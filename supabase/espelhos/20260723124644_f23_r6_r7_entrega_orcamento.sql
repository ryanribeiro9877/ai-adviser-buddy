-- ESPELHO DE MIGRACAO APLICADA
-- version: 20260723124644
-- name: f23_r6_r7_entrega_orcamento
-- projeto: gzjwnjdpxpbmdhcyefvs (Gestor de Trafego IA)
-- aplicada por: Claude via MCP apply_migration
-- espelho gerado a partir de supabase_migrations.schema_migrations - NAO transcrito a mao

-- F2.3 — evaluate_alerts v4: R6 (queda de entrega) + R7 (orçamento). R1-R5 IDÊNTICAS à v3.
-- R6 delivery_drop (medium, threshold=50 = % piso, window_days=3): média de impressões
--    dos últimos 3d < 50% da média dos 7d anteriores; volume mínimo 500 imp/dia na base.
-- R7 budget (high, threshold=20 = % tolerância): gasto de ontem > soma dos daily_budget
--    (CENTAVOS -> /100) dos adsets ATIVOS × 1,20; sem budget conhecido, ramo pico:
--    gasto ontem > 1,8x média 7d anteriores e > R$50.
-- Seeds: 1 regra de cada por empresa.
insert into public.alert_rules (company_id, name, scope, metric, comparator, threshold, window_days, severity, active)
select id, 'Queda de entrega', 'campaign', 'delivery_drop', '<', 50, 3, 'medium', true
from public.companies
on conflict do nothing;
insert into public.alert_rules (company_id, name, scope, metric, comparator, threshold, window_days, severity, active)
select id, 'Gasto acima do orçamento', 'campaign', 'budget', '>', 20, 1, 'high', true
from public.companies
on conflict do nothing;

