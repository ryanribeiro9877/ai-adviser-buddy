-- ESPELHO DE MIGRACAO APLICADA
-- version: 20260811171049
-- name: molde_dinamico_serve_de_config
-- projeto: gzjwnjdpxpbmdhcyefvs (Gestor de Trafego IA)
-- aplicada por: Claude via MCP apply_migration
-- espelho gerado a partir de supabase_migrations.schema_migrations - NAO transcrito a mao

-- OS 48 CRIATIVOS DINAMICOS PASSAM A SERVIR DE MOLDE PARA PECA NOVA DE VIDEO.
--
-- O QUE LIMITAVA:
--   A rota de peca nova so aceitava molde com object_story_spec.video_data. Dos ~59
--   criativos da conta, so 8 tinham isso. Os outros 48 tinham object_story_spec so com
--   page_id e guardavam link + CTA + midia no asset_feed_spec - campo que a coleta diaria
--   JA LIA desde o GT-12 (para destino_url) e descartava.
--
-- SONDA 11/08/2026 (meta-campaign-status v11, so leitura):
--   24 criativos sem video_data com asset_feed_spec respondido; 23 deles com
--   link_urls[].website_url, call_to_action_types=["SIGN_UP"] e videos[]. Forma do CTA
--   observada: string plana no array (nao objeto). page_id no story_spec = true em todos.
--
-- O QUE ESTA MIGRACAO FAZ:
--   1) Guarda os VALORES (page_id, link, CTA, identidade IG) e a FONTE da config
--      (video_data | asset_feed_spec), alem do booleano serve_de_molde_video.
--   2) O portao passa a ler serve_de_molde_video no lugar de expoe_video_data: o molde
--      serve se carrega a CONFIGURACAO necessaria para montar um anuncio de video avulso,
--      mesmo sem video_data no story_spec. Molde de imagem (sem video_data e sem videos no
--      asset_feed) continua recusado - muda formato, nao peca.
--   3) A mensagem de recusa deixa de falar so de "sem video_data" e aponta as duas fontes.

alter table public.creative_estado_graph
  add column if not exists page_id text,
  add column if not exists link_destino text,
  add column if not exists call_to_action_type text,
  add column if not exists instagram_actor_id text,
  add column if not exists fonte_da_config text,
  add column if not exists serve_de_molde_video boolean;

comment on column public.creative_estado_graph.page_id is
  'Valor do page_id observado no object_story_spec. Ausente = nunca lido ou nao veio.';
comment on column public.creative_estado_graph.link_destino is
  'URL de destino herdavel: de video_data.call_to_action.value.link / video_data.link, ou de asset_feed_spec.link_urls[].website_url (forma unica). Ambiguidade (mais de uma URL distinta) deixa nulo - nao escolhemos.';
comment on column public.creative_estado_graph.call_to_action_type is
  'CTA herdavel: de video_data.call_to_action.type, ou o UNICO valor de asset_feed_spec.call_to_action_types. Varios CTAs distintos deixam nulo.';
comment on column public.creative_estado_graph.instagram_actor_id is
  'Identidade Instagram/Threads quando o molde a expoe (instagram_user_id ou instagram_actor_id no story_spec). Sem ela o anuncio nasce sem Identity de Threads - aviso da Meta, nao bloqueio.';
comment on column public.creative_estado_graph.fonte_da_config is
  'De onde saiu a config herdavel: video_data (object_story_spec) ou asset_feed_spec. Null = sem config suficiente.';
comment on column public.creative_estado_graph.serve_de_molde_video is
  'true = este criativo carrega page_id + link + CTA e e de FORMATO VIDEO (tem video_data OU videos[] no asset_feed). E o que o portao de emissao consulta para peca nova. false = molde de imagem ou config incompleta. null = nunca verificado.';

do $$
begin
  if not exists (
    select 1 from pg_constraint
     where conname = 'creative_estado_fonte_da_config_conhecida'
       and conrelid = 'public.creative_estado_graph'::regclass
  ) then
    alter table public.creative_estado_graph
      add constraint creative_estado_fonte_da_config_conhecida
      check (fonte_da_config is null or fonte_da_config in ('video_data','asset_feed_spec'));
  end if;
