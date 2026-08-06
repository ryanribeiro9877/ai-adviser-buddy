-- ESPELHO DE MIGRACAO APLICADA
-- version: 20260805195801
-- name: esp01_c3_winners_usa_teto_vigente_e_remove_fallback_cruzado
-- projeto: gzjwnjdpxpbmdhcyefvs (Gestor de Trafego IA)
-- aplicada por: Claude via MCP apply_migration
-- espelho gerado a partir de supabase_migrations.schema_migrations - NAO transcrito a mao

-- ESP-01 consumidor 3 de 4 · evaluate_winners passa a medir contra o teto QUE GOVERNA.
--
-- DUAS MUDANCAS:
--
-- 1. O teto vem de teto_vigente(). Consequencia direta: a barra de vencedor e teto*0,80, entao
--    ela sai de R$ 1,84 (0,80 x 2,30) para R$ 1,28 (0,80 x 1,60) na Legal e Viver. Um vencedor
--    passa a ser vencedor contra a regua do gestor, nao contra o p75 do proprio passado.
--    Medido antes de aplicar: os 3 anuncios elegiveis rodam a 2,10 / 2,19 / 2,24 - nenhum
--    vencia nem com a barra antiga. Portanto a saida hoje e a mesma (zero), e a mudanca e
--    neutra no ato e correta no futuro.
--
-- 2. REMOVIDO o fallback para custo_por_lead_lp em campanha nao-mensagem. Ele era um defeito
--    de denominador: results7 de leadgen conta FORMULARIO, e custo_por_lead_lp mede CUSTO POR
--    CLIQUE NO LINK (descoberto em 30/07 e registrado na memoria da propria linha de targets).
--    Comparar formulario contra teto de clique produz vencedor inventado. Estava dormente na
--    Legal e Viver (que tem custo_por_formulario), mas armado na COHAPM, que tem clique e nao
--    tem formulario. Sem teto valido a linha simplesmente nao gera recomendacao - declarar
--    ausencia e melhor que julgar com a regua errada.
--
-- 3. A recomendacao passa a DIZER qual regua julgou. Quem le "20% abaixo do teto" precisa saber
--    de quem e o teto.

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
    select b.*, round(b.spend7 / b.results7, 2) as custo7,
           (t.r->>'teto_que_governa')::numeric as teto,
           case when b.category = 'mensagem' then 'custo/conversa' else 'custo/formulário' end as metric_label,
           case when t.r->>'governa' = 'meta_de_negocio'
                then 'régua de negócio de ' || coalesce(t.r->'meta_de_negocio'->>'decidido_por','gestor')
                     || ', ' || to_char((t.r->'meta_de_negocio'->>'decidido_em')::date,'DD/MM/YYYY')
                else 'teto histórico do próprio desempenho' end as regua_label,
           round(100 * (1 - (b.spend7 / b.results7) / (t.r->>'teto_que_governa')::numeric)) as economia_pct
    from base b
    cross join lateral (
      select public.teto_vigente(
               b.company_id,
               case when b.category = 'mensagem' then 'custo_por_conversa' else 'custo_por_formulario' end
             ) as r
    ) t
    where b.results7 >= 30 and b.spend7 >= 30
      and (t.r->>'teto_que_governa') is not null
      and (b.spend7 / b.results7) <= (t.r->>'teto_que_governa')::numeric * 0.80
  )
  insert into public.ai_recommendations (company_id, title, description, impact, category, status)
  select company_id,
         'Escalar criativo vencedor: ' || ad_name,
         'Últimos 7 dias: ' || results7 || ' resultados a R$ ' || to_char(custo7,'FM999990.00') ||
         ' (' || metric_label || ') — ' || economia_pct || '% abaixo do teto R$ ' || to_char(teto,'FM999990.00') ||
         ', com R$ ' || to_char(spend7,'FM999990.00') || ' investidos. Recomendação: aumentar orçamento ou duplicar este anúncio. Campanha ' || camp_name ||
         '. Régua usada: ' || regua_label || '. [auto: vencedores]',
         'high', 'escala', 'new'::recommendation_status
  from scored
  union all
  select company_id,
         'Produza mais como: ' || ad_name,
         'Este criativo performa a R$ ' || to_char(custo7,'FM999990.00') || ' (' || metric_label ||
         '), ' || economia_pct || '% abaixo do teto. Padrão para replicar: formato ' ||
         coalesce(nullif(object_type,''),'(sem registro)') || ', CTA ' || coalesce(nullif(cta,''),'(sem registro)') ||
         case when ad_title <> '' then ', título "' || ad_title || '"' else '' end ||
         '. Campanha ' || camp_name || '. Régua usada: ' || regua_label || '. [auto: vencedores]',
         'medium', 'criativo', 'new'::recommendation_status
  from scored;

  select count(*) into total from public.ai_recommendations
   where status = 'new' and description like '%[auto: vencedores]%';
  return total;
end $function$;