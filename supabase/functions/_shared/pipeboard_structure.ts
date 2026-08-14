export type ToolSchema = { properties?: Record<string, unknown> } | null;

type ListOptions = {
  campaignId?: string;
  adsetId?: string;
  after?: string;
  limit?: number;
  statusFilter?: string;
};

const text = (value: unknown) => String(value ?? "").trim();
const numeric = (value: unknown): number | null => {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};

function parseJson(value: unknown): any {
  let current = value;
  for (let i = 0; i < 4 && typeof current === "string"; i++) {
    try {
      current = JSON.parse(current);
    } catch {
      break;
    }
  }
  return current;
}

function normalizeStatus(value: unknown): string | null {
  const status = text(value).toLowerCase();
  return status || null;
}

function firstId(value: any): string {
  return text(value?.id ?? value);
}

export function buildStructureArgs(
  schema: ToolSchema,
  accountId: string,
  options: ListOptions = {},
): Record<string, unknown> {
  const properties = schema?.properties ?? {};
  const has = (name: string) => Object.hasOwn(properties, name);
  const account = accountId.replace(/^act_/, "");
  const args: Record<string, unknown> = {};
  if (has("account_id") || !schema) args.account_id = `act_${account}`;
  else if (has("ad_account_id")) args.ad_account_id = account;
  if (options.campaignId && has("campaign_id")) args.campaign_id = options.campaignId;
  if (options.adsetId && has("adset_id")) args.adset_id = options.adsetId;
  if (options.after && has("after")) args.after = options.after;
  if (options.after && has("cursor")) args.cursor = options.after;
  if (has("limit")) args.limit = Math.min(Math.max(options.limit ?? 100, 1), 500);
  if (options.statusFilter && has("status_filter")) args.status_filter = options.statusFilter;
  delete args.access_token;
  return args;
}

export function collectStructureRows(value: unknown): { rows: any[]; after: string | null } {
  const root = parseJson(value);
  const body = parseJson(root?.result ?? root);
  const candidates = [
    body?.data,
    body?.items,
    body?.campaigns,
    body?.adsets,
    body?.ad_sets,
    body?.ads,
    Array.isArray(body) ? body : null,
  ];
  const rows = candidates.find(Array.isArray) ?? [];
  const after = text(
    body?.paging?.cursors?.after ??
      body?.paging?.next_cursor ??
      body?.pagination?.next_cursor ??
      body?.next_cursor,
  ) || null;
  return { rows, after };
}

export function firstStructureObject(value: unknown): any | null {
  const root = parseJson(value);
  const body = parseJson(root?.result ?? root);
  const nested = parseJson(body?.data ?? body?.campaign ?? body?.adset ?? body?.ad ?? body);
  if (Array.isArray(nested)) return nested[0] ?? null;
  return nested && typeof nested === "object" ? nested : null;
}

export function mapPipeboardCampaign(row: any, companyId: string, accountId: string) {
  const externalId = firstId(row?.id ?? row?.campaign_id);
  if (!companyId || !externalId) throw new Error("campaign_company_or_external_id_missing");
  return {
    company_id: companyId,
    provider: "meta_ads",
    external_id: externalId,
    external_account_id: accountId.replace(/^act_/, ""),
    name: text(row?.name) || externalId,
    objective: text(row?.objective) || null,
    status: normalizeStatus(row?.effective_status ?? row?.status),
    daily_budget: numeric(row?.daily_budget),
    lifetime_budget: numeric(row?.lifetime_budget),
    bid_strategy: text(row?.bid_strategy) || null,
    buying_type: text(row?.buying_type) || null,
    special_ad_categories: Array.isArray(row?.special_ad_categories) ? row.special_ad_categories : null,
    is_adset_budget_sharing_enabled:
      typeof row?.is_adset_budget_sharing_enabled === "boolean"
        ? row.is_adset_budget_sharing_enabled
        : null,
    config_coletada_em: new Date().toISOString(),
    last_synced_at: new Date().toISOString(),
    fonte_config: "pipeboard:meta",
  };
}

