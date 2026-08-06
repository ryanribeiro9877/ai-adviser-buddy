-- ESPELHO DE MIGRACAO APLICADA
-- version: 20260720191423
-- name: add_monitoring_backbone_snapshots_and_rules
-- projeto: gzjwnjdpxpbmdhcyefvs (Gestor de Trafego IA)
-- aplicada por: Claude via MCP apply_migration
-- espelho gerado a partir de supabase_migrations.schema_migrations - NAO transcrito a mao

-- ============================================================
-- Camada de monitoramento (aditiva). Nao altera tabelas existentes de forma destrutiva.
-- ============================================================

-- 1) Serie temporal de metricas (a espinha do monitoramento).
create table if not exists public.metric_snapshots (
  id            uuid primary key default gen_random_uuid(),
  company_id    uuid not null references public.companies(id) on delete cascade,
  campaign_id   uuid not null references public.campaigns(id) on delete cascade,
  provider      integration_provider not null,
  snapshot_date date not null,
  spend         numeric not null default 0,
  impressions   bigint  not null default 0,
  reach         bigint  not null default 0,
  clicks        bigint  not null default 0,
  leads         bigint  not null default 0,
  sales         bigint  not null default 0,
  revenue       numeric not null default 0,
  frequency     numeric not null default 0,
  source        text    not null default 'windsor',
  created_at    timestamptz not null default now(),
  unique (campaign_id, snapshot_date)
);

create index if not exists idx_metric_snapshots_company_date on public.metric_snapshots (company_id, snapshot_date desc);
create index if not exists idx_metric_snapshots_campaign_date on public.metric_snapshots (campaign_id, snapshot_date desc);

alter table public.metric_snapshots enable row level security;

create policy "members read snapshots" on public.metric_snapshots
  for select to authenticated using (is_company_member(company_id, auth.uid()));
create policy "admins write snapshots" on public.metric_snapshots
  for insert to authenticated with check (has_role(auth.uid(), 'admin'::app_role));
create policy "admins update snapshots" on public.metric_snapshots
  for update to authenticated using (has_role(auth.uid(), 'admin'::app_role));

-- 2) Regras de alerta com threshold (o motor que gera linhas em `alerts`).
create table if not exists public.alert_rules (
  id          uuid primary key default gen_random_uuid(),
  company_id  uuid not null references public.companies(id) on delete cascade,
  name        text not null,
  scope       text not null default 'campaign',   -- 'campaign' | 'company'
  metric      text not null,                        -- 'cpl' | 'roas' | 'frequency' | 'spend' | 'ctr' | 'cpa'
  comparator  text not null,                        -- '>' | '<' | '>=' | '<=' | 'pct_change_up' | 'pct_change_down'
  threshold   numeric not null,
  window_days int not null default 1,
  severity    alert_severity not null default 'medium',
  active       boolean not null default true,
  created_by  uuid references auth.users(id),
  created_at  timestamptz not null default now(),
  constraint alert_rules_scope_chk      check (scope in ('campaign','company')),
  constraint alert_rules_comparator_chk check (comparator in ('>','<','>=','<=','pct_change_up','pct_change_down'))
);

create index if not exists idx_alert_rules_company_active on public.alert_rules (company_id) where active;

alter table public.alert_rules enable row level security;

create policy "members read rules" on public.alert_rules
  for select to authenticated using (is_company_member(company_id, auth.uid()));
create policy "admins write rules" on public.alert_rules
  for insert to authenticated with check (has_role(auth.uid(), 'admin'::app_role));
create policy "admins update rules" on public.alert_rules
  for update to authenticated using (has_role(auth.uid(), 'admin'::app_role));
create policy "admins delete rules" on public.alert_rules
  for delete to authenticated using (has_role(auth.uid(), 'admin'::app_role));

-- 3) Rastreabilidade em `alerts` (colunas NULLABLE -> nao quebra o frontend, que as ignora).
alter table public.alerts add column if not exists rule_id         uuid references public.alert_rules(id) on delete set null;
alter table public.alerts add column if not exists campaign_id     uuid references public.campaigns(id) on delete set null;
alter table public.alerts add column if not exists triggered_value numeric;