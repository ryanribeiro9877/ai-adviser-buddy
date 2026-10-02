-- Releitura depois da escrita, trava de configuracao e cron do plano.
-- Espelho: supabase/espelhos/20261002160000_releitura_e_conferencia_de_plano.sql

create table if not exists public.divergencias_meta (
  id uuid primary key default gen_random_uuid(),
  approval_id uuid,
  objeto_id text not null,
  campo text not null,
  valor_enviado jsonb,
  valor_gravado jsonb,
  veredito text not null check (veredito in ('igual', 'normalizado', 'divergente')),
  criado_em timestamptz not null default now()
);
create index if not exists idx_divergencias_meta_approval
  on public.divergencias_meta (approval_id, criado_em desc);
alter table public.divergencias_meta enable row level security;
drop policy if exists divergencias_meta_leitura on public.divergencias_meta;
create policy divergencias_meta_leitura on public.divergencias_meta
  for select to authenticated
  using (
    approval_id is null
    or exists (
      select 1 from public.approval_requests a
      where a.id = approval_id
        and public.is_company_member(a.company_id, auth.uid())
    )
  );

create or replace function public.saude_das_integracoes(
  p_company_id uuid,
  p_dias_tolerancia int default 3
)
returns jsonb
language plpgsql
stable
set search_path to 'public', 'pg_temp'
as $$
declare
  v jsonb;
  v_empresa text;
  v_master boolean;
  v_gestor text;
  v_template uuid;
  v_faltando text[] := array[]::text[];
begin
  if p_company_id is null then
    raise exception 'saude_das_integracoes exige p_company_id (leitura sem filtro de empresa e proibida neste projeto)';
  end if;

  with ev as (
    select
      i.account_name, i.external_id,
      i.status::text as status_afirmado,
      i.estado_operacional::text as estado_afirmado,
      (select count(*) from ads a where a.account_id = i.external_id and a.company_id = i.company_id) as ads,
      (select max(a.last_synced_at) from ads a where a.account_id = i.external_id and a.company_id = i.company_id) as ads_ultimo_sync,
      (select count(*) from ad_metric_snapshots s where s.account_id = i.external_id and s.company_id = i.company_id) as snapshots,
      (select max(s.snapshot_date) from ad_metric_snapshots s where s.account_id = i.external_id and s.company_id = i.company_id) as ultimo_dia_metrica,
      (select max(s.created_at) from ad_metric_snapshots s where s.account_id = i.external_id and s.company_id = i.company_id) as ultima_gravacao,
      (select count(*) from metric_breakdown_daily b where b.account_id = i.external_id and b.company_id = i.company_id) as breakdown
    from integrations i
    where i.company_id = p_company_id and i.provider = 'meta_ads'
  ),
  julgada as (
    select ev.*,
      (current_date - ultimo_dia_metrica) as dias_sem_metrica,
      extract(day from (now() - ultima_gravacao))::int as dias_sem_gravacao,
      (ultima_gravacao::date - ultimo_dia_metrica) as atraso_da_ultima_gravacao,
      case
        when external_id is null then 'sem_conta_atrelada'
        when ultima_gravacao is null or (snapshots = 0 and ads = 0) then 'nunca_recebeu'
        when (ultima_gravacao::date - ultimo_dia_metrica) > p_dias_tolerancia
          then 'conta_sem_entrega'
        when (now() - ultima_gravacao) > make_interval(days => p_dias_tolerancia)
          then 'coletor_sem_escrever'
        when (current_date - ultimo_dia_metrica) > p_dias_tolerancia
          then 'sem_entrega_recente'
        else 'viva'
      end as veredito
    from ev
  )
  select jsonb_build_object(
    'company_id', p_company_id,
    'dias_tolerancia', p_dias_tolerancia,
    'integracoes', (select count(*) from julgada),
    'por_veredito', coalesce((select jsonb_object_agg(veredito, n)
       from (select veredito, count(*) n from julgada group by 1) z), '{}'::jsonb),
    'contas', coalesce((
      select jsonb_agg(jsonb_build_object(
        'conta', account_name,
        'external_id', external_id,
        'veredito', veredito,
        'afirmado', jsonb_build_object('status', status_afirmado, 'estado_operacional', estado_afirmado),
        'evidencia', jsonb_build_object(
           'ads', ads, 'snapshots', snapshots, 'breakdown', breakdown,
           'ultimo_dia_de_metrica', ultimo_dia_metrica,
           'ultima_gravacao', ultima_gravacao,
           'atraso_da_ultima_gravacao_em_dias', atraso_da_ultima_gravacao,
           'ads_ultimo_sync', ads_ultimo_sync,
           'dias_sem_metrica', dias_sem_metrica,
           'dias_sem_gravacao', dias_sem_gravacao),
        'divergencia', case
           when estado_afirmado = 'ativa' and veredito = 'conta_sem_entrega'
             then 'DIVERGENCIA: marcada ATIVA e a conta nao entrega ha ' || dias_sem_metrica ||
                  ' dias. Isso e fato de MIDIA (conta parada), nao falha de coleta - a ultima gravacao ja veio ' ||
                  atraso_da_ultima_gravacao || ' dias atrasada, o que prova que o coletor rodou e nao havia o que trazer.'
           when estado_afirmado = 'ativa' and veredito <> 'viva'
             then 'DIVERGENCIA: marcada ATIVA e a evidencia diz ' || veredito || '. Marca e afirmacao; dado e medicao.'
           when status_afirmado = 'connected' and veredito = 'nunca_recebeu'
             then 'DIVERGENCIA: status diz CONNECTED e nunca chegou uma linha desta conta. Conectar nao foi verificado contra dado.'
           else null end
      ) order by
        case veredito when 'viva' then 0 when 'sem_entrega_recente' then 1
             when 'conta_sem_entrega' then 2 when 'coletor_sem_escrever' then 3
             when 'nunca_recebeu' then 4 else 5 end, account_name)
      from julgada), '[]'::jsonb),
    'nota', 'Tres relogios, de proposito: ultimo_dia_de_metrica = dia que a conta ENTREGOU; ultima_gravacao = quando o coletor ESCREVEU; atraso_da_ultima_gravacao = quantos dias a escrita ja estava atrasada quando ocorreu. E o terceiro que separa "a conta parou" de "o coletor parou". Empresa com master_enabled sem gestor_nome ou waba_template_id nao esta configurada.'
  ) into v;

  select c.name, m.master_enabled, nullif(btrim(m.gestor_nome), ''), m.waba_template_id
    into v_empresa, v_master, v_gestor, v_template
    from public.companies c
    left join public.meta_execution_config m on m.company_id = c.id
   where c.id = p_company_id;

  if v_master is true then
    if v_gestor is null then v_faltando := array_append(v_faltando, 'gestor_nome'); end if;
    if v_template is null then v_faltando := array_append(v_faltando, 'waba_template_id'); end if;
  end if;

  if cardinality(v_faltando) > 0 then
    v := v || jsonb_build_object(
      'configurada', false,
      'veredito_configuracao', 'reprovado',
      'faltando', to_jsonb(v_faltando),
      'mensagem', format(
        'Empresa %s esta ativa (master_enabled) e sem %s. Sem esses campos ela nao esta configurada.',
        coalesce(v_empresa, p_company_id::text),
        array_to_string(v_faltando, ' e ')
      )
    );
  else
    v := v || jsonb_build_object(
      'configurada', true,
      'veredito_configuracao', 'ok',
      'faltando', '[]'::jsonb,
      'mensagem', null
    );
  end if;

  return v;
