-- ESP-26: o juiz de orcamento diario e o mesmo na proposta e na execucao.
-- Doutrina: supersede o fato que so falava da emissao do card.
-- Aplicada como version 20260812165544. Espelho fiel em
-- supabase/espelhos/20260812165544_esp26_orcamento_na_proposta_e_na_execucao.sql

update public.agent_context
   set vigente = false, atualizado = now()
 where vigente
   and fato ilike 'ORCAMENTO DIARIO E MEDIA, NAO LIMITE DO DIA%';

insert into public.agent_context (categoria,fato,vigente,desde)
values
(
  'doutrina',
  'ORCAMENTO DIARIO E MEDIA, NAO LIMITE DO DIA (atualizado 12/08/2026 — ESP-26). SEMPRE que o gestor informar um orcamento, a avaliacao (RPC avaliar_orcamento_diario via helper compartilhado) roda ANTES de emitir o card E DE NOVO na execucao em meta-actions (criar_conjunto_a_partir_de e alterar_orcamento). Dois juizes locais para a mesma pergunta SAIU: a comparacao contra teto_sanidade_orcamento_diario no executor foi removida. Fail-closed: se a RPC nao responder, NAO emite e NAO executa. REPASSE A MENSAGEM DELA ao gestor — media por dia, teto real de um dia isolado (~1,25x), teto semanal, projecao de 30 dias e a exposicao da OPERACAO INTEIRA (conjuntos ACTIVE). NAO ESTIME EM PARALELO. TETO DE SANIDADE: pedido acima do teto configurado e RECUSADO na emissao e na fila; o teto limita o PEDIDO, nao o pior caso — a avaliacao declara os dois. Card antigo aprovado acima do teto vigente NAO passa na revalidacao da execucao. NUNCA CONFUNDA: orcamento diario e quanto se GASTA por dia; o maximo pago POR RESULTADO e outro campo ("Meta de custo por resultado").',
  true,
  date '2026-08-12'
);
