-- ESPELHO DE MIGRACAO APLICADA
-- version: 20260723114336
-- name: alert_rules_scope_ad_e_seed_pause3d
-- projeto: gzjwnjdpxpbmdhcyefvs (Gestor de Trafego IA)
-- aplicada por: Claude via MCP apply_migration
-- espelho gerado a partir de supabase_migrations.schema_migrations - NAO transcrito a mao

-- F2: a regra dos 3 dias tem escopo de CRIATIVO (anúncio). Amplia o check de
-- scope para incluir 'ad' e semeia a regra (1 por empresa, severidade critical).
alter table public.alert_rules drop constraint alert_rules_scope_chk;
alter table public.alert_rules add constraint alert_rules_scope_chk
  check (scope = any (array['campaign'::text,'company'::text,'ad'::text]));

insert into public.alert_rules (company_id, name, scope, metric, comparator, threshold, window_days, severity, active)
select id, 'Regra dos 3 dias — criativo acima do teto', 'ad', 'pause_3d', '>', 0, 3, 'critical', true
from public.companies
on conflict do nothing;