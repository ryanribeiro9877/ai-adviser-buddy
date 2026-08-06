-- ESPELHO DE MIGRACAO APLICADA
-- version: 20260805200805
-- name: esp03_nota_de_cobertura_derivada_e_export_sem_negacao_falsa
-- projeto: gzjwnjdpxpbmdhcyefvs (Gestor de Trafego IA)
-- aplicada por: Claude via MCP apply_migration
-- espelho gerado a partir de supabase_migrations.schema_migrations - NAO transcrito a mao

-- ESP-03 · pare de declarar cegueira que o sistema nao tem mais, e faca a declaracao DERIVAR.
--
-- O DEFEITO ENCONTRADO EM 05/08: o relatorio diario e o export afirmavam que o sistema "nao
-- coleta recorte por idade, genero ou posicionamento" e que nao tem "os tres rankings de
-- qualidade da Meta". As duas primeiras coisas passaram a existir com o GT-40/41/42 e ninguem
-- atualizou o texto. E a regra 13 ao contrario: mentir de HUMILDADE. O agente estava se
-- desculpando por uma limitacao vencida - e por isso o achado de idade nunca chegou ao gestor.
--
-- MEDIDO ANTES DE ESCREVER:
--   idade: 145 linhas, 7 faixas, 3 anuncios, 2 campanhas, 28/07 a 04/08 -> EXISTE
--   genero: 72 linhas, 3 valores, mesma janela -> EXISTE
--   rankings: 24 linhas coletadas desde 28/07, TODAS com valor UNKNOWN; 505 linhas anteriores
--             com NULO. Ou seja: coletamos e a META nao classifica (falta volume). A cegueira
--             mudou de dono, e UNKNOWN nao e NULO.
--   posicionamento: 0 linhas -> NAO EXISTE, a negacao continua verdadeira.
--
-- POR QUE UMA FUNCAO E NAO UMA STRING CORRIGIDA: string corrigida envelhece na proxima coleta
-- que entrar. Esta nota deriva do dado, entao ela se atualiza sozinha - mesma licao do GT-37
-- (default derivado, nunca literal).

create or replace function public.nota_de_cobertura(p_company_id uuid)
returns text
language plpgsql
stable
as $$
declare
  v_idade record; v_genero record; v_rank record; v_place int;
  v_tem text[] := '{}'; v_nao text[] := '{}'; v_ressalva text[] := '{}';
begin
  select count(*) n, count(distinct valor_recorte) valores, count(distinct ad_external_id) anuncios,
         min(snapshot_date) de, max(snapshot_date) ate
    into v_idade
    from public.metric_breakdown_daily
   where company_id = p_company_id and tipo_recorte = 'idade';

  select count(*) n, count(distinct valor_recorte) valores into v_genero
    from public.metric_breakdown_daily
   where company_id = p_company_id and tipo_recorte = 'genero';

  select count(*) filter (where quality_ranking is not null) coletadas,
         count(*) filter (where quality_ranking = 'UNKNOWN') desconhecidas
    into v_rank
    from public.ad_metric_snapshots where company_id = p_company_id;

  select count(*) into v_place from public.metric_breakdown_daily
   where company_id = p_company_id and tipo_recorte not in ('idade','genero');

  if coalesce(v_idade.n,0) > 0 then
    v_tem := array_append(v_tem, 'recorte por **idade** (' || v_idade.valores || ' faixas, '
      || v_idade.anuncios || ' anúncios, de ' || to_char(v_idade.de,'DD/MM') || ' a ' || to_char(v_idade.ate,'DD/MM') || ')');
    v_ressalva := array_append(v_ressalva,
      'faixa com menos de 50 formulários ou menos de R$ 300 de gasto na janela é ruído — não chame de "mais barata"');
    v_ressalva := array_append(v_ressalva,
      'em crédito é PROIBIDO segmentar por idade, gênero, CEP ou renda; o recorte serve para escolher ângulo e criativo, nunca público');
  else
    v_nao := array_append(v_nao, 'recorte por idade');
  end if;

  if coalesce(v_genero.n,0) > 0 then
    v_tem := array_append(v_tem, 'recorte por **gênero** (' || v_genero.valores || ' valores)');
  else
    v_nao := array_append(v_nao, 'recorte por gênero');
  end if;

  if coalesce(v_rank.coletadas,0) = 0 then
    v_nao := array_append(v_nao, 'os três rankings de qualidade da Meta (nunca coletados)');
  elsif v_rank.coletadas = v_rank.desconhecidas then
    v_ressalva := array_append(v_ressalva,
      'os rankings de qualidade da Meta **são coletados** (' || v_rank.coletadas
      || ' leituras), mas a plataforma devolveu "não classificado" em todas elas — falta volume no anúncio, não falta coleta nossa');
  else
    v_tem := array_append(v_tem, 'os rankings de qualidade da Meta (' || v_rank.coletadas || ' leituras)');
  end if;

  if v_place = 0 then
    v_nao := array_append(v_nao, 'recorte por posicionamento');
  end if;

  return '> **O que este relatório sabe e o que não sabe.** '
    || case when array_length(v_tem,1) > 0
            then 'JÁ EXISTE no sistema: ' || array_to_string(v_tem, '; ') || '. ' else '' end
    || case when array_length(v_nao,1) > 0
            then 'NÃO é coletado por nenhuma rotina: ' || array_to_string(v_nao, '; ')
                 || ' — não conclua nada sobre isso. ' else '' end
    || case when array_length(v_ressalva,1) > 0
            then 'Ressalvas: ' || array_to_string(v_ressalva, '; ') || '.' else '' end;
