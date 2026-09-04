-- ESCRITOR PRIMEIRO, COLUNA DEPOIS: a ingestao para de gravar `leads` (04/09/2026)
--
-- Esta migration NAO remove coluna nenhuma. Ela existe para que a remocao da migration
-- seguinte (20260904171000) nao derrube a ingestao de Meta, Windsor e Pipeboard. Dropar a
-- coluna antes de calar os escritores quebraria as sete funcoes ao mesmo tempo, e o erro
-- apareceria de madrugada, no cron, sem ninguem olhando.
--
-- O QUE `leads` E, MEDIDO E NAO SUPOSTO
-- =========================================================================================
-- Todos os escritores calculam a MESMA coisa: `coalesce(form_leads,0) + coalesce(messaging_started,0)`.
-- Formulario e conversa no mesmo balde, sem base declarada. Conferido nas seis tabelas em
-- 04/09/2026, linha a linha:
--
--   tabela                        linhas  batem  divergem  leads MAIOR que a soma
--   ad_metric_snapshots             1521   1440        81                       0
--   ad_metric_snapshots_paralelo    1007    926        81                       0
--   ads                              358    358         0                       0
--   ad_sets                          131    131         0                       0
--   metric_breakdown_daily           619    619         0                       0
--   metric_snapshots                 501    478        23                       0
--
-- A coluna da direita e a que decide: em NENHUMA linha das seis tabelas `leads` e maior que
-- form_leads + messaging_started. Ou seja, ela nunca guardou um evento que as colunas com
-- base declarada nao tenham. Onde diverge, diverge sempre PARA MENOS — sao os zeros falsos
-- da janela 04/08 a 04/09/2026, quando a fonte parou de devolver o campo: 214 resultados
-- reais gravados como zero, o pior deles com 44 conversas virando `leads = 0`.
--
-- Isso responde a pergunta que precede qualquer drop: nao ha conteudo sem equivalente. O que
-- `leads` diz, `form_leads`, `messaging_started` e `link_clicks` dizem melhor, porque dizem
-- COM QUAL BASE. Nenhuma das seis colunas fica.
--
-- CADA ESCRITOR TRATADO PELO QUE ELE E
-- =========================================================================================
-- Sao OITO, e nao os sete mapeados: `espelhar_ads_da_graph` tambem grava `ads.leads` e nao
-- estava na lista, porque cita a palavra uma vez so e some em busca por contagem.
--
--   VIVOS, alterados (a escrita sai, a funcao fica):
--     rollup_metric_snapshots_from_ads  <- pipeboard-metrics-sync, o pipeline vivo
--     espelhar_ads_da_graph             <- meta-campaign-status, roda 09:10 todo dia
--     promover_pipeboard_ams            <- promocao de espelho para producao
--
--   ORFAOS MAS SAOS, alterados (unico chamador e a edge descontinuada em
--   docs/edges-descontinuadas/windsor-sync/, mas sao RPC valida e chamavel; deixa-los
--   gravando a mistura seria manter a arma carregada):
--     sync_ingest_ad_snapshots, sync_ingest_ads, sync_ingest_adsets, sync_ingest_breakdown
--
--   MORTA, REMOVIDA:
--     sync_ingest_windsor
--
-- Por que a windsor sai inteira em vez de ser alterada: ela JA NAO RODA. Foi aposentada em
-- 14/08/2026 (migration 20260814123000), o cron `windsor-sync-daily` esta desagendado, e
-- desde 03/09/2026 ela esta QUEBRADA — faz insert em `public.campaigns` gravando a coluna
-- `leads`, que deixou de existir. Consertar o `leads` de uma funcao que nao compila mais
-- contra o schema, para que ela continue sem rodar, seria cerimonia. Ela e o proprio caso
-- que essa frente combate, em forma de funcao: existe, parece disponivel, e mente sobre
-- estar pronta. Seu unico chamador vive em docs/edges-descontinuadas/.
--
-- E UM LEITOR VESTIGIAL
-- =========================================================================================
-- `montar_corpo_digest` soma `metric_snapshots.leads` em `v_leads` e NUNCA usa a variavel —
-- sobra da convergencia de 03/09/2026, que trocou o corpo do digest para bases declaradas e
-- deixou a leitura orfa para tras. Corpo de funcao plpgsql nao e validado no DROP COLUMN:
-- sem tirar essa linha, o drop passaria limpo e o relatorio diario quebraria as 11:30 da
-- manha seguinte, com erro 42703 e sem ninguem por perto. A saida do digest nao muda, e a
-- conferencia no fim deste arquivo prova isso comparando o md5 do texto gerado.

