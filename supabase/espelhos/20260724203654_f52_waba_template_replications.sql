-- ESPELHO DE MIGRACAO APLICADA
-- version: 20260724203654
-- name: f52_waba_template_replications
-- projeto: gzjwnjdpxpbmdhcyefvs (Gestor de Trafego IA)
-- aplicada por: Claude via MCP apply_migration
-- espelho gerado a partir de supabase_migrations.schema_migrations - NAO transcrito a mao

-- F5.2: replicação de templates entre WABAs/números.
-- Escrita na Meta => reusa as 3 camadas do F4.2 (master + flag da ação + rate) e o dry_run.
-- Nova flag 'replicar_template' (default false) no mesmo meta_execution_config.

update public.meta_execution_config
   set action_flags = action_flags || '{"replicar_template": false}'::jsonb
 where id = 1;

alter table public.meta_execution_config
  alter column action_flags set default
  '{"pausar_criativo": false, "escalar_criativo": false, "pausar_campanha": false, "alterar_orcamento": false, "replicar_template": false}'::jsonb;

create table public.waba_template_replications (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id),
  source_waba_id text not null,
  target_waba_id text not null,
  template_name text not null,
  language text not null default 'pt_BR',
  category text,
  components jsonb,
  status text not null default 'planejado'
    check (status in ('planejado','enviado','aprovado','rejeitado','falhou','cancelado')),
  meta_template_id text,
  meta_response jsonb,
  rejected_reason text,
  dry_run boolean not null default true,
  requested_by uuid,
  created_at timestamptz not null default now(),
  submitted_at timestamptz,
  resolved_at timestamptz,
  unique (target_waba_id, template_name, language, created_at)
);
comment on table public.waba_template_replications is 'F5.2: fila/histórico de replicação de templates entre WABAs. status planejado(dry-run)→enviado→aprovado|rejeitado. Watcher compara com waba_templates (sync 09:30) para resolver.';
create index idx_repl_status on public.waba_template_replications(status, created_at desc);
create index idx_repl_target on public.waba_template_replications(target_waba_id, template_name);

alter table public.waba_template_replications enable row level security;
create policy repl_select_members on public.waba_template_replications
  for select to authenticated using (public.is_company_member(company_id, auth.uid()));
create policy repl_admin_all on public.waba_template_replications
  for all to authenticated using (public.has_role(auth.uid(), 'admin'::app_role));