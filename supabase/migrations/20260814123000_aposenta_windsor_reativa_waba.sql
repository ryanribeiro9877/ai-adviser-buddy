-- Aposentadoria do Windsor como coletor de metricas + reativacao WABA tier.
-- Decisao do gestor 14/08/2026: conexao Windsor encerrada; identidade de coleta = Pipeboard.
-- WABA sync/tier voltam a ser uteis e sao reativados.

-- ---------------------------------------------------------------------------
-- 1) Desativa crons Windsor (reversivel: active=false, edges ficam publicadas)
-- ---------------------------------------------------------------------------
do $$
declare j record;
begin
  for j in
    select jobid, jobname
    from cron.job
    where jobname in (
      'windsor-sync-daily',
      'windsor-wide-ads-weekly',
      'windsor-wide-adsets-weekly'
    )
  loop
    perform cron.alter_job(j.jobid, active := false);
    raise notice 'cron Windsor desativado: %', j.jobname;
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- 2) Reativa crons WABA (sync + qualidade de tier)
-- ---------------------------------------------------------------------------
do $$
declare j record;
begin
  for j in
    select jobid, jobname
    from cron.job
    where jobname in ('waba-sync-daily', 'waba-tier-alerts-0940')
  loop
    perform cron.alter_job(j.jobid, active := true);
    raise notice 'cron WABA reativado: %', j.jobname;
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- 3) Aposenta o segredo Windsor (nao apaga historico; impede nova coleta)
-- ---------------------------------------------------------------------------
update public.integration_secrets
   set name = 'windsor_api_key_APOSENTADO_20260814',
       value = coalesce(nullif(trim(value), ''), 'APOSENTADO')
 where name = 'windsor_api_key';

-- ---------------------------------------------------------------------------
-- 4) Promove paralelo Pipeboard -> AMS producao (janela recente)
-- ---------------------------------------------------------------------------
create or replace function public.promover_pipeboard_ams(p_dias integer default 14)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_from date := current_date - greatest(coalesce(p_dias, 14), 1);
  v_n int := 0;
begin
  insert into public.ad_metric_snapshots as t (
    company_id, ad_external_id, campaign_external_id, account_id, snapshot_date,
    spend, impressions, reach, clicks, link_clicks, landing_page_views,
    messaging_started, form_leads, leads, frequency,
    quality_ranking, engagement_rate_ranking, conversion_rate_ranking,
    video_p25_watched, video_p50_watched, video_p75_watched, video_p100_watched,
    video_thruplay, video_avg_time_watched, video_plays, fonte
  )
  select
    p.company_id, p.ad_external_id, p.campaign_external_id, p.account_id, p.snapshot_date,
    p.spend, p.impressions, p.reach, p.clicks, p.link_clicks, p.landing_page_views,
    p.messaging_started, p.form_leads, p.leads, p.frequency,
    p.quality_ranking, p.engagement_rate_ranking, p.conversion_rate_ranking,
    p.video_p25_watched, p.video_p50_watched, p.video_p75_watched, p.video_p100_watched,
    p.video_thruplay, p.video_avg_time_watched, p.video_plays,
    coalesce(nullif(p.fonte,''), 'pipeboard:meta')
  from public.ad_metric_snapshots_paralelo p
  where p.snapshot_date >= v_from
    and coalesce(p.fonte, 'pipeboard:meta') like 'pipeboard%'
  on conflict (ad_external_id, snapshot_date) do update set
    company_id = excluded.company_id,
    campaign_external_id = excluded.campaign_external_id,
    account_id = excluded.account_id,
    spend = excluded.spend,
    impressions = excluded.impressions,
    reach = excluded.reach,
    clicks = excluded.clicks,
    link_clicks = excluded.link_clicks,
    landing_page_views = excluded.landing_page_views,
    messaging_started = excluded.messaging_started,
    form_leads = excluded.form_leads,
    leads = excluded.leads,
    frequency = excluded.frequency,
    quality_ranking = excluded.quality_ranking,
    engagement_rate_ranking = excluded.engagement_rate_ranking,
    conversion_rate_ranking = excluded.conversion_rate_ranking,
    video_p25_watched = coalesce(excluded.video_p25_watched, t.video_p25_watched),
    video_p50_watched = coalesce(excluded.video_p50_watched, t.video_p50_watched),
    video_p75_watched = coalesce(excluded.video_p75_watched, t.video_p75_watched),
    video_p100_watched = coalesce(excluded.video_p100_watched, t.video_p100_watched),
    video_thruplay = coalesce(excluded.video_thruplay, t.video_thruplay),
    video_avg_time_watched = coalesce(excluded.video_avg_time_watched, t.video_avg_time_watched),
    video_plays = coalesce(excluded.video_plays, t.video_plays),
    fonte = excluded.fonte;

  get diagnostics v_n = row_count;
  return jsonb_build_object('ok', true, 'upserted', v_n, 'desde', v_from);
end;
$$;

revoke all on function public.promover_pipeboard_ams(integer) from public, anon, authenticated;
grant execute on function public.promover_pipeboard_ams(integer) to service_role;

