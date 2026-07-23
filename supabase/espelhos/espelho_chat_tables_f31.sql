-- ============================================================================
-- ESPELHO: F3.1 — tabelas do chat "Operação" (migração f31_chat_tables)
-- Projeto: gestão_marketing (gzjwnjdpxpbmdhcyefvs) · Aplicada: 23/07/2026
-- ATENÇÃO: espelho para git. NÃO re-executar.
-- Escrita SEMPRE via edge traffic-chat (service_role); leitura por membros da
-- empresa; admin tudo. kind='daily_report' reservado para o relatório 08:30 (F3.2).
-- VALIDAÇÃO: bateria de 10 perguntas via edge -> 11 conversas, 11 msgs user +
-- 11 assistant persistidas com tokens/modelo (anthropic/claude-sonnet-4.5).
-- ============================================================================
create table public.chat_conversations (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id),
  title text,
  kind text not null default 'chat' check (kind in ('chat','daily_report')),
  created_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.chat_messages (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.chat_conversations(id) on delete cascade,
  company_id uuid not null references public.companies(id),
  role text not null check (role in ('user','assistant','tool','system')),
  content text,
  tool_calls jsonb,
  model text,
  tokens_in integer,
  tokens_out integer,
  user_id uuid,
  created_at timestamptz not null default now()
);
create index idx_chat_messages_conv on public.chat_messages (conversation_id, created_at);

alter table public.chat_conversations enable row level security;
alter table public.chat_messages enable row level security;

create policy chat_conv_select on public.chat_conversations
  for select using (is_company_member(company_id, auth.uid()));
create policy chat_conv_admin_all on public.chat_conversations
  for all using (has_role(auth.uid(), 'admin'::app_role));
create policy chat_msg_select on public.chat_messages
  for select using (is_company_member(company_id, auth.uid()));
create policy chat_msg_admin_all on public.chat_messages
  for all using (has_role(auth.uid(), 'admin'::app_role));