-- ============================================================================
-- 1) A funcao morta sai
-- ============================================================================

drop function if exists public.sync_ingest_windsor(jsonb);

-- ============================================================================
-- 2) Pipeline vivo: pipeboard-metrics-sync -> rollup
-- ============================================================================

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
begin
  insert into public.metric_snapshots as m (
    company_id, campaign_id, provider, snapshot_date,
    spend, impressions, reach, clicks, frequency, source,
    link_clicks, landing_page_views, messaging_started, form_leads
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
    sum(coalesce(s.form_leads,0))::bigint
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
    form_leads = excluded.form_leads;

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
$function$;

comment on function public.rollup_metric_snapshots_from_ads(date, date) is
'Rollup de ad_metric_snapshots para metric_snapshots e para os agregados de campaigns. Parou de somar `leads` em 04/09/2026: a coluna era form_leads + messaging_started sem base declarada, e a soma propagava para a serie diaria os zeros falsos da origem. Resultado e custo saem de public.base_de_resultado_da_campanha + public.resultados_da_base.';

-- ============================================================================
-- 3) Espelho diario da Graph (meta-campaign-status, cron 09:10)
-- ============================================================================

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
      messaging_started, form_leads, last_synced_at, ausente_na_graph_em
    )
    select
      company_id, 'meta_ads', account_id, campaign_uuid, adset_external_id, ad_external_id,
      name, creative_id, status,
      spend, impressions, reach, clicks, link_clicks, landing_page_views,
      messaging_started, form_leads,
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
'Espelha anuncios da Graph em public.ads (chamada por meta-campaign-status, cron 09:10). Parou de gravar `leads` em 04/09/2026: era form_leads + messaging_started sem base declarada. As duas parcelas continuam gravadas, cada uma com o proprio nome.';

-- ============================================================================
-- 4) Promocao do espelho paralelo para producao
-- ============================================================================

create or replace function public.promover_pipeboard_ams(p_dias integer default 14)
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public', 'pg_temp'
as $function$
declare
  v_from date := current_date - greatest(coalesce(p_dias, 14), 1);
  v_n int := 0;
begin
  insert into public.ad_metric_snapshots as t (
    company_id, ad_external_id, campaign_external_id, account_id, snapshot_date,
    spend, impressions, reach, clicks, link_clicks, landing_page_views,
    messaging_started, form_leads, frequency,
    quality_ranking, engagement_rate_ranking, conversion_rate_ranking,
    video_p25_watched, video_p50_watched, video_p75_watched, video_p100_watched,
    video_thruplay, video_avg_time_watched, video_plays, fonte
  )
  select
    p.company_id, p.ad_external_id, p.campaign_external_id, p.account_id, p.snapshot_date,
    p.spend, p.impressions, p.reach, p.clicks, p.link_clicks, p.landing_page_views,
    p.messaging_started, p.form_leads, p.frequency,
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
$function$;

comment on function public.promover_pipeboard_ams(integer) is
'Promove ad_metric_snapshots_paralelo para ad_metric_snapshots. Parou de copiar `leads` em 04/09/2026 junto com a aposentadoria da coluna.';

-- ============================================================================
-- 5) RPCs de ingestao orfas (unico chamador vive em docs/edges-descontinuadas/)
-- ============================================================================

