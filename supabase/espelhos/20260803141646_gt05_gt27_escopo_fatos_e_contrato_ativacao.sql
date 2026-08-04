-- ESPELHO DE MIGRACAO APLICADA
-- version: 20260803141646
-- name: gt05_gt27_escopo_fatos_e_contrato_ativacao
-- projeto: gzjwnjdpxpbmdhcyefvs (Gestor de Trafego IA)
-- aplicada por: Claude via MCP apply_migration
-- espelho gerado a partir de supabase_migrations.schema_migrations - NAO transcrito a mao

-- 03/08/2026 - GT-05 + GT-27 + metade-banco do GT-07.
-- CONTEXTO: com a criacao da 3a empresa (Cooperativa_ Cohapm, 03/08 11:39) o vazamento de
-- doutrina deixou de ser latente. Ela nascia com 0 fatos proprios herdando 20 fatos globais,
-- inclusive doutrina de credito consignado, tetos de outra empresa e o fato da categoria
-- especial que SOMAVA as campanhas das duas empresas ("26 campanhas" = 18 LEV + 8 COHAPM).

-- ============================================================
-- GT-05: o fato da categoria especial estava OBSOLETO e CONTAMINADO.
-- Obsoleto: escrito em 29/07, dois dias ANTES de a meta-actions v4/v4.1 passar a gravar
--   special_ad_categories=["FINANCIAL_PRODUCTS_SERVICES"] por construcao (31/07). Por causa
--   dele o agente RECUSOU, em 02/08, um pedido do gestor que ja estava 100% atendido.
-- Contaminado: o numero 26 e a soma das duas empresas, e o fato era global.
-- ============================================================
UPDATE agent_context SET
  company_id = 'ded20b38-f42e-4c71-800c-31b97ea48bcf',
  desde = '2026-07-31',
  atualizado = now(),
  fato = 'CATEGORIA ESPECIAL DE CREDITO - DUAS SITUACOES DIFERENTES, NAO CONFUNDA (verificado 03/08/2026). '
      || '(1) CAMPANHA CRIADA POR ESTE SISTEMA: a categoria especial e gravada POR CONSTRUCAO no ato da criacao, '
      || 'com o valor FINANCIAL_PRODUCTS_SERVICES. Nao e opcional, nao e perguntada ao gestor e nao depende de '
      || 'conferencia humana - o codigo da executora forca o campo. Voce PODE afirmar que a campanha declara '
      || 'categoria especial, e a prova fica no registro de auditoria da criacao (corpo enviado a Meta). '
      || 'NUNCA peca ao gestor para marcar categoria especial em campanha que o sistema criou: isso ja esta feito, '
      || 'e pedir de novo passa a impressao de que o sistema nao fez o que fez. '
      || '(2) CAMPANHA LEGADA OU CRIADA FORA DO SISTEMA: a coleta do campo nao existe no sync, entao o espelho fica '
      || 'vazio para todas elas. Para essas, e apenas para essas, continua valendo: nao afirme que declaram nem que '
      || 'deixam de declarar categoria especial - nao esta verificado, e a conferencia e humana no Gerenciador. '
      || 'NOTA HISTORICA: a Meta APOSENTOU a categoria CREDIT (erro 2909060) e exige FINANCIAL_PRODUCTS_SERVICES; '
      || 'a verificacao de TEXTO que o sistema faz (copy de anuncio e modelo de mensagem) nunca substituiu a '
      || 'verificacao da CONFIGURACAO da campanha.'
WHERE id = 40;

