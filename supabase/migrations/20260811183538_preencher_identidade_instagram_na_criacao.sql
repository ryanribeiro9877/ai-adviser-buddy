-- IDENTIDADE INSTAGRAM NA CRIACAO (11/08/2026)
--
-- Decisao do Ryan: usar 17841428674060566 (@legaleviver) como identidade da Legal e Viver.
-- Procedencia honesta: id observado DIRETAMENTE em dois criativos reais da pagina
-- 1095196357012756 (986920170834987 e 1592433379256099), ambos com
-- object_story_spec.instagram_user_id e creative_estado_graph.expoe_instagram_actor=true.
-- O endpoint autenticado da Pagina NAO confirmou o vinculo porque o token usado nao possui
-- pages_read_engagement. Isso nao e escondido nem promovido a confirmacao.
--
-- Ordem de resolucao:
--   1) instagram_actor_id observado no MOLDE em creative_estado_graph;
--   2) configuracao da EMPRESA em meta_execution_config;
--   3) sem fonte: null (fail-safe; nenhum id e inventado).

alter table public.meta_execution_config
  add column if not exists instagram_actor_id text,
  add column if not exists instagram_handle text,
  add column if not exists instagram_identity_page_id text,
  add column if not exists instagram_identity_provenance text,
  add column if not exists instagram_identity_page_link_confirmed boolean;

comment on column public.meta_execution_config.instagram_actor_id is
  'Identidade Instagram usada na criacao quando o molde nao expoe uma. Config por empresa; trocar aqui dispensa redeploy.';
comment on column public.meta_execution_config.instagram_identity_provenance is
  'Procedencia verificavel do id. Nao confundir observacao em criativos com confirmacao por endpoint da Pagina.';
comment on column public.meta_execution_config.instagram_identity_page_link_confirmed is
  'true somente se endpoint autenticado da Pagina confirmou o vinculo. false para a LEV: token sem pages_read_engagement.';

alter table public.meta_execution_config
  drop constraint if exists meta_execution_config_instagram_actor_id_digits;
alter table public.meta_execution_config
  add constraint meta_execution_config_instagram_actor_id_digits
  check (instagram_actor_id is null or instagram_actor_id ~ '^[0-9]+$');

update public.meta_execution_config
   set instagram_actor_id = '17841428674060566',
       instagram_handle = '@legaleviver',
       instagram_identity_page_id = '1095196357012756',
       instagram_identity_provenance =
         'Decisao de Ryan em 11/08/2026. ID observado diretamente em creative_estado_graph nos creatives 986920170834987 e 1592433379256099, ambos com object_story_spec.instagram_user_id=17841428674060566 e page_id=1095196357012756. O endpoint autenticado da Pagina nao confirmou o vinculo porque o token nao possui pages_read_engagement.',
       instagram_identity_page_link_confirmed = false,
       updated_at = now()
 where company_id = 'ded20b38-f42e-4c71-800c-31b97ea48bcf'::uuid;

create or replace function public.identidade_instagram_para_criacao(
  p_company_id uuid,
  p_creative_id text
)
returns jsonb
language plpgsql
stable security definer
set search_path to 'public'
as $function$
declare
  v_id text;
  v_handle text;
  v_procedencia text;
  v_confirmado boolean;
begin
  -- Fonte 1: o proprio molde observado. E a mais fiel ao criativo reutilizado.
  select nullif(btrim(c.instagram_actor_id), '')
    into v_id
    from public.creative_estado_graph c
   where c.creative_id = nullif(btrim(coalesce(p_creative_id, '')), '')
   limit 1;

  if v_id is not null then
    select case when m.instagram_actor_id = v_id then m.instagram_handle end,
           case when m.instagram_actor_id = v_id then m.instagram_identity_provenance end,
           case when m.instagram_actor_id = v_id then m.instagram_identity_page_link_confirmed end
      into v_handle, v_procedencia, v_confirmado
      from public.meta_execution_config m
     where m.company_id = p_company_id
     limit 1;
    return jsonb_build_object(
      'encontrada', true,
      'instagram_actor_id', v_id,
      'instagram_handle', v_handle,
      'fonte', 'molde_creative_estado_graph',
      'procedencia', coalesce(v_procedencia,
        'instagram_actor_id observado diretamente no creative_estado_graph do molde'),
      'vinculo_pagina_confirmado', v_confirmado);
  end if;

  -- Fonte 2: config da empresa. Ausencia permanece ausencia; nao existe default global.
  select nullif(btrim(m.instagram_actor_id), ''),
         nullif(btrim(m.instagram_handle), ''),
         nullif(btrim(m.instagram_identity_provenance), ''),
         m.instagram_identity_page_link_confirmed
    into v_id, v_handle, v_procedencia, v_confirmado
    from public.meta_execution_config m
   where m.company_id = p_company_id
   limit 1;

  if v_id is not null then
    return jsonb_build_object(
      'encontrada', true,
      'instagram_actor_id', v_id,
      'instagram_handle', v_handle,
      'fonte', 'config_empresa',
      'procedencia', v_procedencia,
      'vinculo_pagina_confirmado', v_confirmado);
  end if;

  return jsonb_build_object(
    'encontrada', false,
    'instagram_actor_id', null,
    'instagram_handle', null,
    'fonte', null,
    'procedencia', null,
    'vinculo_pagina_confirmado', null);
