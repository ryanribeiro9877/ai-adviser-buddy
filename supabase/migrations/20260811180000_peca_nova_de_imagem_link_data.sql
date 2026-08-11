-- PECA NOVA DE IMAGEM: libera os moldes com link_data.
--
-- SONDA 11/08/2026 (antes desta migracao):
--   Dos 28 que nao serviam de video: 25 tem chaves_do_spec=["page_id","link_data"];
--   3 nao expoem object_story_spec (continuam recusando).
--   media_uploads: 0 com meta_image_hash (19 videos). Drive TEM imagens (Capas etc.),
--   mas nenhuma foi enviada a biblioteca Meta ainda.
--   Upload de imagem NOVA: existe via edge upload-midia → Graph /adimages (NAO via
--   Pipeboard). Pipeboard create_ad_creative ACEITA image_hash plano (argsCreativeDeGraph
--   desembrulha link_data desde 07/08).
--
-- O QUE ESTA MIGRACAO FAZ:
--   1) serve_de_molde_imagem + expoe_link_data em creative_estado_graph.
--   2) Portao: regra molde_serve_de_imagem quando o pedido traz meta_image_hash.
--   3) contrato: meta_image_hash passa a suportado=true (deixou de ser foto_nao_suportada).
--   4) peca_bloqueada_por_revisao resolve tambem por meta_image_hash.
--   5) pedido_de_anuncio_completo: avisos de veiculacao SENSIVEIS AO FORMATO
--      (video → Coluna da direita fora; imagem → Coluna da direita pode veicular).
--   6) pedido_de_anuncio_completo_sem_estado_destino: meta_image_hash entra em v_midia.

-- ============================================================================
-- 1 - COLUNAS
-- ============================================================================
alter table public.creative_estado_graph
  add column if not exists expoe_link_data boolean,
  add column if not exists serve_de_molde_imagem boolean;

comment on column public.creative_estado_graph.expoe_link_data is
  'true se object_story_spec traz link_data (formato IMAGEM).';
comment on column public.creative_estado_graph.serve_de_molde_imagem is
  'true = molde carrega page_id + link + CTA em formato IMAGEM (link_data). Portao de peca nova com meta_image_hash consulta esta coluna.';

-- fonte_da_config passa a aceitar link_data
alter table public.creative_estado_graph drop constraint if exists creative_estado_fonte_da_config_conhecida;
alter table public.creative_estado_graph
  add constraint creative_estado_fonte_da_config_conhecida
  check (fonte_da_config is null or fonte_da_config in ('video_data','asset_feed_spec','link_data'));

