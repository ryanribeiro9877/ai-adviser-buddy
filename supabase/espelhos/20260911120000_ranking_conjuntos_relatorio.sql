-- espelho para git — NÃO re-executar. Aplicado em gestão_marketing via apply_migration
-- 20260911120000_ranking_conjuntos_relatorio
--
-- SQL fiel ao arquivo em supabase/migrations/.

-- Ranking de conjuntos no relatorio autonomo (11/09/2026)
--
-- POR QUE: o gestor pedia ranking de pecas e nao via a mesma leitura no nivel
-- certo da estrutura (conjunto). A secao entra no catalogo; agendas que ja
-- pediam criativos ou quebra por conjunto passam a gerar a tabela completa.

create or replace function public.secoes_relatorio_conhecidas()
returns text[]
language sql
immutable
as $$
  select array[
    'resumo_executivo','status_entrega','investimento_pacing','custo_vs_teto',
    'funil_midia','por_campanha','por_conjunto','criativos_ranking','conjuntos_ranking','fadiga',
    'diagnostico_custo','escala','alertas','recomendacoes','compliance',
    'comparativo','whatsapp','cobertura','opiniaoes'
  ]::text[];
$$;

update public.relatorio_agendamentos a
set secoes = (
  case
    when 'conjuntos_ranking' = any(a.secoes) then a.secoes
    when array_position(a.secoes, 'criativos_ranking') is not null then
      a.secoes[1:array_position(a.secoes, 'criativos_ranking')]
      || array['conjuntos_ranking']::text[]
      || coalesce(a.secoes[array_position(a.secoes, 'criativos_ranking') + 1 :], '{}'::text[])
    when array_position(a.secoes, 'por_conjunto') is not null then
      a.secoes[1:array_position(a.secoes, 'por_conjunto')]
      || array['conjuntos_ranking']::text[]
      || coalesce(a.secoes[array_position(a.secoes, 'por_conjunto') + 1 :], '{}'::text[])
    else a.secoes
  end
)
where a.secoes && array['criativos_ranking','por_conjunto']::text[]
  and not ('conjuntos_ranking' = any(a.secoes));
