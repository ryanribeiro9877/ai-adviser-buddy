-- ESPELHO DE MIGRACAO APLICADA
-- version: 20260805171038
-- name: gt12_coleta_url_tags_ponta_meta
-- projeto: gzjwnjdpxpbmdhcyefvs (Gestor de Trafego IA)
-- aplicada por: Claude via MCP apply_migration
-- espelho gerado a partir de supabase_migrations.schema_migrations - NAO transcrito a mao

-- GT-12 · Ponta da Meta da leitura do teste A/B/C.
--
-- POR QUÊ: hoje o sistema nao guarda em lugar nenhum o rotulo de rastreio que o
-- proprio anuncio envia na URL. Consequencia: o sistema criou 3 campanhas de teste
-- e e cego para a propria configuracao delas. Windsor recusa o campo, logo a coleta
-- tem de ser Graph direto (mesma rota do GT-09 Rota B).
--
-- SEMANTICA DE IGNORANCIA (licao de GT-09 e GT-40/41/42 - UNKNOWN nao e NULL):
--   url_tags_coletado_em IS NULL      -> NUNCA foi lido. O sistema declara que nao sabe.
--   url_tags_coletado_em preenchido
--     e url_tags = ''                 -> foi lido e o anuncio REALMENTE nao tem rotulo.
--     e url_tags <> ''                -> foi lido e tem rotulo.
-- Sem essa distincao, "sem UTM" e "nao coletado" viram a mesma coisa e o sistema
-- mente por omissao.
--
-- LIMITE DECLARADO: url_tags e o que o anuncio ENVIA, e pode ser macro dinamica
-- ({{campaign.name}}). Nao prova recebimento. Quantos leads chegaram por rotulo
-- so existe na ponta do destino (proposals, hoje com 0 linhas).

alter table public.ads
  add column if not exists url_tags text,
  add column if not exists url_tags_coletado_em timestamptz,
  add column if not exists destino_url text;

comment on column public.ads.url_tags is
  'Rotulo de rastreio que o anuncio envia na URL, cru, como veio da Graph. Pode conter macro dinamica. NULL + url_tags_coletado_em NULL = nunca lido.';
comment on column public.ads.url_tags_coletado_em is
  'Quando a Graph foi lida para este anuncio. NULL = nunca lido (declara ignorancia, nao ausencia).';
comment on column public.ads.destino_url is
  'URL de destino efetiva do anuncio (call_to_action.value.link). Hoje esse dado nao existe em nenhuma tabela - ver GT-13.';

-- Parser: url_tags cru -> jsonb. Nao decodifica percent-encoding e nao resolve macro:
-- guardar cru e declarar e mais honesto do que normalizar e perder a evidencia.
create or replace function public.ler_url_tags(p_url_tags text)
returns jsonb
language sql
immutable
as $$
  select case
    when p_url_tags is null then null
    when btrim(p_url_tags) = '' then '{}'::jsonb
    else coalesce((
      select jsonb_object_agg(
               split_part(par, '=', 1),
               nullif(substr(par, strpos(par, '=') + 1), '')
             )
      from unnest(string_to_array(btrim(p_url_tags, '?& '), '&')) as par
      where par <> '' and strpos(par, '=') > 1
    ), '{}'::jsonb)
  end;
$$;

comment on function public.ler_url_tags(text) is
  'GT-12: parseia url_tags cru em jsonb. NULL entra NULL sai (nunca lido); string vazia vira {} (lido e vazio).';

-- Panorama por empresa. Company_id OBRIGATORIO: a lacuna que gerou 4 vazamentos
-- entre empresas foi exatamente funcao de leitura sem filtro.
-- Sem SECURITY DEFINER de proposito: a RLS do chamador continua valendo.
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
    select a.url_tags, a.url_tags_coletado_em, public.ler_url_tags(a.url_tags) as tags
    from public.ads a
    where a.company_id = p_company_id
  )
  select jsonb_build_object(
    'company_id', p_company_id,
    'anuncios', (select count(*) from base),
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
          then 'NENHUM anuncio desta empresa teve a URL lida. Nao e "sem UTM": e nao coletado.'
        else 'Parcial ou total. Ver nunca_lido.'
      end,
    'limite_declarado', 'url_tags e o rotulo ENVIADO pelo anuncio e pode ser macro dinamica. Desempenho por rotulo (quantos leads por A/B/C) exige a ponta do destino, que hoje esta vazia.'
  ) into v;

  return v;
end;
$$;

comment on function public.panorama_utm_anuncios(uuid) is
  'GT-12: responde se o teste A/B/C e legivel pela ponta da Meta, distinguindo nao-coletado de sem-rotulo, e declara o proprio limite.';
