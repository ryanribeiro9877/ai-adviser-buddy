-- DELETED/ARCHIVED saem da memoria operacional (02/09/2026).
--
-- Na COHAPM_VISTTA_CONV_WA_SET26 o agente somou 29 DELETED + 11 CAMPAIGN_PAUSED
-- como "40 anuncios registrados". CAMPAIGN_PAUSED continua no inventario (existe,
-- nao entrega). DELETED/ARCHIVED nao.

create or replace function public.status_objeto_operacional(p_status text)
returns boolean
language sql
immutable
parallel safe
set search_path to 'public', 'pg_temp'
as $$
  select upper(btrim(coalesce(p_status, ''))) not in ('DELETED', 'ARCHIVED');
$$;

comment on function public.status_objeto_operacional(text) is
  'True se o objeto Meta ainda existe para operacao. DELETED/ARCHIVED saem; CAMPAIGN_PAUSED/PAUSED/ACTIVE ficam.';

grant execute on function public.status_objeto_operacional(text) to authenticated, service_role;

-- 1) get_criativos_conteudo: todas as sobrecargas vivas, mesmo somente_ativas=false.
create or replace function public.get_criativos_conteudo(p_somente_ativas boolean default true)
returns jsonb
language sql
stable
set search_path to 'public', 'pg_temp'
as $function$
select jsonb_build_object(
  'total', count(*),
  'AVISO_IMPORTANTE', 'Esta listagem NAO esta filtrada por empresa: contem criativos de TODAS as empresas do sistema. Cada item traz o campo empresa - IGNORE os que nao forem da empresa da conversa e diga que fez esse filtro. A versao correta desta ferramenta recebe a empresa como parametro.',
  'nota', 'Conteudo real dos anuncios (legenda, titulo, CTA) ja coletado pelo sync. DELETED/ARCHIVED ficam de fora. Use junto com check_compliance para auditar as pecas em operacao sem pedir texto ao usuario.',
  'criativos', coalesce(jsonb_agg(jsonb_build_object(
      'empresa', (select name from public.companies co where co.id = a.company_id),
      'anuncio', a.name,
      'campanha', c.name,
      'campanha_ativa', (c.status = 'active'),
      'status_anuncio', a.status,
      'titulo', a.title,
      'legenda', a.body,
      'cta', a.call_to_action_type,
      'tem_imagem', (a.image_url is not null or a.thumbnail_url is not null),
      'gasto_acumulado', round(coalesce(a.spend,0)::numeric,2),
      'formularios', a.form_leads
    ) order by coalesce(a.spend,0) desc), '[]'::jsonb)
)
from public.ads a
left join public.campaigns c on c.id = a.campaign_id
where (not p_somente_ativas or c.status = 'active')
  and a.body is not null
  and public.status_objeto_operacional(a.status)
  and public.status_objeto_operacional(c.status);
$function$;

create or replace function public.get_criativos_conteudo(p_somente_ativas boolean, p_company_id uuid)
returns jsonb
language sql
stable
set search_path to 'public', 'pg_temp'
as $function$
select case
  when p_company_id is null then
    jsonb_build_object('erro', 'p_company_id e obrigatorio: criativos sao sempre de UMA empresa. Passe o id da empresa da conversa.')
  else (
    select jsonb_build_object(
      'total', count(*),
      'empresa', (select name from public.companies where id = p_company_id),
      'nota', 'Conteudo real dos anuncios (legenda, titulo, CTA, formato e destino) da empresa selecionada. DELETED/ARCHIVED ficam de fora mesmo com somente_ativas=false. CAMPAIGN_PAUSED continua. object_type diz o formato (VIDEO/IMAGE/etc); destino_url e o link do CTA e destino=whatsapp (wa.me/<numero>) prova que a peca manda para o WhatsApp. Use junto com check_compliance.',
      'criativos', coalesce(jsonb_agg(jsonb_build_object(
          'anuncio', a.name,
          'external_id', a.external_id,
          'creative_id', a.creative_id,
          'campanha', c.name,
          'campanha_ativa', (c.status = 'active'),
          'status_anuncio', a.status,
          'object_type', a.object_type,
          'titulo', a.title,
          'legenda', a.body,
          'cta', a.call_to_action_type,
          'destino_url', a.destination_url,
          'destino', case
            when a.destination_url ~* 'wa\.me|api\.whatsapp|whatsapp\.com' then 'whatsapp'
            when a.destination_url ~* '^https?://' then 'site'
            else 'desconhecido'
          end,
          'tem_imagem', (a.image_url is not null or a.thumbnail_url is not null),
          'gasto_acumulado', round(coalesce(a.spend,0)::numeric,2),
          'formularios', a.form_leads
        ) order by coalesce(a.spend,0) desc), '[]'::jsonb)
    )
    from public.ads a
    left join public.campaigns c on c.id = a.campaign_id
    where a.company_id = p_company_id
      and (not p_somente_ativas or c.status = 'active')
      and a.body is not null
      and public.status_objeto_operacional(a.status)
      and public.status_objeto_operacional(c.status)
  )
