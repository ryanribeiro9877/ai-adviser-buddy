-- Fonte ÚNICA para a exportação rica do relatório (desenho validado pelo exemplar de 29/07:
-- 5 abas — Resumo, Semana a semana, Série diária, Campanhas, Anúncios top).
-- Complementa get_weekly_report_data (que segue servindo a tela/texto): esta devolve as
-- SEÇÕES completas que a planilha precisa. security invoker: RLS vale.

create or replace function public.get_report_export_data(
  p_company_id uuid,
  p_start date,
  p_end date
) returns jsonb
language sql
stable
security invoker
as $$
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
  )
  select jsonb_build_object(
    'periodo', jsonb_build_object('inicio', p_start, 'fim', p_end,
        'dias_com_dado', (select count(*) from dia), 'dias_no_periodo', (p_end - p_start + 1)),
    'serie_diaria', (select coalesce(jsonb_agg(to_jsonb(dia) order by dia.d), '[]'::jsonb) from dia),
    'por_campanha', (select coalesce(jsonb_agg(to_jsonb(camp) order by camp.gasto desc), '[]'::jsonb) from camp),
    'top_anuncios', (select coalesce(jsonb_agg(to_jsonb(tops) order by tops.gasto desc), '[]'::jsonb) from tops),
    'tetos', (select coalesce(jsonb_object_agg(metric, valor), '{}'::jsonb)
              from targets where company_id = p_company_id and active and campaign_id is null),
    'nao_disponivel', jsonb_build_array(
      'perfil_por_idade_e_genero: breakdown demografico nao e coletado pelo sistema; nao estimar')
  );
$$;

revoke all on function public.get_report_export_data(uuid, date, date) from public, anon;
grant execute on function public.get_report_export_data(uuid, date, date) to authenticated, service_role;

comment on function public.get_report_export_data(uuid, date, date) is
  'Secoes completas da exportacao rica do relatorio: serie diaria, campanhas, top 15 anuncios, tetos vigentes. Layout de referencia: relatorio_MELHORADO exemplar de 29/07/2026 (5 abas). security invoker.';