-- ============================================================
-- GT-07 (metade banco): o contrato de ativacao na memoria estava errado desde 31/07.
-- O fato dizia "o card fica PENDENTE / nunca afirme que executou". Hoje aprovar card EXECUTA.
-- Este passa a ser o texto canonico do contrato; prompt, texto de card e docs devem casar com ele.
-- ============================================================
UPDATE agent_context SET
  desde = '2026-07-31',
  atualizado = now(),
  fato = 'CONTRATO DE ATIVACAO VIGENTE DESDE 31/07/2026 - APROVAR CARD E O ATO DE EXECUTAR. '
      || 'Toda acao na Meta (criar, pausar, escalar, mudar orcamento) passa por card de aprovacao decidido por '
      || 'ADMINISTRADOR. Quando o administrador aprova, um gatilho no banco chama a executora e a acao acontece na '
      || 'Meta NA HORA. Campanha, conjunto e anuncio nascem ATIVOS - nao nascem mais pausados. '
      || 'CONSEQUENCIA QUE VOCE DEVE DECLARAR SEMPRE QUE PROPUSER UM CARD DE ANUNCIO: aprovar card de anuncio LIGA '
      || 'A ENTREGA E O GASTO NO ATO, sem nenhum passo manual posterior no Gerenciador. Nao existe mais "tirar a pausa" '
      || 'como ultimo freio do gestor. '
      || 'O QUE NAO MUDOU: voce continua SEM nenhum caminho para ativar, pausar ou gastar por conta propria - o portao '
      || 'e a aprovacao humana. E continua valendo, com forca maior: NUNCA afirme que executou, emitiu ou criou algo '
      || 'sem ter o retorno da ferramenta correspondente naquele turno. Ato sem retorno de ferramenta nao existe.'
WHERE id = 11;

-- ============================================================
-- GT-27: dar escopo de empresa ao que e da Legal e Viver e estava global.
-- 3  = instrumentacao de UTM da captacao da Legal
-- 10 = CAPI ContratoPago / receita da Legal
-- 36 = conversao final acompanhada no dashboard da Legal
-- 41 = mapa de contas Meta da Legal
-- 42 = inventario de WhatsApp da Legal
-- 44 = metrica custo por lead LP e teto R$ 1,50 da Legal
-- 39 = procedencia dos tetos: fica na Legal porque os numeros sao dela; a COHAPM ja tem fato
--      proprio com os tetos dela e a ressalva de amostra pequena.
-- ============================================================
UPDATE agent_context
   SET company_id = 'ded20b38-f42e-4c71-800c-31b97ea48bcf', atualizado = now()
 WHERE id IN (3, 10, 36, 39, 41, 42, 44)
   AND company_id IS NULL;

-- ============================================================
-- GT-27: fato-guarda da empresa nova. NAO inventa a diferenca dela (isso e o GT-28, depende
-- de uma frase do Ryan) - apenas impede herdar identidade e numero de quem nao e ela.
-- ============================================================
INSERT INTO agent_context (categoria, fato, vigente, desde, atualizado, company_id)
SELECT 'identidade',
  'COOPERATIVA_ COHAPM - EMPRESA SEM ESCOPO DECLARADO (cadastrada em 03/08/2026, industry "Digital"). '
  || 'ATENCAO: existe uma segunda empresa chamada COHAPM (cooperativa habitacional, cadastrada em 21/07/2026) e '
  || 'as duas sao entidades SEPARADAS neste sistema por decisao do Ryan em 03/08/2026. A diferenca operacional '
  || 'entre elas AINDA NAO FOI DECLARADA. '
  || 'ENQUANTO ISSO: (1) nao aplique a esta empresa doutrina de credito consignado, calendario de INSS ou de folha, '
  || 'nem produto CLT - nada disso foi declarado para ela; (2) nao use teto de custo de nenhuma outra empresa para '
  || 'julgar campanha dela - ela nao tem teto proprio calculado; (3) nao compare o desempenho dela com o da COHAPM '
  || 'nem com o da Legal e Viver; (4) se o gestor pedir analise dela, declare que o escopo da empresa nao esta '
  || 'definido e pergunte, em vez de assumir. '
  || 'Execucao na Meta: esta empresa tem configuracao propria com master_enabled=false, dry_run=true e todas as '
  || 'acoes desligadas - nada e executado nela.',
  true, '2026-08-03', now(), '307849e6-78a7-4217-8112-3fb0a924f988'
WHERE NOT EXISTS (
  SELECT 1 FROM agent_context
   WHERE company_id = '307849e6-78a7-4217-8112-3fb0a924f988' AND categoria = 'identidade'
);