-- Harden SECURITY DEFINER surface for clients.
-- Keep only RPCs the front actually calls + RLS helpers.
-- Edges/cron use service_role. Also restore evaluate_alerts (admin UI in metas).

-- Restore admin UI RPC revoked too aggressively in 20260819150000.
grant execute on function public.evaluate_alerts() to authenticated;

-- Cron / ingest / digest / drive / trigger — not called from src/
revoke execute on function public.check_conhecimento_validade() from public, anon, authenticated;
revoke execute on function public.check_data_freshness() from public, anon, authenticated;
revoke execute on function public.computar_perfil_vencedor(uuid, integer, boolean) from public, anon, authenticated;
revoke execute on function public.drive_plano_de_varredura(uuid) from public, anon, authenticated;
revoke execute on function public.drive_plano_de_varredura(uuid, text, text) from public, anon, authenticated;
revoke execute on function public.drive_registrar_varredura(uuid, text, integer) from public, anon, authenticated;
revoke execute on function public.montar_corpo_digest(uuid, date) from public, anon, authenticated;
revoke execute on function public.ler_entregas_digest(uuid, integer) from public, anon, authenticated;
revoke execute on function public.aplicar_veredito_de_card(uuid) from public, anon, authenticated;
revoke execute on function public.registrar_veredito_peca_em_revisao(uuid, text, text, text, text, uuid, uuid) from public, anon, authenticated;
revoke execute on function public.snapshot_campaign_config() from public, anon, authenticated;
revoke execute on function public.sync_ingest_breakdown(jsonb) from public, anon, authenticated;
revoke execute on function public.trg_drive_herda_liberacao() from public, anon, authenticated;
revoke execute on function public.set_meta_execution_config(boolean, boolean, jsonb, integer) from public, anon, authenticated;
revoke execute on function public.casar_criativo_performance(uuid, text, text, integer) from public, anon, authenticated;
revoke execute on function public.get_meta_dicas(uuid, integer, text) from public, anon, authenticated;
revoke execute on function public.get_acervo_para_anuncio(uuid, text, boolean) from public, anon, authenticated;
revoke execute on function public.avaliar_estado_destino_execucao(text, jsonb, uuid) from public, anon, authenticated;
revoke execute on function public.avaliar_orcamento_diario(uuid, numeric, integer) from public, anon, authenticated;
revoke execute on function public.inferir_produto_anuncio(uuid, jsonb) from public, anon, authenticated;
revoke execute on function public.ler_brand_identity(uuid) from public, anon, authenticated;
revoke execute on function public.ler_perfil_vencedor(uuid, integer) from public, anon, authenticated;
revoke execute on function public.peca_bloqueada_por_revisao(uuid, text, text, text) from public, anon, authenticated;
revoke execute on function public.pedido_de_anuncio_completo(uuid, jsonb) from public, anon, authenticated;
revoke execute on function public.pedido_de_anuncio_completo_sem_estado_destino(uuid, jsonb) from public, anon, authenticated;
revoke execute on function public.pode_executar_acao(uuid, text) from public, anon, authenticated;
revoke execute on function public.resolver_destino_do_anuncio(uuid, jsonb, text) from public, anon, authenticated;
revoke execute on function public.resolver_driver(uuid, text) from public, anon, authenticated;
revoke execute on function public.saude_dos_tokens(uuid, integer) from public, anon, authenticated;
revoke execute on function public.score_de_prontidao(uuid) from public, anon, authenticated;

-- get_criativos_conteudo: revoke anon; keep authenticated only on the overloads that need it
revoke execute on function public.get_criativos_conteudo(boolean, uuid) from anon;
revoke execute on function public.get_criativos_conteudo(boolean, uuid, integer, integer) from anon;

grant execute on function public.check_conhecimento_validade() to service_role;
grant execute on function public.check_data_freshness() to service_role;
grant execute on function public.computar_perfil_vencedor(uuid, integer, boolean) to service_role;
grant execute on function public.drive_plano_de_varredura(uuid) to service_role;
grant execute on function public.drive_plano_de_varredura(uuid, text, text) to service_role;
grant execute on function public.drive_registrar_varredura(uuid, text, integer) to service_role;
grant execute on function public.montar_corpo_digest(uuid, date) to service_role;
grant execute on function public.ler_entregas_digest(uuid, integer) to service_role;
grant execute on function public.aplicar_veredito_de_card(uuid) to service_role;
grant execute on function public.registrar_veredito_peca_em_revisao(uuid, text, text, text, text, uuid, uuid) to service_role;
grant execute on function public.snapshot_campaign_config() to service_role;
grant execute on function public.sync_ingest_breakdown(jsonb) to service_role;
grant execute on function public.trg_drive_herda_liberacao() to service_role;
grant execute on function public.set_meta_execution_config(boolean, boolean, jsonb, integer) to service_role;
grant execute on function public.casar_criativo_performance(uuid, text, text, integer) to service_role;
grant execute on function public.get_meta_dicas(uuid, integer, text) to service_role;
grant execute on function public.get_acervo_para_anuncio(uuid, text, boolean) to service_role;
grant execute on function public.avaliar_estado_destino_execucao(text, jsonb, uuid) to service_role;
grant execute on function public.avaliar_orcamento_diario(uuid, numeric, integer) to service_role;
grant execute on function public.inferir_produto_anuncio(uuid, jsonb) to service_role;
grant execute on function public.ler_brand_identity(uuid) to service_role;
grant execute on function public.ler_perfil_vencedor(uuid, integer) to service_role;
grant execute on function public.peca_bloqueada_por_revisao(uuid, text, text, text) to service_role;
grant execute on function public.pedido_de_anuncio_completo(uuid, jsonb) to service_role;
grant execute on function public.pedido_de_anuncio_completo_sem_estado_destino(uuid, jsonb) to service_role;
grant execute on function public.pode_executar_acao(uuid, text) to service_role;
grant execute on function public.resolver_destino_do_anuncio(uuid, jsonb, text) to service_role;
grant execute on function public.resolver_driver(uuid, text) to service_role;
grant execute on function public.saude_dos_tokens(uuid, integer) to service_role;
grant execute on function public.score_de_prontidao(uuid) to service_role;
