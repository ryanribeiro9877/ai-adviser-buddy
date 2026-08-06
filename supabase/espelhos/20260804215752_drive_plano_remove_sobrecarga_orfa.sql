-- ESPELHO DE MIGRACAO APLICADA
-- version: 20260804215752
-- name: drive_plano_remove_sobrecarga_orfa
-- projeto: gzjwnjdpxpbmdhcyefvs (Gestor de Trafego IA)
-- aplicada por: Claude via MCP apply_migration
-- espelho gerado a partir de supabase_migrations.schema_migrations - NAO transcrito a mao

-- 04/08/2026 - A versao de DOIS parametros ficou viva ao lado da de tres, e chamada com dois
-- argumentos virou ambigua (42725: could not choose a best candidate). Como a nova tem
-- p_mime_prefixo com DEFAULT NULL, ela atende sozinha as chamadas de dois argumentos - a antiga
-- e puro risco de ambiguidade. Removida.
-- LICAO: acrescentar parametro com default NAO substitui a assinatura anterior no Postgres -
-- cria sobrecarga. Quem chama com o numero antigo de argumentos passa a ter duas candidatas.
DROP FUNCTION IF EXISTS public.drive_plano_de_varredura(uuid, text);