-- ============================================================================
-- 2 - GRAVACAO
-- ============================================================================
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
      case when jsonb_typeof(x->'expoe_link_data') = 'boolean'
           then (x->>'expoe_link_data')::boolean else null end as expoe_ld,
      case when jsonb_typeof(x->'expoe_page_id') = 'boolean'
           then (x->>'expoe_page_id')::boolean else null end       as expoe_page,
      case when jsonb_typeof(x->'expoe_link_destino') = 'boolean'
           then (x->>'expoe_link_destino')::boolean else null end  as expoe_link,
      case when jsonb_typeof(x->'serve_de_molde_video') = 'boolean'
           then (x->>'serve_de_molde_video')::boolean else null end as serve_video,
      case when jsonb_typeof(x->'serve_de_molde_imagem') = 'boolean'
           then (x->>'serve_de_molde_imagem')::boolean else null end as serve_img,
      nullif(btrim(x->>'page_id'), '')                 as page_id,
      nullif(btrim(x->>'link_destino'), '')            as link_destino,
      nullif(btrim(x->>'call_to_action_type'), '')     as cta,
      nullif(btrim(x->>'instagram_actor_id'), '')      as ig,
      case when nullif(btrim(x->>'fonte_da_config'),'') in ('video_data','asset_feed_spec','link_data')
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
      (creative_id, account_id, expoe_object_story_spec, expoe_video_data, expoe_link_data,
       expoe_page_id, expoe_link_destino, serve_de_molde_video, serve_de_molde_imagem,
       page_id, link_destino, call_to_action_type, instagram_actor_id, fonte_da_config,
       chaves_do_spec, observado_em, fonte)
    select creative_id, account_id, expoe_spec, expoe_video, expoe_ld, expoe_page, expoe_link,
           serve_video, serve_img, page_id, link_destino, cta, ig, fonte_cfg, chaves, now(),
           coalesce(fonte, 'Graph fields=object_story_spec,asset_feed_spec; coleta meta-campaign-status')
      from unica
    on conflict (creative_id) do update set
      account_id              = coalesce(excluded.account_id, c.account_id),
      expoe_object_story_spec = excluded.expoe_object_story_spec,
      expoe_video_data        = excluded.expoe_video_data,
      expoe_link_data         = coalesce(excluded.expoe_link_data, c.expoe_link_data),
      expoe_page_id           = coalesce(excluded.expoe_page_id, c.expoe_page_id),
      expoe_link_destino      = coalesce(excluded.expoe_link_destino, c.expoe_link_destino),
      serve_de_molde_video    = coalesce(excluded.serve_de_molde_video, c.serve_de_molde_video),
      serve_de_molde_imagem   = coalesce(excluded.serve_de_molde_imagem, c.serve_de_molde_imagem),
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
    'nota', 'Grava video (serve_de_molde_video) e imagem (serve_de_molde_imagem/link_data).'
  );
end
$function$;

-- ============================================================================
-- 3 - PORTAO
-- ============================================================================
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
    elsif v_regra.propriedade in (
      'molde_expoe_video_data', 'molde_serve_de_imagem',
      'molde_expoe_page_id', 'molde_expoe_link_destino'
    ) then
      select case v_regra.propriedade
               when 'molde_expoe_video_data'   then coalesce(k.serve_de_molde_video, k.expoe_video_data)
               when 'molde_serve_de_imagem'    then coalesce(k.serve_de_molde_imagem, k.expoe_link_data)
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

-- Regras de estado: imagem (ordem 1) + estender page/link para meta_image_hash
insert into public.contrato_de_estado_execucao
  (acao, propriedade, campo_destino, valor_recusado, recusa_nomeada, recusa_estado_desconhecido,
   mensagem_de_recusa, mensagem_estado_desconhecido, condicao_campo_pedido, ordem, vigente, fonte)
select
  'criar_anuncio_a_partir_de',
  'molde_serve_de_imagem',
  'creative_id',
  false,
  'molde_sem_link_data',
  'molde_imagem_nunca_verificado',
  'Nao emiti o card porque o molde escolhido nao carrega link_data (config de anuncio de IMAGEM: pagina + URL + CTA). Use um molde de IMAGEM (creative_estado_graph.serve_de_molde_imagem=true), nao um de video.',
  'Nao emiti o card porque o estado Graph do molde (serve_de_molde_imagem) ainda nao foi coletado. Aguarde a coleta diaria ou rode meta-campaign-status.',
  'meta_image_hash',
  1,
  true,
  'meta-actions montarCriacao v5.9 (link_data); coleta meta-campaign-status v13'
where not exists (
  select 1 from public.contrato_de_estado_execucao
   where acao='criar_anuncio_a_partir_de' and propriedade='molde_serve_de_imagem' and vigente
);

update public.contrato_de_estado_execucao
   set condicao_campo_pedido = 'drive_file_id,meta_video_id,meta_image_hash'
 where acao = 'criar_anuncio_a_partir_de'
   and propriedade in ('molde_expoe_page_id', 'molde_expoe_link_destino')
   and vigente;

