-- ESPELHO DE MIGRACAO APLICADA
-- version: 20260723134400
-- name: f32_post_daily_report
-- projeto: gzjwnjdpxpbmdhcyefvs (Gestor de Trafego IA)
-- aplicada por: Claude via MCP apply_migration
-- espelho gerado a partir de supabase_migrations.schema_migrations - NAO transcrito a mao

-- F3.2 — Relatório diário 08:30 no chat (formato da call do Roberto:
-- "🔎 Encontrei / ✅ Resolvi / 🫵 Depende de você"). DETERMINÍSTICO (sem LLM):
-- relatório de rotina precisa ser 100% confiável, auditável e de custo zero.
-- Uma conversa kind='daily_report' por empresa (criada na 1ª vez, reutilizada);
-- 1 mensagem assistant por dia. Só gera para empresa com campanha ATIVA.
-- Idempotente por dia: se já postou hoje, não duplica.
create or replace function public.post_daily_report()
 returns integer
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  emp record; conv_id uuid; corpo text; postados int := 0;
  v_gasto numeric; v_forms int; v_links int; v_msgs int; v_leads int;
  v_teto_form numeric; v_custo_form numeric;
  v_alertas text; v_recos text; v_sync text; v_n_alertas int; v_n_recos int;
begin
  for emp in
    select co.id, co.name from public.companies co
    where exists (select 1 from public.campaigns c where c.company_id = co.id and c.status = 'active')
  loop
    -- conversa do relatório (1 por empresa)
    select id into conv_id from public.chat_conversations
     where company_id = emp.id and kind = 'daily_report' limit 1;
    if conv_id is null then
      insert into public.chat_conversations (company_id, title, kind)
      values (emp.id, 'Relatório diário 08:30', 'daily_report')
      returning id into conv_id;
    end if;

    -- idempotência: 1 por dia
    if exists (select 1 from public.chat_messages
                where conversation_id = conv_id and role = 'assistant'
                  and created_at::date = current_date) then
      continue;
    end if;

    -- ONTEM
    select coalesce(sum(spend),0), coalesce(sum(form_leads),0), coalesce(sum(link_clicks),0),
           coalesce(sum(messaging_started),0), coalesce(sum(leads),0)
      into v_gasto, v_forms, v_links, v_msgs, v_leads
      from public.metric_snapshots
     where company_id = emp.id and snapshot_date = current_date - 1;
    select valor into v_teto_form from public.targets
     where company_id = emp.id and metric='custo_por_formulario' and active and campaign_id is null;
    v_custo_form := case when v_forms > 0 then round(v_gasto / v_forms, 2) end;

    -- ENCONTREI: alertas ativos
    select count(*), coalesce(string_agg(
             '- ' || case severity::text when 'critical' then '🔴' when 'high' then '🟠'
                          when 'medium' then '🟡' else '🔵' end || ' **' || title || '**: ' || description,
             e'\n' order by case severity::text when 'critical' then 0 when 'high' then 1 when 'medium' then 2 else 3 end), '- nenhum alerta ativo 👌')
      into v_n_alertas, v_alertas
      from public.alerts where company_id = emp.id and resolved = false;

    -- RESOLVI: rotinas do sistema hoje
    select coalesce(string_agg('- ' || j.jobname || ': ' ||
             case d.status when 'succeeded' then '✅ rodou' else '❌ ' || coalesce(d.status,'?') end, e'\n'),
             '- (nenhuma rotina registrada hoje)')
      into v_sync
      from cron.job j
      join lateral (
        select status from cron.job_run_details r
         where r.jobid = j.jobid and r.start_time::date = current_date
         order by r.start_time desc limit 1
      ) d on true
     where j.jobname in ('windsor-sync-daily','waba-sync-daily','alerts-eval-daily');

    -- DEPENDE DE VOCÊ: recomendações pendentes
    select count(*), coalesce(string_agg('- ' ||
             case impact when 'high' then '🚀' else '💡' end || ' **' || title || '**', e'\n' order by impact desc),
             '- nada pendente de decisão')
      into v_n_recos, v_recos
      from public.ai_recommendations where company_id = emp.id and status = 'new';

    corpo :=
      '# 📋 Relatório diário — ' || to_char(current_date, 'DD/MM/YYYY') || e'\n\n' ||
      '## 🔎 Encontrei' || e'\n' ||
      '**Ontem (' || to_char(current_date - 1, 'DD/MM') || '):** gasto **R$ ' || to_char(v_gasto,'FM999G999D00') ||
      '** · ' || v_links || ' leads (LP) · ' || v_forms || ' formulários' ||
      case when v_custo_form is not null then ' · custo/formulário **R$ ' || to_char(v_custo_form,'FM990D00') || '**' ||
        case when v_teto_form is not null then
          case when v_custo_form <= v_teto_form then ' (dentro do teto R$ ' || to_char(v_teto_form,'FM990D00') || ' ✅)'
               else ' (**ACIMA** do teto R$ ' || to_char(v_teto_form,'FM990D00') || ' ⚠️)' end
        else '' end
      else '' end ||
      case when v_msgs > 0 then ' · ' || v_msgs || ' conversas WhatsApp' else '' end || e'\n\n' ||
      '**Alertas ativos (' || v_n_alertas || '):**' || e'\n' || v_alertas || e'\n\n' ||
      '## ✅ Resolvi' || e'\n' ||
      'Rotinas de hoje (sync de dados, avaliação de regras e vencedores):' || e'\n' || v_sync || e'\n\n' ||
      '## 🫵 Depende de você (' || v_n_recos || ')' || e'\n' || v_recos;

    insert into public.chat_messages (conversation_id, company_id, role, content, model)
    values (conv_id, emp.id, 'assistant', corpo, 'relatorio-deterministico');
    update public.chat_conversations set updated_at = now() where id = conv_id;
    postados := postados + 1;
  end loop;
  return postados;
end $function$;

revoke execute on function public.post_daily_report() from public, anon, authenticated;
grant execute on function public.post_daily_report() to service_role;

-- cron 08:30 America/Bahia = 11:30 UTC
select cron.schedule('daily-report-0830', '30 11 * * *', 'select public.post_daily_report();');