-- Origens REAIS dos campos, e os gabaritos que elas obrigaram a corrigir (03/09/2026)
--
-- O seed da camada declarou `campos[].origem` com nomes de chave PLAUSIVEIS que nao existem.
-- Conferido contra as RPCs e contra `chat_messages.tool_results` de producao:
--
--   declarado                                  real
--   avaliar_orcamento_diario.soma_programada   nao existe (a chave e exposicao_atual_por_dia,
--                                              e a RPC nem e ferramenta de chat)
--   custo_llm_periodo.total_usd                a chave e custo_usd
--   custo_llm_periodo.turnos                   a chave e chamadas
--   saude_das_integracoes.com_coleta_7d        NAO EXISTE janela de 7 dias
--   campaigns do company_id                    nao ha ferramenta que liste campanhas; quem
--                                              declara as contagens e get_overview
--
-- Origem que mente e pior que origem ausente, porque a coluna existe para a auditoria
-- responder "de onde veio este numero?" sem ler codigo. Esta migration passa a gravar a
-- string exata que `_shared/valores_do_molde.ts` le, e a prova compara os dois lados: mexer
-- em um sem mexer no outro reprova.
--
-- ============================================================================
-- DOIS GABARITOS MUDARAM DE CONTEUDO, E OS MOTIVOS SAO DIFERENTES
-- ============================================================================
--
-- (a) CAMPOS DE JULGAMENTO SAIRAM DOS MOLDES DE ATO. `ATO_CONFIRMACAO_CARD.pendencia` ("o que
--     ficou de fora e por que") e `ATO_CARD_NAO_EMITIDO.proximo_passo` ("o que falta para o
--     card ser possivel") nao sao dado: sao analise. Foram desenhados quando a camada era
--     BINARIA e o molde tinha de responder o turno inteiro. No hibrido a analise mora FORA do
--     bloco, escrita pelo modelo. Mantidos como obrigatorios, eles impediriam esses dois
--     moldes de resolver para sempre — campo obrigatorio que nenhuma ferramenta pode
--     preencher e molde morto.
--
-- (b) EST_SAUDE_INTEGRACOES afirmava "contas com coleta medida nos ultimos 7 DIAS". A RPC nao
--     tem janela de 7 dias: tem `dias_tolerancia`, que e PARAMETRO e vale 3 por padrao.
--     Emitir "7 dias" lendo uma leitura de 3 e o pior defeito que esta camada pode produzir —
--     numero certo com rotulo errado, travado, autoritativo, e que o gestor nao tem como
--     conferir. O gabarito passou a CITAR a tolerancia como valor em vez de fixar a janela, e
--     a doutrina do molde (o cadastro AFIRMA, o dado MEDE) fica preservada porque e
--     justamente a separacao entre `afirmado.status` e `veredito`.

-- ============================================================================
-- ATO_CONFIRMACAO_CARD — fonte: propose_action, a mesma que o filtro pos-sintese confere
-- ============================================================================

update public.moldes_de_resposta set
  gabarito = '**{total} card(s) emitido(s) para sua aprovacao**' || chr(10) || chr(10) || '{emitidos}',
  campos = '[
    {"nome":"total","tipo":"inteiro","origem":"toolResults[propose_action].retorno.ok=true -> cardinalidade","obrigatorio":true},
    {"nome":"emitidos","tipo":"lista","origem":"toolResults[propose_action].retorno.approval_id + resumo","obrigatorio":true}
  ]'::jsonb,
  fronteira = 'Nao usar quando nenhum propose_action voltou ok=true com approval_id: zero card e ausencia de bloco, nao bloco com zero.',
  versao = versao + 1,
  verificado_em = current_date
where codigo = 'ATO_CONFIRMACAO_CARD';

-- ============================================================================
-- ATO_CARD_NAO_EMITIDO — o motivo sai LITERAL da recusa, sem parafrase
-- ============================================================================

