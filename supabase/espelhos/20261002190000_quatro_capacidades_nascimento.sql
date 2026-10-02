-- Quatro capacidades que faltavam para refazer o dia do La Felicita (02/10/2026):
-- exclusao geografica no conjunto publicado, criativo com saudacao, troca de criativo
-- e conjunto nascido de spec (pausado, targeting completo).

update public.meta_execution_config
   set action_flags = coalesce(action_flags, '{}'::jsonb)
                    || jsonb_build_object(
                         'criar_conjunto',
                         coalesce(action_flags -> 'criar_conjunto_a_partir_de', 'false'::jsonb),
                         'criar_criativo',
                         coalesce(action_flags -> 'criar_anuncio_a_partir_de', 'false'::jsonb),
                         'trocar_criativo_do_anuncio',
                         coalesce(action_flags -> 'criar_anuncio_a_partir_de', 'false'::jsonb)
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
    'criar_campanha','criar_conjunto_a_partir_de','criar_conjunto','criar_criativo','criar_anuncio_a_partir_de','escalar_duplicar',
    'pausar_campanha','pausar_criativo','pausar_conjunto','ativar_campanha','ativar_conjunto','ativar_criativo',
    'alterar_orcamento','renomear_campanha','renomear_conjunto','renomear_criativo',
    'ajustar_posicionamentos_do_conjunto','alterar_geo_do_conjunto','alterar_publico_do_conjunto',
    'alterar_idade_do_conjunto','trocar_criativo_do_anuncio',
    'alterar_categoria_especial_campanha','vincular_instagram_dos_anuncios'
  ];
  v_conhecidas text[] := array[
    'criar_campanha','criar_conjunto_a_partir_de','criar_conjunto','criar_criativo','criar_anuncio_a_partir_de','escalar_duplicar',
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
        'Aprovar cria o criativo. Conjunto WhatsApp sem saudacao nao chega aqui. Criativo e imutavel.'
      when p_action = 'trocar_criativo_do_anuncio' then
        'Aprovar aponta o anuncio para outro criativo. Nao zera aprendizado, mas reinicia a revisao. Nao declare corrigido sem reler effective_status. O criativo velho permanece.'
      when p_action = 'pausar_conjunto' then
        'Aprovar pausa o conjunto (status PAUSED).'
      when p_action = 'escalar_duplicar' then
        'Aprovar cria COPIA do conjunto com +20% de orcamento.'
      else null end,
    'nota_do_driver',
      'criar_criativo sai pela Graph mesmo com driver pipeboard, porque page_welcome_message nao sobrevive no create_ad_creative plano. As outras acoes novas rodam nos dois drivers.');
end
$function$;

comment on function public.pode_executar_acao(uuid, text) is
  'Portao declarativo. criar_conjunto nasce pausado de spec; criar_criativo exige saudacao em WhatsApp; trocar_criativo_do_anuncio reponta o anuncio; alterar_geo aceita excluded_geo_locations.';

delete from public.contrato_de_execucao
 where acao in ('criar_conjunto', 'criar_criativo', 'trocar_criativo_do_anuncio');

insert into public.contrato_de_execucao
  (acao, campo, obrigatorio, tipo, observacao, fonte, vigente, suportado, valores_aceitos)
