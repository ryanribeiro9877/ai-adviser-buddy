-- ESPELHO DE MIGRACAO APLICADA
-- version: 20260807220331
-- name: gt13_get_acervo_para_anuncio
-- projeto: gzjwnjdpxpbmdhcyefvs (Gestor de Trafego IA)
-- aplicada por: Claude via MCP apply_migration
-- espelho gerado a partir de supabase_migrations.schema_migrations - NAO transcrito a mao

-- GT-13 (07/08/2026): o agente nao propunha peca NOVA do acervo do Drive ao montar anuncio.
-- CAUSA MEDIDA (conversa ba86fcbd, 07/08): o acervo E visivel (get_analise_visual_drive foi
-- chamada), mas a RPC get_drive_analises devolve 134 itens (67 arquivos x ~2 analises, SEM
-- dedupe), 37 mil bytes, ordenados por caminho - e o traffic-chat corta todo retorno de tool
-- em 14.000 chars. Os videos (caminho 'Videos/...') caem nas posicoes 28-80 e sao cortados
-- ANTES de chegar ao modelo. Sem enxergar os videos 18/19/20, o agente caiu em
-- get_criativos_conteudo (que le SO public.ads, anuncios ja no ar) e escolheu o R06 'por
-- lastro'. Alem disso a lista nao expunha a transcricao (o que a peca DIZ) e ja_enviada_para_meta
-- so olhava meta_video_id, marcando imagem (image_hash) como nao-publicavel por engano.
--
-- CONSERTO: uma leitura do ACERVO DISPONIVEL PARA USO, deduplicada por arquivo, filtravel por
-- produto, pequena o bastante para nao ser cortada, que responde de forma HONESTA:
--   - nome + o que a peca diz (transcricao do audio + leitura visual)
--   - se esta na biblioteca da Meta (pode virar anuncio sem o card falhar): meta_video_id OU
--     meta_image_hash - o defeito de so olhar video foi corrigido aqui.
--   - se esta BLOQUEADA/EM REVISAO de compliance (pecas_em_revisao): aparece MARCADA, com motivo
--     e regra, nunca silenciada nem omitida.
--   - se ja foi usada em anuncio antes (approval_requests executado que aponta o drive_file_id).
-- HONESTIDADE: para video, o produto_detectado e INFERIDO da transcricao+frames (base
-- multiquadro/criterio) - a RPC declara produto_fonte='inferido'. Peca sem transcricao aparece
-- com transcricao_ausente=true (lacuna declarada, nunca estimada).
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
         and ar.executed_at is not null and (ar.execution_result->>'ok') = 'true') as ja_virou_anuncio,
    (select count(*) from public.approval_requests ar
       where ar.company_id = x.company_id and ar.action = 'criar_anuncio_a_partir_de'
         and ar.payload->>'drive_file_id' = x.drive_file_id) as tentativas_anuncio
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
    'apta_para_anuncio', m.apta,
    'apta_com_ressalva', (m.na_biblioteca_meta and m.em_revisao and not m.bloqueada),
    'na_biblioteca_da_meta', m.na_biblioteca_meta,
    'motivo_inapta', case when not m.na_biblioteca_meta
                          then 'nao esta na biblioteca da Meta (sem meta_video_id nem image_hash) - nao pode ser publicada assim; propor anuncio com ela faria o card falhar depois de aprovado'
                          when m.bloqueada then 'bloqueada por revisao de compliance (veja bloqueada_por_compliance)'
                          else null end,
    'produto', coalesce(m.produto_detectado,'nao classificado'),
    'produto_fonte', case when m.e_video then 'inferido da transcricao e dos frames (base '||coalesce(m.base_da_analise,'?')||')'
                          else 'leitura visual dos pixels (base '||coalesce(m.base_da_analise,'?')||')' end,
    'aproveitavel_visual', coalesce(m.aproveitavel,'nao classificado'),
    'analise_visual', left(m.motivo, 300),
    'texto_visivel', nullif(left(coalesce(m.texto_visivel,''),300),''),
    'transcricao_ausente', case when m.e_video and (m.transcricao_audio is null or length(m.transcricao_audio)=0) then true else null end,
    'o_que_diz_no_audio', case when m.transcricao_audio is not null and length(m.transcricao_audio)>0
                               then left(m.transcricao_audio, 600) || case when length(m.transcricao_audio)>600 then ' […]' else '' end
                               else null end,
    'bloqueada_por_compliance', case when m.em_revisao then jsonb_build_object(
        'bloqueia_uso', m.bloqueada,
        'motivo', m.rev_motivo,
        'regra', m.rev_regra,
        'aberto_em', m.rev_aberto_em,
        'aberto_por', m.rev_aberto_por,
        'evidencia', left(coalesce(m.rev_evidencia,''),240)
      ) else null end,
    'ja_usada_em_anuncio', m.ja_virou_anuncio,
    'tentativas_de_anuncio_no_sistema', m.tentativas_anuncio
  )) as item
  from marc m
  where p_incluir_inaptas or m.apta
)
select jsonb_build_object(
  'produto_filtrado', p_produto,
  'total_no_acervo_apos_filtro', (select count(*) from marc),
  'resumo', jsonb_build_object(
     'aptas_agora', (select count(*) from marc where apta),
     'aptas_com_ressalva_de_revisao', (select count(*) from marc where na_biblioteca_meta and em_revisao and not bloqueada),
     'bloqueadas_por_compliance', (select count(*) from marc where bloqueada),
     'fora_da_biblioteca_da_meta', (select count(*) from marc where not na_biblioteca_meta),
     'ja_usadas_em_anuncio', (select count(*) from marc where ja_virou_anuncio),
     'videos_sem_transcricao', (select count(*) from marc where e_video and (transcricao_audio is null or length(transcricao_audio)=0))),
  'como_usar', 'Este e o ACERVO do Drive disponivel para uso (peca que ainda NAO virou anuncio) - o oposto de get_criativos_conteudo, que le apenas os anuncios JA no ar (public.ads). Use ESTA ferramenta quando o gestor pedir para MONTAR anuncio novo, escolher peca ou saber o que o acervo tem para um produto. apta_para_anuncio=true significa que a peca esta na biblioteca da Meta E nao esta bloqueada por compliance. Peca com bloqueada_por_compliance presente aparece SEMPRE marcada - nunca a proponha sem declarar a revisao ao gestor. o_que_diz_no_audio e a transcricao real do video; se transcricao_ausente=true, declare a lacuna, nao estime. Para peca de video, produto e INFERIDO (veja produto_fonte).',
  'nota_honestidade', 'Para publicar de fato, ainda vale a doutrina: ler nota_visual_da_peca da candidata antes de emitir o card. ja_usada_em_anuncio reflete anuncios criados PELO SISTEMA (approval_requests) - anuncio criado manualmente fora do sistema nao aparece aqui.',
  'itens', coalesce((select jsonb_agg(item order by (item->>'apta_para_anuncio')::boolean desc, item->>'nome') from itens), '[]'::jsonb)
);
$$;

revoke all on function public.get_acervo_para_anuncio(uuid, text, boolean) from public, anon;
grant execute on function public.get_acervo_para_anuncio(uuid, text, boolean) to authenticated, service_role;