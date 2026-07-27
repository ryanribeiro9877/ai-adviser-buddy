// supabase/functions/waba-sync/index.ts
//
// CONECTOR WABA — WhatsApp Business Management API (Graph) -> Supabase.
// Traz: WABAs, números (qualidade + limite de mensagens nível portfólio), templates,
// analytics diário (enviadas/entregues) e analytics por template (sent/delivered/read/clicked).
//
// Segredos (Edge Function Secrets — invisíveis ao SQL):
//   WHATSAPP_ACCESS_TOKEN  (obrigatório) token de System User (whatsapp_business_management+messaging+business_management)
//   META_BUSINESS_ID       (opcional)    ID da BM p/ descobrir WABAs; sem ele, usa as WABAs já na tabela public.wabas
//
// Auth da função: Authorization: Bearer <mcp_config.api_key> (ou x-mcp-key). verify_jwt=false.
// Idempotente (upserts). Janela de analytics: últimos 30 dias.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const GRAPH = "https://graph.facebook.com/v22.0";
const ANALYTICS_DAYS = 30;

function json(obj: unknown, status = 200) {
  return new Response(JSON.stringify(obj), { status, headers: { "content-type": "application/json" } });
}
const dayISO = (d: Date) => d.toISOString().slice(0, 10);
// limite de mensagens: campo novo (nível portfólio, out/2025) com fallback pro deprecado
const limStr = (p: any) => {
  const v = p.whatsapp_business_manager_messaging_limit ?? p.messaging_limit_tier ?? null;
  return v == null ? null : (typeof v === "object" ? JSON.stringify(v) : String(v));
};

async function gGet(path: string, params: Record<string, string>, token: string) {
  const url = new URL(`${GRAPH}/${path}`);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  url.searchParams.set("access_token", token);
  const resp = await fetch(url.toString());
  const text = await resp.text();
  let body: any = null;
  try { body = JSON.parse(text); } catch { /* deixa null */ }
  if (!resp.ok) return { ok: false as const, status: resp.status, error: body?.error?.message ?? text.slice(0, 300) };
  return { ok: true as const, body };
}

