-- ESPELHO DE MIGRACAO APLICADA
-- version: 20260731181427
-- name: rpc_get_drive_analises
-- projeto: gzjwnjdpxpbmdhcyefvs (Gestor de Trafego IA)
-- aplicada por: Claude via MCP apply_migration
-- espelho gerado a partir de supabase_migrations.schema_migrations - NAO transcrito a mao

-- [v28.2 / job v2.3] Expor a analise visual PERSISTIDA como leitura barata.
--
-- MOTIVO (31/07/2026, segunda ocorrencia da mesma classe de bug): o pipeline de visao
-- classificou os 67 arquivos e gravou em drive_midia_analises - mas NENHUMA ferramenta
-- expunha a tabela. O chat sincrono respondeu "mega analise" por nome/pasta/data (o melhor
-- que as ferramentas dele permitiam) com os vereditos visuais ja prontos no banco.
-- LICAO: capacidade nova exige exposicao SIMETRICA (chat + job) do RESULTADO, nao so do
-- pipeline que o produz.

create or replace function public.get_drive_analises(p_company_id uuid)
returns jsonb
language sql
stable
as $$
select case when p_company_id is null then
  jsonb_build_object('erro', 'p_company_id e obrigatorio')
else (
  with a as (
    select nome, caminho, formato_pasta, eixo_pasta, produto_detectado, aproveitavel,
           motivo, nullif(riscos_compliance, '') as risco, base_da_analise, analisado_em::date as em
    from public.drive_midia_analises
    where company_id = p_company_id
    order by case aproveitavel when 'sim' then 1 when 'incerto' then 2 else 3 end, caminho, nome
  )
  select jsonb_build_object(
    'total_analisados', (select count(*) from a),
    'resumo', jsonb_build_object(
       'sim', (select count(*) from a where aproveitavel='sim'),
       'nao', (select count(*) from a where aproveitavel='nao'),
       'incerto', (select count(*) from a where aproveitavel='incerto')),
    'nota', 'Analise VISUAL persistida (pixels da miniatura em alta resolucao, feita pelo especialista de visao). base_da_analise=thumbnail: de video foi visto UM FRAME, nunca o interior - os INCERTO sao a lista curta para conferencia humana. Se total_analisados for menor que o inventario do Drive, pecas novas ainda nao passaram pela visao: peca a analise visual (analise profunda), nao invente veredito.',
    'itens', (select coalesce(jsonb_agg(to_jsonb(x)), '[]'::jsonb) from a x)
  )
)
end;
$$;

comment on function public.get_drive_analises(uuid) is
  'Vereditos da analise visual das midias do Drive (drive_midia_analises) para consumo por agente: resumo sim/nao/incerto + itens com produto detectado, motivo e risco. Leitura barata do trabalho ja persistido pelo pipeline de visao do job.';