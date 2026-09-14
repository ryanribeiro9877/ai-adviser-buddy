-- Relatorio Ocular 14/09/2026: colheita 30/31 com Falhas: get_waba_status.
-- O job inferia meio Drive `sistema_ocular` (VISTTA) e a RPC so aceitava
-- juridico|la_felicita|financeiro|outro — devolvia {erro: meio invalido}.
-- Aceita sistema_ocular (e aliases ocular/vistta) e classifica VISTTA/ocular
-- fora de `outro`. CONJ.*_LAF_* deixa de cair em outro.

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
  if v_meio in ('ocular', 'vistta', 'sistemaocular') then
    v_meio := 'sistema_ocular';
  end if;
  if v_meio is not null and v_meio not in ('juridico', 'la_felicita', 'financeiro', 'sistema_ocular', 'outro') then
    return jsonb_build_object(
      'erro', 'meio invalido',
      'aceitos', jsonb_build_array('juridico', 'la_felicita', 'financeiro', 'sistema_ocular', 'outro', null)
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
          or coalesce(p.verified_name, '') ~* '(^|[^a-z])(lf|laf)[_-]'
          then 'la_felicita'
        when coalesce(p.verified_name, '') ~* 'vistta|ocular|oftalm'
          or coalesce(w.name, '') ~* 'vistta|ocular|oftalm'
          then 'sistema_ocular'
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
      'COHAPM: isole juridico vs la_felicita vs sistema_ocular/VISTTA (verified_name / waba_nome / prefixo JUR_|LAF_|VISTTA). Nao misture meios.'
    ),
    'como_responder', 'Se o meio pedido tiver 0 WABA CONNECTED, diga "nenhum operacional Cloud/ON_PREMISE neste meio". Liste CTWA como inventario separado. Nao peca ao gestor escolher so entre CTWA como se fossem os unicos.'
  ) into v_rows;

  return v_rows;
end;
$$;

comment on function public.get_waba_phones(uuid, text) is
  'Inventario WhatsApp da empresa: WABA Cloud/ON_PREMISE (status/qualidade/tier/de_pe) separado de Click-to-WhatsApp (inventario). Filtro opcional meio=juridico|la_felicita|financeiro|sistema_ocular|outro.';
