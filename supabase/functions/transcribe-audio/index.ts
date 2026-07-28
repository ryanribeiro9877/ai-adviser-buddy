// supabase/functions/transcribe-audio/index.ts (v3)
// v3 - TROCA DO MOTOR DE TRANSCRICAO: google/gemini-2.5-flash -> openai/gpt-4o-mini-transcribe.
//   MOTIVO DA MUDANCA DE ENDPOINT (nao e so trocar a string do modelo): os modelos de
//   transcricao da OpenAI NAO vivem em /chat/completions. Eles ficam em
//   api.openai.com/v1/audio/transcriptions, que usa multipart/form-data e nao aceita
//   base64 em JSON. Por isso esta versao fala DIRETO com a OpenAI, sem passar pelo
//   OpenRouter, e o audio vai como arquivo binario.
//   VANTAGENS praticas do endpoint dedicado:
//     - modelo especializado em transcricao (nao paga por capacidade conversacional)
//     - parametro 'language' fixa portugues e melhora precisao
//     - parametro 'prompt' funciona como GLOSSARIO: melhora a grafia de termos de trafego
//       (CPL, CTR, ROAS, CBO/ABO, Click-to-WhatsApp, consignado) sem pos-processamento
//   CHAVE: lida de OPENAI_API_KEY (env) e, se ausente, de integration_secrets.openai_api_key
//   (tabela com RLS ativa e zero policies: so service_role le). Assim a chave pode ser
//   movida para Edge Secret depois sem tocar no codigo.
//   FALLBACK: se nao houver chave da OpenAI, cai no caminho antigo (Gemini via OpenRouter).
//   Isso mantem o ditado funcionando em qualquer cenario e permite deploy sem coordenacao.
//   O retorno traz 'provider' para dar para conferir qual motor rodou de fato.
// v2: CORS - preflight OPTIONS + Access-Control-Allow-Origin em TODAS as respostas.
// v1: {audio_base64,mime} -> transcricao -> {text}. O texto volta pro FRONT preencher o
//     input EDITAVEL - nunca envia sozinho.
// Auth: Bearer <user JWT> OU x-mcp-key.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const OPENROUTER_KEY = (Deno.env.get("OPENROUTER_API_KEY") ?? "").trim();
const OPENAI_KEY_ENV = (Deno.env.get("OPENAI_API_KEY") ?? "").trim();
// v3: modelo de transcricao da OpenAI. gpt-4o-mini-transcribe e o mais barato da familia
// e supera o whisper-1 em portugues. Trocavel por env sem redeploy de codigo.
const OPENAI_AUDIO_MODEL = (Deno.env.get("OPENAI_AUDIO_MODEL") ?? "gpt-4o-mini-transcribe").trim();
// Fallback legado (apenas se nao houver chave OpenAI).
const AUDIO_MODEL_FALLBACK = (Deno.env.get("OPENROUTER_AUDIO_MODEL") ?? "google/gemini-2.5-flash").trim();

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
// Formato aceito pelo caminho legado (chat/completions com input_audio).
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

// v3: glossario de dominio. No endpoint de transcricao, 'prompt' nao e instrucao - e dica
// de vocabulario. Listar os termos faz o modelo grafa-los certo em vez de foneticamente
// ("cê pê ele" -> "CPL"). Sem isso, sigla de trafego sai errada com frequencia.
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
  form.append("file", new File([bytes], `audio.${extFromMime(mime)}`, { type: mime }));
  form.append("model", OPENAI_AUDIO_MODEL);
  form.append("language", "pt");
  form.append("prompt", GLOSSARIO);
  form.append("response_format", "json");

  const resp = await fetch("https://api.openai.com/v1/audio/transcriptions", {
    method: "POST",
    headers: { authorization: `Bearer ${key}` }, // sem content-type: o FormData define o boundary
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
async function transcreverFallback(b64: string, mime: string) {
  if (!OPENROUTER_KEY) return { erro: "missing_openrouter_key" };
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

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });
  if (req.method !== "POST") return json({ error: "POST only" }, 405);

  const authz = req.headers.get("authorization") ?? "";
  const bearer = authz.toLowerCase().startsWith("bearer ") ? authz.slice(7).trim() : "";
  const provided = (req.headers.get("x-mcp-key") ?? "").trim() || bearer;
  const { data: cfg } = await supa.from("mcp_config").select("api_key").eq("id", 1).maybeSingle();
  let authed = false;
  if (cfg?.api_key && provided === cfg.api_key) authed = true;
  else if (bearer) {
    const { data: u } = await supa.auth.getUser(bearer);
    if (u?.user) authed = true;
  }
  if (!authed) return json({ error: "unauthorized" }, 401);

  let body: any = {};
  try { body = await req.json(); } catch { /* */ }
  const b64 = String(body?.audio_base64 ?? "");
  const mime = String(body?.mime ?? "audio/webm");
  if (!b64) return json({ error: "audio_base64 obrigatório" }, 400);
  const sizeMb = (b64.length * 3) / 4 / 1048576;
  // Teto mantido em 15MB: a OpenAI aceita 25MB no arquivo, mas o base64 chega dentro do
  // corpo JSON da requisicao e inflar isso arrisca estourar o limite de body da edge.
  if (sizeMb > 15) return json({ error: "audio_grande_demais", detail: "limite ~15MB (≈10 min em opus)" }, 413);

  const openaiKey = await getOpenAIKey();

  if (openaiKey) {
    const r = await transcreverOpenAI(openaiKey, b64ToU8(b64), mime);
    if (!r.erro) {
      return json({ ok: true, text: r.texto, model: OPENAI_AUDIO_MODEL, provider: "openai",
        tokens_in: null, tokens_out: null });
    }
    // v3: se a OpenAI falhar (chave invalida, modelo indisponivel, formato recusado), nao
    // deixamos o gestor sem ditado - tentamos o motor antigo e declaramos o desvio.
    const f = await transcreverFallback(b64, mime);
    if (!f.erro) {
      return json({ ok: true, text: f.texto, model: AUDIO_MODEL_FALLBACK, provider: "openrouter_fallback",
        aviso: `OpenAI falhou (${r.erro}); transcrito pelo motor anterior.`,
        detalhe_openai: r.detalhe ?? null,
        tokens_in: f.tokens_in ?? null, tokens_out: f.tokens_out ?? null });
    }
    return json({ error: r.erro, detail: r.detalhe, fallback_error: f.erro }, 502);
  }

  // Sem chave da OpenAI: caminho legado integral.
  const f = await transcreverFallback(b64, mime);
  if (f.erro) return json({ error: f.erro, detail: f.detalhe }, 502);
  return json({ ok: true, text: f.texto, model: AUDIO_MODEL_FALLBACK, provider: "openrouter",
    aviso: "chave da OpenAI ausente (env OPENAI_API_KEY ou integration_secrets.openai_api_key)",
    tokens_in: f.tokens_in ?? null, tokens_out: f.tokens_out ?? null });
});