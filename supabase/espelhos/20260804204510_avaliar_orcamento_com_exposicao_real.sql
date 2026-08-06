-- ESPELHO DE MIGRACAO APLICADA
-- version: 20260804204510
-- name: avaliar_orcamento_com_exposicao_real
-- projeto: gzjwnjdpxpbmdhcyefvs (Gestor de Trafego IA)
-- aplicada por: Claude via MCP apply_migration
-- espelho gerado a partir de supabase_migrations.schema_migrations - NAO transcrito a mao

-- 04/08/2026 - A funcao passa a CONTAR a exposicao real em vez de exigir o numero do chamador.
--
-- ANALISE DO CLAUDE CODE QUE MOTIVOU ISTO: o fluxo nao tem nocao de lote - t_propose_criacao e
-- chamada uma vez por objeto e o payload nao diz "este e o 2o de 3". Ele achou um sinal fraco (o
-- array de cartoes do mesmo turno) e RECUSOU usar, por dois motivos corretos: so conta o mesmo
-- turno, e o caso real do gestor foram aprovacoes separadas; e o pior dia deve somar conjuntos
-- CONCORRENTEMENTE ATIVOS, nao cartoes de um turno.
--
-- DESENHO NOVO: o chamador nao precisa saber contar. A funcao le do banco quanto a empresa JA tem
-- de exposicao por dia - soma do orcamento dos conjuntos que estao de fato entregando (conjunto
-- ACTIVE dentro de campanha active) - e responde a pergunta que o gestor nao fez: "se este
-- conjunto nascer, qual passa a ser o pior dia da operacao inteira?"
-- p_campanhas continua aceito para nao quebrar chamada existente, mas deixa de ser necessario.

CREATE OR REPLACE FUNCTION public.avaliar_orcamento_diario(
  p_company_id uuid,
  p_reais numeric,
  p_campanhas integer DEFAULT NULL
) RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_teto numeric; v_dia numeric; v_sem numeric; v_mes numeric; v_ok boolean;
  v_exp_atual numeric; v_exp_nova numeric; v_pior_total numeric; v_n_conj integer;
  v_pior_lote numeric; v_n integer;
