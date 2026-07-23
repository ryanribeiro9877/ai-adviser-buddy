// supabase/functions/secrets-health/index.ts (v3)
// Verifica a PRESENÇA de segredos de runtime (env) SEM expor valores sensíveis.
// v3: adiciona OPENROUTER_MODEL — o slug do modelo NÃO é sensivel, então o VALOR é
// reportado (permite conferir typo). Auth: Bearer <mcp_config.api_key>.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

function json(obj: unknown, status = 200) {
  return new Response(JSON.stringify(obj), { status, headers: { "content-type": "application/json" } });
}

Deno.serve(async (req) => {
  const supa = createClient(SUPABASE_URL, SERVICE_ROLE, { auth: { persistSession: false } });

  const authz = req.headers.get("authorization") ?? "";
  const bearer = authz.toLowerCase().startsWith("bearer ") ? authz.slice(7).trim() : "";
  const provided = bearer || (req.headers.get("x-mcp-key") ?? "").trim();
  const { data: cfg, error: cfgErr } = await supa.from("mcp_config").select("api_key").eq("id", 1).maybeSingle();
  if (cfgErr) return json({ error: "config_read_failed" }, 500);
  if (!cfg?.api_key || provided !== cfg.api_key) return json({ error: "unauthorized" }, 401);

  const or = (Deno.env.get("OPENROUTER_API_KEY") ?? "").trim();
  const wa = (Deno.env.get("WHATSAPP_ACCESS_TOKEN") ?? "").trim();
  const biz = (Deno.env.get("META_BUSINESS_ID") ?? "").trim();
  const model = (Deno.env.get("OPENROUTER_MODEL") ?? "").trim();

  return json({
    openrouter_api_key: {
      configured: or.length > 0,
      looks_valid: or.startsWith("sk-or-"),
    },
    openrouter_model: {
      configured: model.length > 0,
      value: model || "(ausente — edge usa default do código: anthropic/claude-sonnet-5)",
    },
    whatsapp_access_token: {
      configured: wa.length > 0,
      looks_valid: wa.length > 50,
    },
    meta_business_id: {
      configured: biz.length > 0,
      looks_valid: /^\d{5,}$/.test(biz),
    },
    checked_at: new Date().toISOString(),
  });
});
