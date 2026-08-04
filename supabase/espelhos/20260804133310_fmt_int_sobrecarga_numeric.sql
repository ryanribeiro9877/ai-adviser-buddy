-- ESPELHO DE MIGRACAO APLICADA
-- version: 20260804133310
-- name: fmt_int_sobrecarga_numeric
-- projeto: gzjwnjdpxpbmdhcyefvs (Gestor de Trafego IA)
-- aplicada por: Claude via MCP apply_migration
-- espelho gerado a partir de supabase_migrations.schema_migrations - NAO transcrito a mao

-- 04/08/2026 - sum() de bigint devolve NUMERIC em Postgres, entao fmt_int(bigint) nao casava
-- com as somas do relatorio. Sobrecarga em numeric, arredondando para inteiro.
CREATE OR REPLACE FUNCTION public.fmt_int(v numeric)
RETURNS text LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE WHEN v IS NULL THEN '—'
         ELSE translate(trim(to_char(round(v), 'FM9G999G999G999')), ',', '.') END
$$;
GRANT EXECUTE ON FUNCTION public.fmt_int(numeric) TO authenticated, service_role;