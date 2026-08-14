-- Recomendacoes da IA — canal amplo de transmissao.
-- Schema enriquecido, candidatos SQL, video no snapshot, detectores com gate de 3 dias,
-- gravar_recomendacao, crons 09:25/09:35 + MoM semanal.

create schema if not exists private;
revoke all on schema private from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 1) Colunas de video em ad_metric_snapshots (+ paralelo)
-- ---------------------------------------------------------------------------
alter table public.ad_metric_snapshots
  add column if not exists video_p25_watched bigint,
  add column if not exists video_p50_watched bigint,
  add column if not exists video_p75_watched bigint,
  add column if not exists video_p100_watched bigint,
  add column if not exists video_thruplay bigint,
  add column if not exists video_avg_time_watched numeric,
  add column if not exists video_plays bigint;

alter table public.ad_metric_snapshots_paralelo
  add column if not exists video_p25_watched bigint,
  add column if not exists video_p50_watched bigint,
  add column if not exists video_p75_watched bigint,
  add column if not exists video_p100_watched bigint,
  add column if not exists video_thruplay bigint,
  add column if not exists video_avg_time_watched numeric,
  add column if not exists video_plays bigint;

-- ---------------------------------------------------------------------------
-- 2) Estender ai_recommendations
-- ---------------------------------------------------------------------------
alter table public.ai_recommendations
  add column if not exists signal_key text,
  add column if not exists entity_type text,
  add column if not exists entity_id text,
  add column if not exists entity_name text,
  add column if not exists evidence_json jsonb not null default '{}'::jsonb,
  add column if not exists suggested_prompt text,
  add column if not exists maturity_days integer,
  add column if not exists source text not null default 'legacy',
  add column if not exists dedupe_key text,
  add column if not exists family text;

create unique index if not exists ai_recommendations_dedupe_uidx
  on public.ai_recommendations (company_id, dedupe_key)
  where dedupe_key is not null;

create index if not exists ai_recommendations_status_family_idx
  on public.ai_recommendations (company_id, status, family);

-- ---------------------------------------------------------------------------
-- 3) Candidatos detectados pelo SQL (antes do job LLM / gravacao)
-- ---------------------------------------------------------------------------
create table if not exists public.recommendation_candidates (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  signal_key text not null,
  family text not null,
  entity_type text not null,
  entity_id text not null,
  entity_name text,
  impact text not null default 'medium',
  category text,
  maturity_days integer not null default 0,
  needs_llm boolean not null default false,
  title_draft text not null,
  description_draft text not null,
  suggested_prompt text not null,
  evidence_json jsonb not null default '{}'::jsonb,
  dedupe_key text not null,
  status text not null default 'pending'
    check (status in ('pending','written','rejected','skipped')),
  created_at timestamptz not null default now(),
  processed_at timestamptz,
  reject_reason text
);

create unique index if not exists recommendation_candidates_dedupe_uidx
  on public.recommendation_candidates (company_id, dedupe_key);

create index if not exists recommendation_candidates_pending_idx
  on public.recommendation_candidates (status, created_at)
  where status = 'pending';

alter table public.recommendation_candidates enable row level security;

drop policy if exists reco_cand_members_read on public.recommendation_candidates;
create policy reco_cand_members_read on public.recommendation_candidates
  for select to authenticated
  using (company_id in (select company_id from public.company_members where user_id = auth.uid()));

revoke all on public.recommendation_candidates from anon, authenticated;
grant select on public.recommendation_candidates to authenticated;
grant all on public.recommendation_candidates to service_role;

