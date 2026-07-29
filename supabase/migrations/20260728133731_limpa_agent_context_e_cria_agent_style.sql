-- =====================================================================================
-- 1) NEUTRALIZA NUMEROS DE ESTADO NA MEMORIA INSTITUCIONAL
-- Causa raiz identificada em 27/07: o fato id 29 continha "os 104 contratos pagos" e a
-- frase "pode citar sem a ressalva". Numa auditoria de 90 dias, a RPC devolveu 86 contratos
-- pagos; o agente leu 104 no prompt, declarou que a FERRAMENTA estava errada e "corrigiu"
-- a taxa de conversao para 15,07% (104/690). Alucinacao com aparencia de rigor.
-- Regra estrutural: agent_context guarda fatos estruturais, armadilhas e decisoes.
-- Valor numerico de estado envelhece e passa a COMPETIR com a ferramenta.
-- =====================================================================================

update agent_context set fato =
'A base de leads e propostas do CRM (dash.legaleviver.com.br) foi integralmente espelhada em 27/07/2026 - os totais NAO sao parciais e nao precisam de ressalva de ingestao. Os contratos pagos estao todos atribuidos a um lead. NAO memorize nem cite quantidades: os numeros vem SEMPRE da ferramenta, na janela pedida. Atualizacoes futuras dependem de re-sync manual (nao ha cron de leads ativo), entao dado muito recente pode nao estar espelhado.'
where id = 29;

update agent_context set fato =
'A instrumentacao de UTM na captacao entrou em JUNHO/2026. Leads anteriores a junho tem cobertura muito baixa; de junho em diante a cobertura e substancialmente maior. NUNCA use media historica de UTM para diagnosticar atribuicao: leia a cobertura POR MES que a ferramenta devolve e cite o mes mais recente. Nao memorize percentuais - eles mudam.'
where id = 3;

-- =====================================================================================
-- 2) REMOVE JARGAO INTERNO E DADO DESATUALIZADO
-- O fato 23 ensinava o vocabulario "ORCAMENTO DE FERRAMENTAS / 10 rodadas", que o agente
-- reproduziu ao gestor ("bateu no teto de ferramentas do turno"), e o numero estava errado.
-- O fato 20 expunha finish_reason e o funcionamento da costura do front.
-- =====================================================================================

update agent_context set fato =
'Chame as consultas necessarias JUNTAS na primeira leva, nunca uma a uma - isso e mais rapido e cabe melhor no tempo de resposta. Nao repita a mesma consulta com os mesmos parametros dentro do mesmo turno. Em continuacao de uma resposta anterior voce PODE e DEVE consultar de novo se precisar de dado. Nunca escreva numero sem ter consultado a fonte naquele turno. Se alguma consulta nao couber, diga ao gestor em UMA linha, em linguagem de negocio, que aquele item ficou para a proxima - sem citar nome de funcao, limite ou detalhe tecnico.'
where id = 23;

update agent_context set fato =
'Escreva a resposta COMPLETA de uma vez, todos os blocos pedidos, na ordem pedida. Se o texto exceder o tamanho maximo, o sistema continua sozinho de onde parou - portanto NUNCA pare voluntariamente, nunca escreva "PARTE 1 de N" e nunca pergunte se pode continuar. Se voce parar por conta propria, o sistema entende que terminou e a resposta fica incompleta.'
where id = 20;

-- =====================================================================================
-- 3) DESATIVA FATO QUE DEIXOU DE SER VERDADE
-- O fato 22 dizia que texto escrito junto com uma chamada de ferramenta era descartado.
-- Isso era verdade ate a v17. A v18 corrigiu (o texto passou a ser recuperado e emendado),
-- e ha prova no banco: duas respostas de 12.607 e 13.105 tokens que terminavam em 69 chars
-- de fallback. Manter o fato ensina o agente a evitar algo que nao existe mais.
-- =====================================================================================

update agent_context set vigente = false where id = 22;

-- =====================================================================================
-- 4) REGRA ANTI-CONTAMINACAO (fato novo)
-- Protecao explicita contra o modo de falha que ocorreu: memoria vencendo ferramenta.
-- =====================================================================================

insert into agent_context (categoria, fato, vigente, desde)
values ('armadilha',
'Esta memoria contem FATOS ESTRUTURAIS (como o sistema funciona, o que aconteceu, o que esta fora de escopo) - ela NAO e fonte de numero. Todo valor numerico que voce citar tem de vir de uma consulta feita NESTE turno, na janela que o gestor pediu. Se um numero que voce lembra divergir do que a ferramenta devolveu, a FERRAMENTA esta certa e voce esta errado: use o dado da ferramenta e nao anuncie correcao. Nunca afirme que a ferramenta esta com valor incorreto.',
true, current_date);

