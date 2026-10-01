-- Detector de estouro da regua de custo por conversa. Zero LLM.
--
-- DONO DA GRAVACAO: esta funcao so le. O job (modo correcao_custo) faz o upsert em
-- planos_de_ajuste_de_custo, chave nivel:alvo:metrica, atualizando aberto/proposto
-- em vez de inserir outra linha. Assim o detector continua puro e reexecutavel.
--
-- Constantes calibraveis: o bloco <!--constantes {...} --> do tema agent_knowledge
-- 'vigia_de_regua'. Sem o tema, valem os defaults do topo da funcao.
--
-- Abortar nao e lista vazia: a primeira linha vem com abortar=true quando o espelho
-- diario da Meta (tarefa espelho-meta-diario) nao esta fresco ou veio incompleto.
-- Alvo com menos de 3 dias de entrega, PAUSED ou base diferente de conversas nao sai.

insert into public.agent_knowledge (tema, descricao, conteudo, fonte, verificado_em, revalidar_ate)
values (
  'vigia_de_regua',
  'Pisos, margem, vazao e carencia do vigia de custo por conversa. O detector le o bloco constantes. Nao e prompt: a trava mora no codigo.',
  $vigia$<!--constantes {"min_conversas":10,"min_gasto":150,"margem":0.15,"vazao":3,"carencia_dias":3,"maturacao_dias":3} -->
# Vigia de regua de custo por conversa

Constantes iniciais, provisorias ate o gestor confirmar (30/09/2026):

- minimo de 10 conversas na janela de 7 dias
- minimo de R$ 150 de gasto da base na mesma janela
- margem de 15% acima da regua (centavo nao e estouro)
- no maximo 3 planos de acao por passe por empresa
- carencia de 3 dias entre intervencoes no mesmo alvo
- maturacao de 3 dias com entrega antes de julgar

A janela de 7 dias decide. A de 3 dias e tendencia. Peca nova so do acervo com aproveitavel=sim e aprovado pelo gestor. Linha de produto da COHAPM nao cruza.
$vigia$,
  'spec vigia de regua, 30/09/2026',
  current_date,
  current_date + 30
)
on conflict (tema) do update set
  descricao = excluded.descricao,
  conteudo = excluded.conteudo,
  fonte = excluded.fonte,
  verificado_em = excluded.verificado_em,
  revalidar_ate = excluded.revalidar_ate,
  updated_at = now();

create or replace function public.registrar_frescor_espelho_meta(
  p_completo boolean,
  p_detalhe jsonb default '{}'::jsonb)
returns void
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
begin
  update public.execucoes_agendadas e
     set detalhe = coalesce(e.detalhe, '{}'::jsonb) || jsonb_build_object(
           'espelho_completo', coalesce(p_completo, false),
           'espelho_detalhe', coalesce(p_detalhe, '{}'::jsonb),
           'espelho_carimbado_em', now())
   where e.id = (
     select id from public.execucoes_agendadas
      where tarefa = 'espelho-meta-diario'
        and iniciado_em > now() - interval '6 hours'
      order by iniciado_em desc
      limit 1);
end;
$function$;

revoke all on function public.registrar_frescor_espelho_meta(boolean, jsonb) from public, anon, authenticated;
grant execute on function public.registrar_frescor_espelho_meta(boolean, jsonb) to service_role;

create or replace function public.detectar_estouros_de_regua(
  p_company_id uuid default null,
  p_janela_dias int default 7)
returns setof jsonb
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  -- Defaults. O tema vigia_de_regua sobrescreve quando o bloco constantes parseia.
  v_min_conversas int := 10;
  v_min_gasto numeric := 150;
  v_margem numeric := 0.15;
  v_carencia int := 3;
  v_maturacao int := 3;
  v_janela int := greatest(1, least(coalesce(p_janela_dias, 7), 30));
  v_fim date := current_date - 1;
  v_ini date;
  v_ini3 date;
  v_const jsonb;
  v_exec record;
  v_motivo text;
