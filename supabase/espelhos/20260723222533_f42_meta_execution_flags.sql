-- ESPELHO DE MIGRACAO APLICADA
-- version: 20260723222533
-- name: f42_meta_execution_flags
-- projeto: gzjwnjdpxpbmdhcyefvs (Gestor de Trafego IA)
-- aplicada por: Claude via MCP apply_migration
-- espelho gerado a partir de supabase_migrations.schema_migrations - NAO transcrito a mao

-- F4.2 (infra prévia): 3 camadas de defesa para execução real na Meta.
-- TUDO nasce OFF + dry_run ON. A edge meta-actions (próximo passo) só executa se:
-- master_enabled AND flag da ação AND dentro do rate limit AND dry_run=false.
create table public.meta_execution_config (
  id int primary key default 1 check (id = 1),          -- singleton
  master_enabled boolean not null default false,         -- camada 1: interruptor geral
  dry_run boolean not null default true,                 -- simula: loga sem chamar a Meta
  action_flags jsonb not null default '{"pausar_criativo": false, "escalar_criativo": false, "pausar_campanha": false, "alterar_orcamento": false}'::jsonb, -- camada 2: por ação
  max_actions_per_hour int not null default 5,           -- camada 3: rate limit
  updated_at timestamptz not null default now(),
  updated_by uuid
);
insert into public.meta_execution_config (id) values (1);
comment on table public.meta_execution_config is 'F4.2: flags de execução real na Meta (3 camadas: master + por ação + rate limit). Defaults OFF/dry_run — ligar exige decisão explícita (aval do Roberto).';

alter table public.meta_execution_config enable row level security;
create policy meta_cfg_select_members on public.meta_execution_config
  for select to authenticated using (true);
-- escrita: só admin, via RPC (auditada)
create or replace function public.set_meta_execution_config(
  p_master boolean default null, p_dry_run boolean default null,
  p_action_flags jsonb default null, p_max_per_hour int default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_uid uuid := auth.uid(); v_antes jsonb; v_depois jsonb;
begin
  if v_uid is null then raise exception 'autenticação obrigatória'; end if;
  if not public.has_role(v_uid, 'admin'::app_role) then raise exception 'apenas administradores'; end if;
  select to_jsonb(c) into v_antes from public.meta_execution_config c where id = 1;
  update public.meta_execution_config set
    master_enabled = coalesce(p_master, master_enabled),
    dry_run = coalesce(p_dry_run, dry_run),
    action_flags = coalesce(p_action_flags, action_flags),
    max_actions_per_hour = coalesce(p_max_per_hour, max_actions_per_hour),
    updated_at = now(), updated_by = v_uid
  where id = 1;
  select to_jsonb(c) into v_depois from public.meta_execution_config c where id = 1;
  insert into public.audit_log(company_id, user_id, action, target_type, target_id, details)
  select id, v_uid, 'meta_execution_config_changed', 'config', '1',
         jsonb_build_object('antes', v_antes, 'depois', v_depois)
  from public.companies where name ilike '%legal%' limit 1;
  return v_depois;
end $$;
revoke all on function public.set_meta_execution_config(boolean, boolean, jsonb, int) from public, anon;
grant execute on function public.set_meta_execution_config(boolean, boolean, jsonb, int) to authenticated, service_role;