end;
$function$;

create or replace function public.get_criativos_conteudo(
  p_somente_ativas boolean,
  p_company_id uuid,
  p_offset integer,
  p_limit integer
)
returns jsonb
language sql
stable
set search_path to 'public', 'pg_temp'
as $function$
select case
  when p_company_id is null then
    jsonb_build_object('erro', 'p_company_id e obrigatorio: criativos sao sempre de UMA empresa.')
  else (
    with base as (
      select a.name as anuncio, a.external_id, a.creative_id, a.object_type,
             c.name as campanha, (c.status = 'active') as campanha_ativa,
             a.status as status_anuncio, a.title as titulo, a.body as legenda,
             a.call_to_action_type as cta,
             a.destination_url as destino_url,
             case
               when a.destination_url ~* 'wa\.me|api\.whatsapp|whatsapp\.com' then 'whatsapp'
               when a.destination_url ~* '^https?://' then 'site'
               else 'desconhecido'
             end as destino,
             (a.image_url is not null or a.thumbnail_url is not null) as tem_imagem,
             round(coalesce(a.spend,0)::numeric,2) as gasto_acumulado, a.form_leads as formularios
      from public.ads a
      left join public.campaigns c on c.id = a.campaign_id
      where a.company_id = p_company_id
        and (not p_somente_ativas or c.status = 'active')
        and a.body is not null
        and public.status_objeto_operacional(a.status)
        and public.status_objeto_operacional(c.status)
      order by coalesce(a.spend,0) desc, a.name
    ),
    tot as (select count(*) as n from base),
    pag as (select * from base offset greatest(coalesce(p_offset,0),0) limit coalesce(nullif(p_limit,0), 2147483647))
    select jsonb_build_object(
      'total', (select n from tot),
      'exibidos', (select count(*) from pag),
      'offset', greatest(coalesce(p_offset,0),0),
      'restantes', greatest((select n from tot) - greatest(coalesce(p_offset,0),0) - (select count(*) from pag), 0),
      'empresa', (select name from public.companies where id = p_company_id),
      'nota', 'Pagina de criativos ordenada por gasto (maior primeiro). DELETED/ARCHIVED ficam de fora. object_type=formato, destino_url=link do CTA, destino=whatsapp/site. Se restantes > 0, chame de novo com offset = offset + exibidos.',
      'criativos', coalesce((select jsonb_agg(to_jsonb(p)) from pag p), '[]'::jsonb)
    )
  )
end;
$function$;

create or replace function public.get_criativos_conteudo(
  p_somente_ativas boolean,
  p_company_id uuid,
  p_offset integer,
  p_limit integer,
  p_busca_nome text
)
returns jsonb
language sql
stable
security definer
set search_path to 'public'
as $function$
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
     and public.status_objeto_operacional(a.status)
     and public.status_objeto_operacional(c.status)
), pag as (
  select * from base order by gasto desc, anuncio limit greatest(p_limit,1) offset greatest(p_offset,0)
)
select jsonb_build_object(
  'busca_por_nome', p_busca_nome,
  'total_que_casam_com_a_busca', (select count(*) from base),
  'nesta_pagina', (select count(*) from pag),
  'restantes', greatest((select count(*) from base) - greatest(p_offset,0) - (select count(*) from pag), 0),
  'anuncios', coalesce((select jsonb_agg(to_jsonb(pag) order by pag.gasto desc) from pag), '[]'::jsonb),
  'como_usar', 'Para ACHAR um anuncio especifico, passe parte do nome em busca_nome em vez de folhear a lista inteira. DELETED/ARCHIVED nao casam: zero aqui pode ser peca exclusa, nao peca que nunca existiu.',
  'nota', 'legenda e o corpo do anuncio; titulo e cta vem do criativo. destino_url e o link do CTA: destino=whatsapp (wa.me/<numero>) prova que a peca manda para o WhatsApp; destino=site aponta para pagina. DELETED/ARCHIVED ficam de fora.'
);
$function$;

