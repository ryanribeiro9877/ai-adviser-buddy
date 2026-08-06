-- ESPELHO DE MIGRACAO APLICADA
-- version: 20260722135612
-- name: create_waba_tables
-- projeto: gzjwnjdpxpbmdhcyefvs (Gestor de Trafego IA)
-- aplicada por: Claude via MCP apply_migration
-- espelho gerado a partir de supabase_migrations.schema_migrations - NAO transcrito a mao

-- ============================================================
-- DOMÍNIO WABA (WhatsApp Business) — inventário + insights + série de tier/qualidade
-- Alimentado pela edge function waba-sync (Graph API, token em Edge Secrets).
-- ============================================================

-- WABAs (contas do WhatsApp Business)
create table if not exists public.wabas (
  id uuid primary key default gen_random_uuid(),
  company_id uuid references public.companies(id) on delete set null,
  external_id text not null unique,            -- WABA id (Graph)
  name text,
  currency text,
  timezone_id text,
  raw jsonb,
  last_synced_at timestamptz default now(),
  created_at timestamptz not null default now()
);
alter table public.wabas enable row level security;
create policy "wabas_select" on public.wabas for select using (public.is_company_member(company_id, auth.uid()));
create policy "wabas_admin_all" on public.wabas for all using (public.has_role(auth.uid(),'admin')) with check (public.has_role(auth.uid(),'admin'));

-- Números de telefone por WABA
create table if not exists public.waba_phone_numbers (
  id uuid primary key default gen_random_uuid(),
  company_id uuid references public.companies(id) on delete set null,
  waba_external_id text not null,
  external_id text not null unique,            -- phone number id (Graph)
  display_phone_number text,
  verified_name text,
  status text,
  quality_rating text,                         -- GREEN / YELLOW / RED / NA
  messaging_limit_tier text,                   -- TIER_250 / TIER_1K / TIER_10K / TIER_100K / TIER_UNLIMITED
  name_status text,
  raw jsonb,
  last_synced_at timestamptz default now(),
  created_at timestamptz not null default now()
);
create index if not exists ix_waba_phones_waba on public.waba_phone_numbers (waba_external_id);
alter table public.waba_phone_numbers enable row level security;
create policy "waba_phones_select" on public.waba_phone_numbers for select using (public.is_company_member(company_id, auth.uid()));
create policy "waba_phones_admin_all" on public.waba_phone_numbers for all using (public.has_role(auth.uid(),'admin')) with check (public.has_role(auth.uid(),'admin'));

-- Templates por WABA
create table if not exists public.waba_templates (
  id uuid primary key default gen_random_uuid(),
  company_id uuid references public.companies(id) on delete set null,
  waba_external_id text not null,
  external_id text,                            -- template id (Graph)
  name text not null,
  language text not null,
  category text,                               -- UTILITY / MARKETING / AUTHENTICATION / SERVICE
  status text,                                 -- APPROVED / PENDING / REJECTED / PAUSED...
  quality_score text,
  rejected_reason text,
  components jsonb,                            -- corpo/variáveis/botões/mídia
  version_tag text,                            -- classificação manual do Roberto (V2/V3)
  raw jsonb,
  last_synced_at timestamptz default now(),
  created_at timestamptz not null default now(),
  unique (waba_external_id, name, language)
);
create index if not exists ix_waba_templates_waba on public.waba_templates (waba_external_id);
alter table public.waba_templates enable row level security;
create policy "waba_templates_select" on public.waba_templates for select using (public.is_company_member(company_id, auth.uid()));
create policy "waba_templates_admin_all" on public.waba_templates for all using (public.has_role(auth.uid(),'admin')) with check (public.has_role(auth.uid(),'admin'));

-- Analytics diário da WABA (enviadas/entregues; phone null = agregado da WABA)
create table if not exists public.waba_analytics_daily (
  id uuid primary key default gen_random_uuid(),
  company_id uuid references public.companies(id) on delete set null,
  waba_external_id text not null,
  phone_external_id text,
  date date not null,
  sent bigint default 0,
  delivered bigint default 0,
  raw jsonb,
  created_at timestamptz not null default now()
);
create unique index if not exists uq_waba_analytics_day
  on public.waba_analytics_daily (waba_external_id, coalesce(phone_external_id,''), date);
alter table public.waba_analytics_daily enable row level security;
create policy "waba_analytics_select" on public.waba_analytics_daily for select using (public.is_company_member(company_id, auth.uid()));
create policy "waba_analytics_admin_all" on public.waba_analytics_daily for all using (public.has_role(auth.uid(),'admin')) with check (public.has_role(auth.uid(),'admin'));

-- Analytics diário por TEMPLATE (enviadas/entregues/lidas/cliques => taxa de leitura e de clique)
create table if not exists public.waba_template_analytics_daily (
  id uuid primary key default gen_random_uuid(),
  company_id uuid references public.companies(id) on delete set null,
  waba_external_id text not null,
  template_external_id text,
  template_name text,
  date date not null,
  sent bigint default 0,
  delivered bigint default 0,
  read bigint default 0,
  clicked bigint default 0,
  raw jsonb,
  created_at timestamptz not null default now()
);
create unique index if not exists uq_waba_tpl_analytics_day
  on public.waba_template_analytics_daily (waba_external_id, coalesce(template_external_id, template_name), date);
alter table public.waba_template_analytics_daily enable row level security;
create policy "waba_tpl_analytics_select" on public.waba_template_analytics_daily for select using (public.is_company_member(company_id, auth.uid()));
create policy "waba_tpl_analytics_admin_all" on public.waba_template_analytics_daily for all using (public.has_role(auth.uid(),'admin')) with check (public.has_role(auth.uid(),'admin'));

-- Snapshot diário de tier/qualidade por número (série histórica -> monitor "caiu de 100k p/ 10k")
create table if not exists public.waba_phone_snapshots (
  id uuid primary key default gen_random_uuid(),
  company_id uuid references public.companies(id) on delete set null,
  phone_external_id text not null,
  snapshot_date date not null,
  quality_rating text,
  messaging_limit_tier text,
  status text,
  created_at timestamptz not null default now(),
  unique (phone_external_id, snapshot_date)
);
alter table public.waba_phone_snapshots enable row level security;
create policy "waba_phone_snaps_select" on public.waba_phone_snapshots for select using (public.is_company_member(company_id, auth.uid()));
create policy "waba_phone_snaps_admin_all" on public.waba_phone_snapshots for all using (public.has_role(auth.uid(),'admin')) with check (public.has_role(auth.uid(),'admin'));