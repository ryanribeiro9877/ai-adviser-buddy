-- ESPELHO DE MIGRACAO APLICADA
-- version: 20260806132745
-- name: gt17_precos_reais_e_cache_como_teto_declarado
-- projeto: gzjwnjdpxpbmdhcyefvs (Gestor de Trafego IA)
-- aplicada por: Claude via MCP apply_migration
-- espelho gerado a partir de supabase_migrations.schema_migrations - NAO transcrito a mao

-- GT-17 · os precos reais entram, e o cache passa a ser TETO declarado em vez de zero.
--
-- FONTE: painel do OpenRouter, lido pelo Ryan e enviado em 06/08/2026 (prints da pagina de cada
-- modelo). Nao e estimativa minha: e transcricao da fonte dele.
--
-- O QUE A FONTE NAO TRAZIA: preco de leitura e de escrita de cache. E cache lido e 31% da
-- entrada no nosso uso (1.437.199 de 6.831.228 tokens). Tratar como zero - que era o que o
-- coalesce fazia - subestimaria o custo. Tratar pelo preco de ENTRADA superestima, e superestimar
-- declarando e melhor que subestimar em silencio: o numero passa a ser um TETO, e quem le sabe
-- disso porque a propria funcao diz.
--
-- VIGENCIA: '2026-01-01' de proposito, para cobrir toda a janela de 30 dias. Se o preco mudou
-- dentro do periodo, este calculo esta errado - e a coluna fonte registra que a vigencia
-- anterior a 06/08 e SUPOSICAO, nao leitura.
--
-- sonnet-4.5 fica SEM preco por decisao do Ryan ("pode esquecer"): 10 chamadas, 36 mil tokens.
-- A leitura vai continuar declarando essas chamadas como sem preco - o que e correto.

insert into public.model_prices
  (model, moeda, preco_in_por_milhao, preco_out_por_milhao,
   preco_cache_read_por_milhao, preco_cache_write_por_milhao, vigente_de, fonte)
values
  ('anthropic/claude-opus-4.8','USD', 5, 25, null, null, '2026-01-01',
   'Painel OpenRouter lido pelo Ryan em 06/08/2026: $5/M entrada, $25/M saida. Preco de cache NAO constava na fonte - ver como a leitura trata. Vigencia anterior a 06/08 e suposicao, nao leitura.'),
  ('anthropic/claude-sonnet-5','USD', 2, 10, null, null, '2026-01-01',
   'Painel OpenRouter lido pelo Ryan em 06/08/2026: $2/M entrada, $10/M saida. Preco de cache NAO constava na fonte. Vigencia anterior a 06/08 e suposicao, nao leitura.')
on conflict (model, vigente_de) do nothing;

