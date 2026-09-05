-- ESPELHO DE MIGRACAO APLICADA
-- version: 20260905101940
-- name: dois_campos_do_contrato_voltam_para_a_regra_da_evidencia
-- projeto: gzjwnjdpxpbmdhcyefvs (Gestor de Trafego IA)
-- aplicada por: Claude via MCP apply_migration

-- OS DOIS CAMPOS QUE REPROVAVAM CARD QUE A META EXECUTOU.
--
-- A tabela contrato_de_execucao tem UMA regra: campo so entra por evidencia (payload de card que
-- executou, ou leitura declarada do codigo do executor). Dois campos foram marcados obrigatorios
-- sem passar por ela, e o preco apareceu na medicao de 05/09/2026 sobre os 269 cards.
--
-- ============================================================================================
-- (1) criar_campanha.special_ad_categories : obrigatorio -> NAO obrigatorio
-- ============================================================================================
--
-- A EVIDENCIA CONTRA A OBRIGATORIEDADE E DE TRES TIPOS, E AS TRES CONCORDAM.
--
-- (a) EXECUCAO SEM O CAMPO. Tres cards de criar_campanha (OUTCOME_LEADS, 31/07/2026) nao tem
--     special_ad_categories no payload e executaram com execution_result.ok = true.
--
-- (b) A HISTORIA DESSES TRES CARDS DECIDE O CASO, e ela e o oposto do que a linha dizia. Os tres
--     nasceram para SUBSTITUIR tres cards anteriores (1ef76abe, 1dfe6b58, 48d18220) que mandavam
--     special_ad_categories = ["CREDIT"] e foram recusados pela Meta — a categoria CREDIT foi
--     aposentada (erro 2909060). Os substitutos foram emitidos SEM O CAMPO e passaram. Ou seja: o
--     que fez a Meta aceitar foi RETIRAR o campo, nao preenche-lo. As tres "falhas" que ficaram no
--     banco com ok=false nem chegaram a Meta: foram neutralizadas a mao (superseded=true) para
--     impedir criacao duplicada.
--
-- (c) O EXECUTOR TEM DEFAULT COMPLETO, e ausencia nunca falha nele. Em meta-actions,
--     montarCriacao (criar_campanha):
--         const catsPayload = Array.isArray(p?.special_ad_categories) ? [...] : null;
--         const catsEspeciais = catsPayload != null
--           ? catsPayload
--           : (ehCredito ? ["FINANCIAL_PRODUCTS_SERVICES"] : []);
--     O mesmo default se repete na gravacao do espelho de campaigns. Empresa de credito recebe
--     FINANCIAL_PRODUCTS_SERVICES; as outras recebem []. Exigir no card um campo que o executor
--     resolve melhor do que o emissor e pedir para o modelo adivinhar o que o codigo ja sabe.
--
-- E A FONTE QUE JUSTIFICAVA A OBRIGATORIEDADE NAO ERA EVIDENCIA. A linha citava "payload do card
-- 1b69990c". Esse card NUNCA EXECUTOU (execution_result null). A regra da tabela pede payload de
-- card que executou; 1b69990c e um card emitido, e card emitido e intencao, nao prova.
--
-- ============================================================================================
-- (2) criar_conjunto_a_partir_de.plataformas_publicacao : CONTINUA obrigatorio
-- ============================================================================================
--
-- Aqui a evidencia aponta para o outro lado, e afrouxar seria trocar um erro por um pior.
--
-- Existem 3 cards de conjunto que executaram com ok=true sem plataformas_publicacao (f9a17ed1 em
-- 04/08 11:50, fd9f1957 em 10/08 21:17, cffd8013 em 11/08 19:12). Mas essa evidencia esta VENCIDA:
-- ela descreve um executor que nao existe mais. A v5.15 de meta-actions (11/08) passou a RECUSAR
-- justamente essa forma:
--         if (plataformasPedidas != null) { ... }
--         else if (formatoPrevisto === "video")  { ... }
--         else if (formatoPrevisto === "imagem") { ... }
--         else return { erro: "plataformas_de_publicacao_obrigatorias", ... };
-- A ultima execucao sem o campo foi as 19:12 de 11/08; a frente que tornou o campo obrigatorio
-- entrou as 22:00 do MESMO dia. Os 5 cards que reprovam por este campo tem todos
-- formato_midia_previsto ausente — exatamente o ramo que cai no `else` e e recusado hoje.
--
-- Entao marcar como opcional nao consertaria falso positivo: criaria falso NEGATIVO. O card sairia
-- aprovado pelo contrato e morreria no executor, com o erro aparecendo longe da causa.
--
-- O QUE E VERDADE E NAO CABE NESTA TABELA, e fica declarado em vez de escolhido: a exigencia e
-- CONDICIONAL — plataformas_publicacao OU formato_midia_previsto em (video, imagem). O contrato so
-- sabe testar presenca incondicional, e nao existe coluna "obrigatorio_se". A consequencia
-- honesta: um card com formato_midia_previsto=video e sem plataformas_publicacao passaria no
-- executor e reprova aqui. Essa forma nunca ocorreu em 47 cards de conjunto (0 casos), entao o
-- falso positivo e teorico. Inventar a condicao numa coluna nova, para todas as acoes, sem
-- evidencia das outras, e o movimento que ja falhou tres vezes nesta tabela.
--
-- NAO MEXE em escalar_duplicar: aquela acao herda o targeting do molde e o executor nem pede
-- redes ("Redes nao sao pedidas de novo"). O contrato ja nao lista o campo la, e esta certo.

