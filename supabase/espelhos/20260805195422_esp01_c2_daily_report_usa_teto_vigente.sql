-- ESPELHO DE MIGRACAO APLICADA
-- version: 20260805195422
-- name: esp01_c2_daily_report_usa_teto_vigente
-- projeto: gzjwnjdpxpbmdhcyefvs (Gestor de Trafego IA)
-- aplicada por: Claude via MCP apply_migration
-- espelho gerado a partir de supabase_migrations.schema_migrations - NAO transcrito a mao

-- ESP-01 consumidor 2 de 4 · post_daily_report passa a usar o teto QUE GOVERNA e a DIZER qual.
--
-- MUDANCA MINIMA, tres pontos:
--   1. v_teto_form deixa de vir de targets e passa a vir de teto_vigente();
--   2. duas variaveis novas guardam a resolucao e a nota de procedencia;
--   3. a nota entra UMA vez, no fechamento da empresa - regra 8 do agent_style: cada ressalva
--      aparece uma vez. O veredito por campanha continua curto, so com o numero.
--
-- POR QUE A NOTA E OBRIGATORIA: o teto de formulario da Legal e Viver vai de R$ 2,30 para
-- R$ 1,60 de um dia para o outro. Sem dizer que a regua mudou de fonte - e que a de 1,60 e
-- decisao do gestor de 30/07 - o Roberto veria um numero mudar sozinho.
--
-- NAO TOCADO: o teto_gasto_diario por campanha (R$ 60), que e outra metrica e ja e declaracao
-- humana. Todo o resto do corpo do relatorio esta byte a byte igual.
--
-- VERIFICADO ANTES DE REESCREVER: o relatorio de 05/08 tem 0 barras-n literais e 57 quebras
-- reais, o que provou que os escapes do fonte sao uniformes (e'\n') e a reescrita e segura.

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
  v_teto_form_r jsonb; v_teto_form_nota text;
  v_alertas text; v_recos text; v_sync text; v_n_alertas int; v_n_recos int;
  v_waba text; v_tiers text; v_qual text; v_top_template text;
  v_sent_ontem numeric; v_num_com_dado int; v_n_numeros int;
  v_campanhas text; v_n_camp int; v_d1 date;
