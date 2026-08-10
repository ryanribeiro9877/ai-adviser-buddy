-- ESPELHO DE MIGRACAO APLICADA
-- version: 20260810175626
-- name: approval_entity_ganha_peca_em_revisao
-- projeto: gzjwnjdpxpbmdhcyefvs (Gestor de Trafego IA)
-- aplicada por: Claude via MCP apply_migration
-- espelho gerado a partir de supabase_migrations.schema_migrations - NAO transcrito a mao

-- O card de veredito de compliance nao e campanha, conjunto, anuncio, publico nem config: o
-- objeto decidido e a PECA em revisao. Sem este valor, registrar_veredito_peca_em_revisao
-- estourava 22P02 ao emitir o card (pego pela prova antes de qualquer uso real).
alter type public.approval_entity add value if not exists 'peca_em_revisao';
