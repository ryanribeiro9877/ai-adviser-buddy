-- LLM padrao: OpenRouter Auto Router Beta (openrouter/auto-beta).
-- Secrets OPENROUTER_MODEL / OPENROUTER_MODEL_SUB / OPENROUTER_AUTO_COST_TIER setados via CLI.
-- Preco e o do modelo roteado (campo response.model); nao ha surcharge do router.

insert into public.model_prices (
  model, moeda, preco_in_por_milhao, preco_out_por_milhao,
  preco_cache_read_por_milhao, vigente_de, fonte
)
select
  'openrouter/auto-beta', 'USD', 0, 0, 0, '2026-07-17'::date,
  'OpenRouter Auto Router Beta (21/08/2026): slug meta-roteador. Cobranca = taxa do modelo efetivo (response.model). cost_tier via plugin auto-beta-router.'
where not exists (
  select 1 from public.model_prices where model = 'openrouter/auto-beta' and vigente_ate is null
);

insert into public.agent_context (company_id, categoria, fato, vigente)
values (
  'ded20b38-f42e-4c71-800c-31b97ea48bcf'::uuid,
  'sistema',
  'LLM DA PLATAFORMA (21/08/2026): chat e jobs usam OpenRouter Auto Router Beta (slug openrouter/auto-beta). O router classifica a tarefa e escolhe o modelo pelo share-of-spend do mercado (7 dias), filtrado por cost_tier (secret OPENROUTER_AUTO_COST_TIER, default medium; sintese do job usa high). session_id = conversation_id para sticky. O rodape do chat grava o modelo EFETIVO roteado (response.model), nao so o slug auto-beta.',
  true
);
