-- ============================================================================
-- ESPELHO: targets — metas & tetos configuráveis (F1.3)
-- Projeto: gestão_marketing (gzjwnjdpxpbmdhcyefvs) · Gerado: 22/07/2026
-- ATENÇÃO: espelho para versionamento em git. NÃO re-executar em produção
-- (objetos já existem). Estado fiel ao banco em 22/07/2026.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- Tabela
-- ---------------------------------------------------------------------------
create table public.targets (
  id          uuid primary key default gen_random_uuid(),
  company_id  uuid not null references public.companies(id),
  metric      text not null,          -- custo_por_conversa | custo_por_formulario
                                      -- | custo_por_lead_lp | custo_por_lead_dashboard
  valor       numeric not null,       -- teto em R$
  campaign_id uuid references public.campaigns(id),  -- null = teto da empresa
  fonte       text not null,          -- 'derivado_meta_p75_diario' | 'comando' | 'manual'
  memoria     jsonb,                  -- trilha de auditoria (como foi derivado, testes, etc.)
  active      boolean not null default true,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

-- Unicidade: 1 teto por empresa+métrica (escopo empresa) e 1 por campanha+métrica
create unique index uq_targets_company_metric
  on public.targets (company_id, metric) where (campaign_id is null);
create unique index uq_targets_campaign_metric
  on public.targets (company_id, metric, campaign_id) where (campaign_id is not null);

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------
alter table public.targets enable row level security;

create policy targets_select on public.targets
  for select using (is_company_member(company_id, auth.uid()));

create policy targets_admin_all on public.targets
  for all using (has_role(auth.uid(), 'admin'::app_role));

-- ---------------------------------------------------------------------------
-- Seed vigente (derivado dos dados Meta: p75 do custo diário histórico,
-- dias com spend >= R$10, mar/2026 → hoje, arredondado p/ cima em R$0,05)
-- Valores confirmados no banco em 22/07/2026:
-- ---------------------------------------------------------------------------
-- Legal é Viver:
--   custo_por_lead_dashboard = 2.40
--   custo_por_formulario     = 2.30
--   custo_por_lead_lp        = 1.50
--   custo_por_conversa       = 1.55
-- COHAPM (amostra pequena, marcado na memoria):
--   custo_por_lead_lp        = 6.85
--   custo_por_conversa       = 21.80
--   custo_por_lead_dashboard = 21.80
--
-- Governança (decisão 21/07): fonte da verdade é o dado (p75). Comando do
-- Roberto via chat sobrescreve com fonte='comando' (aspiracional convive com
-- benchmark; a memoria guarda ambos).
--
-- Teste de disparo (22/07, F1.3 item 4): teto Legal custo_por_lead_dashboard
-- foi posto artificialmente em 0.01 → evaluate_alerts() disparou 8 alertas
-- (baseline 2) → restaurado 2.40 → voltou a 2. Trilha na coluna memoria.
