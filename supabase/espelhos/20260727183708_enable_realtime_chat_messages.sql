-- ESPELHO DE MIGRACAO APLICADA
-- version: 20260727183708
-- name: enable_realtime_chat_messages
-- projeto: gzjwnjdpxpbmdhcyefvs (Gestor de Trafego IA)
-- aplicada por: Claude via MCP apply_migration
-- espelho gerado a partir de supabase_migrations.schema_migrations - NAO transcrito a mao

alter publication supabase_realtime add table public.chat_messages;