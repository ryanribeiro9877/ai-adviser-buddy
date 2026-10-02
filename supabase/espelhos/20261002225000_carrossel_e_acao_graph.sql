-- CARROSSEL E ACAO, NAO SPEC (02/10/2026).
--
-- criar_criativo cai no else e fica pipeboard-only. A fresta de graph no criativo
-- comum fecha. criar_criativo_carrossel entra na mesma migration: se a funcao
-- fechar o criativo comum antes do nome novo existir no catalogo, o carrossel
-- fica sem caminho.
--
-- Nada muda em driver_por_acao. Quando a lista de permitidos e so graph, o nome
-- da acao escolhe o driver. Sem isso, empresa em pipeboard devolveria
-- suportado=false e o carrossel nao nasceria. Graph numa acao do else continua
-- recusado: editar driver_escrita ou driver_por_acao nao reabre escrita.
--
-- Medido em dry_run (02/10/2026): create_ad_creative aceita child_attachments e
-- devolve "No media provided". id nulo.
--
-- Reativar graph numa acao continua sendo migration que devolve a acao ao array.

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
    when 'vincular_instagram_dos_anuncios' then array['graph']
    when 'criar_criativo_carrossel'        then array['graph']
    else array['pipeboard']
  end;

  v_override := nullif(btrim(coalesce(cfg.driver_por_acao ->> p_acao, '')), '');
  if v_override is not null then
    v_driver := case when v_override = 'pipeboard' then 'pipeboard' else 'graph' end;
    v_fonte := 'acao';
  else
    v_driver := case when cfg.driver_escrita = 'pipeboard' then 'pipeboard' else 'graph' end;
    v_fonte := 'empresa';
  end if;

  if v_permitidos = array['graph'] then
    v_driver := 'graph';
    v_fonte := 'acao';
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
end
$function$;

comment on function public.resolver_driver(uuid, text) is
  'Driver de transporte. criar_criativo e pipeboard-only. vincular_instagram_dos_anuncios e criar_criativo_carrossel sao graph pelo nome da acao, sem linha nova em driver_por_acao. Graph numa acao do else devolve suportado=false. Reativar exige migration no array.';

