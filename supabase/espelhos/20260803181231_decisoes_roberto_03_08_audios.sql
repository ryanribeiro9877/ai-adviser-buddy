-- ESPELHO DE MIGRACAO APLICADA
-- version: 20260803181231
-- name: decisoes_roberto_03_08_audios
-- projeto: gzjwnjdpxpbmdhcyefvs (Gestor de Trafego IA)
-- aplicada por: Claude via MCP apply_migration
-- espelho gerado a partir de supabase_migrations.schema_migrations - NAO transcrito a mao

-- 03/08/2026 - DECISOES DO ROBERTO por audio (14:45 e 14:47), em resposta a MENSAGEM-ROBERTO.
-- Persistidas NO ATO: decisao dita em conversa morre com a conversa (licao no 2 do projeto).
-- So entram aqui as respostas SEM AMBIGUIDADE. As ambiguas viram fato de ALERTA, nao de regra.

-- 1) CONTRATO DE ATIVACAO: o gestor pediu o freio de volta.
INSERT INTO agent_context (categoria, fato, vigente, desde, atualizado, company_id)
VALUES ('doutrina',
  'CONTRATO DE ATIVACAO - DIVERGENCIA DECLARADA E NAO RESOLVIDA (03/08/2026). O gestor Roberto, '
  || 'por audio em 03/08 14:45, pediu EXPLICITAMENTE que o objeto volte a NASCER PAUSADO: "ela tem '
  || 'que nascer pausada para poder olhar e ativar ou nao". E sobre as tres campanhas de teste: '
  || '"elas tem que ficar la pausadas para eu olhar e mandar ativar, SE ELAS ESTIVEREM COMPLETAS". '
  || 'ISSO CONTRARIA o contrato implantado em 31/07/2026 (aprovar card = ativar, objeto nasce ACTIVE), '
  || 'que foi decisao do Ryan e NAO passou pelo gestor. '
  || 'ENQUANTO A DIVERGENCIA NAO FOR RESOLVIDA PELO RYAN: o codigo em producao ainda cria ATIVO, '
  || 'entao ao propor qualquer card DECLARE os dois lados - o que o sistema fara hoje (nasce ativo) '
  || 'e o que o gestor pediu (nascer pausado) - e diga que a diferenca esta pendente de decisao '
  || 'tecnica. NUNCA afirme que existe um passo manual de ativacao depois da aprovacao enquanto o '
  || 'codigo nao voltar a PAUSED. Divergencia se registra, nao se vence.',
  true, '2026-08-03', now(), 'ded20b38-f42e-4c71-800c-31b97ea48bcf');

-- 2) CATEGORIA ESPECIAL: regra absoluta, sem excecao.
INSERT INTO agent_context (categoria, fato, vigente, desde, atualizado, company_id)
VALUES ('doutrina',
  'CATEGORIA ESPECIAL DE CREDITO E ABSOLUTA NESTA EMPRESA (decisao do gestor Roberto, audio 03/08 14:45): '
  || '"a verificacao, se e da categoria especial, nao tem nem o que verificar, so pode fazer. Criativos, '
  || 'anuncios, conjunto de anuncios, campanha, seja la o que for, SO pela categoria especial de credito." '
  || 'CONSEQUENCIA PRATICA: nao pergunte ao gestor sobre categoria especial, nao trate como opcao e nao '
  || 'peca conferencia dele para objeto que o sistema criou - a categoria e gravada por construcao. '
  || 'DISTINCAO QUE PERMANECE: isso e POLITICA declarada, nao evidencia de configuracao. Nas 18 campanhas '
  || 'legadas o campo nao e coletado pelo sistema; a politica diz que TODAS deveriam estar marcadas, e se '
  || 'alguma nao estiver isso e um DEFEITO a encontrar, nao uma incognita a declarar. Ao falar de campanha '
  || 'legada, diga que a politica exige a marcacao e que o sistema ainda nao le o campo para confirmar.',
  true, '2026-08-03', now(), 'ded20b38-f42e-4c71-800c-31b97ea48bcf');

-- 3) DESTINO: 100% LP. Zero WhatsApp em campanha.
INSERT INTO agent_context (categoria, fato, vigente, desde, atualizado, company_id)
VALUES ('doutrina',
  'DESTINO DE TODA CAMPANHA NOVA: EXCLUSIVAMENTE A LP / SITE PROPRIO (decisao do gestor Roberto, audios '
  || '03/08 14:45 e 14:47): "todas as campanhas a serem criadas e exclusivamente pra derramar no nosso '
  || 'site, na nossa LP" e "nao tem nenhum disparo, nada que e feito pra WhatsApp nenhum". '
  || 'CONSEQUENCIA: nao proponha campanha, conjunto ou anuncio com destino WhatsApp / CTWA / mensagem; '
  || 'nao use molde de conjunto de WhatsApp; ao analisar a conta, trate as campanhas WPP e CTWA existentes '
  || 'como legado pausado fora da estrategia atual. '
  || 'DIVERGENCIA COM O DADO, DECLARADA: o banco mostra envio de modelo de mensagem acontecendo (analytics '
  || 'de WABA com milhares de envios/dia e cliques concentrados em um template de simulacao). Ou seja, HA '
  || 'disparo - mas ele nao vem de trafego pago e nao esta sob o gestor de trafego. Ao tocar em qualidade '
  || 'de numero, declare que o disparo tem outro dono, que nao foi identificado.',
  true, '2026-08-03', now(), 'ded20b38-f42e-4c71-800c-31b97ea48bcf');

