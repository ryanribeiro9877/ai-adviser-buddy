-- ESPELHO DE MIGRACAO APLICADA
-- version: 20260807124802
-- name: pedido_de_anuncio_recusa_carrossel_e_foto_antes_do_card
-- projeto: gzjwnjdpxpbmdhcyefvs (Gestor de Trafego IA)
-- aplicada por: Claude via MCP apply_migration
-- espelho gerado a partir de supabase_migrations.schema_migrations - NAO transcrito a mao

-- LADO DA VERIFICACAO: o card de carrossel/foto nao chega a aprovacao.
--
-- Par da migracao carrossel_e_foto_recusam_por_nome_nos_dois_lados. La o CONTRATO passou a
-- invalidar campo declarado suportado=false; aqui a verificacao operacional recusa o mesmo pedido,
-- com o MESMO nome, e antes de tudo.
--
-- POR QUE ANTES DE INFERIR O TIPO: um pedido de carrossel nao e um pedido de peca nova ao qual
-- falta alguma coisa - e um pedido sem execucao possivel. Responder "faltou a legenda" mandaria o
-- gestor completar um card que, aprovado, publicaria a peca ERRADA. A ordem das perguntas e parte
-- da correcao, nao detalhe.
--
-- A LISTA NAO ESTA NESTA FUNCAO: vem de contrato_de_execucao (suportado=false), a mesma fonte que
-- validar_pedido_contra_contrato le. Escrever os nomes dos campos aqui seria a terceira copia da
-- mesma regra, e este projeto ja pagou por isso.
--
-- meta_image_hash SAI DE v_midia. Ele fazia parte da inferencia "tem midia, logo e peca_nova" -
-- uma rota que nunca teve execucao correspondente no meta-actions. Mantida, a inferencia
-- continuaria descrevendo um caminho que nao existe.

