-- ESPELHO DE MIGRACAO APLICADA
-- version: 20260804152219
-- name: rpc_espelhos_de_migracao
-- projeto: gzjwnjdpxpbmdhcyefvs (Gestor de Trafego IA)
-- aplicada por: Claude via MCP apply_migration
-- espelho gerado a partir de supabase_migrations.schema_migrations - NAO transcrito a mao

-- 04/08/2026 - GT-20, a parte que e minha: gerar espelho de migracao a partir da FONTE.
--
-- CONTEXTO: 22 migracoes foram aplicadas em 03 e 04/08 via apply_migration e nenhuma tem arquivo
-- espelho no repositorio. O SQL autoritativo esta em supabase_migrations.schema_migrations, que
-- o cliente REST nao expoe (PostgREST so publica o schema public). Reproduzir o SQL a mao seria
-- exatamente a deriva de transcricao que este projeto passou o dia consertando - o espelho tem
-- que sair da fonte, com cabecalho no formato da convencao, e nao da memoria de ninguem.
--
-- Esta RPC devolve o espelho PRONTO para gravar em arquivo: nome do arquivo e conteudo.

CREATE OR REPLACE FUNCTION public.espelhos_de_migracao(p_desde text DEFAULT '20260101000000')
RETURNS TABLE (arquivo text, conteudo text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT
    m.version || '_' || m.name || '.sql' AS arquivo,
    '-- ESPELHO DE MIGRACAO APLICADA' || chr(10) ||
    '-- version: ' || m.version || chr(10) ||
    '-- name: ' || m.name || chr(10) ||
    '-- projeto: gzjwnjdpxpbmdhcyefvs (Gestor de Trafego IA)' || chr(10) ||
    '-- aplicada por: Claude via MCP apply_migration' || chr(10) ||
    '-- espelho gerado a partir de supabase_migrations.schema_migrations - NAO transcrito a mao' || chr(10) ||
    chr(10) ||
    array_to_string(m.statements, ';' || chr(10) || chr(10)) AS conteudo
  FROM supabase_migrations.schema_migrations m
  WHERE m.version >= p_desde
  ORDER BY m.version;
$$;

COMMENT ON FUNCTION public.espelhos_de_migracao(text) IS
  'Gera o espelho de cada migracao aplicada, a partir da propria trilha. Usada para reconstruir os arquivos de espelho no repositorio sem transcrever SQL a mao.';

REVOKE ALL ON FUNCTION public.espelhos_de_migracao(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.espelhos_de_migracao(text) TO service_role;