begin
  v_d1 := current_date - 1;

  for emp in
    select co.id, co.name from public.companies co
    where exists (select 1 from public.campaigns c where c.company_id = co.id and c.status = 'active')
  loop
    select id into conv_id from public.chat_conversations
     where company_id = emp.id and kind = 'daily_report' limit 1;
    if conv_id is null then
      insert into public.chat_conversations (company_id, title, kind)
      values (emp.id, 'Relatório diário', 'daily_report') returning id into conv_id;
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
     where company_id = emp.id and snapshot_date = v_d1;

    -- ESP-01: o teto vem da resolucao, nao mais direto de targets.
    v_teto_form_r := public.teto_vigente(emp.id, 'custo_por_formulario');
    v_teto_form   := (v_teto_form_r->>'teto_que_governa')::numeric;
    v_teto_form_nota := case
      when v_teto_form is null then null
      when v_teto_form_r->>'governa' = 'meta_de_negocio' then
        '_Régua usada: R$ ' || public.fmt_brl(v_teto_form) || ' por formulário, decidida por '
        || coalesce(v_teto_form_r->'meta_de_negocio'->>'decidido_por','o gestor') || ' em '
        || to_char((v_teto_form_r->'meta_de_negocio'->>'decidido_em')::date,'DD/MM/YYYY') || '.'
        || case when (v_teto_form_r->'consistencia_historica'->>'valor') is not null
                 and (v_teto_form_r->'consistencia_historica'->>'valor')::numeric <> v_teto_form
                then ' O teto histórico do próprio desempenho é R$ '
                     || public.fmt_brl((v_teto_form_r->'consistencia_historica'->>'valor')::numeric)
                     || ', e mede consistência com o passado — não rentabilidade.'
                else '' end || '_'
      else
        '_Régua usada: R$ ' || public.fmt_brl(v_teto_form)
        || ' por formulário, derivada do histórico do próprio desempenho — mede consistência com o passado, não rentabilidade. Não há régua de negócio declarada para esta métrica._'
      end;

    v_custo_form := case when v_forms > 0 then round(v_gasto / v_forms, 2) end;

    with base as (
      select c.id, c.name,
             coalesce(sum(m.spend),0)              as sp,
             coalesce(sum(m.impressions),0)        as imp,
             coalesce(sum(m.reach),0)              as rch,
             coalesce(sum(m.clicks),0)             as clk,
             coalesce(sum(m.link_clicks),0)        as lclk,
             coalesce(sum(m.landing_page_views),0) as lpv,
             coalesce(sum(m.form_leads),0)         as frm,
             round(avg(m.frequency)::numeric,2)    as freq
        from public.campaigns c
        left join public.metric_snapshots m on m.campaign_id = c.id and m.snapshot_date = v_d1
       where c.company_id = emp.id
       group by c.id, c.name
    ), enriquecida as (
      select b.*, t.valor as teto,
             -- D-2 a D-7: seis dias, TODOS dentro da janela rolante last_7d do windsor-sync.
             -- D-8 ficaria congelado e contaminaria a media com um dia que nao se atualiza.
             (select round(avg(x.spend)::numeric,2) from public.metric_snapshots x
               where x.campaign_id = b.id and x.snapshot_date between v_d1 - 6 and v_d1 - 1
                 and x.spend > 0) as media6
        from base b
        left join public.targets t
               on t.campaign_id = b.id and t.metric = 'teto_gasto_diario' and t.active
       where b.sp > 0 or t.valor is not null
    )
    select count(*), string_agg(
      '### ' || name || e'\n'
      || '- Gasto **R$ ' || public.fmt_brl(sp) || '**'
         || case
              when teto is null then ' · sem teto declarado'
              when sp = 0 then ' · teto declarado R$ ' || public.fmt_brl(teto) || ' — **sem gasto ontem**'
              when sp > teto then ' · teto declarado R$ ' || public.fmt_brl(teto)
                   || ' → **' || round(100*sp/teto) || '% do teto** ⚠️'
              else ' · teto declarado R$ ' || public.fmt_brl(teto)
                   || ' → ' || round(100*sp/teto) || '% do teto ✅'
            end
         || case when media6 is not null and media6 > 0 and sp > 0 then
              ' · vs média dos 6 dias anteriores (R$ ' || public.fmt_brl(media6) || '): '
              || case when sp > media6 then '+' else '' end || round(100*(sp-media6)/media6) || '%'
            else '' end || e'\n'
      || case when sp = 0 then ''
         else
           '- **' || public.fmt_int(imp) || '** impressões para **' || public.fmt_int(rch)
           || '** pessoas' || case when freq is not null then ' (frequência ' || public.fmt_brl(freq) || ')' else '' end || e'\n'
           || '- **' || public.fmt_int(clk) || '** cliques · **' || public.fmt_int(lclk) || '** no link · **'
           || public.fmt_int(lpv) || '** chegaram na página' || e'\n'
           || '- **' || public.fmt_int(frm) || '** formulários'
           || case when frm > 0 then
                ' · custo/formulário **R$ ' || public.fmt_brl(round(sp/frm,2)) || '**'
                || case when v_teto_form is not null then
                     case when round(sp/frm,2) <= v_teto_form
                          then ' (dentro do teto R$ ' || public.fmt_brl(v_teto_form) || ' ✅)'
                          else ' (**ACIMA** do teto R$ ' || public.fmt_brl(v_teto_form) || ' ⚠️)' end
                   else '' end
              else ' — nenhum formulário' end || e'\n'
         end,
      e'\n' order by sp desc, name)
      into v_n_camp, v_campanhas from enriquecida;

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
      join lateral (select status from cron.job_run_details r
         where r.jobid = j.jobid and r.start_time::date = current_date
         order by r.start_time desc limit 1) d on true
     where j.jobname in ('windsor-sync-daily','waba-sync-daily','alerts-eval-daily','waba-tier-alerts-0940');

    select count(*), coalesce(string_agg('- ' ||
             case impact when 'high' then '🚀' else '💡' end || ' **' || title || '**',
             e'\n' order by case impact when 'high' then 0 when 'medium' then 1 else 2 end),
             '- nada pendente de decisão')
      into v_n_recos, v_recos
      from public.ai_recommendations where company_id = emp.id and status = 'new';

    v_waba := null;
    if exists (select 1 from public.wabas w where w.company_id = emp.id) then
      select count(*) into v_n_numeros from public.waba_phone_numbers p
       where p.company_id = emp.id and p.platform_type = 'CLOUD_API';
      select string_agg(t || ': ' || q, ' · ' order by q desc) into v_tiers from (
        select coalesce(messaging_limit_tier,'sem tier') as t, count(*) as q
          from public.waba_phone_numbers where company_id = emp.id and platform_type = 'CLOUD_API' group by 1) x;
      select string_agg(qr || ': ' || q, ' · ' order by q desc) into v_qual from (
        select coalesce(quality_rating,'sem dado') as qr, count(*) as q
          from public.waba_phone_numbers where company_id = emp.id and platform_type = 'CLOUD_API' group by 1) y;
      select coalesce(sum(sent),0), count(distinct nullif(phone_external_id,''))
        into v_sent_ontem, v_num_com_dado
        from public.waba_analytics_daily where company_id = emp.id and date = v_d1;
      select '**' || coalesce(nullif(t.template_name,''), w.name, t.template_external_id) ||
             '** (' || public.fmt_int(coalesce(sum(t.clicked),0)) || ' cliques · '
             || public.fmt_int(coalesce(sum(t.sent),0)) || ' envios em 7d)'
        into v_top_template
        from public.waba_template_analytics_daily t
        left join public.waba_templates w on w.external_id = t.template_external_id
       where t.company_id = emp.id and t.date >= current_date - 7
       group by coalesce(nullif(t.template_name,''), w.name, t.template_external_id)
       having coalesce(sum(t.clicked),0) > 0 order by sum(t.clicked) desc limit 1;
      v_waba :=
        '## 📱 WhatsApp — números e templates' || e'\n' ||
        '- Números vivos (Cloud API): **' || coalesce(v_n_numeros,0) || '**' ||
        case when v_tiers is not null then ' · tier: ' || v_tiers else '' end ||
        case when v_qual  is not null then ' · qualidade: ' || v_qual else '' end || e'\n' ||
        '- Ontem: **' || public.fmt_int(coalesce(v_sent_ontem,0)::bigint) || '** mensagens enviadas (agregado das contas)' ||
        case when coalesce(v_n_numeros,0) > 0 then
          ' — detalhe POR NÚMERO cobrindo ' || coalesce(v_num_com_dado,0) || ' de ' || v_n_numeros ||
          ' números (sem dado por número NÃO significa zero envio)' else '' end || e'\n' ||
        '- Template com mais cliques (7d): ' || coalesce(v_top_template, 'nenhum clique registrado no período') || e'\n\n';
    end if;

    corpo :=
      '# 📋 Relatório diário — ' || to_char(current_date, 'DD/MM/YYYY') || e'\n\n' ||
      '## 🔎 Ontem (' || to_char(v_d1, 'DD/MM') || ') — campanha por campanha' || e'\n\n' ||
      coalesce(v_campanhas, '- nenhuma campanha com gasto e nenhuma com teto declarado') || e'\n\n' ||
      '**Fechamento da empresa:** gasto **R$ ' || public.fmt_brl(v_gasto) || '** · ' ||
      public.fmt_int(v_links::bigint) || ' cliques no link · ' || public.fmt_int(v_forms::bigint) || ' formulários' ||
      case when v_custo_form is not null then ' · custo/formulário médio **R$ ' || public.fmt_brl(v_custo_form) || '**' ||
        case when v_teto_form is not null then
          case when v_custo_form <= v_teto_form then ' (dentro do teto R$ ' || public.fmt_brl(v_teto_form) || ' ✅)'
               else ' (**ACIMA** do teto R$ ' || public.fmt_brl(v_teto_form) || ' ⚠️)' end
        else '' end else '' end ||
      case when v_msgs > 0 then ' · ' || public.fmt_int(v_msgs::bigint) || ' conversas WhatsApp' else '' end || e'\n' ||
      '_O fechamento é soma de ' || coalesce(v_n_camp,0) || ' campanhas: use-o para conferir o caixa, nunca para julgar desempenho._' || e'\n' ||
      coalesce(v_teto_form_nota || e'\n', '') || e'\n' ||
      '> **Duas coisas que este relatório ainda NÃO sabe dizer**, porque não são coletadas por nenhuma rotina: ' ||
      'qual **público ou faixa demográfica** está performando melhor (não há recorte por idade, gênero ou posicionamento), ' ||
      'e a **qualidade do anúncio** segundo a Meta (os três rankings de qualidade, engajamento e conversão). ' ||
      'Não conclua nada sobre público ou qualidade criativa a partir dos números acima.' || e'\n\n' ||
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
$function$;