-- ---------------------------------------------------------------------------
-- 4) Writer unico (service_role / edge)
-- ---------------------------------------------------------------------------
create or replace function public.gravar_recomendacao(
  p_company_id uuid,
  p_title text,
  p_description text,
  p_impact text,
  p_category text,
  p_family text,
  p_signal_key text,
  p_entity_type text,
  p_entity_id text,
  p_entity_name text,
  p_evidence jsonb,
  p_suggested_prompt text,
  p_maturity_days integer,
  p_source text,
  p_dedupe_key text,
  p_candidate_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_id uuid;
  v_ev jsonb := coalesce(p_evidence, '{}'::jsonb);
begin
  if p_company_id is null or coalesce(trim(p_title),'') = '' or coalesce(trim(p_description),'') = '' then
    return jsonb_build_object('ok', false, 'erro', 'titulo_descricao_obrigatorios');
  end if;
  if coalesce(trim(p_dedupe_key),'') = '' then
    return jsonb_build_object('ok', false, 'erro', 'dedupe_key_obrigatorio');
  end if;
  if v_ev = '{}'::jsonb or not (v_ev ? 'fonte') then
    return jsonb_build_object('ok', false, 'erro', 'evidence_json_exige_fonte');
  end if;

  insert into public.ai_recommendations (
    company_id, title, description, impact, category, status,
    signal_key, entity_type, entity_id, entity_name, evidence_json,
    suggested_prompt, maturity_days, source, dedupe_key, family
  ) values (
    p_company_id, left(p_title, 200), p_description,
    coalesce(nullif(p_impact,''),'medium'), p_category, 'new',
    p_signal_key, p_entity_type, p_entity_id, p_entity_name, v_ev,
    p_suggested_prompt, p_maturity_days, coalesce(nullif(p_source,''),'hybrid:reco-job'),
    p_dedupe_key, p_family
  )
  on conflict (company_id, dedupe_key) where dedupe_key is not null
  do update set
    title = excluded.title,
    description = excluded.description,
    impact = excluded.impact,
    category = excluded.category,
    evidence_json = excluded.evidence_json,
    suggested_prompt = excluded.suggested_prompt,
    maturity_days = excluded.maturity_days,
    family = excluded.family,
    signal_key = excluded.signal_key,
    entity_name = excluded.entity_name,
    status = case when ai_recommendations.status = 'new' then 'new' else ai_recommendations.status end
  returning id into v_id;

  if v_id is null then
    select id into v_id from public.ai_recommendations
     where company_id = p_company_id and dedupe_key = p_dedupe_key limit 1;
  end if;

  if p_candidate_id is not null then
    update public.recommendation_candidates
       set status = 'written', processed_at = now()
     where id = p_candidate_id;
  end if;

  return jsonb_build_object('ok', true, 'id', v_id);
end;
$$;

revoke all on function public.gravar_recomendacao(
  uuid, text, text, text, text, text, text, text, text, text, jsonb, text, integer, text, text, uuid
) from public, anon, authenticated;
grant execute on function public.gravar_recomendacao(
  uuid, text, text, text, text, text, text, text, text, text, jsonb, text, integer, text, text, uuid
) to service_role;

-- ---------------------------------------------------------------------------
-- 5) Upsert candidato
-- ---------------------------------------------------------------------------
create or replace function private.upsert_reco_candidate(
  p_company_id uuid,
  p_signal_key text,
  p_family text,
  p_entity_type text,
  p_entity_id text,
  p_entity_name text,
  p_impact text,
  p_category text,
  p_maturity_days bigint,
  p_needs_llm boolean,
  p_title text,
  p_description text,
  p_prompt text,
  p_evidence jsonb,
  p_dedupe_key text
) returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  insert into public.recommendation_candidates (
    company_id, signal_key, family, entity_type, entity_id, entity_name,
    impact, category, maturity_days, needs_llm, title_draft, description_draft,
    suggested_prompt, evidence_json, dedupe_key, status
  ) values (
    p_company_id, p_signal_key, p_family, p_entity_type, p_entity_id, p_entity_name,
    p_impact, p_category, coalesce(p_maturity_days,0)::integer, p_needs_llm, p_title, p_description,
    p_prompt, p_evidence, p_dedupe_key, 'pending'
  )
  on conflict (company_id, dedupe_key) do update set
    title_draft = excluded.title_draft,
    description_draft = excluded.description_draft,
    suggested_prompt = excluded.suggested_prompt,
    evidence_json = excluded.evidence_json,
    impact = excluded.impact,
    maturity_days = excluded.maturity_days,
    needs_llm = excluded.needs_llm,
    entity_name = excluded.entity_name,
    status = case
      when recommendation_candidates.status = 'written' then 'written'
      else 'pending'
    end,
    created_at = case
      when recommendation_candidates.status = 'pending' then now()
      else recommendation_candidates.created_at
    end;
end;
$$;

revoke all on function private.upsert_reco_candidate(uuid,text,text,text,text,text,text,text,bigint,boolean,text,text,text,jsonb,text)
  from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 6) Detector principal (diario)
-- ---------------------------------------------------------------------------
create or replace function public.detectar_sinais_recomendacao(p_modo text default 'diario')
returns jsonb
language plpgsql
security definer
set search_path = public, private, pg_temp
as $$
declare
  v_hoje date := (timezone('America/Sao_Paulo', now()))::date;
  v_dedupe_dia text := to_char(v_hoje, 'YYYYMMDD');
  v_count int := 0;
  r record;
  v_title text;
  v_desc text;
  v_prompt text;
  v_ev jsonb;
  v_dedupe text;
  v_ctr numeric;
  v_ctr_base numeric;
  v_freq numeric;
  v_freq_base numeric;
  v_teto numeric;
  v_custo numeric;
  v_med_thruplay numeric;
  v_med_avg numeric;
