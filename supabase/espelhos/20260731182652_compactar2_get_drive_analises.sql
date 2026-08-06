-- ESPELHO DE MIGRACAO APLICADA
-- version: 20260731182652
-- name: compactar2_get_drive_analises
-- projeto: gzjwnjdpxpbmdhcyefvs (Gestor de Trafego IA)
-- aplicada por: Claude via MCP apply_migration
-- espelho gerado a partir de supabase_migrations.schema_migrations - NAO transcrito a mao

-- [FIX 2] Ainda 16.4k > teto de 14k. Compressao dirigida: motivo so onde ele decide
-- (S e I); nos N o produto detectado JA E o motivo ("financiamento" explica o nao).
create or replace function public.get_drive_analises(p_company_id uuid)
returns jsonb
language sql
stable
as $$
select case when p_company_id is null then
  jsonb_build_object('erro', 'p_company_id e obrigatorio')
else (
  with a as (
    select (coalesce(caminho,'') || '/' || nome) as arquivo,
           produto_detectado as produto,
           upper(left(aproveitavel,1)) as v,
           case when aproveitavel in ('sim','incerto') then left(motivo, 80) end as motivo,
           nullif(left(coalesce(riscos_compliance,''), 60), '') as risco
    from public.drive_midia_analises
    where company_id = p_company_id
    order by case aproveitavel when 'sim' then 1 when 'incerto' then 2 else 3 end, caminho, nome
  )
  select jsonb_build_object(
    'total_analisados', (select count(*) from a),
    'resumo', jsonb_build_object(
       'sim', (select count(*) from a where v='S'),
       'nao', (select count(*) from a where v='N'),
       'incerto', (select count(*) from a where v='I')),
    'nota', 'Analise VISUAL persistida (pixels da miniatura). v: S=aproveitavel, N=nao (o campo produto explica: peca de outro produto), I=incerto (video visto por UM FRAME - lista de conferencia humana, nao reprovacao). Se total_analisados < inventario, pecas novas nao passaram pela visao: declare, nao invente. Texto visivel por peca existe no banco - peca recorte se precisar.',
    'itens', (select coalesce(jsonb_agg(jsonb_strip_nulls(to_jsonb(x))), '[]'::jsonb) from a x)
  )
)
end;
$$;

select length((public.get_drive_analises((select id from companies where name ilike '%legal%')))::text) as tamanho_final;