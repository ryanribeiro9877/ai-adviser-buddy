-- ESPELHO DE MIGRACAO APLICADA
-- version: 20260727182123
-- name: add_chat_messages_diagnostico
-- projeto: gzjwnjdpxpbmdhcyefvs (Gestor de Trafego IA)
-- aplicada por: Claude via MCP apply_migration
-- espelho gerado a partir de supabase_migrations.schema_migrations - NAO transcrito a mao

alter table public.chat_messages add column if not exists diagnostico jsonb;

comment on column public.chat_messages.diagnostico is
  'Diagnostico do turno (gravado pelo traffic-chat v19+): finish_reason, iteracoes, preambulos_detectados/recuperados, ms_total, deadline_tools. Antes do v19 esses sinais existiam apenas na resposta HTTP, que e efemera - nao havia como medir historicamente.';