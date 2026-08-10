-- Tool renomear_campanha: agente propoe, humano aprova, meta-actions executa pelo
-- update_campaign nativo do Pipeboard e reconcilia o campo name pela Graph API.
update public.meta_execution_config
   set action_flags = coalesce(action_flags, '{}'::jsonb)
                    || jsonb_build_object('renomear_campanha', false);

update public.meta_execution_config
   set action_flags = jsonb_set(action_flags, '{renomear_campanha}', 'true'::jsonb, true)
 where company_id = 'ded20b38-f42e-4c71-800c-31b97ea48bcf'
   and driver_escrita = 'pipeboard';

create or replace function public.pode_executar_acao(p_company_id uuid, p_action text)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public'
as $function$
declare
  cfg record; v_flag jsonb; v_flag_ligada boolean; v_na_hora int;
  v_automatizadas text[] := array[
    'criar_campanha','criar_conjunto_a_partir_de','criar_anuncio_a_partir_de',
    'pausar_campanha','pausar_criativo','alterar_orcamento','renomear_campanha'
  ];
  v_conhecidas text[] := array[
    'criar_campanha','criar_conjunto_a_partir_de','criar_anuncio_a_partir_de',
    'pausar_campanha','pausar_criativo','alterar_orcamento','renomear_campanha',
    'criar_template','upload_midia'
  ];
begin
  if p_action is null or not (p_action = any(v_conhecidas)) then
    return jsonb_build_object(
      'permitido', false, 'motivo', 'acao_desconhecida', 'acao', p_action,
      'acoes_conhecidas', to_jsonb(v_conhecidas),
      'mensagem_para_o_gestor', case
        when p_action = 'escalar_criativo' then
          'Escalar criativo nao e uma acao propria deste sistema: escalar significa AUMENTAR O ORCAMENTO do conjunto que tem o criativo vencedor, e isso e a acao de alterar orcamento. Proponha alteracao de orcamento no conjunto certo, dizendo qual criativo justifica.'
        when p_action = 'replicar_template' then
          'Replicar modelo de mensagem nao passa por card de aprovacao: e feito por rotina propria, com guarda propria. Nao proponha card para isso.'
        else 'Essa acao nao existe no sistema. Nao proponha card para ela.'
      end
    );
  end if;

  select * into cfg from public.meta_execution_config where company_id = p_company_id;
  if cfg is null then
    return jsonb_build_object(
      'permitido', false, 'motivo', 'empresa_sem_configuracao_de_execucao', 'acao', p_action,
      'mensagem_para_o_gestor',
      'Esta empresa nao tem configuracao de execucao propria, e sem ela nada pode ser criado nem alterado. Habilitar isso e configuracao do sistema. NUNCA proponha usar a configuracao de outra empresa.'
    );
  end if;

  v_flag := cfg.action_flags -> p_action;
  v_flag_ligada := (v_flag is not null and v_flag::text = 'true');

  if not (p_action = any(v_automatizadas)) then
    return jsonb_build_object(
      'permitido', false, 'motivo', 'acao_reservada_sem_execucao_ainda', 'acao', p_action,
      'dry_run', cfg.dry_run, 'flag_tambem_desligada', not v_flag_ligada,
      'mensagem_para_o_gestor',
      'Esta acao esta PREVISTA mas ainda nao existe execucao para ela: um card aprovado seria marcado como pulado e nao faria nada. Diga ao gestor o que precisa ser feito na mao por enquanto, e nao sugira que liberar permissao resolveria. '
      || case when v_flag_ligada
        then 'ATENCAO ADICIONAL: a permissao desta acao esta LIGADA, mas ela nao produz efeito.'
        else 'A permissao tambem esta fechada, mas abri-la nao criaria a execucao ausente.' end
    );
  end if;

  if p_action = 'renomear_campanha' and cfg.driver_escrita <> 'pipeboard' then
    return jsonb_build_object(
      'permitido', false, 'motivo', 'renomear_campanha_exige_pipeboard',
      'acao', p_action, 'driver_escrita', cfg.driver_escrita,
      'mensagem_para_o_gestor',
      'A ferramenta de renomear campanha foi definida para executar pelo Pipeboard. Esta empresa nao usa Pipeboard como driver de escrita, entao nenhum card foi emitido.'
    );
  end if;

  if cfg.master_enabled is not true then
    return jsonb_build_object(
      'permitido', false, 'motivo', 'trava_mestra_desligada', 'acao', p_action,
      'dry_run', cfg.dry_run, 'flag_tambem_desligada', not v_flag_ligada,
      'mensagem_para_o_gestor',
      'A execucao de acoes reais esta DESLIGADA para esta empresa, entao aprovar um card nao produziria efeito. Entregue o plano completo e diga que ligar a execucao e decisao de quem administra o sistema.'
    );
  end if;

  if not v_flag_ligada then
    return jsonb_build_object(
      'permitido', false, 'motivo', 'trava_da_acao_desligada', 'acao', p_action,
      'dry_run', cfg.dry_run,
      'mensagem_para_o_gestor',
      'Esta acao especifica esta desligada para esta empresa. NAO emiti o card, porque um card aprovado seria recusado na execucao.'
    );
  end if;

  v_na_hora := public.contar_acoes_na_hora(p_company_id);
  if cfg.max_actions_per_hour is not null and v_na_hora >= cfg.max_actions_per_hour then
    return jsonb_build_object(
      'permitido', false, 'motivo', 'limite_horario_atingido', 'acao', p_action,
      'acoes_na_ultima_hora', v_na_hora, 'limite_horario', cfg.max_actions_per_hour,
      'mensagem_para_o_gestor',
      'O sistema ja executou o maximo de acoes permitido para esta empresa na ultima hora. NAO emiti o card agora.'
    );
  end if;

  return jsonb_build_object(
    'permitido', true, 'motivo', 'liberado', 'acao', p_action,
    'dry_run', cfg.dry_run,
    'driver_escrita', cfg.driver_escrita,
    'contas_permitidas_criacao', to_jsonb(coalesce(cfg.contas_permitidas_criacao, '{}'::text[])),
    'teto_sanidade_orcamento_diario', cfg.teto_sanidade_orcamento_diario,
    'max_actions_per_hour', cfg.max_actions_per_hour,
    'acoes_na_ultima_hora', v_na_hora,
    'folga_na_hora', cfg.max_actions_per_hour - v_na_hora,
    'aviso_dry_run', case when cfg.dry_run then
      'ATENCAO: modo de simulacao. Aprovar nao altera a Meta; apenas registra o que faria.' end,
    'mensagem_para_o_gestor', case when cfg.dry_run then
      'ATENCAO: modo de simulacao. Declare antes da decisao que nada sera alterado.' end,
    'limite_do_teto_horario',
      'Contado no audit_log desta empresa na ultima hora. O portao final continua na meta-actions.',
    'nota_do_driver',
      'driver_escrita diz por onde o ultimo passo sai, nunca SE sai. renomear_campanha exige pipeboard.',
    'lembrete_do_contrato',
      'Aprovar renomear_campanha altera somente o campo name da campanha existente; ID, status, orcamento e estrutura permanecem.'
  );
end
$function$;

comment on function public.pode_executar_acao(uuid, text) is
  'Portao declarativo das acoes do agente. renomear_campanha e automatizada somente quando driver_escrita=pipeboard e sua action_flag esta ligada.';
