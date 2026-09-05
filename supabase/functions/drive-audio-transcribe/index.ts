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
// v3 (03/09/2026) — FILA POR ARQUIVO E CUSTO MEDIDO.
// - A selecao saiu daqui e virou `public.videos_com_audio_pendente`, que deduplica por
//   drive_file_id e consulta `public.estado_do_audio_da_peca`. Motivo: o filtro antigo
//   (`base_da_analise like '%criterio%'`) deixava de fora todo video analisado so por
//   thumbnail — 143 da COHAPM e 5 da Legal, nunca ouvidos — e remover o filtro sem
//   deduplicar teria mandado de novo para a OpenAI os 19 arquivos da Legal que ja tem
//   transcricao na outra linha deles, pagando duas vezes pelo mesmo audio.
// - A resposta passa a trazer a DURACAO REAL do audio (lida do container pelo mp4box, sem
//   chamada extra), porque a cobranca da OpenAI e por minuto. O preco nao e aplicado aqui:
//   fica em public.model_prices, para nao existirem duas verdades de preco.
//
// AUTONOMIA / IDEMPOTENCIA:
// - A fila reprocessa pendentes em toda corrida e NUNCA inclui arquivo cujo audio ja foi
//   resolvido, seja com texto, seja com veredito permanente.
// - Falha real e honesta e marcada como permanente e sai da fila — nunca fingimos sucesso.
//   Os dois desfechos permanentes sao DISTINGUIVEIS de proposito: 'sem_fala_util:' quando o
//   transcritor rodou e nao ha locucao, e 'sem_audio_ou_corrompido:' quando o audio nem
//   pode ser lido. Ausencia de fala nao e defeito de arquivo.
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

// TETO DE MEMORIA DO RUNTIME, medido em 03/09/2026 e nao chutado. Esta edge baixa o video
// INTEIRO para um Uint8Array e o mp4box faz copias internas para segmentar; o consumo de
// pico e um multiplo do arquivo. No escoamento do acervo, 97 videos passaram e o maior
// deles tinha 55,2MB; acima disso a funcao morria com HTTP 546 (limite de recursos do
// worker) — e, pior, morria DEPOIS de baixar, entao um .MOV bruto de pasta "Brutos"
// derrubava a corrida inteira e bloqueava a fila para os videos pequenos atras dele.
// Foi assim que o escoamento travou em 33 pendentes: cada corrida morria no mesmo arquivo.
// O teto ficou logo acima do maior que comprovadamente passa. Quem excede NAO e tratado
// como sem fala nem como arquivo corrompido: recebe rotulo proprio, porque a causa e o
// limite do runtime e a lacuna e nossa, nao do material.
const LIMITE_MEMORIA_BYTES = 60 * 1024 * 1024;
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

async function driveDownload(fileId: string, signal?: AbortSignal): Promise<Uint8Array> {
  const token = await driveToken();
  const response = await fetch(
    `https://www.googleapis.com/drive/v3/files/${fileId}?alt=media&supportsAllDrives=true`,
    { headers: { authorization: `Bearer ${token}` }, signal },
  );
  if (!response.ok) throw new Error(`Drive download ${response.status}`);
  return new Uint8Array(await response.arrayBuffer());
}

// Demux da faixa de audio de um MP4 para um MP4 fragmentado so-de-audio (sem reencode).
// mp4box parsa o container, isola o track 'soun' e re-segmenta so ele; init segment + media
// segments concatenados = um .mp4 valido que o ffmpeg da OpenAI le sem problema.
function extrairAudio(input: Uint8Array): { out: Uint8Array | null; codec: string | null; erro: string | null; duracaoSeg: number | null } {
  const mp4 = MB.createFile();
  const parts: Uint8Array[] = [];
  let audioId = -1;
  let codec: string | null = null;
  let erro: string | null = null;
  // DURACAO MEDIDA, nao estimada. A OpenAI cobra transcricao por MINUTO de audio, e ate
  // 03/09/2026 o custo desta rotina so existia como estimativa derivada de tamanho de
  // arquivo. O mp4box ja parsa o container aqui, entao a duracao real sai de graca - e com
  // ela o custo da corrida deixa de ser chute.
  let duracaoSeg: number | null = null;
  mp4.onError = (e: unknown) => { erro = String(e); };
  // deno-lint-ignore no-explicit-any
  mp4.onReady = (info: any) => {
    const ts = Number(info.timescale ?? 0);
    const dur = Number(info.duration ?? 0);
    if (ts > 0 && dur > 0) duracaoSeg = dur / ts;
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
    return { out: null, codec, erro: erro ?? `mp4box_throw: ${String(e)}`, duracaoSeg };
  }
  if (erro) return { out: null, codec, erro, duracaoSeg };
  if (audioId === -1) return { out: null, codec, erro: "faixa de audio nao isolada", duracaoSeg };
  const total = parts.reduce((n, p) => n + p.length, 0);
  if (total === 0) return { out: null, codec, erro: "segmentacao de audio vazia", duracaoSeg };
  const out = new Uint8Array(total);
  let o = 0;
  for (const p of parts) { out.set(p, o); o += p.length; }
  return { out, codec, erro: null, duracaoSeg };
}

