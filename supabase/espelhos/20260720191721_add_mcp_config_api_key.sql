-- ESPELHO DE MIGRACAO APLICADA
-- version: 20260720191721
-- name: add_mcp_config_api_key
-- projeto: gzjwnjdpxpbmdhcyefvs (Gestor de Trafego IA)
-- aplicada por: Claude via MCP apply_migration
-- espelho gerado a partir de supabase_migrations.schema_migrations - NAO transcrito a mao

create table if not exists public.mcp_config (
  id         int primary key default 1,
  api_key    text not null,
  created_at timestamptz not null default now(),
  constraint mcp_config_singleton check (id = 1)
);

insert into public.mcp_config (id, api_key)
values (1, replace(gen_random_uuid()::text,'-','') || replace(gen_random_uuid()::text,'-',''))
on conflict (id) do nothing;

-- RLS habilitado SEM policy => anon/authenticated nao leem (deny-all); apenas service_role (bypass) enxerga.
alter table public.mcp_config enable row level security;