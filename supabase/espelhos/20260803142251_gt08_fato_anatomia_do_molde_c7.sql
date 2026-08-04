-- ESPELHO DE MIGRACAO APLICADA
-- version: 20260803142251
-- name: gt08_fato_anatomia_do_molde_c7
-- projeto: gzjwnjdpxpbmdhcyefvs (Gestor de Trafego IA)
-- aplicada por: Claude via MCP apply_migration
-- espelho gerado a partir de supabase_migrations.schema_migrations - NAO transcrito a mao

-- 03/08/2026 - GT-08. Achado do ensaio em dry_run dos degraus 2 e 3 da escada de criacao.
-- Nada foi escrito na Meta: 2 simulacoes, 0 execucoes. Cards sinteticos apagados, dry_run restaurado.
INSERT INTO agent_context (categoria, fato, vigente, desde, atualizado, company_id)
VALUES ('contexto',
  'ANATOMIA DO MOLDE DE CONJUNTO E DE ANUNCIO - MEDIDA POR ENSAIO EM DRY_RUN (03/08/2026, nada criado na Meta). '
  || 'MOLDE DE REFERENCIA: conjunto "[LP][C3-REELS] Advantage+ BR - Dynamic Video [C7-LAL1%-R06]", '
  || 'external_id 120251373799340191. O que ele carrega e o que seria REPLICADO em qualquer conjunto novo: '
  || 'optimization_goal OFFSITE_CONVERSIONS; billing_event IMPRESSIONS; bid_strategy LOWEST_COST_WITHOUT_CAP (sem teto de custo); '
  || 'destination_type WEBSITE; promoted_object = pixel 26963641603232240 com evento LEAD; '
  || 'targeting com idade 18 a 65 e SEM segmentacao de genero (compativel com categoria especial); '
  || 'targeting_automation e targeting_relaxation_types (recursos Advantage+); e - ponto critico - '
  || 'custom_audiences com UM publico semelhante: "[LEV] LAL 1% Leads Convertidos BR", id 120251372755580191. '
  || 'RISCO ABERTO E NAO RESOLVIDO: esse publico semelhante seria replicado para dentro de campanha que o sistema '
  || 'declara como FINANCIAL_PRODUCTS_SERVICES. Categoria especial restringe uso de publico semelhante, e a Meta pode '
  || 'RECUSAR o conjunto ou - pior - aceitar e DESCARTAR o publico em silencio, fazendo o teste rodar em publico aberto '
  || 'sem ninguem perceber. Ao propor conjunto a partir deste molde, DECLARE esse risco e guarde a resposta crua da Meta. '
  || 'SEGUNDO RISCO, independente do primeiro: o semelhante foi semeado em "Leads Convertidos" ANTERIORES a decisao de '
  || 'produto exclusivo CLT (30/07/2026), logo pode representar publico do produto antigo. Semente do publico e decisao '
  || 'do gestor, nunca inferencia sua. '
  || 'ORCAMENTO NAO SE HERDA: o molde tem R$ 312,00/dia, e o card sobrescreve com o valor pedido (provado: R$ 60,00 saiu '
  || 'como 6000 centavos). Nunca afirme que o conjunto novo herda o orcamento do molde. '
  || 'CRIATIVO - BOA NOTICIA PROVADA: apesar de o molde ser Advantage+ Dynamic Video, o criativo 1989324685053250 EXPOE '
  || 'object_story_spec. Logo o anuncio novo nasce com um adcreative NOVO e as UTMs SAO aplicadas (url_tags entra no corpo). '
  || 'O caminho degradado que reusa o criativo antigo e perde a UTM existe no codigo, mas NAO e acionado por este molde. '
  || 'Se um dia o molde mudar para um criativo sem object_story_spec, o sistema avisa - e o aviso deve ser lido, nao ignorado. '
  || 'CONTRATO CONFIRMADO NO ENSAIO: conjunto e anuncio nasceriam com status ACTIVE nos dois degraus.',
  true, '2026-08-03', now(), 'ded20b38-f42e-4c71-800c-31b97ea48bcf');