-- Estado efetivo separado do configurado, gasto de conjunto vindo dos snapshots,
-- dia corrente marcado como parcial, e um pedido de sync por empresa.
-- Espelho: supabase/espelhos/20261003143000_estado_efetivo_metricas_de_conjunto_e_frescor.sql
--
-- status = o que foi configurado no objeto (ACTIVE, PAUSED, DELETED, ARCHIVED).
-- effective_status = o que a Meta aplica, somando os pais (CAMPAIGN_PAUSED, ...).
-- Em ads os dois conceitos estavam na mesma coluna. O valor que so existe como
-- efetivo sai de status e vai para a coluna nova; o configurado desses anúncios
-- fica nulo ate a proxima leitura da Graph, porque hoje ele nao esta no banco.

alter table public.campaigns add column if not exists effective_status text;
alter table public.ad_sets add column if not exists effective_status text;
alter table public.ads add column if not exists effective_status text;

alter table public.ad_metric_snapshots
  add column if not exists adset_external_id text,
  add column if not exists parcial boolean not null default false,
  add column if not exists atualizado_em timestamptz;

alter table public.ad_metric_snapshots_paralelo
  add column if not exists adset_external_id text,
  add column if not exists parcial boolean not null default false,
  add column if not exists atualizado_em timestamptz;

alter table public.metric_snapshots
  add column if not exists parcial boolean not null default false,
  add column if not exists atualizado_em timestamptz;

comment on column public.campaigns.status is
  'Estado configurado no objeto, em maiusculas, como a Meta devolve. Nao e o estado de entrega.';
comment on column public.campaigns.effective_status is
  'Estado que a Meta aplica na campanha (ACTIVE, PAUSED, WITH_ISSUES, ...). E o que a tela mostra.';
comment on column public.ad_sets.status is
  'Estado configurado no conjunto. ACTIVE dentro de campanha pausada continua ACTIVE aqui.';
comment on column public.ad_sets.effective_status is
  'Estado de entrega do conjunto. ACTIVE dentro de campanha pausada e CAMPAIGN_PAUSED.';
comment on column public.ads.status is
  'Estado configurado no anuncio. Valores de pai (CAMPAIGN_PAUSED, ADSET_PAUSED) nao entram aqui.';
comment on column public.ads.effective_status is
  'Estado de entrega do anuncio, somando campanha e conjunto.';
comment on column public.ad_metric_snapshots.adset_external_id is
  'Conjunto do anuncio no dia. O gasto do conjunto e a soma destas linhas; nao ha coleta nova.';
comment on column public.ad_metric_snapshots.parcial is
  'Verdadeiro quando o dia ainda nao fechou na Meta. A tela nao trata esse numero como definitivo.';
comment on column public.ad_sets.spend is
  'Soma do gasto diario do conjunto em ad_metric_snapshots. Atualizada no rollup. Nao vem do sync de estrutura.';

-- O conjunto ja esta no anuncio. A soma nao espera a proxima coleta.
update public.ad_metric_snapshots s
   set adset_external_id = a.adset_external_id
  from public.ads a
 where a.external_id = s.ad_external_id
   and a.company_id = s.company_id
   and s.adset_external_id is null
   and a.adset_external_id is not null;

update public.ad_metric_snapshots_paralelo s
   set adset_external_id = a.adset_external_id
  from public.ads a
 where a.external_id = s.ad_external_id
   and a.company_id = s.company_id
   and s.adset_external_id is null
   and a.adset_external_id is not null;

update public.ad_metric_snapshots
   set parcial = true,
       atualizado_em = coalesce(atualizado_em, now())
 where snapshot_date = (timezone('America/Sao_Paulo', now()))::date;

update public.ad_metric_snapshots_paralelo
   set parcial = true,
       atualizado_em = coalesce(atualizado_em, now())
 where snapshot_date = (timezone('America/Sao_Paulo', now()))::date;

update public.metric_snapshots
   set parcial = true,
       atualizado_em = coalesce(atualizado_em, now())
 where snapshot_date = (timezone('America/Sao_Paulo', now()))::date;

-- Anuncio: o que so a Meta chama de efetivo sai de status.
update public.ads
   set effective_status = upper(status),
       status = null
 where upper(status) in (
   'CAMPAIGN_PAUSED', 'ADSET_PAUSED', 'WITH_ISSUES', 'PENDING_REVIEW',
   'DISAPPROVED', 'PREAPPROVED', 'PENDING_BILLING_INFO', 'IN_PROCESS'
 );

