-- ESPELHO DE MIGRACAO APLICADA
-- version: 20260805194548
-- name: esp01_regua_de_negocio_como_camada_propria
-- projeto: gzjwnjdpxpbmdhcyefvs (Gestor de Trafego IA)
-- aplicada por: Claude via MCP apply_migration
-- espelho gerado a partir de supabase_migrations.schema_migrations - NAO transcrito a mao

-- ESP-01 · a regua de negocio do gestor vira camada propria, e o teto vigente passa a ser
-- resolvido em UM lugar que declara qual camada governou.
--
-- DIAGNOSTICO CORRIGIDO PELO BANCO: eu tinha escrito no backlog que havia "tres geracoes de
-- meta em circulacao". Nao e isso. O que existe e UMA decisao registrada que nunca chegou na
-- tabela que decide:
--   targets (o que o motor de veredito le): custo_por_formulario = 2,30, fonte
--     derivado_meta_p75_diario - e um teto de CONSISTENCIA com o proprio passado;
--   agent_context (o que o gestor disse, 30/07): "ALVO DE CUSTO: R$ 1,60 por formulario como
--     regua operacional de teste (mais rigido que o teto historico de R$ 2,30); R$ 0,80 e
--     aspiracao de longo prazo, nao gate."
-- O agente leu 2,30, pintou verde, e estava lendo a tabela certa - a decisao e que nao estava
-- la. Medido em 7 dias (29/07 a 04/08): R$ 2,17 por formulario. Dentro do 2,30, 36% acima do 1,60.
--
-- POR QUE TABELA NOVA E NAO UMA LINHA A MAIS EM targets: quatro funcoes leem targets
-- (evaluate_alerts, evaluate_winners, get_report_export_data, post_daily_report) e NAO existe
-- unique em (company_id, metric). Uma segunda linha ativa da mesma metrica mudaria o contrato
-- das quatro de uma vez, com risco de alerta duplicado. targets segue sendo a camada de
-- consistencia historica, intacta. Duas camadas, nunca sobrescrita.
--
-- DENOMINADOR EXPLICITO E OBRIGATORIO: foi a ausencia dele que produziu o "custo_por_lead_lp"
-- que na verdade mede CLIQUE NO LINK (descoberto em 30/07 e registrado na memoria da propria
-- linha). Aqui o denominador e coluna, nao suposicao.
--
-- ASPIRACAO NAO E GATE: o 0,80 entra com tipo 'aspiracao' e a funcao de resolucao NUNCA o
-- devolve como governante. Guardar aspiracao como teto e o caminho mais curto para estrangular
-- volume perseguindo custo minimo.

create table if not exists public.metas_de_negocio (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  metric text not null,
  denominador text not null,
  valor numeric not null,
  tipo text not null,
  decidido_por text not null,
  decidido_em date not null,
  citacao_da_decisao text not null,
  vigente boolean not null default true,
  memoria jsonb,
  created_at timestamptz not null default now(),
  constraint metas_tipo_valido check (tipo in ('gate','aspiracao')),
  constraint metas_uma_vigente_por_tipo unique (company_id, metric, tipo, vigente)
);

comment on table public.metas_de_negocio is
  'ESP-01: regua de NEGOCIO decidida por humano, com denominador explicito e citacao verbatim da decisao. Camada separada de targets, que e a camada de consistencia historica (p75). Nenhum consumidor antigo foi alterado.';
comment on column public.metas_de_negocio.denominador is
  'A coluna do dado que vai no divisor (ex.: form_leads, link_clicks, messaging_started). Obrigatorio: a ausencia disso produziu o custo_por_lead_lp que media clique no link.';
comment on column public.metas_de_negocio.tipo is
  'gate = governa veredito. aspiracao = NUNCA governa; existe para nao ser confundida com teto.';

alter table public.metas_de_negocio enable row level security;
drop policy if exists metas_leitura on public.metas_de_negocio;
create policy metas_leitura on public.metas_de_negocio for select to authenticated
  using (public.is_company_member(company_id, auth.uid()));

-- A regua do Roberto, transcrita do fato de 30/07 - nao inventada.
insert into public.metas_de_negocio
  (company_id, metric, denominador, valor, tipo, decidido_por, decidido_em, citacao_da_decisao, memoria)
