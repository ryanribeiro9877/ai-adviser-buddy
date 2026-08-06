-- ESPELHO DE MIGRACAO APLICADA
-- version: 20260806200740
-- name: post_daily_report_monitora_pipeboard_metrics
-- projeto: gzjwnjdpxpbmdhcyefvs (Gestor de Trafego IA)
-- aplicada por: Cursor via MCP apply_migration
-- espelho gerado a partir de supabase_migrations.schema_migrations - NAO transcrito a mao

-- Inclui pipeboard-metrics-daily na lista monitorada do relatorio diario.
-- Transformacao guardada sobre pg_get_functiondef (mesmo padrao da Fase A).
-- NAO reintroduz v_waba nem mencao WhatsApp condicional.

do $migration$
declare
  v_def text;
begin
  select pg_get_functiondef('public.post_daily_report()'::regprocedure) into v_def;

  if v_def like '%pipeboard-metrics-daily%' then
    raise notice 'post_daily_report ja monitora pipeboard-metrics-daily; noop';
    return;
  end if;

  if v_def not like '%windsor-sync-daily%' or v_def not like '%alerts-eval-daily%' then
    raise exception 'post_daily_report: lista de crons esperada (windsor/alerts) nao encontrada';
  end if;

  if v_def like '%v_waba%' then
    raise exception 'post_daily_report: residuo v_waba presente; nao aplicar este patch ate limpar';
  end if;

  v_def := replace(
    v_def,
    '(''windsor-sync-daily'',''alerts-eval-daily'')',
    '(''windsor-sync-daily'',''alerts-eval-daily'',''pipeboard-metrics-daily'')'
  );

  if v_def not like '%pipeboard-metrics-daily%' then
    raise exception 'post_daily_report: falha ao inserir pipeboard-metrics-daily na lista monitorada';
  end if;

  if v_def like '%v_waba%' or v_def like '%waba-sync-daily%' then
    raise exception 'post_daily_report: transformacao reintroduziu residuo WABA';
  end if;

  execute v_def;
end
$migration$;
