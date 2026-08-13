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
  -- Destino por PRODUTO (credito CLT etc.), nao por dominio â€” preserva
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
