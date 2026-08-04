-- ESPELHO DE MIGRACAO APLICADA
-- version: 20260804174302
-- name: gt44_tres_flags_decisao
-- projeto: gzjwnjdpxpbmdhcyefvs (Gestor de Trafego IA)
-- aplicada por: Claude via MCP apply_migration
-- espelho gerado a partir de supabase_migrations.schema_migrations - NAO transcrito a mao

-- 04/08/2026 - GT-44 FECHADO. Decisao sobre as tres flags que nao executavam nada.
--
-- replicar_template -> REMOVIDA. Prova que decidiu: o audit_log mostra
--   waba_template_replication_planned x8 e _sent x5, com 3 templates APROVADOS pela Meta em
--   29/07 e meta_template_id gravado - tudo isso com a flag em false. Logo a
--   waba-template-replicate NAO consulta esta flag: ela tem guarda propria (dry_run no registro
--   e o guardiao de duas camadas). A flag existia so no schema, lida por ninguem. Manter seria
--   fingir controle que nao existe, que e pior que nao ter controle.
--
-- escalar_criativo -> REMOVIDA. Decisao minha, delegada pelo Ryan, e reversivel. O motivo nao e
--   "nao esta implementada": e que ESCALAR CRIATIVO E AUMENTAR ORCAMENTO do conjunto vencedor, e
--   alterar_orcamento existe, e implementada pela executora e tem flag propria. Nao era acao
--   faltante, era CONCEITO DUPLICADO. Duas flags para o mesmo ato dividem o controle e criam a
--   duvida de qual vale.
--
-- upload_midia -> MANTIDA, e declarada RESERVADA. E a unica das tres que ainda vira acao de card:
--   o GT-13 preve a rota Drive -> anuncio, e nela o upload passa pela escada de aprovacao. A edge
--   upload-midia v1 existe e nunca rodou (media_uploads vazia), entao a flag guarda um caminho
--   que sera real, nao um que nunca sera.

-- 1) Remove as duas flags de todas as empresas.
UPDATE public.meta_execution_config
   SET action_flags = action_flags - 'replicar_template' - 'escalar_criativo',
       updated_at = now();

-- 2) A RPC deixa de conhecer as duas. Quem pedir passa a receber acao_desconhecida, que e falha
--    ALTA e correta - melhor que recusa silenciosa por flag inexistente.
CREATE OR REPLACE FUNCTION public.pode_executar_acao(p_company_id uuid, p_action text)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  cfg record; v_flag jsonb; v_flag_ligada boolean;
  v_automatizadas text[] := ARRAY['criar_campanha','criar_conjunto_a_partir_de','criar_anuncio_a_partir_de','pausar_campanha','pausar_criativo','alterar_orcamento'];
  -- criar_template e upload_midia seguem conhecidas e RESERVADAS: tem caminho previsto.
  v_conhecidas text[] := ARRAY['criar_campanha','criar_conjunto_a_partir_de','criar_anuncio_a_partir_de','pausar_campanha','pausar_criativo','alterar_orcamento','criar_template','upload_midia'];
