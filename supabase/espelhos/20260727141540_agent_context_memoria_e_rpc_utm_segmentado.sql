-- ESPELHO DE MIGRACAO APLICADA
-- version: 20260727141540
-- name: agent_context_memoria_e_rpc_utm_segmentado
-- projeto: gzjwnjdpxpbmdhcyefvs (Gestor de Trafego IA)
-- aplicada por: Claude via MCP apply_migration
-- espelho gerado a partir de supabase_migrations.schema_migrations - NAO transcrito a mao

-- 1) MEMORIA INSTITUCIONAL DO AGENTE
-- Fatos curados que o agente passa a ler em TODA resposta. Existe porque o agente errava
-- por falta de contexto historico (ex.: leu media historica de UTM e diagnosticou problema
-- de atribuicao que ja havia sido resolvido; afirmou canal de captacao inexistente).
create table public.agent_context (
  id          bigint generated always as identity primary key,
  categoria   text not null,        -- escopo | incidente | decisao | contexto | armadilha
  fato        text not null,
  vigente     boolean not null default true,
  desde       date,
  atualizado  timestamptz not null default now()
);
comment on table public.agent_context is 'Memoria institucional injetada no system prompt do traffic-chat. Editar aqui muda o comportamento do agente sem redeploy.';
alter table public.agent_context enable row level security;
create policy agent_ctx_select on public.agent_context for select to authenticated using (true);

insert into public.agent_context (categoria, fato, desde) values
('escopo','Este sistema cuida EXCLUSIVAMENTE de trafego pago. O CRM/Dash da Legal e fonte apenas da conversao final (proposta e contrato pago) que a Meta nao fornece, para medir a qualidade do trafego comprado.', '2026-07-27'),
('escopo','NAO comente, analise ou recomende sobre: relacao com bancos, roteamento de propostas, esteira interna, politica de credito, operacao de atendimento humano ou margem por banco. Isso e resolvido internamente pela Legal e esta FORA do escopo. Se perguntarem, diga que esta fora do escopo do sistema de trafego.', '2026-07-27'),
('contexto','A instrumentacao de UTM na captacao entrou em JUNHO/2026. Leads de maio/2026 e anteriores quase nao tem UTM (8-15%); a partir de junho a cobertura e de 70-75%. NUNCA use a media historica de UTM para diagnosticar problema de atribuicao: segmente por mes.', '2026-06-01'),
('contexto','A conta Meta operada e act_3302001729967572 (Legal e Viver). Existem campanhas de OUTRAS contas no banco (ex.: 946388181625874) sem gasto desde maio/2026 - nao as conte como ativas da operacao atual.', '2026-07-27'),
('contexto','Ha trafego pago FORA da conta Meta monitorada: TikTok (utm JUL26v2_*) e um parceiro externo (utm_source trafegar-midias). O gasto desses canais NAO esta no sistema, logo qualquer CAC calculado com gasto Meta sobre todos os contratos e conservador.', '2026-07-01'),
('contexto','A captacao NAO usa formulario instantaneo (Lead Ads) da Meta: verificado via conector facebook_leads, zero leads na janela maxima de 90 dias. A captacao e por landing page propria e por Click-to-WhatsApp.', '2026-07-27'),
('incidente','Em 22/07/2026, 7 WABAs (Atendimento1, Lily, Mary, Rafa, Rosa, Blip3, Atendente Lucy) deixaram de existir na Graph API - confirmado com dois tokens diferentes, logo nao e permissao. 9 templates seguem atrelados a elas. Causa em apuracao com Roberto/Blip.', '2026-07-22'),
('incidente','As campanhas de WhatsApp (LEV_WPP-CTWA_FRIO_ADV+_2026-06 e [LEV][WPP][LEADS][01.05.26]) estao PAUSADAS na Meta desde 16/07/2026 e por isso as conversas cairam a zero. A queda comecou em 16/07, ANTES do sumico das WABAs (22/07) - nao confunda as duas causas.', '2026-07-16'),
('incidente','Entre 23 e 27/07/2026 o sync de metricas de campanha ficou quebrado (timeout) e o sistema exibiu gasto zero indevidamente. Foi corrigido e os dados reingeridos. Se aparecer periodo com gasto zero antes de 27/07, desconfie e verifique a cobertura de dados.', '2026-07-23'),
('decisao','Na CAPI da Meta, o evento ContratoPago usa valor_financiado (total do contrato), por decisao do Ryan. Isso NAO e a comissao/receita liquida da Legal - portanto volume_sobre_gasto nao e lucro e nunca deve ser chamado de ROAS de lucro.', '2026-07-27'),
('decisao','Acoes na Meta (pausar/escalar/orcamento) so acontecem via card de aprovacao decidido por administrador. Nunca afirme que executou algo: o card fica PENDENTE.', '2026-07-23'),
('armadilha','A base de leads do CRM esta em ingestao progressiva (varredura de 180 mil leads). Totais de lead e taxas com lead no denominador MUDAM entre consultas. Ao citar essas taxas, avise que sao parciais.', '2026-07-27'),
('armadilha','NUNCA misture janelas temporais diferentes no mesmo funil (ex.: midia de 30 dias com CRM de 120 dias). Use a MESMA janela para todas as etapas ou declare a comparacao como invalida.', '2026-07-27'),
('armadilha','Zero em uma metrica pode significar (a) valor realmente zero, (b) dado nao coletado, ou (c) sync quebrado. Antes de concluir queda de desempenho, verifique a cobertura de dados do periodo.', '2026-07-27');

