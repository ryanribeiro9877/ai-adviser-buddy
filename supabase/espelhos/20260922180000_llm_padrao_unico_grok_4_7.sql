-- Padrao unico de LLM (22/09/2026): x-ai/grok-4.7 substitui x-ai/grok-4.6.
-- O codigo mora em supabase/functions/_shared/llm_roteador.ts (MODELO_PADRAO) e
-- llm_catalogo.ts. Esta migracao atualiza o FATO que o agente le sobre si e o
-- preco do slug novo. A linha do 4.6 em model_prices fica (historico de custo);
-- o fato 'LLM DA PLATAFORMA' vigente passa a nomear so o 4.7.

insert into public.model_prices (
  model, moeda, preco_in_por_milhao, preco_out_por_milhao,
  preco_cache_read_por_milhao, vigente_de, fonte
)
select
  'x-ai/grok-4.7', 'USD', 2, 6, 0.50, '2026-09-22'::date,
  'OpenRouter / SpaceXAI Grok 4.7 (22/09/2026): preco inicial alinhado ao 4.6 ($2/M in, $6/M out; cache read $0.50/M) ate conferir a tabela vigente.'
where not exists (
  select 1 from public.model_prices where model = 'x-ai/grok-4.7' and vigente_ate is null
);

update public.agent_context
   set vigente = false
 where vigente = true
   and fato like 'LLM DA PLATAFORMA%';

insert into public.agent_context (company_id, categoria, fato, vigente)
values (
  'ded20b38-f42e-4c71-800c-31b97ea48bcf'::uuid,
  'sistema',
  'LLM DA PLATAFORMA (22/09/2026): UM modelo para todo agente e toda tarefa — SpaceXAI Grok 4.7 via OpenRouter (slug x-ai/grok-4.7). Vale para chat, Roteador AG-01, planner, subagentes, visao de pecas do Drive, coordenacao, sintese, compliance, legendas e templates WABA. O raciocinio do modelo e obrigatorio (nao ha como desligar) e o ESFORCO vem do modo: pesquisa profunda (tier deep do traffic-agent-job) usa xhigh; chat/planner usam low (interativo/triagem). O catalogo por faixa e a rede de fallback: se o Grok pendurar, voltar vazio ou recusar, o turno troca o primario (luna/gemini) no cliente — o array models da OpenRouter nao dispara em hang. Escape: secret LLM_ROTEADOR=legado volta ao openrouter/auto.',
  true
);
