-- [F5.4 + F5.5] Secao WhatsApp no relatorio diario (08:30 BRT).
-- Para empresas que TEM wabas: numeros vivos por tier e qualidade, mensagens enviadas ontem
-- com declaracao de cobertura (analytics cobrindo K de N numeros - ausencia de dado NAO e
-- zero, regra R3), e template com mais cliques em 7 dias. Alertas de tier/qualidade do
-- evaluate_waba_tier_alerts() ja aparecem sozinhos no bloco de alertas.
-- Mudancas em relacao a versao anterior: declares novos, bloco v_waba, v_waba no corpo,
-- e 'waba-tier-alerts-0940' na lista de rotinas. Todo o resto e identico.
create or replace function public.post_daily_report()
returns integer
language plpgsql
security definer
set search_path = public
as $fn$
declare
  emp record; conv_id uuid; corpo text; postados int := 0;
  v_gasto numeric; v_forms int; v_links int; v_msgs int; v_leads int;
  v_teto_form numeric; v_custo_form numeric;
  v_alertas text; v_recos text; v_sync text; v_n_alertas int; v_n_recos int;
  v_waba text; v_tiers text; v_qual text; v_top_template text;
  v_sent_ontem numeric; v_num_com_dado int; v_n_numeros int;
begin
  for emp in
    select co.id, co.name from public.companies co
    where exists (select 1 from public.campaigns c where c.company_id = co.id and c.status = 'active')
  loop
    select id into conv_id from public.chat_conversations
     where company_id = emp.id and kind = 'daily_report' limit 1;
    if conv_id is null then
      insert into public.chat_conversations (company_id, title, kind)
      values (emp.id, 'Relatório diário 08:30', 'daily_report')
      returning id into conv_id;
    end if;

    if exists (select 1 from public.chat_messages
                where conversation_id = conv_id and role = 'assistant'
                  and created_at::date = current_date) then
      continue;
    end if;

    select coalesce(sum(spend),0), coalesce(sum(form_leads),0), coalesce(sum(link_clicks),0),
           coalesce(sum(messaging_started),0), coalesce(sum(leads),0)
      into v_gasto, v_forms, v_links, v_msgs, v_leads
      from public.metric_snapshots
     where company_id = emp.id and snapshot_date = current_date - 1;
    select valor into v_teto_form from public.targets
     where company_id = emp.id and metric='custo_por_formulario' and active and campaign_id is null;
    v_custo_form := case when v_forms > 0 then round(v_gasto / v_forms, 2) end;

    select count(*), coalesce(string_agg(
             '- ' || case severity::text when 'critical' then '🔴' when 'high' then '🟠'
                          when 'medium' then '🟡' else '🔵' end || ' **' || title || '**: ' || description,
             e'\n' order by case severity::text when 'critical' then 0 when 'high' then 1 when 'medium' then 2 else 3 end), '- nenhum alerta ativo 👌')
      into v_n_alertas, v_alertas
      from public.alerts where company_id = emp.id and resolved = false;

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
     where j.jobname in ('windsor-sync-daily','waba-sync-daily','alerts-eval-daily','waba-tier-alerts-0940');

    select count(*), coalesce(string_agg('- ' ||
             case impact when 'high' then '🚀' else '💡' end || ' **' || title || '**',
             e'\n' order by case impact when 'high' then 0 when 'medium' then 1 else 2 end),
             '- nada pendente de decisão')
      into v_n_recos, v_recos
      from public.ai_recommendations where company_id = emp.id and status = 'new';

    -- [F5.4/F5.5] Secao WhatsApp: so para empresa que tem WABA sincronizada.
    v_waba := null;
    if exists (select 1 from public.wabas w where w.company_id = emp.id) then
      select count(*) into v_n_numeros
        from public.waba_phone_numbers p
       where p.company_id = emp.id and p.platform_type = 'CLOUD_API';

      select string_agg(t || ': ' || q, ' · ' order by q desc) into v_tiers from (
        select coalesce(messaging_limit_tier,'sem tier') as t, count(*) as q
          from public.waba_phone_numbers
         where company_id = emp.id and platform_type = 'CLOUD_API'
         group by 1) x;

      select string_agg(qr || ': ' || q, ' · ' order by q desc) into v_qual from (
        select coalesce(quality_rating,'sem dado') as qr, count(*) as q
          from public.waba_phone_numbers
         where company_id = emp.id and platform_type = 'CLOUD_API'
         group by 1) y;

      select coalesce(sum(sent),0), count(distinct phone_external_id)
        into v_sent_ontem, v_num_com_dado
        from public.waba_analytics_daily
       where company_id = emp.id and date = current_date - 1;

      select '**' || template_name || '** (' || coalesce(sum(clicked),0) || ' cliques · ' ||
             coalesce(sum(sent),0) || ' envios em 7d)'
        into v_top_template
        from public.waba_template_analytics_daily
       where company_id = emp.id and date >= current_date - 7
       group by template_name
       having coalesce(sum(clicked),0) > 0
       order by sum(clicked) desc
       limit 1;

      v_waba :=
        '## 📱 WhatsApp — números e templates' || e'\n' ||
        '- Números vivos (Cloud API): **' || coalesce(v_n_numeros,0) || '**' ||
        case when v_tiers is not null then ' · tier: ' || v_tiers else '' end ||
        case when v_qual  is not null then ' · qualidade: ' || v_qual else '' end || e'\n' ||
        '- Ontem: **' || coalesce(v_sent_ontem,0)::bigint || '** mensagens enviadas' ||
        case when coalesce(v_n_numeros,0) > 0 then
          ' — analytics cobrindo ' || coalesce(v_num_com_dado,0) || ' de ' || v_n_numeros ||
          ' números (número sem dado NÃO significa zero envio; pode não ter retornado da API)'
        else '' end || e'\n' ||
        '- Template com mais cliques (7d): ' || coalesce(v_top_template, 'nenhum clique registrado no período') || e'\n\n';
    end if;

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
      coalesce(v_waba, '') ||
      '## ✅ Resolvi' || e'\n' ||
      'Rotinas de hoje (sync de dados, avaliação de regras e vencedores):' || e'\n' || v_sync || e'\n\n' ||
      '## 🫵 Depende de você (' || v_n_recos || ')' || e'\n' || v_recos;

    insert into public.chat_messages (conversation_id, company_id, role, content, model)
    values (conv_id, emp.id, 'assistant', corpo, 'relatorio-deterministico');
    update public.chat_conversations set updated_at = now() where id = conv_id;
    postados := postados + 1;
  end loop;
  return postados;
end
$fn$;
