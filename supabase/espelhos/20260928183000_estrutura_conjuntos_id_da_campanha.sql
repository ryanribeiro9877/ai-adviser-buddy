-- O recorte do relatório identificava a campanha pelo nome. SET26 cabe dentro de
-- SET26- SETEMBRO, e dois AGOSTO com o mesmo texto são campanhas diferentes na Meta.
-- O conjunto passa a carregar o ID da campanha.

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
         c.name as campanha, c.external_id as campaign_external_id, c.status as campanha_status,
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
         s.targeting->'geo_locations'->'neighborhoods' as bairros,
         coalesce(jsonb_array_length(s.targeting->'geo_locations'->'neighborhoods'), 0) as bairros_qtd,
         s.targeting->'geo_locations'->'location_types' as tipos_localizacao,
         s.targeting->>'age_min' as idade_min,
         s.targeting->>'age_max' as idade_max,
         s.targeting->'genders' as genders,
         s.targeting->'targeting_automation' as targeting_automation,
         s.targeting->'publisher_platforms' as plataformas,
         s.targeting->'flexible_spec' as interesses,
         s.targeting->'custom_audiences' as publicos_personalizados,
         s.targeting->'excluded_custom_audiences' as publicos_excluidos,
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
  'nota', 'Esta leitura e de UMA empresa. optimization_goal DEFINE a pegada. numeros_whatsapp sao DESTINOS Click-to-WA do criativo (wa.me) — NAO sao inventario WABA Cloud/ON_PREMISE nem prova de numero "de pe". Para WABA + CTWA separados use get_waba_phones / get_waba_status. Conjunto status=ACTIVE com campanha PAUSED tem entregando=false (nao esta no ar). DELETED/ARCHIVED de conjunto e de anuncio ficam de fora. geo: paises, cidades (key+name), regioes, bairros (key+name) e tipos_localizacao. Salvador da La Felicita pode vir em bairros com a key da cidade. Para TROCAR geo de conjunto publicado use alterar_geo_do_conjunto — nao criar conjunto novo.',
  'como_contar_certo', 'NUNCA diga "100% dos conjuntos" com base na lista desta pagina. Use total_conjuntos_da_empresa e relevantes; se restantes>0, PAGINE. Status e case-insensitive (ACTIVE/active). DELETED/ARCHIVED nao entram no total.',
  'limite_conhecido', 'nao ha historico de ALTERACOES de orcamento (change log): exigiria coletar o endpoint /activities da Graph API.'
);
$function$;

comment on function public.get_estrutura_conjuntos(uuid, integer, integer) is
  'Estrutura de conjuntos com campaign_external_id (ID Meta da campanha), pegada/destino e geo; DELETED/ARCHIVED omitidos.';
