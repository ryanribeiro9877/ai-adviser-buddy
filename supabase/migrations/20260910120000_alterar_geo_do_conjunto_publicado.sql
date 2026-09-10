-- ALTERAR GEO DE CONJUNTO PUBLICADO (10/09/2026)
--
-- O DEFEITO: o gestor pediu recorte RMS (8 cidades BA) nos CONJ.1-4 da
-- COHAPM_VISTTA_CONV_WA_SET26. buscar_geolocalizacao e params.geo_locations
-- existiam so no criar_conjunto. get_estrutura_conjuntos so devolvia paises.
-- O chat concluiu "nao ha ferramenta" / "geo nao se edita em conjunto publicado"
-- e emitiu conjuntos novos a +R$ 30/dia cada — recorte global de verba, nao de geo.
--
-- A Meta aceita POST /{adset_id} targeting no objeto vivo (mesmo caminho de
-- ajustar_posicionamentos_do_conjunto / Pipeboard update_adset). Entra a acao
-- alterar_geo_do_conjunto: troca so geo_locations, preserva idade/plataformas/
-- WhatsApp. Tool dedicada no AG-06 para o modelo nao voltar a declarar ausencia.
-- Duplicar conjunto fica de reserva SE a Graph recusar o PATCH.

update public.meta_execution_config
   set action_flags = coalesce(action_flags, '{}'::jsonb)
                    || jsonb_build_object(
                         'alterar_geo_do_conjunto',
                         coalesce(action_flags -> 'ajustar_posicionamentos_do_conjunto', 'false'::jsonb)
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
  'Portao declarativo das acoes do agente. alterar_geo_do_conjunto edita targeting.geo_locations do conjunto publicado; excluir objeto publicado nao existe em nenhum nivel.';

delete from public.contrato_de_execucao
 where acao = 'alterar_geo_do_conjunto';

insert into public.contrato_de_execucao
  (acao,campo,obrigatorio,tipo,observacao,fonte,vigente,suportado,valores_aceitos)
values
  ('alterar_geo_do_conjunto','target_external_id',true,'text',
   'ID Meta do conjunto; resolvido pelo card a partir de ad_sets da mesma empresa.',
   'traffic-chat.t_propose_action + meta-actions executor',true,true,null),
  ('alterar_geo_do_conjunto','target_name',true,'text',
   'Nome humano do conjunto, para card e auditoria.',
   'traffic-chat.t_propose_action',true,true,null),
  ('alterar_geo_do_conjunto','geo_locations',true,'jsonb',
   'Objeto Meta targeting.geo_locations (cities/neighborhoods/regions/countries/...). Items exigem key Meta — resolver nomes com buscar_geolocalizacao. Alias params.cidades vira cities. Nao misturar com bairros. Ate 250 locais. Em credito, neighborhoods/zips sao recusados por checar_segmentacao. Sem countries:BR quando o recorte e lista de cidades.',
   'traffic-chat.validarGeoDeAlteracao + meta-actions.aplicarGeoNoTargeting',true,true,null),
  ('alterar_geo_do_conjunto','justificativa',true,'text',
   'Evidencia e motivo visiveis no card.',
   'traffic-chat.t_propose_action',true,true,null),
  ('alterar_geo_do_conjunto','reversa',true,'text',
   'Plano de restaurar geo_locations anterior; o estado anterior fica no audit_log.',
   'traffic-chat.t_propose_action + audit_log',true,true,null),
  ('alterar_geo_do_conjunto','metrica_sucesso',true,'text',
   'Releitura Graph confirma as keys pedidas em targeting.geo_locations; idade/plataformas/WhatsApp inalterados.',
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
  'alterar_geo_do_conjunto 10/09/2026: mesmo eixo de ajustar_posicionamentos_do_conjunto.',
  true, 1
from (values
  ('alterar_geo_do_conjunto', 'alvo_conhecido_em_outro_nivel_que_conjunto')
) as v(acao, propriedade)
where not exists (
  select 1 from public.contrato_de_estado_execucao e
   where e.acao = v.acao and e.campo_destino = 'target_external_id' and e.propriedade = v.propriedade
);

insert into public.agent_ferramentas
  (chave, descricao, parametros, doutrina, superficies, parametros_omitidos)
values
  ($ft$alterar_geo_do_conjunto$ft$,
   $ft$Emite CARD DE APROVACAO para trocar a GEO de UM conjunto JA PUBLICADO (ACTIVE ou PAUSED), sem criar conjunto novo e sem recorte global. POST targeting.geo_locations no objeto vivo — o mesmo caminho de ajustar_posicionamentos. Passe cidades/geo_locations com keys Meta (buscar_geolocalizacao tipo=city). NAO diga que geo nao se edita em conjunto publicado nem que so da para duplicar.$ft$,
   $ft${"type":"object","properties":{"conjunto":{"type":"string","description":"Nome atual do conjunto."},"alvo_external_id":{"type":"string","description":"Id Meta do conjunto quando o nome nao for unico."},"cidades":{"type":"array","description":"Keys Meta de cidade (ou {key,name}). Vira geo_locations.cities. Nao misturar com bairros."},"geo_locations":{"type":"object","description":"Objeto Meta geo_locations (cities/neighborhoods/regions/...). Keys via buscar_geolocalizacao."},"bairros":{"type":"array","description":"Atalho de keys Meta para neighborhoods. Nao misturar com cidades/geo_locations."},"justificativa":{"type":"string"},"reversa":{"type":"string"},"metrica_sucesso":{"type":"string"}},"required":["conjunto"]}$ft$::jsonb,
   $ft$Aprovar troca so geo_locations DESTE conjunto. Idade, plataformas e WhatsApp permanecem. Sem countries:BR quando o pedido e lista de cidades — as cidades JA sao o recorte. Se a Graph recusar (Advantage+, categoria especial), o card falha e AÍ o caminho e criar_conjunto + pausar o antigo. Nao invente a recusa antes de emitir. Keys: buscar_geolocalizacao tipo=city, country_code=BR; Candeias cidade=247422 (nao bairro 2778635); Dias D´Vila=250789.$ft$,
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
 where chave = 'alterar_geo_do_conjunto';

update public.agent_ferramentas
   set descricao =
         'Resolve NOMES de bairro, cidade ou regiao para KEYS da Meta (Graph /search type=adgeolocation). Chame ANTES de criar_conjunto ou alterar_geo_do_conjunto. Para cidades da RMS use tipo=city (nao neighborhood). Lote maximo de 40 nomes por chamada. Default tipo=neighborhood, country_code=BR. NAO cria conjunto e NUNCA diga que falta campo de bairros ou de cidades.',
       doutrina = coalesce(doutrina, '')
         || case when doutrina like '%alterar_geo_do_conjunto%' then ''
            else E'\nTambem alimenta alterar_geo_do_conjunto (conjunto ja publicado). tipo=city para municipio; neighborhood so para bairro.' end,
       atualizado_em = now()
 where chave = 'buscar_geolocalizacao';

update public.agent_ferramentas
   set parametros = jsonb_set(
         parametros,
         '{properties,action_type,enum}',
         '["pausar_criativo","ativar_criativo","escalar_criativo","pausar_campanha","ativar_campanha","pausar_conjunto","ativar_conjunto","alterar_orcamento","renomear_campanha","renomear_conjunto","renomear_criativo","alterar_categoria_especial_campanha","ajustar_posicionamentos_do_conjunto","alterar_geo_do_conjunto","vincular_instagram_dos_anuncios","criar_campanha","criar_conjunto_a_partir_de","criar_anuncio_a_partir_de","escalar_duplicar"]'::jsonb
       ),
       atualizado_em = now()
 where chave = 'propose_action';

update public.agent_ferramentas
   set descricao =
         'ESTRUTURA DOS CONJUNTOS desta empresa: nome, status, campanha_status, entregando (true so se conjunto E campanha estao ACTIVE), estrategia de lance, orcamento, segmentacao (paises, cidades, regioes, bairros_qtd), gasto e destination_type (WEBSITE vs WHATSAPP). PAGINADO de 20: use a pagina seguinte enquanto restantes for maior que zero. Cidades do targeting VEM NESTA TOOL — nao diga que filtragem por cidade nao e visivel.',
       atualizado_em = now()
 where chave = 'get_estrutura_conjuntos';

insert into public.agent_unidades (agent_codigo, tipo, chave, observacao)
values
  ('AG-06', 'ferramenta', 'alterar_geo_do_conjunto', 'Edita geo do conjunto publicado; nao duplica')
on conflict (agent_codigo, tipo, chave) do update set
  observacao = excluded.observacao,
  vigente = true;

insert into public.agent_context (categoria, fato, vigente, desde, atualizado)
select
  'doutrina',
  'GEO DE CONJUNTO PUBLICADO (10/09/2026). Existe a acao sancionada alterar_geo_do_conjunto '
  || '(tool dedicada no AG-06 e action_type em propose_action). Ela POST targeting.geo_locations '
  || 'no conjunto vivo — o mesmo transporte de ajustar_posicionamentos_do_conjunto (Graph POST '
  || '/{adset_id} ou Pipeboard update_adset). NAO e recorte global: edita UM conjunto, nao cria '
  || 'objeto novo, nao soma orcamento diario. PROIBIDO dizer que geo nao se edita em conjunto '
  || 'publicado, que falta ferramenta de cidade, ou desviar para criar_conjunto+pausar_BR sem '
  || 'ter emitido o card de geo. Duplicar so se a Graph recusar o PATCH (Advantage+/categoria '
  || 'especial) — a recusa aparece no card falho, nao na prosa. Keys: buscar_geolocalizacao '
  || 'tipo=city. get_estrutura_conjuntos devolve paises, cidades, regioes e bairros_qtd. '
  || 'Juridico COHAPM continua no preset Salvador–BA; VISTTA/La Felicita aceitam lista de cidades.',
  true,
  date '2026-09-10',
  now()
where not exists (
  select 1 from public.agent_context
   where categoria = 'doutrina'
     and fato like 'GEO DE CONJUNTO PUBLICADO (10/09/2026)%'
     and vigente is true
);

create or replace function public.get_estrutura_conjuntos(
  p_company_id uuid,
  p_offset integer default 0,
  p_limit  integer default 20
) returns jsonb
language sql
stable
set search_path = public, pg_temp
as $function$
with cj as (
  select s.name as conjunto, s.status, s.bid_strategy,
         s.daily_budget, s.lifetime_budget,
         s.optimization_goal, s.destination_type, s.billing_event,
         c.name as campanha, c.status as campanha_status,
         (lower(coalesce(s.status, '')) = 'active'
          and lower(coalesce(c.status, '')) = 'active') as entregando,
         round(coalesce(s.spend,0)::numeric,2) as gasto, s.form_leads,
         case when s.daily_budget is null and s.lifetime_budget is null
              then 'orcamento na CAMPANHA (indicio de CBO/Advantage)'
              else 'orcamento no CONJUNTO (indicio de ABO)' end as leitura_orcamento,
         (s.targeting is not null) as tem_targeting,
         s.targeting->'geo_locations'->'countries' as paises,
         s.targeting->'geo_locations'->'cities' as cidades,
         s.targeting->'geo_locations'->'regions' as regioes,
         coalesce(jsonb_array_length(s.targeting->'geo_locations'->'neighborhoods'), 0) as bairros_qtd,
         s.targeting->>'age_min' as idade_min,
         s.targeting->>'age_max' as idade_max,
         s.targeting->'flexible_spec' as interesses,
         s.targeting->'custom_audiences' as publicos_personalizados,
         d.destino_predominante, d.numeros_whatsapp, d.ctas,
         case
           when s.optimization_goal ilike 'CONVERSATIONS'
             or s.destination_type ilike '%WHATSAPP%'
             or s.destination_type ilike '%MESSENGER%'
             then 'conversao_mensagem_otimizada'
           when d.destino_predominante = 'whatsapp'
             then 'trafego_para_whatsapp_nao_otimizado'
           when s.optimization_goal in ('LEAD_GENERATION','QUALITY_LEAD','QUALITY_CALL')
             then 'leads'
           when s.optimization_goal in ('OFFSITE_CONVERSIONS','VALUE')
             then 'conversao_site'
           when s.optimization_goal in ('POST_ENGAGEMENT','PAGE_LIKES','EVENT_RESPONSES','REACH','IMPRESSIONS','AD_RECALL_LIFT','THRUPLAY','PROFILE_VISIT','PROFILE_AND_PAGE_ENGAGEMENT')
             then 'engajamento_topo'
           when s.optimization_goal in ('LINK_CLICKS','LANDING_PAGE_VIEWS')
             then 'trafego'
           else 'outro'
         end as pegada
    from public.ad_sets s
    left join public.campaigns c on c.id = s.campaign_id
    left join lateral (
      select
        case
          when bool_or(a.destination_url ~* 'wa\.me|api\.whatsapp|whatsapp\.com') then 'whatsapp'
          when bool_or(a.destination_url ~* '^https?://') then 'site'
          else 'desconhecido'
        end as destino_predominante,
        coalesce((
          select jsonb_agg(distinct num) from (
            select regexp_replace(m[1], '\D', '', 'g') as num
            from public.ads a2,
                 regexp_matches(coalesce(a2.destination_url,''), '(?:wa\.me/|phone=)(\+?[0-9]+)', 'g') as m
            where a2.adset_external_id = s.external_id
              and public.status_objeto_operacional(a2.status)
          ) w where num is not null and num <> ''
        ), '[]'::jsonb) as numeros_whatsapp,
        coalesce(jsonb_agg(distinct a.call_to_action_type)
                 filter (where a.call_to_action_type is not null), '[]'::jsonb) as ctas
      from public.ads a
      where a.adset_external_id = s.external_id
        and public.status_objeto_operacional(a.status)
    ) d on true
   where coalesce(s.company_id, c.company_id) = p_company_id
     and public.status_objeto_operacional(s.status)
     and public.status_objeto_operacional(c.status)
), rel as (
  select * from cj
   where lower(coalesce(campanha_status, '')) = 'active' or gasto > 0
), pag as (
  select * from rel order by gasto desc, conjunto limit greatest(p_limit,1) offset greatest(p_offset,0)
)
select jsonb_build_object(
  'total_conjuntos_da_empresa', (select count(*) from cj),
  'relevantes', (select count(*) from rel),
  'omitidos_por_irrelevancia', (select count(*) from cj) - (select count(*) from rel),
  'motivo_da_omissao', 'conjunto em campanha pausada E sem gasto no periodo coletado',
  'pagina_offset', greatest(p_offset,0),
  'pagina_tamanho', greatest(p_limit,1),
  'nesta_pagina', (select count(*) from pag),
  'restantes', greatest((select count(*) from rel) - greatest(p_offset,0) - (select count(*) from pag), 0),
  'em_campanha_ativa', (select count(*) from cj where lower(coalesce(campanha_status, '')) = 'active'),
  'entregando', (select count(*) from cj where entregando),
  'resumo_orcamento', (select jsonb_object_agg(leitura_orcamento, n) from (select leitura_orcamento, count(*) as n from rel group by 1) z),
  'resumo_pegada', (select jsonb_object_agg(pegada, n) from (select pegada, count(*) as n from rel group by 1) z),
  'conjuntos', coalesce((select jsonb_agg(to_jsonb(pag) order by pag.gasto desc) from pag), '[]'::jsonb),
  'nota', 'Esta leitura e de UMA empresa. optimization_goal DEFINE a pegada. numeros_whatsapp sao DESTINOS Click-to-WA do criativo (wa.me) — NAO sao inventario WABA Cloud/ON_PREMISE nem prova de numero "de pe". Para WABA + CTWA separados use get_waba_phones / get_waba_status. Conjunto status=ACTIVE com campanha PAUSED tem entregando=false (nao esta no ar). DELETED/ARCHIVED de conjunto e de anuncio ficam de fora. geo: paises, cidades (key+name), regioes e bairros_qtd. Para TROCAR geo de conjunto publicado use alterar_geo_do_conjunto — nao criar conjunto novo.',
  'como_contar_certo', 'NUNCA diga "100% dos conjuntos" com base na lista desta pagina. Use total_conjuntos_da_empresa e relevantes; se restantes>0, PAGINE. Status e case-insensitive (ACTIVE/active). DELETED/ARCHIVED nao entram no total.',
  'limite_conhecido', 'nao ha historico de ALTERACOES de orcamento (change log): exigiria coletar o endpoint /activities da Graph API.'
);
$function$;

comment on function public.get_estrutura_conjuntos(uuid, integer, integer) is
  'Estrutura de conjuntos com pegada/destino e geo (paises, cidades, regioes, bairros_qtd); DELETED/ARCHIVED omitidos.';
