-- ESPELHO DE MIGRACAO APLICADA
-- version: 20260721221253
-- name: add_ads_and_adsets_tables_and_ingest
-- projeto: gzjwnjdpxpbmdhcyefvs (Gestor de Trafego IA)
-- aplicada por: Claude via MCP apply_migration
-- espelho gerado a partir de supabase_migrations.schema_migrations - NAO transcrito a mao

-- ============ TABELA: ad_sets (conjuntos de anúncio) ============
create table if not exists public.ad_sets (
  id uuid primary key default gen_random_uuid(),
  company_id uuid references public.companies(id) on delete cascade,
  provider public.integration_provider not null default 'meta_ads',
  account_id text,
  campaign_id uuid references public.campaigns(id) on delete set null,
  external_id text not null,                 -- Meta adset_id
  name text,
  status text,
  daily_budget numeric,
  lifetime_budget numeric,
  bid_strategy text,
  targeting jsonb,                            -- adset_targeting spec (público)
  spend numeric default 0,
  impressions bigint default 0,
  reach bigint default 0,
  clicks bigint default 0,
  link_clicks bigint default 0,
  landing_page_views bigint default 0,
  messaging_started bigint default 0,
  form_leads bigint default 0,
  leads bigint default 0,
  sales bigint default 0,
  revenue numeric default 0,
  last_synced_at timestamptz default now(),
  created_at timestamptz not null default now()
);
create unique index if not exists uq_adsets_provider_external on public.ad_sets (provider, external_id);
alter table public.ad_sets enable row level security;
create policy "ad_sets_select" on public.ad_sets for select using (public.is_company_member(company_id, auth.uid()));
create policy "ad_sets_admin_all" on public.ad_sets for all using (public.has_role(auth.uid(),'admin')) with check (public.has_role(auth.uid(),'admin'));

-- ============ TABELA: ads (anúncios/criativos) ============
create table if not exists public.ads (
  id uuid primary key default gen_random_uuid(),
  company_id uuid references public.companies(id) on delete cascade,
  provider public.integration_provider not null default 'meta_ads',
  account_id text,
  campaign_id uuid references public.campaigns(id) on delete set null,
  adset_external_id text,                     -- link p/ ad_sets.external_id
  external_id text not null,                  -- Meta ad_id
  name text,
  creative_id text,
  status text,
  object_type text,
  call_to_action_type text,
  title text,
  body text,
  thumbnail_url text,
  image_url text,
  preview_url text,
  permalink_url text,
  spend numeric default 0,
  impressions bigint default 0,
  reach bigint default 0,
  clicks bigint default 0,
  link_clicks bigint default 0,
  landing_page_views bigint default 0,
  messaging_started bigint default 0,
  form_leads bigint default 0,
  leads bigint default 0,
  sales bigint default 0,
  revenue numeric default 0,
  last_synced_at timestamptz default now(),
  created_at timestamptz not null default now()
);
create unique index if not exists uq_ads_provider_external on public.ads (provider, external_id);
create index if not exists ix_ads_company on public.ads (company_id);
create index if not exists ix_ads_adset on public.ads (adset_external_id);
alter table public.ads enable row level security;
create policy "ads_select" on public.ads for select using (public.is_company_member(company_id, auth.uid()));
create policy "ads_admin_all" on public.ads for all using (public.has_role(auth.uid(),'admin')) with check (public.has_role(auth.uid(),'admin'));