BEGIN
  IF p_action IS NULL OR NOT (p_action = ANY(v_conhecidas)) THEN
    RETURN jsonb_build_object('permitido', false, 'motivo', 'acao_desconhecida', 'acao', p_action,
      'acoes_conhecidas', to_jsonb(v_conhecidas),
      'mensagem_para_o_gestor', CASE
        WHEN p_action = 'escalar_criativo' THEN 'Escalar criativo nao e uma acao propria deste sistema: escalar significa AUMENTAR O ORCAMENTO do conjunto que tem o criativo vencedor, e isso e a acao de alterar orcamento. Proponha alteracao de orcamento no conjunto certo, dizendo qual criativo justifica.'
        WHEN p_action = 'replicar_template' THEN 'Replicar modelo de mensagem nao passa por card de aprovacao: e feito por rotina propria, com guarda propria. Nao proponha card para isso.'
        ELSE 'Essa acao nao existe no sistema. Nao proponha card para ela.' END);
  END IF;

  SELECT * INTO cfg FROM meta_execution_config WHERE company_id = p_company_id;
  IF cfg IS NULL THEN
    RETURN jsonb_build_object('permitido', false, 'motivo', 'empresa_sem_configuracao_de_execucao', 'acao', p_action,
      'mensagem_para_o_gestor', 'Esta empresa nao tem configuracao de execucao propria, e sem ela nada pode ser criado nem alterado. Habilitar isso e configuracao do sistema. NUNCA proponha usar a configuracao de outra empresa.');
  END IF;

  v_flag := cfg.action_flags -> p_action;
  v_flag_ligada := (v_flag IS NOT NULL AND v_flag::text = 'true');

  IF NOT (p_action = ANY(v_automatizadas)) THEN
    RETURN jsonb_build_object('permitido', false, 'motivo', 'acao_reservada_sem_execucao_ainda', 'acao', p_action,
      'dry_run', cfg.dry_run, 'flag_tambem_desligada', NOT v_flag_ligada,
      'mensagem_para_o_gestor',
        'Esta acao esta PREVISTA mas ainda nao existe execucao para ela: um card aprovado seria marcado como pulado e nao faria nada. Diga ao gestor o que precisa ser feito na mao por enquanto, e nao sugira que liberar permissao resolveria. '
        || CASE WHEN v_flag_ligada THEN 'ATENCAO ADICIONAL, que vale avisar a quem administra o sistema: a permissao desta acao esta LIGADA, o que e enganoso - ela esta ligada e nao produz efeito nenhum.'
                ELSE 'Para registro: a permissao dela tambem esta fechada, mas isso e secundario - abri-la nao mudaria nada, porque a execucao ainda nao existe.' END);
  END IF;

  IF cfg.master_enabled IS NOT TRUE THEN
    RETURN jsonb_build_object('permitido', false, 'motivo', 'trava_mestra_desligada', 'acao', p_action,
      'dry_run', cfg.dry_run, 'flag_tambem_desligada', NOT v_flag_ligada,
      'mensagem_para_o_gestor', 'A execucao de acoes reais esta DESLIGADA para esta empresa, entao aprovar um card nao produziria efeito. Entregue o plano completo do que seria feito e diga que ligar a execucao e decisao de quem administra o sistema. Nao cite nome de configuracao nem detalhe tecnico.');
  END IF;

  IF NOT v_flag_ligada THEN
    RETURN jsonb_build_object('permitido', false, 'motivo', 'trava_da_acao_desligada', 'acao', p_action,
      'dry_run', cfg.dry_run,
      'mensagem_para_o_gestor', 'Esta acao especifica esta desligada para esta empresa. NAO emiti o card, porque um card aprovado dela seria recusado na execucao - e gastaria a aprovacao do gestor sem resultado. Entregue o plano do que seria feito e diga que falta liberar esta acao no sistema.');
  END IF;

  RETURN jsonb_build_object('permitido', true, 'motivo', 'liberado', 'acao', p_action,
    'dry_run', cfg.dry_run,
    'contas_permitidas_criacao', to_jsonb(coalesce(cfg.contas_permitidas_criacao, '{}'::text[])),
    'teto_sanidade_orcamento_diario', cfg.teto_sanidade_orcamento_diario,
    'max_actions_per_hour', cfg.max_actions_per_hour,
    'aviso_dry_run', CASE WHEN cfg.dry_run THEN 'ATENCAO: o sistema esta em modo de simulacao. Se este card for aprovado, NADA sera criado ou alterado na Meta - a execucao apenas registra o que faria.' END,
    'mensagem_para_o_gestor', CASE WHEN cfg.dry_run THEN 'ATENCAO: o sistema esta em modo de simulacao. Se este card for aprovado, NADA sera criado ou alterado na Meta - a execucao apenas registra o que faria. Declare isso ao gestor antes de ele decidir.' END,
    'lembrete_do_contrato', 'Aprovar o card CRIA ou ALTERA na Meta. Objeto novo nasce PAUSADO (contrato de 03/08/2026) e a ativacao e um segundo ato, manual, do gestor no Gerenciador.');
END $$;

-- 3) Decisao registrada como fato datado.
INSERT INTO agent_context (categoria, fato, vigente, desde, atualizado, company_id)
VALUES ('doutrina',
  'DECISAO SOBRE TRES PERMISSOES QUE NAO EXECUTAVAM NADA (04/08/2026). '
  || 'REPLICAR MODELO DE MENSAGEM: a permissao foi REMOVIDA. A rotina que replica modelo tem guarda '
  || 'propria e provou funcionar sem ela - replicou de verdade em 29/07 com 3 modelos aprovados pela Meta '
  || 'enquanto a permissao estava fechada. Nao proponha card para replicar modelo: nao e ato de card. '
  || 'ESCALAR CRIATIVO: a permissao foi REMOVIDA porque a acao era CONCEITO DUPLICADO. Escalar criativo '
  || 'significa AUMENTAR O ORCAMENTO do conjunto que tem o criativo vencedor, e alterar orcamento ja existe '
  || 'como acao propria e implementada. Quando o gestor pedir para escalar, proponha ALTERACAO DE ORCAMENTO '
  || 'no conjunto certo, dizendo qual criativo justifica o aumento e qual e a reversa. '
  || 'SUBIR MIDIA: a permissao foi MANTIDA e e RESERVADA. Ela guarda a rota Drive -> anuncio, que ainda nao '
  || 'existe: a rotina de subir midia foi publicada e nunca rodou. Enquanto nao existir, um card dela seria '
  || 'pulado - declare isso em vez de propor. '
  || 'REGRA GERAL QUE FICA: permissao no sistema para acao que ninguem executa e promessa que o codigo nao '
  || 'cumpre. Ao encontrar uma, trate como defeito a declarar, nao como capacidade disponivel.',
  true, '2026-08-04', now(), NULL);