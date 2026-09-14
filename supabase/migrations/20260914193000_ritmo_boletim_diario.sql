-- Status diario da forca-tarefa Ritmo (14/09/2026)
--
-- POR QUE: a aba mostrava o plano congelado da analise e o status "em execucao",
-- sem o dia a dia da campanha nem o que os agentes fizeram. O gestor precisa de
-- um fechamento civil (18:30 America/Sao_Paulo) por missao.
--
-- O QUE NAO MEXE: portao SQL, tiques leve/fundo, fila de Aprovacoes, digest.
-- A serie ao vivo na UI le metric_snapshots + ritmo_atos; esta tabela congela
-- o texto das 18:30 para o dia nao ser reescrito pela coleta da manha seguinte.

create table public.ritmo_diarios (
  id uuid primary key default gen_random_uuid(),
  missao_id uuid not null references public.ritmo_missoes(id) on delete cascade,
  company_id uuid not null references public.companies(id) on delete cascade,
  data_civil date not null,
  fechado_em timestamptz not null default now(),
  numeros jsonb not null default '{}'::jsonb,
  atos jsonb not null default '[]'::jsonb,
  lacunas jsonb not null default '[]'::jsonb,
  narrativa text not null default '',
  criado_em timestamptz not null default now(),
  constraint ritmo_diarios_narrativa check (length(btrim(narrativa)) > 0),
  constraint ritmo_diarios_missao_dia unique (missao_id, data_civil)
);

comment on table public.ritmo_diarios is
  'Fechamento diario da forca-tarefa: o que a campanha apresentou e o que os agentes tentaram naquele dia civil (Brasilia).';
comment on column public.ritmo_diarios.data_civil is
  'Dia civil America/Sao_Paulo. Unique por missao: um fechamento por dia.';
comment on column public.ritmo_diarios.numeros is
  'DiaAndamento congelado no fechamento (gasto, metrica, acumulado, custo). A tabela da UI pode continuar lendo a coleta viva.';
comment on column public.ritmo_diarios.atos is
  'Atos da missao com data civil igual a data_civil, no momento do fechamento.';

create index ritmo_diarios_company_idx
  on public.ritmo_diarios (company_id, data_civil desc);

alter table public.ritmo_diarios replica identity full;

alter table public.ritmo_diarios enable row level security;

create policy ritmo_diarios_select on public.ritmo_diarios
  for select to authenticated
  using (
    public.is_company_member(company_id, (select auth.uid()))
    or public.has_role((select auth.uid()), 'admin'::app_role)
  );

revoke all on table public.ritmo_diarios from public, anon, authenticated;
grant select on table public.ritmo_diarios to authenticated;
grant all on table public.ritmo_diarios to service_role;

do $$
begin
  begin
    alter publication supabase_realtime add table public.ritmo_diarios;
  exception
    when duplicate_object then null;
  end;
end $$;

create or replace function public.listar_ritmo_boletins_devidos(p_limite integer)
returns table (id uuid, company_id uuid, campaign_id text)
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_hoje date := (now() at time zone 'America/Sao_Paulo')::date;
begin
  return query
    select m.id, m.company_id, m.campaign_id
      from public.ritmo_missoes m
     where m.periodo_inicio <= v_hoje
       and (
            m.status = 'em_execucao'
            or (
              m.status = 'encerrada'
              and coalesce(m.encerrada_em, m.atualizado_em) >= (v_hoje::timestamp at time zone 'America/Sao_Paulo')
              and coalesce(m.encerrada_em, m.atualizado_em) < ((v_hoje + 1)::timestamp at time zone 'America/Sao_Paulo')
            )
           )
     order by m.autonomia_concedida_em nulls last, m.criado_em
     limit greatest(coalesce(p_limite, 20), 1)
     for update of m skip locked;
end;
$$;

comment on function public.listar_ritmo_boletins_devidos(integer) is
  'Despachante das 18:30: missoes em execucao (prazo ja comecou) e as encerradas no dia civil de Brasilia. Service role. Upsert do boletim e idempotente.';

revoke all on function public.listar_ritmo_boletins_devidos(integer) from public, anon, authenticated;
grant execute on function public.listar_ritmo_boletins_devidos(integer) to service_role;

insert into public.tarefas_agendadas (
  tarefa, titulo, pergunta, tipo, edge, chave_chamador, modo_auth, corpo, timeout_ms,
  periodicidade, tolerancia_horas, tabela_destino, coluna_carimbo, natureza, motivo_natureza)
values (
  'ritmo-boletim-diario',
  'Fechamento diario da forca-tarefa',
  'Alguma forca-tarefa precisa do status das 18:30 agora?',
  'http', 'ritmo-executar', 'cron:ritmo-executar', 'x-mcp-key',
  '{"modo":"dispatcher_boletim"}'::jsonb, 120000,
  'diaria', 6, 'ritmo_diarios', 'fechado_em',
  'reativa',
  'Fechamento diario: nao ter missao em execucao (nem encerrada hoje) e o desfecho normal.')
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
  coluna_carimbo = excluded.coluna_carimbo,
  natureza = excluded.natureza,
  motivo_natureza = excluded.motivo_natureza;

select cron.unschedule(jobid)
  from cron.job
 where jobname = 'ritmo-boletim-diario';

-- 18:30 America/Sao_Paulo = 21:30 UTC (Brasil sem horario de verao desde 2019).
select cron.schedule(
  'ritmo-boletim-diario',
  '30 21 * * *',
  $cmd$ select public.disparar_tarefa_http('ritmo-boletim-diario'); $cmd$
);