begin
  -- ---- A) Fadiga de criativo (ads ativos, >=3 dias com gasto) ----
  for r in
    with dias as (
      select s.company_id, s.ad_external_id, a.name as ad_name, c.name as camp_name, c.category,
             count(*) filter (where s.spend > 0) as dias_entrega,
             max(s.snapshot_date) as ultimo
      from public.ad_metric_snapshots s
      join public.ads a on a.external_id = s.ad_external_id and a.company_id = s.company_id
      join public.campaigns c on c.id = a.campaign_id
      where c.status = 'active'
        and upper(coalesce(a.status,'ACTIVE')) in ('ACTIVE','ADSET_PAUSED_OVERRIDE')
        and s.snapshot_date >= v_hoje - 14
      group by s.company_id, s.ad_external_id, a.name, c.name, c.category
      having count(*) filter (where s.spend > 0) >= 3
    ),
    ultimo as (
      select d.*, s.spend, s.impressions, s.link_clicks, s.frequency,
             (100.0 * s.link_clicks / nullif(s.impressions,0)) as ctr_link
      from dias d
      join public.ad_metric_snapshots s
        on s.company_id = d.company_id and s.ad_external_id = d.ad_external_id
       and s.snapshot_date = d.ultimo
    ),
    base as (
      select u.company_id, u.ad_external_id,
             avg(100.0 * s.link_clicks / nullif(s.impressions,0)) as ctr_base,
             avg(s.frequency) as freq_base
      from ultimo u
      join public.ad_metric_snapshots s
        on s.company_id = u.company_id and s.ad_external_id = u.ad_external_id
       and s.spend > 0
       and s.snapshot_date < u.ultimo and s.snapshot_date >= u.ultimo - 3
      group by u.company_id, u.ad_external_id
      having count(*) >= 2
    )
    select u.*, b.ctr_base, b.freq_base
    from ultimo u
    join base b on b.company_id = u.company_id and b.ad_external_id = u.ad_external_id
    where u.ctr_link is not null and b.ctr_base > 0
      and u.ctr_link <= b.ctr_base * 0.75
      and coalesce(u.frequency,0) >= coalesce(b.freq_base,0) * 1.10
  loop
    v_dedupe := 'fadiga.ctr_freq|' || r.ad_external_id || '|' || v_dedupe_dia;
    v_title := 'Criativo com sinal de fadiga: ' || left(coalesce(r.ad_name, r.ad_external_id), 80);
    v_desc := format(
      'Anuncio "%s" (campanha %s): CTR de link caiu de %s%% (media 3 dias anteriores) para %s%% no ultimo dia, com frequencia de %s para %s. Base = cliques_no_link/impressoes. Maturidade: %s dias de entrega. Avaliar refresh de peca ou troca de angulo. [auto: detector]',
      coalesce(r.ad_name,'?'), coalesce(r.camp_name,'?'),
      to_char(round(r.ctr_base::numeric, 2), 'FM999990.00'),
      to_char(round(r.ctr_link::numeric, 2), 'FM999990.00'),
      to_char(round(coalesce(r.freq_base,0)::numeric, 2), 'FM999990.00'),
      to_char(round(coalesce(r.frequency,0)::numeric, 2), 'FM999990.00'),
      r.dias_entrega
    );
    v_prompt := format(
      'Quero discutir esta recomendacao de fadiga do criativo "%s" (id %s) na campanha "%s". CTR link caiu de %s%% para %s%% e a frequencia subiu. O que voce recomenda: refresh, pausa ou troca de angulo? Use apenas evidencias de midia e declare a base (ctr_link).',
      coalesce(r.ad_name,'?'), r.ad_external_id, coalesce(r.camp_name,'?'),
      to_char(round(r.ctr_base::numeric, 2), 'FM999990.00'),
      to_char(round(r.ctr_link::numeric, 2), 'FM999990.00')
    );
    v_ev := jsonb_build_object(
      'fonte', 'metric_snapshots+ad_metric_snapshots',
      'base_clique', 'link',
      'ctr_link_ultimo', round(r.ctr_link::numeric, 2),
      'ctr_link_base_3d', round(r.ctr_base::numeric, 2),
      'frequencia_ultimo', round(coalesce(r.frequency,0)::numeric, 2),
      'frequencia_base_3d', round(coalesce(r.freq_base,0)::numeric, 2),
      'dias_entrega', r.dias_entrega,
      'janela', jsonb_build_object('ultimo', r.ultimo)
    );
    perform private.upsert_reco_candidate(
      r.company_id, 'fadiga.ctr_freq', 'criativo_fadiga', 'ad', r.ad_external_id, r.ad_name,
      'high', 'criativo', r.dias_entrega, false, v_title, v_desc, v_prompt, v_ev, v_dedupe
    );
    v_count := v_count + 1;
  end loop;

  -- ---- B) Ranking Meta BELOW (qualidade/engajamento) ----
  for r in
    select s.company_id, s.ad_external_id, a.name as ad_name, c.name as camp_name,
           count(*) filter (where s.spend > 0) as dias_entrega,
           max(s.quality_ranking) filter (where s.snapshot_date = (select max(s2.snapshot_date) from public.ad_metric_snapshots s2 where s2.ad_external_id = s.ad_external_id and s2.company_id = s.company_id)) as q_rank,
           max(s.engagement_rate_ranking) filter (where s.snapshot_date = (select max(s2.snapshot_date) from public.ad_metric_snapshots s2 where s2.ad_external_id = s.ad_external_id and s2.company_id = s.company_id)) as e_rank
    from public.ad_metric_snapshots s
    join public.ads a on a.external_id = s.ad_external_id and a.company_id = s.company_id
    join public.campaigns c on c.id = a.campaign_id
    where c.status = 'active'
      and upper(coalesce(a.status,'ACTIVE')) in ('ACTIVE','ADSET_PAUSED_OVERRIDE')
      and s.snapshot_date >= v_hoje - 14
    group by s.company_id, s.ad_external_id, a.name, c.name
    having count(*) filter (where s.spend > 0) >= 3
  loop
    if upper(coalesce(r.q_rank,'')) like '%BELOW%' or upper(coalesce(r.e_rank,'')) like '%BELOW%' then
      v_dedupe := 'ranking.meta_below|' || r.ad_external_id || '|' || v_dedupe_dia;
      v_title := 'Meta classificou abaixo da media: ' || left(coalesce(r.ad_name, r.ad_external_id), 80);
      v_desc := format(
        'Anuncio "%s" (campanha %s): quality_ranking=%s, engagement_rate_ranking=%s. Volume ainda pode ser baixo (UNKNOWN e comum), mas BELOW indica julgamento negativo da Meta. Maturidade: %s dias. [auto: detector]',
        coalesce(r.ad_name,'?'), coalesce(r.camp_name,'?'),
        coalesce(r.q_rank,'n/d'), coalesce(r.e_rank,'n/d'), r.dias_entrega
      );
      v_prompt := format(
        'Quero discutir o ranking da Meta no anuncio "%s" (quality=%s, engagement=%s). O que isso implica para criativo e entrega?',
        coalesce(r.ad_name,'?'), coalesce(r.q_rank,'n/d'), coalesce(r.e_rank,'n/d')
      );
      v_ev := jsonb_build_object(
        'fonte', 'ad_metric_snapshots',
        'quality_ranking', r.q_rank,
        'engagement_rate_ranking', r.e_rank,
        'dias_entrega', r.dias_entrega
      );
      perform private.upsert_reco_candidate(
        r.company_id, 'ranking.meta_below', 'criativo_fadiga', 'ad', r.ad_external_id, r.ad_name,
        'medium', 'criativo', r.dias_entrega, false, v_title, v_desc, v_prompt, v_ev, v_dedupe
      );
      v_count := v_count + 1;
    end if;
  end loop;

  -- ---- C) Custo acima do teto (campanha ativa, >=3 dias) ----
  for r in
    with camp as (
      select c.id, c.company_id, c.name, c.category, c.spend,
             count(distinct ms.snapshot_date) filter (where coalesce(ms.spend,0) > 0) as dias_entrega,
             sum(ms.spend) as spend7,
             sum(case when c.category = 'mensagem' then ms.messaging_started else ms.form_leads end) as results7
      from public.campaigns c
      join public.metric_snapshots ms on ms.campaign_id = c.id and ms.snapshot_date >= v_hoje - 7
      where c.status = 'active'
        and coalesce(c.category,'') in ('leadgen','mensagem','engajamento','trafego')
      group by c.id, c.company_id, c.name, c.category, c.spend
      having count(distinct ms.snapshot_date) filter (where coalesce(ms.spend,0) > 0) >= 3
    )
    select camp.*,
           (t.r->>'teto_que_governa')::numeric as teto,
           case when camp.category = 'mensagem' then 'custo_por_conversa'
                when camp.category = 'leadgen' then 'custo_por_formulario'
                else 'custo_por_lead_lp' end as metrica
    from camp
    cross join lateral (
      select public.teto_vigente(
               camp.company_id,
               case when camp.category = 'mensagem' then 'custo_por_conversa'
                    when camp.category = 'leadgen' then 'custo_por_formulario'
                    else 'custo_por_lead_lp' end
             ) as r
    ) t
    where (t.r->>'teto_que_governa') is not null
      and camp.results7 > 0
      and (camp.spend7 / camp.results7) > (t.r->>'teto_que_governa')::numeric
  loop
    v_custo := round((r.spend7 / r.results7)::numeric, 2);
    v_teto := round(r.teto::numeric, 2);
    v_dedupe := 'custo.acima_teto|' || r.id::text || '|' || v_dedupe_dia;
    v_title := 'Custo acima da regua: ' || left(r.name, 80);
    v_desc := format(
      'Campanha "%s" (%s): custo medio R$ %s vs teto vigente R$ %s (%s) nos ultimos 7 dias (gasto R$ %s / %s resultados). Maturidade: %s dias. Nao e alerta tecnico — e leitura operacional para decidir manter, maturar ou ajustar. [auto: detector]',
      r.name, coalesce(r.category,'?'),
      to_char(v_custo, 'FM999990.00'), to_char(v_teto, 'FM999990.00'),
      r.metrica, to_char(round(r.spend7::numeric,2), 'FM999990.00'), r.results7, r.dias_entrega
    );
    v_prompt := format(
      'Quero discutir a recomendacao de custo da campanha "%s": custo R$ %s acima do teto R$ %s (%s). O que voce recomenda com base na maturidade de %s dias?',
      r.name, to_char(v_custo,'FM999990.00'), to_char(v_teto,'FM999990.00'), r.metrica, r.dias_entrega
    );
    v_ev := jsonb_build_object(
      'fonte', 'metric_snapshots+teto_vigente',
      'metrica', r.metrica,
      'custo_periodo', v_custo,
      'teto', v_teto,
      'spend7', round(r.spend7::numeric,2),
      'resultados7', r.results7,
      'dias_entrega', r.dias_entrega
    );
    perform private.upsert_reco_candidate(
      r.company_id, 'custo.acima_teto', 'custo_teto', 'campaign', r.id::text, r.name,
      'high', 'custo', r.dias_entrega, false, v_title, v_desc, v_prompt, v_ev, v_dedupe
    );
    v_count := v_count + 1;
  end loop;

  -- ---- D) Gasto sem resultado pos-maturidade (leadgen/mensagem) ----
  for r in
    select c.id, c.company_id, c.name, c.category,
           count(distinct ms.snapshot_date) filter (where coalesce(ms.spend,0) > 0) as dias_entrega,
           sum(ms.spend) as spend7,
           sum(case when c.category = 'mensagem' then ms.messaging_started else ms.form_leads end) as results7
    from public.campaigns c
    join public.metric_snapshots ms on ms.campaign_id = c.id and ms.snapshot_date >= v_hoje - 7
    where c.status = 'active'
      and coalesce(c.category,'') in ('leadgen','mensagem')
    group by c.id, c.company_id, c.name, c.category
    having count(distinct ms.snapshot_date) filter (where coalesce(ms.spend,0) > 0) >= 3
       and sum(ms.spend) >= 50
       and sum(case when c.category = 'mensagem' then ms.messaging_started else ms.form_leads end) = 0
  loop
    v_dedupe := 'custo.gasto_sem_resultado|' || r.id::text || '|' || v_dedupe_dia;
    v_title := 'Gasto sem resultado apos maturacao: ' || left(r.name, 80);
    v_desc := format(
      'Campanha "%s" (%s) gastou R$ %s em %s dias com 0 resultados (formulario/conversa). Objetivo exige conversao — investigar criativo, publico ou oferta. [auto: detector]',
      r.name, r.category, to_char(round(r.spend7::numeric,2),'FM999990.00'), r.dias_entrega
    );
    v_prompt := format(
      'Campanha "%s" gastou R$ %s em %s dias sem nenhum resultado. Quero um diagnostico e proximos passos.',
      r.name, to_char(round(r.spend7::numeric,2),'FM999990.00'), r.dias_entrega
    );
    v_ev := jsonb_build_object(
      'fonte', 'metric_snapshots',
      'spend7', round(r.spend7::numeric,2),
      'resultados7', 0,
      'dias_entrega', r.dias_entrega,
      'category', r.category
    );
    perform private.upsert_reco_candidate(
      r.company_id, 'custo.gasto_sem_resultado', 'custo_teto', 'campaign', r.id::text, r.name,
      'high', 'custo', r.dias_entrega, false, v_title, v_desc, v_prompt, v_ev, v_dedupe
    );
    v_count := v_count + 1;
  end loop;

  -- ---- E) Legenda fraca vs peers (precisa LLM para redigir julgamento de copy) ----
  for r in
    with ads_live as (
      select a.company_id, a.external_id, a.name, a.body, a.object_type, c.name as camp_name, c.category, c.id as campaign_id,
             sum(s.impressions) as impr, sum(s.link_clicks) as link_clk, sum(s.spend) as spend,
             count(*) filter (where s.spend > 0) as dias_entrega
      from public.ads a
      join public.campaigns c on c.id = a.campaign_id
      join public.ad_metric_snapshots s on s.ad_external_id = a.external_id and s.company_id = a.company_id
       and s.snapshot_date >= v_hoje - 7
      where c.status = 'active'
        and upper(coalesce(a.status,'ACTIVE')) in ('ACTIVE','ADSET_PAUSED_OVERRIDE')
        and coalesce(a.body,'') <> ''
      group by a.company_id, a.external_id, a.name, a.body, a.object_type, c.name, c.category, c.id
      having count(*) filter (where s.spend > 0) >= 3 and sum(s.impressions) >= 1000
    ),
    scored as (
      select *, (100.0 * link_clk / nullif(impr,0)) as ctr_link
      from ads_live
    ),
    peers as (
      select company_id, category, percentile_cont(0.5) within group (order by ctr_link) as mediana_ctr
      from scored
      where ctr_link is not null
      group by company_id, category
      having count(*) >= 2
    )
    select s.*, p.mediana_ctr
    from scored s
    join peers p on p.company_id = s.company_id and p.category = s.category
    where s.ctr_link is not null
      and p.mediana_ctr > 0
      and s.ctr_link <= p.mediana_ctr * 0.60
  loop
    v_dedupe := 'copy.ctr_abaixo_peers|' || r.external_id || '|' || v_dedupe_dia;
    v_title := 'Legenda abaixo dos peers: ' || left(coalesce(r.name, r.external_id), 80);
    v_desc := format(
      'Anuncio "%s" (categoria %s): CTR de link %s%% vs mediana dos peers %s%% na mesma categoria (7d). Legenda (trecho): "%s". Precisa julgamento qualitativo da copy. Maturidade: %s dias. [auto: detector]',
      coalesce(r.name,'?'), coalesce(r.category,'?'),
      to_char(round(r.ctr_link::numeric,2),'FM999990.00'),
      to_char(round(r.mediana_ctr::numeric,2),'FM999990.00'),
      left(regexp_replace(coalesce(r.body,''), E'[\\n\\r]+', ' ', 'g'), 140),
      r.dias_entrega
    );
    v_prompt := format(
      'Quero discutir a legenda do anuncio "%s". CTR de link %s%% esta abaixo da mediana dos peers (%s%%). Segue a legenda atual:%s%s%s Avalie hook, clareza e CTA; proponha 2 alternativas sem inventar metricas.',
      coalesce(r.name,'?'),
      to_char(round(r.ctr_link::numeric,2),'FM999990.00'),
      to_char(round(r.mediana_ctr::numeric,2),'FM999990.00'),
      E'\n\n', coalesce(r.body,''), E'\n'
    );
    v_ev := jsonb_build_object(
      'fonte', 'ads.body+ad_metric_snapshots',
      'base_clique', 'link',
      'ctr_link', round(r.ctr_link::numeric,2),
      'mediana_peers_ctr_link', round(r.mediana_ctr::numeric,2),
      'legenda', left(coalesce(r.body,''), 500),
      'dias_entrega', r.dias_entrega
    );
    perform private.upsert_reco_candidate(
      r.company_id, 'copy.ctr_abaixo_peers', 'copy_legenda', 'ad', r.external_id, r.name,
      'medium', 'criativo', r.dias_entrega, true, v_title, v_desc, v_prompt, v_ev, v_dedupe
    );
    v_count := v_count + 1;
  end loop;

  -- ---- F) Video: thruplay / avg baixo (paralelo Pipeboard) ----
  for r in
    with vid as (
      select p.company_id, p.ad_external_id, a.name as ad_name, c.name as camp_name,
             count(*) filter (where coalesce(p.spend,0) > 0) as dias_entrega,
             sum(coalesce(p.video_thruplay,0)) as thruplay,
             sum(coalesce(p.video_plays,0)) as plays,
             avg(nullif(p.video_avg_time_watched,0)) as avg_watch,
             sum(coalesce(p.video_p25_watched,0)) as p25,
             sum(coalesce(p.impressions,0)) as impr
      from public.ad_metric_snapshots_paralelo p
      join public.ads a on a.external_id = p.ad_external_id and a.company_id = p.company_id
      join public.campaigns c on c.id = a.campaign_id
      where c.status = 'active'
        and upper(coalesce(a.object_type,'')) like '%VIDEO%'
        and p.snapshot_date >= v_hoje - 7
        and (p.video_thruplay is not null or p.video_avg_time_watched is not null or p.video_plays is not null)
      group by p.company_id, p.ad_external_id, a.name, c.name
      having count(*) filter (where coalesce(p.spend,0) > 0) >= 3
         and sum(coalesce(p.video_plays, p.impressions, 0)) >= 200
    ),
    med as (
      select company_id,
             percentile_cont(0.5) within group (order by (thruplay::numeric / nullif(plays,0))) as med_thruplay_rate,
             percentile_cont(0.5) within group (order by avg_watch) as med_avg
      from vid
      where plays > 0
      group by company_id
      having count(*) >= 1
    )
    select v.*, m.med_thruplay_rate, m.med_avg,
           (v.thruplay::numeric / nullif(v.plays,0)) as thruplay_rate
    from vid v
    join med m on m.company_id = v.company_id
  loop
    if (r.thruplay_rate is not null and r.med_thruplay_rate is not null and r.thruplay_rate <= r.med_thruplay_rate * 0.70)
       or (r.avg_watch is not null and r.avg_watch < 15)
       or (r.plays > 0 and r.p25::numeric / r.plays < 0.35) then
      v_dedupe := 'video.retencao_baixa|' || r.ad_external_id || '|' || v_dedupe_dia;
      v_title := 'Video com retencao fraca: ' || left(coalesce(r.ad_name, r.ad_external_id), 80);
      v_desc := format(
        'Video "%s" (campanha %s): thruplay_rate=%s (mediana conta %s), avg_watch=%ss, p25/plays=%s. Leituras abaixo do esperado para manter atencao — revisar hook dos primeiros segundos. Maturidade: %s dias. Fonte: Pipeboard paralelo. [auto: detector]',
        coalesce(r.ad_name,'?'), coalesce(r.camp_name,'?'),
        coalesce(to_char(round(r.thruplay_rate::numeric, 3), 'FM999990.000'), 'n/d'),
        coalesce(to_char(round(r.med_thruplay_rate::numeric, 3), 'FM999990.000'), 'n/d'),
        coalesce(to_char(round(r.avg_watch::numeric, 1), 'FM999990.0'), 'n/d'),
        coalesce(to_char(round((r.p25::numeric / nullif(r.plays,0)), 2), 'FM999990.00'), 'n/d'),
        r.dias_entrega
      );
      v_prompt := format(
        'Quero discutir a retencao do video "%s": avg_watch=%ss, thruplay_rate=%s, p25/plays=%s. Como melhorar o hook sem inventar metricas?',
        coalesce(r.ad_name,'?'),
        coalesce(to_char(round(r.avg_watch::numeric,1),'FM999990.0'),'n/d'),
        coalesce(to_char(round(r.thruplay_rate::numeric,3),'FM999990.000'),'n/d'),
        coalesce(to_char(round((r.p25::numeric/nullif(r.plays,0)),2),'FM999990.00'),'n/d')
      );
      v_ev := jsonb_build_object(
        'fonte', 'ad_metric_snapshots_paralelo',
        'thruplay', r.thruplay,
        'plays', r.plays,
        'thruplay_rate', round(coalesce(r.thruplay_rate,0)::numeric, 3),
        'avg_watch_s', round(coalesce(r.avg_watch,0)::numeric, 1),
        'p25', r.p25,
        'dias_entrega', r.dias_entrega
      );
      perform private.upsert_reco_candidate(
        r.company_id, 'video.retencao_baixa', 'video', 'ad', r.ad_external_id, r.ad_name,
        'high', 'criativo', r.dias_entrega, true, v_title, v_desc, v_prompt, v_ev, v_dedupe
      );
      v_count := v_count + 1;
    end if;
  end loop;

  -- ---- G) MoM (so no modo semanal) ----
  if p_modo = 'semanal' then
    for r in
      with cur as (
        select c.id, c.company_id, c.name, c.category,
               sum(ms.spend) as spend, sum(ms.impressions) as impr, sum(ms.link_clicks) as link_clk,
               sum(ms.form_leads) as forms,
               count(distinct ms.snapshot_date) filter (where coalesce(ms.spend,0)>0) as dias
        from public.campaigns c
        join public.metric_snapshots ms on ms.campaign_id = c.id
         and ms.snapshot_date >= v_hoje - 7 and ms.snapshot_date < v_hoje
        where c.status = 'active'
        group by c.id, c.company_id, c.name, c.category
        having count(distinct ms.snapshot_date) filter (where coalesce(ms.spend,0)>0) >= 3
      ),
      prev as (
        select c.id, c.company_id,
               sum(ms.spend) as spend, sum(ms.impressions) as impr, sum(ms.link_clicks) as link_clk,
               sum(ms.form_leads) as forms
        from public.campaigns c
        join public.metric_snapshots ms on ms.campaign_id = c.id
         and ms.snapshot_date >= v_hoje - 37 and ms.snapshot_date < v_hoje - 30
        group by c.id, c.company_id
        having sum(ms.impressions) >= 1000
      )
      select cur.*,
             (100.0 * cur.link_clk / nullif(cur.impr,0)) as ctr_now,
             (100.0 * prev.link_clk / nullif(prev.impr,0)) as ctr_prev,
             prev.spend as spend_prev, prev.forms as forms_prev
      from cur
      join prev on prev.id = cur.id
      where prev.impr > 0 and cur.impr > 0
        and (100.0 * cur.link_clk / nullif(cur.impr,0))
            <= (100.0 * prev.link_clk / nullif(prev.impr,0)) * 0.70
    loop
      v_dedupe := 'comparativo.mom_ctr|' || r.id::text || '|' || to_char(v_hoje, 'IYYY-"W"IW');
      v_title := 'Qualidade abaixo do mes passado: ' || left(r.name, 80);
      v_desc := format(
        'Campanha "%s": CTR de link da semana atual %s%% vs semana equivalente do mes passado %s%% (queda >=30%%). Bases = cliques_no_link/impressoes. Dias com entrega nesta semana: %s. [auto: detector-semanal]',
        r.name,
        to_char(round(r.ctr_now::numeric,2),'FM999990.00'),
        to_char(round(r.ctr_prev::numeric,2),'FM999990.00'),
        r.dias
      );
      v_prompt := format(
        'Quero comparar a campanha "%s" com o mesmo periodo do mes passado: CTR link caiu de %s%% para %s%%. O que mudou e o que fazer?',
        r.name,
        to_char(round(r.ctr_prev::numeric,2),'FM999990.00'),
        to_char(round(r.ctr_now::numeric,2),'FM999990.00')
      );
      v_ev := jsonb_build_object(
        'fonte', 'metric_snapshots',
        'base_clique', 'link',
        'ctr_link_semana_atual', round(r.ctr_now::numeric,2),
        'ctr_link_semana_mes_passado', round(r.ctr_prev::numeric,2),
        'dias_entrega', r.dias
      );
      perform private.upsert_reco_candidate(
        r.company_id, 'comparativo.mom_ctr', 'comparativo', 'campaign', r.id::text, r.name,
        'medium', 'comparativo', r.dias, false, v_title, v_desc, v_prompt, v_ev, v_dedupe
      );
      v_count := v_count + 1;
    end loop;
  end if;

  -- ---- H) Materializa candidatos objetivos (needs_llm=false) em ai_recommendations ----
  for r in
    select * from public.recommendation_candidates
     where status = 'pending' and needs_llm = false
       and created_at::date >= v_hoje - 1
  loop
    perform public.gravar_recomendacao(
      r.company_id, r.title_draft, r.description_draft, r.impact, r.category, r.family,
      r.signal_key, r.entity_type, r.entity_id, r.entity_name, r.evidence_json,
      r.suggested_prompt, r.maturity_days, 'hybrid:sql-direct', r.dedupe_key, r.id
    );
  end loop;

  return jsonb_build_object(
    'ok', true,
    'modo', p_modo,
    'candidatos_upsertados_nesta_rodada', v_count,
    'pending_llm', (select count(*) from public.recommendation_candidates where status='pending' and needs_llm),
    'dia', v_hoje
  );
