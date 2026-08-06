-- ESPELHO DE MIGRACAO APLICADA
-- version: 20260731182618
-- name: compactar_get_drive_analises
-- projeto: gzjwnjdpxpbmdhcyefvs (Gestor de Trafego IA)
-- aplicada por: Claude via MCP apply_migration
-- espelho gerado a partir de supabase_migrations.schema_migrations - NAO transcrito a mao

-- [FIX] get_drive_analises COMPACTA - os 67 vereditos precisam caber INTEIROS no teto de
-- payload da ferramenta (~14k chars), senao o corte reaparece exatamente na tool criada
-- para elimina-lo (aconteceu na primeira sonda: ~36 de 67 linhas chegaram).
-- Mudancas: itens carregam so o essencial (arquivo com caminho, produto, veredito de 1
-- letra, motivo encurtado, risco so quando existe); texto_visivel e detalhes ficam FORA da
-- lista (existem na tabela; quem precisar do texto de uma peca especifica pede recorte).
-- Legenda do veredito declarada na nota. Medido apos compactar: ~8k chars para 67 itens.

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
           upper(left(aproveitavel,1)) as v,          -- S / N / I
           left(motivo, 90) as motivo,
           nullif(left(coalesce(riscos_compliance,''), 70), '') as risco
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
    'nota', 'Analise VISUAL persistida (pixels da miniatura em alta resolucao). v: S=aproveitavel, N=nao, I=incerto. De video foi visto UM FRAME - os I sao a lista de conferencia humana, nao reprovacao. Se total_analisados < inventario do Drive, pecas novas ainda nao passaram pela visao: declare, nao invente. O texto visivel de cada peca existe no banco; peca recorte de uma peca especifica se precisar.',
    'itens', (select coalesce(jsonb_agg(to_jsonb(x)), '[]'::jsonb) from a x)
  )
)
end;
$$;

select length((public.get_drive_analises((select id from companies where name ilike '%legal%')))::text) as tamanho_payload,
       (public.get_drive_analises((select id from companies where name ilike '%legal%')))->'resumo' as resumo;