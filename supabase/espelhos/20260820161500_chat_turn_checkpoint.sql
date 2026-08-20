-- Checkpoint de turno sincrono (traffic-chat), espelho do chat_jobs.checkpoint.
-- Quando o orcamento de ~2 min esgota no meio de um pedido (sobretudo ato/criar),
-- a edge grava o ponto de parada aqui e o front (ou a propria edge) retoma
-- automaticamente — sem pedir ao gestor para "focar" ou reenviar.

alter table public.chat_conversations
  add column if not exists turn_checkpoint jsonb;

comment on column public.chat_conversations.turn_checkpoint is
  'Checkpoint do turno sincrono traffic-chat: objetivo, tools/cards ja feitos, segmento. Null = sem continuacao pendente.';
