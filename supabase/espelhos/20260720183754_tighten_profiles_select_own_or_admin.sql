-- ESPELHO DE MIGRACAO APLICADA
-- version: 20260720183754
-- name: tighten_profiles_select_own_or_admin
-- projeto: gzjwnjdpxpbmdhcyefvs (Gestor de Trafego IA)
-- aplicada por: Claude via MCP apply_migration
-- espelho gerado a partir de supabase_migrations.schema_migrations - NAO transcrito a mao

-- Substitui a policy permissiva de leitura de profiles (qualquer autenticado lia o e-mail/nome de todos)
-- por: cada usuario le o proprio perfil; admin le todos.
drop policy if exists "authenticated read profiles" on public.profiles;

create policy "read own profile or admin"
on public.profiles
for select
to authenticated
using ((auth.uid() = id) or has_role(auth.uid(), 'admin'::app_role));