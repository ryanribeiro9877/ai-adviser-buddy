-- ESPELHO DE MIGRACAO APLICADA
-- version: 20260812205546
-- name: esp34_perfil_vencedor_versionado
-- projeto: gzjwnjdpxpbmdhcyefvs (Gestor de Trafego IA)
-- aplicada por: Claude via MCP apply_migration
-- espelho gerado a partir de supabase_migrations.schema_migrations - NAO transcrito a mao

-- ESP-34: extrair e VERSIONAR o perfil do vencedor por empresa.
create table if not exists public.perfil_vencedor_versoes (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  versao integer not null,
  computado_em timestamptz not null default now(),
  janela_dias integer not null default 7,
  total_vencedores integer not null default 0,
  criterio jsonb not null default '{}'::jsonb,
  vencedores jsonb not null default '[]'::jsonb,
  padroes jsonb not null default '{}'::jsonb,
  procedencia jsonb not null default '{}'::jsonb,
  lacunas jsonb not null default '[]'::jsonb,
  constraint perfil_vencedor_versao_unica unique (company_id, versao)
);
create index if not exists idx_perfil_vencedor_company_computado
  on public.perfil_vencedor_versoes (company_id, computado_em desc);

alter table public.perfil_vencedor_versoes enable row level security;
drop policy if exists perfil_vencedor_leitura on public.perfil_vencedor_versoes;
create policy perfil_vencedor_leitura on public.perfil_vencedor_versoes
  for select to authenticated using (public.is_company_member(company_id, auth.uid()));

create or replace function public.computar_perfil_vencedor(
  p_company_id uuid,
  p_dias integer default 7,
  p_forcar boolean default false
) returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_dias integer := greatest(coalesce(p_dias, 7), 1);
  v_vencedores jsonb;
  v_padroes jsonb;
  v_criterio jsonb;
  v_lacunas jsonb;
  v_n int;
  v_versao int;
  v_hash text;
  v_ultima_hash text;
  v_ultima_versao int;
  v_ultima_dia date;
