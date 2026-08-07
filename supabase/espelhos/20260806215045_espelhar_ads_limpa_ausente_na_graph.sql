-- ESPELHO DE MIGRACAO APLICADA
-- version: 20260806215045
-- name: espelhar_ads_limpa_ausente_na_graph
-- projeto: gzjwnjdpxpbmdhcyefvs (Gestor de Trafego IA)
-- aplicada por: Claude via MCP apply_migration
-- espelho gerado a partir de supabase_migrations.schema_migrations - NAO transcrito a mao

create or replace function public.espelhar_ads_da_graph(p jsonb)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  inseridos int := 0;
  atualizados int := 0;
begin
  if p is null or jsonb_typeof(p) <> 'array' then
    raise exception 'espelhar_ads_da_graph: p tem de ser um array jsonb, veio %', coalesce(jsonb_typeof(p), 'null');
  end if;

  with entrada as (
    select * from jsonb_to_recordset(p) as r(
      account_id text,
      ad_external_id text,
      name text,
      status text,
      adset_external_id text,
      campaign_external_id text,
      creative_id text
    )
  ),
  unica as (
    select distinct on (ad_external_id) *
    from entrada
    where ad_external_id is not null and ad_external_id <> ''
    order by ad_external_id
  ),
  mapeada as (
    select u.*, i.company_id, c.id as campaign_uuid
    from unica u
    left join public.integrations i
      on i.external_id = u.account_id and i.provider = 'meta_ads'
    left join public.campaigns c
      on c.external_id = u.campaign_external_id and c.provider = 'meta_ads'
  ),
  com_metrica as (
    select m.*, s.spend, s.impressions, s.reach, s.clicks, s.link_clicks,
           s.landing_page_views, s.messaging_started, s.form_leads
    from mapeada m
    left join lateral (
      select coalesce(sum(a.spend),0) as spend,
             coalesce(sum(a.impressions),0) as impressions,
             coalesce(sum(a.reach),0) as reach,
             coalesce(sum(a.clicks),0) as clicks,
             coalesce(sum(a.link_clicks),0) as link_clicks,
             coalesce(sum(a.landing_page_views),0) as landing_page_views,
             coalesce(sum(a.messaging_started),0) as messaging_started,
             coalesce(sum(a.form_leads),0) as form_leads
      from public.ad_metric_snapshots a
      where a.ad_external_id = m.ad_external_id
    ) s on true
  ),
  gravada as (
    insert into public.ads (
      company_id, provider, account_id, campaign_id, adset_external_id, external_id,
      name, creative_id, status,
      spend, impressions, reach, clicks, link_clicks, landing_page_views,
      messaging_started, form_leads, leads, last_synced_at, ausente_na_graph_em
    )
    select
      company_id, 'meta_ads', account_id, campaign_uuid, adset_external_id, ad_external_id,
      name, creative_id, status,
      spend, impressions, reach, clicks, link_clicks, landing_page_views,
      messaging_started, form_leads,
      coalesce(messaging_started,0) + coalesce(form_leads,0),
      now(), null
    from com_metrica
    on conflict (provider, external_id) do update set
      company_id        = coalesce(excluded.company_id, ads.company_id),
      account_id        = coalesce(excluded.account_id, ads.account_id),
      campaign_id       = coalesce(excluded.campaign_id, ads.campaign_id),
      adset_external_id = coalesce(excluded.adset_external_id, ads.adset_external_id),
      name              = coalesce(excluded.name, ads.name),
      creative_id       = coalesce(excluded.creative_id, ads.creative_id),
      status            = coalesce(excluded.status, ads.status),
      last_synced_at    = now(),
      ausente_na_graph_em = null
    returning (xmax = 0) as inserido
  )
  select count(*) filter (where inserido), count(*) filter (where not inserido)
    into inseridos, atualizados
  from gravada;

  return jsonb_build_object('inseridos', inseridos, 'atualizados', atualizados);
end
$function$;

comment on function public.espelhar_ads_da_graph(jsonb) is
  'Espelha a lista de anuncios vinda da Graph em public.ads. Insere anuncio ausente (metrica derivada da soma de ad_metric_snapshots, nunca inventada), atualiza objeto de anuncio existente sem tocar em metrica, url_tags ou destino_url, limpa ausente_na_graph_em quando o id volta, e sempre avanca last_synced_at. Chamada pela edge meta-campaign-status.';