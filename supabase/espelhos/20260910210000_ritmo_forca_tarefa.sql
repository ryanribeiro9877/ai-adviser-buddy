-- Forca-tarefa Ritmo (10/09/2026)
--
-- POR QUE: o gestor autoriza UMA vez uma missao com prazo, teto e dissertacao;
-- dai os agentes escrevem na Meta sem card, so nesta campanha. Sem essa
-- concessao nomeada, a unica escrita continua sendo o card.
--
-- O QUE NAO MEXE: fila de Aprovacoes, propose_action, digest, relatorios
-- autonomos. O cron HTTP (tiques leve/fundo) entra em outra entrega para
-- nao disparar edge inexistente.
--
-- ESCRITA NA META: so passa se pode_executar_ato_ritmo autenticar a concessao.
-- Nao ha interruptor global de autonomia.

-- ============================================================================
-- 1) TABELAS
-- ============================================================================

create table public.ritmo_missoes (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  campaign_id text not null,
  campaign_name text not null default '',
  ad_account_id text,
  status text not null default 'em_analise'
    check (status in ('em_analise','plano_pronto','analise_falhou','em_execucao','encerrada')),
  periodo_inicio date not null,
  periodo_fim date not null,
  metrica text not null
    check (metrica in ('conversas','cliques_no_link','formularios','alcance','impressoes','ctr','ctr_link')),
  dissertacao text not null,
  sonho numeric,
  extra_investimento numeric not null default 0 check (extra_investimento >= 0),
  baseline_gasto_diario numeric,
  baseline_json jsonb not null default '{}'::jsonb,
  teto_gasto_janela numeric,
  plano_json jsonb,
  leitura_json jsonb,
  projecoes_json jsonb,
  confianca_baseline text check (confianca_baseline is null or confianca_baseline in ('alta','baixa')),
  fonte_campanhas text check (fonte_campanhas is null or fonte_campanhas in ('ao_vivo','espelho')),
  autonomia_concedida_em timestamptz,
  autonomia_concedida_por uuid,
  encerrada_em timestamptz,
  encerrada_por uuid,
  encerrada_motivo text
    check (encerrada_motivo is null or encerrada_motivo in
      ('prazo','sonho','teto','humano','trava','descartada')),
  erro_analise text,
  job_id uuid,
  criado_por uuid,
  criado_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now(),
  constraint ritmo_missoes_prazo check (periodo_fim >= periodo_inicio),
  constraint ritmo_missoes_dissertacao check (length(btrim(dissertacao)) > 0),
  constraint ritmo_missoes_sonho check (sonho is null or sonho > 0)
);

comment on table public.ritmo_missoes is
  'Pedido, plano e concessao de uma forca-tarefa. Uma autorizacao humana abre a janela; sem ela o portao SQL recusa escrita na Meta.';
comment on column public.ritmo_missoes.autonomia_concedida_em is
  'Carimbo da unica autorizacao humana. Null = ainda nao ha concessao, mesmo com plano pronto.';
comment on column public.ritmo_missoes.teto_gasto_janela is
  'Teto da JANELA (baseline x dias + extra), nao orcamento diario da Meta. Estouro fecha a missao.';
comment on column public.ritmo_missoes.fonte_campanhas is
  'ao_vivo = lista veio do Pipeboard nesta rodada. espelho = caiu no banco local, e a UI tem de dizer isso.';

create unique index ritmo_missoes_uma_execucao
  on public.ritmo_missoes (company_id, campaign_id)
  where status = 'em_execucao';

create index ritmo_missoes_company_idx
  on public.ritmo_missoes (company_id, criado_em desc);

