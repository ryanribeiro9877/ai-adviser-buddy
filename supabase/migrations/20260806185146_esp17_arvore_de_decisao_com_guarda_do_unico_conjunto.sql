-- ESPELHO DE MIGRACAO APLICADA
-- version: 20260806185146
-- name: esp17_arvore_de_decisao_com_guarda_do_unico_conjunto
-- projeto: gzjwnjdpxpbmdhcyefvs (Gestor de Trafego IA)
-- aplicada por: Claude via MCP apply_migration
-- espelho gerado a partir de supabase_migrations.schema_migrations - NAO transcrito a mao

-- ESP-17 · arvore de decisao do CONTRA_2 secao 3.3, com a guarda do unico conjunto de lead.
--
-- ESTA E A GUARDA QUE FALTAVA. Hoje o motor de alertas (R5) recomenda PAUSAR e nao verifica se
-- pausar zeraria a entrega. Em 06/08 as 09:15 ele disparou 3 alertas CRITICAL nas tres unicas
-- variantes que entregam - se o gestor seguir os tres, a conta para. Esta funcao e o portao que
-- faltava.
--
-- A GUARDA CONTA ENTREGA, NAO STATUS. Medido: 20 conjuntos com status ACTIVE e apenas 3
-- entregando. Contar 'ACTIVE' daria falsa seguranca de 20 alternativas onde existem 3.
--
-- IMPOSSIBILIDADE DECLARADA, nao contornada: a arvore do contrato usa DUAS reguas - "ideal"
-- (candidato a escala) e "teto" (manter). O sistema tem UMA: o gate de R$1,60 decidido pelo
-- Roberto em 30/07. A aspiracao de R$0,80 ele classificou explicitamente como NAO-gate, e usar
-- aspiracao como gatilho de escala faria nada nunca qualificar. Portanto esta arvore NAO separa
-- "candidato a escala" de "manter" - ela devolve os dois como um estado so e PEDE a regua de
-- ideal. Inventar um ideal aqui seria colocar numero meu numa decisao de dinheiro do gestor.
--
-- VOLUME reusa o criterio de AMOSTRA CONFIAVEL que ja esta decidido no contrato (>=50 resultados
-- ou >=R$300 na janela). Nao inventei corte novo.
--
-- REVERSAO EM CURSO: teto excedido com queda monotonica nos 3 ultimos dias NAO gera pausa. O
-- contrato e explicito - pausar ali mata uma recuperacao que esta acontecendo. Provado na propria
-- conta em julho: um conjunto de reversao saiu de R$2,17 para R$1,36.
--
-- DUPLICACAO QUE EU DECLARO: pode_pausar_por_custo (ESP-16) tem maturacao_dias fixo em 3 no
-- codigo; esta arvore le da tabela. Os valores sao IGUAIS hoje, entao nao ha divergencia de
-- comportamento - mas e duplicacao e o conserto e apontar a do ESP-16 para a tabela.

insert into public.limiares_de_midia
  (company_id, metrica, tipo, operador, valor, janela_dias, acao_prescrita, porque, denominador, fonte)
select c.id, 'maturacao', 'absoluto', '<', 3, 1,
  'NAO pausar por custo. Monitorar e reavaliar ao completar a maturacao.',
  'Custo de objeto em aprendizado e instavel por construcao: a Meta ainda calibra a entrega. Pausar ali mata a calibracao e descarta o que ja foi gasto nela.',
  'dias com entrega (gasto > 0)',
  'CONTRA_2 Parte III - maturacao_dias 3'
from public.companies c where c.name = 'Legal é Viver'
on conflict do nothing;

create or replace function public.decidir_sobre_conjunto(p_company_id uuid, p_adset_external_id text)
returns jsonb
language plpgsql
stable
as $$
declare
  v_teto numeric; v_tem_ideal boolean; v_mat_dias int;
  v_gasto7 numeric; v_forms7 bigint; v_dias int; v_cpl7 numeric;
  v_d0 numeric; v_d1 numeric; v_d2 numeric; v_revertendo boolean;
  v_volume boolean; v_entregando int; v_restariam int;
  v_decisao text; v_porque text; v_acao text; v_guarda text;
