-- ESPELHO DE MIGRACAO APLICADA
-- version: 20260812171026
-- name: esp33_casar_criativo_performance
-- projeto: gzjwnjdpxpbmdhcyefvs (Gestor de Trafego IA)
-- aplicada por: Claude via MCP apply_migration
-- espelho gerado pela RPC espelhos_de_migracao a partir de supabase_migrations.schema_migrations
-- NAO transcrito a mao
create or replace function public.casar_criativo_performance(
  p_company_id uuid,
  p_drive_file_id text default null,
  p_ad_external_id text default null,
  p_dias integer default 7
) returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_dias integer := greatest(coalesce(p_dias, 7), 1);
  v_desde date := (current_date - v_dias);
  v_pares jsonb;
  v_n int;
begin
  if p_company_id is null then
    return jsonb_build_object(
      'erro', 'company_id_obrigatorio',
      'motivo', 'casar_criativo_performance exige a empresa da conversa.'
    );
  end if;

  with vinculos as (
    select
      ar.payload->>'drive_file_id' as drive_file_id,
      ar.execution_result->>'id_criado' as ad_external_id,
      ar.executed_at,
      ar.id as approval_id
    from public.approval_requests ar
    where ar.company_id = p_company_id
      and ar.action = 'criar_anuncio_a_partir_de'
      and ar.executed_at is not null
      and (ar.execution_result->>'ok') = 'true'
      and nullif(ar.payload->>'drive_file_id','') is not null
      and nullif(ar.execution_result->>'id_criado','') is not null
      and (p_drive_file_id is null or ar.payload->>'drive_file_id' = p_drive_file_id)
      and (p_ad_external_id is null or ar.execution_result->>'id_criado' = p_ad_external_id)
  ),
  uniq as (
    select distinct on (drive_file_id, ad_external_id)
      drive_file_id, ad_external_id, executed_at, approval_id
    from vinculos
    order by drive_file_id, ad_external_id, executed_at desc
  ),
  met as (
    select
      u.drive_file_id,
      u.ad_external_id,
      u.executed_at,
      u.approval_id,
      a.name as ad_name,
      a.status as ad_status,
      d.nome as peca_nome,
      d.produto_detectado,
      d.aproveitavel,
      coalesce(sum(s.spend), 0) as gasto,
      coalesce(sum(s.impressions), 0) as impressoes,
      coalesce(sum(s.link_clicks), 0) as cliques_link,
      coalesce(sum(s.form_leads), 0) as formularios,
      coalesce(sum(s.messaging_started), 0) as conversas,
      count(s.snapshot_date) filter (where s.spend > 0) as dias_com_gasto
    from uniq u
    left join public.ads a
      on a.company_id = p_company_id and a.external_id = u.ad_external_id
    left join lateral (
      select da.nome, da.produto_detectado, da.aproveitavel
      from public.drive_midia_analises da
      where da.company_id = p_company_id and da.drive_file_id = u.drive_file_id
      order by da.analisado_em desc nulls last
      limit 1
    ) d on true
    left join public.ad_metric_snapshots s
      on s.company_id = p_company_id
     and s.ad_external_id = u.ad_external_id
     and s.snapshot_date >= v_desde
    group by u.drive_file_id, u.ad_external_id, u.executed_at, u.approval_id,
             a.name, a.status, d.nome, d.produto_detectado, d.aproveitavel
  )
  select coalesce(jsonb_agg(jsonb_build_object(
    'drive_file_id', m.drive_file_id,
    'peca_nome', m.peca_nome,
    'produto', m.produto_detectado,
    'aproveitavel', m.aproveitavel,
    'ad_external_id', m.ad_external_id,
    'ad_name', m.ad_name,
    'ad_status', m.ad_status,
    'criado_em', m.executed_at,
    'approval_id', m.approval_id,
    'janela_dias', v_dias,
    'gasto', round(m.gasto::numeric, 2),
    'impressoes', m.impressoes,
    'cliques_link', m.cliques_link,
    'formularios', m.formularios,
    'conversas', m.conversas,
    'dias_com_gasto', m.dias_com_gasto,
    'custo_por_formulario', case when m.formularios > 0 then round((m.gasto / m.formularios)::numeric, 2) else null end,
    'amostra_pequena', (m.formularios + m.conversas) < 20,
    'sem_entrega_na_janela', m.gasto = 0
  ) order by m.gasto desc nulls last), '[]'::jsonb)
  into v_pares
  from met m;

  v_n := jsonb_array_length(v_pares);

  return jsonb_build_object(
    'pares', v_pares,
    'total', v_n,
    'janela_dias', v_dias,
    'filtro', jsonb_build_object(
      'drive_file_id', p_drive_file_id,
      'ad_external_id', p_ad_external_id
    ),
    'amostra_limiar', 20,
    'nota',
      'Casamento so cobre anuncios criados PELO SISTEMA com payload.drive_file_id e execution_result.id_criado. Anuncios feitos no Gerenciador nao entram. amostra_pequena=true quando formularios+conversas < 20 na janela — trate como hipotese, nao como prova. Ranking medio isolado nao prescreve pausa.',
    'LACUNAS', jsonb_build_array(
      'Anuncios sem card criar_anuncio_a_partir_de (ou sem drive_file_id no payload) ficam orfaos deste casamento.',
      'Performance usa ad_metric_snapshots da janela; se o coletor atrasar, gasto pode aparecer zero sem a peca ser ruim.',
      'Nao deriva fadiga aqui — para fadiga chame avaliar_fadiga(ad_external_id) depois de obter o id neste retorno.'
    )
  );
end;
$$;

comment on function public.casar_criativo_performance(uuid, text, text, integer) is
  'ESP-33: casa peca Drive com anuncios criados pelo sistema e metricas da janela; declara amostra_pequena e lacunas.';

revoke all on function public.casar_criativo_performance(uuid, text, text, integer) from public, anon;
grant execute on function public.casar_criativo_performance(uuid, text, text, integer) to service_role;

insert into public.agent_context (categoria,fato,vigente,desde)
values
(
  'doutrina',
  'CASAMENTO CRIATIVO↔PERFORMANCE (ESP-33, 12/08/2026). Use a tool/RPC casar_criativo_performance quando precisar saber se uma peca do Drive JA virou anuncio e como ela performou. O vinculo so existe para anuncios criados pelo sistema (card criar_anuncio_a_partir_de com drive_file_id). amostra_pequena=true (<20 resultados na janela) = hipotese, nao prova. NAO use get_ads_ranking sozinho para julgar peca do acervo. Para fadiga, depois do casamento chame avaliar_fadiga com o ad_external_id devolvido.',
  true,
  date '2026-08-12'
);
