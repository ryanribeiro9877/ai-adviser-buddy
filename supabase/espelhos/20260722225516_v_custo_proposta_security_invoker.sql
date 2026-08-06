-- ESPELHO DE MIGRACAO APLICADA
-- version: 20260722225516
-- name: v_custo_proposta_security_invoker
-- projeto: gzjwnjdpxpbmdhcyefvs (Gestor de Trafego IA)
-- aplicada por: Claude via MCP apply_migration
-- espelho gerado a partir de supabase_migrations.schema_migrations - NAO transcrito a mao

-- Corrige apontamento do Claude Code (F1.2): a view rodava com privilégio do dono,
-- ignorando o RLS de proposals/campaigns/companies. Com security_invoker=on o RLS
-- do usuário consultante passa a valer. Consumidores mapeados antes da mudança:
-- front (admin) — coberto pois is_company_member() tem bypass de admin embutido;
-- futuros viewers — passam a ver só as empresas de que são membros (comportamento desejado).
alter view public.v_custo_proposta set (security_invoker = on);