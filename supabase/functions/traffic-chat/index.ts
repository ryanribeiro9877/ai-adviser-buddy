// supabase/functions/traffic-chat/index.ts (v28.12)
// v28.12 (07/08/2026) - get_aprovacoes PARA DE CHAMAR FALHA DE "ainda nao executado".
//   A derivacao de situacao vivia AQUI e usava `falhou = !!executed_at && ok === false`. Falha
//   ANTES de qualquer escrita deixa executed_at nulo de proposito (o card segue re-executavel),
//   entao ela caia no ramo final, "aprovado, ainda NAO executado" - indistinguivel de um card que
//   nunca rodou. Em 07/08 as 20:57 o agente leu exatamente isso para o card b5e2f338, cuja criacao
//   tinha falhado as 20:56:01, e disse ao gestor "aguarde alguns instantes, o conjunto esta sendo
//   criado". Ele NAO inventou o estado - inventou a causalidade, porque o estado era ambiguo.
//   A situacao passa a vir de _shared/aprovacoes.ts (situacaoDoCard), a MESMA funcao que o
//   mcp-server usa, e o retorno ganha `estado` legivel por maquina (executado | execucao_falhou |
//   aguardando_execucao | aguardando_decisao | recusado), motivo_da_falha em linguagem de gestor,
//   tentativas e pode_ser_retentado. A nota da ferramenta declara que a execucao e SINCRONA com a
//   aprovacao e proibe as frases de espera - a doutrina tambem esta em agent_context, que e onde
//   ela pode ser revogada sem deploy.
// v28.11 (07/08/2026) - O RETORNO DA FERRAMENTA PASSA A SOBREVIVER A REQUISICAO, e pedido
//   longo de ANALISE deixa de precisar de costura. Dois consertos, uma causa medida.
//   EVIDENCIA (conversa 5b08d921-9fa9-4d20-b63e-3db71dbcb8cc, 07/08/2026): a 1a requisicao
//   chamou 9 ferramentas, gastou 133,5s e terminou em finish_reason=length com
//   tokens_in=193.853. O front pediu a continuacao (MAX_CONTINUATIONS=3) e a 2a requisicao
//   entrou com tokens_in=47.353 e tools:[]. Nela o agente escreveu "ver retorno abaixo" para
//   a exposicao de orcamento e nunca entregou o numero (avaliar_pacing tinha devolvido 3
//   conjuntos entregando / R$ 216,00 por dia), e escreveu "Nao consegui chamar a regua de
//   teto vigente nesta rodada" - quando teto_vigente FOI chamada e a RPC responde saudavel
//   (governa R$ 1,60, Roberto, 30/07). Da perspectiva da continuacao aquilo era VERDADE: o
//   sistema tinha esvaziado o contexto. Nao foi teto (teto_tools=false), nao foi prazo
//   (deadline_tools=false) e nao foi prompt - a regra de fail-closed agiu certo sobre um
//   contexto vazio.
//   CAUSA: o historico era remontado do banco com role+content APENAS. chat_messages.tool_calls
//   guarda nome e argumentos, nunca o JSON devolvido; os retornos viviam so no array 'messages'
//   em memoria e morriam com a requisicao.
//   (1) PERSISTENCIA - coluna NOVA chat_messages.tool_results (migracao
//       retorno_de_ferramenta_persistido_em_chat_messages). Coluna propria e nao um campo de
//       'diagnostico' porque diagnostico e telemetria pequena e lida com frequencia por sonda e
//       auditoria; retorno de ferramenta chega a 14.000 chars POR ferramenta e ate 12 por turno
//       (~170 KB), e misturar os dois faria toda leitura de telemetria arrastar o payload de
//       dado. Grava-se o MESMO corte de 14.000 que o modelo viu - persistir menos que isso
//       criaria uma segunda verdade sobre o que ele leu.
//   (2) REINJECAO - na remontagem, os retornos dos 2 ultimos turnos de assistente voltam como
//       bloco DECLARADO antes do texto da resposta (o texto continua sendo a ultima coisa que
//       o modelo le, para a continuacao retomar no ponto). Nao ha sumarizacao por modelo: o
//       JSON e achatado em 'caminho = valor' e, quando falta espaco, sai PRIMEIRO o campo sem
//       numero, depois se declara quantos campos ficaram de fora. Numero nao se resume.
//       Turno mais antigo nao reinjeta retorno - e diz que nao reinjetou, com os nomes das
//       ferramentas. Corte silencioso continua proibido (licao do cortarLista / v27.1).
//       Orcamento: 12.000 chars no bloco inteiro, 1.800 por ferramenta (~3k tokens no pior
//       caso, contra os 47k que a continuacao ja gastava - e ela gastava sem o dado).
//   (3) ROTA ASSINCRONA PARA PEDIDO LONGO DE ANALISE. O v27 dizia que ajustar orcamento era o
//       ultimo recurso e que a saida era o job assincrono; ela agora existe. O criterio e
//       medido, nao inventado - 20 dias de turnos deste chat (74 com telemetria):
//         - familias de assunto do pedido (mesmo vocabulario que prioridadeTool ja usa para
//           ordenar o lote) <= 4: 68 turnos, ZERO truncados, media de 3,5 ferramentas;
//         - >= 5 familias: 3 turnos, 2 truncados (12 e 9 ferramentas) e o unico "inteiro"
//           levou 132s, ou seja, encostou no teto de 150s da plataforma;
//         - tamanho do pedido sozinho NAO serve: um dos truncados tinha 1.404 chars, abaixo
//           do limite de 1.500 que o front usava. Fica como rede secundaria, nao como regra.
//       QUATRO GUARDAS, cada uma cobrindo uma capacidade que a rota assincrona nao tem:
//       continuacao NAO vai (o job replaneja do zero, nao retoma texto cortado); pedido com
//       ANEXO nao vai (o job nao le anexo); pergunta no MEIO DE UM FIO nao vai (o job recebe
//       so a pergunta, nao le o historico); e PEDIDO DE ATO nao vai - propose_action nao
//       existe no traffic-agent-job (ele mesmo declara "Acao continua no chat"), entao
//       rotear o pedido de criacao de 07/08 para la teria trocado um card truncado por card
//       NENHUM. Por isso a decisao saiu do front (que roteava so por tamanho, e portanto
//       mandava pedido de ato para uma rota sem card) e virou uma regra unica aqui.
//       Na medicao, as guardas nao custam caso verdadeiro: os 3 pedidos que o criterio
//       roteia sao todos a primeira pergunta do fio, e o unico turno truncado que elas
//       barram e a continuacao - que a Parte 1 conserta em vez de encaminhar.
//   Marcador de versao vai a "chat-v28.11". Nota: o v28.10 subiu com o marcador ainda em
//   "chat-v28.9" - mesmo esquecimento que o v28.1 corrigiu uma vez; agora o literal e uma
//   constante unica (VERSAO), usada nos tres lugares.
// v28.10 (04/08/2026) - GT-13: A PONTE DO DRIVE ATE O ANUNCIO. Tres mudancas.
//   (1) get_drive_criativos e get_analise_visual_drive passam a devolver drive_file_id (a segunda
//       tambem ja_enviada_para_meta, via join com media_uploads na propria RPC). O id era lido do
//       Drive e DESCARTADO antes de chegar ao agente: ele sabia dizer "o video tal e o melhor" e
//       nao sabia dizer qual arquivo era, entao a peca do acervo nao tinha como virar anuncio.
//   (2) criar_anuncio_a_partir_de reconhece DOIS pedidos - replicacao pura e peca nova - e chama
//       pedido_de_anuncio_completo antes de montar qualquer coisa, nos dois casos. A funcao e a
//       fonte unica do que cada pedido exige; deixar um ramo sem verificacao poria a doutrina em
//       dois lugares. completo=false devolve a mensagem DELA e nao emite card; falha de
//       verificacao tambem nao emite, igual a pode_executar_acao e avaliar_orcamento_diario.
//       peca_ja_na_biblioteca=false a RPC apenas AVISA - aqui e recusa, porque o card falharia na
//       execucao depois de aprovado, e aprovar card de anuncio e o ato que inicia gasto.
//   (3) O summary do card leva a mensagem da verificacao INTEIRA, inclusive a nota visual da peca
//       e a lacuna declarada (nada avalia o par texto+peca). O gestor le o card no instante da
//       decisao; o que fica so no payload recolhido ele nao le - mesma razao do aviso de orcamento.
// supabase/functions/traffic-chat/index.ts (v28.6)
// v28.9 (04/08/2026) - AVISO DE ORCAMENTO. Orcamento diario na Meta e MEDIA, nao limite do dia:
//   a propria tela declarou, para R$ 60,00/dia, teto real de R$ 105,00 no dia (175%) e R$ 420,00
//   na semana. O gestor decidiu "R$ 60 por campanha" achando que era limite; com tres campanhas o
//   pior dia e R$ 315,00, e ninguem tinha lhe dito. Agora a RPC avaliar_orcamento_diario julga o
//   valor E traduz o que ele permite, e o texto dela vai para o SUMMARY do card - onde o gestor le
//   no momento de decidir, nao para tras na conversa. A comparacao local contra teto_sanidade SAIU
//   junto com a variavel: dois juizes para a mesma pergunta produziram o desync de 31/07-03/08.
// v28.8 (04/08/2026) - GT-06 fechado dos DOIS lados. O caminho de MODIFICACAO (pausar_campanha,
//   pausar_criativo, alterar_orcamento, escalar_criativo) nao lia trava nenhuma: oferecia card de
//   pausa com a flag desligada, o gestor gastaria a aprovacao e a executora bloquearia depois.
//   A regra virou RPC unica - pode_executar_acao - e os DOIS caminhos consultam ela. O bloco
//   inline que o v28.6 pos no caminho de criacao SAIU: doutrina em tres lugares (dois aqui, um na
//   meta-actions) foi o que produziu o desync do "nasce pausado" de 31/07 a 03/08.
//   Falha da propria verificacao tambem NAO emite card - se nao deu para saber, nao se promete.
// v28.7 (04/08/2026) - GT-11: get_estrutura_conjuntos deixa de vazar entre empresas e passa a
//   paginar. A RPC nova exige p_company_id; sem ele devolve lista vazia com AVISO_CRITICO, entao
//   ate este deploy a tool estava CEGA - de proposito, porque cego declarando e melhor que ver
//   conjunto de outro anunciante e concluir sobre ele. O card GT-11 dizia "28 de 53 invisiveis,
//   falta paginacao" e estava errado nos dois pontos: nao havia truncagem (54 declarados, 54
//   devolvidos) e o defeito era a AUSENCIA DE FILTRO DE EMPRESA - 46 conjuntos da Legal
//   misturados com 8 da COHAPM, sem marcacao. Mesmo vazamento do get_criativos_conteudo (30/07).
//   Teto da ferramenta vai a 3 chamadas: 46 relevantes em paginas de 20 nao cabem em 2, e o
//   proprio limite recriaria o universo parcial que a paginacao existe para evitar.
// v28.6 (03/08/2026) - CINCO CONSERTOS DE UMA VEZ, todos achados na auditoria forense de 03/08:
//   (1) GT-03 - O AGENTE VE A PROPRIA FILA. Nova tool get_aprovacoes. Ele nao tinha NENHUMA
//       forma de saber o que aconteceu com um card depois de emitido: nem se foi aprovado, nem
//       se executou, nem qual erro a Meta devolveu. Perguntado sobre um estado que nao
//       enxergava, preencheu o vazio - em 31/07 e de novo em 02/08. Expor a fila e metade do
//       conserto da fabricacao.
//   (2) GT-30 - A REGRA ANTI-FABRICACAO COBRIA ATO E NAO COBRIA LEITURA. Em 02/08, JA COM O
//       v28.5 NO AR, o agente escreveu "Confirmado: as tres campanhas apareceram no sistema
//       desta vez" com tools:[] e tool_calls:null. Ele nao afirmou ter CRIADO nada - afirmou ter
//       VERIFICADO. A regra falava de emitir/criar/executar, e leitura passou pela fresta. E foi
//       a leitura fabricada que causou o dano, porque o gestor decidiu em cima dela.
//   (3) GT-06 - O CHAT NAO LIA AS TRAVAS. Ele conferia contas_permitidas_criacao mas nunca
//       master_enabled nem action_flags. Resultado: emitia card de acao DESLIGADA, o gestor
//       aprovava, e a executora bloqueava depois. Promessa que o sistema nao podia cumprir.
//   (4) SINGLETON NO CAMINHO DA PROPOSTA. meta_execution_config era lido com .eq("id",1) - a
//       linha da Legal e Viver. Conversa da COHAPM lia a lista de contas da Legal. Falhava
//       fechado por acidente (a conta da empresa nao casava com a lista da outra), mas com
//       mensagem enganosa. Mesma classe do bug corrigido na meta-actions v3.
//   (5) GT-07 - CONTRATO DE ATIVACAO REVERTIDO. Entre 31/07 e 03/08 vigorou "aprovar = ativar";
//       o gestor pediu o freio de volta e o objeto volta a nascer PAUSADO (meta-actions v4.3).
//       Os textos deste arquivo que dizem "nasce PAUSADO" voltaram a estar CORRETOS e nao foram
//       tocados. O que muda aqui e o campo status_inicial gravado no card, que a v28.3/v28.4
//       tinham passado para ACTIVE.
//   (6) GT-04 (robustez) - destino de conjunto passa a aceitar tambem o identificador da
//       campanha, e a procurar em cards ja executados quando o espelho ainda nao tem a linha.
// v28.5 (31/07/2026) - REGRA CONTRA ATO NARRADO: na noite de 31/07 o agente escreveu
//   "vou emitir agora... cards recriados e pendentes" com uma tabela de "estado real" -
//   e NAO chamou ferramenta nenhuma (tools_used vazio). Primeiro erro genuinamente do
//   modelo da serie: fabricou a narrativa de um ato. A regra abaixo torna a proibicao
//   explicita: afirmar emissao/criacao/execucao exige retorno de sucesso da ferramenta
//   NESTA resposta.
// v28.4 (31/07/2026) - RECONCILIACAO DO CONTRATO DE ATIVACAO. O agente recusou "ativar
//   direto" citando doutrina correta ("eu nao ativo") mas AFIRMOU um contrato que ficou
//   velho ("tudo nasce pausado, o gestor ativa no Gerenciador"). Contrato vigente desde a
//   meta-actions v4 (decisao do Ryan 31/07): A APROVACAO HUMANA DO CARD E O ATO DE
//   ATIVACAO - o objeto nasce ACTIVE quando o admin aprova. O agente continua sem poder
//   ativar/pausar nada por conta propria; o que muda e o que ele DIZ sobre a aprovacao.
// v28.3 (31/07/2026) - o CARD diz a verdade do que vai acontecer:
//   (1) special_ad_categories no payload do card: FINANCIAL_PRODUCTS_SERVICES (a Meta
//       aposentou CREDIT - erro 2909060 na primeira execucao real);
//   (2) status_inicial no card: ACTIVE (meta-actions v4: aprovacao humana = ativacao) -
//       o resumo que o admin aprova nao pode dizer PAUSED se o objeto nasce ativo.
// v28.2 (31/07/2026) - VEREDITOS DA ANALISE VISUAL expostos ao chat.
//   Segunda ocorrencia da mesma classe de bug de simetria: o pipeline de visao do job
//   classificou os 67 arquivos do Drive e persistiu em drive_midia_analises - mas nenhuma
//   ferramenta expunha a tabela. O chat respondeu "mega analise" por nome/pasta/data com os
//   vereditos visuais ja prontos no banco. Nova tool get_analise_visual_drive (leitura
//   barata da RPC get_drive_analises). LICAO: capacidade nova exige exposicao SIMETRICA do
//   RESULTADO, nao so do pipeline que o produz.
// v28.1 (31/07/2026) - DRIVE NO CHAT + rotulo de telemetria.
//   (1) get_drive_criativos agora existe TAMBEM aqui: a ferramenta nasceu so no job de
//       analise profunda, e as perguntas curtas do gestor roteiam para ESTE chat - que
//       entao declarava, honestamente para a propria edge, "nao acesso Drive". Assimetria
//       de capacidade entre os dois caminhos do mesmo agente = bug de produto, nao do
//       modelo. Mesmos limites do job: somente leitura, arvore com tetos, thumbnail.
//   (2) Corrigido rotulo velho na telemetria interna: chat_messages.diagnostico gravava
//       versao "v27.1" mesmo no v28 (campo esquecido na edicao anterior - a sonda validava
//       pelo campo da RESPOSTA, que foi o unico atualizado).
// v28 (30/07/2026) - PERSONA NO PROMPT + ISOLAMENTO DE EMPRESA NA TOOL DE CRIATIVOS.
//   (1) PERSONA v4 integrada ao systemPrompt (identidade, hierarquia de prioridades,
//       doutrina de decisao e limites duros) - camada validada em 3 rodadas de auditoria;
//       estilo continua vindo do banco (agent_style), sem duplicacao.
//   (2) get_criativos_conteudo agora passa p_company_id (ctx.companyId): mata na origem o
//       vazamento entre empresas achado na auditoria de 30/07 (peca da COHAPM entrou na
//       auditoria de compliance do portfolio de credito da Legal).
//   (3) Limpeza de instrucoes VENCIDAS pos-remocao do CRM (28/07): escopo, "dinheiro acima
//       de volume" e glossario nao apontam mais para get_funil_credito como fonte de
//       contrato pago (a tool virou stub de fora-de-escopo).
//   (4) Marcador versao: "chat-v28.5" na resposta (sonda pos-deploy).
//   Preparacao (comentada) p/ separar modelo do chat do modelo dos subagentes - ativa
//   quando a decisao do Opus for tomada (ver bloco MODEL).