end $$;

create or replace function public.espelhar_estado_de_criativos_da_graph(p jsonb)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_recebidos int := 0;
  v_gravados int := 0;
begin
  if p is null or jsonb_typeof(p) <> 'array' then
    raise exception 'espelhar_estado_de_criativos_da_graph: p tem de ser um array jsonb, veio %',
      coalesce(jsonb_typeof(p), 'null');
  end if;

  v_recebidos := jsonb_array_length(p);

  with entrada as (
    select
      nullif(btrim(x->>'creative_id'), '')             as creative_id,
      nullif(btrim(x->>'account_id'), '')              as account_id,
      (x->>'expoe_object_story_spec')::boolean         as expoe_spec,
      (x->>'expoe_video_data')::boolean                as expoe_video,
      case when jsonb_typeof(x->'expoe_page_id') = 'boolean'
           then (x->>'expoe_page_id')::boolean else null end       as expoe_page,
      case when jsonb_typeof(x->'expoe_link_destino') = 'boolean'
           then (x->>'expoe_link_destino')::boolean else null end  as expoe_link,
      case when jsonb_typeof(x->'serve_de_molde_video') = 'boolean'
           then (x->>'serve_de_molde_video')::boolean else null end as serve_video,
      nullif(btrim(x->>'page_id'), '')                 as page_id,
      nullif(btrim(x->>'link_destino'), '')            as link_destino,
      nullif(btrim(x->>'call_to_action_type'), '')     as cta,
      nullif(btrim(x->>'instagram_actor_id'), '')      as ig,
      case when nullif(btrim(x->>'fonte_da_config'),'') in ('video_data','asset_feed_spec')
           then nullif(btrim(x->>'fonte_da_config'),'') else null end as fonte_cfg,
      case when jsonb_typeof(x->'chaves_do_spec') = 'array'
           then array(select jsonb_array_elements_text(x->'chaves_do_spec'))
           else null end                               as chaves,
      nullif(btrim(x->>'fonte'), '')                   as fonte
    from jsonb_array_elements(p) x
    where jsonb_typeof(x->'expoe_object_story_spec') = 'boolean'
      and jsonb_typeof(x->'expoe_video_data') = 'boolean'
      and nullif(btrim(x->>'creative_id'), '') is not null
  ),
  unica as (
    select distinct on (creative_id) * from entrada order by creative_id
  ),
  gravada as (
    insert into public.creative_estado_graph as c
      (creative_id, account_id, expoe_object_story_spec, expoe_video_data,
       expoe_page_id, expoe_link_destino, serve_de_molde_video,
       page_id, link_destino, call_to_action_type, instagram_actor_id, fonte_da_config,
       chaves_do_spec, observado_em, fonte)
    select creative_id, account_id, expoe_spec, expoe_video, expoe_page, expoe_link, serve_video,
           page_id, link_destino, cta, ig, fonte_cfg, chaves, now(),
           coalesce(fonte, 'Graph fields=object_story_spec,asset_feed_spec; coleta meta-campaign-status')
      from unica
    on conflict (creative_id) do update set
      account_id              = coalesce(excluded.account_id, c.account_id),
      expoe_object_story_spec = excluded.expoe_object_story_spec,
      expoe_video_data        = excluded.expoe_video_data,
      expoe_page_id           = coalesce(excluded.expoe_page_id, c.expoe_page_id),
      expoe_link_destino      = coalesce(excluded.expoe_link_destino, c.expoe_link_destino),
      serve_de_molde_video    = coalesce(excluded.serve_de_molde_video, c.serve_de_molde_video),
      page_id                 = coalesce(excluded.page_id, c.page_id),
      link_destino            = coalesce(excluded.link_destino, c.link_destino),
      call_to_action_type     = coalesce(excluded.call_to_action_type, c.call_to_action_type),
      instagram_actor_id      = coalesce(excluded.instagram_actor_id, c.instagram_actor_id),
      fonte_da_config         = coalesce(excluded.fonte_da_config, c.fonte_da_config),
      chaves_do_spec          = coalesce(excluded.chaves_do_spec, c.chaves_do_spec),
      observado_em            = excluded.observado_em,
      fonte                   = excluded.fonte
    returning 1
  )
  select (select count(*) from gravada) into v_gravados;

  return jsonb_build_object(
    'recebidos', v_recebidos,
    'gravados', v_gravados,
    'nota', 'Grava booleanos e VALORES (page_id, link, CTA) quando a leitura chegou. '
         || 'serve_de_molde_video=true cobre video_data OU asset_feed_spec com videos+link+CTA. '
         || 'Criativo sem resposta preserva o valor anterior.'
  );
