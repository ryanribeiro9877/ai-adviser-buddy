-- ESPELHO DE MIGRACAO APLICADA
-- version: 20260805175006
-- name: gt12_panorama_nao_colapsa_as_duas_coletas
-- projeto: gzjwnjdpxpbmdhcyefvs (Gestor de Trafego IA)
-- aplicada por: Claude via MCP apply_migration
-- espelho gerado a partir de supabase_migrations.schema_migrations - NAO transcrito a mao

-- GT-12 correcao 2 · o resumo do meu proprio panorama colapsava as duas coletas.
--
-- DEFEITO MEU, exposto pela primeira corrida da v14: o campo 'leitura' era calculado
-- SO sobre url_tags_coletado_em. Com 56 destinos gravados e 0 url_tags, ele afirmava
-- "NENHUM anuncio desta empresa teve a URL lida" - falso, e exatamente o pecado que
-- este card existe para combater: dois fatos distintos reduzidos a uma frase.
-- Agora cada coleta declara a sua propria situacao.
--
-- FATO PROVADO na corrida de 05/08 17:48 UTC, com a mensagem da propria Graph:
--   nivel ANUNCIO, campo url_tags  -> graph 400 (#100) "Tried accessing nonexisting field (url_tags)"
--   nivel CRIATIVO, campo url_tags -> campo VALIDO (57 respostas, sem erro), ausente nos 57
-- Logo: url_tags = 0 nao e falha de coleta. A conta nunca teve UTM configurada, e o
-- campo so existe no CRIATIVO, nao no anuncio. Quem quiser rotulo tem de ESCREVER (GT-13).

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
        ) r), '[]'::jsonb),
      'leitura', case
          when (select count(*) from base where url_tags_coletado_em is not null) = 0
            then 'Nenhum url_tags gravado. Provado em 05/08: o campo NAO EXISTE no nivel do anuncio (Graph 400 #100) e, no criativo, e campo valido porem ausente em 100% dos criativos. Portanto a conta nao tem UTM configurada - nao e falha de coleta.'
          else 'Ha url_tags gravado. Ver lido_com_rotulo.'
        end
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
        ) r), '[]'::jsonb),
      'leitura', case
          when (select count(*) from base where destino_url_coletado_em is null)
             = (select count(*) from base)
            then 'Nenhum destino lido.'
          else 'Lido em parte ou no todo. nunca_lido = anuncio em conta fora do alcance do token OU campo ausente na resposta - as duas coisas se distinguem pela telemetria da edge, nao por aqui.'
        end
    ),
    'limite_declarado', 'url_tags e o rotulo ENVIADO pelo anuncio e pode ser macro dinamica. Desempenho por rotulo (quantos leads por A/B/C) exige a ponta do destino, hoje vazia. O token alcanca 1 de 21 contas: anuncio de conta inacessivel permanece nunca_lido por construcao, nao por falha.'
  ) into v;

  return v;
end;
$$;