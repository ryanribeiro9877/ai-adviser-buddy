-- Acao sancionada: ajustar_posicionamentos_do_conjunto.
-- Ryan autorizou a resolucao em 11/08/2026. A flag nasce false para TODAS as empresas e e ligada
-- somente para a Legal e Viver, onde houve autorizacao expressa. Aprovar card continua obrigatorio.

update public.meta_execution_config
   set action_flags = coalesce(action_flags, '{}'::jsonb)
                    || jsonb_build_object('ajustar_posicionamentos_do_conjunto', false);

update public.meta_execution_config
   set action_flags = jsonb_set(
         action_flags,
         '{ajustar_posicionamentos_do_conjunto}',
         'true'::jsonb,
         true)
 where company_id = 'ded20b38-f42e-4c71-800c-31b97ea48bcf';

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
    'pausar_campanha','pausar_criativo','alterar_orcamento','renomear_campanha',
    'ajustar_posicionamentos_do_conjunto'
  ];
  v_conhecidas text[] := array[
    'criar_campanha','criar_conjunto_a_partir_de','criar_anuncio_a_partir_de',
    'pausar_campanha','pausar_criativo','alterar_orcamento','renomear_campanha',
    'ajustar_posicionamentos_do_conjunto','criar_template','upload_midia'
  ];
begin
  if p_action is null or not (p_action = any(v_conhecidas)) then
    return jsonb_build_object(
      'permitido', false, 'motivo', 'acao_desconhecida', 'acao', p_action,
      'acoes_conhecidas', to_jsonb(v_conhecidas),
      'mensagem_para_o_gestor', case
        when p_action = 'escalar_criativo' then
          'Escalar criativo nao e uma acao propria deste sistema: use alterar_orcamento no conjunto.'
        when p_action = 'replicar_template' then
          'Replicar modelo de mensagem usa rotina propria, nao card de aprovacao.'
        else 'Essa acao nao existe no sistema. Nao proponha card para ela.'
      end);
  end if;

  select * into cfg from public.meta_execution_config where company_id = p_company_id;
  if cfg is null then
    return jsonb_build_object(
      'permitido', false, 'motivo', 'empresa_sem_configuracao_de_execucao', 'acao', p_action,
      'mensagem_para_o_gestor',
      'Esta empresa nao tem configuracao de execucao propria, e sem ela nada pode ser criado nem alterado. NUNCA use a configuracao de outra empresa.');
  end if;

  v_flag := cfg.action_flags -> p_action;
  v_flag_ligada := (v_flag is not null and v_flag::text = 'true');

  if not (p_action = any(v_automatizadas)) then
    return jsonb_build_object(
      'permitido', false, 'motivo', 'acao_reservada_sem_execucao_ainda', 'acao', p_action,
      'dry_run', cfg.dry_run, 'flag_tambem_desligada', not v_flag_ligada,
      'mensagem_para_o_gestor',
      'Esta acao esta prevista mas ainda nao existe execucao para ela; nenhum card foi emitido.');
  end if;

  if p_action = 'renomear_campanha' and cfg.driver_escrita <> 'pipeboard' then
    return jsonb_build_object(
      'permitido', false, 'motivo', 'renomear_campanha_exige_pipeboard',
      'acao', p_action, 'driver_escrita', cfg.driver_escrita,
      'mensagem_para_o_gestor',
      'A ferramenta de renomear campanha exige Pipeboard; nenhum card foi emitido.');
  end if;

  -- Ajuste de posicionamentos e suportado pelos DOIS drivers declarados:
  -- graph: POST /{adset_id} targeting=...;
  -- pipeboard: update_adset(adset_id,targeting), provado por tools/list request 610 em 11/08.
  if p_action = 'ajustar_posicionamentos_do_conjunto'
     and cfg.driver_escrita not in ('graph','pipeboard') then
    return jsonb_build_object(
      'permitido', false, 'motivo', 'driver_nao_suporta_edicao_de_posicionamento',
      'acao', p_action, 'driver_escrita', cfg.driver_escrita,
      'mensagem_para_o_gestor',
      'O driver configurado nao suporta editar targeting/posicionamentos de conjunto; nenhum card foi emitido.');
  end if;

  if cfg.master_enabled is not true then
    return jsonb_build_object(
      'permitido', false, 'motivo', 'trava_mestra_desligada', 'acao', p_action,
      'dry_run', cfg.dry_run, 'flag_tambem_desligada', not v_flag_ligada,
      'mensagem_para_o_gestor',
      'A execucao real esta desligada para esta empresa; nenhum card foi emitido.');
  end if;
  if not v_flag_ligada then
    return jsonb_build_object(
      'permitido', false, 'motivo', 'trava_da_acao_desligada', 'acao', p_action,
      'dry_run', cfg.dry_run,
      'mensagem_para_o_gestor',
      'Esta acao especifica esta desligada para esta empresa; nenhum card foi emitido.');
  end if;

  v_na_hora := public.contar_acoes_na_hora(p_company_id);
  if cfg.max_actions_per_hour is not null and v_na_hora >= cfg.max_actions_per_hour then
    return jsonb_build_object(
      'permitido', false, 'motivo', 'limite_horario_atingido', 'acao', p_action,
      'acoes_na_ultima_hora', v_na_hora, 'limite_horario', cfg.max_actions_per_hour,
      'mensagem_para_o_gestor', 'O limite de acoes na ultima hora foi atingido; nenhum card foi emitido.');
  end if;

  return jsonb_build_object(
    'permitido', true, 'motivo', 'liberado', 'acao', p_action,
    'dry_run', cfg.dry_run, 'driver_escrita', cfg.driver_escrita,
    'contas_permitidas_criacao', to_jsonb(coalesce(cfg.contas_permitidas_criacao, '{}'::text[])),
    'teto_sanidade_orcamento_diario', cfg.teto_sanidade_orcamento_diario,
    'max_actions_per_hour', cfg.max_actions_per_hour,
    'acoes_na_ultima_hora', v_na_hora,
    'folga_na_hora', cfg.max_actions_per_hour - v_na_hora,
    'aviso_dry_run', case when cfg.dry_run then
      'ATENCAO: modo de simulacao. Aprovar nao altera a Meta; apenas registra o que faria.' end,
    'mensagem_para_o_gestor', case
      when cfg.dry_run then 'ATENCAO: modo de simulacao; aprovar nao altera a Meta.'
      when p_action = 'ajustar_posicionamentos_do_conjunto' then
        'Aprovar altera os posicionamentos do conjunto pela Meta. O executor relê o targeting e exige reconciliacao.'
      else null end,
    'limite_do_teto_horario',
      'Contado no audit_log desta empresa na ultima hora. O portao final continua na meta-actions.',
    'nota_do_driver',
      'driver_escrita decide o ultimo passo. Ajuste de posicionamento: Graph POST ou Pipeboard update_adset(targeting).',
    'lembrete_do_contrato',
      'A incompatibilidade e derivada de formato_midia. Video exclui facebook.right_hand_column; imagem nao inventa exclusao.');