end;
$$;

revoke all on function public.detectar_sinais_recomendacao(text) from public, anon, authenticated;
grant execute on function public.detectar_sinais_recomendacao(text) to service_role;

comment on function public.detectar_sinais_recomendacao(text) is
  'Detecta sinais operacionais para a aba Recomendacoes da IA. Gate: >=3 dias de entrega. Modo diario|semanal.';

-- ---------------------------------------------------------------------------
-- 7) evaluate_winners: preenche source/family/dedupe novos
-- ---------------------------------------------------------------------------
create or replace function public.evaluate_winners()
returns integer
language plpgsql
security definer
set search_path to 'public'
as $function$
declare total int;
v_hoje text := to_char((timezone('America/Sao_Paulo', now()))::date, 'YYYYMMDD');
begin
  delete from public.ai_recommendations
   where status = 'new' and (description like '%[auto: vencedores]%' or source = 'sql:winners');

  with base as (
    select s.ad_external_id,
           max(a.name) as ad_name, max(c.name) as camp_name, max(c.category) as category,
           max(c.company_id::text)::uuid as company_id,
           max(coalesce(a.object_type,'')) as object_type,
           max(coalesce(a.call_to_action_type,'')) as cta,
           max(coalesce(a.title,'')) as ad_title,
           sum(s.spend) as spend7,
           sum(case when c.category = 'mensagem' then s.messaging_started else s.form_leads end) as results7
    from public.ad_metric_snapshots s
    join public.ads a on a.external_id = s.ad_external_id
    join public.campaigns c on c.id = a.campaign_id
    where c.status = 'active'
      and coalesce(c.category,'') in ('leadgen','mensagem')
      and upper(coalesce(a.status,'ACTIVE')) in ('ACTIVE','ADSET_PAUSED_OVERRIDE')
      and s.snapshot_date >= current_date - 7
    group by s.ad_external_id
  ), scored as (
    select b.*, round(b.spend7 / b.results7, 2) as custo7,
           (t.r->>'teto_que_governa')::numeric as teto,
           case when b.category = 'mensagem' then 'custo/conversa' else 'custo/formulário' end as metric_label,
           case when t.r->>'governa' = 'meta_de_negocio'
                then 'régua de negócio de ' || coalesce(t.r->'meta_de_negocio'->>'decidido_por','gestor')
                     || ', ' || to_char((t.r->'meta_de_negocio'->>'decidido_em')::date,'DD/MM/YYYY')
                else 'teto histórico do próprio desempenho' end as regua_label,
           round(100 * (1 - (b.spend7 / b.results7) / (t.r->>'teto_que_governa')::numeric)) as economia_pct
    from base b
    cross join lateral (
      select public.teto_vigente(
               b.company_id,
               case when b.category = 'mensagem' then 'custo_por_conversa' else 'custo_por_formulario' end
             ) as r
    ) t
    where b.results7 >= 30 and b.spend7 >= 30
      and (t.r->>'teto_que_governa') is not null
      and (b.spend7 / b.results7) <= (t.r->>'teto_que_governa')::numeric * 0.80
  )
  insert into public.ai_recommendations (
    company_id, title, description, impact, category, status,
    signal_key, entity_type, entity_id, entity_name, evidence_json,
    suggested_prompt, maturity_days, source, dedupe_key, family
  )
  select company_id,
         'Escalar criativo vencedor: ' || ad_name,
         'Últimos 7 dias: ' || results7 || ' resultados a R$ ' || to_char(custo7,'FM999990.00') ||
         ' (' || metric_label || ') — ' || economia_pct || '% abaixo do teto R$ ' || to_char(teto,'FM999990.00') ||
         ', com R$ ' || to_char(spend7,'FM999990.00') || ' investidos. Recomendação: aumentar orçamento ou duplicar este anúncio. Campanha ' || camp_name ||
         '. Régua usada: ' || regua_label || '. [auto: vencedores]',
         'high', 'escala', 'new'::recommendation_status,
         'vencedor.escala', 'ad', ad_external_id, ad_name,
         jsonb_build_object('fonte','evaluate_winners','custo7',custo7,'teto',teto,'results7',results7,'spend7',spend7),
         'Quero discutir a recomendacao de escalar o criativo "' || ad_name || '" (custo R$ ' || to_char(custo7,'FM999990.00') || ' vs teto R$ ' || to_char(teto,'FM999990.00') || '). Como proceder com aprovacao?',
         7, 'sql:winners', 'vencedor.escala|' || ad_external_id || '|' || v_hoje, 'vencedor'
  from scored
  union all
  select company_id,
         'Produza mais como: ' || ad_name,
         'Este criativo performa a R$ ' || to_char(custo7,'FM999990.00') || ' (' || metric_label ||
         '), ' || economia_pct || '% abaixo do teto. Padrão para replicar: formato ' ||
         coalesce(nullif(object_type,''),'(sem registro)') || ', CTA ' || coalesce(nullif(cta,''),'(sem registro)') ||
         case when ad_title <> '' then ', título "' || ad_title || '"' else '' end ||
         '. Campanha ' || camp_name || '. Régua usada: ' || regua_label || '. [auto: vencedores]',
         'medium', 'criativo', 'new'::recommendation_status,
         'vencedor.padrao', 'ad', ad_external_id, ad_name,
         jsonb_build_object('fonte','evaluate_winners','custo7',custo7,'object_type',object_type,'cta',cta),
         'Quero produzir mais pecas no padrao do vencedor "' || ad_name || '" (formato ' || coalesce(nullif(object_type,''),'?') || ', CTA ' || coalesce(nullif(cta,''),'?') || ').',
         7, 'sql:winners', 'vencedor.padrao|' || ad_external_id || '|' || v_hoje, 'vencedor'
  from scored;

  select count(*) into total from public.ai_recommendations
   where status = 'new' and source = 'sql:winners';
  return total;
