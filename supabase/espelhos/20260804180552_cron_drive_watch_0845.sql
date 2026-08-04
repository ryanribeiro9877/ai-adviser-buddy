-- ESPELHO DE MIGRACAO APLICADA
-- version: 20260804180552
-- name: cron_drive_watch_0845
-- projeto: gzjwnjdpxpbmdhcyefvs (Gestor de Trafego IA)
-- aplicada por: Claude via MCP apply_migration
-- espelho gerado a partir de supabase_migrations.schema_migrations - NAO transcrito a mao

-- 04/08/2026 - Cron do monitoramento de Drive. Registrado DEPOIS de provado, nao antes:
-- prova real em 04/08 18:04 devolveu 200 com job-v2.5, 1 pasta ativa, 0 pecas novas, 5,6s,
-- zero chamada de LLM de raciocinio, e a marca de varredura atualizou.
--
-- HORARIO 08:45, de proposito ANTES do windsor-sync das 09:00: assim peca nova do dia entra no
-- espelho antes da coleta de metrica, e o relatorio das 11:30 ja pode considera-la.
--
-- UMA EMPRESA POR ENTRADA, de proposito. A RPC do plano e por empresa porque a pasta do Joao e da
-- Legal e Viver e nao pode ser lida sob a COHAPM. Hoje so a Legal tem pasta cadastrada em
-- drive_pastas_monitoradas - quando outra empresa tiver, acrescenta-se uma entrada de cron, e nao
-- se generaliza a chamada. Generalizar aqui seria reabrir o vazamento entre empresas pela porta
-- do agendador.
SELECT cron.schedule(
  'drive-watch-0845',
  '45 8 * * *',
  $$
  select net.http_post(
    url := 'https://gzjwnjdpxpbmdhcyefvs.supabase.co/functions/v1/traffic-agent-job',
    headers := jsonb_build_object('Content-Type','application/json','x-mcp-key', public.get_mcp_api_key()),
    body := jsonb_build_object('modo','drive_watch','company_id', (select id::text from public.companies where name = 'Legal é Viver')),
    timeout_milliseconds := 150000
  );
  $$
);