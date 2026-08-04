// supabase/functions/upload-midia/index.ts (v2)
// =============================================================================
// v2 (04/08/2026) - acao "thumbnails": GET /{video_id}/thumbnails, LEITURA pura, para medir se a
//   Meta entrega 3+ quadros por video ja enviado. Se entregar, o pipeline de visao ganha
//   multiquadro sem download, sem ffmpeg e sem WASM - nenhum dos tres existe no runtime da edge.
//   Nao sobe nada, nao grava nada, nao consulta trava.
// UPLOAD DE MIDIA: Google Drive (service account, somente leitura) -> biblioteca
// de midia da conta Meta (adimages / advideos). E a ponte que faltava para
// "criar anuncio com criativo novo da pasta": o anuncio replicado passa a poder
// referenciar image_hash / video_id de um arquivo que nasceu no Drive.
//
// CONTRATO (POST, auth x-mcp-key ou Bearer vs mcp_config.api_key):
//   { acao: "plan" | "executar" | "thumbnails",
//     company: "<nome ou uuid>",
//     drive_file_id: "<id do arquivo no Drive>"      // OU
//     nome_arquivo: "<nome exato p/ localizar na pasta de criativos>",
//     account_id: "act_XXXX" (opcional - default: unica conta em contas_permitidas_criacao) }
//
//   plan     -> localiza o arquivo, resolve conta, diz o que ACONTECERIA (nada sobe).
//   executar -> exige TODAS as travas abertas; com dry_run=true registra sem subir.
//
// TRAVAS (padrao da casa, todas verificadas EM ORDEM e com recusa declarada):
//   1. master_enabled da empresa
//   2. action_flags.upload_midia
//   3. conta de destino em contas_permitidas_criacao
//   4. teto por hora (max_actions_per_hour compartilhado com as demais acoes)
//   5. dry_run=true -> registra a intencao e NAO chama a Meta (ensaio)
//   6. dedup: (drive_file_id, conta) ja enviado -> devolve o hash existente, nao reenvia
//
// LIMITES DECLARADOS v1: imagem ate 8 MB (base64 no corpo p/ adimages);
// video ate 45 MB em envio unico (multipart 'source' p/ advideos) - acima disso a
// recusa explica que o envio em partes e v2. Video grande nao e "erro silencioso".
// =============================================================================

import { createClient } from "npm:@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const META_ADS_TOKEN = (Deno.env.get("META_ADS_TOKEN") ?? "").trim();
const GOOGLE_SA_KEY_B64 = (Deno.env.get("GOOGLE_SA_KEY_B64") ?? "").trim();
const DRIVE_CRIATIVOS_FOLDER_ID = (Deno.env.get("DRIVE_CRIATIVOS_FOLDER_ID") ?? "").trim();
const GRAPH = "https://graph.facebook.com/v21.0";
const MAX_IMG_BYTES = 8 * 1024 * 1024;
const MAX_VIDEO_BYTES = 45 * 1024 * 1024;

const supa = createClient(SUPABASE_URL, SERVICE_ROLE, { auth: { persistSession: false } });
const json = (b: unknown, s = 200) =>
  new Response(JSON.stringify(b), { status: s, headers: { "content-type": "application/json" } });

