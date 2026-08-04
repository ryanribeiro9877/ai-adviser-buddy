-- ESPELHO DE MIGRACAO APLICADA
-- version: 20260804153429
-- name: gt06_mensagem_declara_estado_da_flag
-- projeto: gzjwnjdpxpbmdhcyefvs (Gestor de Trafego IA)
-- aplicada por: Claude via MCP apply_migration
-- espelho gerado a partir de supabase_migrations.schema_migrations - NAO transcrito a mao

-- 04/08/2026 - Lacuna achada pelo Claude Code: eu preservei o fato da flag em
-- flag_tambem_desligada, campo estruturado, mas o chat so repassa mensagem_para_o_gestor - entao
-- o fato existe e e invisivel. Informacao que vive em um lugar so que ninguem le nao existe.
-- Passa para o TEXTO. E o caso inverso - flag LIGADA numa acao que a executora nao executa - e
-- pior e ganha aviso proprio: e promessa ativa do schema que o codigo nao cumpre.
-- Sem deploy: o chat repassa a mensagem, entao a mudanca vale em producao no ato. Era o objetivo
-- de a regra ter um dono so.
CREATE OR REPLACE FUNCTION public.pode_executar_acao(p_company_id uuid, p_action text)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  cfg record; v_flag jsonb; v_flag_ligada boolean;
  v_automatizadas text[] := ARRAY['criar_campanha','criar_conjunto_a_partir_de','criar_anuncio_a_partir_de','pausar_campanha','pausar_criativo','alterar_orcamento'];
  v_conhecidas text[] := ARRAY['criar_campanha','criar_conjunto_a_partir_de','criar_anuncio_a_partir_de','pausar_campanha','pausar_criativo','alterar_orcamento','escalar_criativo','replicar_template','criar_template','upload_midia'];
BEGIN
  IF p_action IS NULL OR NOT (p_action = ANY(v_conhecidas)) THEN
    RETURN jsonb_build_object('permitido', false, 'motivo', 'acao_desconhecida', 'acao', p_action,
      'acoes_conhecidas', to_jsonb(v_conhecidas),
      'mensagem_para_o_gestor', 'Essa ação não existe no sistema. Não proponha card para ela.');
  END IF;

  SELECT * INTO cfg FROM meta_execution_config WHERE company_id = p_company_id;
  IF cfg IS NULL THEN
    RETURN jsonb_build_object('permitido', false, 'motivo', 'empresa_sem_configuracao_de_execucao', 'acao', p_action,
      'mensagem_para_o_gestor', 'Esta empresa não tem configuração de execução própria, e sem ela nada pode ser criado nem alterado. Habilitar isso é configuração do sistema. NUNCA proponha usar a configuração de outra empresa.');
  END IF;

  v_flag := cfg.action_flags -> p_action;
  v_flag_ligada := (v_flag IS NOT NULL AND v_flag::text = 'true');

  IF NOT (p_action = ANY(v_automatizadas)) THEN
    RETURN jsonb_build_object('permitido', false, 'motivo', 'acao_sem_execucao_automatizada', 'acao', p_action,
      'dry_run', cfg.dry_run, 'flag_tambem_desligada', NOT v_flag_ligada,
      'mensagem_para_o_gestor',
        'O sistema NÃO sabe executar esta ação: ela é decisão manual no Gerenciador. Um card aprovado seria marcado como pulado e não faria nada. Diga ao gestor o que fazer na mão, e não sugira que liberar alguma permissão resolveria — porque não resolveria. '
        || CASE WHEN v_flag_ligada
             THEN 'ATENÇÃO ADICIONAL, que vale avisar a quem administra o sistema: a permissão desta ação está LIGADA, o que é enganoso — ela está ligada e não produz efeito nenhum.'
             ELSE 'Para registro: a permissão desta ação também está fechada, mas isso é secundário — abri-la não mudaria nada, porque a execução não existe.'
           END);
  END IF;

  IF cfg.master_enabled IS NOT TRUE THEN
    RETURN jsonb_build_object('permitido', false, 'motivo', 'trava_mestra_desligada', 'acao', p_action,
      'dry_run', cfg.dry_run, 'flag_tambem_desligada', NOT v_flag_ligada,
      'mensagem_para_o_gestor', 'A execução de ações reais está DESLIGADA para esta empresa, então aprovar um card não produziria efeito. Entregue o plano completo do que seria feito e diga que ligar a execução é decisão de quem administra o sistema. Não cite nome de configuração nem detalhe técnico.');
  END IF;

  IF NOT v_flag_ligada THEN
    RETURN jsonb_build_object('permitido', false, 'motivo', 'trava_da_acao_desligada', 'acao', p_action,
      'dry_run', cfg.dry_run,
      'mensagem_para_o_gestor', 'Esta ação específica está desligada para esta empresa. NÃO emiti o card, porque um card aprovado dela seria recusado na execução — e gastaria a aprovação do gestor sem resultado. Entregue o plano do que seria feito e diga que falta liberar esta ação no sistema.');
  END IF;

  RETURN jsonb_build_object('permitido', true, 'motivo', 'liberado', 'acao', p_action,
    'dry_run', cfg.dry_run,
    'contas_permitidas_criacao', to_jsonb(coalesce(cfg.contas_permitidas_criacao, '{}'::text[])),
    'teto_sanidade_orcamento_diario', cfg.teto_sanidade_orcamento_diario,
    'max_actions_per_hour', cfg.max_actions_per_hour,
    'aviso_dry_run', CASE WHEN cfg.dry_run THEN 'ATENÇÃO: o sistema está em modo de simulação. Se este card for aprovado, NADA será criado ou alterado na Meta — a execução apenas registra o que faria.' END,
    'mensagem_para_o_gestor', CASE WHEN cfg.dry_run THEN 'ATENÇÃO: o sistema está em modo de simulação. Se este card for aprovado, NADA será criado ou alterado na Meta — a execução apenas registra o que faria. Declare isso ao gestor antes de ele decidir.' END,
    'lembrete_do_contrato', 'Aprovar o card CRIA ou ALTERA na Meta. Objeto novo nasce PAUSADO (contrato de 03/08/2026) e a ativação é um segundo ato, manual, do gestor no Gerenciador.');
END $$;