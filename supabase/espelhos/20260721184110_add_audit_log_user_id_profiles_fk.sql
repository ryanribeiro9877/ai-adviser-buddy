-- ESPELHO DE MIGRACAO APLICADA
-- version: 20260721184110
-- name: add_audit_log_user_id_profiles_fk
-- projeto: gzjwnjdpxpbmdhcyefvs (Gestor de Trafego IA)
-- aplicada por: Claude via MCP apply_migration
-- espelho gerado a partir de supabase_migrations.schema_migrations - NAO transcrito a mao

-- Cria a relação que o PostgREST precisa para o embed profiles:user_id(email,full_name)
-- na query de audit_log do front. Mantém a FK existente para auth.users.
alter table public.audit_log
  add constraint audit_log_user_id_profiles_fkey
  foreign key (user_id) references public.profiles(id) on delete set null;