create table public.ritmo_atos (
  id uuid primary key default gen_random_uuid(),
  missao_id uuid not null references public.ritmo_missoes(id) on delete cascade,
  company_id uuid not null references public.companies(id) on delete cascade,
  tique text not null check (tique in ('primeiro_passe','leve','fundo')),
  acao text not null,
  alvo_external_id text,
  payload jsonb not null default '{}'::jsonb,
  evidencia text,
  mecanismo text,
  metrica_sucesso text,
  janela_leitura text,
  reversa text,
  resultado text not null default 'pendente'
    check (resultado in ('pendente','executando','ok','bloqueado','falhou','simulado')),
  resposta_meta jsonb,
  replano boolean not null default false,
  criado_em timestamptz not null default now()
);

comment on table public.ritmo_atos is
  'Cada tentativa de escrita (ou bloqueio) da forca-tarefa. A fila de Aprovacoes nao lista estes atos.';
comment on column public.ritmo_atos.replano is
  'True quando o ato nasceu de um tique fundo, nao do plano original.';

create index ritmo_atos_missao_idx on public.ritmo_atos (missao_id, criado_em desc);

-- ============================================================================
-- 2) FILA DE ANALISE
-- ============================================================================

create or replace function public.enfileirar_ritmo_analise(
  p_company_id uuid,
  p_campaign_id text,
  p_campaign_name text,
  p_ad_account_id text,
  p_periodo_inicio date,
  p_periodo_fim date,
  p_metrica text,
  p_dissertacao text,
  p_sonho numeric,
  p_extra numeric,
  p_fonte_campanhas text
) returns uuid
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_id uuid;
begin
  if p_company_id is null then
    raise exception 'company_id obrigatorio';
  end if;
  if auth.uid() is null
     or not public.has_role(auth.uid(), 'admin'::app_role)
     or not public.is_company_member(p_company_id, auth.uid()) then
    raise exception 'somente administrador da empresa enfileira forca-tarefa';
  end if;
  if p_campaign_id is null or length(btrim(p_campaign_id)) = 0 then
    raise exception 'campanha obrigatoria';
  end if;
  if p_dissertacao is null or length(btrim(p_dissertacao)) = 0 then
    raise exception 'dissertacao obrigatoria';
  end if;
  if p_periodo_inicio is null or p_periodo_fim is null
     or p_periodo_fim < p_periodo_inicio
     or (p_periodo_fim - p_periodo_inicio) > 89 then
    raise exception 'prazo invalido: no maximo 90 dias corridos';
  end if;
  if p_metrica not in (
       'conversas','cliques_no_link','formularios','alcance','impressoes','ctr','ctr_link'
     ) then
    raise exception 'metrica desconhecida';
  end if;
  if p_sonho is not null and p_sonho <= 0 then
    raise exception 'sonho invalido';
  end if;
  if p_extra is not null and p_extra < 0 then
    raise exception 'extra invalido';
  end if;
  if p_fonte_campanhas is not null
     and p_fonte_campanhas not in ('ao_vivo','espelho') then
    raise exception 'fonte_campanhas invalida';
  end if;

  insert into public.ritmo_missoes (
    company_id, campaign_id, campaign_name, ad_account_id,
    status, periodo_inicio, periodo_fim, metrica, dissertacao,
    sonho, extra_investimento, fonte_campanhas, criado_por)
  values (
    p_company_id, btrim(p_campaign_id), coalesce(p_campaign_name, ''), p_ad_account_id,
    'em_analise', p_periodo_inicio, p_periodo_fim, p_metrica, p_dissertacao,
    p_sonho, coalesce(p_extra, 0), p_fonte_campanhas, auth.uid())
  returning id into v_id;

  return v_id;
end;
$$;

comment on function public.enfileirar_ritmo_analise(uuid, text, text, text, date, date, text, text, numeric, numeric, text) is
  'Admin da empresa abre o pedido. Ainda nao escreve na Meta: so enfileira a analise que monta o plano.';

create or replace function public.claim_ritmo_missao_analise(p_id uuid)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_row public.ritmo_missoes;
begin
  select * into v_row
    from public.ritmo_missoes
   where id = p_id
     and status = 'em_analise';
  if v_row.id is null then
    return null;
  end if;
  return to_jsonb(v_row);
end;
$$;

