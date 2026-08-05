-- ESPELHO DE MIGRACAO APLICADA
-- version: 20260805182543
-- name: cron_janela_ampla_um_nivel_por_corrida
-- projeto: gzjwnjdpxpbmdhcyefvs (Gestor de Trafego IA)
-- aplicada por: Claude via MCP apply_migration
-- espelho gerado a partir de supabase_migrations.schema_migrations - NAO transcrito a mao

-- A corrida semanal unica da janela ampla nao cabia no teto de 150s do pg_net: em 02/08/2026 o
-- passo de CONJUNTO gravou aos 154s (08:02:34) e o passo de ANUNCIO, logo em seguida, nunca
-- escreveu - `ads.last_synced_at` ficou em 27/07 nas tres contas. O cron marcava "succeeded"
-- porque so mede o enfileiramento do http_post, nao a resposta da edge.
-- Passa a haver uma corrida por nivel, cada uma com o teto inteiro para si (windsor-sync v18,
-- parametro wide_only). 20 minutos de intervalo: folga de ordem de grandeza sobre os 150s.
select cron.unschedule('windsor-wide-weekly');

select cron.schedule(
  'windsor-wide-adsets-weekly',
  '0 8 * * 0',
  $cron$
  select net.http_post(
    url := 'https://gzjwnjdpxpbmdhcyefvs.supabase.co/functions/v1/windsor-sync',
    headers := jsonb_build_object('Content-Type','application/json','Authorization','Bearer ' || public.get_mcp_api_key()),
    body := jsonb_build_object('wide_only','adsets','wide_from', to_char(current_date - interval '12 months','YYYY-MM-DD')),
    timeout_milliseconds := 150000
  );
  $cron$
);

select cron.schedule(
  'windsor-wide-ads-weekly',
  '20 8 * * 0',
  $cron$
  select net.http_post(
    url := 'https://gzjwnjdpxpbmdhcyefvs.supabase.co/functions/v1/windsor-sync',
    headers := jsonb_build_object('Content-Type','application/json','Authorization','Bearer ' || public.get_mcp_api_key()),
    body := jsonb_build_object('wide_only','ads','wide_from', to_char(current_date - interval '12 months','YYYY-MM-DD')),
    timeout_milliseconds := 150000
  );
  $cron$
);
