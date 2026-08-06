-- ESPELHO DE MIGRACAO APLICADA
-- version: 20260805181511
-- name: gt17_camada_de_preco_e_leitura_de_custo_llm
-- projeto: gzjwnjdpxpbmdhcyefvs (Gestor de Trafego IA)
-- aplicada por: Claude via MCP apply_migration
-- espelho gerado a partir de supabase_migrations.schema_migrations - NAO transcrito a mao

-- GT-17 · Instrumentacao de custo de LLM.
--
-- REVISAO DO PLANO, feita pelo banco: eu ia espelhar o ai_generations do JurisAI. A camada
-- de FATO ja existe aqui em outra forma - chat_messages.model/tokens_in/tokens_out (125 de
-- 139 preenchidos), chat_messages.diagnostico com cache_read e reasoning_tokens, e
-- chat_jobs.diagnostico com tokens POR FASE (planner, sintese, validacao). Criar tabela de
-- fato nova seria repetir o erro do campaign_spend_guard (criado e derrubado em 48 minutos
-- em 04/08 por nao ter procurado o mecanismo existente).
-- Logo: aqui entra SO o que falta - preco e leitura.
--
-- DECISOES DE DESENHO, e o porque de cada uma:
--
-- 1. CUSTO E DERIVADO, NAO GRAVADO. Token e evidencia imutavel; preco muda. Derivando na
--    leitura, corrigir um preco conserta todo o historico sem reescrever fato nenhum.
--
-- 2. PRECO TEM VIGENCIA. Custo de marco tem de ser calculado com o preco de marco.
--    Mesma licao de "conhecimento tem prazo".
--
-- 3. PRECO DESCONHECIDO => CUSTO NULO, NUNCA ZERO. Modelo fora da tabela devolve
--    preco_conhecido=false e a leitura CONTA essas chamadas em separado. Tratar preco
--    ausente como zero e o padrao do `?? "ACTIVE"` aplicado a dinheiro - verde falso.
--
-- 4. EU NAO SEI OS PRECOS e NAO VOU INVENTAR. A tabela nasce VAZIA. Preco de
--    anthropic/claude-opus-4.8 e claude-sonnet-5 no OpenRouter tem de ser lido do painel
--    pelo Ryan e inserido com fonte e data. Fato com numero vira fonte de numero: um preco
--    chutado aqui viraria "o custo do sistema" em todo relatorio seguinte.
--
-- 5. MOEDA EXPLICITA. OpenRouter cobra em USD; o orcamento de midia e em BRL. Nenhuma
--    conversao acontece aqui. Comparar custo de LLM com verba de midia sem declarar
--    cambio e data produz numero errado com aparencia de medicao.
--
-- 6. REASONING conta como SAIDA na cobranca; CACHE_READ tem preco proprio e menor.
--    Ignorar cache_read superestima o custo (na amostra de 05/08, 31% da entrada veio de
--    cache). Por isso as quatro colunas de preco existem separadas.

create table if not exists public.model_prices (
  id uuid primary key default gen_random_uuid(),
  model text not null,
  moeda text not null default 'USD',
  preco_in_por_milhao numeric,
  preco_out_por_milhao numeric,
  preco_cache_read_por_milhao numeric,
  preco_cache_write_por_milhao numeric,
  vigente_de date not null,
  vigente_ate date,
  fonte text not null,
  created_at timestamptz not null default now(),
  constraint model_prices_vigencia_coerente check (vigente_ate is null or vigente_ate >= vigente_de),
  constraint model_prices_unica_por_inicio unique (model, vigente_de)
);

comment on table public.model_prices is
  'GT-17: preco por milhao de tokens, por modelo, COM VIGENCIA. Nasce vazia de proposito: preco chutado viraria fonte de numero. Preencher com leitura do painel do OpenRouter, informando fonte.';
