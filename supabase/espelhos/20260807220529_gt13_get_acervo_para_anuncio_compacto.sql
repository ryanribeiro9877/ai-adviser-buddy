-- ESPELHO DE MIGRACAO APLICADA
-- version: 20260807220529
-- name: gt13_get_acervo_para_anuncio_compacto
-- projeto: gzjwnjdpxpbmdhcyefvs (Gestor de Trafego IA)
-- aplicada por: Claude via MCP apply_migration
-- espelho gerado a partir de supabase_migrations.schema_migrations - NAO transcrito a mao

-- GT-13 (07/08/2026) v2: compacta o retorno de get_acervo_para_anuncio para caber no teto de
-- 14.000 chars que o traffic-chat aplica a cada retorno de ferramenta. A v1 devolvia ~1.6k por
-- item (transcricao 600 + analise 300 + texto_visivel), e o conjunto CLT (14 pecas) dava 22k -
-- seria cortado exatamente como a get_drive_analises que originou o bug. Aqui: transcricao 240,
-- analise 110, texto_visivel so em imagem, e menos campos redundantes. O conteudo honesto
-- (aptidao, bloqueio marcado, o que a peca diz, ja usada) permanece.
create or replace function public.get_acervo_para_anuncio(
  p_company_id uuid,
  p_produto text default null,
  p_incluir_inaptas boolean default true
) returns jsonb
language sql stable security definer set search_path = public as $$
with dedup as (
  select distinct on (d.drive_file_id)
    d.drive_file_id, d.nome, d.caminho, d.mime,
    d.produto_detectado, d.aproveitavel, d.motivo, d.texto_visivel,
    d.base_da_analise, d.transcricao_audio, d.company_id
  from public.drive_midia_analises d
  where d.company_id = p_company_id
  order by d.drive_file_id,
           (d.base_da_analise like '%criterio%') desc,
           d.analisado_em desc nulls last
),
enriq as (
  select
    x.drive_file_id, x.nome, x.caminho,
    case when x.mime ilike 'video%' then 'video'
         when x.mime ilike 'image%' then 'imagem'
         else coalesce(x.mime,'?') end as tipo,
    (x.mime ilike 'video%') as e_video,
    x.produto_detectado, x.aproveitavel, x.motivo, x.texto_visivel,
    x.base_da_analise, x.transcricao_audio,
    exists(select 1 from public.media_uploads m
            where m.drive_file_id = x.drive_file_id
              and (m.meta_video_id is not null or m.meta_image_hash is not null)) as na_biblioteca_meta,
    r.motivo as rev_motivo, r.regra_code as rev_regra, r.bloqueia_uso as rev_bloqueia,
    r.aberto_em as rev_aberto_em, r.aberto_por as rev_aberto_por, r.evidencia as rev_evidencia,
    exists(select 1 from public.approval_requests ar
       where ar.company_id = x.company_id and ar.action = 'criar_anuncio_a_partir_de'
         and ar.payload->>'drive_file_id' = x.drive_file_id
         and ar.executed_at is not null and (ar.execution_result->>'ok') = 'true') as ja_virou_anuncio
  from dedup x
  left join lateral (
    select pr.motivo, pr.regra_code, pr.bloqueia_uso, pr.aberto_em, pr.aberto_por, pr.evidencia
      from public.pecas_em_revisao pr
     where pr.company_id = x.company_id and pr.drive_file_id = x.drive_file_id and pr.veredito is null
     order by pr.aberto_em desc limit 1
  ) r on true
),
filtrado as (
  select * from enriq
   where p_produto is null or produto_detectado ilike '%'||p_produto||'%'
),
marc as (
  select f.*,
    (f.rev_motivo is not null) as em_revisao,
    coalesce(f.rev_bloqueia,false) as bloqueada,
    (f.na_biblioteca_meta and not coalesce(f.rev_bloqueia,false)) as apta
  from filtrado f
),
itens as (
  select m.*, jsonb_strip_nulls(jsonb_build_object(
    'nome', m.nome,
    'drive_file_id', m.drive_file_id,
    'caminho', m.caminho,
    'tipo', m.tipo,
    'apta', m.apta,
    'na_biblioteca_da_meta', m.na_biblioteca_meta,
    'motivo_inapta', case when not m.na_biblioteca_meta
                          then 'fora da biblioteca da Meta (sem meta_video_id nem image_hash); publicar assim faria o card falhar'
                          when m.bloqueada then 'bloqueada por revisao de compliance'
                          else null end,
    'produto', coalesce(m.produto_detectado,'nao classificado'),
    'produto_fonte', case when m.e_video then 'inferido (transcricao+frames)' else 'leitura visual' end,
    'aproveitavel_visual', coalesce(m.aproveitavel,'nao classificado'),
    'analise_visual', left(m.motivo, 110),
    'texto_visivel', case when not m.e_video then nullif(left(coalesce(m.texto_visivel,''),110),'') else null end,
    'transcricao_ausente', case when m.e_video and (m.transcricao_audio is null or length(m.transcricao_audio)=0) then true else null end,
    'o_que_diz_no_audio', case when m.transcricao_audio is not null and length(m.transcricao_audio)>0
                               then left(m.transcricao_audio, 240) || case when length(m.transcricao_audio)>240 then ' […]' else '' end
                               else null end,
    'bloqueada_por_compliance', case when m.em_revisao then jsonb_build_object(
        'bloqueia_uso', m.bloqueada, 'motivo', left(m.rev_motivo,200), 'regra', m.rev_regra,
        'aberto_em', m.rev_aberto_em, 'aberto_por', m.rev_aberto_por) else null end,
    'ja_usada_em_anuncio', m.ja_virou_anuncio
  )) as item
  from marc m
  where p_incluir_inaptas or m.apta
)
select jsonb_build_object(
  'produto_filtrado', p_produto,
  'total_no_acervo_apos_filtro', (select count(*) from marc),
  'resumo', jsonb_build_object(
     'aptas_agora', (select count(*) from marc where apta),
     'bloqueadas_por_compliance', (select count(*) from marc where bloqueada),
     'fora_da_biblioteca_da_meta', (select count(*) from marc where not na_biblioteca_meta),
     'ja_usadas_em_anuncio', (select count(*) from marc where ja_virou_anuncio),
     'videos_sem_transcricao', (select count(*) from marc where e_video and (transcricao_audio is null or length(transcricao_audio)=0))),
  'como_usar', 'ACERVO do Drive disponivel para uso (peca que ainda NAO virou anuncio) - oposto de get_criativos_conteudo, que le so os anuncios JA no ar. Use para MONTAR anuncio novo/escolher peca por produto. apta=true = esta na biblioteca da Meta E sem bloqueio de compliance. Peca com bloqueada_por_compliance aparece SEMPRE marcada; nunca proponha sem declarar a revisao. o_que_diz_no_audio e a transcricao real; transcricao_ausente=true = lacuna, nao estime. Video: produto e INFERIDO (produto_fonte). ja_usada_em_anuncio = anuncio criado PELO SISTEMA. Antes de emitir card, leia nota_visual_da_peca da candidata.',
  'itens', coalesce((select jsonb_agg(item order by (item->>'apta')::boolean desc, item->>'nome') from itens), '[]'::jsonb)
);
$$;

revoke all on function public.get_acervo_para_anuncio(uuid, text, boolean) from public, anon;
grant execute on function public.get_acervo_para_anuncio(uuid, text, boolean) to authenticated, service_role;