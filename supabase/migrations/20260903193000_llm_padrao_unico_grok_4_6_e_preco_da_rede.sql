-- Padrao unico de LLM (03/09/2026): x-ai/grok-4.6 em todo agente e toda tarefa, com esforco
-- de raciocinio por MODO (pesquisa profunda = xhigh, resto = high). O codigo dessa decisao
-- vive em supabase/functions/_shared/llm_roteador.ts; esta migracao cuida das duas coisas que
-- moram no banco: o PRECO do que pode ser cobrado e o FATO que o proprio agente le sobre si.
--
-- 1) PRECO DA REDE DE FALLBACK. O preco do Grok 4.6 ja estava cadastrado (migracao de
--    20/08). O que faltava era a rede: quando o Grok cai, recusa ou falta provedor, a cadeia
--    `models` da OpenRouter continua o turno em outro modelo — e o custo desse turno saia da
--    leitura por falta de linha em model_prices. Sao 6 slugs, a uniao exata do que as cadeias
--    novas podem pedir (levantado rodando resolverChamadaLlm em todos os tipos x imagem x ato
--    x faixa x tier). Precos lidos na /api/v1/models da OpenRouter em 03/09/2026.
--
-- 2) FATO DO SISTEMA. Havia CINCO fatos 'LLM DA PLATAFORMA' marcados vigente=true ao mesmo
--    tempo, cada um nomeando um modelo diferente (Grok, DeepSeek, Luna, Auto Router beta e
--    estavel) — heranca de cinco trocas de padrao que nunca aposentaram a anterior. O agente
--    lia os cinco e nao tinha como saber em qual estava rodando. Aqui eles sao aposentados e
--    fica um so, que declara tambem o esforco de raciocinio, porque "pensou mais" e parte do
--    comportamento que o gestor percebe.

insert into public.model_prices (
  model, moeda, preco_in_por_milhao, preco_out_por_milhao,
  preco_cache_read_por_milhao, preco_cache_write_por_milhao, vigente_de, fonte
)
select v.model, 'USD', v.p_in, v.p_out, v.p_cache_read, v.p_cache_write, '2026-09-03'::date, v.fonte
from (values
  ('anthropic/claude-haiku-4.5', 1::numeric, 5::numeric, 0.10::numeric, 1.25::numeric,
   'OpenRouter /api/v1/models lido em 03/09/2026: $1/M in, $5/M out, cache read $0.10/M, cache write $1.25/M. Entra como rede de fallback do padrao da casa (JSON curto).'),
  ('anthropic/claude-opus-5', 5::numeric, 25::numeric, 0.50::numeric, 6.25::numeric,
   'OpenRouter /api/v1/models lido em 03/09/2026: $5/M in, $25/M out, cache read $0.50/M, cache write $6.25/M. Rede de fallback premium (sintese/coordenacao).'),
  ('google/gemini-2.5-flash', 0.30::numeric, 2.50::numeric, 0.03::numeric, 0.0833::numeric,
   'OpenRouter /api/v1/models lido em 03/09/2026: $0.30/M in, $2.50/M out, cache read $0.03/M, cache write $0.0833/M. Primeiro fallback das rotas de visao.'),
  ('google/gemini-3.7-flash', 0.75::numeric, 3.75::numeric, 0.075::numeric, 0.0417::numeric,
   'OpenRouter /api/v1/models lido em 03/09/2026: $0.75/M in, $3.75/M out, cache read $0.075/M, cache write $0.0417/M. Rede de fallback de copy/legendas.'),
  ('openai/gpt-4o-mini', 0.15::numeric, 0.60::numeric, 0.075::numeric, null::numeric,
   'OpenRouter /api/v1/models lido em 03/09/2026: $0.15/M in, $0.60/M out, cache read $0.075/M; cache write nao publicado. Rede de fallback dos JSON curtos (reco).'),
  ('openai/gpt-5.6-luna-pro', 0.20::numeric, 1.20::numeric, 0.02::numeric, 0.25::numeric,
   'OpenRouter /api/v1/models lido em 03/09/2026: $0.20/M in, $1.20/M out, cache read $0.02/M, cache write $0.25/M. Rede de fallback de prosa/leitura cruzada.')
) as v(model, p_in, p_out, p_cache_read, p_cache_write, fonte)
where not exists (
  select 1 from public.model_prices mp where mp.model = v.model and mp.vigente_ate is null
);

update public.agent_context
   set vigente = false
 where vigente = true
   and fato like 'LLM DA PLATAFORMA%';

insert into public.agent_context (company_id, categoria, fato, vigente)
values (
  'ded20b38-f42e-4c71-800c-31b97ea48bcf'::uuid,
  'sistema',
  'LLM DA PLATAFORMA (03/09/2026): UM modelo para todo agente e toda tarefa — SpaceXAI Grok 4.6 via OpenRouter (slug x-ai/grok-4.6). Vale para chat, Roteador AG-01, planner, subagentes, visao de pecas do Drive, coordenacao, sintese, compliance, legendas e templates WABA. O raciocinio do modelo e obrigatorio (nao ha como desligar) e o ESFORCO vem do modo: pesquisa profunda (tier deep do traffic-agent-job) usa xhigh; toda tarefa padrao usa high. O catalogo por faixa deixou de escolher modelo e virou rede de fallback: se o Grok cair ou recusar, o turno continua no modelo que a casa media melhor para aquele bloco. Escape: secret LLM_ROTEADOR=legado volta ao openrouter/auto. Telemetria da rota (modelo, rede, modo, esforco) em chat_messages.diagnostico.llm_rota e em telemetria.llm_rotas do job.',
  true
);
