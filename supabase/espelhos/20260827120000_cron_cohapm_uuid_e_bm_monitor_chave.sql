-- Crons COHAPM: company_id UUID (nao nome substring) + bm-monitor na chave propria.
--
-- 1) escoar COHAPM usava company='COHAPM' + ilike %COHAPM% na edge. Isso casa
--    COHAPM e Cooperativa_ Cohapm; maybeSingle falha e a edge devolve 404
--    "empresa nao encontrada: COHAPM" (medido em net._http_response 27/08/2026 09:21 e 09:26).
--    A chave MCP do chamador estava certa; o lookup da empresa nao.
-- 2) bm-monitor-0920 ainda autenticava com mcp_config.id=1 (legado da Legal).
--    Troca para cron:bm-monitor-0920.

SELECT cron.unschedule(jobid) FROM cron.job WHERE jobname = 'escoar-imagens-cohapm-hora';
SELECT cron.schedule(
  'escoar-imagens-cohapm-hora',
  '21 * * * *',
  $$
  select net.http_post(
    url := 'https://gzjwnjdpxpbmdhcyefvs.supabase.co/functions/v1/upload-midia',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-mcp-key', public.get_mcp_api_key('cron:escoar-imagens-cohapm-hora')
    ),
    body := jsonb_build_object(
      'acao', 'escoar_imagens',
      'company_id', '57f755b9-c23d-4f58-a488-8173d697c010',
      'company', 'COHAPM',
      'account_id', 'act_1622612945584817'
    ),
    timeout_milliseconds := 150000
  );
  $$
);

SELECT cron.unschedule(jobid) FROM cron.job WHERE jobname = 'escoar-videos-cohapm-hora';
SELECT cron.schedule(
  'escoar-videos-cohapm-hora',
  '26 * * * *',
  $$
  select net.http_post(
    url := 'https://gzjwnjdpxpbmdhcyefvs.supabase.co/functions/v1/upload-midia',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-mcp-key', public.get_mcp_api_key('cron:escoar-videos-cohapm-hora')
    ),
    body := jsonb_build_object(
      'acao', 'escoar_videos',
      'company_id', '57f755b9-c23d-4f58-a488-8173d697c010',
      'company', 'COHAPM',
      'account_id', 'act_1622612945584817'
    ),
    timeout_milliseconds := 150000
  );
  $$
);

SELECT cron.unschedule(jobid) FROM cron.job WHERE jobname = 'bm-monitor-0920';
SELECT cron.schedule(
  'bm-monitor-0920',
  '20 9 * * *',
  $$
  select net.http_post(
    url := 'https://gzjwnjdpxpbmdhcyefvs.supabase.co/functions/v1/bm-monitor',
    headers := jsonb_build_object(
      'Content-Type','application/json',
      'x-mcp-key', public.get_mcp_api_key('cron:bm-monitor-0920')
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 90000
  );
  $$
);

-- Alertas de quota 80004 nao sao token ausente; o sino nao deve ficar vermelho
-- ate o proximo dia depois do conserto do coletor.
update public.alerts
   set resolved = true
 where resolved = false
   and title like '[BM][%] Falha ao consultar a conta de anúncios'
   and description ilike '%80004%';

insert into public.agent_context (company_id, categoria, fato, vigente)
select '57f755b9-c23d-4f58-a488-8173d697c010', 'cron_isolamento',
  'CRONS COHAPM (27/08/2026): escoar imagens/videos passam company_id UUID 57f755b9-…, nao so o nome COHAPM. O nome substring casava Cooperativa_ Cohapm e a edge respondia 404. Token Ads continua META_ADS_TOKEN_COHAPM (sem emprestar o da Legal). A coleta diaria Graph so varre contas estado_operacional=ativa para nao estourar cota 80004.',
  true
where not exists (
  select 1 from public.agent_context
   where company_id = '57f755b9-c23d-4f58-a488-8173d697c010'
     and categoria = 'cron_isolamento'
     and vigente
     and fato like 'CRONS COHAPM (27/08/2026):%'
);