update public.moldes_de_resposta set
  gabarito = '**Nenhum card foi emitido neste turno.**' || chr(10) || chr(10) || '{motivo}',
  campos = '[
    {"nome":"motivo","tipo":"texto","origem":"toolResults[propose_action|validar_pedido_contra_contrato].erro","obrigatorio":true}
  ]'::jsonb,
  fronteira = 'Nao usar quando ALGUM card saiu no turno: a frase seria falsa e a confirmacao e do outro molde.',
  versao = versao + 1,
  verificado_em = current_date
where codigo = 'ATO_CARD_NAO_EMITIDO';

-- ============================================================================
-- EST_ALERTAS_ABERTOS — duas ferramentas, as duas obrigatorias
-- ============================================================================

update public.moldes_de_resposta set
  campos = '[
    {"nome":"data","tipo":"data","origem":"parametro do turno (hojeIso)","obrigatorio":true},
    {"nome":"alertas","tipo":"inteiro","origem":"toolResults[get_alerts].retorno.alertas_ativos -> cardinalidade","obrigatorio":true},
    {"nome":"recomendacoes","tipo":"inteiro","origem":"toolResults[get_recommendations].retorno.recomendacoes_pendentes -> cardinalidade","obrigatorio":true},
    {"nome":"lista","tipo":"lista","origem":"toolResults[get_alerts].alertas_ativos + toolResults[get_recommendations].recomendacoes_pendentes","obrigatorio":true}
  ]'::jsonb,
  fronteira = 'Nao usar quando so uma das duas leituras chegou: numero em branco ou em zero afirmaria ausencia de pendencia que nao foi verificada.',
  versao = versao + 1,
  verificado_em = current_date
where codigo = 'EST_ALERTAS_ABERTOS';

-- ============================================================================
-- EST_CAMPANHAS_ATIVAS — get_overview DECLARA as duas contagens
-- ============================================================================

update public.moldes_de_resposta set
  campos = '[
    {"nome":"data","tipo":"data","origem":"parametro do turno (hojeIso)","obrigatorio":true},
    {"nome":"total","tipo":"inteiro","origem":"toolResults[get_overview].retorno.campanhas_total","obrigatorio":true},
    {"nome":"ativas","tipo":"inteiro","origem":"toolResults[get_overview].retorno.campanhas_ativas","obrigatorio":true},
    {"nome":"lista","tipo":"lista","origem":"toolResults[get_overview].retorno.campanhas_ativas_lista -> nome + conta + gasto_acumulado","obrigatorio":true}
  ]'::jsonb,
  fronteira = 'Nao usar quando get_overview nao rodou. Nao existe outra ferramenta que declare campanhas_total: somar get_estrutura_conjuntos daria total parcial com cara de total.',
  versao = versao + 1,
  verificado_em = current_date
where codigo = 'EST_CAMPANHAS_ATIVAS';

-- ============================================================================
-- EST_SAUDE_INTEGRACOES — a janela de 7 dias era invencao; a tolerancia e da RPC
-- ============================================================================

update public.moldes_de_resposta set
  gabarito =
    '**Integracoes — leitura de {data}**' || chr(10) || chr(10) ||
    'O cadastro AFIRMA e o dado MEDE coisas diferentes, entao as duas colunas vem separadas:' || chr(10) || chr(10) ||
    'Integracoes Meta cadastradas: {integracoes}' || chr(10) ||
    'Com entrega medida (veredito "viva"): {vivas}' || chr(10) ||
    'Tolerancia usada nesta leitura: {tolerancia} dia(s)' || chr(10) || chr(10) ||
    '{detalhe}' || chr(10) || chr(10) ||
    'Conectada no cadastro nao e prova de dado chegando: o status e uma afirmacao de configuracao, e o veredito e um fato observavel. Quando os dois divergem, o veredito e o que vale.',
  campos = '[
    {"nome":"data","tipo":"data","origem":"parametro do turno (hojeIso)","obrigatorio":true},
    {"nome":"integracoes","tipo":"inteiro","origem":"toolResults[saude_das_integracoes].retorno.integracoes","obrigatorio":true},
    {"nome":"vivas","tipo":"inteiro","origem":"toolResults[saude_das_integracoes].retorno.por_veredito.viva","obrigatorio":true},
    {"nome":"tolerancia","tipo":"inteiro","origem":"toolResults[saude_das_integracoes].retorno.dias_tolerancia","obrigatorio":true},
    {"nome":"detalhe","tipo":"lista","origem":"toolResults[saude_das_integracoes].retorno.contas -> conta + afirmado.status + veredito","obrigatorio":true}
  ]'::jsonb,
  fronteira = 'Nao fixar janela de dias no texto: a tolerancia e parametro da RPC (padrao 3) e tem de sair do proprio retorno.',
  versao = versao + 1,
  verificado_em = current_date