begin
  if p_company_id is null then
    return jsonb_build_object(
      'erro', 'company_id_obrigatorio',
      'motivo', 'computar_perfil_vencedor exige a empresa da conversa.'
    );
  end if;

  with base as (
    select s.ad_external_id,
           max(a.name) as ad_name, max(c.name) as camp_name, max(c.category) as category,
           max(coalesce(a.object_type,'')) as object_type,
           max(coalesce(a.call_to_action_type,'')) as cta,
           max(coalesce(a.title,'')) as ad_title,
           sum(s.spend) as spend7,
           sum(case when c.category = 'mensagem' then s.messaging_started else s.form_leads end) as results7
    from public.ad_metric_snapshots s
    join public.ads a on a.external_id = s.ad_external_id
    join public.campaigns c on c.id = a.campaign_id
    where c.company_id = p_company_id
      and c.status = 'active'
      and coalesce(c.category,'') in ('leadgen','mensagem')
      and upper(coalesce(a.status,'ACTIVE')) in ('ACTIVE','ADSET_PAUSED_OVERRIDE')
      and s.snapshot_date >= current_date - v_dias
    group by s.ad_external_id
  ), scored as (
    select b.*, round(b.spend7 / b.results7, 2) as custo7,
           (t.r->>'teto_que_governa')::numeric as teto,
           case when b.category = 'mensagem' then 'custo/conversa' else 'custo/formulário' end as metric_label,
           case when t.r->>'governa' = 'meta_de_negocio'
                then 'régua de negócio de ' || coalesce(t.r->'meta_de_negocio'->>'decidido_por','gestor')
                     || ', ' || to_char((t.r->'meta_de_negocio'->>'decidido_em')::date,'DD/MM/YYYY')
                else 'teto histórico do próprio desempenho' end as regua_label,
           round(100 * (1 - (b.spend7 / b.results7) / (t.r->>'teto_que_governa')::numeric)) as economia_pct
    from base b
    cross join lateral (
      select public.teto_vigente(
               p_company_id,
               case when b.category = 'mensagem' then 'custo_por_conversa' else 'custo_por_formulario' end
             ) as r
    ) t
    where b.results7 >= 30 and b.spend7 >= 30
      and (t.r->>'teto_que_governa') is not null
      and (b.spend7 / b.results7) <= (t.r->>'teto_que_governa')::numeric * 0.80
  ), enriched as (
    select sc.*, dl.drive_file_id, dl.peca_nome, dl.produto
    from scored sc
    left join lateral (
      select ar.payload->>'drive_file_id' as drive_file_id,
             da.nome as peca_nome, da.produto_detectado as produto
      from public.approval_requests ar
      left join lateral (
        select d2.nome, d2.produto_detectado
        from public.drive_midia_analises d2
        where d2.company_id = p_company_id
          and d2.drive_file_id = ar.payload->>'drive_file_id'
        order by d2.analisado_em desc nulls last
        limit 1
      ) da on true
      where ar.company_id = p_company_id
        and ar.action = 'criar_anuncio_a_partir_de'
        and ar.executed_at is not null
        and (ar.execution_result->>'id_criado') = sc.ad_external_id
        and nullif(ar.payload->>'drive_file_id','') is not null
      order by ar.executed_at desc
      limit 1
    ) dl on true
  )
  select
    coalesce(jsonb_agg(jsonb_build_object(
      'ad_external_id', ad_external_id,
      'ad_name', ad_name,
      'campanha', camp_name,
      'categoria', category,
      'metric_label', metric_label,
      'custo', custo7,
      'teto', teto,
      'economia_pct', economia_pct,
      'regua', regua_label,
      'formato', nullif(object_type,''),
      'cta', nullif(cta,''),
      'titulo', nullif(ad_title,''),
      'resultados', results7,
      'gasto', round(spend7::numeric, 2),
      'drive_file_id', drive_file_id,
      'peca_nome', peca_nome,
      'produto', produto
    ) order by economia_pct desc nulls last), '[]'::jsonb),
    count(*)
  into v_vencedores, v_n
  from enriched;

  v_padroes := jsonb_build_object(
    'por_formato', coalesce((
      select jsonb_object_agg(k, c) from (
        select coalesce(x->>'formato','(sem registro)') as k, count(*) as c
        from jsonb_array_elements(v_vencedores) x group by 1
      ) q), '{}'::jsonb),
    'por_cta', coalesce((
      select jsonb_object_agg(k, c) from (
        select coalesce(x->>'cta','(sem registro)') as k, count(*) as c
        from jsonb_array_elements(v_vencedores) x group by 1
      ) q), '{}'::jsonb),
    'por_produto', coalesce((
      select jsonb_object_agg(k, c) from (
        select coalesce(x->>'produto','(indeterminado)') as k, count(*) as c
        from jsonb_array_elements(v_vencedores) x group by 1
      ) q), '{}'::jsonb),
    'com_peca_de_origem', coalesce((
      select count(*) from jsonb_array_elements(v_vencedores) x
      where nullif(x->>'drive_file_id','') is not null
    ), 0)
  );

  v_criterio := jsonb_build_object(
    'janela_dias', v_dias,
    'significancia_minima', jsonb_build_object('resultados', 30, 'gasto', 30),
    'limiar_vencedor', 'custo <= teto_vigente * 0.80',
    'metricas', jsonb_build_object(
      'leadgen', 'form_leads / custo_por_formulario',
      'mensagem', 'messaging_started / custo_por_conversa'
    ),
    'fonte_teto', 'teto_vigente()',
    'observacao', 'Mesma logica de evaluate_winners (ESP-01), escopo por empresa.'
  );

  v_lacunas := jsonb_build_array(
    'Vencedor sem card criar_anuncio_a_partir_de fica sem drive_file_id/peca (orfao de origem).',
    'Janela curta: se o coletor de metricas atrasar, um vencedor real pode nao aparecer.',
    'Perfil descreve o passado da janela; nao garante repeticao futura. Confirme antes de escalar (ESP-39: vencedor mora em ESCALA).'
  );

  select coalesce(string_agg(x->>'ad_external_id', ',' order by x->>'ad_external_id'), '(vazio)')
    into v_hash
    from jsonb_array_elements(v_vencedores) x;

  select versao, computado_em::date, procedencia->>'hash_vencedores'
    into v_ultima_versao, v_ultima_dia, v_ultima_hash
    from public.perfil_vencedor_versoes
   where company_id = p_company_id
   order by versao desc
   limit 1;

  if not p_forcar
     and v_ultima_versao is not null
     and v_ultima_dia = current_date
     and v_ultima_hash = v_hash then
    return jsonb_build_object(
      'ok', true, 'pulado', true,
      'motivo', 'perfil identico ja computado hoje (use p_forcar=true para regravar).',
      'versao', v_ultima_versao, 'total', v_n
    );
  end if;

  v_versao := coalesce(v_ultima_versao, 0) + 1;

  insert into public.perfil_vencedor_versoes
    (company_id, versao, janela_dias, total_vencedores, criterio, vencedores, padroes, procedencia, lacunas)
  values (
    p_company_id, v_versao, v_dias, v_n, v_criterio, v_vencedores, v_padroes,
    jsonb_build_object(
      'fontes', jsonb_build_array(
        'evaluate_winners_logic(ESP-01)', 'teto_vigente',
        'approval_requests(criar_anuncio_a_partir_de)', 'drive_midia_analises(ESP-33)'
      ),
      'hash_vencedores', v_hash,
      'gerado_por', 'computar_perfil_vencedor'
    ),
    v_lacunas
  );

  return jsonb_build_object(
    'ok', true,
    'versao', v_versao,
    'computado_em', now(),
    'janela_dias', v_dias,
    'total', v_n,
    'vencedores', v_vencedores,
    'padroes', v_padroes,
    'criterio', v_criterio,
    'lacunas', v_lacunas,
    'nota', 'ESP-34: perfil versionado do vencedor por empresa. Nao substitui get_recommendations nem a aprovacao humana de escala. Vencedor deve viver em campanha ESCALA (ESP-39).'
  );
