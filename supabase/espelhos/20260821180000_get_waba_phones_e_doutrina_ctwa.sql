-- Inventário WhatsApp legível pelo agente: WABA Cloud/ON_PREMISE vs Click-to-WA.
-- Causa medida (21/08/2026, chat COHAPM): traffic-chat NÃO tinha get_waba_status;
-- o job filtrava só platform_type=CLOUD_API (excluía ON_PREMISE "Cohapm Jurídico");
-- o agente lia só wa.me/nomes de conjunto e tratava CTWA IN_ADS como candidatos a linkar.

-- 1) RPC canônica para o agente
create or replace function public.get_waba_phones(
  p_company_id uuid,
  p_meio text default null
) returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_meio text := nullif(lower(trim(coalesce(p_meio, ''))), '');
  v_rows jsonb;
begin
  if p_company_id is null then
    return jsonb_build_object('erro', 'company_id obrigatorio');
  end if;
  if v_meio is not null and v_meio not in ('juridico', 'la_felicita', 'financeiro', 'outro') then
    return jsonb_build_object(
      'erro', 'meio invalido',
      'aceitos', jsonb_build_array('juridico', 'la_felicita', 'financeiro', 'outro', null)
    );
  end if;

  with base as (
    select
      p.display_phone_number as numero,
      p.verified_name as nome_verificado,
      w.name as waba_nome,
      p.status,
      p.quality_rating as qualidade,
      p.messaging_limit_tier as tier,
      p.platform_type,
      p.external_id,
      case
        when p.platform_type = 'CLICK_TO_WHATSAPP' or p.external_id like 'ads-wa:%'
          then 'click_to_whatsapp'
        when p.platform_type = 'CLOUD_API' then 'cloud_api'
        when p.platform_type = 'ON_PREMISE' then 'on_premise'
        when p.platform_type is null and p.external_id not like 'ads-wa:%'
          then 'waba_sem_platform_type'
        else 'outro'
      end as origem,
      case
        when coalesce(p.verified_name, '') ~* 'jur[ií]dico'
          or coalesce(w.name, '') ~* 'jur[ií]dico'
          or coalesce(p.verified_name, '') ~* '(^|[^a-z])jur[_-]'
          then 'juridico'
        when coalesce(p.verified_name, '') ~* 'felicit'
          or coalesce(w.name, '') ~* 'felicit'
          or coalesce(p.verified_name, '') ~* '(^|[^a-z])lf[_-]'
          then 'la_felicita'
        when coalesce(p.verified_name, '') ~* 'financeiro'
          or coalesce(w.name, '') ~* 'financeiro'
          then 'financeiro'
        else 'outro'
      end as meio,
      case
        when p.platform_type = 'CLICK_TO_WHATSAPP' or p.external_id like 'ads-wa:%'
          then (upper(coalesce(p.status, '')) = 'IN_ACTIVE_ADS')
        else (upper(coalesce(p.status, '')) = 'CONNECTED')
      end as de_pe
    from public.waba_phone_numbers p
    left join public.wabas w
      on w.external_id = p.waba_external_id
     and w.company_id = p.company_id
    where p.company_id = p_company_id
      and coalesce(p.platform_type, '') is distinct from 'NOT_APPLICABLE'
  ),
  filtrado as (
    select * from base
    where v_meio is null or meio = v_meio
  ),
  waba as (
    select * from filtrado where origem <> 'click_to_whatsapp'
  ),
  ctwa as (
    select * from filtrado where origem = 'click_to_whatsapp'
  )
  select jsonb_build_object(
    'filtro_meio', v_meio,
    'resumo', jsonb_build_object(
      'waba_total', (select count(*) from waba),
      'waba_de_pe_connected', (select count(*) from waba where de_pe),
      'waba_disconnected', (select count(*) from waba where not de_pe),
      'waba_cloud_api', (select count(*) from waba where origem = 'cloud_api'),
      'waba_on_premise', (select count(*) from waba where origem = 'on_premise'),
      'ctwa_inventario', (select count(*) from ctwa),
      'ctwa_em_anuncios_ativos_entregando', (select count(*) from ctwa where de_pe),
      'ctwa_so_inventario_in_ads', (select count(*) from ctwa where not de_pe),
      'por_meio', coalesce((
        select jsonb_object_agg(meio, n) from (
          select meio, count(*)::int as n from filtrado group by 1
        ) z
      ), '{}'::jsonb)
    ),
    'waba_cloud_on_premise', coalesce((
      select jsonb_agg(jsonb_build_object(
        'numero', numero,
        'nome_verificado', nome_verificado,
        'waba_nome', waba_nome,
        'origem', origem,
        'meio', meio,
        'status', status,
        'qualidade', qualidade,
        'tier', tier,
        'de_pe', de_pe,
        'leitura', case when de_pe
          then 'operacional (CONNECTED) — apto a considerar "de pe"'
          else 'NAO operacional (status <> CONNECTED) — NAO chame de pe'
        end
      ) order by meio, de_pe desc, nome_verificado, numero)
      from waba
    ), '[]'::jsonb),
    'click_to_whatsapp_inventario', coalesce((
      select jsonb_agg(jsonb_build_object(
        'numero', numero,
        'contexto_anuncio', nome_verificado,
        'meio', meio,
        'status', status,
        'origem', 'click_to_whatsapp',
        'de_pe', de_pe,
        'leitura', case
          when de_pe then 'IN_ACTIVE_ADS = aparece em anuncio com entrega efetiva; ainda assim e destino de midia, nao Cloud API'
          else 'IN_ADS = inventario de destino wa.me/nome de conjunto — NAO e numero "de pe"; NAO indique como unico candidato a linkar sem listar WABA'
        end
      ) order by meio, de_pe desc, nome_verificado, numero)
      from ctwa
    ), '[]'::jsonb),
    'doutrina', jsonb_build_array(
      'WABA Cloud API / ON_PREMISE: "de pe" = status CONNECTED (com qualidade/tier quando houver).',
      'Click-to-WhatsApp: inventario derivado de wa.me / nomes de conjunto. NUNCA chame de pe salvo IN_ACTIVE_ADS.',
      'Pergunta "qual numero linkar / esta de pe?": SEMPRE separe as duas listas. Se WABA do meio estiver DISCONNECTED, diga isso explicitamente.',
      'get_estrutura_conjuntos / get_criativos_conteudo so mostram destino do anuncio (CTWA) — nao substituem esta RPC.',
      'COHAPM: isole juridico vs la_felicita (verified_name / waba_nome / prefixo JUR_|LF_). Nao misture meios.'
    ),
    'como_responder', 'Se o meio pedido tiver 0 WABA CONNECTED, diga "nenhum operacional Cloud/ON_PREMISE neste meio". Liste CTWA como inventario separado. Nao peca ao gestor escolher so entre CTWA como se fossem os unicos.'
  ) into v_rows;

  return v_rows;