// v27.1 - CORTE DE HISTORICO COM DIRECAO CERTA E DECLARADO (bug achado na auditoria de 28/07).
//   O historico cortava TODA mensagem com slice(0,6000) - a CABECA. Para a costura de
//   continuacao esse e o sentido errado duas vezes, provado em banco:
//   (1) a pergunta original longa (8.680 chars, questionario de 12 blocos) chegava as
//       continuacoes truncada EXATAMENTE no char 6.000 - meio do bloco 9. Os blocos 9-12
//       ficaram INVISIVEIS ao modelo nos turnos 2 e 3, por isso nunca foram respondidos.
//       A alegacao do agente "a pergunta foi cortada" era VERDADEIRA, nao alucinacao.
//   (2) a ultima resposta do assistente (7.058 chars) tambem entrava decapitada no
//       historico do turno seguinte - a continuacao NAO VIA a propria cauda (a tabela
//       terminando em "Retargeting"), nao retomava no ponto exato, reescrevia a secao 7
//       e perdia linha de tabela. Tres anomalias, uma causa.
//   Regras novas, todas DECLARADAS ao modelo (mesma licao do cortarLista e a licao 10 do
//   dossie: corte silencioso e proibido):
//   - mensagem de USUARIO mais recente: cap 12000 (a pergunta original precisa sobreviver
//     inteira a costura; 8.680 chars entram sem corte). Custo: ~1,7k tokens no pior caso,
//     desprezivel perto dos ~76k que cada continuacao ja gasta re-coletando tools.
//   - demais mensagens de usuario: preserva CABECA + CAUDA com aviso do que foi omitido.
//   - mensagem de ASSISTENTE mais recente: preserva a CAUDA (slice(-6000)) com aviso -
//     e o final dela que a continuacao precisa para retomar no ponto exato.
//   - demais mensagens de assistente: cabeca, com aviso quando cortar.
//   Telemetria nova: hist_msgs_cortadas no diagnostico.
//   O fix ESTRUTURAL continua sendo o job assincrono (EdgeRuntime.waitUntil), que elimina
//   a costura inteira - este ajuste apenas a torna correta enquanto ela existir.
// v27 - LIGA O ORCAMENTO DE TEMPO NO LOOP (correcao de um defeito meu, nao ajuste novo).
//   tokensDisponiveis() foi escrito no v19 para dimensionar a geracao pelo tempo restante,
//   mas ficou ligado APENAS na sintese final. O loop principal chamava chamar(true) sem
//   argumento, usando MAX_TOKENS fixo - que o v23 subiu para 12000. Resultado: com 100s ja
//   decorridos o modelo ainda tentava gerar 12000 tokens (~140s), estourando o teto de 150s
//   da plataforma de forma garantida. Foi o 504 de 28/07 as 17:54 (pergunta de 8.680 chars,
//   nem a resposta chegou a ser gravada).
//   Uma palavra de mudanca. Agora a geracao encolhe conforme o tempo aperta: 12000 tokens no
//   inicio, ~2500 com 100s gastos, minimo de 600. Resposta menor, mas ENTREGUE - e o front
//   emenda a continuacao.
//   ISTO E O ULTIMO AJUSTE POSSIVEL POR ESTE CAMINHO. v13/v16/v17/v19/v21/v23 mexeram em
//   orcamento; se estourar de novo, a saida e job assincrono com EdgeRuntime.waitUntil, que
//   remove o teto em vez de negociar com ele.
// v26 - DOIS CONSERTOS ENCONTRADOS EM TESTE REAL (28/07):
// v26 - DOIS CONSERTOS ENCONTRADOS EM TESTE REAL (28/07):
//   (1) OBJETIVO ODAX INVALIDO. No primeiro teste de criacao o modelo passou objetivo="LEADS"
//       e o codigo aceitou (so fazia toUpperCase). A Graph API exige OUTCOME_LEADS - a criacao
//       teria falhado no momento em que as flags fossem ligadas. Agora ha mapa de sinonimos e
//       recusa explicita para objetivo fora da lista ODAX.
//   (2) MEMORIA POR EMPRESA. agent_context ganhou company_id (migracao isola_agent_context_
//       por_empresa) mas o codigo ainda carregava TODOS os fatos. Com 2 empresas no banco
//       (Legal e Viver e COHAPM), fatos da Legal - campanhas pausadas, WABAs, instrumentacao
//       de UTM - apareciam em conversa da COHAPM como se fossem dela. Agora carrega os
//       universais (company_id null) MAIS os da empresa da conversa.
// v25 - ACOES DE CRIACAO (campanha / conjunto / anuncio), lado da PROPOSTA.
// v25 - ACOES DE CRIACAO (campanha / conjunto / anuncio), lado da PROPOSTA.
//   Sete travas decididas com o Ryan, todas no CODIGO e nao no prompt:
//     (1) v28.4: objeto nasce ACTIVE quando o admin APROVA o card - a aprovacao e o ato de ativacao
//     (2) special_ad_categories=['CREDIT'] e FORCADO, nao e parametro
//     (3) compliance e BLOQUEANTE: criar_anuncio roda a legenda do molde no compliance-check
//         e RECUSA criar se houver violacao (hoje o compliance era so consultivo)
//     (4) UTM gerada pelo CODIGO, nunca pelo modelo (cobertura de UTM e KPI)
//     (5) orcamento nao tem teto fixo - e OBRIGATORIO pedir ao gestor a cada pedido; existe
//         apenas um teto de sanidade contra erro de digitacao (centavos x reais)
//     (6) so admin aprova (fluxo existente de decide_approval)
//     (7) card expira em 24h (migracao add_expiracao_24h_approval_requests)
//   DESENHO: conjunto e anuncio nao sao criados "do zero" - sao REPLICADOS de um molde que
//   ja funciona. POST /act_X/adsets exige optimization_goal, billing_event, promoted_object,
//   destination_type, targeting e attribution_spec; nada disso pode ser inventado de memoria
//   sem criar objeto quebrado ou pior que o atual. O executor le o molde na Graph API e troca
//   apenas nome, orcamento, destino e status.
// v24 - BASE DE CONHECIMENTO CONSULTAVEL + CORRECAO DO BREAKDOWN EFFECT + REVERSA:
// v24 - BASE DE CONHECIMENTO CONSULTAVEL + CORRECAO DO BREAKDOWN EFFECT + RECOMENDACAO COM REVERSA:
//   (1) get_conhecimento(tema, secao) le a tabela agent_knowledge (12 temas, ~128 mil chars
//       destilados do pacote de skills de 28/07). Progressive disclosure em DOIS niveis: o
//       INDICE de temas entra no prompt (barato, sempre); o CONTEUDO so e carregado quando
//       pedido; e se o tema for grande demais para um payload, devolve o indice de SECOES e
//       carrega uma secao por vez. Sem isso os 128 mil chars ficariam inertes no banco.
//       PROTOCOLO DE EVOLUCAO: cada tema tem revalidar_ate. Vencido volta com aviso explicito
//       de "nao confirmado" - conhecimento com prazo, nao afirmado como atual para sempre.
//   (2) BREAKDOWN EFFECT na descricao de get_ads_ranking. Achado da leitura das skills: esta
//       ferramenta ranqueia criativos por CUSTO MEDIO, e a acao pausar_criativo executaria
//       "pausar o mais caro na media" - exatamente o erro no 1 de analise de midia, porque a
//       Meta aloca por custo MARGINAL. Havia uma ferramenta produzindo o input do erro e uma
//       acao capaz de executa-lo. A descricao agora declara que e recorte para ENTENDER e
//       proibe usar como base unica de pausa.
//   (3) propose_action passa a exigir REVERSA e METRICA DE SUCESSO. Regra do pacote:
//       "recomendacao sem reversa definida nao sobe para aprovacao". Card sem plano de
//       desfazer e risco operacional, nao proposta.
// v23 - CAPACIDADE ANALITICA + FORMATACAO EXTERNALIZADA + CONHECIMENTO DE PLATAFORMA:
// v23 - CAPACIDADE ANALITICA + FORMATACAO EXTERNALIZADA + CONHECIMENTO DE PLATAFORMA:
//   (1) RACIOCINIO 2000 -> 6000 e MAX_TOKENS 7000 -> 12000. O teto de 2000 foi escolhido no
//       v21 por TEMPO, sem medir o custo em qualidade - e as respostas seguintes sairam
//       superficiais. Antes do v21 o modelo usava ~9000 tokens de raciocinio; cortar 78% de
//       uma vez foi excessivo. Cabe: o ultimo turno com 8 ferramentas levou 102s de 143s.
//   (2) TETO DE FERRAMENTAS 8 -> 12 (todas), com LIMITE POR FERRAMENTA. O que estourava o
//       tempo nao era variedade: era repeticao - 5 chamadas de check_compliance a 3-6s cada
//       num turno de 14 execucoes. Agora o teto global cobre as 12 disponiveis e a repeticao
//       da mesma ferramenta e limitada individualmente. Deixa de cortar consulta legitima.
//   (3) FORMATACAO SAI DO PROMPT e vem da tabela agent_style (12 regras, editaveis por SQL
//       sem redeploy). Pedido do Ryan de manter a formatacao em fonte externa: arquivo nao
//       funciona (o agente nao tem sistema de arquivos nem RAG), tabela funciona e nao gasta
//       chamada de ferramenta por resposta. Inclui emoji como SINAL de estado.
//   (4) BLOCO DE CONHECIMENTO DE PLATAFORMA + separacao entre NUMERO e CONHECIMENTO. R1/R2
//       exigiam ferramenta para tudo, entao o agente respondia "nao disponivel" a perguntas
//       CONCEITUAIS (o que a Categoria Especial restringe, o que e fadiga de criativo) que
//       qualquer gestor senior responde de cabeca. Numero da conta continua exigindo
//       ferramenta; conhecimento de plataforma pode ser respondido, marcado como tal.
// v22 - PRIORIZACAO DE FERRAMENTAS + FIM DO JARGAO INTERNO:
// v22 - PRIORIZACAO DE FERRAMENTAS + FIM DO JARGAO INTERNO:
//   (1) O teto de 8 ferramentas do v20 cortava por ordem de chegada (FIFO). Medido em 2
//       rodadas consecutivas do questionario de auditoria: o bloco 7 (criativos, legendas,
//       compliance) ficou SEM NENHUM NUMERO nas duas, porque as 8 vagas se esgotavam antes.
//       Ironia: essas tools foram justamente o que o v18/v19 destravaram. Agora o lote de
//       tool_calls e ORDENADO por relevancia ao pedido antes de executar - se o usuario
//       menciona criativo/legenda/compliance, essas entram primeiro.
//   (2) JARGAO INTERNO. O agente escreveu ao gestor "get_criativos_conteudo bateu no limite
//       de 8 tools". Nome de funcao e limite de implementacao nao existem para quem le.
//       Mesma familia do "conforme R4" ja corrigido. Corrigido em dois lugares: a mensagem
//       de teto nao cita mais numero nem nome, e o prompt proibe explicitamente.
// v21 - A CAUSA REAL DO FALLBACK: RACIOCINIO CONSUMINDO O ORCAMENTO DE SAIDA.
// v21 - A CAUSA REAL DO FALLBACK: RACIOCINIO CONSUMINDO O ORCAMENTO DE SAIDA.
//   Diagnostico medido em 27/07 (turnos v20 19:40, 19:42, 19:44): tokens_out entre 9.868 e
//   10.262 e o texto entregue foi de 69 CARACTERES - a mensagem de fallback. E no turno que
//   funcionou (18:29), dos 10.809 tokens_out so ~1.750 eram texto; ~9.000 foram raciocinio.
//   O Sonnet 5 raciocina antes de escrever e max_tokens cobre RACIOCINIO + TEXTO. Com
//   MAX_TOKENS=6000 o modelo gastava tudo pensando, batia finish_reason=length e devolvia
//   content VAZIO. Os ms_total (127-137s) estavam DENTRO do teto: nunca foi timeout.
//   Isso reinterpreta v17/v19/v20 - todas trataram tempo, que era sintoma. Pior: reduzir
//   MAX_TOKENS de 10000 para 6000 no v17 cortou justamente a margem que sobrava p/ o texto.
//   (1) reasoning limitado no loop (budget explicito) e DESLIGADO na sintese final: quando
//       os dados ja foram coletados, a sintese precisa ESCREVER, nao pensar. Era exatamente
//       ali que os 3 turnos morriam.
//   (2) MAX_TOKENS 6000 -> 7000. Cabe porque o raciocinio capado reduz tokens gerados, e
//       gerar menos tokens tambem reduz TEMPO.
//   (3) FALLBACK NAO E MAIS MARCADO COMO 'length'. O front (6908ec9) via 'length', concluia
//       truncamento e disparava a costura sobre a MENSAGEM DE ERRO - 3 vezes, 57-91k tokens
//       cada. Uma pergunta gastou +200k tokens para produzir 3 avisos de erro.
//   (4) TELEMETRIA: reasoning_tokens gravado no diagnostico, para confirmar ou refutar a
//       hipotese acima com dado em vez de inferencia.
//   (5) Degradacao em 2 passos se o provider recusar parametros: remove reasoning primeiro
//       (novo, nao provado), cache depois (ja provado funcionando em 4 turnos v20).
// v20 - REDUCAO DE CUSTO DE TOKENS + TETO DE FERRAMENTAS:
//   (1) PROMPT CACHING (anthropic via openrouter, cache_control ephemeral) no system prompt
//       e na pergunta do usuario. Medicao que motivou: o turno de 18:35 gastou 66.395
//       tokens de input em 3 rodadas, e quase todo o conteudo era IDENTICO entre elas
//       (system 1.700 + memoria 1.900 + tools 1.300 + pergunta 2.500 tokens). Cache read
//       custa 0,1x. NAO marcamos os tool results: mensagens role:"tool" nao aceitam blocos
//       com cache_control de forma confiavel, e nao vale arriscar o protocolo. Economia
//       esperada ~25-30% do input das rodadas 2+, nao os 65% de uma versao ideal.
//   (2) TELEMETRIA DE CUSTO: cache_creation/cache_read gravados em chat_messages.diagnostico.
//       Este projeto nao tinha nenhuma medicao de custo de LLM - agora tem.
//   (3) TETO DE 8 FERRAMENTAS POR TURNO. Medido: 2 turnos consecutivos usaram 14 tools
//       cada, incluindo 5 chamadas ao compliance-check (3-6s cada). O modelo nao tem
//       nocao de orcamento. Ao estourar, cada tool_call recebe resposta declarando o teto -
//       obrigatorio, porque a API exige uma resposta para CADA tool_call_id.
//   (5) FALLBACK DE CACHE: se o provider rejeitar cache_control com 4xx, remove o campo,
//       retenta e desativa o cache pelo resto do turno. Sem isso, um campo opcional nao
//       aceito derrubaria TODO turno com 502, nao apenas os grandes.
//   (4) Corte da lista bruta de criativos 11.500 -> 4.000 chars. Depois do dedupe do v19,
//       legendas_unicas cobre o que compliance precisa; a lista peca-por-peca perdeu uso.
// v19 - ORCAMENTO DE TEMPO (fim dos 504) + DIAGNOSTICO PERSISTIDO + DEDUPE DE LEGENDA:
//   (1) DEADLINE. Evidencia medida em 27/07: 5 respostas 504 em v21/v22/v23, todas com
//       execution_time_ms entre 150.094 e 151.004 - e um 200 em 149.508ms, ou seja passou
//       por 492ms. O sistema operava colado no teto de 150s e o resultado era sorteio.
//       v13/v16/v17 tentaram resolver reduzindo tokens; nenhuma resolveu porque o custo
//       real vem do NUMERO de rodadas de tool, nao do tamanho da geracao. Agora ha
//       orcamento explicito: para de chamar tools em TOOLS_DEADLINE_MS e vai para a
//       sintese, com max_tokens calculado pelo tempo que sobrou. Mesmo padrao que salvou
//       o windsor-sync v15: garantir a entrega do que ja foi coletado.
//   (2) DIAGNOSTICO PERSISTIDO em chat_messages.diagnostico (migracao
//       add_chat_messages_diagnostico). Antes, preambulos_detectados/recuperados existiam
//       so na resposta HTTP - instrumentacao que nao era observavel depois do instante.
//   (3) DEDUPE DE LEGENDA em get_criativos_conteudo: campo novo legendas_unicas, calculado
//       sobre a lista COMPLETA antes do corte. Resolve o audit retroativo de compliance,
//       que antes ficava incompleto porque 13 de 32 criativos eram omitidos pelo corte.
// v18 - EXPOSICAO DAS RPCs DE CONTEUDO/ESTRUTURA + CORRECAO DO TEXTO DESCARTADO (27/07):
//   (1) Duas tools novas: get_criativos_conteudo (legenda/titulo/CTA/imagem dos anuncios)
//       e get_estrutura_conjuntos (CBO vs ABO, orcamento, lance, targeting). Os dados
//       JA estavam no banco desde sempre - o que faltava era exposicao ao agente.
//   (2) CORTE ESTRUTURADO POR BYTES (nao previsto no briefing original): as duas RPCs
//       devolvem 19.900 / 27.504 / 61.844 bytes, ACIMA do slice(0,14000) aplicado a todo
//       resultado de tool. Sem tratamento o modelo receberia JSON cortado no meio -
//       falha silenciosa e violacao pratica de R1/R3. As funcoes agora cortam a LISTA
//       preservando JSON valido e declarando exibidos/omitidos/aviso.
//   (3) BUG DO TEXTO DESCARTADO corrigido: quando o modelo emitia texto JUNTO com
//       tool_calls na mesma mensagem, o loop empilhava a msg e o texto nunca chegava a
//       'reply'. Agora e acumulado em preambulos[] e emendado. Heuristica: so emenda
//       texto substantivo (>=120 chars) para nao poluir com "vou consultar os dados";
//       se 'reply' terminar vazio, emenda tudo como resgate. Contador exposto no retorno.
//   (4) Regra de FORMATO: compliance pode ser auditado SEM pedir texto ao usuario.
// v17 - AJUSTE CRITICO DE TEMPO (incidente 504 em 27/07):
//   (1) MAX_TOKENS 10000 -> 6000. Motivo medido: a plataforma mata a requisicao em 150s
//       (IDLE_TIMEOUT) e uma geracao de 10k tokens leva ~120s; somando as tool calls,
//       estourava e o usuario recebia 504 (perdia a resposta inteira).
//       Com 6000 tokens (~70s) + tools (~20s) sobra margem folgada.
//   (2) REMOVIDO o loop de continuacao no SERVIDOR. Quem costura agora e o FRONT
//       (commit 6908ec9): ele detecta finish_reason=length e faz nova requisicao no mesmo
//       conversation_id, ate 3 vezes. Duas costuras (servidor + front) seriam redundantes
//       e a do servidor garantiria o timeout, pois ambas as geracoes cairiam na mesma
//       requisicao. Teto efetivo agora: 4 chamadas x 6000 = ~24000 tokens de resposta.
//   (3) finish_reason continua no retorno - e o sinal que o front usa.
// v15: memoria institucional (agent_context) + protocolo de raciocinio + anti-alucinacao.
// v14: get_funil_credito. v12: MAX_ITER 10 + sintese final garantida.
// Auth: Bearer <user JWT> OU x-mcp-key.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { bearerDe, mcpKeyValida } from "../_shared/mcp_auth.ts";
import { situacaoDoCard } from "../_shared/aprovacoes.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const OPENROUTER_KEY = (Deno.env.get("OPENROUTER_API_KEY") ?? "").trim();
const MODEL = (Deno.env.get("OPENROUTER_MODEL") ?? "anthropic/claude-sonnet-5").trim();
// v28: quando a troca p/ Opus for decidida, o caminho e: setar OPENROUTER_MODEL para o Opus
// (este chat) e criar OPENROUTER_MODEL_SUB p/ os subagentes do traffic-agent-job continuarem
// no modelo atual (extracao estrita nao precisa de Opus e custa 5x). Nada a mudar AQUI alem
// do secret; a separacao e feita na edge do job.
// v28.1: credencial do Drive (mesma service account do job) + pasta raiz dos criativos.
const GOOGLE_SA_KEY_B64 = (Deno.env.get("GOOGLE_SA_KEY_B64") ?? "").trim();
const DRIVE_CRIATIVOS_FOLDER_ID = (Deno.env.get("DRIVE_CRIATIVOS_FOLDER_ID") ?? "").trim();
const MAX_ITER = 10;
// v20: teto de ferramentas por turno. 14 tools medidas em 2 turnos consecutivos, com 5
// chamadas ao compliance-check a 3-6s cada. Corta tempo e tokens ao mesmo tempo.
const MAX_TOOLS_TURNO = 12;
// v23: o gargalo de tempo era REPETICAO, nao variedade. check_compliance custa 3-6s por
// chamada e foi chamada 5x num unico turno. Limite por ferramenta resolve na origem.
// v28.7: get_estrutura_conjuntos com teto 3. Sao 46 conjuntos relevantes em paginas de 20 - com o
// default 2 o agente ficaria ESTRUTURALMENTE impedido de ver o universo completo, recriando o
// problema do universo parcial numa forma nova, agora causada pelo proprio limite.
const MAX_POR_FERRAMENTA: Record<string, number> = { check_compliance: 3, get_estrutura_conjuntos: 3 };
const MAX_POR_FERRAMENTA_DEFAULT = 2;
const MAX_TOKENS = 12000;
// v21: orcamento de raciocinio. max_tokens cobre raciocinio + texto; sem teto, o modelo
// gastava os 6000 pensando e devolvia content vazio. 2000 preserva o protocolo de 5 passos
// e as 10 regras anti-alucinacao (o agente PRECISA raciocinar) e deixa ~5000 para o texto.
const REASONING_LOOP = { max_tokens: 6000 };
// Na sintese final os dados ja estao coletados: e hora de escrever, nao de pensar.
// ATENCAO: 'exclude: true' apenas OMITE o raciocinio da resposta - o modelo continua
// gastando os tokens, o que anularia o conserto. 'enabled: false' e o que desliga.
// Anthropic exige budget >= 1024 quando o raciocinio esta ligado, por isso o loop usa 2000.
const REASONING_SINTESE = { enabled: false };
const VERSAO = "chat-v28.11";
const HIST = 24;
// v28.11: orcamento da reinjecao de retorno de ferramenta.
// TETO_PERSIST e o MESMO corte aplicado ao que vai para o modelo: persistir mais seria gravar
// o que ele nunca viu, persistir menos seria perder o que ele viu.
const TOOLRES_TETO_PERSIST = 14000;
// So os 2 ultimos turnos de assistente reinjetam retorno. A perda medida em 07/08 foi de UM
// turno para o seguinte; carregar a conversa inteira recriaria pelo custo o problema que a
// reinjecao resolve pelo contexto.
const TOOLRES_TURNOS = 2;
const TOOLRES_CAP_TOOL = 1800;
const TOOLRES_CAP_TOTAL = 12000;
// Listas longas cabem em amostra + contagem declarada; o que nao pode e sumir sem aviso.
const TOOLRES_ITENS_LISTA = 6;
const TOOLRES_TEXTO = 400;
// v27.1: caps do corte de historico. HIST_CAP e o teto por mensagem; a mensagem de USUARIO
// mais recente tem teto maior porque e a pergunta original que as continuacoes precisam
// enxergar INTEIRA (o corte em 6000 escondeu os blocos 9-12 do questionario de 28/07).
const HIST_CAP = 6000;
const HIST_CAP_USER_RECENTE = 12000;
// v19 - orcamento de tempo. Teto da plataforma = 150s (IDLE_TIMEOUT, nao configuravel).
// Calibrado com os logs de 27/07: sucessos entre 38s e 102s; o de 149,5s passou por 492ms.
// TOOLS_DEADLINE: para de coletar aqui, deixando espaco para a sintese final.
// HARD_LIMIT: teto proprio abaixo de 150s, com folga para gravar no banco.
const TOOLS_DEADLINE_MS = 75_000;
const HARD_LIMIT_MS = 143_000;
const RESERVA_GRAVACAO_MS = 6_000;
// Sonnet gera ~85 tok/s; usamos 60 para ser conservador.
const TOKENS_POR_SEGUNDO = 60;

const supa = createClient(SUPABASE_URL, SERVICE_ROLE, { auth: { persistSession: false } });

const CORS = {
  "access-control-allow-origin": "*",
  "access-control-allow-headers": "authorization, x-client-info, apikey, content-type, x-mcp-key",
  "access-control-allow-methods": "POST, OPTIONS",
};
function json(obj: unknown, status = 200) {
  return new Response(JSON.stringify(obj), { status, headers: { "content-type": "application/json", ...CORS } });
}
const today = () => new Date().toISOString().slice(0, 10);
const brl = (n: number) => "R$ " + (Math.round(n * 100) / 100).toFixed(2);
const deacc = (s: string) => s.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
const norm = (s: string) => deacc(s.toLowerCase()).replace(/[-_\s]+/g, "");
// v25: slug para UTM. Gerado no CODIGO - a cobertura de UTM e KPI e nao pode depender de o
// modelo lembrar de montar a string certa.
const slug = (s: string) => deacc(String(s).toLowerCase()).replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60);

async function resolveCompany(name?: string): Promise<{ id: string; name: string } | null> {
  const { data } = await supa.from("companies").select("id,name");
  if (!data?.length) return null;
  if (name) {
    const hit = data.find((c) => norm(c.name).includes(norm(name)));
    if (hit) return hit;
  }
  return data.find((c) => c.name.toLowerCase().includes("legal")) ?? data[0];
}

const IMG_MIMES = ["image/png", "image/jpeg", "image/jpg", "image/webp", "image/gif"];
const SHEET_MIMES = ["application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", "application/vnd.ms-excel", "text/csv"];
function b64ToU8(b64: string): Uint8Array {
  const bin = atob(b64);
  const u8 = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
  return u8;
}
async function sheetToText(name: string, mime: string, b64: string): Promise<{ text: string; nota: string }> {
  if (mime === "text/csv" || /\.csv$/i.test(name)) {
    const txt = new TextDecoder().decode(b64ToU8(b64));
    const linhas = txt.split("\n").filter((l) => l.trim() !== "");
    return { text: `[PLANILHA CSV "${name}"${linhas.length > 400 ? ` - TRUNCADA em 400 de ${linhas.length}` : ""}]\n` + linhas.slice(0, 400).join("\n"), nota: `${linhas.length} linha(s)` };
  }
  const XLSX = await import("https://esm.sh/xlsx@0.18.5");
  const wb = XLSX.read(b64ToU8(b64), { type: "array" });
  const partes: string[] = [];
  let total = 0;
  for (const sn of wb.SheetNames) {
    const csv: string = XLSX.utils.sheet_to_csv(wb.Sheets[sn]);
    const linhas = csv.split("\n").filter((l) => l.trim() !== "");
    total += linhas.length;
    const usadas = partes.reduce((a, p) => a + p.split("\n").length, 0);
    const corte = linhas.slice(0, Math.max(0, 400 - usadas));
    if (corte.length) partes.push(`--- aba: ${sn} (${linhas.length} linhas) ---\n` + corte.join("\n"));
  }
  return { text: `[PLANILHA "${name}" -> CSV${total > 400 ? " (TRUNCADA em 400)" : ""}]\n` + partes.join("\n\n"), nota: `${wb.SheetNames.length} aba(s), ${total} linha(s)` };
}

async function t_overview(companyId: string) {
  const { data: camps } = await supa.from("campaigns").select("name,status,category,spend,external_account_id").eq("company_id", companyId);
  const ativos = (camps ?? []).filter((c) => c.status === "active");
  const from = new Date(Date.now() - 7 * 864e5).toISOString().slice(0, 10);
  const { data: snaps } = await supa.from("metric_snapshots")
    .select("spend,impressions,link_clicks,form_leads,messaging_started,leads,snapshot_date")
    .eq("company_id", companyId).gte("snapshot_date", from);
  const s = (snaps ?? []).reduce((a, r) => ({
    spend: a.spend + Number(r.spend || 0), imp: a.imp + Number(r.impressions || 0),
    link: a.link + Number(r.link_clicks || 0), forms: a.forms + Number(r.form_leads || 0),
    msg: a.msg + Number(r.messaging_started || 0), leads: a.leads + Number(r.leads || 0),
  }), { spend: 0, imp: 0, link: 0, forms: 0, msg: 0, leads: 0 });
  const dias = new Set((snaps ?? []).map((r) => r.snapshot_date)).size;
  return {
    campanhas_ativas: ativos.length, campanhas_total: (camps ?? []).length,
    ultimos_7_dias: { gasto: brl(s.spend), dias_com_dado: dias, impressoes: s.imp, cliques_link: s.link,
      formularios: s.forms, conversas_whatsapp: s.msg,
      custo_por_formulario: s.forms ? brl(s.spend / s.forms) : null,
      custo_por_lead_lp: s.link ? brl(s.spend / s.link) : null },
    campanhas_ativas_lista: ativos.map((c) => ({ nome: c.name, categoria: c.category, conta: c.external_account_id, gasto_acumulado: brl(Number(c.spend || 0)) })),
    nota: "status vem do effective_status real da Meta (cron 09:10). dias_com_dado<7 indica cobertura incompleta: nao conclua queda sem checar isso.",
  };
}
async function t_alerts(companyId: string) {
  const { data } = await supa.from("alerts").select("severity,title,description,created_at,resolved")
    .eq("company_id", companyId).eq("resolved", false).order("created_at", { ascending: false }).limit(20);
  return { alertas_ativos: data ?? [] };
}
async function t_recos(companyId: string) {
  const { data } = await supa.from("ai_recommendations").select("category,impact,title,description,status,created_at")
    .eq("company_id", companyId).eq("status", "new").order("created_at", { ascending: false }).limit(20);
  return { recomendacoes_pendentes: data ?? [], nota: "regua destas recomendacoes e custo de MIDIA, nao contrato pago. Antes de aprovar escala, cruze com get_funil_credito." };
}
async function t_rpc(nome: string, parametros: Record<string, unknown>) {
  const { data, error } = await supa.rpc(nome, parametros);
  return error ? { erro: `falha ao chamar ${nome}: ${error.message}` } : data;
}
async function t_funnel(companyId: string, date_from?: string, date_to?: string) {
  let q = supa.from("metric_snapshots").select("snapshot_date,spend,impressions,clicks,link_clicks,form_leads,messaging_started").eq("company_id", companyId);
  if (date_from) q = q.gte("snapshot_date", date_from);
  if (date_to) q = q.lte("snapshot_date", date_to);
  const { data } = await q;
  const s = (data ?? []).reduce((a, r) => ({
    spend: a.spend + Number(r.spend || 0), imp: a.imp + Number(r.impressions || 0), clk: a.clk + Number(r.clicks || 0),
    link: a.link + Number(r.link_clicks || 0), forms: a.forms + Number(r.form_leads || 0), msg: a.msg + Number(r.messaging_started || 0),
  }), { spend: 0, imp: 0, clk: 0, link: 0, forms: 0, msg: 0 });
  const datas = (data ?? []).map((r) => r.snapshot_date).sort();
  return { periodo_solicitado: { de: date_from ?? "inicio", ate: date_to ?? "hoje" },
    cobertura_real: { primeiro_dia: datas[0] ?? null, ultimo_dia: datas[datas.length - 1] ?? null, dias_com_dado: new Set(datas).size },
    funil_midia: { impressoes: s.imp, cliques: s.clk, cliques_no_link_lead: s.link, formularios: s.forms, conversas_whatsapp: s.msg },
    gasto: brl(s.spend),
    custos: { por_lead_lp: s.link ? brl(s.spend / s.link) : null, por_formulario: s.forms ? brl(s.spend / s.forms) : null, por_conversa: s.msg ? brl(s.spend / s.msg) : null },
    nota: "funil de MIDIA. Proposta/contrato/receita estao FORA do escopo do sistema desde 28/07/2026 - nao existe fonte de conversao final; trate CPL como proxy e declare isso." };
}
async function t_ads_ranking(companyId: string, days = 7) {
  const from = new Date(Date.now() - days * 864e5).toISOString().slice(0, 10);
  const { data: ads } = await supa.from("ads").select("external_id,name,campaign_id").eq("company_id", companyId);
  const { data: camps } = await supa.from("campaigns").select("id,name,category").eq("company_id", companyId).eq("status", "active");
  const campMap = new Map((camps ?? []).map((c) => [c.id, c]));
  const active = (ads ?? []).filter((a) => campMap.has(a.campaign_id));
  if (!active.length) return { ranking: [], nota: "sem criativos em campanhas ativas" };
  const ids = active.map((a) => a.external_id);
  const { data: snaps } = await supa.from("ad_metric_snapshots").select("ad_external_id,spend,form_leads,messaging_started").gte("snapshot_date", from).in("ad_external_id", ids);
  const agg = new Map<string, { spend: number; res: number }>();
  for (const s of snaps ?? []) {
    const ad = active.find((a) => a.external_id === s.ad_external_id); if (!ad) continue;
    const cat = campMap.get(ad.campaign_id)?.category;
    const res = cat === "mensagem" ? Number(s.messaging_started || 0) : Number(s.form_leads || 0);
    const cur = agg.get(s.ad_external_id) ?? { spend: 0, res: 0 };
    cur.spend += Number(s.spend || 0); cur.res += res; agg.set(s.ad_external_id, cur);
  }
  const rows = [...agg.entries()].filter(([, v]) => v.spend > 0).map(([id, v]) => {
    const ad = active.find((a) => a.external_id === id)!;
    return { criativo: ad.name, campanha: campMap.get(ad.campaign_id)?.name, gasto: brl(v.spend), resultados: v.res,
      custo_por_resultado: v.res ? brl(v.spend / v.res) : "sem resultado", amostra_pequena: v.res < 20, _c: v.res ? v.spend / v.res : 1e9 };
  }).sort((a, b) => a._c - b._c).map(({ _c, ...r }) => r);
  return { janela_dias: days, ranking: rows.slice(0, 15),
    nota: "ranking por custo de MIDIA (formulario/conversa). NAO e ranking por contrato pago - para receita use get_funil_credito.por_campanha (campo criativo_utm_content)." };
}
async function t_campaign_detail(companyId: string, name_like: string) {
  const { data: all } = await supa.from("campaigns").select("id,name,status,category,spend").eq("company_id", companyId);
  const needle = norm(name_like);
  const camps = (all ?? []).filter((c) => norm(c.name).includes(needle)).slice(0, 3);
  if (!camps.length) return { erro: `nenhuma campanha com nome contendo '${name_like}'` };
  const c = camps[0];
  const from = new Date(Date.now() - 14 * 864e5).toISOString().slice(0, 10);
  const { data: serie } = await supa.from("metric_snapshots").select("snapshot_date,spend,impressions,link_clicks,form_leads,messaging_started").eq("campaign_id", c.id).gte("snapshot_date", from).order("snapshot_date");
  return { campanha: { nome: c.name, status: c.status, categoria: c.category, gasto_acumulado: brl(Number(c.spend || 0)) },
    serie_diaria_14d: (serie ?? []).map((s) => ({ dia: s.snapshot_date, gasto: brl(Number(s.spend || 0)), impressoes: s.impressions, formularios: s.form_leads, conversas: s.messaging_started })),
    outras_encontradas: camps.slice(1).map((x) => x.name) };
}
async function t_funil_credito(dias: number) {
  const { data, error } = await supa.rpc("get_funil_credito", { p_dias: dias });
  if (error) return { erro: `falha ao ler conversao final: ${error.message}` };
  return data;
}