update public.ads
   set status = upper(status)
 where status is not null
   and status <> upper(status);

update public.ad_sets
   set status = upper(status)
 where status is not null
   and status <> upper(status);

update public.campaigns
   set status = upper(status)
 where status is not null
   and status <> upper(status);

alter table public.campaigns drop constraint if exists campaigns_status_meta_check;
alter table public.campaigns drop constraint if exists campaigns_effective_status_meta_check;
alter table public.ad_sets drop constraint if exists ad_sets_status_meta_check;
alter table public.ad_sets drop constraint if exists ad_sets_effective_status_meta_check;
alter table public.ads drop constraint if exists ads_status_meta_check;
alter table public.ads drop constraint if exists ads_effective_status_meta_check;

alter table public.campaigns
  add constraint campaigns_status_meta_check
  check (status is null or status in ('ACTIVE', 'PAUSED', 'DELETED', 'ARCHIVED'));

alter table public.campaigns
  add constraint campaigns_effective_status_meta_check
  check (
    effective_status is null
    or effective_status in ('ACTIVE', 'PAUSED', 'DELETED', 'ARCHIVED', 'IN_PROCESS', 'WITH_ISSUES')
  );

alter table public.ad_sets
  add constraint ad_sets_status_meta_check
  check (status is null or status in ('ACTIVE', 'PAUSED', 'DELETED', 'ARCHIVED'));

alter table public.ad_sets
  add constraint ad_sets_effective_status_meta_check
  check (
    effective_status is null
    or effective_status in (
      'ACTIVE', 'PAUSED', 'DELETED', 'ARCHIVED', 'IN_PROCESS', 'WITH_ISSUES', 'CAMPAIGN_PAUSED'
    )
  );

alter table public.ads
  add constraint ads_status_meta_check
  check (status is null or status in ('ACTIVE', 'PAUSED', 'DELETED', 'ARCHIVED'));

alter table public.ads
  add constraint ads_effective_status_meta_check
  check (
    effective_status is null
    or effective_status in (
      'ACTIVE', 'PAUSED', 'DELETED', 'ARCHIVED', 'IN_PROCESS', 'WITH_ISSUES',
      'CAMPAIGN_PAUSED', 'ADSET_PAUSED', 'PENDING_REVIEW', 'DISAPPROVED',
      'PREAPPROVED', 'PENDING_BILLING_INFO'
    )
  );

-- Quem lia status = 'active' passa a comparar sem depender da caixa.
do $rewrite$
declare
  r record;
  def text;
  novo text;
begin
  for r in
    select p.oid
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public'
       and p.prokind = 'f'
       and pg_get_functiondef(p.oid) ~ 'status[[:space:]]*=[[:space:]]*''active'''
  loop
    def := pg_get_functiondef(r.oid);
    novo := regexp_replace(
      def,
      '([A-Za-z0-9_.]*)status[[:space:]]*=[[:space:]]*''active''',
      'upper(\1status) = ''ACTIVE''',
      'g'
    );
    if novo = def then
      raise exception 'rewrite de status nao alterou %', r.oid::regprocedure;
    end if;
    execute novo;
  end loop;
end
$rewrite$;

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
    a.campaign_id,
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

comment on function public.rollup_metric_snapshots_from_ads(date, date) is
  'Sobe o dia do anuncio para a campanha e preenche o acumulado de conjunto e de anuncio. Dia corrente fica parcial.';

-- A janela reescrita e a mesma do cron (6 dias, com o dia corrente). O acumulado
-- de conjunto soma TODOS os snapshots dentro da funcao, sem regravar o historico
-- antigo de metric_snapshots.
select public.rollup_metric_snapshots_from_ads(
  (timezone('America/Sao_Paulo', now()))::date - 6,
  (timezone('America/Sao_Paulo', now()))::date
);

