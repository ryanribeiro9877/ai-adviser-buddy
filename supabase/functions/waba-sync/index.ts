// supabase/functions/waba-sync/index.ts (v21 platform_type)
//
// CONECTOR WABA — WhatsApp Business Management API (Graph) -> Supabase.
// Traz: WABAs, numeros (qualidade + limite de mensagens nivel portfolio), templates,
// analytics diario (enviadas/entregues) e analytics por template (sent/delivered/read/clicked).
//
// v19 (multi-empresa): loop por empresa com token WABA isolado (meta_company_tokens).
//   Nunca faz fallback de token entre empresas. BM via businessIdPorCompanyId (COHAPM + Legal).
//   Fallback da tabela wabas filtra por company_id e exclui ads-destino-%.
//
// v18.1 (29/07/2026) — F5.4 coleta POR NUMERO + template_name:
//   (1) analytics diario POR NUMERO — grava linhas em waba_analytics_daily com
//       phone_external_id PREENCHIDO. A v18.1 usa filtro phone_numbers([digitos])
//       com 1 chamada POR NUMERO (atribuicao por construcao). Telemetria guarda
//       1 amostra crua (analytics_por_numero_amostra_raw). Falha nessa etapa NAO
//       derruba a coleta agregada.
//   (2) template_name preenchido na origem (mapa id->name dos templates da WABA).
//   (3) Marcador de versao no retorno p/ sonda pos-deploy.
//   Coleta agregada (phone_external_id = '') segue INALTERADA.
//
// Segredos (Edge Function Secrets):
//   WHATSAPP_ACCESS_TOKEN          Legal (via meta_company_tokens)
//   WHATSAPP_ACCESS_TOKEN_COHAPM   COHAPM (nome literal; sem alias)
//   META_BUSINESS_ID               opcional; BM Legal (COHAPM usa business_id no shared)
//
// Auth: Authorization: Bearer <mcp_config.api_key> (ou x-mcp-key). verify_jwt=false.
// Idempotente (upserts). Janela de analytics: ultimos 30 dias.
// Body opcional: { "company_id": "<uuid>" } para sync de uma empresa so.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { chaveMcpDe, mcpKeyValida } from "../_shared/mcp_auth.ts";
import {
  COMPANY_LEGAL,
  businessIdPorCompanyId,
  empresasComTokenWaba,
  redactAllMetaTokens,
  tokenWabaPorCompanyId,
} from "../_shared/meta_company_tokens.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const GRAPH = "https://graph.facebook.com/v22.0";
const ANALYTICS_DAYS = 30;
const VERSAO = "waba-sync-v21-platform-type";

function json(obj: unknown, status = 200) {
  return new Response(redactAllMetaTokens(JSON.stringify(obj)), {
    status,
    headers: { "content-type": "application/json" },
  });
}
const dayISO = (d: Date) => d.toISOString().slice(0, 10);
const soDigitos = (s: unknown) => String(s ?? "").replace(/\D+/g, "");
// limite de mensagens: campo novo (nivel portfolio, out/2025) com fallback pro deprecado
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

// paginacao (cursor next e URL completa ja com token)
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

type EmpresaAlvo = {
  company_id: string;
  slug: string;
  nome: string;
  token: string;
  ref: string;
};