values
  ('criar_conjunto','nome_novo',true,'text','Nome do conjunto.','conjunto_spec + traffic-chat',true,true,null),
  ('criar_conjunto','campaign_id',true,'text','Id Meta da campanha pai.','conjunto_spec',true,true,null),
  ('criar_conjunto','orcamento_diario_reais',true,'number','Reais por dia.','conjunto_spec',true,true,null),
  ('criar_conjunto','bid_strategy',true,'text','Obrigatorio. A primeira tentativa do dia falhou sem ele.','conjunto_spec',true,true,null),
  ('criar_conjunto','destination_type',true,'text','Destino do conjunto.','conjunto_spec',true,true,null),
  ('criar_conjunto','promoted_object',true,'jsonb','page_id e, em WhatsApp, o numero.','conjunto_spec',true,true,null),
  ('criar_conjunto','targeting',true,'jsonb','Spec completo, com targeting_automation.advantage_audience.','conjunto_spec',true,true,null),
  ('criar_conjunto','status',true,'text','Sempre PAUSED.','conjunto_spec',true,true,array['PAUSED']),
  ('criar_conjunto','justificativa',true,'text','Motivo visivel no card.','traffic-chat',true,true,null),
  ('criar_conjunto','reversa',true,'text','Como desfazer.','traffic-chat',true,true,null),
  ('criar_conjunto','metrica_sucesso',true,'text','Releitura de status, campos e advantage_audience.','traffic-chat',true,true,null),
  ('criar_criativo','page_id',true,'text','Emissor.','criativo_whatsapp',true,true,null),
  ('criar_criativo','instagram_actor_id',true,'text','Sem ele o anuncio so roda no Facebook.','criativo_whatsapp',true,true,null),
  ('criar_criativo','message',true,'text','Texto principal.','criativo_whatsapp',true,true,null),
  ('criar_criativo','destination_type',true,'text','Destino do conjunto, para o portao de CTA.','criativo_whatsapp',true,true,null),
  ('criar_criativo','object_story_spec',true,'jsonb','Spec montado, com saudacao quando o destino e WhatsApp.','criativo_whatsapp',true,true,null),
  ('criar_criativo','justificativa',true,'text','Motivo visivel no card.','traffic-chat',true,true,null),
  ('criar_criativo','reversa',true,'text','Criativo e imutavel: cria-se outro e troca-se o anuncio.','traffic-chat',true,true,null),
  ('criar_criativo','metrica_sucesso',true,'text','Saudacao e CTA compativeis gravados.','traffic-chat',true,true,null),
  ('trocar_criativo_do_anuncio','creative_id',true,'text','Criativo substituto.','troca_criativo',true,true,null),
  ('trocar_criativo_do_anuncio','target_external_id',true,'text','Id Meta do anuncio.','traffic-chat + meta-actions',true,true,null),
  ('trocar_criativo_do_anuncio','target_name',true,'text','Nome do anuncio.','traffic-chat',true,true,null),
  ('trocar_criativo_do_anuncio','justificativa',true,'text','Motivo visivel no card.','traffic-chat',true,true,null),
  ('trocar_criativo_do_anuncio','reversa',true,'text','O criativo anterior permanece; apontar de volta desfaz, com nova revisao.','traffic-chat',true,true,null),
  ('trocar_criativo_do_anuncio','metrica_sucesso',true,'text','effective_status relido antes de declarar pronto.','troca_criativo',true,true,null);

insert into public.agent_ferramentas
  (chave, descricao, parametros, doutrina, superficies, parametros_omitidos)
values
  ('criar_conjunto',
   'Emite CARD DE APROVACAO para CRIAR um conjunto do zero, com spec completo, sem molde. Nasce PAUSADO. targeting sem targeting_automation.advantage_audience e recusado. Pre-voo obrigatorio. O card descreve verba, idade, cidades, bairros, pinos e termos com nome e classe.',
   '{"type":"object","properties":{"nome":{"type":"string"},"campaign_id":{"type":"string"},"orcamento_diario_reais":{"type":"number"},"optimization_goal":{"type":"string"},"billing_event":{"type":"string"},"bid_strategy":{"type":"string"},"destination_type":{"type":"string"},"promoted_object":{"type":"object"},"start_time":{"type":"string"},"targeting":{"type":"object"},"justificativa":{"type":"string"},"reversa":{"type":"string"},"metrica_sucesso":{"type":"string"}},"required":["nome","campaign_id","orcamento_diario_reais","optimization_goal","billing_event","bid_strategy","destination_type","promoted_object","targeting"]}'::jsonb,
   'Nao duplica molde. Spec parcial nao entra. Aprovar nao ativa.',
   array['chat']::text[],
   '{}'::jsonb),
  ('criar_criativo',
   'Emite CARD DE APROVACAO para criar um criativo de clique. video_id ou image_hash, thumbnail_url obrigatorio em video, page_id, instagram_actor_id, message, call_to_action_type, page_welcome_message, disable_all_enhancements. Criativo de conjunto WhatsApp sem page_welcome_message NAO nasce. CTA incompativel com destination_type e recusado antes do card. Criativo e imutavel. NAO cria o anuncio.',
   '{"type":"object","properties":{"nome":{"type":"string"},"video_id":{"type":"string"},"image_hash":{"type":"string"},"thumbnail_url":{"type":"string"},"page_id":{"type":"string"},"instagram_actor_id":{"type":"string"},"message":{"type":"string"},"call_to_action_type":{"type":"string"},"app_destination":{"type":"string"},"destination_type":{"type":"string"},"page_welcome_message":{"type":"object"},"disable_all_enhancements":{"type":"boolean"},"justificativa":{"type":"string"},"reversa":{"type":"string"},"metrica_sucesso":{"type":"string"}},"required":["page_id","instagram_actor_id","message","destination_type"]}'::jsonb,
   'A saudacao e portao. LEARN_MORE em conjunto de conversas derruba o conjunto (1885882). Para corrigir, crie outro criativo e troque o anuncio.',
   array['chat']::text[],
   '{}'::jsonb),
  ('trocar_criativo_do_anuncio',
   'Emite CARD DE APROVACAO para trocar o criativo de um anuncio (ad_id + creative_id). Nao zera o aprendizado, mas reinicia a revisao: o anuncio volta a IN_PROCESS. Nunca declare corrigido sem reler effective_status. Troca que cruza asset_customization_rules e recusada (1885866). O criativo velho nao e apagado.',
   '{"type":"object","properties":{"anuncio":{"type":"string"},"ad_id":{"type":"string"},"alvo_external_id":{"type":"string"},"creative_id":{"type":"string"},"justificativa":{"type":"string"},"reversa":{"type":"string"},"metrica_sucesso":{"type":"string"}},"required":["creative_id"]}'::jsonb,
   'Unica forma de corrigir texto, botao, saudacao ou miniatura num anuncio que ja roda.',
   array['chat']::text[],
   '{}'::jsonb)
