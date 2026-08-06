-- ESPELHO DE MIGRACAO APLICADA
-- version: 20260731184615
-- name: compactar3_get_drive_analises
-- projeto: gzjwnjdpxpbmdhcyefvs (Gestor de Trafego IA)
-- aplicada por: Claude via MCP apply_migration
-- espelho gerado a partir de supabase_migrations.schema_migrations - NAO transcrito a mao

-- [FIX] 14.9k > teto 14k. So EXCECOES viajam por item: 'sem_aprovacao' so quando g=false
-- (hoje: nenhum), 'div' so quando ha divergencia. O padrao (aprovado, sem divergencia)
-- e declarado uma vez na nota, nao 67 vezes nos itens.
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
           case when not aprovado_pelo_gestor then true end as sem_aprovacao,
           case when aprovado_pelo_gestor and aproveitavel = 'nao' then true end as div,
           case when aproveitavel in ('sim','incerto') then left(motivo, 70) end as motivo,
           nullif(left(coalesce(riscos_compliance,''), 55), '') as risco,
           aprovado_pelo_gestor as g_calc, aproveitavel as ap_calc
    from public.drive_midia_analises
    where company_id = p_company_id
    order by case aproveitavel when 'sim' then 1 when 'incerto' then 2 else 3 end, caminho, nome
  )
  select jsonb_build_object(
    'total_analisados', (select count(*) from a),
    'resumo', jsonb_build_object(
       'aprovados_pelo_gestor', (select count(*) from a where g_calc),
       'visual_sim', (select count(*) from a where v='S'),
       'visual_nao', (select count(*) from a where v='N'),
       'visual_incerto', (select count(*) from a where v='I'),
       'divergencias', (select count(*) from a where div)),
    'nota', 'DUAS CAMADAS. (1) OPERACIONAL: por decisao do gestor (audio 31/07 - acervo inteiro avaliado por copy e gestor de trafego, ordem de usar todos), TODA peca listada esta APROVADA para uso, salvo as marcadas sem_aprovacao=true (pecas novas ainda sem decisao humana). Ao operar, cite a decisao e a data. (2) VISUAL (informacao, nunca veto): v S/N/I = o que os pixels mostram. div=true significa: liberada MAS o visual aparenta OUTRO produto - DECLARE isso como nota ao recomendar, nunca esconda nem recuse. Universo criativo da marca: credito CLT + educacao financeira + dicas de seguranca. Texto visivel por peca existe no banco.',
    'itens', (select coalesce(jsonb_agg(jsonb_strip_nulls(to_jsonb(x) - 'g_calc' - 'ap_calc')), '[]'::jsonb) from a x)
  )
)
end;
$$;

select length((public.get_drive_analises((select id from companies where name ilike '%legal%')))::text) as tamanho_final,
       (public.get_drive_analises((select id from companies where name ilike '%legal%')))->'resumo' as resumo;