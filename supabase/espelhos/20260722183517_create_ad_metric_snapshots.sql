-- ESPELHO DE MIGRACAO APLICADA
-- version: 20260722183517
-- name: create_ad_metric_snapshots
-- projeto: gzjwnjdpxpbmdhcyefvs (Gestor de Trafego IA)
-- aplicada por: Claude via MCP apply_migration
-- espelho gerado a partir de supabase_migrations.schema_migrations - NAO transcrito a mao

-- ============================================================
-- F0.4 — SNAPSHOTS DIÁRIOS POR ANÚNCIO (habilita a regra dos 3 dias)
-- Série diária por ad_id. Alimentada pela edge windsor-sync (nível ad COM date, janela last_7d no cron).
-- ============================================================
create table if not exists public.ad_metric_snapshots (
  id uuid primary key default gen_random_uuid(),
  company_id uuid references public.companies(id) on delete set null,
  ad_external_id text not null,          -- Meta ad_id
  campaign_external_id text,
  account_id text,
  snapshot_date date not null,
  spend numeric default 0,
  impressions bigint default 0,
  reach bigint default 0,
  clicks bigint default 0,
  link_clicks bigint default 0,
  landing_page_views bigint default 0,
  messaging_started bigint default 0,
  form_leads bigint default 0,
  leads bigint default 0,
  frequency numeric default 0,
  created_at timestamptz not null default now()
);
create unique index if not exists uq_ad_snap_ad_date on public.ad_metric_snapshots (ad_external_id, snapshot_date);
create index if not exists ix_ad_snap_company_date on public.ad_metric_snapshots (company_id, snapshot_date);
alter table public.ad_metric_snapshots enable row level security;
create policy "ad_snap_select" on public.ad_metric_snapshots for select using (public.is_company_member(company_id, auth.uid()));
create policy "ad_snap_admin_all" on public.ad_metric_snapshots for all using (public.has_role(auth.uid(),'admin')) with check (public.has_role(auth.uid(),'admin'));

-- Ingestão idempotente (upsert por ad_id+dia). Mapeia account_id -> empresa. leads = conversas + form.
create or replace function public.sync_ingest_ad_snapshots(p jsonb)
returns integer language plpgsql security definer set search_path = public as $$
declare n int;
begin
  with rows as (
    select * from jsonb_to_recordset(p) as r(
      account_id text, campaign_external_id text, ad_external_id text, snapshot_date date,
      spend numeric, impressions bigint, reach bigint, clicks bigint, link_clicks bigint,
      landing_page_views bigint, messaging_started bigint, form_leads bigint, frequency numeric
    )
  ),
  mapped as (
    select r.*, i.company_id
    from rows r
    left join public.integrations i on i.external_id = r.account_id and i.provider='meta_ads'
    where r.ad_external_id is not null and r.snapshot_date is not null
  ),
  up as (
    insert into public.ad_metric_snapshots (
      company_id, ad_external_id, campaign_external_id, account_id, snapshot_date,
      spend, impressions, reach, clicks, link_clicks, landing_page_views,
      messaging_started, form_leads, leads, frequency)
    select
      company_id, ad_external_id, campaign_external_id, account_id, snapshot_date,
      coalesce(spend,0), coalesce(impressions,0), coalesce(reach,0), coalesce(clicks,0),
      coalesce(link_clicks,0), coalesce(landing_page_views,0),
      coalesce(messaging_started,0), coalesce(form_leads,0),
      coalesce(messaging_started,0)+coalesce(form_leads,0), coalesce(frequency,0)
    from mapped
    on conflict (ad_external_id, snapshot_date) do update set
      company_id=excluded.company_id, campaign_external_id=excluded.campaign_external_id,
      account_id=excluded.account_id,
      spend=excluded.spend, impressions=excluded.impressions, reach=excluded.reach, clicks=excluded.clicks,
      link_clicks=excluded.link_clicks, landing_page_views=excluded.landing_page_views,
      messaging_started=excluded.messaging_started, form_leads=excluded.form_leads,
      leads=excluded.leads, frequency=excluded.frequency
    returning 1)
  select count(*) into n from up; return n;
end $$;
grant execute on function public.sync_ingest_ad_snapshots(jsonb) to service_role;