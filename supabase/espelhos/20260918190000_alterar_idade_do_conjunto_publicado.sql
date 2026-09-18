-- IDADE DE CONJUNTO PUBLICADO (18/09/2026)
--
-- O DEFEITO. O gestor perguntou se da para alterar idade minima e maxima
-- num conjunto ACTIVE ja criado. A Meta aceita POST /{adset_id} targeting
-- (age_min/age_max) no objeto vivo — o mesmo caminho de alterar_geo e
-- alterar_publico. A casa nao tinha acao: o chat so lia a faixa.
--
-- Entra alterar_idade_do_conjunto: troca age_min/age_max no targeting atual,
-- preserva geo/interesses/plataformas/WhatsApp. Advantage+ ligado recusa
-- age_max e so aceita age_min 18–25 (erro 1870188): faixa estreita exige
-- advantage_audience=0 (default quando a faixa nao e 18–25 ate 65).
-- Em credito, checar_segmentacao recusa estreitamento (fair lending).
-- Duplicar conjunto fica de reserva SE a Graph recusar o PATCH.

update public.meta_execution_config
   set action_flags = coalesce(action_flags, '{}'::jsonb)
                    || jsonb_build_object(
                         'alterar_idade_do_conjunto',
                         coalesce(
                           action_flags -> 'alterar_publico_do_conjunto',
                           action_flags -> 'alterar_geo_do_conjunto',
                           action_flags -> 'ajustar_posicionamentos_do_conjunto',
                           'false'::jsonb
                         )
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
    'criar_campanha','criar_conjunto_a_partir_de','criar_anuncio_a_partir_de','escalar_duplicar',
    'pausar_campanha','pausar_criativo','pausar_conjunto','ativar_campanha','ativar_conjunto','ativar_criativo',
    'alterar_orcamento','renomear_campanha','renomear_conjunto','renomear_criativo',
    'ajustar_posicionamentos_do_conjunto','alterar_geo_do_conjunto','alterar_publico_do_conjunto',
    'alterar_idade_do_conjunto',
    'alterar_categoria_especial_campanha','vincular_instagram_dos_anuncios'
  ];
  v_conhecidas text[] := array[
    'criar_campanha','criar_conjunto_a_partir_de','criar_anuncio_a_partir_de','escalar_duplicar',
    'pausar_campanha','pausar_criativo','pausar_conjunto','ativar_campanha','ativar_conjunto','ativar_criativo',
    'alterar_orcamento','renomear_campanha','renomear_conjunto','renomear_criativo',
    'ajustar_posicionamentos_do_conjunto','alterar_geo_do_conjunto','alterar_publico_do_conjunto',
    'alterar_idade_do_conjunto',
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
        'Aprovar troca targeting.geo_locations DESTE conjunto (nao cria conjunto novo, nao soma orcamento). Idade, plataformas e WhatsApp permanecem. Se a Graph recusar, o card falha.'
      when p_action = 'alterar_publico_do_conjunto' then
        'Aprovar troca targeting.flexible_spec e targeting_automation.advantage_audience DESTE conjunto (nao cria conjunto novo, nao soma orcamento). Geo, idade, plataformas e WhatsApp permanecem. Interesse nao e renda nem historico de busca. Advantage+ desligado por padrao para o recorte valer. Se a Graph recusar, o card falha.'
      when p_action = 'alterar_idade_do_conjunto' then
        'Aprovar troca targeting.age_min e age_max DESTE conjunto (nao cria conjunto novo, nao soma orcamento). Geo, interesses, plataformas e WhatsApp permanecem. Advantage+ ligado so aceita age_min 18–25 e nao aceita age_max (teto 65). Em credito a faixa 18–65 nao pode ser estreitada. Se a Graph recusar, o card falha.'
      when p_action = 'pausar_conjunto' then
        'Aprovar pausa o conjunto (status PAUSED).'
      when p_action = 'escalar_duplicar' then
        'Aprovar cria COPIA do conjunto com +20% de orcamento.'
      else null end,
    'nota_do_driver',
      'vincular_instagram_dos_anuncios e graph-only. Geo, publico, idade e posicionamentos rodam nos dois drivers via update_adset / POST targeting.');
end
$function$;

comment on function public.pode_executar_acao(uuid, text) is
  'Portao declarativo das acoes do agente. alterar_idade_do_conjunto edita age_min/age_max do conjunto publicado; alterar_publico edita flexible_spec; alterar_geo edita geo_locations; excluir objeto publicado nao existe; desativar comentario do post nao e acao de anuncio.';

delete from public.contrato_de_execucao
 where acao = 'alterar_idade_do_conjunto';

