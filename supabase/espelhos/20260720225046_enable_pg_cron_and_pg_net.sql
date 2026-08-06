-- ESPELHO DE MIGRACAO APLICADA
-- version: 20260720225046
-- name: enable_pg_cron_and_pg_net
-- projeto: gzjwnjdpxpbmdhcyefvs (Gestor de Trafego IA)
-- aplicada por: Claude via MCP apply_migration
-- espelho gerado a partir de supabase_migrations.schema_migrations - NAO transcrito a mao

create extension if not exists pg_net;
create extension if not exists pg_cron;