end $function$;

-- ---------------------------------------------------------------------------
-- 8) Crons
-- ---------------------------------------------------------------------------
insert into public.mcp_api_keys (chamador, api_key, observacao)
select 'cron:traffic-reco-job',
       encode(sha256((gen_random_uuid()::text || clock_timestamp()::text || 'traffic-reco-job')::bytea), 'hex'),
       'Cron diario 09:35 UTC: job LLM que redige/valida candidatos needs_llm da aba Recomendacoes.'
on conflict (chamador) do nothing;

select cron.unschedule(jobid)
from cron.job
where jobname in ('reco-sinais-0925', 'traffic-reco-job-0935', 'reco-sinais-semanal-1000');

select cron.schedule(
  'reco-sinais-0925',
  '25 9 * * *',
  $$select public.detectar_sinais_recomendacao('diario');$$
);

select cron.schedule(
  'traffic-reco-job-0935',
  '35 9 * * *',
  $$
  select net.http_post(
    url := 'https://gzjwnjdpxpbmdhcyefvs.supabase.co/functions/v1/traffic-reco-job',
    headers := jsonb_build_object(
      'content-type', 'application/json',
      'x-mcp-key', public.get_mcp_api_key('cron:traffic-reco-job')
    ),
    body := '{"modo":"diario"}'::jsonb,
    timeout_milliseconds := 120000
  );
  $$
);

select cron.schedule(
  'reco-sinais-semanal-1000',
  '0 10 * * 1',
  $$select public.detectar_sinais_recomendacao('semanal');$$
);
