-- =====================================================================================
-- ESPELHO DAS MIGRAÇÕES DE 27/07/2026 — Gestor de Tráfego IA (Legal é Viver)
-- Projeto Supabase: gzjwnjdpxpbmdhcyefvs
--
-- ATENÇÃO: este arquivo é ESPELHO. As migrações abaixo JÁ FORAM APLICADAS em produção
-- via apply_migration. Ele existe para versionamento e auditoria — NÃO deve ser
-- re-executado contra o banco. Os nomes correspondem às migrações registradas.
--
-- Ordem cronológica de aplicação:
--   1. add_chat_messages_diagnostico       (telemetria do turno de chat)
--   2. enable_realtime_chat_messages       (Realtime para o indicador do front)
--   3. add_watchdog_frescor_dados          (função do watchdog)
--   4. schedule_watchdog_frescor_0945      (cron do watchdog)
-- =====================================================================================


-- =====================================================================================
-- 1) add_chat_messages_diagnostico
-- Motivação: os sinais de diagnóstico do turno (finish_reason, iterações, preâmbulos
-- recuperados) existiam APENAS na resposta HTTP, que é efêmera. Instrumentação que não
-- é observável depois do instante não é instrumentação. Também é a primeira telemetria
-- de custo de LLM deste projeto — antes não havia nenhuma.
-- =====================================================================================

alter table public.chat_messages add column if not exists diagnostico jsonb;

comment on column public.chat_messages.diagnostico is
  'Diagnostico do turno (gravado pelo traffic-chat v19+): finish_reason, iteracoes, preambulos_detectados/recuperados, ms_total, deadline_tools. Antes do v19 esses sinais existiam apenas na resposta HTTP, que e efemera - nao havia como medir historicamente.';


-- =====================================================================================
-- 2) enable_realtime_chat_messages
-- Motivação: o indicador de "analisando" desaparecia quando o usuário saía da conversa,
-- porque o estado vivia no componente React. A resposta, no entanto, É persistida pela
-- edge antes do retorno HTTP (medido: 63 de 67 turnos com resposta no banco). Com
-- Realtime, o front recebe o INSERT do assistant e renderiza sem polling, mesmo que o
-- usuário tenha navegado para outra conversa ou dado F5.
-- =====================================================================================

alter publication supabase_realtime add table public.chat_messages;


-- =====================================================================================
-- 3) add_watchdog_frescor_dados
-- Motivação medida: entre 22/07 e 27/07 o sistema ficou 5 dias sem ingerir
-- metric_snapshots e ninguém soube. O bm-monitor mostrava saldo não faturado subindo de
-- R$ 69 para R$ 602 enquanto os relatórios diários anunciavam "R$ 0,00 · 0 leads" ao
-- gestor. A falha foi descoberta por acidente, durante investigação de outro assunto.
-- O sistema monitorava a conta Meta e não monitorava a si mesmo.
--
-- Decisão de arquitetura: SQL puro, SEM Edge Function. O incidente que esta função vigia
-- foi causado pelo IDLE_TIMEOUT de 150s das edges; fazer o vigia depender da mesma
-- plataforma que ele vigia seria repetir o erro.
-- =====================================================================================

create or replace function public.check_data_freshness()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_company uuid;
  v_ultimo_snapshot date;
  v_dias_atraso int;
  v_jobs_falhos int;
  v_detalhe_jobs text;
  v_alertas int := 0;
  v_resultado jsonb;
