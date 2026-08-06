-- ESPELHO DE MIGRACAO APLICADA
-- version: 20260724205602
-- name: f51_waba_natureza_tecnica
-- projeto: gzjwnjdpxpbmdhcyefvs (Gestor de Trafego IA)
-- aplicada por: Claude via MCP apply_migration
-- espelho gerado a partir de supabase_migrations.schema_migrations - NAO transcrito a mao

-- F5.1: natureza técnica de cada WABA/número, colhida da Meta (waba-probe).
-- Substitui achismo sobre "V2/V3" por fato: platform_type e ownership_type.
alter table public.wabas
  add column if not exists ownership_type text,
  add column if not exists account_review_status text,
  add column if not exists obo_name text;
comment on column public.wabas.ownership_type is 'Meta: SELF (BM própria criou) | CLIENT_OWNED (criada via BSP/Blip com propriedade do cliente).';

alter table public.waba_phone_numbers
  add column if not exists platform_type text,
  add column if not exists throughput_level text,
  add column if not exists is_official_business_account boolean;
comment on column public.waba_phone_numbers.platform_type is 'Meta: CLOUD_API | ON_PREMISE (legado) | NOT_APPLICABLE (número migrado/inativo). Só CLOUD_API aceita gestão de template via Graph com segurança.';