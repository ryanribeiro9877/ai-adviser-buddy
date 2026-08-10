-- ESPELHO DE MIGRACAO APLICADA
-- version: 20260810221714
-- name: molde_os_quatro_pre_requisitos_na_ordem_da_executora
-- projeto: gzjwnjdpxpbmdhcyefvs (Gestor de Trafego IA)
-- aplicada por: Claude via MCP apply_migration
-- conferido contra supabase_migrations.schema_migrations por md5 - byte a byte igual ao banco

-- OS PRE-REQUISITOS DO MOLDE, TODOS, E NA ORDEM EM QUE A EXECUTORA OS COBRA.
--
-- POR QUE ESTA MIGRACAO EXISTE:
--   A migracao anterior trouxe para a emissao a recusa `molde_sem_video_data`, que derrubou
--   o card aprovado em 10/08 as 21:58. Ao conferir o criterio contra a executora
--   (meta-actions montarCriacao, rota de peca nova) apareceram DOIS VIZINHOS no mesmo
--   ponto do codigo, com exatamente o mesmo defeito de momento: molde_sem_page_id e
--   molde_sem_link_de_destino tambem so falam depois que o gestor aprovou.
--   Fechar so um membro da familia adiaria a mesma conversa para o proximo card.
--
-- POR QUE A ORDEM PRECISA SER DECLARADA:
--   Os quatro pre-requisitos sao ENCADEADOS: sem spec nao ha video_data; sem video_data nao
--   ha link, porque o link mora dentro dele. O portao devolve a PRIMEIRA recusa, e ate aqui
--   ele iterava por ordem alfabetica da propriedade. Em molde de FOTO (spec com page_id e
--   link_data, sem video_data), o alfabeto faria "link_destino" vir antes de "video_data" e
--   o gestor leria "o video_data do molde nao traz link" sobre um molde que nao tem video
--   nenhum - uma recusa correta com a explicacao errada, que e como se perde a confianca
--   numa mensagem de erro. A ordem passa a ser declarada na propria regra.

-- ============================================================================
-- 1 - OS OUTROS DOIS FATOS
-- ============================================================================
alter table public.creative_estado_graph
  add column if not exists expoe_page_id boolean,
  add column if not exists expoe_link_destino boolean;

comment on column public.creative_estado_graph.expoe_page_id is
  'true = o object_story_spec traz page_id. A Meta recusa adcreative sem pagina, e nao ha default seguro: publicar por outra pagina mudaria o emissor do anuncio.';
comment on column public.creative_estado_graph.expoe_link_destino is
  'true = o video_data do molde traz link de destino (em call_to_action.value.link ou link). LEIA JUNTO COM expoe_video_data: sem video_data nao existe link, e este campo fica false por consequencia - a ordem declarada em contrato_de_estado_execucao garante que a recusa de video_data fale primeiro nesse caso. A URL de destino nao vive em tabela nenhuma do sistema, so dentro do spec do molde.';

-- ============================================================================
-- 2 - A GRAVACAO ACEITA OS DOIS NOVOS SEM PERDER O CONTRATO
-- ============================================================================
-- Campo ausente no payload PRESERVA o valor anterior, como sempre. Isso vale inclusive para
-- a corrida que rodou entre esta migracao e o deploy da edge nova: ela nao manda os dois
-- campos, e nao deve por isso apaga-los.
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
      case when jsonb_typeof(x->'chaves_do_spec') = 'array'
           then array(select jsonb_array_elements_text(x->'chaves_do_spec'))
           else null end                               as chaves,
      nullif(btrim(x->>'fonte'), '')                   as fonte
    from jsonb_array_elements(p) x
    -- Os dois booleanos de base precisam ser leitura de fato. Valor que nao seja booleano
    -- fica de fora em vez de virar false por conveniencia.
    where jsonb_typeof(x->'expoe_object_story_spec') = 'boolean'
      and jsonb_typeof(x->'expoe_video_data') = 'boolean'
      and nullif(btrim(x->>'creative_id'), '') is not null
  ),
  -- A Graph pagina: o mesmo criativo pode chegar duas vezes no lote, e o ON CONFLICT
  -- recusa atualizar a mesma linha duas vezes no mesmo comando.
  unica as (
    select distinct on (creative_id) * from entrada order by creative_id
  ),
  gravada as (
    insert into public.creative_estado_graph as c
      (creative_id, account_id, expoe_object_story_spec, expoe_video_data,
       expoe_page_id, expoe_link_destino, chaves_do_spec, observado_em, fonte)
    select creative_id, account_id, expoe_spec, expoe_video, expoe_page, expoe_link, chaves, now(),
           coalesce(fonte, 'Graph fields=object_story_spec; coleta meta-campaign-status')
      from unica
    on conflict (creative_id) do update set
      account_id              = coalesce(excluded.account_id, c.account_id),
      expoe_object_story_spec = excluded.expoe_object_story_spec,
      expoe_video_data        = excluded.expoe_video_data,
      expoe_page_id           = coalesce(excluded.expoe_page_id, c.expoe_page_id),
      expoe_link_destino      = coalesce(excluded.expoe_link_destino, c.expoe_link_destino),
      chaves_do_spec          = coalesce(excluded.chaves_do_spec, c.chaves_do_spec),
      observado_em            = excluded.observado_em,
      fonte                   = excluded.fonte
    returning 1
  )
  select (select count(*) from gravada) into v_gravados;

  return jsonb_build_object(
    'recebidos', v_recebidos,
    'gravados', v_gravados,
    'nota', 'So grava criativo cuja leitura de object_story_spec chegou da Graph. '
         || 'Criativo sem resposta preserva o valor anterior: ausencia de leitura nao e leitura.'
  );
end
$function$;