create or replace function public.custo_llm_periodo(
  p_company_id uuid,
  p_de date default (current_date - 30),
  p_ate date default current_date
)
returns jsonb
language plpgsql
stable
as $$
declare v jsonb;
begin
  if p_company_id is null then
    raise exception 'custo_llm_periodo exige p_company_id';
  end if;

  with chat as (
    select m.model, count(*) as chamadas,
           sum(coalesce(m.tokens_in,0))  as tokens_in,
           sum(coalesce(m.tokens_out,0)) as tokens_out,
           sum(coalesce((m.diagnostico->>'cache_read')::bigint,0))       as cache_read,
           sum(coalesce((m.diagnostico->>'cache_write')::bigint,0))      as cache_write,
           sum(coalesce((m.diagnostico->>'reasoning_tokens')::bigint,0)) as reasoning,
           max(m.created_at) as ultima
    from chat_messages m
    where m.company_id = p_company_id and m.role = 'assistant' and m.model is not null
      and m.created_at::date between p_de and p_ate
    group by m.model
  ),
  precificado as (select c.*, public.resolve_model_price(c.model, c.ultima) as p from chat c),
  computado as (
    select pc.*,
      (pc.p->>'preco_conhecido')::boolean as tem_preco,
      ((pc.p->>'cache_read_por_milhao') is null and pc.cache_read > 0) as cache_por_teto,
      case when (pc.p->>'preco_conhecido')::boolean then
        round(
          (greatest(pc.tokens_in - pc.cache_read, 0) / 1000000.0) * coalesce((pc.p->>'in_por_milhao')::numeric, 0)
        -- cache sem preco na fonte: cobrado pelo preco de ENTRADA, o que faz o total ser TETO
        + (pc.cache_read  / 1000000.0) * coalesce((pc.p->>'cache_read_por_milhao')::numeric,  (pc.p->>'in_por_milhao')::numeric, 0)
        + (pc.cache_write / 1000000.0) * coalesce((pc.p->>'cache_write_por_milhao')::numeric, (pc.p->>'in_por_milhao')::numeric, 0)
        + ((pc.tokens_out + pc.reasoning) / 1000000.0) * coalesce((pc.p->>'out_por_milhao')::numeric, 0)
        , 4)
      end as custo
    from precificado pc
  ),
  job as (
    select count(*) as jobs,
      sum(coalesce((j.diagnostico->'planner'->>'tokens_in')::bigint,0)
        + coalesce((j.diagnostico->'sintese'->>'tokens_in')::bigint,0)
        + coalesce((j.diagnostico->'validacao'->>'tokens_in')::bigint,0)) as tokens_in_fases,
      sum(coalesce((j.diagnostico->'planner'->>'tokens_out')::bigint,0)
        + coalesce((j.diagnostico->'sintese'->>'tokens_out')::bigint,0)
        + coalesce((j.diagnostico->'validacao'->>'tokens_out')::bigint,0)) as tokens_out_fases,
      sum(jsonb_array_length(coalesce(j.diagnostico->'subagentes','[]'::jsonb))) as subagentes_executados
    from chat_jobs j
    where j.company_id = p_company_id and j.diagnostico is not null
      and j.created_at::date between p_de and p_ate
  )
  select jsonb_build_object(
    'periodo', jsonb_build_object('de', p_de, 'ate', p_ate),
    'moeda', 'USD',
    'chat', jsonb_build_object(
      'por_modelo', coalesce((select jsonb_agg(jsonb_build_object(
          'model', model, 'chamadas', chamadas,
          'tokens_in', tokens_in, 'tokens_out', tokens_out,
          'cache_read', cache_read, 'reasoning', reasoning,
          'preco_conhecido', tem_preco, 'custo_usd', custo,
          'cache_cobrado_pelo_preco_de_entrada', cache_por_teto
        ) order by custo desc nulls last) from computado), '[]'::jsonb),
      'custo_usd_total', (select sum(custo) from computado where tem_preco),
      'e_teto_nao_exato', (select bool_or(cache_por_teto) from computado),
      'chamadas_sem_preco', (select coalesce(sum(chamadas),0) from computado where not tem_preco),
      'tokens_sem_preco', (select coalesce(sum(tokens_in + tokens_out),0) from computado where not tem_preco)
    ),
    'job', (select jsonb_build_object('jobs', jobs,
        'tokens_in_das_fases_conhecidas', tokens_in_fases,
        'tokens_out_das_fases_conhecidas', tokens_out_fases,
        'subagentes_executados', subagentes_executados,
        'custo_usd', null) from job),
    'LACUNAS_DECLARADAS', jsonb_build_array(
      'CACHE SEM PRECO NA FONTE: o painel enviado em 06/08 nao trazia preco de leitura/escrita de cache. Os tokens de cache estao sendo cobrados pelo preco de ENTRADA, entao o total e um TETO - o custo real e igual ou MENOR.',
      'SUBAGENTES: ate 8 por job e ZERO tokens registrados. Maior lacuna de custo do sistema.',
      'VISAO: drive_midia_analises guarda o modelo e nao guarda tokens. Custo da leitura de criativo invisivel.',
      'MODELO POR FASE DO JOB: o diagnostico traz tokens de planner/sintese/validacao e NAO diz qual modelo rodou cada fase. Sem modelo nao ha preco, por isso job.custo_usd e NULO e nao zero.',
      'COMPLIANCE-CHECK: usa LLM e nao grava consumo.',
      'VIGENCIA DO PRECO: lido em 06/08 e aplicado retroativamente a toda a janela. Se houve mudanca de preco no periodo, o calculo esta errado.'
    ),
    'nota', 'Custo DERIVADO do token na leitura, nunca gravado. Corrigir um preco conserta o historico inteiro sem reescrever fato.'
  ) into v;

  return v;
end;
$$;