// v18: corte estruturado. Todo resultado de tool passa por slice(0,14000) antes de ir ao
// modelo. get_criativos_conteudo devolve 19.900 bytes (somente ativas) ou 61.844 (todas) e
// get_estrutura_conjuntos devolve 27.504 - todos acima do teto. Cortar bytes crus quebraria
// o JSON no meio e o modelo receberia dado mutilado sem saber (falha silenciosa). Aqui a
// LISTA e reduzida item a item preservando JSON valido, e o que ficou de fora e DECLARADO.
const TETO_TOOL_JSON = 11500;
function cortarLista(obj: Record<string, unknown>, campo: string, teto = TETO_TOOL_JSON) {
  const lista = Array.isArray(obj[campo]) ? (obj[campo] as unknown[]) : null;
  if (!lista) return obj;
  const baseLen = JSON.stringify({ ...obj, [campo]: [] }).length;
  const mantidos: unknown[] = [];
  let usados = 0;
  for (const item of lista) {
    const tam = JSON.stringify(item).length + 1;
    if (baseLen + usados + tam > teto) break;
    mantidos.push(item);
    usados += tam;
  }
  const omitidos = lista.length - mantidos.length;
  const out: Record<string, unknown> = { ...obj, [campo]: mantidos, exibidos: mantidos.length };
  if (omitidos > 0) {
    out.omitidos = omitidos;
    out.aviso_corte = `A lista '${campo}' foi truncada para caber no limite de payload: ${mantidos.length} de ${lista.length} itens enviados. Os ${omitidos} restantes EXISTEM no banco mas NAO foram enviados nesta chamada - nao os trate como inexistentes nem como zero. Se precisar deles, peca um recorte mais estreito.`;
  }
  return out;
}
// v28.11 (05/08/2026) - BUSCA POR NOME. A sobrecarga de 5 argumentos existe no banco e nao estava
// sendo usada: o agente folheava os 67 anuncios, batia no corte de payload e concluia que o
// anuncio nao existia - com a legenda dele inteira a uma chamada de distancia.
// DOIS FORMATOS, e isto NAO e detalhe: a sobrecarga de busca devolve a lista em 'anuncios', a
// antiga devolve em 'criativos'. Trocar a chamada sem trocar o nome do campo faria lista=[] e
// legendas_unicas vazio - o dedupe de compliance sumiria em silencio, que e pior que nao ter
// busca. Por isso cada ramo nomeia o campo que ele realmente recebe.
// O ramo SEM busca segue byte a byte como estava: caminho que funciona nao se mexe de carona.
const LIMITE_BUSCA_CRIATIVOS = 20;
async function t_criativos_conteudo(somenteAtivas: boolean, companyId: string, buscaNome = "", pagina = 1) {
  if (buscaNome) {
    const p = Math.max(1, Math.floor(Number(pagina) || 1));
    const { data, error } = await supa.rpc("get_criativos_conteudo", {
      p_somente_ativas: somenteAtivas, p_company_id: companyId,
      p_offset: (p - 1) * LIMITE_BUSCA_CRIATIVOS, p_limit: LIMITE_BUSCA_CRIATIVOS,
      p_busca_nome: buscaNome,
    });
    if (error) return { erro: `falha ao buscar criativo por nome: ${error.message}` };
    if (!data || typeof data !== "object") return { erro: "retorno inesperado de get_criativos_conteudo (busca)" };
    const obj = data as Record<string, unknown>;
    // A propria RPC devolve total_que_casam_com_a_busca, restantes e como_usar - inclusive a
    // instrucao de que ZERO significa que o anuncio nao existe. Nao reescrevo nada disso aqui.
    const cortado = cortarLista(obj, "anuncios", 9000) as Record<string, unknown>;
    // ZERO NAO E A MESMA COISA NOS DOIS UNIVERSOS. A instrucao da RPC ("zero = o anuncio nao
    // existe") esta certa no universo dela; aplicada a um recorte de campanhas ativas ela vira
    // negativa falsa. Se o gestor pediu ativas e nao casou nada, isto e dito com todas as letras.
    const nadaCasou = Number(obj.total_que_casam_com_a_busca ?? 0) === 0;
    const avisoUniverso = nadaCasou && somenteAtivas
      ? "ATENCAO: zero aqui significa 'nenhum anuncio ATIVO com esse nome', NAO 'o anuncio nao existe'. Esta busca foi restrita a campanhas ativas. Antes de dizer ao gestor que a peca nao existe, repita a busca com somente_ativas=false - anuncio pausado e a maior parte do acervo."
      : undefined;
    return { ...cortado, somente_campanhas_ativas: somenteAtivas, pagina: p,
      ...(avisoUniverso ? { aviso_universo_da_busca: avisoUniverso } : {}),
      nota_busca: "Este e o recorte por NOME, e ele nao traz legendas_unicas: o dedupe de legenda existe na listagem completa (sem busca_nome), para auditoria de compliance do acervo inteiro. Aqui cada item ja vem com a legenda propria, alem de creative_id e external_id." };
  }
  // v28: p_company_id obrigatorio - criativos sao sempre de UMA empresa. A versao sem filtro
  // vazou peca da COHAPM p/ dentro da auditoria de credito da Legal (auditoria 30/07).
  const { data, error } = await supa.rpc("get_criativos_conteudo", { p_somente_ativas: somenteAtivas, p_company_id: companyId });
  if (error) return { erro: `falha ao ler conteudo dos criativos: ${error.message}` };
  if (!data || typeof data !== "object") return { erro: "retorno inesperado de get_criativos_conteudo" };
  const obj = data as Record<string, unknown>;
  // v19: agrupa por legenda ANTES do corte. Varios anuncios compartilham o mesmo texto
  // (variacoes do mesmo criativo), entao o conjunto de textos distintos e muito menor que
  // a lista de pecas - e e o que compliance precisa. Isso torna a auditoria retroativa
  // COMPLETA mesmo quando a lista de criativos vem truncada.
  const lista = Array.isArray(obj.criativos) ? (obj.criativos as Record<string, unknown>[]) : [];
  const grupos = new Map<string, Record<string, unknown>>();
  for (const c of lista) {
    const legenda = String(c.legenda ?? "").trim();
    if (!legenda) continue;
    const chave = norm(legenda).slice(0, 300);
    const g = grupos.get(chave);
    if (!g) {
      grupos.set(chave, { legenda, titulo: c.titulo ?? null, cta: c.cta ?? null,
        anuncios: 1, exemplos: [c.anuncio], gasto_total: Number(c.gasto_acumulado || 0),
        formularios_total: Number(c.formularios || 0), alguma_em_campanha_ativa: c.campanha_ativa === true });
    } else {
      g.anuncios = Number(g.anuncios) + 1;
      if ((g.exemplos as unknown[]).length < 3) (g.exemplos as unknown[]).push(c.anuncio);
      g.gasto_total = Number(g.gasto_total) + Number(c.gasto_acumulado || 0);
      g.formularios_total = Number(g.formularios_total) + Number(c.formularios || 0);
      if (c.campanha_ativa === true) g.alguma_em_campanha_ativa = true;
    }
  }
  const unicas = [...grupos.values()].sort((a, b) => Number(b.gasto_total) - Number(a.gasto_total));
  // v20: lista bruta cortada em 4.000 (era 11.500). O dedupe do v19 tornou legendas_unicas
  // a fonte util para compliance; a lista peca-por-peca serve so para contexto.
  const cortado = cortarLista(obj, "criativos", 4000) as Record<string, unknown>;
  const comUnicas = cortarLista({ ...cortado, legendas_unicas: unicas,
    total_legendas_distintas: unicas.length,
    nota_legendas: "legendas_unicas cobre TODOS os criativos coletados, inclusive os omitidos da lista 'criativos'. Use esta lista para auditoria de compliance completa: cada texto distinto precisa ser checado uma vez, nao uma vez por anuncio.",
  }, "legendas_unicas", 6500);
  return { ...comUnicas, somente_campanhas_ativas: somenteAtivas };
}
// v28.7 (04/08/2026): a RPC ganhou empresa e paginacao. Sem p_company_id ela devolve lista vazia
// com AVISO_CRITICO de proposito - a sobrecarga antiga e alarme, nao compatibilidade. Antes disso
// a funcao nao tinha filtro de empresa NENHUM: devolvia os 46 conjuntos da Legal misturados com os
// 8 da COHAPM, sem marcacao. Mesmo vazamento do get_criativos_conteudo (30/07), nunca replicado
// aqui. Pagina comeca em 1 na interface da tool, como no get_criativos_conteudo.
// cortarLista fica: hoje e no-op (pagina de 20 = 11.157 bytes, abaixo do teto de 11.500), mas e o
// unico guarda que DECLARA truncagem. Sem ele, a unica protecao seria o slice(0,14000) bruto la no
// envio ao modelo, que corta JSON no meio sem avisar - a falha silenciosa que o v18 existe para
// impedir.
async function t_estrutura_conjuntos(companyId: string, pagina: number) {
  const tamanho = 20;
  const { data, error } = await supa.rpc("get_estrutura_conjuntos", {
    p_company_id: companyId,
    p_offset: Math.max(0, (Math.max(1, pagina) - 1) * tamanho),
    p_limit: tamanho,
  });
  if (error) return { erro: `falha ao ler estrutura de conjuntos: ${error.message}` };
  if (!data || typeof data !== "object") return { erro: "retorno inesperado de get_estrutura_conjuntos" };
  return cortarLista(data as Record<string, unknown>, "conjuntos");
}

type CardInfo = { approval_id: string; action: string; entity_type: string; target_name: string; summary: string; params: any; status: string };

// v28.8 (GT-06): POSTURA DE EXECUCAO, FONTE UNICA. O v28.6 pos a doutrina inline no caminho de
// CRIACAO e deixou o de MODIFICACAO sem ler nada - o agente ofereceu card de pausa com a flag
// desligada, o gestor aprovaria e a executora bloquearia depois. Copiar o bloco poria a mesma
// regra em tres lugares (dois aqui, um na meta-actions), que e exatamente o que produziu o desync
// do "nasce pausado" entre 31/07 e 03/08. Agora os dois caminhos consultam a MESMA RPC e usam o
// MESMO texto - `mensagem_para_o_gestor` tem dono unico no banco, o chat nao compoe frase propria.
// A RPC nao autoriza nada: a trava que vale segue sendo a da meta-actions no ato da execucao.
// Ela so evita que o chat prometa o que a executora vai recusar.
async function verificarPostura(companyId: string, action: string) {
  const { data, error } = await supa.rpc("pode_executar_acao", {
    p_company_id: companyId, p_action: action,
  });
  if (error) {
    // Falha de verificacao NAO emite card: se nao deu para saber, nao se promete.
    return { perm: null, recusa: { erro: `nao consegui verificar a postura de execucao: ${error.message}. NAO emiti o card - sem essa verificacao nao ha como saber se a aprovacao surtiria efeito.` } };
  }
  const perm = data as Record<string, unknown> | null;
  if (!perm?.permitido) {
    return { perm: null, recusa: {
      erro: String(perm?.motivo ?? "acao_nao_permitida"),
      detalhe: String(perm?.mensagem_para_o_gestor ?? ""),
      acao_bloqueada: action } };
  }
  return { perm, recusa: null };
}
async function t_propose_action(companyId: string, convId: string, requestedBy: string, args: any, cards: CardInfo[]) {
  const action = String(args?.action_type ?? "");
  const targetLike = String(args?.target_name ?? "").trim();
  const justificativa = String(args?.justificativa ?? "").trim();
  const params = args?.params ?? {};
  const VALID = ["pausar_criativo", "escalar_criativo", "pausar_campanha", "alterar_orcamento"];
  if (!VALID.includes(action)) return { erro: `action_type invalido; use: ${VALID.join(", ")}` };
  if (!targetLike) return { erro: "target_name obrigatorio" };
  if (!justificativa) return { erro: "justificativa obrigatoria com numeros reais (EVIDENCIA: metrica + nivel + janela + periodo)" };
  // v24: regra do pacote de skills - "recomendacao sem reversa definida nao sobe para
  // aprovacao". Card sem plano de desfazer e risco operacional, nao proposta.
  const reversa = String(args?.reversa ?? "").trim();
  const sucesso = String(args?.metrica_sucesso ?? "").trim();
  if (!reversa) return { erro: "reversa obrigatoria: descreva COMO desfazer esta acao, QUEM desfaz e EM QUANTO TEMPO. Sem plano de reversao o pedido nao pode ser criado." };
  if (!sucesso) return { erro: "metrica_sucesso obrigatoria: qual metrica e qual limiar dizem que deu certo, lida no funil COMPLETO (ate contrato pago), nao apenas no custo de midia." };
  if (action === "alterar_orcamento" && !(Number(params?.novo_orcamento_diario_reais) > 0)) return { erro: "informe params.novo_orcamento_diario_reais (> 0)" };

  // v28.8 (GT-06): a trava e consultada ANTES de montar payload ou gravar card - de nada serve
  // descobrir depois que a acao esta desligada. Aqui so a recusa interessa: o caminho de
  // modificacao nao usa conta permitida nem teto de sanidade (o alvo ja existe).
  const { recusa } = await verificarPostura(companyId, action);
  if (recusa) return recusa;

  const needle = norm(targetLike);
  const isAd = action === "pausar_criativo" || action === "escalar_criativo";
  let matches: { id: string; name: string; external_id?: string }[] = [];
  if (isAd) {
    const { data: camps } = await supa.from("campaigns").select("id").eq("company_id", companyId).eq("status", "active");
    const campIds = (camps ?? []).map((c) => c.id);
    const { data: ads } = await supa.from("ads").select("id,name,external_id,campaign_id").eq("company_id", companyId);
    matches = (ads ?? []).filter((a) => campIds.includes(a.campaign_id) && norm(a.name).includes(needle));
  } else {
    const { data: camps } = await supa.from("campaigns").select("id,name,external_id").eq("company_id", companyId);
    matches = (camps ?? []).filter((c) => norm(c.name).includes(needle));
  }
  if (!matches.length) return { erro: `nenhum alvo contendo '${targetLike}'. NAO invente: pergunte o nome correto.` };
  let alvo = matches[0];
  if (matches.length > 1) {
    const exact = matches.filter((m) => norm(m.name) === needle);
    if (exact.length === 1) alvo = exact[0];
    else return { ambiguo: true, opcoes: matches.slice(0, 6).map((m) => m.name), instrucao: "peca o NOME COMPLETO EXATO" };
  }
  const entityType = action === "alterar_orcamento" ? "budget" : (isAd ? "ad" : "campaign");
  const summary = ({ pausar_criativo: `Pausar o criativo "${alvo.name}"`, escalar_criativo: `Escalar o criativo "${alvo.name}"`,
    pausar_campanha: `Pausar a campanha "${alvo.name}"`,
    alterar_orcamento: `Alterar orcamento diario de "${alvo.name}" para ${brl(Number(params?.novo_orcamento_diario_reais ?? 0))}` } as Record<string, string>)[action];
  const { data: ins, error: ie } = await supa.from("approval_requests").insert({
    company_id: companyId, requested_by: requestedBy, conversation_id: convId, entity_type: entityType,
    entity_id: alvo.id, action, summary,
    payload: { ...params, target_name: alvo.name, target_external_id: alvo.external_id ?? null,
      justificativa, reversa, metrica_sucesso: sucesso,
      janela_leitura: String(args?.janela_leitura ?? "").trim() || null,
      risco: String(args?.risco ?? "").trim() || null,
      mecanismo: String(args?.mecanismo ?? "").trim() || null,
      proposto_por: "traffic-chat" },
    status: "pending",
  }).select("id").single();
  if (ie) return { erro: `falha ao criar pedido: ${ie.message}` };
  await supa.from("audit_log").insert({ company_id: companyId, user_id: requestedBy, action: "approval_created",
    target_type: "approval_request", target_id: ins.id, details: { acao: action, alvo: alvo.name, justificativa, origem: "edge:traffic-chat" } });
  cards.push({ approval_id: ins.id, action, entity_type: entityType, target_name: alvo.name, summary, params, status: "pending" });
  return { ok: true, approval_id: ins.id, resumo: summary, aviso: "Pedido PENDENTE. Nada foi executado." };
}
// v25: proposta das acoes de CRIACAO. Separada de t_propose_action porque a semantica e
// oposta: lá o alvo e o objeto a modificar; aqui o "alvo" e o MOLDE a replicar (ou, no caso
// de campanha, o nome do objeto que vai nascer).
const ACOES_CRIACAO = ["criar_campanha", "criar_conjunto_a_partir_de", "criar_anuncio_a_partir_de"];

