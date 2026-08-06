-- ESPELHO DE MIGRACAO APLICADA
-- version: 20260724150447
-- name: f42_execucao_colunas_e_cobaia
-- projeto: gzjwnjdpxpbmdhcyefvs (Gestor de Trafego IA)
-- aplicada por: Claude via MCP apply_migration
-- espelho gerado a partir de supabase_migrations.schema_migrations - NAO transcrito a mao

-- F4.2: rastreio de execução nos pedidos + registro da campanha cobaia [TESTE-API]
-- (criada via API direto na Meta em 24/07; vazia, pausada, risco zero).
alter table public.approval_requests
  add column if not exists executed_at timestamptz,
  add column if not exists execution_result jsonb;
comment on column public.approval_requests.executed_at is 'F4.2: quando a meta-actions executou (real). Dry-run NÃO preenche (fica só no audit_log).';

insert into public.campaigns (company_id, external_id, name, status, category, provider)
select c.id, '120253980286160191', '[TESTE-API] pausa-despausa F4 — não usar', 'paused', 'leadgen', 'meta_ads'::integration_provider
from public.companies c
where c.name ilike '%legal%'
  and not exists (select 1 from public.campaigns k where k.external_id = '120253980286160191');