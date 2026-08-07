// drive-audio-transcribe (v2, 07/08/2026) — orquestrador Drive -> transcribe-audio ->
// drive_midia_analises, agora AUTONOMO e capaz de ler 100% dos videos.
//
// MUDANCA AUTORIZADA PELO RYAN (07/08): o teto de 15MB deixou de "abandonar" o video.
// Antes, arquivo grande virava `transcricao_fonte='nao_transcrito: acima do teto...'` e
// nunca mais era tentado. Agora, para qualquer video, extraimos SO A FAIXA DE AUDIO do
// container MP4 (demux via mp4box, sem reencode e sem ffmpeg) — um .mp4 de audio de ~1MB
// mesmo para um video de 40MB — e mandamos so o audio ao transcribe-audio por multipart.
// Medido em campo: video 18 = 22,7MB -> audio 1,03MB -> OpenAI 200, 485 chars.
//
// AUTONOMIA / IDEMPOTENCIA:
// - A selecao reprocessa pendentes em toda corrida: pega linhas sem transcricao_audio cujo
//   transcricao_fonte e NULL ou comeca com 'nao_transcrito:' / 'pendente_'. Assim os antigos
//   'acima do teto de 15MB' entram de novo. NUNCA toca linha que ja tem texto.
// - Falha real e honesta e marcada como permanente ('sem_audio_ou_corrompido:' /
//   'sem_fala_detectada:') e sai do conjunto de retry — nunca fingimos sucesso.
// - Erro transitorio (Drive/transcriber 5xx) NAO marca a linha: a proxima corrida repete.
// - Processa um lote por chamada (limit, padrao 6) com orcamento de parede; o cron diario
//   converge o backlog e depois vira no-op.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import * as MP4BoxNS from "https://esm.sh/mp4box@0.5.2";
import { chaveMcpDe, mcpKeyValida } from "../_shared/mcp_auth.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const GOOGLE_SA_KEY_B64 = (Deno.env.get("GOOGLE_SA_KEY_B64") ?? "").trim();
// Teto do endpoint da OpenAI. Acima disso e sem faixa de audio extraivel, e falha honesta.
const OPENAI_MAX_BYTES = 25 * 1024 * 1024;
const LIMIT_PADRAO = 6;
const ORCAMENTO_MS = 130_000;

const supa = createClient(SUPABASE_URL, SERVICE_ROLE, { auth: { persistSession: false } });
// deno-lint-ignore no-explicit-any
const MB: any = (MP4BoxNS as any).createFile ? (MP4BoxNS as any) : (MP4BoxNS as any).default;

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

let cachedToken: { token: string; exp: number } | null = null;
function pemDer(pem: string): ArrayBuffer {
  const b64 = pem.replace(/-----[^-]+-----/g, "").replace(/\s+/g, "");
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes.buffer;
}
function b64url(data: Uint8Array | string): string {
  const bin = typeof data === "string" ? data : String.fromCharCode(...data);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
async function driveToken(): Promise<string> {
  if (cachedToken && cachedToken.exp > Date.now() + 60_000) return cachedToken.token;
  if (!GOOGLE_SA_KEY_B64) throw new Error("GOOGLE_SA_KEY_B64 ausente");
  const sa = JSON.parse(atob(GOOGLE_SA_KEY_B64));
  const now = Math.floor(Date.now() / 1000);
  const header = b64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const claims = b64url(
    JSON.stringify({
      iss: sa.client_email,
      scope: "https://www.googleapis.com/auth/drive.readonly",
      aud: "https://oauth2.googleapis.com/token",
      iat: now,
      exp: now + 3600,
    }),
  );
  const key = await crypto.subtle.importKey(
    "pkcs8",
    pemDer(sa.private_key),
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const input = `${header}.${claims}`;
  const signature = new Uint8Array(
    await crypto.subtle.sign("RSASSA-PKCS1-v1_5", key, new TextEncoder().encode(input)),
  );
  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body:
      `grant_type=${encodeURIComponent("urn:ietf:params:oauth:grant-type:jwt-bearer")}` +
      `&assertion=${input}.${b64url(signature)}`,
  });
  const parsed = await response.json();
  if (!parsed.access_token) {
    throw new Error(`token do Drive falhou: ${JSON.stringify(parsed).slice(0, 160)}`);
  }
  cachedToken = {
    token: parsed.access_token,
    exp: Date.now() + (Number(parsed.expires_in ?? 3600) - 120) * 1000,
  };
  return cachedToken.token;
}

