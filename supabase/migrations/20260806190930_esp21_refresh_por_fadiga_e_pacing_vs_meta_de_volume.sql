-- ESPELHO DE MIGRACAO APLICADA
-- version: 20260806190930
-- name: esp21_refresh_por_fadiga_e_pacing_vs_meta_de_volume
-- projeto: gzjwnjdpxpbmdhcyefvs (Gestor de Trafego IA)
-- aplicada por: Claude via MCP apply_migration
-- espelho gerado a partir de supabase_migrations.schema_migrations - NAO transcrito a mao

-- ESP-21 · refresh por fadiga, e pacing contra meta de volume. Duas perguntas, dois graos.
--
-- PARTE 1 - FADIGA, no grao do CRIATIVO.
-- O contrato da dois gatilhos: frequencia acima de 3,5 em 30 DIAS, ou queda de CTR de 25% contra a
-- media de 3 dias com a frequencia subindo.
--
-- RESTRICAO DE DADO QUE EU NAO VOU CONTORNAR: frequencia e impressoes / alcance, e ALCANCE NAO
-- SOMA entre dias - a Meta deduplica pessoa. Logo frequencia de 30 dias NAO e calculavel a partir
-- das linhas diarias. Somar alcance para chegar nela produziria um numero que parece frequencia e
-- nao e. O que EXISTE e a frequencia DIARIA, e com ela da para medir o co-sinal que o segundo
-- gatilho pede: frequencia SUBINDO. E esse segundo gatilho e o que distingue criativo cansado de
-- criativo ruim - o mais util dos dois.
--
-- PARTE 2 - PACING, no grao da EMPRESA.
-- A meta de volume VEM COMO PARAMETRO porque ninguem decidiu uma. Nao existe meta de leads por dia
-- registrada neste sistema, e inventar uma para poder responder seria o mesmo erro do "ideal".
--
-- E O NUMERO QUE ELA DEVOLVE E PISO, NAO ESTIMATIVA: a verba necessaria e calculada com o custo
-- por resultado ATUAL. Escalar EMPURRA esse custo para cima, porque a Meta passa a comprar
-- resultado marginal mais caro. Portanto a verba real para atingir a meta e MAIOR que a projetada,
-- e a funcao diz isso. Prometer meta de volume com projecao linear e o jeito mais rapido de o
-- sistema mentir com aritmetica correta.

create or replace function public.avaliar_fadiga(p_company_id uuid, p_ad_external_id text)
returns jsonb
language plpgsql
stable
as $$
declare
  v_lim_queda numeric; v_lim_freq numeric;
  d record; b record; v_dias int;
  v_var_ctr numeric; v_var_freq numeric; v_veredito text; v_acao text;
begin
  if p_company_id is null or p_ad_external_id is null then
    raise exception 'avaliar_fadiga exige empresa e anuncio';
  end if;

  select valor into v_lim_queda from public.limiares_de_midia
   where company_id=p_company_id and metrica='ctr_link' and tipo='variacao_relativa' and vigente limit 1;
  select valor into v_lim_freq from public.limiares_de_midia
   where company_id=p_company_id and metrica='frequencia' and tipo='absoluto' and vigente limit 1;

  select snapshot_date, frequency,
         (100.0*link_clicks/nullif(impressions,0)) ctr into d
    from public.ad_metric_snapshots
   where company_id=p_company_id and ad_external_id=p_ad_external_id and spend>0
   order by snapshot_date desc limit 1;

  if d is null then
    return jsonb_build_object('veredito','sem_entrega',
      'motivo','Sem dia com gasto nao ha fadiga a medir. Peca que nao entrega nao cansa - ela nem apareceu.');
  end if;

  select avg(100.0*link_clicks/nullif(impressions,0)) ctr, avg(frequency) freq, count(*) dias into b
    from public.ad_metric_snapshots
   where company_id=p_company_id and ad_external_id=p_ad_external_id and spend>0
     and snapshot_date < d.snapshot_date and snapshot_date >= d.snapshot_date - 3;

  select count(*) into v_dias from public.ad_metric_snapshots
   where company_id=p_company_id and ad_external_id=p_ad_external_id and spend>0;

  if coalesce(b.dias,0) = 0 then
    return jsonb_build_object('veredito','sem_base_de_comparacao',
      'dias_com_entrega', v_dias,
      'motivo','Fadiga e QUEDA relativa. Sem dias anteriores nao existe queda a medir, e nivel isolado nao distingue cansado de ruim.');
  end if;

  v_var_ctr  := case when b.ctr  > 0 then 100.0*(d.ctr - b.ctr)/b.ctr end;
  v_var_freq := case when b.freq > 0 then 100.0*(d.frequency - b.freq)/b.freq end;

  if v_var_ctr is not null and v_var_ctr <= v_lim_queda and coalesce(v_var_freq,0) > 0 then
    v_veredito := 'fadiga';
    v_acao := 'REFRESH: trocar a peca por variacao com angulo novo. Nao mexer em orcamento - orcamento nao conserta peca cansada.';
  elsif v_var_ctr is not null and v_var_ctr <= v_lim_queda then
    v_veredito := 'queda_sem_saturacao';
    v_acao := 'CTR caiu sem a frequencia subir: nao e saturacao da audiencia. Revisar gancho e proposta da peca, nao trocar por mais do mesmo.';
  elsif coalesce(v_var_freq,0) > 0 and d.frequency >= v_lim_freq then
    v_veredito := 'frequencia_alta_sem_queda_de_ctr';
    v_acao := 'Frequencia diaria em ' || round(d.frequency::numeric,2) || ' e subindo, mas o CTR ainda nao caiu. Preparar variacao nova ANTES de o CTR ceder - refresh feito depois da queda perde os dias em que o custo ja subiu.';
  else
    v_veredito := 'sem_sinal_de_fadiga';
    v_acao := 'Nenhuma acao por fadiga.';
  end if;

  return jsonb_build_object(
    'anuncio', p_ad_external_id,
    'veredito', v_veredito,
    'acao', v_acao,
    'medidas', jsonb_build_object(
      'ultimo_dia', d.snapshot_date, 'dias_de_base', b.dias, 'dias_com_entrega', v_dias,
      'ctr_hoje_pct', round(d.ctr::numeric,3), 'ctr_base_pct', round(b.ctr::numeric,3),
      'variacao_ctr_pct', round(v_var_ctr,1),
      'frequencia_diaria_hoje', round(d.frequency::numeric,2),
      'frequencia_diaria_base', round(b.freq::numeric,2),
      'variacao_frequencia_pct', round(v_var_freq,1)),
    'limiares_usados', jsonb_build_object('queda_de_ctr_pct', v_lim_queda, 'frequencia', v_lim_freq),
    'LACUNA_DECLARADA','O limiar do contrato e frequencia de 30 DIAS acima de 3,5. Isso NAO e calculavel aqui: frequencia e impressoes/alcance e ALCANCE NAO SOMA entre dias, porque a Meta deduplica pessoa. O que uso e a frequencia DIARIA e a variacao dela. Se alguem precisar da frequencia de 30 dias, ela tem de ser coletada como metrica da janela, nao derivada das linhas diarias.'
  );