create or replace function public.evaluate_alerts()
 returns integer
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare total int;
begin
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

  -- R2: Frequência alta / fadiga — INALTERADA
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

  -- R5: Regra dos 3 dias — INALTERADA (v3)
  insert into public.alerts (company_id, severity, title, description, resolved, rule_id, campaign_id, triggered_value)
  select agg.company_id, r.severity, r.name,
         'Criativo "' || agg.ad_name || '" há 3 dias acima do teto R$ ' || to_char(agg.teto,'FM999990.00') ||
         ' (' || agg.metric_label || '): ' ||
         'D-2 ' || agg.c2_txt || ', D-1 ' || agg.c1_txt || ', último dia ' || agg.c0_txt ||
         ' — recomendação: PAUSAR (sem tendência de queda). Campanha ' || agg.camp_name,
         false, r.id, agg.campaign_id, agg.c0_num
  from (
    with last3 as (
      select s.ad_external_id, s.snapshot_date, s.spend,
             case when c.category = 'mensagem' then s.messaging_started else s.form_leads end as results,
             a.name as ad_name, c.id as campaign_id, c.company_id, c.name as camp_name, c.category,
             row_number() over (partition by s.ad_external_id order by s.snapshot_date desc) as rn
      from public.ad_metric_snapshots s
      join public.ads a on a.external_id = s.ad_external_id
      join public.campaigns c on c.id = a.campaign_id
      where c.status = 'active'
        and coalesce(c.category,'') in ('leadgen','mensagem')
        and upper(coalesce(a.status,'ACTIVE')) in ('ACTIVE','ADSET_PAUSED_OVERRIDE')
        and s.snapshot_date >= current_date - 14
        and s.spend > 0
    ), agg0 as (
      select ad_external_id,
             max(ad_name) as ad_name, max(camp_name) as camp_name, max(category) as category,
             max(company_id::text)::uuid as company_id, max(campaign_id::text)::uuid as campaign_id,
             count(*) filter (where rn <= 3) as dias,
             max(snapshot_date) filter (where rn = 1) as d0_date,
             max(spend)   filter (where rn = 1) as s0, max(results) filter (where rn = 1) as r0,
             max(spend)   filter (where rn = 2) as s1, max(results) filter (where rn = 2) as r1,
             max(spend)   filter (where rn = 3) as s2, max(results) filter (where rn = 3) as r2
      from last3 where rn <= 3
      group by ad_external_id
    )
    select a0.*,
           t.teto, t.metric_label,
           case when a0.r0 > 0 then round(a0.s0 / a0.r0, 2) end as c0_num,
           case when a0.r0 > 0 then 'R$ ' || to_char(a0.s0 / a0.r0, 'FM999990.00')
                else 'sem resultado (R$ ' || to_char(a0.s0, 'FM999990.00') || ' gastos)' end as c0_txt,
           case when a0.r1 > 0 then 'R$ ' || to_char(a0.s1 / a0.r1, 'FM999990.00')
                else 'sem resultado (R$ ' || to_char(a0.s1, 'FM999990.00') || ' gastos)' end as c1_txt,
           case when a0.r2 > 0 then 'R$ ' || to_char(a0.s2 / a0.r2, 'FM999990.00')
                else 'sem resultado (R$ ' || to_char(a0.s2, 'FM999990.00') || ' gastos)' end as c2_txt
    from agg0 a0
    cross join lateral (
      select coalesce(
               (select valor from public.targets
                 where company_id = a0.company_id and active and campaign_id is null
                   and metric = case when a0.category = 'mensagem' then 'custo_por_conversa'
                                     else 'custo_por_formulario' end),
               case when a0.category <> 'mensagem' then
                 (select valor from public.targets
                   where company_id = a0.company_id and active and campaign_id is null
                     and metric = 'custo_por_lead_lp') end
             ) as teto,
             case when a0.category = 'mensagem' then 'custo/conversa' else 'custo/formulário' end as metric_label
    ) t
    where a0.dias >= 3
      and a0.d0_date >= current_date - 2
      and t.teto is not null
      and ((a0.r0 = 0 and a0.s0 > t.teto) or (a0.r0 > 0 and a0.s0 / a0.r0 > t.teto))
      and ((a0.r1 = 0 and a0.s1 > t.teto) or (a0.r1 > 0 and a0.s1 / a0.r1 > t.teto))
      and ((a0.r2 = 0 and a0.s2 > t.teto) or (a0.r2 > 0 and a0.s2 / a0.r2 > t.teto))
      and not (a0.r0 > 0 and a0.r1 > 0 and a0.r2 > 0
               and (a0.s2 / a0.r2) > (a0.s1 / a0.r1) and (a0.s1 / a0.r1) > (a0.s0 / a0.r0))
  ) agg
  join public.alert_rules r on r.company_id = agg.company_id and r.metric = 'pause_3d' and r.active;

  -- R6: Queda de entrega (média 3d < threshold% da média dos 7d anteriores; base >= 500 imp/dia)
  insert into public.alerts (company_id, severity, title, description, resolved, rule_id, campaign_id, triggered_value)
  select c.company_id, r.severity, r.name,
         'Entrega caiu para ' || w.pct || '% da média anterior (últimos ' || r.window_days || 'd: ' ||
         w.media_recente || ' imp/dia vs ' || w.media_base || ' imp/dia nos 7d anteriores) — ' || c.name,
         false, r.id, c.id, w.pct
  from public.alert_rules r
  join public.campaigns c on c.company_id = r.company_id and c.status = 'active'
  cross join lateral (
    select round(avg(s.impressions) filter (where s.snapshot_date >= current_date - r.window_days)) as media_recente,
           round(avg(s.impressions) filter (where s.snapshot_date <  current_date - r.window_days
                                        and s.snapshot_date >= current_date - r.window_days - 7)) as media_base,
           round(100 * avg(s.impressions) filter (where s.snapshot_date >= current_date - r.window_days)
                 / nullif(avg(s.impressions) filter (where s.snapshot_date < current_date - r.window_days
                                                 and s.snapshot_date >= current_date - r.window_days - 7), 0)) as pct
    from public.metric_snapshots s
    where s.campaign_id = c.id and s.snapshot_date >= current_date - r.window_days - 7
  ) w
  where r.active and r.metric = 'delivery_drop'
    and w.media_base >= 500
    and w.media_recente is not null
    and w.pct < r.threshold;

  -- R7: Orçamento (gasto de ontem vs soma dos daily_budget dos adsets ATIVOS; centavos -> /100)
  insert into public.alerts (company_id, severity, title, description, resolved, rule_id, campaign_id, triggered_value)
  select c.company_id, r.severity, r.name,
         case when b.budget_dia is not null then
           'Gasto de ontem R$ ' || to_char(g.gasto_ontem,'FM999990.00') || ' excede o orçamento diário R$ ' ||
           to_char(b.budget_dia,'FM999990.00') || ' em ' ||
           round(100 * (g.gasto_ontem / b.budget_dia - 1)) || '% — ' || c.name
         else
           'Pico de gasto: ontem R$ ' || to_char(g.gasto_ontem,'FM999990.00') || ' vs média 7d R$ ' ||
           to_char(g.media_7d,'FM999990.00') || ' (' || round(g.gasto_ontem / nullif(g.media_7d,0), 1) || 'x) — ' || c.name
         end,
         false, r.id, c.id, round(g.gasto_ontem, 2)
  from public.alert_rules r
  join public.campaigns c on c.company_id = r.company_id and c.status = 'active'
  cross join lateral (
    select (select s.spend from public.metric_snapshots s
             where s.campaign_id = c.id and s.snapshot_date = current_date - 1) as gasto_ontem,
           (select avg(s.spend) from public.metric_snapshots s
             where s.campaign_id = c.id and s.snapshot_date < current_date - 1
               and s.snapshot_date >= current_date - 8) as media_7d
  ) g
  cross join lateral (
    select sum(ast.daily_budget) / 100.0 as budget_dia
    from public.ad_sets ast
    where ast.campaign_id = c.id and upper(coalesce(ast.status,'')) = 'ACTIVE'
      and ast.daily_budget is not null
  ) b
  where r.active and r.metric = 'budget'
    and g.gasto_ontem is not null
    and (
      (b.budget_dia is not null and b.budget_dia > 0
        and g.gasto_ontem > b.budget_dia * (1 + r.threshold / 100.0))
      or
      (b.budget_dia is null and g.media_7d is not null and g.media_7d > 0
        and g.gasto_ontem > 1.8 * g.media_7d and g.gasto_ontem > 50)
    );

  select count(*) into total from public.alerts where resolved = false and rule_id is not null;
  return total;
end $function$;