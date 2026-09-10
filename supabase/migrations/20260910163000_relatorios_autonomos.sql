-- Relatorios autonomos (10/09/2026)
--
-- POR QUE: o gestor monta o mesmo relatorio de midia todo dia na mao (teto, custo,
-- fadiga, o que vigiar). O sistema ja tem digest deterministico as 08:30 e o job
-- de analise profunda. Faltava a camada CONFIGURAVEL: horario, campanhas e secoes,
-- com opiniao embasada, sem escrever na Meta.
--
-- O QUE NAO MEXE: post_daily_report, digest por e-mail, chat Operacao, propose_action,
-- catalogo antigo de tarefas (so ACRESCENTA uma linha). Um cron do sistema, N agendas
-- do gestor — cron.job por relatorio explodiria o painel de Tarefas.
--
-- ESCRITA NA META: continua com humano. Este fluxo so le e grava relatorio_gerados.

-- ============================================================================
-- 1) TABELAS
-- ============================================================================

create table public.relatorio_agendamentos (
  id                    uuid primary key default gen_random_uuid(),
  company_id            uuid not null references public.companies(id) on delete cascade,
  nome                  text not null,
  ativo                 boolean not null default true,
  frequencia            text not null
                        check (frequencia in ('diaria','dias_uteis','semanal','cada_n_horas')),
  hora_local            time not null default '08:00',
  dia_semana            smallint check (dia_semana is null or (dia_semana >= 0 and dia_semana <= 6)),
  intervalo_horas       integer check (intervalo_horas is null or intervalo_horas >= 1),
  recorte_campanhas     text not null default 'todas_ativas'
                        check (recorte_campanhas in ('todas_ativas','ids_fixos')),
  campaign_ids          text[] not null default '{}',
  janela_analise        text not null default 'ontem'
                        check (janela_analise in ('ontem','3d','7d','14d')),
  secoes                text[] not null,
  proxima_execucao_em   timestamptz,
  ultima_execucao_em    timestamptz,
  criado_por            uuid,
  criado_em             timestamptz not null default now(),
  atualizado_em         timestamptz not null default now(),
  constraint relatorio_agendamentos_semanal_tem_dia
    check (frequencia <> 'semanal' or dia_semana is not null),
  constraint relatorio_agendamentos_n_horas
    check (frequencia <> 'cada_n_horas' or intervalo_horas is not null),
  constraint relatorio_agendamentos_ids_quando_fixo
    check (recorte_campanhas <> 'ids_fixos' or cardinality(campaign_ids) > 0),
  constraint relatorio_agendamentos_nome_nao_vazio
    check (length(btrim(nome)) > 0)
);

comment on table public.relatorio_agendamentos is
  'Agenda do relatorio autonomo por empresa. O gestor escolhe quando, quais campanhas e o que entra; um despachante unico dispara o job.';
comment on column public.relatorio_agendamentos.recorte_campanhas is
  'todas_ativas = resolve a lista AO VIVO na hora de rodar. ids_fixos = usa campaign_ids (IDs da Meta).';
comment on column public.relatorio_agendamentos.hora_local is
  'Horario de America/Sao_Paulo. Nunca UTC na cara do gestor.';

create index relatorio_agendamentos_company_idx
  on public.relatorio_agendamentos (company_id, ativo, proxima_execucao_em);

create table public.relatorio_gerados (
  id                       uuid primary key default gen_random_uuid(),
  company_id               uuid not null references public.companies(id) on delete cascade,
  agendamento_id           uuid references public.relatorio_agendamentos(id) on delete set null,
  nome                     text not null,
  status                   text not null default 'queued'
                           check (status in ('queued','running','done','error')),
  recorte_campanhas        text not null,
  campaign_ids             text[] not null default '{}',
  campaign_ids_resolvidos  text[] not null default '{}',
  fonte_campanhas          text
                           check (fonte_campanhas is null or fonte_campanhas in ('ao_vivo','espelho')),
  janela_analise           text not null,
  secoes                   text[] not null,
  periodo_inicio           date,
  periodo_fim              date,
  corpo_md                 text,
  achados                  jsonb not null default '[]'::jsonb,
  cobertura                text,
  erro                     text,
  criado_por               uuid,
  criado_em                timestamptz not null default now(),
  iniciado_em              timestamptz,
  finalizado_em            timestamptz
);

comment on table public.relatorio_gerados is
  'Historico dos relatorios autonomos. A aba Relatorios le daqui; o chat Operacao nao recebe esta linha.';
