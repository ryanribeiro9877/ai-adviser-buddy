// supabase/functions/transcribe-audio/index.ts (v4)
// v4 - CAPTURA DE AUDIO GRANDE (autorizado pelo Ryan em 07/08/2026): alem do corpo JSON
//   {audio_base64,mime} (ditado do chat, mantido intacto), a edge agora aceita tambem
//   multipart/form-data com um campo 'file'. Isso permite que a drive-audio-transcribe
//   mande a FAIXA DE AUDIO ja extraida do video (ou o video inteiro, quando cabe) SEM
//   inflar em base64 dentro de um JSON. Pelo caminho multipart o teto sobe para 25MB, que
//   e o limite do endpoint de transcricao da OpenAI; o caminho base64/JSON continua em
//   15MB para nao estourar o corpo da requisicao. O motor de transcricao e identico nos
//   dois caminhos: OpenAI /v1/audio/transcriptions com fallback Gemini/OpenRouter.
// v3 - motor OpenAI gpt-4o-mini-transcribe (endpoint dedicado /v1/audio/transcriptions).
// v2 - CORS.
// v1 - {audio_base64,mime} -> {text}.
// Auth: Bearer <user JWT> OU x-mcp-key.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { bearerDe, mcpKeyValida } from "../_shared/mcp_auth.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const OPENROUTER_KEY = (Deno.env.get("OPENROUTER_API_KEY") ?? "").trim();
const OPENAI_KEY_ENV = (Deno.env.get("OPENAI_API_KEY") ?? "").trim();
const OPENAI_AUDIO_MODEL = (Deno.env.get("OPENAI_AUDIO_MODEL") ?? "gpt-4o-mini-transcribe").trim();
const AUDIO_MODEL_FALLBACK = (Deno.env.get("OPENROUTER_AUDIO_MODEL") ?? "google/gemini-2.5-flash").trim();

// Tetos: OpenAI aceita 25MB no arquivo. Pelo multipart chegamos perto disso sem base64;
// pelo JSON o base64 infla ~33% o corpo, entao mantemos 15MB de audio decodificado.
const MAX_BYTES_MULTIPART = 25 * 1024 * 1024;
const MAX_MB_JSON = 15;

const supa = createClient(SUPABASE_URL, SERVICE_ROLE, { auth: { persistSession: false } });

const CORS = {
  "access-control-allow-origin": "*",
  "access-control-allow-headers": "authorization, x-client-info, apikey, content-type, x-mcp-key",
  "access-control-allow-methods": "POST, OPTIONS",
};
function json(obj: unknown, status = 200) {
  return new Response(JSON.stringify(obj), { status, headers: { "content-type": "application/json", ...CORS } });
}

// Extensao que a OpenAI aceita: flac, m4a, mp3, mp4, mpeg, mpga, oga, ogg, wav, webm.
function extFromMime(mime: string): string {
  const m = mime.toLowerCase();
  if (m.includes("webm")) return "webm";
  if (m.includes("m4a")) return "m4a";
  if (m.includes("mp4") || m.includes("aac")) return "mp4";
  if (m.includes("mpeg") || m.includes("mp3")) return "mp3";
  if (m.includes("ogg") || m.includes("opus")) return "ogg";
  if (m.includes("wav")) return "wav";
  if (m.includes("flac")) return "flac";
  return "webm";
}
function fmtFromMime(mime: string): string {
  const m = mime.toLowerCase();
  if (m.includes("webm")) return "webm";
  if (m.includes("mp4") || m.includes("m4a") || m.includes("aac")) return "mp4";
  if (m.includes("mpeg") || m.includes("mp3")) return "mp3";
  if (m.includes("ogg") || m.includes("opus")) return "ogg";
  if (m.includes("wav")) return "wav";
  return "webm";
}

function b64ToU8(b64: string): Uint8Array {
  const bin = atob(b64);
  const u8 = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
  return u8;
}
function u8ToB64(bytes: Uint8Array): string {
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk) as unknown as number[]);
  }
  return btoa(binary);
}

