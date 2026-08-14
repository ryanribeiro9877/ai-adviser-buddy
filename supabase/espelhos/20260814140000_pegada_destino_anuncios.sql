-- Pegada (engajamento x conversao) e destino (WhatsApp x site) por conjunto/anuncio.
-- Fonte: Pipeboard get_adset_details (optimization_goal/destination_type/billing_event)
-- e get_creative_details (CTA + object_story_spec.*.call_to_action.value.link).

alter table public.ad_sets
  add column if not exists optimization_goal text,
  add column if not exists destination_type text,
  add column if not exists billing_event text,
  add column if not exists promoted_object jsonb;

alter table public.ads
  add column if not exists destination_url text;

comment on column public.ad_sets.optimization_goal is
  'Evento que a Meta otimiza (LINK_CLICKS, CONVERSATIONS, LEAD_GENERATION...). Define a pegada.';
comment on column public.ad_sets.destination_type is
  'Destino declarado do conjunto (WHATSAPP, MESSENGER, UNDEFINED...).';
comment on column public.ads.destination_url is
  'Link de destino do CTA do criativo; wa.me/<numero> revela o WhatsApp de destino.';

-- get_estrutura_conjuntos: agora declara otimizacao, destino e pegada por conjunto,
-- e extrai os numeros de WhatsApp de destino a partir dos criativos.
create or replace function public.get_estrutura_conjuntos(
  p_company_id uuid,
  p_offset integer default 0,
  p_limit  integer default 20
) returns jsonb language sql stable as $function$
with cj as (
  select s.name as conjunto, s.status, s.bid_strategy,
         s.daily_budget, s.lifetime_budget,
         s.optimization_goal, s.destination_type, s.billing_event,
         c.name as campanha, c.status as campanha_status,
         round(coalesce(s.spend,0)::numeric,2) as gasto, s.form_leads,
         case when s.daily_budget is null and s.lifetime_budget is null
              then 'orcamento na CAMPANHA (indicio de CBO/Advantage)'
              else 'orcamento no CONJUNTO (indicio de ABO)' end as leitura_orcamento,
         (s.targeting is not null) as tem_targeting,
         s.targeting->'geo_locations'->'countries' as paises,
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
          ) w where num is not null and num <> ''
        ), '[]'::jsonb) as numeros_whatsapp,
        coalesce(jsonb_agg(distinct a.call_to_action_type)
                 filter (where a.call_to_action_type is not null), '[]'::jsonb) as ctas
      from public.ads a where a.adset_external_id = s.external_id
    ) d on true
   where coalesce(s.company_id, c.company_id) = p_company_id
), rel as (
  select * from cj where campanha_status = 'active' or gasto > 0
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
  'em_campanha_ativa', (select count(*) from cj where campanha_status = 'active'),
  'resumo_orcamento', (select jsonb_object_agg(leitura_orcamento, n) from (select leitura_orcamento, count(*) as n from rel group by 1) z),
  'resumo_pegada', (select jsonb_object_agg(pegada, n) from (select pegada, count(*) as n from rel group by 1) z),
  'conjuntos', coalesce((select jsonb_agg(to_jsonb(pag) order by pag.gasto desc) from pag), '[]'::jsonb),
  'nota', 'Esta leitura e de UMA empresa. optimization_goal e o evento que a Meta otimiza e DEFINE a pegada; destination_type e destino declarado. pegada=trafego_para_whatsapp_nao_otimizado significa que o anuncio MANDA para o WhatsApp (destino wa.me) mas o conjunto NAO otimiza por conversa - a Meta entrega por clique barato, nao por quem inicia conversa. numeros_whatsapp sao os numeros de destino extraidos do link do criativo.',
  'como_contar_certo', 'NUNCA diga "100% dos conjuntos" com base na lista desta pagina. Para afirmacao sobre o universo use total_conjuntos_da_empresa e relevantes; se restantes for maior que zero, PAGINE antes de concluir.',
  'limite_conhecido', 'nao ha historico de ALTERACOES de orcamento (change log): exigiria coletar o endpoint /activities da Graph API.'
);
$function$;

grant execute on function public.get_estrutura_conjuntos(uuid, integer, integer) to authenticated, service_role;

-- get_criativos_conteudo: expoe o destino do CTA (revela wa.me/<numero>).
create or replace function public.get_criativos_conteudo(
  p_somente_ativas boolean,
  p_company_id uuid,
  p_offset integer,
  p_limit integer,
  p_busca_nome text
) returns jsonb language sql stable security definer set search_path = public as $$
with base as (
  select a.name as anuncio, a.external_id, a.creative_id, a.object_type, a.status,
         a.body as legenda, a.title as titulo, a.call_to_action_type as cta,
         a.destination_url as destino_url,
         case
           when a.destination_url ~* 'wa\.me|api\.whatsapp|whatsapp\.com' then 'whatsapp'
           when a.destination_url ~* '^https?://' then 'site'
           else 'desconhecido'
         end as destino,
         round(coalesce(a.spend,0)::numeric,2) as gasto, a.form_leads as formularios,
         c.name as campanha
    from public.ads a
    left join public.campaigns c on c.id = a.campaign_id
   where coalesce(a.company_id, c.company_id) = p_company_id
     and (not p_somente_ativas or a.status = 'ACTIVE')
     and (p_busca_nome is null or a.name ilike '%' || p_busca_nome || '%')
), pag as (
  select * from base order by gasto desc, anuncio limit greatest(p_limit,1) offset greatest(p_offset,0)
)
select jsonb_build_object(
  'busca_por_nome', p_busca_nome,
  'total_que_casam_com_a_busca', (select count(*) from base),
  'nesta_pagina', (select count(*) from pag),
  'restantes', greatest((select count(*) from base) - greatest(p_offset,0) - (select count(*) from pag), 0),
  'anuncios', coalesce((select jsonb_agg(to_jsonb(pag) order by pag.gasto desc) from pag), '[]'::jsonb),
  'como_usar', 'Para ACHAR um anuncio especifico, passe parte do nome em busca_nome em vez de folhear a lista inteira - com muitos anuncios a lista e cortada no payload e o que voce procura pode nao vir. Se total_que_casam_com_a_busca for ZERO, o anuncio realmente nao existe com esse nome nesta empresa; se for maior que zero e restantes tambem, PAGINE. Nunca conclua ausencia a partir de uma pagina.',
  'nota', 'legenda e o corpo do anuncio; titulo e cta vem do criativo. destino_url e o link do CTA: destino=whatsapp (wa.me/<numero>) prova que a peca manda para o WhatsApp; destino=site aponta para pagina. Anuncio com object_type SHARE e criativo flexivel (Advantage+) e NAO expoe estrutura para copiar.'
);
$$;

revoke all on function public.get_criativos_conteudo(boolean, uuid, integer, integer, text) from public, anon;
grant execute on function public.get_criativos_conteudo(boolean, uuid, integer, integer, text) to authenticated, service_role;