async function driveMeta(fileId: string) {
  const token = await driveToken();
  const response = await fetch(
    `https://www.googleapis.com/drive/v3/files/${fileId}?fields=id,name,mimeType,size&supportsAllDrives=true`,
    { headers: { authorization: `Bearer ${token}` } },
  );
  const parsed = await response.json();
  if (!response.ok)
    throw new Error(`Drive meta ${response.status}: ${JSON.stringify(parsed).slice(0, 160)}`);
  return parsed;
}

async function driveDownload(fileId: string): Promise<Uint8Array> {
  const token = await driveToken();
  const response = await fetch(
    `https://www.googleapis.com/drive/v3/files/${fileId}?alt=media&supportsAllDrives=true`,
    { headers: { authorization: `Bearer ${token}` } },
  );
  if (!response.ok) throw new Error(`Drive download ${response.status}`);
  return new Uint8Array(await response.arrayBuffer());
}

// Demux da faixa de audio de um MP4 para um MP4 fragmentado so-de-audio (sem reencode).
// mp4box parsa o container, isola o track 'soun' e re-segmenta so ele; init segment + media
// segments concatenados = um .mp4 valido que o ffmpeg da OpenAI le sem problema.
function extrairAudio(input: Uint8Array): { out: Uint8Array | null; codec: string | null; erro: string | null } {
  const mp4 = MB.createFile();
  const parts: Uint8Array[] = [];
  let audioId = -1;
  let codec: string | null = null;
  let erro: string | null = null;
  mp4.onError = (e: unknown) => { erro = String(e); };
  // deno-lint-ignore no-explicit-any
  mp4.onReady = (info: any) => {
    const a = info.tracks?.find((t: any) => t.type === "audio" || String(t.codec || "").startsWith("mp4a"));
    if (!a) { erro = "sem faixa de audio"; return; }
    audioId = a.id;
    codec = String(a.codec ?? "");
    mp4.setSegmentOptions(a.id, null, { nbSamples: 10_000_000 });
    const init = mp4.initializeSegmentation();
    for (const s of init) parts.push(new Uint8Array(s.buffer));
    mp4.start();
  };
  mp4.onSegment = (_id: number, _u: unknown, buffer: ArrayBuffer) => { parts.push(new Uint8Array(buffer)); };
  const ab = input.buffer.slice(input.byteOffset, input.byteOffset + input.byteLength) as ArrayBuffer & { fileStart?: number };
  ab.fileStart = 0;
  try {
    mp4.appendBuffer(ab);
    mp4.flush();
  } catch (e) {
    return { out: null, codec, erro: erro ?? `mp4box_throw: ${String(e)}` };
  }
  if (erro) return { out: null, codec, erro };
  if (audioId === -1) return { out: null, codec, erro: "faixa de audio nao isolada" };
  const total = parts.reduce((n, p) => n + p.length, 0);
  if (total === 0) return { out: null, codec, erro: "segmentacao de audio vazia" };
  const out = new Uint8Array(total);
  let o = 0;
  for (const p of parts) { out.set(p, o); o += p.length; }
  return { out, codec, erro: null };
}

async function transcrever(key: string, bytes: Uint8Array, mime: string, nomeArquivo: string) {
  const form = new FormData();
  form.append("file", new File([bytes], nomeArquivo, { type: mime }));
  form.append("mime", mime);
  const resp = await fetch(`${SUPABASE_URL}/functions/v1/transcribe-audio`, {
    method: "POST",
    headers: { "x-mcp-key": key },
    body: form,
  });
  const raw = await resp.text();
  let parsed: any = null;
  try { parsed = JSON.parse(raw); } catch { /* */ }
  return { ok: resp.ok && !!parsed?.ok, status: resp.status, parsed, raw };
}

