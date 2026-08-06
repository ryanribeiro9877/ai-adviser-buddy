-- ESPELHO DE MIGRACAO APLICADA
-- version: 20260805120154
-- name: gt13_peca_fora_da_biblioteca_impede_o_card
-- projeto: gzjwnjdpxpbmdhcyefvs (Gestor de Trafego IA)
-- aplicada por: Claude via MCP apply_migration
-- espelho gerado a partir de supabase_migrations.schema_migrations - NAO transcrito a mao

-- 05/08/2026 - CONSERTO DE DEFEITO MEU, achado pelo Claude Code no GT-13.
--
-- O QUE ESTAVA ERRADO: peca que ainda nao subiu para a biblioteca da conta devolvia
-- completo:true com peca_ja_na_biblioteca:false e o alerta APENAS na mensagem. Isso e classificar
-- um IMPEDIMENTO como aviso: sem a midia na biblioteca o anuncio nao tem o que publicar e a
-- execucao falha DEPOIS da aprovacao - e aprovar card de anuncio e o unico ato que inicia gasto.
-- Card que nao pode dar certo nao deve ser emitido.
--
-- Ele barrou no fluxo, usando a mensagem da funcao, sem inventar recusa - comportamento certo.
-- Mas o lugar do conserto e AQUI: se a funcao e fonte unica do que um pedido precisa, ela tem de
-- recusar o que nao pode dar certo, em vez de o chamador compensar. Doutrina compensada no
-- chamador e doutrina em dois lugares.
CREATE OR REPLACE FUNCTION public.pedido_de_anuncio_completo(p_company_id uuid, p_pedido jsonb)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_falta text[] := '{}';
  v_tipo text;
  v_fonte text := nullif(trim(coalesce(p_pedido->>'legenda_fonte','')),'');
  v_legenda text := nullif(trim(coalesce(p_pedido->>'legenda','')),'');
  v_refs jsonb := p_pedido->'legenda_referencias';
  v_drive text := nullif(trim(coalesce(p_pedido->>'drive_file_id','')),'');
  v_video text := nullif(trim(coalesce(p_pedido->>'meta_video_id','')),'');
  v_hash  text := nullif(trim(coalesce(p_pedido->>'meta_image_hash','')),'');
  v_molde text := coalesce(nullif(trim(coalesce(p_pedido->>'molde','')),''),
                           nullif(trim(coalesce(p_pedido->>'molde_nome','')),''),
                           nullif(trim(coalesce(p_pedido->>'molde_creative_id','')),''));
  v_midia text := coalesce(v_drive, v_video, v_hash);
  v_risco text; v_produto text; v_base text; v_nome_peca text;
  v_ja_na_meta boolean; v_video_resolvido text;
  v_msg text := ''; v_nota text := '';
