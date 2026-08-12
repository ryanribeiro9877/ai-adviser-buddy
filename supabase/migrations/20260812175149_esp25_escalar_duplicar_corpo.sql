-- ESP-25: escalar_duplicar como escrita sancionada (+20% por duplicacao).
-- alterar_orcamento ja estava ligado (edicao de verba); escala e OUTRA acao.
-- redistribuir_orcamento NAO entra nesta migracao.
-- Flag nasce false para TODAS; ligada so para Legal e Viver.
-- Aplicada via MCP; espelho fiel via espelhos_de_migracao.

update public.meta_execution_config
   set action_flags = coalesce(action_flags, '{}'::jsonb)
                    || jsonb_build_object('escalar_duplicar', false);

update public.meta_execution_config
   set action_flags = jsonb_set(
         action_flags,
         '{escalar_duplicar}',
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
    'criar_campanha','criar_conjunto_a_partir_de','criar_anuncio_a_partir_de','escalar_duplicar',
    'pausar_campanha','pausar_criativo','pausar_conjunto','alterar_orcamento','renomear_campanha',
    'ajustar_posicionamentos_do_conjunto'
  ];
  v_conhecidas text[] := array[
    'criar_campanha','criar_conjunto_a_partir_de','criar_anuncio_a_partir_de','escalar_duplicar',
    'pausar_campanha','pausar_criativo','pausar_conjunto','alterar_orcamento','renomear_campanha',
    'ajustar_posicionamentos_do_conjunto','criar_template','upload_midia'
  ];
begin
  if p_action is null or not (p_action = any(v_conhecidas)) then
    return jsonb_build_object(
      'permitido', false, 'motivo', 'acao_desconhecida', 'acao', p_action,
      'acoes_conhecidas', to_jsonb(v_conhecidas),
      'mensagem_para_o_gestor', case
        when p_action = 'escalar_criativo' then
          'Escalar criativo nao e uma acao propria deste sistema: use alterar_orcamento no conjunto ou escalar_duplicar no conjunto apto.'
        when p_action = 'redistribuir_orcamento' then
          'Redistribuir orcamento entre conjuntos ainda nao e acao sancionada. Use alterar_orcamento ou escalar_duplicar.'
        when p_action = 'replicar_template' then
          'Replicar modelo de mensagem usa rotina propria, nao card de aprovacao.'
        when p_action like 'ativar_%' then
          'Ativar objetos continua MANUAL no Gerenciador de Anuncios. Este sistema so pausa (pausar_campanha, pausar_conjunto, pausar_criativo).'
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

  if p_action = 'ajustar_posicionamentos_do_conjunto'
     and cfg.driver_escrita not in ('graph','pipeboard') then
    return jsonb_build_object(
      'permitido', false, 'motivo', 'driver_nao_suporta_edicao_de_posicionamento',
      'acao', p_action, 'driver_escrita', cfg.driver_escrita,
      'mensagem_para_o_gestor',
      'O driver configurado nao suporta editar targeting/posicionamentos de conjunto; nenhum card foi emitido.');
  end if;

  if p_action = 'pausar_conjunto'
     and cfg.driver_escrita not in ('graph','pipeboard') then
    return jsonb_build_object(
      'permitido', false, 'motivo', 'driver_nao_suporta_pausar_conjunto',
      'acao', p_action, 'driver_escrita', cfg.driver_escrita,
      'mensagem_para_o_gestor',
      'O driver configurado nao suporta pausar conjunto; nenhum card foi emitido.');
  end if;

  if p_action = 'escalar_duplicar'
     and cfg.driver_escrita not in ('graph','pipeboard') then
    return jsonb_build_object(
      'permitido', false, 'motivo', 'driver_nao_suporta_escalar_duplicar',
      'acao', p_action, 'driver_escrita', cfg.driver_escrita,
      'mensagem_para_o_gestor',
      'O driver configurado nao suporta criar conjunto (escala por duplicacao); nenhum card foi emitido.');
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
      when p_action = 'pausar_conjunto' then
        'Aprovar pausa o conjunto (status PAUSED). Reativar continua MANUAL no Gerenciador — nao ha ativar_conjunto neste sistema.'
      when p_action = 'escalar_duplicar' then
        'Aprovar cria COPIA do conjunto com +20% de orcamento (PAUSED). O original nao e editado. Anuncios nao sao copiados neste card.'
      else null end,
    'limite_do_teto_horario',
      'Contado no audit_log desta empresa na ultima hora. O portao final continua na meta-actions.',
    'nota_do_driver',
      'driver_escrita decide o ultimo passo. Escala: Graph POST /act_/adsets ou Pipeboard create_adset.',
    'lembrete_do_contrato',
      'Escala exige avaliar_escala.apto na proposta e na execucao; orcamento travado em +20%.');
end
$function$;

delete from public.contrato_de_execucao
 where acao = 'escalar_duplicar';

insert into public.contrato_de_execucao
  (acao,campo,obrigatorio,tipo,observacao,fonte,vigente,suportado,valores_aceitos)
values
  ('escalar_duplicar','molde_external_id',true,'text',
   'ID Meta do conjunto ORIGINAL (continua entregando). Escala NAO o edita.',
   'traffic-chat.t_propose_criacao + meta-actions.montarCriacao',true,true,null),
  ('escalar_duplicar','campanha_destino_external_id',true,'text',
   'Sempre a mesma campanha do molde (resolvida no espelho).',
   'traffic-chat.t_propose_criacao',true,true,null),
  ('escalar_duplicar','nome_novo',true,'text',
   'Nome da copia. Default: molde + [ESC+20 ...].',
   'traffic-chat.t_propose_criacao',true,true,null),
  ('escalar_duplicar','orcamento_diario_reais',true,'number',
   'Travado em avaliar_escala.medidas.orcamento_proposto_dia (+20%). Livre = recusa.',
   'avaliar_escala + julgarOrcamentoDiario',true,true,null),
  ('escalar_duplicar','justificativa',true,'text',
   'Evidencia no card.',
   'traffic-chat.t_propose_criacao',true,true,null),
  ('escalar_duplicar','reversa',true,'text',
   'Excluir/pausar a copia (nasce PAUSED). Original intacto.',
   'traffic-chat.t_propose_criacao',true,true,null),
  ('escalar_duplicar','metrica_sucesso',true,'text',
   'Copia criada PAUSED com daily_budget = escada; original inalterado.',
   'traffic-chat + reconciliarAposEscrita',true,true,null);

-- Doutrina: caminho de alterar_orcamento + escala sancionada; redistribuir adiado.
insert into public.agent_context (categoria,fato,vigente,desde)
values (
  'doutrina',
  'ESCALA POR DUPLICACAO ESCRITA (ESP-25, 12/08/2026). Alem de avaliar_escala (so leitura), '
  || 'existe a acao sancionada escalar_duplicar: card + aprovacao + create_adset com +20%. '
  || 'So emite se apto_a_escalar; revalida na execucao; orcamento travado na escada; mesma '
  || 'campanha; targeting herdado; nasce PAUSED; original NAO e editado. Anuncios do molde '
  || 'NAO sao copiados neste card — use criar_anuncio_a_partir_de depois. alterar_orcamento '
  || 'continua sendo EDICAO de verba no conjunto existente (propose+execute+ESP-26+update_adset); '
  || 'caminho estrutural validado 12/08 (flag ligada, juiz na proposta e na fila) — ainda sem '
  || 'card historico de alterar_orcamento na LEV. redistribuir_orcamento fica de fora.',
  true,
  date '2026-08-12'
);