-- ============================================================================
-- 4 - CONTRATO: meta_image_hash SUPORTADO
-- ============================================================================
update public.contrato_de_execucao
   set suportado = true,
       observacao = 'FOTO (imagem ja na biblioteca da conta via meta_image_hash). Rota PECA NOVA DE IMAGEM: copia object_story_spec.link_data do molde e troca image_hash. Exige molde com serve_de_molde_imagem. Upload novo: edge upload-midia → Graph adimages (nao Pipeboard). Mutuamente exclusivo com meta_video_id.',
       fonte = 'meta-actions montarCriacao v5.9; pipeboard argsCreativeDeGraph (image_hash); upload-midia/adimages'
 where acao = 'criar_anuncio_a_partir_de'
   and campo = 'meta_image_hash'
   and vigente;

-- ============================================================================
-- 5 - peca_bloqueada resolve image_hash
-- ============================================================================
-- Remove a assinatura de 3 args: com a de 4 args (default null) convivendo, o Postgres
-- nao resolve chamadas de 3 args (erro 42725 function is not unique).
drop function if exists public.peca_bloqueada_por_revisao(uuid, text, text);

create or replace function public.peca_bloqueada_por_revisao(
  p_company_id uuid,
  p_drive_file_id text default null,
  p_meta_video_id text default null,
  p_meta_image_hash text default null
)
returns jsonb
language plpgsql
stable security definer
set search_path to 'public'
as $function$
declare
  v_drive text := nullif(trim(coalesce(p_drive_file_id,'')),'');
  v_video text := nullif(trim(coalesce(p_meta_video_id,'')),'');
  v_img text := nullif(trim(coalesce(p_meta_image_hash,'')),'');
  rev record;
  v_pendente uuid;
begin
  if v_drive is null and v_video is not null then
    select m.drive_file_id into v_drive
      from public.media_uploads m
     where m.company_id = p_company_id
       and m.meta_video_id = v_video
       and m.drive_file_id is not null
     order by m.enviado_em desc nulls last
     limit 1;
  end if;

  if v_drive is null and v_img is not null then
    select m.drive_file_id into v_drive
      from public.media_uploads m
     where m.company_id = p_company_id
       and m.meta_image_hash = v_img
       and m.drive_file_id is not null
     order by m.enviado_em desc nulls last
     limit 1;
  end if;

  if v_drive is null then
    return jsonb_build_object('bloqueada', false, 'peca_identificada', false);
  end if;

  select * into rev
    from public.pecas_em_revisao
   where company_id = p_company_id
     and drive_file_id = v_drive
     and bloqueia_uso is true
   order by aberto_em desc
   limit 1;

  if not found then
    return jsonb_build_object('bloqueada', false, 'peca_identificada', true, 'drive_file_id', v_drive);
  end if;

  select a.id into v_pendente
    from public.approval_requests a
   where a.company_id = p_company_id
     and a.action = 'registrar_veredito_peca'
     and a.status = 'pending'
     and a.payload->>'peca_id' = rev.id::text
   limit 1;

  return jsonb_build_object(
    'bloqueada', true, 'peca_identificada', true, 'drive_file_id', v_drive,
    'nome', rev.nome, 'motivo', rev.motivo, 'regra_code', rev.regra_code,
    'aberto_em', rev.aberto_em, 'aberto_por', rev.aberto_por,
    'veredito', rev.veredito, 'veredito_em', rev.veredito_em, 'veredito_por', rev.veredito_por,
    'veredito_nota', rev.veredito_nota,
    'proposta_de_veredito_pendente', v_pendente,
    'mensagem', case
      when rev.veredito is null then
        'IMPEDIMENTO: a peca ' || coalesce(rev.nome, v_drive) ||
        ' esta EM REVISAO DE COMPLIANCE e marcada para nao ser usada ate haver veredito' ||
        case when rev.regra_code is not null then ' (regra ' || rev.regra_code || ')' else '' end ||
        '. Aberta em ' || to_char(rev.aberto_em,'DD/MM/YYYY') || ' por ' || coalesce(rev.aberto_por,'?') ||
        '. Motivo: ' || coalesce(rev.motivo,'nao registrado') ||
        ' Isto NAO e ressalva para o gestor decidir no card de anuncio: enquanto nao houver veredito,' ||
        ' a peca nao vai para anuncio.' ||
        case when v_pendente is not null
          then ' JA EXISTE proposta de veredito aguardando decisao do administrador (card ' || left(v_pendente::text,8) || '): proposta NAO libera nada.'
          else ' Voce pode PROPOR um veredito com registrar_veredito_peca_em_revisao - isso emite um card que so o administrador aprova. Voce nao decide isso.' end
      else
        'IMPEDIMENTO: a peca ' || coalesce(rev.nome, v_drive) ||
        ' tem veredito ' || rev.veredito || ' (em ' || to_char(rev.veredito_em,'DD/MM/YYYY') ||
        ' por ' || coalesce(rev.veredito_por,'?') || ') e permanece bloqueada para anuncio.' ||
        case when rev.regra_code is not null then ' Regra: ' || rev.regra_code || '.' else '' end ||
        ' Motivo: ' || coalesce(rev.motivo,'nao registrado') ||
        case when rev.veredito_nota is not null then ' Nota do veredito: ' || rev.veredito_nota else '' end
    end);
