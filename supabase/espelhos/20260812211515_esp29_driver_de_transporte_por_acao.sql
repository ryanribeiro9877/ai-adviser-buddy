-- ESPELHO DE MIGRACAO APLICADA
-- version: 20260812211515
-- name: esp29_driver_de_transporte_por_acao
-- projeto: gzjwnjdpxpbmdhcyefvs (Gestor de Trafego IA)
-- aplicada por: Claude via MCP apply_migration
-- espelho gerado a partir de supabase_migrations.schema_migrations - NAO transcrito a mao

-- ESP-29: driver de transporte (graph|pipeboard) por empresa E por acao.
alter table public.meta_execution_config
  add column if not exists driver_por_acao jsonb not null default '{}'::jsonb;

comment on column public.meta_execution_config.driver_por_acao is
  'ESP-29: override do driver de transporte por acao, ex.: {"renomear_campanha":"pipeboard"}. Precedencia: acao > driver_escrita (empresa) > graph. Valores graph|pipeboard.';

create or replace function public.resolver_driver(p_company_id uuid, p_acao text)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public'
as $function$
declare
  cfg record;
  v_override text;
  v_driver text;
  v_fonte text;
  v_permitidos text[];
begin
  if p_company_id is null then
    return jsonb_build_object('erro','company_id_obrigatorio','motivo','resolver_driver exige a empresa.');
  end if;

  select * into cfg from public.meta_execution_config where company_id = p_company_id;
  if cfg is null then
    return jsonb_build_object(
      'suportado', false, 'driver', null, 'fonte', 'sem_config', 'acao', p_acao,
      'motivo_bloqueio', 'empresa_sem_configuracao_de_execucao',
      'mensagem_para_o_gestor', 'Empresa sem configuracao de execucao; sem driver nada e transportado.'
    );
  end if;

  -- Matriz de capacidade: drivers que CADA acao suporta hoje.
  v_permitidos := case p_acao
    when 'renomear_campanha' then array['pipeboard']
    else array['graph','pipeboard']
  end;

  v_override := nullif(btrim(coalesce(cfg.driver_por_acao ->> p_acao, '')), '');
  if v_override is not null then
    v_driver := case when v_override = 'pipeboard' then 'pipeboard' else 'graph' end;
    v_fonte := 'acao';
  else
    v_driver := case when cfg.driver_escrita = 'pipeboard' then 'pipeboard' else 'graph' end;
    v_fonte := 'empresa';
  end if;

  if not (v_driver = any(v_permitidos)) then
    return jsonb_build_object(
      'suportado', false, 'driver', v_driver, 'fonte', v_fonte, 'acao', p_acao,
      'drivers_suportados', to_jsonb(v_permitidos),
      'motivo_bloqueio', format('driver_nao_suporta_%s', p_acao),
      'mensagem_para_o_gestor',
        format('A acao %s nao roda no driver %s (suporta: %s). Ajuste driver_por_acao/driver_escrita. Nenhum card foi emitido.', p_acao, v_driver, array_to_string(v_permitidos, ', '))
    );
  end if;

  return jsonb_build_object(
    'suportado', true, 'driver', v_driver, 'fonte', v_fonte, 'acao', p_acao,
    'drivers_suportados', to_jsonb(v_permitidos)
  );
end $function$;

comment on function public.resolver_driver(uuid, text) is
  'ESP-29: resolve o driver de transporte de UMA acao com precedencia override(driver_por_acao) > empresa(driver_escrita) > graph e matriz de capacidade (renomear_campanha e pipeboard-only).';

revoke all on function public.resolver_driver(uuid, text) from public, anon;
grant execute on function public.resolver_driver(uuid, text) to service_role;

-- pode_executar_acao passa a resolver o driver por acao (substitui os gates fixos de driver).
create or replace function public.pode_executar_acao(p_company_id uuid, p_action text)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public'
as $function$
declare
  cfg record; v_flag jsonb; v_flag_ligada boolean; v_na_hora int;
  v_drv jsonb; v_driver_ef text;
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

  -- ESP-29: driver resolvido por acao (override > empresa > graph) + matriz de capacidade.
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
    return jsonb_build_object(
      'permitido', false, 'motivo', 'limite_horario_atingido', 'acao', p_action,
      'acoes_na_ultima_hora', v_na_hora, 'limite_horario', cfg.max_actions_per_hour,
      'mensagem_para_o_gestor', 'O limite de acoes na ultima hora foi atingido; nenhum card foi emitido.');
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
      when p_action = 'ajustar_posicionamentos_do_conjunto' then
        'Aprovar altera os posicionamentos do conjunto pela Meta. O executor rele o targeting e exige reconciliacao.'
      when p_action = 'pausar_conjunto' then
        'Aprovar pausa o conjunto (status PAUSED). Reativar continua MANUAL no Gerenciador — nao ha ativar_conjunto neste sistema.'
      when p_action = 'escalar_duplicar' then
        'Aprovar cria COPIA do conjunto com +20% de orcamento (PAUSED). O original nao e editado. Anuncios nao sao copiados neste card.'
      else null end,
    'limite_do_teto_horario',
      'Contado no audit_log desta empresa na ultima hora. O portao final continua na meta-actions.',
    'nota_do_driver',
      'driver_escrita/driver_por_acao decide o ultimo passo (Graph ou Pipeboard), nunca SE sai. renomear_campanha e pipeboard-only.',
    'lembrete_do_contrato',
      'Escala exige avaliar_escala.apto na proposta e na execucao; orcamento travado em +20%.');
end
$function$;

insert into public.agent_context (categoria, fato, vigente, desde)
values (
  'doutrina',
  'DRIVER DE TRANSPORTE POR ACAO (ESP-29, 12/08/2026). O driver (graph|pipeboard) do ultimo passo passa a ser resolvido POR ACAO via resolver_driver(company_id, acao): precedencia override em meta_execution_config.driver_por_acao > driver_escrita (empresa) > graph. Matriz de capacidade: renomear_campanha e pipeboard-only; demais acoes sancionadas aceitam graph e pipeboard. pode_executar_acao e meta-actions usam o driver RESOLVIDO; o driver decide ONDE sai, nunca SE sai (permissao continua em master_enabled + action_flags + limites).',
  true,
  date '2026-08-12'
);
