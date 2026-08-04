// supabase/functions/windsor-sync/index.ts (v16)
//
// v16 (04/08/2026) — RANKINGS DE QUALIDADE DO ANUNCIO. O relatorio diario declarava a ausencia
//   desses tres campos; o Windsor entrega e foi provado com dado real em 04/08 (conta
//   3302001729967572), no MESMO nivel ad_daily que ja e coletado - custo zero de chamada nova.
//   Requer as 3 colunas em ad_metric_snapshots e os 3 campos no jsonb_to_recordset da RPC
//   sync_ingest_ad_snapshots; sem a migracao, estas 3 chaves sao ignoradas pela RPC (o
//   recordset descarta chave que nao declara), entao esta versao NAO quebra se subir antes.
//
// v15 — CORREÇÃO CRÍTICA (incidente 23-27/07/2026: 5 dias sem métricas de campanha):
//   (1) ORDEM DE INGESTÃO: as linhas de CAMPANHA agora são gravadas IMEDIATAMENTE após a
//       coleta, ANTES do bloco de janela ampla. Antes ficavam em memória até a última
//       linha da função; como o bloco wide (36 meses × 2 chamadas pesadas) estourava o
//       IDLE_TIMEOUT de 150s da plataforma, a função morria e TUDO que já tinha sido
//       coletado era perdido. O nível anúncio (ingest inline) sobrevivia — daí a
//       assimetria observada: ad_metric_snapshots cheio, metric_snapshots vazio.
//   (2) wide_from opcional no body: permite reduzir a janela ampla sem depender do
//       secret WINDSOR_WIDE_FROM.
//   (3) bloco wide isolado em try/catch: falha/lentidão nele não derruba a resposta.
//   (4) resposta informa 'campaign_ingest' com o resultado real da gravação.
// RECOMENDAÇÃO DE CRON: diário com {skip_wide:true}; wide em job semanal separado.
//
// NÍVEIS: campanha (snapshots diários) + conjunto (ad_sets) + anúncio (ads) + ad-snapshots.
// Auth: Bearer <mcp_config.api_key> (ou x-mcp-key). verify_jwt=false. Idempotente.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
function wideFrom(override?: string | null): string {
  const floor = new Date();
  floor.setMonth(floor.getMonth() - 36);
  const floorStr = floor.toISOString().slice(0, 10);
  const envFrom = (override ?? Deno.env.get("WINDSOR_WIDE_FROM") ?? "").trim();
  return envFrom && envFrom > floorStr ? envFrom : floorStr;
}
const today = () => new Date().toISOString().slice(0, 10);

const PROVIDER_CONNECTOR: Record<string, string> = { meta_ads: "facebook" };

const METRICS = [
  "spend", "impressions", "reach", "clicks",
  "actions_link_click", "actions_landing_page_view",
  "actions_onsite_conversion_messaging_conversation_started_7d", "actions_lead",
  "actions_offsite_conversion_fb_pixel_purchase", "action_values_offsite_conversion_fb_pixel_purchase",
];
const FIELDS: Record<string, string[]> = {
  facebook: ["date", "account_id", "account_name", "campaign", "campaign_id", "objective", "frequency", ...METRICS],
};
const FIELDS_ADS: Record<string, string[]> = {
  facebook: [
    "account_id", "campaign_id", "adset_id", "ad_id", "ad_name", "creative_id",
    "thumbnail_url", "image_url", "title", "body", "call_to_action_type", "object_type",
    "effective_status", "instagram_permalink_url", "facebook_permalink_url", "mobile_feed_standard_preview_url",
    ...METRICS,
  ],
};
// v16 (04/08/2026): os tres rankings de qualidade da Meta vem na MESMA requisicao do nivel
// ad_daily - testado no Windsor em 04/08 e ele entrega (nao foi o caso do url_tags). Sao
// categoricos, nao numericos: ABOVE_AVERAGE | AVERAGE | BELOW_AVERAGE_10 | BELOW_AVERAGE_20 |
// BELOW_AVERAGE_35 | UNKNOWN.
const RANKINGS = ["quality_ranking", "engagement_rate_ranking", "conversion_rate_ranking"];
const FIELDS_AD_DAILY: Record<string, string[]> = {
  facebook: ["date", "account_id", "campaign_id", "ad_id", "frequency", ...METRICS, ...RANKINGS],
};
const FIELDS_ADSETS: Record<string, string[]> = {
  facebook: [
    "account_id", "campaign_id", "adset_id", "adset_name", "adset_status",
    "adset_daily_budget", "adset_lifetime_budget", "adset_bid_strategy", "adset_targeting",
    ...METRICS,
  ],
};