comment on column public.relatorio_gerados.fonte_campanhas is
  'ao_vivo = lista veio do Pipeboard nesta rodada. espelho = caiu no banco local, e a UI tem de dizer isso.';

create index relatorio_gerados_company_idx
  on public.relatorio_gerados (company_id, criado_em desc);
create index relatorio_gerados_status_idx
  on public.relatorio_gerados (status, criado_em)
  where status in ('queued','running');
create index relatorio_gerados_agenda_idx
  on public.relatorio_gerados (agendamento_id, criado_em desc)
  where agendamento_id is not null;

-- ============================================================================
-- 2) CATALOGO DE SECOES (mesma lista de src/lib/relatorios.ts)
-- ============================================================================

create or replace function public.secoes_relatorio_conhecidas()
returns text[]
language sql
immutable
as $$
  select array[
    'resumo_executivo','status_entrega','investimento_pacing','custo_vs_teto',
    'funil_midia','por_campanha','por_conjunto','criativos_ranking','fadiga',
    'diagnostico_custo','escala','alertas','recomendacoes','compliance',
    'comparativo','whatsapp','cobertura','opiniaoes'
  ]::text[];
$$;

create or replace function public.validar_secoes_relatorio(p_secoes text[])
returns text[]
language plpgsql
immutable
as $$
declare
  v_conhecidas text[] := public.secoes_relatorio_conhecidas();
  v_invalidas text[];
begin
  if p_secoes is null or cardinality(p_secoes) = 0 then
    raise exception 'relatorio sem secao: escolha ao menos uma do catalogo';
  end if;
  select coalesce(array_agg(s), '{}') into v_invalidas
    from unnest(p_secoes) s
   where s <> all (v_conhecidas);
  if cardinality(v_invalidas) > 0 then
    raise exception 'secao(oes) desconhecida(s) no relatorio: %', array_to_string(v_invalidas, ', ');
  end if;
  return p_secoes;
end;
$$;

alter table public.relatorio_agendamentos
  add constraint relatorio_agendamentos_secoes_conhecidas
  check (secoes <@ public.secoes_relatorio_conhecidas() and cardinality(secoes) > 0);

alter table public.relatorio_gerados
  add constraint relatorio_gerados_secoes_conhecidas
  check (secoes <@ public.secoes_relatorio_conhecidas() and cardinality(secoes) > 0);

-- ============================================================================
-- 3) PROXIMA EXECUCAO EM BRASILIA
-- ============================================================================

create or replace function public.proxima_execucao_relatorio(
  p_frequencia text,
  p_hora_local time,
  p_dia_semana integer default null,
  p_intervalo_horas integer default null,
  p_a_partir_de timestamptz default now()
) returns timestamptz
language plpgsql
stable
as $$
declare
  v_local timestamp;
  v_cand timestamp;
  v_dow integer;
  v_alvo integer;
  v_i integer;
begin
  if p_frequencia = 'cada_n_horas' then
    return p_a_partir_de + make_interval(hours => greatest(coalesce(p_intervalo_horas, 1), 1));
  end if;

  v_local := p_a_partir_de at time zone 'America/Sao_Paulo';
  v_cand := v_local::date + coalesce(p_hora_local, time '08:00');

  if p_frequencia = 'diaria' then
    if v_cand <= v_local then
      v_cand := (v_cand::date + 1) + coalesce(p_hora_local, time '08:00');
    end if;
    return v_cand at time zone 'America/Sao_Paulo';
  end if;

  if p_frequencia = 'dias_uteis' then
    for v_i in 0..13 loop
      v_dow := extract(dow from v_cand)::integer;
      if v_cand > v_local and v_dow not in (0, 6) then
        return v_cand at time zone 'America/Sao_Paulo';
      end if;
      v_cand := (v_cand::date + 1) + coalesce(p_hora_local, time '08:00');
    end loop;
    return v_cand at time zone 'America/Sao_Paulo';
  end if;

  if p_frequencia = 'semanal' then
    v_alvo := coalesce(p_dia_semana, 1);
    for v_i in 0..13 loop
      v_dow := extract(dow from v_cand)::integer;
      if v_dow = v_alvo and v_cand > v_local then
        return v_cand at time zone 'America/Sao_Paulo';
      end if;
      v_cand := (v_cand::date + 1) + coalesce(p_hora_local, time '08:00');
    end loop;
    return v_cand at time zone 'America/Sao_Paulo';
  end if;

  raise exception 'frequencia de relatorio desconhecida: %', p_frequencia;
end;
$$;