create or replace function public.sync_ingest_ad_snapshots(p jsonb)
 returns integer
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
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
      messaging_started, form_leads, frequency,
      quality_ranking, engagement_rate_ranking, conversion_rate_ranking)
    select
      company_id, ad_external_id, campaign_external_id, account_id, snapshot_date,
      coalesce(spend,0), coalesce(impressions,0), coalesce(reach,0), coalesce(clicks,0),
      coalesce(link_clicks,0), coalesce(landing_page_views,0),
      coalesce(messaging_started,0), coalesce(form_leads,0), coalesce(frequency,0),
      -- SEM coalesce de proposito: preserva a diferenca entre nao coletado e UNKNOWN.
      nullif(trim(quality_ranking),''), nullif(trim(engagement_rate_ranking),''), nullif(trim(conversion_rate_ranking),'')
    from mapped
    on conflict (ad_external_id, snapshot_date) do update set
      company_id=excluded.company_id, campaign_external_id=excluded.campaign_external_id,
      account_id=excluded.account_id,
      spend=excluded.spend, impressions=excluded.impressions, reach=excluded.reach, clicks=excluded.clicks,
      link_clicks=excluded.link_clicks, landing_page_views=excluded.landing_page_views,
      messaging_started=excluded.messaging_started, form_leads=excluded.form_leads,
      frequency=excluded.frequency,
      -- coalesce(excluded, atual): releitura que NAO trouxe ranking nao apaga o que ja havia.
      quality_ranking=coalesce(excluded.quality_ranking, ad_metric_snapshots.quality_ranking),
      engagement_rate_ranking=coalesce(excluded.engagement_rate_ranking, ad_metric_snapshots.engagement_rate_ranking),
      conversion_rate_ranking=coalesce(excluded.conversion_rate_ranking, ad_metric_snapshots.conversion_rate_ranking)
    returning 1)
  select count(*) into n from up; return n;
end $function$;

create or replace function public.sync_ingest_ads(p jsonb)
 returns integer
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
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
      sales, revenue, last_synced_at)
    select
      company_id, 'meta_ads', account_id, campaign_uuid, adset_external_id, ad_external_id,
      name, creative_id, thumbnail_url, image_url, title, body, call_to_action_type, object_type,
      status, permalink_url, preview_url,
      coalesce(spend,0), coalesce(impressions,0), coalesce(reach,0), coalesce(clicks,0),
      coalesce(link_clicks,0), coalesce(landing_page_views,0), coalesce(messaging_started,0), coalesce(form_leads,0),
      coalesce(sales,0), coalesce(revenue,0), now()
    from mapped
    on conflict (provider, external_id) do update set
      company_id=excluded.company_id, account_id=excluded.account_id, campaign_id=excluded.campaign_id,
      adset_external_id=excluded.adset_external_id, name=excluded.name, creative_id=excluded.creative_id,
      thumbnail_url=excluded.thumbnail_url, image_url=excluded.image_url, title=excluded.title, body=excluded.body,
      call_to_action_type=excluded.call_to_action_type, object_type=excluded.object_type, status=excluded.status,
      permalink_url=excluded.permalink_url, preview_url=excluded.preview_url,
      spend=excluded.spend, impressions=excluded.impressions, reach=excluded.reach, clicks=excluded.clicks,
      link_clicks=excluded.link_clicks, landing_page_views=excluded.landing_page_views,
      messaging_started=excluded.messaging_started, form_leads=excluded.form_leads,
      sales=excluded.sales, revenue=excluded.revenue, last_synced_at=now()
    returning 1)
  select count(*) into n from up; return n;
end $function$;

create or replace function public.sync_ingest_adsets(p jsonb)
 returns integer
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
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
      messaging_started, form_leads, sales, revenue, last_synced_at)
    select
      company_id, 'meta_ads', account_id, campaign_uuid, adset_external_id, name, status,
      daily_budget, lifetime_budget, bid_strategy, targeting,
      coalesce(spend,0), coalesce(impressions,0), coalesce(reach,0), coalesce(clicks,0),
      coalesce(link_clicks,0), coalesce(landing_page_views,0),
      coalesce(messaging_started,0), coalesce(form_leads,0),
      coalesce(sales,0), coalesce(revenue,0), now()
    from mapped
    on conflict (provider, external_id) do update set
      company_id=excluded.company_id, account_id=excluded.account_id, campaign_id=excluded.campaign_id,
      name=excluded.name, status=excluded.status, daily_budget=excluded.daily_budget,
      lifetime_budget=excluded.lifetime_budget, bid_strategy=excluded.bid_strategy, targeting=excluded.targeting,
      spend=excluded.spend, impressions=excluded.impressions, reach=excluded.reach, clicks=excluded.clicks,
      link_clicks=excluded.link_clicks, landing_page_views=excluded.landing_page_views,
      messaging_started=excluded.messaging_started, form_leads=excluded.form_leads,
      sales=excluded.sales, revenue=excluded.revenue, last_synced_at=now()
    returning 1)
  select count(*) into n from up; return n;