BEGIN
  IF p_reais IS NULL OR p_reais <= 0 THEN
    RETURN jsonb_build_object('permitido', false, 'motivo', 'valor_invalido',
      'mensagem_para_o_gestor', 'Orcamento tem de ser um valor positivo em reais por dia.');
  END IF;

  SELECT teto_sanidade_orcamento_diario INTO v_teto
    FROM meta_execution_config WHERE company_id = p_company_id;
  IF v_teto IS NULL THEN
    RETURN jsonb_build_object('permitido', false, 'motivo', 'empresa_sem_configuracao_de_execucao',
      'mensagem_para_o_gestor', 'Esta empresa nao tem configuracao de execucao propria, entao nao ha teto de sanidade definido e nenhum orcamento pode ser proposto.');
  END IF;

  -- EXPOSICAO REAL: so conjunto que ENTREGA conta. Conjunto ativo em campanha pausada nao gasta,
  -- e somar ele inflaria o pior caso - erro na direcao oposta, mas erro.
  SELECT coalesce(sum(a.daily_budget),0)/100.0, count(*)
    INTO v_exp_atual, v_n_conj
    FROM ad_sets a JOIN campaigns c ON c.id = a.campaign_id
   WHERE coalesce(a.company_id, c.company_id) = p_company_id
     AND a.status = 'ACTIVE' AND c.status = 'active' AND coalesce(a.daily_budget,0) > 0;

  v_dia  := round(p_reais * 1.75, 2);
  v_sem  := round(p_reais * 7, 2);
  v_mes  := round(p_reais * 30, 2);
  v_ok   := (p_reais <= v_teto);
  v_exp_nova   := round(v_exp_atual + p_reais, 2);
  v_pior_total := round(v_exp_nova * 1.75, 2);
  v_n          := greatest(coalesce(p_campanhas,1),1);
  v_pior_lote  := round(p_reais * 1.75 * v_n, 2);

  RETURN jsonb_build_object(
    'permitido', v_ok,
    'motivo', CASE WHEN v_ok THEN 'dentro_do_teto_de_sanidade' ELSE 'acima_do_teto_de_sanidade' END,
    'orcamento_pedido_por_dia', round(p_reais,2),
    'media_por_dia', round(p_reais,2),
    'teto_real_do_dia', v_dia,
    'teto_semanal_garantido', v_sem,
    'projecao_30_dias', v_mes,
    'teto_de_sanidade_do_sistema', v_teto,
    -- exposicao medida no banco, nao informada pelo chamador
    'conjuntos_entregando_hoje', v_n_conj,
    'exposicao_atual_por_dia', round(v_exp_atual,2),
    'exposicao_com_este_novo', v_exp_nova,
    'pior_dia_da_operacao_inteira', v_pior_total,
    'pior_dia_se_fossem_n_iguais', CASE WHEN p_campanhas IS NOT NULL THEN v_pior_lote END,
    'procedencia_dos_fatores', 'Os fatores 1,75 (dia) e 7 (semana) sao TEXTO DA PROPRIA META, lidos na tela em 04/08/2026 para um orcamento de R$ 60,00: "limite maximo diario R$ 105,00, semanal R$ 420,00". A projecao de 30 dias e DERIVACAO nossa - a Meta nao declara teto mensal. A exposicao atual e soma dos conjuntos que ESTAO entregando (conjunto ativo em campanha ativa); conjunto ativo em campanha pausada nao gasta e por isso nao entra.',
    'mensagem_para_o_gestor',
      CASE WHEN NOT v_ok THEN
        'Nao proponho esse orcamento: R$ ' || public.fmt_brl(p_reais) || '/dia esta acima do teto de sanidade do sistema, que e R$ '
        || public.fmt_brl(v_teto) || '/dia. Esse teto e configuracao de quem administra o sistema, nao algo que eu contorne. '
        || 'E vale saber por que existe: com R$ ' || public.fmt_brl(p_reais) || '/dia o pior dia possivel seria R$ ' || public.fmt_brl(v_dia) || '.'
      ELSE
        'ATENCAO AO QUE ESSE ORCAMENTO REALMENTE PERMITE. Voce pediu R$ ' || public.fmt_brl(p_reais)
        || '/dia, e esse numero e uma MEDIA, nao um limite do dia. A Meta permite gastar ate R$ '
        || public.fmt_brl(v_dia) || ' num dia isolado (175%), compensando em dias mais fracos. O que ela GARANTE e o teto da semana: R$ '
        || public.fmt_brl(v_sem) || '. Em 30 dias, isso projeta R$ ' || public.fmt_brl(v_mes) || ' (essa ultima e nossa conta, nao numero da Meta). '
        || CASE WHEN v_n_conj > 0 THEN
             'E OLHE A OPERACAO INTEIRA, nao so este objeto: hoje ' || v_n_conj || ' conjunto(s) entregam R$ '
             || public.fmt_brl(v_exp_atual) || '/dia. Com este, a media vai a R$ ' || public.fmt_brl(v_exp_nova)
             || '/dia e o PIOR DIA da operacao passa a ser R$ ' || public.fmt_brl(v_pior_total) || '. '
           ELSE
             'Hoje nenhum conjunto esta entregando, entao este seria o primeiro - a exposicao da operacao passa de zero para R$ '
             || public.fmt_brl(v_exp_nova) || '/dia de media, com pior dia de R$ ' || public.fmt_brl(v_pior_total) || '. '
           END
        || 'E NAO CONFUNDA COM TETO DE CUSTO: isto e quanto se GASTA por dia. O maximo pago POR RESULTADO e outro campo, chamado "Meta de custo por resultado", e ele esta vazio nos conjuntos desta conta.'
      END
  );
END $$;

COMMENT ON FUNCTION public.avaliar_orcamento_diario(uuid, numeric, integer) IS
  'Traduz orcamento diario pedido no que ele realmente permite, e MEDE a exposicao da operacao no banco em vez de exigir o numero do chamador: soma o orcamento dos conjuntos que ESTAO entregando (conjunto ACTIVE em campanha active) e responde qual passa a ser o pior dia da operacao inteira se este objeto nascer. p_campanhas e opcional e serve so para o cenario hipotetico "N objetos iguais".';