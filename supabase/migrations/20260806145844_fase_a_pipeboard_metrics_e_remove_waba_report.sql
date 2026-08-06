-- ESPELHO DE MIGRACAO APLICADA
-- version: 20260806145844
-- name: fase_a_pipeboard_metrics_e_remove_waba_report
-- projeto: gzjwnjdpxpbmdhcyefvs (Gestor de Trafego IA)
-- aplicada por: Claude via MCP apply_migration
-- espelho gerado a partir de supabase_migrations.schema_migrations - NAO transcrito a mao

-- Fase A: agenda o leitor Pipeboard em paralelo. Windsor permanece ativo e inalterado.
-- Residuos: remove do relatorio rotinas WABA desativadas e o bloco WABA congelado.
-- Nenhuma tabela ou chave unica de metricas e alterada.

do $migration$
declare
  v_def text;
  v_start integer;
  v_end integer;
begin
  select pg_get_functiondef('public.post_daily_report()'::regprocedure) into v_def;

  v_def := replace(
    v_def,
    'v_waba text; v_tiers text; v_qual text; v_top_template text;',
    ''
  );
  v_def := replace(
    v_def,
    'v_sent_ontem numeric; v_num_com_dado int; v_n_numeros int;',
    ''
  );
  v_def := replace(
    v_def,
    '(''windsor-sync-daily'',''waba-sync-daily'',''alerts-eval-daily'',''waba-tier-alerts-0940'')',
    '(''windsor-sync-daily'',''alerts-eval-daily'')'
  );

  v_start := strpos(v_def, '    v_waba := null;');
  v_end := strpos(v_def, '    corpo :=');
  if v_start = 0 or v_end = 0 or v_end <= v_start then
    raise exception 'post_daily_report: bloco WABA esperado nao encontrado';
  end if;
  v_def := left(v_def, v_start - 1) || substr(v_def, v_end);
  v_def := replace(v_def, '      coalesce(v_waba, '''') ||' || chr(10), '');

  if v_def like '%v_waba%'
     or v_def like '%waba-sync-daily%'
     or v_def like '%waba-tier-alerts-0940%' then
    raise exception 'post_daily_report: residuos WABA permaneceram apos transformacao';
  end if;

  execute v_def;
end
$migration$;

do $cron$
declare
  v_jobid bigint;
begin
  for v_jobid in
    select jobid from cron.job where jobname = 'pipeboard-metrics-daily'
  loop
    perform cron.unschedule(v_jobid);
  end loop;
end
$cron$;

select cron.schedule(
  'pipeboard-metrics-daily',
  '0 9 * * *',
  $command$
  select net.http_post(
    url := 'https://gzjwnjdpxpbmdhcyefvs.supabase.co/functions/v1/pipeboard-metrics-sync',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || public.get_mcp_api_key()
    ),
    body := jsonb_build_object(
      'date_from', to_char(current_date - interval '6 days', 'YYYY-MM-DD'),
      'date_to', to_char(current_date, 'YYYY-MM-DD')
    ),
    timeout_milliseconds := 150000
  );
  $command$
);
