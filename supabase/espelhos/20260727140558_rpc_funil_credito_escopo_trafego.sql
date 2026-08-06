-- ESPELHO DE MIGRACAO APLICADA
-- version: 20260727140558
-- name: rpc_funil_credito_escopo_trafego
-- projeto: gzjwnjdpxpbmdhcyefvs (Gestor de Trafego IA)
-- aplicada por: Claude via MCP apply_migration
-- espelho gerado a partir de supabase_migrations.schema_migrations - NAO transcrito a mao

-- AJUSTE DE ESCOPO (decisão do Ryan, 27/07): este sistema cuida EXCLUSIVAMENTE de
-- tráfego pago. O Dash da Legal é fonte apenas do que a Meta não entrega — a conversão
-- final (proposta/contrato pago) que serve para medir a QUALIDADE DO TRÁFEGO.
-- Removido: ranking e taxa de aprovação POR BANCO (esteira/operação interna, resolvida
-- internamente pela Legal — não é matéria de gestão de mídia).
-- Mantido: funil até contrato pago, receita, CAC e atribuição por campanha/criativo,
-- porque é isso que mede se o tráfego comprado virou negócio.
create or replace function public.get_funil_credito(p_dias int default 90)
returns jsonb
language sql
stable
as $$
with janela as (
  select (current_date - greatest(p_dias, 1))::date as de, current_date as ate
),
midia as (
  select round(coalesce(sum(spend),0)::numeric, 2) as gasto,
         coalesce(sum(link_clicks),0) as cliques_lp,
         coalesce(sum(form_leads),0)  as formularios_meta,
         min(snapshot_date) as primeiro_dia, max(snapshot_date) as ultimo_dia
  from public.metric_snapshots, janela
  where snapshot_date between janela.de and janela.ate
),
leads_j as (
  select count(*) as leads,
         count(*) filter (where utm_campaign is not null) as leads_com_utm,
         round(avg(custo_aquisicao)::numeric, 2) as custo_medio_lead
  from public.lev_leads, janela
  where criado::date between janela.de and janela.ate and coalesce(is_test,false) = false
),
prop_j as (
  select count(*) as propostas,
         count(distinct lead_id) as leads_com_proposta,
         count(*) filter (where pago) as pagas,
         round(coalesce(sum(valor_financiado) filter (where pago),0)::numeric, 2) as volume_pago,
         round(avg(valor_financiado) filter (where pago)::numeric, 2) as ticket_medio
  from public.lev_propostas, janela
  where criado::date between janela.de and janela.ate
),
campanhas as (
  select jsonb_agg(x order by x.contratos_pagos desc) as lista from (
    select coalesce(l.utm_campaign, '(sem utm)') as utm_campaign,
           coalesce(l.utm_source, '-') as utm_source,
           coalesce(l.utm_content, '-') as utm_content,
           count(distinct p.proposta_id) filter (where p.pago) as contratos_pagos,
           round(coalesce(sum(p.valor_financiado) filter (where p.pago),0)::numeric,2) as volume_pago,
           count(distinct l.lead_id) as leads,
           round(avg(l.custo_aquisicao)::numeric,2) as custo_medio_lead
    from public.lev_leads l
    join public.lev_propostas p on p.lead_id = l.lead_id
    , janela
    where p.criado::date between janela.de and janela.ate
    group by 1,2,3
    having count(distinct p.proposta_id) filter (where p.pago) > 0
  ) x
)
select jsonb_build_object(
  'escopo', 'TRAFEGO PAGO. O CRM/Dash e usado somente como fonte da conversao final (proposta e contrato pago) que a Meta nao fornece, para medir a qualidade do trafego comprado. Analise de esteira interna, relacao com bancos, politica de credito e operacao de atendimento NAO fazem parte do escopo deste sistema e sao tratadas internamente pela Legal - nao comente nem recomende sobre esses temas.',
  'periodo', (select jsonb_build_object('dias', p_dias, 'de', de, 'ate', ate) from janela),
  'midia_meta', (select jsonb_build_object(
      'gasto', gasto, 'cliques_lp', cliques_lp, 'formularios', formularios_meta,
      'cobertura_dados', jsonb_build_object('primeiro_dia', primeiro_dia, 'ultimo_dia', ultimo_dia)) from midia),
  'conversao_final', (select jsonb_build_object(
      'leads_no_crm', l.leads, 'leads_com_utm', l.leads_com_utm,
      'custo_medio_lead_crm', l.custo_medio_lead,
      'leads_com_proposta', pr.leads_com_proposta, 'propostas', pr.propostas,
      'contratos_pagos', pr.pagas,
      'taxa_lead_para_proposta_pct', case when l.leads > 0 then round(100.0*pr.leads_com_proposta/l.leads, 2) end,
      'taxa_proposta_para_pago_pct', case when pr.propostas > 0 then round(100.0*pr.pagas/pr.propostas, 2) end)
    from leads_j l, prop_j pr),
  'financeiro_midia', (select jsonb_build_object(
      'volume_financiado_pago', pr.volume_pago, 'ticket_medio', pr.ticket_medio,
      'cac_por_contrato_pago', case when pr.pagas > 0 then round(m.gasto / pr.pagas, 2) end,
      'volume_sobre_gasto', case when m.gasto > 0 then round(pr.volume_pago / m.gasto, 2) end)
    from prop_j pr, midia m),
  'por_campanha', coalesce((select lista from campanhas), '[]'::jsonb),
  'avisos', jsonb_build_array(
    'volume_financiado e o total do contrato, NAO a comissao da Legal: volume_sobre_gasto nao e lucro',
    'contratos sem utm podem ser organicos, indicacao ou anteriores a instrumentacao de UTM',
    'ha trafego fora da conta Meta monitorada (TikTok e parceiro externo): o CAC divide gasto Meta por TODOS os contratos, logo e conservador',
    'a base de leads do CRM esta em ingestao progressiva; numeros de leads podem crescer',
    'taxas de conversao pos-lead dependem da operacao interna da Legal: use-as para avaliar QUALIDADE DO TRAFEGO, nunca para opinar sobre a esteira interna'
  )
);
$$;
comment on function public.get_funil_credito is 'Conversao final do trafego (lead -> proposta -> contrato pago) + CAC + atribuicao por campanha. ESCOPO: trafego pago. Nao expoe analise por banco/esteira (operacao interna da Legal).';
grant execute on function public.get_funil_credito(int) to authenticated, service_role;