update public.contrato_de_execucao
   set obrigatorio = false,
       observacao =
         'OPCIONAL: o executor tem default completo e ausencia nunca falha. meta-actions '
         || 'montarCriacao: catsPayload != null ? catsPayload : (ehCredito ? '
         || '["FINANCIAL_PRODUCTS_SERVICES"] : []). Credito recebe FINANCIAL; nao-credito recebe []. '
         || 'Declare no card so para SOBRESCREVER o default. NAO use ["CREDIT"]: a Meta aposentou '
         || 'essa categoria em 31/07/2026 (erro 2909060) e recusou os 3 cards que a mandaram.',
       fonte =
         'EVIDENCIA 05/09/2026: 3 cards OUTCOME_LEADS executaram ok=true SEM o campo (31/07), e '
         || 'eram os substitutos de 3 cards recusados pela Meta com ["CREDIT"] — retirar o campo foi '
         || 'o que fez passar. Mais 3 executaram ok=true com []. Executor: meta-actions '
         || 'montarCriacao (criar_campanha) + gravacao do espelho campaigns. A fonte anterior '
         || '("payload do card 1b69990c") nao era evidencia: aquele card nunca executou.'
 where acao = 'criar_campanha'
   and campo = 'special_ad_categories'
   and vigente;

-- plataformas_publicacao: obrigatoriedade MANTIDA. So o registro do motivo muda, para a proxima
-- pessoa nao reabrir o caso lendo os 3 ok=true sem ver que eles sao de antes da v5.15.
update public.contrato_de_execucao
   set observacao =
         'Lista de redes escolhida pelo gestor APOS o agente perguntar. Suportadas: facebook, '
         || 'instagram, audience_network, messenger. Threads NUNCA (empresa sem cadastro). '
         || 'OBRIGATORIEDADE CONDICIONAL, medida em 05/09/2026: o executor exige '
         || 'plataformas_publicacao OU formato_midia_previsto em (video, imagem) — ramo `else` de '
         || 'montarCriacao devolve erro plataformas_de_publicacao_obrigatorias. Esta tabela so testa '
         || 'presenca incondicional, entao o campo fica obrigatorio: e a leitura que nao emite card '
         || 'que o executor recusaria. Falso positivo teorico conhecido: card com '
         || 'formato_midia_previsto=video e sem plataformas passaria no executor e reprova aqui — '
         || 'forma nunca vista em 47 cards de conjunto. NAO relaxar com base nos 3 cards que '
         || 'executaram sem o campo (f9a17ed1 04/08, fd9f1957 10/08, cffd8013 11/08 19:12): sao '
         || 'anteriores a v5.15, que entrou as 22:00 de 11/08 e passou a recusar essa forma.'
 where acao = 'criar_conjunto_a_partir_de'
   and campo = 'plataformas_publicacao'
   and vigente;

-- ============================================================================================
-- O QUE ESTA MEDICAO ACHOU E NAO ESTA SENDO CONSERTADO AQUI — declarado, nao escondido.
-- ============================================================================================
--
-- (A) ARRAY VAZIO CONTA COMO AUSENTE, e isso quebra o valor documentado de uma acao.
--     campo_presente_no_pedido tem: WHEN 'array' THEN jsonb_array_length(...) > 0. Entao
--     special_ad_categories = [] e lido como FALTANDO. Em alterar_categoria_especial_campanha
--     isso e um defeito direto: [] e o valor que REMOVE a categoria, esta escrito na propria
--     observacao da linha, e o executor exige array (recusa se nao for). O card 1ed16789 executou
--     com ok=true em 22/08 e reprova no contrato por esse motivo.
--     NAO CONSERTADO AQUI DE PROPOSITO: campo_presente_no_pedido e compartilhada por todas as
--     acoes e todos os campos de array. Fazer [] contar como presente liberaria tambem
--     plataformas_publicacao = [], que passaria no contrato e produziria conjunto sem rede. Isso
--     precisa de evidencia por campo, que esta medicao nao levantou. Fica para decisao do gestor.
--
-- (B) 22 CARDS REPROVAM POR contrato_desconhecido, nao por campo: pausar_criativo (15, 12 com
--     ok=true), pausar_campanha (4, 3 ok), renomear_criativo (2, 2 ok), ativar_criativo (1, 1 ok).
--     Essas quatro acoes nao tem NENHUMA linha em contrato_de_execucao. O comportamento e o
--     desenhado (contrato ausente = recusa honesta, nao aprovacao), e semear as quatro a partir
--     dos payloads que executaram e trabalho de evidencia proprio — nao entra de carona aqui.
