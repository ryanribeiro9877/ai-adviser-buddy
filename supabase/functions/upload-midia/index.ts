// supabase/functions/upload-midia/index.ts (v6.1)
// =============================================================================
// v6.1 (27/08/2026) - Resolver empresa por UUID/slug/nome EXATO. ilike %COHAPM%
//   casava tambem "Cooperativa_ Cohapm"; maybeSingle falhava e o cron de
//   escoamento COHAPM respondia 404 a cada hora (chave MCP certa, empresa errada).
// v6 (25/08/2026) - VIDEO ATE 4 GB: envio em partes Graph (upload_phase start/
//   transfer/finish) + Range no Drive. A edge nao baixa o arquivo inteiro.
//   Sessao persistida em media_uploads (status=enviando) para retomar apos o wall.
//   Recusa por tamanho SO acima de 4 GB. Imagem segue 8 MB.
// v5.2 (21/08/2026) - status_video: token Ads POR EMPRESA (company_id/company ou
//   resolve via media_uploads). Sem isso COHAPM lia com token Legal → Graph 400
//   (#100) e o portao de emissao de card falhava fechado. Leitura: GET /{id}?fields=id,status.
// v5 (11/08/2026) - acao "escoar_imagens": sobe as imagens aproveitaveis do acervo que
//   ainda nao tem meta_image_hash, em sequencia, respeitando max_actions_per_hour.
//   Cron horario chama isto; quando nao ha pendente, devolve enviados=0 e para sozinho.
//   So imagem (mime image/ + aproveitavel='sim'); off-brand/reprovadas ficam de fora.
// v4 (04/08/2026) - GT-13: acao "creative": GET /{creative_id}?fields=object_story_spec,...,
//   LEITURA pura, para responder se o molde expoe o spec que a rota "copiar e trocar a midia"
//   precisa. Nao sobe nada, nao grava nada, nao consulta trava. Mesmo padrao da acao
//   "thumbnails", que ja esta provada em producao.
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
//   { acao: "plan" | "executar" | "thumbnails" | "creative" | "escoar_imagens",
//     company: "<nome ou uuid>",
//     drive_file_id: "<id do arquivo no Drive>"      // OU
//     nome_arquivo: "<nome exato p/ localizar na pasta de criativos>",
//     account_id: "act_XXXX" (opcional - default: unica conta em contas_permitidas_criacao) }
//
//   plan           -> localiza o arquivo, resolve conta, diz o que ACONTECERIA (nada sobe).
//   executar       -> exige TODAS as travas abertas; com dry_run=true registra sem subir.
//   escoar_imagens -> lote sequencial das imagens aproveitaveis sem meta_image_hash (cron).
//
// TRAVAS (padrao da casa, todas verificadas EM ORDEM e com recusa declarada):
//   1. master_enabled da empresa
//   2. action_flags.upload_midia
//   3. conta de destino em contas_permitidas_criacao
//   4. teto por hora (max_actions_per_hour compartilhado com as demais acoes)
//   5. dry_run=true -> registra a intencao e NAO chama a Meta (ensaio)
//   6. dedup: (drive_file_id, conta) ja enviado -> devolve o hash existente, nao reenvia
//
// LIMITES: imagem ate 8 MB (base64 no corpo p/ adimages);
// video ate 4 GB (biblioteca Meta), sempre em partes. Nao recusar 50 MB–4 GB.
// =============================================================================

// esm.sh, nao npm:, para casar com _shared/mcp_auth.ts e com as outras 22 edges
// (mesmo motivo registrado em mcp-server/index.ts).
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { chaveMcpDe, mcpKeyValida } from "../_shared/mcp_auth.ts";
import {
  COMPANY_LEGAL,
  matchEmpresaPorRef,
  redactAllMetaTokens,
  tokenAdsPorCompanyId,
} from "../_shared/meta_company_tokens.ts";
import {
  MAX_IMG_BYTES,
  MAX_VIDEO_BYTES,
  VIDEO_WALL_MS,
  driveRangeHeader,
  faixaAEnviar,
  limitesUploadCopy,
  nextPhase,
  parseGraphOffsets,
  recusaTamanhoImagem,
  recusaTamanhoVideo,
  sessaoDeLinha,
  type VideoSessao,
} from "../_shared/meta_video_chunked.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
/** Token Ads da empresa do request — nunca fallback cruzado. */
let META_ADS_TOKEN = "";
const GOOGLE_SA_KEY_B64 = (Deno.env.get("GOOGLE_SA_KEY_B64") ?? "").trim();
const GRAPH = "https://graph.facebook.com/v21.0";
const GRAPH_VIDEO = "https://graph-video.facebook.com/v21.0";

const supa = createClient(SUPABASE_URL, SERVICE_ROLE, { auth: { persistSession: false } });
const json = (b: unknown, s = 200) =>
  new Response(redactAllMetaTokens(JSON.stringify(b)), {
    status: s,
    headers: { "content-type": "application/json" },
  });

function ativarTokenEmpresa(companyId: string): { ok: true } | { ok: false; error: string } {
  const t = tokenAdsPorCompanyId(companyId);
  if (!t) {
    META_ADS_TOKEN = "";
    return {
      ok: false,
      error:
        `token Ads ausente para company_id=${companyId} — sem fallback para outra empresa`,
    };
  }
  META_ADS_TOKEN = t.token;
  return { ok: true };
}

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