type ResultadoPeca = {
  peca: string;
  drive_file_id: string;
  transcrito: boolean;
  metodo?: string;
  caracteres?: number;
  tamanho_video?: number;
  tamanho_audio?: number;
  transcricao_fonte?: string;
  erro?: string;
};

// Processa uma linha. Retorna o resultado e se foi um erro transitorio (que NAO marca a linha).
async function processarPeca(row: any, key: string): Promise<{ res: ResultadoPeca; transitorio: boolean }> {
  const fileId = String(row.drive_file_id);
  let meta: any;
  try { meta = await driveMeta(fileId); }
  catch (e) { return { res: { peca: row.nome, drive_file_id: fileId, transcrito: false, erro: `drive_meta: ${String(e)}` }, transitorio: true }; }
  const sizeVideo = Number(meta.size ?? 0);

  let bytes: Uint8Array;
  try { bytes = await driveDownload(fileId); }
  catch (e) { return { res: { peca: row.nome, drive_file_id: fileId, transcrito: false, tamanho_video: sizeVideo, erro: `drive_download: ${String(e)}` }, transitorio: true }; }

  const mimeVideo = String(meta.mimeType ?? row.mime ?? "video/mp4");
  const ehVideo = mimeVideo.toLowerCase().startsWith("video") || mimeVideo.toLowerCase().includes("mp4");

  let payload: Uint8Array = bytes;
  let payloadMime = mimeVideo;
  let nomeArquivo = "audio.mp4";
  let metodo = "video-inteiro";
  let audioLen: number | undefined;

  if (ehVideo) {
    const ex = extrairAudio(bytes);
    if (ex.out && !ex.erro) {
      payload = ex.out;
      payloadMime = "audio/mp4";
      nomeArquivo = "audio.mp4";
      metodo = `mp4box-audio-only${ex.codec ? ` (${ex.codec})` : ""}`;
      audioLen = ex.out.byteLength;
    } else if (bytes.byteLength <= OPENAI_MAX_BYTES) {
      // Extracao falhou mas o video inteiro cabe no teto da OpenAI: mandamos o video.
      metodo = `video-inteiro (extracao falhou: ${ex.erro ?? "?"})`;
      payloadMime = mimeVideo;
      nomeArquivo = "video.mp4";
    } else {
      // Grande demais e sem audio extraivel: falha honesta e PERMANENTE.
      const fonte = `sem_audio_ou_corrompido: extracao de audio falhou e arquivo acima de 25MB (${bytes.byteLength} bytes): ${ex.erro ?? "erro desconhecido"}`;
      await supa.from("drive_midia_analises").update({ transcricao_fonte: fonte }).eq("id", row.id);
      return { res: { peca: row.nome, drive_file_id: fileId, transcrito: false, tamanho_video: sizeVideo, transcricao_fonte: fonte }, transitorio: false };
    }
  }

  if (payload.byteLength > OPENAI_MAX_BYTES) {
    const fonte = `sem_audio_ou_corrompido: payload de ${payload.byteLength} bytes acima do teto de 25MB da OpenAI`;
    await supa.from("drive_midia_analises").update({ transcricao_fonte: fonte }).eq("id", row.id);
    return { res: { peca: row.nome, drive_file_id: fileId, transcrito: false, tamanho_video: sizeVideo, transcricao_fonte: fonte }, transitorio: false };
  }

  const t = await transcrever(key, payload, payloadMime, nomeArquivo);
  if (!t.ok) {
    // Erro do transcriber: nao marca a linha, deixa para a proxima corrida.
    return { res: { peca: row.nome, drive_file_id: fileId, transcrito: false, tamanho_video: sizeVideo, tamanho_audio: audioLen, metodo, erro: `transcribe-audio ${t.status}: ${JSON.stringify(t.parsed ?? t.raw).slice(0, 220)}` }, transitorio: true };
  }
  const text = String(t.parsed?.text ?? "").trim();
  if (!text) {
    const fonte = `sem_fala_detectada: resposta vazia de transcribe-audio (${t.parsed?.provider ?? "fonte desconhecida"}) via ${metodo}`;
    await supa.from("drive_midia_analises").update({ transcricao_fonte: fonte }).eq("id", row.id);
    return { res: { peca: row.nome, drive_file_id: fileId, transcrito: false, tamanho_video: sizeVideo, tamanho_audio: audioLen, metodo, transcricao_fonte: fonte }, transitorio: false };
  }

  const fonte = `transcribe-audio / ${t.parsed?.provider ?? "desconhecido"} / ${t.parsed?.model ?? "modelo nao informado"} (via ${metodo})`;
  const now = new Date().toISOString();
  const { error: writeError } = await supa
    .from("drive_midia_analises")
    .update({ transcricao_audio: text, transcricao_em: now, transcricao_fonte: fonte })
    .eq("id", row.id);
  if (writeError) return { res: { peca: row.nome, drive_file_id: fileId, transcrito: false, erro: `gravacao: ${writeError.message}` }, transitorio: true };

  return { res: { peca: row.nome, drive_file_id: fileId, transcrito: true, metodo, caracteres: text.length, tamanho_video: sizeVideo, tamanho_audio: audioLen, transcricao_fonte: fonte }, transitorio: false };
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return json({ error: "POST only" }, 405);
  const key = chaveMcpDe(req, "header-or-bearer");
  const auth = await mcpKeyValida(supa, key);
  if (!auth.ok) return json({ error: "unauthorized", motivo: auth.motivo }, 401);

  let body: any = {};
  try { body = await req.json(); } catch { /* body vazio = lote de pendentes */ }
  const requestedId = String(body?.drive_file_id ?? "").trim();
  const limit = Math.max(1, Math.min(20, Number(body?.limit ?? LIMIT_PADRAO)));

  // Conjunto de retry: sem texto e ainda "aberto" (fonte nula, teto antigo, ou pendente_*).
  // NUNCA inclui linhas com transcricao_audio preenchida (idempotente).
  let query = supa
    .from("drive_midia_analises")
    .select("id,drive_file_id,nome,mime,base_da_analise")
    .like("mime", "video%")
    .like("base_da_analise", "%criterio%")
    .is("transcricao_audio", null)
    .or("transcricao_fonte.is.null,transcricao_fonte.like.nao_transcrito:*,transcricao_fonte.like.pendente_*")
    .order("nome")
    .limit(requestedId ? 1 : limit);
  if (requestedId) query = query.eq("drive_file_id", requestedId);

  const { data: rows, error: readError } = await query;
  if (readError) return json({ error: "leitura_falhou", detalhe: readError.message }, 500);
  if (!rows || rows.length === 0) {
    return json({ ok: true, processados: 0, transcritos: 0, nota: requestedId ? "peca nao encontrada ou ja transcrita" : "nenhum video pendente" });
  }

  const inicio = Date.now();
  const resultados: ResultadoPeca[] = [];
  let transcritos = 0;
  for (const row of rows) {
    if (Date.now() - inicio > ORCAMENTO_MS) break;
    try {
      const { res } = await processarPeca(row, key);
      resultados.push(res);
      if (res.transcrito) transcritos++;
    } catch (e) {
      resultados.push({ peca: row.nome, drive_file_id: String(row.drive_file_id), transcrito: false, erro: `excecao: ${String(e)}` });
    }
  }

  // Quantos pendentes ainda restam (para o cron/observabilidade saber se convergiu).
  const { count: restantes } = await supa
    .from("drive_midia_analises")
    .select("id", { count: "exact", head: true })
    .like("mime", "video%")
    .like("base_da_analise", "%criterio%")
    .is("transcricao_audio", null)
    .or("transcricao_fonte.is.null,transcricao_fonte.like.nao_transcrito:*,transcricao_fonte.like.pendente_*");

  return json({
    ok: true,
    processados: resultados.length,
    transcritos,
    pendentes_restantes: restantes ?? null,
    resultados,
    mcp_chamador: auth.chamador,
  });
});
