-- [F5.3] Criação de templates com inteligência de categoria.
-- Espelha o padrão provado de waba_template_replications, com os campos do fluxo novo:
-- objetivo (brief humano), components gerados pelo REDATOR LLM, e o laudo do GUARDIÃO
-- (checks determinísticos de categoria + veredito do compliance-check, fail-closed).
-- Fluxo: draft (redator+guardião, NUNCA submete) -> submit (3 camadas de flag + rate limit)
-- -> watch (resolve aprovado/rejeitado na Meta). Escrita só pela edge (service_role).

create table if not exists public.waba_template_creations (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  target_waba_id text not null,
  template_name text not null,
  language text not null default 'pt_BR',
  category text not null default 'UTILITY',
  objetivo text not null,
  components jsonb,
  redator_meta jsonb,
  guardiao jsonb,
  status text not null default 'rascunho',  -- rascunho | reprovado_guardiao | enviado | aprovado | rejeitado | falhou | cancelado
  dry_run boolean not null default true,
  meta_template_id text,
  meta_response jsonb,
  rejected_reason text,
  requested_by uuid,
  created_at timestamptz not null default now(),
  submitted_at timestamptz,
  resolved_at timestamptz
);

comment on table public.waba_template_creations is
  'F5.3: criacoes de template WhatsApp geradas por redator LLM com regras de categoria (UTILITY) e aprovadas pelo guardiao (checks deterministicos + compliance-check bloqueante, fail-closed). Submissao a Meta so via acao submit com master+criar_template+dry_run=false. Escrita exclusiva da edge waba-template-create.';

create index if not exists idx_wtc_company_status on public.waba_template_creations (company_id, status);

alter table public.waba_template_creations enable row level security;

create policy wtc_select_members on public.waba_template_creations
  for select using (is_company_member(company_id, auth.uid()));

create policy wtc_admin_all on public.waba_template_creations
  for all using (has_role(auth.uid(), 'admin'::app_role));
