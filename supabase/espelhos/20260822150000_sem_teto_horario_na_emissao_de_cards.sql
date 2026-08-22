-- Pedido do gestor (22/08/2026): o teto de 5 acoes/hora estava BARRANDO emitir card.
-- COHAPM estava 5/5 e o chat pediu para esperar ~4 min em vez de emitir o lote
-- (2 conjuntos + 6 anuncios). Card e aprovacao humana continuam; o teto nao e porta
-- da proposta. Na execucao, sobe o disjuntor 5/12 → 100/h (Legal + COHAPM).

-- 1) Disjuntor de escrita alto o suficiente para um slate + retries na mesma hora.
update public.meta_execution_config
   set max_actions_per_hour = 100
 where company_id in (
   'ded20b38-f42e-4c71-800c-31b97ea48bcf', -- Legal e Viver
   '57f755b9-c23d-4f58-a488-8173d697c010'  -- COHAPM
 );

alter table public.meta_execution_config
  alter column max_actions_per_hour set default 100;

-- 2) pode_executar_acao NAO recusa mais por teto horario. Continua contando
--    (acoes_na_ultima_hora / folga_na_hora) so para observabilidade.
create or replace function public.pode_executar_acao(p_company_id uuid, p_action text)
 returns jsonb
 language plpgsql
 stable security definer
 set search_path to 'public'
as $function$
declare
  cfg record; v_flag jsonb; v_flag_ligada boolean; v_na_hora int;
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

comment on function public.pode_executar_acao(uuid, text) is
  'Portao unico da proposta (22/08/2026): flags, driver e conta. NAO recusa por teto horario — emitir card nao espera folga. A contagem na hora segue no JSON (observabilidade); o disjuntor de escrita mora na meta-actions (max_actions_per_hour).';

-- 3) Doutrina: o agente nao deve mais pedir espera de minutos.
update public.agent_context
   set vigente = false
 where vigente = true
   and (
     fato like 'TETO HORARIO DE ESCRITA%'
     or fato like '%5 acoes por hora%'
     or fato like '%max_actions_per_hour = 12%'
   );

insert into public.agent_context (categoria, fato, vigente, desde, company_id)
values (
  'doutrina',
  'EMISSAO DE CARDS NAO ESPERA TETO HORARIO (22/08/2026). Pedido do gestor: NAO recuse emitir card por 5/h nem peca para aguardar minutos / reabrir a conversa. pode_executar_acao libera a proposta mesmo com acoes na ultima hora. Aprovacao humana continua sendo o portao. A execucao na Meta tem disjuntor alto (100/h por empresa), nao trava de lote. Se o gestor pedir o lote (conjuntos + anuncios), emita os cards agora. NUNCA diga "limite horario de emissao" nem "5/5 proposes".',
  true,
  now(),
  null
);