// paginação (cursor next é URL completa já com token)
async function gGetAll(path: string, params: Record<string, string>, token: string, maxPages = 20) {
  const out: any[] = [];
  let r = await gGet(path, params, token);
  let pages = 0;
  while (r.ok) {
    out.push(...(r.body?.data ?? []));
    const next = r.body?.paging?.next;
    if (!next || ++pages >= maxPages) break;
    const resp = await fetch(next);
    const text = await resp.text();
    let body: any = null; try { body = JSON.parse(text); } catch { /* */ }
    if (!resp.ok) return { ok: false as const, error: body?.error?.message ?? text.slice(0, 300), data: out };
    r = { ok: true as const, body };
  }
  if (!r.ok) return { ok: false as const, error: (r as any).error, data: out };
  return { ok: true as const, data: out };
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return json({ error: "POST only" }, 405);
  const supa = createClient(SUPABASE_URL, SERVICE_ROLE, { auth: { persistSession: false } });

  // ---- auth (mesmo padrão do windsor-sync) ----
  const authz = req.headers.get("authorization") ?? "";
  const bearer = authz.toLowerCase().startsWith("bearer ") ? authz.slice(7).trim() : "";
  const provided = bearer || (req.headers.get("x-mcp-key") ?? "").trim();
  const { data: cfg, error: cfgErr } = await supa.from("mcp_config").select("api_key").eq("id", 1).maybeSingle();
  if (cfgErr) return json({ error: "config_read_failed" }, 500);
  if (!cfg?.api_key || provided !== cfg.api_key) return json({ error: "unauthorized" }, 401);

  const token = (Deno.env.get("WHATSAPP_ACCESS_TOKEN") ?? "").trim();
  if (!token) return json({ error: "missing_WHATSAPP_ACCESS_TOKEN", hint: "cadastre em Edge Function Secrets" }, 400);
  const bizId = (Deno.env.get("META_BUSINESS_ID") ?? "").trim();

  // empresa default: os WhatsApps são da Legal é Viver
  const { data: legal } = await supa.from("companies").select("id").ilike("name", "%legal%viver%").maybeSingle();
  const companyId = legal?.id ?? null;

  const today = new Date();
  const start = new Date(today.getTime() - ANALYTICS_DAYS * 86400_000);
  const startTs = Math.floor(start.getTime() / 1000);
  const endTs = Math.floor(today.getTime() / 1000);

  const report: any[] = [];

  // ---- 1) Descobrir WABAs (cadeia: BM owned/client -> assigned ao system user -> tabela) ----
  let wabas: { id: string; name?: string; currency?: string; timezone_id?: string; raw?: any }[] = [];
  const edges: { path: string; label: string }[] = [];
  if (bizId) {
    edges.push({ path: `${bizId}/owned_whatsapp_business_accounts`, label: "owned" });
    edges.push({ path: `${bizId}/client_whatsapp_business_accounts`, label: "client" });
  }
  edges.push({ path: `me/assigned_whatsapp_business_accounts`, label: "assigned_to_system_user" });
  for (const e of edges) {
    const r = await gGetAll(e.path, { fields: "id,name,currency,timezone_id", limit: "50" }, token);
    if (!r.ok) { report.push({ step: `discover:${e.label}`, error: r.error }); continue; }
    report.push({ step: `discover:${e.label}`, found: r.data.length });
    wabas.push(...r.data.map((w: any) => ({ ...w, raw: w })));
  }
  {
    const seen = new Set<string>();
    wabas = wabas.filter((w) => (seen.has(w.id) ? false : (seen.add(w.id), true)));
  }
  if (wabas.length === 0) {
    const { data: rows } = await supa.from("wabas").select("external_id,name");
    wabas = (rows ?? []).map((r: any) => ({ id: r.external_id, name: r.name }));
    report.push({ step: "discover:fallback_table", count: wabas.length });
  }
  if (wabas.length === 0) return json({
    ok: false, error: "nenhuma_waba_encontrada",
    hint: "regenerar token incluindo business_management OU semear public.wabas(external_id)",
    report,
  }, 200);

  // upsert wabas
  for (const w of wabas) {
    await supa.from("wabas").upsert({
      company_id: companyId, external_id: w.id, name: w.name ?? null,
      currency: w.currency ?? null, timezone_id: w.timezone_id ?? null,
      raw: w.raw ?? null, last_synced_at: new Date().toISOString(),
    }, { onConflict: "external_id" });
  }
  report.push({ step: "wabas", upserted: wabas.length });

  // ---- 2) Por WABA: números, templates, analytics ----
  for (const w of wabas) {
    const wr: any = { waba: w.id, name: w.name ?? null };

    // números (qualidade + limite de mensagens)
    const ph = await gGetAll(`${w.id}/phone_numbers`,
      { fields: "id,display_phone_number,verified_name,status,quality_rating,messaging_limit_tier,whatsapp_business_manager_messaging_limit,name_status", limit: "50" }, token);
    if (!ph.ok) wr.phones_error = ph.error;
    const phones = ph.ok ? ph.data : (ph as any).data ?? [];
    for (const p of phones) {
      await supa.from("waba_phone_numbers").upsert({
        company_id: companyId, waba_external_id: w.id, external_id: p.id,
        display_phone_number: p.display_phone_number ?? null, verified_name: p.verified_name ?? null,
        status: p.status ?? null, quality_rating: p.quality_rating ?? null,
        messaging_limit_tier: limStr(p), name_status: p.name_status ?? null,
        raw: p, last_synced_at: new Date().toISOString(),
      }, { onConflict: "external_id" });
      await supa.from("waba_phone_snapshots").upsert({
        company_id: companyId, phone_external_id: p.id, snapshot_date: dayISO(today),
        quality_rating: p.quality_rating ?? null, messaging_limit_tier: limStr(p),
        status: p.status ?? null,
      }, { onConflict: "phone_external_id,snapshot_date" });
    }
    wr.phones = phones.length;

    // templates (paginado)
    const tp = await gGetAll(`${w.id}/message_templates`,
      { fields: "id,name,language,status,category,components,quality_score,rejected_reason", limit: "100" }, token);
    if (!tp.ok) wr.templates_error = tp.error;
    const templates = tp.ok ? tp.data : (tp as any).data ?? [];
    for (const t of templates) {
      const qs = t.quality_score != null
        ? (typeof t.quality_score === "object" ? (t.quality_score.score ?? JSON.stringify(t.quality_score)) : String(t.quality_score))
        : null;
      await supa.from("waba_templates").upsert({
        company_id: companyId, waba_external_id: w.id, external_id: t.id ?? null,
        name: t.name, language: t.language ?? "pt_BR", category: t.category ?? null,
        status: t.status ?? null, quality_score: qs, rejected_reason: t.rejected_reason ?? null,
        components: t.components ?? null, raw: t, last_synced_at: new Date().toISOString(),
      }, { onConflict: "waba_external_id,name,language" });
    }
    wr.templates = templates.length;

    // analytics agregado (enviadas/entregues por dia)
    const an = await gGet(`${w.id}`, { fields: `analytics.start(${startTs}).end(${endTs}).granularity(DAY)` }, token);
    if (!an.ok) wr.analytics_error = an.error;
    else {
      const points = an.body?.analytics?.data_points ?? [];
      for (const dp of points) {
        const d = dayISO(new Date((dp.start ?? 0) * 1000));
        await supa.from("waba_analytics_daily").upsert({
          company_id: companyId, waba_external_id: w.id, phone_external_id: "",
          date: d, sent: dp.sent ?? 0, delivered: dp.delivered ?? 0, raw: dp,
        }, { onConflict: "waba_external_id,phone_external_id,date" });
      }
      wr.analytics_days = points.length;
    }

    // analytics por template (sent/delivered/read/clicked) — pode exigir habilitação; try & report
    const approvedIds = templates.filter((t: any) => t.status === "APPROVED" && t.id).map((t: any) => String(t.id));
    let tplDays = 0; const tplErrors: string[] = [];
    for (let i = 0; i < approvedIds.length; i += 10) {
      const chunk = approvedIds.slice(i, i + 10);
      const ta = await gGet(`${w.id}/template_analytics`, {
        start: String(startTs), end: String(endTs), granularity: "DAILY",
        metric_types: JSON.stringify(["SENT", "DELIVERED", "READ", "CLICKED"]),
        template_ids: JSON.stringify(chunk),
      }, token);
      if (!ta.ok) { tplErrors.push(ta.error ?? "erro"); continue; }
      for (const row of (ta.body?.data ?? [])) {
        // formatos observados: {data:[{granularity, data_points:[{template_id, start, end, sent, delivered, read, clicked}]}]}
        const series = row.points ?? row.data_points ?? [];
        for (const dp of series) {
          const d = dayISO(new Date((dp.start ?? 0) * 1000));
          const clicked = Array.isArray(dp.clicked)
            ? dp.clicked.reduce((s: number, c: any) => s + (c.count ?? 0), 0)
            : (dp.clicked ?? 0);
          await supa.from("waba_template_analytics_daily").upsert({
            company_id: companyId, waba_external_id: w.id,
            template_external_id: String(dp.template_id ?? row.template_id ?? ""), template_name: null,
            date: d, sent: dp.sent ?? 0, delivered: dp.delivered ?? 0, read: dp.read ?? 0, clicked,
            raw: dp,
          }, { onConflict: "waba_external_id,template_external_id,date" });
          tplDays++;
        }
      }
    }
    wr.template_analytics_points = tplDays;
    if (tplErrors.length) wr.template_analytics_errors = [...new Set(tplErrors)].slice(0, 3);

    report.push(wr);
  }

  return json({ ok: true, window_days: ANALYTICS_DAYS, wabas: wabas.length, report });
});
