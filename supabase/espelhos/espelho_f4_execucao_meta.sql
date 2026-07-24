-- =============================================================================
-- ESPELHO CONSOLIDADO F4.1/F4.2 (já aplicado — NÃO re-executar; commit p/ histórico)
-- Migrações: f42_meta_execution_flags + f42_execucao_colunas_e_cobaia · 24/07/2026
-- Projeto: gestão_marketing (gzjwnjdpxpbmdhcyefvs)
-- =============================================================================
-- F4.1 FECHADO: System User admin + token META_ADS_TOKEN (Edge Secret) com
-- ads_management/ads_read/business_management; meta-health validou identidade,
-- escopos, GET act_3302001729967572 e GET campanha. Escrita provada: campanha
-- [TESTE-API] (120253980286160191) criada VAZIA via API (sem ad sets/anúncios =
-- não entrega/não gasta/não passa por review) + ciclo pause/unpause completo.
-- F4.2 FECHADO: edge meta-actions consome approval_requests aprovados; 3 camadas
-- (master + flag por ação + rate 5/h) + dry_run; audit antes/depois lido da Meta.
-- PROVAS 24/07: dry-run SIMULADO sem tocar Meta (executed_at null); execução REAL
-- ACTIVE→PAUSED na cobaia via card aprovado (a554dd72) pelo trilho chat→card→
-- aprovação→executor; idempotência (6011800b PAUSED→PAUSED); CAMADA 2 AO VIVO:
-- 3 pedidos de pausar_criativo (alvos reais) BLOQUEADOS por flag=false com master
-- ligado, depois neutralizados administrativamente. Flags devolvidas a OFF+dry_run.
-- Edges p/ download: meta-health v1, meta-test-campaign v3, meta-actions v1,
-- traffic-chat v10 (norm de separadores).
-- PENDÊNCIA DE SEGURANÇA: rotacionar META_ADS_TOKEN (fragmento ecoado em log de
-- erro durante debug; edges agora redigem token de qualquer saída).
-- =============================================================================

-- ---- f42_meta_execution_flags ----
create table public.meta_execution_config (
  id int primary key default 1 check (id = 1),
  master_enabled boolean not null default false,
  dry_run boolean not null default true,
  action_flags jsonb not null default '{"pausar_criativo": false, "escalar_criativo": false, "pausar_campanha": false, "alterar_orcamento": false}'::jsonb,
  max_actions_per_hour int not null default 5,
  updated_at timestamptz not null default now(),
  updated_by uuid
);
insert into public.meta_execution_config (id) values (1);
comment on table public.meta_execution_config is 'F4.2: flags de execução real na Meta (3 camadas: master + por ação + rate limit). Defaults OFF/dry_run — ligar exige decisão explícita (aval do Roberto).';
alter table public.meta_execution_config enable row level security;
create policy meta_cfg_select_members on public.meta_execution_config
  for select to authenticated using (true);
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

-- ---- f42_execucao_colunas_e_cobaia ----
alter table public.approval_requests
  add column if not exists executed_at timestamptz,
  add column if not exists execution_result jsonb;
comment on column public.approval_requests.executed_at is 'F4.2: quando a meta-actions executou (real). Dry-run NÃO preenche (fica só no audit_log).';
insert into public.campaigns (company_id, external_id, name, status, category, provider)
select c.id, '120253980286160191', '[TESTE-API] pausa-despausa F4 — não usar', 'paused', 'leadgen', 'meta_ads'::integration_provider
from public.companies c
where c.name ilike '%legal%'
  and not exists (select 1 from public.campaigns k where k.external_id = '120253980286160191');
