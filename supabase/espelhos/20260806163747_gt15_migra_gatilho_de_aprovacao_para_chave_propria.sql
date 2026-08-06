-- ESPELHO DE MIGRACAO APLICADA
-- version: 20260806163747
-- name: gt15_migra_gatilho_de_aprovacao_para_chave_propria
-- projeto: gzjwnjdpxpbmdhcyefvs (Gestor de Trafego IA)
-- aplicada por: Claude via MCP apply_migration
-- espelho gerado a partir de supabase_migrations.schema_migrations - NAO transcrito a mao

-- GT-15 · ultimo chamador: o gatilho disparar_execucao_aprovacao.
--
-- E O CAMINHO DO DINHEIRO: e este gatilho que dispara o meta-actions quando um card e aprovado.
-- Por isso o metodo e o mesmo dos crons e por um motivo mais forte ainda: TRANSFORMAR o corpo
-- existente com replace sobre pg_get_functiondef, nunca redigitar. Redigitar o gatilho de
-- aprovacao a partir de leitura parcial seria a coisa mais perigosa que eu poderia fazer aqui.
--
-- GUARDAS: aborta se o padrao nao existir, aborta se a substituicao nao mudar nada, e aborta se
-- o texto resultante nao comecar com CREATE OR REPLACE FUNCTION - assim um pg_get_functiondef
-- inesperado nao vira um EXECUTE as cegas.

do $$
declare
  v_def text; v_novo text;
begin
  select pg_get_functiondef(p.oid) into v_def
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'disparar_execucao_aprovacao'
   limit 1;

  if v_def is null then
    raise exception 'disparar_execucao_aprovacao nao encontrada - nada alterado';
  end if;

  if position('public.get_mcp_api_key()' in v_def) = 0 then
    raise notice 'o gatilho NAO usa public.get_mcp_api_key() - nada a migrar. Verificar como ele autentica.';
    return;
  end if;

  v_novo := replace(v_def, 'public.get_mcp_api_key()',
                    'public.get_mcp_api_key(' || quote_literal('trigger:disparar_execucao_aprovacao') || ')');

  if v_novo = v_def then
    raise exception 'substituicao sem efeito no gatilho - abortado';
  end if;

  if v_novo !~* '^\s*CREATE OR REPLACE FUNCTION' then
    raise exception 'definicao inesperada - nao vou executar as cegas';
  end if;

  execute v_novo;
  raise notice 'gatilho migrado para chave propria';
end $$;