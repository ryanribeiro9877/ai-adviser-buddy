-- Auto-resolucao de leitura de estado do conjunto na emissao (doutrina Ryan, 11/08/2026).
--
-- CONTEXTO MEDIDO: em 11/08 o agente recusou emitir o card do anuncio para o conjunto
-- 120254414154880191 ("Campanhas Teste RR") porque nao tinha leitura confiavel do
-- is_dynamic_creative (linha existia em ad_sets, mas estado nulo - a coleta e diaria e o
-- conjunto era recem-criado). O agente DIAGNOSTICOU exatamente a leitura que faltava e mesmo
-- assim devolveu a tarefa ao humano ("peca de novo na proxima"). Esse cenario nao e edge case:
-- e o caminho feliz de criar um conjunto e, no minuto seguinte, querer o anuncio nele.
--
-- DECISAO DO RYAN (vira doutrina): lacuna de LEITURA que o proprio sistema alcanca e coletada e
-- resolvida na MESMA chamada; so devolve tarefa ao humano quando a acao e intransferivel
-- (aprovar card, decidir orcamento, conceder permissao externa).
--
-- IMPLEMENTACAO (fica em CODIGO, nao em SQL): a edge meta-campaign-status ganhou um modo pontual
-- (v14) que le o is_dynamic_creative de UM conjunto na Graph (LEITURA, sem escrita na Meta) e
-- espelha pela mesma RPC da corrida diaria (espelhar_estado_de_conjuntos_da_graph). A emissao
-- (traffic-chat, t_propose_criacao) dispara essa coleta pontual quando pedido_de_anuncio_completo
-- recusa por 'estado_conjunto_destino_nao_verificado' e reavalia UMA vez, na mesma chamada.
-- Escolha do ponto: a auto-resolucao mora na EMISSAO, nao numa tool exposta ao agente, porque a
-- falha reportada foi justamente o agente diagnosticar e ainda assim punt - uma tool separada
-- reintroduz o mesmo desvio (dependeria de o agente lembrar de chama-la). Inline, o agente sai do
-- laco e o card fecha sozinho.
--
-- LIMITE DE SEGURANCA: a auto-resolucao vale so para LEITURA. Nao escreve na Meta, nao afrouxa
-- portao, nao pula aprovacao humana de card. Se a leitura fresca confirmar is_dynamic_creative=true
-- (Dynamic Creative), a recusa por nome continua - agora com o fato fresco, nao com "nao sei".
--
-- Esta migracao apenas REGISTRA a doutrina generalizada em agent_context (procedencia: decisao do
-- Ryan, 11/08/2026). O comportamento em si ja vive nas edges.

insert into public.agent_context (categoria, fato, vigente, desde)
values (
  'doutrina',
  'AUTO-RESOLUCAO DE LEITURA NA MESMA CHAMADA (decisao do Ryan, 11/08/2026). Toda lacuna de '
  || 'LEITURA que o proprio sistema alcanca - estado do conjunto (is_dynamic_creative), estado do '
  || 'criativo/molde, status de processamento de video, acervo/biblioteca - deve ser COLETADA e '
  || 'RESOLVIDA dentro da mesma interacao, sem devolver tarefa ao humano. O agente so devolve '
  || 'tarefa quando a acao e INTRANSFERIVEL: aprovar card, decidir orcamento, conceder permissao '
  || 'externa. E PROIBIDO diagnosticar a leitura que falta e ainda assim mandar o humano pedir de '
  || 'novo. Caso concreto que originou a regra: conjunto 120254414154880191 recusado por '
  || 'estado_conjunto_destino_nao_verificado porque a coleta de is_dynamic_creative e diaria e o '
  || 'conjunto era recem-criado. IMPLEMENTACAO: meta-campaign-status tem modo pontual (POST '
  || '{conjunto|adset_external_id}) que le o estado de UM conjunto na Graph e espelha aquela linha '
  || 'agora; a emissao (t_propose_criacao) dispara essa coleta quando o portao recusa por estado '
  || 'de conjunto nao verificado e reavalia UMA vez na mesma chamada. LIMITE: vale so para LEITURA '
  || '- nao escreve na Meta, nao afrouxa portao, nao pula aprovacao. Leitura fresca dizendo Dynamic '
  || 'Creative MANTEM a recusa por nome, agora com fato fresco.',
  true,
  date '2026-08-11'
);