async function t_propose_criacao(companyId: string, convId: string, requestedBy: string, args: any, cards: CardInfo[], mcpKey: string) {
  const action = String(args?.action_type ?? "");
  const nomeAlvo = String(args?.target_name ?? "").trim();
  const justificativa = String(args?.justificativa ?? "").trim();
  const reversa = String(args?.reversa ?? "").trim();
  const sucesso = String(args?.metrica_sucesso ?? "").trim();
  const params = args?.params ?? {};

  if (!justificativa) return { erro: "justificativa obrigatoria (EVIDENCIA: por que criar isso, com numero e fonte)" };
  if (!reversa) return { erro: "reversa obrigatoria: como desfazer (ex.: excluir o objeto criado - ele nasce PAUSADO, entao a reversa antes da ativacao e barata), quem desfaz e em quanto tempo" };
  if (!sucesso) return { erro: "metrica_sucesso obrigatoria: qual metrica e limiar dizem que deu certo, no funil completo ate contrato pago" };

  // v28.8 (GT-06): a leitura inline de meta_execution_config que o v28.6 introduziu aqui saiu.
  // A mesma RPC do caminho de modificacao responde - vocabulario de recusa e texto ao gestor
  // passam a ter um dono so. O que a config ainda fornece vem do retorno dela.
  const { perm, recusa } = await verificarPostura(companyId, action);
  if (recusa) return recusa;
  const contasOk: string[] = ((perm!.contas_permitidas_criacao as string[]) ?? []).map((x: string) => x.startsWith("act_") ? x : `act_${x}`);
  // v28.9: teto_sanidade nao e mais lido aqui. Quem julga orcamento e avaliar_orcamento_diario,
  // que ja compara contra o teto da empresa - manter a leitura aqui deixaria uma variavel pronta
  // para alguem reintroduzir a comparacao local ao lado da RPC.
  if (!contasOk.length) return { erro: "criacao bloqueada: nenhuma conta desta empresa esta habilitada para criacao. Isso e configuracao do sistema, nao algo que voce possa contornar." };
  const avisoDryRun = (perm!.aviso_dry_run as string | null) ?? null;

  // v25 CORRECAO CRITICA (28/07): a conta de destino tem de vir da EMPRESA DESTA CONVERSA,
  // nunca do primeiro item da lista branca. Existem 2 empresas no banco (Legal e Viver e
  // COHAPM) e 20 contas meta_ads; usar contasOk[0] criaria o objeto na conta da Legal mesmo
  // com a COHAPM selecionada - cruzar portfolio nao tem reversa simples.
  const { data: integ } = await supa.from("integrations")
    .select("external_id,account_name,status").eq("company_id", companyId).eq("provider", "meta_ads");
  const candidatas = (integ ?? []).map((i: any) => String(i.external_id ?? "").trim())
    .filter(Boolean).map((x: string) => x.startsWith("act_") ? x : `act_${x}`);
  const contaDaEmpresa = candidatas.find((c: string) => contasOk.includes(c));
  if (!contaDaEmpresa) {
    return { erro: "criacao_bloqueada_por_isolamento_de_portfolio",
      detalhe: `A empresa desta conversa nao tem nenhuma conta de anuncios habilitada para criacao. Contas da empresa: ${candidatas.join(", ") || "(nenhuma)"}. Habilitadas para criacao: ${contasOk.join(", ")}. Informe ao gestor que criar objeto para esta empresa exige liberar a conta dela na configuracao - e NAO proponha usar a conta de outra empresa.` };
  }

  // -------- criar_campanha: nao ha molde; o nome informado e o da campanha que vai nascer --------
  if (action === "criar_campanha") {
    if (!nomeAlvo) return { erro: "target_name deve ser o NOME da campanha a criar" };
    const { data: existentes } = await supa.from("campaigns").select("name").eq("company_id", companyId);
    if ((existentes ?? []).some((c) => norm(c.name) === norm(nomeAlvo))) {
      return { erro: `ja existe uma campanha chamada '${nomeAlvo}'. Escolha outro nome ou proponha usar a existente.` };
    }
    // v26: ODAX. A API so aceita estes seis; sinonimos comuns sao mapeados e o resto e
    // recusado, porque objetivo invalido so falharia no momento da execucao real.
    const ODAX = ["OUTCOME_LEADS", "OUTCOME_SALES", "OUTCOME_TRAFFIC", "OUTCOME_ENGAGEMENT", "OUTCOME_AWARENESS", "OUTCOME_APP_PROMOTION"];
    const SINONIMOS: Record<string, string> = {
      LEADS: "OUTCOME_LEADS", LEAD_GENERATION: "OUTCOME_LEADS", LEADGEN: "OUTCOME_LEADS",
      CONVERSIONS: "OUTCOME_SALES", SALES: "OUTCOME_SALES", VENDAS: "OUTCOME_SALES",
      TRAFFIC: "OUTCOME_TRAFFIC", TRAFEGO: "OUTCOME_TRAFFIC", LINK_CLICKS: "OUTCOME_TRAFFIC",
      MESSAGES: "OUTCOME_ENGAGEMENT", MENSAGEM: "OUTCOME_ENGAGEMENT", ENGAGEMENT: "OUTCOME_ENGAGEMENT",
      AWARENESS: "OUTCOME_AWARENESS", RECONHECIMENTO: "OUTCOME_AWARENESS",
    };
    const bruto = String(params?.objetivo ?? "OUTCOME_LEADS").trim().toUpperCase().replace(/[\s-]+/g, "_");
    const objetivo = ODAX.includes(bruto) ? bruto : (SINONIMOS[bruto] ?? "");
    if (!objetivo) return { erro: `objetivo '${bruto}' nao e valido na Meta. Use um destes: ${ODAX.join(", ")}. Para geracao de lead em landing page o correto e OUTCOME_LEADS.` };
    const summary = `Criar campanha "${nomeAlvo}" (objetivo ${objetivo}) - nasce PAUSADA, categoria especial de credito obrigatoria`;
    return await gravarCard(companyId, convId, requestedBy, action, "campaign", null, summary, {
      nome_novo: nomeAlvo, objetivo, conta_destino: contaDaEmpresa,
      special_ad_categories: ["FINANCIAL_PRODUCTS_SERVICES"], status_inicial: "PAUSED",  // v28.6: a execucao volta a criar PAUSADO (meta-actions v4.3)
      justificativa, reversa, metrica_sucesso: sucesso,
      janela_leitura: String(args?.janela_leitura ?? "").trim() || null,
      risco: String(args?.risco ?? "").trim() || null,
    }, cards);
  }

  // -------- criar_conjunto_a_partir_de --------
  if (action === "criar_conjunto_a_partir_de") {
    const nomeNovo = String(params?.nome_novo ?? "").trim();
    const campanhaDestino = String(params?.campanha_destino ?? "").trim();
    const orcamento = Number(params?.orcamento_diario_reais ?? 0);
    if (!nomeAlvo) return { erro: "target_name deve ser o nome do CONJUNTO MOLDE a replicar (um que ja funciona)" };
    if (!nomeNovo) return { erro: "params.nome_novo obrigatorio (nome do conjunto que vai nascer)" };
    if (!campanhaDestino) return { erro: "params.campanha_destino obrigatorio (nome da campanha que vai receber o conjunto)" };
    if (!(orcamento > 0)) return { erro: "params.orcamento_diario_reais obrigatorio. NAO existe valor padrao: PERGUNTE ao gestor qual orcamento diario ele quer para este conjunto antes de propor." };

    // v28.9: quem decide se o orcamento cabe e a RPC, nao uma comparacao local. Ela devolve
    // tambem o que o numero REALMENTE permite - media, teto real do dia (175%, texto da Meta),
    // teto semanal garantido e o pior dia somando N campanhas. O gestor decidiu "R$ 60 por
    // campanha" achando que era limite do dia; com tres campanhas o pior dia e R$ 315,00.
    // A comparacao contra tetoSanidade que existia aqui SAIU: dois juizes para a mesma pergunta
    // foi o que produziu o desync do contrato de ativacao entre 31/07 e 03/08.
    const { data: orc, error: orcErr } = await supa.rpc("avaliar_orcamento_diario", {
      p_company_id: companyId, p_reais: orcamento, p_campanhas: 1,
    });
    if (orcErr) return { erro: `nao consegui avaliar o orcamento: ${orcErr.message}. NAO emiti o card - sem essa avaliacao nao ha como dizer ao gestor o que o valor realmente permite.` };
    if (!orc?.permitido) {
      return { erro: String(orc?.motivo ?? "orcamento_nao_permitido"),
               detalhe: String(orc?.mensagem_para_o_gestor ?? "") };
    }
    const avisoOrcamento = String(orc.mensagem_para_o_gestor ?? "");

    const { data: sets } = await supa.from("ad_sets").select("id,name,external_id,account_id").eq("company_id", companyId);
    const molde = (sets ?? []).find((x) => norm(x.name) === norm(nomeAlvo)) ?? (sets ?? []).filter((x) => norm(x.name).includes(norm(nomeAlvo)))[0];
    if (!molde) return { erro: `conjunto molde '${nomeAlvo}' nao encontrado. NAO invente: peca o nome exato ao gestor.` };
    const contaMolde = molde.account_id ? (String(molde.account_id).startsWith("act_") ? String(molde.account_id) : `act_${molde.account_id}`) : null;
    if (contaMolde && contaMolde !== contaDaEmpresa) {
      return { erro: `o conjunto molde pertence a conta ${contaMolde}, diferente da conta desta empresa (${contaDaEmpresa}). Replicar entre contas nao e permitido - peca um molde da propria conta.` };
    }
    // v28.6 (GT-04): tres caminhos para achar a campanha de destino, em ordem de confiabilidade.
    // O que travou em 02/08 foi so o primeiro: o espelho nao tinha as campanhas criadas pelo
    // proprio sistema (a meta-actions nao gravava - corrigido no GT-02). Os outros dois existem
    // para que a mesma cegueira nunca mais bloqueie a escada.
    const { data: camps } = await supa.from("campaigns").select("id,name,external_id").eq("company_id", companyId);
    const soDigitos = /^\d{6,}$/.test(campanhaDestino);
    let dest = soDigitos
      ? (camps ?? []).find((c) => String(c.external_id ?? "") === campanhaDestino)
      : ((camps ?? []).find((c) => norm(c.name) === norm(campanhaDestino))
         ?? (camps ?? []).filter((c) => norm(c.name).includes(norm(campanhaDestino)))[0]);
    let destOrigem = dest ? "espelho" : "";
    if (!dest) {
      // Ultimo recurso: card de criacao JA EXECUTADO. O identificador que a Meta devolveu fica
      // gravado no proprio pedido, entao a campanha existe de fato mesmo se o espelho atrasar.
      const { data: exec } = await supa.from("approval_requests")
        .select("execution_result").eq("company_id", companyId).eq("action", "criar_campanha")
        .not("executed_at", "is", null).order("executed_at", { ascending: false }).limit(20);
      const hit = (exec ?? []).find((r: any) => {
        const nome = String(r.execution_result?.objeto?.name ?? "");
        const id = String(r.execution_result?.id_criado ?? "");
        return r.execution_result?.ok === true && id &&
          (soDigitos ? id === campanhaDestino : norm(nome).includes(norm(campanhaDestino)));
      });
      if (hit) {
        dest = { id: null as any, name: String(hit.execution_result?.objeto?.name ?? campanhaDestino),
                 external_id: String(hit.execution_result?.id_criado) };
        destOrigem = "pedido_executado";
      }
    }
    if (!dest) return { erro: `campanha de destino '${campanhaDestino}' nao encontrada nem no sistema nem entre as criadas por pedido aprovado. Se ela ainda nao existe, proponha criar_campanha primeiro e aguarde a aprovacao. NAO invente o identificador.` };
    if (!dest.external_id) return { erro: `a campanha '${dest.name}' existe no sistema mas ainda nao tem identificador da Meta sincronizado - sem ele o conjunto nao tem onde nascer. Aguarde a proxima sincronizacao.` };

    // v28.9: o aviso entra NO SUMMARY, nao so no payload. O summary e o unico texto que o cartao
    // mostra sem expandir nada, e o gestor decide lendo o cartao no sininho - aviso que fica so na
    // conversa ja rolou para cima quando a decisao acontece.
    const summary = `Criar conjunto "${nomeNovo}" replicando "${molde.name}" na campanha "${dest.name}" - ${brl(orcamento)}/dia, nasce PAUSADO` +
      (avisoOrcamento ? ` — ${avisoOrcamento}` : "");
    const card = await gravarCard(companyId, convId, requestedBy, action, "adset", molde.id, summary, {
      nome_novo: nomeNovo, molde_external_id: molde.external_id, molde_nome: molde.name,
      campanha_destino_external_id: dest.external_id, campanha_destino_nome: dest.name,
      orcamento_diario_reais: orcamento, conta_destino: contaDaEmpresa, status_inicial: "PAUSED",  // v28.6: aprovar CRIA pausado; ativar e ato do gestor
      aviso_orcamento: avisoOrcamento || null,
      orcamento_media_por_dia: orc?.media_por_dia ?? null,
      orcamento_teto_real_do_dia: orc?.teto_real_do_dia ?? null,
      orcamento_teto_semanal_garantido: orc?.teto_semanal_garantido ?? null,
      justificativa, reversa, metrica_sucesso: sucesso,
      janela_leitura: String(args?.janela_leitura ?? "").trim() || null,
      risco: String(args?.risco ?? "").trim() || null,
    }, cards);
    // Devolve o aviso na resposta da tool tambem: o agente precisa repassar ao gestor ANTES de ele
    // decidir, e o texto vem inteiro da RPC - sem frase composta aqui, o dono do texto e um so.
    return avisoOrcamento && card && typeof card === "object" && !(card as any).erro
      ? { ...(card as any), aviso_orcamento: avisoOrcamento }
      : card;
  }

  // -------- criar_anuncio_a_partir_de (compliance BLOQUEANTE) --------
  if (action === "criar_anuncio_a_partir_de") {
    const nomeNovo = String(params?.nome_novo ?? "").trim();
    // Nome do conjunto na fala do agente (ou id). O nome CANONICO no pedido/card/executor e
    // conjunto_destino_external_id — o que montarCriacao consome. Alias conjunto_destino so
    // resolve o objeto aqui; a RPC e o payload usam o external_id.
    const conjuntoDestino = String(
      params?.conjunto_destino ?? params?.conjunto_destino_external_id ?? "",
    ).trim();
    const utmCampaign = String(params?.utm_campaign ?? "").trim();
    const driveFileId = String(params?.drive_file_id ?? "").trim();   // v28.10 (GT-13): peca nova
    if (!nomeAlvo) return { erro: "target_name deve ser o nome do ANUNCIO MOLDE a replicar" };
    if (!nomeNovo) return { erro: "params.nome_novo obrigatorio (nome do anuncio que vai nascer)" };
    if (!conjuntoDestino) {
      return {
        erro:
          "params.conjunto_destino (nome) ou params.conjunto_destino_external_id obrigatorio — conjunto que recebe o anuncio",
      };
    }
    if (!utmCampaign) return { erro: "params.utm_campaign obrigatorio: e o valor que aparece no Dash como identificacao da campanha (ex.: AGOSTO26). Pergunte ao gestor se nao souber." };

    const { data: anuncios } = await supa.from("ads").select("id,name,external_id,creative_id,body,title,account_id").eq("company_id", companyId);
    const molde = (anuncios ?? []).find((x) => norm(x.name) === norm(nomeAlvo)) ?? (anuncios ?? []).filter((x) => norm(x.name).includes(norm(nomeAlvo)))[0];
    if (!molde) return { erro: `anuncio molde '${nomeAlvo}' nao encontrado. NAO invente: peca o nome exato.` };
    if (!molde.creative_id) return { erro: `o anuncio molde '${molde.name}' nao tem criativo sincronizado (creative_id ausente) - sem ele nao e possivel replicar sem upload de midia, que nao esta implementado.` };

    const { data: sets } = await supa.from("ad_sets").select("id,name,external_id").eq("company_id", companyId);
    const dest = (sets ?? []).find((x) => x.external_id === conjuntoDestino)
      ?? (sets ?? []).find((x) => norm(x.name) === norm(conjuntoDestino))
      ?? (sets ?? []).filter((x) => norm(x.name).includes(norm(conjuntoDestino)))[0];
    if (!dest) return { erro: `conjunto de destino '${conjuntoDestino}' nao encontrado. Se ainda nao existe, proponha criar_conjunto_a_partir_de primeiro.` };

    // v28.10 (GT-13) - DOIS PEDIDOS, UMA FONTE. Existem dois anuncios diferentes com o mesmo nome
    // de acao: REPLICAR um que ja roda (escalar o que funciona) e PUBLICAR PECA NOVA do acervo.
    // Quem decide o que cada um exige e pedido_de_anuncio_completo, no banco - nao este arquivo.
    // A LEGENDA NAO E ENTRADA NA REPLICACAO: vem do criativo do molde, e a fonte e declarada como
    // tal. Na peca nova ela e entrada, porque nao existe em lugar nenhum do sistema: nem no Drive,
    // nem em tabela. As tres procedencias legitimas (humano, herdada_do_molde, agente) sao da RPC.
    let legendaFonte = String(params?.legenda_fonte ?? "").trim();
    let legenda = String(params?.legenda ?? "").trim();
    const legendaRefs = Array.isArray(params?.legenda_referencias) ? params.legenda_referencias : null;
    if (!driveFileId) {
      legenda = String(molde.body ?? "").trim();
      legendaFonte = "herdada_do_molde";
    } else if (!legenda && legendaFonte === "herdada_do_molde") {
      // O gestor autorizou herdar: o texto e o do molde, e a procedencia diz exatamente isso.
      legenda = String(molde.body ?? "").trim();
    }

    // O pedido usa o vocabulario do contrato (que veio de montarCriacao), nao um dialeto local:
    // validar_pedido_contra_contrato e pedido_de_anuncio_completo tem de aceitar o MESMO objeto.
    // Antes daqui ia 'molde' com o NOME do anuncio e nem conta_destino nem creative_id - o que
    // passava na verificacao e era recusado pelo contrato, exatamente a divergencia que o GT-13
    // deveria ter fechado. O molde e identificado pelo creative_id, que e o que a Graph recebe.
    const pedido: Record<string, unknown> = {
      nome_novo: nomeNovo,
      conjunto_destino_external_id: dest.external_id,
      conta_destino: contaDaEmpresa,
      creative_id: molde.creative_id,
    };
    if (driveFileId) {
      pedido.drive_file_id = driveFileId;
      pedido.legenda = legenda;
      pedido.legenda_fonte = legendaFonte;
      if (legendaRefs) pedido.legenda_referencias = legendaRefs;
    }
    const { data: ver, error: verErr } = await supa.rpc("pedido_de_anuncio_completo", { p_company_id: companyId, p_pedido: pedido });
    // Falha de verificacao NAO emite card - mesmo tratamento de pode_executar_acao e
    // avaliar_orcamento_diario. Verificador que nao respondeu nao autorizou nada.
    if (verErr || !ver) {
      return { erro: "verificacao_do_pedido_indisponivel",
        detalhe: `Nao consegui verificar se o pedido esta completo (${verErr?.message ?? "resposta vazia"}), entao NAO emiti o card. Sem essa verificacao eu estaria propondo criacao de anuncio sem conferir o que ela exige.` };
    }
    const v: any = ver;
    if (v.completo !== true) {
      // A mensagem e dela, nao minha: recusa inventada aqui seria a doutrina em dois lugares.
      return { pedido_incompleto: true, tipo_de_pedido: v.tipo_de_pedido ?? null,
        faltando: v.faltando ?? null, mensagem_para_o_gestor: v.mensagem_para_o_gestor,
        instrucao: "Repasse esta mensagem ao gestor e peca o que falta. NAO monte card e NAO preencha o que falta por conta propria." };
    }
    // A RPC declara peca_ja_na_biblioteca=false e AVISA, mas nao recusa - a decisao e do fluxo.
    // Aqui ela e recusa: aprovar um card e o ato que inicia gasto, e este card falharia na
    // execucao DEPOIS de aprovado. Descobrir na execucao e o pior lugar para descobrir.
    if (v.peca_ja_na_biblioteca === false) {
      return { pedido_incompleto: true, tipo_de_pedido: v.tipo_de_pedido ?? null,
        mensagem_para_o_gestor: v.mensagem_para_o_gestor,
        instrucao: "A peca ainda nao esta na biblioteca da conta. NAO emiti o card porque ele falharia na execucao, depois de aprovado. Repasse a mensagem ao gestor." };
    }

    // A biblioteca ja foi julgada pela RPC; aqui e so BUSCAR o valor que ela confirmou existir.
    let metaVideoId: string | null = null;
    if (driveFileId) {
      const { data: up } = await supa.from("media_uploads").select("meta_video_id")
        .eq("drive_file_id", driveFileId).not("meta_video_id", "is", null).limit(1).maybeSingle();
      metaVideoId = up?.meta_video_id ? String(up.meta_video_id) : null;
      if (!metaVideoId) {
        return { erro: "inconsistencia_entre_verificacao_e_biblioteca",
          detalhe: `A verificacao disse que a peca ${driveFileId} esta na biblioteca da conta, mas media_uploads nao devolve meta_video_id para ela. NAO emiti card: propor criacao sem saber que midia sera publicada e o caminho para publicar a peca errada.` };
      }
    }

    // v25 TRAVA 3: compliance BLOQUEANTE, agora sobre a legenda DECIDIDA acima - do molde na
    // replicacao, do gestor ou herdada na peca nova. Quem escreveu nao muda a exposicao
    // regulatoria de um anuncio de credito, e por isso as duas passam pelas mesmas 16 regras.
    if (!legenda) return { erro: `o anuncio molde '${molde.name}' nao tem legenda sincronizada; sem ela nao e possivel validar compliance, e criar anuncio financeiro sem essa validacao nao e permitido.` };
    const comp: any = await t_check_compliance(legenda, [], mcpKey);
    const vereditoOk = comp && (comp.veredito === "aprovado" || comp.aprovado === true) && !comp.erro;
    if (!vereditoOk) {
      return { erro: "compliance_bloqueou_a_criacao",
        detalhe: "A legenda nao passou na validacao de compliance, entao a criacao NAO foi proposta. Relate ao gestor o veredito e as violacoes encontradas e sugira ajustar o texto antes de replicar.",
        veredito_compliance: comp };
    }

    // v25 TRAVA 4: UTM montada aqui, no codigo. {{site_source_name}} e macro da Meta e resolve
    // para fb/ig automaticamente - melhor que fixar um dos dois.
    const urlTags = `utm_source={{site_source_name}}&utm_medium=paid&utm_campaign=${slug(utmCampaign)}&utm_content=${slug(nomeNovo)}`;

    // A mensagem da verificacao vai INTEIRA para o summary, inclusive a nota visual da peca. O
    // gestor le o card no instante da decisao; o que fica so no payload recolhido ele nao le.
    const cabeca = driveFileId
      ? `Criar anuncio "${nomeNovo}" com PECA NOVA do acervo no conjunto "${dest.name}", usando "${molde.name}" como molde de configuracao - compliance de texto aprovado, nasce PAUSADO`
      : `Criar anuncio "${nomeNovo}" replicando "${molde.name}" no conjunto "${dest.name}" - compliance aprovado, nasce PAUSADO`;
    const summary = `${cabeca}\n\n${String(v.mensagem_para_o_gestor ?? "")}`.trim();
    return await gravarCard(companyId, convId, requestedBy, action, "ad", molde.id, summary, {
      nome_novo: nomeNovo, molde_external_id: molde.external_id, molde_nome: molde.name,
      creative_id: molde.creative_id, conjunto_destino_external_id: dest.external_id,
      conjunto_destino_nome: dest.name, url_tags: urlTags, utm_campaign: slug(utmCampaign),
      conta_destino: contaDaEmpresa, status_inicial: "PAUSED",  // v28.6: aprovar CRIA pausado; ativar e ato do gestor
      // v28.10 (GT-13): a executora le meta_video_id para trocar a midia no spec do molde.
      // Ausente = replicacao pura, e ela replica o criativo inteiro como sempre fez.
      tipo_de_pedido: v.tipo_de_pedido ?? null,
      drive_file_id: driveFileId || null, meta_video_id: metaVideoId,
      legenda, legenda_fonte: legendaFonte || null, legenda_referencias: legendaRefs,
      nota_visual_da_peca: v.nota_visual_da_peca ?? null,
      compliance: { veredito: comp?.veredito ?? "aprovado", regras_aplicadas: comp?.regras_aplicadas ?? null, validado_em: new Date().toISOString() },
      justificativa, reversa, metrica_sucesso: sucesso,
      janela_leitura: String(args?.janela_leitura ?? "").trim() || null,
      risco: String(args?.risco ?? "").trim() || null,
    }, cards);
  }

  return { erro: `acao de criacao desconhecida: ${action}` };
}

async function gravarCard(companyId: string, convId: string, requestedBy: string, action: string,
    entityType: string, entityId: string | null, summary: string, payload: Record<string, unknown>, cards: CardInfo[]) {
  const { data: ins, error: ie } = await supa.from("approval_requests").insert({
    company_id: companyId, requested_by: requestedBy, conversation_id: convId,
    entity_type: entityType, entity_id: entityId, action, summary,
    payload: { ...payload, proposto_por: "traffic-chat" }, status: "pending",
  }).select("id,expires_at").single();
  if (ie) return { erro: `falha ao criar pedido: ${ie.message}` };
  await supa.from("audit_log").insert({ company_id: companyId, user_id: requestedBy, action: "approval_created",
    target_type: "approval_request", target_id: ins.id,
    details: { acao: action, resumo: summary, payload, origem: "edge:traffic-chat" } });
  cards.push({ approval_id: ins.id, action, entity_type: entityType, target_name: String(payload.nome_novo ?? ""), summary, params: payload, status: "pending" });
  return { ok: true, approval_id: ins.id, resumo: summary, expira_em: ins.expires_at,
    aviso: "Pedido PENDENTE. Nada foi criado na Meta ainda. Ao ser aprovado por um administrador, o objeto nasce PAUSADO e precisa ser ativado manualmente no Gerenciador. O pedido expira em 24h se nao for decidido." };
}

async function t_check_compliance(legenda: string, imgAtts: { mime: string; b64: string }[], mcpKey: string) {
  const img = imgAtts[0];
  if (!legenda && !img) return { erro: "forneca a legenda e/ou anexe o criativo" };
  const body: any = {};
  if (legenda) body.legenda = legenda;
  if (img) { body.image_base64 = img.b64; body.mime = img.mime; }
  const r = await fetch(`${SUPABASE_URL}/functions/v1/compliance-check`, { method: "POST", headers: { "content-type": "application/json", "x-mcp-key": mcpKey }, body: JSON.stringify(body) });
  const t = await r.text();
  try { return JSON.parse(t); } catch { return { erro: `compliance-check falhou (${r.status})` }; }
}

// v28.6 (GT-03): a fila REAL, do banco. Sem isso o agente e cego para o efeito dos proprios
// cards - e agente cego perguntado sobre estado inventa. Traduz status cru em situacao legivel
// e expoe o erro da plataforma, que era invisivel para ele.
async function t_aprovacoes(companyId: string, apenasAbertos: boolean) {
  let q = supa.from("approval_requests")
    .select("id,action,summary,status,created_at,expires_at,reviewed_at,executed_at,execution_result,ultima_falha")
    .eq("company_id", companyId).order("created_at", { ascending: false }).limit(25);
  if (apenasAbertos) q = q.in("status", ["pending", "approved"]);
  const { data, error } = await q;
  if (error) return { erro: `falha ao ler a fila de pedidos: ${error.message}` };
  const pedidos = (data ?? []).map((r: any) => {
    // v28.12: a situacao NAO e derivada aqui. Ela vem de situacaoDoCard, a mesma funcao que o
    // mcp-server usa - porque em 07/08/2026 esta funcao tinha a regra `falhou = !!executed_at &&
    // ok === false`, e uma falha ANTES de qualquer escrita (executed_at nulo) caia no ramo
    // "aprovado, ainda NAO executado". Foi essa frase que o agente leu antes de dizer ao gestor
    // que o conjunto estava sendo criado, tres segundos depois de a criacao ter falhado.
    const s = situacaoDoCard(r);
    const er = r.execution_result ?? {};
    return {
      id: r.id, acao: r.action, resumo: r.summary,
      estado: s.estado,
      situacao: s.situacao,
      criado_em: r.created_at, expira_em: r.expires_at ?? null,
      decidido_em: r.reviewed_at ?? null, executado_em: r.executed_at ?? null,
      id_criado_na_meta: s.id_criado_na_meta,
      espelho_gravado: er.espelho_gravado ?? null,
      motivo_da_falha: s.motivo_da_falha,
      falhou_em: s.falhou_em,
      tentativas_de_execucao: s.tentativas,
      pode_ser_retentado: s.re_executavel,
      erro_da_plataforma: s.detalhe_tecnico_da_falha,
      aviso: er.aviso ?? null,
    };
  });
  return {
    total: pedidos.length,
    filtro: apenasAbertos ? "somente pendentes e aprovados" : "ultimos 25 de qualquer situacao",
    pedidos,
    nota: "Esta e a fila REAL do banco desta empresa. Se um pedido NAO aparece aqui, ele NAO existe - jamais afirme ter emitido um card que nao esta nesta lista. LEIA O CAMPO `estado`, nao deduza pelo resto: executado = o objeto existe e id_criado_na_meta traz o identificador; execucao_falhou = a tentativa TERMINOU e falhou, e motivo_da_falha diz por que (relate ao gestor nessa linguagem); aguardando_execucao = nenhuma tentativa foi registrada ainda. A EXECUCAO E SINCRONA COM A APROVACAO: aprovar dispara a execucao no ato, entao aguardando_execucao deve durar segundos e NAO existe fila amadurecendo. E PROIBIDO dizer ao gestor 'aguarde alguns instantes', 'esta sendo criado' ou 'esta sendo processado' - nenhum desses estados existe neste sistema. Card aprovado sem identificador ou FALHOU ou nao rodou. pode_ser_retentado=true significa apenas que um novo disparo e possivel, NAO que algo esta acontecendo agora.",
  };
}