comment on function public.claim_ritmo_missao_analise(uuid) is
  'Job pega a missao em analise sem mudar o status. Idempotente: a mesma linha pode ser relida.';

create or replace function public.gravar_plano_ritmo(
  p_id uuid,
  p_plano_json jsonb,
  p_leitura_json jsonb,
  p_projecoes_json jsonb,
  p_baseline_gasto_diario numeric,
  p_baseline_json jsonb,
  p_teto_gasto_janela numeric,
  p_confianca_baseline text,
  p_erro_analise text,
  p_job_id uuid
) returns uuid
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_id uuid;
  v_falhou boolean;
begin
  if p_id is null then
    raise exception 'missao obrigatoria';
  end if;

  v_falhou := p_erro_analise is not null and length(btrim(p_erro_analise)) > 0;

  if v_falhou then
    update public.ritmo_missoes
       set status = 'analise_falhou',
           erro_analise = p_erro_analise,
           job_id = coalesce(p_job_id, job_id),
           atualizado_em = now()
     where id = p_id
       and status = 'em_analise'
    returning id into v_id;
  else
    if p_confianca_baseline is not null
       and p_confianca_baseline not in ('alta','baixa') then
      raise exception 'confianca_baseline invalida';
    end if;
    update public.ritmo_missoes
       set plano_json = p_plano_json,
           leitura_json = p_leitura_json,
           projecoes_json = p_projecoes_json,
           baseline_gasto_diario = p_baseline_gasto_diario,
           baseline_json = coalesce(p_baseline_json, '{}'::jsonb),
           teto_gasto_janela = p_teto_gasto_janela,
           confianca_baseline = p_confianca_baseline,
           status = 'plano_pronto',
           erro_analise = null,
           job_id = coalesce(p_job_id, job_id),
           atualizado_em = now()
     where id = p_id
       and status = 'em_analise'
    returning id into v_id;
  end if;

  if v_id is null then
    raise exception 'missao nao esta em analise';
  end if;
  return v_id;
end;
$$;

comment on function public.gravar_plano_ritmo(uuid, jsonb, jsonb, jsonb, numeric, jsonb, numeric, text, text, uuid) is
  'Job grava o plano (ou a falha) sem emitir card. Envelope de gasto ja veio calculado, nao do modelo.';

create or replace function public.reenviar_ritmo_analise(p_id uuid)
returns uuid
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_m public.ritmo_missoes;
begin
  if p_id is null then
    raise exception 'missao obrigatoria';
  end if;

  select * into v_m from public.ritmo_missoes where id = p_id;
  if v_m.id is null then
    raise exception 'missao nao encontrada';
  end if;
  if auth.uid() is null
     or not public.has_role(auth.uid(), 'admin'::app_role)
     or not public.is_company_member(v_m.company_id, auth.uid()) then
    raise exception 'somente administrador da empresa reenvia analise';
  end if;
  if v_m.status is distinct from 'analise_falhou' then
    raise exception 'so missao com analise falha pode ser reenviada';
  end if;

  update public.ritmo_missoes
     set status = 'em_analise',
         erro_analise = null,
         atualizado_em = now()
   where id = p_id
     and status = 'analise_falhou';

  return p_id;
end;
$$;

comment on function public.reenviar_ritmo_analise(uuid) is
  'Admin manda a analise de novo depois de uma falha. Nao reabre concessao nem escreve na Meta.';

-- ============================================================================
-- 3) CONCESSAO E ENCERRAMENTO
-- ============================================================================

create or replace function public.autorizar_ritmo_missao(p_id uuid)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_m public.ritmo_missoes;
  v_hoje date := (now() at time zone 'America/Sao_Paulo')::date;
  v_master boolean;
  v_status text;
