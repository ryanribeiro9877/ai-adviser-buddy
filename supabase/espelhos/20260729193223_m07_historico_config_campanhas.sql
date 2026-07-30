-- [M-07] Historico de configuracao de campanha — torna executavel a doutrina "voce nao e o
-- unico ator". Motivo: campaigns.status e daily_budget sao SOBRESCRITOS pelo sync diario e o
-- audit_log so registra acoes DESTE sistema. Sem historico, mandar o agente "verificar se
-- houve alteracao no periodo" seria mandar ele fazer o impossivel — ou pior, afirmar sem base.
-- LIMITACAO DECLARADA POR DESENHO: foto 1x/dia (cron 09:25, depois do sync de status das
-- 09:10). Mudanca feita e revertida no mesmo dia e invisivel. Historico comeca em 29/07/2026 -
-- nao ha retroatividade. A funcao de leitura devolve essa limitacao junto com o resultado,
-- para que "nenhuma alteracao detectada" nunca seja lido como "ninguem mexeu".

create table if not exists public.campaign_config_snapshots (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  campaign_external_id text not null,
  campaign_name text,
  snapshot_date date not null default current_date,
  status text,
  daily_budget numeric,
  objective text,
  bid_strategy text,
  special_ad_categories text,
  created_at timestamptz not null default now(),
  constraint uq_ccs_campanha_dia unique (campaign_external_id, snapshot_date)
);

comment on table public.campaign_config_snapshots is
  'Foto diaria da configuracao de cada campanha (status, orcamento, objetivo, estrategia de lance, categoria especial). Existe para detectar alteracao feita FORA deste sistema (outro operador humano ou outro sistema com escrita na Meta). Granularidade: 1 dia. Sem retroatividade antes de 29/07/2026.';

create index if not exists idx_ccs_company_data on public.campaign_config_snapshots (company_id, snapshot_date);

alter table public.campaign_config_snapshots enable row level security;

create policy ccs_select_members on public.campaign_config_snapshots
  for select using (is_company_member(company_id, auth.uid()));

create policy ccs_admin_all on public.campaign_config_snapshots
  for all using (has_role(auth.uid(), 'admin'::app_role));

-- Gravador: idempotente no dia (rodar 2x nao duplica, atualiza a foto)
create or replace function public.snapshot_campaign_config()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare v_n integer;
begin
  insert into campaign_config_snapshots (
    company_id, campaign_external_id, campaign_name, snapshot_date,
    status, daily_budget, objective, bid_strategy, special_ad_categories)
  select c.company_id, c.external_id, c.name, current_date,
         c.status, c.daily_budget, c.objective, c.bid_strategy, c.special_ad_categories::text
  from campaigns c
  where c.external_id is not null and c.company_id is not null
  on conflict (campaign_external_id, snapshot_date) do update
    set status = excluded.status,
        daily_budget = excluded.daily_budget,
        objective = excluded.objective,
        bid_strategy = excluded.bid_strategy,
        special_ad_categories = excluded.special_ad_categories,
        campaign_name = excluded.campaign_name;
  select count(*) into v_n from campaign_config_snapshots where snapshot_date = current_date;
  return v_n;
end $$;

comment on function public.snapshot_campaign_config() is
  'Grava a foto do dia da configuracao das campanhas. Roda no cron 09:25, apos o sync de status (09:10). Idempotente no dia.';

-- Leitor para o agente: devolve as alteracoes E a limitacao, sempre juntas
create or replace function public.get_alteracoes_config(p_company_id uuid, p_dias integer default 14)
returns jsonb
language sql
stable
security invoker
as $$
  with s as (
    select campaign_external_id, campaign_name, snapshot_date, status, daily_budget,
           lag(status)        over (partition by campaign_external_id order by snapshot_date) as status_ant,
           lag(daily_budget)  over (partition by campaign_external_id order by snapshot_date) as orcamento_ant,
           lag(snapshot_date) over (partition by campaign_external_id order by snapshot_date) as data_ant
    from campaign_config_snapshots
    where company_id = p_company_id
      and snapshot_date >= current_date - greatest(p_dias, 1)
  ),
  mud as (
    select * from s
    where (status_ant is not null and status_ant is distinct from status)
       or (orcamento_ant is not null and orcamento_ant is distinct from daily_budget)
  )
  select jsonb_build_object(
    'janela_dias', greatest(p_dias, 1),
    'dias_com_foto', (select count(distinct snapshot_date) from s),
    'primeira_foto_disponivel', (select min(snapshot_date) from campaign_config_snapshots where company_id = p_company_id),
    'alteracoes', (select coalesce(jsonb_agg(jsonb_build_object(
        'campanha', campaign_name,
        'detectada_na_foto_de', snapshot_date,
        'foto_anterior', data_ant,
        'status', case when status_ant is distinct from status
                       then status_ant || ' -> ' || coalesce(status,'(nulo)') else null end,
        'orcamento_diario', case when orcamento_ant is distinct from daily_budget
                       then orcamento_ant::text || ' -> ' || coalesce(daily_budget::text,'(nulo)') else null end
      ) order by snapshot_date desc), '[]'::jsonb) from mud),
    'limitacao', 'Foto 1x/dia (09:25). Alteracao feita e revertida no mesmo dia NAO aparece. Historico comeca em 29/07/2026, sem retroatividade. Lista vazia significa "nada detectado nas fotos diarias", NUNCA "ninguem alterou" - se a suspeita de alteracao externa for relevante para a decisao, peca confirmacao humana.'
  );
$$;

revoke all on function public.get_alteracoes_config(uuid, integer) from public, anon;
grant execute on function public.get_alteracoes_config(uuid, integer) to authenticated, service_role;

comment on function public.get_alteracoes_config(uuid, integer) is
  'Alteracoes de status e orcamento detectadas entre fotos diarias, com a limitacao declarada no proprio retorno. Base da doutrina "voce nao e o unico ator": verificar alteracao de configuracao antes de atribuir causa a criativo ou publico.';

-- Agendamento (aplicado via execute_sql apos a migracao):
-- select cron.schedule('campaign-config-snapshot-0925', '25 9 * * *',
--   $$select public.snapshot_campaign_config()$$);