// ---------------- Drive (service account) ----------------
let _tok: { t: string; exp: number } | null = null;
function pemDer(pem: string): ArrayBuffer {
  const b64 = pem.replace(/-----[^-]+-----/g, "").replace(/\s+/g, "");
  const bin = atob(b64); const u = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i);
  return u.buffer;
}
function b64url(d: Uint8Array | string): string {
  const bin = typeof d === "string" ? d : String.fromCharCode(...d);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
async function driveToken(): Promise<string> {
  if (_tok && _tok.exp > Date.now() + 60_000) return _tok.t;
  if (!GOOGLE_SA_KEY_B64) throw new Error("GOOGLE_SA_KEY_B64 ausente");
  const sa = JSON.parse(atob(GOOGLE_SA_KEY_B64));
  const now = Math.floor(Date.now() / 1000);
  const h = b64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const c = b64url(JSON.stringify({ iss: sa.client_email, scope: "https://www.googleapis.com/auth/drive.readonly",
    aud: "https://oauth2.googleapis.com/token", iat: now, exp: now + 3600 }));
  const k = await crypto.subtle.importKey("pkcs8", pemDer(sa.private_key),
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["sign"]);
  const sig = new Uint8Array(await crypto.subtle.sign("RSASSA-PKCS1-v1_5", k, new TextEncoder().encode(`${h}.${c}`)));
  const r = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" },
    body: `grant_type=${encodeURIComponent("urn:ietf:params:oauth:grant-type:jwt-bearer")}&assertion=${h}.${c}.${b64url(sig)}` });
  const j = await r.json();
  if (!j.access_token) throw new Error(`token do Drive falhou: ${JSON.stringify(j).slice(0, 160)}`);
  _tok = { t: j.access_token, exp: Date.now() + (Number(j.expires_in ?? 3600) - 120) * 1000 };
  return _tok.t;
}
async function driveMeta(fileId: string) {
  const t = await driveToken();
  const r = await fetch(`https://www.googleapis.com/drive/v3/files/${fileId}?fields=id,name,mimeType,size,modifiedTime,parents&supportsAllDrives=true`,
    { headers: { authorization: `Bearer ${t}` } });
  const j = await r.json();
  if (!r.ok) throw new Error(`Drive meta ${r.status}: ${JSON.stringify(j).slice(0, 160)}`);
  return j;
}
async function driveBuscarPorNome(nome: string) {
  const t = await driveToken();
  // busca dentro da subarvore por nome exato (o Drive nao filtra por ancestral; busca global do SA
  // e aceitavel: a SA so enxerga o que foi compartilhado com ela = a pasta de criativos)
  const q = encodeURIComponent(`name = '${nome.replace(/'/g, "\\'")}' and trashed = false`);
  const r = await fetch(`https://www.googleapis.com/drive/v3/files?q=${q}&fields=files(id,name,mimeType,size,modifiedTime)&pageSize=5&supportsAllDrives=true&includeItemsFromAllDrives=true`,
    { headers: { authorization: `Bearer ${t}` } });
  const j = await r.json();
  if (!r.ok) throw new Error(`Drive busca ${r.status}: ${JSON.stringify(j).slice(0, 160)}`);
  return j.files ?? [];
}
async function driveBaixar(fileId: string): Promise<Uint8Array> {
  const t = await driveToken();
  const r = await fetch(`https://www.googleapis.com/drive/v3/files/${fileId}?alt=media&supportsAllDrives=true`,
    { headers: { authorization: `Bearer ${t}` } });
  if (!r.ok) throw new Error(`Drive download ${r.status}`);
  return new Uint8Array(await r.arrayBuffer());
}

// ---------------- Meta ----------------
function b64(u: Uint8Array): string {
  let s = ""; const CH = 0x8000;
  for (let i = 0; i < u.length; i += CH) s += String.fromCharCode.apply(null, u.subarray(i, i + CH) as any);
  return btoa(s);
}
async function metaUploadImagem(account: string, nome: string, bytes: Uint8Array) {
  const body = new URLSearchParams({ bytes: b64(bytes), name: nome, access_token: META_ADS_TOKEN });
  const r = await fetch(`${GRAPH}/${account}/adimages`, { method: "POST", body });
  const j = await r.json();
  if (!r.ok) throw new Error(`adimages ${r.status}: ${JSON.stringify(j).slice(0, 220)}`);
  const img = j.images?.[nome] ?? Object.values(j.images ?? {})[0];
  if (!img?.hash) throw new Error(`adimages sem hash: ${JSON.stringify(j).slice(0, 220)}`);
  return String(img.hash);
}
async function metaUploadVideo(account: string, nome: string, bytes: Uint8Array, mime: string) {
  const fd = new FormData();
  fd.set("name", nome);
  fd.set("access_token", META_ADS_TOKEN);
  fd.set("source", new Blob([bytes], { type: mime || "video/mp4" }), nome);
  const r = await fetch(`${GRAPH}/${account}/advideos`, { method: "POST", body: fd });
  const j = await r.json();
  if (!r.ok || !j.id) throw new Error(`advideos ${r.status}: ${JSON.stringify(j).slice(0, 220)}`);
  return String(j.id);
}