end
$function$;

delete from public.contrato_de_execucao
 where acao = 'ajustar_posicionamentos_do_conjunto';

insert into public.contrato_de_execucao
  (acao,campo,obrigatorio,tipo,observacao,fonte,vigente,suportado,valores_aceitos)
values
  ('ajustar_posicionamentos_do_conjunto','target_external_id',true,'text',
   'ID Meta do conjunto; resolvido pelo card a partir de ad_sets da mesma empresa.',
   'traffic-chat.t_propose_action + meta-actions executor',true,true,null),
  ('ajustar_posicionamentos_do_conjunto','target_name',true,'text',
   'Nome humano do conjunto, para card e auditoria.',
   'traffic-chat.t_propose_action',true,true,null),
  ('ajustar_posicionamentos_do_conjunto','formato_midia',true,'enum',
   'O servidor deriva a incompatibilidade pelo formato; nao aceita lista livre de exclusoes.',
   'meta-actions.targetingCompativelComFormato',true,true,array['video','imagem']),
  ('ajustar_posicionamentos_do_conjunto','justificativa',true,'text',
   'Evidencia e motivo visiveis no card.',
   'traffic-chat.t_propose_action',true,true,null),
  ('ajustar_posicionamentos_do_conjunto','reversa',true,'text',
   'Plano de restaurar targeting anterior; o estado anterior fica no audit_log.',
   'traffic-chat.t_propose_action + audit_log',true,true,null),
  ('ajustar_posicionamentos_do_conjunto','metrica_sucesso',true,'text',
   'Releitura Graph confirma ausencia da posicao incompatível.',
   'traffic-chat.t_propose_action + reconciliarAposEscrita',true,true,null);

insert into public.agent_context (categoria,fato,vigente,desde)
values (
  'doutrina',
  'POSICIONAMENTOS POR FORMATO (decisao Ryan, 11/08/2026): existe a acao sancionada '
  || 'ajustar_posicionamentos_do_conjunto. Ela nunca escreve sem card aprovado. O pedido informa '
  || 'formato_midia; o servidor deriva incompatibilidades. Para VIDEO, facebook.right_hand_column '
  || 'e excluido porque exige imagem; trocar tamanho/proporcao do video nao resolve. Para IMAGEM, '
  || 'essa exclusao nao e aplicada. Se o conjunto estava em Advantage+/automatico (arrays de '
  || 'placement ausentes), excluir uma posicao exige passar a selecao manual; o card deve declarar '
  || 'isso. Instagram stream + Threads threads_stream sao preservados. Driver Pipeboard comprovado '
  || 'por tools/list request 610: update_adset aceita targeting completo (idempotentHint=true, '
  || 'destructiveHint=false). Graph tambem suporta POST /{adset_id} targeting. Depois da escrita, '
  || 'a executora rele o conjunto na Graph, compara targeting, grava audit_log, atualiza ad_sets.targeting '
  || 'via espelhar() e so marca reconciliacao conferida quando o posicionamento realmente saiu. '
  || 'A flag nasceu false globalmente e foi ligada somente para Legal e Viver por autorizacao '
  || 'expressa do Ryan; aprovacao humana continua obrigatoria.',
  true,
  date '2026-08-11'
);
