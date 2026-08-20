-- Teto horario: slate nao fica preso apos falha / lote de 5.
--
-- Sintoma (20/08/2026, Legal e Viver): apos aprovar slate (4 anuncios OK + carrossel
-- meta_action_failed por app em Development), contar_acoes_na_hora = 5 e
-- max_actions_per_hour = 5 → pode_executar_acao recusou NOVO card (limite_horario_atingido).
-- O agente pediu ao gestor "aguarde e diga emite de novo" — UX ruim; a falha nao deveria
-- consumir a folga de re-emissao, e 5/h e curto justo para campanha+conjunto+5 pecas+retry.
--
-- Mudancas:
-- 1) contar_acoes_na_hora conta SO meta_action_executed (alinha com meta-actions; failed
--    nao prende re-emissao). dry_run/blocked continuam fora.
-- 2) LEV max_actions_per_hour 5 → 12 (folha para slate normal + retries).
-- 3) mensagem de recusa traz N/limite, minutos_ate_folga e proibe pedir "emite" de novo.
-- 4) doutrina vigente descreve o teto e o comportamento do agente.

create or replace function public.contar_acoes_na_hora(p_company_id uuid)
returns integer
language sql
stable
set search_path to 'public', 'pg_temp'
as $$
  select count(*)::int
  from public.audit_log
  where company_id = p_company_id
    and action = 'meta_action_executed'
    and created_at > now() - interval '1 hour';
$$;

comment on function public.contar_acoes_na_hora(uuid) is
  'Teto horario (20/08/2026): conta so meta_action_executed desta empresa na ultima hora. Falhas (meta_action_failed), dry_run e blocked NAO contam — falha nao consome folga de re-emissao. Alinhado ao portao da meta-actions.';

create or replace function public.minutos_ate_folga_horario(p_company_id uuid)
returns integer
language sql
stable
set search_path to 'public', 'pg_temp'
as $$
  select coalesce(
    greatest(
      0,
      ceil(
        extract(
          epoch from (
            (min(created_at) + interval '1 hour') - now()
          )
        ) / 60.0
      )::int
    ),
    0
  )
  from public.audit_log
  where company_id = p_company_id
    and action = 'meta_action_executed'
    and created_at > now() - interval '1 hour';
$$;

comment on function public.minutos_ate_folga_horario(uuid) is
  'Minutos ate a acao executada mais antiga sair da janela de 1h (folga do teto horario). 0 se nao ha contagem.';

revoke all on function public.minutos_ate_folga_horario(uuid) from public, anon, authenticated;
grant execute on function public.minutos_ate_folga_horario(uuid) to service_role;

update public.meta_execution_config
   set max_actions_per_hour = 12
 where company_id = 'ded20b38-f42e-4c71-800c-31b97ea48bcf'
   and max_actions_per_hour is not null
   and max_actions_per_hour < 12;

create or replace function public.pode_executar_acao(p_company_id uuid, p_action text)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public'
as $function$
declare
  cfg record; v_flag jsonb; v_flag_ligada boolean; v_na_hora int; v_min_folga int;
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
          'Teto horario atingido (%s/%s execucoes bem-sucedidas na ultima hora). Nenhum card foi emitido. Folga em cerca de %s min. Diga o tempo de espera ao gestor — NAO peca para repetir "emite" agora; quando houver folga, emita o card sem pedir de novo.',
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
      when p_action = 'ajustar_posicionamentos_do_conjunto' then
        'Aprovar altera os posicionamentos do conjunto pela Meta. O executor rele o targeting e exige reconciliacao.'
      when p_action = 'pausar_conjunto' then
        'Aprovar pausa o conjunto (status PAUSED). Reativar continua MANUAL no Gerenciador — nao ha ativar_conjunto neste sistema.'
      when p_action = 'escalar_duplicar' then
        'Aprovar cria COPIA do conjunto com +20% de orcamento (PAUSED). O original nao e editado. Anuncios nao sao copiados neste card.'
      else null end,
    'limite_do_teto_horario',
      'Conta so meta_action_executed desta empresa na ultima hora (falhas nao entram). O portao final continua na meta-actions.',
    'nota_do_driver',
      'driver_escrita/driver_por_acao decide o ultimo passo (Graph ou Pipeboard), nunca SE sai. renomear_campanha e pipeboard-only.',
    'lembrete_do_contrato',
      'Escala exige avaliar_escala.apto na proposta e na execucao; orcamento travado em +20%.');
end
$function$;

-- Doutrina: comportamento do agente no teto (substitui o "diga emite de novo").
update public.agent_context
   set vigente = false
 where vigente = true
   and fato like 'ESCRITA REAL LIGADA - dry_run DESLIGADO. ESTE FATO SUBSTITUI O FATO 96%'
   and fato like '%5 acoes por hora%';

insert into public.agent_context (categoria, fato, vigente, desde, company_id)
values (
  'doutrina',
  'TETO HORARIO DE ESCRITA (20/08/2026). pode_executar_acao conta so meta_action_executed desta empresa na ultima hora (falhas NAO contam). Nesta empresa max_actions_per_hour = 12 (cabe slate campanha+conjunto+varias pecas+retry). Se motivo=limite_horario_atingido: declare N/limite e minutos_ate_folga; NAO peca ao gestor para repetir "emite" — diga o tempo ou emita assim que houver folga_na_hora. Card pendente NAO consome o teto; so execucao bem-sucedida.',
  true,
  now(),
  'ded20b38-f42e-4c71-800c-31b97ea48bcf'
);
