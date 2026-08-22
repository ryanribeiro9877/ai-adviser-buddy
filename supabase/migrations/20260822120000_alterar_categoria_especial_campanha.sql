-- alterar_categoria_especial_campanha: card + execucao para corrigir special_ad_categories
-- em campanha ja criada (ex.: COHAPM_JURIDICO_CONV_LEVA01 criada com FINANCIAL por engano).
-- Tambem: isolamento de memoria (desativa fatos de credito/senha colados na COHAPM)
-- e doutrina da nova acao.

-- 1) Flags de execucao (Legal + COHAPM com escrita)
update public.meta_execution_config
   set action_flags = coalesce(action_flags, '{}'::jsonb)
                  || jsonb_build_object('alterar_categoria_especial_campanha', true)
 where company_id in (
   'ded20b38-f42e-4c71-800c-31b97ea48bcf', -- Legal
   '57f755b9-c23d-4f58-a488-8173d697c010'  -- COHAPM
 );

-- 2) Contrato de execucao (campos do payload)
insert into public.contrato_de_execucao
  (acao, campo, obrigatorio, tipo, observacao, fonte, vigente, suportado)
values
  ('alterar_categoria_especial_campanha', 'special_ad_categories', true, 'text[]',
   'Array vazio = remove categoria especial. FINANCIAL_PRODUCTS_SERVICES so quando produto exigir. Graph POST /{campaign_id}.',
   'traffic-chat.t_alterar_categoria_especial + meta-actions', true, true),
  ('alterar_categoria_especial_campanha', 'target_external_id', true, 'text',
   'external_id da campanha no espelho; resolvido na proposta a partir do nome.',
   'traffic-chat + meta-actions', true, true),
  ('alterar_categoria_especial_campanha', 'justificativa', true, 'text',
   'padrao propose_action', 'traffic-chat', true, true),
  ('alterar_categoria_especial_campanha', 'reversa', true, 'text',
   'padrao propose_action', 'traffic-chat', true, true),
  ('alterar_categoria_especial_campanha', 'metrica_sucesso', true, 'text',
   'padrao propose_action', 'traffic-chat', true, true)
on conflict (acao, campo, vigente) do update
  set obrigatorio = excluded.obrigatorio,
      tipo = excluded.tipo,
      observacao = excluded.observacao,
      fonte = excluded.fonte,
      suportado = excluded.suportado;

-- 3) pode_executar_acao reconhece a nova acao (graph|pipeboard)
create or replace function public.pode_executar_acao(p_company_id uuid, p_action text)
 returns jsonb
 language plpgsql
 stable security definer
 set search_path to 'public'
