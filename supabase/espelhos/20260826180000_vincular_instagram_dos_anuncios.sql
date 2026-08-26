-- Espelho: supabase/migrations/20260826180000_vincular_instagram_dos_anuncios.sql

-- Leitura nominal + escrita sancionada do Instagram em anuncios JA criados
-- (campanha La Felicità em trabalho). Sem isso o agente so lia o perfil da
-- conta e dizia que nao havia acao de edicao.

update public.meta_execution_config
   set action_flags = coalesce(action_flags, '{}'::jsonb)
                  || jsonb_build_object('vincular_instagram_dos_anuncios', true),
       driver_por_acao = coalesce(driver_por_acao, '{}'::jsonb)
                      || jsonb_build_object('vincular_instagram_dos_anuncios', 'graph')
 where company_id in (
   'ded20b38-f42e-4c71-800c-31b97ea48bcf',
   '57f755b9-c23d-4f58-a488-8173d697c010'
 );

insert into public.contrato_de_execucao
  (acao, campo, obrigatorio, tipo, observacao, fonte, vigente, suportado)
values
  ('vincular_instagram_dos_anuncios', 'campanha_external_id', true, 'text',
   'Campanha alvo (Graph). So COHAPM_LAFELICITA_CONV_*; Juridico e SALT recusados.',
   'traffic-chat.t_vincular_instagram_anuncios + meta-actions', true, true),
  ('vincular_instagram_dos_anuncios', 'instagram_destino_id', true, 'text',
   'IBA oficial (@cohapm). Novo adcreative + update_ad. Status do anuncio se mantem.',
   'traffic-chat + meta-actions', true, true),
  ('vincular_instagram_dos_anuncios', 'justificativa', true, 'text',
   'padrao propose_action', 'traffic-chat', true, true),
  ('vincular_instagram_dos_anuncios', 'reversa', true, 'text',
   'padrao propose_action', 'traffic-chat', true, true),
  ('vincular_instagram_dos_anuncios', 'metrica_sucesso', true, 'text',
   'padrao propose_action', 'traffic-chat', true, true)
on conflict (acao, campo, vigente) do update
  set obrigatorio = excluded.obrigatorio,
      tipo = excluded.tipo,
      observacao = excluded.observacao,
      fonte = excluded.fonte,
      suportado = excluded.suportado;

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

  v_permitidos := case p_acao
    when 'renomear_campanha' then array['pipeboard']
    when 'vincular_instagram_dos_anuncios' then array['graph']
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
    'alterar_categoria_especial_campanha','vincular_instagram_dos_anuncios'
  ];
  v_conhecidas text[] := array[
    'criar_campanha','criar_conjunto_a_partir_de','criar_anuncio_a_partir_de','escalar_duplicar',
    'pausar_campanha','pausar_criativo','pausar_conjunto','ativar_campanha','ativar_conjunto','ativar_criativo',
    'alterar_orcamento','renomear_campanha','ajustar_posicionamentos_do_conjunto',
    'alterar_categoria_especial_campanha','vincular_instagram_dos_anuncios','criar_template','upload_midia'
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
      when p_action = 'vincular_instagram_dos_anuncios' then
        'Aprovar cria um criativo novo com @cohapm e republica o anuncio (mesmo status). Conjuntos pausados nao sao ativados. So a campanha La Felicità em trabalho.'
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
      'driver_escrita/driver_por_acao decide o ultimo passo. vincular_instagram_dos_anuncios e graph-only; renomear_campanha e pipeboard-only.');
end
$function$;

comment on function public.pode_executar_acao(uuid, text) is
  'Portao unico da proposta: flags, driver e conta. NAO recusa por teto horario. Inclui vincular_instagram_dos_anuncios (26/08/2026).';

grant execute on function public.pode_executar_acao(uuid, text) to service_role;
grant execute on function public.resolver_driver(uuid, text) to service_role;

insert into public.agent_context (company_id, categoria, fato, vigente, desde)
values (
  '57f755b9-c23d-4f58-a488-8173d697c010',
  'instagram_anuncios',
  'INSTAGRAM DOS ANUNCIOS (26/08/2026). Para classificar @coop_cohapm vs @cohapm use get_instagram_dos_anuncios(campanha=COHAPM_LAFELICITA_CONV_AGO26): le a Graph por peca, conjuntos ACTIVE e PAUSED. O perfil unico da conta NAO prova o vinculo de cada anuncio. Para alterar: vincular_instagram_dos_anuncios — emite card; a aprovacao troca o criativo para @cohapm e republica (status se mantem). Juridico e SALT ficam de fora. Nao diga que falta ferramenta.',
  true,
  now()
);
