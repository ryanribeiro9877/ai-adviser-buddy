-- ESPELHO DE MIGRACAO APLICADA
-- version: 20260727212751
-- name: schedule_watchdog_frescor_0945
-- projeto: gzjwnjdpxpbmdhcyefvs (Gestor de Trafego IA)
-- aplicada por: Claude via MCP apply_migration
-- espelho gerado a partir de supabase_migrations.schema_migrations - NAO transcrito a mao

-- Cron do watchdog as 09:45 UTC: DEPOIS de todos os jobs de ingestao e monitoramento
-- (09:00 windsor-sync, 09:10 meta-campaign-status, 09:15 alerts-eval, 09:20 bm-monitor,
-- 09:30 waba-sync), para que ele avalie o resultado do dia inteiro e nao um estado parcial.
-- Chamada direta a funcao SQL: sem pg_net, sem edge, portanto sem IDLE_TIMEOUT.
select cron.schedule('watchdog-frescor-0945', '45 9 * * *', $$select public.check_data_freshness();$$);