-- ESPELHO DE MIGRACAO APLICADA
-- version: 20260804144452
-- name: gt11_pagina_16_alinha_com_teto_de_chamadas
-- projeto: gzjwnjdpxpbmdhcyefvs (Gestor de Trafego IA)
-- aplicada por: Claude via MCP apply_migration
-- espelho gerado a partir de supabase_migrations.schema_migrations - NAO transcrito a mao

-- 04/08/2026 - GT-11, ajuste final apos medicao do Code no payload real.
--
-- MEDIDO POR ELE: pagina de 20 = 11.157 bytes; TETO_TOOL_JSON do cortarLista = 11.500. Margem
-- de 343 bytes, menos de um item (item medio = 472 bytes). Se o payload crescer, o cortarLista
-- passa 19 e declara omitidos:1 enquanto a RPC diz nesta_pagina:20 - DOIS NUMEROS DISCORDANDO
-- no mesmo payload, e um terceiro conceito de "faltando" ao lado dos dois que ja existem.
--
-- ELE PROPOS p_limit 15. NAO USO 15, e o motivo e aritmetico: MAX_POR_FERRAMENTA para esta tool
-- e 3 chamadas. Com 46 conjuntos relevantes, 15 por pagina exige QUATRO paginas - o agente
-- ficaria estruturalmente impedido de ver o universo, que e exatamente o defeito que o GT-11
-- existe para matar, so trocando a causa de "sem filtro" para "sem chamada".
--   15 por pagina -> 46/15 = 3,07 -> 4 paginas -> NAO cabe em 3 chamadas
--   16 por pagina -> 46/16 = 2,88 -> 3 paginas -> CABE, com margem de ~2.200 bytes (4 itens)
-- 16 e o maior valor que cobre o universo dentro do teto de chamadas E mantem o corte inerte.
--
-- LIMITE DECLARADO: 3 chamadas x 16 = 48 conjuntos. Acima disso o universo volta a nao caber,
-- e a instrucao abaixo obriga o agente a DECLARAR que nao leu tudo em vez de concluir.
CREATE OR REPLACE FUNCTION public.get_estrutura_conjuntos(
  p_company_id uuid,
  p_offset integer DEFAULT 0,
  p_limit  integer DEFAULT 16
) RETURNS jsonb LANGUAGE sql STABLE AS $function$
with cj as (
  select s.name as conjunto, s.status, s.bid_strategy,
         s.daily_budget, s.lifetime_budget,
         c.name as campanha, c.status as campanha_status,
         round(coalesce(s.spend,0)::numeric,2) as gasto, s.form_leads,
         case when s.daily_budget is null and s.lifetime_budget is null
              then 'orcamento na CAMPANHA (indicio de CBO/Advantage)'
              else 'orcamento no CONJUNTO (indicio de ABO)' end as leitura_orcamento,
         (s.targeting is not null) as tem_targeting,
         s.targeting->'geo_locations'->'countries' as paises,
         s.targeting->>'age_min' as idade_min,
         s.targeting->>'age_max' as idade_max,
         s.targeting->'flexible_spec' as interesses,
         s.targeting->'custom_audiences' as publicos_personalizados
    from public.ad_sets s
    left join public.campaigns c on c.id = s.campaign_id
   where coalesce(s.company_id, c.company_id) = p_company_id
), rel as (
  select * from cj where campanha_status = 'active' or gasto > 0
), pag as (
  select * from rel order by gasto desc, conjunto limit greatest(p_limit,1) offset greatest(p_offset,0)
)
select jsonb_build_object(
  'total_conjuntos_da_empresa', (select count(*) from cj),
  'relevantes', (select count(*) from rel),
  'omitidos_por_irrelevancia', (select count(*) from cj) - (select count(*) from rel),
  'motivo_da_omissao', 'conjunto em campanha pausada E sem gasto no periodo coletado',
  'pagina_offset', greatest(p_offset,0),
  'pagina_tamanho', greatest(p_limit,1),
  'nesta_pagina', (select count(*) from pag),
  'restantes', greatest((select count(*) from rel) - greatest(p_offset,0) - (select count(*) from pag), 0),
  'em_campanha_ativa', (select count(*) from cj where campanha_status = 'active'),
  'resumo_orcamento', (select jsonb_object_agg(leitura_orcamento, n) from (select leitura_orcamento, count(*) as n from rel group by 1) z),
  'conjuntos', coalesce((select jsonb_agg(to_jsonb(pag) order by pag.gasto desc) from pag), '[]'::jsonb),
  'nota', 'Esta leitura e de UMA empresa. bid_strategy e a presenca/ausencia de orcamento no conjunto indicam CBO vs ABO. targeting traz pais, faixa de idade, interesses e publicos personalizados conforme coletado.',
  'como_contar_certo', 'Tres coisas diferentes podem faltar, nao confunda: omitidos_por_irrelevancia sao conjuntos fora do recorte (campanha pausada e sem gasto); restantes sao os das paginas seguintes; e um eventual aviso de corte no envelope da ferramenta significa que a pagina nao caberia inteira. '
    || 'REGRA: para qualquer afirmacao sobre o universo use total_conjuntos_da_empresa e relevantes, nunca a contagem desta pagina. Se restantes for maior que zero, PAGINE. '
    || 'E se voce nao conseguir paginar ate restantes chegar a zero - por limite de chamadas ou qualquer outro motivo - DECLARE que leu apenas parte e diga quantos ficaram, em vez de dar percentual. Leitura parcial apresentada como universo foi como nasceu o achado errado de "100% dos conjuntos sem cost cap".',
  'limite_conhecido', 'nao ha historico de ALTERACOES de orcamento (change log): exigiria coletar o endpoint /activities da Graph API.'
);
$function$;