BEGIN
  v_tipo := CASE
    WHEN nullif(trim(coalesce(p_pedido->>'tipo_de_pedido','')),'') IS NOT NULL THEN p_pedido->>'tipo_de_pedido'
    WHEN v_midia IS NOT NULL THEN 'peca_nova'
    WHEN v_molde IS NOT NULL THEN 'replicacao_pura'
    ELSE NULL END;

  IF v_tipo IS NULL THEN
    RETURN jsonb_build_object('completo', false, 'tipo_de_pedido', null,
      'faltando', to_jsonb(ARRAY['saber que anuncio voce quer: replicar um que ja roda, ou publicar uma peca nova']),
      'mensagem_para_o_gestor', 'Nao consegui entender o pedido. Existem duas coisas diferentes: REPLICAR um anuncio que ja roda para outro conjunto (escalar o que funciona), ou publicar uma PECA NOVA do acervo. Diga qual, porque as duas exigem informacoes diferentes.');
  END IF;
  IF v_tipo NOT IN ('replicacao_pura','peca_nova') THEN
    RETURN jsonb_build_object('completo', false, 'tipo_de_pedido', v_tipo,
      'mensagem_para_o_gestor', 'Tipo de pedido desconhecido. Os validos sao replicar anuncio existente ou publicar peca nova.');
  END IF;

  IF nullif(trim(coalesce(p_pedido->>'nome_novo','')),'') IS NULL THEN v_falta := array_append(v_falta,'nome do anuncio'); END IF;
  IF nullif(trim(coalesce(p_pedido->>'conjunto_destino','')),'') IS NULL THEN v_falta := array_append(v_falta,'conjunto de destino'); END IF;

  IF v_tipo = 'replicacao_pura' THEN
    IF v_molde IS NULL THEN v_falta := array_append(v_falta,'qual anuncio existente replicar'); END IF;
  ELSE
    IF v_midia IS NULL THEN v_falta := array_append(v_falta,'a peca criativa (arquivo do Drive ou midia ja enviada)'); END IF;
    IF v_legenda IS NULL THEN v_falta := array_append(v_falta,'a LEGENDA do anuncio'); END IF;
    IF v_fonte IS NULL THEN
      v_falta := array_append(v_falta,'de onde vem a legenda');
    ELSIF v_fonte NOT IN ('humano','herdada_do_molde','agente') THEN
      v_falta := array_append(v_falta,'uma procedencia valida para a legenda (gestor, herdada de anuncio existente, ou escrita pelo sistema)');
    ELSIF v_fonte = 'agente' AND (v_refs IS NULL OR jsonb_array_length(coalesce(v_refs,'[]'::jsonb)) = 0) THEN
      v_falta := array_append(v_falta,'em quais anuncios existentes voce se baseou para escrever a legenda');
    END IF;

    -- IMPEDIMENTO, nao aviso: sem midia na biblioteca o card nao pode dar certo.
    IF v_drive IS NOT NULL THEN
      SELECT m.meta_video_id, d.nome INTO v_video_resolvido, v_nome_peca
        FROM drive_midia_analises d
        LEFT JOIN media_uploads m ON m.drive_file_id = d.drive_file_id AND m.status='enviado'
       WHERE d.drive_file_id = v_drive AND d.company_id = p_company_id LIMIT 1;
      v_ja_na_meta := (v_video_resolvido IS NOT NULL);
      IF v_ja_na_meta IS NOT TRUE THEN
        v_falta := array_append(v_falta,'a peca enviada para a biblioteca da conta (ela esta no Drive e ainda nao foi enviada)');
      END IF;
    ELSE
      v_ja_na_meta := true;  -- veio identificador da Meta direto: ja esta la por definicao
    END IF;
  END IF;

  IF array_length(v_falta,1) IS NOT NULL THEN
    v_msg := 'Nao emiti o card porque falta informacao ou condicao que eu NAO contorno. Preciso de: ' || array_to_string(v_falta,'; ') || '.';
    IF 'a LEGENDA do anuncio' = ANY(v_falta) THEN
      v_msg := v_msg || ' Sobre a legenda: ela nao esta guardada em lugar nenhum do sistema nem vem do Drive - ou voce me passa o texto, ou me autoriza a herdar a legenda de um anuncio que ja roda, ou me pede para escrever uma com base nos que ja rodaram.';
    END IF;
    IF 'a peca criativa (arquivo do Drive ou midia ja enviada)' = ANY(v_falta) THEN
      v_msg := v_msg || ' Se a sua intencao era ESCALAR um anuncio que ja funciona para outro conjunto, isso e outro pedido e nao precisa de peca nova - diga qual anuncio replicar.';
    END IF;
    IF v_drive IS NOT NULL AND v_ja_na_meta IS NOT TRUE THEN
      v_msg := v_msg || ' Sobre a peca ' || coalesce(v_nome_peca, v_drive) || ': ela existe no Drive e foi analisada, mas NAO esta na biblioteca da conta - e sem isso o anuncio nao tem o que publicar. Um card assim seria aprovado e falharia na execucao, e aprovar card de anuncio e o ato que inicia o gasto. Envie a midia primeiro.';
    END IF;
    RETURN jsonb_build_object('completo', false, 'tipo_de_pedido', v_tipo, 'faltando', to_jsonb(v_falta),
                              'peca_ja_na_biblioteca', v_ja_na_meta, 'mensagem_para_o_gestor', v_msg);
  END IF;

  IF v_drive IS NOT NULL THEN
    SELECT riscos_compliance, produto_detectado, base_da_analise
      INTO v_risco, v_produto, v_base
      FROM drive_midia_analises
     WHERE drive_file_id = v_drive AND company_id = p_company_id
     ORDER BY (base_da_analise LIKE '%criterio%') DESC, analisado_em DESC LIMIT 1;
    IF v_risco IS NOT NULL AND v_risco NOT IN ('','nenhum','NENHUM') THEN
      v_nota := ' NOTA DA LEITURA VISUAL DESTA PECA (nao e veredito, e informacao para voce decidir): "'
             || left(v_risco,400) || '" - produto detectado nos quadros: ' || coalesce(v_produto,'nao classificado')
             || ', base da leitura: ' || coalesce(v_base,'?') || '.';
    ELSIF v_produto IS NOT NULL THEN
      v_nota := ' Leitura visual desta peca: nenhum risco anotado, produto detectado ' || v_produto || ' (base ' || coalesce(v_base,'?') || ').';
    END IF;
  END IF;

  RETURN jsonb_build_object(
    'completo', true, 'tipo_de_pedido', v_tipo,
    'legenda_fonte', CASE WHEN v_tipo='replicacao_pura' THEN 'herdada_do_molde' ELSE v_fonte END,
    'compliance_de_texto_obrigatorio', true,
    'peca_ja_na_biblioteca', v_ja_na_meta,
    'meta_video_id_resolvido', v_video_resolvido,
    'nota_visual_da_peca', nullif(v_nota,''),
    'mensagem_para_o_gestor',
      CASE v_tipo
        WHEN 'replicacao_pura' THEN
          'Este pedido REPLICA um anuncio que ja roda para outro conjunto - e escalar o que funciona, nao publicar peca nova. O anuncio nasce IDENTICO ao original, criativo e texto inclusive, e isso e o proposito. A legenda vem do proprio anuncio de origem e passa pelo compliance de texto de novo mesmo assim.'
        ELSE
          CASE v_fonte
            WHEN 'humano' THEN 'A legenda e sua e sera publicada como escrita. Ela AINDA passa pelo compliance de texto: quem escreveu nao muda a exposicao regulatoria de um anuncio de credito.'
            WHEN 'herdada_do_molde' THEN 'A legenda e reuso do texto de um anuncio que ja rodou, mas a PECA e nova - entao passa pelo compliance de texto de novo.'
            WHEN 'agente' THEN 'Eu escrevi esta legenda a partir dos anuncios que voce ve nas referencias. Leia antes de aprovar: autoria minha nao substitui sua decisao.'
          END
      END
      || ' O QUE E AVALIADO E O QUE NAO E, seja explicito com o gestor: o compliance avalia a LEGENDA, por 16 regras com fonte juridica, e pode BLOQUEAR. Quando ha peca do acervo, ela tem avaliacao visual propria, que vai como nota. NENHUM DOS DOIS AVALIA O PAR texto mais peca junto - nao existe caminho para isso hoje, e prometer que existe seria pior que a lacuna.'
      || coalesce(v_nota,''));
END $$;