async function driveBaixarFaixa(fileId: string, start: number, endExclusive: number): Promise<Uint8Array> {
  const esperado = endExclusive - start;
  const t = await driveToken();
  const r = await fetch(
    `https://www.googleapis.com/drive/v3/files/${fileId}?alt=media&supportsAllDrives=true`,
    { headers: { authorization: `Bearer ${t}`, range: driveRangeHeader(start, endExclusive) } },
  );
  const cl = Number(r.headers.get("content-length") ?? NaN);
  if (r.status === 200 && Number.isFinite(cl) && cl > esperado + 1024) {
    try { await r.body?.cancel(); } catch { /* */ }
    throw new Error("Drive ignorou Range e devolveu o arquivo inteiro — abortado para nao estourar memoria");
  }
  if (r.status !== 206 && r.status !== 200) throw new Error(`Drive range ${r.status}`);
  const bytes = new Uint8Array(await r.arrayBuffer());
  if (!bytes.length) throw new Error(`Drive range vazio em ${start}-${endExclusive}`);
  return bytes;
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

async function graphAdvideos(account: string, fd: FormData): Promise<any> {
  const r = await fetch(`${GRAPH_VIDEO}/${account}/advideos`, { method: "POST", body: fd });
  const j = await r.json();
  if (!r.ok || j?.error) throw new Error(`advideos ${r.status}: ${JSON.stringify(j).slice(0, 280)}`);
  return j;
}

async function metaVideoStart(account: string, tamanho: number): Promise<VideoSessao> {
  const fd = new FormData();
  fd.set("upload_phase", "start");
  fd.set("file_size", String(tamanho));
  fd.set("access_token", META_ADS_TOKEN);
  const j = await graphAdvideos(account, fd);
  const off = parseGraphOffsets(j);
  const session_id = String(j.upload_session_id ?? "").trim();
  const video_id = String(j.video_id ?? j.id ?? "").trim();
  if (!session_id) throw new Error(`advideos start sem upload_session_id: ${JSON.stringify(j).slice(0, 200)}`);
  return { session_id, video_id, start: off.start, end: off.end };
}

async function metaVideoTransfer(
  account: string,
  sessao: VideoSessao,
  chunk: Uint8Array,
  nome: string,
  mime: string,
): Promise<VideoSessao> {
  const fd = new FormData();
  fd.set("upload_phase", "transfer");
  fd.set("upload_session_id", sessao.session_id);
  fd.set("start_offset", String(sessao.start));
  fd.set("access_token", META_ADS_TOKEN);
  fd.set("video_file_chunk", new Blob([chunk as Uint8Array<ArrayBuffer>], { type: mime || "video/mp4" }), nome);
  const j = await graphAdvideos(account, fd);
  const off = parseGraphOffsets(j);
  return {
    session_id: sessao.session_id,
    video_id: String(j.video_id ?? sessao.video_id ?? "").trim(),
    start: off.start,
    end: off.end,
  };
}

async function metaVideoFinish(account: string, sessao: VideoSessao, nome: string): Promise<string> {
  const fd = new FormData();
  fd.set("upload_phase", "finish");
  fd.set("upload_session_id", sessao.session_id);
  fd.set("title", nome);
  fd.set("name", nome);
  fd.set("access_token", META_ADS_TOKEN);
  const j = await graphAdvideos(account, fd);
  const id = String(j.video_id ?? j.id ?? sessao.video_id ?? "").trim();
  if (!id && j.success !== true) throw new Error(`advideos finish sem video_id: ${JSON.stringify(j).slice(0, 200)}`);
  return id || sessao.video_id;
}

type VideoUploadOut =
  | { ok: true; feito: true; video_id: string }
  | { ok: true; feito: false; em_andamento: true; sessao: VideoSessao; bytes_enviados: number }
  | { ok: false; erro: string };

async function gravarSessaoVideo(p: {
  companyId: string;
  account: string;
  fileId: string;
  nome: string;
  mime: string;
  tamanho: number;
  status: "enviando" | "enviado" | "erro";
  sessao?: VideoSessao | null;
  video_id?: string | null;
  erro?: string | null;
}) {
  const enviado = p.status === "enviado";
  const enviando = p.status === "enviando";
  await supa.from("media_uploads").upsert({
    company_id: p.companyId,
    account_external_id: p.account,
    drive_file_id: p.fileId,
    nome: p.nome,
    mime: p.mime,
    tamanho_bytes: p.tamanho,
    tipo: "video",
    status: p.status,
    dry_run: false,
    erro: p.erro ?? null,
    meta_video_id: enviado ? (p.video_id ?? p.sessao?.video_id ?? null) : null,
    upload_session_id: enviando ? (p.sessao?.session_id ?? null) : null,
    upload_video_id: enviando ? (p.sessao?.video_id ?? null) : null,
    upload_start_offset: enviando ? (p.sessao?.start ?? null) : null,
    upload_end_offset: enviando ? (p.sessao?.end ?? null) : null,
    enviado_em: enviado ? new Date().toISOString() : null,
    criado_por: "upload-midia v6",
  }, { onConflict: "drive_file_id,account_external_id" });
}

async function enviarVideoEmPartes(opts: {
  account: string;
  fileId: string;
  nome: string;
  mime: string;
  tamanho: number;
  companyId: string;
  sessaoExistente?: VideoSessao | null;
  wallMs?: number;
  jaReiniciou?: boolean;
}): Promise<VideoUploadOut> {
  const wall = opts.wallMs ?? VIDEO_WALL_MS;
  const t0 = Date.now();
  let sessao = opts.sessaoExistente ?? null;
  try {
    if (!sessao) {
      sessao = await metaVideoStart(opts.account, opts.tamanho);
      await gravarSessaoVideo({
        companyId: opts.companyId, account: opts.account, fileId: opts.fileId,
        nome: opts.nome, mime: opts.mime, tamanho: opts.tamanho,
        status: "enviando", sessao,
      });
    }
    while (nextPhase(sessao.start, sessao.end) === "transfer") {
      if (Date.now() - t0 > wall - 8_000) {
        await gravarSessaoVideo({
          companyId: opts.companyId, account: opts.account, fileId: opts.fileId,
          nome: opts.nome, mime: opts.mime, tamanho: opts.tamanho,
          status: "enviando", sessao,
        });
        return { ok: true, feito: false, em_andamento: true, sessao, bytes_enviados: sessao.start };
      }
      const faixa = faixaAEnviar(sessao.start, sessao.end);
      const chunk = await driveBaixarFaixa(opts.fileId, faixa.start, faixa.end);
      sessao = await metaVideoTransfer(opts.account, { ...sessao, start: faixa.start, end: faixa.end }, chunk, opts.nome, opts.mime);
      await gravarSessaoVideo({
        companyId: opts.companyId, account: opts.account, fileId: opts.fileId,
        nome: opts.nome, mime: opts.mime, tamanho: opts.tamanho,
        status: "enviando", sessao,
      });
    }
    const video_id = await metaVideoFinish(opts.account, sessao, opts.nome);
    await gravarSessaoVideo({
      companyId: opts.companyId, account: opts.account, fileId: opts.fileId,
      nome: opts.nome, mime: opts.mime, tamanho: opts.tamanho,
      status: "enviado", sessao, video_id,
    });
    return { ok: true, feito: true, video_id };
  } catch (e) {
    const msg = String((e as any)?.message ?? e).slice(0, 400);
    const sessaoExpirou = /session|offset|upload_phase/i.test(msg) && !!opts.sessaoExistente && !opts.jaReiniciou;
    if (sessaoExpirou && opts.sessaoExistente) {
      try {
        return await enviarVideoEmPartes({ ...opts, sessaoExistente: null, jaReiniciou: true });
      } catch (e2) {
        const msg2 = String((e2 as any)?.message ?? e2).slice(0, 400);
        await gravarSessaoVideo({
          companyId: opts.companyId, account: opts.account, fileId: opts.fileId,
          nome: opts.nome, mime: opts.mime, tamanho: opts.tamanho,
          status: "erro", sessao, erro: msg2,
        });
        return { ok: false, erro: msg2 };
      }
    }
    await gravarSessaoVideo({
      companyId: opts.companyId, account: opts.account, fileId: opts.fileId,
      nome: opts.nome, mime: opts.mime, tamanho: opts.tamanho,
      status: sessao ? "enviando" : "erro",
      sessao,
      erro: sessao ? `pausa_com_erro: ${msg}` : msg,
    });
    if (sessao) return { ok: true, feito: false, em_andamento: true, sessao, bytes_enviados: sessao.start };
    return { ok: false, erro: msg };
  }
}

// ---------------- Handler ----------------
Deno.serve(async (req) => {
  if (req.method !== "POST") return json({ error: "POST apenas" }, 405);
  const auth = await mcpKeyValida(supa, chaveMcpDe(req, "header-or-bearer"));
  if (!auth.ok) return json({ error: "nao autorizado", motivo: auth.motivo }, 401);

  let body: any = {};
  try { body = await req.json(); } catch { /* */ }
  const acao = String(body?.acao ?? "plan");
  const wallMsReq = Number(body?.wall_ms);
  const wallMs = Number.isFinite(wallMsReq) && wallMsReq >= 10_000
    ? Math.min(90_000, wallMsReq)
    : undefined;
  if (!["plan", "executar", "thumbnails", "creative", "escoar_imagens", "escoar_videos", "status_video"].includes(acao)) {
    return json({ error: "acao deve ser plan, executar, thumbnails, creative, escoar_imagens, escoar_videos ou status_video" }, 400);
  }

  // v4 (04/08/2026) - GT-13: LEITURA do object_story_spec de um criativo que ja roda. GET puro,
  // mesmo padrao provado da acao "thumbnails": nao sobe nada, nao grava nada, nao consulta trava,
  // e por isso vem antes da resolucao de empresa. Existe para responder UMA pergunta de desenho:
  // a rota "copiar o spec do molde e trocar a midia" e viavel, ou o molde nao expoe o spec?
  // A resposta decide se `criar_anuncio_a_partir_de` com peca nova pode existir sem montar spec
  // do zero - e montar do zero exigiria a URL de destino, que nao esta em tabela nenhuma.
  if (acao === "creative") {
    // Probe: company_id UUID se informado; senao Legal (META_ADS_TOKEN legado).
    const companyProbe = String(body?.company_id ?? "").trim() || COMPANY_LEGAL;
    const ativ = ativarTokenEmpresa(companyProbe);
    if (!ativ.ok) return json({ error: ativ.error }, 500);
    const ids: string[] = Array.isArray(body?.creative_ids)
      ? body.creative_ids.map((x: unknown) => String(x).trim()).filter(Boolean)
      : (body?.creative_id ? [String(body.creative_id).trim()] : []);
    if (!ids.length) return json({ error: "informe creative_id ou creative_ids" }, 400);

    const CAMPOS = "id,name,object_type,object_story_spec,asset_feed_spec,thumbnail_url,image_hash,video_id,url_tags,degrees_of_freedom_spec";
    const lidos: any[] = [];
    for (const cid of ids) {
      const url = `${GRAPH}/${cid}?fields=${CAMPOS}&access_token=${encodeURIComponent(META_ADS_TOKEN)}`;
      const r = await fetch(url);
      const t = await r.text();
      let j: any; try { j = JSON.parse(t); } catch { j = { parse_error: t.slice(0, 200) }; }
      if (!r.ok) { lidos.push({ creative_id: cid, erro: `graph ${r.status}`, detalhe: JSON.stringify(j).slice(0, 300) }); continue; }

      const spec = j?.object_story_spec ?? null;
      const ld = spec?.link_data ?? null;
      const vd = spec?.video_data ?? null;
      // O que interessa nao e "veio algo", e "veio o suficiente para copiar": page_id (sem ele a
      // Meta recusa a criacao) e o link de destino (sem ele so daria para inventar URL, que e
      // exatamente o que nao se faz). Declarado campo a campo, nao como booleano unico.
      lidos.push({
        creative_id: cid, nome: j?.name ?? null, object_type: j?.object_type ?? null,
        tem_object_story_spec: !!spec,
        spec_chaves: spec ? Object.keys(spec) : null,
        page_id: spec?.page_id ?? null,
        instagram_actor_id: spec?.instagram_actor_id ?? spec?.instagram_user_id ?? null,
        formato_do_spec: vd ? "video_data" : ld ? "link_data" : spec ? "outro" : null,
        link_destino: ld?.link ?? vd?.call_to_action?.value?.link ?? ld?.call_to_action?.value?.link ?? null,
        legenda_do_spec: (ld?.message ?? vd?.message ?? null),
        call_to_action_type: (ld?.call_to_action?.type ?? vd?.call_to_action?.type ?? null),
        video_data_chaves: vd ? Object.keys(vd) : null,
        link_data_chaves: ld ? Object.keys(ld) : null,
        image_hash_no_spec: ld?.image_hash ?? vd?.image_hash ?? null,
        video_id_no_spec: vd?.video_id ?? null,
        tem_asset_feed_spec: !!j?.asset_feed_spec,
        // v4.1: quando o spec vem so com page_id e ha asset_feed_spec, o criativo e flexivel
        // (Advantage+): midia, textos e link vivem AQUI, e a rota de copia tem de olhar para ca.
        afs_chaves: j?.asset_feed_spec ? Object.keys(j.asset_feed_spec) : null,
        afs_videos: Array.isArray(j?.asset_feed_spec?.videos) ? j.asset_feed_spec.videos.length : null,
        afs_link_urls: Array.isArray(j?.asset_feed_spec?.link_urls)
          ? j.asset_feed_spec.link_urls.map((l: any) => l?.website_url ?? null) : null,
        url_tags: j?.url_tags ?? null,
        thumbnail_url: j?.thumbnail_url ?? null,
        // Enviado inteiro so quando pedido: e o material da decisao de copia, e cabe olhar cru.
        spec_cru: body?.incluir_spec_cru === true ? spec : undefined,
        afs_cru: body?.incluir_spec_cru === true ? (j?.asset_feed_spec ?? null) : undefined,
      });
    }
    const copiaveis = lidos.filter((x) => x.tem_object_story_spec && x.page_id && x.link_destino);
    return json({ ok: true, acao: "creative", versao: "upload-midia-v4",
      criativos: lidos,
      copiaveis: copiaveis.length, lidos_com_erro: lidos.filter((x) => x.erro).length,
      veredito_da_rota: copiaveis.length
        ? "ROTA VIAVEL: ha molde que expoe object_story_spec com page_id e link - da para copiar o spec e trocar a midia"
        : "ROTA NAO PROVADA: nenhum dos criativos lidos expoe spec com page_id e link - copiar a midia exigiria montar spec do zero, e a URL de destino nao existe em tabela nenhuma",
      nota: "GET puro - nada foi enviado, nada foi gravado. link_destino nulo com spec presente significa que o molde nao carrega a URL onde este codigo a procura; nao presuma ausencia de link no anuncio." });
  }

  // v2 (04/08/2026) - GT-45 frente 1: LEITURA dos quadros que a Meta gerou para um video ja
  // enviado. GET puro: nao sobe nada, nao escreve em tabela nenhuma, nao consulta trava - por isso
  // vem ANTES da resolucao de empresa e config, que esta acao nao precisa.
  // Existe aqui porque esta edge ja tem o META_ADS_TOKEN e ja e a de midia. O objetivo e medir se
  // a Meta entrega 3+ quadros por video: se entregar, o pipeline de visao ganha multiquadro sem
  // download, sem ffmpeg e sem WASM - nenhum dos tres existe no runtime da edge.
  if (acao === "thumbnails") {
    const companyProbe = String(body?.company_id ?? "").trim() || COMPANY_LEGAL;
    const ativ = ativarTokenEmpresa(companyProbe);
    if (!ativ.ok) return json({ error: ativ.error }, 500);
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
      // v2.1: com medir_todos, mede TODOS - o consumidor precisa do content-length de cada quadro
      // para calcular a mediana e descartar os quase uniformes. Sem isso ele teria de escolher
      // quadro por posicao, e a posicao 1 e justamente onde mora a abertura em fundo liso.
      const medirTodos = body?.medir_todos === true;
      const quantosMedir = medirTodos ? lista.length : Math.min(3, lista.length);
      const medidos: any[] = [];
      for (let i = 0; i < quantosMedir; i++) {
        const th = lista[i];
        let bytes: number | null = null, status: number | null = null, ctype: string | null = null, erro: string | null = null;
        try {
          const h = await fetch(String(th.uri), { method: "HEAD" });
          status = h.status; ctype = h.headers.get("content-type");
          const cl = h.headers.get("content-length");
          bytes = cl ? Number(cl) : null;
        } catch (e) { erro = String((e as any)?.message ?? e); }
        medidos.push({ indice: i, id: th.id, uri: medirTodos ? th.uri : undefined,
          width: th.width, height: th.height, scale: th.scale, is_preferred: th.is_preferred,
          bytes, http_status: status, content_type: ctype, erro });
      }
      const tamanhos = medidos.map((m) => m.bytes).filter((b) => typeof b === "number" && b > 0).sort((a, b) => a - b);
      const mediana = tamanhos.length
        ? (tamanhos.length % 2 ? tamanhos[(tamanhos.length - 1) / 2] : (tamanhos[tamanhos.length / 2 - 1] + tamanhos[tamanhos.length / 2]) / 2)
        : null;
      porVideo.push({
        video_id: vid, total_thumbnails: lista.length,
        dimensoes: [...new Set(lista.map((x: any) => `${x.width}x${x.height}`))],
        preferidos: lista.filter((x: any) => x.is_preferred === true).length,
        mediana_bytes: mediana,
        quadros: medidos,
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

  // v5.1 (11/08/2026) - status de processamento de um video JA na biblioteca.
  // advideos devolve id antes do video ficar pronto; anuncio apontando para video
  // ainda processando falha. Esta acao e LEITURA pura do status.video_status.
  // v5.2: token da EMPRESA dona do video (nao default cego para Legal).
  if (acao === "status_video") {
    const vid = String(body?.video_id ?? body?.meta_video_id ?? "").trim();
    if (!vid) return json({ error: "informe video_id ou meta_video_id" }, 400);

    let companyProbe = String(body?.company_id ?? body?.company ?? "").trim();
    let accountHint: string | null = null;
    // Dono do video no espelho prevalece: token da empresa que enviou (evita Graph 400
    // com token Legal em video COHAPM, e vice-versa).
    const { data: row } = await supa.from("media_uploads")
      .select("company_id, account_external_id")
      .eq("meta_video_id", vid)
      .eq("status", "enviado")
      .order("enviado_em", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (row?.company_id) companyProbe = String(row.company_id);
    if (row?.account_external_id) accountHint = String(row.account_external_id);
    if (!companyProbe || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(companyProbe)) {
      const { data: empresas } = await supa.from("companies").select("id,name");
      const hit = matchEmpresaPorRef(companyProbe, empresas ?? []);
      companyProbe = hit.ok ? hit.id : COMPANY_LEGAL;
    }

    const ativ = ativarTokenEmpresa(companyProbe);
    if (!ativ.ok) return json({ error: ativ.error }, 500);

    // Meta docs: GET /{video-id}?fields=status → status.video_status (ready|processing|error).
    // Nao pedir title/length: desnecessarios para o portao e historicamente sensiveis a #100.
    const url =
      `${GRAPH}/${encodeURIComponent(vid)}?fields=id,status` +
      `&access_token=${encodeURIComponent(META_ADS_TOKEN)}`;
    const r = await fetch(url);
    const t = await r.text();
    let j: any; try { j = JSON.parse(t); } catch { j = { parse_error: t.slice(0, 200) }; }
    if (!r.ok) {
      return json({
        ok: false, acao: "status_video", video_id: vid,
        company_id: companyProbe, account_external_id: accountHint,
        erro: `graph ${r.status}`, detalhe: JSON.stringify(j).slice(0, 300),
      }, 502);
    }
    const st = j?.status ?? null;
    const videoStatus = (st && typeof st === "object")
      ? (String(st.video_status ?? "").trim() || null)
      : null;
    const pronto = videoStatus === "ready";
    return json({
      ok: true, acao: "status_video", versao: "upload-midia-v5.2",
      video_id: String(j?.id ?? vid),
      company_id: companyProbe,
      account_external_id: accountHint,
      status_cru: st,
      status_processamento: videoStatus,
      pronto,
      nota: pronto
        ? "Video pronto para uso em anuncio."
        : (videoStatus
          ? `Video ainda nao pronto (status_processamento=${videoStatus}). NAO emita card apontando para este id ate ficar ready - anuncio com video processando falha na Meta.`
          : "Graph nao devolveu status.video_status legivel; nao afirme prontidao. Reconsulte antes de emitir card."),
    });
  }

  // empresa — UUID, slug (COHAPM/Legal) ou nome EXATO. Nunca ilike %x%:
  // %COHAPM% casa tambem "Cooperativa_ Cohapm" e maybeSingle falha fechado (404).
  const compRef = String(body?.company_id ?? body?.company ?? "").trim();
  if (!compRef) return json({ error: "company obrigatorio (nome, slug ou uuid)" }, 400);
  const { data: empresas } = await supa.from("companies").select("id,name");
  const hitEmpresa = matchEmpresaPorRef(compRef, empresas ?? []);
  if (!hitEmpresa.ok) {
    return json({
      error: `empresa nao encontrada: ${compRef}`,
      motivo: hitEmpresa.motivo,
      matches: hitEmpresa.matches,
    }, 404);
  }
  const comp = { id: hitEmpresa.id, name: hitEmpresa.name };

  // Token Ads DA EMPRESA resolvida — se COHAPM sem secret, falha (não usa Legal).
  const ativEmpresa = ativarTokenEmpresa(comp.id);
  if (!ativEmpresa.ok) return json({ error: ativEmpresa.error }, 500);

  // travas
  const { data: ex } = await supa.from("meta_execution_config").select("*").eq("company_id", comp.id).maybeSingle();
  if (!ex) return json({ error: "empresa sem configuracao de execucao" }, 400);
  const contas: string[] = ex.contas_permitidas_criacao ?? [];
  const account = String(body?.account_id ?? (contas.length === 1 ? contas[0] : "")).trim();

  // ============== escoar_imagens (cron horario) ==============
  // Sobe as imagens aproveitaveis do acervo que ainda nao tem meta_image_hash.
  // Sequencial (nao paralelo) para o teto por hora ser medido de verdade a cada envio.
  // Quando nao ha pendente, devolve enviados=0 — o cron continua agendado mas nao faz nada.
  if (acao === "escoar_imagens") {
    if (!META_ADS_TOKEN) return json({ error: `token Ads ausente para empresa ${comp.name}` }, 500);
    if (ex.master_enabled !== true) {
      return json({ ok: false, recusado: true, motivo: "master_enabled desligado para a empresa" }, 403);
    }
    if (ex.action_flags?.upload_midia !== true) {
      return json({ ok: false, recusado: true, motivo: "flag upload_midia desligada" }, 403);
    }
    if (!account) return json({ ok: false, recusado: true, motivo: "conta de destino indefinida" }, 403);
    if (!contas.includes(account)) {
      return json({ ok: false, recusado: true, motivo: `conta ${account} fora de contas_permitidas_criacao` }, 403);
    }

    const teto = Number(ex.max_actions_per_hour ?? 5);
    const { count: naHora } = await supa.from("media_uploads").select("id", { count: "exact", head: true })
      .eq("company_id", comp.id).eq("status", "enviado")
      .gte("enviado_em", new Date(Date.now() - 3600_000).toISOString());
    const slots = Math.max(0, teto - (naHora ?? 0));
    if (slots === 0) {
      return json({
        ok: true, acao: "escoar_imagens", versao: "upload-midia-v5",
        enviados: 0, dedup: 0, falhas: 0, slots: 0, na_hora: naHora ?? 0, teto,
        nota: "teto por hora atingido - nada enviado nesta janela; o cron tenta de novo na proxima",
      });
    }

    // Pendentes: imagem com analise aproveitavel='sim' e SEM meta_image_hash enviado nesta conta.
    // Off-brand/reprovadas (aproveitavel != sim) ficam de fora de proposito.
    const { data: analises, error: errAn } = await supa.from("drive_midia_analises")
      .select("drive_file_id, nome, mime, aproveitavel, analisado_em")
      .eq("company_id", comp.id)
      .like("mime", "image/%")
      .eq("aproveitavel", "sim")
      .order("analisado_em", { ascending: false });
    if (errAn) return json({ error: `falha ao listar acervo: ${errAn.message}` }, 500);

    const visto = new Set<string>();
    const candidatos: { drive_file_id: string; nome: string; mime: string }[] = [];
    for (const a of analises ?? []) {
      const id = String(a.drive_file_id ?? "").trim();
      if (!id || visto.has(id)) continue;
      visto.add(id);
      candidatos.push({ drive_file_id: id, nome: String(a.nome ?? id), mime: String(a.mime ?? "") });
    }

    const { data: jaNaMeta } = await supa.from("media_uploads")
      .select("drive_file_id")
      .eq("company_id", comp.id)
      .eq("account_external_id", account)
      .eq("status", "enviado")
      .not("meta_image_hash", "is", null);
    const comHash = new Set((jaNaMeta ?? []).map((r: any) => String(r.drive_file_id)));
    const pendentes = candidatos.filter((c) => !comHash.has(c.drive_file_id));

    if (!pendentes.length) {
      return json({
        ok: true, acao: "escoar_imagens", versao: "upload-midia-v5",
        enviados: 0, dedup: 0, falhas: 0, pendentes: 0, slots, na_hora: naHora ?? 0, teto,
        nota: "nada pendente - cron para sozinho (sem trabalho nesta corrida)",
      });
    }

    const lote = pendentes.slice(0, slots);
    const resultados: any[] = [];
    let enviados = 0, dedup = 0, falhas = 0;

    for (const item of lote) {
      // Reconta o teto a cada item: se outra escrita consumiu o slot, para.
      const { count: agora } = await supa.from("media_uploads").select("id", { count: "exact", head: true })
        .eq("company_id", comp.id).eq("status", "enviado")
        .gte("enviado_em", new Date(Date.now() - 3600_000).toISOString());
      if ((agora ?? 0) >= teto) {
        resultados.push({ drive_file_id: item.drive_file_id, nome: item.nome, status: "parado_pelo_teto" });
        break;
      }

      const { data: existente } = await supa.from("media_uploads")
        .select("id,status,meta_image_hash,enviado_em")
        .eq("drive_file_id", item.drive_file_id)
        .eq("account_external_id", account)
        .maybeSingle();
      if (existente?.status === "enviado" && existente.meta_image_hash) {
        dedup++;
        resultados.push({
          drive_file_id: item.drive_file_id, nome: item.nome, status: "dedup",
          image_hash: existente.meta_image_hash,
        });
        continue;
      }

      if (ex.dry_run === true) {
        await supa.from("media_uploads").upsert({
          company_id: comp.id, account_external_id: account, drive_file_id: item.drive_file_id,
          nome: item.nome, mime: item.mime, tipo: "imagem", status: "planejado", dry_run: true,
          criado_por: "upload-midia v5 escoar_imagens",
        }, { onConflict: "drive_file_id,account_external_id" });
        resultados.push({ drive_file_id: item.drive_file_id, nome: item.nome, status: "dry_run" });
        continue;
      }

      try {
        const meta = await driveMeta(item.drive_file_id);
        const mime = String(meta.mimeType ?? item.mime);
        const tamanho = Number(meta.size ?? 0);
        if (!mime.startsWith("image/")) {
          falhas++;
          resultados.push({ drive_file_id: item.drive_file_id, nome: item.nome, status: "erro",
            erro: `tipo nao suportado no escoamento de imagem: ${mime}` });
          continue;
        }
        if (tamanho > MAX_IMG_BYTES) {
          falhas++;
          const msg = recusaTamanhoImagem(tamanho);
          await supa.from("media_uploads").upsert({
            company_id: comp.id, account_external_id: account, drive_file_id: item.drive_file_id,
            nome: meta.name ?? item.nome, mime, tamanho_bytes: tamanho, tipo: "imagem",
            status: "erro", dry_run: false, erro: msg, criado_por: "upload-midia v5 escoar_imagens",
          }, { onConflict: "drive_file_id,account_external_id" });
          resultados.push({ drive_file_id: item.drive_file_id, nome: meta.name ?? item.nome, status: "erro", erro: msg });
          continue;
        }

        const bytes = await driveBaixar(item.drive_file_id);
        const image_hash = await metaUploadImagem(account, meta.name ?? item.nome, bytes);
        await supa.from("media_uploads").upsert({
          company_id: comp.id, account_external_id: account, drive_file_id: item.drive_file_id,
          nome: meta.name ?? item.nome, mime, tamanho_bytes: tamanho, tipo: "imagem",
          status: "enviado", dry_run: false, meta_image_hash: image_hash,
          enviado_em: new Date().toISOString(), criado_por: "upload-midia v5 escoar_imagens",
        }, { onConflict: "drive_file_id,account_external_id" });
        enviados++;
        resultados.push({
          drive_file_id: item.drive_file_id, nome: meta.name ?? item.nome,
          status: "enviado", image_hash,
        });
      } catch (e) {
        falhas++;
        const msg = String((e as any)?.message ?? e).slice(0, 400);
        await supa.from("media_uploads").upsert({
          company_id: comp.id, account_external_id: account, drive_file_id: item.drive_file_id,
          nome: item.nome, mime: item.mime, tipo: "imagem", status: "erro", dry_run: false,
          erro: msg, criado_por: "upload-midia v5 escoar_imagens",
        }, { onConflict: "drive_file_id,account_external_id" });
        resultados.push({ drive_file_id: item.drive_file_id, nome: item.nome, status: "erro", erro: msg });
      }
    }

    return json({
      ok: true, acao: "escoar_imagens", versao: "upload-midia-v5",
      enviados, dedup, falhas,
      pendentes_antes: pendentes.length,
      pendentes_depois: Math.max(0, pendentes.length - enviados - dedup),
      slots, na_hora_antes: naHora ?? 0, teto,
      resultados,
      nota: pendentes.length <= enviados + dedup
        ? "acervo aproveitavel escoado - proximas corridas nao tem o que subir"
        : `ainda ha pendentes; o cron horario escoa ate ${teto}/hora`,
    });
  }

  // ============== escoar_videos (cron horario, mesmo teto) ==============
  if (acao === "escoar_videos") {
    if (!META_ADS_TOKEN) return json({ error: `token Ads ausente para empresa ${comp.name}` }, 500);
    if (ex.master_enabled !== true) {
      return json({ ok: false, recusado: true, motivo: "master_enabled desligado para a empresa" }, 403);
    }
    if (ex.action_flags?.upload_midia !== true) {
      return json({ ok: false, recusado: true, motivo: "flag upload_midia desligada" }, 403);
    }
    if (!account) return json({ ok: false, recusado: true, motivo: "conta de destino indefinida" }, 403);
    if (!contas.includes(account)) {
      return json({ ok: false, recusado: true, motivo: `conta ${account} fora de contas_permitidas_criacao` }, 403);
    }

    const teto = Number(ex.max_actions_per_hour ?? 5);
    const { count: naHora } = await supa.from("media_uploads").select("id", { count: "exact", head: true })
      .eq("company_id", comp.id).eq("status", "enviado")
      .gte("enviado_em", new Date(Date.now() - 3600_000).toISOString());
    const slots = Math.max(0, teto - (naHora ?? 0));
    if (slots === 0) {
      return json({
        ok: true, acao: "escoar_videos", versao: "upload-midia-v5.1",
        enviados: 0, dedup: 0, falhas: 0, slots: 0, na_hora: naHora ?? 0, teto,
        nota: "teto por hora atingido - nada enviado nesta janela; o cron tenta de novo na proxima",
      });
    }

    const { data: analises, error: errAn } = await supa.from("drive_midia_analises")
      .select("drive_file_id, nome, mime, aproveitavel, analisado_em")
      .eq("company_id", comp.id)
      .like("mime", "video/%")
      .eq("aproveitavel", "sim")
      .order("analisado_em", { ascending: false });
    if (errAn) return json({ error: `falha ao listar acervo: ${errAn.message}` }, 500);

    const visto = new Set<string>();
    const candidatos: { drive_file_id: string; nome: string; mime: string }[] = [];
    for (const a of analises ?? []) {
      const id = String(a.drive_file_id ?? "").trim();
      if (!id || visto.has(id)) continue;
      visto.add(id);
      candidatos.push({ drive_file_id: id, nome: String(a.nome ?? id), mime: String(a.mime ?? "") });
    }

    const { data: jaNaMeta } = await supa.from("media_uploads")
      .select("drive_file_id")
      .eq("company_id", comp.id)
      .eq("account_external_id", account)
      .eq("status", "enviado")
      .not("meta_video_id", "is", null);
    const comId = new Set((jaNaMeta ?? []).map((r: any) => String(r.drive_file_id)));
    const pendentes = candidatos.filter((c) => !comId.has(c.drive_file_id));

    if (!pendentes.length) {
      return json({
        ok: true, acao: "escoar_videos", versao: "upload-midia-v5.1",
        enviados: 0, dedup: 0, falhas: 0, pendentes: 0, slots, na_hora: naHora ?? 0, teto,
        nota: "nada pendente - cron para sozinho (sem trabalho nesta corrida)",
      });
    }

    const { data: emCurso } = await supa.from("media_uploads")
      .select("drive_file_id, nome, mime")
      .eq("company_id", comp.id)
      .eq("account_external_id", account)
      .eq("tipo", "video")
      .eq("status", "enviando");
    const continuacoes = (emCurso ?? []).map((r: any) => ({
      drive_file_id: String(r.drive_file_id),
      nome: String(r.nome ?? r.drive_file_id),
      mime: String(r.mime ?? "video/mp4"),
    }));
    const idsCurso = new Set(continuacoes.map((c) => c.drive_file_id));
    const lote = [...continuacoes, ...pendentes.filter((p) => !idsCurso.has(p.drive_file_id)).slice(0, slots)];
    const resultados: any[] = [];
    let enviados = 0, dedup = 0, falhas = 0;

    for (const item of lote) {
      const { data: existentePre } = await supa.from("media_uploads")
        .select("status")
        .eq("drive_file_id", item.drive_file_id)
        .eq("account_external_id", account)
        .maybeSingle();
      const continuando = existentePre?.status === "enviando";
      const { count: agora } = await supa.from("media_uploads").select("id", { count: "exact", head: true })
        .eq("company_id", comp.id).eq("status", "enviado")
        .gte("enviado_em", new Date(Date.now() - 3600_000).toISOString());
      if (!continuando && (agora ?? 0) >= teto) {
        resultados.push({ drive_file_id: item.drive_file_id, nome: item.nome, status: "parado_pelo_teto" });
        break;
      }

      const { data: existente } = await supa.from("media_uploads")
        .select("id,status,meta_video_id,enviado_em,upload_session_id,upload_video_id,upload_start_offset,upload_end_offset")
        .eq("drive_file_id", item.drive_file_id)
        .eq("account_external_id", account)
        .maybeSingle();
      if (existente?.status === "enviado" && existente.meta_video_id) {
        dedup++;
        resultados.push({
          drive_file_id: item.drive_file_id, nome: item.nome, status: "dedup",
          video_id: existente.meta_video_id,
        });
        continue;
      }

      if (ex.dry_run === true) {
        await supa.from("media_uploads").upsert({
          company_id: comp.id, account_external_id: account, drive_file_id: item.drive_file_id,
          nome: item.nome, mime: item.mime, tipo: "video", status: "planejado", dry_run: true,
          criado_por: "upload-midia v5.1 escoar_videos",
        }, { onConflict: "drive_file_id,account_external_id" });
        resultados.push({ drive_file_id: item.drive_file_id, nome: item.nome, status: "dry_run" });
        continue;
      }

      try {
        const meta = await driveMeta(item.drive_file_id);
        const mime = String(meta.mimeType ?? item.mime);
        const tamanho = Number(meta.size ?? 0);
        if (!mime.startsWith("video/")) {
          falhas++;
          resultados.push({ drive_file_id: item.drive_file_id, nome: item.nome, status: "erro",
            erro: `tipo nao suportado no escoamento de video: ${mime}` });
          continue;
        }
        if (tamanho > MAX_VIDEO_BYTES) {
          falhas++;
          const msg = recusaTamanhoVideo(tamanho);
          await gravarSessaoVideo({
            companyId: comp.id, account, fileId: item.drive_file_id,
            nome: meta.name ?? item.nome, mime, tamanho, status: "erro", erro: msg,
          });
          resultados.push({ drive_file_id: item.drive_file_id, nome: meta.name ?? item.nome, status: "erro", erro: msg });
          continue;
        }

        const ret = await enviarVideoEmPartes({
          account, fileId: item.drive_file_id, nome: meta.name ?? item.nome, mime, tamanho,
          companyId: comp.id,
          sessaoExistente: existente?.status === "enviando" ? sessaoDeLinha(existente) : null,
        });
        if (!ret.ok) {
          falhas++;
          resultados.push({ drive_file_id: item.drive_file_id, nome: meta.name ?? item.nome, status: "erro", erro: ret.erro });
          continue;
        }
        if (!ret.feito) {
          resultados.push({
            drive_file_id: item.drive_file_id, nome: meta.name ?? item.nome,
            status: "enviando", bytes_enviados: ret.bytes_enviados, tamanho_bytes: tamanho,
            aviso: "sessao Graph persistida; o proximo escoar_videos / upload_midia continua de onde parou",
          });
          continue;
        }
        enviados++;
        resultados.push({
          drive_file_id: item.drive_file_id, nome: meta.name ?? item.nome,
          status: "enviado", video_id: ret.video_id,
          aviso: "id devolvido pela Meta; processamento pode ainda estar em andamento - consulte status_video antes de emitir card",
        });
      } catch (e) {
        falhas++;
        const msg = String((e as any)?.message ?? e).slice(0, 400);
        await supa.from("media_uploads").upsert({
          company_id: comp.id, account_external_id: account, drive_file_id: item.drive_file_id,
          nome: item.nome, mime: item.mime, tipo: "video", status: "erro", dry_run: false,
          erro: msg, criado_por: "upload-midia v5.1 escoar_videos",
        }, { onConflict: "drive_file_id,account_external_id" });
        resultados.push({ drive_file_id: item.drive_file_id, nome: item.nome, status: "erro", erro: msg });
      }
    }

    return json({
      ok: true, acao: "escoar_videos", versao: "upload-midia-v5.1",
      enviados, dedup, falhas,
      pendentes_antes: pendentes.length,
      pendentes_depois: Math.max(0, pendentes.length - enviados - dedup),
      slots, na_hora_antes: naHora ?? 0, teto,
      resultados,
      nota: pendentes.length <= enviados + dedup
        ? "acervo aproveitavel de video escoado - proximas corridas nao tem o que subir"
        : `ainda ha pendentes; o cron horario escoa ate ${teto}/hora`,
    });
  }

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
  const { data: existente } = await supa.from("media_uploads")
    .select("id,status,meta_image_hash,meta_video_id,enviado_em,upload_session_id,upload_video_id,upload_start_offset,upload_end_offset")
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
    em_andamento: existente?.status === "enviando" ? sessaoDeLinha(existente) : null,
    limites_v1: limitesUploadCopy(),
  };

  if (acao === "plan") return json({ ok: true, acao: "plan", ...plano, nota: "nada foi enviado - ensaio" });

  // ============== executar ==============
  const recusa = (motivo: string) => json({ ok: false, recusado: true, motivo, ...plano }, 403);
  if (!travas.master_enabled) return recusa("master_enabled desligado para a empresa");
  if (!travas.flag_upload_midia) return recusa("flag upload_midia desligada");
  if (!travas.conta_definida) return recusa("conta de destino indefinida");
  if (!travas.conta_permitida) return recusa(`conta ${account} fora de contas_permitidas_criacao`);
  if (!travas.tipo_suportado) return recusa(`tipo nao suportado: ${mime}`);
  if (!travas.tamanho_ok) {
    return recusa(tipo === "video" ? recusaTamanhoVideo(tamanho) : recusaTamanhoImagem(tamanho));
  }

  // teto por hora (compartilhado com as demais acoes de escrita).
  // Continuacao de sessao enviando NAO consome slot novo.
  const { count: naHora } = await supa.from("media_uploads").select("id", { count: "exact", head: true })
    .eq("company_id", comp.id).eq("status", "enviado").gte("enviado_em", new Date(Date.now() - 3600_000).toISOString());
  if (existente?.status !== "enviando" && (naHora ?? 0) >= (ex.max_actions_per_hour ?? 5)) {
    return recusa(`teto por hora atingido (${ex.max_actions_per_hour})`);
  }

  if (existente?.status === "enviado") {
    let status_processamento: string | null = null;
    let pronto: boolean | null = existente.meta_image_hash ? true : null;
    if (existente.meta_video_id && META_ADS_TOKEN) {
      try {
        const sr = await fetch(
          `${GRAPH}/${encodeURIComponent(existente.meta_video_id)}?fields=id,status` +
            `&access_token=${encodeURIComponent(META_ADS_TOKEN)}`,
        );
        const sj = await sr.json();
        const st = sj?.status ?? null;
        status_processamento = (st && typeof st === "object")
          ? (String(st.video_status ?? "").trim() || null)
          : null;
        pronto = status_processamento === "ready";
      } catch {
        status_processamento = "consulta_falhou";
        pronto = null;
      }
    }
    return json({ ok: true, acao: "executar", dedup: true,
      nome: meta.name, drive_file_id: fileId,
      image_hash: existente.meta_image_hash, video_id: existente.meta_video_id,
      status_processamento, pronto,
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
    if (tipo === "video") {
      const ret = await enviarVideoEmPartes({
        account, fileId, nome: meta.name, mime, tamanho, companyId: comp.id,
        sessaoExistente: existente?.status === "enviando" ? sessaoDeLinha(existente) : null,
        wallMs,
      });
      if (!ret.ok) return json({ ok: false, error: ret.erro, nome: meta.name, drive_file_id: fileId }, 502);
      if (!ret.feito) {
        return json({
          ok: true, acao: "executar", enviado: false, em_andamento: true,
          nome: meta.name, drive_file_id: fileId,
          video_id: ret.sessao.video_id || null,
          bytes_enviados: ret.bytes_enviados, tamanho_bytes: tamanho,
          upload_session_id: ret.sessao.session_id,
          proximo_passo: "chame upload_midia de novo com o mesmo drive_file_id — a sessao continua",
          nota: `Envio em partes pausado no wall da edge (${ret.bytes_enviados}/${tamanho} bytes). Nao e recusa de tamanho. Chame de novo.`,
        });
      }
      let status_processamento: string | null = null;
      let pronto: boolean | null = null;
      try {
        const sr = await fetch(
          `${GRAPH}/${encodeURIComponent(ret.video_id)}?fields=id,status` +
            `&access_token=${encodeURIComponent(META_ADS_TOKEN)}`,
        );
        const sj = await sr.json();
        status_processamento = String(sj?.status?.video_status ?? "").trim() || null;
        pronto = status_processamento === "ready";
      } catch { /* status e informativo */ }
      return json({
        ok: true, acao: "executar", enviado: true, image_hash: null, video_id: ret.video_id,
        nome: meta.name, drive_file_id: fileId,
        status_processamento, pronto,
        nota: pronto === true
          ? "video na biblioteca e pronto para uso em anuncio"
          : "video na biblioteca - id existe, mas processamento pode ainda estar em andamento. Consulte status_video antes de emitir card; anuncio com video processando falha na Meta.",
      });
    }

    const bytes = await driveBaixar(fileId);
    const image_hash = await metaUploadImagem(account, meta.name, bytes);
    await supa.from("media_uploads").upsert({
      company_id: comp.id, account_external_id: account, drive_file_id: fileId,
      nome: meta.name, mime, tamanho_bytes: tamanho, tipo, status: "enviado", dry_run: false,
      meta_image_hash: image_hash, meta_video_id: null, enviado_em: new Date().toISOString(),
      criado_por: "upload-midia v6",
    }, { onConflict: "drive_file_id,account_external_id" });
    return json({
      ok: true, acao: "executar", enviado: true, image_hash, video_id: null,
      nome: meta.name, drive_file_id: fileId,
      status_processamento: null, pronto: true,
      nota: "midia na biblioteca da conta - use image_hash ao criar o anuncio",
    });
  } catch (e) {
    const msg = String((e as any)?.message ?? e).slice(0, 400);
    await supa.from("media_uploads").upsert({
      company_id: comp.id, account_external_id: account, drive_file_id: fileId,
      nome: meta.name, mime, tamanho_bytes: tamanho, tipo, status: "erro", dry_run: false, erro: msg,
      criado_por: "upload-midia v6",
    }, { onConflict: "drive_file_id,account_external_id" });
    return json({ ok: false, error: msg, nome: meta.name, drive_file_id: fileId }, 502);
  }
});