const num = (v: unknown) => { const n = Number(v); return Number.isFinite(n) ? n : 0; };
const int = (v: unknown) => Math.round(num(v));
const anySignal = (o: any) =>
  o.spend > 0 || o.impressions > 0 || o.clicks > 0 || o.link_clicks > 0 ||
  o.messaging_started > 0 || o.form_leads > 0 || o.sales > 0;

function baseMetrics(row: any) {
  return {
    spend: num(row.spend), impressions: int(row.impressions), reach: int(row.reach), clicks: int(row.clicks),
    link_clicks: int(row.actions_link_click), landing_page_views: int(row.actions_landing_page_view),
    messaging_started: int(row.actions_onsite_conversion_messaging_conversation_started_7d),
    form_leads: int(row.actions_lead),
    sales: int(row.actions_offsite_conversion_fb_pixel_purchase),
    revenue: num(row.action_values_offsite_conversion_fb_pixel_purchase),
  };
}

function mapFacebook(row: any, integ: any) {
  const m = baseMetrics(row);
  if (!anySignal(m)) return null;
  return {
    company_id: integ.company_id, provider: integ.provider, account_id: integ.external_id,
    campaign_id: String(row.campaign_id ?? ""), campaign_name: row.campaign ?? "(sem nome)",
    objective: row.objective ?? null, date: row.date, frequency: num(row.frequency),
    ...m, source: "windsor:facebook",
  };
}
function mapAd(row: any, integ: any) {
  if (!row.ad_id) return null;
  const m = baseMetrics(row);
  if (!anySignal(m)) return null;
  return {
    account_id: integ.external_id,
    campaign_external_id: String(row.campaign_id ?? ""),
    adset_external_id: row.adset_id != null ? String(row.adset_id) : null,
    ad_external_id: String(row.ad_id),
    name: row.ad_name ?? null,
    creative_id: row.creative_id != null ? String(row.creative_id) : null,
    thumbnail_url: row.thumbnail_url ?? null, image_url: row.image_url ?? null,
    title: row.title ?? null, body: row.body ?? null,
    call_to_action_type: row.call_to_action_type ?? null, object_type: row.object_type ?? null,
    status: row.effective_status ?? null,
    permalink_url: row.instagram_permalink_url ?? row.facebook_permalink_url ?? null,
    preview_url: row.mobile_feed_standard_preview_url ?? null,
    ...m,
  };
}
// v16: ranking chega como texto. NULL e UNKNOWN sao coisas DIFERENTES e a distincao precisa
// sobreviver no banco: null = nao coletado (campo ausente na resposta); UNKNOWN = coletado, e a
// Meta declarou que ainda nao ha impressoes suficientes para julgar. Ler UNKNOWN como "qualidade
// ruim" seria erro de leitura - hoje os 3 anuncios em entrega estao todos UNKNOWN, com 1,4 a 2,6
// mil impressoes/dia cada.
const rank = (v: unknown): string | null => {
  const s = String(v ?? "").trim().toUpperCase();
  return s ? s : null;
};

function mapAdDaily(row: any, integ: any) {
  if (!row.ad_id || !row.date) return null;
  const m = baseMetrics(row);
  return {
    account_id: integ.external_id,
    campaign_external_id: String(row.campaign_id ?? ""),
    ad_external_id: String(row.ad_id),
    snapshot_date: row.date,
    spend: m.spend, impressions: m.impressions, reach: m.reach, clicks: m.clicks,
    link_clicks: m.link_clicks, landing_page_views: m.landing_page_views,
    messaging_started: m.messaging_started, form_leads: m.form_leads,
    frequency: num(row.frequency),
    quality_ranking: rank(row.quality_ranking),
    engagement_rate_ranking: rank(row.engagement_rate_ranking),
    conversion_rate_ranking: rank(row.conversion_rate_ranking),
  };
}
function mapAdset(row: any, integ: any) {
  if (!row.adset_id) return null;
  const m = baseMetrics(row);
  let targeting: any = row.adset_targeting ?? null;
  if (typeof targeting === "string") { try { targeting = JSON.parse(targeting); } catch { /* mantém string */ } }
  return {
    account_id: integ.external_id,
    campaign_external_id: String(row.campaign_id ?? ""),
    adset_external_id: String(row.adset_id),
    name: row.adset_name ?? null,
    status: row.adset_status ?? null,
    daily_budget: row.adset_daily_budget != null ? num(row.adset_daily_budget) : null,
    lifetime_budget: row.adset_lifetime_budget != null ? num(row.adset_lifetime_budget) : null,
    bid_strategy: row.adset_bid_strategy ?? null,
    targeting,
    ...m,
  };
}