end;
$function$;

-- ============================================================================
-- 6 - AVISOS SENSIVEIS AO FORMATO + midia imagem no gate de emissao
-- ============================================================================
-- Patch pontual de pedido_de_anuncio_completo_sem_estado_destino: incluiz helper
-- que o wrapper consulta. Em vez de reescrever a funcao gigante, o wrapper
-- pedido_de_anuncio_completo passa a:
--   a) recusar meta_image_hash+meta_video_id juntos
--   b) aceitar pedido de imagem (contrato ja suportado)
--   c) avisos por formato
--
-- A inferencia de tipo_de_pedido com so meta_image_hash exige v_midia incluir o hash.
-- Aplicamos um replace focado via nova versao minima do trecho critico usando
-- create or replace da funcao completa gerada a partir da vigente + diffs.

create or replace function public.pedido_de_anuncio_completo(p_company_id uuid, p_pedido jsonb)
returns jsonb
language plpgsql
stable security definer
set search_path to 'public'
as $function$
declare
  v_base jsonb;
  v_estado jsonb;
  v_molde text;
  v_dest jsonb;
  v_msg text;
  v_serve_v boolean;
  v_serve_i boolean;
  v_ig boolean;
  v_tem_video boolean;
  v_tem_img boolean;
  v_bloq jsonb;
  v_pedido jsonb := coalesce(p_pedido, '{}'::jsonb);