async function transcrever(
  key: string,
  bytes: Uint8Array,
  mime: string,
  nomeArquivo: string,
  signal?: AbortSignal,
) {
  const form = new FormData();
  // BlobPart exige Uint8Array<ArrayBuffer>; a lib do Deno 2.9 tipa o retorno como
  // Uint8Array<ArrayBufferLike>, que inclui SharedArrayBuffer. Aqui os bytes vem
  // sempre de um ArrayBuffer comum, entao o cast e so para o checador - nao muda
  // nada em runtime e nao copia o buffer.
  form.append("file", new File([bytes as Uint8Array<ArrayBuffer>], nomeArquivo, { type: mime }));
  form.append("mime", mime);
  const resp = await fetch(`${SUPABASE_URL}/functions/v1/transcribe-audio`, {
    method: "POST",
    headers: { "x-mcp-key": key },
    body: form,
    signal,
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
  duracao_seg?: number;
  transcricao_fonte?: string;
  /** `usage` cru do transcritor, para conferencia de fatura. Ver a gravacao em processarPeca. */
  usage?: unknown;
  erro?: string;
};

// Processa uma linha. `restanteMs` e o que sobra da parede da corrida — a guarda
// ANTES do item nao impede um video pesado de sozinho estourar o cron. O abort
// corta download e transcribe-audio quando o relogio da corrida acaba; nao e
// teto novo, e o mesmo ORCAMENTO_MS aplicado durante o item.
async function processarPeca(
  row: any,
  key: string,
  restanteMs: number,
): Promise<{ res: ResultadoPeca; transitorio: boolean }> {
  const fileId = String(row.drive_file_id);
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), Math.max(1_000, restanteMs));
  const abortou = () => ac.signal.aborted;
  try {
  let meta: any;
  try { meta = await driveMeta(fileId); }
  catch (e) {
    if (abortou()) {
      return { res: { peca: row.nome, drive_file_id: fileId, transcrito: false, erro: "parede_durante_o_item" }, transitorio: true };
    }
    return { res: { peca: row.nome, drive_file_id: fileId, transcrito: false, erro: `drive_meta: ${String(e)}` }, transitorio: true };
  }
  const sizeVideo = Number(meta.size ?? 0);

  // Guarda ANTES de baixar: o objetivo e nao gastar banda nem morrer com o arquivo na mao.
  if (sizeVideo > LIMITE_MEMORIA_BYTES) {
    const fonte = `acima_do_limite_de_memoria: video de ${sizeVideo} bytes (${(sizeVideo / 1048576).toFixed(1)}MB); esta edge carrega o arquivo inteiro em memoria e o maior que comprovadamente passou tem 55,2MB. Nao e ausencia de fala nem arquivo corrompido - e limite do runtime, e a fala segue NAO avaliada.`;
    await supa.from("drive_midia_analises").update({ transcricao_fonte: fonte }).eq("id", row.id);
    return { res: { peca: row.nome, drive_file_id: fileId, transcrito: false, tamanho_video: sizeVideo, transcricao_fonte: fonte }, transitorio: false };
  }

  let bytes: Uint8Array;
  try { bytes = await driveDownload(fileId, ac.signal); }
  catch (e) {
    if (abortou()) {
      return { res: { peca: row.nome, drive_file_id: fileId, transcrito: false, tamanho_video: sizeVideo, erro: "parede_durante_o_item" }, transitorio: true };
    }
    return { res: { peca: row.nome, drive_file_id: fileId, transcrito: false, tamanho_video: sizeVideo, erro: `drive_download: ${String(e)}` }, transitorio: true };
  }

  const mimeVideo = String(meta.mimeType ?? row.mime ?? "video/mp4");
  const ehVideo = mimeVideo.toLowerCase().startsWith("video") || mimeVideo.toLowerCase().includes("mp4");

  let payload: Uint8Array = bytes;
  let payloadMime = mimeVideo;
  let nomeArquivo = "audio.mp4";
  let metodo = "video-inteiro";
  let audioLen: number | undefined;
  let duracaoSeg: number | undefined;

  if (ehVideo) {
    const ex = extrairAudio(bytes);
    if (ex.duracaoSeg && ex.duracaoSeg > 0) duracaoSeg = ex.duracaoSeg;
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

  let t: Awaited<ReturnType<typeof transcrever>>;
  try {
    t = await transcrever(key, payload, payloadMime, nomeArquivo, ac.signal);
  } catch (e) {
    if (abortou()) {
      return { res: { peca: row.nome, drive_file_id: fileId, transcrito: false, tamanho_video: sizeVideo, tamanho_audio: audioLen, duracao_seg: duracaoSeg, metodo, erro: "parede_durante_o_item" }, transitorio: true };
    }
    throw e;
  }
  if (!t.ok) {
    if (abortou()) {
      return { res: { peca: row.nome, drive_file_id: fileId, transcrito: false, tamanho_video: sizeVideo, tamanho_audio: audioLen, duracao_seg: duracaoSeg, metodo, erro: "parede_durante_o_item" }, transitorio: true };
    }
    // Erro do transcriber: nao marca a linha, deixa para a proxima corrida.
    return { res: { peca: row.nome, drive_file_id: fileId, transcrito: false, tamanho_video: sizeVideo, tamanho_audio: audioLen, duracao_seg: duracaoSeg, metodo, erro: `transcribe-audio ${t.status}: ${JSON.stringify(t.parsed ?? t.raw).slice(0, 220)}` }, transitorio: true };
  }
  const text = String(t.parsed?.text ?? "").trim();
  if (!text) {
    // ROTULO ALINHADO (03/09/2026): o transcritor rodou e nao ha locucao. Isto e o MESMO
    // desfecho dos 5 Reels do Sistema Ocular, que ja estavam gravados como
    // `sem_fala_util:`. Antes esta linha gravava `sem_fala_detectada:`, criando dois
    // rotulos para o mesmo fato - e ausencia de fala NAO pode ficar parecida com falha
    // tecnica, que segue com rotulo proprio (`sem_audio_ou_corrompido:`).
    const fonte = `sem_fala_util: resposta vazia de transcribe-audio (${t.parsed?.provider ?? "fonte desconhecida"}) via ${metodo}`;
    await supa.from("drive_midia_analises").update({ transcricao_fonte: fonte }).eq("id", row.id);
    return { res: { peca: row.nome, drive_file_id: fileId, transcrito: false, tamanho_video: sizeVideo, tamanho_audio: audioLen, duracao_seg: duracaoSeg, metodo, transcricao_fonte: fonte }, transitorio: false };
  }

  const fonte = `transcribe-audio / ${t.parsed?.provider ?? "desconhecido"} / ${t.parsed?.model ?? "modelo nao informado"} (via ${metodo})`;
  const now = new Date().toISOString();
  // v4 (04/09/2026) - GUARDA O USAGE FATURADO. A apuracao de 03/09 teve de DERIVAR o custo
  // (calibrando caracteres por segundo contra as duracoes do mp4box) porque este numero era
  // descartado. Agora o objeto cru da OpenAI fica ao lado da transcricao que ele pagou, e a
  // proxima apuracao mede em vez de estimar. Nulo quando o provedor nao informa - ausencia
  // aqui significa "nao capturado", nunca "custou zero".
  const usage = t.parsed?.usage ?? null;
  const { error: writeError } = await supa
    .from("drive_midia_analises")
    .update({
      transcricao_audio: text,
      transcricao_em: now,
      transcricao_fonte: fonte,
      transcricao_usage: usage,
    })
    .eq("id", row.id);
  if (writeError) return { res: { peca: row.nome, drive_file_id: fileId, transcrito: false, erro: `gravacao: ${writeError.message}` }, transitorio: true };

  return { res: { peca: row.nome, drive_file_id: fileId, transcrito: true, metodo, caracteres: text.length, tamanho_video: sizeVideo, tamanho_audio: audioLen, duracao_seg: duracaoSeg, transcricao_fonte: fonte, usage }, transitorio: false };
  } finally {
    clearTimeout(timer);
  }
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

  // FILA POR ARQUIVO, e nao por linha de analise (03/09/2026). A selecao antiga
  // (`base_da_analise like '%criterio%'` + `transcricao_audio is null`) tinha dois
  // defeitos: deixava de fora todo video analisado so por thumbnail, e, se o filtro de
  // base fosse simplesmente removido, mandaria de novo para a OpenAI os arquivos que ja
  // tem transcricao na OUTRA linha deles - pagando duas vezes pelo mesmo audio.
  // `videos_com_audio_pendente` deduplica por drive_file_id e consulta o estado canonico,
  // entao exclui de graca `sem_fala_util` e falha permanente de extracao.
  let rows: any[] | null = null;
  if (requestedId) {
    const { data, error } = await supa
      .from("drive_midia_analises")
      .select("id,drive_file_id,nome,mime,base_da_analise")
      .like("mime", "video%")
      .is("transcricao_audio", null)
      .eq("drive_file_id", requestedId)
      .order("analisado_em", { ascending: false })
      .limit(1);
    if (error) return json({ error: "leitura_falhou", detalhe: error.message }, 500);
    rows = data;
  } else {
    const { data, error } = await supa.rpc("videos_com_audio_pendente", { p_limit: limit });
    if (error) return json({ error: "leitura_falhou", detalhe: error.message }, 500);
    rows = data;
  }
  if (!rows || rows.length === 0) {
    return json({ ok: true, processados: 0, transcritos: 0, nota: requestedId ? "peca nao encontrada ou ja transcrita" : "nenhum video pendente" });
  }

  const inicio = Date.now();
  const resultados: ResultadoPeca[] = [];
  let transcritos = 0;
  for (const row of rows) {
    const restante = ORCAMENTO_MS - (Date.now() - inicio);
    if (restante < 5_000) break;
    try {
      const { res } = await processarPeca(row, key, restante);
      resultados.push(res);
      if (res.transcrito) transcritos++;
    } catch (e) {
      resultados.push({ peca: row.nome, drive_file_id: String(row.drive_file_id), transcrito: false, erro: `excecao: ${String(e)}` });
    }
  }

  // Quantos ARQUIVOS pendentes ainda restam (para o cron/observabilidade saber se
  // convergiu). Mesma fonte da fila, para os dois numeros nunca discordarem.
  const { data: restantes } = await supa.rpc("contar_videos_com_audio_pendente");

  // CUSTO DA CORRIDA COM DURACAO MEDIDA. A OpenAI cobra por minuto de audio, entao o que
  // importa e o tempo, nao o numero de arquivos nem os bytes. A duracao sai do mp4box, que
  // ja parsa o container para extrair a faixa - nao ha chamada extra para medir isto.
  // O preco NAO e aplicado aqui de proposito: ele vive em public.model_prices, e duplicar
  // numero de preco em codigo e como esta base envelhece.
  const comDuracao = resultados.filter((r) => typeof r.duracao_seg === "number");
  const segundos = comDuracao.reduce((n, r) => n + (r.duracao_seg ?? 0), 0);

  return json({
    ok: true,
    processados: resultados.length,
    transcritos,
    pendentes_restantes: restantes ?? null,
    audio_medido: {
      pecas_com_duracao_medida: comDuracao.length,
      pecas_sem_duracao_medida: resultados.length - comDuracao.length,
      segundos: Math.round(segundos),
      minutos: Number((segundos / 60).toFixed(3)),
      nota: "duracao real lida do container pelo mp4box; multiplique por model_prices para o custo",
    },
    resultados,
    mcp_chamador: auth.chamador,
  });
});
