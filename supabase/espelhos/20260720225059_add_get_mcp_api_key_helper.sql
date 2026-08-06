-- ESPELHO DE MIGRACAO APLICADA
-- version: 20260720225059
-- name: add_get_mcp_api_key_helper
-- projeto: gzjwnjdpxpbmdhcyefvs (Gestor de Trafego IA)
-- aplicada por: Claude via MCP apply_migration
-- espelho gerado a partir de supabase_migrations.schema_migrations - NAO transcrito a mao

-- Lê a API key interna contornando o RLS deny-all da mcp_config.
-- Usada pelo cron para montar o header Authorization. NÃO exposta a anon/authenticated.
create or replace function public.get_mcp_api_key()
returns text
language sql
security definer
set search_path = public
stable
as $$ select api_key from public.mcp_config where id = 1 $$;

revoke all on function public.get_mcp_api_key() from public, anon, authenticated;
grant execute on function public.get_mcp_api_key() to postgres, service_role;