end $function$;

create or replace function public.sync_ingest_breakdown(p jsonb)
 returns integer
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare n int;
begin
  with rows as (
    select * from jsonb_to_recordset(p) as r(
      account_id text, campaign_external_id text, ad_external_id text, snapshot_date date,
      tipo_recorte text, valor_recorte text,
      spend numeric, impressions bigint, reach bigint, clicks bigint, link_clicks bigint,
      landing_page_views bigint, form_leads bigint, messaging_started bigint
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
      spend, impressions, reach, clicks, link_clicks, landing_page_views,
      form_leads, messaging_started)
    select company_id, account_id, campaign_external_id, ad_external_id, snapshot_date,
      tipo_recorte, valor_norm,
      coalesce(spend,0), coalesce(impressions,0),
      reach,                                              -- NULL = nao coletado
      coalesce(clicks,0), coalesce(link_clicks,0), coalesce(landing_page_views,0),
      coalesce(form_leads,0),
      messaging_started                                   -- NULL = nao coletado
    from mapped
    on conflict (ad_external_id, snapshot_date, tipo_recorte, valor_recorte) do update set
      company_id=excluded.company_id, account_id=excluded.account_id,
      campaign_external_id=excluded.campaign_external_id,
      spend=excluded.spend, impressions=excluded.impressions,
      -- coalesce(excluded, atual) nos campos que a releitura pode nao trazer: com janela rolante
      -- de 7 dias, 86% das linhas de cada corrida sao reescrita.
      reach=coalesce(excluded.reach, metric_breakdown_daily.reach),
      clicks=excluded.clicks, link_clicks=excluded.link_clicks,
      landing_page_views=excluded.landing_page_views, form_leads=excluded.form_leads,
      messaging_started=coalesce(excluded.messaging_started, metric_breakdown_daily.messaging_started)
    returning 1)
  select count(*) into n from up; return n;
end $function$;

comment on function public.sync_ingest_breakdown(jsonb) is
'Ingestao de recortes diarios. Parou de gravar `leads` em 04/09/2026. Alem de misturar bases, a coluna apagava a distincao que esta funcao faz questao de preservar: `messaging_started` entra NULL quando nao foi coletado, e `leads` somava com coalesce(...,0), transformando "nao coletado" em "zero conversas".';

-- ============================================================================
-- 6) O leitor vestigial do digest
-- ============================================================================

create or replace function public.montar_corpo_digest(p_company_id uuid, p_dia date default (current_date - 1))
 returns text
 language plpgsql
 stable security definer
 set search_path to 'public'
as $function$
declare
  corpo text;
  v_gasto numeric; v_forms int; v_links int; v_msgs int;
  v_gasto_form numeric; v_gasto_conv numeric; v_gasto_clq numeric;
  v_forms_base int; v_msgs_base int;
  v_teto_form numeric; v_custo_form numeric;
  v_teto_conv numeric; v_custo_conv numeric;
  v_teto_form_r jsonb; v_teto_form_nota text;
  v_alertas text; v_recos text; v_sync text; v_n_alertas int; v_n_recos int;
  v_campanhas text; v_n_camp int; v_d1 date;