const GLOSSARIO =
  "Contexto: gestao de trafego pago para credito consignado no Brasil. " +
  "Termos que podem aparecer e devem ser grafados corretamente: CPL, CPA, CTR, CPM, ROAS, CAC, " +
  "Meta Ads, Gerenciador de Anuncios, criativo, conjunto de anuncios, campanha, CBO, ABO, " +
  "Advantage+, lookalike, publico, segmentacao, categoria especial, formulario instantaneo, " +
  "landing page, LP, Click-to-WhatsApp, CTWA, UTM, pixel, CAPI, Conversions API, " +
  "consignado, CLT, margem, proposta, contrato pago, esteira, Legal e Viver, Supabase, Windsor.";

async function getOpenAIKey(): Promise<string> {
  if (OPENAI_KEY_ENV) return OPENAI_KEY_ENV;
  const { data } = await supa.from("integration_secrets")
    .select("value").eq("name", "openai_api_key").maybeSingle();
  return (data?.value ?? "").trim();
}

// ---------- caminho principal: OpenAI /v1/audio/transcriptions ----------
async function transcreverOpenAI(key: string, bytes: Uint8Array, mime: string) {
  const form = new FormData();
  // Cast so para o checador (mesmo motivo de drive-audio-transcribe): BlobPart
  // exige Uint8Array<ArrayBuffer> e a lib do Deno 2.9 tipa ArrayBufferLike.
  form.append(
    "file",
    new File([bytes as Uint8Array<ArrayBuffer>], `audio.${extFromMime(mime)}`, { type: mime }),
  );
  form.append("model", OPENAI_AUDIO_MODEL);
  form.append("language", "pt");
  form.append("prompt", GLOSSARIO);
  form.append("response_format", "json");

  const resp = await fetch("https://api.openai.com/v1/audio/transcriptions", {
    method: "POST",
    headers: { authorization: `Bearer ${key}` },
    body: form,
  });
  const raw = await resp.text();
  if (!resp.ok) return { erro: `openai_http_${resp.status}`, detalhe: raw.slice(0, 400) };
  try {
    const p = JSON.parse(raw);
    return { texto: String(p?.text ?? "").trim() };
  } catch {
    return { erro: "openai_non_json", detalhe: raw.slice(0, 300) };
  }
}