end;
$$;

comment on function public.nota_de_cobertura(uuid) is
  'ESP-03: paragrafo de cobertura DERIVADO do dado. Substitui as declaracoes fixas de cegueira, que envelheceram quando o GT-40/41/42 passou a coletar idade, genero e rankings.';

-- Export: a negacao falsa sai, a cobertura real entra.
create or replace function public.get_report_export_data(p_company_id uuid, p_start date, p_end date)
returns jsonb
language sql
stable
as $function$
  with dia as (
    select snapshot_date d, round(sum(spend)::numeric,2) gasto, sum(impressions) imp, sum(clicks) clk,
           sum(link_clicks) lclk, sum(landing_page_views) views, sum(form_leads) forms, sum(messaging_started) conv
    from metric_snapshots
    where company_id = p_company_id and snapshot_date between p_start and p_end
    group by snapshot_date
  ),
  camp as (
    select c.name nome, round(sum(m.spend)::numeric,2) gasto, sum(m.impressions) imp,
           sum(m.link_clicks) lclk, sum(m.landing_page_views) views, sum(m.form_leads) forms,
           sum(m.messaging_started) conv
    from metric_snapshots m join campaigns c on c.id = m.campaign_id
    where m.company_id = p_company_id and m.snapshot_date between p_start and p_end
    group by c.name having sum(m.spend) > 0
  ),
  tops as (
    select coalesce(a.name, ams.ad_external_id) nome, round(sum(ams.spend)::numeric,2) gasto,
           sum(ams.form_leads) forms, sum(ams.link_clicks) lclk
    from ad_metric_snapshots ams left join ads a on a.external_id = ams.ad_external_id
    where ams.company_id = p_company_id and ams.snapshot_date between p_start and p_end
    group by 1 order by 2 desc limit 15
  ),
  demo as (
    select tipo_recorte, valor_recorte, round(sum(spend)::numeric,2) gasto, sum(form_leads) forms,
           round((sum(spend)/nullif(sum(form_leads),0))::numeric,2) custo_por_form,
           (sum(form_leads) >= 50 or sum(spend) >= 300) as amostra_confiavel
    from metric_breakdown_daily
    where company_id = p_company_id and snapshot_date between p_start and p_end
    group by 1,2
  ),
  metricas as (
    select metric from public.targets
     where company_id = p_company_id and active and campaign_id is null
    union
    select metric from public.metas_de_negocio
     where company_id = p_company_id and vigente and tipo = 'gate'
  ),
  resolvidos as (
    select m.metric, public.teto_vigente(p_company_id, m.metric) as r from metricas m
  )
  select jsonb_build_object(
    'periodo', jsonb_build_object('inicio', p_start, 'fim', p_end,
        'dias_com_dado', (select count(*) from dia), 'dias_no_periodo', (p_end - p_start + 1)),
    'serie_diaria', (select coalesce(jsonb_agg(to_jsonb(dia) order by dia.d), '[]'::jsonb) from dia),
    'por_campanha', (select coalesce(jsonb_agg(to_jsonb(camp) order by camp.gasto desc), '[]'::jsonb) from camp),
    'top_anuncios', (select coalesce(jsonb_agg(to_jsonb(tops) order by tops.gasto desc), '[]'::jsonb) from tops),
    'tetos', (select coalesce(jsonb_object_agg(metric, (r->>'teto_que_governa')::numeric), '{}'::jsonb)
              from resolvidos where (r->>'teto_que_governa') is not null),
    'tetos_detalhe', (select coalesce(jsonb_object_agg(metric, r), '{}'::jsonb) from resolvidos),
    'perfil_demografico', (select coalesce(jsonb_agg(to_jsonb(demo) order by demo.tipo_recorte, demo.custo_por_form), '[]'::jsonb) from demo),
    'cobertura', public.nota_de_cobertura(p_company_id),
    'proibicao', 'Em campanha de credito e PROIBIDO segmentar por idade, genero, CEP ou renda. O perfil demografico acima serve para escolher angulo e criativo, NUNCA para estreitar publico.'
  );
$function$;