-- ESPELHO DE MIGRACAO APLICADA
-- version: 20260807170319
-- name: retorno_de_ferramenta_persistido_em_chat_messages
-- projeto: gzjwnjdpxpbmdhcyefvs (Gestor de Trafego IA)
-- aplicada por: Claude via MCP apply_migration
-- espelho gerado a partir de supabase_migrations.schema_migrations - NAO transcrito a mao

-- O historico da conversa era remontado de role+content apenas. chat_messages.tool_calls
-- guarda NOME e ARGUMENTOS da chamada e nunca o JSON devolvido: o retorno de cada
-- ferramenta vivia so no array 'messages' em memoria da edge e morria com a requisicao.
-- Medido na conversa 5b08d921-9fa9-4d20-b63e-3db71dbcb8cc (07/08/2026): a 1a requisicao
-- chamou 9 ferramentas e terminou em finish_reason=length; a continuacao entrou com
-- tools:[] e escreveu "Nao consegui chamar a regua de teto vigente nesta rodada" - era
-- VERDADE do ponto de vista dela, porque o sistema esvaziou o contexto entre as duas.
--
-- Coluna PROPRIA e nao um campo dentro de diagnostico: diagnostico e telemetria pequena e
-- lida com frequencia (sondas e auditorias fazem select diagnostico); o retorno de
-- ferramenta chega a 14.000 chars POR ferramenta (mesmo corte que a edge ja aplica antes
-- de mandar ao modelo) e ate 12 ferramentas por turno. Misturar os dois faria toda leitura
-- de telemetria arrastar ate ~170 KB de payload de dado.
alter table public.chat_messages add column if not exists tool_results jsonb;

comment on column public.chat_messages.tool_results is
  'Retorno de cada ferramenta executada na rodada que produziu esta mensagem, na ordem de execucao: [{tool, args, chars, cortado, retorno}]. retorno e o objeto devolvido pela tool, ou a string ja cortada em 14000 chars quando o payload excedeu - o MESMO corte que o modelo viu. Existe para a continuacao enxergar o que ja foi apurado em vez de relatar falsamente que nao conseguiu chamar a ferramenta. NAO e telemetria: telemetria fica em diagnostico.';
