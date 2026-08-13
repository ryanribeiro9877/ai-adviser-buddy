-- ESPELHO DE MIGRACAO APLICADA
-- version: 20260813161344
-- name: fecha_anon_revogando_de_public_correcao
-- projeto: gzjwnjdpxpbmdhcyefvs (Gestor de Trafego IA)
-- aplicada por: Claude via MCP apply_migration
-- espelho gerado a partir de supabase_migrations.schema_migrations - NAO transcrito a mao

-- Auditoria de seguranca 13/08/2026, parte 2 de 2 - a que efetivamente fechou.
-- Ler 20260813161229 primeiro: lá esta a prova do furo e o registro do no-op.
--
-- ALVO CERTO: PUBLIC, nao anon. O ACL das 12 era
--   "=X/postgres postgres=X/postgres authenticated=X/postgres service_role=X/postgres"
-- O primeiro item, com grantee vazio, e o pseudo-papel PUBLIC - Postgres concede
-- EXECUTE a PUBLIC por padrao ao criar funcao. anon herdava dali, entao
-- `revoke ... from anon` nao removia nada.
--
-- POR QUE REVOGAR DE PUBLIC NAO QUEBRA NADA: authenticated e service_role tem
-- grant EXPLICITO nas 12 (confirmado no ACL acima, nas 12, uma por uma antes de
-- aplicar). Revogar de PUBLIC atinge so quem dependia da heranca - anon.

revoke execute on function public.aplicar_veredito_de_card(uuid) from public;
revoke execute on function public.disparar_execucao_aprovacao() from public;
revoke execute on function public.notificar_alerta_critico() from public;
revoke execute on function public.registrar_veredito_peca_em_revisao(
  uuid, text, text, text, text, uuid, uuid) from public;
revoke execute on function public.snapshot_campaign_config() from public;
revoke execute on function public.sync_ingest_breakdown(jsonb) from public;
revoke execute on function public.trg_drive_herda_liberacao() from public;
revoke execute on function public.drive_plano_de_varredura(uuid, text, text) from public;
revoke execute on function public.inferir_produto_anuncio(uuid, jsonb) from public;
revoke execute on function public.mcp_keys_prontidao() from public;
revoke execute on function public.peca_bloqueada_por_revisao(uuid, text, text, text) from public;
revoke execute on function public.resolver_destino_do_anuncio(uuid, jsonb, text) from public;

-- VERIFICACAO DEPOIS DE APLICAR (a mesma chamada que vazava, agora negada):
--
--   POST /rest/v1/rpc/mcp_keys_prontidao      -> HTTP 401
--     {"code":"42501","message":"permission denied for function mcp_keys_prontidao"}
--   POST /rest/v1/rpc/snapshot_campaign_config -> HTTP 401  42501
--   GET  /rest/v1/integration_secrets          -> HTTP 401  42501
--   GET  /rest/v1/mcp_api_keys                 -> HTTP 401  42501
--   (idem mcp_config, agent_knowledge, agent_style)
--
-- Catalogo, que e a fonte que nao depende de status HTTP:
--   funcoes SECURITY DEFINER com anon EXECUTE ......  12 -> 0
--   funcoes sem search_path fixo ...................  44 -> 0
--   grants de anon nas 5 tabelas ....................  35 -> 0
--   as 12 ainda executaveis por authenticated .......  13/13 (com sobrecargas)
--   as 12 ainda executaveis por service_role ........  13/13
--   as 5 RPCs do front, para authenticated ..........   5/5
--
-- Lint de seguranca do Supabase: as categorias
-- anon_security_definer_function_executable (12) e function_search_path_mutable
-- (44) sairam inteiras da lista.
--
-- PENDENCIAS DELIBERADAMENTE NAO MEXIDAS aqui (nao sao regressao, sao decisao):
--   - authenticated_security_definer_function_executable: ~39 funcoes seguem
--     chamaveis por usuario logado. E por design (o app roda como authenticated),
--     mas vale revisar uma a uma se o app ganhar papel de viewer nao-admin.
--   - as 5 tabelas com RLS ligado e ZERO policy seguem assim (INFO no lint):
--     deny-all implicito, alcancadas so por service_role. Agora com duas camadas,
--     nao uma - RLS + ausencia de grant.
--   - authenticated tambem tem grant total nas 5 tabelas de credencial. Nao foi
--     tocado por estar fora do escopo aprovado (que era fechar anon). Hoje o RLS
--     deny-all segura; fechar tambem esse lado e a proxima recomendacao.
