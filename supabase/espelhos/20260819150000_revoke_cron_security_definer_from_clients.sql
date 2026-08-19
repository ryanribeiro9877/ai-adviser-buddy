-- Exhaustive validation (Front A/C): cron/maintenance SECURITY DEFINER RPCs
-- were EXECUTE-able by `authenticated`. Clients must not call these; only
-- service_role / pg_cron. decide_approval stays available to authenticated.

revoke execute on function public.expire_stale_approvals() from public, anon, authenticated;
revoke execute on function public.evaluate_alerts() from public, anon, authenticated;
revoke execute on function public.disparar_execucao_aprovacao() from public, anon, authenticated;
revoke execute on function public.espelhos_de_migracao(text) from public, anon, authenticated;
revoke execute on function public.notificar_alerta_critico() from public, anon, authenticated;
revoke execute on function public.mcp_keys_prontidao() from public, anon, authenticated;

grant execute on function public.expire_stale_approvals() to service_role;
grant execute on function public.evaluate_alerts() to service_role;
grant execute on function public.disparar_execucao_aprovacao() to service_role;
grant execute on function public.espelhos_de_migracao(text) to service_role;
grant execute on function public.notificar_alerta_critico() to service_role;
grant execute on function public.mcp_keys_prontidao() to service_role;
