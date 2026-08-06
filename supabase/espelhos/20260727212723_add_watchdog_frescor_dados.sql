-- ESPELHO DE MIGRACAO APLICADA
-- version: 20260727212723
-- name: add_watchdog_frescor_dados
-- projeto: gzjwnjdpxpbmdhcyefvs (Gestor de Trafego IA)
-- aplicada por: Claude via MCP apply_migration
-- espelho gerado a partir de supabase_migrations.schema_migrations - NAO transcrito a mao

-- WATCHDOG DE FRESCOR DE DADOS
-- Motivacao medida: entre 22/07 e 27/07 o sistema ficou 5 dias sem ingerir metric_snapshots
-- e ninguem soube. O bm-monitor mostrava saldo subindo de R$69 para R$602 enquanto os
-- relatorios diarios anunciavam "R$ 0,00 - 0 leads" ao gestor. A falha foi descoberta por
-- acidente, durante investigacao de outro assunto.
-- O sistema monitorava a conta Meta e nao monitorava a si mesmo. Esta funcao fecha isso.
-- Implementada em SQL puro de proposito: nao usa Edge Function, portanto nao esta sujeita
-- ao IDLE_TIMEOUT de 150s que causou justamente o incidente que ela vigia.

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