values
  ('ded20b38-f42e-4c71-800c-31b97ea48bcf', 'custo_por_formulario', 'form_leads', 1.60, 'gate',
   'Roberto (gestor)', '2026-07-30',
   'ALVO DE CUSTO: R$ 1,60 por formulario como regua operacional de teste (mais rigido que o teto historico de R$ 2,30); R$ 0,80 e aspiracao de longo prazo, nao gate.',
   jsonb_build_object(
     'origem', 'agent_context, fato DECISOES OPERACIONAIS DO GESTOR de 30/07/2026',
     'relacao_com_o_teto_historico', 'O proprio gestor declarou que esta regua e MAIS RIGIDA que o teto de 2,30 derivado do p75. Portanto ela nao substitui aquele teto: governa o veredito, e o 2,30 segue respondendo consistencia com o passado.',
     'medido_em_29_07_a_04_08', 'R$ 2,17 por formulario - dentro do 2,30 e 36% acima desta regua')),
  ('ded20b38-f42e-4c71-800c-31b97ea48bcf', 'custo_por_formulario', 'form_leads', 0.80, 'aspiracao',
   'Roberto (gestor)', '2026-07-30',
   'R$ 0,80 e aspiracao de longo prazo, nao gate.',
   jsonb_build_object('nao_e_gate', true,
     'por_que_registrar', 'Registrada para NAO ser confundida com teto. Perseguir 0,80 como gate estrangularia volume - o proprio gestor a classificou como aspiracao.'))
on conflict do nothing;

-- Resolucao em UM lugar, declarando qual camada governou e o que a outra diz.
create or replace function public.teto_vigente(p_company_id uuid, p_metric text)
returns jsonb
language plpgsql
stable
as $$
declare
  v_gate record; v_asp record; v_hist record; v jsonb;
begin
  if p_company_id is null or p_metric is null then
    raise exception 'teto_vigente exige p_company_id e p_metric';
  end if;

  select * into v_gate from public.metas_de_negocio
   where company_id = p_company_id and metric = p_metric and tipo = 'gate' and vigente limit 1;

  select * into v_asp from public.metas_de_negocio
   where company_id = p_company_id and metric = p_metric and tipo = 'aspiracao' and vigente limit 1;

  select * into v_hist from public.targets
   where company_id = p_company_id and metric = p_metric and active and campaign_id is null limit 1;

  v := jsonb_build_object(
    'company_id', p_company_id,
    'metric', p_metric,
    'governa', case when v_gate is not null then 'meta_de_negocio' 
                    when v_hist is not null then 'consistencia_historica'
                    else 'nenhum' end,
    'teto_que_governa', coalesce(v_gate.valor, v_hist.valor),
    'denominador', coalesce(v_gate.denominador,
       case p_metric when 'custo_por_formulario' then 'form_leads'
                     when 'custo_por_conversa' then 'messaging_started'
                     when 'custo_por_lead_lp' then 'link_clicks (o NOME desta metrica e enganoso - descoberto em 30/07)'
                     else 'nao declarado' end),
    'meta_de_negocio', case when v_gate is null then null else jsonb_build_object(
        'valor', v_gate.valor, 'decidido_por', v_gate.decidido_por,
        'decidido_em', v_gate.decidido_em, 'citacao', v_gate.citacao_da_decisao) end,
    'consistencia_historica', case when v_hist is null then null else jsonb_build_object(
        'valor', v_hist.valor, 'fonte', v_hist.fonte,
        'responde', 'consistencia com o proprio passado, nao rentabilidade') end,
    'aspiracao_nao_governa', case when v_asp is null then null else v_asp.valor end
  );

  if v_gate is not null and v_hist is not null and v_gate.valor <> v_hist.valor then
    v := v || jsonb_build_object('divergencia_declarada',
      'Existem DUAS reguas e elas nao coincidem. Governa a de negocio (' || v_gate.valor ||
      ', decidida por ' || v_gate.decidido_por || ' em ' || to_char(v_gate.decidido_em,'DD/MM/YYYY') ||
      '). O valor de ' || v_hist.valor || ' e teto de consistencia historica e NAO deve ser usado como veredito de negocio. Ao reportar, cite a regua que governou.');
  end if;

  if v_gate is null and v_hist is not null then
    v := v || jsonb_build_object('aviso',
      'Nao existe regua de negocio para esta metrica nesta empresa: o veredito esta saindo do teto de consistencia historica, que mede o passado e nao a rentabilidade. Pedir a regua ao gestor.');
  end if;

  return v;
end;
$$;