begin
  if p_id is null then
    return jsonb_build_object('ok', false, 'motivo', 'missao_ausente');
  end if;

  select * into v_m from public.ritmo_missoes where id = p_id for update;
  if v_m.id is null then
    return jsonb_build_object('ok', false, 'motivo', 'missao_ausente');
  end if;

  if auth.uid() is null
     or not public.has_role(auth.uid(), 'admin'::app_role)
     or not public.is_company_member(v_m.company_id, auth.uid()) then
    raise exception 'somente administrador da empresa autoriza forca-tarefa';
  end if;

  if v_m.status is distinct from 'plano_pronto' then
    return jsonb_build_object('ok', false, 'motivo', 'status');
  end if;
  if v_m.periodo_fim < v_hoje then
    return jsonb_build_object('ok', false, 'motivo', 'fora_do_prazo');
  end if;

  select mec.master_enabled into v_master
    from public.meta_execution_config mec
   where mec.company_id = v_m.company_id;
  if v_master is not true then
    return jsonb_build_object('ok', false, 'motivo', 'master_desligado');
  end if;

  select c.status into v_status
    from public.campaigns c
   where c.company_id = v_m.company_id
     and c.external_id = v_m.campaign_id
   limit 1;
  if v_status is null or lower(btrim(v_status)) not in ('active') then
    return jsonb_build_object('ok', false, 'motivo', 'campanha');
  end if;

  begin
    update public.ritmo_missoes
       set status = 'em_execucao',
           autonomia_concedida_em = now(),
           autonomia_concedida_por = auth.uid(),
           atualizado_em = now()
     where id = p_id
       and status = 'plano_pronto';
  exception
    when unique_violation then
      return jsonb_build_object('ok', false, 'motivo', 'ja_em_execucao');
  end;

  if not found then
    return jsonb_build_object('ok', false, 'motivo', 'status');
  end if;

  return jsonb_build_object('ok', true);
end;
$$;

comment on function public.autorizar_ritmo_missao(uuid) is
  'Um humano concede autonomia nesta campanha. O indice unico impede duas missoes em execucao no mesmo alvo.';

create or replace function public.encerrar_ritmo_missao(p_id uuid, p_motivo text)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_m public.ritmo_missoes;
begin
  if p_id is null then
    return jsonb_build_object('ok', false, 'motivo', 'missao_ausente');
  end if;
  if p_motivo is null or p_motivo not in ('prazo','sonho','teto','humano','trava','descartada') then
    raise exception 'motivo de encerramento invalido';
  end if;

  select * into v_m from public.ritmo_missoes where id = p_id for update;
  if v_m.id is null then
    return jsonb_build_object('ok', false, 'motivo', 'missao_ausente');
  end if;

  if auth.uid() is not null then
    if not public.has_role(auth.uid(), 'admin'::app_role)
       or not public.is_company_member(v_m.company_id, auth.uid()) then
      raise exception 'somente administrador da empresa encerra forca-tarefa';
    end if;
  end if;

  if v_m.status = 'plano_pronto' then
    if p_motivo is distinct from 'descartada' then
      return jsonb_build_object('ok', false, 'motivo', 'status');
    end if;
  elsif v_m.status = 'em_execucao' then
    if p_motivo = 'descartada' then
      return jsonb_build_object('ok', false, 'motivo', 'status');
    end if;
  else
    return jsonb_build_object('ok', false, 'motivo', 'status');
  end if;

  update public.ritmo_missoes
     set status = 'encerrada',
         encerrada_em = now(),
         encerrada_por = auth.uid(),
         encerrada_motivo = p_motivo,
         atualizado_em = now()
   where id = p_id
     and status in ('em_execucao','plano_pronto');

  if not found then
    return jsonb_build_object('ok', false, 'motivo', 'status');
  end if;

  return jsonb_build_object('ok', true, 'motivo', p_motivo);
end;
$$;

comment on function public.encerrar_ritmo_missao(uuid, text) is
  'Fecha a concessao (humano ou tique automatico). Plano pronto so descarta; em execucao para por prazo, sonho, teto, trava ou humano.';

-- ============================================================================
-- 4) PORTAO DE ESCRITA
-- ============================================================================