begin
  begin
    select substring(conteudo from '<!--constantes (\{.*\}) -->')::jsonb
      into v_const
      from public.agent_knowledge
     where tema = 'vigia_de_regua' and vigente
     limit 1;
    if v_const is not null then
      v_min_conversas := coalesce((v_const->>'min_conversas')::int, v_min_conversas);
      v_min_gasto := coalesce((v_const->>'min_gasto')::numeric, v_min_gasto);
      v_margem := coalesce((v_const->>'margem')::numeric, v_margem);
      v_carencia := coalesce((v_const->>'carencia_dias')::int, v_carencia);
      v_maturacao := coalesce((v_const->>'maturacao_dias')::int, v_maturacao);
    end if;
  exception when others then
    null;
  end;

  v_ini := v_fim - (v_janela - 1);
  v_ini3 := v_fim - 2;

  select e.desfecho, e.finalizado_em, e.detalhe
    into v_exec
    from public.execucoes_agendadas e
   where e.tarefa = 'espelho-meta-diario'
   order by e.iniciado_em desc
   limit 1;

  v_motivo := case
    when v_exec.desfecho is null then 'espelho_meta_sem_corrida'
    when v_exec.desfecho not in ('sucesso', 'sucesso_vazio') then 'espelho_meta_ultima_corrida_' || v_exec.desfecho
    when v_exec.finalizado_em is null or v_exec.finalizado_em < now() - interval '36 hours' then 'espelho_meta_sem_frescor'
    when v_exec.detalhe->>'espelho_completo' = 'false' then 'espelho_meta_incompleto'
    else null
  end;

  if v_motivo is not null then
    return next jsonb_build_object(
      'abortar', true,
      'acionavel', false,
      'motivo', v_motivo,
      'desfecho', v_exec.desfecho,
      'finalizado_em', v_exec.finalizado_em,
      'espelho_completo', v_exec.detalhe->>'espelho_completo');
    return;
  end if;

  return query
  with ads_ok as (
    select distinct on (a.company_id, a.external_id)
      a.company_id,
      a.external_id,
      a.name as alvo_nome,
      a.adset_external_id as conjunto_external_id,
      s.name as conjunto_nome,
      c.external_id as campanha_external_id,
      c.name as campanha_nome,
      public.linha_de_produto_do_nome(c.name, c.company_id) as marca
    from public.ads a
    join public.campaigns c on c.id = a.campaign_id
    join public.ad_sets s
      on s.external_id = a.adset_external_id
     and s.company_id = a.company_id
    where (p_company_id is null or a.company_id = p_company_id)
      and c.provider = 'meta_ads'
      and public.base_de_resultado_da_campanha(c.id) = 'conversas'
      and public.status_objeto_operacional(c.status)
      and public.status_objeto_operacional(s.status)
      and public.status_objeto_operacional(a.status)
      and upper(btrim(coalesce(c.status, ''))) not like '%PAUSED%'
      and upper(btrim(coalesce(s.status, ''))) not like '%PAUSED%'
      and upper(btrim(coalesce(a.status, ''))) not like '%PAUSED%'
      and exists (
        select 1 from public.metas_de_negocio m
         where m.company_id = a.company_id
           and m.vigente and m.tipo = 'gate'
           and m.metric = 'custo_por_conversa')
    order by a.company_id, a.external_id
  ),
  med as (
    select
      k.company_id, k.external_id, k.alvo_nome, k.conjunto_external_id, k.conjunto_nome,
      k.campanha_external_id, k.campanha_nome, k.marca,
      coalesce(sum(s.spend) filter (where s.snapshot_date between v_ini and v_fim), 0) as gasto7,
      coalesce(sum(s.messaging_started) filter (where s.snapshot_date between v_ini and v_fim), 0) as msgs7,
      coalesce(sum(s.form_leads) filter (where s.snapshot_date between v_ini and v_fim), 0) as forms7,
      coalesce(sum(s.link_clicks) filter (where s.snapshot_date between v_ini and v_fim), 0) as links7,
      count(distinct s.snapshot_date) filter (
        where s.snapshot_date between v_ini and v_fim and coalesce(s.spend, 0) > 0) as dias7,
      coalesce(sum(s.spend) filter (where s.snapshot_date between v_ini3 and v_fim), 0) as gasto3,
      coalesce(sum(s.messaging_started) filter (where s.snapshot_date between v_ini3 and v_fim), 0) as msgs3,
      coalesce(sum(s.form_leads) filter (where s.snapshot_date between v_ini3 and v_fim), 0) as forms3,
      coalesce(sum(s.link_clicks) filter (where s.snapshot_date between v_ini3 and v_fim), 0) as links3
    from ads_ok k
    left join public.ad_metric_snapshots s
      on s.company_id = k.company_id and s.ad_external_id = k.external_id
    group by k.company_id, k.external_id, k.alvo_nome, k.conjunto_external_id, k.conjunto_nome,
             k.campanha_external_id, k.campanha_nome, k.marca
  ),
  custo_ad as (
    select
      m.*,
      public.custo_por_resultado(m.gasto7, m.forms7, m.msgs7, 'conversas', m.links7) as custo7,
      public.custo_por_resultado(m.gasto3, m.forms3, m.msgs3, 'conversas', m.links3) as custo3,
      public.teto_vigente_da_marca(m.company_id, 'custo_por_conversa', m.marca) as tv
    from med m
  ),
  ent as (
    select company_id, conjunto_external_id,
           count(*) filter (where gasto7 > 0)::int as entregando
    from custo_ad
    group by 1, 2
  ),
  car as (
    select p.company_id, p.alvo_external_id,
           max(greatest(
             p.proposto_em::date + v_carencia,
             coalesce(p.data_de_leitura, p.proposto_em::date + v_carencia))) as ate
    from public.planos_de_ajuste_de_custo p
    where p.proposto_em is not null
      and p.status in ('proposto', 'verificado_ok', 'verificado_sem_efeito')
    group by 1, 2
  ),
  nivel_anuncio as (
    select
      ca.company_id,
      ca.conjunto_external_id,
      ca.custo7,
      ca.gasto7,
      (
        coalesce(ca.tv->>'governa', '') = 'meta_de_negocio'
        and ca.custo7 is not null
        and ca.msgs7 >= v_min_conversas
        and ca.gasto7 >= v_min_gasto
        and coalesce((ca.tv->>'teto_que_governa')::numeric, 0) > 0
        and ca.custo7 > (ca.tv->>'teto_que_governa')::numeric * (1 + v_margem)
        and (cr.ate is null or cr.ate <= current_date)
      ) as acionavel,
      jsonb_build_object(
        'abortar', false,
        'tipo', case when coalesce(ca.tv->>'governa', '') = 'meta_de_negocio' then 'estouro' else 'lacuna' end,
        'acionavel', (
          coalesce(ca.tv->>'governa', '') = 'meta_de_negocio'
          and ca.custo7 is not null
          and ca.msgs7 >= v_min_conversas
          and ca.gasto7 >= v_min_gasto
          and coalesce((ca.tv->>'teto_que_governa')::numeric, 0) > 0
          and ca.custo7 > (ca.tv->>'teto_que_governa')::numeric * (1 + v_margem)
          and (cr.ate is null or cr.ate <= current_date)
        ),
        'company_id', ca.company_id,
        'nivel', 'anuncio',
        'alvo_external_id', ca.external_id,
        'alvo_nome', ca.alvo_nome,
        'campanha_external_id', ca.campanha_external_id,
        'campanha_nome', ca.campanha_nome,
        'conjunto_external_id', ca.conjunto_external_id,
        'conjunto_nome', ca.conjunto_nome,
        'marca', ca.marca,
        'metrica', 'custo_por_conversa',
        'base_declarada', 'conversas',
        'regua_valor', (ca.tv->>'teto_que_governa')::numeric,
        'regua_fonte', coalesce(ca.tv->>'governa', 'nenhum'),
        'regua_provisoria', ca.tv->'meta_de_negocio'->>'provisoria',
        'janela_dias', v_janela,
        'janela_inicio', v_ini,
        'janela_fim', v_fim,
        'gasto_da_base', round(ca.gasto7, 2),
        'resultados_da_base', ca.msgs7::int,
        'custo_observado', round(ca.custo7, 2),
        'custo_7d', round(ca.custo7, 2),
        'custo_3d', round(ca.custo3, 2),
        'dias_com_entrega', ca.dias7,
        'anuncios_entregando_no_conjunto', coalesce(en.entregando, 0),
        'carencia_ate', cr.ate,
        'direcoes_discordam', (
          ca.custo3 is not null and ca.custo7 is not null
          and (ca.tv->>'teto_que_governa') is not null
          and ((ca.custo3 > (ca.tv->>'teto_que_governa')::numeric) is distinct from
               (ca.custo7 > (ca.tv->>'teto_que_governa')::numeric))
        ),
        'janela_que_decidiu', '7d',
        'severidade', case
          when ca.custo7 is null or coalesce((ca.tv->>'teto_que_governa')::numeric, 0) <= 0 then 'baixa'
          when ca.custo7 >= (ca.tv->>'teto_que_governa')::numeric * 1.5 then 'alta'
          when ca.custo7 >= (ca.tv->>'teto_que_governa')::numeric * 1.25 then 'media'
          else 'baixa' end,
        'peso', case
          when ca.custo7 is null or coalesce((ca.tv->>'teto_que_governa')::numeric, 0) <= 0 then 0
          else round(((ca.custo7 / (ca.tv->>'teto_que_governa')::numeric) - 1) * ca.gasto7, 2) end,
        'chave_dedupe', 'anuncio:' || ca.external_id || ':custo_por_conversa',
        'cobertura', jsonb_build_object(
          'frescor_espelho', coalesce(v_exec.detalhe->>'espelho_completo', 'legado_sem_flag'),
          'forms7', ca.forms7, 'links7', ca.links7)
      ) as doc
    from custo_ad ca
    left join ent en
      on en.company_id = ca.company_id and en.conjunto_external_id = ca.conjunto_external_id
    left join car cr
      on cr.company_id = ca.company_id and cr.alvo_external_id = ca.external_id
    where ca.dias7 >= v_maturacao
      and (
        (coalesce(ca.tv->>'governa', '') <> 'meta_de_negocio' and ca.gasto7 > 0)
        or (
          coalesce(ca.tv->>'governa', '') = 'meta_de_negocio'
          and ca.custo7 is not null
          and ca.msgs7 >= v_min_conversas
          and ca.gasto7 >= v_min_gasto
          and ca.custo7 > (ca.tv->>'teto_que_governa')::numeric * (1 + v_margem)
        )
      )
  ),
  conj_med as (
    select
      company_id, conjunto_external_id,
      max(conjunto_nome) as conjunto_nome,
      max(campanha_external_id) as campanha_external_id,
      max(campanha_nome) as campanha_nome,
      max(marca) as marca,
      sum(gasto7) as gasto7, sum(msgs7) as msgs7, sum(forms7) as forms7, sum(links7) as links7,
      sum(gasto3) as gasto3, sum(msgs3) as msgs3, sum(forms3) as forms3, sum(links3) as links3
    from custo_ad
    where conjunto_external_id is not null
    group by company_id, conjunto_external_id
  ),
  dias_conj as (
    select a.company_id, a.conjunto_external_id,
           count(distinct s.snapshot_date)::int as dias7
    from ads_ok a
    join public.ad_metric_snapshots s
      on s.company_id = a.company_id and s.ad_external_id = a.external_id
     and s.snapshot_date between v_ini and v_fim and coalesce(s.spend, 0) > 0
    group by 1, 2
  ),
  nivel_conjunto as (
    select
      cm.company_id,
      cm.conjunto_external_id,
      public.custo_por_resultado(cm.gasto7, cm.forms7, cm.msgs7, 'conversas', cm.links7) as custo7,
      cm.gasto7,
      false as acionavel,
      jsonb_build_object(
        'abortar', false,
        'tipo', case when coalesce(tv.tv->>'governa', '') = 'meta_de_negocio' then 'estouro' else 'lacuna' end,
        'acionavel', (
          coalesce(tv.tv->>'governa', '') = 'meta_de_negocio'
          and public.custo_por_resultado(cm.gasto7, cm.forms7, cm.msgs7, 'conversas', cm.links7) is not null
          and cm.msgs7 >= v_min_conversas
          and cm.gasto7 >= v_min_gasto
          and coalesce((tv.tv->>'teto_que_governa')::numeric, 0) > 0
          and public.custo_por_resultado(cm.gasto7, cm.forms7, cm.msgs7, 'conversas', cm.links7)
              > (tv.tv->>'teto_que_governa')::numeric * (1 + v_margem)
          and (cr.ate is null or cr.ate <= current_date)
        ),
        'company_id', cm.company_id,
        'nivel', 'conjunto',
        'alvo_external_id', cm.conjunto_external_id,
        'alvo_nome', cm.conjunto_nome,
        'campanha_external_id', cm.campanha_external_id,
        'campanha_nome', cm.campanha_nome,
        'conjunto_external_id', cm.conjunto_external_id,
        'conjunto_nome', cm.conjunto_nome,
        'marca', cm.marca,
        'metrica', 'custo_por_conversa',
        'base_declarada', 'conversas',
        'regua_valor', (tv.tv->>'teto_que_governa')::numeric,
        'regua_fonte', coalesce(tv.tv->>'governa', 'nenhum'),
        'regua_provisoria', tv.tv->'meta_de_negocio'->>'provisoria',
        'janela_dias', v_janela,
        'janela_inicio', v_ini,
        'janela_fim', v_fim,
        'gasto_da_base', round(cm.gasto7, 2),
        'resultados_da_base', cm.msgs7::int,
        'custo_observado', round(public.custo_por_resultado(cm.gasto7, cm.forms7, cm.msgs7, 'conversas', cm.links7), 2),
        'custo_7d', round(public.custo_por_resultado(cm.gasto7, cm.forms7, cm.msgs7, 'conversas', cm.links7), 2),
        'custo_3d', round(public.custo_por_resultado(cm.gasto3, cm.forms3, cm.msgs3, 'conversas', cm.links3), 2),
        'dias_com_entrega', coalesce(dc.dias7, 0),
        'anuncios_entregando_no_conjunto', coalesce(en.entregando, 0),
        'carencia_ate', cr.ate,
        'direcoes_discordam', (
          public.custo_por_resultado(cm.gasto3, cm.forms3, cm.msgs3, 'conversas', cm.links3) is not null
          and public.custo_por_resultado(cm.gasto7, cm.forms7, cm.msgs7, 'conversas', cm.links7) is not null
          and (tv.tv->>'teto_que_governa') is not null
          and (
            (public.custo_por_resultado(cm.gasto3, cm.forms3, cm.msgs3, 'conversas', cm.links3)
              > (tv.tv->>'teto_que_governa')::numeric)
            is distinct from
            (public.custo_por_resultado(cm.gasto7, cm.forms7, cm.msgs7, 'conversas', cm.links7)
              > (tv.tv->>'teto_que_governa')::numeric)
          )
        ),
        'janela_que_decidiu', '7d',
        'severidade', case
          when public.custo_por_resultado(cm.gasto7, cm.forms7, cm.msgs7, 'conversas', cm.links7) is null
            or coalesce((tv.tv->>'teto_que_governa')::numeric, 0) <= 0 then 'baixa'
          when public.custo_por_resultado(cm.gasto7, cm.forms7, cm.msgs7, 'conversas', cm.links7)
            >= (tv.tv->>'teto_que_governa')::numeric * 1.5 then 'alta'
          when public.custo_por_resultado(cm.gasto7, cm.forms7, cm.msgs7, 'conversas', cm.links7)
            >= (tv.tv->>'teto_que_governa')::numeric * 1.25 then 'media'
          else 'baixa' end,
        'peso', case
          when public.custo_por_resultado(cm.gasto7, cm.forms7, cm.msgs7, 'conversas', cm.links7) is null
            or coalesce((tv.tv->>'teto_que_governa')::numeric, 0) <= 0 then 0
          else round((
            (public.custo_por_resultado(cm.gasto7, cm.forms7, cm.msgs7, 'conversas', cm.links7)
              / (tv.tv->>'teto_que_governa')::numeric) - 1) * cm.gasto7, 2) end,
        'chave_dedupe', 'conjunto:' || cm.conjunto_external_id || ':custo_por_conversa',
        'cobertura', jsonb_build_object('frescor_espelho', coalesce(v_exec.detalhe->>'espelho_completo', 'legado_sem_flag'))
      ) as doc
    from conj_med cm
    left join dias_conj dc
      on dc.company_id = cm.company_id and dc.conjunto_external_id = cm.conjunto_external_id
    left join ent en
      on en.company_id = cm.company_id and en.conjunto_external_id = cm.conjunto_external_id
    left join car cr
      on cr.company_id = cm.company_id and cr.alvo_external_id = cm.conjunto_external_id
    cross join lateral (
      select public.teto_vigente_da_marca(cm.company_id, 'custo_por_conversa', cm.marca) as tv
    ) tv
    where coalesce(dc.dias7, 0) >= v_maturacao
      and (
        (coalesce(tv.tv->>'governa', '') <> 'meta_de_negocio' and cm.gasto7 > 0)
        or (
          coalesce(tv.tv->>'governa', '') = 'meta_de_negocio'
          and public.custo_por_resultado(cm.gasto7, cm.forms7, cm.msgs7, 'conversas', cm.links7) is not null
          and cm.msgs7 >= v_min_conversas
          and cm.gasto7 >= v_min_gasto
          and public.custo_por_resultado(cm.gasto7, cm.forms7, cm.msgs7, 'conversas', cm.links7)
              > (tv.tv->>'teto_que_governa')::numeric * (1 + v_margem)
        )
      )
  ),
  camp_med as (
    select
      company_id, campanha_external_id,
      max(campanha_nome) as campanha_nome,
      max(marca) as marca,
      sum(gasto7) as gasto7, sum(msgs7) as msgs7, sum(forms7) as forms7, sum(links7) as links7,
      sum(gasto3) as gasto3, sum(msgs3) as msgs3, sum(forms3) as forms3, sum(links3) as links3
    from custo_ad
    where campanha_external_id is not null
    group by company_id, campanha_external_id
  ),
  dias_camp as (
    select a.company_id, a.campanha_external_id,
           count(distinct s.snapshot_date)::int as dias7
    from ads_ok a
    join public.ad_metric_snapshots s
      on s.company_id = a.company_id and s.ad_external_id = a.external_id
     and s.snapshot_date between v_ini and v_fim and coalesce(s.spend, 0) > 0
    group by 1, 2
  ),
  nivel_campanha as (
    select
      cm.company_id,
      null::text as conjunto_external_id,
      public.custo_por_resultado(cm.gasto7, cm.forms7, cm.msgs7, 'conversas', cm.links7) as custo7,
      cm.gasto7,
      false as acionavel,
      jsonb_build_object(
        'abortar', false,
        'tipo', case when coalesce(tv.tv->>'governa', '') = 'meta_de_negocio' then 'estouro' else 'lacuna' end,
        'acionavel', (
          coalesce(tv.tv->>'governa', '') = 'meta_de_negocio'
          and public.custo_por_resultado(cm.gasto7, cm.forms7, cm.msgs7, 'conversas', cm.links7) is not null
          and cm.msgs7 >= v_min_conversas
          and cm.gasto7 >= v_min_gasto
          and coalesce((tv.tv->>'teto_que_governa')::numeric, 0) > 0
          and public.custo_por_resultado(cm.gasto7, cm.forms7, cm.msgs7, 'conversas', cm.links7)
              > (tv.tv->>'teto_que_governa')::numeric * (1 + v_margem)
          and (cr.ate is null or cr.ate <= current_date)
        ),
        'company_id', cm.company_id,
        'nivel', 'campanha',
        'alvo_external_id', cm.campanha_external_id,
        'alvo_nome', cm.campanha_nome,
        'campanha_external_id', cm.campanha_external_id,
        'campanha_nome', cm.campanha_nome,
        'conjunto_external_id', null,
        'conjunto_nome', null,
        'marca', cm.marca,
        'metrica', 'custo_por_conversa',
        'base_declarada', 'conversas',
        'regua_valor', (tv.tv->>'teto_que_governa')::numeric,
        'regua_fonte', coalesce(tv.tv->>'governa', 'nenhum'),
        'regua_provisoria', tv.tv->'meta_de_negocio'->>'provisoria',
        'janela_dias', v_janela,
        'janela_inicio', v_ini,
        'janela_fim', v_fim,
        'gasto_da_base', round(cm.gasto7, 2),
        'resultados_da_base', cm.msgs7::int,
        'custo_observado', round(public.custo_por_resultado(cm.gasto7, cm.forms7, cm.msgs7, 'conversas', cm.links7), 2),
        'custo_7d', round(public.custo_por_resultado(cm.gasto7, cm.forms7, cm.msgs7, 'conversas', cm.links7), 2),
        'custo_3d', round(public.custo_por_resultado(cm.gasto3, cm.forms3, cm.msgs3, 'conversas', cm.links3), 2),
        'dias_com_entrega', coalesce(dc.dias7, 0),
        'anuncios_entregando_no_conjunto', null,
        'carencia_ate', cr.ate,
        'direcoes_discordam', (
          public.custo_por_resultado(cm.gasto3, cm.forms3, cm.msgs3, 'conversas', cm.links3) is not null
          and public.custo_por_resultado(cm.gasto7, cm.forms7, cm.msgs7, 'conversas', cm.links7) is not null
          and (tv.tv->>'teto_que_governa') is not null
          and (
            (public.custo_por_resultado(cm.gasto3, cm.forms3, cm.msgs3, 'conversas', cm.links3)
              > (tv.tv->>'teto_que_governa')::numeric)
            is distinct from
            (public.custo_por_resultado(cm.gasto7, cm.forms7, cm.msgs7, 'conversas', cm.links7)
              > (tv.tv->>'teto_que_governa')::numeric)
          )
        ),
        'janela_que_decidiu', '7d',
        'severidade', case
          when public.custo_por_resultado(cm.gasto7, cm.forms7, cm.msgs7, 'conversas', cm.links7) is null
            or coalesce((tv.tv->>'teto_que_governa')::numeric, 0) <= 0 then 'baixa'
          when public.custo_por_resultado(cm.gasto7, cm.forms7, cm.msgs7, 'conversas', cm.links7)
            >= (tv.tv->>'teto_que_governa')::numeric * 1.5 then 'alta'
          when public.custo_por_resultado(cm.gasto7, cm.forms7, cm.msgs7, 'conversas', cm.links7)
            >= (tv.tv->>'teto_que_governa')::numeric * 1.25 then 'media'
          else 'baixa' end,
        'peso', case
          when public.custo_por_resultado(cm.gasto7, cm.forms7, cm.msgs7, 'conversas', cm.links7) is null
            or coalesce((tv.tv->>'teto_que_governa')::numeric, 0) <= 0 then 0
          else round((
            (public.custo_por_resultado(cm.gasto7, cm.forms7, cm.msgs7, 'conversas', cm.links7)
              / (tv.tv->>'teto_que_governa')::numeric) - 1) * cm.gasto7, 2) end,
        'chave_dedupe', 'campanha:' || cm.campanha_external_id || ':custo_por_conversa',
        'cobertura', jsonb_build_object('frescor_espelho', coalesce(v_exec.detalhe->>'espelho_completo', 'legado_sem_flag'))
      ) as doc
    from camp_med cm
    left join dias_camp dc
      on dc.company_id = cm.company_id and dc.campanha_external_id = cm.campanha_external_id
    left join car cr
      on cr.company_id = cm.company_id and cr.alvo_external_id = cm.campanha_external_id
    cross join lateral (
      select public.teto_vigente_da_marca(cm.company_id, 'custo_por_conversa', cm.marca) as tv
    ) tv
    where coalesce(dc.dias7, 0) >= v_maturacao
      and (
        (coalesce(tv.tv->>'governa', '') <> 'meta_de_negocio' and cm.gasto7 > 0)
        or (
          coalesce(tv.tv->>'governa', '') = 'meta_de_negocio'
          and public.custo_por_resultado(cm.gasto7, cm.forms7, cm.msgs7, 'conversas', cm.links7) is not null
          and cm.msgs7 >= v_min_conversas
          and cm.gasto7 >= v_min_gasto
          and public.custo_por_resultado(cm.gasto7, cm.forms7, cm.msgs7, 'conversas', cm.links7)
              > (tv.tv->>'teto_que_governa')::numeric * (1 + v_margem)
        )
      )
  ),
  tudo as (
    select company_id, conjunto_external_id, custo7, gasto7, acionavel, doc from nivel_anuncio
    union all
    select company_id, conjunto_external_id, custo7, gasto7, (doc->>'acionavel')::boolean, doc from nivel_conjunto
    union all
    select company_id, conjunto_external_id, custo7, gasto7, (doc->>'acionavel')::boolean, doc from nivel_campanha
  )
  select t.doc
  from tudo t
  where not (
    t.doc->>'nivel' = 'conjunto'
    and exists (
      select 1 from tudo a
       where a.doc->>'nivel' = 'anuncio'
         and a.doc->>'acionavel' = 'true'
         and a.doc->>'company_id' = t.doc->>'company_id'
         and a.doc->>'conjunto_external_id' = t.doc->>'conjunto_external_id'
    )
  );
end;
$function$;

comment on function public.detectar_estouros_de_regua(uuid, int) is
  'Le estouros de custo por conversa contra a regua da marca. Nao grava. Abortar=true quando o espelho diario da Meta nao esta fresco ou completo. Imature (<3 dias), PAUSED e base diferente de conversas nao saem. O job faz o upsert.';

revoke all on function public.detectar_estouros_de_regua(uuid, int) from public, anon, authenticated;
grant execute on function public.detectar_estouros_de_regua(uuid, int) to service_role;
