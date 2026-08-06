-- ESPELHO DE MIGRACAO APLICADA
-- version: 20260805195056
-- name: esp01_c1_export_usa_teto_vigente
-- projeto: gzjwnjdpxpbmdhcyefvs (Gestor de Trafego IA)
-- aplicada por: Claude via MCP apply_migration
-- espelho gerado a partir de supabase_migrations.schema_migrations - NAO transcrito a mao

-- ESP-01 consumidor 1 de 4 · get_report_export_data passa a exportar o teto QUE GOVERNA.
--
-- ANTES: 'tetos' vinha de jsonb_object_agg(metric, valor) sobre targets - ou seja, sempre o
-- teto de consistencia historica, mesmo quando existe regua de negocio decidida pelo gestor.
-- DEPOIS: o mesmo formato {metrica: numero}, mas o numero e o de teto_vigente(), e as
-- metricas sao a UNIAO das que tem teto historico e das que tem regua de negocio.
--
-- FORMA PRESERVADA DE PROPOSITO: quem consome o export espera {metrica: numero}. Trocar para
-- objeto quebraria o chamador - a licao de "alterar contrato de todo chamador". A procedencia
-- entra em CHAVE NOVA, 'tetos_detalhe', que nao existia e portanto nao pode quebrar nada.
--
-- Escolhido como PRIMEIRO dos quatro por ser o unico que nao escreve nada.

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
    'nao_disponivel', jsonb_build_array(
      'perfil_por_idade_e_genero: breakdown demografico nao e coletado pelo sistema; nao estimar')
  );
$function$;