-- ESPELHO DE MIGRACAO APLICADA
-- version: 20260721145311
-- name: update_sync_ingest_windsor_granular
-- projeto: gzjwnjdpxpbmdhcyefvs (Gestor de Trafego IA)
-- aplicada por: Claude via MCP apply_migration
-- espelho gerado a partir de supabase_migrations.schema_migrations - NAO transcrito a mao

create or replace function public.sync_ingest_windsor(p_rows jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_campaigns int := 0;
  v_snaps int := 0;
  v_ids uuid[];
begin
  if p_rows is null or jsonb_typeof(p_rows) <> 'array' or jsonb_array_length(p_rows) = 0 then
    return jsonb_build_object('campaigns_touched',0,'snapshots_upserted',0,'affected_campaigns',0,'note','no rows');
  end if;

  -- 1) campanhas (identidade + objetivo)
  with src as (
    select distinct
      (r->>'company_id')::uuid                              as company_id,
      (r->>'provider')::integration_provider               as provider,
      r->>'campaign_id'                                    as external_id,
      r->>'account_id'                                     as external_account_id,
      coalesce(nullif(r->>'campaign_name',''),'(sem nome)') as name,
      nullif(r->>'objective','')                           as objective
    from jsonb_array_elements(p_rows) r
    where coalesce(r->>'campaign_id','') <> ''
  ),
  up as (
    insert into public.campaigns
      (company_id, provider, name, status, daily_budget,
       spend, impressions, reach, clicks, leads, sales, revenue, frequency,
       link_clicks, landing_page_views, messaging_started, form_leads,
       objective, external_id, external_account_id, last_synced_at)
    select company_id, provider, name, 'active', 0,
           0,0,0,0,0,0,0,0,
           0,0,0,0,
           objective, external_id, external_account_id, now()
    from src
    on conflict (provider, external_id) do update
      set name                = excluded.name,
          external_account_id = excluded.external_account_id,
          objective           = coalesce(excluded.objective, public.campaigns.objective),
          last_synced_at      = now()
    returning id
  )
  select count(*) into v_campaigns from up;

  -- 2) snapshots com sinais granulares; leads = conversas + formulário
  with snap as (
    select
      (r->>'company_id')::uuid                       as company_id,
      c.id                                           as campaign_id,
      (r->>'provider')::integration_provider         as provider,
      (r->>'date')::date                             as snapshot_date,
      coalesce((r->>'spend')::numeric,0)             as spend,
      coalesce((r->>'impressions')::bigint,0)        as impressions,
      coalesce((r->>'reach')::bigint,0)              as reach,
      coalesce((r->>'clicks')::bigint,0)             as clicks,
      coalesce((r->>'link_clicks')::bigint,0)        as link_clicks,
      coalesce((r->>'landing_page_views')::bigint,0) as landing_page_views,
      coalesce((r->>'messaging_started')::bigint,0)  as messaging_started,
      coalesce((r->>'form_leads')::bigint,0)         as form_leads,
      coalesce((r->>'sales')::bigint,0)              as sales,
      coalesce((r->>'revenue')::numeric,0)           as revenue,
      coalesce((r->>'frequency')::numeric,0)         as frequency,
      coalesce(nullif(r->>'source',''),'windsor')    as source
    from jsonb_array_elements(p_rows) r
    join public.campaigns c
      on c.provider    = (r->>'provider')::integration_provider
     and c.external_id = r->>'campaign_id'
    where coalesce(r->>'date','') <> ''
  ),
  ins as (
    insert into public.metric_snapshots
      (company_id, campaign_id, provider, snapshot_date,
       spend, impressions, reach, clicks, leads, sales, revenue, frequency,
       link_clicks, landing_page_views, messaging_started, form_leads, source)
    select company_id, campaign_id, provider, snapshot_date,
           spend, impressions, reach, clicks,
           (messaging_started + form_leads),
           sales, revenue, frequency,
           link_clicks, landing_page_views, messaging_started, form_leads, source
    from snap
    on conflict (campaign_id, snapshot_date) do update
      set spend               = excluded.spend,
          impressions         = excluded.impressions,
          reach               = excluded.reach,
          clicks              = excluded.clicks,
          leads               = excluded.leads,
          sales               = excluded.sales,
          revenue             = excluded.revenue,
          frequency           = excluded.frequency,
          link_clicks         = excluded.link_clicks,
          landing_page_views  = excluded.landing_page_views,
          messaging_started   = excluded.messaging_started,
          form_leads          = excluded.form_leads,
          source              = excluded.source
    returning campaign_id
  )
  select count(*), array_agg(distinct campaign_id) into v_snaps, v_ids from ins;

  -- 3) recomputa agregados + categoria a partir de TODOS os snapshots
  if v_ids is not null then
    update public.campaigns c
    set spend               = agg.spend,
        impressions         = agg.impressions,
        reach               = agg.reach,
        clicks              = agg.clicks,
        leads               = agg.leads,
        sales               = agg.sales,
        revenue             = agg.revenue,
        link_clicks         = agg.link_clicks,
        landing_page_views  = agg.landing_page_views,
        messaging_started   = agg.messaging_started,
        form_leads          = agg.form_leads,
        frequency           = case when agg.reach > 0 then round(agg.impressions::numeric / agg.reach, 4) else 0 end,
        category            = public.classify_campaign(c.objective, agg.messaging_started, agg.form_leads, agg.sales, agg.link_clicks),
        last_synced_at      = now()
    from (
      select campaign_id,
             coalesce(sum(spend),0)              as spend,
             coalesce(sum(impressions),0)        as impressions,
             coalesce(sum(reach),0)              as reach,
             coalesce(sum(clicks),0)             as clicks,
             coalesce(sum(leads),0)              as leads,
             coalesce(sum(sales),0)              as sales,
             coalesce(sum(revenue),0)            as revenue,
             coalesce(sum(link_clicks),0)        as link_clicks,
             coalesce(sum(landing_page_views),0) as landing_page_views,
             coalesce(sum(messaging_started),0)  as messaging_started,
             coalesce(sum(form_leads),0)         as form_leads
      from public.metric_snapshots
      where campaign_id = any(v_ids)
      group by campaign_id
    ) agg
    where c.id = agg.campaign_id;
  end if;

  return jsonb_build_object(
    'campaigns_touched',   v_campaigns,
    'snapshots_upserted',  v_snaps,
    'affected_campaigns',  coalesce(array_length(v_ids,1),0)
  );
end;
$$;

revoke all on function public.sync_ingest_windsor(jsonb) from public, anon, authenticated;
grant execute on function public.sync_ingest_windsor(jsonb) to service_role;