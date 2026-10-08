-- 08/10/2026 - Relatorios da COHAPM (La Felicita e Ocular, campanhas 2026-10) saiam com
-- gasto R$ 0 e zero impressao, com a Meta entregando. A metrica por anuncio estava
-- gravada (ad_metric_snapshots: R$ 143,84 em 06/10, R$ 634,32 em 07/10), mas o rollup
-- para metric_snapshots fazia JOIN obrigatorio com public.ads para achar a campanha.
-- Anuncio que a estrutura ainda nao espelhou (o nivel ads do pipeboard-structure-sync
-- ficou pulando a COHAPM por prazo desde 06/10) tinha o gasto descartado em silencio.
--
-- Agora a campanha vem do anuncio quando ele existe e, se nao existe, do
-- campaign_external_id que a propria linha de metrica traz. Resto identico.
create or replace function public.rollup_metric_snapshots_from_ads(
  p_from date default (current_date - 14),
  p_to date default current_date
)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_n int := 0;
  v_conjuntos int := 0;
  v_anuncios int := 0;
begin
  insert into public.metric_snapshots as m (
    company_id, campaign_id, provider, snapshot_date,
    spend, impressions, reach, clicks, frequency, source,
    link_clicks, landing_page_views, messaging_started, form_leads,
    parcial, atualizado_em
  )
  select
    s.company_id,
    coalesce(a.campaign_id, c.id),
    'meta_ads'::public.integration_provider,
    s.snapshot_date,
    sum(coalesce(s.spend, 0)),
    sum(coalesce(s.impressions, 0))::bigint,
    sum(coalesce(s.reach, 0))::bigint,
    sum(coalesce(s.clicks, 0))::bigint,
    case when sum(coalesce(s.reach, 0)) > 0
         then sum(coalesce(s.impressions, 0))::numeric / sum(coalesce(s.reach, 0))
         else avg(s.frequency) end,
    'pipeboard:meta',
    sum(coalesce(s.link_clicks, 0))::bigint,
    sum(coalesce(s.landing_page_views, 0))::bigint,
    sum(coalesce(s.messaging_started, 0))::bigint,
    sum(coalesce(s.form_leads, 0))::bigint,
    bool_or(coalesce(s.parcial, false))
      or s.snapshot_date = (timezone('America/Sao_Paulo', now()))::date,
    now()
  from public.ad_metric_snapshots s
  left join public.ads a
    on a.external_id = s.ad_external_id
   and a.company_id = s.company_id
  left join public.campaigns c
    on c.external_id = s.campaign_external_id
   and c.company_id = s.company_id
  where s.snapshot_date between p_from and p_to
    and coalesce(a.campaign_id, c.id) is not null
    and coalesce(s.fonte, 'pipeboard:meta') like 'pipeboard%'
  group by s.company_id, coalesce(a.campaign_id, c.id), s.snapshot_date
  on conflict (campaign_id, snapshot_date) do update set
    spend = excluded.spend,
    impressions = excluded.impressions,
    reach = excluded.reach,
    clicks = excluded.clicks,
    frequency = excluded.frequency,
    source = excluded.source,
    link_clicks = excluded.link_clicks,
    landing_page_views = excluded.landing_page_views,
    messaging_started = excluded.messaging_started,
    form_leads = excluded.form_leads,
    parcial = excluded.parcial,
    atualizado_em = excluded.atualizado_em;

  get diagnostics v_n = row_count;

  update public.campaigns c set
    spend = coalesce(x.spend, 0),
    impressions = coalesce(x.impressions, 0),
    reach = coalesce(x.reach, 0),
    clicks = coalesce(x.clicks, 0),
    link_clicks = coalesce(x.link_clicks, 0),
    form_leads = coalesce(x.form_leads, 0),
    messaging_started = coalesce(x.messaging_started, 0),
    landing_page_views = coalesce(x.landing_page_views, 0),
    frequency = x.frequency
  from (
    select campaign_id,
           sum(spend) as spend,
           sum(impressions) as impressions,
           sum(reach) as reach,
           sum(clicks) as clicks,
           sum(link_clicks) as link_clicks,
           sum(form_leads) as form_leads,
           sum(messaging_started) as messaging_started,
           sum(landing_page_views) as landing_page_views,
           case when sum(reach) > 0 then sum(impressions)::numeric / sum(reach) else null end as frequency
    from public.metric_snapshots
    group by campaign_id
  ) x
  where c.id = x.campaign_id;

  update public.ad_sets s set
    spend = coalesce(x.spend, 0),
    impressions = coalesce(x.impressions, 0),
    reach = coalesce(x.reach, 0),
    clicks = coalesce(x.clicks, 0),
    link_clicks = coalesce(x.link_clicks, 0),
    form_leads = coalesce(x.form_leads, 0),
    messaging_started = coalesce(x.messaging_started, 0),
    landing_page_views = coalesce(x.landing_page_views, 0)
  from (
    select company_id, adset_external_id,
           sum(coalesce(spend, 0)) as spend,
           sum(coalesce(impressions, 0))::bigint as impressions,
           sum(coalesce(reach, 0))::bigint as reach,
           sum(coalesce(clicks, 0))::bigint as clicks,
           sum(coalesce(link_clicks, 0))::bigint as link_clicks,
           sum(coalesce(form_leads, 0))::bigint as form_leads,
           sum(coalesce(messaging_started, 0))::bigint as messaging_started,
           sum(coalesce(landing_page_views, 0))::bigint as landing_page_views
      from public.ad_metric_snapshots
     where adset_external_id is not null
     group by company_id, adset_external_id
  ) x
  where s.company_id = x.company_id
    and s.external_id = x.adset_external_id;

  get diagnostics v_conjuntos = row_count;

  update public.ads a set
    spend = coalesce(x.spend, 0),
    impressions = coalesce(x.impressions, 0),
    reach = coalesce(x.reach, 0),
    clicks = coalesce(x.clicks, 0),
    link_clicks = coalesce(x.link_clicks, 0),
    form_leads = coalesce(x.form_leads, 0),
    messaging_started = coalesce(x.messaging_started, 0),
    landing_page_views = coalesce(x.landing_page_views, 0)
  from (
    select company_id, ad_external_id,
           sum(coalesce(spend, 0)) as spend,
           sum(coalesce(impressions, 0))::bigint as impressions,
           sum(coalesce(reach, 0))::bigint as reach,
           sum(coalesce(clicks, 0))::bigint as clicks,
           sum(coalesce(link_clicks, 0))::bigint as link_clicks,
           sum(coalesce(form_leads, 0))::bigint as form_leads,
           sum(coalesce(messaging_started, 0))::bigint as messaging_started,
           sum(coalesce(landing_page_views, 0))::bigint as landing_page_views
      from public.ad_metric_snapshots
     group by company_id, ad_external_id
  ) x
  where a.company_id = x.company_id
    and a.external_id = x.ad_external_id;

  get diagnostics v_anuncios = row_count;

  return jsonb_build_object(
    'ok', true,
    'upserted', v_n,
    'conjuntos', v_conjuntos,
    'anuncios', v_anuncios,
    'de', p_from,
    'ate', p_to
  );
end;
$function$;

-- Recupera o que o JOIN antigo descartou nas ultimas duas semanas.
select public.rollup_metric_snapshots_from_ads(current_date - 14, current_date);