create or replace view public.v_campaign_breakdown
with (security_invoker = true) as
select
  c.company_id,
  co.name as empresa,
  c.external_account_id as account_id,
  i.account_name,
  c.id as campaign_id,
  c.name as campanha,
  c.objective,
  c.category as tipo,
  c.status,
  c.spend,
  c.impressions,
  c.reach,
  c.frequency,
  c.clicks,
  c.link_clicks,
  c.landing_page_views,
  c.messaging_started,
  c.form_leads,
  c.sales,
  c.revenue,
  b.base as base_de_resultado,
  rotulo_da_base(b.base) as rotulo_do_custo,
  unidade_da_base(b.base) as unidade_do_resultado,
  resultados_da_base(b.base, c.form_leads::numeric, c.messaging_started::numeric, c.link_clicks::numeric) as resultados,
  custo_por_resultado(c.spend, c.form_leads::numeric, c.messaging_started::numeric, b.base, c.link_clicks::numeric) as custo_por_resultado,
  case when c.link_clicks > 0 then c.spend / c.link_clicks::numeric else null::numeric end as cpc_link,
  c.last_synced_at,
  c.effective_status,
  c.ausente_na_graph_em
from campaigns c
cross join lateral (select base_de_resultado_da_campanha(c.id) as base) b
left join companies co on co.id = c.company_id
left join integrations i
  on i.provider = 'meta_ads'::integration_provider
 and i.external_id = c.external_account_id;

create or replace function public.gravar_estado_efetivo(p_tabela text, p jsonb)
returns integer
language plpgsql
security definer
set search_path to 'public'
as $gravar$
declare
  n integer := 0;
begin
  if p is null or jsonb_typeof(p) <> 'array' then
    raise exception 'gravar_estado_efetivo: p tem de ser um array jsonb';
  end if;
  if p_tabela = 'ad_sets' then
    update public.ad_sets s
       set status = case
             when nullif(upper(e.status), '') in ('ACTIVE', 'PAUSED', 'DELETED', 'ARCHIVED')
               then upper(e.status)
             else s.status
           end,
           effective_status = nullif(upper(e.effective_status), ''),
           last_synced_at = now()
      from jsonb_to_recordset(p) as e(external_id text, status text, effective_status text)
     where s.provider = 'meta_ads'
       and s.external_id = e.external_id
       and e.external_id is not null;
  elsif p_tabela = 'campaigns' then
    update public.campaigns s
       set status = case
             when nullif(upper(e.status), '') in ('ACTIVE', 'PAUSED', 'DELETED', 'ARCHIVED')
               then upper(e.status)
             else s.status
           end,
           effective_status = nullif(upper(e.effective_status), ''),
           last_synced_at = now()
      from jsonb_to_recordset(p) as e(external_id text, status text, effective_status text)
     where s.provider = 'meta_ads'
       and s.external_id = e.external_id
       and e.external_id is not null;
  elsif p_tabela = 'ads' then
    update public.ads s
       set status = case
             when nullif(upper(e.status), '') in ('ACTIVE', 'PAUSED', 'DELETED', 'ARCHIVED')
               then upper(e.status)
             else s.status
           end,
           effective_status = nullif(upper(e.effective_status), ''),
           last_synced_at = now()
      from jsonb_to_recordset(p) as e(external_id text, status text, effective_status text)
     where s.provider = 'meta_ads'
       and s.external_id = e.external_id
       and e.external_id is not null;
  else
    raise exception 'gravar_estado_efetivo: tabela % nao aceita', p_tabela;
  end if;
  get diagnostics n = row_count;
  return n;
end;
$gravar$;

revoke all on function public.gravar_estado_efetivo(text, jsonb) from public, anon, authenticated;
grant execute on function public.gravar_estado_efetivo(text, jsonb) to service_role;

create or replace function public.pedir_sync_da_empresa(p_company_id uuid)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $sync$
declare
  v_contas text[];
  v_chave text;
  v_headers jsonb;
  v_n int := 0;
  v_nivel text;