-- ============================================================================
-- 3 - A ORDEM VIRA PARTE DO CONTRATO
-- ============================================================================
alter table public.contrato_de_estado_execucao
  add column if not exists ordem int;

comment on column public.contrato_de_estado_execucao.ordem is
  'Ordem em que a regra e avaliada. Existe porque pre-requisitos encadeados precisam falar na ordem da dependencia: o portao devolve a PRIMEIRA recusa, e a ordem alfabetica da propriedade produzia explicacao errada para recusa certa (molde de foto acusado de "video_data sem link"). Nulo cai por ultimo, mantendo o desempate antigo.';

update public.contrato_de_estado_execucao
   set ordem = 1
 where acao = 'criar_anuncio_a_partir_de' and propriedade = 'molde_expoe_video_data' and ordem is null;

-- ============================================================================
-- 4 - O PORTAO HONRA A ORDEM E APRENDE AS DUAS PROPRIEDADES
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
     -- A ordem declarada manda; sem ela, o desempate antigo. Ver comentario da coluna `ordem`.
     order by coalesce(ordem, 1000), campo_destino, propriedade
  loop
    -- Regra condicionada a campo(s) do pedido: ausentes todos, a regra nao se aplica.
    -- A condicao aceita uma LISTA separada por virgula, com semantica de QUALQUER UM. Isso
    -- existe porque a mesma propriedade pode ser exigida por rotas que nomeiam o pedido de
    -- formas diferentes - peca nova chega como drive_file_id OU como meta_video_id - e a
    -- tabela so admite uma regra vigente por (acao, campo_destino, propriedade). Condicao
    -- com um nome so nao tem virgula e se comporta exatamente como antes.
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
      -- CONHECIMENTO SO VALE COM PROCEDENCIA. config_coletada_em nulo = a configuracao nunca foi
      -- lida na Graph, e daily_budget pode ser o default fabricado pelo espelho da executora - foi
      -- exatamente o caso desta campanha, que ficou com "0" no espelho enquanto a Meta tinha 1000.
      -- Sem coleta, o estado e DESCONHECIDO e falha fechado.
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
      -- O molde e um CRIATIVO, nao um anuncio: o pedido aponta para creative_id e o mesmo
      -- criativo pode servir a varios anuncios. Linha ausente = nunca verificado = fecha.
      select case v_regra.propriedade
               when 'molde_expoe_video_data'   then k.expoe_video_data
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

-- ============================================================================
-- 5 - AS DUAS REGRAS QUE FALTAVAM, COM OS NOMES DA EXECUTORA
-- ============================================================================
-- Os nomes de recusa sao os MESMOS que meta-actions ja usa. Inventar nomes novos criaria
-- dois vocabularios para o mesmo fato e o gestor teria de aprender qual dos dois esta lendo.
insert into public.contrato_de_estado_execucao
  (acao, campo_destino, propriedade, valor_recusado, recusa_nomeada, mensagem_de_recusa,
   recusa_estado_desconhecido, mensagem_estado_desconhecido, fonte, condicao_campo_pedido, ordem, vigente)
select * from (values
  ('criar_anuncio_a_partir_de', 'creative_id', 'molde_expoe_page_id', false,
   'molde_sem_page_id',
   'Nao emiti o card porque o molde escolhido nao traz a pagina do Facebook (page_id) no spec, e a Meta recusa criar anuncio sem pagina. Nao existe default seguro aqui: publicar por outra pagina mudaria o EMISSOR do anuncio. Escolha um molde que carregue a pagina.',
   'estado_do_molde_nao_verificado',
   'Nao emiti o card porque ainda nao tenho leitura confiavel do criativo escolhido como molde. Atualize os dados da conta (a coleta de configuracao) ou escolha um molde cujo estado ja tenha sido verificado.',
   'Graph fields=object_story_spec; executora meta-actions montarCriacao (recusa molde_sem_page_id)',
   'drive_file_id,meta_video_id', 2, true),
  ('criar_anuncio_a_partir_de', 'creative_id', 'molde_expoe_link_destino', false,
   'molde_sem_link_de_destino',
   'Nao emiti o card porque o molde escolhido nao carrega a URL de destino dentro do video. A URL de destino nao existe em tabela nenhuma deste sistema - ela vem do molde ou nao vem, e nao sera inventada (muito menos em anuncio de credito). Escolha um molde que leve o link.',
   'estado_do_molde_nao_verificado',
   'Nao emiti o card porque ainda nao tenho leitura confiavel do criativo escolhido como molde. Atualize os dados da conta (a coleta de configuracao) ou escolha um molde cujo estado ja tenha sido verificado.',
   'Graph fields=object_story_spec; executora meta-actions montarCriacao (recusa molde_sem_link_de_destino)',
   'drive_file_id,meta_video_id', 3, true)
) as v(acao, campo_destino, propriedade, valor_recusado, recusa_nomeada, mensagem_de_recusa,
       recusa_estado_desconhecido, mensagem_estado_desconhecido, fonte, condicao_campo_pedido, ordem, vigente)
where not exists (
  select 1 from public.contrato_de_estado_execucao r
   where r.acao = v.acao and r.campo_destino = v.campo_destino and r.propriedade = v.propriedade and r.vigente
);

do $$
declare v_ordem text;
begin
  select string_agg(propriedade, ' > ' order by ordem) into v_ordem
    from public.contrato_de_estado_execucao
   where acao='criar_anuncio_a_partir_de' and propriedade like 'molde\_%' and vigente;
  if v_ordem <> 'molde_expoe_video_data > molde_expoe_page_id > molde_expoe_link_destino' then
    raise exception 'a ordem dos pre-requisitos do molde tem de espelhar a da executora, veio: %', coalesce(v_ordem, '(nenhuma)');
  end if;
end $$;
