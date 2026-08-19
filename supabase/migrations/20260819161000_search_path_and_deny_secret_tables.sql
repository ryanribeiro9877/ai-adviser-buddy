-- Harden search_path + explicit deny policies on secret tables that had RLS
-- enabled with zero policies (deny-by-default, but advisors flag INFO).

alter function private.classificar_familia_dica_meta(text, text, text, text)
  set search_path = private, public, pg_temp;

alter function public.get_estrutura_conjuntos(uuid, integer, integer)
  set search_path = public, pg_temp;

-- Explicit client deny (service_role bypasses RLS). Keeps the same effective
-- posture as "RLS on, no policies" while clearing the advisor INFO.
do $$
declare
  t text;
begin
  foreach t in array array[
    'agent_knowledge',
    'agent_style',
    'creative_estado_graph',
    'integration_secrets',
    'mcp_api_keys',
    'mcp_config'
  ]
  loop
    execute format(
      'drop policy if exists %I on public.%I',
      t || '_deny_clients',
      t
    );
    execute format(
      'create policy %I on public.%I for all to anon, authenticated using (false) with check (false)',
      t || '_deny_clients',
      t
    );
  end loop;
end $$;
