-- Leitura total do acervo (19/08/2026) + taxonomia Drive LEV.
-- Inventario real pasta Junho e Julho: 19 videos (10 Educacao financeira + 9 Caminho Triste/feliz),
-- Capas, 9 Carrosseis, 4 Cards instrucionais + Fixado Cards.
-- LEITURA livre; apta=true so = prontidao de publicacao; NAO libera FIN-04 automaticamente.

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
    case when x.caminho ~* 'carrossel' then x.caminho else null end as grupo_carrossel,
    case
      when x.mime ilike 'video%' and x.caminho ~* 'educa' then 'video_educacao_financeira'
      when x.mime ilike 'video%' and x.caminho ~* 'triste|caminho' then 'video_caminho_triste_feliz'
      when x.caminho ~* 'educa' and x.caminho ~* 'capa' then 'capa_de_video'
      when x.caminho ~* 'carrossel' then 'slide_carrossel'
      when lower(x.caminho) = 'cards' or x.caminho ~* '^cards/' then 'card_instrucional'
      when x.caminho ~* 'fixado' and x.caminho ~* 'cards' then 'card_fixado'
      when x.mime ilike 'video%' then 'video_outro'
      when x.mime ilike 'image%' then 'imagem_outra'
      else 'outro'
    end as familia_drive,
    case
      when lower(x.caminho) = 'cards' or x.caminho ~* '^cards/' then
        'mecanismo_instrucional: atrai com pergunta/tema e manda ler a legenda (ex. como funciona o consorcio) - NAO tratar como imagem generica'
      when x.caminho ~* 'fixado' and x.caminho ~* 'cards' then
        'card_fixado_institucional_ou_educativo'
      when x.caminho ~* 'educa' and x.caminho ~* 'capa' then
        'capa_usada_nos_videos_de_educacao_financeira - inventariar e propor como imagem se fizer sentido'
      else null
    end as papel_criativo,
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
marc_global as (
  select e.*,
    (e.rev_motivo is not null) as em_revisao,
    coalesce(e.rev_bloqueia,false) as bloqueada,
    (e.na_biblioteca_meta and not coalesce(e.rev_bloqueia,false)) as apta
  from enriq e
),
filtrado as (
  select * from marc_global
   where p_produto is null
      or produto_detectado ilike '%'||p_produto||'%'
      or caminho ilike '%'||p_produto||'%'
      or nome ilike '%'||p_produto||'%'
      or familia_drive ilike '%'||p_produto||'%'
),
marc as (
  select * from filtrado
),
itens as (
  select m.*, jsonb_strip_nulls(jsonb_build_object(
    'nome', m.nome,
    'drive_file_id', m.drive_file_id,
    'caminho', m.caminho,
    'tipo', m.tipo,
    'familia_drive', m.familia_drive,
    'papel_criativo', m.papel_criativo,
    'legivel', true,
    'apta', m.apta,
    'na_biblioteca_da_meta', m.na_biblioteca_meta,
    'meta_video_id', m.meta_video_id,
    'meta_image_hash', m.meta_image_hash,
    'grupo_carrossel', m.grupo_carrossel,
    'uso_como_imagem_estatica', case when (m.familia_drive in ('slide_carrossel','capa_de_video','card_instrucional','card_fixado')) and m.tipo = 'imagem' then true else null end,
    'formato_carrossel_meta', case when m.familia_drive = 'slide_carrossel' then
      'slides_ok_como_imagem_unica; formato_carrossel_Meta_nao_montado_pela_executora'
      else null end,
    'motivo_inapta', case when not m.na_biblioteca_meta
                          then 'fora da biblioteca da Meta - chame upload_midia com este drive_file_id antes de propor o card'
                          when m.bloqueada then 'bloqueada por revisao de compliance - LEITURA livre; para publicar, emita card registrar_veredito_peca_em_revisao (liberado_como_esta) e aguarde aprovacao humana'
                          else null end,
    'produto', coalesce(m.produto_detectado,'nao classificado'),
    'produto_fonte', case when m.e_video then 'inferido (transcricao+frames)' else 'leitura visual' end,
    'aproveitavel_visual', coalesce(m.aproveitavel,'nao classificado'),
    'analise_visual', left(m.motivo, 110),
    'texto_visivel', case when not m.e_video then nullif(left(coalesce(m.texto_visivel,''),110),'') else null end,
    'transcricao_ausente', case when m.e_video and (m.transcricao_audio is null or length(m.transcricao_audio)=0) then true else null end,
    'o_que_diz_no_audio', case when m.transcricao_audio is not null and length(m.transcricao_audio)>0
                               then left(m.transcricao_audio, 240) || case when length(m.transcricao_audio)>240 then ' [...]' else '' end
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
  'leitura_total', true,
  'total_no_acervo_apos_filtro', (select count(*) from marc),
  'taxonomia_drive', jsonb_build_object(
     'videos_total', (select count(*) from marc_global where tipo = 'video'),
     'videos_educacao_financeira', (select count(*) from marc_global where familia_drive = 'video_educacao_financeira'),
     'videos_caminho_triste_feliz', (select count(*) from marc_global where familia_drive = 'video_caminho_triste_feliz'),
     'capas_de_video', (select count(*) from marc_global where familia_drive = 'capa_de_video'),
     'carrosseis', (select count(distinct grupo_carrossel) from marc_global where familia_drive = 'slide_carrossel'),
     'slides_carrossel', (select count(*) from marc_global where familia_drive = 'slide_carrossel'),
     'cards_instrucionais', (select count(*) from marc_global where familia_drive = 'card_instrucional'),
     'cards_fixados', (select count(*) from marc_global where familia_drive = 'card_fixado'),
     'mapa', '19 videos (10 Educacao financeira + 9 Caminho Triste/feliz) + Capas na subpasta Capas + 9 Carrosseis + 4 Cards instrucionais (leia a legenda) + Fixado Cards'
  ),
  'inventario_global', jsonb_build_object(
     'arquivos_unicos', (select count(*) from marc_global),
     'videos', (select count(*) from marc_global where tipo = 'video'),
     'imagens', (select count(*) from marc_global where tipo = 'imagem'),
     'slides_carrossel', (select count(*) from marc_global where familia_drive = 'slide_carrossel'),
     'pastas_carrossel', (select count(distinct grupo_carrossel) from marc_global where familia_drive = 'slide_carrossel'),
     'capas_de_video', (select count(*) from marc_global where familia_drive = 'capa_de_video'),
     'cards_instrucionais', (select count(*) from marc_global where familia_drive = 'card_instrucional'),
     'aptas_agora', (select count(*) from marc_global where apta),
     'bloqueadas_por_compliance', (select count(*) from marc_global where bloqueada),
     'fora_da_biblioteca_da_meta', (select count(*) from marc_global where not na_biblioteca_meta),
     'por_familia', coalesce((
        select jsonb_object_agg(fam, n) from (
          select familia_drive as fam, count(*)::int as n from marc_global group by 1
        ) s
     ), '{}'::jsonb),
     'por_produto', coalesce((
        select jsonb_object_agg(prod, n) from (
          select coalesce(produto_detectado,'(nao classificado)') as prod, count(*)::int as n from marc_global group by 1
        ) s
     ), '{}'::jsonb),
     'por_caminho', coalesce((
        select jsonb_object_agg(cam, n) from (
          select coalesce(caminho,'(raiz)') as cam, count(*)::int as n from marc_global group by 1
        ) s
     ), '{}'::jsonb)
  ),
  'resumo', jsonb_build_object(
     'aptas_agora', (select count(*) from marc where apta),
     'bloqueadas_por_compliance', (select count(*) from marc where bloqueada),
     'fora_da_biblioteca_da_meta', (select count(*) from marc where not na_biblioteca_meta),
     'ja_usadas_em_anuncio', (select count(*) from marc where ja_virou_anuncio),
     'videos_sem_transcricao', (select count(*) from marc where e_video and (transcricao_audio is null or length(transcricao_audio)=0)),
     'slides_carrossel', (select count(*) from marc where familia_drive = 'slide_carrossel'),
     'pastas_carrossel', (select count(distinct grupo_carrossel) from marc where familia_drive = 'slide_carrossel'),
     'capas_de_video', (select count(*) from marc where familia_drive = 'capa_de_video'),
     'cards_instrucionais', (select count(*) from marc where familia_drive = 'card_instrucional')),
  'como_usar', 'LEITURA TOTAL do Drive: taxonomia_drive + inventario_global SEMPRE listam tudo - 19 videos (10 Educacao financeira + 9 Caminho Triste/feliz), Capas (subpasta Capas), 9 Carrosseis, 4 Cards instrucionais. legivel=true em todo item. apta=true = pronta para publicar AGORA - NAO significa "so isso existe". Para lote/mix: (1) chame SEM produto e cite taxonomia_drive; (2) filtro de produto NAO autoriza escassez falsa; (3) slides Carrossel N = IMAGEM ESTATICA; formato carrossel Meta nao e montado - declare limite de FORMATO, nao ausencia; (4) Cards = mecanismo instrucional (leia a legenda), nao imagem generica; (5) Capas = capas dos videos de educacao financeira, tambem legiveis; (6) peca bloqueada continua LEGIVEL - proponha via registrar_veredito_peca_em_revisao + card apos aprovacao humana (NAO liberar FIN-04 sozinho). Se na_biblioteca_da_meta=false, upload_midia antes do card.',
  'itens', coalesce((select jsonb_agg(item order by (item->>'apta')::boolean desc, item->>'nome') from itens), '[]'::jsonb)
);
$$;

revoke all on function public.get_acervo_para_anuncio(uuid, text, boolean) from public, anon, authenticated;
grant execute on function public.get_acervo_para_anuncio(uuid, text, boolean) to service_role;

update public.agent_context
   set vigente = false
 where company_id = 'ded20b38-f42e-4c71-800c-31b97ea48bcf'
   and categoria = 'criacao'
   and (fato like 'LEITURA TOTAL DO ACERVO%' or fato like 'TAXONOMIA DO DRIVE%')
   and vigente;

insert into public.agent_context (company_id, categoria, fato, vigente)
values
(
  'ded20b38-f42e-4c71-800c-31b97ea48bcf'::uuid,
  'criacao',
  'LEITURA TOTAL DO ACERVO (19/08/2026): get_acervo_para_anuncio devolve taxonomia_drive + inventario_global SEMPRE. LEITURA e livre - bloqueio de compliance e apta=false NAO escondem a peca. Em lote/mix: (1) chame SEM filtro de produto e cite taxonomia_drive; (2) NUNCA diga "so existem N" com base so no filtro CLT; (3) slides Carrossel 1..9 = imagem estatica usavel (formato carrossel Meta nao montado = limite de formato, nao ausencia); (4) Capas em Videos/Educacao financeira/Capa = inventario obrigatorio; (5) Cards = mecanismo instrucional "leia a legenda", nao imagem generica; (6) videos FIN-04 bloqueados listam-se e entram via card de veredito liberado_como_esta + criacao apos aprovacao humana - NAO liberar sozinho.',
  true
),
(
  'ded20b38-f42e-4c71-800c-31b97ea48bcf'::uuid,
  'criacao',
  'TAXONOMIA DO DRIVE LEV (19/08/2026, pasta Junho e Julho): 19 videos = 10 Educacao financeira + 9 Caminho Triste/feliz; dentro de Educacao financeira existe subpasta Capas (capas dos videos) - sempre inventariar; 9 carrosseis (Carrossel 1..9) com slides legiveis; 4 Cards em pasta Cards = pecas instrucionais que pedem leitura da legenda (ex. "como funciona o consorcio?"); Fixado Cards = institucionais/educativos. Ao propor mix, cite essas familias pelo nome (familia_drive / taxonomia_drive), nao colapse tudo em "imagem".',
  true
);
