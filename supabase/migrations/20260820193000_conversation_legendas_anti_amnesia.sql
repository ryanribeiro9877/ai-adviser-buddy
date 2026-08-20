-- Legend as duráveis por conversa (20/08/2026).
-- Incidente IMPULSÃO: o agente gerou 5 legendas no chat e, em turnos seguintes,
-- afirmou que 3 "não existem" / "texto integral não disponível". Causa: HIST_CAP
-- corta o FINAL de mensagens longas do assistente; tool_results de gerar_legendas
-- também saem do orçamento de reinjeção. Sem store, a copy some do contexto.
--
-- Esta tabela é a fonte de verdade da copy já proposta nesta conversa.
-- Tools: get_legendas_da_conversa / registrar_legenda_da_conversa; gerar_legendas
-- grava automaticamente ao sucesso.

create table if not exists public.conversation_legendas (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies (id) on delete cascade,
  conversation_id uuid not null references public.chat_conversations (id) on delete cascade,
  peca_chave text not null,
  drive_file_id text,
  legenda text not null,
  variante_indice integer,
  selecionada boolean not null default true,
  fonte text not null default 'agente_proposto'
    check (fonte in ('gerar_legendas', 'agente_proposto', 'gestor', 'seed')),
  objetivo text,
  apto_para_card boolean,
  variantes jsonb,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint conversation_legendas_peca_unica unique (conversation_id, peca_chave)
);

comment on table public.conversation_legendas is
  'Legendas propostas nesta conversa (ESP-37 / slate). Persistidas para sobreviver a HIST_CAP e a reinjeção limitada de tool_results. Chave: conversation_id + peca_chave.';

create index if not exists conversation_legendas_company_conv_idx
  on public.conversation_legendas (company_id, conversation_id);

create index if not exists conversation_legendas_drive_idx
  on public.conversation_legendas (company_id, drive_file_id)
  where drive_file_id is not null;

alter table public.conversation_legendas enable row level security;

create policy conversation_legendas_select on public.conversation_legendas
  for select to authenticated
  using (public.is_company_member(company_id, (select auth.uid())));

create policy conversation_legendas_admin_write on public.conversation_legendas
  for all to authenticated
  using (public.is_company_member(company_id, (select auth.uid())))
  with check (public.is_company_member(company_id, (select auth.uid())));

-- Service role (edges) bypassa RLS; membros leem o que a empresa deles gravou.

-- Doutrina anti-amnésia de legenda.
update public.agent_context
   set vigente = false
 where categoria = 'doutrina'
   and vigente = true
   and fato ilike 'LEGENDAS DA CONVERSA%';

insert into public.agent_context (categoria, fato, vigente, desde, company_id)
values (
  'doutrina',
  'LEGENDAS DA CONVERSA SAO DURAVEIS (20/08/2026). Quando gerar_legendas devolve variantes '
  || 'OU voce propoe copy para pecas do slate (drive_file_id / carrossel / card), a copy fica '
  || 'em conversation_legendas (tools get_legendas_da_conversa e registrar_legenda_da_conversa). '
  || 'ANTES de dizer que legenda "nao existe", "texto integral nao disponivel" ou pedir ao '
  || 'gestor para colar de novo: (1) chame get_legendas_da_conversa; (2) releia o historico '
  || 'desta conversa. PROIBIDO pedir ao gestor para re-colar copy que VOCE escreveu nesta '
  || 'conversa. Se a peca esta no store ou no historico, use o texto integral — nunca invente '
  || 'amnesia. Ao propor legendas soltas no chat (sem gerar_legendas), chame '
  || 'registrar_legenda_da_conversa com peca_chave + legenda (+ drive_file_id quando houver).',
  true,
  date '2026-08-20',
  null
);