-- 4) PORTAO DE LIBERACAO DE PECA: compliance de TEXTO. Visual e nota.
INSERT INTO agent_context (categoria, fato, vigente, desde, atualizado, company_id)
VALUES ('doutrina',
  'LIBERACAO DE PECA CRIATIVA - O PORTAO E O COMPLIANCE DE TEXTO (decisao do gestor Roberto, audio 03/08 '
  || '14:47): "pode liberar qualquer peca que passe ali no compliance de texto". '
  || 'CONSEQUENCIA: o veredito VISUAL (produto detectado nos pixels da miniatura) NAO e criterio de '
  || 'liberacao - e NOTA, jamais veto. As 38 pecas com veredito visual "nao" seguem liberadas, com a '
  || 'divergencia declarada. O que bloqueia uma peca e reprovacao no compliance de texto, e so isso. '
  || 'AS 5 IMAGENS INCERTAS: quem libera e o proprio Roberto, peca por peca - nao decida por ele. '
  || 'OS 17 VIDEOS INCERTOS: ele AUTORIZOU reclassificar por audio mais varios quadros, em vez de '
  || 'assistir um por um. Reclassificacao por esse metodo e permitida e o veredito novo substitui o '
  || 'antigo, que foi produzido com um unico quadro.',
  true, '2026-08-03', now(), 'ded20b38-f42e-4c71-800c-31b97ea48bcf');

-- 5) JANELA DE LEITURA E RECALCULO DE TETO.
INSERT INTO agent_context (categoria, fato, vigente, desde, atualizado, company_id)
VALUES ('metodo',
  'JANELA DE LEITURA E RECALCULO (decisao do gestor Roberto, audio 03/08 14:47): SETE DIAS de leitura '
  || 'antes de decidir qualquer coisa sobre um conjunto novo ("sao sete dias de leitura antes de decidir '
  || 'o que fazer"); e o recalculo de percentil de custo (p75/p90) passa a ser SEMANAL - deixa de ser '
  || 'numero congelado em 22/07/2026. Ao propor prazo de leitura, use 7 dias como padrao declarado do '
  || 'gestor, nao como escolha sua.',
  true, '2026-08-03', now(), 'ded20b38-f42e-4c71-800c-31b97ea48bcf');

-- 6) AMBIGUIDADES: fato de ALERTA, para impedir acao sobre premissa errada.
INSERT INTO agent_context (categoria, fato, vigente, desde, atualizado, company_id)
VALUES ('lacuna',
  'TRES AMBIGUIDADES NAS RESPOSTAS DO GESTOR EM 03/08 - NAO AJA SOBRE NENHUMA DELAS SEM CONFIRMAR. '
  || '(1) TETO DE CUSTO x ORCAMENTO DIARIO: perguntado qual VALOR DE TETO DE CUSTO por resultado (opcoes '
  || 'de R$ 2,30 e R$ 2,66), ele respondeu "60 por campanha", que e o ORCAMENTO DIARIO. Sao coisas '
  || 'diferentes: orcamento e quanto se gasta por dia; teto de custo e o maximo pago por resultado. '
  || 'Configurar R$ 60 como teto de custo por lead seria teto inexistente na pratica; configurar R$ 2,66 '
  || 'como orcamento diario asfixiaria a entrega. NAO configure teto de custo ate o gestor confirmar o '
  || 'valor POR RESULTADO. '
  || '(2) CBO x ABO: ele afirmou "60 por campanha e e CBO, ne?". As tres campanhas de teste foram criadas '
  || 'ABO por construcao (sem orcamento na campanha, compartilhamento desligado). A premissa dele esta '
  || 'errada; corrigir e barato agora porque as campanhas estao vazias, mas e decisao dele e do Ryan. '
  || '(3) "SUPER GESTOR PRO": perguntado qual sistema fica com permissao de escrita na Meta, respondeu '
  || '"pelo Super Gestor Pro". NAO esta estabelecido se esse e o nome comercial DESTE sistema ou de outro. '
  || 'Se for outro sistema, as travas de escrita DESTE deveriam permanecer desligadas. Nao presuma.',
  true, '2026-08-03', now(), 'ded20b38-f42e-4c71-800c-31b97ea48bcf');