where codigo = 'EST_SAUDE_INTEGRACOES';

-- ============================================================================
-- OS DOIS COMPONIVEIS SEM FONTE — a fronteira passa a dizer por que
-- ============================================================================
--
-- Seguem `segmento_componivel` porque a classificacao responde "tolera analise em volta?",
-- que e doutrina e nao mudou. Nao ter extrator e fato de implementacao, e mora no codigo
-- (`SEM_EXTRATOR`). O que impede mutilacao e `instrucaoDeComposicao` exigir extrator: sem
-- extrator a instrucao de omitir nunca entra no prompt, e o turno degrada para o
-- comportamento de hoje em vez de degradar para pior.

update public.moldes_de_resposta set
  fronteira = 'SEM FONTE HOJE: nenhuma ferramenta devolve a exposicao de orcamento diario vigente. avaliar_orcamento_diario nao e ferramenta de chat e exige p_reais > 0 (julga orcamento PROPOSTO, nao le o vigente); get_estrutura_conjuntos e paginado de 20 e somar pagina daria total parcial. Nao emite ate existir leitura propria.',
  verificado_em = current_date
where codigo = 'NUM_EXPOSICAO_ORCAMENTO';

update public.moldes_de_resposta set
  fronteira = 'SEM FONTE CONFERIVEL HOJE: a ferramenta existe no catalogo mas tem 0 chamadas em producao, entao a forma do retorno nao pode ser conferida contra dado real. O corpo da RPC tem custo_usd, custo_usd_sub e custo_usd_sintese alem de blocos chat e jobs, e errar o nivel da chave emitiria custo parcial como total.',
  verificado_em = current_date
where codigo = 'NUM_CUSTO_LLM_PERIODO';

-- ============================================================================
-- MEMORIA INSTITUCIONAL
-- ============================================================================

insert into public.agent_context (categoria, fato, vigente, desde, company_id)
select 'sistema',
  'ORIGENS DOS CAMPOS DO MOLDE (03/09/2026): o bloco canonico e alimentado por _shared/valores_do_molde.ts a partir dos toolResults do turno, e public.moldes_de_resposta.campos[].origem grava a string EXATA que o extrator le — a prova compara os dois lados e reprova se divergirem. Cinco dos sete componiveis tem extrator: ATO_CONFIRMACAO_CARD e ATO_CARD_NAO_EMITIDO (propose_action), EST_ALERTAS_ABERTOS (get_alerts + get_recommendations, as duas obrigatorias), EST_CAMPANHAS_ATIVAS (get_overview, que DECLARA campanhas_total e campanhas_ativas) e EST_SAUDE_INTEGRACOES (saude_das_integracoes). NUM_EXPOSICAO_ORCAMENTO e NUM_CUSTO_LLM_PERIODO ficaram sem extrator e por isso nao recebem a instrucao de omitir — degradam para resposta inteiramente gerada, como hoje. Tres regras do extrator: campo obrigatorio ausente derruba a resolucao INTEIRA (nunca bloco parcial); valor presente de forma inesperada e DEFEITO nomeado e nao lacuna silenciosa (cortado=true significa retorno truncado em string e foi medido em 59 de 67 chamadas de get_aprovacoes; erro presente significa que o dado NAO foi lido e nunca pode ser tratado como zero); e nenhuma formula nasce no extrator — quando ha conta, ela vem de metrica_canonica.ts. Nenhum dos cinco precisa de formula, o que e proposital: indicador com base de calculo em disputa nao deve estar travado em molde.',
  true, current_date, null
where not exists (
  select 1 from public.agent_context
  where categoria = 'sistema' and fato like 'ORIGENS DOS CAMPOS DO MOLDE (03/09/2026):%'
);
