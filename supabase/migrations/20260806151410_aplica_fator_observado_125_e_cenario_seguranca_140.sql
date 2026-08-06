-- Ryan escolheu em 06/08/2026:
-- 1,25 = fator observado; 1,40 = margem interna de seguranca separada.
-- A funcao e transformada a partir da definicao viva para evitar transcricao divergente.

DO $migration$
DECLARE
  v_regprocedure constant regprocedure :=
    'public.avaliar_orcamento_diario(uuid,numeric,integer)'::regprocedure;
  v_def text;
  v_new text;
BEGIN
  v_def := pg_get_functiondef(v_regprocedure);

  IF regexp_count(v_def, '1\.75') <> 3 THEN
    RAISE EXCEPTION
      'avaliar_orcamento_diario mudou: esperadas 3 ocorrencias de 1.75, encontradas %',
      regexp_count(v_def, '1\.75');
  END IF;
  IF position('1,75 (dia)' IN v_def) = 0 THEN
    RAISE EXCEPTION
      'avaliar_orcamento_diario mudou: texto esperado "1,75 (dia)" nao encontrado';
  END IF;
  IF position('(175%)' IN v_def) = 0 THEN
    RAISE EXCEPTION
      'avaliar_orcamento_diario mudou: texto esperado "(175%%)" nao encontrado';
  END IF;

  v_new := replace(v_def, '1.75', '1.25');

  v_new := replace(
    v_new,
    '  v_pior_lote numeric; v_n integer;',
    E'  v_pior_lote numeric; v_n integer;\n'
      || '  v_dia_seguranca numeric; v_pior_total_seguranca numeric; '
      || 'v_pior_lote_seguranca numeric;'
  );

  v_new := replace(
    v_new,
    '  v_pior_lote  := round(p_reais * 1.25 * v_n, 2);',
    E'  v_pior_lote  := round(p_reais * 1.25 * v_n, 2);\n'
      || E'  -- Margem INTERNA e separada. Nao altera nem se mistura ao observado.\n'
      || E'  v_dia_seguranca        := round(p_reais * 1.40, 2);\n'
      || E'  v_pior_total_seguranca := round(v_exp_nova * 1.40, 2);\n'
      || '  v_pior_lote_seguranca  := round(p_reais * 1.40 * v_n, 2);'
  );

  v_new := replace(
    v_new,
    E'    ''pior_dia_se_fossem_n_iguais'', CASE WHEN p_campanhas IS NOT NULL THEN v_pior_lote END,\n'
      || '    ''procedencia_dos_fatores'',',
    E'    ''pior_dia_se_fossem_n_iguais'', CASE WHEN p_campanhas IS NOT NULL THEN v_pior_lote END,\n'
      || E'    ''exposicao_observada_125'', jsonb_build_object(\n'
      || E'      ''fator'', 1.25,\n'
      || E'      ''objeto_no_dia'', v_dia,\n'
      || E'      ''operacao_inteira_no_dia'', v_pior_total,\n'
      || E'      ''lote_n_iguais_no_dia'', CASE WHEN p_campanhas IS NOT NULL THEN v_pior_lote END,\n'
      || E'      ''base'', ''Maior razao medida na janela recente de 14 dias com orcamento plausivelmente estavel. Sem historico de alteracao de orcamento de ad set, nao extrapolar para meses anteriores.''),\n'
      || E'    ''cenario_seguranca_margem_interna_140'', jsonb_build_object(\n'
      || E'      ''fator'', 1.40,\n'
      || E'      ''objeto_no_dia'', v_dia_seguranca,\n'
      || E'      ''operacao_inteira_no_dia'', v_pior_total_seguranca,\n'
      || E'      ''lote_n_iguais_no_dia'', CASE WHEN p_campanhas IS NOT NULL THEN v_pior_lote_seguranca END,\n'
      || E'      ''rotulo'', ''MARGEM INTERNA DE SEGURANCA. Nao e regra, garantia nem limite declarado pela Meta.''),\n'
      || '    ''procedencia_dos_fatores'','
  );

  v_new := replace(
    v_new,
    'Os fatores 1,75 (dia) e 7 (semana) sao TEXTO DA PROPRIA META, lidos na tela em 04/08/2026 para um orcamento de R$ 60,00: "limite maximo diario R$ 105,00, semanal R$ 420,00". A projecao de 30 dias e DERIVACAO nossa - a Meta nao declara teto mensal. A exposicao atual e soma dos conjuntos que ESTAO entregando (conjunto ativo em campanha ativa); conjunto ativo em campanha pausada nao gasta e por isso nao entra.',
    'O fator observado de 1,25 (125%) vem da maior razao medida na janela recente de 14 dias com orcamento plausivelmente estavel (maximo 1,249 em 42 pares conjunto-dia; nenhum acima de 1,25). O sistema NAO coleta historico de alteracao de orcamento de ad set, portanto esta evidencia nao deve ser extrapolada para meses anteriores. O fator 1,40 e uma MARGEM INTERNA DE SEGURANCA, separada do observado; nao e regra, garantia nem limite declarado pela Meta. O fator semanal de 7 vezes segue separado. A projecao de 30 dias e derivacao nossa. A exposicao atual soma apenas conjuntos que estao entregando.'
  );

  v_new := replace(
    v_new,
    E'        || ''E vale saber por que existe: com R$ '' || public.fmt_brl(p_reais) || ''/dia o pior dia possivel seria R$ '' || public.fmt_brl(v_dia) || ''.''',
    E'        || ''Com R$ '' || public.fmt_brl(p_reais) || ''/dia, a exposicao observada a 125% seria R$ '' || public.fmt_brl(v_dia)\n'
      || E'        || ''; o cenario separado de seguranca interna a 140% seria R$ '' || public.fmt_brl(v_dia_seguranca)\n'
      || '        || ''. O segundo numero e margem interna, nao regra nem limite da Meta.'' '
  );

  v_new := replace(
    v_new,
    E'        || ''/dia, e esse numero e uma MEDIA, nao um limite do dia. A Meta permite gastar ate R$ ''\n'
      || '        || public.fmt_brl(v_dia) || '' num dia isolado (175%), compensando em dias mais fracos. O que ela GARANTE e o teto da semana: R$ ''',
    E'        || ''/dia, e esse numero e uma MEDIA, nao um limite do dia. Na janela recente de 14 dias com orcamento plausivelmente estavel, observamos ate R$ ''\n'
      || E'        || public.fmt_brl(v_dia) || '' num dia isolado (125% observado; nao e regra da Meta). O cenario separado de seguranca interna a 140% seria R$ ''\n'
      || '        || public.fmt_brl(v_dia_seguranca) || '' neste objeto; e margem interna, nao regra nem limite da Meta. O valor semanal de planejamento em 7 vezes e R$ '''
  );

  v_new := replace(
    v_new,
    E'             || ''/dia e o PIOR DIA da operacao passa a ser R$ '' || public.fmt_brl(v_pior_total) || ''. ''',
    E'             || ''/dia e a EXPOSICAO OBSERVADA da operacao a 125% passa a R$ '' || public.fmt_brl(v_pior_total)\n'
      || '             || ''. O CENARIO DE SEGURANCA INTERNA a 140% seria R$ '' || public.fmt_brl(v_pior_total_seguranca) || ''. '' '
  );

  v_new := replace(
    v_new,
    E'             || public.fmt_brl(v_exp_nova) || ''/dia de media, com pior dia de R$ '' || public.fmt_brl(v_pior_total) || ''. ''',
    E'             || public.fmt_brl(v_exp_nova) || ''/dia de media, com exposicao observada a 125% de R$ '' || public.fmt_brl(v_pior_total)\n'
      || '             || '' e cenario de seguranca interna a 140% de R$ '' || public.fmt_brl(v_pior_total_seguranca) || ''. '' '
  );

  IF v_new = v_def THEN
    RAISE EXCEPTION 'avaliar_orcamento_diario nao foi transformada';
  END IF;
  IF regexp_count(v_new, '1\.75') <> 0
     OR position('1,75 (dia)' IN v_new) > 0
     OR position('(175%)' IN v_new) > 0 THEN
    RAISE EXCEPTION
      'transformacao incompleta: ainda existe referencia ao fator antigo';
  END IF;
  IF position('exposicao_observada_125' IN v_new) = 0
     OR position('cenario_seguranca_margem_interna_140' IN v_new) = 0 THEN
    RAISE EXCEPTION
      'transformacao incompleta: campos observado/seguranca nao foram inseridos';
  END IF;
  IF position('pior dia possivel' IN v_new) > 0
     OR position('PIOR DIA da operacao' IN v_new) > 0
     OR position('com pior dia de R$' IN v_new) > 0
     OR position('A Meta permite gastar ate' IN v_new) > 0
     OR position('O que ela GARANTE' IN v_new) > 0
     OR regexp_count(v_new, 'MARGEM INTERNA DE SEGURANCA') < 2 THEN
    RAISE EXCEPTION
      'transformacao incompleta: texto ao gestor nao separou observado de seguranca';
  END IF;

  EXECUTE v_new;
END;
$migration$;

COMMENT ON FUNCTION public.avaliar_orcamento_diario(uuid, numeric, integer) IS
  'Avalia orcamento e exposicao da operacao. Campos legados de pior dia usam o fator observado 1,25. Retorna separadamente cenario de seguranca 1,40, rotulado como margem interna e nunca como regra da Meta.';
