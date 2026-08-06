-- ESPELHO DE MIGRACAO APLICADA
-- version: 20260723130620
-- name: f31_chat_tables
-- projeto: gzjwnjdpxpbmdhcyefvs (Gestor de Trafego IA)
-- aplicada por: Claude via MCP apply_migration
-- espelho gerado a partir de supabase_migrations.schema_migrations - NAO transcrito a mao

-- F3.1 — persistência do chat "Operação".
-- chat_conversations: 1 linha por conversa (kind 'chat' = interativa; 'daily_report' = relatório 08:30).
-- chat_messages: histórico completo (roles user/assistant/tool/system), custo/token por mensagem.
-- Escrita SEMPRE via edge (service_role); RLS de leitura por empresa; admin tudo.
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