end;
$function$;

revoke all on function public.identidade_instagram_para_criacao(uuid, text) from public, anon, authenticated;
grant execute on function public.identidade_instagram_para_criacao(uuid, text) to service_role;

-- O contrato declara a derivacao no campo que escolhe o molde; nao transforma instagram_user_id
-- em entrada livre do pedido (isso permitiria ao caller sobrescrever a identidade da empresa).
update public.contrato_de_execucao
   set observacao = observacao ||
       ' IDENTIDADE INSTAGRAM DERIVADA: na peca nova, o executor resolve instagram_user_id primeiro de creative_estado_graph.instagram_actor_id deste molde e, se ausente, de meta_execution_config.instagram_actor_id da empresa. O caller nao fornece nem sobrescreve esse id.',
       fonte = 'meta-actions montarCriacao v5.11 + identidade_instagram_para_criacao + creative_estado_graph + meta_execution_config'
 where acao = 'criar_anuncio_a_partir_de'
   and campo = 'creative_id'
   and vigente
   and observacao not like '%IDENTIDADE INSTAGRAM DERIVADA:%';

-- drive_file_id identifica tanto video quanto imagem. Depois que imagens reais passaram a ser
-- registradas em media_uploads, usa-lo como condicao da regra de VIDEO fazia imagem+drive_file_id
-- cair em molde_sem_video_data. O discriminador de formato e meta_video_id.
update public.contrato_de_estado_execucao
   set condicao_campo_pedido = 'meta_video_id'
 where acao = 'criar_anuncio_a_partir_de'
   and propriedade = 'molde_expoe_video_data'
   and vigente;

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
  v_ident jsonb;
  v_tem_video boolean;
  v_tem_img boolean;
  v_bloq jsonb;
  v_pedido jsonb := coalesce(p_pedido, '{}'::jsonb);
