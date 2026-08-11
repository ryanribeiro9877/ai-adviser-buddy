-- PORTAO DO MOLDE: resolver o molde pelos MESMOS apelidos que o pedido aceita.
--
-- BURACO OBSERVADO (11/08/2026, sonda em pedido_de_anuncio_completo):
--   As regras de molde (molde_expoe_video_data, molde_serve_de_imagem, molde_expoe_page_id,
--   molde_expoe_link_destino) declaram campo_destino='creative_id'. Mas pedido_de_anuncio_completo
--   aceita o molde por TRES apelidos: creative_id, molde, molde_creative_id (v_molde faz coalesce
--   dos tres). Um pedido que nomeia o molde como 'molde' nao tinha 'creative_id' no jsonb, entao
--   avaliar_estado_destino_execucao caia em 'destino_ausente' e PULAVA todas as regras de molde -
--   o card saia completo=true sem que nenhuma condicao de molde tivesse sido verificada.
--
--   Evidencia: pedido de IMAGEM (meta_image_hash) apontando para um molde de VIDEO
--   (creative 1011059938579189) devolvia completo=true com {'propriedade':'molde_serve_de_imagem',
--   'avaliado':false,'motivo':'destino_ausente'}. O mesmo pedido com a chave 'creative_id' recusa
--   corretamente por nome: molde_sem_link_data.
--
--   O buraco e ANTIGO (vale igual para molde_expoe_video_data no caminho de video), mas so ficou
--   perigoso agora: com o caminho de imagem no ar, um pedido podia atravessar a emissao sem portao.
--   A executora ainda recusaria por nome em montarCriacao, mas o portao de emissao existe para o
--   card nao chegar ao gestor - recusa tardia nao e recusa no lugar certo.
--
-- CORRECAO: quando a regra aponta para 'creative_id' e o pedido nao traz essa chave, procurar o
-- molde em 'molde' e 'molde_creative_id' - os mesmos apelidos, na mesma ordem, que
-- pedido_de_anuncio_completo usa. Nada mais muda: is_dynamic_creative e campanha continuam
-- resolvendo pelo campo_destino declarado.

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

    -- Apelidos do molde: mesma ordem de coalesce que pedido_de_anuncio_completo usa.
    v_destino := coalesce(
      nullif(btrim(coalesce(p_pedido->>v_regra.campo_destino,'')),''),
      case when v_regra.campo_destino = 'creative_id'
           then coalesce(nullif(btrim(coalesce(p_pedido->>'molde','')),''),
                         nullif(btrim(coalesce(p_pedido->>'molde_creative_id','')),''))
      end,
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

-- Prova de que o portao passou a pegar o pedido que nomeia o molde como 'molde':
-- imagem apontando para molde de VIDEO precisa recusar por nome.
do $$
declare v jsonb; v_mold text;
begin
  select creative_id into v_mold from public.creative_estado_graph
   where serve_de_molde_video and not coalesce(serve_de_molde_imagem,false)
   order by creative_id limit 1;
  if v_mold is null then return; end if;

  v := public.avaliar_estado_destino_execucao('criar_anuncio_a_partir_de',
         jsonb_build_object('molde', v_mold, 'meta_image_hash', 'hash_de_sonda',
                            'conta_destino', 'act_3302001729967572'), null);
  if coalesce((v->>'valido')::boolean, true) is not false
     or coalesce(v->>'recusa','') <> 'molde_sem_link_data' then
    raise exception 'portao do molde nao recusou pedido de imagem com molde de video pelo apelido molde: %', v;
  end if;
end $$;
