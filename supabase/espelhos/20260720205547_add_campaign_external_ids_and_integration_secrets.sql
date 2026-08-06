-- ESPELHO DE MIGRACAO APLICADA
-- version: 20260720205547
-- name: add_campaign_external_ids_and_integration_secrets
-- projeto: gzjwnjdpxpbmdhcyefvs (Gestor de Trafego IA)
-- aplicada por: Claude via MCP apply_migration
-- espelho gerado a partir de supabase_migrations.schema_migrations - NAO transcrito a mao

-- Vinculo externo nas campanhas (para upsert por id da plataforma)
alter table public.campaigns add column if not exists external_id          text;
alter table public.campaigns add column if not exists external_account_id  text;
alter table public.campaigns add column if not exists last_synced_at       timestamptz;

-- unique para upsert por (provider, external_id). Nulls nao conflitam -> campanhas antigas sem external_id ficam ok.
create unique index if not exists uq_campaigns_provider_external on public.campaigns (provider, external_id);

-- Cofre simples de segredos de integracao. RLS deny-all: apenas service_role (bypass) le/escreve.
create table if not exists public.integration_secrets (
  name       text primary key,
  value      text not null,
  updated_at timestamptz not null default now()
);
alter table public.integration_secrets enable row level security;