begin
  v_tem_video := public.campo_presente_no_pedido(v_pedido, 'meta_video_id');
  v_tem_img := public.campo_presente_no_pedido(v_pedido, 'meta_image_hash');

  if v_tem_video and v_tem_img then
    return jsonb_build_object(
      'completo', false, 'recusa', 'formatos_de_midia_conflitantes', 'faltando', '[]'::jsonb,
      'mensagem_para_o_gestor',
        'Nao emiti o card: o pedido traz meta_video_id E meta_image_hash. Um anuncio avulso e de um formato so (video ou imagem). Remova um dos dois.');
  end if;

  if v_tem_img and not v_tem_video
     and nullif(btrim(coalesce(v_pedido->>'tipo_de_pedido','')),'') is null then
    v_pedido := v_pedido || jsonb_build_object('tipo_de_pedido', 'peca_nova');
  end if;

  v_base := public.pedido_de_anuncio_completo_sem_estado_destino(p_company_id, v_pedido);

  if coalesce((v_base->>'completo')::boolean, false) is not true
     and v_tem_img and not v_tem_video
     and coalesce(v_base->>'recusa','') not in ('carrossel_nao_suportado','campo_nao_suportado','formatos_de_midia_conflitantes')
     and exists (
       select 1 from jsonb_array_elements_text(coalesce(v_base->'faltando','[]'::jsonb)) f
        where f like '%peca criativa%'
           or f like '%peca enviada para a biblioteca%')
     and exists (
       select 1
         from public.media_uploads m
        where m.company_id = p_company_id
          and m.meta_image_hash = nullif(btrim(coalesce(v_pedido->>'meta_image_hash','')),'')
          and m.status = 'enviado')
  then
    if nullif(btrim(coalesce(v_pedido->>'nome_novo','')),'') is not null
       and coalesce(nullif(btrim(coalesce(v_pedido->>'conjunto_destino_external_id','')),''),
                    nullif(btrim(coalesce(v_pedido->>'conjunto_destino','')),'')) is not null
       and nullif(btrim(coalesce(v_pedido->>'conta_destino','')),'') is not null
       and coalesce(nullif(btrim(coalesce(v_pedido->>'creative_id','')),''),
                    nullif(btrim(coalesce(v_pedido->>'molde','')),''),
                    nullif(btrim(coalesce(v_pedido->>'molde_creative_id','')),'')) is not null
       and nullif(btrim(coalesce(v_pedido->>'legenda','')),'') is not null
       and nullif(btrim(coalesce(v_pedido->>'legenda_fonte','')),'') in ('humano','herdada_do_molde','agente')
    then
      v_bloq := public.peca_bloqueada_por_revisao(
        p_company_id,
        nullif(btrim(coalesce(v_pedido->>'drive_file_id','')),''),
        null,
        nullif(btrim(coalesce(v_pedido->>'meta_image_hash','')),''));
      if coalesce((v_bloq->>'bloqueada')::boolean, false) then
        return jsonb_build_object(
          'completo', false, 'tipo_de_pedido', 'peca_nova',
          'recusa', 'peca_em_revisao_bloqueia_uso',
          'faltando', to_jsonb(array['o veredito do responsavel sobre esta peca, que esta em revisao de compliance e marcada para nao ser usada']),
          'peca_em_revisao', v_bloq,
          'mensagem_para_o_gestor', coalesce(v_bloq->>'mensagem', 'Peca bloqueada por revisao de compliance.'));
      end if;
      v_base := jsonb_build_object(
        'completo', true, 'tipo_de_pedido', 'peca_nova',
        'legenda_fonte', v_pedido->>'legenda_fonte',
        'conjunto_destino_external_id', coalesce(v_pedido->>'conjunto_destino_external_id', v_pedido->>'conjunto_destino'),
        'conta_destino', v_pedido->>'conta_destino',
        'creative_id', coalesce(v_pedido->>'creative_id', v_pedido->>'molde', v_pedido->>'molde_creative_id'),
        'meta_image_hash', v_pedido->>'meta_image_hash',
        'formato', 'imagem',
        'mensagem_para_o_gestor',
          'Pedido de PECA NOVA DE IMAGEM (meta_image_hash). A legenda passa pelo compliance de texto. O molde fornece page_id, URL e CTA via link_data; a imagem e a do hash informado (ja na biblioteca da conta via upload-midia/adimages).');
    end if;
  end if;

  if coalesce((v_base->>'completo')::boolean, false) is not true then return v_base; end if;

  v_estado := public.avaliar_estado_destino_execucao(
    'criar_anuncio_a_partir_de', v_pedido, p_company_id);
  if coalesce((v_estado->>'valido')::boolean, true) is not true then
    return v_base || jsonb_build_object(
      'completo', false, 'recusa', v_estado->>'recusa', 'estado_destino', v_estado,
      'faltando', '[]'::jsonb, 'mensagem_para_o_gestor', v_estado->>'mensagem');
  end if;

  v_molde := coalesce(
    nullif(btrim(coalesce(v_pedido->>'creative_id', '')), ''),
    nullif(btrim(coalesce(v_pedido->>'molde', '')), ''),
    nullif(btrim(coalesce(v_pedido->>'molde_creative_id', '')), ''));
  v_dest := public.resolver_destino_do_anuncio(p_company_id, v_pedido, null);
  v_ident := public.identidade_instagram_para_criacao(p_company_id, v_molde);

  v_msg := coalesce(v_base->>'mensagem_para_o_gestor', '');
  if coalesce(v_dest->>'mensagem','') <> '' then
    v_msg := v_msg || ' DESTINO: ' || (v_dest->>'mensagem');
  end if;

  select serve_de_molde_video, serve_de_molde_imagem
    into v_serve_v, v_serve_i
    from public.creative_estado_graph
   where creative_id = v_molde
   limit 1;

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

  if coalesce((v_ident->>'encontrada')::boolean, false) then
    v_msg := v_msg
      || ' IDENTIDADE: o anuncio nascera COM identidade Instagram '
      || coalesce(nullif(v_ident->>'instagram_handle',''), '(perfil sem handle configurado)')
      || ', id ' || (v_ident->>'instagram_actor_id')
      || ', fonte ' || (v_ident->>'fonte')
      || '. Instagram e Threads passam a ser posicionamentos elegiveis; a entrega final ainda'
      || ' depende das demais regras da Meta. Procedencia: id observado em criativos reais;'
      || ' o vinculo com a Pagina nao foi confirmado por endpoint autenticado (token sem pages_read_engagement).';
  else
    v_msg := v_msg
      || ' IDENTIDADE: nem o molde nem a configuracao da empresa fornecem instagram_user_id.'
      || ' O anuncio nascera SEM identidade Instagram/Threads e esses posicionamentos nao'
      || ' veiculam. Nenhum id foi inventado.';
  end if;

  return v_base || jsonb_build_object(
    'estado_destino', v_estado,
    'destino_do_anuncio', v_dest,
    'identidade_instagram_resolvida', v_ident,
    'avisos_de_veiculacao_derivados', jsonb_build_object(
      'formato', case when v_tem_img then 'imagem' when v_tem_video then 'video' else 'desconhecido' end,
      'video_coluna_direita_fora', (v_tem_video or (not v_tem_img and coalesce(v_serve_v, false))),
      'imagem_coluna_direita_ok', (v_tem_img or coalesce(v_serve_i, false)),
      'identidade_instagram_preenchida', coalesce((v_ident->>'encontrada')::boolean, false),
      'instagram_actor_id', v_ident->>'instagram_actor_id',
      'fonte_identidade_instagram', v_ident->>'fonte',
      'sem_identidade_instagram_threads', not coalesce((v_ident->>'encontrada')::boolean, false)),
    'mensagem_para_o_gestor', v_msg);
