-- Rewrite RLS policies that call auth.uid()/auth.role() per-row (auth_rls_initplan)
-- into (select auth.uid()) / (select auth.role()) so Postgres caches the value.

do $$
declare
  r record;
  new_using text;
  new_check text;
  roles_sql text;
  cmd_sql text;
  perm_sql text;
  sql text;
begin
  for r in
    select
      schemaname,
      tablename,
      policyname,
      permissive,
      roles,
      cmd,
      qual,
      with_check
    from pg_policies
    where schemaname = 'public'
      and (
        (qual is not null and qual ~ 'auth\.(uid|role)\(\)' and qual !~ '\(select auth\.(uid|role)\(\)\)')
        or (with_check is not null and with_check ~ 'auth\.(uid|role)\(\)' and with_check !~ '\(select auth\.(uid|role)\(\)\)')
      )
  loop
    new_using := r.qual;
    new_check := r.with_check;
    if new_using is not null then
      new_using := replace(new_using, 'auth.uid()', '(select auth.uid())');
      new_using := replace(new_using, 'auth.role()', '(select auth.role())');
    end if;
    if new_check is not null then
      new_check := replace(new_check, 'auth.uid()', '(select auth.uid())');
      new_check := replace(new_check, 'auth.role()', '(select auth.role())');
    end if;

    -- Avoid double-wrap if a prior pass already nested select.
    new_using := replace(new_using, '(select (select auth.uid()))', '(select auth.uid())');
    new_using := replace(new_using, '(select (select auth.role()))', '(select auth.role())');
    new_check := replace(new_check, '(select (select auth.uid()))', '(select auth.uid())');
    new_check := replace(new_check, '(select (select auth.role()))', '(select auth.role())');

    roles_sql := array_to_string(
      array(select quote_ident(x) from unnest(r.roles) as x),
      ', '
    );
    if roles_sql is null or roles_sql = '' then
      roles_sql := 'public';
    end if;

    cmd_sql := case upper(r.cmd)
      when 'SELECT' then 'SELECT'
      when 'INSERT' then 'INSERT'
      when 'UPDATE' then 'UPDATE'
      when 'DELETE' then 'DELETE'
      else 'ALL'
    end;

    perm_sql := case when r.permissive = 'PERMISSIVE' then 'PERMISSIVE' else 'RESTRICTIVE' end;

    execute format(
      'drop policy if exists %I on %I.%I',
      r.policyname,
      r.schemaname,
      r.tablename
    );

    sql := format(
      'create policy %I on %I.%I as %s for %s to %s',
      r.policyname,
      r.schemaname,
      r.tablename,
      perm_sql,
      cmd_sql,
      roles_sql
    );

    if cmd_sql in ('ALL', 'SELECT', 'UPDATE', 'DELETE') and new_using is not null then
      sql := sql || ' using (' || new_using || ')';
    end if;
    if cmd_sql in ('ALL', 'INSERT', 'UPDATE') and new_check is not null then
      sql := sql || ' with check (' || new_check || ')';
    elsif cmd_sql = 'INSERT' and new_check is null and new_using is not null then
      -- INSERT policies sometimes store expression only in qual historically
      sql := sql || ' with check (' || new_using || ')';
    end if;

    execute sql;
  end loop;
end $$;