end;
$$;

comment on function public.get_waba_phones(uuid, text) is
  'Inventario WhatsApp da empresa: WABA Cloud/ON_PREMISE (status/qualidade/tier/de_pe) separado de Click-to-WhatsApp (inventario). Filtro opcional meio=juridico|la_felicita|financeiro|outro.';

grant execute on function public.get_waba_phones(uuid, text) to authenticated, service_role;

-- 2) get_estrutura_conjuntos: status case-insensitive + entregando + nota CTWA
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
          ) w where num is not null and num <> ''
        ), '[]'::jsonb) as numeros_whatsapp,
        coalesce(jsonb_agg(distinct a.call_to_action_type)
                 filter (where a.call_to_action_type is not null), '[]'::jsonb) as ctas
      from public.ads a where a.adset_external_id = s.external_id
    ) d on true
   where coalesce(s.company_id, c.company_id) = p_company_id
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
  'nota', 'Esta leitura e de UMA empresa. optimization_goal DEFINE a pegada. numeros_whatsapp sao DESTINOS Click-to-WA do criativo (wa.me) — NAO sao inventario WABA Cloud/ON_PREMISE nem prova de numero "de pe". Para WABA + CTWA separados use get_waba_phones / get_waba_status. Conjunto status=ACTIVE com campanha PAUSED tem entregando=false (nao esta no ar).',
  'como_contar_certo', 'NUNCA diga "100% dos conjuntos" com base na lista desta pagina. Use total_conjuntos_da_empresa e relevantes; se restantes>0, PAGINE. Status e case-insensitive (ACTIVE/active).',
  'limite_conhecido', 'nao ha historico de ALTERACOES de orcamento (change log): exigiria coletar o endpoint /activities da Graph API.'
);
$function$;

comment on function public.get_estrutura_conjuntos(uuid, integer, integer) is
  'Estrutura de conjuntos com pegada/destino; status case-insensitive; entregando=adset+campanha ACTIVE; numeros_whatsapp=CTWA destino.';

-- 3) Doutrina institucional
insert into public.agent_context (company_id, categoria, fato, vigente)
select null, 'whatsapp_inventario',
  'WHATSAPP: duas familias distintas. (1) WABA Cloud API / ON_PREMISE — status CONNECTED/DISCONNECTED, qualidade, tier; "de pe" = CONNECTED. (2) Click-to-WhatsApp — inventario de destino wa.me / nome de conjunto (platform_type=CLICK_TO_WHATSAPP); status IN_ADS = so inventario, IN_ACTIVE_ADS = em anuncio com entrega efetiva. NUNCA chame CTWA de pe salvo IN_ACTIVE_ADS. Pergunta "qual numero linkar / esta de pe?" OBRIGA get_waba_status/get_waba_phones; get_estrutura_conjuntos/get_criativos_conteudo so mostram destino do anuncio e NAO substituem a leitura WABA. Conjunto ACTIVE sob campanha PAUSED = nao entregando.',
  true
where not exists (
  select 1 from public.agent_context
  where vigente and company_id is null and categoria = 'whatsapp_inventario'
    and fato like 'WHATSAPP: duas familias distintas%'
);

insert into public.agent_context (company_id, categoria, fato, vigente)
select '57f755b9-c23d-4f58-a488-8173d697c010', 'whatsapp_isolamento_cohapm',
  'COHAPM WhatsApp: isole JURIDICO vs LA FELICITA (verified_name / waba_nome / prefixo JUR_ vs LF_ no contexto do anuncio). Juridico tipicamente aparece como "Cohapm Juridico" (ON_PREMISE); La Felicita tem Cloud CONNECTED proprios. CTWA com JUR_ no rotulo sao inventario de midia, nao prova de Cloud operacional. Se WABA juridico estiver DISCONNECTED, diga honestamente: nenhum operacional Cloud no meio; CTWA so inventario; nao peca escolher so entre CTWA como se fossem os unicos de pe.',
  true
where not exists (
  select 1 from public.agent_context
  where vigente and company_id = '57f755b9-c23d-4f58-a488-8173d697c010'
    and categoria = 'whatsapp_isolamento_cohapm'
);
