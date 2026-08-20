-- Troca do LLM padrao da plataforma para DeepSeek V4 Pro 0423 (OpenRouter: deepseek/deepseek-v4-pro).
-- Secrets OPENROUTER_MODEL e OPENROUTER_MODEL_SUB setados via CLI em 20/08/2026.

insert into public.model_prices (
  model, moeda, preco_in_por_milhao, preco_out_por_milhao,
  preco_cache_read_por_milhao, vigente_de, fonte
)
select
  'deepseek/deepseek-v4-pro', 'USD', 0.66, 1.98, 0.022, '2026-04-23'::date,
  'OpenRouter / DeepSeek V4 Pro 0423 (20/08/2026): $0.66/M in, $1.98/M out; cache read $0.022/M (provider DeepSeek).'
where not exists (
  select 1 from public.model_prices where model = 'deepseek/deepseek-v4-pro' and vigente_ate is null
);

insert into public.agent_context (company_id, categoria, fato, vigente)
values (
  'ded20b38-f42e-4c71-800c-31b97ea48bcf'::uuid,
  'sistema',
  'LLM DA PLATAFORMA (20/08/2026): chat, subagentes, compliance e legendas usam DeepSeek V4 Pro 0423 via OpenRouter (slug deepseek/deepseek-v4-pro). Secrets OPENROUTER_MODEL e OPENROUTER_MODEL_SUB apontam para esse modelo.',
  true
);