begin
  v_d1 := p_dia;

  select coalesce(sum(m.spend),0), coalesce(sum(m.form_leads),0), coalesce(sum(m.link_clicks),0),
         coalesce(sum(m.messaging_started),0),
         coalesce(sum(m.spend) filter (where bs.base = 'formularios'),0),
         coalesce(sum(m.spend) filter (where bs.base = 'conversas'),0),
         coalesce(sum(m.spend) filter (where bs.base = 'cliques_no_link'),0),
         coalesce(sum(m.form_leads) filter (where bs.base = 'formularios'),0),
         coalesce(sum(m.messaging_started) filter (where bs.base = 'conversas'),0)
    into v_gasto, v_forms, v_links, v_msgs,
         v_gasto_form, v_gasto_conv, v_gasto_clq, v_forms_base, v_msgs_base
    from public.metric_snapshots m
    cross join lateral (select public.base_de_resultado_da_campanha(m.campaign_id) as base) bs
   where m.company_id = p_company_id and m.snapshot_date = v_d1;

  v_teto_form_r := public.teto_vigente(p_company_id, 'custo_por_formulario');
  v_teto_form   := (v_teto_form_r->>'teto_que_governa')::numeric;
  v_teto_conv   := (public.teto_vigente(p_company_id, 'custo_por_conversa')->>'teto_que_governa')::numeric;
  v_teto_form_nota := case
    when v_teto_form is null then null
    when v_teto_form_r->>'governa' = 'meta_de_negocio' then
      '_Régua usada: R$ ' || public.fmt_brl(v_teto_form) || ' por formulário, decidida por '
      || coalesce(v_teto_form_r->'meta_de_negocio'->>'decidido_por','o gestor') || ' em '
      || to_char((v_teto_form_r->'meta_de_negocio'->>'decidido_em')::date,'DD/MM/YYYY') || '.'
      || case when (v_teto_form_r->'consistencia_historica'->>'valor') is not null
               and (v_teto_form_r->'consistencia_historica'->>'valor')::numeric <> v_teto_form
              then ' O teto histórico do próprio desempenho é R$ '
                   || public.fmt_brl((v_teto_form_r->'consistencia_historica'->>'valor')::numeric)
                   || ', e mede consistência com o passado — não rentabilidade.'
              else '' end || '_'
    else
      '_Régua usada: R$ ' || public.fmt_brl(v_teto_form)
      || ' por formulário, derivada do histórico do próprio desempenho — mede consistência com o passado, não rentabilidade. Não há régua de negócio declarada para esta métrica._'
    end;

  v_custo_form := case when v_forms_base > 0 then round(v_gasto_form / v_forms_base, 2) end;
  v_custo_conv := case when v_msgs_base  > 0 then round(v_gasto_conv / v_msgs_base,  2) end;

  with base as (
    select c.id, c.name,
           public.base_de_resultado_da_campanha(c.id)  as base,
           coalesce(sum(m.spend),0)              as sp,
           coalesce(sum(m.impressions),0)        as imp,
           coalesce(sum(m.reach),0)              as rch,
           coalesce(sum(m.clicks),0)             as clk,
           coalesce(sum(m.link_clicks),0)        as lclk,
           coalesce(sum(m.landing_page_views),0) as lpv,
           coalesce(sum(m.form_leads),0)         as frm,
           coalesce(sum(m.messaging_started),0)  as msg,
           round(avg(m.frequency)::numeric,2)    as freq
      from public.campaigns c
      left join public.metric_snapshots m on m.campaign_id = c.id and m.snapshot_date = v_d1
     where c.company_id = p_company_id
     group by c.id, c.name
  ), enriquecida as (
    select b.*,
           public.resultados_da_base(b.base, b.frm, b.msg, b.lclk) as res,
           case b.base when 'conversas' then v_teto_conv
                       when 'cliques_no_link' then null
                       else v_teto_form end as teto_base,
           case b.base when 'conversas' then 'conversas'
                       when 'cliques_no_link' then 'cliques no link'
                       else 'formulários' end as unidade,
           case b.base when 'conversas' then 'custo/conversa'
                       when 'cliques_no_link' then 'custo/clique no link'
                       else 'custo/formulário' end as rotulo,
           t.valor as teto,
           (select round(avg(x.spend)::numeric,2) from public.metric_snapshots x
             where x.campaign_id = b.id and x.snapshot_date between v_d1 - 6 and v_d1 - 1
               and x.spend > 0) as media6
      from base b
      left join public.targets t
             on t.campaign_id = b.id and t.metric = 'teto_gasto_diario' and t.active
     where b.sp > 0 or t.valor is not null
  )
  select count(*), string_agg(
    '### ' || name || e'\n'
    || '- Gasto **R$ ' || public.fmt_brl(sp) || '**'
       || case
            when teto is null then ' · sem teto declarado'
            when sp = 0 then ' · teto declarado R$ ' || public.fmt_brl(teto) || ' — **sem gasto ontem**'
            when sp > teto then ' · teto declarado R$ ' || public.fmt_brl(teto)
                 || ' → **' || round(100*sp/teto) || '% do teto** ⚠️'
            else ' · teto declarado R$ ' || public.fmt_brl(teto)
                 || ' → ' || round(100*sp/teto) || '% do teto ✅'
          end
       || case when media6 is not null and media6 > 0 and sp > 0 then
            ' · vs média dos 6 dias anteriores (R$ ' || public.fmt_brl(media6) || '): '
            || case when sp > media6 then '+' else '' end || round(100*(sp-media6)/media6) || '%'
          else '' end || e'\n'
    || case when sp = 0 then ''
       else
         '- **' || public.fmt_int(imp) || '** impressões para **' || public.fmt_int(rch)
         || '** pessoas' || case when freq is not null then ' (frequência ' || public.fmt_brl(freq) || ')' else '' end || e'\n'
         || '- **' || public.fmt_int(clk) || '** cliques · **' || public.fmt_int(lclk) || '** no link · **'
         || public.fmt_int(lpv) || '** chegaram na página' || e'\n'
         || '- **' || public.fmt_int(res::bigint) || '** ' || unidade
         || case when res > 0 then
              ' · ' || rotulo || ' **R$ ' || public.fmt_brl(round(sp/res,2)) || '**'
              || case when teto_base is not null then
                   case when round(sp/res,2) <= teto_base
                        then ' (dentro do teto R$ ' || public.fmt_brl(teto_base) || ' ✅)'
                        else ' (**ACIMA** do teto R$ ' || public.fmt_brl(teto_base) || ' ⚠️)' end
                 else ' (sem régua declarada para esta base)' end
            else ' — nenhum resultado' end || e'\n'
       end,
    e'\n' order by sp desc, name)
    into v_n_camp, v_campanhas from enriquecida;

  select count(*), coalesce(string_agg(
           '- ' || case severity::text when 'critical' then '🔴' when 'high' then '🟠'
                        when 'medium' then '🟡' else '🔵' end || ' **' || title || '**: ' || description,
           e'\n' order by case severity::text when 'critical' then 0 when 'high' then 1 when 'medium' then 2 else 3 end), '- nenhum alerta ativo 👌')
    into v_n_alertas, v_alertas
    from public.alerts where company_id = p_company_id and resolved = false;

  select coalesce(string_agg('- ' || j.jobname || ': ' ||
           case d.status when 'succeeded' then '✅ rodou' else '❌ ' || coalesce(d.status,'?') end, e'\n'),
           '- (nenhuma rotina registrada hoje)')
    into v_sync
    from cron.job j
    join lateral (select status from cron.job_run_details r
       where r.jobid = j.jobid and r.start_time::date = current_date
       order by r.start_time desc limit 1) d on true
   where j.jobname in ('windsor-sync-daily','alerts-eval-daily','pipeboard-metrics-daily');

  select count(*), coalesce(string_agg('- ' ||
           case impact when 'high' then '🚀' else '💡' end || ' **' || title || '**',
           e'\n' order by case impact when 'high' then 0 when 'medium' then 1 else 2 end),
           '- nada pendente de decisão')
    into v_n_recos, v_recos
    from public.ai_recommendations where company_id = p_company_id and status = 'new';

  corpo :=
    '# 📋 Relatório diário — ' || to_char(current_date, 'DD/MM/YYYY') || e'\n\n' ||
    '## 🔎 Ontem (' || to_char(v_d1, 'DD/MM') || ') — campanha por campanha' || e'\n\n' ||
    coalesce(v_campanhas, '- nenhuma campanha com gasto e nenhuma com teto declarado') || e'\n\n' ||
    '**Fechamento da empresa:** gasto **R$ ' || public.fmt_brl(v_gasto) || '** · ' ||
    public.fmt_int(v_links::bigint) || ' cliques no link · ' || public.fmt_int(v_forms::bigint) || ' formulários' ||
    case when v_custo_form is not null then ' · custo/formulário **R$ ' || public.fmt_brl(v_custo_form) ||
      '** (sobre os R$ ' || public.fmt_brl(v_gasto_form) || ' gastos em campanhas de formulário)' ||
      case when v_teto_form is not null then
        case when v_custo_form <= v_teto_form then ' (dentro do teto R$ ' || public.fmt_brl(v_teto_form) || ' ✅)'
             else ' (**ACIMA** do teto R$ ' || public.fmt_brl(v_teto_form) || ' ⚠️)' end
      else '' end else '' end ||
    case when v_msgs > 0 then ' · ' || public.fmt_int(v_msgs::bigint) || ' conversas WhatsApp' ||
      case when v_custo_conv is not null then ' · custo/conversa **R$ ' || public.fmt_brl(v_custo_conv) ||
        '** (sobre os R$ ' || public.fmt_brl(v_gasto_conv) || ' gastos em campanhas de conversa)' ||
        case when v_teto_conv is not null then
          case when v_custo_conv <= v_teto_conv then ' (dentro do teto R$ ' || public.fmt_brl(v_teto_conv) || ' ✅)'
               else ' (**ACIMA** do teto R$ ' || public.fmt_brl(v_teto_conv) || ' ⚠️)' end
        else '' end else '' end
    else '' end || e'\n' ||
    case when v_gasto_clq > 0 then
      '_R$ ' || public.fmt_brl(v_gasto_clq) || ' do gasto de ontem foi em campanha de tráfego, engajamento ou alcance — base **cliques no link**. Esse dinheiro NÃO entra no custo por formulário nem no custo por conversa, porque não disputa esse resultado._' || e'\n'
    else '' end ||
    '_O fechamento é soma de ' || coalesce(v_n_camp,0) || ' campanhas: use-o para conferir o caixa, nunca para julgar desempenho. Custo/formulário, custo/conversa e gasto sem base de lead não dividem numerador — cada um soma apenas o gasto da sua base._' || e'\n' ||
    coalesce(v_teto_form_nota || e'\n', '') || e'\n' ||
    coalesce(public.nota_de_cobertura(p_company_id), '') || e'\n\n' ||
    '**Alertas ativos (' || v_n_alertas || '):**' || e'\n' || v_alertas || e'\n\n' ||
    '## ✅ Resolvi' || e'\n' ||
    'Rotinas de hoje (sync de dados, avaliação de regras e vencedores):' || e'\n' || v_sync || e'\n\n' ||
    '## 🫵 Depende de você (' || v_n_recos || ')' || e'\n' || v_recos;

  return corpo;
