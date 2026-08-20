-- Troca do LLM padrao da plataforma para SpaceXAI Grok 4.6 (OpenRouter: x-ai/grok-4.6).
-- Secrets OPENROUTER_MODEL e OPENROUTER_MODEL_SUB ja setados via CLI em 20/08/2026.
-- Esta migracao registra o preco para leitura de custo LLM.

insert into public.model_prices (
  model, moeda, preco_in_por_milhao, preco_out_por_milhao,
  preco_cache_read_por_milhao, vigente_de, fonte
)
select
  'x-ai/grok-4.6', 'USD', 2, 6, 0.50, '2026-08-12'::date,
  'OpenRouter / SpaceXAI Grok 4.6 (20/08/2026): $2/M in, $6/M out (<200k prompt); cache read $0.50/M. Taxa dobra se prompt >=200k.'
where not exists (
  select 1 from public.model_prices where model = 'x-ai/grok-4.6' and vigente_ate is null
);

insert into public.agent_context (company_id, categoria, fato, vigente)
values (
  'ded20b38-f42e-4c71-800c-31b97ea48bcf'::uuid,
  'sistema',
  'LLM DA PLATAFORMA (20/08/2026): chat, subagentes, compliance e legendas usam SpaceXAI Grok 4.6 via OpenRouter (slug x-ai/grok-4.6). Secrets OPENROUTER_MODEL e OPENROUTER_MODEL_SUB apontam para esse modelo.',
  true
);
