-- PUBLICO DE CONJUNTO PUBLICADO (18/09/2026)
--
-- O DEFEITO. O gestor pediu filtrar o publico dos quatro conjuntos ACTIVE da
-- COHAPM_LAFELICITA_CONV_WA_2026-08 (renda familiar >= R$ 8.000, via interesses).
-- O chat recusou card: "nao ha ato de alterar interesses em conjunto ja no ar
-- (so geo, orcamento, pause/ativa, criar)" e desviou para criar conjunto novo.
--
-- A Meta aceita POST /{adset_id} targeting no objeto vivo — o mesmo caminho de
-- alterar_geo_do_conjunto / ajustar_posicionamentos / Pipeboard update_adset.
-- Nao existe filtro de renda familiar nem "pesquisou nos ultimos dias" (logica
-- de busca). O que existe e interesse/comportamento (afinidade). Advantage+
-- ligado dilui o recorte manual.
--
-- Entra alterar_publico_do_conjunto: troca flexible_spec + advantage_audience
-- no targeting atual, preserva geo/idade/plataformas/WhatsApp. Tool dedicada
-- buscar_interesses resolve nomes -> IDs (Graph type=adinterest). Duplicar
-- conjunto fica de reserva SE a Graph recusar o PATCH.

update public.meta_execution_config
   set action_flags = coalesce(action_flags, '{}'::jsonb)
                    || jsonb_build_object(
                         'alterar_publico_do_conjunto',
                         coalesce(
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
    'alterar_categoria_especial_campanha','vincular_instagram_dos_anuncios'
  ];
  v_conhecidas text[] := array[
    'criar_campanha','criar_conjunto_a_partir_de','criar_anuncio_a_partir_de','escalar_duplicar',
    'pausar_campanha','pausar_criativo','pausar_conjunto','ativar_campanha','ativar_conjunto','ativar_criativo',
    'alterar_orcamento','renomear_campanha','renomear_conjunto','renomear_criativo',
    'ajustar_posicionamentos_do_conjunto','alterar_geo_do_conjunto','alterar_publico_do_conjunto',
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
      when p_action = 'pausar_conjunto' then
        'Aprovar pausa o conjunto (status PAUSED).'
      when p_action = 'escalar_duplicar' then
        'Aprovar cria COPIA do conjunto com +20% de orcamento.'
      else null end,
    'nota_do_driver',
      'vincular_instagram_dos_anuncios e graph-only. Geo, publico e posicionamentos rodam nos dois drivers via update_adset / POST targeting.');
end
$function$;

comment on function public.pode_executar_acao(uuid, text) is
  'Portao declarativo das acoes do agente. alterar_publico_do_conjunto edita flexible_spec + advantage_audience do conjunto publicado; alterar_geo edita geo_locations; excluir objeto publicado nao existe; desativar comentario do post nao e acao de anuncio.';

delete from public.contrato_de_execucao
 where acao = 'alterar_publico_do_conjunto';

insert into public.contrato_de_execucao
  (acao,campo,obrigatorio,tipo,observacao,fonte,vigente,suportado,valores_aceitos)
values
  ('alterar_publico_do_conjunto','target_external_id',true,'text',
   'ID Meta do conjunto; resolvido pelo card a partir de ad_sets da mesma empresa.',
   'traffic-chat.t_propose_action + meta-actions executor',true,true,null),
  ('alterar_publico_do_conjunto','target_name',true,'text',
   'Nome humano do conjunto, para card e auditoria.',
   'traffic-chat.t_propose_action',true,true,null),
  ('alterar_publico_do_conjunto','interesses',true,'jsonb',
   'Array de {id, name} com IDs da Graph type=adinterest. Resolver nomes com buscar_interesses. Nao inventar id. Nao passar lugar (Lauro, Praia do Forte, Linha Verde) nem aluguel de carro. OR no mesmo flexible_spec. Ate 20.',
   'traffic-chat.validarPublicoDoPedido + meta-actions.aplicarPublicoNoTargeting',true,true,null),
  ('alterar_publico_do_conjunto','advantage_audience',false,'int',
   '0 (padrao) = recorte vale; 1 = Advantage+ dilui o detalhamento a sugestao. Pedido de filtro fino deve ir 0.',
   'traffic-chat.validarPublicoDoPedido + meta-actions.aplicarPublicoNoTargeting',true,true,null),
  ('alterar_publico_do_conjunto','justificativa',true,'text',
   'Evidencia e motivo visiveis no card. Nao afirmar que o recorte prova renda R$ 8 mil.',
   'traffic-chat.t_propose_action',true,true,null),
  ('alterar_publico_do_conjunto','reversa',true,'text',
   'Plano de restaurar flexible_spec e advantage_audience anteriores; o estado anterior fica no audit_log.',
   'traffic-chat.t_propose_action + audit_log',true,true,null),
  ('alterar_publico_do_conjunto','metrica_sucesso',true,'text',
   'Releitura Graph confirma os IDs em targeting.flexible_spec e advantage_audience pedido; geo/idade/WhatsApp inalterados.',
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
  'alterar_publico_do_conjunto 18/09/2026: mesmo eixo de alterar_geo_do_conjunto.',
  true, 1
from (values
  ('alterar_publico_do_conjunto', 'alvo_conhecido_em_outro_nivel_que_conjunto')
) as v(acao, propriedade)
where not exists (
  select 1 from public.contrato_de_estado_execucao e
   where e.acao = v.acao and e.campo_destino = 'target_external_id' and e.propriedade = v.propriedade
);

insert into public.agent_ferramentas
  (chave, descricao, parametros, doutrina, superficies, parametros_omitidos)
values
  ($ft$buscar_interesses$ft$,
   $ft$Resolve NOMES de interesse/detalhamento para IDs da Meta (Graph /search type=adinterest). Chame ANTES de alterar_publico_do_conjunto. Lote maximo de 20 termos. Default locale=pt_BR. NAO cria conjunto e NUNCA invente id. Lauro de Freitas, Praia do Forte e Linha Verde SAO GEO (use buscar_geolocalizacao). Aluguel de casa costuma devolver aluguel de carro: nao use.$ft$,
   $ft${"type":"object","properties":{"nomes":{"type":"array","items":{"type":"string"},"description":"Lista de termos (ate 20 por chamada)."},"limit_por_query":{"type":"integer","description":"Default 8."},"locale":{"type":"string","description":"Default pt_BR."}},"required":["nomes"]}$ft$::jsonb,
   $ft$Interesse e afinidade, nao historico de busca e nao renda familiar. Nao existe filtro R$ 8.000. Empilhar 11 termos nao aproxima teto salarial. Nucleo util: Investimento imobiliario, Imobiliario, Condominio, Condominio fechado, Remodelacao da casa (OR). Fora do nucleo (carros, academia, piscina) e segundo teste, separado. geo_nao_interesse no retorno = use alterar_geo, nao esta tool. resolvidos[] alimenta params.interesses do card.$ft$,
   array['chat']::text[],
   $ft${}$ft$::jsonb),
  ($ft$alterar_publico_do_conjunto$ft$,
   $ft$Emite CARD DE APROVACAO para trocar o DETALHAMENTO (interesses / flexible_spec) de UM conjunto JA PUBLICADO (ACTIVE ou PAUSED), sem criar conjunto novo e sem recorte global. POST targeting no objeto vivo — o mesmo caminho de alterar_geo. Passe interesses com {id,name} de buscar_interesses. Advantage+ desliga por padrao (senao o recorte vira sugestao). NAO diga que publico nao se edita em conjunto publicado nem que so da para duplicar. NAO afirma que o recorte prova renda R$ 8 mil.$ft$,
   $ft${"type":"object","properties":{"conjunto":{"type":"string","description":"Nome atual do conjunto."},"alvo_external_id":{"type":"string","description":"Id Meta do conjunto quando o nome nao for unico."},"interesses":{"type":"array","description":"Array {id,name} da buscar_interesses. OR no mesmo grupo."},"advantage_audience":{"type":"integer","description":"0 (padrao, recorte vale) ou 1 (Advantage+ dilui)."},"justificativa":{"type":"string"},"reversa":{"type":"string"},"metrica_sucesso":{"type":"string"}},"required":["conjunto","interesses"]}$ft$::jsonb,
   $ft$Aprovar troca flexible_spec e advantage_audience DESTE conjunto. Geo, idade, plataformas e WhatsApp permanecem. Edicao significativa pode resetar aprendizado — o card avisa; nao invente a recusa antes de emitir. Se a Graph recusar, o card falha e AÍ o caminho e criar_conjunto + pausar o antigo. Uma dimensao por teste: nao empilhar nucleo imobiliario + carros + academia + lugares. CRM fora de escopo: aptidao comercial (renda R$ 8 mil) nao e metrica desta conta; proxy = conversas sem estouro de custo vs o irmao amplo, 7 dias fechados.$ft$,
   array['chat']::text[],
   $ft${}$ft$::jsonb)
on conflict (chave) do update set
  descricao = excluded.descricao,
  parametros = excluded.parametros,
  doutrina = excluded.doutrina,
  superficies = excluded.superficies,
  vigente = true,
  atualizado_em = now();

update public.agent_ferramentas set efeito = 'leitura', setor = 'Atos na conta Meta'
 where chave = 'buscar_interesses';

update public.agent_ferramentas set efeito = 'escrita', setor = 'Atos na conta Meta'
 where chave = 'alterar_publico_do_conjunto';

update public.agent_ferramentas
   set parametros = jsonb_set(
         parametros,
         '{properties,action_type,enum}',
         '["pausar_criativo","ativar_criativo","escalar_criativo","pausar_campanha","ativar_campanha","pausar_conjunto","ativar_conjunto","alterar_orcamento","renomear_campanha","renomear_conjunto","renomear_criativo","alterar_categoria_especial_campanha","ajustar_posicionamentos_do_conjunto","alterar_geo_do_conjunto","alterar_publico_do_conjunto","vincular_instagram_dos_anuncios","criar_campanha","criar_conjunto_a_partir_de","criar_anuncio_a_partir_de","escalar_duplicar"]'::jsonb
       ),
       atualizado_em = now()
 where chave = 'propose_action';

update public.agent_ferramentas
   set descricao =
         'ESTRUTURA DOS CONJUNTOS desta empresa: nome, status, campanha_status, entregando (true so se conjunto E campanha estao ACTIVE), estrategia de lance, orcamento, segmentacao (paises, cidades, regioes, bairros com NOME, idade, genero, Advantage+, interesses resumidos, publicos personalizados) e destination_type. PAGINADO de 20. Geo: alterar_geo_do_conjunto. Interesses de conjunto publicado: alterar_publico_do_conjunto (IDs via buscar_interesses) — nao criar conjunto novo so para mudar publico.',
       atualizado_em = now()
 where chave = 'get_estrutura_conjuntos';

insert into public.agent_unidades (agent_codigo, tipo, chave, observacao)
values
  ('AG-06', 'ferramenta', 'buscar_interesses', 'Resolve nomes de interesse para IDs Meta; nao escreve'),
  ('AG-06', 'ferramenta', 'alterar_publico_do_conjunto', 'Edita interesses do conjunto publicado; nao duplica')
on conflict (agent_codigo, tipo, chave) do update set
  observacao = excluded.observacao,
  vigente = true;

insert into public.agent_context (categoria, fato, vigente, desde, atualizado)
select
  'doutrina',
  'PUBLICO DE CONJUNTO PUBLICADO (18/09/2026). Existe a acao sancionada alterar_publico_do_conjunto '
  || '(tool dedicada no AG-06 e action_type em propose_action). Ela POST targeting.flexible_spec '
  || '+ targeting_automation.advantage_audience no conjunto vivo — o mesmo transporte de '
  || 'alterar_geo_do_conjunto (Graph POST /{adset_id} ou Pipeboard update_adset). NAO e recorte '
  || 'global: edita UM conjunto, nao cria objeto novo, nao soma orcamento diario. PROIBIDO dizer '
  || 'que publico/interesse nao se edita em conjunto publicado, que falta ferramenta, ou desviar '
  || 'para criar_conjunto+pausar o amplo sem ter emitido o card de publico. Duplicar so se a Graph '
  || 'recusar o PATCH — a recusa aparece no card falho, nao na prosa. IDs: buscar_interesses. '
  || 'Nao existe filtro de renda familiar R$ 8.000 nem "pesquisou nos ultimos dias". Interesse e '
  || 'afinidade. Advantage+ ligado dilui o recorte: o card desliga por padrao. Lauro de Freitas, '
  || 'Praia do Forte e Linha Verde sao geo (alterar_geo). Aluguel de casa nao usar (resolve para '
  || 'aluguel de carro). Nucleo: OU de Investimento imobiliario / Imobiliario / Condominio / '
  || 'Condominio fechado / Remodelacao da casa. Fora do nucleo = segundo teste. CRM fora de '
  || 'escopo desde 28/07: aptidao comercial nao entra nesta conta.',
  true,
  date '2026-09-18',
  now()
where not exists (
  select 1 from public.agent_context
   where categoria = 'doutrina'
     and fato like 'PUBLICO DE CONJUNTO PUBLICADO (18/09/2026)%'
     and vigente is true
);
