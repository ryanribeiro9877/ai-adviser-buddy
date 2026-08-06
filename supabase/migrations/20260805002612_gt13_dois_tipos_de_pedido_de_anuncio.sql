-- ESPELHO DE MIGRACAO APLICADA
-- version: 20260805002612
-- name: gt13_dois_tipos_de_pedido_de_anuncio
-- projeto: gzjwnjdpxpbmdhcyefvs (Gestor de Trafego IA)
-- aplicada por: Claude via MCP apply_migration
-- espelho gerado a partir de supabase_migrations.schema_migrations - NAO transcrito a mao

-- 04/08/2026 - CONSERTO DE DEFEITO DE DESENHO MEU, achado pelo Claude Code.
--
-- O QUE EU ERREI: escrevi pedido_de_anuncio_completo exigindo peca criativa SEMPRE. Mas
-- criar_anuncio_a_partir_de existe para ESCALAR CRIATIVO VENCEDOR para outro conjunto - replica o
-- creative_id do molde e nao traz peca nova. Com a minha exigencia, esse caminho - o unico de
-- criacao de anuncio que o sistema tem hoje - seria recusado 100% das vezes.
-- Desenhei para o caso novo e esqueci o que ja funciona. E a mesma classe de erro que cometi
-- varias vezes hoje: otimizar para o defeito que estou consertando e quebrar o que estava certo.
--
-- POR QUE NAO A SAIDA DE "NAO CHAMAR A RPC NO RAMO DE REPLICACAO": ele propos isso por deferencia,
-- e eu recuso. Se a funcao e fonte unica do que um pedido precisa, ela tem de conhecer OS DOIS
-- pedidos. Deixar um ramo sem validacao poe a doutrina em dois lugares - exatamente o defeito que
-- este projeto passou o dia matando.
--
-- DOIS TIPOS, cada um com suas exigencias:
--   replicacao_pura : escalar criativo que ja roda. Exige molde. NAO exige peca nem legenda de
--                     entrada - a legenda vem do proprio criativo do molde, e o compliance roda
--                     sobre ela. O anuncio nasce IDENTICO ao molde, e isso e o proposito.
--   peca_nova       : anuncio com peca do Drive ou midia ja enviada. Exige a peca E a legenda com
--                     procedencia declarada.
-- O tipo e INFERIDO dos campos presentes, e DECLARADO no retorno - inferir em silencio seria
-- outra armadilha.

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
  v_risco text; v_produto text; v_base text; v_ja_na_meta boolean;
  v_msg text := ''; v_nota text := '';
BEGIN
  -- 1) Que pedido e este? Inferido, e declarado.
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

  -- 2) Comuns aos dois
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
  END IF;

  IF array_length(v_falta,1) IS NOT NULL THEN
    v_msg := 'Nao emiti o card porque falta informacao que eu NAO invento. Preciso de: ' || array_to_string(v_falta,'; ') || '.';
    IF 'a LEGENDA do anuncio' = ANY(v_falta) THEN
      v_msg := v_msg || ' Sobre a legenda: ela nao esta guardada em lugar nenhum do sistema nem vem do Drive - ou voce me passa o texto, ou me autoriza a herdar a legenda de um anuncio que ja roda, ou me pede para escrever uma com base nos que ja rodaram. As tres formas servem; o que eu nao faco e inventar texto de anuncio de credito sem voce saber de onde veio.';
    END IF;
    IF 'a peca criativa (arquivo do Drive ou midia ja enviada)' = ANY(v_falta) THEN
      v_msg := v_msg || ' Se a sua intencao era ESCALAR um anuncio que ja funciona para outro conjunto, isso e outro pedido e nao precisa de peca nova - diga qual anuncio replicar.';
    END IF;
    RETURN jsonb_build_object('completo', false, 'tipo_de_pedido', v_tipo, 'faltando', to_jsonb(v_falta), 'mensagem_para_o_gestor', v_msg);
  END IF;

  -- 3) Nota da leitura visual, quando a peca vem do Drive. E o aviso de peca nao enviada.
  IF v_drive IS NOT NULL THEN
    SELECT riscos_compliance, produto_detectado, base_da_analise
      INTO v_risco, v_produto, v_base
      FROM drive_midia_analises
     WHERE drive_file_id = v_drive AND company_id = p_company_id
     ORDER BY (base_da_analise LIKE '%criterio%') DESC, analisado_em DESC LIMIT 1;
    SELECT EXISTS (SELECT 1 FROM media_uploads m WHERE m.drive_file_id = v_drive AND m.status='enviado')
      INTO v_ja_na_meta;
    IF v_risco IS NOT NULL AND v_risco NOT IN ('','nenhum','NENHUM') THEN
      v_nota := ' NOTA DA LEITURA VISUAL DESTA PECA (nao e veredito, e informacao para voce decidir): "'
             || left(v_risco,400) || '" - produto detectado nos quadros: ' || coalesce(v_produto,'nao classificado')
             || ', base da leitura: ' || coalesce(v_base,'?') || '.';
    ELSIF v_produto IS NOT NULL THEN
      v_nota := ' Leitura visual desta peca: nenhum risco anotado, produto detectado ' || v_produto || ' (base ' || coalesce(v_base,'?') || ').';
    END IF;
    IF v_ja_na_meta IS NOT TRUE THEN
      v_nota := v_nota || ' ATENCAO: esta peca AINDA NAO foi enviada para a biblioteca da conta - sem isso o anuncio nao tem o que publicar e a execucao falha. Envie a midia antes.';
    END IF;
  END IF;

  RETURN jsonb_build_object(
    'completo', true, 'tipo_de_pedido', v_tipo,
    'legenda_fonte', CASE WHEN v_tipo='replicacao_pura' THEN 'herdada_do_molde' ELSE v_fonte END,
    'compliance_de_texto_obrigatorio', true,
    'peca_ja_na_biblioteca', v_ja_na_meta,
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

COMMENT ON FUNCTION public.pedido_de_anuncio_completo(uuid, jsonb) IS
  'FONTE UNICA do que um pedido de anuncio precisa ter, e conhece OS DOIS tipos: replicacao_pura (escalar anuncio que ja roda - exige molde, nao exige peca nem legenda de entrada) e peca_nova (exige peca do acervo e legenda com procedencia declarada). O tipo e inferido dos campos presentes e DECLARADO no retorno. Anexa a nota da leitura visual e avisa quando a peca ainda nao esta na biblioteca da conta.';