begin
  if p_company_id is null or p_adset_external_id is null then
    raise exception 'decidir_sobre_conjunto exige empresa e conjunto';
  end if;

  v_teto := (public.teto_vigente(p_company_id,'custo_por_formulario')->>'teto_que_governa')::numeric;
  select exists(select 1 from public.metas_de_negocio
                 where company_id=p_company_id and metric='custo_por_formulario'
                   and tipo='gate' and vigente) into v_tem_ideal;
  v_tem_ideal := false;  -- nao existe regua de "ideal" separada do gate; declarado abaixo

  select valor into v_mat_dias from public.limiares_de_midia
   where company_id=p_company_id and metrica='maturacao' and vigente limit 1;
  v_mat_dias := coalesce(v_mat_dias, 3);

  select coalesce(sum(s.spend),0), coalesce(sum(s.form_leads),0), count(distinct s.snapshot_date)
    into v_gasto7, v_forms7, v_dias
    from public.ad_metric_snapshots s
    join public.ads a on a.external_id = s.ad_external_id
   where s.company_id=p_company_id and a.adset_external_id=p_adset_external_id
     and s.snapshot_date >= current_date - 7 and s.spend > 0;

  if v_dias = 0 then
    return jsonb_build_object('decisao','sem_entrega',
      'porque','Este conjunto nao teve nenhum dia com gasto nos ultimos 7 dias. Nao ha custo a julgar.',
      'acao','Nenhuma por custo. Se ele esta ativo e nao entrega, o problema nao e custo.');
  end if;

  v_cpl7 := case when v_forms7 > 0 then v_gasto7 / v_forms7 end;
  v_volume := (v_forms7 >= 50 or v_gasto7 >= 300);

  -- tendencia: os tres ultimos dias com entrega, do mais recente para o mais antigo
  select max(cpl) filter (where rn=1), max(cpl) filter (where rn=2), max(cpl) filter (where rn=3)
    into v_d0, v_d1, v_d2
    from (
      select s.snapshot_date,
             sum(s.spend)/nullif(sum(s.form_leads),0) cpl,
             row_number() over (order by s.snapshot_date desc) rn
      from public.ad_metric_snapshots s
      join public.ads a on a.external_id = s.ad_external_id
      where s.company_id=p_company_id and a.adset_external_id=p_adset_external_id and s.spend>0
      group by s.snapshot_date) z
   where rn <= 3;

  v_revertendo := (v_d0 is not null and v_d1 is not null and v_d2 is not null
                   and v_d2 > v_d1 and v_d1 > v_d0);

  -- quantos conjuntos entregam hoje nesta empresa, e quantos restariam
  select count(distinct a.adset_external_id) into v_entregando
    from public.ad_metric_snapshots s join public.ads a on a.external_id = s.ad_external_id
   where s.company_id=p_company_id and s.snapshot_date >= current_date - 3 and s.spend > 0
     and a.adset_external_id is not null;
  v_restariam := greatest(v_entregando - 1, 0);

  if v_dias < v_mat_dias then
    v_decisao := 'manter_em_maturacao';
    v_porque  := 'Tem ' || v_dias || ' dia(s) de entrega e a maturacao minima e ' || v_mat_dias || '. Custo de objeto em aprendizado e instavel por construcao.';
    v_acao    := 'Monitorar. NAO pausar por custo antes de completar a maturacao.';
  elsif v_cpl7 is null then
    if v_gasto7 >= 300 then
      v_decisao := 'pausar_e_criar_reversao';
      v_porque  := 'R$ ' || round(v_gasto7::numeric,2) || ' gastos em ' || v_dias || ' dias e ZERO resultado. Nao ha custo por resultado porque nao ha resultado.';
      v_acao    := 'Criar objeto de reversao NOVO e pausado, validar, ativar, e SO ENTAO pausar este.';
    else
      v_decisao := 'manter_sem_dado_suficiente';
      v_porque  := 'Zero resultado, mas apenas R$ ' || round(v_gasto7::numeric,2) || ' gastos - abaixo do piso de amostra confiavel.';
      v_acao    := 'Aguardar. Julgar com este gasto seria julgar ruido.';
    end if;
  elsif v_cpl7 <= v_teto then
    v_decisao := case when v_volume then 'dentro_do_teto_com_volume' else 'dentro_do_teto_sem_volume' end;
    v_porque  := 'Custo por formulario de R$ ' || round(v_cpl7::numeric,2) || ' contra a regua de R$ ' || v_teto || '.'
              || case when v_volume then ' Amostra confiavel (' || v_forms7 || ' resultados, R$ ' || round(v_gasto7::numeric,2) || ').'
                      else ' Amostra ainda nao confiavel.' end;
    v_acao    := 'MANTER. NAO consigo dizer se e candidato a escala: a arvore do contrato exige uma regua de IDEAL separada do teto, e esta empresa so tem o teto de R$ ' || v_teto || ' decidido pelo gestor. Pedir a regua de ideal ao gestor antes de tratar isto como gatilho de escala.';
  else
    if v_revertendo then
      v_decisao := 'manter_esta_revertendo';
      v_porque  := 'Custo de R$ ' || round(v_cpl7::numeric,2) || ' acima da regua de R$ ' || v_teto
                || ', MAS caindo nos tres ultimos dias (' || round(v_d2::numeric,2) || ' -> ' || round(v_d1::numeric,2) || ' -> ' || round(v_d0::numeric,2) || ').';
      v_acao    := 'MANTER e nao tocar. Pausar agora mataria uma recuperacao em curso - foi assim que um conjunto desta conta saiu de R$ 2,17 para R$ 1,36 em julho.';
    elsif v_volume then
      v_decisao := 'manter_e_trocar_criativo';
      v_porque  := 'Custo de R$ ' || round(v_cpl7::numeric,2) || ' acima da regua de R$ ' || v_teto
                || ', sem tendencia de queda, e COM volume (' || v_forms7 || ' resultados). O conjunto entrega; o que cansou foi a peca.';
      v_acao    := 'Refresh de criativo. NAO pausar o conjunto: ele e o canal, a peca e o problema.';
    else
      v_decisao := 'pausar_e_criar_reversao';
      v_porque  := 'Custo de R$ ' || round(v_cpl7::numeric,2) || ' acima da regua de R$ ' || v_teto
                || ', sem tendencia de queda e SEM volume (' || v_forms7 || ' resultados, R$ ' || round(v_gasto7::numeric,2) || ').';
      v_acao    := 'Criar objeto de reversao NOVO e pausado, validar, ativar, e SO ENTAO pausar este.';
    end if;
  end if;

  -- A GUARDA. Ela nao aconselha: ela SOBRESCREVE a decisao de pausar.
  if v_decisao like 'pausar%' and v_restariam = 0 then
    v_guarda := 'GUARDA ACIONADA: este e o UNICO conjunto entregando nesta empresa. Pausar zeraria a entrega. '
             || 'A decisao de pausar foi SOBRESCRITA. Primeiro criar a alternativa nova, ativar e confirmar entrega; '
             || 'so depois pausar este. Sequencia invertida deixa a conta sem entrega no intervalo.';
    v_decisao := 'nao_pausar_sem_alternativa_ativa';
    v_acao    := 'Criar conjunto novo PAUSADO, validar, ATIVAR, confirmar que entrega, e somente ai pausar este.';
  end if;

  return jsonb_build_object(
    'conjunto', p_adset_external_id,
    'decisao', v_decisao,
    'porque', v_porque,
    'acao', v_acao,
    'numeros', jsonb_build_object(
      'dias_com_entrega_7d', v_dias, 'gasto_7d', round(v_gasto7::numeric,2),
      'resultados_7d', v_forms7, 'custo_por_formulario_7d', round(v_cpl7::numeric,2),
      'regua_que_governa', v_teto, 'amostra_confiavel', v_volume,
      'cpl_ultimos_3_dias', jsonb_build_array(round(v_d2::numeric,2), round(v_d1::numeric,2), round(v_d0::numeric,2)),
      'revertendo', v_revertendo),
    'guarda', jsonb_build_object(
      'conjuntos_entregando_na_empresa', v_entregando,
      'restariam_se_este_pausar', v_restariam,
      'acionada', (v_guarda is not null),
      'mensagem', v_guarda),
    'LACUNA_DECLARADA', 'A arvore do contrato separa "candidato a escala" (custo <= IDEAL) de "manter" (custo <= TETO). Esta empresa tem apenas o TETO de R$ ' || v_teto || ' decidido pelo gestor; a aspiracao de R$ 0,80 ele classificou como NAO-gate. Portanto os dois estados aparecem como um so e nenhuma escala e prescrita por esta funcao. Pedir a regua de IDEAL ao gestor.',
    'nota', 'A guarda conta ENTREGA, nao status. Medido em 06/08: 20 conjuntos com status ACTIVE e 3 entregando - contar status daria falsa seguranca de 20 alternativas onde existem 3.'
  );
end;
$$;