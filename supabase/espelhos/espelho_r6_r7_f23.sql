-- ============================================================================
-- ESPELHO: F2.3 — Novas regras de alerta: R6 (queda de entrega) + R7 (orçamento)
-- Projeto: gestão_marketing (gzjwnjdpxpbmdhcyefvs) · Aplicada: 23/07/2026
-- Migração: f23_r6_r7_entrega_orcamento (evaluate_alerts v4)
-- ATENÇÃO: espelho para git. NÃO re-executar. O corpo COMPLETO da v4 (R1-R7)
-- está na migração no banco; este espelho registra os SEEDS e as DUAS REGRAS
-- NOVAS na íntegra (R1-R5 são idênticas aos espelhos anteriores:
-- espelho_evaluate_alerts_v2_f13.sql e espelho_regra_3_dias_f2.sql).
--
-- R6 delivery_drop (medium, threshold=50 = % piso, window_days=3):
--   média de impressões dos últimos 3d < 50% da média dos 7d anteriores;
--   volume mínimo: base >= 500 imp/dia (não alerta campanha minúscula).
--   Divisão de trabalho com a R3: entrega ZERADA = R3; queda PARCIAL = R6
--   (sem alarme duplo — verificado nos dados reais).
-- R7 budget (high, threshold=20 = % tolerância, window_days=1):
--   gasto de ONTEM > soma dos daily_budget dos adsets ATIVOS × 1,20.
--   ATENÇÃO UNIDADE: daily_budget vem da Meta em CENTAVOS -> dividir por 100
--   (verificado: LEV LP soma 14400 = R$144/dia vs gasto real ~R$125/dia).
--   Sem budget conhecido -> ramo PICO: ontem > 1,8x média 7d anteriores e > R$50.
--
-- NOTA F2.3 checklist: o item "CPL lendo targets" já estava entregue desde a
-- migração alerts_r1_cpl_le_target_vivo (F1.3) — ver espelho_evaluate_alerts_v2.
--
-- AUDITORIA DE FALSOS POSITIVOS (23/07/2026, dados reais):
--   v4 com dados reais -> 2 alertas (mesmos do baseline; R6/R7 em silêncio).
--   Silêncio LEGÍTIMO, conferido na régua: LEV LP a 115% da entrega-base e
--   gasto ontem R$125,01 < budget R$144; LEV_WPP-CTWA sem entrega (coberta
--   pela R3, R6 não duplica). Cenário sintético [TESTE] (entrega 1000->100
--   imp/dia + gasto 100 com budget 50) -> R6 disparou ("caiu para 10%") e R7
--   disparou ("excede em 100%"); limpeza -> baseline 2, zero resíduo.
-- ============================================================================

-- Seeds (1 de cada por empresa)
insert into public.alert_rules (company_id, name, scope, metric, comparator, threshold, window_days, severity, active)
select id, 'Queda de entrega', 'campaign', 'delivery_drop', '<', 50, 3, 'medium', true
from public.companies
on conflict do nothing;
insert into public.alert_rules (company_id, name, scope, metric, comparator, threshold, window_days, severity, active)
select id, 'Gasto acima do orçamento', 'campaign', 'budget', '>', 20, 1, 'high', true
from public.companies
on conflict do nothing;

-- Trechos NOVOS da evaluate_alerts v4 (R6 e R7; R1-R5 inalteradas):

  -- R6: Queda de entrega (média 3d < threshold% da média dos 7d anteriores; base >= 500 imp/dia)
  -- insert into public.alerts (company_id, severity, title, description, resolved, rule_id, campaign_id, triggered_value)
  -- select c.company_id, r.severity, r.name,
  --        'Entrega caiu para ' || w.pct || '% da média anterior (últimos ' || r.window_days || 'd: ' ||
  --        w.media_recente || ' imp/dia vs ' || w.media_base || ' imp/dia nos 7d anteriores) — ' || c.name,
  --        false, r.id, c.id, w.pct
  -- from public.alert_rules r
  -- join public.campaigns c on c.company_id = r.company_id and c.status = 'active'
  -- cross join lateral (
  --   select round(avg(s.impressions) filter (where s.snapshot_date >= current_date - r.window_days)) as media_recente,
  --          round(avg(s.impressions) filter (where s.snapshot_date <  current_date - r.window_days
  --                                       and s.snapshot_date >= current_date - r.window_days - 7)) as media_base,
  --          round(100 * avg(s.impressions) filter (where s.snapshot_date >= current_date - r.window_days)
  --                / nullif(avg(s.impressions) filter (where s.snapshot_date < current_date - r.window_days
  --                                                and s.snapshot_date >= current_date - r.window_days - 7), 0)) as pct
  --   from public.metric_snapshots s
  --   where s.campaign_id = c.id and s.snapshot_date >= current_date - r.window_days - 7
  -- ) w
  -- where r.active and r.metric = 'delivery_drop'
  --   and w.media_base >= 500
  --   and w.media_recente is not null
  --   and w.pct < r.threshold;

  -- R7: Orçamento (gasto de ontem vs soma dos daily_budget dos adsets ATIVOS; centavos -> /100)
  -- insert into public.alerts (company_id, severity, title, description, resolved, rule_id, campaign_id, triggered_value)
  -- select c.company_id, r.severity, r.name,
  --        case when b.budget_dia is not null then
  --          'Gasto de ontem R$ ' || to_char(g.gasto_ontem,'FM999990.00') || ' excede o orçamento diário R$ ' ||
  --          to_char(b.budget_dia,'FM999990.00') || ' em ' ||
  --          round(100 * (g.gasto_ontem / b.budget_dia - 1)) || '% — ' || c.name
  --        else
  --          'Pico de gasto: ontem R$ ' || to_char(g.gasto_ontem,'FM999990.00') || ' vs média 7d R$ ' ||
  --          to_char(g.media_7d,'FM999990.00') || ' (' || round(g.gasto_ontem / nullif(g.media_7d,0), 1) || 'x) — ' || c.name
  --        end,
  --        false, r.id, c.id, round(g.gasto_ontem, 2)
  -- from public.alert_rules r
  -- join public.campaigns c on c.company_id = r.company_id and c.status = 'active'
  -- cross join lateral (
  --   select (select s.spend from public.metric_snapshots s
  --            where s.campaign_id = c.id and s.snapshot_date = current_date - 1) as gasto_ontem,
  --          (select avg(s.spend) from public.metric_snapshots s
  --            where s.campaign_id = c.id and s.snapshot_date < current_date - 1
  --              and s.snapshot_date >= current_date - 8) as media_7d
  -- ) g
  -- cross join lateral (
  --   select sum(ast.daily_budget) / 100.0 as budget_dia
  --   from public.ad_sets ast
  --   where ast.campaign_id = c.id and upper(coalesce(ast.status,'')) = 'ACTIVE'
  --     and ast.daily_budget is not null
  -- ) b
  -- where r.active and r.metric = 'budget'
  --   and g.gasto_ontem is not null
  --   and (
  --     (b.budget_dia is not null and b.budget_dia > 0
  --       and g.gasto_ontem > b.budget_dia * (1 + r.threshold / 100.0))
  --     or
  --     (b.budget_dia is null and g.media_7d is not null and g.media_7d > 0
  --       and g.gasto_ontem > 1.8 * g.media_7d and g.gasto_ontem > 50)
  --   );
