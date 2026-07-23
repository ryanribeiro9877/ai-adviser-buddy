-- ============================================================================
-- ESPELHO: migração sec_revoke_anon_funcoes_escrita — hardening de grants
-- Projeto: gestão_marketing (gzjwnjdpxpbmdhcyefvs) · Aplicada: 22/07/2026
-- ATENÇÃO: espelho para git. NÃO re-executar (já aplicada; re-executar é inócuo
-- mas desnecessário).
--
-- ACHADO (varredura pós-F1.3, lição DEF-1/JurisAI): 5 funções SECURITY DEFINER
-- de ESCRITA estavam executáveis por anon via REST (grant default de PUBLIC no
-- CREATE FUNCTION): evaluate_alerts, match_proposals_batch, sync_ingest_ads,
-- sync_ingest_adsets, sync_ingest_ad_snapshots. Qualquer pessoa com a URL do
-- projeto poderia recomputar alertas ou INJETAR dados falsos de anúncio.
-- sync_ingest_windsor já estava blindada (hardening anterior) — as demais
-- nasceram depois sem o mesmo tratamento.
--
-- CONSUMIDORES MAPEADOS ANTES DO REVOKE:
--   pg_cron            -> roda como postgres (dono): imune
--   edge windsor-sync  -> SUPABASE_SERVICE_ROLE_KEY (confirmado no fonte v12): grant explícito
--   UI "Reavaliar agora" -> authenticated: mantido SÓ em evaluate_alerts
--
-- VALIDAÇÃO: matriz de has_function_privilege conferida (anon=false em todas;
-- authenticated=true só em evaluate_alerts; service_role=true em todas) +
-- disparo real do windsor-sync pós-revoke (net.http_post) retornou 200 ok:true.
-- ============================================================================
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