export function mapPipeboardAdset(
  row: any,
  companyId: string,
  accountId: string,
  campaignMap: Map<string, string>,
) {
  const externalId = firstId(row?.id ?? row?.adset_id);
  const campaignExternalId = firstId(row?.campaign_id ?? row?.campaign);
  const campaignId = campaignMap.get(campaignExternalId);
  if (!companyId || !externalId || !campaignId) throw new Error("adset_company_or_campaign_missing");
  return {
    company_id: companyId,
    provider: "meta_ads",
    account_id: accountId.replace(/^act_/, ""),
    campaign_id: campaignId,
    external_id: externalId,
    name: text(row?.name) || externalId,
    status: text(row?.effective_status ?? row?.status).toUpperCase() || null,
    daily_budget: numeric(row?.daily_budget),
    lifetime_budget: numeric(row?.lifetime_budget),
    bid_strategy: text(row?.bid_strategy) || null,
    optimization_goal: text(row?.optimization_goal) || null,
    billing_event: text(row?.billing_event) || null,
    destination_type: text(row?.destination_type) || null,
    promoted_object: parseJson(row?.promoted_object) ?? null,
    targeting: parseJson(row?.targeting) ?? null,
    last_synced_at: new Date().toISOString(),
    config_coletada_em: new Date().toISOString(),
    fonte_config: "pipeboard:meta",
    ausente_na_graph_em: null,
  };
}

// Extrai conteudo e destino do criativo (object_story_spec cobre video/link/foto).
export function extractCreativeFields(creative: any) {
  const spec = parseJson(creative?.object_story_spec) ?? {};
  const data = spec.video_data ?? spec.link_data ?? spec.photo_data ?? spec.template_data ?? {};
  const cta = data?.call_to_action ?? creative?.call_to_action ?? null;
  const destino =
    text(cta?.value?.link) ||
    text(data?.link) ||
    text(spec?.link_data?.link) ||
    text(creative?.destination_url) ||
    null;
  return {
    object_type: text(creative?.object_type) || null,
    call_to_action_type: text(cta?.type) || null,
    destination_url: destino,
    body: text(creative?.body) || text(data?.message) || null,
    title: text(creative?.title) || text(data?.title) || text(data?.name) || null,
    image_url: text(data?.image_url) || text(creative?.image_url) || null,
    thumbnail_url: text(creative?.thumbnail_url) || null,
  };
}

export function mapPipeboardAd(
  row: any,
  companyId: string,
  accountId: string,
  campaignMap: Map<string, string>,
) {
  const externalId = firstId(row?.id ?? row?.ad_id);
  const campaignExternalId = firstId(row?.campaign_id ?? row?.campaign);
  const campaignId = campaignMap.get(campaignExternalId);
  const adsetExternalId = firstId(row?.adset_id ?? row?.adset);
  if (!companyId || !externalId || !campaignId || !adsetExternalId) {
    throw new Error("ad_company_campaign_or_adset_missing");
  }
  const creative = parseJson(row?.creative) ?? {};
  const creativeFields = extractCreativeFields(creative);
  return {
    company_id: companyId,
    provider: "meta_ads",
    account_id: accountId.replace(/^act_/, ""),
    campaign_id: campaignId,
    adset_external_id: adsetExternalId,
    external_id: externalId,
    name: text(row?.name) || externalId,
    creative_id: firstId(row?.creative ?? row?.creative_id) || null,
    status: text(row?.effective_status ?? row?.status).toUpperCase() || null,
    object_type: creativeFields.object_type,
    call_to_action_type: creativeFields.call_to_action_type,
    destination_url: creativeFields.destination_url,
    body: creativeFields.body,
    title: creativeFields.title,
    image_url: creativeFields.image_url,
    thumbnail_url: creativeFields.thumbnail_url,
    preview_url: text(row?.preview_shareable_link) || text(row?.preview_url) || null,
    last_synced_at: new Date().toISOString(),
    config_coletada_em: new Date().toISOString(),
    fonte_config: "pipeboard:meta",
    ausente_na_graph_em: null,
  };
}
