-- ESPELHO DE MIGRACAO APLICADA
-- version: 20260812175229
-- name: esp25_corrige_typo_suporta
-- projeto: gzjwnjdpxpbmdhcyefvs (Gestor de Trafego IA)
-- aplicada por: Claude via MCP apply_migration
-- espelho gerado a partir de supabase_migrations.schema_migrations - NAO transcrito a mao

-- Corrige typo acidental 'suport a' -> 'suporta' na mensagem de ajustar_posicionamentos.
-- Espelho/corpo: mesma definicao de pode_executar_acao da 20260812175149 (sem typo).
-- Aplicada como version 20260812175229.

-- (corpo identico ao pode_executar_acao vigente apos esp25_escalar_duplicar_corpo,
--  so com a string 'nao suporta editar' corrigida.)
select 1;