on conflict (chave) do update set
  descricao = excluded.descricao,
  parametros = excluded.parametros,
  doutrina = excluded.doutrina,
  superficies = excluded.superficies,
  vigente = true,
  atualizado_em = now();

update public.agent_ferramentas
   set descricao = 'Emite CARD DE APROVACAO para trocar a GEO de UM conjunto JA PUBLICADO, inclusive a EXCLUSAO (excluded_geo_locations). Mesma gramatica de chaves e pinos para incluir e excluir. NAO diga que exclusao geografica nao existe.',
       parametros = '{"type":"object","properties":{"conjunto":{"type":"string"},"alvo_external_id":{"type":"string"},"cidades":{"type":"array"},"geo_locations":{"type":"object"},"bairros":{"type":"array"},"excluded_geo_locations":{"type":"object"},"excluir_bairros":{"type":"array"},"excluir_cidades":{"type":"array"},"excluir_pinos":{"type":"array"},"justificativa":{"type":"string"},"reversa":{"type":"string"},"metrica_sucesso":{"type":"string"}},"required":["conjunto"]}'::jsonb,
       atualizado_em = now()
 where chave = 'alterar_geo_do_conjunto';

update public.agent_ferramentas set efeito = 'escrita', setor = 'Atos na conta Meta'
 where chave in ('criar_conjunto', 'criar_criativo', 'trocar_criativo_do_anuncio', 'gravar_plano');

update public.agent_ferramentas set efeito = 'leitura', setor = 'Atos na conta Meta'
 where chave in (
   'buscar_comportamentos',
   'buscar_setores_de_trabalho',
   'ler_objeto',
   'conferir_contra_plano',
   'buscar_segmentacao'
 );

update public.agent_ferramentas
   set parametros = jsonb_set(
         parametros,
         '{properties,action_type,enum}',
         '["pausar_criativo","ativar_criativo","escalar_criativo","pausar_campanha","ativar_campanha","pausar_conjunto","ativar_conjunto","alterar_orcamento","renomear_campanha","renomear_conjunto","renomear_criativo","alterar_categoria_especial_campanha","ajustar_posicionamentos_do_conjunto","alterar_geo_do_conjunto","alterar_publico_do_conjunto","alterar_idade_do_conjunto","vincular_instagram_dos_anuncios","criar_campanha","criar_conjunto_a_partir_de","criar_conjunto","criar_criativo","criar_anuncio_a_partir_de","escalar_duplicar","trocar_criativo_do_anuncio"]'::jsonb
       ),
       atualizado_em = now()
 where chave = 'propose_action';

insert into public.agent_unidades (agent_codigo, tipo, chave, observacao)
values
  ('AG-06', 'ferramenta', 'criar_conjunto', 'Cria conjunto pausado a partir de spec, sem molde'),
  ('AG-06', 'ferramenta', 'criar_criativo', 'Cria criativo de clique com saudacao e CTA'),
  ('AG-06', 'ferramenta', 'trocar_criativo_do_anuncio', 'Aponta anuncio para outro criativo')
on conflict (agent_codigo, tipo, chave) do update set
  observacao = excluded.observacao,
  vigente = true;

insert into public.agent_context (categoria, fato, vigente, desde, atualizado)
select
  'doutrina',
  'NASCIMENTO DE CONJUNTO E CRIATIVO (02/10/2026). criar_conjunto aceita spec completo e nasce PAUSADO; targeting sem advantage_audience e recusado. criar_criativo exige page_welcome_message em destino WhatsApp e recusa CTA incompativel antes do card. trocar_criativo_do_anuncio e a correcao, porque criativo e imutavel: nao zera aprendizado, reinicia revisao, e effective_status tem de ser relido antes de declarar pronto. alterar_geo_do_conjunto aceita excluded_geo_locations. Divergencia de location_types entre geo_locations e excluded_geo_locations e esperada (a exclusao fica home, recent e perde frequently_in) e nao alarma a releitura. O que alarma e o Gerenciador recusar a publicacao (1870194).',
  true,
  date '2026-10-02',
  now()
where not exists (
  select 1 from public.agent_context
   where categoria = 'doutrina'
     and fato like 'NASCIMENTO DE CONJUNTO E CRIATIVO (02/10/2026)%'
     and vigente is true
);
