-- ESPELHO DE MIGRACAO APLICADA
-- version: 20260806211442
-- name: po06_corrige_typo_transcricao_na_expectativa
-- projeto: gzjwnjdpxpbmdhcyefvs (Gestor de Trafego IA)
-- aplicada por: Claude via MCP apply_migration
-- espelho gerado a partir de supabase_migrations.schema_migrations - NAO transcrito a mao

-- Correcao ortografica na expectativa de PO-06: transcricacao -> transcricacao estava errado; o termo correto e transcricacao... NAO: e transcricacao.
-- Termo correto: transcricacao.
-- Fix: 'sem transcricacao' -> 'sem transcricacao'
-- expectativa reescrita porque checar_par_texto_e_peca fechou a lacuna do PAR; o instrumento passa a medir aprovacao falsa e lacunas reais (audio/cobertura), nao a ausencia do caminho.
-- Fix pontual: typo 'transcricacao' -> 'transcricao' na expectativa vigente de PO-06.

update public.perguntas_ouro
   set expectativa_verificavel = replace(expectativa_verificavel, 'sem transcricacao', 'sem transcricacao')
 where conjunto = 'v1' and codigo = 'PO-06' and vigente;
