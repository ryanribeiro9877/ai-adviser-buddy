-- ESPELHO DE MIGRACAO APLICADA
-- version: 20260813161229
-- name: fecha_anon_em_rpcs_definer_e_tabelas_de_credencial
-- projeto: gzjwnjdpxpbmdhcyefvs (Gestor de Trafego IA)
-- aplicada por: Claude via MCP apply_migration
-- espelho gerado a partir de supabase_migrations.schema_migrations - NAO transcrito a mao

-- Auditoria de seguranca 13/08/2026, parte 1 de 2. LER JUNTO COM
-- 20260813161344_fecha_anon_revogando_de_public_correcao.sql: a parte de FUNCAO
-- deste arquivo NAO teve efeito, e a correcao esta lá. Ver "O QUE FALHOU" abaixo.
--
-- PROVA DO FURO (nao era teorico). Com apenas a chave publishable, que e publica
-- por design e vai no bundle do cliente, uma chamada NAO autenticada respondeu
-- 200 com dado interno:
--
--   POST /rest/v1/rpc/mcp_keys_prontidao   -> HTTP 200
--   {"chaves":[{"usos":0,"ativa":true,"chamador":"cron:bm-monitor-0920",...},
--              {"usos":30,...,"chamador":"cron:drive-watch-0845",...}, ...]}
--
-- Eram 12 funcoes SECURITY DEFINER (rodam com o privilegio do dono, ou seja
-- ignoram RLS) alcancaveis por anon, 7 delas VOLATILE - capazes de escrever,
-- incluindo aplicar_veredito_de_card e disparar_execucao_aprovacao. As de
-- escrita NAO foram exercitadas de proposito: confirmar o grant no catalogo
-- basta, e disparar aprovacao/execucao em producao para "provar" seria causar o
-- dano em vez de fechar.
--
-- POR QUE FOI SEGURO REVOGAR (verificado antes, nao presumido):
--   - as 24 edge functions usam SERVICE_ROLE, que ignora grant de papel;
--     nenhuma usa a chave anon/publishable;
--   - o front chama exatamente 5 RPCs (decide_approval, evaluate_alerts,
--     get_notificacoes_pendentes, get_report_export_data,
--     get_weekly_report_data) e NENHUMA das 12 esta nessa lista;
--   - essas 5 ja tinham anon sem EXECUTE. A postura pretendida do projeto ja era
--     "anon sem EXECUTE" - as 12 eram desvio, nao decisao.
--
-- O QUE FALHOU NESTE ARQUIVO, e o registro fica porque a licao importa:
-- os 12 `revoke execute ... from anon` foram NO-OP. O grant nunca esteve em anon:
-- estava no pseudo-papel PUBLIC (ACL "=X/postgres", grantee vazio), que anon
-- herda. Revogar de um papel nao remove o que vem de PUBLIC.
-- Pior, a primeira verificacao por HTTP pareceu confirmar o conserto: 10 das 12
-- passaram a responder 404. Nao era permissao - era PGRST202 ("no function
-- matches"), porque a chamada de teste mandou {} e essas funcoes exigem
-- argumento. Duas seguiram devolvendo 200, e foi isso que denunciou o no-op.
-- O check que nao mente e o do catalogo: has_function_privilege('anon', oid,
-- 'EXECUTE'), que continuava true nas 12.
--
-- A parte de TABELA (revoke all ... from anon) FUNCIONOU: ali o grant era
-- explicito em anon, vindo do GRANT ALL ON ALL TABLES padrao do Supabase.

revoke all on table public.integration_secrets from anon;
revoke all on table public.mcp_api_keys       from anon;
revoke all on table public.mcp_config         from anon;
revoke all on table public.agent_knowledge    from anon;
revoke all on table public.agent_style        from anon;

revoke execute on function public.aplicar_veredito_de_card(uuid) from anon;
revoke execute on function public.disparar_execucao_aprovacao() from anon;
revoke execute on function public.notificar_alerta_critico() from anon;
revoke execute on function public.registrar_veredito_peca_em_revisao(
  uuid, text, text, text, text, uuid, uuid) from anon;
revoke execute on function public.snapshot_campaign_config() from anon;
revoke execute on function public.sync_ingest_breakdown(jsonb) from anon;
revoke execute on function public.trg_drive_herda_liberacao() from anon;

revoke execute on function public.drive_plano_de_varredura(uuid, text, text) from anon;
revoke execute on function public.inferir_produto_anuncio(uuid, jsonb) from anon;
revoke execute on function public.mcp_keys_prontidao() from anon;
revoke execute on function public.peca_bloqueada_por_revisao(uuid, text, text, text) from anon;
revoke execute on function public.resolver_destino_do_anuncio(uuid, jsonb, text) from anon;

-- search_path mutavel: eram 44 no lint do Supabase, ficaram 0.
-- Sem search_path fixo, quem puder criar objeto num schema que venha antes na
-- resolucao faz a funcao chamar o objeto dele; em SECURITY DEFINER isso roda com
-- o privilegio do dono.
-- Feito pelo catalogo, e nao com 44 ALTER a mao, porque a assinatura exata de
-- cada uma e onde o erro humano entra; e idempotente (so alcanca quem ainda nao
-- tem search_path).
-- public, pg_temp e suficiente: a unica funcao que referencia schema de fora e
-- disparar_execucao_aprovacao, via net.http_post - nome QUALIFICADO, que nao
-- depende de search_path. Verificado que o schema `net` existe e contem
-- http_post (pg_net registra a extensao em public mas cria objeto em net).
do $$
declare
  r record;
  n int := 0;
begin
  for r in
    select p.oid::regprocedure as assinatura
    from pg_proc p
    join pg_namespace ns on ns.oid = p.pronamespace
    where ns.nspname = 'public'
      and p.prokind in ('f', 'p')
      and not exists (
        select 1 from unnest(coalesce(p.proconfig, '{}'::text[])) c
        where c like 'search_path=%'
      )
  loop
    execute format('alter function %s set search_path = public, pg_temp', r.assinatura);
    n := n + 1;
  end loop;
  raise notice 'search_path fixado em % funcoes', n;
end $$;