end;
$function$;

-- Fatos antigos afirmavam que os anuncios necessariamente nasceriam sem identidade.
update public.agent_context
   set vigente = false
 where company_id = 'ded20b38-f42e-4c71-800c-31b97ea48bcf'::uuid
   and vigente
   and id in (105, 107);

insert into public.agent_context (company_id, categoria, fato, vigente)
select 'ded20b38-f42e-4c71-800c-31b97ea48bcf'::uuid,
       'criacao',
       'IDENTIDADE INSTAGRAM NA CRIACAO (11/08/2026): peca nova de VIDEO ou IMAGEM preenche object_story_spec.instagram_user_id. Ordem: (1) creative_estado_graph.instagram_actor_id do molde; (2) meta_execution_config.instagram_actor_id da empresa; (3) sem ambas, nenhum id e inventado e o card avisa SEM identidade. Legal e Viver configura 17841428674060566 (@legaleviver), decisao do Ryan, observado diretamente nos creatives 986920170834987 e 1592433379256099 da pagina 1095196357012756. Ressalva obrigatoria: endpoint autenticado da Pagina nao confirmou o vinculo porque o token nao possui pages_read_engagement. Com identidade preenchida, Instagram/Threads ficam elegiveis; nao prometer entrega, que depende das demais regras da Meta.',
       true
where not exists (
  select 1 from public.agent_context
   where company_id = 'ded20b38-f42e-4c71-800c-31b97ea48bcf'::uuid
     and vigente
     and fato like 'IDENTIDADE INSTAGRAM NA CRIACAO (11/08/2026):%');

-- Provas estruturais: molde observado vence config; empresa sem config continua sem fonte.
do $$
declare v jsonb;
begin
  v := public.identidade_instagram_para_criacao(
    'ded20b38-f42e-4c71-800c-31b97ea48bcf'::uuid, '986920170834987');
  if v->>'instagram_actor_id' <> '17841428674060566'
     or v->>'fonte' <> 'molde_creative_estado_graph' then
    raise exception 'identidade do molde nao venceu a config: %', v;
  end if;

  v := public.identidade_instagram_para_criacao(
    'ded20b38-f42e-4c71-800c-31b97ea48bcf'::uuid, '1006811811912419');
  if v->>'instagram_actor_id' <> '17841428674060566'
     or v->>'fonte' <> 'config_empresa' then
    raise exception 'fallback da config da empresa nao funcionou: %', v;
  end if;

  v := public.identidade_instagram_para_criacao(
    '307849e6-78a7-4217-8112-3fb0a924f988'::uuid, 'creative_inexistente');
  if coalesce((v->>'encontrada')::boolean, true) then
    raise exception 'empresa sem fonte recebeu identidade inventada: %', v;
  end if;
end $$;