end;
$$;

create or replace function public.avaliar_pacing(p_company_id uuid, p_meta_leads_dia numeric default null)
returns jsonb
language plpgsql
stable
as $$
declare
  v_orc_dia numeric; v_conjuntos int; v_gasto7 numeric; v_forms7 bigint;
  v_custo numeric; v_leads_dia numeric; v_verba_necessaria numeric; v_multiplo numeric;
begin
  if p_company_id is null then
    raise exception 'avaliar_pacing exige empresa';
  end if;

  select coalesce(sum(ast.daily_budget/100.0),0), count(*) into v_orc_dia, v_conjuntos
    from public.ad_sets ast
   where ast.company_id = p_company_id and upper(coalesce(ast.status,'')) = 'ACTIVE'
     and ast.daily_budget > 0
     and exists (select 1 from public.ad_metric_snapshots s join public.ads a on a.external_id=s.ad_external_id
                  where a.adset_external_id = ast.external_id and s.snapshot_date >= current_date - 3 and s.spend > 0);

  select coalesce(sum(spend),0), coalesce(sum(form_leads),0) into v_gasto7, v_forms7
    from public.ad_metric_snapshots
   where company_id = p_company_id and snapshot_date >= current_date - 7;

  v_custo := case when v_forms7 > 0 then v_gasto7 / v_forms7 end;
  v_leads_dia := case when v_custo > 0 then v_orc_dia / v_custo end;

  if p_meta_leads_dia is not null and v_custo is not null then
    v_verba_necessaria := round(p_meta_leads_dia * v_custo, 2);
    v_multiplo := round(v_verba_necessaria / nullif(v_orc_dia,0), 2);
  end if;

  return jsonb_build_object(
    'capacidade_atual', jsonb_build_object(
      'conjuntos_entregando', v_conjuntos,
      'orcamento_somado_dia', round(v_orc_dia::numeric,2),
      'custo_por_formulario_7d', round(v_custo::numeric,2),
      'leads_por_dia_que_a_estrutura_comporta', round(v_leads_dia::numeric,0)),
    'meta_informada', p_meta_leads_dia,
    'nao_existe_meta_registrada','Este sistema NAO tem meta de leads por dia decidida por ninguem. A meta entra como parametro porque inventar uma para poder responder seria o mesmo erro de inventar a regua de ideal.',
    'projecao', case when p_meta_leads_dia is null then null else jsonb_build_object(
      'verba_diaria_necessaria_PISO', v_verba_necessaria,
      'multiplo_da_verba_atual', v_multiplo,
      'gap', case when v_multiplo > 1
              then 'Faltam ' || round((v_verba_necessaria - v_orc_dia)::numeric,2) || ' por dia, ou seja ' || v_multiplo || ' vezes a verba atual.'
              else 'A estrutura atual ja comporta a meta.' end) end,
    'POR_QUE_E_PISO_E_NAO_ESTIMATIVA', case when p_meta_leads_dia is null then null else
      'A verba de R$ ' || v_verba_necessaria || ' usa o custo por formulario ATUAL de R$ ' || round(v_custo::numeric,2)
      || '. Escalar EMPURRA esse custo para cima: a Meta passa a comprar resultado marginal mais caro. Portanto a verba real para atingir '
      || p_meta_leads_dia || ' leads por dia e MAIOR que essa - quanto maior, so a escada de escala rodando por passos descobre. '
      || 'Tratar essa projecao como estimativa seria prometer meta com aritmetica correta e premissa falsa.' end,
    'nota','Capacidade conta apenas conjunto ACTIVE com orcamento proprio E com entrega nos ultimos 3 dias. Conjunto ativo que nao entrega nao comporta lead nenhum.'
  );
end;
$$;