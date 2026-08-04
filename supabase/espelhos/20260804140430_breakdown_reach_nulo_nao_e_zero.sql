-- ESPELHO DE MIGRACAO APLICADA
-- version: 20260804140430
-- name: breakdown_reach_nulo_nao_e_zero
-- projeto: gzjwnjdpxpbmdhcyefvs (Gestor de Trafego IA)
-- aplicada por: Claude via MCP apply_migration
-- espelho gerado a partir de supabase_migrations.schema_migrations - NAO transcrito a mao

-- 04/08/2026 - reach no recorte: NULL significa NAO COLETADO, nunca zero.
-- O Code deixou reach fora da coleta de recorte de proposito (nao soma, por ser gente
-- deduplicada). Mas a coluna tinha NOT NULL DEFAULT 0, o que transformaria "nao coletei" em
-- "alcance zero" - numero falso com cara de medido, mesma familia do default ACTIVE que virou
-- verde falso no espelho hoje. Se um dia o reach por faixa for coletado, o valor entra; enquanto
-- nao for, fica NULL e quem le sabe que nao sabe.
ALTER TABLE public.metric_breakdown_daily ALTER COLUMN reach DROP DEFAULT;
ALTER TABLE public.metric_breakdown_daily ALTER COLUMN reach DROP NOT NULL;

COMMENT ON COLUMN public.metric_breakdown_daily.reach IS
  'Alcance da faixa. NULL = nao coletado. NAO SOMA para o total da campanha: e gente deduplicada e a mesma pessoa aparece em mais de um balde (medido 04/08: 2.938 na soma contra 2.967 no total, -1,0%). Impressoes, gasto, cliques e formularios FECHAM exato.';

-- A RPC ja passa reach direto (coalesce(reach,0) era o unico ponto que forcava zero) - corrigido.
CREATE OR REPLACE FUNCTION public.sync_ingest_breakdown(p jsonb)
 RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
declare n int;
begin
  with rows as (
    select * from jsonb_to_recordset(p) as r(
      account_id text, campaign_external_id text, ad_external_id text, snapshot_date date,
      tipo_recorte text, valor_recorte text,
      spend numeric, impressions bigint, reach bigint, clicks bigint, link_clicks bigint,
      landing_page_views bigint, form_leads bigint
    )
  ),
  mapped as (
    select r.*, i.company_id,
           coalesce(nullif(trim(r.valor_recorte),''),'desconhecido') as valor_norm
      from rows r
      left join public.integrations i on i.external_id = r.account_id and i.provider='meta_ads'
     where r.ad_external_id is not null and r.snapshot_date is not null
       and r.tipo_recorte in ('idade','genero','plataforma','posicionamento')
  ),
  up as (
    insert into public.metric_breakdown_daily (
      company_id, account_id, campaign_external_id, ad_external_id, snapshot_date,
      tipo_recorte, valor_recorte,
      spend, impressions, reach, clicks, link_clicks, landing_page_views, form_leads, leads)
    select company_id, account_id, campaign_external_id, ad_external_id, snapshot_date,
      tipo_recorte, valor_norm,
      coalesce(spend,0), coalesce(impressions,0),
      reach,                                              -- sem coalesce: NULL = nao coletado
      coalesce(clicks,0), coalesce(link_clicks,0), coalesce(landing_page_views,0),
      coalesce(form_leads,0), coalesce(form_leads,0)
    from mapped
    on conflict (ad_external_id, snapshot_date, tipo_recorte, valor_recorte) do update set
      company_id=excluded.company_id, account_id=excluded.account_id,
      campaign_external_id=excluded.campaign_external_id,
      spend=excluded.spend, impressions=excluded.impressions,
      reach=coalesce(excluded.reach, metric_breakdown_daily.reach),
      clicks=excluded.clicks, link_clicks=excluded.link_clicks,
      landing_page_views=excluded.landing_page_views, form_leads=excluded.form_leads,
      leads=excluded.leads
    returning 1)
  select count(*) into n from up; return n;
end $function$;