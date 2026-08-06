-- ESPELHO DE MIGRACAO APLICADA
-- version: 20260805194637
-- name: esp01_corrige_record_is_not_null_no_teto_vigente
-- projeto: gzjwnjdpxpbmdhcyefvs (Gestor de Trafego IA)
-- aplicada por: Claude via MCP apply_migration
-- espelho gerado a partir de supabase_migrations.schema_migrations - NAO transcrito a mao

-- ESP-01 correcao · defeito meu, do tipo que este projeto nomeia: sinal contraditorio na
-- mesma resposta.
--
-- O SINTOMA: teto_vigente devolvia {"governa":"nenhum","teto_que_governa":1.5} - negando ter
-- regua e mostrando uma.
--
-- A CAUSA, que vale como armadilha registrada: em PL/pgSQL, "RECORD IS NOT NULL" e FALSO se
-- QUALQUER campo do registro for nulo. Nao testa se a linha foi encontrada. As linhas de
-- targets tem campaign_id nulo, entao v_hist IS NOT NULL dava falso com a linha em mao. A
-- metrica custo_por_formulario funcionou por acidente: era a unica linha com todos os campos
-- preenchidos. Diagnostico certo exige FOUND ou uma coluna especifica - nunca o registro.

create or replace function public.teto_vigente(p_company_id uuid, p_metric text)
returns jsonb
language plpgsql
stable
as $$
declare
  v_gate record; v_asp record; v_hist record;
  tem_gate boolean := false; tem_asp boolean := false; tem_hist boolean := false;
  v jsonb;
begin
  if p_company_id is null or p_metric is null then
    raise exception 'teto_vigente exige p_company_id e p_metric';
  end if;

  select * into v_gate from public.metas_de_negocio
   where company_id = p_company_id and metric = p_metric and tipo = 'gate' and vigente limit 1;
  tem_gate := found;

  select * into v_asp from public.metas_de_negocio
   where company_id = p_company_id and metric = p_metric and tipo = 'aspiracao' and vigente limit 1;
  tem_asp := found;

  select * into v_hist from public.targets
   where company_id = p_company_id and metric = p_metric and active and campaign_id is null limit 1;
  tem_hist := found;

  v := jsonb_build_object(
    'company_id', p_company_id,
    'metric', p_metric,
    'governa', case when tem_gate then 'meta_de_negocio'
                    when tem_hist then 'consistencia_historica'
                    else 'nenhum' end,
    'teto_que_governa', case when tem_gate then v_gate.valor
                             when tem_hist then v_hist.valor
                             else null end,
    'denominador', case when tem_gate then v_gate.denominador
       else case p_metric
              when 'custo_por_formulario' then 'form_leads'
              when 'custo_por_conversa' then 'messaging_started'
              when 'custo_por_lead_lp' then 'link_clicks (o NOME desta metrica e enganoso - descoberto em 30/07)'
              else 'nao declarado' end end,
    'meta_de_negocio', case when not tem_gate then null else jsonb_build_object(
        'valor', v_gate.valor, 'decidido_por', v_gate.decidido_por,
        'decidido_em', v_gate.decidido_em, 'citacao', v_gate.citacao_da_decisao) end,
    'consistencia_historica', case when not tem_hist then null else jsonb_build_object(
        'valor', v_hist.valor, 'fonte', v_hist.fonte,
        'responde', 'consistencia com o proprio passado, nao rentabilidade') end,
    'aspiracao_nao_governa', case when tem_asp then v_asp.valor else null end
  );

  if tem_gate and tem_hist and v_gate.valor <> v_hist.valor then
    v := v || jsonb_build_object('divergencia_declarada',
      'Existem DUAS reguas e elas nao coincidem. Governa a de negocio (' || v_gate.valor ||
      ', decidida por ' || v_gate.decidido_por || ' em ' || to_char(v_gate.decidido_em,'DD/MM/YYYY') ||
      '). O valor de ' || v_hist.valor || ' e teto de consistencia historica e NAO deve ser usado como veredito de negocio. Ao reportar, cite a regua que governou.');
  end if;

  if not tem_gate and tem_hist then
    v := v || jsonb_build_object('aviso',
      'Nao existe regua de negocio para esta metrica nesta empresa: o veredito esta saindo do teto de consistencia historica, que mede o passado e nao a rentabilidade. Pedir a regua ao gestor.');
  end if;

  if not tem_gate and not tem_hist then
    v := v || jsonb_build_object('aviso',
      'Nenhuma regua existe para esta metrica nesta empresa. Qualquer veredito de bom ou ruim aqui seria opiniao sem referencia - declarar a ausencia em vez de julgar.');
  end if;

  return v;
end;
$$;