begin
  v_tem_video := public.campo_presente_no_pedido(v_pedido, 'meta_video_id');
  v_tem_img := public.campo_presente_no_pedido(v_pedido, 'meta_image_hash');

  if v_tem_video and v_tem_img then
    return jsonb_build_object(
      'completo', false,
      'recusa', 'formatos_de_midia_conflitantes',
      'faltando', '[]'::jsonb,
      'mensagem_para_o_gestor',
        'Nao emiti o card: o pedido traz meta_video_id E meta_image_hash. Um anuncio avulso e de um formato so (video ou imagem). Remova um dos dois.');
  end if;

  if v_tem_img and not v_tem_video
     and nullif(btrim(coalesce(v_pedido->>'tipo_de_pedido','')),'') is null then
    v_pedido := v_pedido || jsonb_build_object('tipo_de_pedido', 'peca_nova');
  end if;

  v_base := public.pedido_de_anuncio_completo_sem_estado_destino(p_company_id, v_pedido);

  if coalesce((v_base->>'completo')::boolean, false) is not true
     and v_tem_img
     and not v_tem_video
     and coalesce(v_base->>'recusa','') not in ('carrossel_nao_suportado','campo_nao_suportado','formatos_de_midia_conflitantes')
     and exists (
           select 1 from jsonb_array_elements_text(coalesce(v_base->'faltando','[]'::jsonb)) f
            where f like '%peca criativa%'
         )
  then
    if nullif(btrim(coalesce(v_pedido->>'nome_novo','')),'') is not null
       and coalesce(
             nullif(btrim(coalesce(v_pedido->>'conjunto_destino_external_id','')),''),
             nullif(btrim(coalesce(v_pedido->>'conjunto_destino','')),'')
           ) is not null
       and nullif(btrim(coalesce(v_pedido->>'conta_destino','')),'') is not null
       and coalesce(
             nullif(btrim(coalesce(v_pedido->>'creative_id','')),''),
             nullif(btrim(coalesce(v_pedido->>'molde','')),''),
             nullif(btrim(coalesce(v_pedido->>'molde_creative_id','')),'')
           ) is not null
       and nullif(btrim(coalesce(v_pedido->>'legenda','')),'') is not null
       and nullif(btrim(coalesce(v_pedido->>'legenda_fonte','')),'') in ('humano','herdada_do_molde','agente')
    then
      v_bloq := public.peca_bloqueada_por_revisao(
        p_company_id,
        nullif(btrim(coalesce(v_pedido->>'drive_file_id','')),''),
        null,
        nullif(btrim(coalesce(v_pedido->>'meta_image_hash','')),'')
      );
      if coalesce((v_bloq->>'bloqueada')::boolean, false) then
        return jsonb_build_object(
          'completo', false,
          'tipo_de_pedido', 'peca_nova',
          'recusa', 'peca_em_revisao_bloqueia_uso',
          'faltando', to_jsonb(array['o veredito do responsavel sobre esta peca, que esta em revisao de compliance e marcada para nao ser usada']),
          'peca_em_revisao', v_bloq,
          'mensagem_para_o_gestor', coalesce(v_bloq->>'mensagem', 'Peca bloqueada por revisao de compliance.'));
      end if;
      v_base := jsonb_build_object(
        'completo', true,
        'tipo_de_pedido', 'peca_nova',
        'legenda_fonte', v_pedido->>'legenda_fonte',
        'conjunto_destino_external_id', coalesce(v_pedido->>'conjunto_destino_external_id', v_pedido->>'conjunto_destino'),
        'conta_destino', v_pedido->>'conta_destino',
        'creative_id', coalesce(v_pedido->>'creative_id', v_pedido->>'molde', v_pedido->>'molde_creative_id'),
        'meta_image_hash', v_pedido->>'meta_image_hash',
        'formato', 'imagem',
        'mensagem_para_o_gestor',
          'Pedido de PECA NOVA DE IMAGEM (meta_image_hash). A legenda passa pelo compliance de texto. O molde fornece page_id, URL e CTA via link_data; a imagem e a do hash informado (ja na biblioteca da conta via upload-midia/adimages).'
      );
    end if;
  end if;

  if coalesce((v_base->>'completo')::boolean, false) is not true then
    return v_base;
  end if;

  v_estado := public.avaliar_estado_destino_execucao(
    'criar_anuncio_a_partir_de', v_pedido, p_company_id);
  if coalesce((v_estado->>'valido')::boolean, true) is not true then
    return v_base || jsonb_build_object(
      'completo', false,
      'recusa', v_estado->>'recusa',
      'estado_destino', v_estado,
      'faltando', '[]'::jsonb,
      'mensagem_para_o_gestor', v_estado->>'mensagem');
  end if;

  v_molde := coalesce(
    nullif(btrim(coalesce(v_pedido->>'creative_id', '')), ''),
    nullif(btrim(coalesce(v_pedido->>'molde', '')), ''),
    nullif(btrim(coalesce(v_pedido->>'molde_creative_id', '')), ''));
  -- Destino por PRODUTO (credito CLT etc.), nao por dominio — preserva
  -- resolver_destino_do_anuncio do agente paralelo (20260811174831).
  v_dest := public.resolver_destino_do_anuncio(p_company_id, v_pedido, null);

  v_msg := coalesce(v_base->>'mensagem_para_o_gestor', '');
  if coalesce(v_dest->>'mensagem','') <> '' then
    v_msg := v_msg || ' DESTINO: ' || (v_dest->>'mensagem');
  end if;

  select serve_de_molde_video, serve_de_molde_imagem, expoe_instagram_actor
    into v_serve_v, v_serve_i, v_ig
    from public.creative_estado_graph
   where creative_id = v_molde
   limit 1;

  -- Avisos SENSIVEIS AO FORMATO do pedido (nao fixos em video).
  if v_tem_video or (not v_tem_img and coalesce(v_serve_v, false)) then
    v_msg := v_msg
      || ' VEICULACAO: este anuncio e de VIDEO. A Coluna da direita do Facebook nao veicula'
      || ' video (exige imagem, de qualquer proporcao ou tamanho), entao esse posicionamento'
      || ' NAO sera entregue - nao adianta trocar por um video menor ou mais estreito, e regra'
      || ' do posicionamento. Os demais posicionamentos seguem normalmente.';
  elsif v_tem_img or coalesce(v_serve_i, false) then
    v_msg := v_msg
      || ' VEICULACAO: este anuncio e de IMAGEM. A Coluna da direita do Facebook ACEITA imagem'
      || ' - esse posicionamento pode veicular (diferente do anuncio de video).';
  end if;

  if v_ig is not null and v_ig is false then
    v_msg := v_msg
      || ' IDENTIDADE: o molde escolhido nao carrega identidade Instagram (instagram_user_id'
      || ' no object_story_spec), entao o anuncio nascera SEM identidade Instagram/Threads e'
      || ' esses posicionamentos (Instagram e Threads) nao veiculam. Para veicular neles,'
      || ' escolha um molde que exponha a identidade ou configure a identidade no Gerenciador.';
  end if;

  return v_base || jsonb_build_object(
    'estado_destino', v_estado,
    'destino_do_anuncio', v_dest,
    'avisos_de_veiculacao_derivados', jsonb_build_object(
      'formato', case when v_tem_img then 'imagem' when v_tem_video then 'video' else 'desconhecido' end,
      'video_coluna_direita_fora', (v_tem_video or (not v_tem_img and coalesce(v_serve_v, false))),
      'imagem_coluna_direita_ok', (v_tem_img or coalesce(v_serve_i, false)),
      'sem_identidade_instagram_threads', (v_ig is not null and v_ig is false)),
    'mensagem_para_o_gestor', v_msg);
