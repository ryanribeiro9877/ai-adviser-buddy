// supabase/functions/waba-sync/index.ts (v18)
//
// CONECTOR WABA — WhatsApp Business Management API (Graph) -> Supabase.
// Traz: WABAs, números (qualidade + limite de mensagens nível portfólio), templates,
// analytics diário (enviadas/entregues) e analytics por template (sent/delivered/read/clicked).
//
// v18.1 (29/07/2026) — F5.4 coleta POR NÚMERO + template_name:
//   (1) NOVO: analytics diário POR NÚMERO — grava linhas em waba_analytics_daily com
//       phone_external_id PREENCHIDO. HISTÓRICO DA ABORDAGEM: a v18 tentou 1 chamada por
//       WABA com dimensions(["PHONE"]), mas a Graph IGNOROU o modificador em silêncio
//       (200 ok, pontos agregados sem phone_number, zero gravados — validação 29/07).
//       A v18.1 usa filtro phone_numbers([digitos]) com 1 chamada POR NÚMERO: a atribuição
//       é por construção. Telemetria guarda 1 amostra crua da resposta por sync
//       (analytics_por_numero_amostra_raw) p/ diagnosticar futuras mudanças da Graph.
//       Falha nessa etapa NÃO derruba a coleta agregada: degrada com aviso no report.
//   (2) template_name agora é preenchido na origem (mapa id->name dos templates da própria
//       WABA). Backfill das 728 linhas antigas já foi aplicado direto no banco em 29/07.
//   (3) Marcador de versão no retorno (versao: "waba-sync-v18") p/ sonda pós-deploy.
//   A coleta agregada (phone_external_id = '') segue INALTERADA — relatório diário e telas
//   que a consomem não mudam de contrato.
//
// Segredos (Edge Function Secrets — invisíveis ao SQL):
//   WHATSAPP_ACCESS_TOKEN  (obrigatório) token de System User (whatsapp_business_management+messaging+business_management)
//   META_BUSINESS_ID       (opcional)    ID da BM p/ descobrir WABAs; sem ele, usa as WABAs já na tabela public.wabas
//
// Auth da função: Authorization: Bearer <mcp_config.api_key> (ou x-mcp-key). verify_jwt=false.
// Idempotente (upserts). Janela de analytics: últimos 30 dias.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { chaveMcpDe, mcpKeyValida } from "../_shared/mcp_auth.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const GRAPH = "https://graph.facebook.com/v22.0";
const ANALYTICS_DAYS = 30;
const VERSAO = "waba-sync-v18.1";

function json(obj: unknown, status = 200) {
  return new Response(JSON.stringify(obj), { status, headers: { "content-type": "application/json" } });
}
const dayISO = (d: Date) => d.toISOString().slice(0, 10);
const soDigitos = (s: unknown) => String(s ?? "").replace(/\D+/g, "");
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
  const auth = await mcpKeyValida(supa, chaveMcpDe(req, "bearer-or-header"));
  if (!auth.ok) return json({ error: "unauthorized", motivo: auth.motivo }, 401);

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
    ok: false, versao: VERSAO, error: "nenhuma_waba_encontrada",
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

    // v18: mapa dígitos do número -> external_id (a analytics por número devolve dígitos, não id)
    const phoneIdPorDigitos = new Map<string, string>();
    for (const p of phones) {
      const dig = soDigitos(p.display_phone_number);
      if (dig) phoneIdPorDigitos.set(dig, String(p.id));
    }

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

    // v18: mapa id -> name p/ preencher template_name na analytics por template
    const nomePorTemplateId = new Map<string, string>();
    for (const t of templates) if (t.id && t.name) nomePorTemplateId.set(String(t.id), String(t.name));

    // analytics agregado (enviadas/entregues por dia) — INALTERADO (phone_external_id = '')
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

    // v18.1: analytics POR NÚMERO via filtro phone_numbers([digitos]) — 1 chamada por número.
    // Motivo da mudança: dimensions(["PHONE"]) foi IGNORADA silenciosamente pela Graph na
    // validação de 29/07 (200 ok, pontos agregados sem phone_number, zero gravados). Com o
    // filtro, a atribuição é por construção: pedi o número X, a resposta é do número X.
    // Falha aqui degrada com aviso, nunca derruba a coleta agregada acima.
    {
      let gravados = 0; const errosNum: string[] = [];
      let amostraGuardada = false;
      for (const p of phones) {
        const dig = soDigitos(p.display_phone_number);
        if (!p.id || !dig) continue;
        const anPh = await gGet(`${w.id}`,
          { fields: `analytics.start(${startTs}).end(${endTs}).granularity(DAY).phone_numbers(["${dig}"])` }, token);
        if (!anPh.ok) { errosNum.push(anPh.error ?? "erro"); continue; }
        const points = anPh.body?.analytics?.data_points ?? [];
        // telemetria de diagnóstico: guarda UMA amostra crua por sync (primeiro número com resposta)
        if (!amostraGuardada) {
          wr.analytics_por_numero_amostra_raw = JSON.stringify(anPh.body?.analytics ?? anPh.body ?? {}).slice(0, 400);
          amostraGuardada = true;
        }
        for (const dp of points) {
          const d = dayISO(new Date((dp.start ?? 0) * 1000));
          await supa.from("waba_analytics_daily").upsert({
            company_id: companyId, waba_external_id: w.id,
            phone_external_id: String(p.id), // atribuição por construção (filtro da chamada)
            date: d, sent: dp.sent ?? 0, delivered: dp.delivered ?? 0, raw: dp,
          }, { onConflict: "waba_external_id,phone_external_id,date" });
          gravados++;
        }
      }
      wr.analytics_por_numero_pontos = gravados;
      if (errosNum.length) wr.analytics_por_numero_errors = [...new Set(errosNum)].slice(0, 3);
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
          const tplId = String(dp.template_id ?? row.template_id ?? "");
          await supa.from("waba_template_analytics_daily").upsert({
            company_id: companyId, waba_external_id: w.id,
            template_external_id: tplId,
            template_name: nomePorTemplateId.get(tplId) ?? null, // v18: preenchido na origem
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

  return json({ ok: true, versao: VERSAO, window_days: ANALYTICS_DAYS, wabas: wabas.length, report });
});
