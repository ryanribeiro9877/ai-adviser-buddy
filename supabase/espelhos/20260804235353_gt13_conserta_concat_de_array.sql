-- ESPELHO DE MIGRACAO APLICADA
-- version: 20260804235353
-- name: gt13_conserta_concat_de_array
-- projeto: gzjwnjdpxpbmdhcyefvs (Gestor de Trafego IA)
-- aplicada por: Claude via MCP apply_migration
-- espelho gerado a partir de supabase_migrations.schema_migrations - NAO transcrito a mao

-- 04/08/2026 - Conserto: em plpgsql, "text[] || 'texto'" tenta interpretar a string como LITERAL
-- de array e falha com 22P02. Precisa de array_append ou ARRAY['texto']. Armadilha de Postgres que
-- vale guardar: a concatenacao de array aceita elemento, mas o parser resolve o literal antes.
CREATE OR REPLACE FUNCTION public.pedido_de_anuncio_completo(p_company_id uuid, p_pedido jsonb)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_falta text[] := '{}';
  v_fonte text := nullif(trim(coalesce(p_pedido->>'legenda_fonte','')),'');
  v_legenda text := nullif(trim(coalesce(p_pedido->>'legenda','')),'');
  v_refs jsonb := p_pedido->'legenda_referencias';
  v_midia text := coalesce(nullif(trim(coalesce(p_pedido->>'drive_file_id','')),''),
                           nullif(trim(coalesce(p_pedido->>'meta_video_id','')),''),
                           nullif(trim(coalesce(p_pedido->>'meta_image_hash','')),''));
  v_msg text := '';
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

  IF array_length(v_falta,1) IS NULL THEN
    RETURN jsonb_build_object(
      'completo', true, 'legenda_fonte', v_fonte, 'exige_compliance_do_par', true,
      'mensagem_para_o_gestor',
        CASE v_fonte
          WHEN 'humano' THEN 'A legenda e sua e sera publicada como escrita. Ela AINDA passa pelo compliance: quem escreveu nao muda a exposicao regulatoria de um anuncio de credito.'
          WHEN 'herdada_do_molde' THEN 'ATENCAO: a legenda e reuso de um anuncio que ja rodou, mas a PECA e nova - e compliance avalia o PAR texto mais imagem, nao o texto sozinho. A aprovacao anterior valeu para o par anterior, entao este par sera avaliado de novo.'
          WHEN 'agente' THEN 'Eu escrevi esta legenda a partir dos anuncios que voce ve nas referencias. Leia antes de aprovar: autoria minha nao substitui sua decisao, e o compliance avalia o par completo.'
        END);
  END IF;

  v_msg := 'Nao emiti o card porque falta informacao que eu NAO invento. Preciso de: '
        || array_to_string(v_falta, '; ') || '.';
  IF 'a LEGENDA do anuncio' = ANY(v_falta) THEN
    v_msg := v_msg || ' Sobre a legenda: ela nao esta guardada em lugar nenhum do sistema nem vem do Drive - ou voce me passa o texto, ou me autoriza a herdar a legenda do molde, ou me pede para escrever uma com base nos anuncios que ja rodaram. As tres formas servem; o que eu nao faco e inventar texto de anuncio de credito sem voce saber de onde veio.';
  END IF;

  RETURN jsonb_build_object('completo', false, 'faltando', to_jsonb(v_falta), 'mensagem_para_o_gestor', v_msg);
END $$;