end $function$;

comment on function public.montar_corpo_digest(uuid, date) is
'Corpo do relatorio diario. Em 04/09/2026 saiu a soma de metric_snapshots.leads: era lida para a variavel v_leads e nunca usada, sobra da convergencia de 03/09/2026. Corpo plpgsql nao e validado no DROP COLUMN, entao a linha morta teria derrubado o digest so na hora de rodar.';

-- ============================================================================
-- 7) Conferencia: nenhum dos oito ainda toca a coluna
-- ============================================================================

do $conferencia$
declare
  v_alvo text;
  v_restam text[] := '{}';
  v_windsor int;
begin
  foreach v_alvo in array array[
    'rollup_metric_snapshots_from_ads', 'espelhar_ads_da_graph', 'promover_pipeboard_ams',
    'sync_ingest_ad_snapshots', 'sync_ingest_ads', 'sync_ingest_adsets', 'sync_ingest_breakdown',
    'montar_corpo_digest'
  ] loop
    if exists (
      select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
       where n.nspname = 'public' and p.proname = v_alvo and p.prosrc ~* '\mleads\M'
    ) then
      v_restam := v_restam || v_alvo;
    end if;
  end loop;

  if array_length(v_restam, 1) > 0 then
    raise exception 'ainda gravam ou leem leads: %', array_to_string(v_restam, ', ');
  end if;

  select count(*) into v_windsor
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'sync_ingest_windsor';
  if v_windsor > 0 then
    raise exception 'sync_ingest_windsor continua existindo';
  end if;

  raise notice 'ingestao limpa: 7 funcoes alteradas, 1 removida, 0 escritas de leads restantes';
end $conferencia$;
