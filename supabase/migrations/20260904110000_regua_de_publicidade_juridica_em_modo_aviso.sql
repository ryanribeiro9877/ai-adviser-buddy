-- REGUA DE PUBLICIDADE DE SERVICO JURIDICO — PROPOSTA, EM MODO AVISO
--
-- TODAS as regras entram com severidade 'atencao'. NENHUMA bloqueia. Isso e deliberado e o
-- gestor pediu explicitamente: `checar_par_texto_e_peca` so faz a emissao RECUSAR quando o
-- veredito e 'reprova' (severidade 'bloqueia'), e 'atencao' apenas anota. Regra larga ativada
-- como bloqueio sem revisao de advogado travaria a operacao na manha seguinte, e o custo de
-- travar 42 pecas legitimas recai sobre quem opera, nao sobre quem escreveu a regra.
--
-- LIMITE DE QUEM ESCREVEU, declarado e nao disfarcado: eu nao sou advogado e o gestor tambem
-- nao. Isto e um rascunho para um advogado revisar em minutos, com o dispositivo citado ao lado
-- de cada regra para que a revisao seja de MERITO e nao de garimpo. Onde eu tenho duvida, esta
-- escrito "DUVIDA" na observacao — e a duvida da LGL-JUR-03 e grande o bastante para ser o
-- primeiro assunto da conversa com o advogado.
--
-- NORMA APLICAVEL, conferida em 04/09/2026 e nao citada de memoria:
--   * Provimento CFOAB n. 205/2021 (publicidade e informacao na advocacia). Revogou o
--     Provimento 94/2000 (art. 12) e VIGE desde agosto de 2021 (art. 13). A revisao do texto
--     esta em "fase final" desde dez/2025, mas NENHUMA norma substitutiva foi publicada ate
--     esta data — entao o 205/2021 e o texto vigente. Citar o 94/2000 seria citar revogado.
--   * Codigo de Etica e Disciplina da OAB (Resolucao CFOAB n. 02/2015), art. 39: publicidade
--     meramente informativa, com discricao e sobriedade, vedada captacao de clientela e
--     mercantilizacao.
--   * Estatuto da Advocacia (Lei 8.906/1994), art. 34, IV: angariar ou captar causa e infracao
--     disciplinar, independentemente do canal.
--   * CDC (Lei 8.078/1990): art. 31 (informacao correta, clara, precisa e ostensiva), art. 36
--     paragrafo unico (o fornecedor mantem os dados faticos que sustentam a mensagem), art. 37
--     §1º e §3º (enganosa, inclusive POR OMISSAO de dado essencial) e art. 37 §2º (abusiva a
--     que explora o medo).
--
-- ESCOPO POR LOOKAHEAD, e por que nao por coluna. `promessas_proibidas` NAO tem coluna de
-- escopo: as 10 regras existentes sao todas de oferta de credito e valem globalmente. Sem
-- escopo, uma regra de "gratuidade" pegaria "o Registrato do Banco Central e um servico
-- gratuito" nos videos de educacao financeira da Legal e Viver — que nao e publicidade
-- advocaticia nem gratuidade nossa. Medido: a versao ingenua produzia 2 falsos positivos
-- desses. Sao DOIS remedios diferentes, e vale saber qual esta em qual regra:
--   * 01, 02, 04 e 05 ancoram em contexto juridico com lookahead
--     `(?=.*(juridic|advogad|judicial))`, que o regex do Postgres suporta.
--   * a 03 NAO usa lookahead: o que a salva e PROXIMIDADE, `[^.!?]{0,25}` entre
--     "analise/consulta/atendimento" e "gratuit", sem cruzar pontuacao. E por isso que
--     "servico gratuito" do Registrato nao casa. Ancorar a 03 em contexto juridico seria
--     redundante: quem oferta "analise gratuita" ja esta no assunto.
-- Fica registrado que a solucao ESTRUTURAL seria uma coluna de escopo (`escopo` = credito |
-- juridico | qualquer); nao a criei porque mudaria a assinatura de uma tabela com seis
-- consumidores vivos. Se a regua jurídica crescer, a coluna passa a valer.
--
-- ATENCAO A UMA ASSIMETRIA QUE FICA DE FORA DESTA MIGRATION: a edge `compliance-check` só
-- consulta `promessas_proibidas` quando a empresa e de credito ("COHAPM nao herda substitutos
-- CLT"). Logo, estas regras NAO vao aparecer por aquele caminho para a COHAPM. Elas aparecem
-- pelo caminho que de fato roda na emissao do anuncio, `checar_par_texto_e_peca`, que consulta
-- o portao para qualquer empresa. Corrigir a assimetria e decisao do gestor, porque abrir
-- `compliance-check` para a COHAPM tambem exporia as 10 regras de credito a um negocio que nao
-- e de credito — que foi a razao original do recorte.
--
-- ALCANCE MEDIDO NO ACERVO REAL (145 videos com transcricao; 42 sao do Juridico da COHAPM).
-- Nenhuma das cinco regras pega uma unica peca fora do Juridico:
--   LGL-JUR-01  6 pecas   (0 no ar como anuncio)
--   LGL-JUR-02  5 pecas   (3 no ar)
--   LGL-JUR-03 42 pecas   (6 no ar)  <- 42 de 42: ver DUVIDA
--   LGL-JUR-04  8 pecas   (2 no ar)
--   LGL-JUR-05  1 peca    (1 no ar)

insert into public.promessas_proibidas
  (regra_code, proibido, padrao, exige_presenca_de, seguro, severidade, active, fonte, observacao)
values

-- =========================================================================================
-- LGL-JUR-01 — AFIRMACAO INCONDICIONAL DE DIREITO A BENEFICIO QUE A LEI CONDICIONA
--
-- A mais grave das tres categorias e tambem a mais objetiva de detectar, que e a combinacao
-- que justifica ser a primeira candidata a virar bloqueio depois da revisao.
-- Por que e grave: BPC/LOAS, aposentadoria rural e isencao de IR por doenca grave TODOS
-- dependem de requisito legal (renda per capita, comprovacao de atividade rural, laudo e
-- enquadramento). Dizer "essa pessoa tem direito" a quem ainda nao teve o caso analisado
-- omite o dado essencial - a condicao - e leva o consumidor a agir na crenca de um direito
-- que talvez nao tenha. Isso e exatamente a hipotese do art. 37 §3º do CDC.
-- O hedge e o que separa o licito do ilicito: "pode ter direito" informa; "tem direito"
-- promete. Por isso a regra so dispara na AUSENCIA do hedge.
-- =========================================================================================
('LGL-JUR-01',
 'Afirmar que a pessoa TEM direito a um beneficio que a lei concede sob condicao (BPC/LOAS, aposentadoria rural, isencao de IR por doenca grave), sem o condicional e sem dizer que depende de analise.',
 '(?=.*(jur[ií]dic|advogad|judicial|a[cç][aã]o na justi[cç]a))(?=.*\m(tem|t[eê]m|d[aã]o|d[aá]) +direito\M)',
 '(pode|poder[aá]|possa|talvez|requisito|depende|caso a caso|se +tiver|an[aá]lise +do +caso)',
 'Troque por "pode ter direito" ou "pode se enquadrar", e diga que o enquadramento depende de analise dos requisitos legais do beneficio.',
 'atencao', true,
 'CDC art. 37 §1º e §3º (publicidade enganosa, inclusive por omissao de dado essencial) e art. 31 (informacao correta e precisa); Provimento CFOAB 205/2021 art. 3º, II (vedada divulgacao de informacao que possa induzir a erro) e art. 6º (vedada mencao a promessa de resultados).',
 'SEVERIDADE RECOMENDADA APOS REVISAO: bloqueia. E a unica das cinco que eu recomendaria promover, porque o defeito e verificavel na frase: o beneficio e condicional na lei e a frase o apresenta como certo. Pega 6 pecas, todas do Juridico, ZERO falso positivo fora dele. FALHA CONHECIDA: "Cuidar da saude e aposentadoria" diz "Varias pessoas tem esse direito e nao sabem", afirmativo, mas escapa porque a frase anterior traz "podem permitir" e o hedge e avaliado no texto inteiro. Preferi falso negativo a falso positivo.'),

-- =========================================================================================
-- LGL-JUR-02 — MENCAO A DECISAO JUDICIAL, RESULTADO OBTIDO OU REVERSAO GARANTIDA
--
-- Aqui a norma da OAB e mais explicita que o CDC: o art. 6º e seu paragrafo unico vedam a
-- mencao a promessa de resultados E a utilizacao de casos concretos para oferta de atuacao
-- profissional. "Existem decisoes judiciais obrigando os bancos a devolverem TODOS os valores"
-- usa resultado de caso concreto como argumento de venda, e o "todos" o transforma em
-- promessa. A cartilha do Comite Regulador do Marketing Juridico do CFOAB reforca a vedacao a
-- referencia a decisoes e resultados de qualquer natureza.
-- =========================================================================================
('LGL-JUR-02',
 'Usar decisao judicial, resultado obtido ou reversao judicial como argumento de oferta ("existem decisoes obrigando os bancos a devolver todos os valores", "pode ser revertida judicialmente").',
 '(?=.*(jur[ií]dic|advogad|judicial))(?=.*(revertid|revers[aã]o judicial|decis[oõ]es judiciais|obrigando os bancos|devolver(em)? +todos|ganho de causa|\m[eê]xito\M))',
 null,
 'Descreva o DIREITO em tese e o servico oferecido, sem citar decisao, resultado ou probabilidade de reversao. Ex.: "cobrancas indevidas podem ser contestadas na forma da lei".',
 'atencao', true,
 'Provimento CFOAB 205/2021 art. 6º e paragrafo unico (vedada mencao a promessa de resultados e utilizacao de casos concretos para oferta de atuacao profissional); Codigo de Etica e Disciplina OAB (Res. 02/2015) art. 39; CDC art. 37 §1º.',
 'SEVERIDADE RECOMENDADA: bloqueia SE o advogado confirmar que "pode ser revertida judicialmente" ja e mencao a resultado; atencao se o condicional a salvar. E aqui que eu NAO sei responder: das 5 pecas pegas, 3 dizem "PODE ser revertida" e 2 afirmam decisoes concretas com "todos os valores". Se o condicional bastar, reescrever para pegar so as 2. Pega 5 pecas, 3 NO AR.'),

-- =========================================================================================
-- LGL-JUR-03 — GRATUIDADE COMO CHAMARIZ
--
-- Esta e a regra que exige mais cautela e a que eu tenho MENOS confianca, apesar de ser a de
-- fundamento textual mais direto. O art. 3º, I do Provimento 205/2021 veda "referencia, direta
-- ou indireta, a valores de honorarios, forma de pagamento, GRATUIDADE ou descontos e reducoes
-- de precos COMO FORMA DE CAPTACAO DE CLIENTES". As tres ultimas palavras sao o problema:
-- a vedacao e condicionada a finalidade de captacao, e a finalidade nao esta na frase - esta
-- no contexto. Consulta inicial gratuita pode ser informacao legitima de como o servico
-- funciona, ou pode ser isca. A norma nao resolve isso no texto, e eu nao tenho competencia
-- para resolver.
-- Agrava a duvida o fato de o conjunto inteiro ser TRAFEGO PAGO: ha entendimento de que
-- publicidade ATIVA impulsionada ofertando servico ja e captacao (art. 2º, VIII define captacao
-- como mecanismo que "de forma ativa" se destina a angariar clientes). Se esse entendimento
-- procede, o problema nao e a palavra "gratuita" - e o modelo de anuncio. Isso e uma pergunta
-- de advogado, nao de regex, e esta REGISTRADA aqui em vez de decidida.
-- =========================================================================================
('LGL-JUR-03',
 'Oferecer analise, consulta ou consultoria juridica GRATUITA como chamada de acao em publicidade ativa impulsionada.',
 '(an[aá]lise|consultoria|consulta|avalia[cç][aã]o|atendimento)[^.!?]{0,25}(gratuit|sem custo|de gra[cç]a)',
 null,
 'Se houver captacao: retire a mencao a gratuidade e convide para informacao ("saiba como funciona", "conheca seus direitos"). Se for informacao legitima de consulta inicial, esta regra deve ser DESATIVADA em vez de reescrita.',
 'atencao', true,
 'Provimento CFOAB 205/2021 art. 3º, I (vedada referencia direta ou indireta a gratuidade COMO FORMA DE CAPTACAO de clientes) e art. 2º, VIII (captacao e o mecanismo que de forma ativa se destina a angariar clientes); Lei 8.906/1994 art. 34, IV; CED OAB art. 39.',
 'DUVIDA, E A PRINCIPAL DESTA ENTREGA. Pega 42 de 42 pecas do Juridico - regra que pega o acervo inteiro normalmente esta larga demais, e fica ativa em AVISO para o gestor e o advogado verem o tamanho, nao para barrar. Duas leituras e eu nao sei escolher: (a) consulta inicial gratuita e legitima e a regra deve ser DESATIVADA; (b) gratuidade em anuncio pago com CTA de contratacao e captacao vedada, e o conserto e no roteiro das 42. PERGUNTA QUE PODE TORNAR A REGRA IRRELEVANTE: se trafego pago ofertando servico advocaticio ja e captacao ativa vedada (art. 2º, VIII), o problema e o canal e nao a palavra. NAO promover a bloqueio antes dessa resposta.'),

-- =========================================================================================
-- LGL-JUR-04 — EXPLORACAO DO MEDO E SENSACIONALISMO
--
-- Duas fontes independentes convergem: o CDC art. 37 §2º chama de ABUSIVA a publicidade que
-- "explore o medo", e o CED art. 39 exige discricao e sobriedade, com a cartilha do CFOAB
-- vedando expressamente o "carater sensacionalista".
-- "Cuidado! Os juros podem ser abusivos", "isso nao e credito, e uma armadilha" e "a divida
-- nunca acaba" operam por alarme. A gradacao importa: alertar sobre pratica ilegal de terceiro
-- e legitimo e ate socialmente util; a fronteira e o tom, e tom nao se mede com regex. Por isso
-- esta regra e de AVISO e eu nao recomendo promove-la.
-- =========================================================================================
('LGL-JUR-04',
 'Construir a chamada por alarme ("Cuidado!", "e uma armadilha", "a divida nunca acaba") em publicidade de servico juridico.',
 '(?=.*(jur[ií]dic|advogad|judicial))(?=.*(armadilha|\mcuidado\M|nunca +acaba|nunca +diminui))',
 null,
 'Troque o alarme pelo fato verificavel e pelo direito em tese: "contratos podem conter encargos acima do limite legal; a analise identifica se e o seu caso" em vez de "cuidado, e uma armadilha".',
 'atencao', true,
 'CDC art. 37 §2º (e abusiva a publicidade que explore o medo); Codigo de Etica e Disciplina OAB (Res. 02/2015) art. 39 (discricao e sobriedade); cartilha do Comite Regulador do Marketing Juridico do CFOAB sobre o Provimento 205/2021 (vedado carater sensacionalista).',
 'SEVERIDADE RECOMENDADA: manter em atencao, NAO promover. "Sensacionalismo" e juizo de tom e regex nao mede tom. Pega 8 pecas do Juridico, 2 NO AR. O escopo por lookahead foi indispensavel: sem ancorar em contexto juridico, a regra pegava 4 videos de EDUCACAO EM SEGURANCA da Legal e Viver ("cuidado com boleto falso"), que nem sao publicidade advocaticia. Esses 4 falsos positivos foram medidos, nao imaginados.'),

-- =========================================================================================
-- LGL-JUR-05 — AFIRMACAO FACTUAL SOBRE TERCEIROS SEM SUSTENTACAO DOCUMENTAL
--
-- O CDC art. 36 paragrafo unico obriga o fornecedor a MANTER EM SEU PODER os dados faticos,
-- tecnicos e cientificos que dao sustentacao a mensagem publicitaria. "Muitos bancos cobram o
-- dobro do que deveria" e afirmacao quantitativa sobre conduta de terceiros identificaveis:
-- ou existe o estudo que a sustenta, ou a frase nao se sustenta - e o onus e de quem anuncia.
-- Ha risco adicional que nao e de consumo e sim de terceiro (dano a imagem de instituicoes),
-- fora do meu alcance avaliar.
-- =========================================================================================
('LGL-JUR-05',
 'Afirmar conduta ilegal generalizada de terceiros identificaveis em numero ("muitos bancos cobram o dobro", "a maioria dos bancos") sem dado que sustente.',
 '(?=.*(jur[ií]dic|advogad|judicial))(?=.*(muitos +bancos|a +maioria +dos +bancos|os +bancos +cobram|todo +banco))',
 null,
 'Individualize e condicione: "a taxa do SEU contrato pode estar acima do limite legal; a analise verifica" em vez de afirmar conduta do mercado.',
 'atencao', true,
 'CDC art. 36 paragrafo unico (o fornecedor mantem em seu poder os dados faticos e tecnicos que sustentam a mensagem) e art. 37 §1º; Provimento CFOAB 205/2021 art. 3º, II (informacao que possa causar dano a terceiros).',
 'Pega 1 peca, e ela esta NO AR ("Emprestimo na conta corrente": "muitos bancos cobram o dobro do que deveria", 36 impressoes). Regra estreita de proposito - lista enumerada, nao generica. DUVIDA: se existir estudo que sustente a afirmacao, ela e licita e a regra vira falso positivo; nao ha no sistema onde registrar essa sustentacao, e isso e lacuna real (o art. 36 exige que o dado EXISTA e fique guardado, nao que apareca no anuncio).')

-- A chave unica da tabela e `proibido` (nao `regra_code`), entao o idempotente vai por ela.
on conflict (proibido) do update set
  regra_code        = excluded.regra_code,
  padrao            = excluded.padrao,
  exige_presenca_de = excluded.exige_presenca_de,
  seguro            = excluded.seguro,
  severidade        = excluded.severidade,
  active            = excluded.active,
  fonte             = excluded.fonte,
  observacao        = excluded.observacao;
