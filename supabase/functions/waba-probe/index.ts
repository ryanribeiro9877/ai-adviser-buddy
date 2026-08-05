// supabase/functions/waba-probe/index.ts (v2) — F5.1 diagnóstico
// v2: parâmetro body.token = 'waba' (default, usa WHATSAPP_ACCESS_TOKEN — SU Employee que
//     tem os ativos WABA atribuídos) | 'ads' (META_ADS_TOKEN, SU admin). Motivo: na v1 o
//     token de ads falhou em 7 WABAs com "does not exist or missing permissions", o que
//     indica falta de ATRIBUIÇÃO DE ATIVO (escopo ≠ ativo). Este parâmetro isola a causa.
// Descobre platform_type (CLOUD_API|ON_PREMISE|NOT_APPLICABLE), ownership_type, OBO,
// review e throughput. SOMENTE LEITURA. Auth: x-mcp-key. Token redigido.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { chaveMcpDe, mcpKeyValida } from "../_shared/mcp_auth.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const T_WABA = (Deno.env.get("WHATSAPP_ACCESS_TOKEN") ?? "").trim();
const T_ADS = (Deno.env.get("META_ADS_TOKEN") ?? "").trim();
const GRAPH = "https://graph.facebook.com/v21.0";

const supa = createClient(SUPABASE_URL, SERVICE_ROLE, { auth: { persistSession: false } });
function redact(s: string): string {
  let o = s;
  for (const t of [T_WABA, T_ADS]) if (t) o = o.split(t).join("[TOKEN-REDACTED]");
  return o.replace(/access_token=[A-Za-z0-9]+/g, "access_token=[TOKEN-REDACTED]");
}
function json(obj: unknown, status = 200) {
  return new Response(redact(JSON.stringify(obj)), { status, headers: { "content-type": "application/json" } });
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return json({ error: "POST only" }, 405);
  const auth = await mcpKeyValida(supa, chaveMcpDe(req, "header-only"));
  if (!auth.ok) return json({ error: "unauthorized", motivo: auth.motivo }, 401);

  let body: any = {}; try { body = await req.json(); } catch { /* */ }
  const qual = String(body?.token ?? "waba").toLowerCase();
  const TOKEN = qual === "ads" ? T_ADS : T_WABA;
  if (!TOKEN) return json({ error: `token '${qual}' ausente no ambiente` }, 500);

  async function g(path: string) {
    const sep = path.includes("?") ? "&" : "?";
    const r = await fetch(`${GRAPH}${path}${sep}access_token=${encodeURIComponent(TOKEN)}`);
    const t = await r.text();
    try { return { status: r.status, body: JSON.parse(redact(t)) }; } catch { return { status: r.status, body: redact(t.slice(0, 200)) }; }
  }

  const { data: wabas } = await supa.from("wabas").select("external_id,name").order("name");
  const out: any[] = [];
  for (const w of wabas ?? []) {
    const meta = await g(`/${w.external_id}?fields=name,account_review_status,message_template_namespace,ownership_type,on_behalf_of_business_info,owner_business_info`);
    const phones = await g(`/${w.external_id}/phone_numbers?fields=display_phone_number,verified_name,status,platform_type,quality_rating,throughput,is_official_business_account&limit=25`);
    out.push({
      waba: w.name, waba_id: w.external_id,
      acessivel: meta.status === 200,
      review: meta.body?.account_review_status ?? null,
      ownership_type: meta.body?.ownership_type ?? null,
      obo: meta.body?.on_behalf_of_business_info?.name ?? null,
      owner: meta.body?.owner_business_info?.name ?? null,
      erro: meta.status !== 200 ? (meta.body?.error?.message ?? meta.body) : null,
      numeros: (phones.body?.data ?? []).map((p: any) => ({
        numero: p.display_phone_number, nome: p.verified_name, status: p.status,
        platform_type: p.platform_type ?? "(nao_informado)",
        throughput: p.throughput?.level ?? null, qualidade: p.quality_rating ?? null,
        oba: p.is_official_business_account ?? null,
      })),
    });
  }
  const nums = out.flatMap((w) => w.numeros.map((n: any) => ({ waba: w.waba, ...n })));
  const porPlataforma: Record<string, number> = {};
  for (const n of nums) porPlataforma[n.platform_type] = (porPlataforma[n.platform_type] ?? 0) + 1;

  return json({ ok: true, token_usado: qual, wabas_total: out.length,
    wabas_acessiveis: out.filter((w) => w.acessivel).length,
    wabas_inacessiveis: out.filter((w) => !w.acessivel).map((w) => w.waba),
    numeros: nums.length, resumo_por_platform_type: porPlataforma, detalhe: out });
});