create or replace function public.pode_executar_ato_ritmo(
  p_missao_id uuid,
  p_company_id uuid,
  p_campaign_id text,
  p_acao text
) returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  m public.ritmo_missoes;
  v_hoje date := (now() at time zone 'America/Sao_Paulo')::date;
  v_master boolean;
  v_dry boolean := false;
  v_gasto numeric := 0;
begin
  if p_missao_id is null then
    return jsonb_build_object('ok', false, 'motivo', 'missao_ausente', 'dry_run', false);
  end if;

  select * into m from public.ritmo_missoes where id = p_missao_id;
  if m.id is null then
    return jsonb_build_object('ok', false, 'motivo', 'missao_ausente', 'dry_run', false);
  end if;

  select coalesce(mec.dry_run, false), mec.master_enabled
    into v_dry, v_master
    from public.meta_execution_config mec
   where mec.company_id = m.company_id;

  if m.status is distinct from 'em_execucao' then
    return jsonb_build_object('ok', false, 'motivo', 'status', 'dry_run', v_dry);
  end if;
  if m.autonomia_concedida_em is null then
    return jsonb_build_object('ok', false, 'motivo', 'sem_concessao', 'dry_run', v_dry);
  end if;
  if p_company_id is null or m.company_id is distinct from p_company_id then
    return jsonb_build_object('ok', false, 'motivo', 'empresa', 'dry_run', v_dry);
  end if;
  if p_campaign_id is null or m.campaign_id is distinct from p_campaign_id then
    return jsonb_build_object('ok', false, 'motivo', 'campanha', 'dry_run', v_dry);
  end if;
  if v_master is not true then
    return jsonb_build_object('ok', false, 'motivo', 'master_desligado', 'dry_run', v_dry);
  end if;

  -- criar_campanha e qualquer acao fora da lista branca: recusa fechada.
  if p_acao is null
     or p_acao = 'criar_campanha'
     or p_acao not in (
       'pausar_criativo',
       'ativar_criativo',
       'escalar_criativo',
       'pausar_conjunto',
       'ativar_conjunto',
       'alterar_orcamento',
       'ajustar_posicionamentos_do_conjunto',
       'alterar_geo_do_conjunto',
       'vincular_instagram_dos_anuncios',
       'criar_conjunto_a_partir_de',
       'criar_anuncio_a_partir_de',
       'escalar_duplicar'
     ) then
    return jsonb_build_object('ok', false, 'motivo', 'acao_proibida', 'dry_run', v_dry);
  end if;

  if v_hoje < m.periodo_inicio then
    return jsonb_build_object('ok', false, 'motivo', 'antes_do_inicio', 'dry_run', v_dry);
  end if;
  if v_hoje > m.periodo_fim then
    return jsonb_build_object('ok', false, 'motivo', 'fora_do_prazo', 'dry_run', v_dry);
  end if;

  if p_acao = 'alterar_orcamento'
     or p_acao like 'escalar_%'
     or p_acao like 'criar_%' then
    v_gasto := coalesce((
      select sum(spend) from public.metric_snapshots s
       where s.company_id = m.company_id
         and s.campaign_id = m.campaign_id
         and s.snapshot_date >= m.periodo_inicio
         and s.snapshot_date <= m.periodo_fim
    ), 0);
    if v_gasto >= coalesce(m.teto_gasto_janela, 0) then
      return jsonb_build_object('ok', false, 'motivo', 'teto', 'dry_run', v_dry);
    end if;
  end if;

  return jsonb_build_object('ok', true, 'motivo', null, 'dry_run', coalesce(v_dry, false));
end;
$$;

comment on function public.pode_executar_ato_ritmo(uuid, uuid, text, text) is
  'Portao da escrita sem card: missao em execucao, mesma empresa e campanha, prazo, teto e lista branca. dry_run informa; nao libera escrita.';

