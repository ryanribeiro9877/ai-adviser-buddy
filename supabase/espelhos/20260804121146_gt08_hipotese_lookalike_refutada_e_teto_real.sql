-- ESPELHO DE MIGRACAO APLICADA
-- version: 20260804121146
-- name: gt08_hipotese_lookalike_refutada_e_teto_real
-- projeto: gzjwnjdpxpbmdhcyefvs (Gestor de Trafego IA)
-- aplicada por: Claude via MCP apply_migration
-- espelho gerado a partir de supabase_migrations.schema_migrations - NAO transcrito a mao

-- 04/08/2026 - Prova real do degrau 2 (conjunto 120254208284780191) respondeu duas perguntas
-- abertas e revelou uma terceira. Fonte: tela do Gerenciador conferida pelo Ryan em 04/08.

-- (1) Atualiza o fato da anatomia do molde: o risco do publico semelhante era HIPOTESE e foi REFUTADO.
UPDATE agent_context SET
  atualizado = now(),
  fato = replace(fato,
    'RISCO ABERTO E NAO RESOLVIDO: esse publico semelhante seria replicado para dentro de campanha que o sistema '
    || 'declara como FINANCIAL_PRODUCTS_SERVICES. Categoria especial restringe uso de publico semelhante, e a Meta pode '
    || 'RECUSAR o conjunto ou - pior - aceitar e DESCARTAR o publico em silencio, fazendo o teste rodar em publico aberto '
    || 'sem ninguem perceber. Ao propor conjunto a partir deste molde, DECLARE esse risco e guarde a resposta crua da Meta.',
    'RISCO RESOLVIDO EM 04/08/2026 - HIPOTESE REFUTADA POR PROVA REAL: o conjunto 120254208284780191 foi criado a '
    || 'partir deste molde dentro de campanha FINANCIAL_PRODUCTS_SERVICES e a Meta MANTEVE o publico semelhante. '
    || 'Conferido na tela do Gerenciador: secao Publico mostra "Publicos personalizados > Semelhante > [LEV] LAL 1% '
    || 'Leads Convertidos BR", com Brasil, idade 18-65 e genero Todos. Nao houve recusa nem descarte silencioso. '
    || 'Publico semelhante PODE ser usado em campanha de categoria especial de credito nesta conta.')
WHERE fato LIKE '%ANATOMIA DO MOLDE%';

-- (2) FATO NOVO E OPERACIONALMENTE IMPORTANTE: orcamento diario nao e teto diario.
INSERT INTO agent_context (categoria, fato, vigente, desde, atualizado, company_id)
VALUES ('metodo',
  'ORCAMENTO DIARIO NAO E TETO DIARIO - LIDO NA TELA DA META EM 04/08/2026. Ao configurar orcamento diario de '
  || 'R$ 60,00, a propria Meta declara: "Voce gastara em media R$ 60,00 por dia. Seu limite maximo de gasto DIARIO '
  || 'e R$ 105,00, e seu limite maximo de gasto SEMANAL e R$ 420,00". Ou seja: o orcamento diario e uma MEDIA, com '
  || 'folga de 75% para cima em qualquer dia isolado; o que a plataforma garante e o teto SEMANAL (7 x o valor diario). '
  || 'CONSEQUENCIA QUE VOCE DEVE DECLARAR sempre que propuser orcamento: com tres campanhas a R$ 60,00/dia, o pior dia '
  || 'possivel nao e R$ 180,00 e sim R$ 315,00. Nunca apresente o orcamento diario ao gestor como se fosse limite de '
  || 'gasto do dia - apresente a media e o teto real. '
  || 'E NAO CONFUNDA COM TETO DE CUSTO: sao dois campos diferentes na mesma tela. "Orcamento diario" e quanto se gasta; '
  || '"Meta de custo por resultado" e o maximo pago por resultado, e e esse o teto de custo. No conjunto de prova ele '
  || 'estava em "Nenhum", coerente com bid_strategy LOWEST_COST_WITHOUT_CAP. Quando o gestor falar "teto de 60", ele '
  || 'esta falando de ORCAMENTO - confirme qual dos dois campos ele quer antes de propor qualquer coisa.',
  true, '2026-08-04', now(), 'ded20b38-f42e-4c71-800c-31b97ea48bcf');

-- (3) LACUNA NOVA: a replicacao e parcial e nao se declara parcial.
INSERT INTO agent_context (categoria, fato, vigente, desde, atualizado, company_id)
VALUES ('lacuna',
  'A REPLICACAO DE CONJUNTO E PARCIAL E O CARD NAO DIZ ISSO (achado 04/08/2026). A executora copia do molde uma '
  || 'LISTA FIXA de campos: optimization_goal, billing_event, bid_strategy, targeting, promoted_object, '
  || 'destination_type, attribution_spec, bid_amount e dsa_*. Todo campo fora dessa lista NAO e replicado e nasce no '
  || 'default da Meta. Caso concreto: o conjunto de prova criado do molde "Advantage+ BR - Dynamic Video [C7-LAL1%-R06]" '
  || 'nasceu com "Criativo dinamico: Desativado", porque is_dynamic_creative nao esta na lista copiada. Se o molde tiver '
  || 'esse recurso ligado, a replica NAO e fiel e os dois conjuntos nao sao comparaveis - o que invalida a premissa de '
  || 'um teste A/B. NAO afirme que um conjunto e "igual ao molde": diga que ele replica os campos de segmentacao e '
  || 'otimizacao listados, e que campos fora da lista nascem no padrao. Verificar o molde e decisao pendente.',
  true, '2026-08-04', now(), 'ded20b38-f42e-4c71-800c-31b97ea48bcf');