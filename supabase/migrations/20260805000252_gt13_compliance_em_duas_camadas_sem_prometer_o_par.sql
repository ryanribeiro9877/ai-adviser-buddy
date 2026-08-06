-- ESPELHO DE MIGRACAO APLICADA
-- version: 20260805000252
-- name: gt13_compliance_em_duas_camadas_sem_prometer_o_par
-- projeto: gzjwnjdpxpbmdhcyefvs (Gestor de Trafego IA)
-- aplicada por: Claude via MCP apply_migration
-- espelho gerado a partir de supabase_migrations.schema_migrations - NAO transcrito a mao

-- 04/08/2026 - CONSERTO DE PROMESSA MINHA. Ao criar pedido_de_anuncio_completo eu escrevi que
-- "este par sera avaliado de novo" pelo compliance. NAO SERA, e nao existe caminho hoje:
--   - o compliance-check aceita 'legenda' e/ou 'image_base64'. Provado em 04/08: com legenda ele
--     aplica 11 das 16 regras e devolve tres niveis (aprovado / atencao / reprovado), citando o
--     codigo da regra, o trecho e uma sugestao de reescrita. Funciona bem.
--   - mas a peca do Drive e um arquivo no Drive ou um video_id na Meta - nenhum dos dois e
--     image_base64. E para video nao existe "a imagem do video": existem 15 quadros.
-- Escrevi doutrina correta sem caminho tecnico, que e o defeito que este projeto passou o dia
-- matando. Corrigido para o que o sistema PODE cumprir, em DUAS CAMADAS:
--   (1) PORTAO QUE BLOQUEIA: compliance de TEXTO, 16 regras. E o critério que o gestor Roberto
--       declarou em 03/08 ("pode liberar qualquer peca que passe no compliance de texto").
--   (2) NOTA ANEXA: riscos_compliance da analise visual, que ja existe nas pecas e foi produzido
--       com cinco quadros. Informa, nao bloqueia.
-- NENHUM DOS DOIS AVALIA O PAR texto+peca, e o card tem de dizer isso.
--
-- POR QUE NAO passar um quadro como image_base64: quadro escolhido por densidade de bytes nao
-- representa o video, e daria ao card selo de "par avaliado" com 14 quadros nao vistos. Trocaria
-- lacuna declarada por garantia falsa - pior que a lacuna.

CREATE OR REPLACE FUNCTION public.pedido_de_anuncio_completo(p_company_id uuid, p_pedido jsonb)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_falta text[] := '{}';
  v_fonte text := nullif(trim(coalesce(p_pedido->>'legenda_fonte','')),'');
  v_legenda text := nullif(trim(coalesce(p_pedido->>'legenda','')),'');
  v_refs jsonb := p_pedido->'legenda_referencias';
  v_drive text := nullif(trim(coalesce(p_pedido->>'drive_file_id','')),'');
  v_midia text := coalesce(v_drive,
                           nullif(trim(coalesce(p_pedido->>'meta_video_id','')),''),
                           nullif(trim(coalesce(p_pedido->>'meta_image_hash','')),''));
  v_risco text; v_produto text; v_base text;
  v_msg text := ''; v_nota text := '';