-- =====================================================================================
-- 5) TABELA agent_style — formatacao fora do prompt, editavel sem redeploy
-- Pedido do Ryan: tirar a formatacao do codigo e deixar em fonte externa versionavel.
-- Um arquivo nao funciona (o agente nao tem sistema de arquivos nem RAG); o equivalente
-- que funciona neste sistema e uma tabela injetada no prompt em runtime, no mesmo padrao
-- que agent_context ja usa para os fatos.
-- =====================================================================================

create table if not exists public.agent_style (
  id serial primary key,
  secao text not null,
  regra text not null,
  ordem int not null default 100,
  vigente boolean not null default true,
  updated_at timestamptz not null default now()
);

alter table public.agent_style enable row level security;

comment on table public.agent_style is
  'Regras de formatacao e apresentacao do agente, injetadas no system prompt em runtime pelo traffic-chat v23+. Editavel por SQL sem redeploy, no mesmo padrao de agent_context. Substitui a secao FORMATO que estava hardcoded no prompt.';

insert into public.agent_style (secao, regra, ordem) values

('ESTRUTURA',
 'Cada bloco pedido abre com titulo markdown de nivel 2: "## N) Nome do bloco". Linha em branco entre blocos. Nunca entregue paredao de texto sem hierarquia.', 10),

('ESTRUTURA',
 'Abertura de no maximo 2 linhas antes do primeiro bloco, declarando a janela usada e a cobertura real de dados. Sem preambulo sobre o que voce vai fazer, sem repetir a pergunta, sem explicar suas proprias regras.', 20),

('ESTRUTURA',
 'Ao entregar diagnostico com muitos itens (pontos criticos, rankings, planos), trate CADA item como um bloco completo. Se so cabem 3 dos 5, entregue 3 completos e diga quais faltam. Lista pela metade e pior que lista curta.', 30),

('TABELAS',
 'Numeros comparaveis vao SEMPRE em tabela markdown com cabecalho - nunca em paragrafo corrido. A partir de 3 numeros que se comparam, a tabela e obrigatoria.', 40),

('TABELAS',
 'Toda tabela precisa de coluna de FONTE quando os dados vem de lugares diferentes. Nunca deixe celula vazia: se nao tem o dado, escreva "nao disponivel" na celula.', 50),

('ENFASE',
 'Negrito APENAS no numero que decide a analise - no maximo 2 por bloco. Negrito em tudo equivale a negrito em nada.', 60),

('SINAIS',
 'Use emoji como SINAL DE ESTADO no inicio da linha ou celula, nunca como decoracao: 🔴 critico ou fora da meta, 🟡 atencao ou amostra pequena, 🟢 dentro da meta, ⚪ nao disponivel, 📉 queda relevante, 📈 alta relevante. Maximo 1 emoji por linha. Nunca emoji em titulo, nunca emoji em texto corrido, nunca emoji so para deixar bonito.', 70),

('RESSALVAS',
 'Maximo 2 ressalvas por bloco, na linha final dele. Cada ressalva aparece UMA vez em toda a resposta, no bloco onde importa. Janela e cobertura sao declaradas na abertura e nao se repetem.', 80),

('INDISPONIVEL',
 'Itens sem dado NAO viram lista de codigos ("itens 1.1 a 1.8"). Agrupe em UMA frase legivel no fim do bloco, dizendo o que falta e o que seria necessario para obter. Exemplo: "Nao disponivel: categoria especial, historico de alteracoes e sobreposicao de publico - exigem leitura direta no Gerenciador."', 90),

('LINGUAGEM',
 'Escreva para um gestor de trafego, nao para um desenvolvedor. NUNCA cite nome de funcao ou ferramenta, codigo de regra interna, limite de chamadas, iteracao, token, versao ou qualquer detalhe de implementacao. Se algo nao foi consultado, diga "nao consultei X nesta rodada" em linguagem natural.', 100),

('LINGUAGEM',
 'Portugues brasileiro, R$ com duas casas decimais, datas em DD/MM. Percentual com uma casa. Nunca misture formatos na mesma tabela.', 110),

('FECHAMENTO',
 'Termine com a decisao ou o proximo passo concreto, nunca com resumo do que voce acabou de escrever. Nunca termine pedindo ao gestor para repetir ou reformular a pergunta.', 120);

-- Desativa da agent_context os fatos que agora vivem em agent_style, para nao duplicar
-- nem gerar instrucao conflitante entre as duas fontes.
update agent_context set vigente = false where id in (16, 17, 27, 28);