comment on function public.proxima_execucao_relatorio(text, time, integer, integer, timestamptz) is
  'Proximo disparo em America/Sao_Paulo. O gestor nao escreve cron: diaria / dias uteis / semanal / cada N horas.';

create or replace function public.relatorio_agendamentos_preencher_proxima()
returns trigger
language plpgsql
as $$
begin
  perform public.validar_secoes_relatorio(NEW.secoes);
  NEW.atualizado_em := now();
  if TG_OP = 'INSERT' then
    if NEW.ativo then
      NEW.proxima_execucao_em := public.proxima_execucao_relatorio(
        NEW.frequencia, NEW.hora_local, NEW.dia_semana, NEW.intervalo_horas, now());
    end if;
  elsif NEW.frequencia is distinct from OLD.frequencia
     or NEW.hora_local is distinct from OLD.hora_local
     or NEW.dia_semana is distinct from OLD.dia_semana
     or NEW.intervalo_horas is distinct from OLD.intervalo_horas
     or (NEW.ativo = true and (OLD.ativo = false or NEW.proxima_execucao_em is null)) then
    if NEW.ativo then
      NEW.proxima_execucao_em := public.proxima_execucao_relatorio(
        NEW.frequencia, NEW.hora_local, NEW.dia_semana, NEW.intervalo_horas, now());
    end if;
  end if;
  return NEW;
end;
$$;

create trigger trg_relatorio_agendamentos_proxima
before insert or update on public.relatorio_agendamentos
for each row execute function public.relatorio_agendamentos_preencher_proxima();

-- ============================================================================
-- 4) LISTA DO ESPELHO (fallback honesto)
-- ============================================================================

create or replace function public.listar_campanhas_para_relatorio(p_company_id uuid)
returns table (
  external_id text,
  nome text,
  status text,
  objetivo text,
  tipo text,
  gasto numeric,
  last_synced_at timestamptz
)
language plpgsql
stable
security definer
set search_path to 'public'
as $$
begin
  if p_company_id is null then
    raise exception 'company_id obrigatorio';
  end if;
  if auth.uid() is not null
     and not public.is_company_member(p_company_id, auth.uid())
     and not public.has_role(auth.uid(), 'admin'::app_role) then
    raise exception 'nao autorizado para esta empresa';
  end if;

  return query
    select c.external_id,
           c.name,
           c.status,
           c.objective,
           c.category,
           coalesce(c.spend, 0)::numeric,
           c.last_synced_at
      from public.campaigns c
     where c.company_id = p_company_id
       and c.external_id is not null
       and btrim(c.external_id) <> ''
     order by coalesce(c.spend, 0) desc, c.name;
end;
$$;

comment on function public.listar_campanhas_para_relatorio(uuid) is
  'Lista do ESPELHO local. A lista ao vivo vem da edge pipeboard-read; se ela falhar, a UI usa esta e declara a fonte.';

-- ============================================================================
-- 5) FILA
-- ============================================================================

create or replace function public.enfileirar_relatorios_vencidos(p_limite integer default 2)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_a record;
  v_id uuid;
  v_n integer := 0;
  v_ids uuid[] := '{}';
  v_hoje date := (now() at time zone 'America/Sao_Paulo')::date;
  v_fim date := v_hoje - 1;
  v_ini date;
  v_dias integer;
begin
  for v_a in
    select a.*
      from public.relatorio_agendamentos a
     where a.ativo
       and a.proxima_execucao_em is not null
       and a.proxima_execucao_em <= now()
       and not exists (
         select 1 from public.relatorio_gerados g
          where g.agendamento_id = a.id
            and g.status in ('queued','running')
       )
     order by a.proxima_execucao_em
     for update of a skip locked
     limit greatest(coalesce(p_limite, 2), 1)
  loop
    v_dias := case v_a.janela_analise
                when 'ontem' then 1
                when '3d' then 3
                when '7d' then 7
                else 14
              end;
    v_ini := v_fim - (v_dias - 1);

    insert into public.relatorio_gerados (
      company_id, agendamento_id, nome, status,
      recorte_campanhas, campaign_ids, janela_analise, secoes,
      periodo_inicio, periodo_fim)
    values (
      v_a.company_id, v_a.id, v_a.nome, 'queued',
      v_a.recorte_campanhas, v_a.campaign_ids, v_a.janela_analise, v_a.secoes,
      v_ini, v_fim)
    returning id into v_id;

    update public.relatorio_agendamentos
       set proxima_execucao_em = public.proxima_execucao_relatorio(
             frequencia, hora_local, dia_semana, intervalo_horas, now()),
           ultima_execucao_em = now()
     where id = v_a.id;

    v_n := v_n + 1;
    v_ids := v_ids || v_id;
  end loop;

  return jsonb_build_object('enfileirados', v_n, 'ids', to_jsonb(v_ids));
