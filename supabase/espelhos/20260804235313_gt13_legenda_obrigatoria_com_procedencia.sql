-- ESPELHO DE MIGRACAO APLICADA
-- version: 20260804235313
-- name: gt13_legenda_obrigatoria_com_procedencia
-- projeto: gzjwnjdpxpbmdhcyefvs (Gestor de Trafego IA)
-- aplicada por: Claude via MCP apply_migration
-- espelho gerado a partir de supabase_migrations.schema_migrations - NAO transcrito a mao

-- 04/08/2026 - GT-13, fundacao: A LEGENDA E ENTRADA OBRIGATORIA DO PEDIDO DE ANUNCIO.
--
-- DECISAO DO RYAN (04/08): a legenda NAO vive no Drive nem e pre-definida em lugar nenhum - e
-- externa e entra no PEDIDO. Se o gestor nao informar, o agente EXIGE, exatamente como ja faz com
-- orcamento. E ela pode chegar por tres caminhos: dentro do pedido, separada do pedido, ou escrita
-- pelo proprio agente a partir de analise dos criativos que ja rodaram.
--
-- O QUE AMARRA O DESENHO: compliance de credito consignado NAO se importa com quem escreveu. As
-- tres procedencias passam pelo mesmo portao bloqueante. E a HERDADA e a mais traicoeira: o texto
-- foi aprovado para o par antigo texto+peca, e peca nova faz um par que ninguem avaliou.
--
-- 1) Procedencia gravada no espelho do anuncio, para auditoria depois do fato.
ALTER TABLE public.ads
  ADD COLUMN IF NOT EXISTS legenda_fonte text,
  ADD COLUMN IF NOT EXISTS legenda_referencias jsonb,
  ADD COLUMN IF NOT EXISTS compliance_verificado_em timestamptz;

COMMENT ON COLUMN public.ads.legenda_fonte IS
  'De onde veio a legenda: "humano" (o gestor escreveu), "herdada_do_molde" (reuso de texto de anuncio existente) ou "agente" (o sistema escreveu a partir de analise). NULL nos anuncios legados, que sao anteriores a esta rastreabilidade.';
COMMENT ON COLUMN public.ads.legenda_referencias IS
  'Quando legenda_fonte = "agente": em quais anuncios existentes ele se baseou. Autoria do sistema tem de ser rastreavel ate a evidencia que a sustentou.';
COMMENT ON COLUMN public.ads.compliance_verificado_em IS
  'Quando o par LEGENDA + PECA foi avaliado pelo compliance. Par novo exige avaliacao nova, mesmo que o texto seja reuso de um aprovado: aprovacao anterior valeu para o par anterior.';

-- 2) UMA fonte para "o que um pedido de anuncio precisa ter" - mesmo padrao de
--    pode_executar_acao e avaliar_orcamento_diario: a regra tem um dono, e a mensagem ao gestor
--    e composta aqui para nao divergir entre chamadores.
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
  IF nullif(trim(coalesce(p_pedido->>'nome_novo','')),'') IS NULL THEN v_falta := v_falta || 'nome do anuncio'; END IF;
  IF nullif(trim(coalesce(p_pedido->>'conjunto_destino','')),'') IS NULL THEN v_falta := v_falta || 'conjunto de destino'; END IF;
  IF v_midia IS NULL THEN v_falta := v_falta || 'a peca criativa (arquivo do Drive ou midia ja enviada)'; END IF;
  IF v_legenda IS NULL THEN v_falta := v_falta || 'a LEGENDA do anuncio'; END IF;

  IF v_fonte IS NULL THEN
    v_falta := v_falta || 'de onde vem a legenda';
  ELSIF v_fonte NOT IN ('humano','herdada_do_molde','agente') THEN
    v_falta := v_falta || 'uma procedencia valida para a legenda (gestor, herdada de anuncio existente, ou escrita pelo sistema)';
  ELSIF v_fonte = 'agente' AND (v_refs IS NULL OR jsonb_array_length(coalesce(v_refs,'[]'::jsonb)) = 0) THEN
    v_falta := v_falta || 'em quais anuncios existentes voce se baseou para escrever a legenda';
  END IF;

  IF array_length(v_falta,1) IS NULL THEN
    RETURN jsonb_build_object(
      'completo', true, 'legenda_fonte', v_fonte,
      'exige_compliance_do_par', true,
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

  RETURN jsonb_build_object('completo', false, 'faltando', to_jsonb(v_falta),
                            'mensagem_para_o_gestor', v_msg);
END $$;

COMMENT ON FUNCTION public.pedido_de_anuncio_completo(uuid, jsonb) IS
  'FONTE UNICA do que um pedido de anuncio precisa ter. Chamada ANTES de montar payload de card. A legenda e obrigatoria e nunca inventada - mesmo padrao do orcamento. Devolve mensagem pronta ao gestor, com o aviso especifico de cada procedencia.';

REVOKE ALL ON FUNCTION public.pedido_de_anuncio_completo(uuid, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.pedido_de_anuncio_completo(uuid, jsonb) TO authenticated, service_role;

-- 3) A doutrina, para o agente.
INSERT INTO agent_context (categoria, fato, vigente, desde, atualizado, company_id)
VALUES ('doutrina',
  'LEGENDA DE ANUNCIO E ENTRADA OBRIGATORIA DO PEDIDO - NUNCA INVENTADA (decisao do Ryan, 04/08/2026). '
  || 'A legenda NAO existe no Drive nem esta guardada em lugar nenhum do sistema: ela e externa e vem no '
  || 'pedido. Se o gestor pedir um anuncio sem informar legenda, EXIJA - do mesmo jeito que voce ja exige '
  || 'orcamento, e pelo mesmo motivo: texto de anuncio de credito nao se adivinha. '
  || 'TRES PROCEDENCIAS VALIDAS, e voce sempre declara qual usou: (1) HUMANO - o gestor escreveu, no pedido '
  || 'ou em mensagem separada; (2) HERDADA DO MOLDE - reuso do texto de um anuncio que ja rodou, mediante '
  || 'autorizacao dele; (3) AGENTE - voce escreve a partir de ANALISE dos anuncios existentes, e nesse caso '
  || 'DECLARA em quais se baseou. Autoria sua tem de ser rastreavel ate a evidencia. '
  || 'AS TRES PASSAM PELO COMPLIANCE, sem excecao: quem escreveu nao muda a exposicao regulatoria. '
  || 'E A HERANCA E A MAIS TRAICOEIRA - o texto foi aprovado para o par antigo texto+peca, e peca nova forma '
  || 'um par que ninguem avaliou. Compliance de credito avalia o PAR, nao o texto isolado. '
  || 'Ao propor anuncio, use a verificacao de pedido completo antes de montar qualquer card: ela diz o que '
  || 'falta em linguagem de negocio. Nao preencha lacuna com suposicao para o pedido "passar".',
  true, '2026-08-04', now(), NULL);