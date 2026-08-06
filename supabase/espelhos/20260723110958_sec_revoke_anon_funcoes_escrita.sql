-- ESPELHO DE MIGRACAO APLICADA
-- version: 20260723110958
-- name: sec_revoke_anon_funcoes_escrita
-- projeto: gzjwnjdpxpbmdhcyefvs (Gestor de Trafego IA)
-- aplicada por: Claude via MCP apply_migration
-- espelho gerado a partir de supabase_migrations.schema_migrations - NAO transcrito a mao

-- Hardening (varredura 22/07, lição DEF-1): funções SECURITY DEFINER de escrita
-- estavam executáveis por anon (grant default de PUBLIC no CREATE FUNCTION).
-- Consumidores mapeados ANTES do revoke:
--   - pg_cron: roda como postgres (dono) — imune a revoke;
--   - edge windsor-sync: usa SUPABASE_SERVICE_ROLE_KEY — grant explícito abaixo;
--   - UI (botão "Reavaliar alertas agora"): authenticated — mantido SÓ em evaluate_alerts.
-- sync_ingest_windsor já estava blindado (padrão de hardening anterior); estas
-- nasceram depois sem o mesmo tratamento.
do $$
declare f record;
begin
  for f in
    select p.oid::regprocedure as sig, p.proname
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname in ('evaluate_alerts','match_proposals_batch',
                        'sync_ingest_ads','sync_ingest_adsets','sync_ingest_ad_snapshots')
  loop
    execute format('revoke execute on function %s from public, anon', f.sig);
    if f.proname <> 'evaluate_alerts' then
      execute format('revoke execute on function %s from authenticated', f.sig);
    end if;
    execute format('grant execute on function %s to service_role', f.sig);
  end loop;
end $$;