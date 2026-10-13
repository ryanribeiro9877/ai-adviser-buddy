-- espelho para git — NÃO re-executar. Aplicado em gestão_marketing via apply_migration
-- 20261013160000_dia_a_dia_no_relatorio
--
-- SQL fiel ao arquivo em supabase/migrations/.

-- Dia a dia por campanha, conjunto e criativo no relatorio autonomo (13/10/2026)
--
-- POR QUE: o relatorio semanal da Lafelicita LP afirmou 0 formularios de 06 a 12/10 quando a
-- Meta registrou 63 (o coletor nao lia o SubmitApplication da LP; corrigido no
-- pipeboard-metrics-sync). O total errado passou porque nada no relatorio mostrava em que dia e
-- em qual peca o resultado acontecia. A secao nova abre cada dia da janela, separado, nos tres
-- niveis, com o total no fim. O catalogo SQL precisa conhecer a chave: o check de
-- relatorio_agendamentos e relatorio_gerados recusa secao que nao esta aqui.
--
-- Agendas que ja pediam leitura por campanha ganham a secao logo depois da Quebra por campanha,
-- na mesma ordem do catalogo do front (src/lib/relatorios.ts).

create or replace function public.secoes_relatorio_conhecidas()
returns text[]
language sql
immutable
as $$
  select array[
    'resumo_executivo','status_entrega','investimento_pacing','custo_vs_teto',
    'funil_midia','por_campanha','dia_a_dia','por_conjunto','criativos_ranking','conjuntos_ranking','fadiga',
    'diagnostico_custo','escala','alertas','recomendacoes','compliance',
    'comparativo','whatsapp','cobertura','opiniaoes'
  ]::text[];
$$;

update public.relatorio_agendamentos a
set secoes = a.secoes[1:array_position(a.secoes, 'por_campanha')]
  || array['dia_a_dia']::text[]
  || coalesce(a.secoes[array_position(a.secoes, 'por_campanha') + 1 :], '{}'::text[])
where 'por_campanha' = any(a.secoes)
  and not ('dia_a_dia' = any(a.secoes));
