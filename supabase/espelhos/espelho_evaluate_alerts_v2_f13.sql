-- ============================================================================
-- ESPELHO: migração alerts_r1_cpl_le_target_vivo — evaluate_alerts v2 (F1.3)
-- Projeto: gestão_marketing (gzjwnjdpxpbmdhcyefvs) · Aplicada: 22/07/2026
-- ATENÇÃO: espelho para versionamento em git. NÃO re-executar manualmente
-- (já aplicada via apply_migration).
--
-- O QUE MUDA: apenas a R1 (CPL). O teto passa a vir de public.targets
-- (métrica custo_por_lead_dashboard, escopo empresa), com fallback para
-- alert_rules.threshold quando não houver target ativo. Editar a meta na UI
-- recalibra o alerta imediatamente, sem tocar em alert_rules.
-- R2 (frequência), R3 (sem entrega) e R4 (gasto sem lead) permanecem idênticas.
-- Descrição do alerta indica a origem do alvo: [alvo: metas] ou [alvo: regra].
--
-- VALIDAÇÃO (22/07/2026): baseline 2 alertas → teto artificial R$0,01 em
-- targets → 8 alertas (6 CPL novos, descrição "[alvo: metas]") → teto
-- restaurado R$2,40 → 2 alertas. Integração provada mudando SÓ o target.
-- ============================================================================

create or replace function public.evaluate_alerts()
 returns integer
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare total int;
begin
  -- refresh: remove alertas não resolvidos gerados por regra (preserva resolvidos e manuais)
  delete from public.alerts where resolved = false and rule_id is not null;

  -- R1: CPL acima do alvo (teto VIVO de targets; fallback threshold da regra)
  insert into public.alerts (company_id, severity, title, description, resolved, rule_id, campaign_id, triggered_value)
  select c.company_id, r.severity, r.name,
         'CPL atual R$ ' || to_char(c.spend / nullif(c.leads,0), 'FM999990.00') ||
         ' — acima do alvo R$ ' || to_char(coalesce(t.valor, r.threshold), 'FM999990.00') ||
         ' (campanha ' || c.name || ')' ||
         case when t.valor is not null then ' [alvo: metas]' else ' [alvo: regra]' end,
         false, r.id, c.id, round(c.spend / nullif(c.leads,0), 2)
  from public.alert_rules r
  join public.campaigns c on c.company_id = r.company_id and c.status = 'active'
  left join public.targets t on t.company_id = r.company_id
       and t.metric = 'custo_por_lead_dashboard' and t.active and t.campaign_id is null
  where r.active and r.metric = 'cpl'
    and coalesce(c.category,'') in ('leadgen','mensagem')
    and c.leads > 0
    and (c.spend / c.leads) > coalesce(t.valor, r.threshold);

  -- R2: Frequência alta / fadiga (campanhas ATIVAS) — INALTERADA
  insert into public.alerts (company_id, severity, title, description, resolved, rule_id, campaign_id, triggered_value)
  select c.company_id, r.severity, r.name,
         'Frequência ' || to_char(c.frequency, 'FM990.0') ||
         ' (limite ' || to_char(r.threshold, 'FM990.0') || ') — possível fadiga de criativo em ' || c.name,
         false, r.id, c.id, round(c.frequency, 2)
  from public.alert_rules r
  join public.campaigns c on c.company_id = r.company_id and c.status = 'active'
  where r.active and r.metric = 'frequency'
    and c.frequency >= r.threshold;

  -- R3: Campanha ativa sem entrega — INALTERADA
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

  -- R4: Gasto sem conversão — INALTERADA
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
end $function$;