BEGIN
  IF nullif(trim(coalesce(p_pedido->>'nome_novo','')),'') IS NULL THEN v_falta := array_append(v_falta,'nome do anuncio'); END IF;
  IF nullif(trim(coalesce(p_pedido->>'conjunto_destino','')),'') IS NULL THEN v_falta := array_append(v_falta,'conjunto de destino'); END IF;
  IF v_midia IS NULL THEN v_falta := array_append(v_falta,'a peca criativa (arquivo do Drive ou midia ja enviada)'); END IF;
  IF v_legenda IS NULL THEN v_falta := array_append(v_falta,'a LEGENDA do anuncio'); END IF;

  IF v_fonte IS NULL THEN
    v_falta := array_append(v_falta,'de onde vem a legenda');
  ELSIF v_fonte NOT IN ('humano','herdada_do_molde','agente') THEN
    v_falta := array_append(v_falta,'uma procedencia valida para a legenda (gestor, herdada de anuncio existente, ou escrita pelo sistema)');
  ELSIF v_fonte = 'agente' AND (v_refs IS NULL OR jsonb_array_length(coalesce(v_refs,'[]'::jsonb)) = 0) THEN
    v_falta := array_append(v_falta,'em quais anuncios existentes voce se baseou para escrever a legenda');
  END IF;

  IF array_length(v_falta,1) IS NOT NULL THEN
    v_msg := 'Nao emiti o card porque falta informacao que eu NAO invento. Preciso de: '
          || array_to_string(v_falta, '; ') || '.';
    IF 'a LEGENDA do anuncio' = ANY(v_falta) THEN
      v_msg := v_msg || ' Sobre a legenda: ela nao esta guardada em lugar nenhum do sistema nem vem do Drive - ou voce me passa o texto, ou me autoriza a herdar a legenda do molde, ou me pede para escrever uma com base nos anuncios que ja rodaram. As tres formas servem; o que eu nao faco e inventar texto de anuncio de credito sem voce saber de onde veio.';
    END IF;
    RETURN jsonb_build_object('completo', false, 'faltando', to_jsonb(v_falta), 'mensagem_para_o_gestor', v_msg);
  END IF;

  -- CAMADA 2: a leitura visual que JA existe da peca, se ela vier do Drive. Nota, nunca veto.
  IF v_drive IS NOT NULL THEN
    SELECT riscos_compliance, produto_detectado, base_da_analise
      INTO v_risco, v_produto, v_base
      FROM drive_midia_analises
     WHERE drive_file_id = v_drive AND company_id = p_company_id
     ORDER BY (base_da_analise LIKE '%criterio%') DESC, analisado_em DESC
     LIMIT 1;
    IF v_risco IS NOT NULL AND v_risco NOT IN ('','nenhum','NENHUM') THEN
      v_nota := ' NOTA DA LEITURA VISUAL DESTA PECA (nao e veredito, e informacao para voce decidir): "'
             || left(v_risco, 400) || '" - produto detectado nos quadros: ' || coalesce(v_produto,'nao classificado')
             || ', base da leitura: ' || coalesce(v_base,'?') || '.';
    ELSIF v_produto IS NOT NULL THEN
      v_nota := ' Leitura visual desta peca: nenhum risco anotado, produto detectado ' || v_produto
             || ' (base ' || coalesce(v_base,'?') || ').';
    END IF;
  END IF;

  RETURN jsonb_build_object(
    'completo', true, 'legenda_fonte', v_fonte,
    'compliance_de_texto_obrigatorio', true,
    'nota_visual_da_peca', nullif(v_nota,''),
    'mensagem_para_o_gestor',
      CASE v_fonte
        WHEN 'humano' THEN 'A legenda e sua e sera publicada como escrita. Ela AINDA passa pelo compliance de texto: quem escreveu nao muda a exposicao regulatoria de um anuncio de credito.'
        WHEN 'herdada_do_molde' THEN 'A legenda e reuso de um anuncio que ja rodou, e passa pelo compliance de texto de novo mesmo assim - o texto foi aprovado em outro contexto.'
        WHEN 'agente' THEN 'Eu escrevi esta legenda a partir dos anuncios que voce ve nas referencias. Leia antes de aprovar: autoria minha nao substitui sua decisao.'
      END
      || ' O QUE E AVALIADO E O QUE NAO E, seja explicito com o gestor: o compliance avalia a LEGENDA, por 16 regras com fonte juridica, e pode BLOQUEAR. A peca tem avaliacao visual propria, que vai como nota. NENHUM DOS DOIS AVALIA O PAR texto mais peca junto - nao existe caminho para isso hoje, e prometer que existe seria pior que a lacuna.'
      || coalesce(v_nota,''));
END $$;

COMMENT ON FUNCTION public.pedido_de_anuncio_completo(uuid, jsonb) IS
  'FONTE UNICA do que um pedido de anuncio precisa ter. Legenda obrigatoria e nunca inventada, com procedencia declarada. Anexa a nota da leitura visual da peca quando ela vem do Drive. DECLARA que o compliance avalia legenda e nao o par texto+peca - nao ha caminho tecnico para o par hoje.';

-- Doutrina corrigida: duas camadas, e o que nenhuma delas cobre.
UPDATE agent_context SET
  atualizado = now(),
  fato = replace(fato,
    'AS TRES PASSAM PELO COMPLIANCE, sem excecao: quem escreveu nao muda a exposicao regulatoria. '
    || 'E A HERANCA E A MAIS TRAICOEIRA - o texto foi aprovado para o par antigo texto+peca, e peca nova forma '
    || 'um par que ninguem avaliou. Compliance de credito avalia o PAR, nao o texto isolado. ',
    'AS TRES PASSAM PELO COMPLIANCE DE TEXTO, sem excecao: quem escreveu nao muda a exposicao regulatoria. '
    || 'DUAS CAMADAS, E DIGA AO GESTOR O QUE CADA UMA COBRE: (a) o compliance de TEXTO avalia a legenda por 16 '
    || 'regras com fonte juridica e pode BLOQUEAR - provado em 04/08 com tres niveis (aprovado, atencao, '
    || 'reprovado), citando codigo da regra, trecho e sugestao de reescrita; (b) a leitura visual da peca tem '
    || 'avaliacao propria, que vai como NOTA anexa ao card e nunca bloqueia. '
    || 'NENHUMA DAS DUAS AVALIA O PAR texto mais peca junto, e nao existe caminho tecnico para isso hoje: o '
    || 'compliance aceita imagem em base64, e a peca e arquivo do Drive ou identificador de video na Meta - e '
    || 'para video nao existe "a imagem", existem quinze quadros. DECLARE essa lacuna em vez de deixar o gestor '
    || 'supor que o par foi avaliado. ')
WHERE vigente AND fato LIKE 'LEGENDA DE ANUNCIO E ENTRADA OBRIGATORIA%';