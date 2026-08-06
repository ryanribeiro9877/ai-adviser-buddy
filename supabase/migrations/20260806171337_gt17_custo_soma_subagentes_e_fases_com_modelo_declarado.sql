-- ESPELHO DE MIGRACAO APLICADA
-- version: 20260806171337
-- name: gt17_custo_soma_subagentes_e_fases_com_modelo_declarado
-- projeto: gzjwnjdpxpbmdhcyefvs (Gestor de Trafego IA)
-- aplicada por: Claude via MCP apply_migration
-- espelho gerado a partir de supabase_migrations.schema_migrations - NAO transcrito a mao

-- GT-17 correcao grande · a funcao ignorava 5x mais tokens do que contava.
--
-- O ERRO: eu declarei "SUBAGENTES: ate 8 por job e ZERO tokens registrados. Maior lacuna de
-- custo do sistema." Falso. Os tokens estao gravados em diagnostico->'subagentes'[].tokens_in e
-- tokens_out desde 28/07, em 14 dos 17 jobs. Minha funcao contava quantos subagentes rodaram
-- (jsonb_array_length) e NAO somava os tokens deles - dentro do mesmo jsonb que ela ja lia.
-- Medido em 06/08: 2.251.254 tokens de entrada e 449.475 de saida nos subagentes, contra os
-- 440.173 que eu reportava das fases. Eu apresentei o custo com confianca e ele estava errado
-- por fator grande.
--
-- Pior que o numero: eu declarei uma LACUNA QUE NAO EXISTIA. Isso e o inverso da regra 13 -
-- inventar limitacao parece humildade e e mentira, e aqui custou uma decisao de instrumentacao
-- que ja estava tomada.
--
-- MODELO POR ETAPA: o diagnostico nao grava qual modelo rodou cada etapa. Aplico a configuracao
-- do sistema como PREMISSA DECLARADA, nao como leitura: OPENROUTER_MODEL_SUB (sonnet-5) para
-- planner, validacao e subagentes; OPENROUTER_MODEL (opus-4.8) para a sintese. Se a configuracao
-- mudar, este calculo fica errado - e por isso a premissa vai escrita na resposta.

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
  v_sub_model text := 'anthropic/claude-sonnet-5';
  v_main_model text := 'anthropic/claude-opus-4.8';
  v_sub_in numeric; v_sub_out numeric; v_main_in numeric; v_main_out numeric;