// ---------------- Handler ----------------
Deno.serve(async (req) => {
  if (req.method !== "POST") return json({ error: "POST apenas" }, 405);
  const { data: cfg } = await supa.from("mcp_config").select("api_key").eq("id", 1).maybeSingle();
  const auth = req.headers.get("x-mcp-key") ?? (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "");
  if (!cfg?.api_key || auth !== cfg.api_key) return json({ error: "nao autorizado" }, 401);

  let body: any = {};
  try { body = await req.json(); } catch { /* */ }
  const acao = String(body?.acao ?? "plan");
  if (!["plan", "executar", "thumbnails"].includes(acao)) return json({ error: "acao deve ser plan, executar ou thumbnails" }, 400);

  // v2 (04/08/2026) - GT-45 frente 1: LEITURA dos quadros que a Meta gerou para um video ja
  // enviado. GET puro: nao sobe nada, nao escreve em tabela nenhuma, nao consulta trava - por isso
  // vem ANTES da resolucao de empresa e config, que esta acao nao precisa.
  // Existe aqui porque esta edge ja tem o META_ADS_TOKEN e ja e a de midia. O objetivo e medir se
  // a Meta entrega 3+ quadros por video: se entregar, o pipeline de visao ganha multiquadro sem
  // download, sem ffmpeg e sem WASM - nenhum dos tres existe no runtime da edge.
  if (acao === "thumbnails") {
    if (!META_ADS_TOKEN) return json({ error: "META_ADS_TOKEN ausente" }, 500);
    const ids: string[] = Array.isArray(body?.video_ids)
      ? body.video_ids.map((x: unknown) => String(x).trim()).filter(Boolean)
      : (body?.video_id ? [String(body.video_id).trim()] : []);
    if (!ids.length) return json({ error: "informe video_id ou video_ids" }, 400);

    const porVideo: any[] = [];
    for (const vid of ids) {
      const url = `${GRAPH}/${vid}/thumbnails?fields=id,uri,width,height,scale,is_preferred&access_token=${encodeURIComponent(META_ADS_TOKEN)}`;
      const r = await fetch(url);
      const t = await r.text();
      let j: any; try { j = JSON.parse(t); } catch { j = { parse_error: t.slice(0, 200) }; }
      if (!r.ok) { porVideo.push({ video_id: vid, erro: `graph ${r.status}`, detalhe: JSON.stringify(j).slice(0, 300) }); continue; }
      const lista: any[] = Array.isArray(j?.data) ? j.data : [];
      // Um HEAD em cada uri responde a pergunta que decide a rota: o modelo de visao consegue
      // baixar? Se o uri exigir credencial, os quadros existem e nao servem.
      const amostra: any[] = [];
      for (const th of lista.slice(0, 3)) {
        let acessivel: any = null;
        try {
          const h = await fetch(String(th.uri), { method: "HEAD" });
          acessivel = { status: h.status, content_type: h.headers.get("content-type"), bytes: h.headers.get("content-length") };
        } catch (e) { acessivel = { erro: String((e as any)?.message ?? e) }; }
        amostra.push({ id: th.id, width: th.width, height: th.height, scale: th.scale, is_preferred: th.is_preferred, uri_acessivel: acessivel });
      }
      porVideo.push({
        video_id: vid, total_thumbnails: lista.length,
        dimensoes: [...new Set(lista.map((x: any) => `${x.width}x${x.height}`))],
        preferidos: lista.filter((x: any) => x.is_preferred === true).length,
        amostra_com_teste_de_download: amostra,
      });
    }
    const totais = porVideo.map((v) => v.total_thumbnails ?? 0);
    return json({ ok: true, acao: "thumbnails", versao: "upload-midia-v2",
      videos: porVideo,
      veredito_da_rota: totais.length && Math.min(...totais) >= 3
        ? "ROTA VIAVEL: a Meta entrega 3+ quadros por video - multiquadro sem download nem ffmpeg"
        : "ROTA NAO PROVADA: menos de 3 quadros por video, o ganho sobre a miniatura atual e duvidoso",
      nota: "GET puro - nada foi enviado, nada foi gravado. Quadro da Meta e gerado na ingestao do video; nao ha como pedir offset de tempo especifico." });
  }

  // empresa
  const compRef = String(body?.company ?? "").trim();
  if (!compRef) return json({ error: "company obrigatorio (nome ou uuid)" }, 400);
  const { data: comp } = /^[0-9a-f-]{36}$/i.test(compRef)
    ? await supa.from("companies").select("id,name").eq("id", compRef).maybeSingle()
    : await supa.from("companies").select("id,name").ilike("name", `%${compRef}%`).maybeSingle();
  if (!comp) return json({ error: `empresa nao encontrada: ${compRef}` }, 404);

  // travas
  const { data: ex } = await supa.from("meta_execution_config").select("*").eq("company_id", comp.id).maybeSingle();
  if (!ex) return json({ error: "empresa sem configuracao de execucao" }, 400);
  const contas: string[] = ex.contas_permitidas_criacao ?? [];
  const account = String(body?.account_id ?? (contas.length === 1 ? contas[0] : "")).trim();

  // arquivo: por id direto ou por nome
  let fileId = String(body?.drive_file_id ?? "").trim();
  let meta: any = null;
  try {
    if (!fileId && body?.nome_arquivo) {
      const achados = await driveBuscarPorNome(String(body.nome_arquivo));
      if (!achados.length) return json({ error: `arquivo nao encontrado no Drive: ${body.nome_arquivo}` }, 404);
      if (achados.length > 1) return json({ error: "nome ambiguo no Drive", candidatos: achados.map((f: any) => ({ id: f.id, nome: f.name })) }, 409);
      fileId = achados[0].id; meta = achados[0];
    }
    if (!fileId) return json({ error: "informe drive_file_id ou nome_arquivo" }, 400);
    if (!meta) meta = await driveMeta(fileId);
  } catch (e) {
    return json({ error: String((e as any)?.message ?? e), aviso: "falha ao consultar o Drive - nada foi enviado" }, 502);
  }

  const mime = String(meta.mimeType ?? "");
  const tamanho = Number(meta.size ?? 0);
  const tipo = mime.startsWith("image/") ? "imagem" : mime.startsWith("video/") ? "video" : null;

  const travas = {
    master_enabled: ex.master_enabled === true,
    flag_upload_midia: ex.action_flags?.upload_midia === true,
    conta_definida: !!account,
    conta_permitida: !!account && contas.includes(account),
    tipo_suportado: tipo !== null,
    tamanho_ok: tipo === "imagem" ? tamanho <= MAX_IMG_BYTES : tipo === "video" ? tamanho <= MAX_VIDEO_BYTES : false,
  };

  // dedup: ja subiu antes?
  const { data: existente } = await supa.from("media_uploads").select("id,status,meta_image_hash,meta_video_id,enviado_em")
    .eq("drive_file_id", fileId).eq("account_external_id", account || "(indefinida)").maybeSingle();

  const plano = {
    arquivo: { id: fileId, nome: meta.name, mime, tamanho_bytes: tamanho, tipo },
    conta_destino: account || "(indefinida - informe account_id ou cadastre exatamente 1 conta permitida)",
    empresa: comp.name,
    travas,
    ja_enviado: existente?.status === "enviado"
      ? { em: existente.enviado_em, image_hash: existente.meta_image_hash, video_id: existente.meta_video_id,
          nota: "dedup: este arquivo JA esta na biblioteca desta conta - reuso do identificador, nada sera reenviado" }
      : null,
    limites_v1: `imagem <= ${MAX_IMG_BYTES / 1048576} MB; video <= ${MAX_VIDEO_BYTES / 1048576} MB em envio unico (video maior = envio em partes, v2)`,
  };

  if (acao === "plan") return json({ ok: true, acao: "plan", ...plano, nota: "nada foi enviado - ensaio" });

  // ============== executar ==============
  const recusa = (motivo: string) => json({ ok: false, recusado: true, motivo, ...plano }, 403);
  if (!travas.master_enabled) return recusa("master_enabled desligado para a empresa");
  if (!travas.flag_upload_midia) return recusa("flag upload_midia desligada");
  if (!travas.conta_definida) return recusa("conta de destino indefinida");
  if (!travas.conta_permitida) return recusa(`conta ${account} fora de contas_permitidas_criacao`);
  if (!travas.tipo_suportado) return recusa(`tipo nao suportado: ${mime}`);
  if (!travas.tamanho_ok) return recusa(`arquivo excede o limite v1 (${tamanho} bytes)`);

  // teto por hora (compartilhado com as demais acoes de escrita)
  const { count: naHora } = await supa.from("media_uploads").select("id", { count: "exact", head: true })
    .eq("company_id", comp.id).eq("status", "enviado").gte("enviado_em", new Date(Date.now() - 3600_000).toISOString());
  if ((naHora ?? 0) >= (ex.max_actions_per_hour ?? 5)) return recusa(`teto por hora atingido (${ex.max_actions_per_hour})`);

  if (existente?.status === "enviado") {
    return json({ ok: true, acao: "executar", dedup: true,
      image_hash: existente.meta_image_hash, video_id: existente.meta_video_id,
      nota: "arquivo ja estava na biblioteca desta conta - identificador reutilizado, nada reenviado" });
  }

  // dry_run: registra a intencao, NAO chama a Meta
  if (ex.dry_run === true) {
    await supa.from("media_uploads").upsert({
      company_id: comp.id, account_external_id: account, drive_file_id: fileId,
      nome: meta.name, mime, tamanho_bytes: tamanho, tipo, status: "planejado", dry_run: true,
      criado_por: "upload-midia v1",
    }, { onConflict: "drive_file_id,account_external_id" });
    return json({ ok: true, acao: "executar", dry_run: true,
      nota: "ENSAIO: travas abertas e arquivo validado, mas dry_run=true na empresa - registro gravado, NADA enviado a Meta" });
  }

  // envio real
  try {
    const bytes = await driveBaixar(fileId);
    let image_hash: string | null = null, video_id: string | null = null;
    if (tipo === "imagem") image_hash = await metaUploadImagem(account, meta.name, bytes);
    else video_id = await metaUploadVideo(account, meta.name, bytes, mime);
    await supa.from("media_uploads").upsert({
      company_id: comp.id, account_external_id: account, drive_file_id: fileId,
      nome: meta.name, mime, tamanho_bytes: tamanho, tipo, status: "enviado", dry_run: false,
      meta_image_hash: image_hash, meta_video_id: video_id, enviado_em: new Date().toISOString(),
      criado_por: "upload-midia v1",
    }, { onConflict: "drive_file_id,account_external_id" });
    return json({ ok: true, acao: "executar", enviado: true, image_hash, video_id,
      nota: "midia na biblioteca da conta - use image_hash/video_id ao criar o anuncio" });
  } catch (e) {
    const msg = String((e as any)?.message ?? e).slice(0, 400);
    await supa.from("media_uploads").upsert({
      company_id: comp.id, account_external_id: account, drive_file_id: fileId,
      nome: meta.name, mime, tamanho_bytes: tamanho, tipo, status: "erro", dry_run: false, erro: msg,
      criado_por: "upload-midia v1",
    }, { onConflict: "drive_file_id,account_external_id" });
    return json({ ok: false, error: msg }, 502);
  }
});