-- ---------------------------------------------------------------------------
-- 5) Rollup ad -> metric_snapshots (campanha) a partir do AMS Pipeboard
-- ---------------------------------------------------------------------------
create or replace function public.rollup_metric_snapshots_from_ads(
  p_from date default (current_date - 14),
  p_to date default current_date
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_n int := 0;
begin
  insert into public.metric_snapshots as m (
    company_id, campaign_id, provider, snapshot_date,
    spend, impressions, reach, clicks, frequency, source,
    link_clicks, landing_page_views, messaging_started, form_leads, leads
  )
  select
    s.company_id,
    a.campaign_id,
    'meta_ads'::public.integration_provider,
    s.snapshot_date,
    sum(coalesce(s.spend,0)),
    sum(coalesce(s.impressions,0))::bigint,
    sum(coalesce(s.reach,0))::bigint,
    sum(coalesce(s.clicks,0))::bigint,
    case when sum(coalesce(s.reach,0)) > 0
         then sum(coalesce(s.impressions,0))::numeric / sum(coalesce(s.reach,0))
         else avg(s.frequency) end,
    'pipeboard:meta',
    sum(coalesce(s.link_clicks,0))::bigint,
    sum(coalesce(s.landing_page_views,0))::bigint,
    sum(coalesce(s.messaging_started,0))::bigint,
    sum(coalesce(s.form_leads,0))::bigint,
    sum(coalesce(s.leads,0))::bigint
  from public.ad_metric_snapshots s
  join public.ads a
    on a.external_id = s.ad_external_id
   and a.company_id = s.company_id
  where s.snapshot_date between p_from and p_to
    and a.campaign_id is not null
    and coalesce(s.fonte, 'pipeboard:meta') like 'pipeboard%'
  group by s.company_id, a.campaign_id, s.snapshot_date
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
    leads = excluded.leads;

  get diagnostics v_n = row_count;

  -- Atualiza agregados de campanha a partir da serie (nao inventa)
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

  return jsonb_build_object('ok', true, 'upserted', v_n, 'de', p_from, 'ate', p_to);
end;
$$;

revoke all on function public.rollup_metric_snapshots_from_ads(date, date) from public, anon, authenticated;
grant execute on function public.rollup_metric_snapshots_from_ads(date, date) to service_role;

-- Bootstrap imediato: promove paralelo recente e faz rollup
select public.promover_pipeboard_ams(21);
select public.rollup_metric_snapshots_from_ads(current_date - 21, current_date);

-- ---------------------------------------------------------------------------
-- 6) Relatorio diario: troca Windsor por Pipeboard na lista monitorada
-- ---------------------------------------------------------------------------
do $$
declare
  v_def text;
  v_new text;
begin
  select pg_get_functiondef('public.post_daily_report()'::regprocedure) into v_def;
  if v_def is null then
    raise notice 'post_daily_report ausente; skip monitor list';
    return;
  end if;
  v_new := replace(v_def, '''windsor-sync-daily''', '''pipeboard-metrics-daily''');
  -- Evita duplicar se ja estiver so com pipeboard
  if v_new = v_def and v_def like '%pipeboard-metrics-daily%' then
    raise notice 'post_daily_report ja aponta pipeboard-metrics-daily';
    return;
  end if;
  if v_new = v_def then
    raise notice 'post_daily_report: windsor-sync-daily nao encontrado (ja sem Windsor ou lista externa); skip';
    return;
  end if;
  execute v_new;
end $$;

-- ---------------------------------------------------------------------------
-- 6b) Detector de video: paralelo -> AMS producao (Pipeboard)
-- ---------------------------------------------------------------------------
do $$
declare
  v_def text;
  v_new text;
begin
  select pg_get_functiondef('public.detectar_sinais_recomendacao(text)'::regprocedure) into v_def;
  if v_def is null then
    raise notice 'detectar_sinais_recomendacao ausente; skip';
    return;
  end if;
  if v_def not like '%ad_metric_snapshots_paralelo%' then
    raise notice 'detector video ja usa AMS producao';
    return;
  end if;
  v_new := replace(v_def, 'ad_metric_snapshots_paralelo', 'ad_metric_snapshots');
  v_new := replace(v_new, 'Fonte: Pipeboard paralelo.', 'Fonte: Pipeboard.');
  execute v_new;
end $$;

-- ---------------------------------------------------------------------------
-- 7) Doutrina
-- ---------------------------------------------------------------------------
insert into public.agent_context (categoria, fato, vigente, desde, company_id)
values (
  'execucao',
  'COLETOR DE METRICAS = PIPEBOARD (14/08/2026). A conexao Windsor foi ENCERRADA por decisao do gestor. As crons windsor-sync-daily / windsor-wide-ads-weekly / windsor-wide-adsets-weekly estao active=false e o segredo windsor_api_key foi aposentado. A identidade oficial de coleta de midia e pipeboard:meta (edge pipeboard-metrics-sync escreve em ad_metric_snapshots de producao + paralelo; rollup_metric_snapshots_from_ads alimenta metric_snapshots). Historico antigo com source windsor:facebook permanece como arquivo — NAO misture como se fosse coleta viva. WABA sync diario e alertas de tier (waba-sync-daily, waba-tier-alerts-0940) foram REATIVADOS nesta mesma data.',
  true,
  current_date,
  null
);

-- Se havia fato de congelamento WABA total, nao apagamos — a reativacao desta data governa as crons.
insert into public.agent_context (categoria, fato, vigente, desde, company_id)
values (
  'execucao',
  'WABA SYNC E TIER REATIVADOS (14/08/2026). As crons waba-sync-daily (09:30 UTC) e waba-tier-alerts-0940 (09:40 UTC) voltaram a active=true. Continuam uteis para qualidade/tier do numero; o congelamento de pos-clique (escopo de conversa/CRM) NAO foi revogado — so a coleta/alerta de tier/qualidade do canal.',
  true,
  current_date,
  null
);
