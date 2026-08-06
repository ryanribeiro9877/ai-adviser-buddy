-- ESPELHO DE MIGRACAO APLICADA
-- version: 20260806120620
-- name: esp12_pendura_transcricao_no_drive_watch
-- projeto: gzjwnjdpxpbmdhcyefvs (Gestor de Trafego IA)
-- aplicada por: Claude via MCP apply_migration
-- espelho gerado a partir de supabase_migrations.schema_migrations - NAO transcrito a mao

select cron.unschedule('drive-watch-0845');

select cron.schedule(
  'drive-watch-0845',
  '45 8 * * *',
  $cron$
  select net.http_post(
    url := 'https://gzjwnjdpxpbmdhcyefvs.supabase.co/functions/v1/traffic-agent-job',
    headers := jsonb_build_object('Content-Type','application/json','x-mcp-key', public.get_mcp_api_key()),
    body := jsonb_build_object('modo','drive_watch','company_id', (select id::text from public.companies where name = 'Legal é Viver')),
    timeout_milliseconds := 150000
  );
  select net.http_post(
    url := 'https://gzjwnjdpxpbmdhcyefvs.supabase.co/functions/v1/drive-audio-transcribe',
    headers := jsonb_build_object('Content-Type','application/json','x-mcp-key', public.get_mcp_api_key()),
    body := '{}'::jsonb,
    timeout_milliseconds := 150000
  );
  $cron$
);