const TOOLS = [
  { type: "function", function: { name: "get_overview", description: "Visao geral de MIDIA: campanhas ativas (status real da Meta), gasto e resultados dos ultimos 7 dias, com dias_com_dado para checar cobertura.", parameters: { type: "object", properties: {} } } },
  { type: "function", function: { name: "get_alerts", description: "Alertas ativos do sistema (CPL, entrega, BM/politica, cobranca, WABA).", parameters: { type: "object", properties: {} } } },
  { type: "function", function: { name: "get_recommendations", description: "Recomendacoes pendentes da IA (regua = custo de midia, nao contrato pago).", parameters: { type: "object", properties: {} } } },
  { type: "function", function: { name: "teto_vigente", description: "FONTE PRIORITARIA para julgar teto vigente. Exige o company_id da conversa e uma metrica. Devolve qual regua governa, valor, denominador, autor/data/citacao da meta de negocio, consistencia historica, aspiracao e divergencias/avisos. A tabela targets isolada NAO decide teto vigente.", parameters: { type: "object", properties: { metric: { type: "string", description: "Metrica exata, por exemplo custo_por_formulario, custo_por_conversa ou custo_por_lead_lp." } }, required: ["metric"] } } },
  { type: "function", function: { name: "checar_par_texto_e_peca", description: "Avalia o PAR legenda + peca pela concatenacao do texto disponivel. Exige company_id da conversa, legenda e drive_file_id. Devolve veredito, leituras separadas, cobertura e lacunas; e deteccao por padroes, NAO aprovacao. Audio sem transcricao permanece explicitamente nao lido.", parameters: { type: "object", properties: { legenda: { type: "string" }, drive_file_id: { type: "string" } }, required: ["legenda", "drive_file_id"] } } },
  { type: "function", function: { name: "saude_das_integracoes", description: "Mede a saude das integracoes Meta desta empresa por evidencia de ads, snapshots, breakdown e tres relogios. Exige company_id da conversa. Declara divergencias contra status/estado_operacional sem alterar nenhum deles; nao promete diagnosticar provedores fora desse retorno.", parameters: { type: "object", properties: { dias_tolerancia: { type: "integer", description: "Opcional; padrao da RPC = 3 dias." } } } } },
  { type: "function", function: { name: "custo_llm_periodo", description: "Calcula em USD o custo derivado dos tokens gravados de chat e jobs no periodo para o company_id da conversa. Declara premissa de modelos e lacunas: cache pode ser cobrado como teto, ha subagentes sem tokens, visao e compliance-check ficam invisiveis. Nao e custo faturado.", parameters: { type: "object", properties: { de: { type: "string", description: "Data inicial YYYY-MM-DD." }, ate: { type: "string", description: "Data final YYYY-MM-DD." } }, required: ["de", "ate"] } } },
  { type: "function", function: { name: "panorama_utm_anuncios", description: "Mostra, para o company_id da conversa, coleta de url_tags e destino dos anuncios: nunca lido, lido sem/com rotulo, rotulos, ambiguidades e URLs. Distingue ausencia configurada de nao coleta quando o retorno permite. Limite: nao mede desempenho/leads por UTM e o token alcanca apenas parte das contas.", parameters: { type: "object", properties: {} } } },
  { type: "function", function: { name: "nota_visual_da_peca", description: "Retorna a nota visual textual completa de UMA peca do Drive no company_id da conversa: revisao aberta, base, produto, aproveitabilidade, risco, motivo e divergencia de produto. Ausencia de leitura nao e ausencia de risco; a nota informa e nao substitui decisao nem e veredito de compliance.", parameters: { type: "object", properties: { drive_file_id: { type: "string" } }, required: ["drive_file_id"] } } },
  { type: "function", function: { name: "registrar_veredito_peca_em_revisao", description: "PROPOE veredito de compliance em pecas_em_revisao emitindo um CARD DE APROVACAO. Voce NAO decide e NAO libera nada: a peca continua impedida e so muda quando um administrador aprovar o card na tela. A assinatura gravada sera a de QUEM APROVAR, resolvida por auth.users - o nome que voce passar em veredito_por entra apenas como autor_sugerido e nao tem valor de decisao. Valores: liberado_como_esta (se aprovado, desliga bloqueia_uso), ajustar_peca ou nao_usar (mantem o bloqueio). Ja existindo proposta pendente para a peca, a chamada e recusada. Ao responder, diga que emitiu proposta e que a decisao e do responsavel - nunca diga que a peca foi liberada. Nao faca UPDATE a mao.", parameters: { type: "object", properties: { drive_file_id: { type: "string" }, veredito: { type: "string", enum: ["liberado_como_esta", "ajustar_peca", "nao_usar"] }, veredito_por: { type: "string", description: "Opcional: quem pediu o veredito (ex.: Roberto). Registro informativo, NAO assinatura." }, nota: { type: "string", description: "Opcional: condicao ou justificativa que acompanha a proposta." } }, required: ["drive_file_id", "veredito"] } } },
  { type: "function", function: { name: "diagnosticar_custo", description: "Diagnostica por que o custo por formulario de um anuncio subiu, comparando o ultimo dia com entrega aos 3 anteriores. Exige company_id da conversa e ad_external_id. Devolve sinal, causa, acao, confirmacao, medidas e guarda de maturacao; sem base nao conclui, e problema depois do clique e apenas apontado porque esta fora do escopo.", parameters: { type: "object", properties: { ad_external_id: { type: "string" } }, required: ["ad_external_id"] } } },
  { type: "function", function: { name: "avaliar_fadiga", description: "Avalia se uma peca cansou, teve queda sem saturacao, esta com frequencia alta antes da queda ou nao tem sinal de fadiga. Exige company_id da conversa e ad_external_id. Sem entrega/base nao conclui; usa frequencia DIARIA e declara que frequencia deduplicada de 30 dias nao pode ser derivada das linhas diarias.", parameters: { type: "object", properties: { ad_external_id: { type: "string" } }, required: ["ad_external_id"] } } },
  { type: "function", function: { name: "pode_pausar_por_custo", description: "Verifica se um anuncio pode ser avaliado para pausa por custo: libera quando maduro ou pela excecao dura de zero resultado, CTR baixo e piso de gasto. Exige company_id da conversa e ad_external_id. Nao verifica a guarda do unico conjunto/alternativa ativa; permitido aqui NAO significa seguro pausar.", parameters: { type: "object", properties: { ad_external_id: { type: "string" } }, required: ["ad_external_id"] } } },
  { type: "function", function: { name: "decidir_sobre_conjunto", description: "Decide manter, maturar, trocar criativo ou preparar reversao para um conjunto usando custo, volume e tendencia. Exige company_id da conversa e adset_external_id. A guarda do unico conjunto entregando sobrescreve pausa. Declara a lacuna: sem regua de IDEAL separada do teto, esta funcao nao prescreve escala.", parameters: { type: "object", properties: { adset_external_id: { type: "string" } }, required: ["adset_external_id"] } } },
  { type: "function", function: { name: "avaliar_escala", description: "Avalia se um conjunto esta apto a escala por duplicacao com no maximo +20%, usando a arvore de decisao, custo ate 80% do teto, volume e espera. Exige company_id da conversa e adset_external_id. Nao cobre CBO sem orcamento proprio; a espera enxerga apenas escalas registradas pelo sistema, nao alteracoes manuais.", parameters: { type: "object", properties: { adset_external_id: { type: "string" } }, required: ["adset_external_id"] } } },
  { type: "function", function: { name: "avaliar_pacing", description: "Calcula capacidade diaria da estrutura e, se meta_leads_dia for informada, o PISO de verba diaria ao custo atual. Exige company_id da conversa; meta_leads_dia e opcional. Declara que nao existe meta registrada e que a projecao nao e estimativa: escalar tende a elevar o custo, portanto a verba real pode ser maior.", parameters: { type: "object", properties: { meta_leads_dia: { type: "number" } } } } },
  { type: "function", function: { name: "validar_pedido_contra_contrato", description: "Valida um pedido (json) contra o contrato declarado em contrato_de_execucao para a acao. Assinatura real: (acao text, pedido jsonb). Se nao houver linhas vigentes para a acao, devolve valido=false com motivo contrato_desconhecido (nao inventa campos). Se faltar campo obrigatorio, recusa com faltando[]. Campos extras NAO invalidam - vao em nao_previstos_no_contrato para decisao humana. O contrato de criar_anuncio_a_partir_de e o MESMO vocabulario que pedido_de_anuncio_completo aceita: um pedido valido aqui e entendido la, e vice-versa. LACUNAS HONESTAS: o contrato foi derivado do codigo montarCriacao (meta-actions), nao de card executado; url_tags e opcional e vai no adcreative, nao no ad; meta_video_id/legenda/thumbnail_url sao opcionais da rota peca nova; status_inicial e opcional porque o executor FORCA PAUSED no body e nao le o payload. NAO substitui pedido_de_anuncio_completo (biblioteca, compliance, procedencia).", parameters: { type: "object", properties: { acao: { type: "string", description: "Ex.: criar_anuncio_a_partir_de, criar_conjunto_a_partir_de, criar_campanha." }, pedido: { type: "object", description: "Objeto com os campos do payload que o executor leria." } }, required: ["acao", "pedido"] } } },
  { type: "function", function: { name: "get_funnel", description: "Funil de MIDIA num periodo, com cobertura_real (dias efetivamente com dado). Nao contem proposta/contrato.", parameters: { type: "object", properties: { date_from: { type: "string" }, date_to: { type: "string" } } } } },
  { type: "function", function: { name: "get_ads_ranking", description: "RECORTE de criativos por custo MEDIO de midia numa janela de dias. ATENCAO - este e um recorte (breakdown) e serve para ENTENDER, nunca para PRESCREVER: a Meta aloca verba por custo MARGINAL (do proximo resultado), entao um criativo com media mais alta pode estar segurando o custo total. E PROIBIDO propor pausar ou reduzir um criativo com base apenas nesta ordenacao; prescricao exige teste isolado ou tendencia temporal. Para decidir escala ou corte, cruze com get_funil_credito (contrato pago por criativo) e consulte get_conhecimento(tema=otimizacao).", parameters: { type: "object", properties: { days: { type: "number" } } } } },
  { type: "function", function: { name: "get_campaign_detail", description: "Detalhe e serie diaria (14d) de uma campanha pelo nome.", parameters: { type: "object", properties: { name_like: { type: "string" } }, required: ["name_like"] } } },
  { type: "function", function: { name: "get_analise_visual_drive", description: "VEREDITO VISUAL POR PECA das midias do Drive, ja persistido: para cada arquivo, produto detectado PELOS PIXELS da miniatura, texto visivel, risco de compliance e veredito aproveitavel sim/nao/incerto com motivo. USE SEMPRE que o gestor pedir para classificar/avaliar/escolher pecas da pasta - e leitura instantanea de analise ja feita. Se total_analisados < inventario, ha pecas novas sem analise: diga que a classificacao delas exige a analise profunda, nao invente veredito. Os INCERTO (maioria videos - so um frame foi visto) sao a lista curta para conferencia humana.", parameters: { type: "object", properties: {} } } },
  { type: "function", function: { name: "get_drive_criativos", description: "INVENTARIO DA PASTA DE CRIATIVOS NOVOS no Google Drive (somente leitura): caminho (1o nivel=formato, 2o nivel=eixo de mensagem), nome, tipo, data e thumbnail de cada arquivo, com resumo por formato e por eixo. Use para LISTAR o que existe na pasta. Para VEREDITO DE CONTEUDO por peca (aproveitavel ou nao, produto, risco), use get_analise_visual_drive - a classificacao visual ja esta persistida. LIMITES A DECLARAR: leitura de inventario e thumbnail - nao le conteudo interno de video; e CONCEDER permissao de acesso a pessoas segue sendo acao manual no Drive, fora do sistema.", parameters: { type: "object", properties: {} } } },
  { type: "function", function: { name: "get_acervo_para_anuncio", description: "ACERVO DO DRIVE PRONTO PARA VIRAR ANUNCIO NOVO. Esta e a ferramenta certa quando o gestor pede para MONTAR anuncio novo, ESCOLHER peca ou saber quais pecas do acervo servem para um produto - NAO use get_criativos_conteudo para isso (aquela le SO os anuncios ja no ar em public.ads e por isso nunca propoe peca nova). Deduplicada por arquivo e filtravel por produto (ex.: 'CLT'). Por peca: nome, drive_file_id, o que a peca DIZ (o_que_diz_no_audio = transcricao real do video; texto_visivel para imagem), analise visual, se esta na biblioteca da Meta (apta), se esta bloqueada por compliance (bloqueada_por_compliance, SEMPRE marcada quando ha revisao aberta) e se ja foi usada em anuncio antes. Honestidade embutida: produto de video e INFERIDO (produto_fonte); peca sem transcricao vem com transcricao_ausente=true. Antes de emitir o card de uma candidata, ainda leia nota_visual_da_peca.", parameters: { type: "object", properties: { produto: { type: "string", description: "Opcional. Filtra por produto detectado, casa por pedaco insensivel a caso (ex.: 'CLT' acha 'consignado CLT'). Sem este campo devolve o acervo inteiro." }, incluir_inaptas: { type: "boolean", description: "Padrao true: inclui as bloqueadas e as fora da biblioteca, MARCADAS, para nao omitir nada. false = so as aptas agora." } } } } },
  { type: "function", function: { name: "get_funil_credito", description: "FORA DE ESCOPO desde 28/07/2026: CRM/conversao final foram removidos do sistema por decisao da empresa. Esta ferramenta existe so por compatibilidade e devolve um aviso de fora-de-escopo. NAO a chame; se o gestor pedir proposta/contrato/receita, explique a exclusao e ofereca as metricas de midia.", parameters: { type: "object", properties: { dias: { type: "number", description: "janela em dias (default 90). Use a MESMA janela do get_funnel ao comparar." } } } } },
  { type: "function", function: { name: "propose_action", description: "Cria PEDIDO DE APROVACAO (ActionCard). NAO executa nada: o card fica PENDENTE, so um administrador aprova, e expira em 24h se nao for decidido. Exige sempre justificativa (evidencia), metrica_sucesso e reversa. Nunca proponha pausa baseada apenas em custo medio de recorte (veja get_ads_ranking). ACOES SOBRE O QUE JA EXISTE: pausar_criativo, escalar_criativo, pausar_campanha, alterar_orcamento - target_name e o objeto a alterar. ACOES DE CRIACAO: criar_campanha (target_name = NOME da campanha nova; params.objetivo opcional); criar_conjunto_a_partir_de (target_name = nome do conjunto MOLDE que ja funciona; params.nome_novo, params.campanha_destino e params.orcamento_diario_reais OBRIGATORIOS - se o gestor nao informou o orcamento, PERGUNTE, nao invente); criar_anuncio_a_partir_de (target_name = nome do anuncio MOLDE; params.nome_novo, params.utm_campaign e o conjunto que recebe o anuncio OBRIGATORIOS - o conjunto vai em params.conjunto_destino_external_id, e params.conjunto_destino aceita o nome dele quando voce so tem o nome). EXISTEM DOIS PEDIDOS DE ANUNCIO, e eles exigem coisas diferentes: (a) REPLICACAO PURA - escalar para outro conjunto um anuncio que ja funciona; nao passe params.drive_file_id, e a legenda NAO e sua: vem do molde. (b) PECA NOVA do acervo do Drive - passe params.drive_file_id (o id vem de get_drive_criativos ou get_analise_visual_drive, nunca o nome do arquivo), params.legenda e params.legenda_fonte, que e 'humano' se o gestor escreveu, 'herdada_do_molde' se ele autorizou usar o texto do molde, ou 'agente' se voce escreveu - e nesse caso params.legenda_referencias com os anuncios que serviram de base e OBRIGATORIO. So proponha peca nova cujo ja_enviada_para_meta seja true. NAO invente legenda para o pedido passar: se o gestor nao disse de onde vem o texto, PERGUNTE. Tudo que e criado nasce PAUSADO, com categoria especial de credito, e a legenda passa por validacao de compliance que BLOQUEIA a criacao se reprovar. Conjunto e anuncio sao REPLICADOS de um molde existente, nunca montados do zero.", parameters: { type: "object", properties: { action_type: { type: "string", enum: ["pausar_criativo", "escalar_criativo", "pausar_campanha", "alterar_orcamento", "criar_campanha", "criar_conjunto_a_partir_de", "criar_anuncio_a_partir_de"] }, target_name: { type: "string" }, justificativa: { type: "string", description: "EVIDENCIA: metrica + nivel de avaliacao + janela de atribuicao + periodo + fonte" }, mecanismo: { type: "string", description: "por que o sistema produz esse padrao" }, metrica_sucesso: { type: "string", description: "OBRIGATORIO: metrica-alvo e limiar, lidos no funil completo ate contrato pago" }, janela_leitura: { type: "string", description: "janela minima de leitura e data de decisao (minimo 3-4 dias fora da fase de aprendizado)" }, reversa: { type: "string", description: "OBRIGATORIO: como desfazer, quem desfaz e em quanto tempo" }, risco: { type: "string", description: "o que pode piorar e como detectar cedo" }, params: { type: "object", description: "para criacao: nome_novo, campanha_destino OU conjunto_destino, orcamento_diario_reais (obrigatorio no conjunto), utm_campaign (obrigatorio no anuncio), objetivo (opcional na campanha). SO no anuncio com peca nova: drive_file_id, legenda, legenda_fonte ('humano' | 'herdada_do_molde' | 'agente') e legenda_referencias (array, obrigatorio quando a fonte e 'agente')" } }, required: ["action_type", "target_name", "justificativa", "metrica_sucesso", "reversa"] } } },
  { type: "function", function: { name: "check_compliance", description: "GUARDIAO DE COMPLIANCE: valida legenda e/ou criativo contra base de regras versionada.", parameters: { type: "object", properties: { legenda: { type: "string" } } } } },
  { type: "function", function: { name: "get_criativos_conteudo", description: "CONTEUDO REAL DOS ANUNCIOS ja coletado pelo sync: legenda (texto do anuncio), titulo, CTA, se tem imagem, gasto acumulado, formularios e status. Use para auditar compliance das pecas EM OPERACAO sem pedir o texto ao usuario (pegue a legenda aqui e passe para check_compliance), e para qualquer pergunta sobre o que os anuncios dizem. Pode vir truncado: leia os campos exibidos/omitidos/aviso_corte e nunca trate item omitido como inexistente. PARA ACHAR UM ANUNCIO ESPECIFICO use busca_nome em vez de folhear: sao 67 anuncios, a lista completa vem cortada, e o que voce procura pode estar justamente no pedaco omitido - foi assim que anuncio existente passou por inexistente. Com busca_nome o retorno traz total_que_casam_com_a_busca, e SO se ele for zero o anuncio realmente nao existe.", parameters: { type: "object", properties: { somente_ativas: { type: "boolean", description: "true (recomendado) = so criativos em campanha ativa; false = historico completo, payload maior e mais truncado. COM busca_nome o default ja e false, porque anuncio procurado pelo nome quase sempre esta pausado - nao passe true junto de busca_nome sem motivo, senao a busca pode devolver zero para peca que existe." }, busca_nome: { type: "string", description: "Parte do nome do anuncio. Insensivel a maiusculas e casa por pedaco: 'reel02' acha 'AD_LPV2_A1_Reel02'. Devolve os itens com legenda inteira, creative_id e external_id - e e o caminho certo para achar o MOLDE antes de propor criar_anuncio_a_partir_de. Sem este campo vem a listagem completa com legendas_unicas (dedupe para auditoria de compliance do acervo)." }, pagina: { type: "integer", description: "So com busca_nome. Comeca em 1, 20 itens por pagina; leia 'restantes' para saber se ha mais." } } } } },
  { type: "function", function: { name: "get_conhecimento", description: "BASE DE CONHECIMENTO TECNICA consultavel: politicas da Meta e compliance financeiro no Brasil, atlas de metricas com linha do tempo historica, criacao e edicao de campanha/conjunto/anuncio, otimizacao e diagnostico (Breakdown Effect, fase de aprendizado, fadiga, gates de escala), operacao da Marketing API, unidade economica e analise critica, e biblioteca de criativo (formatos visuais, taticas de hook, mecanicas, padroes de voz). Use SEMPRE que a pergunta for conceitual, de politica, de metodo, de definicao de metrica, ou quando precisar propor/auditar criativo com fundamento. Os temas disponiveis estao listados no seu contexto. Se o tema for extenso, o retorno vem parcial com o indice das secoes: chame de novo com o parametro 'secao' para ler o resto.", parameters: { type: "object", properties: { tema: { type: "string", description: "o tema exato, conforme a lista no seu contexto" }, secao: { type: "string", description: "opcional: titulo (ou parte) de uma secao especifica do tema" } }, required: ["tema"] } } },
  { type: "function", function: { name: "get_estrutura_conjuntos", description: "ESTRUTURA DOS CONJUNTOS desta empresa: nome, status, estrategia de lance, orcamento (no conjunto = ABO, na campanha = CBO), segmentacao com pais, faixa de idade, interesses e PUBLICOS PERSONALIZADOS, gasto e formularios. Vem PAGINADO em 20 por vez, ordenado por gasto. Se o campo 'restantes' vier maior que zero, chame de novo com a pagina seguinte ANTES de concluir qualquer coisa sobre o conjunto de conjuntos - e NUNCA afirme percentual sobre o total a partir de uma pagina so. NAO contem historico de ALTERACOES de orcamento (exigiria o endpoint /activities da Graph).", parameters: { type: "object", properties: { pagina: { type: "number", description: "Pagina, comecando em 1. Use a seguinte enquanto 'restantes' for maior que zero." } } } } },
  { type: "function", function: { name: "get_aprovacoes", description: "FILA REAL DE PEDIDOS DE APROVACAO desta empresa, direto do banco: o que esta aguardando decisao, o que foi aprovado, o que JA FOI EXECUTADO na Meta (com o identificador do objeto criado), o que falhou e QUAL erro a plataforma devolveu. USE SEMPRE que o gestor perguntar o estado de um card, se algo foi criado, se a aprovacao surtiu efeito, ou o que esta pendente - e use ANTES de afirmar qualquer coisa sobre o estado de um pedido. Se um pedido nao aparece nesta lista, ele nao existe.", parameters: { type: "object", properties: { apenas_abertos: { type: "boolean", description: "true (recomendado) = somente pendentes e aprovados; false = ultimos 25 de qualquer situacao, incluindo executados e recusados." } } } } },
];

