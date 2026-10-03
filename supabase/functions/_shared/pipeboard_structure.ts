export type ToolSchema = { properties?: Record<string, unknown> } | null;

type ListOptions = {
  campaignId?: string;
  adsetId?: string;
  after?: string;
  limit?: number;
  statusFilter?: string;
  fields?: string;
};

// A Graph omite o que nao foi pedido pelo nome. O conector faz o mesmo: sem `fields`,
// o criativo volta so com id e a miniatura nunca entra no espelho.
export const CAMPOS_ANUNCIO_PIPEBOARD =
  "id,name,status,effective_status,adset_id,campaign_id,preview_shareable_link,creative{id,thumbnail_url,image_url,image_hash,object_story_spec,video_id,object_type,body,title,asset_feed_spec}";

export const CAMPOS_CRIATIVO_PIPEBOARD =
  "id,thumbnail_url,image_url,image_hash,object_story_spec,video_id,object_type,body,title,asset_feed_spec";

export function argumentosComCampos(
  properties: Record<string, unknown> | null | undefined,
  args: Record<string, unknown>,
  campos: string,
): Record<string, unknown> {
  if (properties && Object.hasOwn(properties, "fields")) {
    return { ...args, fields: campos };
  }
  return args;
}

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

const STATUS_SO_EFETIVO = new Set([
  "CAMPAIGN_PAUSED",
  "ADSET_PAUSED",
  "WITH_ISSUES",
  "PENDING_REVIEW",
  "DISAPPROVED",
  "PREAPPROVED",
  "PENDING_BILLING_INFO",
  "IN_PROCESS",
]);

function caixaMeta(value: unknown): string | null {
  const status = text(value).toUpperCase();
  return status || null;
}

// status = configurado no objeto. effective_status = o que a Meta aplica.
// Um valor que so existe como efetivo (CAMPAIGN_PAUSED) nao entra em status:
// a coluna voltaria a misturar os dois conceitos e o check do banco recusaria
// a linha, derrubando o lote inteiro por um campo que tem casa propria.
export function partirStatus(row: any): { status?: string; effective_status?: string } {
  const configurado = caixaMeta(row?.status);
  const efetivo = caixaMeta(row?.effective_status);
  const out: { status?: string; effective_status?: string } = {};
  if (efetivo) out.effective_status = efetivo;
  if (configurado && STATUS_SO_EFETIVO.has(configurado)) {
    if (!out.effective_status) out.effective_status = configurado;
  } else if (configurado) {
    out.status = configurado;
  }
  return out;
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
  if (options.fields && has("fields")) args.fields = options.fields;
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
    ...partirStatus(row),
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
    ...partirStatus(row),
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

/** Junta textos distintos na ordem em que aparecem. Variantes iguais nao duplicam. */
function textosDoCriativo(valores: unknown[]): string | null {
  const vistos = new Set<string>();
  const out: string[] = [];
  const add = (v: unknown) => {
    const s = text(v);
    if (!s || vistos.has(s)) return;
    vistos.add(s);
    out.push(s);
  };
  for (const valor of valores) {
    if (Array.isArray(valor)) {
      for (const item of valor) {
        if (typeof item === "string") add(item);
        else if (item && typeof item === "object") {
          add((item as { text?: unknown; message?: unknown }).text ??
            (item as { message?: unknown }).message);
        }
      }
    } else {
      add(valor);
    }
  }
  return out.length ? out.join("\n---\n") : null;
}

// Extrai conteudo e destino do criativo.
// object_story_spec cobre video/link/foto avulsos. asset_feed_spec.bodies cobre o
// Criativo Dinamico / Advantage+, que e o formato da maioria das pecas digitadas
// no Gerenciador: a midia sobe pelo sistema e a legenda nunca voltava porque este
// extrator so lia `creative.body` e `video_data.message`.
export function extractCreativeFields(creative: any) {
  const spec = parseJson(creative?.object_story_spec) ?? {};
  const data = spec.video_data ?? spec.link_data ?? spec.photo_data ?? spec.template_data ?? {};
  const afs = parseJson(creative?.asset_feed_spec) ?? {};
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
    body: textosDoCriativo([
      creative?.body,
      data?.message,
      spec?.video_data?.message,
      spec?.link_data?.message,
      spec?.photo_data?.message,
      spec?.template_data?.message,
      afs?.bodies,
    ]),
    title: textosDoCriativo([
      creative?.title,
      data?.title,
      data?.name,
      afs?.titles,
    ]),
    image_url: text(data?.image_url) || text(creative?.image_url) || null,
    thumbnail_url: text(creative?.thumbnail_url) || null,
    video_id: videoIdDoCriativo(creative),
  };
}

// A capa do video e o que a grade mostra. thumbnail_url da Meta e esse frame;
// image_url do video_data e o mesmo quadro quando o campo de cima nao vem.
export function urlDaMiniatura(creative: any): string | null {
  const spec = parseJson(creative?.object_story_spec) ?? {};
  const candidatos = [
    creative?.thumbnail_url,
    spec?.video_data?.image_url,
    creative?.image_url,
    spec?.link_data?.picture,
    spec?.link_data?.image_url,
    spec?.photo_data?.url,
    spec?.photo_data?.image_url,
  ];
  for (const candidato of candidatos) {
    const s = text(candidato);
    if (s.startsWith("https://")) return s;
  }
  return null;
}

export function videoIdDoCriativo(creative: any): string | null {
  const spec = parseJson(creative?.object_story_spec) ?? {};
  const id = text(creative?.video_id) || text(spec?.video_data?.video_id);
  return id || null;
}

export function hashDaImagem(creative: any): string | null {
  const spec = parseJson(creative?.object_story_spec) ?? {};
  const hash =
    text(creative?.image_hash) ||
    text(spec?.link_data?.image_hash) ||
    text(spec?.photo_data?.image_hash) ||
    text(spec?.video_data?.image_hash);
  return hash || null;
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
    ...partirStatus(row),
    object_type: creativeFields.object_type,
    call_to_action_type: creativeFields.call_to_action_type,
    destination_url: creativeFields.destination_url,
    body: creativeFields.body,
    title: creativeFields.title,
    // URL de CDN da Meta expira em dias. thumbnail_url no banco e caminho no
    // storage, gravado por miniatura_criativo — nunca a URL que acabou de vir.
    ...(creativeFields.video_id ? { meta_video_id: creativeFields.video_id } : {}),
    preview_url: text(row?.preview_shareable_link) || text(row?.preview_url) || null,
    last_synced_at: new Date().toISOString(),
    config_coletada_em: new Date().toISOString(),
    fonte_config: "pipeboard:meta",
    ausente_na_graph_em: null,
  };
}
