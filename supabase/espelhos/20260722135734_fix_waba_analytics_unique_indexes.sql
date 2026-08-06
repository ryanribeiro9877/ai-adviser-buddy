-- ESPELHO DE MIGRACAO APLICADA
-- version: 20260722135734
-- name: fix_waba_analytics_unique_indexes
-- projeto: gzjwnjdpxpbmdhcyefvs (Gestor de Trafego IA)
-- aplicada por: Claude via MCP apply_migration
-- espelho gerado a partir de supabase_migrations.schema_migrations - NAO transcrito a mao

-- Ajuste: upsert via PostgREST exige unique de colunas simples (índice por expressão não serve).
drop index if exists public.uq_waba_analytics_day;
alter table public.waba_analytics_daily
  alter column phone_external_id set default '',
  alter column phone_external_id set not null;
update public.waba_analytics_daily set phone_external_id = '' where phone_external_id is null;
create unique index uq_waba_analytics_day
  on public.waba_analytics_daily (waba_external_id, phone_external_id, date);

drop index if exists public.uq_waba_tpl_analytics_day;
alter table public.waba_template_analytics_daily
  alter column template_external_id set default '',
  alter column template_external_id set not null;
update public.waba_template_analytics_daily set template_external_id = '' where template_external_id is null;
create unique index uq_waba_tpl_analytics_day
  on public.waba_template_analytics_daily (waba_external_id, template_external_id, date);