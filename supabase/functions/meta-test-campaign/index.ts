// supabase/functions/meta-test-campaign/index.ts (v3) — F4.1 aceite 5 / F4.2 estágio 2
// v3: (a) fix GET com path que já contém '?' (usava '?' duplicado — syntax error no Graph);
//     (b) REDACT do access_token em qualquer corpo devolvido (o Graph ecoa a URL em erros).
// v2: is_adset_budget_sharing_enabled=false no create. v1: base.
// Opera SOMENTE em campanha [TESTE-API] (trava dura). Ações: create|status|pause|unpause|delete.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const TOKEN = (Deno.env.get("META_ADS_TOKEN") ?? "").trim();
const AD_ACCOUNT = "act_3302001729967572";
const GRAPH = "https://graph.facebook.com/v21.0";
const PREFIXO = "[TESTE-API]";

const supa = createClient(SUPABASE_URL, SERVICE_ROLE, { auth: { persistSession: false } });
function redact(s: string): string {
  if (!TOKEN) return s;
  return s.split(TOKEN).join("[TOKEN-REDACTED]").replace(/access_token=[A-Za-z0-9]+/g, "access_token=[TOKEN-REDACTED]");
}
function json(obj: unknown, status = 200) {
  return new Response(redact(JSON.stringify(obj)), { status, headers: { "content-type": "application/json" } });
}
async function g(path: string, method = "GET", body?: Record<string, string>) {
  const form = new URLSearchParams({ ...(body ?? {}), access_token: TOKEN });
  const sep = path.includes("?") ? "&" : "?";
  const r = method === "GET"
    ? await fetch(`${GRAPH}${path}${sep}${form.toString()}`)
    : await fetch(`${GRAPH}${path}`, { method, body: form });
  const t = await r.text();
  try { return { status: r.status, body: JSON.parse(redact(t)) }; } catch { return { status: r.status, body: redact(t.slice(0, 300)) }; }
}
async function audit(action: string, details: unknown) {
  const { data: c } = await supa.from("companies").select("id").ilike("name", "%legal%").limit(1).maybeSingle();
  const { data: adm } = await supa.from("user_roles").select("user_id").eq("role", "admin").limit(1).maybeSingle();
  if (c && adm) await supa.from("audit_log").insert({ company_id: c.id, user_id: adm.user_id, action, target_type: "meta_test_campaign", target_id: AD_ACCOUNT, details: JSON.parse(redact(JSON.stringify(details))) });
}
async function guardTeste(campaignId: string) {
  const info = await g(`/${campaignId}?fields=name,status,effective_status`);
  if (info.status !== 200) return { ok: false, erro: info.body };
  if (!String(info.body?.name ?? "").startsWith(PREFIXO)) {
    return { ok: false, erro: `TRAVA: campanha '${info.body?.name}' não começa com ${PREFIXO} — esta edge só opera na campanha de teste.` };
  }
  return { ok: true, info: info.body };
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return json({ error: "POST only" }, 405);
  if (!TOKEN) return json({ error: "META_ADS_TOKEN ausente" }, 500);
  const provided = (req.headers.get("x-mcp-key") ?? "").trim();
  const { data: cfg } = await supa.from("mcp_config").select("api_key").eq("id", 1).maybeSingle();
  if (!cfg?.api_key || provided !== cfg.api_key) return json({ error: "unauthorized" }, 401);

  let body: any = {}; try { body = await req.json(); } catch { /* */ }
  const acao = String(body?.acao ?? "");
  const campaignId = String(body?.campaign_id ?? "");

  if (acao === "create") {
    const r = await g(`/${AD_ACCOUNT}/campaigns`, "POST", {
      name: `${PREFIXO} pausa-despausa F4 — não usar`,
      objective: "OUTCOME_TRAFFIC",
      status: "PAUSED",
      special_ad_categories: "[]",
      buying_type: "AUCTION",
      is_adset_budget_sharing_enabled: "false",
    });
    await audit("meta_test_create", r);
    return json(r, r.status === 200 ? 200 : 502);
  }

  if (["pause", "unpause", "status", "delete"].includes(acao)) {
    if (!campaignId) return json({ error: "campaign_id obrigatório" }, 400);
    const guard = await guardTeste(campaignId);
    if (!guard.ok) return json({ error: guard.erro }, 403);
    if (acao === "status") return json({ ok: true, campanha: guard.info });
    let r;
    if (acao === "delete") r = await g(`/${campaignId}`, "DELETE");
    else r = await g(`/${campaignId}`, "POST", { status: acao === "pause" ? "PAUSED" : "ACTIVE" });
    const depois = await g(`/${campaignId}?fields=name,status,effective_status`);
    await audit(`meta_test_${acao}`, { antes: guard.info, resultado: r, depois: depois.body });
    return json({ ok: r.status === 200, resultado: r, antes: guard.info, depois: depois.body }, r.status === 200 ? 200 : 502);
  }

  return json({ error: "acao inválida: use create | status | pause | unpause | delete" }, 400);
});
