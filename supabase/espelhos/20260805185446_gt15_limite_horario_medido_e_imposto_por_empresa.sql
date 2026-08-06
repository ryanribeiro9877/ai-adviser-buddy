-- ESPELHO DE MIGRACAO APLICADA
-- version: 20260805185446
-- name: gt15_limite_horario_medido_e_imposto_por_empresa
-- projeto: gzjwnjdpxpbmdhcyefvs (Gestor de Trafego IA)
-- aplicada por: Claude via MCP apply_migration
-- espelho gerado a partir de supabase_migrations.schema_migrations - NAO transcrito a mao

-- GT-15 · o limite de acoes por hora deixa de ser anunciado e passa a ser MEDIDO e IMPOSTO,
-- por empresa.
--
-- O DEFEITO: pode_executar_acao devolvia max_actions_per_hour ao agente como se fosse
-- garantia, sem contar nada. Se a contagem real vivesse na edge e fosse global, o numero
-- que o agente declarava ao gestor era falso por empresa - e declarar limite e afirmacao,
-- que pela regra 13 tem de ser verdadeira.
--
-- O QUE TORNA A CONTAGEM POSSIVEL: audit_log tem company_id preenchido em 100% das linhas
-- (medido em 05/08, 14 tipos de acao, zero nulos), mais created_at e action.
--
-- O QUE CONTA, e o porque de cada escolha:
--   meta_action_executed -> conta. Chamou a Meta e mudou algo.
--   meta_action_failed   -> CONTA. Chegou a chamar a Graph; consumiu tentativa real.
--   meta_action_dry_run  -> NAO conta. Simulacao nao toca a Meta.
--   meta_action_blocked  -> NAO conta. A trava pegou antes de sair.
--
-- LIMITE DECLARADO DESTA MUDANCA: esta checagem roda na PROPOSTA. A execucao acontece na
-- APROVACAO. Portanto ela torna o numero verdadeiro e barra proposta acima do teto, mas NAO
-- fecha o TOCTOU: dois cards propostos dentro do limite e aprovados depois ainda passam.
-- O portao de execucao continua devendo existir no meta-actions. Nao vender isso como
-- resolvido seria repetir o defeito que esta migracao conserta.

create or replace function public.contar_acoes_na_hora(p_company_id uuid)
returns integer
language sql
stable
as $$
  select count(*)::int
  from public.audit_log
  where company_id = p_company_id
    and action in ('meta_action_executed', 'meta_action_failed')
    and created_at > now() - interval '1 hour';
$$;

comment on function public.contar_acoes_na_hora(uuid) is
  'GT-15: acoes que realmente tocaram a Graph na ultima hora, por empresa. dry_run e blocked nao contam - nao sairam.';

create or replace function public.pode_executar_acao(p_company_id uuid, p_action text)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public'
as $function$
DECLARE
  cfg record; v_flag jsonb; v_flag_ligada boolean; v_na_hora int;
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

  -- NOVO (GT-15): teto horario CONTADO nesta empresa, nunca global.
  v_na_hora := public.contar_acoes_na_hora(p_company_id);

  IF cfg.max_actions_per_hour IS NOT NULL AND v_na_hora >= cfg.max_actions_per_hour THEN
    RETURN jsonb_build_object('permitido', false, 'motivo', 'limite_horario_atingido', 'acao', p_action,
      'acoes_na_ultima_hora', v_na_hora, 'limite_horario', cfg.max_actions_per_hour,
      'mensagem_para_o_gestor', 'O sistema ja executou o maximo de acoes permitido para esta empresa na ultima hora. NAO emiti o card agora: ele seria recusado na execucao. Entregue o plano e diga que da para retomar dentro de uma hora.');
  END IF;

  RETURN jsonb_build_object('permitido', true, 'motivo', 'liberado', 'acao', p_action,
    'dry_run', cfg.dry_run,
    'contas_permitidas_criacao', to_jsonb(coalesce(cfg.contas_permitidas_criacao, '{}'::text[])),
    'teto_sanidade_orcamento_diario', cfg.teto_sanidade_orcamento_diario,
    'max_actions_per_hour', cfg.max_actions_per_hour,
    'acoes_na_ultima_hora', v_na_hora,
    'folga_na_hora', cfg.max_actions_per_hour - v_na_hora,
    'aviso_dry_run', CASE WHEN cfg.dry_run THEN 'ATENCAO: o sistema esta em modo de simulacao. Se este card for aprovado, NADA sera criado ou alterado na Meta - a execucao apenas registra o que faria.' END,
    'mensagem_para_o_gestor', CASE WHEN cfg.dry_run THEN 'ATENCAO: o sistema esta em modo de simulacao. Se este card for aprovado, NADA sera criado ou alterado na Meta - a execucao apenas registra o que faria. Declare isso ao gestor antes de ele decidir.' END,
    'limite_do_teto_horario', 'Este numero e CONTADO no audit_log desta empresa na ultima hora, nao presumido. A contagem roda na PROPOSTA; o portao de execucao continua sendo do meta-actions.',
    'lembrete_do_contrato', 'Aprovar o card CRIA ou ALTERA na Meta. Objeto novo nasce PAUSADO (contrato de 03/08/2026) e a ativacao e um segundo ato, manual, do gestor no Gerenciador.');
END $function$;