function json(obj: unknown, status = 200) {
  return new Response(JSON.stringify(obj), { status, headers: { "content-type": "application/json" } });
}

async function fetchRows(connector: string, fields: string[], key: string, win: { preset?: string | null; from?: string | null; to?: string | null }) {
  const url = new URL(`https://connectors.windsor.ai/${connector}`);
  url.searchParams.set("api_key", key);
  url.searchParams.set("fields", fields.join(","));
  if (win.preset) url.searchParams.set("date_preset", win.preset);
  if (win.from) url.searchParams.set("date_from", win.from);
  if (win.to) url.searchParams.set("date_to", win.to);
  const resp = await fetch(url.toString(), { headers: { accept: "application/json" } });
  const text = await resp.text();
  if (!resp.ok) return { error: `windsor_http_${resp.status}`, body: text.slice(0, 300), rows: [] as any[] };
  let parsed: any;
  try { parsed = JSON.parse(text); } catch { return { error: "windsor_non_json", body: text.slice(0, 300), rows: [] as any[] }; }
  return { rows: (Array.isArray(parsed) ? parsed : (parsed?.data ?? [])) as any[] };
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return json({ error: "POST only" }, 405);
  const supa = createClient(SUPABASE_URL, SERVICE_ROLE, { auth: { persistSession: false } });

  const authz = req.headers.get("authorization") ?? "";
  const bearer = authz.toLowerCase().startsWith("bearer ") ? authz.slice(7).trim() : "";
  const provided = bearer || (req.headers.get("x-mcp-key") ?? "").trim();
  const { data: cfg, error: cfgErr } = await supa.from("mcp_config").select("api_key").eq("id", 1).maybeSingle();
  if (cfgErr) return json({ error: "config_read_failed", detail: cfgErr.message }, 500);
  if (!cfg?.api_key || provided !== cfg.api_key) return json({ error: "unauthorized" }, 401);

  const { data: sec } = await supa.from("integration_secrets").select("value").eq("name", "windsor_api_key").maybeSingle();
  const windsorKey = (sec?.value ?? "").trim();
  if (!windsorKey) return json({ error: "missing_windsor_api_key" }, 400);

  let body: any = {};
  try { body = await req.json(); } catch { /* vazio ok */ }
  const dateFrom = body?.date_from ? String(body.date_from) : null;
  const dateTo = body?.date_to ? String(body.date_to) : null;
  const datePreset = dateFrom ? null : String(body?.date_preset ?? "last_7d");
  const skipWide = body?.skip_wide === true;
  const wideFromOverride = body?.wide_from ? String(body.wide_from) : null;
  const reqWin = { preset: datePreset, from: dateFrom, to: dateTo };
  const wideWin = { preset: null as string | null, from: wideFrom(wideFromOverride), to: today() };

  const { data: integs, error: ie } = await supa
    .from("integrations").select("id, company_id, provider, external_id, account_name, status");
  if (ie) return json({ error: "integrations_read_failed", detail: ie.message }, 500);

  const byAccount = new Map<string, any>();
  const byConnector = new Map<string, any[]>();
  for (const it of integs ?? []) {
    const connector = PROVIDER_CONNECTOR[it.provider as string];
    if (!connector || !it.external_id) continue;
    byAccount.set(String(it.external_id), it);
    (byConnector.get(connector) ?? byConnector.set(connector, []).get(connector)!).push(it);
  }
  const resolve = (r: any, list: any[]) => {
    let integ = r.account_id != null ? byAccount.get(String(r.account_id)) : undefined;
    if (!integ && list.length === 1) integ = list[0];
    return integ;
  };

  const report: any[] = [];
  let campaignIngest: any = { note: "no rows" };
  let campaignRowsTotal = 0;

  for (const [connector, list] of byConnector) {
    const accounts = list.map((x) => x.external_id);

    // ---- CAMPANHA (janela do request) — v15: COLETA + INGEST IMEDIATO ----
    if (FIELDS[connector]) {
      const r = await fetchRows(connector, FIELDS[connector], windsorKey, reqWin);
      if (r.error) report.push({ connector, level: "campaign", error: r.error, body: r.body });
      else {
        const rows: any[] = [];
        for (const row of r.rows) {
          const integ = resolve(row, list); if (!integ) continue;
          const m = mapFacebook(row, integ); if (m && m.campaign_id) rows.push(m);
        }
        campaignRowsTotal += rows.length;
        if (rows.length) {
          const { data: res, error: re } = await supa.rpc("sync_ingest_windsor", { p_rows: rows });
          if (re) report.push({ connector, level: "campaign", ingest_error: re.message });
          else campaignIngest = res;
        }
        report.push({ connector, level: "campaign", accounts, windsor_rows: r.rows.length, kept: rows.length, ingerido_imediatamente: true });
      }
    }

    // ---- AD-SNAPSHOTS DIÁRIOS (janela do request COM date) ----
    if (FIELDS_AD_DAILY[connector]) {
      const r = await fetchRows(connector, FIELDS_AD_DAILY[connector], windsorKey, reqWin);
      if (r.error) report.push({ connector, level: "ad_daily", error: r.error, body: r.body });
      else {
        const rows: any[] = [];
        for (const row of r.rows) { const integ = resolve(row, list); if (!integ) continue; const m = mapAdDaily(row, integ); if (m) rows.push(m); }
        let ingested = 0;
        if (rows.length) { const { data, error } = await supa.rpc("sync_ingest_ad_snapshots", { p: rows }); if (error) report.push({ connector, level: "ad_daily", ingest_error: error.message }); else ingested = data as number; }
        report.push({ connector, level: "ad_daily", windsor_rows: r.rows.length, ingested });
      }
    }

    // ---- JANELA AMPLA (opcional, isolada: não pode derrubar o que já foi gravado) ----
    if (!skipWide) {
      try {
        if (FIELDS_ADSETS[connector]) {
          const r = await fetchRows(connector, FIELDS_ADSETS[connector], windsorKey, wideWin);
          if (r.error) report.push({ connector, level: "adset", error: r.error, body: r.body });
          else {
            const rows: any[] = [];
            for (const row of r.rows) { const integ = resolve(row, list); if (!integ) continue; const m = mapAdset(row, integ); if (m) rows.push(m); }
            let ingested = 0;
            if (rows.length) { const { data, error } = await supa.rpc("sync_ingest_adsets", { p: rows }); if (error) report.push({ connector, level: "adset", ingest_error: error.message }); else ingested = data as number; }
            report.push({ connector, level: "adset", windsor_rows: r.rows.length, ingested });
          }
        }
        if (FIELDS_ADS[connector]) {
          const r = await fetchRows(connector, FIELDS_ADS[connector], windsorKey, wideWin);
          if (r.error) report.push({ connector, level: "ad", error: r.error, body: r.body });
          else {
            const rows: any[] = [];
            for (const row of r.rows) { const integ = resolve(row, list); if (!integ) continue; const m = mapAd(row, integ); if (m) rows.push(m); }
            let ingested = 0;
            if (rows.length) { const { data, error } = await supa.rpc("sync_ingest_ads", { p: rows }); if (error) report.push({ connector, level: "ad", ingest_error: error.message }); else ingested = data as number; }
            report.push({ connector, level: "ad", windsor_rows: r.rows.length, ingested });
          }
        }
      } catch (e) {
        report.push({ connector, level: "wide", erro_isolado: String((e as any)?.message ?? e), nota: "campanha e ad_daily JÁ foram gravados antes deste bloco" });
      }
    }
  }

  return json({
    ok: true,
    window: dateFrom ? { date_from: dateFrom, date_to: dateTo } : { date_preset: datePreset },
    wide_window: skipWide ? { skipped: true } : wideWin,
    report,
    campaign_rows_ingested: campaignRowsTotal,
    campaign_ingest: campaignIngest,
  });
});