end;
$function$;

-- Fato agente
insert into public.agent_context (company_id, categoria, fato, vigente)
select 'ded20b38-f42e-4c71-800c-31b97ea48bcf'::uuid,
       'criacao',
       'PECA NOVA DE IMAGEM (11/08/2026): use meta_image_hash (imagem JA na biblioteca Meta) + molde com serve_de_molde_imagem=true (link_data). NAO use meta_video_id no mesmo pedido. Carrossel continua recusado. Upload de imagem do Drive: chame upload-midia (Graph adimages) ANTES - Pipeboard nao sobe imagem; hoje o acervo tem imagens no Drive mas 0 meta_image_hash. Video e imagem sao formatos distintos: molde de video nao serve para peca de imagem e vice-versa. Veiculacao: imagem PODE ir na Coluna da direita; video NAO.',
       true
where not exists (
  select 1 from public.agent_context
   where company_id = 'ded20b38-f42e-4c71-800c-31b97ea48bcf'
     and fato like 'PECA NOVA DE IMAGEM (11/08/2026):%'
     and vigente
);

do $$
begin
  if not exists (
    select 1 from information_schema.columns
     where table_schema='public' and table_name='creative_estado_graph' and column_name='serve_de_molde_imagem'
  ) then
    raise exception 'serve_de_molde_imagem deveria existir';
  end if;
end $$;
