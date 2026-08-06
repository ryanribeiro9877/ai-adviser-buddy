-- ESPELHO DE MIGRACAO APLICADA
-- version: 20260722171008
-- name: create_targets_seed_from_meta_data
-- projeto: gzjwnjdpxpbmdhcyefvs (Gestor de Trafego IA)
-- aplicada por: Claude via MCP apply_migration
-- espelho gerado a partir de supabase_migrations.schema_migrations - NAO transcrito a mao

-- ============================================================
-- METAS/TETOS (targets) — derivados 100% dos dados reais da Meta (via snapshots diários)
-- Regra: teto = p75 do custo diário histórico (dias-campanha com spend>=10, mar->hoje),
-- arredondado p/ cima em passos de R$0,05. Memória de cálculo gravada em jsonb.
-- ============================================================
create table if not exists public.targets (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  metric text not null,                  -- custo_por_conversa | custo_por_formulario | custo_por_lead_lp | custo_por_lead_dashboard
  valor numeric not null,
  campaign_id uuid references public.campaigns(id) on delete cascade,  -- null = empresa toda
  fonte text not null default 'derivado_meta_p75_diario',
  memoria jsonb,                         -- p50/p75/p90, nº de dias, janela, regra
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index if not exists uq_targets_company_metric
  on public.targets (company_id, metric) where campaign_id is null;
create unique index if not exists uq_targets_campaign_metric
  on public.targets (company_id, metric, campaign_id) where campaign_id is not null;
alter table public.targets enable row level security;
create policy "targets_select" on public.targets for select using (public.is_company_member(company_id, auth.uid()));
create policy "targets_admin_all" on public.targets for all using (public.has_role(auth.uid(),'admin')) with check (public.has_role(auth.uid(),'admin'));

-- SEED (valores = p75 real arredondado; memória completa)
insert into public.targets (company_id, metric, valor, memoria)
select co.id, v.metric, v.valor, v.memoria
from public.companies co
join lateral (values
  -- Legal é Viver
  ('custo_por_conversa',       1.55, '{"p50":1.21,"p75":1.54,"p90":2.64,"dias":37,"janela":"2026-03-03..hoje","regra":"p75 diario, spend>=10"}'::jsonb, 'Legal é Viver'),
  ('custo_por_formulario',     2.30, '{"p50":2.03,"p75":2.30,"p90":2.66,"dias":70,"janela":"2026-03-03..hoje","regra":"p75 diario, spend>=10"}'::jsonb, 'Legal é Viver'),
  ('custo_por_lead_lp',        1.50, '{"p50":1.13,"p75":1.50,"p90":3.10,"dias":159,"janela":"2026-03-03..hoje","regra":"p75 diario, spend>=10"}'::jsonb, 'Legal é Viver'),
  ('custo_por_lead_dashboard', 2.40, '{"p50":1.97,"p75":2.39,"p90":6.28,"dias":119,"janela":"2026-03-03..hoje","regra":"p75 diario, spend>=10"}'::jsonb, 'Legal é Viver'),
  -- COHAPM (amostra menor: campanhas de março; sem formulários — não semeado)
  ('custo_por_conversa',       21.80, '{"p50":16.79,"p75":21.80,"p90":26.86,"dias":12,"janela":"2026-03","regra":"p75 diario, spend>=10","nota":"amostra pequena"}'::jsonb, 'COHAPM'),
  ('custo_por_lead_lp',         6.85, '{"p50":6.01,"p75":6.84,"p90":11.83,"dias":13,"janela":"2026-03","regra":"p75 diario, spend>=10","nota":"amostra pequena"}'::jsonb, 'COHAPM'),
  ('custo_por_lead_dashboard', 21.80, '{"p50":16.79,"p75":21.80,"p90":26.86,"dias":12,"janela":"2026-03","regra":"p75 diario, spend>=10","nota":"amostra pequena"}'::jsonb, 'COHAPM')
) as v(metric, valor, memoria, empresa) on co.name = v.empresa
on conflict do nothing;

-- RECALIBRAR o motor de alertas: regra 'CPL acima do alvo' passa a usar o teto derivado
-- (a regra avalia spend/leads agregado da campanha = métrica custo_por_lead_dashboard)
update public.alert_rules ar
set threshold = t.valor
from public.targets t
where t.company_id = ar.company_id
  and t.metric = 'custo_por_lead_dashboard'
  and ar.name = 'CPL acima do alvo';