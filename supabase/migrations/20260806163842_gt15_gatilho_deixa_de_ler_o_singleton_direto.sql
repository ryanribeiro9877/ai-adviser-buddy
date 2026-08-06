-- ESPELHO DE MIGRACAO APLICADA
-- version: 20260806163842
-- name: gt15_gatilho_deixa_de_ler_o_singleton_direto
-- projeto: gzjwnjdpxpbmdhcyefvs (Gestor de Trafego IA)
-- aplicada por: Claude via MCP apply_migration
-- espelho gerado a partir de supabase_migrations.schema_migrations - NAO transcrito a mao

-- GT-15 · o gatilho de aprovacao deixa de ler mcp_config direto.
--
-- O QUE ELE FAZIA: "select api_key into v_key from public.mcp_config where id = 1;" - leitura
-- DIRETA do singleton, sem passar por get_mcp_api_key(). Por isso a minha varredura anterior por
-- 'get_mcp_api_key()' nao o encontrou: minha premissa estava errada, o levantamento de ontem
-- buscou 'mcp_config' e eu confundi os dois criterios.
--
-- Este era o ULTIMO chamador da chave legada. Com ele migrado, nada no banco depende mais do
-- singleton - e a revogacao da legada passa a ser possivel, medida pela prontidao.
--
-- METODO: substituicao de uma linha exata no corpo existente, via pg_get_functiondef, com as
-- mesmas tres guardas dos crons. O gatilho tem 695 caracteres e mesmo assim eu nao redigito:
-- e ele que dispara o meta-actions quando um card e aprovado.

do $$
declare
  v_def text; v_novo text;
  v_antigo text := 'select api_key into v_key from public.mcp_config where id = 1;';
  v_substituto text := 'v_key := public.get_mcp_api_key(''trigger:disparar_execucao_aprovacao'');';
begin
  select pg_get_functiondef(p.oid) into v_def
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'disparar_execucao_aprovacao' limit 1;

  if v_def is null then
    raise exception 'gatilho nao encontrado - nada alterado';
  end if;

  if position(v_antigo in v_def) = 0 then
    raise exception 'a linha esperada nao esta no corpo do gatilho - nada alterado, para nao quebrar o caminho de aprovacao';
  end if;

  v_novo := replace(v_def, v_antigo, v_substituto);

  if v_novo = v_def then
    raise exception 'substituicao sem efeito - abortado';
  end if;

  if v_novo !~* '^\s*CREATE OR REPLACE FUNCTION' then
    raise exception 'definicao inesperada - nao vou executar as cegas';
  end if;

  execute v_novo;
  raise notice 'gatilho migrado: passa a usar get_mcp_api_key(trigger:disparar_execucao_aprovacao)';
end $$;