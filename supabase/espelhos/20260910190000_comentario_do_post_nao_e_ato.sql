-- COMENTARIO DO POST NAO E ATO DE ANUNCIO (10/09/2026)
--
-- O DEFEITO. O gestor pediu desativar comentarios das 14 turbinagens ativas
-- (Legal e Viver). O Executor chamou propose_action (acao que nao existe para
-- comentario). Sem approval_id, o guarda afirmou "card emitido" e o sistema
-- retornou o turno exigindo propose_action de novo — loop que ou inventa card
-- ou pausa campanha no lugar do interruptor do post.
--
-- O QUE EXISTE. Comentario aberto/fechado e configuracao do CONTEUDO (post
-- organico no Instagram/Business Suite). O boost herda o post; pausar a
-- campanha so para o gasto. Graph POST /{IG_MEDIA_ID}?comment_enabled=false
-- existe em tese (instagram_manage_comments, token de usuario). Pipeboard
-- (catalogo 03/09/2026, 121 tools) nao expoe essa escrita. Esta casa nao tem
-- card nem executor para isso.
--
-- O QUE ESTA MIGRATION FAZ. Recusa NOMEADA em pode_executar_acao (sem
-- acrescentar a acao em v_conhecidas/v_automatizadas). Limite de escopo no
-- AG-06. Doutrina no propose_action. Memoria em agent_context. O chat deixa
-- de forcar/retomar propose_action neste pedido (intencao_turno + traffic-chat).

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
    'ajustar_posicionamentos_do_conjunto','alterar_geo_do_conjunto',
    'alterar_categoria_especial_campanha','vincular_instagram_dos_anuncios'
  ];
  v_conhecidas text[] := array[
    'criar_campanha','criar_conjunto_a_partir_de','criar_anuncio_a_partir_de','escalar_duplicar',
    'pausar_campanha','pausar_criativo','pausar_conjunto','ativar_campanha','ativar_conjunto','ativar_criativo',
    'alterar_orcamento','renomear_campanha','renomear_conjunto','renomear_criativo',
    'ajustar_posicionamentos_do_conjunto','alterar_geo_do_conjunto',
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
      when p_action = 'pausar_conjunto' then
        'Aprovar pausa o conjunto (status PAUSED).'
      when p_action = 'escalar_duplicar' then
        'Aprovar cria COPIA do conjunto com +20% de orcamento.'
      else null end,
    'nota_do_driver',
      'vincular_instagram_dos_anuncios e graph-only. Geo e posicionamentos rodam nos dois drivers via update_adset / POST targeting.');
end
$function$;

comment on function public.pode_executar_acao(uuid, text) is
  'Portao declarativo das acoes do agente. alterar_geo_do_conjunto edita targeting.geo_locations do conjunto publicado; excluir objeto publicado nao existe; desativar comentario do post nao e acao de anuncio.';

update public.agents
   set limites = limites || array[
         $lim$COMENTARIO DO POST NAO E ATO DE ANUNCIO (10/09/2026): desativar/desligar comentario e interruptor do post no Instagram ou no Meta Business Suite, nao card. Pipeboard nao tem escrita de comment_enabled. Graph POST /{IG_MEDIA_ID}?comment_enabled=false existe em tese (instagram_manage_comments) e nao e executor desta casa. Pausar boost nao fecha comentario. Se o pedido for parar a entrega, a acao e pausar_campanha/pausar_conjunto.$lim$
       ],
       updated_at = now()
 where codigo = 'AG-06'
   and not exists (
     select 1 from unnest(limites) x where x like 'COMENTARIO DO POST%'
   );

update public.agent_ferramentas
   set descricao =
         'Cria PEDIDO DE APROVACAO (ActionCard) para todo ato na conta Meta. NAO executa: o card fica PENDENTE, so um administrador aprova, e expira em 24h. SO use quando o gestor pedir o ato com verbo explicito (emitir, criar, subir, pausar, ativar, escalar, duplicar, renomear, alterar, vincular). PERGUNTA sem verbo de ato — inclusive ''antes da aprovacao'' e ''o anuncio esta com o mesmo link'' — se responde com get_aprovacoes, get_estrutura_conjuntos ou get_criativos_conteudo, NAO com esta tool. Desativar comentario do post Instagram NAO e action_type: nao emita card (o interruptor e no Instagram/Business Suite; pausar boost nao fecha comentario). Exige justificativa, metrica_sucesso e reversa. target_name e o nome ATUAL do objeto; quando o nome nao for unico, mande params.alvo_external_id com o id da Meta. EXCLUIR nao existe em nenhum nivel: para tirar do ar use pausar_*. Sem approval_id no retorno, o card NAO existe.',
       atualizado_em = now()
 where chave = 'propose_action';

update public.agent_knowledge
   set conteudo = conteudo || $md$

## Comentário do post (não é ato de anúncio)

Desativar/desligar comentário é interruptor do **conteúdo** (post orgânico no Instagram ou Meta Business Suite), não da campanha/conjunto/anúncio. O boost herda o post: pausar a turbinagem para o gasto e **não** fecha comentário.

Nesta casa (verificado 10/09/2026):
- Não existe `action_type` nem card para comentário.
- Pipeboard não expõe escrita de `comment_enabled` (catálogo medido 03/09/2026).
- Graph `POST /{IG_MEDIA_ID}?comment_enabled=false` existe em tese (`instagram_manage_comments`) e **não** está no executor.
- Não invente card, não pause no lugar do interruptor, não retome `propose_action` neste pedido.

Se o gestor pedir **parar a entrega**, aí sim: `pausar_campanha` / `pausar_conjunto`.
$md$,
       updated_at = now()
 where tema = 'criacao'
   and conteudo not like '%comment_enabled%';

insert into public.agent_context (categoria, fato, vigente, desde, atualizado)
select
  'doutrina',
  'COMENTARIO DO POST (10/09/2026). Desativar comentario nao e ato de anuncio: nao ha card. Pipeboard nao tem essa escrita. Graph comment_enabled existe em tese e nao e executor desta casa. Pausar boost nao fecha comentario. Interruptor: Instagram app / Business Suite no post organico. Se o pedido for parar a entrega, peca pausar_campanha explicitamente.',
  true,
  date '2026-09-10',
  now()
where not exists (
  select 1 from public.agent_context
   where categoria = 'doutrina'
     and fato like 'COMENTARIO DO POST (10/09/2026)%'
     and vigente is true
);
