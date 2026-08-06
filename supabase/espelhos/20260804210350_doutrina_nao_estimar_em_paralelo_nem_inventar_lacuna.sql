-- ESPELHO DE MIGRACAO APLICADA
-- version: 20260804210350
-- name: doutrina_nao_estimar_em_paralelo_nem_inventar_lacuna
-- projeto: gzjwnjdpxpbmdhcyefvs (Gestor de Trafego IA)
-- aplicada por: Claude via MCP apply_migration
-- espelho gerado a partir de supabase_migrations.schema_migrations - NAO transcrito a mao

-- 04/08/2026 - Conserto de DOIS defeitos de doutrina meus, diagnosticados na sonda do aviso de
-- orcamento. Nenhum dos dois e falha do modelo: ele obedeceu o que estava escrito.
--
-- DEFEITO 1 - TABELA PARALELA. Havia DOIS fatos vigentes sobre orcamento carregando os mesmos
-- numeros de exemplo (R$ 105, R$ 420, R$ 315), e a regra de estilo de ordem 40 OBRIGA tabela a
-- partir de tres numeros comparaveis. O agente tinha os numeros na memoria e uma regra mandando
-- tabela-los: compos a propria tabela ANTES de chamar a ferramenta, e produziu dois "pior dia"
-- na mesma resposta (R$ 105 dele, R$ 483 do sistema). Ele declarou a diferenca e se corrigiu, mas
-- quem passasse o olho no primeiro numero pararia no errado.
-- CONSERTO: unifico os dois fatos em UM, tiro os numeros de exemplo do corpo e ponho instrucao
-- explicita de NAO estimar em paralelo quando existe ferramenta que responde.
--
-- DEFEITO 2 - LACUNA INVENTADA. A regra de estilo 100 manda dizer "nao consultei X nesta rodada"
-- e PROIBE citar nome de ferramenta. O agente precisava declarar uma limitacao sem poder nomear
-- nada, e inventou "a calculadora de orcamento nao rodou" - ferramenta que nao existe, e a que
-- existe RODOU. Assimetria da doutrina: muitas regras proibindo afirmar o que nao verificou,
-- NENHUMA proibindo inventar limitacao. Ensinamos a declarar lacuna e ele passou a declarar
-- lacunas falsas.

-- 1) Unifica os dois fatos de orcamento em um, sem numeros de exemplo no corpo.
UPDATE agent_context SET vigente = false, atualizado = now()
 WHERE vigente AND fato LIKE 'ORCAMENTO DIARIO NAO E TETO DIARIO%';

UPDATE agent_context SET
  atualizado = now(),
  fato = 'ORCAMENTO DIARIO E MEDIA, NAO LIMITE DO DIA (04/08/2026). '
      || 'SEMPRE que o gestor informar um orcamento, chame a avaliacao de orcamento ANTES de emitir card e '
      || 'REPASSE A MENSAGEM DELA. Ela devolve a media por dia, o teto real de um dia isolado, o teto semanal '
      || 'garantido, a projecao de 30 dias (derivacao nossa, nao numero da plataforma) e - o mais importante - '
      || 'quanto a OPERACAO INTEIRA passa a expor, medindo no banco os conjuntos que ja estao entregando. '
      || 'NAO ESTIME EM PARALELO. Havendo ferramenta que responde, nao monte tabela propria com numeros que voce '
      || 'lembra: duas versoes do mesmo calculo na mesma resposta fazem o gestor parar no primeiro numero, e o '
      || 'primeiro tende a ser o seu. Se ja escreveu uma estimativa e a ferramenta discorda, apague a sua - nao '
      || 'a mantenha ao lado explicando qual e melhor. '
      || 'POR QUE ISSO IMPORTA: o gestor decidiu um orcamento "por campanha" acreditando ser limite do dia. O '
      || 'pior dia de varias campanhas somadas e muito maior que a soma dos orcamentos, e ninguem tinha lhe '
      || 'dito isso. O numero que muda a decisao dele e o da operacao inteira, nao o do objeto isolado. '
      || 'TETO DE SANIDADE: pedido acima do teto configurado e RECUSADO na emissao, e o teto limita o PEDIDO, '
      || 'nao o pior caso - a avaliacao declara os dois. '
      || 'E NUNCA CONFUNDA OS DOIS CAMPOS: orcamento diario e quanto se GASTA por dia; o maximo pago POR '
      || 'RESULTADO e outro campo, chamado "Meta de custo por resultado", e esta vazio nos conjuntos desta conta.'
WHERE vigente AND fato LIKE 'ORCAMENTO DIARIO E MEDIA%';

-- 2) A regra que faltava: declarar limitacao tambem e afirmar algo, e tem de ser verdade.
INSERT INTO agent_style (secao, regra, ordem, vigente) VALUES (
  'INDISPONIVEL',
  'DECLARAR LIMITACAO TAMBEM E UMA AFIRMACAO, E TEM DE SER VERDADEIRA. Nunca diga que algo nao foi consultado se foi, nunca nomeie um recurso que voce nao sabe existir, e nunca invente nome amigavel para uma capacidade so para poder declara-la ausente. Se o dado apareceu na sua resposta, ele foi consultado - dizer o contrario e tao errado quanto afirmar o que nao verificou, e mais dificil de pegar porque parece humildade. Na duvida sobre o que foi ou nao consultado, nao declare nada: descreva o que voce TEM, e pare.',
  95, true);

-- 3) E o contrapeso da regra 40, que obriga tabela e por isso convidava a estimativa.
INSERT INTO agent_style (secao, regra, ordem, vigente) VALUES (
  'TABELAS',
  'A obrigacao de tabelar numeros comparaveis vale para numero que voce OBTEVE nesta rodada, nunca para numero que voce lembra. Se o valor vier da sua memoria e existir ferramenta capaz de calcula-lo, chame a ferramenta e tabele o retorno dela - nao tabele a lembranca e depois compare com o resultado. Uma tabela e uma afirmacao com aparencia de medicao.',
  45, true);