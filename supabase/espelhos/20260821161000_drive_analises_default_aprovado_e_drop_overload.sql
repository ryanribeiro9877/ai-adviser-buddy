-- DEFAULT para novas analises (COHAPM nasce nao aprovado pelo gestor)
ALTER TABLE public.drive_midia_analises
  ALTER COLUMN aprovado_pelo_gestor SET DEFAULT false;

COMMENT ON COLUMN public.drive_midia_analises.aprovado_pelo_gestor IS
  'false ate o gestor aprovar o acervo (Legal foi backfill true em 31/07). Novas pecas COHAPM nascem false.';

-- Remove overload ambiguo (ja aplicado em fix_drive_plano_overload_ambiguo)
DROP FUNCTION IF EXISTS public.drive_plano_de_varredura(uuid);