create or replace function public.listar_ritmo_tiques_devidos(p_tique text, p_limite integer)
returns table (id uuid, company_id uuid, campaign_id text)
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_hoje date := (now() at time zone 'America/Sao_Paulo')::date;
begin
  if p_tique is null
     or p_tique not in ('primeiro_passe','leve','fundo') then
    raise exception 'tique desconhecido';
  end if;

  return query
    select m.id, m.company_id, m.campaign_id
      from public.ritmo_missoes m
     where m.status = 'em_execucao'
       and m.periodo_inicio <= v_hoje
     order by m.autonomia_concedida_em nulls last, m.criado_em
     limit greatest(coalesce(p_limite, 20), 1)
     for update of m skip locked;
end;
$$;

comment on function public.listar_ritmo_tiques_devidos(text, integer) is
  'Despachante: missoes em execucao cujo prazo ja comecou em America/Sao_Paulo. Service role.';

-- ============================================================================
-- 5) RLS
-- ============================================================================

alter table public.ritmo_missoes enable row level security;
alter table public.ritmo_atos enable row level security;

create policy ritmo_missoes_select on public.ritmo_missoes
  for select to authenticated
  using (
    public.is_company_member(company_id, (select auth.uid()))
    or public.has_role((select auth.uid()), 'admin'::app_role)
  );

create policy ritmo_atos_select on public.ritmo_atos
  for select to authenticated
  using (
    public.is_company_member(company_id, (select auth.uid()))
    or public.has_role((select auth.uid()), 'admin'::app_role)
  );

-- Escrita de ritmo_missoes e ritmo_atos: RPC (definer) e service_role da edge.
-- Sem INSERT/UPDATE direto de authenticated.

revoke all on function public.enfileirar_ritmo_analise(uuid, text, text, text, date, date, text, text, numeric, numeric, text) from public, anon;
grant execute on function public.enfileirar_ritmo_analise(uuid, text, text, text, date, date, text, text, numeric, numeric, text) to authenticated, service_role;

revoke all on function public.reenviar_ritmo_analise(uuid) from public, anon;
grant execute on function public.reenviar_ritmo_analise(uuid) to authenticated, service_role;

revoke all on function public.autorizar_ritmo_missao(uuid) from public, anon;
grant execute on function public.autorizar_ritmo_missao(uuid) to authenticated, service_role;

revoke all on function public.encerrar_ritmo_missao(uuid, text) from public, anon;
grant execute on function public.encerrar_ritmo_missao(uuid, text) to authenticated, service_role;

revoke all on function public.claim_ritmo_missao_analise(uuid) from public, anon, authenticated;
grant execute on function public.claim_ritmo_missao_analise(uuid) to service_role;

revoke all on function public.gravar_plano_ritmo(uuid, jsonb, jsonb, jsonb, numeric, jsonb, numeric, text, text, uuid) from public, anon, authenticated;
grant execute on function public.gravar_plano_ritmo(uuid, jsonb, jsonb, jsonb, numeric, jsonb, numeric, text, text, uuid) to service_role;

revoke all on function public.pode_executar_ato_ritmo(uuid, uuid, text, text) from public, anon, authenticated;
grant execute on function public.pode_executar_ato_ritmo(uuid, uuid, text, text) to service_role;

revoke all on function public.listar_ritmo_tiques_devidos(text, integer) from public, anon, authenticated;
grant execute on function public.listar_ritmo_tiques_devidos(text, integer) to service_role;

revoke all on table public.ritmo_missoes from public, anon, authenticated;
revoke all on table public.ritmo_atos from public, anon, authenticated;
grant select on table public.ritmo_missoes to authenticated;
grant select on table public.ritmo_atos to authenticated;
grant all on table public.ritmo_missoes to service_role;
grant all on table public.ritmo_atos to service_role;

-- ============================================================================
-- 6) REALTIME
-- ============================================================================

do $$
begin
  begin
    alter publication supabase_realtime add table public.ritmo_missoes;
  exception
    when duplicate_object then null;
  end;
  begin
    alter publication supabase_realtime add table public.ritmo_atos;
  exception
    when duplicate_object then null;
  end;
end $$;