end;
$$;

insert into public.mcp_api_keys (chamador, api_key, observacao)
select 'cron:conferir-planos',
       encode(sha256((gen_random_uuid()::text || clock_timestamp()::text || 'conferir-planos')::bytea), 'hex'),
       'Cron diario que confere planos vigentes contra a ficha ao vivo.'
on conflict (chamador) do nothing;

insert into public.tarefas_agendadas (
  tarefa, titulo, pergunta, tipo, edge, chave_chamador, modo_auth, corpo, timeout_ms,
  periodicidade, tolerancia_horas, tabela_destino, coluna_carimbo, natureza, motivo_natureza, ativa
) values (
  'conferir-planos',
  'Conferencia dos planos vigentes',
  'Alguma campanha com plano vigente esta diferente ou incompleta na conta?',
  'http',
  'traffic-agent-job',
  'cron:conferir-planos',
  'x-mcp-key',
  '{"modo":"conferir_planos"}'::jsonb,
  150000,
  'diaria',
  26,
  'alerts',
  'created_at',
  'reativa',
  'Dia sem diferenca entre plano e conta e o desfecho normal. Alerta so nasce quando ha campo diferente, ausente ou leitura que falhou.',
  true
)
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
  motivo_natureza = excluded.motivo_natureza,
  ativa = true;

select cron.unschedule(jobid) from cron.job where jobname = 'conferir-planos-1500';

select cron.schedule(
  'conferir-planos-1500',
  '0 15 * * *',
  $$select public.disparar_tarefa_http('conferir-planos')$$
);
