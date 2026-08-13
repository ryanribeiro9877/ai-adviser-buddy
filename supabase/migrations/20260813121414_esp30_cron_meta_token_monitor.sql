-- ESP-30 fechamento operacional: chave propria do chamador + cron diario 09:15 UTC
-- (antes do bm-monitor 09:20). Popula meta_tokens / meta_business_managers / meta_ad_accounts.
--
-- Aplicada como version 20260813121414. Espelho fiel em
-- supabase/espelhos/20260813121414_esp30_cron_meta_token_monitor.sql

insert into public.mcp_api_keys (chamador, api_key, observacao)
select 'cron:meta-token-monitor',
       encode(sha256((gen_random_uuid()::text || clock_timestamp()::text || 'meta-token-monitor')::bytea), 'hex'),
       'Gerada em 13/08/2026: cron diario do meta-token-monitor (ESP-30) — metadado de expiracao/escopo, nunca o valor do token.'
on conflict (chamador) do nothing;

select cron.schedule(
  'meta-token-monitor-0915',
  '15 9 * * *',
  $$
  select net.http_post(
    url := 'https://gzjwnjdpxpbmdhcyefvs.supabase.co/functions/v1/meta-token-monitor',
    headers := jsonb_build_object(
      'content-type', 'application/json',
      'x-mcp-key', public.get_mcp_api_key('cron:meta-token-monitor')
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 90000
  );
  $$
);