comment on column public.model_prices.preco_cache_read_por_milhao is
  'Leitura de cache e cobrada mais barato que entrada normal. Ignorar isso superestima o custo.';
comment on column public.model_prices.fonte is
  'De onde o preco foi lido (ex.: painel OpenRouter, data). Obrigatorio - preco sem procedencia nao entra.';

alter table public.model_prices enable row level security;

drop policy if exists model_prices_leitura_autenticada on public.model_prices;
create policy model_prices_leitura_autenticada on public.model_prices
  for select to authenticated using (true);
-- escrita: apenas service_role (que ignora RLS), como todo o resto do projeto.

-- Resolve o preco vigente na data do consumo. Declara quando NAO sabe.
create or replace function public.resolve_model_price(p_model text, p_em timestamptz default now())
returns jsonb
language sql
stable
as $$
  select coalesce(
    (select jsonb_build_object(
       'preco_conhecido', true, 'model', mp.model, 'moeda', mp.moeda,
       'in_por_milhao', mp.preco_in_por_milhao,
       'out_por_milhao', mp.preco_out_por_milhao,
       'cache_read_por_milhao', mp.preco_cache_read_por_milhao,
       'cache_write_por_milhao', mp.preco_cache_write_por_milhao,
       'vigente_de', mp.vigente_de, 'fonte', mp.fonte)
     from public.model_prices mp
     where mp.model = p_model
       and mp.vigente_de <= p_em::date
       and (mp.vigente_ate is null or mp.vigente_ate >= p_em::date)
     order by mp.vigente_de desc limit 1),
    jsonb_build_object('preco_conhecido', false, 'model', p_model,
      'aviso', 'Preco nao cadastrado para este modelo nesta data. Custo NAO pode ser calculado - e nulo, nao zero.')
  );
$$;

-- Leitura do custo no periodo, com cobertura e lacunas DECLARADAS.
create or replace function public.custo_llm_periodo(
  p_company_id uuid,
  p_de date default (current_date - 30),
  p_ate date default current_date
)
returns jsonb
language plpgsql
stable
as $$
declare
  v jsonb;
