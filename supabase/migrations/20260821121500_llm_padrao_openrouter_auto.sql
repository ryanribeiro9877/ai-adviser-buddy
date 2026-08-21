-- Troca do LLM padrao: OpenRouter Auto Router estavel (openrouter/auto).
-- Sai de openrouter/auto-beta. Plugin id: auto-router. Secrets atualizados via CLI.

insert into public.model_prices (
  model, moeda, preco_in_por_milhao, preco_out_por_milhao,
  preco_cache_read_por_milhao, vigente_de, fonte
)
select
  'openrouter/auto', 'USD', 0, 0, 0, '2026-07-17'::date,
  'OpenRouter Auto Router estavel (21/08/2026): slug meta-roteador. Cobranca = taxa do modelo efetivo (response.model). cost_tier via plugin auto-router.'
where not exists (
  select 1 from public.model_prices where model = 'openrouter/auto' and vigente_ate is null
);

insert into public.agent_context (company_id, categoria, fato, vigente)
values (
  'ded20b38-f42e-4c71-800c-31b97ea48bcf'::uuid,
  'sistema',
  'LLM DA PLATAFORMA (21/08/2026): chat e jobs usam OpenRouter Auto Router ESTAVEL (slug openrouter/auto, nao auto-beta). Classifica a tarefa e escolhe o modelo pelo share-of-spend (7 dias), cost_tier via plugin auto-router (secret OPENROUTER_AUTO_COST_TIER). session_id = conversation_id. Rodape grava o modelo EFETIVO roteado (response.model).',
  true
);