end $function$;

comment on function public.computar_perfil_vencedor(uuid, integer, boolean) is
  'ESP-34: computa e versiona o perfil do vencedor da empresa (logica evaluate_winners/ESP-01 + procedencia ESP-33). Dedup no mesmo dia salvo p_forcar.';

revoke all on function public.computar_perfil_vencedor(uuid, integer, boolean) from public, anon;
grant execute on function public.computar_perfil_vencedor(uuid, integer, boolean) to service_role;

create or replace function public.ler_perfil_vencedor(
  p_company_id uuid,
  p_versao integer default null
) returns jsonb
language plpgsql
stable
security definer
set search_path to 'public'
as $function$
declare
  v jsonb;
  v_hist int;
begin
  if p_company_id is null then
    return jsonb_build_object('erro', 'company_id_obrigatorio', 'motivo', 'ler_perfil_vencedor exige a empresa da conversa.');
  end if;

  select count(*) into v_hist
    from public.perfil_vencedor_versoes
   where company_id = p_company_id;

  select to_jsonb(t) into v
  from (
    select versao, computado_em, janela_dias, total_vencedores,
           criterio, vencedores, padroes, procedencia, lacunas
    from public.perfil_vencedor_versoes
    where company_id = p_company_id
      and (p_versao is null or versao = p_versao)
    order by versao desc
    limit 1
  ) t;

  if v is null then
    return jsonb_build_object(
      'ok', true, 'existe', false, 'historico_disponivel', v_hist,
      'motivo', 'nenhum perfil computado para a empresa (ou versao inexistente). Chame computar_perfil_vencedor.'
    );
  end if;

  return jsonb_build_object('ok', true, 'existe', true, 'historico_disponivel', v_hist, 'perfil', v);
end $function$;

comment on function public.ler_perfil_vencedor(uuid, integer) is
  'ESP-34: le a ultima versao (ou uma especifica) do perfil do vencedor da empresa.';

revoke all on function public.ler_perfil_vencedor(uuid, integer) from public, anon;
grant execute on function public.ler_perfil_vencedor(uuid, integer) to service_role;

insert into public.agent_context (categoria, fato, vigente, desde)
values (
  'doutrina',
  'PERFIL DO VENCEDOR VERSIONADO (ESP-34, 12/08/2026). computar_perfil_vencedor grava uma VERSAO por empresa do que esta vencendo (mesma regua de evaluate_winners/ESP-01: janela, >=30 resultados e >=30 gasto, custo <= teto_vigente*0,80) com procedencia da peca de origem (ESP-33) e lacunas. ler_perfil_vencedor le a ultima versao (ou uma especifica). NAO substitui get_recommendations (fila acionavel) nem a aprovacao humana; vencedor deve viver em campanha ESCALA (ESP-39). Amostra/janela curta = hipotese, nao prova.',
  true,
  date '2026-08-12'
);