begin
  if p_company_id is null then
    raise exception 'custo_llm_periodo exige p_company_id';
  end if;

  select coalesce((p->>'in_por_milhao')::numeric,0), coalesce((p->>'out_por_milhao')::numeric,0)
    into v_sub_in, v_sub_out from public.resolve_model_price(v_sub_model) p;
  select coalesce((p->>'in_por_milhao')::numeric,0), coalesce((p->>'out_por_milhao')::numeric,0)
    into v_main_in, v_main_out from public.resolve_model_price(v_main_model) p;

  with chat as (
    select m.model, count(*) as chamadas,
           sum(coalesce(m.tokens_in,0)) as tokens_in, sum(coalesce(m.tokens_out,0)) as tokens_out,
           sum(coalesce((m.diagnostico->>'cache_read')::bigint,0)) as cache_read,
           sum(coalesce((m.diagnostico->>'cache_write')::bigint,0)) as cache_write,
           sum(coalesce((m.diagnostico->>'reasoning_tokens')::bigint,0)) as reasoning,
           max(m.created_at) as ultima
    from chat_messages m
    where m.company_id = p_company_id and m.role = 'assistant' and m.model is not null
      and m.created_at::date between p_de and p_ate
    group by m.model
  ),
  computado as (
    select c.*, (p->>'preco_conhecido')::boolean as tem_preco,
      ((p->>'cache_read_por_milhao') is null and c.cache_read > 0) as cache_por_teto,
      case when (p->>'preco_conhecido')::boolean then
        round((greatest(c.tokens_in - c.cache_read,0)/1000000.0) * coalesce((p->>'in_por_milhao')::numeric,0)
            + (c.cache_read/1000000.0) * coalesce((p->>'cache_read_por_milhao')::numeric,(p->>'in_por_milhao')::numeric,0)
            + (c.cache_write/1000000.0) * coalesce((p->>'cache_write_por_milhao')::numeric,(p->>'in_por_milhao')::numeric,0)
            + ((c.tokens_out + c.reasoning)/1000000.0) * coalesce((p->>'out_por_milhao')::numeric,0), 4)
      end as custo
    from chat c, public.resolve_model_price(c.model, c.ultima) p
  ),
  jobs as (
    select j.id,
      coalesce((j.diagnostico->'planner'->>'tokens_in')::bigint,0)
        + coalesce((j.diagnostico->'validacao'->>'tokens_in')::bigint,0)
        + coalesce((select sum((s->>'tokens_in')::bigint) from jsonb_array_elements(coalesce(j.diagnostico->'subagentes','[]'::jsonb)) s),0) as sub_in,
      coalesce((j.diagnostico->'planner'->>'tokens_out')::bigint,0)
        + coalesce((j.diagnostico->'validacao'->>'tokens_out')::bigint,0)
        + coalesce((select sum((s->>'tokens_out')::bigint) from jsonb_array_elements(coalesce(j.diagnostico->'subagentes','[]'::jsonb)) s),0) as sub_out,
      coalesce((j.diagnostico->'sintese'->>'tokens_in')::bigint,0)  as main_in,
      coalesce((j.diagnostico->'sintese'->>'tokens_out')::bigint,0) as main_out,
      jsonb_array_length(coalesce(j.diagnostico->'subagentes','[]'::jsonb)) as n_subs,
      (select count(*) from jsonb_array_elements(coalesce(j.diagnostico->'subagentes','[]'::jsonb)) s where s ? 'tokens_in') as subs_com_tokens
    from chat_jobs j
    where j.company_id = p_company_id and j.diagnostico is not null
      and j.created_at::date between p_de and p_ate
  ),
  job_tot as (
    select count(*) qtd, sum(sub_in) sub_in, sum(sub_out) sub_out,
           sum(main_in) main_in, sum(main_out) main_out,
           sum(n_subs) n_subs, sum(subs_com_tokens) subs_com_tokens
    from jobs
  )
  select jsonb_build_object(
    'periodo', jsonb_build_object('de', p_de, 'ate', p_ate),
    'moeda', 'USD',
    'chat', jsonb_build_object(
      'por_modelo', coalesce((select jsonb_agg(jsonb_build_object(
          'model', model, 'chamadas', chamadas, 'tokens_in', tokens_in, 'tokens_out', tokens_out,
          'cache_read', cache_read, 'reasoning', reasoning,
          'preco_conhecido', tem_preco, 'custo_usd', custo,
          'cache_cobrado_pelo_preco_de_entrada', cache_por_teto) order by custo desc nulls last)
        from computado), '[]'::jsonb),
      'custo_usd', (select sum(custo) from computado where tem_preco),
      'chamadas_sem_preco', (select coalesce(sum(chamadas),0) from computado where not tem_preco)),
    'jobs', (select jsonb_build_object(
        'quantidade', qtd,
        'subagentes_executados', n_subs,
        'subagentes_com_token_gravado', subs_com_tokens,
        'tokens_sub', jsonb_build_object('in', sub_in, 'out', sub_out),
        'tokens_sintese', jsonb_build_object('in', main_in, 'out', main_out),
        'custo_usd_sub', round((sub_in/1000000.0)*v_sub_in + (sub_out/1000000.0)*v_sub_out, 4),
        'custo_usd_sintese', round((main_in/1000000.0)*v_main_in + (main_out/1000000.0)*v_main_out, 4),
        'custo_usd', round((sub_in/1000000.0)*v_sub_in + (sub_out/1000000.0)*v_sub_out
                         + (main_in/1000000.0)*v_main_in + (main_out/1000000.0)*v_main_out, 4))
      from job_tot),
    'PREMISSA_DECLARADA', 'O diagnostico NAO grava qual modelo rodou cada etapa. Apliquei a configuracao do sistema: sonnet-5 para planner, validacao e subagentes; opus-4.8 para a sintese. Se OPENROUTER_MODEL ou OPENROUTER_MODEL_SUB mudarem, este calculo fica errado.',
    'LACUNAS_DECLARADAS', jsonb_build_array(
      'CACHE SEM PRECO NA FONTE: tokens de cache cobrados pelo preco de entrada, entao o custo do chat e TETO.',
      'SUBAGENTES SEM TOKEN EM ALGUNS JOBS: ver subagentes_executados contra subagentes_com_token_gravado - a diferenca sao execucoes cujo consumo nao foi gravado.',
      'VISAO: drive_midia_analises guarda o modelo e nao guarda tokens. Leitura de criativo segue invisivel.',
      'COMPLIANCE-CHECK: usa LLM e nao grava consumo.',
      'CORRECAO DE 06/08: a versao anterior desta funcao IGNORAVA os tokens dos subagentes e declarava que eles nao existiam. Eram 2,25 milhoes de tokens de entrada. O custo informado antes desta correcao estava subestimado.'),
    'nota', 'Custo DERIVADO do token na leitura, nunca gravado.'
  ) into v;

  return v;
end;
$$;