CREATE OR REPLACE FUNCTION public.pedido_de_anuncio_completo(p_company_id uuid, p_pedido jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_falta text[] := '{}';
  v_tipo text;
  v_fonte text := nullif(trim(coalesce(p_pedido->>'legenda_fonte','')),'');
  v_legenda text := nullif(trim(coalesce(p_pedido->>'legenda','')),'');
  v_refs jsonb := p_pedido->'legenda_referencias';
  v_drive text := nullif(trim(coalesce(p_pedido->>'drive_file_id','')),'');
  v_video text := nullif(trim(coalesce(p_pedido->>'meta_video_id','')),'');
  v_molde text := coalesce(nullif(trim(coalesce(p_pedido->>'creative_id','')),''),
                           nullif(trim(coalesce(p_pedido->>'molde','')),''),
                           nullif(trim(coalesce(p_pedido->>'molde_nome','')),''),
                           nullif(trim(coalesce(p_pedido->>'molde_creative_id','')),''));
  v_conjunto text := coalesce(
    nullif(trim(coalesce(p_pedido->>'conjunto_destino_external_id','')),''),
    nullif(trim(coalesce(p_pedido->>'conjunto_destino','')),'')
  );
  v_conta text := nullif(trim(coalesce(p_pedido->>'conta_destino','')),'');
  v_midia text;
  v_ns_campo text; v_ns_recusa text; v_ns_msg text;
  v_risco text; v_produto text; v_base text; v_nome_peca text;
  v_ja_na_meta boolean; v_video_resolvido text;
  v_bloq jsonb := jsonb_build_object('bloqueada', false);
  v_msg text := ''; v_nota text := '';
BEGIN
  -- FORMATO SEM CAMINHO NO EXECUTOR VEM PRIMEIRO, antes ate de inferir o tipo de pedido.
  SELECT c.campo, c.recusa_nomeada, c.mensagem_de_recusa
    INTO v_ns_campo, v_ns_recusa, v_ns_msg
    FROM public.contrato_de_execucao c
   WHERE c.acao = 'criar_anuncio_a_partir_de' AND c.vigente AND NOT c.suportado
     AND public.campo_presente_no_pedido(p_pedido, c.campo)
   ORDER BY c.campo
   LIMIT 1;
  IF v_ns_campo IS NOT NULL THEN
    RETURN jsonb_build_object(
      'completo', false,
      'recusa', coalesce(v_ns_recusa, 'campo_nao_suportado'),
      'campo_nao_suportado', v_ns_campo,
      'tipo_de_pedido', nullif(trim(coalesce(p_pedido->>'tipo_de_pedido','')),''),
      'faltando', to_jsonb(ARRAY['um formato de anuncio que esta executora saiba publicar (video novo, ou replicacao de um anuncio existente)']),
      'mensagem_para_o_gestor', coalesce(v_ns_msg,
        'Este pedido usa ' || v_ns_campo || ', que o executor nao suporta. O card nao foi emitido.'));
  END IF;

  -- meta_image_hash NAO entra mais em v_midia: ele agora recusa acima.
  v_midia := coalesce(v_drive, v_video);

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
  IF v_conjunto IS NULL THEN v_falta := array_append(v_falta,'conjunto de destino (conjunto_destino_external_id)'); END IF;
  IF v_conta IS NULL THEN v_falta := array_append(v_falta,'a conta de anuncios onde o anuncio nasce (conta_destino, formato act_<id>)'); END IF;

  -- O MOLDE E EXIGENCIA DAS DUAS ROTAS, como em montarCriacao (guarda incondicional).
  IF v_molde IS NULL THEN
    v_falta := array_append(v_falta,
      CASE v_tipo
        WHEN 'replicacao_pura' THEN 'qual anuncio existente replicar (creative_id do molde)'
        ELSE 'o anuncio molde de onde herdar pagina, link de destino e CTA (creative_id)'
      END);
  END IF;

  IF v_tipo = 'peca_nova' THEN
    IF v_midia IS NULL THEN v_falta := array_append(v_falta,'a peca criativa (arquivo do Drive ou midia ja enviada)'); END IF;
    IF v_legenda IS NULL THEN v_falta := array_append(v_falta,'a LEGENDA do anuncio'); END IF;
    IF v_fonte IS NULL THEN
      v_falta := array_append(v_falta,'de onde vem a legenda (legenda_fonte)');
    ELSIF v_fonte NOT IN ('humano','herdada_do_molde','agente') THEN
      v_falta := array_append(v_falta,'uma procedencia valida para a legenda (gestor, herdada de anuncio existente, ou escrita pelo sistema)');
    ELSIF v_fonte = 'agente' AND (v_refs IS NULL OR jsonb_array_length(coalesce(v_refs,'[]'::jsonb)) = 0) THEN
      v_falta := array_append(v_falta,'em quais anuncios existentes voce se baseou para escrever a legenda');
    END IF;

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
      v_ja_na_meta := true;
    END IF;

    v_bloq := public.peca_bloqueada_por_revisao(p_company_id, v_drive, coalesce(v_video, v_video_resolvido));
    IF (v_bloq->>'bloqueada')::boolean IS TRUE THEN
      v_falta := array_append(v_falta,'o veredito do responsavel sobre esta peca, que esta em revisao de compliance e marcada para nao ser usada');
    END IF;
  END IF;

  IF array_length(v_falta,1) IS NOT NULL THEN
    v_msg := 'Nao emiti o card porque falta informacao ou condicao que eu NAO contorno. Preciso de: ' || array_to_string(v_falta,'; ') || '.';
    IF 'a LEGENDA do anuncio' = ANY(v_falta) THEN
      v_msg := v_msg || ' Sobre a legenda: ela nao esta guardada em lugar nenhum do sistema nem vem do Drive - ou voce me passa o texto, ou me autoriza a herdar a legenda de um anuncio que ja roda, ou me pede para escrever uma com base nos que ja rodaram.';
    END IF;
    IF 'o anuncio molde de onde herdar pagina, link de destino e CTA (creative_id)' = ANY(v_falta) THEN
      v_msg := v_msg || ' Sobre o molde: publicar PECA NOVA tambem exige um anuncio existente como base, e isso nao e o mesmo que replicar. A peca e a sua, nova; o que vem do molde e a configuracao que faz um anuncio funcionar - a pagina que assina, a URL de destino e o botao. Nada disso esta em tabela deste sistema: vive dentro do criativo do molde, e eu nao vou inventar URL de destino de anuncio de credito. Diga qual anuncio que ja roda serve de base.';
    END IF;
    IF 'a peca criativa (arquivo do Drive ou midia ja enviada)' = ANY(v_falta) THEN
      v_msg := v_msg || ' Se a sua intencao era ESCALAR um anuncio que ja funciona para outro conjunto, isso e outro pedido e nao precisa de peca nova - diga qual anuncio replicar.';
    END IF;
    IF v_drive IS NOT NULL AND v_ja_na_meta IS NOT TRUE THEN
      v_msg := v_msg || ' Sobre a peca ' || coalesce(v_nome_peca, v_drive) || ': ela existe no Drive e foi analisada, mas NAO esta na biblioteca da conta - e sem isso o anuncio nao tem o que publicar. Um card assim seria aprovado e falharia na execucao, e aprovar card de anuncio e o ato que inicia o gasto. Envie a midia primeiro.';
    END IF;
    IF (v_bloq->>'bloqueada')::boolean IS TRUE THEN
      v_msg := v_msg || ' ' || coalesce(v_bloq->>'mensagem','');
    END IF;
    RETURN jsonb_build_object('completo', false, 'tipo_de_pedido', v_tipo, 'faltando', to_jsonb(v_falta),
                              'peca_ja_na_biblioteca', v_ja_na_meta,
                              'peca_em_revisao', v_bloq,
                              'mensagem_para_o_gestor', v_msg);
  END IF;

  v_nota := coalesce(public.nota_visual_da_peca(p_company_id, v_drive), '');

  RETURN jsonb_build_object(
    'completo', true, 'tipo_de_pedido', v_tipo,
    'legenda_fonte', CASE WHEN v_tipo='replicacao_pura' THEN 'herdada_do_molde' ELSE v_fonte END,
    'conjunto_destino_external_id', v_conjunto,
    'conta_destino', v_conta,
    'creative_id', v_molde,
    'compliance_de_texto_obrigatorio', true,
    'peca_ja_na_biblioteca', v_ja_na_meta,
    'peca_em_revisao', v_bloq,
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
END $function$;

comment on function public.pedido_de_anuncio_completo(uuid, jsonb) is
  'Verifica se o pedido de anuncio esta completo ANTES de emitir card. Fala o MESMO vocabulario de contrato_de_execucao para criar_anuncio_a_partir_de, que por sua vez veio de montarCriacao: creative_id (molde), conjunto_destino_external_id, conta_destino, nome_novo obrigatorios NAS DUAS ROTAS - em peca nova o molde e a unica fonte de page_id, link e CTA que o executor copia. meta_video_id/drive_file_id/legenda/legenda_fonte/legenda_referencias/url_tags/thumbnail_url/tipo_de_pedido opcionais conforme a rota. FORMATO NAO SUPORTADO recusa antes de tudo, com o nome do executor: child_attachments (carrossel_nao_suportado) e meta_image_hash (foto_nao_suportada) - a lista vem de contrato_de_execucao.suportado=false, nao esta escrita na funcao. Alias legado aceitos: conjunto_destino, molde, molde_nome, molde_creative_id. status_inicial NAO e entrada - o executor forca PAUSED. Equivalencia com validar_pedido_contra_contrato e medida pela PO-17 v2.';
