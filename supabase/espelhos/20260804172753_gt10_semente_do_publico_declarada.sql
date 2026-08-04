-- ESPELHO DE MIGRACAO APLICADA
-- version: 20260804172753
-- name: gt10_semente_do_publico_declarada
-- projeto: gzjwnjdpxpbmdhcyefvs (Gestor de Trafego IA)
-- aplicada por: Claude via MCP apply_migration
-- espelho gerado a partir de supabase_migrations.schema_migrations - NAO transcrito a mao

-- 04/08/2026 - GT-10 FECHADO. Semente dos publicos semelhantes declarada pelo gestor.
INSERT INTO agent_context (categoria, fato, vigente, desde, atualizado, company_id)
VALUES ('contexto',
  'SEMENTE DOS PUBLICOS SEMELHANTES - DECLARADA PELO GESTOR EM 04/08/2026: os "Leads Convertidos" '
  || 'que semearam a familia de publicos semelhantes da conta sao de CLT APENAS. Palavras do Roberto, '
  || 'via Ryan: "CLT apenas". '
  || 'A FAMILIA E: [LEV] LAL 1% / 2% / 3% / 5% Leads Convertidos BR (ids 120251372755580191, '
  || '120252877913750191, 120252877913840191, 120253152558060191) - quatro percentuais da MESMA semente. '
  || 'Mais o [LEV] Visitantes Site 30d, que e retargeting e nao semelhante. 11 conjuntos da conta usam '
  || 'algum semelhante desta familia. '
  || 'CONSEQUENCIA: o molde C7-LAL1%-R06 esta ALINHADO com o produto vigente (CLT exclusivo desde '
  || '30/07/2026). O risco de o teste A/B/C rodar sobre publico do produto antigo esta AFASTADO. '
  || 'DUAS CAMADAS, NAO SOBRESCRITA: isto e DECLARACAO HUMANA, nao leitura da plataforma. Ninguem abriu '
  || 'o campo "Origem" do publico no Gerenciador para confirmar de qual publico de origem ele foi gerado. '
  || 'Se algum dia essa leitura for feita e mostrar semente de consignado ou INSS, registre como '
  || 'DIVERGENCIA DECLARADA - nao apague a declaracao do gestor nem finja que a maquina sempre soube. '
  || 'E ja esta provado, por criacao real em 04/08, que publico semelhante SOBREVIVE a categoria especial '
  || 'financeira: a Meta manteve o LAL 1% no conjunto 120254208284780191, conferido na tela.',
  true, '2026-08-04', now(), 'ded20b38-f42e-4c71-800c-31b97ea48bcf');