insert into public.contrato_de_execucao
  (acao,campo,obrigatorio,tipo,observacao,fonte,vigente,suportado,valores_aceitos)
values
  ('alterar_idade_do_conjunto','target_external_id',true,'text',
   'ID Meta do conjunto; resolvido pelo card a partir de ad_sets da mesma empresa.',
   'traffic-chat.t_propose_action + meta-actions executor',true,true,null),
  ('alterar_idade_do_conjunto','target_name',true,'text',
   'Nome humano do conjunto, para card e auditoria.',
   'traffic-chat.t_propose_action',true,true,null),
  ('alterar_idade_do_conjunto','idade_min',true,'int',
   'age_min inteiro 18–65. Alias age_min. Os dois extremos sao obrigatorios.',
   'traffic-chat.validarIdadeDoPedido + meta-actions.aplicarIdadeNoTargeting',true,true,null),
  ('alterar_idade_do_conjunto','idade_max',true,'int',
   'age_max inteiro 18–65, >= idade_min. Alias age_max. Com Advantage+ a Graph nao aceita age_max no payload (teto 65).',
   'traffic-chat.validarIdadeDoPedido + meta-actions.aplicarIdadeNoTargeting',true,true,null),
  ('alterar_idade_do_conjunto','advantage_audience',false,'int',
   '0 = desliga Advantage+ (obrigatorio se a faixa nao for 18–25 ate 65). 1 so vale se idade_min 18–25 e idade_max 65.',
   'traffic-chat.validarIdadeDoPedido + meta-actions.aplicarIdadeNoTargeting',true,true,null),
  ('alterar_idade_do_conjunto','justificativa',true,'text',
   'Evidencia e motivo visiveis no card.',
   'traffic-chat.t_propose_action',true,true,null),
  ('alterar_idade_do_conjunto','reversa',true,'text',
   'Plano de restaurar age_min/age_max (e Advantage+ se mudou); o estado anterior fica no audit_log.',
   'traffic-chat.t_propose_action + audit_log',true,true,null),
  ('alterar_idade_do_conjunto','metrica_sucesso',true,'text',
   'Releitura Graph confirma age_min/age_max pedidos; geo/interesses/WhatsApp inalterados.',
   'traffic-chat.t_propose_action + reconciliarAposEscrita',true,true,null);

insert into public.contrato_de_estado_execucao (
  acao, campo_destino, propriedade, valor_recusado,
  recusa_nomeada, mensagem_de_recusa,
  recusa_estado_desconhecido, mensagem_estado_desconhecido,
  fonte, vigente, ordem
)
select v.acao, 'target_external_id', v.propriedade, true,
  'alvo_de_outro_nivel_no_espelho',
  'O identificador do alvo pertence a outro nivel da conta: a acao escreve em conjunto, e o espelho conhece este id como outro objeto. Executar assim escreveria no objeto errado. Confira o alvo do card.',
  'alvo_de_nivel_nao_conferido',
  'Nao foi possivel decidir o nivel do alvo pelo espelho. Ausencia do espelho nao e recusa: objeto recem-criado ainda nao espelhado cai aqui, e a conferencia mecanica antes da escrita ocorre de novo no executor, com o sinal da Graph.',
  'alterar_idade_do_conjunto 18/09/2026: mesmo eixo de alterar_geo_do_conjunto.',
  true, 1
from (values
  ('alterar_idade_do_conjunto', 'alvo_conhecido_em_outro_nivel_que_conjunto')
) as v(acao, propriedade)
where not exists (
  select 1 from public.contrato_de_estado_execucao e
   where e.acao = v.acao and e.campo_destino = 'target_external_id' and e.propriedade = v.propriedade
);

insert into public.agent_ferramentas
  (chave, descricao, parametros, doutrina, superficies, parametros_omitidos)