-- 2) get_estrutura_conjuntos: conjuntos e anuncios DELETED/ARCHIVED fora.
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
  'nota', 'Esta leitura e de UMA empresa. optimization_goal DEFINE a pegada. numeros_whatsapp sao DESTINOS Click-to-WA do criativo (wa.me) — NAO sao inventario WABA Cloud/ON_PREMISE nem prova de numero "de pe". Para WABA + CTWA separados use get_waba_phones / get_waba_status. Conjunto status=ACTIVE com campanha PAUSED tem entregando=false (nao esta no ar). DELETED/ARCHIVED de conjunto e de anuncio ficam de fora.',
  'como_contar_certo', 'NUNCA diga "100% dos conjuntos" com base na lista desta pagina. Use total_conjuntos_da_empresa e relevantes; se restantes>0, PAGINE. Status e case-insensitive (ACTIVE/active). DELETED/ARCHIVED nao entram no total.',
  'limite_conhecido', 'nao ha historico de ALTERACOES de orcamento (change log): exigiria coletar o endpoint /activities da Graph API.'
);
$function$;

comment on function public.get_estrutura_conjuntos(uuid, integer, integer) is
  'Estrutura de conjuntos com pegada/destino; DELETED/ARCHIVED omitidos; entregando=adset+campanha ACTIVE; numeros_whatsapp=CTWA destino de anuncios operacionais.';

insert into public.agent_context (categoria, fato, vigente, desde, atualizado)
select
  'doutrina',
  'DELETED/ARCHIVED SAEM DA MEMORIA OPERACIONAL (02/09/2026, traffic-chat v28.94). '
  || 'Quando o sync marca anuncio, conjunto ou campanha como DELETED ou ARCHIVED, o objeto '
  || 'deixa de existir para o agente: nao conta como "registrado", nao aparece em '
  || 'get_detalhe_anuncios / get_criativos_conteudo / get_estrutura_conjuntos / ranking, '
  || 'nao serve de molde e nao recebe card (alvo_nao_operacional). '
  || 'CAMPAIGN_PAUSED, ADSET_PAUSED e PAUSED continuam no inventario: o objeto EXISTE e so '
  || 'nao entrega. Pergunta "quais anuncios ativos nos conjuntos" com campanha pausada = '
  || 'liste os que ainda existem (status CAMPAIGN_PAUSED) e diga que nao entregam porque a '
  || 'campanha-mae esta pausada. '
  || 'PROIBIDO somar DELETED com CAMPAIGN_PAUSED. Medido em 02/09/2026 na '
  || 'COHAPM_VISTTA_CONV_WA_SET26: 29 DELETED + 11 CAMPAIGN_PAUSED viraram "40 anuncios '
  || 'registrados" (CONJ.1=6, CONJ.2=17, CONJ.3=12, CONJ.4=5). Inventario operacional real: '
  || 'CONJ.1=6 CAMPAIGN_PAUSED, CONJ.2=5 CAMPAIGN_PAUSED, CONJ.3=0, CONJ.4=0. '
  || 'A acao de excluir pelo agente continua inexistente (pausar tira do ar); exclusao feita '
  || 'na Meta pelo Ads Manager e o sync que a espelha — dai o agente desconsidera.',
  true,
  '2026-09-02',
  now()
where not exists (
  select 1 from public.agent_context
  where vigente and fato like 'DELETED/ARCHIVED SAEM DA MEMORIA OPERACIONAL%'
);