begin
  if auth.uid() is null then
    raise exception 'sessao ausente';
  end if;
  if not public.is_company_member(p_company_id, auth.uid()) then
    raise exception 'sem acesso a esta empresa';
  end if;

  select coalesce(array_agg(distinct regexp_replace(external_id, '^act_', '')), array[]::text[])
    into v_contas
    from public.integrations
   where company_id = p_company_id
     and provider = 'meta_ads'
     and external_id is not null
     and status is distinct from 'disabled';

  if coalesce(array_length(v_contas, 1), 0) = 0 then
    raise exception 'empresa sem conta Meta vinculada';
  end if;

  v_chave := public.get_mcp_api_key('cron:pipeboard-structure-campaigns-0912');
  if v_chave is null or length(btrim(v_chave)) < 8 then
    raise exception 'credencial de estrutura ausente';
  end if;
  v_headers := jsonb_build_object(
    'Content-Type', 'application/json',
    'Authorization', 'Bearer ' || v_chave
  );

  foreach v_nivel in array array['campaigns', 'adsets', 'ads']
  loop
    perform net.http_post(
      url := public.url_functions() || 'pipeboard-structure-sync',
      headers := v_headers,
      body := jsonb_build_object('level', v_nivel, 'account_ids', to_jsonb(v_contas)),
      timeout_milliseconds := 150000
    );
    v_n := v_n + 1;
  end loop;

  v_chave := public.get_mcp_api_key('cron:pipeboard-metrics-daily');
  if v_chave is null or length(btrim(v_chave)) < 8 then
    raise exception 'credencial de metricas ausente';
  end if;
  v_headers := jsonb_build_object(
    'Content-Type', 'application/json',
    'Authorization', 'Bearer ' || v_chave
  );
  perform net.http_post(
    url := public.url_functions() || 'pipeboard-metrics-sync',
    headers := v_headers,
    body := jsonb_build_object(
      'account_ids', to_jsonb(v_contas),
      'date_from', to_char((timezone('America/Sao_Paulo', now()))::date - 6, 'YYYY-MM-DD'),
      'date_to', to_char((timezone('America/Sao_Paulo', now()))::date, 'YYYY-MM-DD')
    ),
    timeout_milliseconds := 150000
  );
  v_n := v_n + 1;

  return jsonb_build_object(
    'ok', true,
    'pedidos', v_n,
    'contas', array_length(v_contas, 1),
    'pedido_em', now()
  );
end;
$sync$;

revoke all on function public.pedir_sync_da_empresa(uuid) from public, anon;
grant execute on function public.pedir_sync_da_empresa(uuid) to authenticated;

comment on function public.pedir_sync_da_empresa(uuid) is
  'Pede sync de estrutura e de metricas so das contas da empresa. O http_post nao espera a Meta; a tela mostra o carimbo quando o espelho atualizar.';

-- A coleta diaria ja reprocessa 6 dias, inclusive o dia corrente. O que faltava
-- era repetir ao longo do dia: a Meta revisa atribuicao, e um unico passe as 6h
-- congela o numero. A trava de "uma vez por dia" do catalogo e contornada com
-- p_forcar, senao a segunda agenda do mesmo dia seria pulada.
do $cron$
declare r record;
begin
  for r in
    select jobid from cron.job
     where jobname in (
       'pipeboard-structure-campaigns-1540',
       'pipeboard-structure-adsets-1545',
       'pipeboard-structure-ads-1550',
       'pipeboard-metrics-1600',
       'pipeboard-structure-campaigns-2140',
       'pipeboard-structure-adsets-2145',
       'pipeboard-structure-ads-2150',
       'pipeboard-metrics-2200'
     )
  loop
    perform cron.unschedule(r.jobid);
  end loop;
end
$cron$;

select cron.schedule(
  'pipeboard-structure-campaigns-1540',
  '40 15 * * *',
  $cmd$select public.disparar_tarefa_http('estrutura-campanhas', 'cron', true);$cmd$
);
select cron.schedule(
  'pipeboard-structure-adsets-1545',
  '45 15 * * *',
  $cmd$select public.disparar_tarefa_http('estrutura-conjuntos', 'cron', true);$cmd$
);
select cron.schedule(
  'pipeboard-structure-ads-1550',
  '50 15 * * *',
  $cmd$select public.disparar_tarefa_http('estrutura-anuncios', 'cron', true);$cmd$
);
select cron.schedule(
  'pipeboard-metrics-1600',
  '0 16 * * *',
  $cmd$select public.disparar_tarefa_http('metricas-pipeboard', 'cron', true);$cmd$
);
select cron.schedule(
  'pipeboard-structure-campaigns-2140',
  '40 21 * * *',
  $cmd$select public.disparar_tarefa_http('estrutura-campanhas', 'cron', true);$cmd$
);
select cron.schedule(
  'pipeboard-structure-adsets-2145',
  '45 21 * * *',
  $cmd$select public.disparar_tarefa_http('estrutura-conjuntos', 'cron', true);$cmd$
);
select cron.schedule(
  'pipeboard-structure-ads-2150',
  '50 21 * * *',
  $cmd$select public.disparar_tarefa_http('estrutura-anuncios', 'cron', true);$cmd$
);
select cron.schedule(
  'pipeboard-metrics-2200',
  '0 22 * * *',
  $cmd$select public.disparar_tarefa_http('metricas-pipeboard', 'cron', true);$cmd$
);