-- 2) RPC: taxa de UTM SEGMENTADA no periodo consultado (evita o diagnostico falso)
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
         min(snapshot_date) as primeiro_dia, max(snapshot_date) as ultimo_dia,
         count(distinct snapshot_date) as dias_com_dado
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
  select count(*) as propostas, count(distinct lead_id) as leads_com_proposta,
         count(*) filter (where pago) as pagas,
         round(coalesce(sum(valor_financiado) filter (where pago),0)::numeric, 2) as volume_pago,
         round(avg(valor_financiado) filter (where pago)::numeric, 2) as ticket_medio
  from public.lev_propostas, janela
  where criado::date between janela.de and janela.ate
),
utm_mes as (
  select jsonb_agg(jsonb_build_object('mes', mes, 'leads', leads, 'pct_com_utm', pct) order by mes desc) as serie
  from (
    select to_char(criado,'YYYY-MM') as mes, count(*) as leads,
           round(100.0*count(*) filter (where utm_campaign is not null)/count(*),1) as pct
    from public.lev_leads, janela
    where criado::date between janela.de and janela.ate
    group by 1
  ) z
),
campanhas as (
  select jsonb_agg(x order by x.contratos_pagos desc) as lista from (
    select coalesce(l.utm_campaign,'(sem utm)') as utm_campaign,
           coalesce(l.utm_source,'-') as utm_source,
           coalesce(l.utm_content,'-') as criativo_utm_content,
           count(distinct p.proposta_id) filter (where p.pago) as contratos_pagos,
           round(coalesce(sum(p.valor_financiado) filter (where p.pago),0)::numeric,2) as volume_pago,
           count(distinct l.lead_id) as leads
    from public.lev_leads l
    join public.lev_propostas p on p.lead_id = l.lead_id, janela
    where p.criado::date between janela.de and janela.ate
    group by 1,2,3
    having count(distinct p.proposta_id) filter (where p.pago) > 0
  ) x
)
select jsonb_build_object(
  'escopo','TRAFEGO PAGO. CRM usado so como fonte da conversao final. Analise de banco/esteira/atendimento interno esta FORA do escopo - nao comente.',
  'periodo', (select jsonb_build_object('dias', p_dias, 'de', de, 'ate', ate) from janela),
  'midia_meta', (select jsonb_build_object('gasto', gasto, 'cliques_lp', cliques_lp, 'formularios', formularios_meta,
      'dias_com_dado', dias_com_dado, 'cobertura', jsonb_build_object('primeiro_dia', primeiro_dia, 'ultimo_dia', ultimo_dia)) from midia),
  'conversao_final', (select jsonb_build_object(
      'leads_no_crm', l.leads, 'leads_com_proposta', pr.leads_com_proposta, 'propostas', pr.propostas,
      'contratos_pagos', pr.pagas, 'custo_medio_lead_crm', l.custo_medio_lead,
      'taxa_lead_para_proposta_pct', case when l.leads>0 then round(100.0*pr.leads_com_proposta/l.leads,2) end,
      'taxa_proposta_para_pago_pct', case when pr.propostas>0 then round(100.0*pr.pagas/pr.propostas,2) end)
    from leads_j l, prop_j pr),
  'atribuicao', (select jsonb_build_object(
      'leads_com_utm_no_periodo', l.leads_com_utm, 'leads_no_periodo', l.leads,
      'pct_com_utm_no_periodo', case when l.leads>0 then round(100.0*l.leads_com_utm/l.leads,1) end,
      'por_mes', (select serie from utm_mes),
      'leitura_correta','A instrumentacao de UTM comecou em junho/2026. Avalie a cobertura pelo MES MAIS RECENTE, nunca pela media do periodo.')
    from leads_j l),
  'financeiro_midia', (select jsonb_build_object('volume_financiado_pago', pr.volume_pago, 'ticket_medio', pr.ticket_medio,
      'cac_por_contrato_pago', case when pr.pagas>0 then round(m.gasto/pr.pagas,2) end,
      'volume_sobre_gasto', case when m.gasto>0 then round(pr.volume_pago/m.gasto,2) end)
    from prop_j pr, midia m),
  'por_campanha', coalesce((select lista from campanhas),'[]'::jsonb),
  'avisos', jsonb_build_array(
    'volume_financiado e o total do contrato, NAO a comissao: volume_sobre_gasto nao e lucro nem ROAS',
    'contratos sem utm podem ser organicos, indicacao ou anteriores a junho/2026 (pre-instrumentacao)',
    'ha trafego fora da conta Meta (TikTok e parceiro externo): o CAC e conservador',
    'base de leads do CRM em ingestao progressiva: totais de lead e taxas com lead no denominador sao PARCIAIS',
    'nao compare janelas diferentes: use o mesmo periodo para midia e CRM'
  )
);
$$;
grant execute on function public.get_funil_credito(int) to authenticated, service_role;