-- ESPELHO DE MIGRACAO APLICADA
-- version: 20260810221033
-- name: molde_sem_video_data_recusa_antes_do_card
-- projeto: gzjwnjdpxpbmdhcyefvs (Gestor de Trafego IA)
-- aplicada por: Claude via MCP apply_migration
-- conferido contra supabase_migrations.schema_migrations por md5 - byte a byte igual ao banco

-- O MOLDE QUE NAO SERVE PASSA A SER RECUSADO NA EMISSAO, NAO NA EXECUCAO.
--
-- O QUE ACONTECEU (10/08/2026, 21:58):
--   Card aprovado as 21:58:07; a execucao falhou 39 segundos depois com
--   `molde_sem_video_data`: o molde AD_LP_C7_LAL1pct_R06_DYN expoe object_story_spec
--   apenas com page_id, sem video_data. A recusa esta CERTA - trocar a midia de um spec
--   sem video_data mudaria o FORMATO do anuncio, nao a peca. Nenhum anuncio foi criado.
--
--   O defeito nao e a recusa: e o MOMENTO dela. O gestor aprovou um card que nunca teve
--   como executar. Aprovar card de anuncio e o ato que inicia o gasto; um card que ja
--   nasce impossivel gasta confianca e tempo do gestor, e e exatamente o que o
--   contrato_de_estado_execucao existe para impedir - foi assim que resolvemos
--   is_dynamic_creative e o CBO da campanha.
--
--   A causa raiz e a mesma da coluna is_dynamic_creative, um nivel ao lado: o estado
--   existia na Graph, a coleta diaria ja o LIA, e ninguem o guardava. meta-campaign-status
--   consulta object_story_spec de TODO criativo da conta desde a v4 (GT-12), usa o
--   resultado so para deduzir destino_url e descarta o resto. O fato "este criativo expoe
--   video_data" atravessava a corrida e se perdia.
--
--   POR QUE MOLDE DINAMICO NAO EXPOE: criativo de conjunto Dynamic Creative nao tem
--   object_story_spec com midia porque a Meta monta as combinacoes sozinha (a midia vive
--   no asset_feed_spec). Por construcao, ele nao serve de molde para anuncio avulso de
--   video. E o mesmo achado de 07/08 aparecendo num lugar novo: os criativos de maior
--   lastro da conta sao dinamicos, e justamente por isso nao se copiam.

-- ============================================================================
-- 1 - ONDE O ESTADO DO CRIATIVO PASSA A MORAR
-- ============================================================================
-- Tabela propria, e nao coluna em `ads`, porque o estado e do CRIATIVO: o mesmo criativo
-- pode estar em varios anuncios, e o pedido de anuncio aponta para creative_id, nao para
-- um anuncio. Guardar em ads duplicaria o fato e permitiria duas respostas para a mesma
-- pergunta.
create table if not exists public.creative_estado_graph (
  creative_id text primary key,
  account_id text,
  -- Os dois fatos sao distintos e a executora os separa em duas recusas diferentes
  -- (molde_sem_object_story_spec e molde_sem_video_data). Guardar so o segundo apagaria
  -- a diferenca entre "criativo flexivel/Advantage+" e "spec de imagem".
  expoe_object_story_spec boolean,
  expoe_video_data boolean,
  -- As chaves do spec sao o que a executora imprime no detalhe da recusa
  -- ("chaves presentes: page_id"). Guardadas para o agente explicar sem adivinhar.
  chaves_do_spec text[],
  observado_em timestamptz,
  fonte text
);

comment on table public.creative_estado_graph is
  'Estado Graph do criativo observado pela coleta diaria (meta-campaign-status). Responde a unica pergunta que decide se um criativo serve de MOLDE para anuncio avulso de video: ele expoe object_story_spec com video_data? Linha ausente ou coluna nula significa NUNCA VERIFICADO, e o portao de emissao recusa fechado nesse caso.';
comment on column public.creative_estado_graph.expoe_video_data is
  'true = o object_story_spec traz video_data e a rota de peca nova pode trocar a midia. false = nao traz, e usar este molde produziria mudanca de FORMATO, nao troca de peca. null = nunca verificado.';

alter table public.creative_estado_graph enable row level security;

-- Estado operacional lido pela edge com service_role. Sem politica de leitura para anon:
-- quem precisa disso no produto passa pelas RPCs que ja filtram por empresa.
revoke all on table public.creative_estado_graph from anon;
revoke all on table public.creative_estado_graph from authenticated;

