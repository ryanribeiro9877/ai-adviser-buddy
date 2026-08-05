// supabase/functions/meta-health/index.ts (v1) — F4.1
// Diagnóstico do token Meta disponível no ambiente: escopos, acesso à ad account da
// Legal é Viver (act_3302001729967572) e leitura de campanha. NÃO escreve nada.
// Tokens testados: META_ADS_TOKEN (se existir) senão WHATSAPP_ACCESS_TOKEN.
// Auth: x-mcp-key / Bearer <mcp_config.api_key>.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { chaveMcpDe, mcpKeyValida } from "../_shared/mcp_auth.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const TOKEN = (Deno.env.get("META_ADS_TOKEN") ?? Deno.env.get("WHATSAPP_ACCESS_TOKEN") ?? "").trim();
const TOKEN_FONTE = Deno.env.get("META_ADS_TOKEN") ? "META_ADS_TOKEN" : "WHATSAPP_ACCESS_TOKEN";
const AD_ACCOUNT = "act_3302001729967572";
const GRAPH = "https://graph.facebook.com/v21.0";

const supa = createClient(SUPABASE_URL, SERVICE_ROLE, { auth: { persistSession: false } });
const CORS = { "access-control-allow-origin": "*", "access-control-allow-headers": "authorization, content-type, x-mcp-key", "access-control-allow-methods": "POST, OPTIONS" };
function json(obj: unknown, status = 200) {
  return new Response(JSON.stringify(obj), { status, headers: { "content-type": "application/json", ...CORS } });
}

async function g(path: string) {
  const r = await fetch(`${GRAPH}${path}${path.includes("?") ? "&" : "?"}access_token=${encodeURIComponent(TOKEN)}`);
  const t = await r.text();
  try { return { status: r.status, body: JSON.parse(t) }; } catch { return { status: r.status, body: t.slice(0, 300) }; }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });
  const auth = await mcpKeyValida(supa, chaveMcpDe(req, "header-or-bearer"));
  if (!auth.ok) return json({ error: "unauthorized", motivo: auth.motivo }, 401);
  if (!TOKEN) return json({ error: "nenhum token Meta no ambiente" }, 500);

  const permissoes = await g("/me/permissions");
  const quem = await g("/me?fields=id,name");
  const conta = await g(`/${AD_ACCOUNT}?fields=name,account_status,currency`);
  // leitura de 1 campanha (a líder conhecida) — só GET
  const campanha = await g(`/120249671567740191?fields=name,status,daily_budget`);

  return json({
    token_fonte: TOKEN_FONTE,
    identidade: quem,
    permissoes: permissoes,
    ad_account: conta,
    campanha_leitura: campanha,
    veredito_dica: "para F4.2 precisamos: ads_read (leitura) e ads_management (escrita) com a ad account atribuída ao System User",
  });
});
