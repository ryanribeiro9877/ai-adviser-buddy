-- ESPELHO DE MIGRACAO APLICADA
-- version: 20260811201404
-- name: auto_resolucao_de_leitura_estado_do_conjunto
-- projeto: gzjwnjdpxpbmdhcyefvs (Gestor de Trafego IA)
-- aplicada por: Claude via MCP apply_migration
-- espelho gerado a partir de supabase_migrations.schema_migrations - NAO transcrito a mao

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
