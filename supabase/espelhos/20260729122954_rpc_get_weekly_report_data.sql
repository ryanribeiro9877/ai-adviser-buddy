-- RPC que reproduz as métricas do relatório semanal enviado ao Roberto (formato validado
-- contra os relatórios reais de 07/2026). Fonte única p/ tela, exportação e futuro gerador
-- de texto. 7 das 8 métricas do relatório humano existem no banco; a 8ª (perfil por
-- idade/gênero) NÃO é coletada — a função declara isso no retorno em vez de omitir.

create or replace function public.get_weekly_report_data(
  p_company_id uuid,
  p_start date,
  p_end date
) returns jsonb
language sql
stable
security invoker
as $$
  with base as (
    select coalesce(sum(spend),0) as gasto,
           coalesce(sum(form_leads),0) as formularios,
           coalesce(sum(link_clicks),0) as cliques_link,
           coalesce(sum(landing_page_views),0) as page_views,
           coalesce(sum(clicks),0) as cliques_totais,
           coalesce(sum(impressions),0) as impressoes,
           count(distinct snapshot_date) as dias_com_dado
    from metric_snapshots
    where company_id = p_company_id and snapshot_date between p_start and p_end
  ),
  por_campanha as (
    select c.name, round(sum(m.spend)::numeric,2) as gasto, coalesce(sum(m.form_leads),0) as formularios
    from metric_snapshots m join campaigns c on c.id = m.campaign_id
    where m.company_id = p_company_id and m.snapshot_date between p_start and p_end
    group by c.name having sum(m.spend) > 0 order by 2 desc
  )
  select jsonb_build_object(
    'periodo', jsonb_build_object('inicio', p_start, 'fim', p_end,
       'dias_com_dado', (select dias_com_dado from base),
       'dias_no_periodo', (p_end - p_start + 1)),
    'investimento', round((select gasto from base)::numeric, 2),
    'formularios', (select formularios from base),
    'custo_por_formulario', round(((select gasto from base) / nullif((select formularios from base),0))::numeric, 2),
    'cliques_link', (select cliques_link from base),
    'custo_por_clique', round(((select gasto from base) / nullif((select cliques_link from base),0))::numeric, 2),
    'visualizacoes_pagina', (select page_views from base),
    'ctr_pct', round(((select cliques_totais from base)::numeric / nullif((select impressoes from base),0)) * 100, 2),
    'conversao_view_form_pct', round(((select formularios from base)::numeric / nullif((select page_views from base),0)) * 100, 2),
    'por_campanha', (select coalesce(jsonb_agg(jsonb_build_object('campanha', name, 'gasto', gasto, 'formularios', formularios)), '[]'::jsonb) from por_campanha),
    'nao_disponivel', jsonb_build_array(
      'perfil_por_idade_e_genero: breakdown demografico nao e coletado pelo sistema (exige coleta adicional na fonte); nao estimar')
  );
$$;

revoke all on function public.get_weekly_report_data(uuid, date, date) from public, anon;
grant execute on function public.get_weekly_report_data(uuid, date, date) to authenticated, service_role;

comment on function public.get_weekly_report_data(uuid, date, date) is
  'Metricas do relatorio semanal no formato enviado ao gestor (investimento, formularios, custos, page views, CTR, conversao, quebra por campanha). security invoker: RLS do metric_snapshots vale. Declara explicitamente o que NAO esta disponivel (demografia).';
