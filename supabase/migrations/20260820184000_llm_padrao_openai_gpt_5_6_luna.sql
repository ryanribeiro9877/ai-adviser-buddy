-- Troca do LLM padrao da plataforma para OpenAI GPT-5.6 Luna (OpenRouter: openai/gpt-5.6-luna).
-- Secrets OPENROUTER_MODEL e OPENROUTER_MODEL_SUB setados via CLI em 20/08/2026.

insert into public.model_prices (
  model, moeda, preco_in_por_milhao, preco_out_por_milhao,
  preco_cache_read_por_milhao, vigente_de, fonte
)
select
  'openai/gpt-5.6-luna', 'USD', 0.20, 1.20, 0.05, '2026-07-09'::date,
  'OpenRouter / OpenAI GPT-5.6 Luna (20/08/2026): $0.20/M in, $1.20/M out; cache read ~$0.05/M (OpenRouter listing).'
where not exists (
  select 1 from public.model_prices where model = 'openai/gpt-5.6-luna' and vigente_ate is null
);

insert into public.agent_context (company_id, categoria, fato, vigente)
values (
  'ded20b38-f42e-4c71-800c-31b97ea48bcf'::uuid,
  'sistema',
  'LLM DA PLATAFORMA (20/08/2026): chat, subagentes, compliance e legendas usam OpenAI GPT-5.6 Luna via OpenRouter (slug openai/gpt-5.6-luna). Secrets OPENROUTER_MODEL e OPENROUTER_MODEL_SUB apontam para esse modelo.',
  true
);
