-- ============================================================================
-- ESPELHO: F2.2 — Detector de criativos vencedores ("produza mais desse tipo")
-- Projeto: gestão_marketing (gzjwnjdpxpbmdhcyefvs) · Aplicadas: 23/07/2026
-- Migrações: f22_evaluate_winners (+_fix_enum, +_cast_enum — versão final abaixo)
-- ATENÇÃO: espelho para git. NÃO re-executar.
--
-- PARÂMETROS (editar na função se o Roberto pedir):
--   Janela 7 dias · Significância mínima: >=30 resultados E >=R$30 gastos
--   Vencedor: custo/resultado <= 80% do teto VIVO (targets; mesma métrica da R5)
-- SAÍDAS em ai_recommendations (aba de recomendações do front lê direto; enum
--   recommendation_status: new/accepted/dismissed):
--   (a) category='escala'   impact='high'   -> escalar orçamento/duplicar
--   (b) category='criativo' impact='medium' -> produzir similar (formato/CTA/título)
-- Idempotente: apaga/regrava só as 'new' marcadas [auto: vencedores]; as tratadas
-- (accepted/dismissed) viram histórico intocado.
-- CRON: jobid 2 (alerts-eval-daily, 06:15 America/Bahia = 09:15 UTC) atualizado:
--   select public.evaluate_alerts(); select public.evaluate_winners();
-- GRANTS: revoke public/anon/authenticated; grant service_role (padrão sec_revoke).
--
-- VALIDAÇÃO (23/07/2026, dados REAIS): 2 vencedores detectados ->
--   AD_LP_C3REELS_R06 (308 form/7d a R$1,65; teto 2,30; corte 1,84) e
--   ...NovoLeilao-Reversao (249 form/7d a R$1,73). Conta manual por SQL bateu
--   ao centavo. Coerência: são os MESMOS 2 criativos poupados pela regra dos
--   3 dias na auditoria da F2.1 — pausa e vencedores decidem na mesma direção.
-- ============================================================================

create or replace function public.evaluate_winners()
 returns integer
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare total int;
begin
  delete from public.ai_recommendations
   where status = 'new' and description like '%[auto: vencedores]%';

  with base as (
    select s.ad_external_id,
           max(a.name) as ad_name, max(c.name) as camp_name, max(c.category) as category,
           max(c.company_id::text)::uuid as company_id,
           max(coalesce(a.object_type,'')) as object_type,
           max(coalesce(a.call_to_action_type,'')) as cta,
           max(coalesce(a.title,'')) as ad_title,
           sum(s.spend) as spend7,
           sum(case when c.category = 'mensagem' then s.messaging_started else s.form_leads end) as results7
    from public.ad_metric_snapshots s
    join public.ads a on a.external_id = s.ad_external_id
    join public.campaigns c on c.id = a.campaign_id
    where c.status = 'active'
      and coalesce(c.category,'') in ('leadgen','mensagem')
      and upper(coalesce(a.status,'ACTIVE')) in ('ACTIVE','ADSET_PAUSED_OVERRIDE')
      and s.snapshot_date >= current_date - 7
    group by s.ad_external_id
  ), scored as (
    select b.*, round(b.spend7 / b.results7, 2) as custo7, t.teto, t.metric_label,
           round(100 * (1 - (b.spend7 / b.results7) / t.teto)) as economia_pct
    from base b
    cross join lateral (
      select coalesce(
               (select valor from public.targets
                 where company_id = b.company_id and active and campaign_id is null
                   and metric = case when b.category = 'mensagem' then 'custo_por_conversa'
                                     else 'custo_por_formulario' end),
               case when b.category <> 'mensagem' then
                 (select valor from public.targets
                   where company_id = b.company_id and active and campaign_id is null
                     and metric = 'custo_por_lead_lp') end
             ) as teto,
             case when b.category = 'mensagem' then 'custo/conversa' else 'custo/formulário' end as metric_label
    ) t
    where b.results7 >= 30 and b.spend7 >= 30
      and t.teto is not null
      and (b.spend7 / b.results7) <= t.teto * 0.80
  )
  insert into public.ai_recommendations (company_id, title, description, impact, category, status)
  select company_id,
         'Escalar criativo vencedor: ' || ad_name,
         'Últimos 7 dias: ' || results7 || ' resultados a R$ ' || to_char(custo7,'FM999990.00') ||
         ' (' || metric_label || ') — ' || economia_pct || '% abaixo do teto R$ ' || to_char(teto,'FM999990.00') ||
         ', com R$ ' || to_char(spend7,'FM999990.00') || ' investidos. Recomendação: aumentar orçamento ou duplicar este anúncio. Campanha ' || camp_name || '. [auto: vencedores]',
         'high', 'escala', 'new'::recommendation_status
  from scored
  union all
  select company_id,
         'Produza mais como: ' || ad_name,
         'Este criativo performa a R$ ' || to_char(custo7,'FM999990.00') || ' (' || metric_label ||
         '), ' || economia_pct || '% abaixo do teto. Padrão para replicar: formato ' ||
         coalesce(nullif(object_type,''),'(sem registro)') || ', CTA ' || coalesce(nullif(cta,''),'(sem registro)') ||
         case when ad_title <> '' then ', título "' || ad_title || '"' else '' end ||
         '. Campanha ' || camp_name || '. [auto: vencedores]',
         'medium', 'criativo', 'new'::recommendation_status
  from scored;

  select count(*) into total from public.ai_recommendations
   where status = 'new' and description like '%[auto: vencedores]%';
  return total;
end $function$;

revoke execute on function public.evaluate_winners() from public, anon, authenticated;
grant execute on function public.evaluate_winners() to service_role;

-- cron (executado via cron.alter_job, registrado aqui para espelho):
-- select cron.alter_job(2, command => ' select public.evaluate_alerts(); select public.evaluate_winners(); ');