end
$function$;

create or replace function public.avaliar_estado_destino_execucao(p_acao text, p_pedido jsonb, p_company_id uuid default null::uuid)
returns jsonb
language plpgsql
stable security definer
set search_path to 'public'
as $function$
declare
  v_regra public.contrato_de_estado_execucao%rowtype;
  v_destino text; v_conta text; v_estado boolean; v_encontrado boolean;
  v_avaliacoes jsonb := '[]'::jsonb; v_uma jsonb; v_recusa jsonb := null; v_alguma boolean := false;
begin
  for v_regra in
    select * from public.contrato_de_estado_execucao
     where acao = p_acao and vigente
     order by coalesce(ordem, 1000), campo_destino, propriedade
  loop
    if v_regra.condicao_campo_pedido is not null
       and not exists (
         select 1 from unnest(string_to_array(v_regra.condicao_campo_pedido, ',')) c
          where public.campo_presente_no_pedido(p_pedido, btrim(c))
       ) then
      v_avaliacoes := v_avaliacoes || jsonb_build_object('propriedade', v_regra.propriedade,
        'avaliado', false, 'motivo', 'condicao_do_pedido_ausente', 'condicao', v_regra.condicao_campo_pedido);
      continue;
    end if;

    v_destino := coalesce(nullif(btrim(coalesce(p_pedido->>v_regra.campo_destino,'')),''),
                          nullif(btrim(coalesce(p_pedido->>'conjunto_destino','')),''));
    if v_destino is null then
      v_avaliacoes := v_avaliacoes || jsonb_build_object('propriedade', v_regra.propriedade,
        'avaliado', false, 'motivo', 'destino_ausente');
      continue;
    end if;
    v_conta := regexp_replace(nullif(btrim(coalesce(p_pedido->>'conta_destino','')),''), '^act_', '');

    v_estado := null; v_encontrado := false;
    if v_regra.propriedade = 'is_dynamic_creative' then
      select a.is_dynamic_creative, true into v_estado, v_encontrado from public.ad_sets a
       where a.external_id = v_destino and (p_company_id is null or a.company_id = p_company_id)
         and (v_conta is null or a.account_id = v_conta)
       order by a.estado_graph_observado_em desc nulls last limit 1;
    elsif v_regra.propriedade = 'campanha_tem_orcamento_proprio' then
      select case when c.config_coletada_em is null then null
                  else (coalesce(c.daily_budget,0) > 0 or coalesce(c.lifetime_budget,0) > 0) end,
             true
        into v_estado, v_encontrado
        from public.campaigns c
       where c.external_id = v_destino and c.provider = 'meta_ads'
         and (p_company_id is null or c.company_id = p_company_id)
         and (v_conta is null or c.external_account_id = v_conta)
       order by c.config_coletada_em desc nulls last limit 1;
    elsif v_regra.propriedade in ('molde_expoe_video_data', 'molde_expoe_page_id', 'molde_expoe_link_destino') then
      select case v_regra.propriedade
               when 'molde_expoe_video_data'   then coalesce(k.serve_de_molde_video, k.expoe_video_data)
               when 'molde_expoe_page_id'      then k.expoe_page_id
               else                                 k.expoe_link_destino
             end,
             true
        into v_estado, v_encontrado
        from public.creative_estado_graph k
       where k.creative_id = v_destino
         and (v_conta is null or k.account_id is null or k.account_id = v_conta)
       limit 1;
    end if;

    if not coalesce(v_encontrado,false) or v_estado is null then
      v_uma := jsonb_build_object('propriedade', v_regra.propriedade, 'avaliado', true,
        'estado_observado', null, 'valido', false,
        'recusa', v_regra.recusa_estado_desconhecido, 'mensagem', v_regra.mensagem_estado_desconhecido);
    elsif v_estado = v_regra.valor_recusado then
      v_uma := jsonb_build_object('propriedade', v_regra.propriedade, 'avaliado', true,
        'estado_observado', v_estado, 'valido', false,
        'recusa', v_regra.recusa_nomeada, 'mensagem', v_regra.mensagem_de_recusa);
    else
      v_uma := jsonb_build_object('propriedade', v_regra.propriedade, 'avaliado', true,
        'estado_observado', v_estado, 'valido', true,
        'mensagem', 'Estado do destino verificado e compativel com o pedido.');
    end if;

    v_alguma := true;
    v_avaliacoes := v_avaliacoes || v_uma;
    if (v_uma->>'valido')::boolean is not true and v_recusa is null then v_recusa := v_uma; end if;
  end loop;

  if v_recusa is not null then
    return v_recusa || jsonb_build_object('avaliacoes', v_avaliacoes);
  end if;
  if not v_alguma then
    return jsonb_build_object('valido', true, 'avaliado', false,
      'motivo', case when exists (select 1 from public.contrato_de_estado_execucao where acao=p_acao and vigente)
                     then 'nenhuma_regra_aplicavel_ao_pedido' else 'acao_sem_regra_de_estado' end,
      'avaliacoes', v_avaliacoes);
  end if;
  return jsonb_build_object('valido', true, 'avaliado', true, 'avaliacoes', v_avaliacoes,
    'mensagem', 'Todos os estados de destino declarados para esta acao foram verificados e aceitam o pedido.');
