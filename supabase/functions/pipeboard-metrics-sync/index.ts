// Fase B (14/08/2026): Windsor aposentado. Pipeboard e o coletor oficial.
// Escreve em ad_metric_snapshots (producao) E em ad_metric_snapshots_paralelo (espelho),
// depois faz rollup para metric_snapshots.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { chaveMcpDe, mcpKeyValida } from "../_shared/mcp_auth.ts";
import { pipeboardCall, pipeboardToken } from "../_shared/pipeboard.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const PIPEBOARD_URL = "https://meta-ads.mcp.pipeboard.co/";
const FONTE = "pipeboard:meta";
const FIELDS = [
  "account_id",
  "campaign_id",
  "adset_id",
  "ad_id",
  "ad_name",
  "date_start",
  "date_stop",
  "spend",
  "impressions",
  "reach",
  "clicks",
  "frequency",
  "actions",
  "quality_ranking",
  "engagement_rate_ranking",
  "conversion_rate_ranking",
];
const VIDEO_FIELDS = [
  "video_p25_watched_actions",
  "video_p50_watched_actions",
  "video_p75_watched_actions",
  "video_p95_watched_actions",
  "video_p100_watched_actions",
  "video_thruplay_watched_actions",
  "video_avg_time_watched_actions",
  "video_play_actions",
  "video_30_sec_watched_actions",
];

type ToolDef = { name?: string; inputSchema?: { properties?: Record<string, any>; required?: string[] } };

