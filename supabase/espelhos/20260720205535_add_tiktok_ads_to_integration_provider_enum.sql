-- ESPELHO DE MIGRACAO APLICADA
-- version: 20260720205535
-- name: add_tiktok_ads_to_integration_provider_enum
-- projeto: gzjwnjdpxpbmdhcyefvs (Gestor de Trafego IA)
-- aplicada por: Claude via MCP apply_migration
-- espelho gerado a partir de supabase_migrations.schema_migrations - NAO transcrito a mao

alter type public.integration_provider add value if not exists 'tiktok_ads';