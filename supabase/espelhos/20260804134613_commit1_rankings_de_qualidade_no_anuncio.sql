-- ESPELHO DE MIGRACAO APLICADA
-- version: 20260804134613
-- name: commit1_rankings_de_qualidade_no_anuncio
-- projeto: gzjwnjdpxpbmdhcyefvs (Gestor de Trafego IA)
-- aplicada por: Claude via MCP apply_migration
-- espelho gerado a partir de supabase_migrations.schema_migrations - NAO transcrito a mao

-- 04/08/2026 - COMMIT 1 (parte de banco): rankings de qualidade da Meta no nivel de anuncio.
-- Rota A confirmada pelo Claude Code com dado real: o Windsor entrega os tres campos no
-- catalogo facebook, sem recusa - diferente do que aconteceu com url_tags.
-- ARMADILHA ATIVA, NAO TEORICA: nos tres anuncios em entrega (1.470 a 2.600 impressoes/dia)
-- os tres rankings voltam UNKNOWN, porque a Meta so calcula com volume muito maior.
-- POR ISSO A COLUNA NAO TEM DEFAULT E NAO SE COALESCE PARA NADA: null significa NAO COLETADO,
-- 'UNKNOWN' significa COLETADO E SEM VOLUME PARA JULGAR. Confundir os dois destroi a unica
-- informacao util que o campo tem hoje.

ALTER TABLE public.ad_metric_snapshots
  ADD COLUMN IF NOT EXISTS quality_ranking         text,
  ADD COLUMN IF NOT EXISTS engagement_rate_ranking text,
  ADD COLUMN IF NOT EXISTS conversion_rate_ranking text;

COMMENT ON COLUMN public.ad_metric_snapshots.quality_ranking IS
  'Ranking de qualidade da Meta. Valores: ABOVE_AVERAGE, AVERAGE, BELOW_AVERAGE_10/20/35, UNKNOWN. NULL = nao coletado; UNKNOWN = coletado, sem volume de impressoes para a Meta julgar. Nao trate UNKNOWN como qualidade ruim.';

-- RPC estendida. Mantido tudo que existia; acrescentados os 3 campos no recordset, no insert
-- e no do-update (sem eles no do-update, uma releitura do dia perderia o ranking).
CREATE OR REPLACE FUNCTION public.sync_ingest_ad_snapshots(p jsonb)
 RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
declare n int;
begin
  with rows as (
    select * from jsonb_to_recordset(p) as r(
      account_id text, campaign_external_id text, ad_external_id text, snapshot_date date,
      spend numeric, impressions bigint, reach bigint, clicks bigint, link_clicks bigint,
      landing_page_views bigint, messaging_started bigint, form_leads bigint, frequency numeric,
      quality_ranking text, engagement_rate_ranking text, conversion_rate_ranking text
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
      messaging_started, form_leads, leads, frequency,
      quality_ranking, engagement_rate_ranking, conversion_rate_ranking)
    select
      company_id, ad_external_id, campaign_external_id, account_id, snapshot_date,
      coalesce(spend,0), coalesce(impressions,0), coalesce(reach,0), coalesce(clicks,0),
      coalesce(link_clicks,0), coalesce(landing_page_views,0),
      coalesce(messaging_started,0), coalesce(form_leads,0),
      coalesce(messaging_started,0)+coalesce(form_leads,0), coalesce(frequency,0),
      -- SEM coalesce de proposito: preserva a diferenca entre nao coletado e UNKNOWN.
      nullif(trim(quality_ranking),''), nullif(trim(engagement_rate_ranking),''), nullif(trim(conversion_rate_ranking),'')
    from mapped
    on conflict (ad_external_id, snapshot_date) do update set
      company_id=excluded.company_id, campaign_external_id=excluded.campaign_external_id,
      account_id=excluded.account_id,
      spend=excluded.spend, impressions=excluded.impressions, reach=excluded.reach, clicks=excluded.clicks,
      link_clicks=excluded.link_clicks, landing_page_views=excluded.landing_page_views,
      messaging_started=excluded.messaging_started, form_leads=excluded.form_leads,
      leads=excluded.leads, frequency=excluded.frequency,
      -- coalesce(excluded, atual): releitura que NAO trouxe ranking nao apaga o que ja havia.
      quality_ranking=coalesce(excluded.quality_ranking, ad_metric_snapshots.quality_ranking),
      engagement_rate_ranking=coalesce(excluded.engagement_rate_ranking, ad_metric_snapshots.engagement_rate_ranking),
      conversion_rate_ranking=coalesce(excluded.conversion_rate_ranking, ad_metric_snapshots.conversion_rate_ranking)
    returning 1)
  select count(*) into n from up; return n;
end $function$;