// v24: leitura da base de conhecimento com corte por SECAO. Um tema pode ter 31 mil chars
// (formatos visuais), muito acima do teto de payload de uma ferramenta. Cortar markdown por
// bytes destroi a estrutura, entao dividimos por titulo de nivel 2 e entregamos secao a
// secao, declarando o indice do que ficou de fora.
const TETO_CONHECIMENTO = 10000;
function dividirSecoes(md: string): { titulo: string; corpo: string }[] {
  const linhas = md.split("\n");
  const out: { titulo: string; corpo: string }[] = [];
  let tituloAtual = "(inicio)";
  let buffer: string[] = [];
  for (const l of linhas) {
    if (/^##\s+/.test(l)) {
      if (buffer.length) out.push({ titulo: tituloAtual, corpo: buffer.join("\n").trim() });
      tituloAtual = l.replace(/^#+\s*/, "").trim();
      buffer = [];
    } else buffer.push(l);
  }
  if (buffer.length) out.push({ titulo: tituloAtual, corpo: buffer.join("\n").trim() });
  return out.filter((s) => s.corpo.length > 0);
}
async function t_conhecimento(tema: string, secao?: string) {
  if (!tema) return { erro: "informe o tema. Os temas disponiveis estao listados no seu contexto." };
  const { data, error } = await supa.from("agent_knowledge")
    .select("tema,descricao,conteudo,fonte,verificado_em,revalidar_ate")
    .eq("vigente", true).eq("tema", tema.trim().toLowerCase()).maybeSingle();
  if (error) return { erro: `falha ao ler conhecimento: ${error.message}` };
  if (!data) return { erro: `tema '${tema}' nao encontrado. Use exatamente um dos temas listados no seu contexto.` };

  // Protocolo de evolucao: conteudo vencido nao pode ser afirmado como atual.
  const hoje = new Date().toISOString().slice(0, 10);
  const vencido = data.revalidar_ate ? String(data.revalidar_ate) < hoje : false;
  const meta: Record<string, unknown> = {
    tema: data.tema, verificado_em: data.verificado_em, revalidar_ate: data.revalidar_ate,
    fonte: data.fonte,
  };
  if (vencido) {
    meta.aviso_validade = "Este conhecimento passou do prazo de revalidacao. Trate como NAO CONFIRMADO: pode citar como referencia, mas declare ao gestor que precisa ser reverificado na fonte oficial antes de virar decisao.";
  }

  const conteudo = String(data.conteudo ?? "");
  const secoes = dividirSecoes(conteudo);

  if (secao) {
    const alvo = norm(secao);
    const hit = secoes.find((x) => norm(x.titulo).includes(alvo));
    if (!hit) return { ...meta, erro: `secao '${secao}' nao encontrada`, secoes_disponiveis: secoes.map((x) => x.titulo) };
    return { ...meta, secao: hit.titulo, conteudo: hit.corpo.slice(0, TETO_CONHECIMENTO) };
  }

  if (conteudo.length <= TETO_CONHECIMENTO) return { ...meta, conteudo };

  // Grande demais: entrega o que couber e o indice do restante.
  const entregues: string[] = [];
  let usados = 0;
  for (const sx of secoes) {
    const bloco = `## ${sx.titulo}\n${sx.corpo}`;
    if (usados + bloco.length > TETO_CONHECIMENTO) break;
    entregues.push(bloco); usados += bloco.length;
  }
  const nEntregues = entregues.length;
  return { ...meta,
    conteudo: entregues.join("\n\n"),
    secoes_entregues: secoes.slice(0, nEntregues).map((x) => x.titulo),
    secoes_nao_entregues: secoes.slice(nEntregues).map((x) => x.titulo),
    instrucao: nEntregues < secoes.length
      ? "Este tema e extenso e veio parcial. As secoes listadas em secoes_nao_entregues EXISTEM - para le-las, chame de novo informando o parametro 'secao'. Nao conclua que o assunto nao esta coberto."
      : undefined };
}

// v22: prioridade de ferramentas dentro de um mesmo lote. O teto por turno e necessario
// (14 tools/turno estouravam tempo e tokens), mas cortar por ordem de chegada fazia o
// pedido perder justamente o que foi pedido. Aqui a ordem depende do que o gestor pediu:
// menor numero = executa antes = sobrevive ao teto.
function prioridadeTool(nome: string, pedido: string): number {
  const p = norm(pedido);
  const pedeCriativo = /criativ|legenda|compliance|anuncio|peca|texto|copy|oferta/.test(p);
  const pedeReceita = /receita|contrato|cac|retorno|vende|vendas|funil|proposta|lucro/.test(p);
  const pedeEstrutura = /cbo|abo|conjunto|estrutura|publico|targeting|lance|orcamento/.test(p);
  const pedeUtm = /utm|teste a\/b|teste a b|teste abc|teste a\/b\/c|variante|rastreio|rotulo/.test(p);
  const pedeCustoLlm = /custo.*agente|agente.*cust|custo.*llm|token/.test(p);
  const pedeSaudeIntegracao = /conta.*conect|integrac|trazendo dado|coletor/.test(p);
  const pedeTeto = /teto|regua|meta de custo|escal|vencedor/.test(p);
  const pedeConhecimento = /como funciona|por que|explique|conceito|politica|regra da meta|categoria especial|hook|formato|fadiga|aprendizado|learning|breakdown|metrica|historic|sazonal|sugira|briefing/.test(p);
  // v28.6: pergunta sobre estado de card/aprovacao/criacao tem prioridade MAXIMA. Era
  // justamente esse tipo de pergunta que o agente respondia de cabeca por nao ter a fila.
  const pedeFila = /card|aprova|pendente|aprovado|criou|criad|emiti|executou|executad|fila|sino|notificac|subiu|apareceu/.test(p);
  if (pedeFila && nome === "get_aprovacoes") return 0;
  if (pedeUtm && nome === "panorama_utm_anuncios") return 0;
  if (pedeCustoLlm && nome === "custo_llm_periodo") return 0;
  if (pedeSaudeIntegracao && nome === "saude_das_integracoes") return 0;
  if (pedeTeto && nome === "teto_vigente") return 0;
  if (pedeConhecimento && nome === "get_conhecimento") return 0;
  if (pedeCriativo && (nome === "get_acervo_para_anuncio" || nome === "get_criativos_conteudo" || nome === "check_compliance" || nome === "checar_par_texto_e_peca" || nome === "nota_visual_da_peca")) return 0;
  if (pedeReceita && nome === "get_funil_credito") return 0;
  if (pedeEstrutura && nome === "get_estrutura_conjuntos") return 0;
  const base: Record<string, number> = {
    get_aprovacoes: 1, propose_action: 1, get_overview: 2, get_funil_credito: 3, get_alerts: 4,
    get_criativos_conteudo: 5, check_compliance: 6, get_funnel: 7, get_ads_ranking: 8,
    teto_vigente: 2, checar_par_texto_e_peca: 2, custo_llm_periodo: 2, panorama_utm_anuncios: 2,
    nota_visual_da_peca: 3, saude_das_integracoes: 3, get_acervo_para_anuncio: 3,
    get_estrutura_conjuntos: 9, get_conhecimento: 9, get_recommendations: 11,
  };
  return base[nome] ?? 12;
}

// ============================================================================
// v28.1 - GOOGLE DRIVE (service account, somente leitura) - identico ao do job v2
// ============================================================================
let _driveToken: { token: string; exp: number } | null = null;
function _pemParaDer(pem: string): ArrayBuffer {
  const b64 = pem.replace(/-----[^-]+-----/g, "").replace(/\s+/g, "");
  const bin = atob(b64);
  const buf = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) buf[i] = bin.charCodeAt(i);
  return buf.buffer;
}
function _b64url(dados: Uint8Array | string): string {
  const bin = typeof dados === "string" ? dados : String.fromCharCode(...dados);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
async function driveToken(): Promise<string> {
  if (_driveToken && _driveToken.exp > Date.now() + 60_000) return _driveToken.token;
  if (!GOOGLE_SA_KEY_B64) throw new Error("credencial do Drive nao configurada (GOOGLE_SA_KEY_B64)");
  const sa = JSON.parse(atob(GOOGLE_SA_KEY_B64));
  const agora = Math.floor(Date.now() / 1000);
  const header = _b64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const claims = _b64url(JSON.stringify({
    iss: sa.client_email, scope: "https://www.googleapis.com/auth/drive.readonly",
    aud: "https://oauth2.googleapis.com/token", iat: agora, exp: agora + 3600 }));
  const chave = await crypto.subtle.importKey("pkcs8", _pemParaDer(sa.private_key),
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["sign"]);
  const assinatura = new Uint8Array(await crypto.subtle.sign("RSASSA-PKCS1-v1_5", chave,
    new TextEncoder().encode(`${header}.${claims}`)));
  const jwt = `${header}.${claims}.${_b64url(assinatura)}`;
  const resp = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" },
    body: `grant_type=${encodeURIComponent("urn:ietf:params:oauth:grant-type:jwt-bearer")}&assertion=${jwt}` });
  const j = await resp.json();
  if (!resp.ok || !j.access_token) throw new Error(`falha no token do Drive: ${JSON.stringify(j).slice(0, 200)}`);
  _driveToken = { token: j.access_token, exp: Date.now() + (Number(j.expires_in ?? 3600) - 120) * 1000 };
  return _driveToken.token;
}
async function t_drive_criativos() {
  if (!DRIVE_CRIATIVOS_FOLDER_ID) return { erro: "pasta de criativos nao configurada (DRIVE_CRIATIVOS_FOLDER_ID)" };
  let token: string;
  try { token = await driveToken(); }
  catch (e) { return { erro: String((e as any)?.message ?? e), aviso: "Sem acesso ao Drive nesta rodada - o dado NAO foi lido; nao trate como pasta vazia." }; }
  const MAX_PASTAS = 40, MAX_ARQUIVOS = 250, MAX_PROFUNDIDADE = 4;
  type No = { id: string; caminho: string; nivel: number };
  const fila: No[] = [{ id: DRIVE_CRIATIVOS_FOLDER_ID, caminho: "", nivel: 0 }];
  const arquivos: any[] = [];
  let pastasLidas = 0, cortado = false;
  while (fila.length) {
    const no = fila.shift()!;
    if (pastasLidas >= MAX_PASTAS || arquivos.length >= MAX_ARQUIVOS) { cortado = true; break; }
    pastasLidas++;
    let pageToken = "";
    do {
      const url = new URL("https://www.googleapis.com/drive/v3/files");
      url.searchParams.set("q", `'${no.id}' in parents and trashed=false`);
      url.searchParams.set("fields", "nextPageToken,files(id,name,mimeType,size,modifiedTime,thumbnailLink)");
      url.searchParams.set("pageSize", "100");
      url.searchParams.set("supportsAllDrives", "true");
      url.searchParams.set("includeItemsFromAllDrives", "true");
      if (pageToken) url.searchParams.set("pageToken", pageToken);
      const r = await fetch(url, { headers: { authorization: `Bearer ${token}` } });
      const j = await r.json();
      if (!r.ok) return { erro: `Drive respondeu ${r.status}`, detalhe: JSON.stringify(j).slice(0, 200) };
      for (const f of j.files ?? []) {
        if (f.mimeType === "application/vnd.google-apps.folder") {
          if (no.nivel + 1 <= MAX_PROFUNDIDADE) fila.push({ id: f.id, caminho: no.caminho ? `${no.caminho}/${f.name}` : f.name, nivel: no.nivel + 1 });
        } else if (arquivos.length < MAX_ARQUIVOS) {
          // v28.10 (GT-13): o drive_file_id era lido do Drive e descartado aqui. Sem ele o agente
          // sabia dizer "o video tal e o melhor" e nao sabia dizer QUAL ARQUIVO - logo nao havia
          // como pedir anuncio com aquela peca. E o unico identificador estavel: nome repete.
          arquivos.push({ drive_file_id: f.id, nome: f.name, caminho: no.caminho || "(raiz)",
            formato_pasta: (no.caminho.split("/")[0] || "(raiz)"),
            eixo_pasta: (no.caminho.split("/")[1] ?? null),
            tipo: f.mimeType, tamanho_bytes: Number(f.size ?? 0) || null,
            modificado_em: f.modifiedTime ?? null, thumbnail: f.thumbnailLink ?? null });
        } else { cortado = true; }
      }
      pageToken = j.nextPageToken ?? "";
    } while (pageToken && arquivos.length < MAX_ARQUIVOS);
  }
  const porFormato: Record<string, number> = {};
  const porEixo: Record<string, number> = {};
  for (const a of arquivos) {
    porFormato[a.formato_pasta] = (porFormato[a.formato_pasta] ?? 0) + 1;
    if (a.eixo_pasta) porEixo[a.eixo_pasta] = (porEixo[a.eixo_pasta] ?? 0) + 1;
  }
  const out: any = {
    total_arquivos: arquivos.length, pastas_lidas: pastasLidas,
    resumo_por_formato: porFormato, resumo_por_eixo_de_mensagem: porEixo,
    nota: "Inventario da pasta de criativos do Drive (somente leitura). 1o nivel do caminho = formato, 2o nivel = eixo de mensagem. LIMITE: video e analisado por thumbnail+nome+caminho, nao pelo conteudo interno.",
    arquivos,
  };
  if (cortado) out.aviso_corte = `Inventario truncado nos tetos (${MAX_PASTAS} pastas / ${MAX_ARQUIVOS} arquivos). O que nao veio EXISTE - nao trate como inexistente.`;
  return out;
}

async function runTool(name: string, args: any, ctx: any) {
  try {
    switch (name) {
      case "get_overview": return await t_overview(ctx.companyId);
      case "get_alerts": return await t_alerts(ctx.companyId);
      case "get_recommendations": return await t_recos(ctx.companyId);
      case "teto_vigente": return await t_rpc("teto_vigente", { p_company_id: ctx.companyId, p_metric: String(args?.metric ?? "") });
      case "checar_par_texto_e_peca": return await t_rpc("checar_par_texto_e_peca", { p_company_id: ctx.companyId, p_legenda: String(args?.legenda ?? ""), p_drive_file_id: String(args?.drive_file_id ?? "") });
      case "saude_das_integracoes": return await t_rpc("saude_das_integracoes", { p_company_id: ctx.companyId, p_dias_tolerancia: Number(args?.dias_tolerancia ?? 3) });
      case "custo_llm_periodo": return await t_rpc("custo_llm_periodo", { p_company_id: ctx.companyId, p_de: String(args?.de ?? ""), p_ate: String(args?.ate ?? "") });
      case "panorama_utm_anuncios": return await t_rpc("panorama_utm_anuncios", { p_company_id: ctx.companyId });
      case "nota_visual_da_peca": return await t_rpc("nota_visual_da_peca", { p_company_id: ctx.companyId, p_drive_file_id: String(args?.drive_file_id ?? "") });
      case "registrar_veredito_peca_em_revisao": return await t_rpc("registrar_veredito_peca_em_revisao", {
        p_company_id: ctx.companyId,
        p_drive_file_id: String(args?.drive_file_id ?? ""),
        p_veredito: String(args?.veredito ?? ""),
        p_veredito_por: args?.veredito_por == null || String(args.veredito_por).trim() === "" ? null : String(args.veredito_por),
        p_nota: args?.nota == null || String(args.nota).trim() === "" ? null : String(args.nota),
        // A RPC exige solicitante: proposta sem dono nao e proposta. Vem do usuario da conversa.
        p_solicitado_por: ctx.requestedBy,
        p_conversation_id: ctx.convId,
      });
      case "diagnosticar_custo": return await t_rpc("diagnosticar_custo", { p_company_id: ctx.companyId, p_ad_external_id: String(args?.ad_external_id ?? "") });
      case "avaliar_fadiga": return await t_rpc("avaliar_fadiga", { p_company_id: ctx.companyId, p_ad_external_id: String(args?.ad_external_id ?? "") });
      case "pode_pausar_por_custo": return await t_rpc("pode_pausar_por_custo", { p_company_id: ctx.companyId, p_ad_external_id: String(args?.ad_external_id ?? "") });
      case "decidir_sobre_conjunto": return await t_rpc("decidir_sobre_conjunto", { p_company_id: ctx.companyId, p_adset_external_id: String(args?.adset_external_id ?? "") });
      case "avaliar_escala": return await t_rpc("avaliar_escala", { p_company_id: ctx.companyId, p_adset_external_id: String(args?.adset_external_id ?? "") });
      case "avaliar_pacing": return await t_rpc("avaliar_pacing", { p_company_id: ctx.companyId, p_meta_leads_dia: args?.meta_leads_dia == null ? null : Number(args.meta_leads_dia) });
      case "validar_pedido_contra_contrato": return await t_rpc("validar_pedido_contra_contrato", { p_acao: String(args?.acao ?? ""), p_pedido: args?.pedido ?? {} });
      case "get_funnel": return await t_funnel(ctx.companyId, args?.date_from, args?.date_to);
      case "get_ads_ranking": return await t_ads_ranking(ctx.companyId, Number(args?.days ?? 7));
      case "get_campaign_detail": return await t_campaign_detail(ctx.companyId, String(args?.name_like ?? ""));
      case "get_funil_credito": return await t_funil_credito(Number(args?.dias ?? 90));
      case "propose_action": {
        const at = String(args?.action_type ?? "");
        if (ACOES_CRIACAO.includes(at)) return await t_propose_criacao(ctx.companyId, ctx.convId, ctx.requestedBy, args, ctx.cards, ctx.mcpKey);
        return await t_propose_action(ctx.companyId, ctx.convId, ctx.requestedBy, args, ctx.cards);
      }
      case "check_compliance": return await t_check_compliance(String(args?.legenda ?? "").trim(), ctx.imgAtts, ctx.mcpKey);
      case "get_criativos_conteudo": {
        const buscaNome = String(args?.busca_nome ?? "").trim();
        // v28.11: COM BUSCA, o default de somente_ativas inverte para false. Medido: 'Reel02' com
        // true devolve 0 e com false devolve 2 - e esses dois sao justamente os unicos moldes de
        // video que expoem object_story_spec, ou seja, os unicos que servem para o GT-13. Herdar o
        // default true aqui faria o agente buscar o molde, receber zero, e ler na mensagem da
        // propria RPC que "zero significa que o anuncio nao existe" - uma negativa ERRADA e ainda
        // por cima autorizada. Quem procura um anuncio pelo nome procura no acervo, nao no que
        // esta entregando hoje. Passar somente_ativas explicitamente continua valendo.
        const informouAtivas = typeof args?.somente_ativas === "boolean";
        const somenteAtivas = informouAtivas ? args.somente_ativas === true : !buscaNome;
        return await t_criativos_conteudo(somenteAtivas, ctx.companyId, buscaNome, Number(args?.pagina ?? 1));
      }
      case "get_drive_criativos": return await t_drive_criativos();
      case "get_analise_visual_drive": {
        const { data, error } = await supa.rpc("get_drive_analises", { p_company_id: ctx.companyId });
        return error ? { erro: error.message } : data;
      }
      case "get_acervo_para_anuncio": {
        const produto = String(args?.produto ?? "").trim();
        const { data, error } = await supa.rpc("get_acervo_para_anuncio", {
          p_company_id: ctx.companyId,
          p_produto: produto || null,
          p_incluir_inaptas: args?.incluir_inaptas === false ? false : true,
        });
        return error ? { erro: error.message } : data;
      }
      case "get_estrutura_conjuntos":
        return await t_estrutura_conjuntos(ctx.companyId, Number(args?.pagina ?? 1));
      case "get_aprovacoes": return await t_aprovacoes(ctx.companyId, args?.apenas_abertos === false ? false : true);
      case "get_conhecimento": return await t_conhecimento(String(args?.tema ?? ""), args?.secao ? String(args.secao) : undefined);
      default: return { erro: `tool desconhecida: ${name}` };
    }
  } catch (e) { return { erro: String((e as any)?.message ?? e) }; }
}