end;
$$;

comment on function public.enfileirar_relatorios_vencidos(integer) is
  'Despachante: ate N agendas vencidas viram relatorio_gerados queued. Avanca proxima_execucao para nao empilhar. Service role.';

create or replace function public.enfileirar_relatorio_agora(
  p_company_id uuid,
  p_agendamento_id uuid default null,
  p_nome text default null,
  p_recorte_campanhas text default null,
  p_campaign_ids text[] default null,
  p_janela_analise text default null,
  p_secoes text[] default null
) returns uuid
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_a public.relatorio_agendamentos%rowtype;
  v_id uuid;
  v_hoje date := (now() at time zone 'America/Sao_Paulo')::date;
  v_fim date := v_hoje - 1;
  v_ini date;
  v_dias integer;
  v_nome text;
  v_recorte text;
  v_ids text[];
  v_janela text;
  v_secoes text[];
begin
  if p_company_id is null then
    raise exception 'company_id obrigatorio';
  end if;
  if auth.uid() is null or not public.has_role(auth.uid(), 'admin'::app_role) then
    raise exception 'somente administrador enfileira relatorio';
  end if;
  if not public.is_company_member(p_company_id, auth.uid())
     and not public.has_role(auth.uid(), 'admin'::app_role) then
    raise exception 'nao autorizado para esta empresa';
  end if;

  if p_agendamento_id is not null then
    select * into v_a from public.relatorio_agendamentos
     where id = p_agendamento_id and company_id = p_company_id;
    if v_a.id is null then
      raise exception 'agendamento nao encontrado nesta empresa';
    end if;
    v_nome := coalesce(nullif(btrim(p_nome), ''), v_a.nome);
    v_recorte := coalesce(p_recorte_campanhas, v_a.recorte_campanhas);
    v_ids := coalesce(p_campaign_ids, v_a.campaign_ids);
    v_janela := coalesce(p_janela_analise, v_a.janela_analise);
    v_secoes := coalesce(p_secoes, v_a.secoes);
  else
    v_nome := coalesce(nullif(btrim(p_nome), ''), 'Relatorio avulso');
    v_recorte := coalesce(p_recorte_campanhas, 'todas_ativas');
    v_ids := coalesce(p_campaign_ids, '{}');
    v_janela := coalesce(p_janela_analise, 'ontem');
    v_secoes := coalesce(p_secoes, public.secoes_relatorio_conhecidas());
  end if;

  perform public.validar_secoes_relatorio(v_secoes);
  if v_recorte = 'ids_fixos' and cardinality(v_ids) = 0 then
    raise exception 'recorte ids_fixos exige ao menos uma campanha';
  end if;

  v_dias := case v_janela
              when 'ontem' then 1
              when '3d' then 3
              when '7d' then 7
              else 14
            end;
  v_ini := v_fim - (v_dias - 1);

  insert into public.relatorio_gerados (
    company_id, agendamento_id, nome, status,
    recorte_campanhas, campaign_ids, janela_analise, secoes,
    periodo_inicio, periodo_fim, criado_por)
  values (
    p_company_id, p_agendamento_id, v_nome, 'queued',
    v_recorte, v_ids, v_janela, v_secoes,
    v_ini, v_fim, auth.uid())
  returning id into v_id;

  return v_id;
end;
$$;

comment on function public.enfileirar_relatorio_agora(uuid, uuid, text, text, text[], text, text[]) is
  'Admin dispara um relatorio agora (da agenda ou avulso). Devolve o id para a edge processar.';

create or replace function public.claim_relatorio_gerado(p_id uuid)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_row public.relatorio_gerados;
begin
  update public.relatorio_gerados
     set status = 'running',
         iniciado_em = now(),
         erro = null
   where id = p_id
     and status = 'queued'
  returning * into v_row;
  if v_row.id is null then
    return null;
  end if;
  return to_jsonb(v_row);
end;
$$;

-- ============================================================================
-- 6) RLS
-- ============================================================================

alter table public.relatorio_agendamentos enable row level security;
alter table public.relatorio_gerados enable row level security;

create policy relatorio_agendamentos_select on public.relatorio_agendamentos
  for select to authenticated
  using (
    public.is_company_member(company_id, (select auth.uid()))
    or public.has_role((select auth.uid()), 'admin'::app_role)
  );

