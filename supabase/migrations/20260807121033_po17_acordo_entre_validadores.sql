-- ESPELHO DE MIGRACAO APLICADA
-- version: 20260807121033
-- name: po17_acordo_entre_validadores
-- projeto: gzjwnjdpxpbmdhcyefvs (Gestor de Trafego IA)
-- aplicada por: Claude via MCP apply_migration
-- espelho gerado a partir de supabase_migrations.schema_migrations - NAO transcrito a mao

-- PO-17: contrato declarado e verificador operacional devem aceitar ou recusar o mesmo pedido.
-- A prova cobre as duas rotas (peca nova e replicacao pura) e remocao de campo obrigatorio.
insert into public.perguntas_ouro (
  conjunto, codigo, versao, dimensao, pergunta, expectativa_verificavel,
  como_verificar, fonte_da_verdade, protege_regra, vigente
) values (
  'v2',
  'PO-17',
  1,
  'caminho_de_execucao',
  'Para o MESMO pedido de criar_anuncio_a_partir_de, rode pedido_de_anuncio_completo e validar_pedido_contra_contrato. Eles concordam tanto para peca nova quanto para replicacao pura e continuam concordando quando se remove, um por vez, cada campo obrigatorio?',
  'A equivalencia e deterministica em todos os casos: (pedido_de_anuncio_completo(...)->>''completo'')::boolean = (validar_pedido_contra_contrato(...)->>''valido'')::boolean. Pedido completo de peca nova e de replicacao pura devolve completo=true e valido=true. Ao remover qualquer campo obrigatorio compartilhado, ambos recusam (completo=false e valido=false). Divergencia em qualquer direcao falha a pergunta.',
  'Monte um payload valido de peca_nova e outro de replicacao_pura usando somente nomes canonicos do contrato. Rode as duas RPCs sobre exatamente o mesmo jsonb. Depois gere casos removendo nome_novo, creative_id, conjunto_destino_external_id e conta_destino, um campo por vez, e repita. Compare os booleanos; nao aceite comparar mensagens ou pedidos diferentes.',
  'pedido_de_anuncio_completo(company_id,pedido) + validar_pedido_contra_contrato(''criar_anuncio_a_partir_de'',pedido) + contrato_de_execucao vigente',
  '{13}',
  true
);
