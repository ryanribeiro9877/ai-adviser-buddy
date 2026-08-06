-- ESPELHO DE MIGRACAO APLICADA
-- version: 20260804202255
-- name: teto_sanidade_3000_e_aviso_de_orcamento
-- projeto: gzjwnjdpxpbmdhcyefvs (Gestor de Trafego IA)
-- aplicada por: Claude via MCP apply_migration
-- espelho gerado a partir de supabase_migrations.schema_migrations - NAO transcrito a mao

-- 04/08/2026 - TETO DE SANIDADE cai de R$ 5.000 para R$ 3.000/dia (decisao do Ryan) e nasce a
-- funcao que traduz orcamento pedido no que ele REALMENTE permite.
--
-- POR QUE A FUNCAO EXISTE: em 04/08 a propria tela da Meta declarou, para um orcamento de
-- R$ 60,00/dia: "Voce gastara em media R$ 60,00 por dia. Seu limite maximo de gasto DIARIO e
-- R$ 105,00, e seu limite maximo de gasto SEMANAL e R$ 420,00". Ou seja o orcamento diario e uma
-- MEDIA com folga de 75% para cima em qualquer dia isolado, e o que a plataforma garante e o
-- semanal. O gestor decidiu "R$ 60 por campanha" acreditando que era limite do dia - com tres
-- campanhas o pior dia nao e R$ 180,00 e sim R$ 315,00.
--
-- CONSEQUENCIA DO TETO DE 3.000, DECLARADA: pedido de R$ 3.000/dia tem pior dia de R$ 5.250,00.
-- Se a intencao fosse nenhum dia passar de R$ 5.000, o teto pedido teria que ser R$ 2.857,14.
-- A funcao mostra o pior caso em toda resposta para essa aritmetica nunca ficar implicita.
--
-- FATORES E SUA PROCEDENCIA: 1,75 e 7 sao TEXTO DA META, lidos na tela em 04/08. A projecao de
-- 30 dias e DERIVACAO nossa e vai marcada como tal - a Meta nao declara teto mensal.

UPDATE public.meta_execution_config
   SET teto_sanidade_orcamento_diario = 3000, updated_at = now();

CREATE OR REPLACE FUNCTION public.avaliar_orcamento_diario(
  p_company_id uuid,
  p_reais numeric,
  p_campanhas integer DEFAULT 1
) RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_teto numeric; v_n integer := greatest(coalesce(p_campanhas,1),1);
  v_dia numeric; v_sem numeric; v_mes numeric; v_pior numeric; v_ok boolean;
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

  v_dia  := round(p_reais * 1.75, 2);
  v_sem  := round(p_reais * 7, 2);
  v_mes  := round(p_reais * 30, 2);
  v_pior := round(p_reais * 1.75 * v_n, 2);
  v_ok   := (p_reais <= v_teto);

  RETURN jsonb_build_object(
    'permitido', v_ok,
    'motivo', CASE WHEN v_ok THEN 'dentro_do_teto_de_sanidade' ELSE 'acima_do_teto_de_sanidade' END,
    'orcamento_pedido_por_dia', round(p_reais,2),
    'campanhas_consideradas', v_n,
    'media_por_dia', round(p_reais,2),
    'teto_real_do_dia', v_dia,
    'teto_semanal_garantido', v_sem,
    'projecao_30_dias', v_mes,
    'pior_dia_somando_as_campanhas', v_pior,
    'teto_de_sanidade_do_sistema', v_teto,
    'procedencia_dos_fatores', 'Os fatores 1,75 (dia) e 7 (semana) sao TEXTO DA PROPRIA META, lidos na tela em 04/08/2026 para um orcamento de R$ 60,00: "limite maximo diario R$ 105,00, semanal R$ 420,00". A projecao de 30 dias e DERIVACAO nossa - a Meta nao declara teto mensal.',
    'mensagem_para_o_gestor',
      CASE WHEN NOT v_ok THEN
        'Nao proponho esse orcamento: R$ ' || public.fmt_brl(p_reais) || '/dia esta acima do teto de sanidade do sistema, que e R$ '
        || public.fmt_brl(v_teto) || '/dia. Esse teto e configuracao de quem administra o sistema, nao algo que eu contorne. '
        || 'E vale saber por que existe: com R$ ' || public.fmt_brl(p_reais) || '/dia o pior dia possivel seria R$ ' || public.fmt_brl(v_dia) || '.'
      ELSE
        'ATENCAO AO QUE ESSE ORCAMENTO REALMENTE PERMITE. Voce pediu R$ ' || public.fmt_brl(p_reais)
        || '/dia, e esse numero e uma MEDIA, nao um limite do dia. A Meta permite gastar ate R$ '
        || public.fmt_brl(v_dia) || ' num dia isolado (175%), compensando em dias mais fracos. O que ela GARANTE e o teto da semana: R$ '
        || public.fmt_brl(v_sem) || '. Em 30 dias, isso projeta R$ ' || public.fmt_brl(v_mes) || ' (essa ultima e nossa conta, nao numero da Meta).'
        || CASE WHEN v_n > 1 THEN ' Com ' || v_n || ' campanhas nesse orcamento, o pior dia do conjunto nao e R$ '
             || public.fmt_brl(round(p_reais*v_n,2)) || ' e sim R$ ' || public.fmt_brl(v_pior) || '.' ELSE '' END
        || ' E NAO CONFUNDA COM TETO DE CUSTO: isto e quanto se GASTA por dia. O maximo pago POR RESULTADO e outro campo, chamado "Meta de custo por resultado", e ele esta vazio nos conjuntos desta conta.'
      END
  );