end; $function$;

update public.contrato_de_estado_execucao
   set mensagem_de_recusa =
     'Nao emiti o card porque o anuncio molde escolhido nao carrega a configuracao necessaria para trocar a peca por um VIDEO novo (pagina + URL de destino + CTA em formato de video). Isso acontece com molde de IMAGEM. Criativo Dinamico com asset_feed_spec de video PASSA a servir - a config sai de la. Escolha um molde de VIDEO (avulso ou dinamico com videos no feed).',
       fonte = 'Graph fields=object_story_spec,asset_feed_spec; coleta meta-campaign-status; executora meta-actions montarCriacao (video_data ou montagem a partir do asset_feed_spec)'
 where acao = 'criar_anuncio_a_partir_de'
   and propriedade = 'molde_expoe_video_data'
   and vigente;

insert into public.agent_context (company_id, categoria, fato, vigente)
select 'ded20b38-f42e-4c71-800c-31b97ea48bcf'::uuid,
       'criacao',
       'MOLDE DE PECA NOVA (11/08/2026): nao escolha molde so por lastro nem so por video_data no object_story_spec. Criativo Dinamico (asset_feed_spec com videos + link_urls + call_to_action_types) TAMBEM serve de molde - a executora monta o video_data a partir dessa config. Molde de IMAGEM continua recusado. Consulte creative_estado_graph.serve_de_molde_video=true (ou peca ao portao). Sobre posicionamentos: anuncio de VIDEO nao roda na Coluna da direita do Facebook (exige imagem) - isso e esperado, nao e tamanho do video. Threads exige Identity (instagram_actor_id); se o molde nao trouxer, o aviso aparece e o anuncio segue nos demais posicionamentos.',
       true
where not exists (
  select 1 from public.agent_context
   where company_id = 'ded20b38-f42e-4c71-800c-31b97ea48bcf'
     and fato like 'MOLDE DE PECA NOVA (11/08/2026):%'
     and vigente
);

do $$
begin
  if not exists (
    select 1 from information_schema.columns
     where table_schema='public' and table_name='creative_estado_graph' and column_name='serve_de_molde_video'
  ) then
    raise exception 'coluna serve_de_molde_video deveria existir apos esta migracao';
  end if;
end $$;