function systemPrompt(companyName: string, memoria: string, estilo: string, indiceConhecimento: string) {
  return `Voce e o Gestor de Trafego IA da ${companyName}. Hoje e ${today()}. Responde ao gestor (Roberto) em portugues brasileiro.

== QUEM VOCE E ==
Voce nao e um assistente que responde perguntas: e o profissional responsavel por onde o dinheiro de midia e colocado e por que. A conversa e entre pares - sem didatismo, sem entusiasmo de vendedor, sem se desculpar por dar ma noticia. Sua missao: captar mais e melhor pelo menor custo sustentavel - SEM comprar volume barato que nao vira negocio, SEM arriscar a conta de anuncios, SEM queimar os numeros de WhatsApp, SEM degradar pagina e perfil (ativo organico e infraestrutura de midia - ja houve conta com ~R$94 mil gastos derrubada por propagacao de restricao do organico) e SEM transformar base sem consentimento em publico.

== HIERARQUIA DE PRIORIDADES (quando duas coisas boas se contradizem, esta ordem decide) ==
1. Nao causar dano irreversivel: conta de anuncios, qualidade de numero de WhatsApp, ativo organico, exposicao regulatoria.
2. Verdade sobre o dado: lacuna declarada vale mais que numero bonito - e declarar lacuna onde NAO ha lacuna tambem e dano (confira antes de dizer "nao temos").
3. Proteger o custo: teto resolvido por teto_vigente (meta de negocio governa quando existir; historico e apenas consistencia), protecao de custo no conjunto, gasto sob controle.
4. Volume e escala - depois das tres acima.
5. Elegancia da analise - nunca acima de nenhuma.

== DOUTRINA DE DECISAO ==
- DIGA DE QUEM FALA: empresa e categoria regulatoria antes do nivel (conta/campanha/conjunto/anuncio). Doutrina de credito NAO se aplica a empresa que nao e de credito. NUNCA compare empresas de categorias distintas.
- Toda recomendacao tem 5 partes: evidencia (numero+janela), mecanismo, criterio de sucesso, prazo de leitura e REVERSA. Sem reversa, nao sai.
- Uma decisao por leitura. Escolha a janela ANTES de olhar o resultado; se duas janelas discordam, mostre as duas e diga qual decide.
- Sazonalidade: a Legal anuncia consignado INSS E consignado CLT - calendarios diferentes. Declare o produto da campanha antes de invocar sazonalidade; produto nao identificado = nao invoque.
- Voce nao e o unico ator: antes de atribuir causa a criativo/publico, verifique o historico de alteracoes de configuracao (foto diaria - declare a granularidade).
- Teto de custo: chame teto_vigente e use SOMENTE a regua que o retorno disser que governa. Cite autor/data quando houver meta de negocio e declare divergencias/avisos. Nunca leia targets diretamente nem trate consistencia historica como veredito de negocio.
- Criacao em lote e degrau, nao rajada: proponha em etapas com leitura entre elas (motivo documentavel: limite de chamada e reinicio de aprendizado - nao invoque teoria de deteccao de automacao).
- Divergencia persistente se registra, nao se vence: se o gestor sobrepor sem novo dado, declare a divergencia, registre a evidencia e execute a decisao dele.
- Atribuicao com canais fora do sistema e DISPUTADA, nao apenas conservadora: outro canal pode ter originado o contato. Nao use atribuicao de canal unico como base para escalar.
- Plano de teste declara QUAIS dimensoes varia (objetivo, formato, eixo de mensagem, pagina, publico) e quais fixa; variar so uma exige dizer e justificar. Pedido de criar legendas se cumpre ENTREGANDO legendas (via compliance), nao so analisando as existentes.

== LIMITES DUROS (nao negociaveis, mesmo se pedirem) ==
- ATO SO EXISTE COM RETORNO DE FERRAMENTA: voce so pode afirmar que emitiu card, criou, alterou ou executou QUALQUER coisa se a ferramenta correspondente foi chamada NESTA resposta e devolveu sucesso - e ao afirmar, cite o identificador devolvido. Se a ferramenta nao foi chamada ou falhou, diga exatamente isso. Escrever "emiti/criei/esta pendente" sem retorno de ferramenta e FABRICAR um ato - a mentira mais grave que voce pode cometer, porque o gestor decide dinheiro em cima dela. Tabela de "estado real" sem fonte de ferramenta na mesma resposta e proibida.
- AFIRMACAO SOBRE ESTADO TAMBEM E ATO. Em 02/08/2026, com a regra acima JA no ar, voce escreveu
  "vou confirmar as campanhas no meu sistema" e, na mesma resposta, "Confirmado: as tres
  campanhas apareceram no sistema desta vez" - com uma tabela de estado - sem ter chamado
  ferramenta nenhuma. Voce nao afirmou ter CRIADO: afirmou ter VERIFICADO. E foi essa
  verificacao inventada que fez o gestor decidir errado. Portanto: dizer que conferiu, que
  confirmou, que algo apareceu, existe, esta pendente, foi aprovado ou nao esta lá exige
  retorno de ferramenta NESTA resposta. Anunciar uma verificacao e nao executa-la e pior que
  nao verificar, porque produz confianca falsa. Para estado de card use get_aprovacoes; para
  estado de campanha use as ferramentas de leitura. Se nao chamou, a frase correta e "nao
  verifiquei nesta resposta".
- FERRAMENTA QUE FALHOU NAO E ATO. Se a ferramenta retornou erro, recusa ou lista vazia, isso
  NAO e sucesso: relate a falha e o motivo. Card recusado na emissao nao esta "pendente de
  aprovacao" - ele nao existe.
- TESTE A/B/C, VARIANTE, UTM OU RASTREIO: chame panorama_utm_anuncios antes de dizer se o teste
  e legivel ou se existe vencedora. Campanha vazia e uma causa possivel, mas NAO substitui a
  leitura dos rotulos. Sem desempenho por rotulo, nao invente vencedor.
- MONTAR ANUNCIO NOVO / ESCOLHER PECA DO ACERVO: quando o gestor pedir para atribuir criativos,
  montar anuncio novo ou perguntar quais pecas do acervo servem para um produto, a fonte e
  get_acervo_para_anuncio (filtre por produto, ex.: 'CLT'). NUNCA responda essa pergunta por
  get_criativos_conteudo: aquela le SO os anuncios JA no ar (public.ads) e por isso arrasta o
  gestor a repetir criativo em uso (foi o que aconteceu em 07/08, quando o R06 ja no ar foi
  proposto no lugar de peca nova do acervo). get_acervo_para_anuncio devolve o que esta apto a
  VIRAR anuncio: pecas do Drive na biblioteca da Meta, com o que cada uma diz (transcricao),
  bloqueio de compliance MARCADO e se ja foi usada antes. Peca do acervo NAO tem metrica por
  definicao - nao a compare com anuncio em operacao nem a preterira por "lastro".
- PECA ESPECIFICA DO DRIVE: antes de recomendar, classificar ou listar uma peca como candidata,
  chame nota_visual_da_peca com o drive_file_id atual (o id vem de get_acervo_para_anuncio ou
  get_analise_visual_drive). get_analise_visual_drive serve para inventario/triagem; nao autoriza
  repetir classificacao antiga. Se nao houver espaco para ler as notas das candidatas, nao
  recomende nenhuma pelo nome. Em especial, nunca recomende o video 19 sem sua nota vigente, que
  declara aparencia de credito empresarial e incerteza.
- COMPLIANCE DE LEGENDA + PECA: existe caminho conjunto e ele e checar_par_texto_e_peca. Quando
  legenda e drive_file_id estiverem disponiveis, chame-o e repasse cobertura/lacunas; nunca diga
  que o par nao e avaliado. Se um dos dois nao veio, peca o dado faltante sem negar a capacidade.
- VEREDITO DE PECA EM REVISAO: voce PROPOE, nao decide. registrar_veredito_peca_em_revisao emite um
  CARD que so o administrador aprova; enquanto isso a peca segue impedida. Nunca diga que liberou uma
  peca: diga que emitiu proposta e que a decisao e do responsavel. A assinatura do veredito e de quem
  aprovar, nao o nome que voce informar. Nunca UPDATE a mao. Em 10/08/2026 um subagente escreveu
  veredito direto assinando com o nome do fundador e liberou 5 pecas do FIN-04 sem decisao dele: essa
  porta foi fechada por isso, e o caminho de proposta e o unico que existe.
- Voce nao gasta nem publica por conta propria: toda acao real passa por card aprovado por humano, e as travas por acao sao dele. CONTRATO VIGENTE DESDE 03/08/2026: aprovar o card CRIA o objeto na Meta, PAUSADO - e a criacao NAO inicia entrega nem gasto. A ativacao e um SEGUNDO ATO, MANUAL, do gestor no Gerenciador, para ele conferir a arvore inteira antes de qualquer verba sair. Diga isso com todas as letras ao propor: aprovar cria e nao gasta; quem liga a entrega e ele. Entre 31/07 e 03/08 vigorou o contrato oposto (aprovar = ativar) - se voce encontrar texto afirmando isso, esta VENCIDO. Voce continua sem nenhum caminho para ativar, pausar ou gastar sem card aprovado. Trava fechada = explique o que falta e entregue o plano; nunca contorne.
- Categoria especial (Produtos e servicos financeiros, a antiga Credito): nas campanhas criadas PELO SISTEMA ela e GRAVADA por construcao na criacao - diga isso. Nas campanhas antigas ou criadas fora, o campo nao e coletado e a conferencia continua humana, no Gerenciador. Nunca afirme conformidade de campanha que o sistema nao criou.
- Conta em quarentena e somente leitura e VENCE a flag da empresa. Conta sem dono declarado nao existe para voce. Conta nao operacional (nunca teve campanha/gasto) e invisivel para analise.
- Base/lista sem procedencia de consentimento declarada: a proposta de publico NAO sai (pergunte origem e base legal; consulte o tema base_legal_lista).
- Nao prometa resultado; nao trate lead como contrato; nao chame CPL de lucro.
- Fora do escopo: politica de credito, esteira, atendimento humano, produto, e plataformas alem da Meta (nao ha dado de nenhuma outra).
- Nunca fale de implementacao (nome de funcao, versao, tabela, token, limite de chamada) - traduza para linguagem de negocio.

== ESCOPO (limite rigido) ==
Voce cuida EXCLUSIVAMENTE de TRAFEGO PAGO: midia, criativo, publico, orcamento, custo, atribuicao e a conversao final que prova se o trafego comprado virou negocio.
CRM/Dash, proposta e contrato SAIRAM do escopo do sistema em 28/07/2026 por decisao da Legal: nao existe fonte de conversao final aqui, e voce NAO busca esse dado por nenhuma via. Consequencia declarada: voce otimiza CPL como PROXY e diz isso.
ESTA FORA DO SEU ESCOPO e voce NAO comenta, analisa nem recomenda: relacao com bancos, roteamento de propostas, esteira interna, politica de credito, operacao de atendimento humano, margem por banco, processos internos. Se perguntarem, responda que isso e tratado internamente pela Legal e siga para o que e trafego.

== PROTOCOLO OBRIGATORIO ANTES DE RESPONDER ==
1. PLANEJE: identifique o que a pergunta exige e QUAIS tools trazem cada parte. Prefira chamar as tools necessarias na MESMA rodada.
2. COLETE: rode as tools. Nunca responda de memoria sobre numeros - so o que a tool devolveu nesta conversa vale como dado.
3. CONFIRA cada numero antes de escrever: (a) de qual tool veio? (b) qual periodo exato? (c) a cobertura de dados cobre esse periodo inteiro (campos dias_com_dado / cobertura_real / cobertura)? (d) o denominador e estavel ou esta em ingestao?
4. SEGMENTE antes de concluir tendencia: medias historicas escondem mudancas. Se houver serie por mes (ex.: atribuicao.por_mes), leia o mes mais recente, nao a media.
5. RESPONDA com numero + fonte + ressalva. Se algo nao fecha, diga que nao fecha em vez de escolher a versao mais bonita.

== REGRAS ANTI-ALUCINACAO (nao negociaveis) ==
R1. Todo NUMERO DESTA CONTA (gasto, leads, propostas, contratos, custos, datas, quantidades) precisa ter vindo de uma consulta feita NESTE turno OU de um bloco "[RETORNOS DE FERRAMENTA JA APURADOS EM ...]" do historico - esse bloco e o registro literal do que a ferramenta devolveu numa rodada anterior desta MESMA conversa, reinjetado pelo sistema, e vale como consulta (cite a data que ele traz). Nunca diga que nao conseguiu consultar algo cujo retorno esta nesse bloco: se esta la, foi consultado. O que o bloco NAO cobre e ATO e ESTADO ATUAL - ver os dois limites duros acima. Se nao veio, escreva "nao disponivel" e diga o que precisaria ser integrado. NUNCA estime, arredonde de cabeca ou complete lacuna com plausibilidade. Se um numero que voce lembra divergir do que a consulta devolveu, A CONSULTA ESTA CERTA - use o dado dela e nao anuncie correcao.
R1b. CONHECIMENTO DE PLATAFORMA NAO E NUMERO DESTA CONTA. Perguntas conceituais - o que a Categoria Especial de Credito restringe, o que e fadiga de criativo, qual a diferenca entre CBO e ABO, por que otimizar para o evento errado distorce a entrega, o que caracteriza promessa enganosa - voce RESPONDE com seu conhecimento de Meta Ads, de forma tecnica e completa. Nao diga "nao disponivel" para pergunta de conhecimento: isso e o oposto do que se espera de um gestor senior. Separe visivelmente as duas coisas: conhecimento de plataforma e uma explicacao; dado desta conta vem com numero e fonte. Quando faltar o dado para confirmar como ESTA CONTA esta configurada, entregue o conceito e diga que a verificacao exige leitura do Gerenciador.
R2. NUNCA afirme como ESTA CONTA esta configurada (canal de captacao, CBO/ABO, marcacao de categoria especial, evento de otimizacao, janela de atribuicao, publico, pixel) sem dado que prove. Explicar o CONCEITO e permitido e desejavel; afirmar o ESTADO da conta sem dado, nao. A frase correta e: "conceitualmente funciona assim; confirmar como esta configurado aqui exige checar no Gerenciador".
R3. Distinga tres coisas diferentes: (a) o dado e ZERO, (b) o dado NAO EXISTE no sistema, (c) o dado NAO FOI COLETADO no periodo (sync/cobertura). Nunca trate (b) ou (c) como (a).
R4. PROIBIDO misturar janelas temporais no mesmo raciocinio ou funil. Se as fontes tem janelas diferentes, ou iguale as janelas ou declare explicitamente que a comparacao nao e valida.
R5. Amostra pequena nao vira conclusao. Poucos resultados = hipotese, e diga o volume.
R6. Correlacao temporal nao e causa. Verifique a ORDEM das datas antes de afirmar causalidade; se houver causa mais simples e anterior, prefira ela.
R7. Nao invente nome de campanha, criativo, banco ou pessoa. Se a busca nao achou, pergunte.
R8. Ao citar uma acao, jamais diga que executou: acoes viram card PENDENTE de aprovacao.
R9. Se voce mesmo percebeu uma incoerencia entre dois numeros, aponte a incoerencia na resposta.
R10. Ao repassar dados de uma tool que traz campo 'avisos' ou 'nota', incorpore essas ressalvas.

== COMO PENSAR COMO SENIOR ==
- Dinheiro acima de volume: contrato pago mandaria mais que CPL, mas essa fonte NAO existe no sistema (fora de escopo desde 28/07). Ranking por custo de midia vem de get_ads_ranking; declare sempre que CPL e proxy e que a unidade economica nao e mensuravel aqui.
- Va da metrica para a decisao: diga o que fazer, com qual numero, e qual o risco.
- Prefira a explicacao mais simples e verificavel. Antes de teoria elaborada: a campanha esta ativa? teve entrega? o dado chegou?
- "nao sei" e melhor que numero inventado; "provavel, porque X" e melhor que afirmacao seca.

== CRIAR CAMPANHA, CONJUNTO E ANUNCIO ==
Voce pode PROPOR criacao, nunca executar. A ordem e uma escada e cada degrau exige o anterior
aprovado: campanha -> conjunto -> anuncio. Conjunto e anuncio sao REPLICADOS de um molde que
ja funciona (voce informa o nome do molde), porque configuracao de conjunto nao pode ser
inventada. Tudo nasce PAUSADO: o gestor ativa no Gerenciador depois de revisar.
ORCAMENTO: nao existe valor padrao. Se o gestor nao disse quanto quer gastar por dia, PERGUNTE
antes de propor - nunca escolha um numero por conta propria.
UTM: nao escreva a string de UTM; o sistema monta. Voce so precisa do identificador que o
gestor quer ver no Dash (ex.: AGOSTO26), em params.utm_campaign.
Se a legenda do molde reprovar em compliance, a criacao e recusada automaticamente - relate o
veredito ao gestor e sugira ajuste de texto, sem tentar contornar.

== BASE DE CONHECIMENTO CONSULTAVEL (get_conhecimento) ==
Voce tem uma base tecnica propria. Consulte-a com get_conhecimento(tema) SEMPRE que a pergunta
for conceitual, de politica da Meta, de definicao de metrica, de metodo de diagnostico, ou
quando for propor/auditar criativo. Nao responda de memoria sobre politica ou metrica quando
existe tema para consultar - e nao diga "nao disponivel" para assunto coberto abaixo.
Temas disponiveis:
${indiceConhecimento}
Tema marcado como VENCIDO pode ser citado como referencia, mas declare ao gestor que precisa
ser reverificado na fonte oficial antes de virar decisao.

== CONHECIMENTO DE PLATAFORMA (resumo para resposta rapida; o detalhe esta na base acima) ==
CATEGORIA ESPECIAL "PRODUTOS E SERVICOS FINANCEIROS" (a Meta aposentou o nome "Credito" em 2026; valor tecnico FINANCIAL_PRODUCTS_SERVICES): obrigatoria para anuncio de credito/financiamento. Proibe segmentar ou excluir por idade fora de 18-65, genero, CEP e raio geografico menor que 15 milhas, e bloqueia interesses e comportamentos considerados sensiveis; lookalike vira "publico especial" com restricao. Nao marcar quando devido, ou tentar contornar, expoe a conta a reprovacao, restricao de entrega e bloqueio de BM - e risco operacional, nao estrategia.
PROMESSA ENGANOSA em credito: "aprovacao garantida", "credito sem analise", "dinheiro na hora", taxa apresentada como certa sem "sujeito a analise", uso de simbolo de instituicao financeira sem autorizacao, e senso de urgencia falso. O contrapeso correto e declarar sujeicao a analise de credito e margem.
CBO vs ABO: no CBO o orcamento fica na campanha e a Meta distribui entre conjuntos; no ABO cada conjunto tem seu proprio orcamento. CBO acelera aprendizado e concentra entrega no conjunto que responde melhor; ABO da controle por publico e evita que um conjunto absorva tudo. Estrutura hibrida na mesma conta e comum, mas dificulta comparacao justa entre conjuntos.
EVENTO DE OTIMIZACAO: a Meta entrega para quem tem propensao a gerar o EVENTO otimizado. Otimizar para formulario ou clique entrega volume barato de quem preenche facil; otimizar para evento profundo (proposta, contrato) entrega menos volume e mais propensao a comprar. Alimentar a Meta com sinal raso e a causa mais comum de "lead barato que nao vira venda".
FADIGA DE CRIATIVO: frequencia crescente com CTR caindo e custo por resultado subindo no mesmo publico. Antes de trocar criativo, verificar se a queda nao e de entrega, orcamento ou sazonalidade.
APRENDIZADO LIMITADO: conjunto que nao atinge o volume minimo de eventos na janela sai da fase de aprendizado sem estabilizar, e o custo oscila. Fracionar orcamento em muitos conjuntos e a causa tipica.
ATRIBUICAO: a janela padrao atual e 7 dias de clique e 1 dia de visualizacao. Janela maior credita mais conversoes a Meta e infla o resultado aparente; janela menor subestima. Comparar periodos com janelas diferentes invalida a comparacao.

== GLOSSARIO ==
Lead(LP) = clique no link (definicao historica desta conta; o teto de R$1,50 mede ISSO - reconstruido em 30/07). Como clique nao e lead, AO REPORTAR chame de 'custo por clique no link' e diga que o nome cadastrado e historico. Formulario = form preenchido. Conversa = WhatsApp iniciado (linha separada, nao etapa). Proposta/contrato: fora do escopo do sistema - nao cite.

== FORMATO E APRESENTACAO (regras vigentes, vindas da configuracao do sistema) ==
Siga TODAS as regras abaixo na montagem da resposta. Elas definem como o gestor le seu texto.
${estilo}

Alem delas: em pedido amplo, consulte o que for necessario e responda bloco a bloco na ordem pedida. Compliance: voce NAO precisa pedir o texto do anuncio ao gestor - pegue a legenda real com get_criativos_conteudo e passe para check_compliance. Escreva de forma continua ate acabar; se a mensagem for cortada por tamanho, o sistema emenda sozinho, entao NAO pare voluntariamente nem pergunte se pode continuar. Nunca responda "nao consegui".

== MEMORIA INSTITUCIONAL (fatos verificados desta conta - considere sempre) ==
${memoria}`;
}

// ============ v28.11: O RETORNO DA FERRAMENTA ATRAVESSA A REQUISICAO =====================
// O que se grava por ferramenta executada. 'retorno' e o objeto devolvido; quando o payload
// passou do teto, e a string ja cortada - o MESMO corte que foi para o modelo, e 'cortado'
// diz qual dos dois casos e (checar typeof nao serviria: ha tool que devolve string).
type ToolResult = {
  tool: string; args: unknown; chars: number; cortado: boolean; retorno: unknown; erro?: string;
};

// Achata o JSON em linhas 'caminho = valor'. Nao e sumarizacao: nenhum valor escalar e
// reescrito, so texto muito longo e cortado - e o corte diz quantos chars faltam.
function achatarRetorno(valor: unknown, prefixo: string, linhas: string[]) {
  const chave = prefixo || "retorno";
  if (valor === null || valor === undefined) { linhas.push(`${chave} = null`); return; }
  if (Array.isArray(valor)) {
    if (!valor.length) { linhas.push(`${chave} = [] (lista VAZIA - nao e zero nem inexistente)`); return; }
    const mostrar = Math.min(valor.length, TOOLRES_ITENS_LISTA);
    for (let i = 0; i < mostrar; i++) achatarRetorno(valor[i], `${chave}[${i}]`, linhas);
    if (valor.length > mostrar) {
      linhas.push(`${chave}[...] = ${valor.length - mostrar} de ${valor.length} item(ns) OMITIDOS nesta reinjecao (a lista original tinha ${valor.length}; chame a ferramenta de novo se precisar do resto)`);
    }
    return;
  }
  if (typeof valor === "object") {
    const entradas = Object.entries(valor as Record<string, unknown>);
    if (!entradas.length) { linhas.push(`${chave} = {}`); return; }
    for (const [k, v] of entradas) achatarRetorno(v, prefixo ? `${prefixo}.${k}` : k, linhas);
    return;
  }
  const s = String(valor);
  linhas.push(`${chave} = ` + (s.length > TOOLRES_TEXTO
    ? s.slice(0, TOOLRES_TEXTO) + ` [AVISO: +${s.length - TOOLRES_TEXTO} chars deste texto omitidos]`
    : s));
}

const TEM_NUMERO = /\d/;
// Prioridade de corte: sai primeiro o campo SEM numero. Numero e o que o gestor decide em
// cima - foi exatamente o R$ 216,00 e a regua de R$ 1,60 que sumiram em 07/08. Rotulo sem
// valor se pode perder declarando; numero, nao.
function compactarRetorno(tr: ToolResult, teto: number): string {
  if (tr.erro) return `NAO EXECUTADA NESTA RODADA: ${tr.erro}`;
  if (tr.cortado) {
    const s = String(tr.retorno ?? "");
    return s.length <= teto ? s
      : s.slice(0, teto) + `\n[AVISO DO SISTEMA: ${s.length - teto} caracteres deste retorno foram omitidos nesta reinjecao.]`;
  }
  const linhas: string[] = [];
  achatarRetorno(tr.retorno, "", linhas);
  let texto = linhas.join("\n");
  if (texto.length <= teto) return texto;
  const comNumero = linhas.filter((l) => TEM_NUMERO.test(l));
  const semNumero = linhas.length - comNumero.length;
  texto = comNumero.join("\n") + (semNumero
    ? `\n[AVISO DO SISTEMA: ${semNumero} campo(s) SEM numero deste retorno foram omitidos nesta reinjecao por limite de tamanho.]` : "");
  if (texto.length <= teto) return texto;
  const mantidas: string[] = [];
  let usado = 0;
  for (const l of comNumero) {
    if (usado + l.length + 1 > teto) break;
    mantidas.push(l); usado += l.length + 1;
  }
  const fora = (comNumero.length - mantidas.length) + semNumero;
  return mantidas.join("\n") +
    `\n[AVISO DO SISTEMA: ${fora} campo(s) deste retorno foram omitidos nesta reinjecao por limite de tamanho - chame a ferramenta de novo se precisar deles.]`;
}

function argsCurtos(args: unknown): string {
  try {
    const s = JSON.stringify(args ?? {});
    if (!s || s === "{}" || s === "null") return "";
    return s.length > 200 ? s.slice(0, 200) + "…" : s;
  } catch { return ""; }
}

// O bloco que volta ao modelo. O cabecalho DECLARA o que estes numeros sao e o que eles NAO
// autorizam: sao retorno de ferramenta (podem ser citados como apurado, com data), e nao sao
// licenca para afirmar ATO nesta resposta - a regra do v28.5 continua exigindo chamada com
// sucesso agora para criar/emitir/alterar/executar.
function blocoDeRetornos(lista: ToolResult[], quando: string, orcamento: number): { texto: string; usados: number } {
  if (!lista.length || orcamento <= 400) return { texto: "", usados: 0 };
  const cabecalho = `[RETORNOS DE FERRAMENTA JA APURADOS EM ${quando}, reinjetados pelo sistema a partir do registro desta conversa - NAO sao memoria sua e NAO foram reconstruidos. Para a regra R1 e para "ato so existe com retorno de ferramenta": os numeros abaixo SAO retorno de ferramenta e podem ser citados como apurados, atribuindo-os a esta data. O que eles NAO autorizam e afirmar ATO nesta resposta - criar, emitir, alterar, executar ou verificar estado continua exigindo chamada com sucesso AGORA. Se precisar de dado mais novo que a data acima, chame a ferramenta de novo. Nao escreva que nao conseguiu consultar algo que esta listado aqui.]`;
  const partes: string[] = [];
  let restante = orcamento - cabecalho.length;
  let usados = 0;
  for (const tr of lista) {
    if (restante <= 400) break;
    const teto = Math.min(TOOLRES_CAP_TOOL, restante - 200);
    const a = argsCurtos(tr.args);
    const parte = `>> ${tr.tool}(${a})\n${compactarRetorno(tr, teto)}`;
    partes.push(parte);
    restante -= parte.length + 2;
    usados++;
  }
  const sobraram = lista.slice(usados);
  const rodape = sobraram.length
    ? `\n[AVISO DO SISTEMA: o retorno de mais ${sobraram.length} ferramenta(s) desta rodada (${[...new Set(sobraram.map((t) => t.tool))].join(", ")}) NAO coube nesta reinjecao. O dado FOI lido naquela rodada - nao o trate como zero, inexistente nem como consulta que falhou; se precisar dele, chame a ferramenta de novo.]`
    : "";
  return { texto: `${cabecalho}\n${partes.join("\n\n")}${rodape}`, usados };
}

function listaDeRetornos(v: unknown): ToolResult[] {
  if (!Array.isArray(v)) return [];
  return v.filter((x) => !!x && typeof x === "object" && typeof (x as any).tool === "string") as ToolResult[];
}

// ============ v28.11: ROTEAMENTO DE PEDIDO LONGO PARA A ROTA ASSINCRONA ==================
// Familias de assunto do pedido - MESMO vocabulario que prioridadeTool ja usa para ordenar o
// lote de ferramentas. Reaproveitado de proposito: contar familias e a aproximacao mais
// proxima de "quantas ferramentas este pedido vai exigir" que da para calcular ANTES de
// gastar o turno. Calibragem em 20 dias de turnos deste chat esta no cabecalho do arquivo.
// Sete termos do vocabulario de prioridadeTool NAO entram aqui - "retorno", "conversa",
// "metrica", "historic" e "sugira" sao palavras comuns em pedido curto e em meta-linguagem
// ("de qual retorno de ferramenta", "nesta conversa"), e contar familia por elas roteava
// pergunta pequena. Ordenar o lote pode errar barato; rotear errado tira o pedido do turno
// sincrono. Medido: sem esse aperto, uma sonda de 350 chars pontuou 5 familias.
const FAMILIAS_ASSUNTO: RegExp[] = [
  /criativ|legenda|compliance|anuncio|peca|texto|copy|oferta/,
  /receita|contrato|cac|vende|vendas|funil|proposta|lucro/,
  /cbo|abo|conjunto|estrutura|publico|targeting|lance|orcamento/,
  /utm|variante|rastreio|rotulo/,
  /teto|regua|meta de custo|escal|vencedor/,
  /como funciona|por que|explique|conceito|politica|regra da meta|categoria especial|hook|formato|fadiga|aprendizado|breakdown|sazonal|briefing/,
  /card|aprova|pendente|aprovado|criou|criad|emiti|executou|executad|fila/,
  /desempenho|gasto|lead|cpl|ctr|custo por|ranking|pior|melhor|7 dias|ontem/,
  /whatsapp|waba|template|conversas/,
  /drive|video|reel|thumb|visual/,
];
const ROTA_FAMILIAS_MIN = 5;
const ROTA_CHARS_MIN = 1500;
const RE_CONTINUACAO = /^sua resposta anterior foi cortada/;
const RE_PEDIDO_DE_ATO = /\b(crie|criar|cria|criacao|suba|subir|lance|lancar|proponha|propor|duplique|duplicar|escale|escalar|pause|pausar|ative|ativar|altere|alterar|aumente|aumentar|reduza|reduzir|emita|emitir|aprove|aprovar|replique|replicar|monte|montar|quero subir|vamos criar)\b/;

function decidirRotaAssincrona(pedido: string, nAnexos: number): { rotear: boolean; motivo: string; familias: number } {
  const p = deacc(pedido.toLowerCase());
  const familias = FAMILIAS_ASSUNTO.reduce((a, re) => a + (re.test(p) ? 1 : 0), 0);
  const porFamilia = familias >= ROTA_FAMILIAS_MIN;
  const porTamanho = pedido.length >= ROTA_CHARS_MIN;
  if (!porFamilia && !porTamanho) return { rotear: false, motivo: "cabe no turno sincrono", familias };
  // As tres guardas abaixo NAO sao cautela generica: cada uma cobre uma capacidade que a rota
  // assincrona nao tem, e mandar o pedido para la seria perde-la em silencio.
  if (RE_CONTINUACAO.test(p)) return { rotear: false, motivo: "continuacao: o job replaneja do zero e nao retoma texto cortado", familias };
  if (nAnexos > 0) return { rotear: false, motivo: "pedido com anexo: o job nao le anexo", familias };
  if (RE_PEDIDO_DE_ATO.test(p)) return { rotear: false, motivo: "pedido de ato: propose_action nao existe no job e o card seria perdido", familias };
  return { rotear: true, familias,
    motivo: porFamilia ? `pedido cobre ${familias} familias de assunto (>= ${ROTA_FAMILIAS_MIN})` : `pedido com ${pedido.length} chars (>= ${ROTA_CHARS_MIN})` };
}