begin
  if p_company_id is null then
    raise exception 'custo_llm_periodo exige p_company_id';
  end if;

  with chat as (
    select m.model,
           count(*) as chamadas,
           sum(coalesce(m.tokens_in,0))  as tokens_in,
           sum(coalesce(m.tokens_out,0)) as tokens_out,
           sum(coalesce((m.diagnostico->>'cache_read')::bigint,0))       as cache_read,
           sum(coalesce((m.diagnostico->>'cache_write')::bigint,0))      as cache_write,
           sum(coalesce((m.diagnostico->>'reasoning_tokens')::bigint,0)) as reasoning,
           count(*) filter (where m.diagnostico ? 'cache_read')       as com_cache_declarado,
           count(*) filter (where m.diagnostico ? 'reasoning_tokens') as com_reasoning_declarado,
           max(m.created_at) as ultima
    from chat_messages m
    where m.company_id = p_company_id
      and m.role = 'assistant'
      and m.model is not null
      and m.created_at::date between p_de and p_ate
    group by m.model
  ),
  precificado as (
    select c.*,
           public.resolve_model_price(c.model, c.ultima) as p
    from chat c
  ),
  computado as (
    select pc.*,
      (pc.p->>'preco_conhecido')::boolean as tem_preco,
      case when (pc.p->>'preco_conhecido')::boolean then
        round(
          (greatest(pc.tokens_in - pc.cache_read, 0) / 1000000.0) * coalesce((pc.p->>'in_por_milhao')::numeric, 0)
        + (pc.cache_read  / 1000000.0) * coalesce((pc.p->>'cache_read_por_milhao')::numeric, 0)
        + (pc.cache_write / 1000000.0) * coalesce((pc.p->>'cache_write_por_milhao')::numeric, 0)
        + ((pc.tokens_out + pc.reasoning) / 1000000.0) * coalesce((pc.p->>'out_por_milhao')::numeric, 0)
        , 4)
      end as custo
    from precificado pc
  ),
  job as (
    select
      count(*) as jobs,
      sum(coalesce((j.diagnostico->'planner'->>'tokens_in')::bigint,0)
        + coalesce((j.diagnostico->'sintese'->>'tokens_in')::bigint,0)
        + coalesce((j.diagnostico->'validacao'->>'tokens_in')::bigint,0)) as tokens_in_fases,
      sum(coalesce((j.diagnostico->'planner'->>'tokens_out')::bigint,0)
        + coalesce((j.diagnostico->'sintese'->>'tokens_out')::bigint,0)
        + coalesce((j.diagnostico->'validacao'->>'tokens_out')::bigint,0)) as tokens_out_fases,
      sum(jsonb_array_length(coalesce(j.diagnostico->'subagentes','[]'::jsonb))) as subagentes_executados
    from chat_jobs j
    where j.company_id = p_company_id
      and j.diagnostico is not null
      and j.created_at::date between p_de and p_ate
  )
  select jsonb_build_object(
    'company_id', p_company_id,
    'periodo', jsonb_build_object('de', p_de, 'ate', p_ate),
    'moeda', 'USD',
    'chat', jsonb_build_object(
      'por_modelo', coalesce((select jsonb_agg(jsonb_build_object(
          'model', model, 'chamadas', chamadas,
          'tokens_in', tokens_in, 'tokens_out', tokens_out,
          'cache_read', cache_read, 'reasoning', reasoning,
          'preco_conhecido', tem_preco,
          'custo_usd', custo,
          'cobertura_do_detalhe', jsonb_build_object(
             'chamadas_com_cache_declarado', com_cache_declarado,
             'chamadas_com_reasoning_declarado', com_reasoning_declarado)
        ) order by tokens_in desc) from computado), '[]'::jsonb),
      'custo_usd_total_conhecido', (select sum(custo) from computado where tem_preco),
      'chamadas_sem_preco', (select coalesce(sum(chamadas),0) from computado where not tem_preco),
      'tokens_sem_preco', (select coalesce(sum(tokens_in + tokens_out),0) from computado where not tem_preco)
    ),
    'job', (select jsonb_build_object(
        'jobs', jobs,
        'tokens_in_das_fases_conhecidas', tokens_in_fases,
        'tokens_out_das_fases_conhecidas', tokens_out_fases,
        'subagentes_executados', subagentes_executados,
        'custo_usd', null) from job),
    'LACUNAS_DECLARADAS', jsonb_build_array(
      'SUBAGENTES: o job registra quantos rodaram e se o relatorio veio completo, mas NAO registra tokens por subagente. Sao ate 8 em paralelo - e a maior lacuna de custo do sistema.',
      'VISAO: drive_midia_analises guarda o modelo e NAO guarda tokens. Cada video vira 15 quadros. O custo da leitura de criativo e integralmente invisivel.',
      'MODELO POR FASE DO JOB: o diagnostico traz tokens de planner/sintese/validacao mas NAO diz qual modelo rodou cada fase. Sem modelo nao ha preco, por isso job.custo_usd e NULO e nao zero.',
      'COMPLIANCE-CHECK: usa LLM para identificar e nao grava consumo em lugar nenhum.',
      'CACHE E REASONING PARCIAIS: telemetria mais nova que parte das mensagens. cobertura_do_detalhe diz em quantas chamadas o dado existe.',
      'MOEDA: tudo em USD. Nao ha conversao para BRL aqui de proposito - comparar com verba de midia exige cambio e data declarados.'
    ),
    'nota', 'Custo e DERIVADO do token na leitura, nunca gravado: corrigir um preco conserta o historico inteiro sem reescrever fato. Preco ausente produz custo NULO - jamais zero.'
  ) into v;

  return v;
end;
$$;