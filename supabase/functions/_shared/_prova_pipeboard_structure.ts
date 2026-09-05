import {
  buildStructureArgs,
  collectStructureRows,
  firstStructureObject,
  mapPipeboardAd,
  mapPipeboardAdset,
  mapPipeboardCampaign,
} from "./pipeboard_structure.ts";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

const args = buildStructureArgs(
  {
    properties: {
      account_id: {},
      campaign_id: {},
      limit: {},
      after: {},
      access_token: {},
    },
  },
  "1622612945584817",
  { campaignId: "cmp-1", after: "cursor-2", limit: 100 },
);
assert(args.account_id === "act_1622612945584817", "account_id deve usar act_");
assert(args.campaign_id === "cmp-1", "campaign_id ausente");
assert(args.after === "cursor-2", "cursor ausente");
assert(!("access_token" in args), "access_token nunca pode ser enviado");

const rows = collectStructureRows({
  result: JSON.stringify({
    data: [{ id: "set-1", name: "Conjunto 1" }],
    paging: { cursors: { after: "next-1" }, next: "https://example" },
  }),
});
assert(rows.rows.length === 1, "deve desembrulhar result JSON");
assert(rows.after === "next-1", "deve ler cursor de paginacao");
assert(
  firstStructureObject({ result: JSON.stringify({ id: "detail-1", daily_budget: "5000" }) })?.id ===
    "detail-1",
  "deve desembrulhar objeto de detalhe",
);

const campaign = mapPipeboardCampaign(
  {
    id: "cmp-1",
    name: "Campanha",
    objective: "OUTCOME_ENGAGEMENT",
    effective_status: "ACTIVE",
    daily_budget: "12345",
    bid_strategy: "LOWEST_COST_WITHOUT_CAP",
  },
  "company-1",
  "1622612945584817",
);
assert(campaign.company_id === "company-1", "campaign company_id");
assert(campaign.external_account_id === "1622612945584817", "campaign account");
assert(campaign.daily_budget === 12345, "budget deve continuar em centavos");
assert(campaign.status === "active", "status normalizado");
assert(campaign.fonte_config === "pipeboard:meta", "fonte campaign");

const adset = mapPipeboardAdset(
  {
    id: "set-1",
    campaign_id: "cmp-1",
    name: "Conjunto",
    status: "PAUSED",
    daily_budget: 7200,
    bid_strategy: "LOWEST_COST_WITHOUT_CAP",
    optimization_goal: "LINK_CLICKS",
    billing_event: "IMPRESSIONS",
    destination_type: "UNDEFINED",
    promoted_object: { page_id: "105656372312257" },
    targeting: { age_min: 25, geo_locations: { countries: ["BR"] } },
  },
  "company-1",
  "1622612945584817",
  new Map([["cmp-1", "campaign-uuid"]]),
);
assert(adset.campaign_id === "campaign-uuid", "campaign FK deve vir do mapa da empresa");
assert(adset.account_id === "1622612945584817", "adset account");
assert(adset.daily_budget === 7200, "adset budget em centavos");
assert((adset.targeting as any).age_min === 25, "targeting preservado");
assert(adset.optimization_goal === "LINK_CLICKS", "optimization_goal capturado");
assert(adset.billing_event === "IMPRESSIONS", "billing_event capturado");
assert(adset.destination_type === "UNDEFINED", "destination_type capturado");
assert((adset.promoted_object as any).page_id === "105656372312257", "promoted_object preservado");

let blocked = false;
try {
  mapPipeboardAdset(
    { id: "set-x", campaign_id: "cmp-de-outra-empresa", name: "Invalido" },
    "company-1",
    "1622612945584817",
    new Map(),
  );
} catch {
  blocked = true;
}
assert(blocked, "adset sem campanha vinculada deve falhar fechado");

const ad = mapPipeboardAd(
  {
    id: "ad-1",
    name: "Anuncio",
    campaign_id: "cmp-1",
    adset_id: "set-1",
    effective_status: "ACTIVE",
    preview_shareable_link: "https://fb.me/preview",
    creative: {
      id: "creative-1",
      object_type: "VIDEO",
      thumbnail_url: "https://cdn/thumb.jpg",
      body: "Corpo do anuncio",
      title: "Titulo do anuncio",
      object_story_spec: {
        page_id: "105656372312257",
        video_data: {
          message: "Corpo do anuncio",
          title: "Titulo do anuncio",
          image_url: "https://cdn/img.jpg",
          call_to_action: { type: "CONTACT_US", value: { link: "https://wa.me/5571993451315" } },
        },
      },
    },
  },
  "company-1",
  "1622612945584817",
  new Map([["cmp-1", "campaign-uuid"]]),
);
assert(ad.company_id === "company-1", "ad company");
assert(ad.campaign_id === "campaign-uuid", "ad campaign FK");
assert(ad.adset_external_id === "set-1", "adset externo");
assert(ad.creative_id === "creative-1", "creative id");
assert(ad.object_type === "VIDEO", "object_type do criativo");
assert(ad.body === "Corpo do anuncio", "legenda do criativo");
assert(ad.title === "Titulo do anuncio", "titulo do criativo");
assert(ad.call_to_action_type === "CONTACT_US", "CTA do criativo");
assert(ad.destination_url === "https://wa.me/5571993451315", "destino WhatsApp do criativo");
assert(ad.image_url === "https://cdn/img.jpg", "image_url do criativo");
assert(ad.thumbnail_url === "https://cdn/thumb.jpg", "thumbnail do criativo");
assert(ad.preview_url === "https://fb.me/preview", "preview do anuncio");

const dinamico = mapPipeboardAd(
  {
    id: "ad-dyn",
    name: "Dinamico",
    campaign_id: "cmp-1",
    adset_id: "set-1",
    effective_status: "ACTIVE",
    creative: {
      id: "creative-dyn",
      object_type: "SHARE",
      object_story_spec: { page_id: "105656372312257" },
      asset_feed_spec: {
        bodies: [{ text: "Legenda digitada no Gerenciador" }, { text: "Legenda digitada no Gerenciador" }],
        titles: [{ text: "Titulo do feed" }],
        link_urls: [{ website_url: "https://wa.me/5571993451315" }],
        call_to_action_types: ["CONTACT_US"],
      },
    },
  },
  "company-1",
  "1622612945584817",
  new Map([["cmp-1", "campaign-uuid"]]),
);
assert(dinamico.body === "Legenda digitada no Gerenciador", "body sai de asset_feed_spec.bodies");
assert(dinamico.title === "Titulo do feed", "title sai de asset_feed_spec.titles");

console.log("ok: _prova_pipeboard_structure");