update public.meta_execution_config
   set action_flags = coalesce(action_flags, '{}'::jsonb)
                    || jsonb_build_object(
                         'criar_criativo_carrossel',
                         coalesce(action_flags -> 'criar_criativo', 'false'::jsonb)
                       );

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
    'criar_campanha','criar_conjunto_a_partir_de','criar_conjunto','criar_criativo','criar_criativo_carrossel','criar_anuncio_a_partir_de','escalar_duplicar',
    'pausar_campanha','pausar_criativo','pausar_conjunto','ativar_campanha','ativar_conjunto','ativar_criativo',
    'alterar_orcamento','renomear_campanha','renomear_conjunto','renomear_criativo',
    'ajustar_posicionamentos_do_conjunto','alterar_geo_do_conjunto','alterar_publico_do_conjunto',
    'alterar_idade_do_conjunto','trocar_criativo_do_anuncio',
    'alterar_categoria_especial_campanha','vincular_instagram_dos_anuncios'
  ];
  v_conhecidas text[] := array[
    'criar_campanha','criar_conjunto_a_partir_de','criar_conjunto','criar_criativo','criar_criativo_carrossel','criar_anuncio_a_partir_de','escalar_duplicar',
    'pausar_campanha','pausar_criativo','pausar_conjunto','ativar_campanha','ativar_conjunto','ativar_criativo',
    'alterar_orcamento','renomear_campanha','renomear_conjunto','renomear_criativo',
    'ajustar_posicionamentos_do_conjunto','alterar_geo_do_conjunto','alterar_publico_do_conjunto',
    'alterar_idade_do_conjunto','trocar_criativo_do_anuncio',
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
        when p_action in ('excluir_anuncio','excluir_conjunto','excluir_campanha','deletar_anuncio') then
          'Excluir objeto publicado nao existe neste sistema, em nenhum nivel: o historico de entrega e gasto tem de ficar de pe. Para tirar do ar use pausar_criativo / pausar_conjunto / pausar_campanha; para corrigir nome use renomear_criativo / renomear_conjunto / renomear_campanha.'
        when p_action in (
          'desativar_comentarios','desativar_comentarios_do_post','desligar_comentarios',
          'fechar_comentarios','disable_comments','alterar_comentarios','comment_enabled'
        ) then
          'Desativar comentario e configuracao do post (Instagram ou Meta Business Suite), nao ato de anuncio. Nao ha card. Pausar campanha nao fecha comentario. Faca no app; se o pedido for parar a entrega, peca pausar_campanha explicitamente.'
        when p_action in ('alterar_interesses','alterar_targeting','alterar_publico','editar_publico') then
          'Use alterar_publico_do_conjunto no conjunto JA PUBLICADO (tool dedicada + action_type). NAO crie conjunto novo so para mudar interesse. NAO diga que falta ferramenta.'
        when p_action in ('alterar_idade','alterar_age','editar_idade','alterar_idade_minima','alterar_faixa_etaria') then
          'Use alterar_idade_do_conjunto no conjunto JA PUBLICADO (tool dedicada + action_type). NAO crie conjunto novo so para mudar idade. NAO diga que falta ferramenta.'
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
      when p_action in ('renomear_campanha','renomear_conjunto','renomear_criativo') then
        'Aprovar altera SOMENTE o campo name do objeto existente; id, status, orcamento, criativo e entrega permanecem.'
      when p_action = 'vincular_instagram_dos_anuncios' then
        'Aprovar cria um criativo novo com @cohapm e republica o anuncio (mesmo status). Conjuntos pausados nao sao ativados. So a campanha La Felicita em trabalho.'
      when p_action = 'alterar_categoria_especial_campanha' then
        'Aprovar altera special_ad_categories da campanha na Meta.'
      when p_action = 'ajustar_posicionamentos_do_conjunto' then
        'Aprovar altera os posicionamentos do conjunto pela Meta.'
      when p_action = 'alterar_geo_do_conjunto' then
        'Aprovar troca a geo DESTE conjunto, inclusao ou exclusao (excluded_geo_locations). Nao cria conjunto novo. Divergencia de location_types entre os dois blocos e esperada e nao alarma: a exclusao fica home, recent. O que alarma e o Gerenciador recusar a publicacao.'
      when p_action = 'alterar_publico_do_conjunto' then
        'Aprovar troca targeting.flexible_spec e targeting_automation.advantage_audience DESTE conjunto (nao cria conjunto novo, nao soma orcamento). Geo, idade, plataformas e WhatsApp permanecem. Interesse nao e renda nem historico de busca. Advantage+ desligado por padrao para o recorte valer. Se a Graph recusar, o card falha.'
      when p_action = 'alterar_idade_do_conjunto' then
        'Aprovar troca targeting.age_min e age_max DESTE conjunto (nao cria conjunto novo, nao soma orcamento). Geo, interesses, plataformas e WhatsApp permanecem. Advantage+ ligado so aceita age_min 18–25 e nao aceita age_max (teto 65). Em credito a faixa 18–65 nao pode ser estreitada. Se a Graph recusar, o card falha.'
      when p_action = 'criar_conjunto' then
        'Aprovar cria o conjunto PAUSADO, com o targeting completo do card. Nao ativa. Ativar e outra decisao.'
      when p_action = 'criar_criativo' then
        'Aprovar cria o criativo de uma peca, pelo Pipeboard. Dois ou mais slides usam criar_criativo_carrossel. Criativo e imutavel.'
      when p_action = 'criar_criativo_carrossel' then
        'Aprovar cria o carrossel pela Graph. Dois ou mais slides. Criativo e imutavel.'
      when p_action = 'trocar_criativo_do_anuncio' then
        'Aprovar aponta o anuncio para outro criativo. Nao zera aprendizado, mas reinicia a revisao. Nao declare corrigido sem reler effective_status. O criativo velho permanece.'
      when p_action = 'pausar_conjunto' then
        'Aprovar pausa o conjunto (status PAUSED).'
      when p_action = 'escalar_duplicar' then
        'Aprovar cria COPIA do conjunto com +20% de orcamento.'
      else null end,
    'nota_do_driver',
      'criar_criativo e pipeboard-only. criar_criativo_carrossel e vincular_instagram_dos_anuncios sao graph-only: o Pipeboard aceita child_attachments e devolve No media provided. Graph em qualquer outra acao nao nasce card.');
end
$function$;

comment on function public.pode_executar_acao(uuid, text) is
  'Portao declarativo. criar_criativo e uma peca pelo Pipeboard. criar_criativo_carrossel e dois ou mais slides pela Graph.';

update public.agent_ferramentas
   set descricao = descricao || ' Dois ou mais slides nao entram aqui: use criar_criativo_carrossel.',
       atualizado_em = now()
 where chave = 'criar_criativo'
   and descricao not like '%criar_criativo_carrossel%';

insert into public.agent_ferramentas
  (chave, descricao, parametros, doutrina, superficies, parametros_omitidos, efeito, setor)
