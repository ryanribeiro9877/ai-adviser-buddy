-- ESPELHO DE MIGRACAO APLICADA
-- version: 20260811174819
-- name: drop_peca_bloqueada_overload_3arg
-- projeto: gzjwnjdpxpbmdhcyefvs (Gestor de Trafego IA)
-- aplicada por: Claude via MCP apply_migration
-- espelho gerado a partir de supabase_migrations.schema_migrations - NAO transcrito a mao

drop function if exists public.peca_bloqueada_por_revisao(uuid, text, text);

-- reaffirm 4-arg is the only one
select pg_get_function_identity_arguments(oid) as args from pg_proc where proname='peca_bloqueada_por_revisao';

-- ---------------------------------------------------------------------------
-- MIGRACAO INTERMEDIARIA ABSORVIDA - nao tem (nem deve ter) arquivo em
-- supabase/migrations/.
--
-- Nasceu de execute_sql durante o trabalho paralelo de 11/08 e a trilha ficou
-- dividida. O mesmo drop, com a mesma justificativa (a assinatura de 4 args com
-- default null convive com a de 3 e o Postgres deixa de resolver chamadas de 3
-- args, erro 42725 function is not unique), foi absorvido por
-- 20260811180000_peca_nova_de_imagem_link_data.sql, que versiona o drop
-- imediatamente antes de recriar peca_bloqueada_por_revisao na assinatura de 4
-- args - a ordem correta para replay. Versionar este arquivo tambem repetiria o
-- drop fora de ordem, sem nenhum efeito novo.
--
-- A segunda linha e uma sonda de leitura (select ... from pg_proc), sem efeito
-- de schema; fica aqui so como registro do que rodou.
-- ---------------------------------------------------------------------------