begin
  -- empresa principal (a que opera midia); mantem o watchdog focado sem varrer tenants
  select id into v_company from companies where name ilike '%legal%' order by created_at limit 1;
  if v_company is null then
    return jsonb_build_object('erro','empresa principal nao encontrada');
  end if;

  -- 1) FRESCOR DA INGESTAO DE MIDIA
  select max(snapshot_date) into v_ultimo_snapshot
  from metric_snapshots where company_id = v_company;

  v_dias_atraso := coalesce((current_date - v_ultimo_snapshot), 999);

  -- D-1 e o esperado (o cron das 09:00 UTC ingere o dia anterior). 2+ dias = atraso real.
  if v_dias_atraso >= 2 then
    if not exists (
      select 1 from alerts
      where company_id = v_company and resolved = false
        and title = 'Ingestao de metricas atrasada'
        and created_at > now() - interval '20 hours'
    ) then
      insert into alerts (company_id, severity, title, description, triggered_value)
      values (v_company,
        case when v_dias_atraso >= 3 then 'high'::alert_severity else 'medium'::alert_severity end,
        'Ingestao de metricas atrasada',
        format('metric_snapshots sem dado novo ha %s dia(s). Ultimo snapshot: %s. O sistema pode estar cego para gasto e resultados - conferir windsor-sync e net._http_response antes de confiar em qualquer relatorio.',
               v_dias_atraso, coalesce(v_ultimo_snapshot::text,'nenhum')),
        v_dias_atraso);
      v_alertas := v_alertas + 1;
    end if;
  end if;

  -- 2) JOBS QUE NAO RETORNARAM 200
  -- pg_cron marca "succeeded" quando o POST e ENFILEIRADO, nao quando a edge responde OK.
  -- A verdade esta em net._http_response.
  select count(*), string_agg(distinct coalesce(status_code::text,'sem resposta'), ', ')
    into v_jobs_falhos, v_detalhe_jobs
  from net._http_response
  where created > now() - interval '24 hours'
    and (status_code is null or status_code <> 200);

  if v_jobs_falhos > 0 then
    if not exists (
      select 1 from alerts
      where company_id = v_company and resolved = false
        and title = 'Jobs internos com falha'
        and created_at > now() - interval '20 hours'
    ) then
      insert into alerts (company_id, severity, title, description, triggered_value)
      values (v_company, 'medium'::alert_severity,
        'Jobs internos com falha',
        format('%s chamada(s) interna(s) nao retornaram 200 nas ultimas 24h (status: %s). Conferir net._http_response - "succeeded" no pg_cron significa apenas que o POST foi enfileirado.',
               v_jobs_falhos, coalesce(v_detalhe_jobs,'-')),
        v_jobs_falhos);
      v_alertas := v_alertas + 1;
    end if;
  end if;

  v_resultado := jsonb_build_object(
    'verificado_em', now(),
    'ultimo_snapshot', v_ultimo_snapshot,
    'dias_atraso', v_dias_atraso,
    'ingestao_ok', v_dias_atraso < 2,
    'jobs_com_falha_24h', v_jobs_falhos,
    'alertas_criados', v_alertas);

  return v_resultado;
end $$;

revoke all on function public.check_data_freshness() from public, anon;
grant execute on function public.check_data_freshness() to authenticated, service_role;

comment on function public.check_data_freshness() is
  'Watchdog de frescor: alerta se metric_snapshots nao recebe dado ha 2+ dias ou se houve chamada interna != 200 nas ultimas 24h. Dedup de 20h por titulo para nao inundar alerts. SQL puro (sem edge) para nao depender da plataforma que ele vigia.';


-- =====================================================================================
-- 4) schedule_watchdog_frescor_0945
-- 09:45 UTC: DEPOIS de todos os jobs do dia (09:00 windsor-sync, 09:10
-- meta-campaign-status, 09:15 alerts-eval, 09:20 bm-monitor, 09:30 waba-sync), para
-- avaliar o resultado consolidado e não um estado parcial.
-- Resultado: jobid 10, ativo.
-- =====================================================================================

select cron.schedule('watchdog-frescor-0945', '45 9 * * *', $$select public.check_data_freshness();$$);


-- =====================================================================================
-- PROVA DE EXECUÇÃO (27/07/2026 21:27 UTC)
-- select public.check_data_freshness();
-- → {"dias_atraso": 0, "ingestao_ok": true, "ultimo_snapshot": "2026-07-27",
--    "jobs_com_falha_24h": 1, "alertas_criados": 1}
--
-- O job com falha detectado foi o id 167 (15:13 UTC): timeout de 150.000 ms — o próprio
-- incidente de IDLE_TIMEOUT do traffic-chat. O watchdog pegou na primeira execução.
-- =====================================================================================