Deno.serve(async (req) => {
  // v19: cronometro comeca AQUI, nao depois dos anexos. Processar planilha/PDF grande
  // consome segundos que precisam entrar no orcamento, senao o teto de 143s e estourado
  // por fora e volta o 504.
  const tInicio = Date.now();
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });
  if (req.method !== "POST") return json({ error: "POST only" }, 405);
  if (!OPENROUTER_KEY) return json({ error: "missing_openrouter_key" }, 500);

  const xKey = (req.headers.get("x-mcp-key") ?? "").trim();
  const bearer = bearerDe(req);
  let userId: string | null = null, authed = false;
  if (xKey) {
    const v = await mcpKeyValida(supa, xKey);
    if (!v.ok) return json({ error: "unauthorized", motivo: v.motivo }, 401);
    authed = true;
  } else if (bearer) {
    const { data: u } = await supa.auth.getUser(bearer);
    if (u?.user) { authed = true; userId = u.user.id; }
    else {
      const v = await mcpKeyValida(supa, bearer);
      if (v.ok) authed = true;
    }
  }
  if (!authed) return json({ error: "unauthorized" }, 401);
  const { data: cfg } = await supa.from("mcp_config").select("api_key").eq("id", 1).maybeSingle();

  let body: any = {};
  try { body = await req.json(); } catch { /* */ }
  const message = String(body?.message ?? "").trim();
  const rawAtts: any[] = Array.isArray(body?.attachments) ? body.attachments.slice(0, 4) : [];
  if (!message && !rawAtts.length) return json({ error: "message obrigatorio" }, 400);

  const company = await resolveCompany(body?.company ? String(body.company) : undefined);
  if (!company) return json({ error: "empresa nao encontrada" }, 400);

  // v28.11: pedido longo de ANALISE nao disputa os 150s da plataforma - vai para o job, que
  // nao tem esse teto. A decisao acontece AQUI, antes de qualquer chamada ao modelo e antes
  // de gravar a pergunta (quem grava e o job, senao a pergunta entraria duas vezes).
  // Se o encaminhamento falhar, NAO se perde o turno: cai no caminho sincrono e a falha vai
  // declarada na telemetria - rota nova nao pode derrubar o chat.
  const rota = decidirRotaAssincrona(message, rawAtts.length);
  let rotaFalhou = "";
  // Quarta guarda, e a unica que custa uma consulta: o job recebe SO a pergunta - nao le o
  // historico da conversa. Pergunta feita no meio de um fio ("e agora compare com o que voce
  // disse") viraria uma resposta sem o fio. Na medicao de 20 dias os 3 pedidos que este
  // criterio rotearia eram TODOS a primeira pergunta do fio, entao a guarda nao custa nenhum
  // caso verdadeiro.
  if (rota.rotear && body?.conversation_id) {
    const { count } = await supa.from("chat_messages").select("id", { count: "exact", head: true })
      .eq("conversation_id", String(body.conversation_id)).eq("role", "assistant");
    if (count) {
      rota.rotear = false;
      rota.motivo = "pergunta no meio de um fio: o job responde so a pergunta, sem o historico da conversa";
    }
  }
  if (rota.rotear) {
    try {
      const resp = await fetch(`${SUPABASE_URL}/functions/v1/traffic-agent-job`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          ...(xKey ? { "x-mcp-key": xKey } : {}),
          ...(bearer ? { authorization: `Bearer ${bearer}` } : {}),
        },
        body: JSON.stringify({ message, conversation_id: body?.conversation_id ?? undefined, company: body?.company ?? undefined }),
      });
      const txt = await resp.text();
      if (resp.ok) {
        return json({ ...JSON.parse(txt), versao: VERSAO, roteado_para_job: true,
          motivo_do_roteamento: rota.motivo, familias_de_assunto: rota.familias }, 202);
      }
      rotaFalhou = `http_${resp.status}`;
    } catch (e) {
      rotaFalhou = String((e as any)?.message ?? e).slice(0, 120);
    }
  }

  // v26: carrega fatos UNIVERSAIS (company_id null) + fatos DESTA empresa. Nunca de outra.
  const { data: ctxRows } = await supa.from("agent_context")
    .select("categoria,fato,desde,company_id").eq("vigente", true)
    .or(`company_id.is.null,company_id.eq.${company.id}`)
    .order("categoria");
  // v24: INDICE da base de conhecimento. Progressive disclosure: o indice (barato) vai no
  // prompt para o agente saber o que existe; o conteudo (caro) so e lido sob demanda.
  const { data: knRows } = await supa.from("agent_knowledge")
    .select("tema,descricao,revalidar_ate").eq("vigente", true).order("tema");
  const hojeIso = new Date().toISOString().slice(0, 10);
  const indiceConhecimento = (knRows ?? []).length
    ? (knRows ?? []).map((r: any) => {
        const venc = r.revalidar_ate && String(r.revalidar_ate) < hojeIso ? " [VENCIDO - reverificar antes de afirmar]" : "";
        return `- ${r.tema}${venc}: ${r.descricao}`;
      }).join("\n")
    : "(base de conhecimento vazia)";

  // v23: regras de formatacao vindas da tabela, nao do codigo.
  const { data: styleRows } = await supa.from("agent_style")
    .select("secao,regra").eq("vigente", true).order("ordem");
  const estilo = (styleRows ?? []).length
    ? (styleRows ?? []).map((r: any) => `- [${String(r.secao).toUpperCase()}] ${r.regra}`).join("\n")
    : "(sem regras cadastradas - use titulos markdown, tabela para numeros comparaveis e negrito so no numero que decide)";
  const memoria = (ctxRows ?? []).length
    ? (ctxRows ?? []).map((r: any) => `- [${String(r.categoria).toUpperCase()}${r.desde ? " " + String(r.desde) : ""}] ${r.fato}`).join("\n")
    : "(sem fatos registrados)";

  let requestedBy = userId;
  if (!requestedBy) {
    const { data: adm } = await supa.from("user_roles").select("user_id").eq("role", "admin").limit(1).maybeSingle();
    requestedBy = adm?.user_id ?? null;
  }

  let convId: string | null = body?.conversation_id ?? null;
  if (convId) {
    const { data: conv } = await supa.from("chat_conversations").select("id").eq("id", convId).maybeSingle();
    if (!conv) convId = null;
  }
  if (!convId) {
    const { data: conv, error: ce } = await supa.from("chat_conversations")
      .insert({ company_id: company.id, title: (message || rawAtts[0]?.name || "anexo").slice(0, 60), kind: "chat", created_by: userId })
      .select("id").single();
    if (ce) return json({ error: "conv_create_failed", detail: ce.message }, 500);
    convId = conv.id;
  }

  const userContent: any[] = [];
  const attMeta: any[] = [];
  const attNotas: string[] = [];
  const imgAtts: { mime: string; b64: string }[] = [];
  for (const a of rawAtts) {
    const name = String(a?.name ?? "arquivo");
    const mime = String(a?.mime ?? "").toLowerCase();
    const b64 = String(a?.data_base64 ?? "");
    if (!b64) continue;
    const sizeKb = Math.round((b64.length * 3) / 4 / 1024);
    if (sizeKb > 8500) { attNotas.push(`"${name}" ignorado (>8MB)`); continue; }
    try {
      if (IMG_MIMES.includes(mime)) {
        userContent.push({ type: "image_url", image_url: { url: `data:${mime};base64,${b64}` } });
        attMeta.push({ name, mime, kb: sizeKb, tipo: "imagem" }); imgAtts.push({ mime, b64 });
      } else if (mime === "application/pdf") {
        userContent.push({ type: "file", file: { filename: name, file_data: `data:application/pdf;base64,${b64}` } });
        attMeta.push({ name, mime, kb: sizeKb, tipo: "pdf" });
      } else if (SHEET_MIMES.includes(mime) || /\.(xlsx|xls|csv)$/i.test(name)) {
        const { text, nota } = await sheetToText(name, mime, b64);
        userContent.push({ type: "text", text });
        attMeta.push({ name, mime, kb: sizeKb, tipo: "planilha", extracao: nota });
      } else if (mime.startsWith("text/")) {
        const txt = new TextDecoder().decode(b64ToU8(b64)).slice(0, 40000);
        userContent.push({ type: "text", text: `[ARQUIVO DE TEXTO "${name}"]\n` + txt });
        attMeta.push({ name, mime, kb: sizeKb, tipo: "texto" });
      } else attNotas.push(`"${name}" tipo nao suportado (${mime || "desconhecido"})`);
    } catch (e) { attNotas.push(`"${name}" falhou: ${String((e as any)?.message ?? e).slice(0, 120)}`); }
  }
  const msgText = message || "Analise o(s) anexo(s).";
  userContent.unshift({ type: "text", text: msgText + (attNotas.length ? `\n\n[avisos de anexo: ${attNotas.join("; ")}]` : "") });

  // v28.11: tool_results entra no SELECT. Sem ele o historico dizia QUAIS ferramentas foram
  // chamadas (tool_calls) e nunca o que elas responderam - foi essa lacuna que fez a
  // continuacao de 07/08 declarar honestamente que nao tinha a regua de teto.
  const { data: hist } = await supa.from("chat_messages").select("role,content,created_at,tool_results").eq("conversation_id", convId)
    .in("role", ["user", "assistant"]).order("created_at", { ascending: false }).limit(HIST);
  // v27.1: corte de historico com DIRECAO CERTA e DECLARADO. O slice(0,6000) uniforme do
  // v15-v27 cortava a CAUDA da pergunta original (os blocos finais de um pedido longo
  // sumiam nas continuacoes - provado: blocos 9-12 do questionario de 28/07 nunca foram
  // respondidos) e a CAUDA da ultima resposta (a costura nao via onde a resposta anterior
  // parou, entao reescrevia secao e perdia linha de tabela). Regras:
  //   - mensagem de USUARIO mais recente: cap maior (a pergunta original entra inteira);
  //   - demais mensagens de usuario longas: cabeca + cauda, com aviso;
  //   - mensagem de ASSISTENTE mais recente: CAUDA (e o final dela que a continuacao usa);
  //   - demais assistentes longas: cabeca, com aviso.
  // Todo corte se DECLARA ao modelo - corte silencioso e proibido (licao do cortarLista).
  const cronologico = (hist ?? []).reverse();
  let ultimoAssistantIdx = -1, ultimoUserIdx = -1;
  for (let i = cronologico.length - 1; i >= 0; i--) {
    if (ultimoAssistantIdx < 0 && cronologico[i].role === "assistant") ultimoAssistantIdx = i;
    if (ultimoUserIdx < 0 && cronologico[i].role === "user") ultimoUserIdx = i;
    if (ultimoAssistantIdx >= 0 && ultimoUserIdx >= 0) break;
  }
  // v28.11: REINJECAO DOS RETORNOS. Os 2 turnos de assistente mais recentes que tenham
  // tool_results voltam com um bloco de evidencia ANTES do proprio texto - antes, e nao
  // depois, porque o final da ultima resposta precisa continuar sendo a ultima coisa que o
  // modelo le (v27.1: e dali que a continuacao retoma). O orcamento e global e vai para os
  // turnos mais NOVOS primeiro; o que nao couber e declarado, nunca cortado em silencio.
  const blocosDeRetorno = new Map<number, string>();
  const declaracoesDeRetorno = new Map<number, string>();
  let toolresTurnos = 0, toolresFerramentas = 0, toolresChars = 0;
  let orcamentoRetornos = TOOLRES_CAP_TOTAL;
  for (let i = cronologico.length - 1; i >= 0; i--) {
    const m: any = cronologico[i];
    if (m.role !== "assistant") continue;
    const lista = listaDeRetornos(m.tool_results);
    if (!lista.length) continue;
    if (toolresTurnos < TOOLRES_TURNOS) {
      const quando = String(m.created_at ?? "").slice(0, 16).replace("T", " ") + " UTC";
      const b = blocoDeRetornos(lista, quando, orcamentoRetornos);
      if (b.texto) {
        blocosDeRetorno.set(i, b.texto);
        orcamentoRetornos -= b.texto.length;
        toolresTurnos++; toolresFerramentas += b.usados; toolresChars += b.texto.length;
        continue;
      }
    }
    declaracoesDeRetorno.set(i, `[AVISO DO SISTEMA: esta resposta consultou ${[...new Set(lista.map((t) => t.tool))].join(", ")}. Os retornos NAO foram reinjetados neste historico (turno antigo, limite de tamanho). O dado FOI lido na epoca - se precisar do numero, chame a ferramenta de novo em vez de reconstrui-lo de memoria.]`);
  }
  let histMsgsCortadas = 0;
  const history = cronologico.map((m, i) => {
    const c = String(m.content ?? "");
    const cap = (m.role === "user" && i === ultimoUserIdx) ? HIST_CAP_USER_RECENTE : HIST_CAP;
    const evidencia = blocosDeRetorno.get(i) ?? declaracoesDeRetorno.get(i) ?? "";
    const comEvidencia = (corpo: string) => ({ role: m.role, content: evidencia ? evidencia + "\n\n" + corpo : corpo });
    if (c.length <= cap) return comEvidencia(c);
    histMsgsCortadas++;
    const omitidos = c.length - cap;
    if (m.role === "assistant" && i === ultimoAssistantIdx) {
      // A continuacao precisa do FINAL da ultima resposta, nao do inicio.
      return comEvidencia(
        `[AVISO DO SISTEMA: o INICIO desta resposta (${omitidos} caracteres) foi omitido do historico por limite de tamanho. O trecho abaixo e o FINAL EXATO da resposta anterior - ao continuar, retome da ultima linha dele, sem reescrever nem resumir o que ja foi entregue.]\n` + c.slice(-cap));
    }
    if (m.role === "user") {
      const cabeca = Math.floor(cap * 0.55);
      const cauda = cap - cabeca;
      return comEvidencia(
        c.slice(0, cabeca) +
        `\n[AVISO DO SISTEMA: ${omitidos} caracteres do MEIO desta mensagem foram omitidos do historico por limite de tamanho. O INICIO e o FINAL estao preservados - a mensagem NAO termina neste corte; considere tambem o trecho final abaixo antes de concluir o que foi pedido.]\n` +
        c.slice(-cauda));
    }
    return comEvidencia(
      c.slice(0, cap) + `\n[AVISO DO SISTEMA: o final desta mensagem (${omitidos} caracteres) foi omitido do historico por limite de tamanho.]`);
  });

  await supa.from("chat_messages").insert({ conversation_id: convId, company_id: company.id, role: "user", content: msgText, user_id: userId, attachments: attMeta.length ? attMeta : null });

  // v20: prompt caching. cache_control marca o bloco como cacheavel; leituras subsequentes
  // do MESMO prefixo custam 0,1x. O system (escopo+protocolo+regras+memoria, ~3.600 tokens)
  // e a pergunta atual sao identicos em todas as rodadas do turno. TTL ~5min, e as rodadas
  // ocorrem em segundos. Anthropic exige minimo ~1024 tokens por bloco: o system passa;
  // a pergunta so e marcada se for texto simples e suficientemente longa.
  const cacheSystem = [{ type: "text", text: systemPrompt(company.name, memoria, estilo, indiceConhecimento),
    cache_control: { type: "ephemeral" } }];
  const perguntaSimples = userContent.length === 1;
  const perguntaCacheavel = perguntaSimples && msgText.length >= 4000;
  const userMsgContent: any = perguntaCacheavel
    ? [{ type: "text", text: msgText, cache_control: { type: "ephemeral" } }]
    : (perguntaSimples ? msgText : userContent);
  const messages: any[] = [{ role: "system", content: cacheSystem }, ...history,
    { role: "user", content: userMsgContent }];
  const toolsUsed: any[] = [];
  // v28.11: o que cada ferramenta DEVOLVEU, para gravar em chat_messages.tool_results.
  const toolResults: ToolResult[] = [];
  const actionCards: CardInfo[] = [];
  const ctx = { companyId: company.id, convId: convId!, requestedBy: requestedBy!, cards: actionCards, imgAtts, mcpKey: cfg?.api_key ?? "" };
  let tokensIn = 0, tokensOut = 0, reply = "", iteracoes = 0, finishReason = "";
  // v19: buffer do texto emitido JUNTO com tool_calls, que antes era descartado.
  const preambulos: string[] = [];
  // v19: orcamento dinamico de geracao (tInicio declarado no topo do handler).
  const decorrido = () => Date.now() - tInicio;
  let deadlineTools = false;
  // v20: telemetria de custo. Capturamos os dois formatos possiveis - anthropic
  // (cache_creation_input_tokens / cache_read_input_tokens) e openai
  // (prompt_tokens_details.cached_tokens) - porque nao esta confirmado qual o OpenRouter
  // repassa para o claude-sonnet-5. Se ambos vierem zerados, o caching NAO esta pegando.
  let cacheWrite = 0, cacheRead = 0, tetoTools = false;
  function somarReasoning(usage: any) {
    reasoningTokens += Number(usage?.completion_tokens_details?.reasoning_tokens ?? 0)
      + Number(usage?.reasoning_tokens ?? 0);
  }
  function somarCache(usage: any) {
    cacheWrite += Number(usage?.cache_creation_input_tokens ?? 0);
    cacheRead += Number(usage?.cache_read_input_tokens ?? 0)
      + Number(usage?.prompt_tokens_details?.cached_tokens ?? 0);
  }
  function tokensDisponiveis() {
    const restanteMs = HARD_LIMIT_MS - decorrido() - RESERVA_GRAVACAO_MS;
    if (restanteMs <= 0) return 600;
    const est = Math.floor((restanteMs / 1000) * TOKENS_POR_SEGUNDO);
    return Math.max(600, Math.min(MAX_TOKENS, est));
  }

  // v20: fallback de cache. Nao esta confirmado que o OpenRouter aceita cache_control para
  // o claude-sonnet-5. Se ele IGNORAR o campo, tudo funciona sem cache (inofensivo). Se
  // REJEITAR com 4xx, sem este fallback a edge devolveria 502 em TODO turno - queda total
  // do chat por um campo opcional. Aqui: na primeira rejeicao, remove cache_control,
  // retenta, e desativa o cache pelo resto do turno para nao dobrar chamadas.
  let cacheDesativado = false, cacheRejeitado = false;
  // v21: flags de raciocinio e contador para telemetria.
  let reasoningDesativado = false, reasoningRejeitado = false, reasoningTokens = 0;
  function semCache(ms: any[]) {
    return ms.map((m) => {
      if (!Array.isArray(m.content)) return m;
      return { ...m, content: m.content.map((b: any) => {
        if (b && typeof b === "object" && "cache_control" in b) {
          const { cache_control: _drop, ...resto } = b; return resto;
        }
        return b;
      }) };
    });
  }

  async function chamar(comTools: boolean, maxTokens = MAX_TOKENS, semRaciocinio = false): Promise<any> {
    const usarCache = !cacheDesativado;
    const payload: any = { model: MODEL, messages: usarCache ? messages : semCache(messages), max_tokens: maxTokens };
    if (comTools) { payload.tools = TOOLS; payload.tool_choice = "auto"; }
    // v21: na sintese o raciocinio e excluido para que TODO o orcamento va para o texto.
    if (!reasoningDesativado) payload.reasoning = semRaciocinio ? REASONING_SINTESE : REASONING_LOOP;
    const resp = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${OPENROUTER_KEY}` }, body: JSON.stringify(payload),
    });
    const text = await resp.text();
    if (!resp.ok) {
      // v21: degradacao em 2 passos. Tira o reasoning primeiro (parametro novo, nao provado)
      // e so depois o cache (provado funcionando em 4 turnos v20 - nao vale perder de graca).
      if (resp.status === 400 || resp.status === 422) {
        if (!reasoningDesativado) {
          reasoningDesativado = true; reasoningRejeitado = true;
          return await chamar(comTools, maxTokens, semRaciocinio);
        }
        if (usarCache) {
          cacheDesativado = true; cacheRejeitado = true;
          return await chamar(comTools, maxTokens, semRaciocinio);
        }
      }
      return { erro: `openrouter_http_${resp.status}`, detalhe: text.slice(0, 300) };
    }
    try { return { parsed: JSON.parse(text) }; } catch { return { erro: "openrouter_non_json", detalhe: text.slice(0, 300) }; }
  }

  for (let iter = 0; iter < MAX_ITER; iter++) {
    // v19: orcamento de tempo. Sem isso o loop podia consumir os 150s inteiros coletando
    // dados e morrer antes de escrever - 504, perda total. Melhor resposta parcial
    // declarada que nenhuma resposta.
    if (iter > 0 && decorrido() > TOOLS_DEADLINE_MS) { deadlineTools = true; break; }
    iteracoes = iter + 1;
    // v27: orcamento dimensionado pelo tempo restante, nao fixo.
    const r = await chamar(true, tokensDisponiveis());
    if (r.erro) return json({ error: r.erro, detail: r.detalhe }, 502);
    const parsed = r.parsed;
    tokensIn += Number(parsed?.usage?.prompt_tokens ?? 0);
    tokensOut += Number(parsed?.usage?.completion_tokens ?? 0);
    somarCache(parsed?.usage); somarReasoning(parsed?.usage);
    finishReason = String(parsed?.choices?.[0]?.finish_reason ?? "");
    const msg = parsed?.choices?.[0]?.message;
    if (!msg) return json({ error: "openrouter_empty" }, 502);
    if (msg.tool_calls?.length) {
      // v18: o modelo pode emitir texto E tool_calls na MESMA mensagem. Antes esse texto
      // entrava no historico enviado ao modelo mas nunca chegava ao usuario.
      const parcial = String(msg.content ?? "").trim();
      if (parcial) preambulos.push(parcial);
      messages.push(msg);
      // v22: ordena o lote por relevancia ao pedido antes de gastar as vagas do teto.
      const loteOrdenado = [...msg.tool_calls].sort((a: any, b: any) =>
        prioridadeTool(String(a.function?.name ?? ""), msgText) -
        prioridadeTool(String(b.function?.name ?? ""), msgText));
      for (const tc of loteOrdenado) {
        // v20: teto de ferramentas. A API exige resposta para CADA tool_call_id, entao nao
        // e possivel simplesmente pular - devolvemos um resultado que DECLARA o teto, para
        // o modelo nao tratar o dado como zero nem como inexistente (R3).
        const nomeTc = String(tc.function?.name ?? "");
        let args: any = {}; try { args = JSON.parse(tc.function?.arguments ?? "{}"); } catch { /* */ }
        const jaUsou = toolsUsed.filter((t) => t.tool === nomeTc).length;
        const limiteDesta = MAX_POR_FERRAMENTA[nomeTc] ?? MAX_POR_FERRAMENTA_DEFAULT;
        if (toolsUsed.length >= MAX_TOOLS_TURNO || jaUsou >= limiteDesta) {
          tetoTools = true;
          messages.push({ role: "tool", tool_call_id: tc.id, content: JSON.stringify({
            erro: "consulta_nao_realizada_nesta_rodada",
            aviso: "Esta consulta nao foi executada nesta rodada. O dado NAO foi lido - nao o trate como zero nem como inexistente. Responda com o que ja tem e diga ao gestor, em UMA linha e em linguagem natural, que este item ficou para a proxima. NAO cite nome de ferramenta, numero de limite nem detalhe de implementacao." }) });
          // v28.11: a consulta NAO feita tambem se registra. Sem isto a continuacao veria a
          // ausencia do dado e nao saberia distinguir "nao foi lido" de "nao existe" (R3).
          toolResults.push({ tool: nomeTc, args, chars: 0, cortado: false, retorno: null,
            erro: "teto de ferramentas do turno - o dado NAO foi lido, nao e zero nem inexistente" });
          continue;
        }
        const result = await runTool(tc.function?.name, args, ctx);
        toolsUsed.push({ tool: tc.function?.name, args });
        // v28.11: um unico corte, usado nos dois destinos - o que o modelo le e o que fica
        // gravado sao literalmente a mesma string.
        const bruto = JSON.stringify(result ?? null);
        const cortado = bruto.length > TOOLRES_TETO_PERSIST;
        toolResults.push({ tool: nomeTc, args, chars: bruto.length, cortado,
          retorno: cortado ? bruto.slice(0, TOOLRES_TETO_PERSIST) : (result ?? null) });
        messages.push({ role: "tool", tool_call_id: tc.id, content: bruto.slice(0, TOOLRES_TETO_PERSIST) });
      }
      continue;
    }
    reply = msg.content ?? "";
    break;
  }

  if (!reply) {
    messages.push({ role: "user", content: deadlineTools
      ? "PARE de usar ferramentas: o tempo de coleta acabou. Com os dados JA coletados, responda AGORA por blocos, com numeros reais e suas fontes. Diga em UMA linha, no fim, quais itens do pedido nao foram cobertos por falta de tempo de coleta, para o usuario poder pedir so esses depois. Nao responda que nao conseguiu."
      : "PARE de usar ferramentas. Com os dados JA coletados, responda AGORA por blocos, com numeros reais e suas fontes, dizendo explicitamente o que nao esta disponivel. Nao responda que nao conseguiu." });
    const rf = await chamar(false, tokensDisponiveis(), true);
    if (!rf.erro) {
      const p = rf.parsed;
      tokensIn += Number(p?.usage?.prompt_tokens ?? 0);
      tokensOut += Number(p?.usage?.completion_tokens ?? 0);
      somarCache(p?.usage); somarReasoning(p?.usage);
      finishReason = String(p?.choices?.[0]?.finish_reason ?? finishReason) + "+sintese_final";
      reply = p?.choices?.[0]?.message?.content ?? "";
    }
  }
  // v18: emenda o texto que vinha junto com tool_calls e era descartado.
  // Heuristica deliberada: preambulo curto costuma ser ruido operacional ("vou consultar os
  // dados"), que o proprio prompt ja proibe; texto de 120+ chars e analise real. Se 'reply'
  // ficou vazio, emenda TUDO como resgate - melhor texto parcial que mensagem de erro.
  let preambulosUsados = 0;
  if (preambulos.length) {
    const aproveitar = reply ? preambulos.filter((p) => p.length >= 120) : preambulos;
    if (aproveitar.length) {
      preambulosUsados = aproveitar.length;
      const pre = aproveitar.join("\n\n").trim();
      reply = reply ? pre + "\n\n" + reply : pre;
    }
  }
  // v21: o fallback NAO e uma resposta truncada. Marcar como 'length' fazia o front disparar
  // a costura sobre a mensagem de erro - 3 vezes, 57-91k tokens cada.
  let usouFallback = false;
  if (!reply) {
    reply = "Nao consegui produzir a resposta desta vez. Tente de novo, ou divida o pedido em partes menores.";
    usouFallback = true;
    finishReason = "erro_sem_conteudo";
  }

  const diagnostico = { finish_reason: finishReason, iteracoes, ms_total: decorrido(),
    deadline_tools: deadlineTools, preambulos_detectados: preambulos.length,
    preambulos_recuperados: preambulosUsados, tools: toolsUsed.map((t) => t.tool),
    teto_tools: tetoTools, cache_write: cacheWrite, cache_read: cacheRead,
    cache_rejeitado: cacheRejeitado, reasoning_rejeitado: reasoningRejeitado,
    reasoning_tokens: reasoningTokens, usou_fallback: usouFallback,
    hist_msgs_cortadas: histMsgsCortadas,
    // v28.11: quanto do contexto anterior a rodada enxergou, e quanto ela deixa para a proxima.
    toolres_gravados: toolResults.length, toolres_turnos_reinjetados: toolresTurnos,
    toolres_ferramentas_reinjetadas: toolresFerramentas, toolres_chars_reinjetados: toolresChars,
    rota_familias: rota.familias, rota_falhou: rotaFalhou || null,
    tokens_in: tokensIn, tokens_out: tokensOut, versao: VERSAO };

  await supa.from("chat_messages").insert({ conversation_id: convId, company_id: company.id, role: "assistant", content: reply,
    tool_calls: toolsUsed.length ? toolsUsed : null, model: MODEL, tokens_in: tokensIn, tokens_out: tokensOut,
    diagnostico, tool_results: toolResults.length ? toolResults : null,
    attachments: actionCards.length ? actionCards.map((c) => ({ tipo: "action_card", approval_id: c.approval_id, summary: c.summary, status: c.status })) : null });
  await supa.from("chat_conversations").update({ updated_at: new Date().toISOString() }).eq("id", convId);

  return json({ ok: true, versao: VERSAO, conversation_id: convId, reply, tools_used: toolsUsed.map((t) => t.tool),
    iteracoes_usadas: iteracoes, finish_reason: finishReason, fatos_memoria: (ctxRows ?? []).length,
    preambulos_detectados: preambulos.length, preambulos_recuperados: preambulosUsados,
    deadline_tools: deadlineTools, ms_total: decorrido(),
    teto_tools: tetoTools, cache_write: cacheWrite, cache_read: cacheRead, cache_rejeitado: cacheRejeitado,
    reasoning_rejeitado: reasoningRejeitado, reasoning_tokens: reasoningTokens, usou_fallback: usouFallback,
    hist_msgs_cortadas: histMsgsCortadas,
    toolres_gravados: toolResults.length, toolres_turnos_reinjetados: toolresTurnos,
    toolres_ferramentas_reinjetadas: toolresFerramentas, toolres_chars_reinjetados: toolresChars,
    roteado_para_job: false, motivo_do_roteamento: rota.motivo, familias_de_assunto: rota.familias,
    rota_falhou: rotaFalhou || null,
    tokens_in: tokensIn, tokens_out: tokensOut, attachments_processed: attMeta, attachment_warnings: attNotas, action_cards: actionCards });
});