-- ============================================================================
-- 2 - A GRAVACAO, COM O MESMO CONTRATO DO ESP-13
-- ============================================================================
-- Criativo cuja resposta da Graph nao chegou NAO entra no payload e portanto preserva o
-- valor anterior. Ausencia de leitura nao e leitura, e nao pode virar "nao expoe video".
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
      case when jsonb_typeof(x->'chaves_do_spec') = 'array'
           then array(select jsonb_array_elements_text(x->'chaves_do_spec'))
           else null end                               as chaves,
      nullif(btrim(x->>'fonte'), '')                   as fonte
    from jsonb_array_elements(p) x
    -- Os dois booleanos precisam ser leitura de fato. Valor que nao seja booleano fica
    -- de fora em vez de virar false por conveniencia.
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
       chaves_do_spec, observado_em, fonte)
    select creative_id, account_id, expoe_spec, expoe_video, chaves, now(),
           coalesce(fonte, 'Graph fields=object_story_spec; coleta meta-campaign-status')
      from unica
    on conflict (creative_id) do update set
      account_id              = coalesce(excluded.account_id, c.account_id),
      expoe_object_story_spec = excluded.expoe_object_story_spec,
      expoe_video_data        = excluded.expoe_video_data,
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

comment on function public.espelhar_estado_de_criativos_da_graph(jsonb) is
  'Grava em public.creative_estado_graph se o criativo expoe object_story_spec e video_data, a partir da leitura que a edge meta-campaign-status ja fazia desde o GT-12 e descartava. Existe para que a emissao do card saiba, ANTES da aprovacao, se o molde escolhido serve para anuncio avulso de video.';

revoke all on function public.espelhar_estado_de_criativos_da_graph(jsonb) from public;
revoke all on function public.espelhar_estado_de_criativos_da_graph(jsonb) from anon;
revoke all on function public.espelhar_estado_de_criativos_da_graph(jsonb) from authenticated;
grant execute on function public.espelhar_estado_de_criativos_da_graph(jsonb) to service_role;

-- ============================================================================
-- 3 - O PORTAO APRENDE A PROPRIEDADE
-- ============================================================================
-- Duas mudancas na funcao, ambas aditivas: a condicao do pedido passa a aceitar lista, e
-- ha mais um ramo na resolucao do estado. O resto e identico, de proposito - a maquina de
-- recusa ja estava certa, faltava-lhe o fato.
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
     where acao = p_acao and vigente order by campo_destino, propriedade
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
    elsif v_regra.propriedade = 'molde_expoe_video_data' then
      -- O molde e um CRIATIVO, nao um anuncio: o pedido aponta para creative_id e o mesmo
      -- criativo pode servir a varios anuncios. Linha ausente = nunca verificado = fecha.
      select k.expoe_video_data, true into v_estado, v_encontrado
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
-- 4 - A REGRA DECLARADA
-- ============================================================================
-- A condicao lista as DUAS formas pelas quais a rota de peca nova chega: o pedido pode
-- trazer o arquivo do Drive (drive_file_id) ou a midia ja enviada (meta_video_id). Cobrir
-- so uma deixaria a outra passar sem verificacao, que e o defeito que esta migracao
-- conserta. Em replicacao pura nenhuma das duas esta presente e a regra corretamente nao
-- se aplica: ali o pedido E publicar o criativo do molde, e video_data e irrelevante.
insert into public.contrato_de_estado_execucao
  (acao, campo_destino, propriedade, valor_recusado, recusa_nomeada, mensagem_de_recusa,
   recusa_estado_desconhecido, mensagem_estado_desconhecido, fonte, condicao_campo_pedido, vigente)
select 'criar_anuncio_a_partir_de', 'creative_id', 'molde_expoe_video_data', false,
  'molde_sem_video_data',
  'Nao emiti o card porque o anuncio molde escolhido nao expoe a midia de video no formato que a troca de peca exige. Isso acontece com criativo de conjunto Criativo Dinamico (a Meta monta as combinacoes sozinha, e a midia nao vive num campo copiavel) e com molde de imagem. Publicar a peca nova sobre esse molde mudaria o FORMATO do anuncio, nao apenas a peca - por isso recuso aqui, antes de voce aprovar. Escolha como molde um anuncio de VIDEO avulso, cujo criativo exponha o spec com a midia.',
  'estado_do_molde_nao_verificado',
  'Nao emiti o card porque ainda nao tenho leitura confiavel do criativo escolhido como molde que confirme se ele expoe a midia de video. Atualize os dados da conta (a coleta de configuracao) ou escolha um molde cujo estado ja tenha sido verificado.',
  'Graph fields=object_story_spec; coleta meta-campaign-status; executora meta-actions montarCriacao (recusas molde_sem_object_story_spec e molde_sem_video_data)',
  'drive_file_id,meta_video_id', true
where not exists (
  select 1 from public.contrato_de_estado_execucao
   where acao='criar_anuncio_a_partir_de' and campo_destino='creative_id'
     and propriedade='molde_expoe_video_data' and vigente
);

do $$
declare v_cond text;
begin
  select condicao_campo_pedido into v_cond
    from public.contrato_de_estado_execucao
   where acao='criar_anuncio_a_partir_de' and propriedade='molde_expoe_video_data' and vigente;
  if v_cond is null or not (v_cond like '%drive_file_id%' and v_cond like '%meta_video_id%') then
    raise exception 'as duas rotas de peca nova (drive_file_id e meta_video_id) precisam estar cobertas pela regra do molde, veio %', coalesce(v_cond,'(nenhuma regra)');
  end if;
end $$;