as $function$
declare
  cfg record; v_flag jsonb; v_flag_ligada boolean; v_na_hora int; v_min_folga int;
  v_drv jsonb; v_driver_ef text;
  v_automatizadas text[] := array[
    'criar_campanha','criar_conjunto_a_partir_de','criar_anuncio_a_partir_de','escalar_duplicar',
    'pausar_campanha','pausar_criativo','pausar_conjunto','ativar_campanha','ativar_conjunto','ativar_criativo',
    'alterar_orcamento','renomear_campanha','ajustar_posicionamentos_do_conjunto',
    'alterar_categoria_especial_campanha'
  ];
  v_conhecidas text[] := array[
    'criar_campanha','criar_conjunto_a_partir_de','criar_anuncio_a_partir_de','escalar_duplicar',
    'pausar_campanha','pausar_criativo','pausar_conjunto','ativar_campanha','ativar_conjunto','ativar_criativo',
    'alterar_orcamento','renomear_campanha','ajustar_posicionamentos_do_conjunto',
    'alterar_categoria_especial_campanha','criar_template','upload_midia'
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

  v_drv := public.resolver_driver(p_company_id, p_action);
  v_driver_ef := v_drv ->> 'driver';
  if (v_drv ->> 'suportado') is distinct from 'true' then
    return jsonb_build_object(
      'permitido', false,
      'motivo', coalesce(v_drv ->> 'motivo_bloqueio', 'driver_nao_suporta_acao'),
      'acao', p_action, 'driver_escrita', v_driver_ef, 'driver_fonte', v_drv ->> 'fonte',
      'mensagem_para_o_gestor',
        coalesce(v_drv ->> 'mensagem_para_o_gestor', 'O driver configurado nao suporta esta acao; nenhum card foi emitido.'));
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
    v_min_folga := public.minutos_ate_folga_horario(p_company_id);
    return jsonb_build_object(
      'permitido', false, 'motivo', 'limite_horario_atingido', 'acao', p_action,
      'acoes_na_ultima_hora', v_na_hora, 'limite_horario', cfg.max_actions_per_hour,
      'minutos_ate_folga', v_min_folga,
      'mensagem_para_o_gestor',
        format(
          'Teto horario atingido (%s/%s execucoes bem-sucedidas na ultima hora). Nenhum card foi emitido. Folga em cerca de %s min.',
          v_na_hora, cfg.max_actions_per_hour, v_min_folga
        ));
  end if;

  return jsonb_build_object(
    'permitido', true, 'motivo', 'liberado', 'acao', p_action,
    'dry_run', cfg.dry_run, 'driver_escrita', v_driver_ef, 'driver_fonte', v_drv ->> 'fonte',
    'contas_permitidas_criacao', to_jsonb(coalesce(cfg.contas_permitidas_criacao, '{}'::text[])),
    'teto_sanidade_orcamento_diario', cfg.teto_sanidade_orcamento_diario,
    'max_actions_per_hour', cfg.max_actions_per_hour,
    'acoes_na_ultima_hora', v_na_hora,
    'folga_na_hora', cfg.max_actions_per_hour - v_na_hora,
    'aviso_dry_run', case when cfg.dry_run then
      'ATENCAO: modo de simulacao. Aprovar nao altera a Meta; apenas registra o que faria.' end,
    'mensagem_para_o_gestor', case
      when cfg.dry_run then 'ATENCAO: modo de simulacao; aprovar nao altera a Meta.'
      when p_action = 'alterar_categoria_especial_campanha' then
        'Aprovar altera special_ad_categories da campanha na Meta (Graph/Pipeboard update_campaign). Array vazio remove a categoria. A Meta pode recusar se houver anuncio sob a marca antiga — nesse caso o caminho e campanha nova.'
      when p_action = 'ajustar_posicionamentos_do_conjunto' then
        'Aprovar altera os posicionamentos do conjunto pela Meta. O executor rele o targeting e exige reconciliacao.'
      when p_action = 'pausar_conjunto' then
        'Aprovar pausa o conjunto (status PAUSED).'
      when p_action = 'escalar_duplicar' then
        'Aprovar cria COPIA do conjunto com +20% de orcamento. O original nao e editado. Anuncios nao sao copiados neste card.'
      else null end,
    'nota_do_driver',
      'driver_escrita/driver_por_acao decide o ultimo passo (Graph ou Pipeboard). renomear_campanha e pipeboard-only; alterar_categoria_especial_campanha aceita graph e pipeboard.');
end
$function$;

-- 4) Memoria: desativa contaminacao credito/senha na COHAPM
update public.agent_context
   set vigente = false, atualizado = now()
 where company_id = '57f755b9-c23d-4f58-a488-8173d697c010'
   and vigente = true
   and (
     fato ilike '%CTR SAUDAVEL EM CREDITO%'
     or fato ilike '%SENHA DO ADMIN%'
     or fato ilike '%consignado%'
     or fato ilike '%FIN-04%'
   );

-- 5) Doutrina da nova ferramenta (universal, sem nomear so uma marca)
insert into public.agent_context (categoria, fato, vigente, desde, company_id)
select
  'doutrina',
  'ALTERAR CATEGORIA ESPECIAL DE CAMPANHA EXISTENTE (22/08/2026). Existe acao sancionada alterar_categoria_especial_campanha (tool alterar_categoria_especial → propose_action → card → meta-actions). Params: special_ad_categories (array; [] = remover). NAO diga que "nao ha ferramenta" nem que "so na criacao". Leia o estado com get_campaign_detail / auditar_compliance_financeira antes; emita o card; apos aprovacao o espelho campaigns.special_ad_categories e sincronizado. Se a Meta recusar a troca em campanha com entrega, declare a recusa e ofereca campanha nova — sem inventar incapacidade do sistema.',
  true, current_date, null
where not exists (
  select 1 from public.agent_context
   where vigente = true and company_id is null
     and fato ilike '%ALTERAR CATEGORIA ESPECIAL DE CAMPANHA EXISTENTE%'
);

-- Atualiza doutrina antiga que falava so de LEITURA
update public.agent_context
   set fato = replace(
     fato,
     'Lacuna real restante: audio/frames de video nao passam por check_compliance automatico.',
     'Escrita: use alterar_categoria_especial (card alterar_categoria_especial_campanha). Lacuna restante: audio/frames de video nao passam por check_compliance automatico.'
   ),
   atualizado = now()
 where vigente = true
   and fato ilike '%CATEGORIA ESPECIAL FINANCEIRA E LEGIVEL%'
   and fato ilike '%PROIBIDO dizer ao gestor que "nao ha ferramenta"%';
