-- Identidade Instagram oficial = id exposto pelo Business, e a CONFIG prevalece sobre o molde.
-- (Decisao de Ryan, 11/08/2026.)
--
-- DIAGNOSTICO COM PROVA (sonda meta-identity-probe + creative_estado_graph, 11/08):
--   - O anuncio real 120254415116200191 (creative 2578056329302852), criado pelo NOSSO caminho
--     as 20:33 (DEPOIS do deploy meta-actions v53 as 18:38), teve o creative montado com
--     instagram_user_id = 17841428674060566 e a Meta ACEITOU/GRAVOU o id
--     (creative_estado_graph.chaves_do_spec passou a conter instagram_user_id, expoe_instagram_actor=true).
--     Mesmo assim a previa manteve o aviso de Threads. Logo: nao foi (a) anuncio antigo, nao foi
--     (b) montagem manual do Ryan - foi (c) preenchemos um id que NAO e identidade valida para
--     Threads nessa conta/Business.
--   - A sonda confirmou o id CORRETO: business_id 3109716642547310 devolve 17841423949227215
--     (@legaleviver_) tanto em owned_instagram_accounts quanto em instagram_accounts; o no
--     /17841423949227215 resolve para "Legal e Viver" (@legaleviver_). O id antigo
--     17841428674060566 NAO aparece na lista owned do Business.
--   - Ressalva honesta: o vinculo com a Pagina 1095196357012756 nao foi confirmado por endpoint
--     autenticado da Pagina (token sem pages_read_engagement) para NENHUM dos dois ids. A prova
--     que temos e a exposicao pelo Business, que e exatamente a condicao que o Ryan pediu.
--
-- O QUE MUDA:
--   1) meta_execution_config passa a guardar o id oficial 17841423949227215 (@legaleviver_),
--      substituindo 17841428674060566, com procedencia. Continua lido de config (reversivel, sem redeploy).
--   2) identidade_instagram_para_criacao inverte a prioridade: a CONFIG oficial da empresa PREVALECE;
--      o molde so e usado como FALLBACK quando a empresa nao tem identidade oficial. Justificativa:
--      os moldes antigos expoem o id desabilitado 17841428674060566; copiar do molde reinjetaria o
--      id velho. Ryan definiu a config como fonte oficial, entao ela vence.
--   3) A nota de identidade ao gestor (em pedido_de_anuncio_completo) passa a citar o id/handle
--      resolvidos (agora @legaleviver_ / 17841423949227215) com procedencia de Business.

-- 1) CONFIG OFICIAL --------------------------------------------------------------------------
update public.meta_execution_config
   set instagram_actor_id = '17841423949227215',
       instagram_handle = '@legaleviver_',
       instagram_identity_page_id = '1095196357012756',
       instagram_identity_provenance =
         'Decisao de Ryan em 11/08/2026: a identidade Instagram oficial e o id que o Business Manager expoe, '
         || '17841423949227215 (@legaleviver_). Confirmado pela sonda meta-identity-probe (11/08): business_id '
         || '3109716642547310 devolve esse id em owned_instagram_accounts E instagram_accounts; o no '
         || '/17841423949227215 resolve para "Legal e Viver" (@legaleviver_). SUBSTITUI o id anterior '
         || '17841428674060566, que foi observado em creatives reais mas NAO aparece na lista owned do Business e '
         || 'cujo preenchimento manteve o aviso de Threads na previa (id nao aceito como identidade valida). O '
         || 'vinculo com a Pagina 1095196357012756 nao foi confirmado por endpoint autenticado da Pagina porque o '
         || 'token nao tem pages_read_engagement.',
       instagram_identity_page_link_confirmed = false
 where company_id = 'ded20b38-f42e-4c71-800c-31b97ea48bcf';

-- 2) CONFIG PREVALECE SOBRE O MOLDE ----------------------------------------------------------
create or replace function public.identidade_instagram_para_criacao(p_company_id uuid, p_creative_id text)
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
  -- Fonte OFICIAL: config da empresa PREVALECE (decisao Ryan 11/08). Os moldes antigos expoem o id
  -- desabilitado 17841428674060566; copiar do molde reintroduziria o id velho e o aviso de Threads.
  -- Por isso a config vence: e a fonte oficial declarada pelo Ryan.
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

  -- Fallback: identidade observada no molde, SO quando a empresa nao tem identidade oficial em config.
  select nullif(btrim(c.instagram_actor_id), '')
    into v_id
    from public.creative_estado_graph c
   where c.creative_id = nullif(btrim(coalesce(p_creative_id, '')), '')
   limit 1;

  if v_id is not null then
    return jsonb_build_object(
      'encontrada', true,
      'instagram_actor_id', v_id,
      'instagram_handle', null,
      'fonte', 'molde_creative_estado_graph',
      'procedencia', 'instagram_actor_id observado no creative_estado_graph do molde '
        || '(fallback: a empresa nao tem identidade oficial em meta_execution_config)',
      'vinculo_pagina_confirmado', null);
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

-- 3) DOUTRINA ---------------------------------------------------------------------------------
update public.agent_context
   set vigente = false
 where categoria = 'identidade'
   and vigente = true
   and fato ilike '%17841428674060566%';

insert into public.agent_context (categoria, fato, vigente, desde)
values (
  'identidade',
  'IDENTIDADE INSTAGRAM OFICIAL = 17841423949227215 (@legaleviver_), o id que o Business Manager '
  || 'expoe (decisao de Ryan, 11/08/2026). SUBSTITUI o 17841428674060566, que estava configurado por '
  || 'nos: aquele id foi observado em creatives, a Meta ate o gravava no object_story_spec, mas NAO '
  || 'aparece na lista owned do Business e mantinha o aviso de Threads na previa (id nao aceito como '
  || 'identidade valida). Prova: sonda meta-identity-probe (business_id 3109716642547310) devolve '
  || '17841423949227215 em owned_instagram_accounts e instagram_accounts; o no resolve para "Legal e '
  || 'Viver"/@legaleviver_. REGRA DE PREFERENCIA: a config oficial (meta_execution_config) PREVALECE '
  || 'sobre a identidade herdada do molde - copiar do molde antigo reinjetaria o id velho, entao o '
  || 'molde so e fallback quando a empresa nao tem identidade oficial. O id e lido de config '
  || '(reversivel, sem redeploy). Ressalva: o vinculo com a Pagina 1095196357012756 nao foi confirmado '
  || 'por endpoint autenticado (token sem pages_read_engagement).',
  true,
  date '2026-08-11'
);

-- 4) NOTA AO GESTOR: procedencia coerente com a config oficial (nao mais "observado em criativos").
-- Reproduz pedido_de_anuncio_completo fielmente; muda APENAS a frase de procedencia da linha
-- IDENTIDADE. O id/handle/fonte ja eram interpolados de v_ident e agora mostram @legaleviver_ /
-- 17841423949227215 / config_empresa automaticamente.
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
      || ' depende das demais regras da Meta. Procedencia: id oficial exposto pelo Business'
      || ' (owned_instagram_accounts/instagram_accounts); o vinculo com a Pagina nao foi confirmado'
      || ' por endpoint autenticado (token sem pages_read_engagement).';
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
