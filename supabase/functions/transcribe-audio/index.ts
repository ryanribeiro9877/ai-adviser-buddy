// supabase/functions/transcribe-audio/index.ts (v2)
// v2: CORS — preflight OPTIONS + Access-Control-Allow-Origin em TODAS as respostas.
//     (v1 só funcionava via pg_net/servidor; navegador faz preflight e era bloqueado.)
// v1: {audio_base64,mime} → google/gemini-2.5-flash via OpenRouter → {text}.
//     O texto volta pro FRONT preencher o input EDITÁVEL — nunca envia sozinho.
// Auth: Bearer <user JWT> OU x-mcp-key. Env OPENROUTER_AUDIO_MODEL sobrescreve o modelo.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const OPENROUTER_KEY = (Deno.env.get("OPENROUTER_API_KEY") ?? "").trim();
const AUDIO_MODEL = (Deno.env.get("OPENROUTER_AUDIO_MODEL") ?? "google/gemini-2.5-flash").trim();

const supa = createClient(SUPABASE_URL, SERVICE_ROLE, { auth: { persistSession: false } });

const CORS = {
  "access-control-allow-origin": "*",
  "access-control-allow-headers": "authorization, x-client-info, apikey, content-type, x-mcp-key",
  "access-control-allow-methods": "POST, OPTIONS",
};
function json(obj: unknown, status = 200) {
  return new Response(JSON.stringify(obj), { status, headers: { "content-type": "application/json", ...CORS } });
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

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });
  if (req.method !== "POST") return json({ error: "POST only" }, 405);
  if (!OPENROUTER_KEY) return json({ error: "missing_openrouter_key" }, 500);

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
  if (sizeMb > 15) return json({ error: "audio_grande_demais", detail: "limite ~15MB (≈10 min em opus)" }, 413);

  const resp = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${OPENROUTER_KEY}` },
    body: JSON.stringify({
      model: AUDIO_MODEL,
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
  const text = await resp.text();
  if (!resp.ok) return json({ error: `openrouter_http_${resp.status}`, detail: text.slice(0, 400) }, 502);
  let parsed: any; try { parsed = JSON.parse(text); } catch { return json({ error: "openrouter_non_json", detail: text.slice(0, 300) }, 502); }
  const out = (parsed?.choices?.[0]?.message?.content ?? "").trim();
  return json({ ok: true, text: out, model: AUDIO_MODEL, tokens_in: parsed?.usage?.prompt_tokens ?? null, tokens_out: parsed?.usage?.completion_tokens ?? null });
});
