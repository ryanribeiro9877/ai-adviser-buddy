-- [F5.6] Ingestão do relatório Infobip (Excel "Detalhado")
-- Schema derivado do export REAL (22/07/2026): abas Data de whatsapp_*.xlsx (31 colunas,
-- grão = mensagem) e whatsapp_billing_*.xlsx (20 colunas, grão = registro de MAU).
-- As duas entram na MESMA tabela: service_name distingue (Outbound/Inbound/Monthly Active User).
-- Escrita: admin via front (parser SheetJS no navegador, upsert em lote) — por isso a policy
-- admin ALL, no mesmo padrao das tabelas waba_*. Leitura: membros da empresa.
-- Preco: gravado COMO VEM do export (numeric). Leitura provavel: centavos de BRL
-- (R$ 0,06/msg cobrada — 1.393 cobradas x 6 = 8.358 no arquivo de exemplo). NAO converter
-- na gravacao; interpretar na leitura ate confirmacao com a fatura Infobip.

create table if not exists public.infobip_dispatches (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  message_id text not null,
  service_name text,            -- 'WhatsApp Outbound' | 'WhatsApp Inbound' | 'WhatsApp Monthly Active User'
  traffic_source text,          -- 'Broadcast' | 'API' | 'Other'
  communication_name text,      -- nome da transmissao (Broadcast)
  template_name text,           -- Communication Template (vazio no exemplo real)
  from_number text,
  to_number text,
  send_at timestamptz,
  done_at timestamptz,
  seen_at timestamptz,
  status text,                  -- Delivered | Expired | Undeliverable | Pending | Rejected
  reason text,
  error_group text,
  error_name text,
  network_name text,
  country_prefix text,
  price_raw numeric,            -- Purchase Price como no export (sem conversao)
  clicks int,
  messages_count int,
  user_name text,
  source_file text,             -- nome do arquivo importado (auditoria)
  imported_at timestamptz not null default now(),
  raw jsonb,
  constraint uq_infobip_message unique (message_id, service_name)
);

comment on table public.infobip_dispatches is
  'Log de disparos/faturamento importado dos exports Excel da Infobip (relatorio Detalhado). Grao = linha do export (mensagem ou registro de MAU). Dedup por (message_id, service_name). Alimentado pelo front (admin) via parser no navegador; leitura por membros da empresa.';

create index if not exists idx_infobip_company_sendat on public.infobip_dispatches (company_id, send_at);
create index if not exists idx_infobip_status on public.infobip_dispatches (company_id, status);

alter table public.infobip_dispatches enable row level security;

create policy infobip_select on public.infobip_dispatches
  for select using (is_company_member(company_id, auth.uid()));

create policy infobip_admin_all on public.infobip_dispatches
  for all using (has_role(auth.uid(), 'admin'::app_role));
