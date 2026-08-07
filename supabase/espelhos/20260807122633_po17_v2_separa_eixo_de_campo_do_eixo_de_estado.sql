-- ESPELHO DE MIGRACAO APLICADA
-- version: 20260807122633
-- name: po17_v2_separa_eixo_de_campo_do_eixo_de_estado
-- projeto: gzjwnjdpxpbmdhcyefvs (Gestor de Trafego IA)
-- aplicada por: Claude via MCP apply_migration
-- espelho gerado a partir de supabase_migrations.schema_migrations - NAO transcrito a mao

-- PO-17 v2: a v1 media a coisa certa pelo criterio errado.
--
-- A v1 exigia equivalencia "em todos os casos". Rodada contra a peca 22 (em revisao de compliance,
-- bloqueia_uso=true), ela ACUSARIA falha onde o sistema esta correto:
--   pedido_de_anuncio_completo -> completo=false  (gate de compliance dispara)
--   validar_pedido_contra_contrato -> valido=true  (os 4 campos obrigatorios estao presentes)
--
-- Isso nao e divergencia: sao DOIS EIXOS diferentes, e a assinatura prova.
-- validar_pedido_contra_contrato(p_acao text, p_pedido jsonb) NAO recebe company_id e e STABLE
-- sobre contrato_de_execucao: ela responde "o pedido tem os campos que o executor exige", e nada
-- mais. Nao tem como saber que a peca esta em revisao - pecas_em_revisao e por empresa. Ensina-la
-- isso significaria repetir a doutrina do bloqueio num segundo lugar, exatamente o que
-- peca_bloqueada_por_revisao existe para impedir (fonte unica, consumida pela verificacao e pela
-- executora).
--
-- O QUE A PERGUNTA PASSA A EXIGIR, que e o que de fato protege producao:
--   EIXO DE CAMPO: equivalencia estrita nos dois sentidos. Faltou campo obrigatorio, os dois
--     recusam. Estao todos presentes, os dois aceitam. Foi aqui que a v1 pegou a divergencia real
--     de 07/08 (peca nova sem creative_id: completo=true, valido=false) - o contrato estava certo,
--     a verificacao era permissiva demais, e a correcao esta em
--     20260807* po17_pedido_exige_molde_tambem_em_peca_nova.
--   EIXO DE ESTADO: assimetria permitida em UMA direcao so. pedido_de_anuncio_completo pode
--     recusar a mais (compliance, peca fora da biblioteca) - isso e fail-closed e e desejado.
--   PROIBIDO SEMPRE: completo=true com valido=false. Verificacao aprovando o que o contrato
--     recusa e o unico padrao que gasta aprovacao do gestor e morre em montarCriacao depois.
--
-- PADRAO DO CONJUNTO: pergunta nao se edita no lugar. v1 vira vigente=false e fica como registro
-- do criterio que valeu na rodada em que ela achou a divergencia; v2 entra como vigente.

update public.perguntas_ouro
   set vigente = false
 where conjunto = 'v2' and codigo = 'PO-17' and versao = 1;

insert into public.perguntas_ouro (
  conjunto, codigo, versao, dimensao, pergunta, expectativa_verificavel,
  como_verificar, fonte_da_verdade, protege_regra, vigente
) values (
  'v2',
  'PO-17',
  2,
  'caminho_de_execucao',
  'Para o MESMO pedido de criar_anuncio_a_partir_de, pedido_de_anuncio_completo e validar_pedido_contra_contrato concordam sobre campo obrigatorio nas duas rotas (peca nova e replicacao pura)? E existe algum pedido em que a verificacao APROVA o que o contrato RECUSA?',
  'EIXO DE CAMPO, equivalencia estrita: com os 4 obrigatorios presentes (nome_novo, creative_id, conjunto_destino_external_id, conta_destino) os dois aceitam, em peca nova E em replicacao pura; removendo qualquer um deles, um por vez, os dois recusam. EIXO DE ESTADO, assimetria permitida em uma direcao so: pedido_de_anuncio_completo pode devolver completo=false com valido=true quando um gate de estado dispara (peca em revisao de compliance, peca fora da biblioteca) - isso e fail-closed e nao e falha. PROIBIDO EM QUALQUER CASO: completo=true com valido=false; um unico caso assim falha a pergunta, porque e card que passa pela aprovacao do gestor e morre em montarCriacao com payload incompleto.',
  'Monte um payload de peca_nova e um de replicacao_pura com nomes canonicos do contrato, mais um de peca_nova usando peca com bloqueia_uso=true e sem veredito. Para cada um, gere os casos removendo os 4 obrigatorios, um por vez. Rode as duas RPCs sobre exatamente o mesmo jsonb e classifique: completo=valido CONCORDAM; completo=false com valido=true ASSIMETRIA SEGURA so se um gate de estado justificar; completo=true com valido=false FALHA. Nao compare mensagens, so os booleanos, e nao compare pedidos diferentes.',
  'pedido_de_anuncio_completo(company_id,pedido) + validar_pedido_contra_contrato(''criar_anuncio_a_partir_de'',pedido) + contrato_de_execucao vigente + peca_bloqueada_por_revisao',
  '{13}',
  true
);