-- ESPELHO DE MIGRACAO APLICADA
-- version: 20260804194310
-- name: drive_liberacao_derivada_tambem_no_update
-- projeto: gzjwnjdpxpbmdhcyefvs (Gestor de Trafego IA)
-- aplicada por: Claude via MCP apply_migration
-- espelho gerado a partir de supabase_migrations.schema_migrations - NAO transcrito a mao

-- 04/08/2026 - Fecha o buraco que a modelagem de 04/08 deixou: o gatilho de heranca cobria
-- apenas INSERT. O pipeline grava com INSERT ... ON CONFLICT DO UPDATE, e no caminho de UPDATE o
-- gatilho BEFORE INSERT nao dispara - entao qualquer escritor que mande aprovado_pelo_gestor num
-- update poderia divergir da fonte de novo. Coluna DERIVADA tem que ser derivada nos dois caminhos,
-- senao "derivada" e so intencao.
DROP TRIGGER IF EXISTS trg_drive_herda_liberacao ON public.drive_midia_analises;
CREATE TRIGGER trg_drive_herda_liberacao
  BEFORE INSERT OR UPDATE ON public.drive_midia_analises
  FOR EACH ROW EXECUTE FUNCTION public.trg_drive_herda_liberacao();