END $$;

COMMENT ON FUNCTION public.avaliar_orcamento_diario(uuid, numeric, integer) IS
  'Traduz orcamento diario pedido no que ele realmente permite: media, teto real do dia (175%), teto semanal garantido (7x), projecao de 30 dias (derivada) e pior dia somando N campanhas. Chamada ANTES de emitir card com orcamento. Os fatores 1,75 e 7 sao texto da Meta lido em 04/08/2026.';

REVOKE ALL ON FUNCTION public.avaliar_orcamento_diario(uuid, numeric, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.avaliar_orcamento_diario(uuid, numeric, integer) TO authenticated, service_role;

INSERT INTO agent_context (categoria, fato, vigente, desde, atualizado, company_id)
VALUES ('doutrina',
  'ORCAMENTO DIARIO E MEDIA, NAO LIMITE DO DIA - E TETO DE SANIDADE CAIU PARA R$ 3.000 (04/08/2026). '
  || 'SEMPRE que o gestor informar um orcamento, chame avaliar_orcamento_diario e repasse a mensagem dela '
  || 'ANTES de emitir qualquer card. Ela declara: a media por dia, o teto REAL do dia (175% do pedido, texto '
  || 'da propria Meta), o teto semanal garantido (7x), a projecao de 30 dias (derivacao nossa, nao numero da '
  || 'Meta) e o pior dia somando N campanhas. '
  || 'EXEMPLO QUE JA CAUSOU MAL-ENTENDIDO: o gestor decidiu "R$ 60 por campanha" acreditando ser limite do '
  || 'dia. Com tres campanhas o pior dia nao e R$ 180,00 e sim R$ 315,00. '
  || 'TETO DE SANIDADE: caiu de R$ 5.000 para R$ 3.000/dia por decisao do Ryan em 04/08. Pedido acima disso e '
  || 'RECUSADO na emissao. Consequencia declarada: um pedido de R$ 3.000/dia tem pior dia de R$ 5.250,00 - o '
  || 'teto limita o PEDIDO, nao o pior caso. '
  || 'E NUNCA CONFUNDA os dois campos: orcamento diario e quanto se GASTA; "Meta de custo por resultado" e o '
  || 'maximo pago POR RESULTADO, esta vazio nos conjuntos desta conta, e e esse o teto de custo.',
  true, '2026-08-04', now(), NULL);