values
  ($ft$alterar_idade_do_conjunto$ft$,
   $ft$Emite CARD DE APROVACAO para trocar a IDADE (age_min e age_max) de UM conjunto JA PUBLICADO (ACTIVE ou PAUSED), sem criar conjunto novo e sem recorte global. POST targeting no objeto vivo — o mesmo caminho de alterar_geo. Passe idade_min e idade_max (inteiros 18–65). Advantage+ ligado so aceita min 18–25 e nao aceita max no payload (teto 65): faixa estreita desliga Advantage+ por padrao. Em credito a Meta forca 18–65. NAO diga que idade nao se edita em conjunto publicado nem que so da para duplicar.$ft$,
   $ft${"type":"object","properties":{"conjunto":{"type":"string","description":"Nome atual do conjunto."},"alvo_external_id":{"type":"string","description":"Id Meta do conjunto quando o nome nao for unico."},"idade_min":{"type":"integer","description":"Idade minima (18–65). Alias: age_min."},"idade_max":{"type":"integer","description":"Idade maxima (18–65, >= min). Alias: age_max."},"advantage_audience":{"type":"integer","description":"0 desliga Advantage+ (padrao se a faixa nao for 18–25 ate 65). 1 so com min 18–25 e max 65."},"justificativa":{"type":"string"},"reversa":{"type":"string"},"metrica_sucesso":{"type":"string"}},"required":["conjunto","idade_min","idade_max"]}$ft$::jsonb,
   $ft$Aprovar troca age_min e age_max DESTE conjunto. Geo, interesses, plataformas e WhatsApp permanecem. Edicao significativa pode resetar aprendizado — o card avisa; nao invente a recusa antes de emitir. Se a Graph recusar, o card falha e AÍ o caminho e criar_conjunto + pausar o antigo. Uma dimensao por teste. Em credito (fair lending) estreitamento e recusado pelo gate. COHAPM/imovel pode estreitar.$ft$,
   array['chat']::text[],
   $ft${}$ft$::jsonb)
on conflict (chave) do update set
  descricao = excluded.descricao,
  parametros = excluded.parametros,
  doutrina = excluded.doutrina,
  superficies = excluded.superficies,
  vigente = true,
  atualizado_em = now();

update public.agent_ferramentas set efeito = 'escrita', setor = 'Atos na conta Meta'
 where chave = 'alterar_idade_do_conjunto';

update public.agent_ferramentas
   set parametros = jsonb_set(
         parametros,
         '{properties,action_type,enum}',
         '["pausar_criativo","ativar_criativo","escalar_criativo","pausar_campanha","ativar_campanha","pausar_conjunto","ativar_conjunto","alterar_orcamento","renomear_campanha","renomear_conjunto","renomear_criativo","alterar_categoria_especial_campanha","ajustar_posicionamentos_do_conjunto","alterar_geo_do_conjunto","alterar_publico_do_conjunto","alterar_idade_do_conjunto","vincular_instagram_dos_anuncios","criar_campanha","criar_conjunto_a_partir_de","criar_anuncio_a_partir_de","escalar_duplicar"]'::jsonb
       ),
       atualizado_em = now()
 where chave = 'propose_action';

update public.agent_ferramentas
   set descricao =
         'ESTRUTURA DOS CONJUNTOS desta empresa: nome, status, campanha_status, entregando (true so se conjunto E campanha estao ACTIVE), estrategia de lance, orcamento, segmentacao (paises, cidades, regioes, bairros com NOME, idade, genero, Advantage+, interesses resumidos, publicos personalizados) e destination_type. PAGINADO de 20. Geo: alterar_geo_do_conjunto. Interesses: alterar_publico_do_conjunto. Idade de conjunto publicado: alterar_idade_do_conjunto — nao criar conjunto novo so para mudar faixa etaria.',
       atualizado_em = now()
 where chave = 'get_estrutura_conjuntos';

insert into public.agent_unidades (agent_codigo, tipo, chave, observacao)
values
  ('AG-06', 'ferramenta', 'alterar_idade_do_conjunto', 'Edita idade do conjunto publicado; nao duplica')
on conflict (agent_codigo, tipo, chave) do update set
  observacao = excluded.observacao,
  vigente = true;

insert into public.agent_context (categoria, fato, vigente, desde, atualizado)
select
  'doutrina',
  'IDADE DE CONJUNTO PUBLICADO (18/09/2026). Existe a acao sancionada alterar_idade_do_conjunto '
  || '(tool dedicada no AG-06 e action_type em propose_action). Ela POST targeting.age_min e '
  || 'age_max no conjunto vivo — o mesmo transporte de alterar_geo_do_conjunto (Graph POST '
  || '/{adset_id} ou Pipeboard update_adset). NAO e recorte global: edita UM conjunto, nao cria '
  || 'objeto novo, nao soma orcamento diario. PROIBIDO dizer que idade nao se edita em conjunto '
  || 'publicado, que falta ferramenta, ou desviar para criar_conjunto+pausar o amplo sem ter '
  || 'emitido o card de idade. Duplicar so se a Graph recusar o PATCH. Piso 18, teto 65. '
  || 'Advantage+ ligado: so age_min 18–25 e sem age_max no payload (erro 1870188). Faixa estreita '
  || 'desliga Advantage+ por padrao. Em credito o gate recusa estreitamento (18–65).',
  true,
  date '2026-09-18',
  now()
where not exists (
  select 1 from public.agent_context
   where categoria = 'doutrina'
     and fato like 'IDADE DE CONJUNTO PUBLICADO (18/09/2026)%'
     and vigente is true
);