create policy relatorio_agendamentos_insert on public.relatorio_agendamentos
  for insert to authenticated
  with check (
    public.has_role((select auth.uid()), 'admin'::app_role)
    and public.is_company_member(company_id, (select auth.uid()))
  );

create policy relatorio_agendamentos_update on public.relatorio_agendamentos
  for update to authenticated
  using (
    public.has_role((select auth.uid()), 'admin'::app_role)
    and public.is_company_member(company_id, (select auth.uid()))
  )
  with check (
    public.has_role((select auth.uid()), 'admin'::app_role)
    and public.is_company_member(company_id, (select auth.uid()))
  );

create policy relatorio_agendamentos_delete on public.relatorio_agendamentos
  for delete to authenticated
  using (
    public.has_role((select auth.uid()), 'admin'::app_role)
    and public.is_company_member(company_id, (select auth.uid()))
  );

create policy relatorio_gerados_select on public.relatorio_gerados
  for select to authenticated
  using (
    public.is_company_member(company_id, (select auth.uid()))
    or public.has_role((select auth.uid()), 'admin'::app_role)
  );

-- Escrita de relatorio_gerados: RPC (definer) e service_role da edge. Sem INSERT direto.

revoke all on function public.enfileirar_relatorios_vencidos(integer) from public, anon, authenticated;
grant execute on function public.enfileirar_relatorios_vencidos(integer) to service_role;

revoke all on function public.claim_relatorio_gerado(uuid) from public, anon, authenticated;
grant execute on function public.claim_relatorio_gerado(uuid) to service_role;

revoke all on function public.enfileirar_relatorio_agora(uuid, uuid, text, text, text[], text, text[]) from public, anon;
grant execute on function public.enfileirar_relatorio_agora(uuid, uuid, text, text, text[], text, text[]) to authenticated, service_role;

revoke all on function public.listar_campanhas_para_relatorio(uuid) from public, anon;
grant execute on function public.listar_campanhas_para_relatorio(uuid) to authenticated, service_role;

revoke all on function public.proxima_execucao_relatorio(text, time, integer, integer, timestamptz) from public, anon;
grant execute on function public.proxima_execucao_relatorio(text, time, integer, integer, timestamptz) to authenticated, service_role;

grant select, insert, update, delete on public.relatorio_agendamentos to authenticated;
grant select on public.relatorio_gerados to authenticated;

-- ============================================================================
-- 7) REALTIME
-- ============================================================================

do $$
begin
  begin
    alter publication supabase_realtime add table public.relatorio_gerados;
  exception
    when duplicate_object then null;
  end;
end $$;

-- ============================================================================
-- 8) CATALOGO DE TAREFAS + CRON
-- ============================================================================

insert into public.mcp_api_keys (chamador, api_key, observacao)
select 'cron:relatorios-agendados',
       encode(sha256((gen_random_uuid()::text || clock_timestamp()::text || 'relatorios-agendados')::bytea), 'hex'),
       'Despachante a cada 5 min dos relatorios autonomos da aba Relatorios.'
on conflict (chamador) do nothing;

insert into public.tarefas_agendadas (
  tarefa, titulo, pergunta, tipo, edge, chave_chamador, modo_auth, corpo, timeout_ms,
  periodicidade, tolerancia_horas, tabela_destino, coluna_carimbo)
values (
  'relatorios-agendados',
  'Relatorios autonomos',
  'Algum relatorio configurado pelo gestor venceu e ainda nao foi gerado?',
  'http', 'traffic-agent-job', 'cron:relatorios-agendados', 'x-mcp-key',
  '{"modo":"relatorio_dispatcher"}'::jsonb, 120000,
  'frequente', 1, 'relatorio_gerados', 'criado_em')
on conflict (tarefa) do update set
  titulo = excluded.titulo,
  pergunta = excluded.pergunta,
  tipo = excluded.tipo,
  edge = excluded.edge,
  chave_chamador = excluded.chave_chamador,
  modo_auth = excluded.modo_auth,
  corpo = excluded.corpo,
  timeout_ms = excluded.timeout_ms,
  periodicidade = excluded.periodicidade,
  tolerancia_horas = excluded.tolerancia_horas,
  tabela_destino = excluded.tabela_destino,
  coluna_carimbo = excluded.coluna_carimbo;

select cron.unschedule(jobid)
  from cron.job
 where jobname = 'relatorios-agendados';

select cron.schedule(
  'relatorios-agendados',
  '*/5 * * * *',
  $cmd$ select public.disparar_tarefa_http('relatorios-agendados'); $cmd$
);
