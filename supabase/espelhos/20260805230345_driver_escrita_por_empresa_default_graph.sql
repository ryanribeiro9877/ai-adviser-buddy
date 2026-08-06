-- ESPELHO DE MIGRACAO APLICADA
-- version: 20260805230345
-- name: driver_escrita_por_empresa_default_graph
-- projeto: gzjwnjdpxpbmdhcyefvs (Gestor de Trafego IA)
-- aplicada por: Claude via MCP apply_migration
-- espelho gerado a partir de supabase_migrations.schema_migrations - NAO transcrito a mao

-- Habilitador do driver de escrita, por empresa. Aditivo e com default = comportamento atual.
--
-- POR QUE ENTRAR ANTES DO CODIGO: o meta-actions precisa de um lugar para ler o driver, e esse
-- lugar tem de nascer com 'graph' para que ligar a coluna NAO mude nada. Trocar para 'pipeboard'
-- passa a ser um ato deliberado, por empresa, na mesma tabela onde ja vivem master_enabled,
-- dry_run, action_flags e os tetos - ou seja, atras das mesmas travas e sujeito a mesma palavra
-- do Ryan.
--
-- O QUE ISTO NAO E: nao e permissao de escrita. A escrita continua governada por
-- master_enabled + action_flags + pode_executar_acao. Esta coluna decide apenas POR ONDE o
-- ultimo passo sai, nunca SE ele sai.
--
-- MEDIDO EM 05/08 e que justifica existir: o Pipeboard alcanca 2 contas operacionais contra 1
-- do nosso token (act_3302001729967572 + act_946388181625874), e COHAPM nao esta conectada la -
-- entao COHAPM tem de permanecer em 'graph' por falta de conexao, nao por escolha.

alter table public.meta_execution_config
  add column if not exists driver_escrita text not null default 'graph';

alter table public.meta_execution_config
  drop constraint if exists meta_exec_driver_valido;

alter table public.meta_execution_config
  add constraint meta_exec_driver_valido
  check (driver_escrita in ('graph','pipeboard'));

comment on column public.meta_execution_config.driver_escrita is
  'Por onde o ULTIMO passo da escrita sai: graph (direto na Meta, padrao) ou pipeboard. Nao concede permissao - quem concede sao master_enabled, action_flags e pode_executar_acao. COHAPM deve ficar em graph enquanto nao houver conexao dela no Pipeboard.';

-- pode_executar_acao passa a INFORMAR o driver, para o card dizer por onde sairia.
-- Mudanca minima: uma chave a mais no retorno liberado. Nenhuma decisao muda.
create or replace function public.pode_executar_acao(p_company_id uuid, p_action text)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public'
as $function$
DECLARE
  cfg record; v_flag jsonb; v_flag_ligada boolean; v_na_hora int; v_base jsonb;
  v_automatizadas text[] := ARRAY['criar_campanha','criar_conjunto_a_partir_de','criar_anuncio_a_partir_de','pausar_campanha','pausar_criativo','alterar_orcamento'];
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

  v_na_hora := public.contar_acoes_na_hora(p_company_id);

  IF cfg.max_actions_per_hour IS NOT NULL AND v_na_hora >= cfg.max_actions_per_hour THEN
    RETURN jsonb_build_object('permitido', false, 'motivo', 'limite_horario_atingido', 'acao', p_action,
      'acoes_na_ultima_hora', v_na_hora, 'limite_horario', cfg.max_actions_per_hour,
      'mensagem_para_o_gestor', 'O sistema ja executou o maximo de acoes permitido para esta empresa na ultima hora. NAO emiti o card agora: ele seria recusado na execucao. Entregue o plano e diga que da para retomar dentro de uma hora.');
  END IF;

  RETURN jsonb_build_object('permitido', true, 'motivo', 'liberado', 'acao', p_action,
    'dry_run', cfg.dry_run,
    'driver_escrita', cfg.driver_escrita,
    'contas_permitidas_criacao', to_jsonb(coalesce(cfg.contas_permitidas_criacao, '{}'::text[])),
    'teto_sanidade_orcamento_diario', cfg.teto_sanidade_orcamento_diario,
    'max_actions_per_hour', cfg.max_actions_per_hour,
    'acoes_na_ultima_hora', v_na_hora,
    'folga_na_hora', cfg.max_actions_per_hour - v_na_hora,
    'aviso_dry_run', CASE WHEN cfg.dry_run THEN 'ATENCAO: o sistema esta em modo de simulacao. Se este card for aprovado, NADA sera criado ou alterado na Meta - a execucao apenas registra o que faria.' END,
    'mensagem_para_o_gestor', CASE WHEN cfg.dry_run THEN 'ATENCAO: o sistema esta em modo de simulacao. Se este card for aprovado, NADA sera criado ou alterado na Meta - a execucao apenas registra o que faria. Declare isso ao gestor antes de ele decidir.' END,
    'limite_do_teto_horario', 'Este numero e CONTADO no audit_log desta empresa na ultima hora, nao presumido. A contagem roda na PROPOSTA; o portao de execucao continua sendo do meta-actions.',
    'nota_do_driver', 'driver_escrita diz por onde o ultimo passo sai, nunca SE sai. Permissao continua sendo master_enabled + action_flags + esta RPC.',
    'lembrete_do_contrato', 'Aprovar o card CRIA ou ALTERA na Meta. Objeto novo nasce PAUSADO (contrato de 03/08/2026) e a ativacao e um segundo ato, manual, do gestor no Gerenciador.');
END $function$;