values
  ('criar_criativo_carrossel',
   'Emite CARD DE APROVACAO para um criativo com dois ou mais slides (child_attachments). Criativo de uma peca usa criar_criativo. O Pipeboard aceita o parametro child_attachments e devolve No media provided, medido em dry_run; por isso esta acao sai pela Graph. Menos de dois slides e recusado. NAO cria o anuncio.',
   '{"type":"object","properties":{"nome":{"type":"string"},"child_attachments":{"type":"array","description":"2 a 10 slides, cada um com image_hash e link."},"page_id":{"type":"string"},"instagram_actor_id":{"type":"string"},"message":{"type":"string"},"link":{"type":"string"},"call_to_action_type":{"type":"string"},"justificativa":{"type":"string"},"reversa":{"type":"string"},"metrica_sucesso":{"type":"string"}},"required":["page_id","instagram_actor_id","message","child_attachments"]}'::jsonb,
   'Sai pela Graph. O Pipeboard lista child_attachments e mesmo assim responde No media provided. Uma peca so usa criar_criativo.',
   array['chat']::text[],
   '{}'::jsonb,
   'escrita',
   'Atos na conta Meta')
on conflict (chave) do update set
  descricao = excluded.descricao,
  parametros = excluded.parametros,
  doutrina = excluded.doutrina,
  superficies = excluded.superficies,
  efeito = excluded.efeito,
  setor = excluded.setor,
  vigente = true,
  atualizado_em = now();

update public.agent_ferramentas
   set parametros = jsonb_set(
         parametros,
         '{properties,action_type,enum}',
         '["pausar_criativo","ativar_criativo","escalar_criativo","pausar_campanha","ativar_campanha","pausar_conjunto","ativar_conjunto","alterar_orcamento","renomear_campanha","renomear_conjunto","renomear_criativo","alterar_categoria_especial_campanha","ajustar_posicionamentos_do_conjunto","alterar_geo_do_conjunto","alterar_publico_do_conjunto","alterar_idade_do_conjunto","vincular_instagram_dos_anuncios","criar_campanha","criar_conjunto_a_partir_de","criar_conjunto","criar_criativo","criar_criativo_carrossel","criar_anuncio_a_partir_de","escalar_duplicar","trocar_criativo_do_anuncio"]'::jsonb
       ),
       atualizado_em = now()
 where chave = 'propose_action';

insert into public.agent_unidades (agent_codigo, tipo, chave, observacao)
values
  ('AG-06', 'ferramenta', 'criar_criativo_carrossel', 'Cria carrossel pela Graph; o Pipeboard devolve No media provided')
on conflict (agent_codigo, tipo, chave) do update set
  observacao = excluded.observacao,
  vigente = true;

update public.agent_ferramentas
   set efeito = 'escrita', setor = 'Atos na conta Meta'
 where chave = 'criar_criativo_carrossel';

do $prova$
declare
  v_empresa uuid := '307849e6-78a7-4217-8112-3fb0a924f988';
  v_antes jsonb;
  v_r jsonb;
begin
  if exists (
    select 1 from public.meta_execution_config
     where driver_por_acao ? 'criar_criativo_carrossel'
  ) then
    raise exception 'prova: override de carrossel nao deveria existir';
  end if;

  select driver_por_acao into v_antes
    from public.meta_execution_config where company_id = v_empresa;

  v_r := public.resolver_driver(v_empresa, 'criar_criativo');
  if (v_r -> 'drivers_suportados') is distinct from '["pipeboard"]'::jsonb
     or (v_r ->> 'driver') is distinct from 'pipeboard'
     or (v_r ->> 'suportado') is distinct from 'true'
  then
    raise exception 'prova criar_criativo: %', v_r;
  end if;

  v_r := public.resolver_driver(v_empresa, 'criar_criativo_carrossel');
  if (v_r -> 'drivers_suportados') is distinct from '["graph"]'::jsonb
     or (v_r ->> 'driver') is distinct from 'graph'
     or (v_r ->> 'suportado') is distinct from 'true'
  then
    raise exception 'prova carrossel: %', v_r;
  end if;

  update public.meta_execution_config
     set driver_por_acao = coalesce(driver_por_acao, '{}'::jsonb)
                           || jsonb_build_object('criar_criativo', 'graph')
   where company_id = v_empresa;

  v_r := public.resolver_driver(v_empresa, 'criar_criativo');
  if (v_r ->> 'suportado') is distinct from 'false'
     or (v_r ->> 'driver') is distinct from 'graph'
  then
    update public.meta_execution_config set driver_por_acao = v_antes where company_id = v_empresa;
    raise exception 'prova graph em criar_criativo: %', v_r;
  end if;

  update public.meta_execution_config
     set driver_por_acao = v_antes
   where company_id = v_empresa;

  if not exists (
    select 1 from public.agent_ferramentas
     where chave = 'criar_criativo_carrossel' and vigente is true
  ) then
    raise exception 'prova: catalogo sem criar_criativo_carrossel';
  end if;

  if not exists (
    select 1 from public.agent_ferramentas
     where chave = 'propose_action'
       and parametros -> 'properties' -> 'action_type' -> 'enum' ? 'criar_criativo_carrossel'
  ) then
    raise exception 'prova: enum de propose_action sem o carrossel';
  end if;
end
$prova$;