-- ============ INGESTÃO: sync_ingest_adsets(jsonb) ============
create or replace function public.sync_ingest_adsets(p jsonb)
returns integer language plpgsql security definer set search_path = public as $$
declare n int;
begin
  with rows as (
    select * from jsonb_to_recordset(p) as r(
      account_id text, campaign_external_id text, adset_external_id text,
      name text, status text, daily_budget numeric, lifetime_budget numeric,
      bid_strategy text, targeting jsonb,
      spend numeric, impressions bigint, reach bigint, clicks bigint, link_clicks bigint,
      landing_page_views bigint, messaging_started bigint, form_leads bigint, sales bigint, revenue numeric
    )
  ),
  mapped as (
    select r.*, i.company_id, c.id as campaign_uuid
    from rows r
    left join public.integrations i on i.external_id = r.account_id and i.provider='meta_ads'
    left join public.campaigns c   on c.external_id = r.campaign_external_id and c.provider='meta_ads'
    where r.adset_external_id is not null
  ),
  up as (
    insert into public.ad_sets (
      company_id, provider, account_id, campaign_id, external_id, name, status,
      daily_budget, lifetime_budget, bid_strategy, targeting,
      spend, impressions, reach, clicks, link_clicks, landing_page_views,
      messaging_started, form_leads, leads, sales, revenue, last_synced_at)
    select
      company_id, 'meta_ads', account_id, campaign_uuid, adset_external_id, name, status,
      daily_budget, lifetime_budget, bid_strategy, targeting,
      coalesce(spend,0), coalesce(impressions,0), coalesce(reach,0), coalesce(clicks,0),
      coalesce(link_clicks,0), coalesce(landing_page_views,0),
      coalesce(messaging_started,0), coalesce(form_leads,0),
      coalesce(messaging_started,0)+coalesce(form_leads,0),
      coalesce(sales,0), coalesce(revenue,0), now()
    from mapped
    on conflict (provider, external_id) do update set
      company_id=excluded.company_id, account_id=excluded.account_id, campaign_id=excluded.campaign_id,
      name=excluded.name, status=excluded.status, daily_budget=excluded.daily_budget,
      lifetime_budget=excluded.lifetime_budget, bid_strategy=excluded.bid_strategy, targeting=excluded.targeting,
      spend=excluded.spend, impressions=excluded.impressions, reach=excluded.reach, clicks=excluded.clicks,
      link_clicks=excluded.link_clicks, landing_page_views=excluded.landing_page_views,
      messaging_started=excluded.messaging_started, form_leads=excluded.form_leads, leads=excluded.leads,
      sales=excluded.sales, revenue=excluded.revenue, last_synced_at=now()
    returning 1)
  select count(*) into n from up; return n;
end $$;
grant execute on function public.sync_ingest_adsets(jsonb) to service_role;

-- ============ INGESTÃO: sync_ingest_ads(jsonb) ============
create or replace function public.sync_ingest_ads(p jsonb)
returns integer language plpgsql security definer set search_path = public as $$
declare n int;
begin
  with rows as (
    select * from jsonb_to_recordset(p) as r(
      account_id text, campaign_external_id text, adset_external_id text, ad_external_id text,
      name text, creative_id text, thumbnail_url text, image_url text, title text, body text,
      call_to_action_type text, object_type text, status text, permalink_url text, preview_url text,
      spend numeric, impressions bigint, reach bigint, clicks bigint, link_clicks bigint,
      landing_page_views bigint, messaging_started bigint, form_leads bigint, sales bigint, revenue numeric
    )
  ),
  mapped as (
    select r.*, i.company_id, c.id as campaign_uuid
    from rows r
    left join public.integrations i on i.external_id = r.account_id and i.provider='meta_ads'
    left join public.campaigns c   on c.external_id = r.campaign_external_id and c.provider='meta_ads'
    where r.ad_external_id is not null
  ),
  up as (
    insert into public.ads (
      company_id, provider, account_id, campaign_id, adset_external_id, external_id,
      name, creative_id, thumbnail_url, image_url, title, body, call_to_action_type, object_type,
      status, permalink_url, preview_url,
      spend, impressions, reach, clicks, link_clicks, landing_page_views, messaging_started, form_leads,
      leads, sales, revenue, last_synced_at)
    select
      company_id, 'meta_ads', account_id, campaign_uuid, adset_external_id, ad_external_id,
      name, creative_id, thumbnail_url, image_url, title, body, call_to_action_type, object_type,
      status, permalink_url, preview_url,
      coalesce(spend,0), coalesce(impressions,0), coalesce(reach,0), coalesce(clicks,0),
      coalesce(link_clicks,0), coalesce(landing_page_views,0), coalesce(messaging_started,0), coalesce(form_leads,0),
      coalesce(messaging_started,0)+coalesce(form_leads,0), coalesce(sales,0), coalesce(revenue,0), now()
    from mapped
    on conflict (provider, external_id) do update set
      company_id=excluded.company_id, account_id=excluded.account_id, campaign_id=excluded.campaign_id,
      adset_external_id=excluded.adset_external_id, name=excluded.name, creative_id=excluded.creative_id,
      thumbnail_url=excluded.thumbnail_url, image_url=excluded.image_url, title=excluded.title, body=excluded.body,
      call_to_action_type=excluded.call_to_action_type, object_type=excluded.object_type, status=excluded.status,
      permalink_url=excluded.permalink_url, preview_url=excluded.preview_url,
      spend=excluded.spend, impressions=excluded.impressions, reach=excluded.reach, clicks=excluded.clicks,
      link_clicks=excluded.link_clicks, landing_page_views=excluded.landing_page_views,
      messaging_started=excluded.messaging_started, form_leads=excluded.form_leads, leads=excluded.leads,
      sales=excluded.sales, revenue=excluded.revenue, last_synced_at=now()
    returning 1)
  select count(*) into n from up; return n;
end $$;
grant execute on function public.sync_ingest_ads(jsonb) to service_role;