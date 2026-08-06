-- ESPELHO DE MIGRACAO APLICADA
-- version: 20260721145236
-- name: add_granular_metrics_classification_and_views
-- projeto: gzjwnjdpxpbmdhcyefvs (Gestor de Trafego IA)
-- aplicada por: Claude via MCP apply_migration
-- espelho gerado a partir de supabase_migrations.schema_migrations - NAO transcrito a mao

-- 1) métricas granulares (sinais separados por natureza)
alter table public.metric_snapshots
  add column if not exists link_clicks        bigint not null default 0,
  add column if not exists landing_page_views bigint not null default 0,
  add column if not exists messaging_started  bigint not null default 0,
  add column if not exists form_leads         bigint not null default 0;

alter table public.campaigns
  add column if not exists category           text,
  add column if not exists link_clicks        bigint not null default 0,
  add column if not exists landing_page_views bigint not null default 0,
  add column if not exists messaging_started  bigint not null default 0,
  add column if not exists form_leads         bigint not null default 0;

-- 2) classificador de campanha: objetivo primeiro, sinal como fallback
create or replace function public.classify_campaign(
  p_objective text, p_messaging bigint, p_forms bigint, p_sales bigint, p_link_clicks bigint
) returns text language sql immutable as $$
  select case
    when upper(coalesce(p_objective,'')) like '%LEAD%'                                            then 'leadgen'
    when upper(coalesce(p_objective,'')) like any (array['%SALES%','%CONVERSION%','%CATALOG%'])   then 'vendas'
    when upper(coalesce(p_objective,'')) like any (array['%TRAFFIC%','%LINK_CLICK%'])             then 'trafego'
    when upper(coalesce(p_objective,'')) like '%MESSAGE%'                                         then 'mensagem'
    when upper(coalesce(p_objective,'')) like '%ENGAGEMENT%'
         then case when p_messaging > 0 then 'mensagem' else 'engajamento' end
    when upper(coalesce(p_objective,'')) like any (array['%AWARENESS%','%REACH%'])                then 'alcance'
    when upper(coalesce(p_objective,'')) like '%VIDEO%'                                           then 'video'
    when upper(coalesce(p_objective,'')) like '%APP%'                                             then 'app'
    -- fallback por sinal (objetivo ausente/desconhecido)
    when p_messaging   > 0 then 'mensagem'
    when p_sales       > 0 then 'vendas'
    when p_forms       > 0 then 'leadgen'
    when p_link_clicks > 0 then 'trafego'
    else 'outro'
  end
$$;

-- 3) VISÃO POR CAMPANHA (detalhe completo)
create or replace view public.v_campaign_breakdown
with (security_invoker = true) as
select
  c.company_id, co.name as empresa,
  c.external_account_id as account_id, i.account_name,
  c.id as campaign_id, c.name as campanha, c.objective, c.category as tipo, c.status,
  c.spend, c.impressions, c.reach, c.frequency, c.clicks,
  c.link_clicks, c.landing_page_views, c.messaging_started, c.form_leads,
  c.leads, c.sales, c.revenue,
  case when c.leads > 0        then round(c.spend / c.leads, 2)       end as cpl,
  case when c.link_clicks > 0  then round(c.spend / c.link_clicks, 2) end as cpc_link,
  c.last_synced_at
from public.campaigns c
left join public.companies    co on co.id = c.company_id
left join public.integrations i  on i.provider='meta_ads' and i.external_id = c.external_account_id;

-- 4) VISÃO POR CONTA (tipo dominante por gasto + detalhe agregado)
create or replace view public.v_account_breakdown
with (security_invoker = true) as
with per_cat as (
  select c.external_account_id as account_id, c.category, sum(c.spend) as spend
  from public.campaigns c group by c.external_account_id, c.category
),
dominant as (
  select distinct on (account_id) account_id, category as account_type
  from per_cat order by account_id, spend desc nulls last
),
tot as (
  select c.external_account_id as account_id,
         count(*) campaigns, sum(c.spend) spend, sum(c.clicks) clicks,
         sum(c.link_clicks) link_clicks, sum(c.landing_page_views) landing_page_views,
         sum(c.messaging_started) messaging_started, sum(c.form_leads) form_leads,
         sum(c.leads) leads, sum(c.sales) sales, sum(c.revenue) revenue
  from public.campaigns c group by c.external_account_id
)
select
  i.external_id as account_id, i.account_name, i.company_id,
  coalesce(d.account_type,'sem_dados') as tipo_conta,
  coalesce(t.campaigns,0) campaigns, coalesce(t.spend,0) spend, coalesce(t.clicks,0) clicks,
  coalesce(t.link_clicks,0) link_clicks, coalesce(t.landing_page_views,0) landing_page_views,
  coalesce(t.messaging_started,0) messaging_started, coalesce(t.form_leads,0) form_leads,
  coalesce(t.leads,0) leads, coalesce(t.sales,0) sales, coalesce(t.revenue,0) revenue
from public.integrations i
left join tot      t on t.account_id = i.external_id
left join dominant d on d.account_id = i.external_id
where i.provider='meta_ads';

grant select on public.v_campaign_breakdown, public.v_account_breakdown to authenticated, service_role;