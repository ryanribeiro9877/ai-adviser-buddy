-- ESPELHO DE MIGRACAO APLICADA
-- version: 20260804145125
-- name: gt06_rpc_unica_de_permissao_de_acao
-- projeto: gzjwnjdpxpbmdhcyefvs (Gestor de Trafego IA)
-- aplicada por: Claude via MCP apply_migration
-- espelho gerado a partir de supabase_migrations.schema_migrations - NAO transcrito a mao

-- 04/08/2026 - GT-06, a metade que faltava, resolvida como FONTE UNICA em vez de terceiro clone.
--
-- O DEFEITO: o t_propose_criacao passou a ler master_enabled e action_flags no v28.6, mas o
-- t_propose_action (pausar_criativo, escalar_criativo, pausar_campanha, alterar_orcamento) nao
-- le NADA. Consequencia observada na sonda de 03/08: o agente ofereceu emitir cards de pausa
-- para as tres campanhas de teste, e pausar_campanha esta false - o card sairia e seria
-- bloqueado na execucao. Promessa que o sistema nao cumpre, que e o defeito que o GT-06 mata.
--
-- POR QUE RPC E NAO COPIAR O BLOCO: copiar poria a mesma doutrina em TRES lugares - dois no
-- chat e um na meta-actions. Doutrina em tres lugares foi exatamente o que produziu o desync do
-- "nasce pausado", que vigorou de 31/07 a 03/08 e fez o gestor operar acreditando num freio que
-- nao existia. A regra passa a ter um dono.
--
-- IMPORTANTE: esta RPC NAO autoriza nada. Ela LE a postura de execucao e devolve um veredito
-- legivel. A trava que vale continua sendo a da meta-actions, no momento da execucao - aqui e
-- so para o chat parar de prometer o que a executora vai recusar.

CREATE OR REPLACE FUNCTION public.pode_executar_acao(p_company_id uuid, p_action text)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  cfg record;
  v_flag jsonb;
  -- acoes que a executora sabe fazer. escalar_criativo tem FLAG mas NAO tem implementacao:
  -- a meta-actions devolve "pulado: acao nao automatizada". Prometer card dela e prometer nada.
  v_automatizadas text[] := ARRAY[
    'criar_campanha','criar_conjunto_a_partir_de','criar_anuncio_a_partir_de',
    'pausar_campanha','pausar_criativo','alterar_orcamento'];
  v_conhecidas text[] := ARRAY[
    'criar_campanha','criar_conjunto_a_partir_de','criar_anuncio_a_partir_de',
    'pausar_campanha','pausar_criativo','alterar_orcamento',
    'escalar_criativo','replicar_template','criar_template','upload_midia'];
BEGIN
  IF p_action IS NULL OR NOT (p_action = ANY(v_conhecidas)) THEN
    RETURN jsonb_build_object(
      'permitido', false, 'motivo', 'acao_desconhecida',
      'acao', p_action, 'acoes_conhecidas', to_jsonb(v_conhecidas),
      'mensagem_para_o_gestor', 'Essa ação não existe no sistema. Não proponha card para ela.');
  END IF;

  SELECT * INTO cfg FROM meta_execution_config WHERE company_id = p_company_id;

  IF cfg IS NULL THEN
    RETURN jsonb_build_object(
      'permitido', false, 'motivo', 'empresa_sem_configuracao_de_execucao', 'acao', p_action,
      'mensagem_para_o_gestor', 'Esta empresa não tem configuração de execução própria, e sem ela nada pode ser criado nem alterado. Habilitar isso é configuração do sistema. NUNCA proponha usar a configuração de outra empresa.');
  END IF;

  IF cfg.master_enabled IS NOT TRUE THEN
    RETURN jsonb_build_object(
      'permitido', false, 'motivo', 'trava_mestra_desligada', 'acao', p_action,
      'dry_run', cfg.dry_run,
      'mensagem_para_o_gestor', 'A execução de ações reais está DESLIGADA para esta empresa, então aprovar um card não produziria efeito. Entregue o plano completo do que seria feito e diga que ligar a execução é decisão de quem administra o sistema. Não cite nome de configuração nem detalhe técnico.');
  END IF;

  v_flag := cfg.action_flags -> p_action;

  IF v_flag IS NULL OR v_flag::text <> 'true' THEN
    RETURN jsonb_build_object(
      'permitido', false, 'motivo', 'trava_da_acao_desligada', 'acao', p_action,
      'dry_run', cfg.dry_run,
      'mensagem_para_o_gestor', 'Esta ação específica está desligada para esta empresa. NÃO emiti o card, porque um card aprovado dela seria recusado na execução — e gastaria a aprovação do gestor sem resultado. Entregue o plano do que seria feito e diga que falta liberar esta ação no sistema.');
  END IF;

  IF NOT (p_action = ANY(v_automatizadas)) THEN
    RETURN jsonb_build_object(
      'permitido', false, 'motivo', 'acao_sem_execucao_automatizada', 'acao', p_action,
      'dry_run', cfg.dry_run,
      'mensagem_para_o_gestor', 'A trava desta ação está ligada, mas o sistema NÃO sabe executá-la: ela é decisão manual no Gerenciador. Um card aprovado seria marcado como pulado. Diga ao gestor o que fazer na mão, em vez de emitir card.');
  END IF;

  RETURN jsonb_build_object(
    'permitido', true, 'motivo', 'liberado', 'acao', p_action,
    'dry_run', cfg.dry_run,
    'contas_permitidas_criacao', to_jsonb(coalesce(cfg.contas_permitidas_criacao, '{}'::text[])),
    'teto_sanidade_orcamento_diario', cfg.teto_sanidade_orcamento_diario,
    'max_actions_per_hour', cfg.max_actions_per_hour,
    'aviso_dry_run', CASE WHEN cfg.dry_run THEN
      'ATENÇÃO: o sistema está em modo de simulação. Se este card for aprovado, NADA será criado ou alterado na Meta — a execução apenas registra o que faria. Declare isso ao gestor.' END,
    'lembrete_do_contrato', 'Aprovar o card CRIA ou ALTERA na Meta. Objeto novo nasce PAUSADO (contrato de 03/08/2026) e a ativação é um segundo ato, manual, do gestor no Gerenciador.');
END $$;

COMMENT ON FUNCTION public.pode_executar_acao(uuid, text) IS
  'FONTE UNICA da postura de execucao por empresa e acao. Chamada pelo traffic-chat ANTES de emitir qualquer card, nos DOIS caminhos (criacao e modificacao). Nao autoriza nada: a trava que vale e a da meta-actions no momento da execucao. Devolve mensagem_para_o_gestor pronta, em linguagem de negocio, para o texto nao divergir entre os caminhos.';

REVOKE ALL ON FUNCTION public.pode_executar_acao(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.pode_executar_acao(uuid, text) TO authenticated, service_role;