/** Sync de UMA empresa com O SEU token WABA — nunca usa token de outra. */
async function syncEmpresa(
  // deno-lint-ignore no-explicit-any
  supa: any,
  emp: EmpresaAlvo,
  startTs: number,
  endTs: number,
  today: Date,
) {
  const companyId = emp.company_id;
  const token = emp.token; // isolado: so este token nesta iteracao
  const report: any[] = [];

  // BM por empresa (COHAPM hardcode; Legal via META_BUSINESS_ID)
  const bizId = businessIdPorCompanyId(companyId);

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
    // fallback: so WABAs desta empresa; exclui inventarios Click-to-WhatsApp (ads-destino-%)
    const { data: rows } = await supa
      .from("wabas")
      .select("external_id,name")
      .eq("company_id", companyId)
      .not("external_id", "like", "ads-destino-%");
    wabas = (rows ?? []).map((r: any) => ({ id: r.external_id, name: r.name }));
    report.push({ step: "discover:fallback_table", count: wabas.length });
  }
  if (wabas.length === 0) {
    return {
      company_id: companyId,
      slug: emp.slug,
      nome: emp.nome,
      token_ref: emp.ref,
      ok: false,
      error: "nenhuma_waba_encontrada",
      hint: "regenerar token incluindo business_management OU semear public.wabas(external_id)",
      report,
    };
  }

  // upsert wabas
  for (const w of wabas) {
    await supa.from("wabas").upsert({
      company_id: companyId, external_id: w.id, name: w.name ?? null,
      currency: w.currency ?? null, timezone_id: w.timezone_id ?? null,
      raw: w.raw ?? null, last_synced_at: new Date().toISOString(),
    }, { onConflict: "external_id" });
  }
  report.push({ step: "wabas", upserted: wabas.length });

  // ---- 2) Por WABA: numeros, templates, analytics ----
  for (const w of wabas) {
    const wr: any = { waba: w.id, name: w.name ?? null };

    // numeros (qualidade + limite de mensagens)
    const ph = await gGetAll(`${w.id}/phone_numbers`,
      { fields: "id,display_phone_number,verified_name,status,quality_rating,messaging_limit_tier,whatsapp_business_manager_messaging_limit,name_status,platform_type", limit: "50" }, token);
    if (!ph.ok) wr.phones_error = ph.error;
    const phones = ph.ok ? ph.data : (ph as any).data ?? [];
    for (const p of phones) {
      await supa.from("waba_phone_numbers").upsert({
        company_id: companyId, waba_external_id: w.id, external_id: p.id,
        display_phone_number: p.display_phone_number ?? null, verified_name: p.verified_name ?? null,
        status: p.status ?? null, quality_rating: p.quality_rating ?? null,
        messaging_limit_tier: limStr(p), name_status: p.name_status ?? null,
        platform_type: p.platform_type ?? null,
        raw: p, last_synced_at: new Date().toISOString(),
      }, { onConflict: "external_id" });
      await supa.from("waba_phone_snapshots").upsert({
        company_id: companyId, phone_external_id: p.id, snapshot_date: dayISO(today),
        quality_rating: p.quality_rating ?? null, messaging_limit_tier: limStr(p),
        status: p.status ?? null,
      }, { onConflict: "phone_external_id,snapshot_date" });
    }
    wr.phones = phones.length;

    // v18: mapa digitos do numero -> external_id (analytics por numero devolve digitos, nao id)
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

    // v18.1: analytics POR NUMERO via filtro phone_numbers([digitos]) — 1 chamada por numero.
    // Motivo: dimensions(["PHONE"]) foi IGNORADA silenciosamente pela Graph.
    // Com o filtro, a atribuicao e por construcao. Falha degrada com aviso.
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
        // telemetria: guarda UMA amostra crua por sync (primeiro numero com resposta)
        if (!amostraGuardada) {
          wr.analytics_por_numero_amostra_raw = JSON.stringify(anPh.body?.analytics ?? anPh.body ?? {}).slice(0, 400);
          amostraGuardada = true;
        }
        for (const dp of points) {
          const d = dayISO(new Date((dp.start ?? 0) * 1000));
          await supa.from("waba_analytics_daily").upsert({
            company_id: companyId, waba_external_id: w.id,
            phone_external_id: String(p.id), // atribuicao por construcao (filtro da chamada)
            date: d, sent: dp.sent ?? 0, delivered: dp.delivered ?? 0, raw: dp,
          }, { onConflict: "waba_external_id,phone_external_id,date" });
          gravados++;
        }
      }
      wr.analytics_por_numero_pontos = gravados;
      if (errosNum.length) wr.analytics_por_numero_errors = [...new Set(errosNum)].slice(0, 3);
    }

    // analytics por template (sent/delivered/read/clicked) — pode exigir habilitacao; try & report
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

  return {
    company_id: companyId,
    slug: emp.slug,
    nome: emp.nome,
    token_ref: emp.ref,
    ok: true,
    wabas: wabas.length,
    report,
  };
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return json({ error: "POST only" }, 405);
  const supa = createClient(SUPABASE_URL, SERVICE_ROLE, { auth: { persistSession: false } });

  // ---- auth (mesmo padrao do windsor-sync) ----
  const auth = await mcpKeyValida(supa, chaveMcpDe(req, "bearer-or-header"));
  if (!auth.ok) return json({ error: "unauthorized", motivo: auth.motivo }, 401);

  // body opcional: { company_id?: string }
  let filtroCompanyId: string | null = null;
  try {
    const raw = await req.text();
    if (raw.trim()) {
      const parsed = JSON.parse(raw);
      const cid = parsed?.company_id;
      if (cid != null && String(cid).trim()) filtroCompanyId = String(cid).trim();
    }
  } catch {
    return json({ error: "invalid_json_body" }, 400);
  }

  // lista de empresas com token WABA presente — sem fallback cruzado
  let alvos: EmpresaAlvo[] = [];
  if (filtroCompanyId) {
    const tw = tokenWabaPorCompanyId(filtroCompanyId);
    if (!tw) {
      return json({
        ok: false,
        versao: VERSAO,
        error: "missing_waba_token_for_company",
        company_id: filtroCompanyId,
        hint: "cadastre o secret WABA desta empresa (nao usamos token de outra empresa)",
      }, 400);
    }
    const cfg = empresasComTokenWaba().find((e) => e.company_id === tw.company_id);
    alvos = [{
      company_id: tw.company_id,
      slug: tw.slug,
      nome: cfg?.nome ?? tw.slug,
      token: tw.token,
      ref: tw.ref,
    }];
  } else {
    alvos = empresasComTokenWaba().map((e) => ({
      company_id: e.company_id,
      slug: e.slug,
      nome: e.nome,
      token: e.token,
      ref: e.ref,
    }));
  }

  if (alvos.length === 0) {
    return json({
      ok: false,
      versao: VERSAO,
      error: "nenhuma_empresa_com_token_waba",
      hint: "cadastre WHATSAPP_ACCESS_TOKEN e/ou WHATSAPP_ACCESS_TOKEN_COHAPM",
    }, 400);
  }

  const today = new Date();
  const start = new Date(today.getTime() - ANALYTICS_DAYS * 86400_000);
  const startTs = Math.floor(start.getTime() / 1000);
  const endTs = Math.floor(today.getTime() / 1000);

  const empresas: any[] = [];
  for (const emp of alvos) {
    // cada iteracao usa SOMENTE emp.token — isolado por company_id
    const resultado = await syncEmpresa(supa, emp, startTs, endTs, today);
    empresas.push(resultado);
  }

  const ok = empresas.every((e) => e.ok === true);
  return json({
    ok,
    versao: VERSAO,
    window_days: ANALYTICS_DAYS,
    empresas,
  });
});
