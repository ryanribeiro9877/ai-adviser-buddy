-- ESPELHO DE MIGRACAO APLICADA
-- version: 20260804143210
-- name: gt11_estrutura_conjuntos_isolamento_e_paginacao
-- projeto: gzjwnjdpxpbmdhcyefvs (Gestor de Trafego IA)
-- aplicada por: Claude via MCP apply_migration
-- espelho gerado a partir de supabase_migrations.schema_migrations - NAO transcrito a mao

-- 04/08/2026 - GT-11, e o card estava atacando o sintoma errado.
--
-- O QUE O CARD DIZIA: "28 de 53 conjuntos seguem invisiveis - falta paginacao".
-- O QUE O BANCO MOSTRA: nao ha truncagem. A funcao declara total 54 e devolve 54 itens. Aquele
-- episodio de 28/07 foi o RELATORIO DO SUBAGENTE cortando em length, nao a funcao.
--
-- O DEFEITO REAL, ACHADO AGORA: get_estrutura_conjuntos() nao tem NENHUM filtro de empresa.
-- Devolve os 46 conjuntos da Legal e Viver junto com os 8 da COHAPM, sem marcacao. E o MESMO
-- vazamento corrigido no get_criativos_conteudo em 30/07 - quando a peca "La Felicita" da COHAPM
-- apareceu numa analise da Legal - e nunca replicado aqui. Analise de sobreposicao de publico e
-- de estrategia de lance feita sobre dois anunciantes distintos e conclusao sem valor.
--
-- DESENHO, em tres camadas:
--   (1) Sobrecarga COM p_company_id: e a que o chat passa a usar. Isola de verdade.
--   (2) A assinatura antiga SEM argumento e PRESERVADA para nao quebrar chamada existente, mas
--       passa a DECLARAR que mistura empresas - degradar avisando, nunca em silencio.
--   (3) Paginacao com campo 'restantes', no padrao do get_criativos_conteudo. Nao morde com 46
--       conjuntos, mas o teto existe antes de precisar dele.
-- E acrescento o que faltava e causou o achado errado de "100% dos conjuntos": a funcao passa a
-- declarar QUANTOS ficaram de fora do recorte e por que.

CREATE OR REPLACE FUNCTION public.get_estrutura_conjuntos(
  p_company_id uuid,
  p_offset integer DEFAULT 0,
  p_limit  integer DEFAULT 20
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
  -- "relevante" = em campanha ativa OU com gasto. Conjunto parado e sem gasto nao informa.
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
  'como_contar_certo', 'NUNCA diga "100% dos conjuntos" com base na lista desta pagina. Para afirmacao sobre o universo use total_conjuntos_da_empresa e relevantes; se restantes for maior que zero, PAGINE antes de concluir.',
  'limite_conhecido', 'nao ha historico de ALTERACOES de orcamento (change log): exigiria coletar o endpoint /activities da Graph API.'
);
$function$;

-- A antiga fica viva para nao quebrar chamada existente - mas confessa o que faz.
CREATE OR REPLACE FUNCTION public.get_estrutura_conjuntos()
RETURNS jsonb LANGUAGE sql STABLE AS $function$
select public.get_estrutura_conjuntos(null::uuid, 0, 200)
       || jsonb_build_object(
         'AVISO_CRITICO', 'Esta chamada foi feita SEM empresa e por isso NAO devolveu nada. '
           || 'A versao sem filtro misturava conjuntos de empresas diferentes na mesma lista '
           || '(46 da Legal e Viver com 8 da COHAPM em 04/08/2026), o que invalida qualquer analise '
           || 'de sobreposicao de publico ou de estrategia de lance. Chame get_estrutura_conjuntos '
           || 'passando o company_id da empresa da conversa.');
$function$;

GRANT EXECUTE ON FUNCTION public.get_estrutura_conjuntos(uuid, integer, integer) TO authenticated, service_role;