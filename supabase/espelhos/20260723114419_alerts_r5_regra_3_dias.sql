-- ESPELHO DE MIGRACAO APLICADA
-- version: 20260723114419
-- name: alerts_r5_regra_3_dias
-- projeto: gzjwnjdpxpbmdhcyefvs (Gestor de Trafego IA)
-- aplicada por: Claude via MCP apply_migration
-- espelho gerado a partir de supabase_migrations.schema_migrations - NAO transcrito a mao

-- F2 — evaluate_alerts v3: adiciona R5 (Regra dos 3 dias, call do Roberto).
-- Criativo ATIVO de campanha ATIVA (leadgen/mensagem) cujos 3 ÚLTIMOS DIAS COM
-- ENTREGA (spend>0, dado fresco: mais recente >= hoje-2) ficaram TODOS acima do
-- teto vivo de targets — mensagem: custo_por_conversa; leadgen: custo_por_formulario
-- (fallback custo_por_lead_lp). Dia sem resultado conta como estourado se o gasto
-- do dia excede o teto. PERDÃO: custo em queda monotônica nos 3 dias => não recomenda.
-- Gera alerta CRITICAL (recomendação de PAUSA; execução real fica p/ fase de ações).
-- R1-R4 permanecem IDÊNTICAS à v2 (alerts_r1_cpl_le_target_vivo).
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

  -- R5: Regra dos 3 dias (recomendação de pausa por criativo)
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
      -- os 3 dias acima do teto (dia sem resultado: gasto do dia > teto)
      and ((a0.r0 = 0 and a0.s0 > t.teto) or (a0.r0 > 0 and a0.s0 / a0.r0 > t.teto))
      and ((a0.r1 = 0 and a0.s1 > t.teto) or (a0.r1 > 0 and a0.s1 / a0.r1 > t.teto))
      and ((a0.r2 = 0 and a0.s2 > t.teto) or (a0.r2 > 0 and a0.s2 / a0.r2 > t.teto))
      -- perdão: queda monotônica (todos com resultado e custo melhorando dia a dia)
      and not (a0.r0 > 0 and a0.r1 > 0 and a0.r2 > 0
               and (a0.s2 / a0.r2) > (a0.s1 / a0.r1) and (a0.s1 / a0.r1) > (a0.s0 / a0.r0))
  ) agg
  join public.alert_rules r on r.company_id = agg.company_id and r.metric = 'pause_3d' and r.active;

  select count(*) into total from public.alerts where resolved = false and rule_id is not null;
  return total;
end $function$;