function json(value: unknown, status = 200) {
  return new Response(JSON.stringify(value), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function isoDate(value: unknown): string | null {
  const text = String(value ?? "").slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(text) ? text : null;
}

function number(value: unknown): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function integer(value: unknown): number {
  return Math.round(number(value));
}

function rank(value: unknown): string | null {
  const text = String(value ?? "").trim().toUpperCase();
  return text || null;
}

function actionValue(row: any, names: string[]): number {
  const wanted = new Set(names);
  const actions = Array.isArray(row?.actions) ? row.actions : [];
  let total = 0;
  for (const action of actions) {
    if (wanted.has(String(action?.action_type ?? action?.type ?? ""))) {
      total += number(action?.value);
    }
  }
  return total;
}

function videoActionValue(row: any, fieldNames: string[]): number {
  for (const name of fieldNames) {
    const raw = row?.[name];
    if (raw == null) continue;
    if (typeof raw === "number" || typeof raw === "string") {
      const n = number(raw);
      if (n > 0) return n;
      continue;
    }
    if (Array.isArray(raw) && raw.length) {
      let total = 0;
      for (const item of raw) {
        total += number(item?.value ?? item?.count ?? item);
      }
      if (total > 0) return total;
    }
  }
  return 0;
}

function mapRow(row: any, companyId: string, accountFallback: string) {
  const source = row?.metrics && typeof row.metrics === "object" ? { ...row, ...row.metrics } : row;
  const adId = String(source?.ad_id ?? source?.ad_external_id ?? "").trim();
  const snapshotDate = isoDate(
    source?.date_start ?? source?.date ?? source?.day ?? source?.snapshot_date ?? source?.period,
  );
  if (!adId || !snapshotDate) return null;
  return {
    company_id: companyId,
    ad_external_id: adId,
    campaign_external_id:
      String(source?.campaign_id ?? source?.campaign_external_id ?? "").trim() || null,
    account_id: String(source?.account_id ?? source?.ad_account_id ?? accountFallback).replace(
      /^act_/,
      "",
    ),
    snapshot_date: snapshotDate,
    spend: number(source?.spend),
    impressions: integer(source?.impressions),
    reach: integer(source?.reach),
    clicks: integer(source?.clicks),
    link_clicks:
      integer(source?.link_clicks) ||
      integer(source?.actions_link_click) ||
      integer(actionValue(source, ["link_click"])),
    landing_page_views:
      integer(source?.landing_page_views) ||
      integer(source?.actions_landing_page_view) ||
      integer(actionValue(source, ["landing_page_view"])),
    messaging_started:
      integer(source?.messaging_started) ||
      integer(source?.actions_onsite_conversion_messaging_conversation_started_7d) ||
      integer(
        actionValue(source, [
          "onsite_conversion.messaging_conversation_started_7d",
          "onsite_conversion_messaging_conversation_started_7d",
        ]),
      ),
    form_leads:
      integer(source?.form_leads) ||
      integer(source?.actions_lead) ||
      integer(actionValue(source, ["lead", "onsite_conversion.lead_grouped"])),
    // `leads` NAO e mais gravado (04/09/2026). Este coletor nao era um escritor legitimo da
    // coluna; era um escritor QUEBRADO, e a medicao mostra as duas coisas.
    //
    // O que a coluna deveria ser: a base combinada — `sync_ingest_windsor` ainda documenta
    // "leads = conversas + formulário". O que este mapeamento fazia: `source.leads` ou, na falta
    // dele, a acao `lead`. Nenhum dos dois olha `messaging_started`. Ou seja, ele so acertava a
    // definicao quando a campanha nao tinha conversa nenhuma.
    //
    // O estrago esta medido: das 95 linhas com `messaging_started > 0`, 23 (todas de 04/08 em
    // diante) gravaram `leads = 0` tendo resultado real — a fonte parou de devolver `source.leads`
    // e o fallback assumiu, calado. Ex.: 03/09, campanha bd9b6122, 44 conversas iniciadas,
    // `leads = 0`. Um numero de resultado que some quando a base muda e pior que numero ausente,
    // porque ninguem desconfia de um zero.
    //
    // A coluna e a mistura sem base declarada que ja saiu de `campaigns` em 03/09. Quem tem base
    // explicita e vive do rollup e `form_leads`, `messaging_started` e `link_clicks` — os tres
    // ficam. Omitir aqui e seguro: a coluna e default 0 em todas as tabelas onde existe.
    frequency: number(source?.frequency),
    quality_ranking: rank(source?.quality_ranking),
    engagement_rate_ranking: rank(source?.engagement_rate_ranking),
    conversion_rate_ranking: rank(source?.conversion_rate_ranking),
    video_p25_watched: integer(videoActionValue(source, ["video_p25_watched_actions", "video_p25_watched"])) || null,
    video_p50_watched: integer(videoActionValue(source, ["video_p50_watched_actions", "video_p50_watched"])) || null,
    video_p75_watched: integer(videoActionValue(source, ["video_p75_watched_actions", "video_p75_watched"])) || null,
    video_p100_watched: integer(videoActionValue(source, ["video_p100_watched_actions", "video_p100_watched"])) || null,
    video_thruplay: integer(videoActionValue(source, ["video_thruplay_watched_actions", "video_thruplay"])) || null,
    video_avg_time_watched: number(videoActionValue(source, ["video_avg_time_watched_actions", "video_avg_time_watched"])) || null,
    video_plays: integer(videoActionValue(source, ["video_play_actions", "video_plays"])) || null,
    fonte: FONTE,
  };
}

function collectRows(value: any, depth = 0): any[] {
  if (depth > 5 || value == null) return [];
  if (typeof value === "string") {
    try {
      return collectRows(JSON.parse(value), depth + 1);
    } catch {
      return [];
    }
  }
  if (Array.isArray(value)) {
    if (value.some((item) => item && typeof item === "object" && (item.ad_id || item.ad_external_id))) {
      return value.filter((item) => item && typeof item === "object");
    }
    return value.flatMap((item) => collectRows(item, depth + 1));
  }
  if (typeof value !== "object") return [];
  for (const key of [
    "data",
    "insights",
    "rows",
    "results",
    "items",
    "result",
    "segmented_metrics",
    "ads",
    "metrics",
  ]) {
    if (value[key] != null) {
      const found = collectRows(value[key], depth + 1);
      if (found.length) return found;
    }
  }
  return value.ad_id || value.ad_external_id ? [value] : [];
}

function parseResult(value: any, depth = 0): any {
  if (depth > 5 || value == null) return value;
  if (typeof value === "string") {
    try {
      return parseResult(JSON.parse(value), depth + 1);
    } catch {
      return value;
    }
  }
  if (typeof value === "object" && !Array.isArray(value) && value.result !== undefined) {
    return parseResult(value.result, depth + 1);
  }
  return value;
}

function nestedError(value: any, depth = 0): string | null {
  if (depth > 8 || value == null) return null;
  if (typeof value === "string") {
    try {
      return nestedError(JSON.parse(value), depth + 1);
    } catch {
      return null;
    }
  }
  if (Array.isArray(value)) {
    for (const item of value) {
      const found = nestedError(item, depth + 1);
      if (found) return found;
    }
    return null;
  }
  if (typeof value !== "object") return null;
  if (value.error) {
    return String(value.error?.message ?? value.error);
  }
  for (const child of Object.values(value)) {
    const found = nestedError(child, depth + 1);
    if (found) return found;
  }
  return null;
}

async function callTool(tool: string, args: Record<string, unknown>, token: string) {
  const response = await pipeboardCall(tool, args, token);
  response.body = parseResult(response.body);
  const embeddedError = nestedError(response.body);
  if (embeddedError) response.erro = embeddedError;
  response.ok =
    response.status >= 200 &&
    response.status < 300 &&
    !response.erro &&
    !response.body?.error;
  return response;
}

function nextCursor(body: any): string | null {
  const value =
    body?.next_cursor ??
    body?.pagination?.next_cursor ??
    body?.paging?.next_cursor ??
    body?.paging?.cursors?.after ??
    body?.meta?.next_cursor;
  const text = String(value ?? "").trim();
  return text || null;
}

function sampleFields(value: any): Record<string, { type: string; sample: unknown }> {
  if (!value || typeof value !== "object") return {};
  return Object.fromEntries(
    Object.entries(value)
      .slice(0, 80)
      .map(([key, field]) => [
        key,
        {
          type: Array.isArray(field) ? "array" : field === null ? "null" : typeof field,
          sample:
            typeof field === "string"
              ? field.slice(0, 160)
              : Array.isArray(field)
                ? field.slice(0, 2)
                : field,
        },
      ]),
  );
}

async function rpc(method: string, params: Record<string, unknown>, token: string) {
  const response = await fetch(PIPEBOARD_URL, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      accept: "application/json, text/event-stream",
      authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
  });
  const raw = await response.text();
  let envelope: any = null;
  const candidates = raw
    .split("\n")
    .map((line) => line.replace(/^data:\s*/, "").trim())
    .filter(Boolean);
  for (const candidate of [raw, ...candidates.reverse()]) {
    try {
      envelope = JSON.parse(candidate);
      break;
    } catch {
      // Tenta o próximo frame SSE.
    }
  }
  return { ok: response.ok && !envelope?.error, status: response.status, envelope, raw: raw.slice(0, 500) };
}

async function listTools(token: string): Promise<ToolDef[]> {
  const response = await rpc("tools/list", {}, token);
  const tools = response.envelope?.result?.tools;
  return Array.isArray(tools) ? tools : [];
}

function toolByName(tools: ToolDef[], name: string): ToolDef | null {
  return tools.find((tool) => tool.name === name) ?? null;
}

function buildArgs(
  tool: ToolDef | null,
  accountId: string,
  dateFrom: string,
  dateTo: string,
  body: any,
  after?: string | null,
): Record<string, unknown> {
  const properties = tool?.inputSchema?.properties ?? {};
  const has = (name: string) => Object.hasOwn(properties, name);
  const args: Record<string, unknown> = {};
  const account = accountId.replace(/^act_/, "");

  if (has("object_id")) args.object_id = `act_${account}`;
  else if (has("account_id") || !tool) args.account_id = account;
  else if (has("ad_account_id")) args.ad_account_id = account;
  else if (has("account_ids")) args.account_ids = [account];

  if (has("level") || !tool) args.level = "ad";
  if (has("time_breakdown") || !tool) args.time_breakdown = "day";
  if (has("compact") || !tool) args.compact = true;
  if (has("fields") || !tool) args.fields = [...FIELDS, ...VIDEO_FIELDS];
  if (has("limit") || !tool) args.limit = Math.min(Math.max(integer(body?.limit) || 500, 1), 1000);

  if (has("time_range")) args.time_range = { since: dateFrom, until: dateTo };
  else {
    if (has("since")) args.since = dateFrom;
    if (has("until")) args.until = dateTo;
    if (has("date_from") || !tool) args.date_from = dateFrom;
    if (has("date_to") || !tool) args.date_to = dateTo;
  }

  const campaignIds = Array.isArray(body?.campaign_ids) ? body.campaign_ids.map(String) : [];
  const adsetIds = Array.isArray(body?.adset_ids) ? body.adset_ids.map(String) : [];
  if (campaignIds.length && (has("campaign_ids") || !tool)) args.campaign_ids = campaignIds;
  if (adsetIds.length && (has("adset_ids") || !tool)) args.adset_ids = adsetIds;
  if (after && (has("after") || !tool)) args.after = after;
  if (after && has("cursor")) args.cursor = after;

  // Defesa em profundidade: esta chave nunca integra o payload, ainda que apareça no schema.
  delete args.access_token;
  return args;
}

function buildBulkArgs(
  accountId: string,
  dateFrom: string,
  dateTo: string,
  body: any,
  after?: string | null,
  probeVideo = false,
): Record<string, unknown> {
  const args: Record<string, unknown> = {
    level: "ad",
    account_ids: [accountId.replace(/^act_/, "")],
    since: dateFrom,
    until: dateTo,
    time_breakdown: "day",
    compact: true,
    fields: probeVideo ? [...FIELDS, ...VIDEO_FIELDS] : FIELDS,
    limit: 1,
  };
  const campaignIds = Array.isArray(body?.campaign_ids) ? body.campaign_ids.map(String) : [];
  const adsetIds = Array.isArray(body?.adset_ids) ? body.adset_ids.map(String) : [];
  if (campaignIds.length) args.campaign_ids = campaignIds;
  if (adsetIds.length) args.adset_ids = adsetIds;
  if (after) args.after = after;
  return args;
}

function probeResult(name: string, response: any, schema: ToolDef | null) {
  const body = response?.body;
  const rows = collectRows(body);
  const sample =
    rows[0]?.metrics && typeof rows[0].metrics === "object"
      ? { ...rows[0], ...rows[0].metrics }
      : rows[0];
  return {
    ferramenta: name,
    schema: schema?.inputSchema ?? null,
    ok: response?.ok === true,
    http_status: response?.status ?? null,
    erro: response?.erro ?? null,
    tipo_resultado: Array.isArray(body) ? "array" : body === null ? "null" : typeof body,
    campos_raiz: body && typeof body === "object" ? Object.keys(body) : [],
    campos_raiz_detalhes: sampleFields(body),
    linhas_encontradas: rows.length,
    campos_primeira_linha: sampleFields(sample),
    cursor: nextCursor(body),
    envelope_result_parseado: true,
  };
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return json({ error: "POST only" }, 405);
  const supa = createClient(SUPABASE_URL, SERVICE_ROLE, { auth: { persistSession: false } });
  const auth = await mcpKeyValida(supa, chaveMcpDe(req, "bearer-or-header"));
  if (!auth.ok) return json({ error: "unauthorized", motivo: auth.motivo }, 401);

  let body: any = {};
  try {
    body = await req.json();
  } catch {
    // Corpo vazio usa defaults seguros.
  }

  const { data: dbSecret } = await supa
    .from("integration_secrets")
    .select("value")
    .eq("name", "pipeboard_api_token")
    .maybeSingle();
  const token = await pipeboardToken(async () => String(dbSecret?.value ?? ""));
  if (!token) {
    return json(
      {
        ok: false,
        error: "missing_pipeboard_api_token",
        PIPEBOARD_API_TOKEN: "ausente no Edge Secret e em integration_secrets",
        fase: "B",
        windsor_desligado: true,
      },
      400,
    );
  }

  const today = new Date().toISOString().slice(0, 10);
  const sevenDaysAgo = new Date(Date.now() - 6 * 86400000).toISOString().slice(0, 10);
  const dateFrom = isoDate(body?.date_from) ?? sevenDaysAgo;
  const dateTo = isoDate(body?.date_to) ?? today;
  if (dateFrom > dateTo) return json({ error: "date_from posterior a date_to" }, 400);

  const { data: integrations, error: integrationError } = await supa
    .from("integrations")
    .select("company_id, external_id, status")
    .eq("provider", "meta_ads")
    .not("external_id", "is", null);
  if (integrationError) return json({ error: "integrations_read_failed", detail: integrationError.message }, 500);

  const requestedAccounts = Array.isArray(body?.account_ids)
    ? new Set(body.account_ids.map((value: unknown) => String(value).replace(/^act_/, "")))
    : null;
  const activeIntegrations = (integrations ?? []).filter(
    (item: any) =>
      item.external_id &&
      item.status !== "disabled" &&
      (!requestedAccounts || requestedAccounts.has(String(item.external_id).replace(/^act_/, ""))),
  );
  const tools = await listTools(token);
  const getTool = toolByName(tools, "get_insights");
  const bulkTool = toolByName(tools, "bulk_get_insights");

  if (body?.probe === true) {
    const integration = activeIntegrations[0];
    if (!integration) return json({ error: "nenhuma_integracao_meta_para_sonda" }, 400);
    const probeDate = isoDate(body?.probe_date) ?? dateTo;
    const args = buildArgs(getTool, String(integration.external_id), probeDate, probeDate, body);
    const getResponse = await callTool("get_insights", args, token);

    let bulkResponse: any = {
      ok: false,
      status: null,
      body: null,
      erro: bulkTool ? "schema_bulk_nao_mapeado_para_chamada_segura" : "ferramenta_nao_listada_no_plano",
    };
    if (bulkTool) {
      const properties = bulkTool.inputSchema?.properties ?? {};
      let bulkArgs: Record<string, unknown> | null = null;
      if (Object.hasOwn(properties, "requests")) bulkArgs = { requests: [args] };
      else if (Object.hasOwn(properties, "items")) bulkArgs = { items: [args] };
      else if (Object.hasOwn(properties, "account_ids")) {
        bulkArgs = buildBulkArgs(
          String(integration.external_id),
          probeDate,
          probeDate,
          body,
          null,
          true,
        );
      }
      if (bulkArgs) bulkResponse = await callTool("bulk_get_insights", bulkArgs, token);
    }

    const getProbe = probeResult("get_insights", getResponse, getTool);
    const bulkProbe = probeResult("bulk_get_insights", bulkResponse, bulkTool);
    return json({
      ok: getResponse.ok || bulkResponse.ok,
      fase: "A",
      PIPEBOARD_API_TOKEN: "presente na Edge (valor não exposto)",
      ferramentas_listadas: tools.map((tool) => tool.name).filter(Boolean),
      premium: {
        bulk_disponivel: !!bulkTool,
        bulk_executado: bulkResponse.status !== null,
        rankings_retornados: [
          "quality_ranking",
          "engagement_rate_ranking",
          "conversion_rate_ranking",
        ].filter((field) => Object.hasOwn(bulkProbe.campos_primeira_linha, field)),
        video_retention_retornada: Object.keys(bulkProbe.campos_primeira_linha).filter((field) =>
          /video.*(retention|watched|play)/i.test(field),
        ),
      },
      get_insights: getProbe,
      bulk_get_insights: bulkProbe,
      nota: "result do envelope MCP foi convertido de string JSON antes da leitura de campos",
    });
  }

  const reports: any[] = [];
  let totalUpserted = 0;
  for (const integration of activeIntegrations) {
    const accountId = String(integration.external_id).replace(/^act_/, "");
    let after: string | null = null;
    let pages = 0;
    let collected = 0;
    let accountError: string | null = null;
    let getInsightsError: string | null = null;
    let usingBulk = false;
    const rowsByKey = new Map<string, any>();

    let collectMore = true;
    while (collectMore && pages < 50) {
      const args = usingBulk
        ? buildBulkArgs(accountId, dateFrom, dateTo, body, after)
        : buildArgs(getTool, accountId, dateFrom, dateTo, body, after);
      const response = await callTool(
        usingBulk ? "bulk_get_insights" : "get_insights",
        args,
        token,
      );
      pages += 1;
      if (!response.ok) {
        if (!usingBulk && bulkTool) {
          getInsightsError = response.erro ?? `pipeboard_http_${response.status}`;
          usingBulk = true;
          after = null;
          continue;
        }
        accountError = response.erro ?? `pipeboard_http_${response.status}`;
        reports.push({
          account_id: accountId,
          page: pages,
          error: accountError,
          response_fields: sampleFields(response.body),
        });
        break;
      }
      const pageRows = collectRows(response.body);
      collected += pageRows.length;
      for (const rawRow of pageRows) {
        const mapped = mapRow(rawRow, String(integration.company_id), accountId);
        if (mapped) rowsByKey.set(`${mapped.ad_external_id}:${mapped.snapshot_date}`, mapped);
      }
      const cursor = nextCursor(response.body);
      after = cursor && cursor !== after ? cursor : null;
      collectMore = !!after;
    }

    const rows = [...rowsByKey.values()];
    let upserted = 0;
    let upsertedProd = 0;
    for (let start = 0; start < rows.length; start += 500) {
      const chunk = rows.slice(start, start + 500);
      const { error: errPar } = await supa
        .from("ad_metric_snapshots_paralelo")
        .upsert(chunk, { onConflict: "ad_external_id,snapshot_date" });
      if (errPar) {
        accountError = `staging_upsert_failed: ${errPar.message}`;
        break;
      }
      const { error: errProd } = await supa
        .from("ad_metric_snapshots")
        .upsert(chunk, { onConflict: "ad_external_id,snapshot_date" });
      if (errProd) {
        accountError = `production_upsert_failed: ${errProd.message}`;
        break;
      }
      upserted += chunk.length;
      upsertedProd += chunk.length;
    }
    totalUpserted += upserted;
    reports.push({
      account_id: accountId,
      coletor: usingBulk ? "bulk_get_insights_fallback" : "get_insights",
      get_insights_error: getInsightsError,
      pages,
      pipeboard_rows: collected,
      unique_rows: rows.length,
      upserted,
      upserted_producao: upsertedProd,
      error: accountError,
    });
  }

  const { data: rollup, error: rollupErr } = await supa.rpc("rollup_metric_snapshots_from_ads", {
    p_from: dateFrom,
    p_to: dateTo,
  });

  return json({
    ok: reports.every((item) => !item.error) && !rollupErr,
    fase: "B",
    fonte: FONTE,
    PIPEBOARD_API_TOKEN: "presente na Edge (valor não exposto)",
    window: { date_from: dateFrom, date_to: dateTo },
    level: "ad",
    time_breakdown: "day",
    access_token_enviado: false,
    destino: ["ad_metric_snapshots", "ad_metric_snapshots_paralelo", "metric_snapshots(rollup)"],
    tabela_real_alterada: true,
    total_upserted: totalUpserted,
    rollup: rollupErr ? { ok: false, erro: rollupErr.message } : rollup,
    report: reports,
  });
});
