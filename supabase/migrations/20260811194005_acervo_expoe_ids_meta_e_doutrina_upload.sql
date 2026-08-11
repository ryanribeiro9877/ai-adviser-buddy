-- Lacuna real (11/08/2026): upload-midia JA sobe video (advideos) e a peca 10 JA tem
-- meta_video_id=1521143389283336 (criado_por=upload-midia v1 em 04/08). O agente devolvia
-- beco sem saida porque get_acervo_para_anuncio so dizia na_biblioteca_da_meta=true booleano,
-- SEM o id, e propose_action pedia um campo 'ja_enviada_para_meta' que o acervo nao devolve.
-- Capacidade existia; exposicao nao. Esta migracao expoe meta_video_id e meta_image_hash
-- no acervo e atualiza a doutrina do como_usar.

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
    mup.meta_video_id,
    mup.meta_image_hash,
    (mup.meta_video_id is not null or mup.meta_image_hash is not null) as na_biblioteca_meta,
    r.motivo as rev_motivo, r.regra_code as rev_regra, r.bloqueia_uso as rev_bloqueia,
    r.aberto_em as rev_aberto_em, r.aberto_por as rev_aberto_por, r.evidencia as rev_evidencia,
    r.veredito as rev_veredito,
    exists(select 1 from public.approval_requests ar
       where ar.company_id = x.company_id and ar.action = 'criar_anuncio_a_partir_de'
         and ar.payload->>'drive_file_id' = x.drive_file_id
         and ar.executed_at is not null and (ar.execution_result->>'ok') = 'true') as ja_virou_anuncio
  from dedup x
  left join lateral (
    select mu.meta_video_id, mu.meta_image_hash
      from public.media_uploads mu
     where mu.drive_file_id = x.drive_file_id
       and mu.company_id = x.company_id
       and mu.status = 'enviado'
       and (mu.meta_video_id is not null or mu.meta_image_hash is not null)
     order by mu.enviado_em desc nulls last
     limit 1
  ) mup on true
  left join lateral (
    select pr.motivo, pr.regra_code, pr.bloqueia_uso, pr.aberto_em, pr.aberto_por, pr.evidencia, pr.veredito
      from public.pecas_em_revisao pr
     where pr.company_id = x.company_id and pr.drive_file_id = x.drive_file_id and pr.bloqueia_uso is true
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
    'meta_video_id', m.meta_video_id,
    'meta_image_hash', m.meta_image_hash,
    'motivo_inapta', case when not m.na_biblioteca_meta
                          then 'fora da biblioteca da Meta - chame upload_midia com este drive_file_id antes de propor o card'
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
        'aberto_em', m.rev_aberto_em, 'aberto_por', m.rev_aberto_por,
        'veredito', m.rev_veredito) else null end,
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
  'como_usar', 'ACERVO do Drive para MONTAR anuncio novo. apta=true = na biblioteca Meta E sem bloqueio. Cada item traz meta_video_id (video) ou meta_image_hash (imagem) quando ja subiu - use esses ids no pedido. Se na_biblioteca_da_meta=false, chame upload_midia(drive_file_id) ANTES de propor o card; nao diga que o sistema nao sabe subir. Video recem-enviado pode ainda estar processando na Meta: so emita card quando status_processamento=ready. Peca bloqueada_por_compliance aparece SEMPRE marcada.',
  'itens', coalesce((select jsonb_agg(item order by (item->>'apta')::boolean desc, item->>'nome') from itens), '[]'::jsonb)
);
$$;

revoke all on function public.get_acervo_para_anuncio(uuid, text, boolean) from public, anon;
grant execute on function public.get_acervo_para_anuncio(uuid, text, boolean) to authenticated, service_role;

insert into public.agent_context (company_id, categoria, fato, vigente)
select 'ded20b38-f42e-4c71-800c-31b97ea48bcf'::uuid,
       'criacao',
       'UPLOAD DE MIDIA EXPOSTO (11/08/2026): a edge upload-midia JA sobe imagem (adimages) e video (advideos). get_acervo_para_anuncio agora devolve meta_video_id/meta_image_hash. Se a peca estiver fora da biblioteca, chame a ferramenta upload_midia com o drive_file_id - nao encerre a conversa pedindo id que voce mesmo pode gerar. Respeita flag upload_midia e teto 5/hora. Video: o id pode existir antes do processamento terminar; so emita card com video ready. A peca 10 (educacao financeira/rotativo) JA tinha meta_video_id=1521143389283336 desde 04/08 via upload-midia v1.',
       true
where not exists (
  select 1 from public.agent_context
   where company_id = 'ded20b38-f42e-4c71-800c-31b97ea48bcf'
     and fato like 'UPLOAD DE MIDIA EXPOSTO (11/08/2026):%'
     and vigente
);
