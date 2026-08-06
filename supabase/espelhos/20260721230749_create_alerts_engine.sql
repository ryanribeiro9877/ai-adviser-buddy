-- ESPELHO DE MIGRACAO APLICADA
-- version: 20260721230749
-- name: create_alerts_engine
-- projeto: gzjwnjdpxpbmdhcyefvs (Gestor de Trafego IA)
-- aplicada por: Claude via MCP apply_migration
-- espelho gerado a partir de supabase_migrations.schema_migrations - NAO transcrito a mao

-- ============================================================
-- MOTOR DE ALERTAS
-- Regras configuráveis por empresa em public.alert_rules;
-- public.evaluate_alerts() avalia as regras ativas e grava em public.alerts.
-- Idempotente: a cada rodada apaga alertas NÃO resolvidos vindos de regra e re-gera.
-- ============================================================

-- 1) Semear regras padrão por empresa (guardado por NOT EXISTS; não duplica; edições do usuário persistem)
insert into public.alert_rules (company_id, name, scope, metric, comparator, threshold, window_days, severity, active)
select co.id, r.name, r.scope, r.metric, r.comparator, r.threshold, r.window_days, r.severity::alert_severity, true
from public.companies co
cross join lateral (values
  -- CPL acima do alvo: 1,8x o CPL médio da empresa (fallback 5,00 quando não há leads)
  ('CPL acima do alvo', 'campaign', 'cpl', '>',
     round(coalesce(1.8 * nullif((select sum(spend) from public.campaigns c where c.company_id = co.id), 0)
                        / nullif((select sum(leads) from public.campaigns c where c.company_id = co.id), 0), 5.00), 2),
     30, 'high'),
  ('Frequência alta (fadiga)', 'campaign', 'frequency', '>=', 3.5, 7, 'medium'),
  ('Campanha ativa sem entrega', 'campaign', 'no_delivery', '<', 1, 3, 'medium'),
  ('Gasto sem conversão', 'campaign', 'spend_no_leads', '>', 100, 30, 'high')
) as r(name, scope, metric, comparator, threshold, window_days, severity)
where not exists (
  select 1 from public.alert_rules ar where ar.company_id = co.id and ar.name = r.name
);

-- 2) Função avaliadora
create or replace function public.evaluate_alerts()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare total int;
begin
  -- refresh: remove alertas não resolvidos gerados por regra (preserva resolvidos e manuais)
  delete from public.alerts where resolved = false and rule_id is not null;

  -- R1: CPL acima do alvo (campanhas ATIVAS de lead/mensagem, com leads, CPL agregado > alvo)
  insert into public.alerts (company_id, severity, title, description, resolved, rule_id, campaign_id, triggered_value)
  select c.company_id, r.severity, r.name,
         'CPL atual R$ ' || to_char(c.spend / nullif(c.leads,0), 'FM999990.00') ||
         ' — acima do alvo R$ ' || to_char(r.threshold, 'FM999990.00') || ' (campanha ' || c.name || ')',
         false, r.id, c.id, round(c.spend / nullif(c.leads,0), 2)
  from public.alert_rules r
  join public.campaigns c on c.company_id = r.company_id and c.status = 'active'
  where r.active and r.metric = 'cpl'
    and coalesce(c.category,'') in ('leadgen','mensagem')
    and c.leads > 0
    and (c.spend / c.leads) > r.threshold;

  -- R2: Frequência alta / fadiga (campanhas ATIVAS)
  insert into public.alerts (company_id, severity, title, description, resolved, rule_id, campaign_id, triggered_value)
  select c.company_id, r.severity, r.name,
         'Frequência ' || to_char(c.frequency, 'FM990.0') ||
         ' (limite ' || to_char(r.threshold, 'FM990.0') || ') — possível fadiga de criativo em ' || c.name,
         false, r.id, c.id, round(c.frequency, 2)
  from public.alert_rules r
  join public.campaigns c on c.company_id = r.company_id and c.status = 'active'
  where r.active and r.metric = 'frequency'
    and c.frequency >= r.threshold;

  -- R3: Campanha ativa sem entrega (entregou nos últimos 14d mas 0 impressões na janela) -> "foi ao ar e parou"
  insert into public.alerts (company_id, severity, title, description, resolved, rule_id, campaign_id, triggered_value)
  select c.company_id, r.severity, r.name,
         'Campanha ativa sem entrega há ' ||
         (current_date - (select max(s.snapshot_date) from public.metric_snapshots s where s.campaign_id = c.id)) ||
         ' dia(s) — ' || c.name,
         false, r.id, c.id,
         (current_date - (select max(s.snapshot_date) from public.metric_snapshots s where s.campaign_id = c.id))::numeric
  from public.alert_rules r
  join public.campaigns c on c.company_id = r.company_id and c.status = 'active'
  where r.active and r.metric = 'no_delivery'
    and exists (select 1 from public.metric_snapshots s
                 where s.campaign_id = c.id and s.snapshot_date >= current_date - 14)
    and not exists (select 1 from public.metric_snapshots s
                     where s.campaign_id = c.id and s.snapshot_date >= current_date - r.window_days
                       and s.impressions > 0);

  -- R4: Gasto sem conversão (ATIVAS de lead/mensagem, gasto > limite, 0 leads) -> NÃO pega tráfego/engajamento
  insert into public.alerts (company_id, severity, title, description, resolved, rule_id, campaign_id, triggered_value)
  select c.company_id, r.severity, r.name,
         'Gastou R$ ' || to_char(c.spend, 'FM999990.00') || ' sem nenhum lead — ' || c.name,
         false, r.id, c.id, round(c.spend, 2)
  from public.alert_rules r
  join public.campaigns c on c.company_id = r.company_id and c.status = 'active'
  where r.active and r.metric = 'spend_no_leads'
    and coalesce(c.category,'') in ('leadgen','mensagem')
    and c.leads = 0
    and c.spend > r.threshold;

  select count(*) into total from public.alerts where resolved = false and rule_id is not null;
  return total;
end $$;

grant execute on function public.evaluate_alerts() to service_role;