// ---------- fallback legado: Gemini via OpenRouter ----------
async function transcreverFallback(bytes: Uint8Array, mime: string) {
  if (!OPENROUTER_KEY) return { erro: "missing_openrouter_key" };
  const b64 = u8ToB64(bytes);
  const resp = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${OPENROUTER_KEY}` },
    body: JSON.stringify({
      model: AUDIO_MODEL_FALLBACK,
      max_tokens: 4000,
      messages: [{
        role: "user",
        content: [
          { type: "text", text: "Transcreva FIELMENTE este áudio em português brasileiro. Retorne SOMENTE o texto transcrito, sem comentários, sem prefixos, sem aspas. Pontue naturalmente. Se houver termos de tráfego pago (CPL, CTR, Meta Ads, formulário, criativo), grafe-os corretamente." },
          { type: "input_audio", input_audio: { data: b64, format: fmtFromMime(mime) } },
        ],
      }],
    }),
  });
  const raw = await resp.text();
  if (!resp.ok) return { erro: `openrouter_http_${resp.status}`, detalhe: raw.slice(0, 400) };
  try {
    const p = JSON.parse(raw);
    return { texto: String(p?.choices?.[0]?.message?.content ?? "").trim(),
      tokens_in: p?.usage?.prompt_tokens ?? null, tokens_out: p?.usage?.completion_tokens ?? null };
  } catch {
    return { erro: "openrouter_non_json", detalhe: raw.slice(0, 300) };
  }
}

// Le a entrada em bytes, aceitando tanto multipart/form-data (campo 'file') quanto o
// corpo JSON {audio_base64,mime}. Retorna erro amigavel se o teto do caminho for excedido.
async function lerEntrada(req: Request): Promise<{ bytes?: Uint8Array; mime?: string; erro?: string; status?: number }> {
  const ct = (req.headers.get("content-type") ?? "").toLowerCase();
  if (ct.includes("multipart/form-data")) {
    let fd: FormData;
    try { fd = await req.formData(); } catch { return { erro: "multipart_invalido", status: 400 }; }
    const file = fd.get("file");
    if (!(file instanceof File)) return { erro: "campo 'file' obrigatório no multipart", status: 400 };
    const bytes = new Uint8Array(await file.arrayBuffer());
    if (bytes.byteLength === 0) return { erro: "arquivo vazio", status: 400 };
    if (bytes.byteLength > MAX_BYTES_MULTIPART)
      return { erro: "audio_grande_demais", status: 413 };
    const mime = (String(fd.get("mime") ?? "") || file.type || "audio/mp4").toString();
    return { bytes, mime };
  }
  let body: any = {};
  try { body = await req.json(); } catch { /* */ }
  const b64 = String(body?.audio_base64 ?? "");
  const mime = String(body?.mime ?? "audio/webm");
  if (!b64) return { erro: "audio_base64 obrigatório", status: 400 };
  const sizeMb = (b64.length * 3) / 4 / 1048576;
  if (sizeMb > MAX_MB_JSON) return { erro: "audio_grande_demais", status: 413 };
  return { bytes: b64ToU8(b64), mime };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });
  if (req.method !== "POST") return json({ error: "POST only" }, 405);

  const xKey = (req.headers.get("x-mcp-key") ?? "").trim();
  const bearer = bearerDe(req);
  let authed = false;
  if (xKey) {
    const v = await mcpKeyValida(supa, xKey);
    if (!v.ok) return json({ error: "unauthorized", motivo: v.motivo }, 401);
    authed = true;
  } else if (bearer) {
    const { data: u } = await supa.auth.getUser(bearer);
    if (u?.user) authed = true;
    else {
      const v = await mcpKeyValida(supa, bearer);
      if (v.ok) authed = true;
    }
  }
  if (!authed) return json({ error: "unauthorized" }, 401);

  const entrada = await lerEntrada(req);
  if (entrada.erro || !entrada.bytes) {
    return json({ error: entrada.erro ?? "entrada_invalida" }, entrada.status ?? 400);
  }
  const bytes = entrada.bytes;
  const mime = entrada.mime ?? "audio/webm";

  const openaiKey = await getOpenAIKey();

  if (openaiKey) {
    const r = await transcreverOpenAI(openaiKey, bytes, mime);
    if (!r.erro) {
      return json({ ok: true, text: r.texto, model: OPENAI_AUDIO_MODEL, provider: "openai",
        tokens_in: null, tokens_out: null });
    }
    const f = await transcreverFallback(bytes, mime);
    if (!f.erro) {
      return json({ ok: true, text: f.texto, model: AUDIO_MODEL_FALLBACK, provider: "openrouter_fallback",
        aviso: `OpenAI falhou (${r.erro}); transcrito pelo motor anterior.`,
        detalhe_openai: r.detalhe ?? null,
        tokens_in: f.tokens_in ?? null, tokens_out: f.tokens_out ?? null });
    }
    return json({ error: r.erro, detail: r.detalhe, fallback_error: f.erro }, 502);
  }

  const f = await transcreverFallback(bytes, mime);
  if (f.erro) return json({ error: f.erro, detail: f.detalhe }, 502);
  return json({ ok: true, text: f.texto, model: AUDIO_MODEL_FALLBACK, provider: "openrouter",
    aviso: "chave da OpenAI ausente (env OPENAI_API_KEY ou integration_secrets.openai_api_key)",
    tokens_in: f.tokens_in ?? null, tokens_out: f.tokens_out ?? null });
});
