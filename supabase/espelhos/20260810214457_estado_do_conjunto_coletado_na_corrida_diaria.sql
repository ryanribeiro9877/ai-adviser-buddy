-- ESPELHO DE MIGRACAO APLICADA
-- version: 20260810214457
-- name: estado_do_conjunto_coletado_na_corrida_diaria
-- projeto: gzjwnjdpxpbmdhcyefvs (Gestor de Trafego IA)
-- aplicada por: Claude via MCP apply_migration
-- espelho gerado a partir de supabase_migrations.schema_migrations - NAO transcrito a mao

-- ESTADO DO CONJUNTO (is_dynamic_creative) PASSA A SER COLETADO, EM VEZ DE MEDIDO A MAO.
--
-- O QUE QUEBROU (10/08/2026):
--   O card do anuncio da peca 24 no conjunto 120254387861670191 foi recusado com
--   `estado_conjunto_destino_nao_verificado`. O portao de emissao
--   (avaliar_estado_destino_execucao) le `ad_sets.is_dynamic_creative` do ESPELHO e falha
--   fechado quando a coluna e nula - o que esta correto: ausencia de leitura nao e liberacao.
--
--   O defeito nao estava no portao, e sim em quem deveria alimentar a coluna: NINGUEM.
--     - meta-campaign-status (a coleta diaria de configuracao) nunca leu is_dynamic_creative;
--     - meta-health apenas LE e registra em audit_log, sem escrever no espelho;
--     - o unico preenchimento existente veio da migracao manual 20260807183846, para 4 moldes.
--   Ou seja: todo conjunto criado depois daquela medicao nasce invisivel para o portao, e
--   nenhuma espera resolve. Nao havia processo amadurecendo - havia lacuna.
--
--   Medicao ao vivo em 10/08/2026 21:36 (sonda meta-health, Graph fields=is_dynamic_creative):
--     120254387861670191 (replica de teste C) -> false  => ACEITA anuncio avulso
--     120251373799340191 (molde C3-REELS Dynamic Video) -> true
--   Confere com o codigo: criar_conjunto_a_partir_de (meta-actions) nao copia
--   is_dynamic_creative do molde, entao a replica nasce com Criativo Dinamico desativado.

-- ============================================================================
-- PARTE 1 - DESTRAVA O CONJUNTO DE TESTE C COM O ESTADO QUE FOI DE FATO MEDIDO
-- ============================================================================
-- Nao e chute nem default: e o valor observado na Graph, com instante e fonte declarados.
-- A condicao `is_dynamic_creative is null` garante que isto so preenche lacuna e nunca
-- sobrescreve uma leitura existente.
update public.ad_sets
   set is_dynamic_creative       = false,
       estado_graph_observado_em = timestamptz '2026-08-10 21:36:49+00',
       estado_graph_fonte        = 'Graph fields=is_dynamic_creative; sonda meta-health 10/08/2026 21:36'
 where external_id = '120254387861670191'
   and is_dynamic_creative is null;

do $$
begin
  if not exists (
    select 1 from public.ad_sets
     where external_id = '120254387861670191' and is_dynamic_creative is false
  ) then
    raise exception 'conjunto 120254387861670191 segue sem estado observado: a destrava nao foi aplicada';
  end if;
end $$;

-- ============================================================================
-- PARTE 2 - A COLETA DIARIA PASSA A GRAVAR O ESTADO DE TODO CONJUNTO LIDO
-- ============================================================================
-- Contrato identico ao do ESP-13, e ele e o ponto inteiro desta funcao:
--   campo AUSENTE na resposta da Graph  -> nao entra no payload -> preserva o valor anterior;
--   campo PRESENTE com booleano         -> grava, com instante e fonte.
-- Um valor presente mas nao-booleano nao vira `false` por conveniencia: fica de fora e e
-- contado, porque "nao entendi a resposta" nao pode virar "o conjunto aceita anuncio avulso".
create or replace function public.espelhar_estado_de_conjuntos_da_graph(p jsonb)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_recebidos int := 0;
  v_legiveis int := 0;
  v_atualizados int := 0;
begin
  if p is null or jsonb_typeof(p) <> 'array' then
    raise exception 'espelhar_estado_de_conjuntos_da_graph: p tem de ser um array jsonb, veio %',
      coalesce(jsonb_typeof(p), 'null');
  end if;

  v_recebidos := jsonb_array_length(p);

  with entrada as (
    select
      nullif(btrim(x->>'adset_external_id'), '') as external_id,
      (x->>'is_dynamic_creative')::boolean       as is_dc,
      nullif(btrim(x->>'fonte'), '')             as fonte
    from jsonb_array_elements(p) x
    where jsonb_typeof(x->'is_dynamic_creative') = 'boolean'
      and nullif(btrim(x->>'adset_external_id'), '') is not null
  ),
  -- A Graph pagina: o mesmo conjunto pode chegar duas vezes no lote, e o Postgres recusa
  -- atualizar a mesma linha duas vezes no mesmo comando.
  unica as (
    select distinct on (external_id) * from entrada order by external_id
  ),
  aplicado as (
    update public.ad_sets a
       set is_dynamic_creative       = u.is_dc,
           estado_graph_observado_em = now(),
           estado_graph_fonte        = coalesce(u.fonte,
             'Graph fields=is_dynamic_creative; coleta meta-campaign-status')
      from unica u
     where a.external_id = u.external_id
       and a.provider = 'meta_ads'
    returning 1
  )
  select (select count(*) from unica), (select count(*) from aplicado)
    into v_legiveis, v_atualizados;

  return jsonb_build_object(
    'recebidos', v_recebidos,
    'com_leitura_booleana', v_legiveis,
    'atualizados', v_atualizados,
    'sem_espelho', greatest(v_legiveis - v_atualizados, 0),
    'nota', 'So grava conjunto cujo is_dynamic_creative veio como booleano na resposta da Graph. '
         || 'Campo ausente preserva o valor anterior: ausencia de leitura nao e leitura. '
         || 'sem_espelho = conjunto lido na Graph que ainda nao existe em ad_sets.'
  );
end
$function$;

comment on function public.espelhar_estado_de_conjuntos_da_graph(jsonb) is
  'Grava em public.ad_sets o estado Graph do conjunto (is_dynamic_creative) com instante e fonte, a partir da lista lida pela edge meta-campaign-status. Existe porque avaliar_estado_destino_execucao le essa coluna para decidir se o conjunto aceita anuncio avulso, e ate 10/08/2026 nenhuma coleta a preenchia - todo conjunto novo ficava invisivel para o portao de emissao. Campo ausente na Graph preserva o valor anterior.';

-- Escreve em ad_sets: fora do alcance de anon e authenticated. Somente service_role (a edge).
revoke all on function public.espelhar_estado_de_conjuntos_da_graph(jsonb) from public;
revoke all on function public.espelhar_estado_de_conjuntos_da_graph(jsonb) from anon;
revoke all on function public.espelhar_estado_de_conjuntos_da_graph(jsonb) from authenticated;
grant execute on function public.espelhar_estado_de_conjuntos_da_graph(jsonb) to service_role;
