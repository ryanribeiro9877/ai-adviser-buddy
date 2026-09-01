-- RENOMEAR NOS TRES NIVEIS, E SEM TRAVA DE DRIVER.
--
-- O DEFEITO: em 01/09/2026 dois anuncios do CONJ.2_VISTTA nasceram com o NOME DO CONJUNTO
-- ("CONJ.2_VISTTA_WA_7199185-8107") no lugar do nome do criativo. O agente localizou os dois,
-- soube dizer o nome correto de cada um e concluiu a unica coisa que o sistema permitia:
-- "nao existe card de renomeacao de anuncio; faca o ajuste direto no Gerenciador". Existia
-- renomear_campanha e mais nada. Trabalho na mao por falta de ferramenta, nao por decisao.
--
-- Renomear e a MESMA escrita nos tres niveis: POST /{id} com o campo `name`. Nao havia razao
-- tecnica para o buraco. Entram renomear_conjunto e renomear_criativo, com execucao real em
-- meta-actions (v5.60) e espelho de nome em ad_sets/ads igual ao que campaigns ja tinha.
--
-- Junto cai a exigencia de Pipeboard em renomear_campanha. Ela vinha de como a ferramenta foi
-- introduzida (update_campaign nativo do Pipeboard em 10/08/2026), nao de limite da Meta — e
-- em 01/09 virou parede: a COHAPM, que escreve pela Graph, recebeu driver_nao_suporta_acao ao
-- pedir um rename legitimo, e so passou depois de abrirem override em driver_por_acao. A Graph
-- renomeia campanha pelo mesmo caminho generico dos outros niveis.

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

  -- renomear_campanha saiu daqui: renomear e POST /{id} com `name`, que os dois drivers fazem.
  -- vincular_instagram_dos_anuncios continua graph-only porque republica o anuncio com criativo
  -- novo, e isso o Pipeboard nao expoe.
  v_permitidos := case p_acao
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
end
$function$;

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
    'pausar_campanha','pausar_criativo','pausar_conjunto','ativar_campanha','ativar_conjunto','ativar_criativo',
    'alterar_orcamento','renomear_campanha','renomear_conjunto','renomear_criativo',
    'ajustar_posicionamentos_do_conjunto',
    'alterar_categoria_especial_campanha','vincular_instagram_dos_anuncios'
  ];
  v_conhecidas text[] := array[
    'criar_campanha','criar_conjunto_a_partir_de','criar_anuncio_a_partir_de','escalar_duplicar',
    'pausar_campanha','pausar_criativo','pausar_conjunto','ativar_campanha','ativar_conjunto','ativar_criativo',
    'alterar_orcamento','renomear_campanha','renomear_conjunto','renomear_criativo',
    'ajustar_posicionamentos_do_conjunto',
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
      when p_action = 'pausar_conjunto' then
        'Aprovar pausa o conjunto (status PAUSED).'
      when p_action = 'escalar_duplicar' then
        'Aprovar cria COPIA do conjunto com +20% de orcamento.'
      else null end,
    'nota_do_driver',
      'vincular_instagram_dos_anuncios e graph-only. Renomear roda nos dois drivers, nos tres niveis.');
end
$function$;

comment on function public.pode_executar_acao(uuid, text) is
  'Portao declarativo das acoes do agente. Renomear existe nos tres niveis (campanha/conjunto/anuncio) e roda em qualquer driver; excluir objeto publicado nao existe em nenhum nivel.';

-- Registra as duas chaves em todas as empresas para que a leitura de action_flags mostre a
-- postura explicita, e liga onde renomear ja era permitido no nivel de campanha: quem pode
-- corrigir o nome da campanha nao tem por que ficar sem corrigir o do conjunto e o do anuncio.
update public.meta_execution_config
   set action_flags = coalesce(action_flags, '{}'::jsonb)
                    || jsonb_build_object(
                         'renomear_conjunto', coalesce(action_flags -> 'renomear_campanha', 'false'::jsonb),
                         'renomear_criativo', coalesce(action_flags -> 'renomear_campanha', 'false'::jsonb)
                       );

-- A COHAPM ganhou override renomear_campanha=pipeboard em 01/09 so para furar a trava que esta
-- migration remove. Sem a trava, o override vira desvio silencioso do driver da empresa (graph):
-- renomear campanha sairia por um caminho e renomear conjunto/anuncio por outro.
update public.meta_execution_config
   set driver_por_acao = driver_por_acao - 'renomear_campanha'
 where driver_por_acao ? 'renomear_campanha';
