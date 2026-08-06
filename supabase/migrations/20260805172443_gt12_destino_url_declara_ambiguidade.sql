-- ESPELHO DE MIGRACAO APLICADA
-- version: 20260805172443
-- name: gt12_destino_url_declara_ambiguidade
-- projeto: gzjwnjdpxpbmdhcyefvs (Gestor de Trafego IA)
-- aplicada por: Claude via MCP apply_migration
-- espelho gerado a partir de supabase_migrations.schema_migrations - NAO transcrito a mao

-- GT-12 correcao · destino_url tambem precisa declarar a propria cegueira.
--
-- DEFEITO MEU, achado pelo Code: na migracao 20260805171038 eu criei ads.destino_url
-- sem par de leitura. Como a coleta so grava quando ha UMA url inequivoca (regra do
-- Code, correta), destino_url IS NULL passaria a significar tres coisas distintas:
--   (a) nunca lido, (b) lido e o anuncio nao tem destino, (c) lido e ha MAIS DE UM
--       destino candidato (asset_feed_spec com varias link_urls).
-- Colapsar (a), (b) e (c) e o mesmo erro que o url_tags_coletado_em existe para evitar,
-- e o mesmo erro do `?? null` que o Code encontrou na upload-midia.
--
-- Guardar as candidatas cruas segue a licao "Graph ignora modificador desconhecido em
-- silencio - guardar amostra crua": quando houver ambiguidade, quem decide e humano,
-- e ele precisa da evidencia, nao do veredito.

alter table public.ads
  add column if not exists destino_url_coletado_em timestamptz,
  add column if not exists destino_url_situacao text,
  add column if not exists destino_url_candidatas jsonb;

alter table public.ads
  drop constraint if exists ads_destino_url_situacao_check;

alter table public.ads
  add constraint ads_destino_url_situacao_check
  check (destino_url_situacao is null
         or destino_url_situacao in ('unica', 'ambigua', 'ausente'));

comment on column public.ads.destino_url_coletado_em is
  'Quando a Graph foi lida em busca do destino. NULL = nunca lido.';
comment on column public.ads.destino_url_situacao is
  'unica = uma URL inequivoca (gravada em destino_url) | ambigua = mais de uma candidata (ver destino_url_candidatas, destino_url fica NULL) | ausente = lido e o anuncio nao expoe destino. NULL = nunca lido.';
comment on column public.ads.destino_url_candidatas is
  'Evidencia crua quando situacao = ambigua: array das URLs encontradas, como vieram da Graph.';

-- Panorama atualizado: agora responde pelas DUAS coletas, cada uma declarando o que
-- nao sabe. Mantida a exigencia de company_id e a ausencia de SECURITY DEFINER.
create or replace function public.panorama_utm_anuncios(p_company_id uuid)
returns jsonb
language plpgsql
stable
as $$
declare
  v jsonb;
begin
  if p_company_id is null then
    raise exception 'panorama_utm_anuncios exige p_company_id (leitura sem filtro de empresa e proibida neste projeto)';
  end if;

  with base as (
    select a.url_tags, a.url_tags_coletado_em,
           a.destino_url, a.destino_url_coletado_em, a.destino_url_situacao,
           public.ler_url_tags(a.url_tags) as tags
    from public.ads a
    where a.company_id = p_company_id
  )
  select jsonb_build_object(
    'company_id', p_company_id,
    'anuncios', (select count(*) from base),
    'url_tags', jsonb_build_object(
      'nunca_lido', (select count(*) from base where url_tags_coletado_em is null),
      'lido_sem_rotulo', (select count(*) from base
                          where url_tags_coletado_em is not null and coalesce(url_tags, '') = ''),
      'lido_com_rotulo', (select count(*) from base
                          where url_tags_coletado_em is not null and coalesce(url_tags, '') <> ''),
      'rotulos', coalesce((
        select jsonb_agg(r) from (
          select tags->>'utm_campaign' as utm_campaign,
                 tags->>'utm_content'  as utm_content,
                 tags->>'utm_source'   as utm_source,
                 count(*)              as anuncios
          from base
          where tags is not null and tags <> '{}'::jsonb
          group by 1, 2, 3
          order by 4 desc
        ) r), '[]'::jsonb)
    ),
    'destino', jsonb_build_object(
      'nunca_lido', (select count(*) from base where destino_url_coletado_em is null),
      'unica', (select count(*) from base where destino_url_situacao = 'unica'),
      'ambigua', (select count(*) from base where destino_url_situacao = 'ambigua'),
      'ausente', (select count(*) from base where destino_url_situacao = 'ausente'),
      'urls', coalesce((
        select jsonb_agg(r) from (
          select destino_url, count(*) as anuncios
          from base where destino_url is not null
          group by 1 order by 2 desc
        ) r), '[]'::jsonb)
    ),
    'leitura', case
        when (select count(*) from base where url_tags_coletado_em is not null) = 0
          then 'NENHUM anuncio desta empresa teve a URL lida. Nao e "sem UTM": e nao coletado.'
        else 'Parcial ou total. Ver nunca_lido em cada bloco.'
      end,
    'limite_declarado', 'url_tags e o rotulo ENVIADO pelo anuncio e pode ser macro dinamica. Desempenho por rotulo (quantos leads por A/B/C) exige a ponta do destino, que hoje esta vazia. Alem disso o token alcanca 1 conta de ~21: anuncio de conta fora do alcance permanece nunca_lido por construcao, nao por falha.'
  ) into v;

  return v;
end;
$$;
