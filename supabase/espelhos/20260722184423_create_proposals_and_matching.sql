-- ESPELHO DE MIGRACAO APLICADA
-- version: 20260722184423
-- name: create_proposals_and_matching
-- projeto: gzjwnjdpxpbmdhcyefvs (Gestor de Trafego IA)
-- aplicada por: Claude via MCP apply_migration
-- espelho gerado a partir de supabase_migrations.schema_migrations - NAO transcrito a mao

-- ============================================================
-- F1.1 — PROPOSTAS (Dash da Legal) + cruzamento por telefone/UTM
-- ============================================================
create table if not exists public.proposals_import (
  id uuid primary key default gen_random_uuid(),
  batch_id uuid not null,
  company_id uuid references public.companies(id) on delete set null,
  phone_raw text,
  phone_e164 text,
  lead_external_id text,
  utm_source text, utm_medium text, utm_campaign text, utm_content text, utm_term text,
  proposal_date date,
  status text,
  raw jsonb,
  created_at timestamptz not null default now()
);
create index if not exists ix_prop_import_batch on public.proposals_import (batch_id);
create index if not exists ix_prop_import_phone on public.proposals_import (phone_e164);
alter table public.proposals_import enable row level security;
create policy "prop_import_admin_all" on public.proposals_import for all using (public.has_role(auth.uid(),'admin')) with check (public.has_role(auth.uid(),'admin'));

create table if not exists public.proposals (
  id uuid primary key default gen_random_uuid(),
  company_id uuid references public.companies(id) on delete set null,
  phone_e164 text,
  lead_external_id text,
  utm_source text, utm_medium text, utm_campaign text, utm_content text,
  proposal_date date,
  status text,
  campaign_id uuid references public.campaigns(id) on delete set null,
  match_method text,
  matched boolean not null default false,
  raw jsonb,
  created_at timestamptz not null default now()
);
create index if not exists ix_proposals_company_date on public.proposals (company_id, proposal_date);
create index if not exists ix_proposals_campaign on public.proposals (campaign_id);
-- unique por expressão (coalesce não pode em constraint inline)
create unique index if not exists uq_proposals_dedupe
  on public.proposals (phone_e164, proposal_date, (coalesce(lead_external_id,'')));
alter table public.proposals enable row level security;
create policy "proposals_select" on public.proposals for select using (public.is_company_member(company_id, auth.uid()));
create policy "proposals_admin_all" on public.proposals for all using (public.has_role(auth.uid(),'admin')) with check (public.has_role(auth.uid(),'admin'));

create or replace function public.normalize_phone_br(p text)
returns text language plpgsql immutable as $$
declare d text;
begin
  if p is null then return null; end if;
  d := regexp_replace(p, '\D', '', 'g');
  d := regexp_replace(d, '^0+', '');
  if length(d) = 0 then return null; end if;
  if left(d,2) = '55' and length(d) >= 12 then return d; end if;
  if length(d) in (10,11) then return '55' || d; end if;
  return d;
end $$;

create or replace function public.match_proposals_batch(p_batch_id uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_total int; v_matched int;
begin
  insert into public.proposals (
    company_id, phone_e164, lead_external_id, utm_source, utm_medium, utm_campaign, utm_content,
    proposal_date, status, campaign_id, match_method, matched, raw)
  select
    imp.company_id, imp.phone_e164, imp.lead_external_id,
    imp.utm_source, imp.utm_medium, imp.utm_campaign, imp.utm_content,
    imp.proposal_date, imp.status,
    c.id,
    case when c.id is not null then 'utm_campaign' else 'none' end,
    (c.id is not null),
    imp.raw
  from public.proposals_import imp
  left join public.campaigns c
    on imp.utm_campaign is not null
   and (c.external_id = imp.utm_campaign or lower(c.name) = lower(imp.utm_campaign))
  where imp.batch_id = p_batch_id
  on conflict (phone_e164, proposal_date, (coalesce(lead_external_id,''))) do update set
    campaign_id = excluded.campaign_id, match_method = excluded.match_method,
    matched = excluded.matched, status = excluded.status;

  select count(*) , count(*) filter (where matched) into v_total, v_matched
  from public.proposals p
  where exists (select 1 from public.proposals_import imp
                where imp.batch_id = p_batch_id
                  and imp.phone_e164 is not distinct from p.phone_e164
                  and imp.proposal_date is not distinct from p.proposal_date);

  return jsonb_build_object('batch', p_batch_id, 'total', v_total, 'matched', v_matched,
                            'descartados', v_total - v_matched);
end $$;
grant execute on function public.match_proposals_batch(uuid) to service_role;

create or replace view public.v_custo_proposta as
select
  c.company_id, co.name as empresa, c.id as campaign_id, c.name as campanha,
  count(p.*) filter (where p.matched) as propostas,
  round(c.spend, 2) as gasto_campanha,
  round(c.spend / nullif(count(p.*) filter (where p.matched), 0), 2) as custo_por_proposta
from public.campaigns c
join public.companies co on co.id = c.company_id
left join public.proposals p on p.campaign_id = c.id
group by c.company_id, co.name, c.id, c.name, c.spend;
grant select on public.v_custo_proposta to authenticated, service_role;