// supabase/functions/traffic-chat/index.ts (v28.45)
// v28.45 (20/08/2026) - EMISSAO ENGAJAMENTO (lote 5 cards IMPULSAO):
//   (1) sem_molde em conjunto OUTCOME_ENGAGEMENT/AWARENESS auto-preenche destino
//   Page/IG (nao exige LP/produto CLT) — fecha peca_nova_sem_molde_incompleta;
//   (2) FIN-01 em impulsão educativa: se so falta "Consulte sua margem…", anexa
//   a frase uma vez e revalida (nao recusa hard o card autorizado pelo gestor);
//   (3) auto-continue NAO loopa quando propose_action ja falhou com erro duro
//   (destino/compliance) sem card — reporta o erro em vez de "Continuando…";
//   (4) EMITE OS N: prioridade propose; doutrina proibe re-get_acervo total.
// v28.44 (20/08/2026) - LEGENDAS DURAVEIS ANTI-AMNESIA (IMPULSAO):
//   (1) tabela conversation_legendas + tools get_legendas_da_conversa /
//   registrar_legenda_da_conversa; gerar_legendas grava ao sucesso;
//   (2) bloco LEGENDAS DA CONVERSA reinjetado no historico;
//   (3) HIST_CAP em assistente antigo passa a preservar INICIO+FINAL (legendas
//   no fim de slate longo nao somem); (4) doutrina: nunca dizer "texto integral
//   nao disponivel" sem consultar store+historico; nunca pedir re-colar copy
//   que o agente escreveu nesta conversa.
// v28.43 (20/08/2026) - RETRY OpenRouter 429/502/503 com backoff no chamar() sincrono,
//   alinhado ao traffic-agent-job v3.7: rate-limit nao vira 502 imediato se ainda ha
//   orcamento de parede.
// v28.42 (20/08/2026) - ENGAGEMENT: summary/doutrina sem OR REACH; ON_POST no payload.
//   REACH so em reconhecimento. Meta exige destination_type=ON_POST com POST_ENGAGEMENT.
// v28.41 (20/08/2026) - CONJUNTO DE ENGAJAMENTO: sem_molde OU molde LEADS so para targeting.
//   PROIBIDO bloquear com "nao ha molde POST_ENGAGEMENT" / "so no Ads Manager" / "aguardar Ryan".
//   Campanha OUTCOME_ENGAGEMENT ja criada: emitir criar_conjunto com objetivo_tag=ENGAJAMENTO.
// v28.40 (20/08/2026) - ANTI-ALUCINACAO DE CARD EMITIDO (incidente IMPULSAO SOCIAL):
//   Agente escreveu "## Card emitido — aguardando aprovação" sem approval_id: 1o
//   propose falhou (target_name="composto"), 2o caiu no deadline, sintese inventou
//   o ato. Conserto: (1) filtro pos-sintese reescreve claim sem actionCards;
//   (2) target_name placeholder (composto/nome_composto/…) = omitir; (3) papel
//   espelhado na raiz do payload; (4) RE_PEDIDO_DE_ATO aceita "emissao";
//   (5) claim falso NAO fecha o turno — permite auto-continuar a emissao.
// v28.39 (20/08/2026) - OBJETIVOS ODAX DE ENGAJAMENTO/RECONHECIMENTO (IMPULSAO SOCIAL):
//   criar_campanha aceita ENGAJAMENTO/POST_ENGAGEMENT/RECONHECIMENTO (e deriva ODAX da
//   objetivo_tag se params.objetivo omitido). Canal SOCIAL + Page/IG permitidos nesta
//   familia; CLT+LP continua o default da casa. criar_conjunto propaga familia_objetivo
//   + page_id para o executor sobrescrever OFFSITE_CONVERSIONS do molde.
// v28.38 (20/08/2026) - CONTINUACAO AUTOMATICA SO EM TURNO INCOMPLETO:
//   v28.37 disparava continuar quando pedido_ato + deadline + zero cards, mesmo com
//   resposta completa (contradicão / pergunta de decisao). Agora so retoma se:
//   (1) orcamento esgotou com reply vazia/parcial mid tool-loop, OU
//   (2) fluxo de ato com propose_action/emissão em andamento e card ainda nao saiu.
//   Resposta substantiva que fecha o turno (clarificacao, recusa pendente de decisao)
//   NAO grava checkpoint nem continua. Copy de "emitir pedido(s)" so quando de fato
//   havia emissao pendente — nao quando o modelo so esclarece.
// v28.37 (20/08/2026) - CONTINUACAO AUTOMATICA DO TURNO SINCRONO:
//   Quando o orcamento (~118s) esgota no meio do loop (ato/criar, tools, sintese),
//   grava turn_checkpoint em chat_conversations e devolve { continuar:true } em vez
//   do aviso "Nao deu tempo… Peça de novo…". O front (ou body.continuar) retoma do
//   checkpoint no mesmo conversation_id ate emitir cards/reply. Segmentos sob o
//   teto de gateway (~150s) — nunca falha como UX final em fluxo de ato.
// v28.36 (20/08/2026) - REVERTE analise profunda como default:
//   Q&A volta ao sync traffic-chat; job so com toggle do gestor OU auto-rota antiga
//   (>=5 familias / >=1500 chars), com guarda de meio-de-fio. Mantem filtro de
//   preambulo anti-intencao (v28.35) e atalho Opportunity Score / orcamento 2 min.
// v28.35 (20/08/2026) - ANALISE PROFUNDA PADRAO + PROIBE RESPOSTA DE INTENCAO:
//   Q&A de analise vai ao traffic-agent-job por default (frontend e edge). Sync fica
//   so para ato (propose_action), anexo e costura de continuacao. Doutrina: nunca
//   enviar mensagem que so narra o que "vai" consultar — tools rodam, depois UMA
//   resposta completa. Preambulos de intencao ("vou cruzar/ler/consultar") nao entram
//   no reply. (roteamento default revertido em v28.36; filtro de preambulo permanece)
// v28.34 (20/08/2026) - DICAS DA META AO VIVO (Opportunity Score):
//   O atalho meta-dicas lia so o banco; meta_recommendations estava vazio em TODAS as
//   empresas porque a coleta v15 so sondava o campo classico `recommendations` (nunca
//   populou). O badge do Ads Manager vem de GET /act_*/recommendations. Agora o atalho
//   dispara meta-campaign-status {modo:meta_dicas} ANTES de get_meta_dicas, e a doutrina
//   separa fila interna (get_recommendations) do badge da Meta.
// v28.33 (20/08/2026) - ORCAMENTO 2 MIN + PROSA (nao JSON) NAS DICAS DA META:
//   Pos-v28.32 o atalho meta-dicas terminava, mas a sintese OpenRouter abortava no
//   OPENROUTER_CALL_CAP 45s e o fallback colava JSON bruto ("tempo de sintese estourou").
//   Conserto: (1) orcamento operacional de ~2 min (HARD_LIMIT 118s, margem sob IDLE ~150s
//   nao configuravel da plataforma); (2) TOOLS_DEADLINE 55s + OPENROUTER_CALL_CAP 70s para
//   sobrar >=40-60s de prosa; (3) payload compacto no atalho; (4) fallback deterministico
//   em portugues a partir dos campos estruturados — NUNCA dump de JSON no chat.
// v28.32 (20/08/2026) - FIM DOS 504 RECORRENTES (incidente Legal 20/08 ~13:27 e ~13:34 UTC):
//   Evidencia: POST 504 no gateway a ~150s; um turno de "emita o card" gravou ms_total=170668
//   (depois do 504); a pergunta de dicas da Meta nao gravou reply nenhum. Causa: o deadline
//   so era checado ENTRE iteracoes, e o fetch ao OpenRouter nao tinha AbortSignal — uma
//   unica geracao com ~112k tokens_in + propose/sintese estourava o IDLE_TIMEOUT da
//   plataforma. Conserto: (1) HARD_LIMIT 125s + TOOLS_DEADLINE 50s; (2) AbortSignal por
//   chamada OpenRouter no tempo restante; (3) deadline ANTES de cada tool do lote;
//   (4) atalho sincrono para pergunta de dicas/recomendacoes da Meta (get_meta_dicas +
//   get_recommendations, sem Pipeboard); (5) prioridade/doutrina anti-Pipeboard nesse caso.
// v28.31 (20/08/2026) - Emite lote sem re-perguntar: MAX_TOOLS_TURNO 24; propose_action
//   ate 10; criar_anuncio nao e cortado pelo teto global; get_acervo aceita
//   drive_file_ids (recorte) + compactacao; doutrina "emite os N" fecha o ato;
//   child_attachments entra no payload do card (carrossel real).
// v28.30 (17/08/2026) - Auditoria financeira fechada: get_campaign_detail expoe
//   special_ad_categories; nova tool auditar_compliance_financeira; prompt proibe
//   "nao tenho tool" para categoria especial / regras Meta se compliance e Pipeboard
//   existem. Categoria especial e de CAMPANHA (herdada pelos anuncios).
// v28.29 (15/08/2026) - Campanha/conjunto nascem ACTIVE na aprovacao; ativar_campanha /
//   ativar_conjunto espelham ativar_criativo. Pausar ja existia nos tres niveis.
// v28.28 (15/08/2026) - Aprovar criar_anuncio = nasce ACTIVE (nao PAUSED).
//   Campanha/conjunto continuam PAUSED. Nova acao ativar_criativo para religar
//   anuncio ja pausado. Doutrina/prompt alinhados ao contrato 15/08.
// v28.27 (15/08/2026) - Autonomia do super-gestor na emissao de criar_anuncio:
//   (1) legenda_fonte=agente: legenda_referencias autofill (molde / anuncio do conjunto /
//       anuncio_substituido) — NUNCA devolver essa trava como pergunta ao humano;
//   (2) ESP-40: defaults marca/canal/objetivo/periodo/produto quando omitidos;
//   (3) utm_campaign: deriva do rotulo/periodo se o gestor nao deu identificador;
//   (4) plataformas de conjunto: default facebook+instagram (Threads continua bloqueado);
//   (5) molde inexistente com cara de nome composto = erro de invencao, lista candidatos reais;
//   (6) prompt: montar a solucao e emitir o card; humano so aprova atos drasticos.
// v28.26 (12/08/2026) - ESP-41: tool ler_entregas_digest (RPC read-only) — config de cadencia/
//   destino do digest + entregas recentes (digest e alerta critico) com status por entrega.
// v28.25 (12/08/2026) - ESP-30: tool saude_dos_tokens (RPC read-only) — dias para expirar/
//   data_access e escopos faltando por token Meta (ads/waba), veredito por token. Le meta_tokens
//   (metadado, nunca o valor); populado pelo meta-token-monitor. NAO chama a Graph.
// v28.24 (12/08/2026) - ESP-38: tool score_de_prontidao (RPC read-only) — score 0-100 de
//   prontidao da empresa (config, integracao viva, postura, brand, destino, driver) com nivel,
//   checks itemizados, bloqueios e recomendacoes. NAO altera nada, NAO substitui gates por pedido.
// v28.23 (12/08/2026) - ESP-36: tool ler_brand_identity (RPC read-only) — voz/tom, dos/donts,
//   disclaimers e linhas de produto por empresa; motor de legenda (gerar_legendas) ja consome.
// v28.22 (12/08/2026) - ESP-34: tools computar_perfil_vencedor / ler_perfil_vencedor (RPC
//   read-only). Versiona por empresa o perfil do vencedor (regua evaluate_winners/ESP-01 +
//   procedencia ESP-33). Nao substitui get_recommendations nem aprovacao humana de escala.
// v28.21 (12/08/2026) - ESP-37: tool gerar_legendas (framework Hook→Beneficio→CTA+CET, N=3).
//   Proxy para edge gerar-legendas; nao emite card. Pedido de legendas usa a tool, nao improvisa.
// v28.20 (12/08/2026) - ESP-39: papel TESTE|ESCALA obrigatorio em criar/renomear campanha;
//   escalar_duplicar nao permanece em campanha TESTE (exige campanha_destino ESCALA).
// v28.19 (12/08/2026) - ESP-40: nomenclatura por campos. criar_campanha / criar_conjunto /
//   criar_anuncio / renomear_campanha MONTAO o nome a partir de marca+canal+objetivo_tag+periodo
//   (+ produto/rotulo opcionais). Nome livre recusado. Padrao [MARCA][CANAL][OBJ][PROD?][ROT?][PER].
// v28.18 (12/08/2026) - ESP-25: propose escalar_duplicar (escrita sancionada). Emite card so
//   se avaliar_escala.apto_a_escalar; orcamento travado em +20% da RPC; mesma campanha do molde;
//   targeting herdado (sem redes livres). redistribuir_orcamento NAO entra. alterar_orcamento
//   permanece o caminho de EDICAO de verba (nao de escala).
// v28.17 (12/08/2026) - ESP-24: propose_action pausar_conjunto (ad set → PAUSED). Guarda do
//   unico conjunto entregando via decidir_sobre_conjunto: se restariam 0, NAO emite card.
//   Ativar continua FORA do sistema (gestor no Gerenciador). Sem ativar_*.
// v28.16 (12/08/2026) - ESP-35: peca nova SEM molde (target_name=sem_molde / params.sem_molde).
//   page_id + CTA + destino_url vindos da config/pedido; replicacao pura continua exigindo molde.
// v28.15 (12/08/2026) - ESP-33: tool casar_criativo_performance (RPC read-only peca↔anuncio↔metricas+amostra).
// v28.14 (12/08/2026) - ESP-26: alterar_orcamento tambem passa por avaliar_orcamento_diario
//   ANTES de emitir o card (mesma RPC da criacao de conjunto e da execucao em meta-actions).
//   Fail-closed: RPC indisponivel = nao emite. Helper compartilhado: _shared/avaliar_orcamento.ts.
// v28.13 (11/08/2026) - CARD DE POSICIONAMENTO POR CONJUNTO. propose_action reconhece
//   ajustar_posicionamentos_do_conjunto, resolve o alvo em ad_sets (nao campanhas), exige
//   formato_midia video|imagem e deixa a derivacao da exclusao para o executor. O card fica
//   pending; nenhuma escrita acontece na emissao.
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
import { julgarOrcamentoDiario } from "../_shared/avaliar_orcamento.ts";
import { resolverNomePartesDoParams, classificarPapelCampanha } from "../_shared/nomenclatura.ts";
import {
  resolverObjetivoOdax,
  familiaDeObjetivo,
  ehFamiliaSocialTopo,
  mensagemObjetivoNaoSuportado,
  ODAX_OBJETIVOS,
} from "../_shared/objetivo_odax.ts";
import { urlDestinoSocialTopo } from "../_shared/destino_url_lp.ts";
import { pipeboardToken } from "../_shared/pipeboard.ts";
import {
  callReadTool,
  companyMetaAccounts,
  isReadOnlyTool,
  listReadTools,
  scopeArgsToCompany,
  truncatePipeboardPayload,
} from "../_shared/pipeboard_read.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const OPENROUTER_KEY = (Deno.env.get("OPENROUTER_API_KEY") ?? "").trim();
const MODEL = (Deno.env.get("OPENROUTER_MODEL") ?? "openai/gpt-5.6-luna").trim();
// v28: OPENROUTER_MODEL = chat principal; OPENROUTER_MODEL_SUB = subagentes do traffic-agent-job.
// 20/08/2026: padrao da casa = OpenAI GPT-5.6 Luna (slug OpenRouter openai/gpt-5.6-luna).
// no modelo atual (extracao estrita nao precisa de Opus e custa 5x). Nada a mudar AQUI alem
// do secret; a separacao e feita na edge do job.
// v28.1: credencial do Drive (mesma service account do job) + pasta raiz dos criativos.
const GOOGLE_SA_KEY_B64 = (Deno.env.get("GOOGLE_SA_KEY_B64") ?? "").trim();
const DRIVE_CRIATIVOS_FOLDER_ID = (Deno.env.get("DRIVE_CRIATIVOS_FOLDER_ID") ?? "").trim();
const MAX_ITER = 10;
// v20: teto de ferramentas por turno. 14 tools medidas em 2 turnos consecutivos, com 5
// chamadas ao compliance-check a 3-6s cada. Corta tempo e tokens ao mesmo tempo.
// v28.31 (20/08/2026): 12 era pouco para "emite N cards" (acervo + notes + N×propose).
// 24 cobre lote de 5 criar_anuncio + leituras curtas sem forcar o gestor a repetir "emite".
const MAX_TOOLS_TURNO = 24;
// v23: o gargalo de tempo era REPETICAO, nao variedade. check_compliance custa 3-6s por
// chamada e foi chamada 5x num unico turno. Limite por ferramenta resolve na origem.
// v28.7: get_estrutura_conjuntos com teto 3. Sao 46 conjuntos relevantes em paginas de 20 - com o
// default 2 o agente ficaria ESTRUTURALMENTE impedido de ver o universo completo, recriando o
// problema do universo parcial numa forma nova, agora causada pelo proprio limite.
// v28.31: propose_action default=2 matava lote de 5 cards; carve-out dedicado abaixo.
const MAX_POR_FERRAMENTA: Record<string, number> = {
  check_compliance: 3,
  gerar_legendas: 3,
  registrar_legenda_da_conversa: 8,
  get_legendas_da_conversa: 2,
  get_estrutura_conjuntos: 3,
  listar_ferramentas_pipeboard: 2,
  ler_pipeboard: 5,
  propose_action: 10,
  get_acervo_para_anuncio: 3,
  nota_visual_da_peca: 6,
};
const MAX_POR_FERRAMENTA_DEFAULT = 2;
// propose_action de criacao nao consome o teto global do turno (so o teto por ferramenta).
// Assim releituras opcionais nao "roubam" as vagas dos cards quando o slate ja esta no chat.
const ACOES_CRIACAO_NO_TETO = ["criar_campanha", "criar_conjunto_a_partir_de", "criar_anuncio_a_partir_de", "escalar_duplicar"];
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
const VERSAO = "chat-v28.45";
// Continuacao automatica do turno sincrono (espelho do checkpoint do job).
const MAX_TURN_SEGMENTS = 4;
const REPLY_CONTINUANDO =
  "Continuando automaticamente a partir do ponto em que o orçamento desta janela esgotou.";
const REPLY_CONTINUANDO_ATO =
  "Montando os pedidos de aprovação — continuando automaticamente a partir do ponto em que o orçamento desta janela esgotou.";
const RE_CONTINUAR_AUTO =
  /^\[continuacao automatica do sistema|^montando os pedidos de aprovacao — continuando|^continuando automaticamente a partir/i;
// Narracao mid-loop ("vou consultar…") — nao conta como resposta que fecha o turno.
const RE_INTENCAO =
  /\b(vou|deixe-?me|deixa eu|irei|vou apenas)\b.{0,80}\b(cruzar|ler|consultar|verificar|checar|buscar|abrir|olhar|coletar|apurar|rodar|chamar|emitir|criar|propor)\b/i;
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
// v27.1 / v28.44: caps do corte de historico. HIST_CAP e o teto por mensagem; a mensagem de
// USUARIO mais recente tem teto maior. Assistente longo usa cabeca+cauda (como user): em
// 20/08 o corte so no inicio escondeu legendas no FINAL de um slate de 10k chars e o agente
// inventou "texto integral nao disponivel". Store conversation_legendas e a fonte duravel.
const HIST_CAP = 6000;
const HIST_CAP_USER_RECENTE = 12000;
const HIST_CAP_ASSIST_COM_LEGENDA = 10000;
// v19/v28.33 - orcamento de tempo (~2 min operacional). Teto da plataforma = ~150s
// (IDLE_TIMEOUT do gateway Supabase, NAO configuravel no projeto). Pedido do gestor:
// 120s de orcamento util. HARD_LIMIT 118s deixa folga para gravar a reply antes do corte
// de plataforma. TOOLS_DEADLINE 55s reserva >=40-60s para prosa. OPENROUTER_CALL_CAP 70s
// evita o abort prematuro da sintese que, em v28.32, caia no dump de JSON.
const TOOLS_DEADLINE_MS = 55_000;
const HARD_LIMIT_MS = 118_000;
const RESERVA_GRAVACAO_MS = 8_000;
const OPENROUTER_CALL_CAP_MS = 70_000;
// Atalho meta-dicas: tetos do payload enviado ao LLM (persistencia em tool_results continua
// com TOOLRES_TETO_PERSIST; aqui so enxugamos o que a sintese precisa ler).
const META_DICAS_LLM_ITENS = 24;
const META_DICAS_LLM_MSG = 280;
const META_RECOS_LLM_ITENS = 12;
// Sonnet gera ~85 tok/s; usamos 60 para ser conservador. Grok 4.6 e mais lento sob contexto
// grande — o AbortSignal e a defesa real, nao so o teto de tokens.
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
// Data no fuso da operacao (BRT). Em UTC, depois das 21h de Brasilia a data virava o dia
// seguinte e o agente passava a tratar amanha como hoje.
const today = () => new Date().toLocaleDateString("en-CA", { timeZone: "America/Sao_Paulo" });
const brl = (n: number) => "R$ " + (Math.round(n * 100) / 100).toFixed(2);
const deacc = (s: string) => s.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
const norm = (s: string) => deacc(s.toLowerCase()).replace(/[-_\s]+/g, "");
// v25: slug para UTM. Gerado no CODIGO - a cobertura de UTM e KPI e nao pode depender de o
// modelo lembrar de montar a string certa.
const slug = (s: string) => deacc(String(s).toLowerCase()).replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60);

/** Periodo Meta no padrao AGO26 a partir de hoje (BRT). */
function periodoMetaAtual(): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Sao_Paulo",
    month: "short",
    year: "2-digit",
  }).formatToParts(new Date());
  const mon = (parts.find((p) => p.type === "month")?.value ?? "Jan").slice(0, 3).toUpperCase();
  const map: Record<string, string> = {
    JAN: "JAN", FEB: "FEV", MAR: "MAR", APR: "ABR", MAY: "MAI", JUN: "JUN",
    JUL: "JUL", AUG: "AGO", SEP: "SET", OCT: "OUT", NOV: "NOV", DEC: "DEZ",
  };
  const yy = parts.find((p) => p.type === "year")?.value ?? "26";
  return `${map[mon] ?? mon}${yy}`;
}

/**
 * Autofill de legenda_referencias quando a autoria e do agente.
 * A trava de rastreio e para o CARD (humano aprova), nao para entrevista no chat.
 */
async function resolverLegendaReferenciasAgente(opts: {
  companyId: string;
  refsExplicitas: unknown;
  moldeNome?: string | null;
  nomeAlvo?: string | null;
  semMolde: boolean;
  adsetExternalId?: string | null;
  params: Record<string, unknown>;
}): Promise<{ refs: string[]; origem: string }> {
  const out: string[] = [];
  let origem = "vazio";
  const push = (raw: unknown, origemHint: string) => {
    const s = String(raw ?? "").trim();
    if (!s) return;
    if (out.some((x) => norm(x) === norm(s))) return;
    out.push(s);
    if (origem === "vazio") origem = origemHint;
  };

  if (Array.isArray(opts.refsExplicitas)) {
    for (const r of opts.refsExplicitas) push(r, "params");
  }
  push(opts.params?.anuncio_base, "anuncio_base");
  push(opts.params?.anuncio_substituido, "anuncio_substituido");
  push(opts.params?.referencia_legenda, "referencia_legenda");
  push(opts.params?.peca_substituida, "peca_substituida");
  if (opts.moldeNome) push(opts.moldeNome, "molde");
  if (!opts.semMolde && opts.nomeAlvo && norm(String(opts.nomeAlvo)) !== "semmolde") {
    push(opts.nomeAlvo, "target_name");
  }

  if (out.length === 0 && opts.adsetExternalId) {
    const { data: ads } = await supa
      .from("ads")
      .select("name,status,updated_at")
      .eq("company_id", opts.companyId)
      .eq("adset_external_id", opts.adsetExternalId)
      .order("updated_at", { ascending: false })
      .limit(5);
    const prefer = (ads ?? []).find((a: any) => /PAUSED/i.test(String(a.status ?? "")))
      ?? (ads ?? [])[0];
    if (prefer?.name) push(prefer.name, "anuncio_do_mesmo_conjunto");
  }

  return { refs: out, origem: out.length ? origem : "vazio" };
}

async function resolveCompany(name?: string): Promise<{ id: string; name: string } | null> {
  const { data } = await supa.from("companies").select("id,name");
  if (!data?.length || !name?.trim()) return null;
  const needle = norm(name);
  const exact = data.filter((c) => norm(c.name) === needle);
  if (exact.length === 1) return exact[0];
  const partial = data.filter((c) => norm(c.name).includes(needle) || needle.includes(norm(c.name)));
  return partial.length === 1 ? partial[0] : null;
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

/** Compacta get_meta_dicas para a sintese LLM — menos tokens, mesma leitura acionavel. */
function compactMetaDicasParaLlm(raw: any): any {
  if (raw == null) return null;
  if (typeof raw !== "object") return raw;
  if (raw.erro) return { erro: String(raw.erro) };
  const lista = Array.isArray(raw.dicas) ? raw.dicas : [];
  const slim = lista.slice(0, META_DICAS_LLM_ITENS).map((d: any) => ({
    title: d?.title ?? null,
    message: String(d?.message ?? "").slice(0, META_DICAS_LLM_MSG),
    importance: d?.importance ?? null,
    object_type: d?.object_type ?? null,
    object_name: d?.object_name ?? null,
    campaign_name: d?.campaign_name ?? null,
    veredito: d?.veredito ?? null,
    veredito_motivo: String(d?.veredito_motivo ?? "").slice(0, 220),
    first_seen_on: d?.first_seen_on ?? null,
    last_seen_on: d?.last_seen_on ?? null,
    ainda_ativa_hoje: d?.ainda_ativa_hoje ?? null,
  }));
  return {
    empresa: raw.empresa ?? null,
    janela_dias: raw.janela_dias ?? null,
    desde: raw.desde ?? null,
    total: raw.total ?? lista.length,
    por_veredito: raw.por_veredito ?? {},
    dicas: slim,
    dicas_omitidas: Math.max(0, lista.length - slim.length),
    nota: "Payload compactado para sintese. Cite o veredito interno; nao invente dicas ausentes.",
  };
}

/** Compacta a fila interna para a sintese LLM. */
function compactRecosParaLlm(raw: any): any {
  if (raw == null) return null;
  if (typeof raw !== "object") return raw;
  const lista = Array.isArray(raw.recomendacoes_pendentes) ? raw.recomendacoes_pendentes : [];
  return {
    recomendacoes_pendentes: lista.slice(0, META_RECOS_LLM_ITENS).map((r: any) => ({
      title: r?.title ?? null,
      impact: r?.impact ?? null,
      category: r?.category ?? null,
      description: String(r?.description ?? "").slice(0, 280),
      status: r?.status ?? null,
      created_at: r?.created_at ?? null,
    })),
    omitidas: Math.max(0, lista.length - Math.min(lista.length, META_RECOS_LLM_ITENS)),
    nota: raw.nota ?? null,
  };
}

function rotuloVereditoPt(v: unknown): string {
  const key = String(v ?? "").toLowerCase();
  const map: Record<string, string> = {
    concorda: "Concordamos",
    discorda: "Discordamos",
    nao_aplicavel: "Não aplicável à régua",
    sem_regua: "Sem régua ainda",
  };
  return map[key] || (key ? String(v) : "sem veredito");
}

/**
 * Fallback deterministico em portugues quando a sintese OpenRouter falha/estoura.
 * Usa SO campos ja lidos do banco — NUNCA inventa dica nem cola JSON bruto no chat.
 */
function formatarResumoMetaDicasPt(dicasRaw: any, recosRaw: any): string {
  const blocos: string[] = [];
  const d = dicasRaw && typeof dicasRaw === "object" ? dicasRaw : null;
  if (d?.erro) {
    blocos.push(`Não consegui ler as dicas da Meta no banco (${String(d.erro).slice(0, 160)}).`);
  } else if (d) {
    const janela = Number(d.janela_dias ?? 14) || 14;
    const total = Number(d.total ?? 0) || 0;
    const lista = Array.isArray(d.dicas) ? d.dicas : [];
    const empresa = d.empresa ? ` — ${String(d.empresa)}` : "";
    const counts = d.por_veredito && typeof d.por_veredito === "object" ? d.por_veredito : {};
    const partesCount = Object.entries(counts)
      .filter(([, n]) => Number(n) > 0)
      .map(([k, n]) => `${rotuloVereditoPt(k).toLowerCase()}: ${n}`)
      .join("; ");
    blocos.push(`## Dicas da Meta (últimos ${janela} dias)${empresa}`);
    if (total === 0 || lista.length === 0) {
      blocos.push(
        "Não há dica da Meta na Graph nesta janela (Opportunity Score / Recommendation Center + campo clássico). " +
          "Isso não inventa o badge do Ads Manager: a Meta documenta que a API pode listar menos itens que a coluna da UI. " +
          "A fila interna abaixo NÃO é recomendação do Ads Manager.",
      );
    } else {
      blocos.push(
        `Encontrei **${total}** dica(s) no banco` +
          (partesCount ? ` (${partesCount})` : "") +
          ". Abaixo, o veredito interno de cada uma — a sugestão da Meta não é a nossa.",
      );
      const maxShow = 18;
      for (const item of lista.slice(0, maxShow)) {
        const titulo = String(item?.title ?? "Dica sem título").trim() || "Dica sem título";
        const onde = [
          item?.object_type ? String(item.object_type) : "",
          item?.object_name ? String(item.object_name) : "",
          item?.campaign_name ? `campanha ${String(item.campaign_name)}` : "",
        ].filter(Boolean).join(" · ");
        const imp = item?.importance ? ` · impacto Meta: ${String(item.importance)}` : "";
        const ver = rotuloVereditoPt(item?.veredito);
        const motivo = String(item?.veredito_motivo ?? "").trim();
        const msg = String(item?.message ?? "").trim().slice(0, 220);
        const ativa = item?.ainda_ativa_hoje === true ? " (ainda ativa hoje)" : "";
        const linhasItem = [
          `### ${titulo}${ativa}`,
          onde ? `- Onde: ${onde}${imp}` : (imp ? `- ${imp.replace(/^ · /, "")}` : null),
          `- Veredito interno: **${ver}**` + (motivo ? ` — ${motivo.slice(0, 220)}` : ""),
          msg ? `- O que a Meta escreveu: ${msg}` : null,
          `- Próximo passo: ${
            String(item?.veredito ?? "").toLowerCase() === "concorda"
              ? "avaliar se cabe agir nesta conta com card explícito."
              : String(item?.veredito ?? "").toLowerCase() === "discorda"
              ? "não seguir a sugestão da Meta; manter a régua interna."
              : String(item?.veredito ?? "").toLowerCase() === "nao_aplicavel"
              ? "ignorar para decisão de mídia — fora da régua."
              : "aguardar classificação interna antes de agir."
          }`,
        ].filter(Boolean);
        blocos.push(linhasItem.join("\n"));
      }
      if (lista.length > maxShow) {
        blocos.push(`_…e mais ${lista.length - maxShow} dica(s) no banco nesta janela (peça um recorte se quiser o restante)._`);
      }
    }
  } else {
    blocos.push("## Dicas da Meta\nNão há retorno estruturado de dicas neste turno.");
  }

  const r = recosRaw && typeof recosRaw === "object" ? recosRaw : null;
  const fila = Array.isArray(r?.recomendacoes_pendentes) ? r.recomendacoes_pendentes : [];
  blocos.push("## Fila interna (régua de mídia)");
  if (fila.length === 0) {
    blocos.push("Nenhuma recomendação interna pendente no momento.");
  } else {
    blocos.push(`Há **${fila.length}** item(ns) pendente(s) na fila interna (custo de mídia, não contrato pago):`);
    for (const item of fila.slice(0, 10)) {
      const titulo = String(item?.title ?? "Recomendação").trim() || "Recomendação";
      const impact = item?.impact != null ? String(item.impact) : null;
      const cat = item?.category != null ? String(item.category) : null;
      const desc = String(item?.description ?? "").trim().slice(0, 220);
      const meta = [cat, impact ? `impacto ${impact}` : null].filter(Boolean).join(" · ");
      blocos.push(
        `- **${titulo}**` +
          (meta ? ` (${meta})` : "") +
          (desc ? `: ${desc}` : "") +
          " — próximo passo: revisar e decidir se vira card.",
      );
    }
    if (fila.length > 10) {
      blocos.push(`_…e mais ${fila.length - 10} na fila._`);
    }
  }

  blocos.push(
    "_Leitura direta do que já está no banco (sem inventar). Se quiser aprofundar um objeto ou emitir card, peça o recorte._",
  );
  return blocos.join("\n\n");
}

async function t_rpc(nome: string, parametros: Record<string, unknown>) {
  const { data, error } = await supa.rpc(nome, parametros);
  return error ? { erro: `falha ao chamar ${nome}: ${error.message}` } : data;
}
async function t_funnel(companyId: string, date_from?: string, date_to?: string) {
  let q = supa.from("metric_snapshots").select("campaign_id,snapshot_date,spend,impressions,clicks,link_clicks,landing_page_views,form_leads,messaging_started").eq("company_id", companyId);
  if (date_from) q = q.gte("snapshot_date", date_from);
  if (date_to) q = q.lte("snapshot_date", date_to);
  const { data } = await q;
  const linhas = data ?? [];
  const s = linhas.reduce((a, r) => ({
    spend: a.spend + Number(r.spend || 0), imp: a.imp + Number(r.impressions || 0), clk: a.clk + Number(r.clicks || 0),
    link: a.link + Number(r.link_clicks || 0), lpv: a.lpv + Number(r.landing_page_views || 0),
    forms: a.forms + Number(r.form_leads || 0), msg: a.msg + Number(r.messaging_started || 0),
  }), { spend: 0, imp: 0, clk: 0, link: 0, lpv: 0, forms: 0, msg: 0 });
  // v29 (14/08): custo por resultado nao pode diluir gasto de campanha que nem persegue o evento.
  // Sem este recorte, os R$ 602 de engajamento (0 conversa) entraram no custo por conversa do
  // periodo de mensagens e inflaram a regua real de R$ 21,13 para R$ 31,89 (auditoria COHAPM).
  const porCampanha = new Map<string, { spend: number; forms: number; msg: number }>();
  for (const r of linhas) {
    const k = String(r.campaign_id ?? "sem_campanha");
    const cur = porCampanha.get(k) ?? { spend: 0, forms: 0, msg: 0 };
    cur.spend += Number(r.spend || 0);
    cur.forms += Number(r.form_leads || 0);
    cur.msg += Number(r.messaging_started || 0);
    porCampanha.set(k, cur);
  }
  const gastoOnde = (tem: (v: { forms: number; msg: number }) => boolean) =>
    [...porCampanha.values()].filter(tem).reduce((a, v) => a + v.spend, 0);
  const gastoComForm = gastoOnde((v) => v.forms > 0);
  const gastoComConversa = gastoOnde((v) => v.msg > 0);
  const semEvento = [...porCampanha.values()].filter((v) => v.spend > 0 && v.forms === 0 && v.msg === 0);
  const datas = linhas.map((r) => r.snapshot_date).sort();
  return { periodo_solicitado: { de: date_from ?? "inicio", ate: date_to ?? "hoje" },
    janela_sem_data_informada: !date_from && !date_to ? "ATENCAO: nenhuma data foi passada, entao esta e a serie INTEIRA da empresa (veja cobertura_real). NAO chame isso de '7 dias' nem atribua a uma campanha especifica." : undefined,
    cobertura_real: { primeiro_dia: datas[0] ?? null, ultimo_dia: datas[datas.length - 1] ?? null, dias_com_dado: new Set(datas).size },
    funil_midia: { impressoes: s.imp, cliques_todos: s.clk, cliques_no_link: s.link, visualizacoes_lp: s.lpv, formularios: s.forms, conversas_whatsapp: s.msg },
    gasto: brl(s.spend),
    custos: { por_clique_no_link: s.link ? brl(s.spend / s.link) : null, por_visualizacao_lp: s.lpv ? brl(s.spend / s.lpv) : null,
      por_formulario: s.forms ? brl(gastoComForm / s.forms) : null, por_conversa: s.msg ? brl(gastoComConversa / s.msg) : null,
      gasto_base_do_por_formulario: s.forms ? brl(gastoComForm) : null,
      gasto_base_do_por_conversa: s.msg ? brl(gastoComConversa) : null },
    gasto_de_campanhas_sem_formulario_nem_conversa: semEvento.length ? brl(semEvento.reduce((a, v) => a + v.spend, 0)) : null,
    campanhas_sem_formulario_nem_conversa: semEvento.length,
    nota: "funil de MIDIA agregado da conta. cliques_todos = todos os cliques; cliques_no_link = so os que levam ao destino - nao misture as bases. visualizacoes_lp e resultado valido, reporte. CUSTO POR RESULTADO: por_formulario e por_conversa usam SO o gasto das campanhas que registraram aquele evento (veja gasto_base_do_*), justamente para nao diluir a regua com campanha que nem persegue o evento - e PROIBIDO recalcular dividindo `gasto` total pelo evento. Se a janela mistura objetivos (ex.: periodo de mensagens + periodo de engajamento), diga QUAL campanha sustenta o custo antes de usar como benchmark. Proposta/contrato/receita estao FORA do escopo desde 28/07/2026 - nao existe fonte de conversao final; trate custo por clique/LP como proxy e declare isso." };
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
  const { data: all } = await supa
    .from("campaigns")
    .select("id,name,status,category,spend,special_ad_categories,objective,external_id")
    .eq("company_id", companyId);
  const needle = norm(name_like);
  const camps = (all ?? []).filter((c) => norm(c.name).includes(needle)).slice(0, 3);
  if (!camps.length) return { erro: `nenhuma campanha com nome contendo '${name_like}'` };
  const c = camps[0];
  const from = new Date(Date.now() - 14 * 864e5).toISOString().slice(0, 10);
  const { data: serie } = await supa.from("metric_snapshots")
    .select("snapshot_date,spend,impressions,reach,clicks,link_clicks,form_leads,messaging_started,frequency,landing_page_views")
    .eq("campaign_id", c.id).gte("snapshot_date", from).order("snapshot_date");
  const rows = serie ?? [];
  const num = (v: unknown) => Number(v || 0);
  const pct = (n: number, d: number) => d > 0 ? `${(100 * n / d).toFixed(2)}%` : null;
  // v30 (14/08): o campo 'alcance' no total foi apresentado pelo agente como "total do periodo
  // reportado pela plataforma" mesmo com a flag alcance_e_soma_dos_dias=true ao lado. Aviso em
  // campo separado nao segura a interpretacao; o nome do campo passou a carregar a semantica.
  // Tambem: media diaria agora sai pronta SO com dias fechados, porque dividir pelo dia corrente
  // parcial diluiu a media (R$ 61 aparente vs R$ 80 real no Juridico) e mascarou estouro de verba.
  const hoje = new Date().toISOString().slice(0, 10);
  const linhaDia = (s: Record<string, unknown>) => {
    const spend = num(s.spend), imp = num(s.impressions), clkTodos = num(s.clicks), clkLink = num(s.link_clicks);
    return {
      dia: s.snapshot_date, gasto: brl(spend), impressoes: imp, alcance: num(s.reach),
      frequencia: s.frequency != null ? Number(num(s.frequency).toFixed(2)) : null,
      cliques_todos: clkTodos, cliques_no_link: clkLink, visualizacoes_lp: num(s.landing_page_views),
      formularios: num(s.form_leads), conversas: num(s.messaging_started),
      ctr_todos: pct(clkTodos, imp), ctr_link: pct(clkLink, imp),
      cpc_todos: clkTodos ? brl(spend / clkTodos) : null, cpc_link: clkLink ? brl(spend / clkLink) : null,
      cpm: imp ? brl(1000 * spend / imp) : null,
      ...(String(s.snapshot_date) === hoje ? { dia_parcial_em_coleta: true } : {}),
    };
  };
  const tot = rows.reduce((a, s: Record<string, unknown>) => ({
    spend: a.spend + num(s.spend), imp: a.imp + num(s.impressions), reach: a.reach + num(s.reach),
    clkTodos: a.clkTodos + num(s.clicks), link: a.link + num(s.link_clicks), lpv: a.lpv + num(s.landing_page_views),
    forms: a.forms + num(s.form_leads), msg: a.msg + num(s.messaging_started),
  }), { spend: 0, imp: 0, reach: 0, clkTodos: 0, link: 0, lpv: 0, forms: 0, msg: 0 });
  const fechados = rows.filter((s: Record<string, unknown>) => String(s.snapshot_date) < hoje);
  const gastoFechado = fechados.reduce((a, s: Record<string, unknown>) => a + num(s.spend), 0);
  const cats = Array.isArray((c as any).special_ad_categories)
    ? (c as any).special_ad_categories
    : [];
  return {
    campanha: {
      nome: c.name,
      external_id: (c as any).external_id ?? null,
      status: c.status,
      objetivo: (c as any).objective ?? null,
      categoria_interna: c.category,
      // v28.30: campo que o agente omitia — especial financeira vive na CAMPANHA e vale para todos os anuncios.
      special_ad_categories: cats,
      categoria_especial_financeira:
        cats.includes("FINANCIAL_PRODUCTS_SERVICES") || cats.includes("CREDIT")
          ? "marcada_na_campanha"
          : (cats.length ? "outra_categoria_especial" : "nao_marcada_no_espelho"),
      gasto_acumulado: brl(num(c.spend)),
    },
    serie_diaria_14d: rows.map(linhaDia),
    totais_periodo: {
      dias_com_dado: rows.length, dias_fechados: fechados.length,
      inclui_dia_parcial: rows.some((s: Record<string, unknown>) => String(s.snapshot_date) === hoje),
      gasto: brl(tot.spend),
      gasto_medio_por_dia_fechado: fechados.length ? brl(gastoFechado / fechados.length) : null,
      impressoes: tot.imp, alcance_soma_diaria_nao_deduplicada: tot.reach,
      cliques_todos: tot.clkTodos, cliques_no_link: tot.link, visualizacoes_lp: tot.lpv,
      formularios: tot.forms, conversas: tot.msg,
      ctr_todos: pct(tot.clkTodos, tot.imp), ctr_link: pct(tot.link, tot.imp),
      cpc_todos: tot.clkTodos ? brl(tot.spend / tot.clkTodos) : null, cpc_link: tot.link ? brl(tot.spend / tot.link) : null,
      cpm: tot.imp ? brl(1000 * tot.spend / tot.imp) : null,
      custo_por_formulario: tot.forms ? brl(tot.spend / tot.forms) : null,
    },
    outras_encontradas: camps.slice(1).map((x) => x.name),
    nota: "serie diaria e totais vem de metric_snapshots (D-1, coletor oficial pipeboard:meta). special_ad_categories e campo da CAMPANHA (Meta nao grava isso no anuncio): se a campanha tem FINANCIAL_PRODUCTS_SERVICES, TODOS os anuncios dela estao sob a categoria especial. Para confirmar ao vivo, ler_pipeboard get_campaign_details. DUAS BASES DE CLIQUE, NAO MISTURE: cliques_todos = TODOS os cliques; cliques_no_link = SO cliques de destino. ALCANCE: alcance_soma_diaria_nao_deduplicada e SOMA diaria (nao pessoas unicas).",
  };
}

/** v28.30: fecha lacuna do agente que dizia "nao da para ler categoria especial / regras Meta". */
async function t_auditar_compliance_financeira(companyId: string, nameLike: string) {
  const needle = norm(nameLike);
  if (!needle) return { erro: "informe name_like da campanha (ex.: CAMPANHA TESTE AGO26 RR)" };

  const { data: camps } = await supa
    .from("campaigns")
    .select("id,name,status,objective,external_id,special_ad_categories,criado_pelo_sistema")
    .eq("company_id", companyId);
  const hits = (camps ?? []).filter((c) => norm(c.name).includes(needle));
  if (!hits.length) return { erro: `nenhuma campanha contendo '${nameLike}'` };
  if (hits.length > 1) {
    const exact = hits.filter((c) => norm(c.name) === needle);
    if (exact.length !== 1) {
      return {
        ambiguo: true,
        opcoes: hits.slice(0, 8).map((c) => c.name),
        instrucao: "peca o nome completo da campanha",
      };
    }
  }
  const camp = hits.length === 1 ? hits[0] : hits.find((c) => norm(c.name) === needle)!;
  const cats = Array.isArray(camp.special_ad_categories) ? camp.special_ad_categories : [];
  const financeira =
    cats.includes("FINANCIAL_PRODUCTS_SERVICES") || cats.includes("CREDIT");

  const { data: ads } = await supa
    .from("ads")
    .select(
      "name,status,external_id,call_to_action_type,destino_url,destination_url,body,criado_pelo_sistema,criado_por_approval_id",
    )
    .eq("campaign_id", camp.id)
    .eq("company_id", companyId)
    .order("name");

  const { data: conjuntos } = await supa
    .from("ad_sets")
    .select("name,status,external_id,targeting")
    .eq("campaign_id", camp.id)
    .eq("company_id", companyId);

  const { data: regras } = await supa
    .from("compliance_rules")
    .select("code,regra,severidade,categoria,fonte")
    .eq("active", true)
    .or("code.ilike.FIN-%,code.ilike.LGL-%,code.ilike.CRI-%")
    .order("code");

  const anuncios = (ads ?? []).map((a) => ({
    nome: a.name,
    status: a.status,
    external_id: a.external_id,
    cta: a.call_to_action_type,
    destino: a.destino_url || a.destination_url || null,
    criado_pelo_sistema: a.criado_pelo_sistema === true,
    tem_approval_de_criacao: !!a.criado_por_approval_id,
    legenda_presente: !!String(a.body ?? "").trim(),
    herda_categoria_especial_da_campanha: financeira,
  }));

  const alertas_segmentacao: string[] = [];
  for (const s of conjuntos ?? []) {
    const t = (s.targeting && typeof s.targeting === "object") ? s.targeting as Record<string, unknown> : {};
    if (t.genders) alertas_segmentacao.push(`conjunto "${s.name}": genders presente (restricao tipica de categoria especial)`);
    if (Array.isArray(t.custom_audiences) && (t.custom_audiences as unknown[]).length) {
      alertas_segmentacao.push(
        `conjunto "${s.name}": tem custom_audiences/LAL — doutrina interna (tema compliance) alerta que lookalike classico fica restrito sob categoria especial; confirme na Central da Meta se este publico ainda e permitido`,
      );
    }
    const ageMin = Number(t.age_min ?? 0);
    const ageMax = Number(t.age_max ?? 0);
    if (ageMin && ageMin > 18) {
      alertas_segmentacao.push(`conjunto "${s.name}": age_min=${ageMin} (>18) — faixa estreita pode conflitar com regras de credito`);
    }
    if (ageMax && ageMax < 65) {
      alertas_segmentacao.push(`conjunto "${s.name}": age_max=${ageMax} (<65) — faixa limitada; sob categoria especial so 18+ costuma ser permitido`);
    }
  }

  return {
    coletado_em: new Date().toISOString(),
    fonte_categoria: "espelho campaigns.special_ad_categories (+ heranca Meta: nivel campanha)",
    campanha: {
      nome: camp.name,
      external_id: camp.external_id,
      status: camp.status,
      objetivo: camp.objective,
      special_ad_categories: cats,
      categoria_especial_financeira: financeira,
      criado_pelo_sistema: camp.criado_pelo_sistema === true,
    },
    anuncios,
    conjuntos: (conjuntos ?? []).map((s) => ({
      nome: s.name,
      status: s.status,
      external_id: s.external_id,
      age_min: (s.targeting as any)?.age_min ?? null,
      age_max: (s.targeting as any)?.age_max ?? null,
      tem_genders: !!(s.targeting as any)?.genders,
      tem_custom_audiences: Array.isArray((s.targeting as any)?.custom_audiences) &&
        ((s.targeting as any).custom_audiences as unknown[]).length > 0,
    })),
    alertas_segmentacao,
    regras_internas_ativas: regras ?? [],
    como_completar_o_quadro: {
      texto_dos_anuncios: "get_criativos_conteudo(busca_nome=...) + check_compliance(legenda)",
      regras_oficiais_meta_na_base: "get_conhecimento(tema=compliance) — secoes 'Categoria especial' e 'Politica de produtos e servicos financeiros'",
      confirmacao_ao_vivo: "ler_pipeboard ferramenta=get_campaign_details args={campaign_id}",
      audio_e_frames_do_video: "lacuna declarada — check_compliance de video completo ainda nao le fala/frames; nao invente veredito visual",
    },
    nota:
      "PROIBIDO dizer que categoria especial 'nao foi coletada' se special_ad_categories veio aqui ou em get_campaign_detail. A Meta aplica a categoria na CAMPANHA; anuncios herdam. PROIBIDO dizer que regras Meta de financas 'nao existem no sistema' sem chamar get_conhecimento(tema=compliance).",
  };
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

/** v28.31: acervo compacto — taxonomia + campos uteis por item; corta texto longo. */
function compactarAcervoParaAgente(data: unknown, filtroAtivo: boolean): unknown {
  if (!data || typeof data !== "object") return data;
  const obj = { ...(data as Record<string, unknown>) };
  const itens = Array.isArray(obj.itens) ? (obj.itens as Record<string, unknown>[]) : null;
  if (!itens) return obj;
  const compactos = itens.map((it) => {
    const o: Record<string, unknown> = {
      nome: it.nome,
      drive_file_id: it.drive_file_id,
      tipo: it.tipo,
      familia_drive: it.familia_drive,
      apta: it.apta,
      na_biblioteca_da_meta: it.na_biblioteca_da_meta,
      meta_video_id: it.meta_video_id ?? null,
      meta_image_hash: it.meta_image_hash ?? null,
      grupo_carrossel: it.grupo_carrossel ?? null,
      caminho: it.caminho ?? null,
      produto: it.produto ?? null,
      motivo_inapta: it.motivo_inapta ?? null,
    };
    if (it.bloqueada_por_compliance) o.bloqueada_por_compliance = it.bloqueada_por_compliance;
    return o;
  });
  const tetoItens = filtroAtivo ? 40 : 25;
  const cortado = cortarLista({ ...obj, itens: compactos }, "itens", filtroAtivo ? 9000 : 8000) as Record<string, unknown>;
  if ((compactos.length > tetoItens) && !filtroAtivo) {
    cortado.dica = "Para emitir slate conhecido, chame de novo com drive_file_ids=[...] — payload bem menor.";
  }
  return cortado;
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
  // v29 (14/08): a lista peca-por-peca agora e COMPACTA. A legenda inteira consumia o teto e
  // derrubava justamente os campos de classificacao (o agente concluiu "todos imagem" e
  // "numero nao confirmado" a partir de item cortado). Aqui cada item leva legenda_resumo
  // (~180 chars) e SEMPRE os campos estruturais (object_type/cta/destino/destino_url), entao
  // os ativos cabem inteiros. legendas_unicas continua com o texto INTEGRAL para compliance.
  const compactos = lista.map((c) => ({
    anuncio: c.anuncio ?? null,
    campanha: c.campanha ?? null,
    campanha_ativa: c.campanha_ativa === true,
    status_anuncio: c.status_anuncio ?? null,
    object_type: c.object_type ?? null,
    cta: c.cta ?? null,
    destino: c.destino ?? null,
    destino_url: c.destino_url ?? null,
    tem_imagem: c.tem_imagem ?? null,
    gasto_acumulado: c.gasto_acumulado ?? null,
    formularios: c.formularios ?? null,
    legenda_resumo: String(c.legenda ?? "").slice(0, 300),
    legenda_foi_cortada: String(c.legenda ?? "").length > 300,
  }));
  const cortado = cortarLista({ ...obj, criativos: compactos }, "criativos", 11000) as Record<string, unknown>;
  const comUnicas = cortarLista({ ...cortado, legendas_unicas: unicas,
    total_legendas_distintas: unicas.length,
    nota_legendas: "legendas_unicas traz o texto INTEGRAL de cada legenda distinta e e a UNICA fonte valida para compliance - audite por aqui, nunca por legenda_resumo. Na lista 'criativos', legenda_resumo e um recorte de ~300 chars para identificar a peca; legenda_foi_cortada=true diz que ha texto alem do recorte, e nesse caso o texto inteiro esta aqui em legendas_unicas (nao declare a peca 'nao auditada' por causa do recorte).",
  }, "legendas_unicas", 6500);
  return { ...comUnicas, somente_campanhas_ativas: somenteAtivas };
}
// Leitura ao vivo do Pipeboard (hibrido): sync diario no DB + catalogo/call sob demanda.
async function pipeboardTokenFromDb(): Promise<string> {
  const { data: secret } = await supa
    .from("integration_secrets")
    .select("value")
    .eq("name", "pipeboard_api_token")
    .maybeSingle();
  return await pipeboardToken(async () => String(secret?.value ?? ""));
}

async function t_listar_ferramentas_pipeboard() {
  const token = await pipeboardTokenFromDb();
  if (!token) return { erro: "PIPEBOARD_API_TOKEN ausente" };
  const catalog = await listReadTools(token);
  if (!catalog.ok) return { erro: catalog.erro ?? "falha ao listar ferramentas Pipeboard" };
  const cut = truncatePipeboardPayload({
    ok: true,
    source: "pipeboard:meta",
    total_pipeboard: catalog.total_pipeboard,
    total_leitura: catalog.total_leitura,
    tools: catalog.tools.map((t) => ({
      name: t.name,
      description: t.description,
      argumentos: t.properties,
      obrigatorios: t.required,
    })),
    nota: "Estas sao as ferramentas de LEITURA do Pipeboard. Para chamar uma, use ler_pipeboard com o nome exato. Preferir tools de DB (get_overview, get_campaign_detail, get_estrutura_conjuntos, get_criativos_conteudo) quando bastarem; use Pipeboard ao vivo quando faltar dado (breakdown, activities, pages, pixels, audiences, insights pontuais, config fresca).",
  });
  return cut.data;
}

async function t_ler_pipeboard(companyId: string, ferramenta: string, argumentos: Record<string, unknown> = {}) {
  if (!companyId) return { erro: "company_id_obrigatorio" };
  const name = String(ferramenta ?? "").trim();
  if (!name) return { erro: "ferramenta_obrigatoria", dica: "chame listar_ferramentas_pipeboard antes" };
  if (!isReadOnlyTool(name)) {
    return {
      erro: "ferramenta_nao_e_leitura",
      ferramenta: name,
      nota: "ler_pipeboard so executa get_/list_/search_/estimate_/resolve_/check_/compute_/bulk_get_/fetch. Escrita = propose_action / meta-actions.",
    };
  }
  const token = await pipeboardTokenFromDb();
  if (!token) return { erro: "PIPEBOARD_API_TOKEN ausente" };
  let allowed: string[] = [];
  try {
    allowed = await companyMetaAccounts(supa, companyId);
  } catch (error) {
    return { erro: String((error as Error).message ?? error) };
  }
  if (!allowed.length) return { erro: "empresa_sem_conta_meta_vinculada" };

  const catalog = await listReadTools(token);
  const toolMeta = catalog.tools.find((t) => t.name === name);
  const properties = Object.fromEntries((toolMeta?.properties ?? []).map((p) => [p, {}]));
  const scoped = scopeArgsToCompany(name, argumentos ?? {}, allowed, properties);
  if (!scoped.ok) {
    return {
      erro: scoped.erro,
      contas_da_empresa: scoped.contas_da_empresa ?? allowed,
    };
  }
  const result = await callReadTool(name, scoped.args, token);
  const cut = truncatePipeboardPayload({
    ok: result.ok,
    source: "pipeboard:meta",
    company_id: companyId,
    ferramenta: name,
    args_usados: scoped.args,
    status: result.status ?? null,
    erro: result.erro ?? null,
    resultado: result.body ?? null,
  });
  return cut.data;
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
  const VALID = [
    "pausar_criativo",
    "ativar_criativo",
    "escalar_criativo",
    "pausar_campanha",
    "ativar_campanha",
    "pausar_conjunto",
    "ativar_conjunto",
    "alterar_orcamento",
    "renomear_campanha",
    "ajustar_posicionamentos_do_conjunto",
  ];
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
  if (action === "renomear_campanha" && !String(params?.novo_nome ?? "").trim()) return { erro: "informe params.novo_nome (nao vazio)" };
  if (
    action === "ajustar_posicionamentos_do_conjunto" &&
    !["video", "imagem"].includes(String(params?.formato_midia ?? "").trim().toLowerCase())
  ) {
    return { erro: "informe params.formato_midia = video ou imagem; a exclusao e derivada do formato" };
  }

  // v28.8 (GT-06): a trava e consultada ANTES de montar payload ou gravar card - de nada serve
  // descobrir depois que a acao esta desligada. Aqui so a recusa interessa: o caminho de
  // modificacao nao usa conta permitida nem teto de sanidade (o alvo ja existe).
  const { recusa } = await verificarPostura(companyId, action);
  if (recusa) return recusa;

  const needle = norm(targetLike);
  const isAd = action === "pausar_criativo" || action === "ativar_criativo" || action === "escalar_criativo";
  const isAdset =
    action === "alterar_orcamento" ||
    action === "ajustar_posicionamentos_do_conjunto" ||
    action === "pausar_conjunto" ||
    action === "ativar_conjunto";
  let matches: { id: string; name: string; external_id?: string }[] = [];
  if (isAd) {
    const { data: camps } = await supa.from("campaigns").select("id").eq("company_id", companyId).eq("status", "active");
    const campIds = (camps ?? []).map((c) => c.id);
    const { data: ads } = await supa.from("ads").select("id,name,external_id,campaign_id").eq("company_id", companyId);
    matches = (ads ?? []).filter((a) => campIds.includes(a.campaign_id) && norm(a.name).includes(needle));
  } else if (isAdset) {
    const { data: adsets } = await supa
      .from("ad_sets")
      .select("id,name,external_id")
      .eq("company_id", companyId)
      .eq("provider", "meta_ads");
    matches = (adsets ?? []).filter((a) => norm(a.name).includes(needle));
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

  // ESP-24: guarda do unico conjunto entregando — se pausar este zera entrega, nao emite card.
  let avisoGuardaConjunto: string | null = null;
  if (action === "pausar_conjunto" && alvo.external_id) {
    const { data: dec, error: decErr } = await supa.rpc("decidir_sobre_conjunto", {
      p_company_id: companyId,
      p_adset_external_id: alvo.external_id,
    });
    if (decErr) {
      return {
        erro: "guarda_do_conjunto_indisponivel",
        detalhe: `Nao consegui consultar decidir_sobre_conjunto (${decErr.message}). Sem a guarda do unico conjunto, NAO emito card de pausa.`,
      };
    }
    const guarda = (dec as any)?.guarda ?? null;
    const restariam = Number(guarda?.restariam_se_este_pausar ?? -1);
    if (guarda?.acionada === true || restariam === 0) {
      return {
        erro: "nao_pausar_sem_alternativa_ativa",
        detalhe: String(
          guarda?.mensagem ??
            (dec as any)?.acao ??
            "Pausar este conjunto deixaria a empresa sem conjunto entregando. A guarda do unico conjunto bloqueou o card.",
        ),
        decisao_conjunto: dec,
      };
    }
    if (typeof restariam === "number" && restariam > 0) {
      avisoGuardaConjunto = `Guarda OK: restariam ${restariam} conjunto(s) entregando se este pausar.`;
    }
  }

  // ESP-26: alterar_orcamento julga o valor NA PROPOSTA com a mesma RPC da execucao.
  let avisoOrcamentoAlteracao: string | null = null;
  if (action === "alterar_orcamento") {
    const reais = Number(params?.novo_orcamento_diario_reais ?? 0);
    const julgado = await julgarOrcamentoDiario(supa, companyId, reais, 1);
    if (!julgado.ok) {
      return {
        erro: julgado.motivo,
        detalhe: julgado.detalhe,
        avaliacao_orcamento: julgado.avaliacao,
      };
    }
    avisoOrcamentoAlteracao = julgado.mensagem_para_o_gestor || null;
  }

  const entityType = action === "alterar_orcamento"
    ? "budget"
    : (action === "ajustar_posicionamentos_do_conjunto" ||
        action === "pausar_conjunto" ||
        action === "ativar_conjunto")
      ? "adset"
      : (isAd ? "ad" : "campaign");
  const summaryBase = ({ pausar_criativo: `Pausar o criativo "${alvo.name}"`,
    ativar_criativo: `Ativar o criativo "${alvo.name}" (status ACTIVE)`,
    escalar_criativo: `Escalar o criativo "${alvo.name}"`,
    pausar_campanha: `Pausar a campanha "${alvo.name}"`,
    ativar_campanha: `Ativar a campanha "${alvo.name}" (status ACTIVE)`,
    pausar_conjunto: `Pausar o conjunto "${alvo.name}" (status PAUSED)`,
    ativar_conjunto: `Ativar o conjunto "${alvo.name}" (status ACTIVE)`,
    alterar_orcamento: `Alterar orcamento diario de "${alvo.name}" para ${brl(Number(params?.novo_orcamento_diario_reais ?? 0))}`,
    renomear_campanha: `Renomear a campanha "${alvo.name}" para "${String(params?.novo_nome ?? "").trim()}" via Pipeboard`,
    ajustar_posicionamentos_do_conjunto:
      `Ajustar posicionamentos de "${alvo.name}" para ${String(params?.formato_midia).toUpperCase()}: excluir Facebook Coluna da direita quando incompatível, preservar Instagram/Threads e demais posicionamentos compatíveis`,
  } as Record<string, string>)[action];
  const avisosExtra = [avisoOrcamentoAlteracao, avisoGuardaConjunto].filter(Boolean);
  const summary = avisosExtra.length ? `${summaryBase} — ${avisosExtra.join(" · ")}` : summaryBase;
  const { data: ins, error: ie } = await supa.from("approval_requests").insert({
    company_id: companyId, requested_by: requestedBy, conversation_id: convId, entity_type: entityType,
    entity_id: alvo.id, action, summary,
    payload: { ...params, target_name: alvo.name, target_external_id: alvo.external_id ?? null,
      justificativa, reversa, metrica_sucesso: sucesso,
      janela_leitura: String(args?.janela_leitura ?? "").trim() || null,
      risco: String(args?.risco ?? "").trim() || null,
      mecanismo: String(args?.mecanismo ?? "").trim() || null,
      aviso_orcamento: avisoOrcamentoAlteracao,
      aviso_guarda_conjunto: avisoGuardaConjunto,
      proposto_por: "traffic-chat" },
    status: "pending",
  }).select("id").single();
  if (ie) return { erro: `falha ao criar pedido: ${ie.message}` };
  await supa.from("audit_log").insert({ company_id: companyId, user_id: requestedBy, action: "approval_created",
    target_type: "approval_request", target_id: ins.id, details: { acao: action, alvo: alvo.name, justificativa, origem: "edge:traffic-chat" } });
  cards.push({ approval_id: ins.id, action, entity_type: entityType, target_name: alvo.name, summary, params, status: "pending" });
  return avisoOrcamentoAlteracao || avisoGuardaConjunto
    ? { ok: true, approval_id: ins.id, resumo: summary, aviso: "Pedido PENDENTE. Nada foi executado.", aviso_orcamento: avisoOrcamentoAlteracao, aviso_guarda_conjunto: avisoGuardaConjunto }
    : { ok: true, approval_id: ins.id, resumo: summary, aviso: "Pedido PENDENTE. Nada foi executado." };
}
/** Tool dedicada: emite card humano; meta-actions é o único executor e exige Pipeboard. */
async function t_renomear_campanha(companyId: string, convId: string, requestedBy: string, args: any, cards: CardInfo[]) {
  const campanhaAtual = String(args?.campanha_atual ?? "").trim();
  if (!campanhaAtual) return { erro: "campanha_atual obrigatoria" };

  // ESP-40: novo nome vem das partes (nao string livre), salvo se args.novo_nome ja for o composto.
  const { data: cfgNome } = await supa
    .from("meta_execution_config")
    .select("marca_tag")
    .eq("company_id", companyId)
    .maybeSingle();
  const paramsNome = {
    marca: args?.marca,
    canal: args?.canal,
    objetivo_tag: args?.objetivo_tag,
    produto: args?.produto,
    papel: args?.papel,
    rotulo: args?.rotulo,
    periodo: args?.periodo,
  };
  const montado = resolverNomePartesDoParams(paramsNome, {
    defaultMarca: (cfgNome as any)?.marca_tag || "LEV",
    exigirPapel: true,
  });
  if (!montado.ok) {
    return {
      erro: montado.erro,
      detalhe: montado.detalhe,
      faltando: montado.faltando,
      instrucao:
        "ESP-40/39: renomear campanha exige marca/canal/objetivo_tag/papel(TESTE|ESCALA)/periodo (+ produto/rotulo). novo_nome livre foi aposentado.",
    };
  }
  const novoNome = montado.nome;
  const livre = String(args?.novo_nome ?? "").trim();
  if (livre && norm(livre) !== norm(novoNome) && !livre.includes("[")) {
    return {
      erro: "nome_livre_recusado",
      detalhe: `novo_nome="${livre}" divergiu do composto "${novoNome}".`,
      nome_composto: novoNome,
      nome_partes: montado.partes,
    };
  }
  if (norm(campanhaAtual) === norm(novoNome)) return { erro: "novo_nome e igual ao nome atual; nenhuma proposta foi emitida" };
  return await t_propose_action(companyId, convId, requestedBy, {
    action_type: "renomear_campanha", target_name: campanhaAtual,
    justificativa: String(args?.justificativa ?? "").trim() || "Solicitacao explicita do gestor para corrigir o nome da campanha.",
    reversa: `Renomear a campanha de volta para "${campanhaAtual}" pelo mesmo update_campaign do Pipeboard.`,
    metrica_sucesso: `A Graph API devolver name exatamente igual a "${novoNome}" na reconciliacao pos-escrita.`,
    risco: "Links, relatorios ou rotinas que dependam do nome antigo podem deixar de casar; o ID da campanha nao muda.",
    mecanismo: "Pipeboard update_campaign altera somente o campo name da campanha existente. Nome composto ESP-40.",
    params: { novo_nome: novoNome, nome_partes: montado.partes },
  }, cards);
}
// v25: proposta das acoes de CRIACAO. Separada de t_propose_action porque a semantica e
// oposta: lÃ¡ o alvo e o objeto a modificar; aqui o "alvo" e o MOLDE a replicar (ou, no caso
// de campanha, o nome do objeto que vai nascer).
const ACOES_CRIACAO = ["criar_campanha", "criar_conjunto_a_partir_de", "criar_anuncio_a_partir_de", "escalar_duplicar"];

async function t_propose_criacao(companyId: string, convId: string, requestedBy: string, args: any, cards: CardInfo[], mcpKey: string) {
  const action = String(args?.action_type ?? "");
  const nomeAlvo = String(args?.target_name ?? "").trim();
  const justificativa = String(args?.justificativa ?? "").trim();
  const reversa = String(args?.reversa ?? "").trim();
  const sucesso = String(args?.metrica_sucesso ?? "").trim();
  const params = args?.params ?? {};

  if (!justificativa) return { erro: "justificativa obrigatoria (EVIDENCIA: por que criar isso, com numero e fonte)" };
  if (!reversa) return { erro: "reversa obrigatoria: como desfazer (ex.: pausar_campanha / pausar_conjunto / pausar_criativo no objeto criado, ou excluir se ainda nao entregar), quem desfaz e em quanto tempo" };
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

  // -------- criar_campanha: nome COMPOSTO (ESP-40); target_name deixa de ser nome livre --------
  if (action === "criar_campanha") {
    // v28.39: ODAX completo + sinonimos PT/legado (ENGAJAMENTO, POST_ENGAGEMENT, …).
    // Se params.objetivo faltar, deriva de objetivo_tag (ex.: ENGAJAMENTO → OUTCOME_ENGAGEMENT).
    const resolvido = resolverObjetivoOdax({
      objetivo: params?.objetivo,
      objetivo_tag: params?.objetivo_tag,
    });
    if (!resolvido.ok) {
      return mensagemObjetivoNaoSuportado(resolvido.bruto);
    }
    const objetivo = resolvido.objetivo;
    const familia = familiaDeObjetivo(objetivo);
    const socialTopo = ehFamiliaSocialTopo(objetivo);

    // Marca vem da empresa ou do pedido; nunca cai em LEV para outra empresa.
    const { data: cfgNome } = await supa
      .from("meta_execution_config")
      .select("marca_tag, page_id")
      .eq("company_id", companyId)
      .maybeSingle();
    const montado = resolverNomePartesDoParams(params, {
      defaultMarca: (cfgNome as any)?.marca_tag || undefined,
      objetivoOdax: objetivo,
      exigirPapel: true,
    });
    if (!montado.ok) {
      return {
        erro: montado.erro,
        detalhe: montado.detalhe,
        faltando: montado.faltando,
        instrucao:
          "Informe params.marca quando a empresa nao tiver marca_tag, params.canal, params.objetivo_tag (ou objetivo ODAX), params.papel (TESTE|ESCALA) e params.periodo. Opcional: produto, rotulo. Brand boost: canal=SOCIAL, objetivo_tag=ENGAJAMENTO (sem produto CLT).",
      };
    }
    const nomeAlvoComposto = montado.nome;
    // v28.40: "composto" / placeholders = omitir (nao recusar). Nome vem das partes.
    const nomeAlvoUtil = targetNameCriacaoUtil(nomeAlvo);
    // Se o agente ainda passou target_name livre divergente, recusa — o nome e das partes.
    if (nomeAlvoUtil && norm(nomeAlvoUtil) !== norm(nomeAlvoComposto) && !String(nomeAlvoUtil).includes("[")) {
      return {
        erro: "nome_livre_recusado",
        detalhe: `target_name="${nomeAlvoUtil}" nao e mais o nome da campanha. O sistema montou "${nomeAlvoComposto}" a partir dos campos. Omita target_name ou use exatamente o nome composto.`,
        nome_composto: nomeAlvoComposto,
        nome_partes: montado.partes,
      };
    }

    const { data: existentes } = await supa.from("campaigns").select("name").eq("company_id", companyId);
    if ((existentes ?? []).some((c) => norm(c.name) === norm(nomeAlvoComposto))) {
      return { erro: `ja existe uma campanha chamada '${nomeAlvoComposto}'. Ajuste rotulo/periodo/produto.` };
    }
    const pageId =
      String(params?.page_id ?? "").trim() ||
      String((cfgNome as any)?.page_id ?? "").trim() ||
      null;
    const notaSocial = socialTopo
      ? ` — familia ${familia}: destino Page/Instagram (nao LP). ODAX ${objetivo} (via ${resolvido.origem}).`
      : "";
    const summary = `Criar campanha "${nomeAlvoComposto}" (objetivo ${objetivo}, papel ${montado.partes.papel}) - nasce ACTIVE, categoria especial de credito obrigatoria — nome composto ESP-40/39${notaSocial}`;
    return await gravarCard(companyId, convId, requestedBy, action, "campaign", null, summary, {
      nome_novo: nomeAlvoComposto,
      nome_partes: montado.partes,
      // ESP-39: contrato exige papel na raiz; tambem vive em nome_partes.
      papel: montado.partes.papel,
      objetivo,
      familia_objetivo: familia,
      page_id: socialTopo ? pageId : null,
      destino_social: socialTopo,
      conta_destino: contaDaEmpresa,
      special_ad_categories: ["FINANCIAL_PRODUCTS_SERVICES"],
      status_inicial: "ACTIVE",
      justificativa,
      reversa,
      metrica_sucesso: sucesso,
      janela_leitura: String(args?.janela_leitura ?? "").trim() || null,
      risco: String(args?.risco ?? "").trim() || null,
      odax_aceitos: [...ODAX_OBJETIVOS],
    }, cards);
  }

  // -------- criar_conjunto_a_partir_de --------
  if (action === "criar_conjunto_a_partir_de") {
    const campanhaDestino = String(params?.campanha_destino ?? "").trim();
    const orcamento = Number(params?.orcamento_diario_reais ?? 0);
    const formatoPrevisto = String(params?.formato_midia_previsto ?? "").trim().toLowerCase();
    if (formatoPrevisto && !["video", "imagem"].includes(formatoPrevisto)) {
      return { erro: "params.formato_midia_previsto invalido: use 'video' ou 'imagem', ou omita. NAO adivinho o formato." };
    }
    // ESP-40: nome do conjunto novo vem das partes (nao nome_novo livre).
    const { data: cfgNomeConj } = await supa
      .from("meta_execution_config")
      .select("marca_tag, page_id")
      .eq("company_id", companyId)
      .maybeSingle();
    const montadoConj = resolverNomePartesDoParams(params, {
      defaultMarca: (cfgNomeConj as any)?.marca_tag || "LEV",
    });
    if (!montadoConj.ok) {
      return {
        erro: montadoConj.erro,
        detalhe: montadoConj.detalhe,
        faltando: montadoConj.faltando,
        instrucao:
          "ESP-40: para o conjunto novo informe params.marca/canal/objetivo_tag/periodo (+ produto/rotulo opcionais). params.nome_novo livre foi aposentado.",
      };
    }
    const nomeNovo = montadoConj.nome;
    const nomeLivre = String(params?.nome_novo ?? "").trim();
    if (nomeLivre && norm(nomeLivre) !== norm(nomeNovo) && !nomeLivre.includes("[")) {
      return {
        erro: "nome_livre_recusado",
        detalhe: `params.nome_novo="${nomeLivre}" divergiu do composto "${nomeNovo}". Use os campos de nomenclatura.`,
        nome_composto: nomeNovo,
        nome_partes: montadoConj.partes,
      };
    }
    // v28.39: familia social (ENGAJAMENTO/RECONHECIMENTO) — Page, nao LP/pixel.
    const resolvidoObjConj = resolverObjetivoOdax({
      objetivo: params?.objetivo,
      objetivo_tag: params?.objetivo_tag ?? montadoConj.partes.objetivo_tag,
      defaultLeadsSeVazio: true,
    });
    const objetivoConj = resolvidoObjConj.ok ? resolvidoObjConj.objetivo : "OUTCOME_LEADS";
    const familiaRaw = String(params?.familia_objetivo ?? "").trim().toLowerCase();
    const familiaConj =
      familiaRaw === "engajamento" || familiaRaw === "reconhecimento" || familiaRaw === "conversao"
      || familiaRaw === "trafego" || familiaRaw === "app"
        ? familiaRaw
        : familiaDeObjetivo(objetivoConj ?? montadoConj.partes.objetivo_tag);
    const socialTopoConj = familiaConj === "engajamento" || familiaConj === "reconhecimento";
    const pageIdConj =
      String(params?.page_id ?? "").trim() ||
      String((cfgNomeConj as any)?.page_id ?? "").trim() ||
      null;
    if (socialTopoConj && !pageIdConj) {
      return {
        erro: "page_id_obrigatorio_para_engajamento",
        detalhe:
          "Conjunto de engajamento/reconhecimento exige page_id da Page. Configure meta_execution_config ou passe params.page_id.",
      };
    }
    // v28.27: default facebook+instagram. Threads continua bloqueado. Nao entrevista o gestor
    // so para escolher redes padrao da casa — ele revisa no card.
    const plataformasRaw = params?.plataformas_publicacao ?? params?.publisher_platforms ?? ["facebook", "instagram"];
    const plataformas = Array.isArray(plataformasRaw)
      ? plataformasRaw.map((p: unknown) => String(p ?? "").trim().toLowerCase()).filter(Boolean)
      : [];
    const plataformasDefaultAplicado = params?.plataformas_publicacao == null && params?.publisher_platforms == null;
    if (!plataformas.length) {
      return { erro: "plataformas_de_publicacao_obrigatorias", detalhe: "A lista veio vazia. Use facebook e/ou instagram (padrao da casa)." };
    }
    if (plataformas.includes("threads")) {
      return {
        erro: "threads_desabilitado_empresa_sem_cadastro",
        detalhe:
          "Threads esta desabilitado por padrao: a empresa nao possui perfil nessa rede. Nao proponha Threads; escolha entre facebook, instagram, audience_network e messenger.",
      };
    }
    const permitidas = new Set(["facebook", "instagram", "audience_network", "messenger"]);
    const invalidas = plataformas.filter((p: string) => !permitidas.has(p));
    if (invalidas.length) {
      return { erro: "plataforma_de_publicacao_nao_suportada", detalhe: `Invalidas: ${invalidas.join(", ")}` };
    }
    // Video e o formato mais comum em LP/CLT; se Facebook veio no default e formato omitido, assume video
    // (exclui Coluna da direita). Se o gestor/agente passou imagem, respeita.
    const formatoEfetivo = formatoPrevisto || (plataformas.includes("facebook") ? "video" : "");
    if (plataformas.includes("facebook") && !formatoEfetivo) {
      return {
        erro: "formato_de_midia_obrigatorio_quando_facebook_selecionado",
        detalhe: "Facebook foi escolhido: informe params.formato_midia_previsto=video|imagem (video exclui a Coluna da direita automaticamente).",
      };
    }
    const semMoldeConj =
      params?.sem_molde === true ||
      norm(nomeAlvo) === "sem_molde" ||
      norm(nomeAlvo) === "_sem_molde";
    if (semMoldeConj && !socialTopoConj) {
      return {
        erro: "sem_molde_so_para_familia_social",
        detalhe:
          "sem_molde em criar_conjunto so vale para engajamento/reconhecimento. Use objetivo_tag=ENGAJAMENTO (ou RECONHECIMENTO) e campanha OUTCOME_ENGAGEMENT/AWARENESS, OU informe um conjunto molde real (mesmo OFFSITE_CONVERSIONS — o executor sobrescreve).",
      };
    }
    if (!semMoldeConj && !nomeAlvo) {
      return {
        erro: "target_name deve ser o nome do CONJUNTO MOLDE a replicar (um que ja funciona) OU 'sem_molde' quando familia engajamento/reconhecimento",
        detalhe:
          "Nao e preciso molde POST_ENGAGEMENT: qualquer conjunto da conta empresta so o targeting; optimization/pixel viram POST_ENGAGEMENT + page_id. Alternativa: target_name=sem_molde.",
      };
    }
    if (!campanhaDestino) return { erro: "params.campanha_destino obrigatorio (nome da campanha que vai receber o conjunto)" };
    if (!(orcamento > 0)) return { erro: "params.orcamento_diario_reais obrigatorio. NAO existe valor padrao: PERGUNTE ao gestor qual orcamento diario ele quer para este conjunto antes de propor." };

    // v28.9 / ESP-26: quem decide se o orcamento cabe e a RPC (helper compartilhado).
    const julgadoConj = await julgarOrcamentoDiario(supa, companyId, orcamento, 1);
    if (!julgadoConj.ok) {
      return { erro: julgadoConj.motivo, detalhe: julgadoConj.detalhe, avaliacao_orcamento: julgadoConj.avaliacao };
    }
    const avisoOrcamento = julgadoConj.mensagem_para_o_gestor;
    const orc = julgadoConj.avaliacao;

    const { data: sets } = await supa.from("ad_sets").select("id,name,external_id,account_id").eq("company_id", companyId);
    let molde: { id: string | null; name: string; external_id: string | null; account_id?: string | null } | null = null;
    if (!semMoldeConj) {
      molde = (sets ?? []).find((x) => norm(x.name) === norm(nomeAlvo)) ?? (sets ?? []).filter((x) => norm(x.name).includes(norm(nomeAlvo)))[0] ?? null;
      if (!molde) return { erro: `conjunto molde '${nomeAlvo}' nao encontrado. NAO invente: peca o nome exato ao gestor. Em engajamento voce pode usar target_name=sem_molde.` };
      const contaMolde = molde.account_id ? (String(molde.account_id).startsWith("act_") ? String(molde.account_id) : `act_${molde.account_id}`) : null;
      if (contaMolde && contaMolde !== contaDaEmpresa) {
        return { erro: `o conjunto molde pertence a conta ${contaMolde}, diferente da conta desta empresa (${contaDaEmpresa}). Replicar entre contas nao e permitido - peca um molde da propria conta.` };
      }
    } else {
      molde = { id: null, name: "sem_molde", external_id: "sem_molde" };
    }
    // v28.6 (GT-04): tres caminhos para achar a campanha de destino, em ordem de confiabilidade.
    // O que travou em 02/08 foi so o primeiro: o espelho nao tinha as campanhas criadas pelo
    // proprio sistema (a meta-actions nao gravava - corrigido no GT-02). Os outros dois existem
    // para que a mesma cegueira nunca mais bloqueie a escada.
    const { data: camps } = await supa.from("campaigns").select("id,name,external_id,objective").eq("company_id", companyId);
    const soDigitos = /^\d{6,}$/.test(campanhaDestino);
    let dest = soDigitos
      ? (camps ?? []).find((c) => String(c.external_id ?? "") === campanhaDestino)
      : ((camps ?? []).find((c) => norm(c.name) === norm(campanhaDestino))
         ?? (camps ?? []).filter((c) => norm(c.name).includes(norm(campanhaDestino)))[0]);
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
                 external_id: String(hit.execution_result?.id_criado), objective: null };
      }
    }
    if (!dest) return { erro: `campanha de destino '${campanhaDestino}' nao encontrada nem no sistema nem entre as criadas por pedido aprovado. Se ela ainda nao existe, proponha criar_campanha primeiro e aguarde a aprovacao. NAO invente o identificador.` };
    if (!dest.external_id) return { erro: `a campanha '${dest.name}' existe no sistema mas ainda nao tem identificador da Meta sincronizado - sem ele o conjunto nao tem onde nascer. Aguarde a proxima sincronizacao.` };

    // Se a campanha destino e social e o agente esqueceu a tag, forca familia pelo objective.
    let familiaEfetiva = familiaConj;
    let socialEfetivo = socialTopoConj;
    let pageIdEfetivo = pageIdConj;
    let objetivoEfetivo = objetivoConj;
    if (!socialEfetivo && ehFamiliaSocialTopo((dest as any).objective)) {
      familiaEfetiva = familiaDeObjetivo((dest as any).objective);
      socialEfetivo = true;
      objetivoEfetivo = String((dest as any).objective);
      if (!pageIdEfetivo) {
        return {
          erro: "page_id_obrigatorio_para_engajamento",
          detalhe:
            "Campanha destino e de engajamento/reconhecimento; informe page_id ou configure meta_execution_config.page_id.",
        };
      }
    }
    if (semMoldeConj && !socialEfetivo) {
      return {
        erro: "sem_molde_so_para_familia_social",
        detalhe: "A campanha destino nao e OUTCOME_ENGAGEMENT/AWARENESS — sem_molde recusado.",
      };
    }

    // v28.9: o aviso entra NO SUMMARY, nao so no payload. O summary e o unico texto que o cartao
    // mostra sem expandir nada, e o gestor decide lendo o cartao no sininho - aviso que fica so na
    // conversa ja rolou para cima quando a decisao acontece.
    // v28.15: summary declara plataformas + regras automaticas (FB+video sem Coluna; Threads off).
    const redesTxt = plataformas.join(", ");
    const notaPosicionamento = plataformas.includes("facebook") && formatoEfetivo === "video"
      ? ` — Redes: ${redesTxt}. Facebook+VIDEO: posicionamentos manuais (8) sem Coluna da direita. Threads DESABILITADO (empresa sem cadastro).${plataformas.includes("instagram") ? " Instagram: usar somente a identidade cadastrada desta empresa." : ""}${plataformasDefaultAplicado ? " (redes padrao da casa aplicadas automaticamente)" : ""}`
      : ` — Redes: ${redesTxt}. Threads DESABILITADO (empresa sem cadastro).${formatoEfetivo === "imagem" && plataformas.includes("facebook") ? " Facebook+imagem: Coluna da direita permanece elegivel." : ""}${plataformas.includes("instagram") ? " Instagram: usar somente a identidade cadastrada desta empresa." : ""}${plataformasDefaultAplicado ? " (redes padrao da casa aplicadas automaticamente)" : ""}`;
    const notaSocialConj = socialEfetivo
      ? (familiaEfetiva === "reconhecimento"
        ? (semMoldeConj
          ? ` — familia reconhecimento SEM MOLDE: REACH + page_id (targeting BR Advantage+ minimo).`
          : ` — familia reconhecimento: molde so empresta targeting; executor sobrescreve por REACH + page_id.`)
        : (semMoldeConj
          ? ` — familia engajamento SEM MOLDE: POST_ENGAGEMENT + destination_type=ON_POST + page_id (targeting BR Advantage+ minimo).`
          : ` — familia engajamento: molde so empresta targeting; executor sobrescreve OFFSITE/pixel por POST_ENGAGEMENT + ON_POST + page_id.`))
      : "";
    const summary = semMoldeConj
      ? `Criar conjunto "${nomeNovo}" SEM MOLDE na campanha "${dest.name}" - ${brl(orcamento)}/dia, nasce ACTIVE` +
        (avisoOrcamento ? ` — ${avisoOrcamento}` : "") + notaPosicionamento + notaSocialConj
      : `Criar conjunto "${nomeNovo}" replicando "${molde!.name}" na campanha "${dest.name}" - ${brl(orcamento)}/dia, nasce ACTIVE` +
        (avisoOrcamento ? ` — ${avisoOrcamento}` : "") + notaPosicionamento + notaSocialConj;
    const card = await gravarCard(companyId, convId, requestedBy, action, "adset", molde!.id, summary, {
      nome_novo: nomeNovo,
      nome_partes: montadoConj.partes,
      molde_external_id: molde!.external_id,
      molde_nome: molde!.name,
      sem_molde: semMoldeConj,
      campanha_destino_external_id: dest.external_id, campanha_destino_nome: dest.name,
      orcamento_diario_reais: orcamento, conta_destino: contaDaEmpresa, status_inicial: "ACTIVE",  // v28.29: aprovar CRIA ativo
      formato_midia_previsto: formatoEfetivo || null,
      plataformas_publicacao: plataformas,
      plataformas_default_aplicado: plataformasDefaultAplicado,
      threads_desabilitado: true,
      familia_objetivo: familiaEfetiva,
      objetivo: objetivoEfetivo,
      page_id: socialEfetivo ? pageIdEfetivo : null,
      optimization_goal: socialEfetivo
        ? (String(params?.optimization_goal ?? "").trim() || (familiaEfetiva === "reconhecimento" ? "REACH" : "POST_ENGAGEMENT"))
        : null,
      destination_type: socialEfetivo
        ? (familiaEfetiva === "reconhecimento" ? null : "ON_POST")
        : null,
      destino_social: socialEfetivo,
      posicionamento_padrao_video: formatoEfetivo === "video" && plataformas.includes("facebook") ? {
        publisher_platforms: plataformas,
        facebook_positions: ["feed", "instream_video", "marketplace", "story", "search", "facebook_reels", "facebook_reels_overlay", "profile_feed"],
        coluna_direita_excluida: true,
        origem: "3_conjuntos_video_active_observados_11_08",
      } : null,
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

  // -------- escalar_duplicar (ESP-25 / ESP-19) --------
  // Escala e por DUPLICACAO com +20% no maximo. NAO editar orcamento do original (isso e
  // alterar_orcamento). Card so nasce se avaliar_escala.apto_a_escalar. Orcamento vem da RPC,
  // nao do agente. Mesma campanha do molde. Targeting herdado do molde (sem lista livre de redes).
  if (action === "escalar_duplicar") {
    if (!nomeAlvo) return { erro: "target_name deve ser o nome do CONJUNTO a escalar (molde que continua entregando)" };
    const { data: sets } = await supa
      .from("ad_sets")
      .select("id,name,external_id,account_id,campaign_id,daily_budget")
      .eq("company_id", companyId)
      .eq("provider", "meta_ads");
    const molde = (sets ?? []).find((x) => norm(x.name) === norm(nomeAlvo))
      ?? (sets ?? []).filter((x) => norm(x.name).includes(norm(nomeAlvo)))[0];
    if (!molde) return { erro: `conjunto '${nomeAlvo}' nao encontrado. NAO invente: peca o nome exato ao gestor.` };
    if (!molde.external_id) return { erro: `conjunto '${molde.name}' sem external_id Meta — sem ele nao avalio escala.` };
    const contaMolde = molde.account_id
      ? (String(molde.account_id).startsWith("act_") ? String(molde.account_id) : `act_${molde.account_id}`)
      : null;
    if (contaMolde && contaMolde !== contaDaEmpresa) {
      return {
        erro: `o conjunto pertence a conta ${contaMolde}, diferente da conta desta empresa (${contaDaEmpresa}). Escala entre contas nao e permitida.`,
      };
    }

    const { data: aval, error: avalErr } = await supa.rpc("avaliar_escala", {
      p_company_id: companyId,
      p_adset_external_id: molde.external_id,
    });
    if (avalErr) {
      return {
        erro: "avaliacao_de_escala_indisponivel",
        detalhe: `Nao consegui consultar avaliar_escala (${avalErr.message}). Sem aptidao medida, NAO emito card de escala.`,
      };
    }
    if (aval?.apto_a_escalar !== true) {
      return {
        erro: "conjunto_nao_apto_a_escalar",
        detalhe: String(aval?.porque_nao ?? aval?.mensagem_para_o_gestor ?? "avaliar_escala recusou a escala."),
        avaliacao_escala: aval,
      };
    }
    const orcamento = Number(aval?.medidas?.orcamento_proposto_dia ?? 0);
    if (!(orcamento > 0)) {
      return {
        erro: "orcamento_proposto_invalido_na_avaliacao",
        detalhe: "avaliar_escala marcou apto mas nao devolveu orcamento_proposto_dia > 0. NAO invento o valor.",
        avaliacao_escala: aval,
      };
    }
    // Gestor nao pode pedir salto maior que a escada; valor livre so via alterar_orcamento (outra acao).
    const pedidoLivre = Number(params?.orcamento_diario_reais ?? 0);
    if (pedidoLivre > 0 && Math.abs(pedidoLivre - orcamento) > 0.009) {
      return {
        erro: "orcamento_de_escala_travado_pela_escada",
        detalhe: `Escala usa o orcamento da RPC (R$ ${orcamento}/dia = +20%). Pedido livre R$ ${pedidoLivre} divergiu. Para outro valor use alterar_orcamento (edita o original — devolve ao aprendizado) ou espere o proximo passo da escada.`,
        orcamento_da_escada: orcamento,
        avaliacao_escala: aval,
      };
    }

    const julgadoEsc = await julgarOrcamentoDiario(supa, companyId, orcamento, 1);
    if (!julgadoEsc.ok) {
      return { erro: julgadoEsc.motivo, detalhe: julgadoEsc.detalhe, avaliacao_orcamento: julgadoEsc.avaliacao, avaliacao_escala: aval };
    }
    const avisoOrcamento = julgadoEsc.mensagem_para_o_gestor;

    if (!molde.campaign_id) {
      return { erro: `conjunto '${molde.name}' sem campanha no espelho — escala exige campanha do original.` };
    }
    const { data: campOrig } = await supa
      .from("campaigns")
      .select("id,name,external_id")
      .eq("id", molde.campaign_id)
      .maybeSingle();
    if (!campOrig?.external_id) {
      return { erro: `campanha do conjunto '${molde.name}' sem external_id Meta no espelho. Aguarde sync.` };
    }

    // ESP-39: escala NAO permanece em campanha TESTE. Destino deve ser ESCALA.
    const papelOrig = classificarPapelCampanha(campOrig.name);
    let camp = campOrig;
    let avisoPapel: string | null = null;
    const destPedido = String(params?.campanha_destino ?? "").trim();

    if (destPedido) {
      const { data: camps } = await supa.from("campaigns").select("id,name,external_id").eq("company_id", companyId);
      const soDigitos = /^\d{6,}$/.test(destPedido);
      const hit = soDigitos
        ? (camps ?? []).find((c) => String(c.external_id ?? "") === destPedido)
        : ((camps ?? []).find((c) => norm(c.name) === norm(destPedido))
          ?? (camps ?? []).filter((c) => norm(c.name).includes(norm(destPedido)))[0]);
      if (!hit?.external_id) {
        return {
          erro: "campanha_destino_de_escala_nao_encontrada",
          detalhe: `params.campanha_destino='${destPedido}' nao bateu com nenhuma campanha da empresa. Use nome ou external_id de uma campanha ESCALA.`,
        };
      }
      camp = hit;
    }

    const papelDest = classificarPapelCampanha(camp.name);
    if (papelDest === "teste") {
      return {
        erro: "escala_nao_vai_em_campanha_teste",
        detalhe:
          `A campanha destino "${camp.name}" e TESTE. ESP-39: escala/vencedores ficam em campanha ESCALA separada. Crie ou escolha uma campanha com papel=ESCALA e informe params.campanha_destino.`,
        papel_destino: papelDest,
      };
    }
    if (papelOrig === "teste" && !destPedido) {
      return {
        erro: "escala_exige_campanha_escala",
        detalhe:
          `O conjunto esta na campanha TESTE "${campOrig.name}". Para escalar, informe params.campanha_destino com uma campanha ESCALA (nao use a mesma).`,
        papel_origem: papelOrig,
      };
    }
    if (papelDest === "desconhecido") {
      if (papelOrig === "teste") {
        return {
          erro: "campanha_destino_sem_papel_escala",
          detalhe:
            `Campanha destino "${camp.name}" nao declara [ESCALA] no nome. Com origem TESTE, o destino tem de ser ESCALA explicito (ESP-39 + ESP-40).`,
        };
      }
      avisoPapel =
        `AVISO ESP-39: campanha "${camp.name}" sem token [TESTE]/[ESCALA] (legado). Escala seguiu, mas campanhas novas devem nascer com papel.`;
    }

    const nomeNovo = String(params?.nome_novo ?? "").trim()
      || `${molde.name} [ESC+20 ${orcamento}]`.slice(0, 180);
    const summary =
      `Escalar por duplicacao: criar "${nomeNovo}" a partir de "${molde.name}" na campanha "${camp.name}" — ${brl(orcamento)}/dia (+20%), nasce ACTIVE. Original continua entregando.` +
      (avisoOrcamento ? ` — ${avisoOrcamento}` : "") +
      (avisoPapel ? ` — ${avisoPapel}` : "") +
      (camp.external_id !== campOrig.external_id
        ? ` — ESP-39: copia vai para campanha ESCALA (origem era "${campOrig.name}").`
        : ` — Escala (ESP-19/25): NAO edita o original.`) +
      ` Anuncios do molde NAO sao copiados neste card — apos o conjunto nascer, proponha criar_anuncio_a_partir_de para cada peca ativa.`;

    const card = await gravarCard(companyId, convId, requestedBy, action, "adset", molde.id, summary, {
      nome_novo: nomeNovo,
      molde_external_id: molde.external_id,
      molde_nome: molde.name,
      campanha_origem_external_id: campOrig.external_id,
      campanha_origem_nome: campOrig.name,
      campanha_origem_papel: papelOrig,
      campanha_destino_external_id: camp.external_id,
      campanha_destino_nome: camp.name,
      campanha_destino_papel: papelDest,
      orcamento_diario_reais: orcamento,
      orcamento_origem: "avaliar_escala.medidas.orcamento_proposto_dia",
      aumento_pct: 20,
      conta_destino: contaDaEmpresa,
      status_inicial: "ACTIVE",
      herdar_targeting_do_molde: true,
      anuncios_nao_copiados_neste_card: true,
      avaliacao_escala: aval,
      aviso_orcamento: avisoOrcamento || null,
      aviso_papel: avisoPapel,
      justificativa,
      reversa,
      metrica_sucesso: sucesso,
      janela_leitura: String(args?.janela_leitura ?? "").trim() || null,
      risco: String(args?.risco ?? "").trim() || null,
    }, cards);
    return avisoOrcamento && card && typeof card === "object" && !(card as any).erro
      ? { ...(card as any), aviso_orcamento: avisoOrcamento, avaliacao_escala: aval, aviso_papel: avisoPapel }
      : { ...(typeof card === "object" ? card as any : { ok: true }), avaliacao_escala: aval, aviso_papel: avisoPapel };
  }

  // -------- criar_anuncio_a_partir_de (compliance BLOQUEANTE) --------
  if (action === "criar_anuncio_a_partir_de") {
    // ESP-40: nome do anuncio novo vem das partes. v28.27: defaults da casa quando omitidos —
    // o agente monta a solucao; o humano revisa no card.
    const { data: cfgNomeAd } = await supa
      .from("meta_execution_config")
      .select("marca_tag")
      .eq("company_id", companyId)
      .maybeSingle();
    const marcaDefault = String((cfgNomeAd as any)?.marca_tag || "LEV").trim() || "LEV";
    const paramsNomeAd = {
      ...params,
      marca: String(params?.marca ?? "").trim() || marcaDefault,
      canal: String(params?.canal ?? "").trim() || "LP",
      objetivo_tag: String(params?.objetivo_tag ?? "").trim() || "LEADS",
      produto: String(params?.produto ?? "").trim() || "CLT",
      periodo: String(params?.periodo ?? "").trim() || periodoMetaAtual(),
      rotulo: String(params?.rotulo ?? "").trim()
        || String(params?.utm_campaign ?? "").trim()
        || "NOVO",
    };
    const montadoAd = resolverNomePartesDoParams(paramsNomeAd, {
      defaultMarca: marcaDefault,
    });
    if (!montadoAd.ok) {
      return {
        erro: montadoAd.erro,
        detalhe: montadoAd.detalhe,
        faltando: montadoAd.faltando,
        instrucao:
          "ESP-40: preencha marca/canal/objetivo_tag/periodo (+ produto/rotulo) VOCE MESMO com os defaults da casa se o gestor nao especificou. Nao peca ao gestor para montar o nome.",
      };
    }
    const nomeNovo = montadoAd.nome;
    const nomeLivre = String(params?.nome_novo ?? "").trim();
    if (nomeLivre && norm(nomeLivre) !== norm(nomeNovo) && !nomeLivre.includes("[")) {
      return {
        erro: "nome_livre_recusado",
        detalhe: `params.nome_novo="${nomeLivre}" divergiu do composto "${nomeNovo}".`,
        nome_composto: nomeNovo,
        nome_partes: montadoAd.partes,
      };
    }
    // Nome do conjunto na fala do agente (ou id). O nome CANONICO no pedido/card/executor e
    // conjunto_destino_external_id — o que montarCriacao consome. Alias conjunto_destino so
    // resolve o objeto aqui; a RPC e o payload usam o external_id.
    const conjuntoDestino = String(
      params?.conjunto_destino ?? params?.conjunto_destino_external_id ?? "",
    ).trim();
    let utmCampaign = String(params?.utm_campaign ?? "").trim();
    if (!utmCampaign) {
      // v28.27: deriva do rotulo/periodo — nao entrevista o gestor por identificador generico.
      utmCampaign = String(montadoAd.partes.rotulo || montadoAd.partes.periodo || nomeNovo).trim();
    }
    const driveFileId = String(params?.drive_file_id ?? "").trim();   // v28.10 (GT-13): peca nova
    // v28.31: carrossel real via child_attachments (2-10 slides com image_hash).
    const childAttachmentsRaw = Array.isArray(params?.child_attachments) ? params.child_attachments : null;
    const temCarrossel = !!(childAttachmentsRaw && childAttachmentsRaw.length >= 2);
    const metaImageHashEarly = String(params?.meta_image_hash ?? "").trim();
    // ESP-35: peca nova pode omitir molde (target_name vazio / "sem_molde" / params.sem_molde).
    const semMolde = !!(driveFileId || temCarrossel || metaImageHashEarly) && (
      params?.sem_molde === true ||
      !nomeAlvo ||
      norm(nomeAlvo) === "sem_molde" ||
      norm(nomeAlvo) === "_sem_molde"
    );
    if (!semMolde && !nomeAlvo) return { erro: "target_name deve ser o nome do ANUNCIO MOLDE a replicar (ou 'sem_molde' + drive_file_id / child_attachments / meta_image_hash para peca nova sem herdar molde)" };
    if (!conjuntoDestino) {
      return {
        erro:
          "params.conjunto_destino (nome) ou params.conjunto_destino_external_id obrigatorio — conjunto que recebe o anuncio",
      };
    }

    let molde: any = null;
    if (!semMolde) {
      const { data: anuncios } = await supa.from("ads").select("id,name,external_id,creative_id,body,title,account_id,adset_external_id").eq("company_id", companyId);
      molde = (anuncios ?? []).find((x) => norm(x.name) === norm(nomeAlvo)) ?? (anuncios ?? []).filter((x) => norm(x.name).includes(norm(nomeAlvo)))[0];
      if (!molde) {
        const pareceInventado = String(nomeAlvo).includes("[") || /LEV|LP|LEADS|TESTE|ESCALA|AGO\d{2}/i.test(String(nomeAlvo));
        const candidatos = (anuncios ?? [])
          .filter((a: any) => a.adset_external_id && String(conjuntoDestino).includes(String(a.adset_external_id)))
          .slice(0, 8)
          .map((a: any) => a.name);
        const { data: setsTmp } = await supa.from("ad_sets").select("external_id,name").eq("company_id", companyId);
        const destTmp = (setsTmp ?? []).find((x) => x.external_id === conjuntoDestino)
          ?? (setsTmp ?? []).find((x) => norm(x.name) === norm(conjuntoDestino));
        const noConjunto = destTmp?.external_id
          ? (anuncios ?? []).filter((a: any) => a.adset_external_id === destTmp.external_id).map((a: any) => a.name).slice(0, 8)
          : candidatos;
        return {
          erro: pareceInventado ? "molde_parece_nome_composto_inventado" : "anuncio_molde_nao_encontrado",
          detalhe: pareceInventado
            ? `target_name='${nomeAlvo}' nao existe no espelho e parece NOME INVENTADO (composto). E PROIBIDO inventar molde. Use o nome EXATO de um anuncio real (ex.: AD_LP_TESTE-RR_Rotativo_Video10) OU sem_molde=true + drive_file_id da peca do acervo.`
            : `anuncio molde '${nomeAlvo}' nao encontrado. NAO invente: use um nome real do espelho.`,
          candidatos_no_conjunto: noConjunto,
          instrucao: "Corrija target_name com um anuncio REAL listado em candidatos_no_conjunto, ou use sem_molde=true com drive_file_id. Nao peca ao gestor para inventar o molde — leia o espelho.",
        };
      }
      if (!molde.creative_id) return { erro: `o anuncio molde '${molde.name}' nao tem criativo sincronizado (creative_id ausente) - sem ele nao e possivel copiar page_id/link/CTA. Escolha outro molde ou use sem_molde=true com page_id/CTA/destino na config.` };
    }

    const { data: sets } = await supa.from("ad_sets").select("id,name,external_id,campaign_id").eq("company_id", companyId);
    const dest = (sets ?? []).find((x) => x.external_id === conjuntoDestino)
      ?? (sets ?? []).find((x) => norm(x.name) === norm(conjuntoDestino))
      ?? (sets ?? []).filter((x) => norm(x.name).includes(norm(conjuntoDestino)))[0];
    if (!dest) return { erro: `conjunto de destino '${conjuntoDestino}' nao encontrado. Se ainda nao existe, proponha criar_conjunto_a_partir_de primeiro.` };

    // v28.45: familia do conjunto destino (campanha ODAX) — engajamento/reconhecimento
    // nao usam LP de conversao; destino do criativo e Page/IG.
    let objetivoCampanhaDest: string | null = null;
    if ((dest as any).campaign_id) {
      const { data: campDest } = await supa
        .from("campaigns")
        .select("objective,name")
        .eq("id", (dest as any).campaign_id)
        .maybeSingle();
      objetivoCampanhaDest = String((campDest as any)?.objective ?? "").trim() || null;
    }
    const familiaPorTag = ehFamiliaSocialTopo(params?.objetivo_tag) || ehFamiliaSocialTopo(params?.objetivo);
    const familiaPorCampanha = ehFamiliaSocialTopo(objetivoCampanhaDest);
    const familiaPorNomeConjunto = /ENGAJAMENTO|RECONHECIMENTO|IMPULSAO|SOCIAL/i.test(String(dest.name ?? ""));
    const anuncioSocialTopo = familiaPorTag || familiaPorCampanha ||
      (familiaPorNomeConjunto && String(params?.canal ?? "").toUpperCase() === "SOCIAL");

    // v28.10 (GT-13) - DOIS PEDIDOS, UMA FONTE. Existem dois anuncios diferentes com o mesmo nome
    // de acao: REPLICAR um que ja roda (escalar o que funciona) e PUBLICAR PECA NOVA do acervo.
    // Quem decide o que cada um exige e pedido_de_anuncio_completo, no banco - nao este arquivo.
    // A LEGENDA NAO E ENTRADA NA REPLICACAO: vem do criativo do molde, e a fonte e declarada como
    // tal. Na peca nova ela e entrada, porque nao existe em lugar nenhum do sistema: nem no Drive,
    // nem em tabela. As tres procedencias legitimas (humano, herdada_do_molde, agente) sao da RPC.
    let legendaFonte = String(params?.legenda_fonte ?? "").trim();
    let legenda = String(params?.legenda ?? "").trim();
    if ((driveFileId || temCarrossel) && legenda && !legendaFonte) legendaFonte = "agente";
    let legendaRefs: string[] | null = Array.isArray(params?.legenda_referencias)
      ? (params.legenda_referencias as unknown[]).map((r) => String(r ?? "").trim()).filter(Boolean)
      : null;
    let legendaRefsOrigem: string | null = Array.isArray(params?.legenda_referencias) ? "params" : null;
    if (!driveFileId && !temCarrossel) {
      legenda = String(molde?.body ?? "").trim();
      legendaFonte = "herdada_do_molde";
    } else if (!legenda && legendaFonte === "herdada_do_molde") {
      if (semMolde) {
        return { erro: "sem_molde_nao_herda_legenda", detalhe: "Peca nova sem molde nao tem legenda a herdar. Informe params.legenda e legenda_fonte=humano (ou agente com referencias)." };
      }
      // O gestor autorizou herdar: o texto e o do molde, e a procedencia diz exatamente isso.
      legenda = String(molde.body ?? "").trim();
    }

    // v28.27: se a legenda e do agente, autofill referencias — NUNCA pedir isso ao humano.
    if ((driveFileId || temCarrossel) && (legendaFonte === "agente" || (!legendaFonte && legenda))) {
      if (legendaFonte !== "agente") legendaFonte = "agente";
      const resolvido = await resolverLegendaReferenciasAgente({
        companyId,
        refsExplicitas: legendaRefs,
        moldeNome: molde?.name ?? null,
        nomeAlvo,
        semMolde,
        adsetExternalId: dest.external_id,
        params: (params ?? {}) as Record<string, unknown>,
      });
      legendaRefs = resolvido.refs;
      legendaRefsOrigem = resolvido.origem;
      if (!legendaRefs.length) {
        return {
          erro: "legenda_referencias_indisponiveis",
          detalhe:
            "Autoria agente exige rastreio, mas nao ha anuncio-base no conjunto/molde para autofill. Use um molde real (target_name de anuncio existente) OU informe anuncio_substituido com o nome do anuncio que motivou a legenda. NAO peca ao gestor para 'confirmar a referencia' — resolva no espelho.",
          instrucao: "Releia get_criativos_conteudo / ads do conjunto e preencha anuncio_substituido ou use molde real. Nao entreviste o gestor sobre o contrato.",
        };
      }
    }

    // ESP-35: config da empresa preenche page/CTA quando sem molde.
    // v28.45: engajamento/reconhecimento → destino Page/IG (nunca forcar LP CLT).
    let pageIdPedido: string | null = String(params?.page_id ?? "").trim() || null;
    let ctaPedido: string | null = String(params?.call_to_action_type ?? params?.cta ?? "").trim() || null;
    let destinoUrlPedido: string | null = String(params?.destino_url ?? "").trim() || null;
    let destinoSocialResolvido = false;
    if (semMolde) {
      const { data: confEmp } = await supa
        .from("meta_execution_config")
        .select("instagram_identity_page_id, page_id, cta_padrao, instagram_handle")
        .eq("company_id", companyId)
        .maybeSingle();
      if (!pageIdPedido) {
        pageIdPedido = String(confEmp?.page_id ?? confEmp?.instagram_identity_page_id ?? "").trim() || null;
      }
      if (!ctaPedido) {
        ctaPedido = String(confEmp?.cta_padrao ?? "LEARN_MORE").trim() || null;
      }
      if (anuncioSocialTopo) {
        // Preferir URL ja passada (Page ou IG); senao Instagram handle da config; senao Page.
        if (!destinoUrlPedido) {
          destinoUrlPedido = urlDestinoSocialTopo(
            pageIdPedido ?? "",
            String((confEmp as any)?.instagram_handle ?? params?.instagram_handle ?? "").trim() || null,
          );
        }
        destinoSocialResolvido = true;
        // CTA tipico de boost social: LEARN_MORE / SEE_MORE — LEARN_MORE ja e o padrao.
      } else if (!destinoUrlPedido) {
        // Destino conversao: so CLT tem LP canonica.
        const produtoHint = String(params?.produto ?? "").trim().toLowerCase();
        if (produtoHint.includes("clt") || produtoHint.includes("consignado")) {
          const { data: destP } = await supa
            .from("destino_por_produto")
            .select("url_canonica")
            .eq("company_id", companyId)
            .eq("produto", "consignado_clt")
            .eq("vigente", true)
            .maybeSingle();
          destinoUrlPedido = String(destP?.url_canonica ?? "").trim() || null;
        }
      }
      if (!pageIdPedido || !ctaPedido || !destinoUrlPedido) {
        return {
          erro: "peca_nova_sem_molde_incompleta",
          detalhe: anuncioSocialTopo
            ? `Sem molde (engajamento/reconhecimento) faltam: ${[!pageIdPedido && "page_id", !ctaPedido && "call_to_action_type", !destinoUrlPedido && "destino Page/IG"].filter(Boolean).join(", ")}. Configure meta_execution_config.page_id.`
            : `Sem molde faltam: ${[!pageIdPedido && "page_id", !ctaPedido && "call_to_action_type", !destinoUrlPedido && "destino_url (ou produto CLT)"].filter(Boolean).join(", ")}. Configure meta_execution_config ou passe no params. So CLT tem LP canonica hoje.`,
        };
      }
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
    };
    if (molde?.creative_id) pedido.creative_id = molde.creative_id;
    if (driveFileId) {
      pedido.drive_file_id = driveFileId;
      pedido.legenda = legenda;
      pedido.legenda_fonte = legendaFonte;
      if (legendaRefs && legendaRefs.length) pedido.legenda_referencias = legendaRefs;
      pedido.tipo_de_pedido = "peca_nova";
    }
    const metaImageHashParam = String(params?.meta_image_hash ?? "").trim();
    if (metaImageHashParam && !temCarrossel) {
      pedido.meta_image_hash = metaImageHashParam;
      pedido.legenda = legenda;
      pedido.legenda_fonte = legendaFonte;
      if (legendaRefs && legendaRefs.length) pedido.legenda_referencias = legendaRefs;
      pedido.tipo_de_pedido = "peca_nova";
    }
    if (temCarrossel) {
      pedido.child_attachments = childAttachmentsRaw;
      pedido.legenda = legenda;
      pedido.legenda_fonte = legendaFonte;
      if (legendaRefs && legendaRefs.length) pedido.legenda_referencias = legendaRefs;
      pedido.tipo_de_pedido = "peca_nova";
      // Hash do 1o slide ajuda a RPC a achar a peca na biblioteca quando drive_file_id falta.
      const h0 = String((childAttachmentsRaw![0] as any)?.image_hash ?? (childAttachmentsRaw![0] as any)?.meta_image_hash ?? "").trim();
      if (h0 && !pedido.meta_image_hash) {
        // Nao setar meta_image_hash junto de child_attachments na executora — so no pedido
        // intermediario a RPC antiga pode exigir "peca"; apos fix ja_na_meta isso sobra.
      }
    }
    if (semMolde) {
      pedido.page_id = pageIdPedido;
      pedido.call_to_action_type = ctaPedido;
      pedido.destino_url = destinoUrlPedido;
      if (destinoSocialResolvido || anuncioSocialTopo) {
        pedido.destino_do_anuncio = {
          caso: "engajamento_social",
          produto: null,
          url_final: destinoUrlPedido,
          url_canonica: destinoUrlPedido,
          corrigir: false,
          aplicavel: true,
          mensagem:
            "ESP-35/v28.45: anuncio de engajamento/reconhecimento — destino Page/Instagram (sem LP de conversao).",
        };
      } else {
        pedido.destino_do_anuncio = {
          caso: "clt",
          produto: "consignado_clt",
          url_final: destinoUrlPedido,
          url_canonica: destinoUrlPedido,
          corrigir: false,
          aplicavel: true,
          mensagem: "ESP-35: peca nova sem molde; destino informado/resolvido na emissao (sem heranca de URL de molde).",
        };
      }
    }
    const { data: ver, error: verErr } = await supa.rpc("pedido_de_anuncio_completo", { p_company_id: companyId, p_pedido: pedido });
    // Falha de verificacao NAO emite card - mesmo tratamento de pode_executar_acao e
    // avaliar_orcamento_diario. Verificador que nao respondeu nao autorizou nada.
    if (verErr || !ver) {
      return { erro: "verificacao_do_pedido_indisponivel",
        detalhe: `Nao consegui verificar se o pedido esta completo (${verErr?.message ?? "resposta vazia"}), entao NAO emiti o card. Sem essa verificacao eu estaria propondo criacao de anuncio sem conferir o que ela exige.` };
    }
    let v: any = ver;
    // AUTO-RESOLUCAO DE LEITURA (doutrina Ryan 11/08): se o portao recusou porque o estado do
    // conjunto de destino nao foi verificado (is_dynamic_creative nulo - conjunto recem-criado que
    // ainda nao entrou na coleta diaria), o sistema NAO devolve tarefa ao humano. Ele colhe o estado
    // do conjunto na Graph (LEITURA, sem escrita na Meta), espelha aquela linha e reavalia UMA vez,
    // na mesma chamada. Ponto de escolha: aqui, na emissao, e nao numa tool separada - a falha
    // reportada foi o agente DIAGNOSTICAR a leitura que faltava e mesmo assim mandar pedir de novo;
    // uma tool exposta ao agente reintroduz esse mesmo desvio (ele teria de lembrar de chama-la).
    // Resolvendo inline, o agente sai do laco e o card fecha na mesma conversa. Nao afrouxa portao:
    // leitura fresca dizendo Dynamic Creative mantem a recusa por nome.
    let autoResConjunto: any = null;
    if (v.completo !== true && v.recusa === "estado_conjunto_destino_nao_verificado") {
      autoResConjunto = await t_atualizar_estado_conjunto(dest.external_id, contaDaEmpresa, companyId, mcpKey);
      const { data: ver2 } = await supa.rpc("pedido_de_anuncio_completo", { p_company_id: companyId, p_pedido: pedido });
      if (ver2) v = ver2;
    }
    if (v.completo !== true) {
      // v28.31: carrossel com hashes ja na biblioteca — RPC antiga so olhava meta_video_id
      // e recusava imagem/carrossel. Se todos os slides tem hash em media_uploads, seguimos.
      let hashesCarr: string[] = [];
      if (temCarrossel) {
        hashesCarr = (childAttachmentsRaw as any[])
          .map((c) => String(c?.image_hash ?? c?.meta_image_hash ?? "").trim())
          .filter(Boolean);
      }
      let carrosselLibOk = false;
      if (hashesCarr.length >= 2) {
        const { data: upsCarr } = await supa.from("media_uploads")
          .select("meta_image_hash")
          .eq("company_id", companyId)
          .eq("status", "enviado")
          .in("meta_image_hash", hashesCarr);
        const found = new Set((upsCarr ?? []).map((u: any) => String(u.meta_image_hash)));
        carrosselLibOk = hashesCarr.every((h) => found.has(h));
      }
      // Imagem avulsa: RPC antiga so olhava meta_video_id no drive_file_id.
      let imagemLibOk = false;
      const hImg = String(params?.meta_image_hash ?? "").trim();
      if (!temCarrossel && (driveFileId || hImg)) {
        let q = supa.from("media_uploads").select("meta_image_hash,drive_file_id")
          .eq("company_id", companyId).eq("status", "enviado");
        if (driveFileId) q = q.eq("drive_file_id", driveFileId);
        else q = q.eq("meta_image_hash", hImg);
        const { data: upImg } = await q.not("meta_image_hash", "is", null).limit(1).maybeSingle();
        imagemLibOk = !!(upImg?.meta_image_hash);
      }
      const soBiblioteca = /biblioteca|enviada para a biblioteca|peca criativa/i.test(
        JSON.stringify(v.faltando ?? []) + String(v.mensagem_para_o_gestor ?? ""),
      );
      const bypassLib = soBiblioteca && legenda && legendaFonte &&
        ((temCarrossel && carrosselLibOk) || (!temCarrossel && imagemLibOk));
      if (!bypassLib) {
        // A mensagem e dela, nao minha: recusa inventada aqui seria a doutrina em dois lugares.
        const faltandoTxt = JSON.stringify(v.faltando ?? []);
        const soRastreio = /legenda_referencias|anuncios existentes voce se baseou/i.test(faltandoTxt + String(v.mensagem_para_o_gestor ?? ""));
        return { pedido_incompleto: true, tipo_de_pedido: v.tipo_de_pedido ?? null,
          auto_resolucao_estado_conjunto: autoResConjunto,
          faltando: v.faltando ?? null, mensagem_para_o_gestor: v.mensagem_para_o_gestor,
          destino_do_anuncio: v.destino_do_anuncio ?? null,
          legenda_referencias_autofill: legendaRefs,
          legenda_referencias_origem: legendaRefsOrigem,
          instrucao: soRastreio
            ? "Falha de rastreio da legenda: NAO pergunte ao gestor. Reemitir com molde real ou anuncio_substituido preenchido a partir do espelho; o codigo tambem tenta autofill."
            : "Complete VOCE o que o contrato permite (molde real, drive_file_id, partes ESP-40, legenda_referencias via autofill). So devolva ao gestor decisao DELE (orcamento nao informado, escolha entre pecas equivalentes que voce ja listou). NUNCA peca ao gestor para te ensinar o contrato nem para montar o card.",
        };
      }
      // Bypass controlado: trata como completo para gravar o card (imagem/carrossel).
      v = { ...v, completo: true, peca_ja_na_biblioteca: true, tipo_de_pedido: "peca_nova",
        mensagem_para_o_gestor: (v.mensagem_para_o_gestor ?? "") +
          (temCarrossel
            ? " CARROSSEL: slides confirmados na biblioteca Meta via media_uploads (image_hash)."
            : " IMAGEM: meta_image_hash confirmado na biblioteca Meta via media_uploads.") };
    }
    // A RPC declara peca_ja_na_biblioteca=false e AVISA, mas nao recusa - a decisao e do fluxo.
    // Aqui ela e recusa: aprovar um card e o ato que inicia gasto, e este card falharia na
    // execucao DEPOIS de aprovado. Descobrir na execucao e o pior lugar para descobrir.
    // v28.31: carrossel — se todos os image_hash estao em media_uploads, nao bloqueie por
    // peca_ja_na_biblioteca=false do drive_file_id (RPC antiga so olhava meta_video_id).
    let carrosselHashesOk = false;
    if (temCarrossel) {
      const hashes = (childAttachmentsRaw as any[])
        .map((c) => String(c?.image_hash ?? c?.meta_image_hash ?? "").trim())
        .filter(Boolean);
      if (hashes.length >= 2) {
        const { data: upsCarr } = await supa.from("media_uploads")
          .select("meta_image_hash")
          .eq("company_id", companyId)
          .eq("status", "enviado")
          .in("meta_image_hash", hashes);
        const found = new Set((upsCarr ?? []).map((u: any) => String(u.meta_image_hash)));
        carrosselHashesOk = hashes.every((h) => found.has(h));
      }
    }
    if (v.peca_ja_na_biblioteca === false && !carrosselHashesOk) {
      return { pedido_incompleto: true, tipo_de_pedido: v.tipo_de_pedido ?? null,
        mensagem_para_o_gestor: v.mensagem_para_o_gestor,
        proximo_passo: "chame upload_midia com este drive_file_id para subir a peca a biblioteca da conta; depois proponha o card de novo",
        drive_file_id: driveFileId || null,
        instrucao: "A peca ainda nao esta na biblioteca da conta. NAO emiti o card. NAO diga que o sistema nao sabe subir midia: chame upload_midia(drive_file_id) agora, espere o retorno (e, se for video, status_processamento=ready), e so entao proponha o card." };
    }

    // A biblioteca ja foi julgada pela RPC; aqui e so BUSCAR o valor que ela confirmou existir.
    // Imagem e video: um anuncio avulso usa UM dos dois. Carrossel usa child_attachments.
    let metaVideoId: string | null = null;
    let metaImageHash: string | null = null;
    if (driveFileId && !temCarrossel) {
      const { data: up } = await supa.from("media_uploads")
        .select("meta_video_id, meta_image_hash, tipo")
        .eq("drive_file_id", driveFileId)
        .eq("status", "enviado")
        .or("meta_video_id.not.is.null,meta_image_hash.not.is.null")
        .order("enviado_em", { ascending: false })
        .limit(1).maybeSingle();
      metaVideoId = up?.meta_video_id ? String(up.meta_video_id) : null;
      metaImageHash = up?.meta_image_hash ? String(up.meta_image_hash) : null;
      if (!metaVideoId && !metaImageHash) {
        return { erro: "inconsistencia_entre_verificacao_e_biblioteca",
          detalhe: `A verificacao disse que a peca ${driveFileId} esta na biblioteca da conta, mas media_uploads nao devolve meta_video_id nem meta_image_hash. NAO emiti card.`,
          proximo_passo: "chame upload_midia com este drive_file_id" };
      }
    }
    // Permite meta_image_hash explicito no params (capa/imagem) quando drive ja mapeou.
    if (!temCarrossel && !metaImageHash && !metaVideoId) {
      const hParam = String(params?.meta_image_hash ?? "").trim();
      if (hParam) metaImageHash = hParam;
    }

    // Video na Meta e assincrono: o id existe antes do processamento terminar.
    // Card apontando para video ainda processando falha na execucao - recusa aqui.
    if (metaVideoId) {
      const st = await t_status_video(metaVideoId, mcpKey);
      if (st?.ok && st.pronto === false) {
        return {
          pedido_incompleto: true,
          tipo_de_pedido: v.tipo_de_pedido ?? null,
          meta_video_id: metaVideoId,
          status_processamento: st.status_processamento ?? null,
          mensagem_para_o_gestor:
            `A peca ja tem identificador na Meta (${metaVideoId}), mas o video ainda nao esta pronto` +
            (st.status_processamento ? ` (status_processamento=${st.status_processamento})` : "") +
            ". NAO emiti o card porque anuncio apontando para video em processamento falha. Aguarde e consulte de novo; nao invente prazo.",
          instrucao: "Repasse o estado real ao gestor. Nao prometa tempo de processamento.",
        };
      }
      if (st?.ok === false) {
        return {
          pedido_incompleto: true,
          tipo_de_pedido: v.tipo_de_pedido ?? null,
          meta_video_id: metaVideoId,
          mensagem_para_o_gestor:
            `A peca tem meta_video_id=${metaVideoId}, mas nao consegui confirmar o status de processamento na Graph (${st?.erro ?? "falha"}). NAO emiti o card sem essa confirmacao.`,
          instrucao: "Tente de novo com upload_midia/status ou aguarde; nao emita card Ã s cegas.",
        };
      }
    }

    // v25 TRAVA 3: compliance BLOQUEANTE, agora sobre a legenda DECIDIDA acima - do molde na
    // replicacao, do gestor ou herdada na peca nova. Quem escreveu nao muda a exposicao
    // regulatoria de um anuncio de credito, e por isso as duas passam pelas mesmas 16 regras.
    // v28.45: impulsão educativa — se FIN-01 so pede "Consulte sua margem…", anexa e revalida
    // uma vez (gestor autorizou engajamento social; nao trava o emit por frase faltante).
    if (!legenda) {
      return {
        erro: semMolde
          ? "peca_nova_sem_molde_exige_legenda"
          : `o anuncio molde '${molde?.name}' nao tem legenda sincronizada; sem ela nao e possivel validar compliance, e criar anuncio financeiro sem essa validacao nao e permitido.`,
      };
    }
    const FRASE_MARGEM_FIN01 = "Consulte sua margem disponivel";
    let legendaCompliance = legenda;
    let comp: any = await t_check_compliance(companyId, legendaCompliance, [], mcpKey);
    let vereditoOk = comp && (comp.veredito === "aprovado" || comp.aprovado === true) && !comp.erro;
    if (!vereditoOk && anuncioSocialTopo) {
      const blob = JSON.stringify(comp ?? {});
      const fin01Margem = /FIN-01/i.test(blob) && /margem/i.test(blob);
      const jaTemFrase = /consulte\s+sua\s+margem/i.test(legendaCompliance);
      if (fin01Margem && !jaTemFrase) {
        legendaCompliance = `${legendaCompliance.trim()}\n\n${FRASE_MARGEM_FIN01}.`;
        legenda = legendaCompliance;
        comp = await t_check_compliance(companyId, legendaCompliance, [], mcpKey);
        vereditoOk = comp && (comp.veredito === "aprovado" || comp.aprovado === true) && !comp.erro;
      } else if (fin01Margem && jaTemFrase && /atencao|aprovado/i.test(String(comp?.veredito ?? ""))) {
        // Ja tem a frase e so atencao residual — nao bloqueia emit de impulsão autorizada.
        vereditoOk = !comp?.erro && String(comp?.veredito ?? "").toLowerCase() !== "reprovado";
      }
    }
    if (!vereditoOk) {
      return { erro: "compliance_bloqueou_a_criacao",
        detalhe: "A legenda nao passou na validacao de compliance, entao a criacao NAO foi proposta. Relate ao gestor o veredito e as violacoes encontradas e sugira ajustar o texto antes de replicar.",
        veredito_compliance: comp };
    }

    // v25 TRAVA 4: UTM montada aqui, no codigo. {{site_source_name}} e macro da Meta e resolve
    // para fb/ig automaticamente - melhor que fixar um dos dois.
    const urlTags = `utm_source={{site_source_name}}&utm_medium=paid&utm_campaign=${slug(utmCampaign)}&utm_content=${slug(nomeNovo)}`;

    // A mensagem da verificacao vai INTEIRA para o summary, inclusive a nota visual da peca e a
    // linha DESTINO (que a RPC pedido_de_anuncio_completo ja anexa a mensagem_para_o_gestor). O
    // destino e por PRODUTO: a RPC identifica a oferta (CLT/outro/indeterminado), o sinal usado e
    // a URL escolhida. So corrige para /simulacao-clt quando o produto e CLT; produto diferente
    // ou indeterminado preserva a URL do molde. O card carrega a decisao inteira em
    // destino_do_anuncio; a executora HONRA essa decisao (nao reinfere por dominio).
    const destAnuncio = (semMolde ? pedido.destino_do_anuncio : null) ?? v.destino_do_anuncio ?? null;
    const destinoUrlCard = destAnuncio?.url_final ?? destAnuncio?.url_do_molde ?? destinoUrlPedido ?? null;

    // v28.45: nao deixe a RPC colar "DESTINO: LP CLT" em card de engajamento social.
    let msgGestor = String(v.mensagem_para_o_gestor ?? "");
    if (anuncioSocialTopo || destinoSocialResolvido) {
      msgGestor = msgGestor.replace(/\s*DESTINO:\s*[^.]*\./gi, " ");
      msgGestor = (msgGestor.trim() +
        ` DESTINO: engajamento/reconhecimento — Page/Instagram (${destinoUrlCard ?? "config"}). Sem LP de conversao.`).trim();
    }

    const cabeca = temCarrossel
      ? `Criar anuncio "${nomeNovo}" CARROSSEL (${(childAttachmentsRaw as any[]).length} slides) no conjunto "${dest.name}", SEM molde (ESP-35) - compliance de texto aprovado, nasce ACTIVE`
      : semMolde
      ? `Criar anuncio "${nomeNovo}" com PECA NOVA do acervo no conjunto "${dest.name}", SEM molde (ESP-35: page/CTA/destino da config) - compliance de texto aprovado, nasce ACTIVE`
      : driveFileId
      ? `Criar anuncio "${nomeNovo}" com PECA NOVA do acervo no conjunto "${dest.name}", usando "${molde.name}" como molde de configuracao - compliance de texto aprovado, nasce ACTIVE`
      : `Criar anuncio "${nomeNovo}" replicando "${molde.name}" no conjunto "${dest.name}" - compliance aprovado, nasce ACTIVE`;
    const summary = `${cabeca}\n\n${msgGestor}`.trim();
    return await gravarCard(companyId, convId, requestedBy, action, "ad", molde?.id ?? dest.id, summary, {
      nome_novo: nomeNovo,
      nome_partes: montadoAd.partes,
      molde_external_id: molde?.external_id ?? null,
      molde_nome: molde?.name ?? null,
      creative_id: molde?.creative_id ?? null,
      sem_molde: semMolde,
      page_id: pageIdPedido,
      call_to_action_type: ctaPedido,
      conjunto_destino_external_id: dest.external_id,
      conjunto_destino_nome: dest.name, url_tags: urlTags, utm_campaign: slug(utmCampaign),
      conta_destino: contaDaEmpresa, status_inicial: "ACTIVE",  // v28.28: aprovar criar_anuncio = cria ACTIVE
      // v28.10 (GT-13): a executora le meta_video_id para trocar a midia no spec do molde.
      // Ausente = replicacao pura, e ela replica o criativo inteiro como sempre fez.
      tipo_de_pedido: v.tipo_de_pedido ?? (driveFileId || temCarrossel ? "peca_nova" : null),
      drive_file_id: driveFileId || null, meta_video_id: metaVideoId, meta_image_hash: temCarrossel ? null : metaImageHash,
      child_attachments: temCarrossel ? childAttachmentsRaw : null,
      legenda, legenda_fonte: legendaFonte || null, legenda_referencias: legendaRefs,
      legenda_referencias_origem: legendaRefsOrigem,
      utm_campaign_origem: String(params?.utm_campaign ?? "").trim() ? "gestor" : "derivado_do_rotulo",
      nota_visual_da_peca: v.nota_visual_da_peca ?? null,
      destino_url: destinoUrlCard,
      destino_do_anuncio: destAnuncio,
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
    aviso: "Pedido PENDENTE. Nada foi criado na Meta ainda. Ao ser aprovado, campanha/conjunto/anuncio nascem ACTIVE (a aprovacao do card autoriza entrega). Para religar objeto ja PAUSED use ativar_campanha, ativar_conjunto ou ativar_criativo. O pedido expira em 24h se nao for decidido." };
}

async function t_check_compliance(companyId: string, legenda: string, imgAtts: { mime: string; b64: string }[], mcpKey: string) {
  const img = imgAtts[0];
  if (!legenda && !img) return { erro: "forneca a legenda e/ou anexe o criativo" };
  const body: any = { company_id: companyId };
  if (legenda) body.legenda = legenda;
  if (img) { body.image_base64 = img.b64; body.mime = img.mime; }
  const r = await fetch(`${SUPABASE_URL}/functions/v1/compliance-check`, { method: "POST", headers: { "content-type": "application/json", "x-mcp-key": mcpKey }, body: JSON.stringify(body) });
  const t = await r.text();
  try { return JSON.parse(t); } catch { return { erro: `compliance-check falhou (${r.status})` }; }
}

// ESP-37: motor de legenda (N=3). Nao cria anuncio — so devolve variantes com veredito.
// v28.44: persiste variantes em conversation_legendas quando ha conversation_id.
async function t_gerar_legendas(
  companyId: string,
  mcpKey: string,
  args: { produto?: string; objetivo?: string; eixo?: string; drive_file_id?: string; referencias?: string[]; peca_chave?: string },
  convId?: string | null,
) {
  const objetivo = String(args?.objetivo ?? args?.eixo ?? "").trim();
  if (!objetivo) {
    return {
      erro: "objetivo_obrigatorio",
      detalhe: "Informe objetivo (o que a legenda deve comunicar). Ex.: 'CLT — simulacao rapida sem burocracia'.",
    };
  }
  const body: Record<string, unknown> = {
    company_id: companyId,
    produto: String(args?.produto ?? "").trim(),
    objetivo,
  };
  if (!body.produto) return { erro: "produto_obrigatorio", detalhe: "Informe o produto da empresa; o sistema nao usa CLT como fallback." };
  const drive = String(args?.drive_file_id ?? "").trim();
  if (drive) body.drive_file_id = drive;
  if (Array.isArray(args?.referencias) && args.referencias.length) {
    body.referencias = args.referencias.map((r) => String(r)).filter(Boolean).slice(0, 5);
  }
  const r = await fetch(`${SUPABASE_URL}/functions/v1/gerar-legendas`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-mcp-key": mcpKey },
    body: JSON.stringify(body),
  });
  const t = await r.text();
  let j: any;
  try {
    j = JSON.parse(t);
  } catch {
    return { ok: false, erro: `gerar-legendas falhou (${r.status}): ${t.slice(0, 200)}` };
  }
  if (j?.ok && convId) {
    const peca = String(args?.peca_chave ?? drive ?? `objetivo:${objetivo.slice(0, 80)}`).trim() || "sem_peca";
    const variantes = Array.isArray(j.variantes) ? j.variantes : [];
    const escolhida = variantes.find((v: any) => v?.apto_para_card) ?? variantes[0];
    const gravado = await upsertLegendaConversa({
      companyId,
      convId,
      pecaChave: peca,
      driveFileId: drive || null,
      legenda: String(escolhida?.texto ?? "").trim(),
      varianteIndice: escolhida?.indice != null ? Number(escolhida.indice) : null,
      fonte: "gerar_legendas",
      objetivo,
      aptoParaCard: escolhida?.apto_para_card === true,
      variantes,
      metadata: { n: j.n, aptas: j.aptas, produto: j.produto },
    });
    j.persistido = gravado;
    j.peca_chave = peca;
    j.nota_memoria =
      "Legendas gravadas em conversation_legendas desta conversa. Em turnos seguintes use get_legendas_da_conversa — NUNCA diga que o texto sumiu nem peca ao gestor para colar de novo.";
  }
  return j;
}

async function upsertLegendaConversa(opts: {
  companyId: string;
  convId: string;
  pecaChave: string;
  driveFileId?: string | null;
  legenda: string;
  varianteIndice?: number | null;
  fonte: "gerar_legendas" | "agente_proposto" | "gestor" | "seed";
  objetivo?: string | null;
  aptoParaCard?: boolean | null;
  variantes?: unknown;
  metadata?: Record<string, unknown>;
  selecionada?: boolean;
}) {
  const legenda = String(opts.legenda ?? "").trim();
  if (!legenda) return { ok: false, erro: "legenda_vazia" };
  const peca = String(opts.pecaChave ?? "").trim();
  if (!peca) return { ok: false, erro: "peca_chave_obrigatoria" };
  const row = {
    company_id: opts.companyId,
    conversation_id: opts.convId,
    peca_chave: peca.slice(0, 200),
    drive_file_id: opts.driveFileId ? String(opts.driveFileId).trim() : null,
    legenda,
    variante_indice: opts.varianteIndice ?? null,
    selecionada: opts.selecionada !== false,
    fonte: opts.fonte,
    objetivo: opts.objetivo ? String(opts.objetivo).slice(0, 500) : null,
    apto_para_card: opts.aptoParaCard ?? null,
    variantes: opts.variantes ?? null,
    metadata: opts.metadata ?? {},
    updated_at: new Date().toISOString(),
  };
  const { data, error } = await supa.from("conversation_legendas")
    .upsert(row, { onConflict: "conversation_id,peca_chave" })
    .select("id, peca_chave, drive_file_id, updated_at")
    .maybeSingle();
  if (error) return { ok: false, erro: error.message };
  return { ok: true, id: data?.id, peca_chave: data?.peca_chave, drive_file_id: data?.drive_file_id };
}

async function t_registrar_legenda_da_conversa(
  companyId: string,
  convId: string,
  args: { peca_chave?: string; legenda?: string; drive_file_id?: string; variante_indice?: number; selecionada?: boolean; objetivo?: string },
) {
  if (!convId) return { erro: "conversation_id_ausente", detalhe: "So funciona dentro de uma conversa." };
  const peca = String(args?.peca_chave ?? args?.drive_file_id ?? "").trim();
  const legenda = String(args?.legenda ?? "").trim();
  if (!peca) return { erro: "peca_chave_obrigatoria", detalhe: "Informe peca_chave (ex.: carrossel_5, card_capa_1) ou drive_file_id." };
  if (!legenda) return { erro: "legenda_obrigatoria" };
  return await upsertLegendaConversa({
    companyId,
    convId,
    pecaChave: peca,
    driveFileId: args?.drive_file_id ? String(args.drive_file_id).trim() : null,
    legenda,
    varianteIndice: args?.variante_indice != null ? Number(args.variante_indice) : null,
    fonte: "agente_proposto",
    objetivo: args?.objetivo ? String(args.objetivo) : null,
    selecionada: args?.selecionada !== false,
  });
}

async function t_get_legendas_da_conversa(
  companyId: string,
  convId: string,
  args?: { peca_chave?: string; drive_file_id?: string },
) {
  if (!convId) return { erro: "conversation_id_ausente" };
  let q = supa.from("conversation_legendas")
    .select("id, peca_chave, drive_file_id, legenda, variante_indice, selecionada, fonte, objetivo, apto_para_card, variantes, updated_at")
    .eq("company_id", companyId)
    .eq("conversation_id", convId)
    .order("updated_at", { ascending: false })
    .limit(40);
  const peca = String(args?.peca_chave ?? "").trim();
  const drive = String(args?.drive_file_id ?? "").trim();
  if (peca) q = q.eq("peca_chave", peca);
  if (drive) q = q.eq("drive_file_id", drive);
  const { data, error } = await q;
  if (error) return { erro: error.message };
  const itens = data ?? [];
  return {
    total: itens.length,
    itens,
    nota:
      "Fonte DURAVEL desta conversa. Se total>0, o texto INTEGRAL esta em itens[].legenda — use para compliance/card. PROIBIDO dizer 'nao disponivel' ou pedir ao gestor para colar de novo quando a peca aparece aqui. Se total=0 e a copy estava no chat, registre com registrar_legenda_da_conversa antes de declarar ausencia.",
  };
}

async function carregarBlocoLegendasConversa(companyId: string, convId: string): Promise<string> {
  const { data, error } = await supa.from("conversation_legendas")
    .select("peca_chave, drive_file_id, legenda, variante_indice, selecionada, fonte, updated_at")
    .eq("company_id", companyId)
    .eq("conversation_id", convId)
    .order("updated_at", { ascending: false })
    .limit(20);
  if (error || !data?.length) return "";
  const linhas = data.map((r: any, i: number) => {
    const meta = [
      r.peca_chave,
      r.drive_file_id ? `drive=${r.drive_file_id}` : null,
      r.variante_indice != null ? `var=${r.variante_indice}` : null,
      r.selecionada === false ? "nao_selecionada" : "selecionada",
      r.fonte,
    ].filter(Boolean).join(" | ");
    return `${i + 1}) [${meta}]\n${String(r.legenda ?? "").trim()}`;
  });
  return (
    "[LEGENDAS DA CONVERSA — store duravel; texto INTEGRAL abaixo. " +
    "Se o gestor pedir compliance/card destas pecas, USE estes textos. " +
    "PROIBIDO dizer que nao existem ou pedir para colar de novo.]\n" +
    linhas.join("\n\n")
  );
}

// Sobe peca do Drive para a biblioteca Meta (adimages/advideos) via edge upload-midia.
// Respeita flag upload_midia e teto por hora DENTRO da edge. Idempotente.
async function t_upload_midia(companyId: string, driveFileId: string, mcpKey: string, accountId?: string) {
  const body: Record<string, unknown> = {
    acao: "executar",
    company: companyId,
    drive_file_id: driveFileId,
  };
  if (accountId) body.account_id = accountId;
  const r = await fetch(`${SUPABASE_URL}/functions/v1/upload-midia`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-mcp-key": mcpKey },
    body: JSON.stringify(body),
  });
  const t = await r.text();
  let j: any; try { j = JSON.parse(t); } catch { return { ok: false, erro: `upload-midia falhou (${r.status}): ${t.slice(0, 200)}` }; }
  return j;
}

// Auto-resolucao de LEITURA (doutrina Ryan 11/08): estado de conjunto ausente/desatualizado e uma
// lacuna que o sistema alcanca sozinho. Dispara a coleta pontual da meta-campaign-status (le
// is_dynamic_creative na Graph, LEITURA, e espelha aquela linha agora) para o portao reavaliar na
// MESMA chamada. Nao escreve nada na Meta e nao afrouxa portao: se a leitura fresca disser Dynamic
// Creative, a recusa por nome continua, agora com o fato fresco em vez de "nao sei".
async function t_atualizar_estado_conjunto(adsetExternalId: string, accountId: string | null, companyId: string, mcpKey: string) {
  const body: Record<string, unknown> = { conjunto: adsetExternalId, company_id: companyId };
  if (accountId) body.account_id = accountId;
  const r = await fetch(`${SUPABASE_URL}/functions/v1/meta-campaign-status`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-mcp-key": mcpKey },
    body: JSON.stringify(body),
  });
  const t = await r.text();
  try { return JSON.parse(t); } catch { return { ok: false, erro: `coleta pontual do conjunto falhou (${r.status}): ${t.slice(0, 200)}` }; }
}

/** Refresh ao vivo das dicas Opportunity Score antes de ler o banco (atalho meta-dicas). */
async function t_sincronizar_meta_dicas(companyId: string, mcpKey: string) {
  if (!mcpKey) return { ok: false, erro: "mcp_key_ausente_para_sync" };
  const r = await fetch(`${SUPABASE_URL}/functions/v1/meta-campaign-status`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-mcp-key": mcpKey },
    body: JSON.stringify({ modo: "meta_dicas", company_id: companyId }),
  });
  const t = await r.text();
  try {
    return JSON.parse(t);
  } catch {
    return { ok: false, erro: `sync meta_dicas falhou (${r.status}): ${t.slice(0, 200)}` };
  }
}

// Video na Meta e assincrono: id existe antes de status.video_status=ready.
async function t_status_video(videoId: string, mcpKey: string) {
  const r = await fetch(`${SUPABASE_URL}/functions/v1/upload-midia`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-mcp-key": mcpKey },
    body: JSON.stringify({ acao: "status_video", video_id: videoId }),
  });
  const t = await r.text();
  try { return JSON.parse(t); } catch { return { ok: false, erro: `status_video falhou (${r.status})` }; }
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
  { type: "function", function: { name: "get_recommendations", description: "FILA INTERNA pendente (ai_recommendations: custo de midia / regua nossa). NAO e o badge '1 recomendacao' do Ads Manager nem Opportunity Score. Para dicas da Meta use get_meta_dicas.", parameters: { type: "object", properties: {} } } },
  { type: "function", function: { name: "get_meta_dicas", description: "Dicas da Meta (Opportunity Score GET /act_*/recommendations + campo classico recommendations), com first_seen_on/last_seen_on e veredito interno (concorda|discorda|nao_aplicavel|sem_regua). E PROIBIDO repetir a dica da Meta como se fosse nossa. A API pode ter MENOS itens que o badge do Ads Manager.", parameters: { type: "object", properties: { dias: { type: "integer", description: "Janela em dias (default 14)." }, veredito: { type: "string", description: "Filtro opcional: concorda|discorda|nao_aplicavel|sem_regua" } } } } },
  { type: "function", function: { name: "teto_vigente", description: "FONTE PRIORITARIA para julgar teto vigente. Exige o company_id da conversa e uma metrica. Devolve qual regua governa, valor, denominador, autor/data/citacao da meta de negocio, consistencia historica, aspiracao e divergencias/avisos. A tabela targets isolada NAO decide teto vigente.", parameters: { type: "object", properties: { metric: { type: "string", description: "Metrica exata, por exemplo custo_por_formulario, custo_por_conversa ou custo_por_lead_lp." } }, required: ["metric"] } } },
  { type: "function", function: { name: "checar_par_texto_e_peca", description: "Avalia o PAR legenda + peca pela concatenacao do texto disponivel. Exige company_id da conversa, legenda e drive_file_id. Devolve veredito, leituras separadas, cobertura e lacunas; e deteccao por padroes, NAO aprovacao. Audio sem transcricao permanece explicitamente nao lido.", parameters: { type: "object", properties: { legenda: { type: "string" }, drive_file_id: { type: "string" } }, required: ["legenda", "drive_file_id"] } } },
  { type: "function", function: { name: "saude_das_integracoes", description: "Mede a saude das integracoes Meta desta empresa por evidencia de ads, snapshots, breakdown e tres relogios. Exige company_id da conversa. Declara divergencias contra status/estado_operacional sem alterar nenhum deles; nao promete diagnosticar provedores fora desse retorno.", parameters: { type: "object", properties: { dias_tolerancia: { type: "integer", description: "Opcional; padrao da RPC = 3 dias." } } } } },
  { type: "function", function: { name: "custo_llm_periodo", description: "Calcula em USD o custo derivado dos tokens gravados de chat e jobs no periodo para o company_id da conversa. Declara premissa de modelos e lacunas: cache pode ser cobrado como teto, ha subagentes sem tokens, visao e compliance-check ficam invisiveis. Nao e custo faturado.", parameters: { type: "object", properties: { de: { type: "string", description: "Data inicial YYYY-MM-DD." }, ate: { type: "string", description: "Data final YYYY-MM-DD." } }, required: ["de", "ate"] } } },
  { type: "function", function: { name: "panorama_utm_anuncios", description: "Mostra, para o company_id da conversa, coleta de url_tags e destino dos anuncios: nunca lido, lido sem/com rotulo, rotulos, ambiguidades e URLs. Distingue ausencia configurada de nao coleta quando o retorno permite. Limite: nao mede desempenho/leads por UTM e o token alcanca apenas parte das contas.", parameters: { type: "object", properties: {} } } },
  { type: "function", function: { name: "nota_visual_da_peca", description: "Retorna a nota visual textual completa de UMA peca do Drive no company_id da conversa: revisao aberta, base, produto, aproveitabilidade, risco, motivo e divergencia de produto. Ausencia de leitura nao e ausencia de risco; a nota informa e nao substitui decisao nem e veredito de compliance.", parameters: { type: "object", properties: { drive_file_id: { type: "string" } }, required: ["drive_file_id"] } } },
  { type: "function", function: { name: "registrar_veredito_peca_em_revisao", description: "PROPOE veredito de compliance em pecas_em_revisao emitindo um CARD DE APROVACAO. Voce NAO decide e NAO libera nada: a peca continua impedida e so muda quando um administrador aprovar o card na tela. A assinatura gravada sera a de QUEM APROVAR, resolvida por auth.users - o nome que voce passar em veredito_por entra apenas como autor_sugerido e nao tem valor de decisao. Valores: liberado_como_esta (se aprovado, desliga bloqueia_uso), ajustar_peca ou nao_usar (mantem o bloqueio). Ja existindo proposta pendente para a peca, a chamada e recusada. Ao responder, diga que emitiu proposta e que a decisao e do responsavel - nunca diga que a peca foi liberada. Nao faca UPDATE a mao.", parameters: { type: "object", properties: { drive_file_id: { type: "string" }, veredito: { type: "string", enum: ["liberado_como_esta", "ajustar_peca", "nao_usar"] }, veredito_por: { type: "string", description: "Opcional: quem pediu o veredito (ex.: Roberto). Registro informativo, NAO assinatura." }, nota: { type: "string", description: "Opcional: condicao ou justificativa que acompanha a proposta." } }, required: ["drive_file_id", "veredito"] } } },
  { type: "function", function: { name: "diagnosticar_custo", description: "Diagnostica por que o custo por formulario de um anuncio subiu, comparando o ultimo dia com entrega aos 3 anteriores. Exige company_id da conversa e ad_external_id. Devolve sinal, causa, acao, confirmacao, medidas e guarda de maturacao; sem base nao conclui, e problema depois do clique e apenas apontado porque esta fora do escopo.", parameters: { type: "object", properties: { ad_external_id: { type: "string" } }, required: ["ad_external_id"] } } },
  { type: "function", function: { name: "avaliar_fadiga", description: "Avalia se uma peca cansou, teve queda sem saturacao, esta com frequencia alta antes da queda ou nao tem sinal de fadiga. Exige company_id da conversa e ad_external_id. Sem entrega/base nao conclui; usa frequencia DIARIA e declara que frequencia deduplicada de 30 dias nao pode ser derivada das linhas diarias.", parameters: { type: "object", properties: { ad_external_id: { type: "string" } }, required: ["ad_external_id"] } } },
  { type: "function", function: { name: "casar_criativo_performance", description: "ESP-33: casa peca do Drive com os anuncios criados PELO SISTEMA a partir dela e devolve metricas da janela (gasto, formularios, conversas, custo/formulario) + amostra_pequena (<20 resultados). Passe drive_file_id e/ou ad_external_id; sem filtro lista os pares existentes da empresa. Anuncios feitos so no Gerenciador NAO entram (lacuna declarada). Use ANTES de julgar peca do acervo por performance; ranking medio isolado nao prescreve pausa. Para fadiga, chame avaliar_fadiga com o ad_external_id devolvido.", parameters: { type: "object", properties: { drive_file_id: { type: "string" }, ad_external_id: { type: "string" }, dias: { type: "integer", description: "Janela em dias (default 7)." } } } } },
  { type: "function", function: { name: "ler_brand_identity", description: "ESP-36: le a identidade de marca VIGENTE da empresa da conversa: voz/tom, dos/donts, disclaimers obrigatorios, linhas de produto e referencias resolvidas (page_id/instagram/CTA/driver de meta_execution_config e destinos de destino_por_produto). E a fonte curada de voz da marca — use antes de redigir/avaliar copy. O motor gerar_legendas ja consome isso automaticamente. Leitura pura.", parameters: { type: "object", properties: {} } } },
  { type: "function", function: { name: "score_de_prontidao", description: "ESP-38: score read-only 0-100 de prontidao da empresa da conversa para propor/executar anuncios, agregando sinais que ja existem: config de execucao (25), integracao Meta viva (25), postura de criacao/pode_executar_acao (20), brand_identity (15), destino_por_produto (10) e driver resolvivel (5). Devolve nivel (bloqueado|parcial|operacional|pronto), checks itemizados com evidencia/lacuna, bloqueios duros e recomendacoes. Use quando o usuario pergunta 'estamos prontos?/por que nao consigo criar anuncio?/o que falta'. NAO altera nada e NAO substitui os gates por pedido (validar_pedido_contra_contrato / pedido_de_anuncio_completo).", parameters: { type: "object", properties: {} } } },
  { type: "function", function: { name: "saude_dos_tokens", description: "ESP-30: saude dos tokens Meta (ads/waba) da empresa da conversa por METADADO gravado (meta_tokens): por token devolve dias para expirar, dias para o fim do data_access, escopos faltando vs o esperado do papel e veredito (ok|expira_em_breve|expirado|data_access_expirado|escopo_incompleto|invalido). Use quando o usuario pergunta 'o token vai vencer?/temos permissao pra X?/por que parou de coletar'. Leitura pura: le o ultimo estado do meta-token-monitor, NAO chama a Graph e NUNCA expoe o valor do token. Complementa saude_das_integracoes (entrega) e bm-monitor (status/cobranca da conta).", parameters: { type: "object", properties: {} } } },
  { type: "function", function: { name: "ler_entregas_digest", description: "ESP-41: config de digest (cadencia/slots, e-mails, alerta critico) + entregas recentes (digest e alerta critico) da empresa da conversa, com status por entrega. Use quando o usuario pergunta 'o relatorio de hoje foi enviado?/chega por e-mail?/qual o horario do digest'. Leitura pura: reflete o que a edge enviar-digest e o trigger gravaram; status sem_provedor = falta configurar e-mail, sem_destinatario = sem e-mail cadastrado (nesses casos o digest segue no chat).", parameters: { type: "object", properties: { dias: { type: "integer", description: "Janela em dias (default 7)." } } } } },
  { type: "function", function: { name: "computar_perfil_vencedor", description: "ESP-34: computa e VERSIONA o perfil do vencedor da empresa da conversa e devolve a versao gravada. Usa a MESMA regua de evaluate_winners/ESP-01 (janela, >=30 resultados e >=30 gasto, custo <= teto_vigente*0,80) e enriquece com a peca do Drive de origem (ESP-33). Grava uma nova versao (dedup no mesmo dia salvo forcar=true). NAO publica nada, NAO substitui get_recommendations (fila acionavel) e NAO dispensa aprovacao humana de escala (vencedor mora em ESCALA, ESP-39). Use quando o usuario quer consolidar/atualizar 'o que esta vencendo'.", parameters: { type: "object", properties: { dias: { type: "integer", description: "Janela em dias (default 7)." }, forcar: { type: "boolean", description: "Regrava mesmo se identico ao perfil de hoje (default false)." } } } } },
  { type: "function", function: { name: "ler_perfil_vencedor", description: "ESP-34: le a ultima versao (ou uma versao especifica) do perfil do vencedor ja computado para a empresa da conversa, com vencedores, padroes agregados, criterio, procedencia e lacunas. Se nunca foi computado, avisa para chamar computar_perfil_vencedor. Leitura pura: nao recalcula.", parameters: { type: "object", properties: { versao: { type: "integer", description: "Versao especifica; se ausente, retorna a mais recente." } } } } },
  { type: "function", function: { name: "pode_pausar_por_custo", description: "Verifica se um anuncio pode ser avaliado para pausa por custo: libera quando maduro ou pela excecao dura de zero resultado, CTR baixo e piso de gasto. Exige company_id da conversa e ad_external_id. Nao verifica a guarda do unico conjunto/alternativa ativa; permitido aqui NAO significa seguro pausar.", parameters: { type: "object", properties: { ad_external_id: { type: "string" } }, required: ["ad_external_id"] } } },
  { type: "function", function: { name: "decidir_sobre_conjunto", description: "Decide manter, maturar, trocar criativo ou preparar reversao para um conjunto usando custo, volume e tendencia. Exige company_id da conversa e adset_external_id. A guarda do unico conjunto entregando sobrescreve pausa. Declara a lacuna: sem regua de IDEAL separada do teto, esta funcao nao prescreve escala.", parameters: { type: "object", properties: { adset_external_id: { type: "string" } }, required: ["adset_external_id"] } } },
  { type: "function", function: { name: "avaliar_escala", description: "Avalia se um conjunto esta apto a escala por duplicacao com no maximo +20%, usando a arvore de decisao, custo ate 80% do teto, volume e espera. Exige company_id da conversa e adset_external_id. Nao cobre CBO sem orcamento proprio; a espera enxerga apenas escalas registradas pelo sistema, nao alteracoes manuais.", parameters: { type: "object", properties: { adset_external_id: { type: "string" } }, required: ["adset_external_id"] } } },
  { type: "function", function: { name: "avaliar_pacing", description: "Calcula capacidade diaria da estrutura e, se meta_leads_dia for informada, o PISO de verba diaria ao custo atual. Exige company_id da conversa; meta_leads_dia e opcional. Declara que nao existe meta registrada e que a projecao nao e estimativa: escalar tende a elevar o custo, portanto a verba real pode ser maior.", parameters: { type: "object", properties: { meta_leads_dia: { type: "number" } } } } },
  { type: "function", function: { name: "validar_pedido_contra_contrato", description: "Valida um pedido (json) contra o contrato declarado em contrato_de_execucao para a acao. Assinatura real: (acao text, pedido jsonb). Se nao houver linhas vigentes para a acao, devolve valido=false com motivo contrato_desconhecido (nao inventa campos). Se faltar campo obrigatorio, recusa com faltando[]. Campos extras NAO invalidam - vao em nao_previstos_no_contrato para decisao humana. O contrato de criar_anuncio_a_partir_de e o MESMO vocabulario que pedido_de_anuncio_completo aceita: um pedido valido aqui e entendido la, e vice-versa. LACUNAS HONESTAS: o contrato foi derivado do codigo montarCriacao (meta-actions), nao de card executado; url_tags e opcional e vai no adcreative, nao no ad; meta_video_id/legenda/thumbnail_url sao opcionais da rota peca nova; status_inicial e opcional porque o executor FORCA ACTIVE no body (campanha/conjunto/anuncio) e nao le o payload. NAO substitui pedido_de_anuncio_completo (biblioteca, compliance, procedencia).", parameters: { type: "object", properties: { acao: { type: "string", description: "Ex.: criar_anuncio_a_partir_de, criar_conjunto_a_partir_de, criar_campanha." }, pedido: { type: "object", description: "Objeto com os campos do payload que o executor leria." } }, required: ["acao", "pedido"] } } },
  { type: "function", function: { name: "get_funnel", description: "Funil de MIDIA num periodo, com cobertura_real (dias efetivamente com dado). Nao contem proposta/contrato.", parameters: { type: "object", properties: { date_from: { type: "string" }, date_to: { type: "string" } } } } },
  { type: "function", function: { name: "get_ads_ranking", description: "RECORTE de criativos por custo MEDIO de midia numa janela de dias. ATENCAO - este e um recorte (breakdown) e serve para ENTENDER, nunca para PRESCREVER: a Meta aloca verba por custo MARGINAL (do proximo resultado), entao um criativo com media mais alta pode estar segurando o custo total. E PROIBIDO propor pausar ou reduzir um criativo com base apenas nesta ordenacao; prescricao exige teste isolado ou tendencia temporal. Para decidir escala ou corte, cruze com get_funil_credito (contrato pago por criativo) e consulte get_conhecimento(tema=otimizacao).", parameters: { type: "object", properties: { days: { type: "number" } } } } },
  { type: "function", function: { name: "get_campaign_detail", description: "Detalhe e serie diaria (14d) de UMA campanha pelo nome, com totais do periodo. Inclui special_ad_categories da CAMPANHA (FINANCIAL_PRODUCTS_SERVICES quando marcada) — a Meta aplica categoria especial no nivel campanha e os anuncios herdam. Cada dia e os totais trazem: gasto, impressoes, alcance, frequencia, cliques_todos, cliques_no_link, visualizacoes_lp, formularios, conversas, e os derivados ctr_todos, ctr_link, cpc_todos, cpc_link e cpm. DUAS BASES DE CLIQUE - NUNCA misture. Dia sem linha = coleta D-1 ainda nao chegou, nao entrega zero.", parameters: { type: "object", properties: { name_like: { type: "string" } }, required: ["name_like"] } } },
  { type: "function", function: { name: "auditar_compliance_financeira", description: "Auditoria de categoria especial + regras financeiras de UMA campanha e seus anuncios. Devolve special_ad_categories do espelho, se e financeira, lista de anuncios (status/CTA/destino/criado_pelo_sistema), alertas de segmentacao (idade/genero/LAL) e as regras ativas FIN/LGL/CRI. Use quando o gestor perguntar se anuncios respeitam finanças/categoria especial/regras da Meta. NAO diga que o campo nao existe: esta tool e get_campaign_detail leem. Complemente com get_conhecimento(tema=compliance) e check_compliance nas legendas. Confirmacao ao vivo: ler_pipeboard get_campaign_details.", parameters: { type: "object", properties: { name_like: { type: "string", description: "Nome (ou trecho) da campanha" } }, required: ["name_like"] } } },
  { type: "function", function: { name: "get_analise_visual_drive", description: "VEREDITO VISUAL POR PECA das midias do Drive, ja persistido: para cada arquivo, produto detectado PELOS PIXELS da miniatura, texto visivel, risco de compliance e veredito aproveitavel sim/nao/incerto com motivo. USE SEMPRE que o gestor pedir para classificar/avaliar/escolher pecas da pasta - e leitura instantanea de analise ja feita. Se total_analisados < inventario, ha pecas novas sem analise: diga que a classificacao delas exige a analise profunda, nao invente veredito. Os INCERTO (maioria videos - so um frame foi visto) sao a lista curta para conferencia humana.", parameters: { type: "object", properties: {} } } },
  { type: "function", function: { name: "get_drive_criativos", description: "INVENTARIO DA PASTA DE CRIATIVOS NOVOS no Google Drive (somente leitura): caminho (1o nivel=formato, 2o nivel=eixo de mensagem), nome, tipo, data e thumbnail de cada arquivo, com resumo por formato e por eixo. Use para LISTAR o que existe na pasta. Para VEREDITO DE CONTEUDO por peca (aproveitavel ou nao, produto, risco), use get_analise_visual_drive - a classificacao visual ja esta persistida. LIMITES A DECLARAR: leitura de inventario e thumbnail - nao le conteudo interno de video; e CONCEDER permissao de acesso a pessoas segue sendo acao manual no Drive, fora do sistema.", parameters: { type: "object", properties: {} } } },
  { type: "function", function: { name: "get_acervo_para_anuncio", description: "LEITURA TOTAL do acervo do Drive. SEMPRE taxonomia_drive + inventario_global. Carrossel Meta HABILITADO via child_attachments. Videos liberados FIN-04 sao inventario apto (NAO confundir com o slate do pedido do gestor). Em lote/mix: chame SEM produto primeiro e cite o slate que o gestor pediu. Quando o slate JA tem drive_file_ids conhecidos (ex. 'emite os 5'), passe drive_file_ids para recorte compacto — evite dump completo.", parameters: { type: "object", properties: { produto: { type: "string", description: "Opcional. Em lote/mix deixe vazio na 1a chamada." }, incluir_inaptas: { type: "boolean", description: "Padrao true." }, drive_file_ids: { type: "array", items: { type: "string" }, description: "Opcional. Recorte: so estes arquivos (slate conhecido). Preferir ao inventariar de novo antes de emitir." } } } } },
  { type: "function", function: { name: "upload_midia", description: "Sobe UMA peca do Drive (imagem ou video) para a biblioteca da conta Meta (Graph adimages/advideos) e grava meta_image_hash ou meta_video_id em media_uploads. USE quando get_acervo_para_anuncio mostrar na_biblioteca_da_meta=false e o gestor quiser anunciar essa peca. NAO cria anuncio, NAO emite card. Respeita flag upload_midia e teto de 5 acoes/hora. Idempotente: se ja enviou, devolve o id existente sem reenviar. VIDEO: o id pode existir antes do processamento terminar - o retorno traz status_processamento/pronto; se pronto!=true, NAO emita o card ainda; diga o estado real e tente de novo depois (nao invente prazo). Off-brand/reprovadas: so suba se o gestor pedir explicitamente essa peca.", parameters: { type: "object", properties: { drive_file_id: { type: "string", description: "Id do arquivo no Drive (vem de get_acervo_para_anuncio)." }, account_id: { type: "string", description: "Opcional; default = unica conta permitida da empresa." } }, required: ["drive_file_id"] } } },
  { type: "function", function: { name: "get_funil_credito", description: "FORA DE ESCOPO desde 28/07/2026: CRM/conversao final foram removidos do sistema por decisao da empresa. Esta ferramenta existe so por compatibilidade e devolve um aviso de fora-de-escopo. NAO a chame; se o gestor pedir proposta/contrato/receita, explique a exclusao e ofereca as metricas de midia.", parameters: { type: "object", properties: { dias: { type: "number", description: "janela em dias (default 90). Use a MESMA janela do get_funnel ao comparar." } } } } },
  { type: "function", function: { name: "renomear_campanha", description: "Emite CARD DE APROVACAO para renomear campanha existente pelo update_campaign nativo do Pipeboard. NAO altera antes da aprovacao. ESP-40/39: o novo nome e COMPOSTO a partir de marca/canal/objetivo_tag/papel(TESTE|ESCALA)/periodo (+ produto/rotulo opcionais) no padrao [MARCA][CANAL][OBJ][PROD?][PAPEL][ROT?][PER] — novo_nome livre foi aposentado. Localiza a campanha atual pelo nome; ambiguidade exige nome completo. Ao aprovar, meta-actions exige Pipeboard, envia somente campaign_id + name e reconcilia pela Graph.", parameters: { type: "object", properties: { campanha_atual: { type: "string" }, marca: { type: "string" }, canal: { type: "string" }, objetivo_tag: { type: "string" }, produto: { type: "string" }, papel: { type: "string", description: "TESTE ou ESCALA (obrigatorio ESP-39)" }, rotulo: { type: "string" }, periodo: { type: "string" }, justificativa: { type: "string" } }, required: ["campanha_atual", "canal", "papel", "periodo"] } } },
  { type: "function", function: { name: "propose_action", description: "Cria PEDIDO DE APROVACAO (ActionCard). NAO executa nada: o card fica PENDENTE, so um administrador aprova, e expira em 24h se nao for decidido. Exige sempre justificativa, metrica_sucesso e reversa. ACOES SOBRE OBJETOS: pausar_criativo, ativar_criativo, escalar_criativo, pausar_campanha, ativar_campanha, pausar_conjunto, ativar_conjunto, alterar_orcamento, ajustar_posicionamentos_do_conjunto e renomear_campanha. pausar_conjunto: target_name e o CONJUNTO (ad set); a guarda do unico conjunto entregando bloqueia o card se pausar este zerar entrega (decidir_sobre_conjunto). ATIVAR e PAUSAR nos tres niveis (campanha/conjunto/criativo) via card: ativar_campanha, ativar_conjunto, ativar_criativo e os pausar_*. Criacao (criar_campanha / criar_conjunto / criar_anuncio / escalar_duplicar) nasce ACTIVE na aprovacao. Para ajustar_posicionamentos_do_conjunto (acao CORRETIVA de conjunto antigo/de teste), target_name e o conjunto e params.formato_midia e obrigatorio (video|imagem); o sistema deriva as incompatibilidades pelo formato. VIDEO aplica o padrao manual observado nos 3 conjuntos de video ACTIVE (publisher_platforms=[facebook] + 8 facebook_positions, sem facebook.right_hand_column); IMAGEM nao exclui nada. A escrita so ocorre depois da aprovacao e e relida/reconciliada pela Graph. ACOES DE CRIACAO: criar_campanha, criar_conjunto_a_partir_de, criar_anuncio_a_partir_de, escalar_duplicar. ESP-40/39 NOMENCLATURA: o nome do objeto NOVO e COMPOSTO — params.marca (default LEV), params.canal, params.objetivo_tag (ou objetivo ODAX), params.periodo obrigatorios; params.produto e params.rotulo opcionais. CAMPANHA exige tambem params.papel=TESTE|ESCALA (ESP-39: vencedores e testes em campanhas SEPARADAS). Padrao [MARCA][CANAL][OBJ][PROD?][PAPEL?][ROT?][PER]. Nome livre (target_name/nome_novo soltos) e RECUSADO. Para criar_campanha, target_name pode ser omitido (composto pelas partes). escalar_duplicar (ESP-25/39): target_name = conjunto a escalar; so emite se avaliar_escala.apto_a_escalar; orcamento travado em +20% da RPC; NAO fica em campanha TESTE — se o molde esta em TESTE, informe params.campanha_destino de uma campanha ESCALA; targeting herdado; nasce ACTIVE; NAO edita o original. Anuncios nao sao copiados neste card. Para criar_conjunto_a_partir_de: target_name = nome EXATO do conjunto molde OU 'sem_molde' (so familia engajamento/reconhecimento). Molde OFFSITE_CONVERSIONS e ACEITO em engajamento — so empresta targeting; executor grava POST_ENGAGEMENT + page_id. Params: plataformas_publicacao (default facebook+instagram), formato_midia_previsto quando Facebook, objetivo_tag/familia_objetivo/page_id/optimization_goal para social. PROIBIDO recusar IMPULSAO por falta de molde POST_ENGAGEMENT. Tudo que e criado nasce ACTIVE.", parameters: { type: "object", properties: { action_type: { type: "string", enum: ["pausar_criativo", "escalar_criativo", "pausar_campanha", "pausar_conjunto", "alterar_orcamento", "renomear_campanha", "ajustar_posicionamentos_do_conjunto", "criar_campanha", "criar_conjunto_a_partir_de", "criar_anuncio_a_partir_de", "escalar_duplicar"] }, target_name: { type: "string" }, justificativa: { type: "string" }, mecanismo: { type: "string" }, metrica_sucesso: { type: "string" }, janela_leitura: { type: "string" }, reversa: { type: "string" }, risco: { type: "string" }, params: { type: "object", description: "ESP-40/39 nome: marca, canal, objetivo_tag, periodo, papel(TESTE|ESCALA em campanha) (+ produto, rotulo). Escala: campanha_destino se origem TESTE. Criacao de conjunto: plataformas_publicacao; formato_midia_previsto quando Facebook; engajamento: sem_molde ou molde qualquer + familia_objetivo/page_id/optimization_goal. Demais campos da acao." } }, required: ["action_type", "target_name", "justificativa", "metrica_sucesso", "reversa"] } } },
  { type: "function", function: { name: "gerar_legendas", description: "ESP-37 MOTOR DE LEGENDA: gera exatamente 3 variantes no framework Hook→Beneficio/prova→CTA+CET (FIN-04). Cada variante ja passou por compliance-check (e checar_par_texto_e_peca se drive_file_id). NAO cria anuncio e NAO emite card. As variantes ficam GRAVADAS em conversation_legendas desta conversa (peca_chave/drive_file_id). Use quando o gestor pedir legendas/copy. Depois escolha UMA com apto_para_card=true e passe em propose_action criar_anuncio_a_partir_de com params.legenda, legenda_fonte=agente e legenda_referencias. VOCE preenche legenda_referencias — NUNCA peca ao gestor para confirmar a referencia. Nao improvise legendas soltas no chat sem registrar depois com registrar_legenda_da_conversa.", parameters: { type: "object", properties: { produto: { type: "string", description: "Ex.: CLT (default)." }, objetivo: { type: "string", description: "O que a legenda deve comunicar (obrigatorio)." }, eixo: { type: "string", description: "Sinonimo de objetivo." }, drive_file_id: { type: "string", description: "Opcional: peca do Drive para alinhar ao par texto+peca." }, peca_chave: { type: "string", description: "Chave estavel no slate (ex.: carrossel_5, card_capa_1). Default = drive_file_id ou objetivo." }, referencias: { type: "array", items: { type: "string" }, description: "Ate 5 legendas de referencia (estilo)." } }, required: ["objetivo"] } } },
  { type: "function", function: { name: "get_legendas_da_conversa", description: "MEMORIA DURAVEL de legendas desta conversa (conversation_legendas). Devolve texto INTEGRAL por peca_chave/drive_file_id. OBRIGATORIO chamar ANTES de dizer que legenda 'nao existe' / 'texto integral nao disponivel' ou de pedir ao gestor para colar copy. Se a peca esta aqui, use o texto — nunca invente amnesia.", parameters: { type: "object", properties: { peca_chave: { type: "string" }, drive_file_id: { type: "string" } } } } },
  { type: "function", function: { name: "registrar_legenda_da_conversa", description: "Grava/atualiza UMA legenda no store duravel desta conversa. Use quando voce propuser copy no chat SEM passar por gerar_legendas (ex.: slate de impulsão com legenda editorial), ou para marcar a variante selecionada pelo gestor. peca_chave estavel (carrossel_2, card_capa_1, …) + legenda integral. Com drive_file_id quando houver.", parameters: { type: "object", properties: { peca_chave: { type: "string" }, legenda: { type: "string" }, drive_file_id: { type: "string" }, variante_indice: { type: "number" }, selecionada: { type: "boolean" }, objetivo: { type: "string" } }, required: ["peca_chave", "legenda"] } } },
  { type: "function", function: { name: "check_compliance", description: "GUARDIAO DE COMPLIANCE: valida legenda e/ou criativo contra base de regras versionada.", parameters: { type: "object", properties: { legenda: { type: "string" } } } } },
  { type: "function", function: { name: "get_criativos_conteudo", description: "CONTEUDO REAL DOS ANUNCIOS ja coletado pelo sync: legenda (texto do anuncio), titulo, CTA, se tem imagem, gasto acumulado, formularios e status. Traz tambem destino_url (link do CTA do criativo) e destino (whatsapp quando wa.me/api.whatsapp, senao site): O NUMERO DE WHATSAPP DE DESTINO de cada peca SAI DAQUI (ex.: wa.me/5571993451315). Isso e CONFIG do criativo coletada do Pipeboard - NAO confunda com a analitica de conversa WABA (pos-clique), que esta congelada; o numero de destino do anuncio E legivel e voce DEVE informa-lo quando perguntado. Use para auditar compliance das pecas EM OPERACAO sem pedir o texto ao usuario (pegue a legenda aqui e passe para check_compliance), e para qualquer pergunta sobre o que os anuncios dizem. Pode vir truncado: leia os campos exibidos/omitidos/aviso_corte e nunca trate item omitido como inexistente. PARA ACHAR UM ANUNCIO ESPECIFICO use busca_nome em vez de folhear: sao 67 anuncios, a lista completa vem cortada, e o que voce procura pode estar justamente no pedaco omitido - foi assim que anuncio existente passou por inexistente. Com busca_nome o retorno traz total_que_casam_com_a_busca, e SO se ele for zero o anuncio realmente nao existe.", parameters: { type: "object", properties: { somente_ativas: { type: "boolean", description: "true (recomendado) = so criativos em campanha ativa; false = historico completo, payload maior e mais truncado. COM busca_nome o default ja e false, porque anuncio procurado pelo nome quase sempre esta pausado - nao passe true junto de busca_nome sem motivo, senao a busca pode devolver zero para peca que existe." }, busca_nome: { type: "string", description: "Parte do nome do anuncio. Insensivel a maiusculas e casa por pedaco: 'reel02' acha 'AD_LPV2_A1_Reel02'. Devolve os itens com legenda inteira, creative_id e external_id - e e o caminho certo para achar o MOLDE antes de propor criar_anuncio_a_partir_de. Sem este campo vem a listagem completa com legendas_unicas (dedupe para auditoria de compliance do acervo)." }, pagina: { type: "integer", description: "So com busca_nome. Comeca em 1, 20 itens por pagina; leia 'restantes' para saber se ha mais." } } } } },
  { type: "function", function: { name: "get_conhecimento", description: "BASE DE CONHECIMENTO TECNICA consultavel: politicas da Meta e compliance financeiro no Brasil, atlas de metricas com linha do tempo historica, criacao e edicao de campanha/conjunto/anuncio, otimizacao e diagnostico (Breakdown Effect, fase de aprendizado, fadiga, gates de escala), operacao da Marketing API, unidade economica e analise critica, e biblioteca de criativo (formatos visuais, taticas de hook, mecanicas, padroes de voz). Use SEMPRE que a pergunta for conceitual, de politica, de metodo, de definicao de metrica, ou quando precisar propor/auditar criativo com fundamento. Os temas disponiveis estao listados no seu contexto. Se o tema for extenso, o retorno vem parcial com o indice das secoes: chame de novo com o parametro 'secao' para ler o resto.", parameters: { type: "object", properties: { tema: { type: "string", description: "o tema exato, conforme a lista no seu contexto" }, secao: { type: "string", description: "opcional: titulo (ou parte) de uma secao especifica do tema" } }, required: ["tema"] } } },
  { type: "function", function: { name: "get_estrutura_conjuntos", description: "ESTRUTURA DOS CONJUNTOS desta empresa: nome, status, estrategia de lance, orcamento (no conjunto = ABO, na campanha = CBO), segmentacao com pais, faixa de idade, interesses e PUBLICOS PERSONALIZADOS, gasto e formularios. Traz tambem, por conjunto, a PEGADA do anuncio a partir da config coletada: optimization_goal (evento que a Meta otimiza), destination_type, pegada (engajamento_topo | trafego | trafego_para_whatsapp_nao_otimizado | conversao_mensagem_otimizada | leads | conversao_site | outro), destino_predominante (whatsapp|site) e numeros_whatsapp (numeros de destino extraidos do link do criativo). Use isto para responder se os anuncios tem pegada ORGANICA/ENGAJAMENTO ou de CONVERSAO para WhatsApp e QUAL numero recebe cada conjunto. ATENCAO a nuance: pegada=trafego_para_whatsapp_nao_otimizado significa que a peca MANDA para o WhatsApp (destino wa.me) porem o conjunto otimiza por LINK_CLICKS e nao por CONVERSATIONS - a Meta entrega por clique barato, nao por quem inicia conversa. Vem PAGINADO em 20 por vez, ordenado por gasto. Se o campo 'restantes' vier maior que zero, chame de novo com a pagina seguinte ANTES de concluir qualquer coisa sobre o conjunto de conjuntos - e NUNCA afirme percentual sobre o total a partir de uma pagina so. Historico de ALTERACOES (activities) nao vem aqui: use ler_pipeboard com get_account_activities.", parameters: { type: "object", properties: { pagina: { type: "number", description: "Pagina, comecando em 1. Use a seguinte enquanto 'restantes' for maior que zero." } } } } },
  { type: "function", function: { name: "listar_ferramentas_pipeboard", description: "Catalogo ao vivo das ferramentas de LEITURA do Pipeboard (get_/list_/search_/estimate_/...). Use quando precisar saber QUAL endpoint chama para um dado que as tools de DB nao cobrem (pages, pixels, audiences, activities, breakdowns, Instagram, lead forms, catalogs, etc.). Depois chame ler_pipeboard com o nome exato.", parameters: { type: "object", properties: {} } } },
  { type: "function", function: { name: "ler_pipeboard", description: "Leitura AO VIVO do Pipeboard na conta Meta da empresa desta conversa. Preferir tools de DB (get_overview, get_campaign_detail, get_estrutura_conjuntos, get_criativos_conteudo, funil/ranking) quando bastarem. Use ler_pipeboard quando faltar dado: config fresca do dia, breakdown, activities, pages, pixels, audiences, insights pontuais, creatives detalhados, etc. Parametro ferramenta = nome exato do catalogo (ex.: get_adset_details, get_insights, get_account_pages). argumentos = objeto JSON do schema da ferramenta. SO leitura: create/update/delete/upload sao recusados. Contas fora da empresa sao recusadas. Resposta pode vir truncada (aviso_corte).", parameters: { type: "object", properties: { ferramenta: { type: "string", description: "Nome exato da tool Pipeboard de leitura (ex.: get_campaign_details)." }, argumentos: { type: "object", description: "Argumentos da tool (account_id e injetado se a empresa tiver uma unica conta)." } }, required: ["ferramenta"] } } },
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
  const pedeConhecimento = /como funciona|por que|explique|conceito|politica|regra da meta|categoria especial|financas|financeiro|compliance|hook|formato|fadiga|aprendizado|learning|breakdown|metrica|historic|sazonal|sugira|briefing/.test(p);
  const pedeComplianceFin = /categoria especial|financ|credit|compliance|fin-0|respeit.*regra|categorizad/.test(p);
  // v28.6: pergunta sobre estado de card/aprovacao/criacao tem prioridade MAXIMA. Era
  // justamente esse tipo de pergunta que o agente respondia de cabeca por nao ter a fila.
  const pedeFila = /card|aprova|pendente|aprovado|criou|criad|emiti|executou|executad|fila|sino|notificac|subiu|apareceu/.test(p);
  if (pedeFila && nome === "get_aprovacoes") return 0;
  // v28.32: dicas/recomendacoes da Meta — so get_meta_dicas (+ fila interna). Nao gastar o
  // lote em Pipeboard/catalogo; foi o padrao que estourava 150s em pergunta simples.
  const pedeMetaDica = /dica.*meta|recomendac.*(meta|facebook|anuncio|impulsionar|boost)|meta emitiu|meta.*recomend|impulsionar.*(anuncio|eles|campanha)|opportunity score|recomendacao da meta/.test(p);
  if (pedeMetaDica && (nome === "get_meta_dicas" || nome === "get_recommendations")) return 0;
  if (pedeMetaDica && (nome === "listar_ferramentas_pipeboard" || nome === "ler_pipeboard")) return 99;
  // v28.31: pedido de emitir cards — propose_action primeiro; nao gastar o teto em re-auditoria.
  const pedeEmitir = /\bemite|\bemita|\bemiss[aã]o|\bcards?\b.*\baprov|\baprova.*\bcard|criar_anuncio|propose_action/.test(p);
  if (pedeEmitir && nome === "propose_action") return 0;
  if (pedeUtm && nome === "panorama_utm_anuncios") return 0;
  if (pedeCustoLlm && nome === "custo_llm_periodo") return 0;
  if (pedeSaudeIntegracao && nome === "saude_das_integracoes") return 0;
  if (pedeTeto && nome === "teto_vigente") return 0;
  if (pedeConhecimento && nome === "get_conhecimento") return 0;
  if (pedeComplianceFin && (nome === "auditar_compliance_financeira" || nome === "get_campaign_detail" || nome === "check_compliance")) return 0;
  if (pedeCriativo && (nome === "get_acervo_para_anuncio" || nome === "upload_midia" || nome === "get_criativos_conteudo" || nome === "check_compliance" || nome === "gerar_legendas" || nome === "get_legendas_da_conversa" || nome === "registrar_legenda_da_conversa" || nome === "checar_par_texto_e_peca" || nome === "nota_visual_da_peca")) return 0;
  if (pedeReceita && nome === "get_funil_credito") return 0;
  if (pedeEstrutura && nome === "get_estrutura_conjuntos") return 0;
  const base: Record<string, number> = {
    get_aprovacoes: 1, propose_action: 1, get_overview: 2, get_funil_credito: 3, get_alerts: 4,
    get_criativos_conteudo: 5, check_compliance: 6, get_funnel: 7, get_ads_ranking: 8,
    teto_vigente: 2, checar_par_texto_e_peca: 2, custo_llm_periodo: 2, panorama_utm_anuncios: 2,
    nota_visual_da_peca: 3, saude_das_integracoes: 3, get_acervo_para_anuncio: 3, upload_midia: 3,
    get_estrutura_conjuntos: 9, get_conhecimento: 9, auditar_compliance_financeira: 4, get_recommendations: 11, get_meta_dicas: 5,
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
async function t_drive_criativos(companyId: string) {
  const { data: plano, error: planoError } = await supa.rpc("drive_plano_de_varredura", {
    p_company_id: companyId,
  });
  const pastas = Array.isArray((plano as any)?.pastas_ativas) ? (plano as any).pastas_ativas : [];
  const raizes = pastas
    .map((p: any) => ({ id: String(p?.folder_id ?? ""), nome: String(p?.nome ?? "(pasta)") }))
    .filter((p: any) => p.id);
  if (!raizes.length) {
    return {
      erro: "nenhuma_pasta_drive_configurada_para_esta_empresa",
      detalhe: planoError?.message ?? null,
      aviso: "Falha fechada: o fallback global foi removido para impedir leitura de criativos de outra empresa.",
    };
  }
  let token: string;
  try { token = await driveToken(); }
  catch (e) { return { erro: String((e as any)?.message ?? e), aviso: "Sem acesso ao Drive nesta rodada - o dado NAO foi lido; nao trate como pasta vazia." }; }
  const MAX_PASTAS = 40, MAX_ARQUIVOS = 250, MAX_PROFUNDIDADE = 4;
  type No = { id: string; caminho: string; nivel: number };
  const fila: No[] = raizes.map((raiz: any) => ({ id: raiz.id, caminho: raiz.nome, nivel: 0 }));
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
      case "get_meta_dicas": {
        const dias = Math.max(1, Math.min(90, Number(args?.dias ?? 14) || 14));
        const veredito = args?.veredito != null ? String(args.veredito) : null;
        const { data, error } = await supa.rpc("get_meta_dicas", {
          p_company_id: ctx.companyId,
          p_dias: dias,
          p_veredito: veredito,
        });
        if (error) return { erro: error.message };
        return data;
      }
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
      case "casar_criativo_performance": return await t_rpc("casar_criativo_performance", {
        p_company_id: ctx.companyId,
        p_drive_file_id: args?.drive_file_id == null || String(args.drive_file_id).trim() === "" ? null : String(args.drive_file_id),
        p_ad_external_id: args?.ad_external_id == null || String(args.ad_external_id).trim() === "" ? null : String(args.ad_external_id),
        p_dias: Number(args?.dias ?? 7),
      });
      case "ler_brand_identity": return await t_rpc("ler_brand_identity", { p_company_id: ctx.companyId });
      case "score_de_prontidao": return await t_rpc("score_de_prontidao", { p_company_id: ctx.companyId });
      case "saude_dos_tokens": return await t_rpc("saude_dos_tokens", { p_company_id: ctx.companyId });
      case "ler_entregas_digest": return await t_rpc("ler_entregas_digest", { p_company_id: ctx.companyId, p_dias: Number(args?.dias ?? 7) });
      case "computar_perfil_vencedor": return await t_rpc("computar_perfil_vencedor", {
        p_company_id: ctx.companyId,
        p_dias: Number(args?.dias ?? 7),
        p_forcar: args?.forcar === true,
      });
      case "ler_perfil_vencedor": return await t_rpc("ler_perfil_vencedor", {
        p_company_id: ctx.companyId,
        p_versao: args?.versao == null || String(args.versao).trim() === "" ? null : Number(args.versao),
      });
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
      case "renomear_campanha": return await t_renomear_campanha(ctx.companyId, ctx.convId, ctx.requestedBy, args, ctx.cards);
      case "auditar_compliance_financeira":
        return await t_auditar_compliance_financeira(ctx.companyId, String(args?.name_like ?? ""));
      case "check_compliance": return await t_check_compliance(ctx.companyId, String(args?.legenda ?? "").trim(), ctx.imgAtts, ctx.mcpKey);
      case "gerar_legendas": return await t_gerar_legendas(ctx.companyId, ctx.mcpKey, args, ctx.convId);
      case "get_legendas_da_conversa": return await t_get_legendas_da_conversa(ctx.companyId, ctx.convId, args);
      case "registrar_legenda_da_conversa": return await t_registrar_legenda_da_conversa(ctx.companyId, ctx.convId, args);
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
      case "get_drive_criativos": return await t_drive_criativos(ctx.companyId);
      case "get_analise_visual_drive": {
        const { data, error } = await supa.rpc("get_drive_analises", { p_company_id: ctx.companyId });
        return error ? { erro: error.message } : data;
      }
      case "get_acervo_para_anuncio": {
        const produto = String(args?.produto ?? "").trim();
        const idsFiltro = Array.isArray(args?.drive_file_ids)
          ? (args.drive_file_ids as unknown[]).map((x) => String(x ?? "").trim()).filter(Boolean)
          : [];
        const rpcArgs: Record<string, unknown> = {
          p_company_id: ctx.companyId,
          p_produto: produto || null,
          p_incluir_inaptas: args?.incluir_inaptas === false ? false : true,
        };
        // p_drive_file_ids so existe apos migracao v28.31; se a RPC antiga rejeitar o arg, cai sem filtro.
        if (idsFiltro.length) rpcArgs.p_drive_file_ids = idsFiltro;
        let data: any = null;
        let error: any = null;
        ({ data, error } = await supa.rpc("get_acervo_para_anuncio", rpcArgs));
        if (error && idsFiltro.length && /p_drive_file_ids|function.*does not exist|Could not find/i.test(String(error.message ?? ""))) {
          ({ data, error } = await supa.rpc("get_acervo_para_anuncio", {
            p_company_id: ctx.companyId,
            p_produto: produto || null,
            p_incluir_inaptas: args?.incluir_inaptas === false ? false : true,
          }));
          if (!error && data && typeof data === "object" && Array.isArray((data as any).itens)) {
            const want = new Set(idsFiltro);
            const itens = ((data as any).itens as any[]).filter((it) => want.has(String(it?.drive_file_id ?? "")));
            data = { ...data, itens, filtro_drive_file_ids: idsFiltro, filtro_aplicado_no_edge: true,
              total_no_acervo_apos_filtro: itens.length };
          }
        }
        if (error) return { erro: error.message };
        return compactarAcervoParaAgente(data, idsFiltro.length > 0);
      }
      case "upload_midia": {
        const dfid = String(args?.drive_file_id ?? "").trim();
        if (!dfid) return { erro: "drive_file_id obrigatorio" };
        const accountId = String(args?.account_id ?? "").trim() || undefined;
        const out = await t_upload_midia(ctx.companyId, dfid, ctx.mcpKey, accountId);
        // Traduz para o agente: o que fazer a seguir, sem jargao de edge.
        if (out?.recusado) {
          return {
            ok: false,
            recusado: true,
            motivo: out.motivo,
            mensagem: `Upload recusado: ${out.motivo}. Nao invente o id; resolva a trava (flag/teto/conta) ou aguarde a proxima janela do teto.`,
          };
        }
        if (out?.error || out?.erro) {
          return { ok: false, erro: out.error ?? out.erro, mensagem: "Upload falhou. Relate o erro exato ao gestor." };
        }
        return {
          ok: true,
          dedup: !!out?.dedup,
          enviado: !!out?.enviado,
          drive_file_id: dfid,
          meta_video_id: out?.video_id ?? null,
          meta_image_hash: out?.image_hash ?? null,
          status_processamento: out?.status_processamento ?? null,
          pronto: out?.pronto ?? (out?.image_hash ? true : null),
          nota: out?.nota ?? null,
          proximo_passo: out?.video_id && out?.pronto !== true
            ? "Video ainda pode estar processando. Nao emita o card agora; diga o estado real e tente propor depois."
            : "Peca na biblioteca. Pode propor criar_anuncio_a_partir_de com este drive_file_id.",
        };
      }
      case "get_estrutura_conjuntos":
        return await t_estrutura_conjuntos(ctx.companyId, Number(args?.pagina ?? 1));
      case "listar_ferramentas_pipeboard":
        return await t_listar_ferramentas_pipeboard();
      case "ler_pipeboard":
        return await t_ler_pipeboard(
          ctx.companyId,
          String(args?.ferramenta ?? args?.tool ?? ""),
          (args?.argumentos && typeof args.argumentos === "object" && !Array.isArray(args.argumentos))
            ? args.argumentos as Record<string, unknown>
            : ((args?.args && typeof args.args === "object" && !Array.isArray(args.args))
              ? args.args as Record<string, unknown>
              : {}),
        );
      case "get_aprovacoes": return await t_aprovacoes(ctx.companyId, args?.apenas_abertos === false ? false : true);
      case "get_conhecimento": return await t_conhecimento(String(args?.tema ?? ""), args?.secao ? String(args.secao) : undefined);
      default: return { erro: `tool desconhecida: ${name}` };
    }
  } catch (e) { return { erro: String((e as any)?.message ?? e) }; }
}

function systemPrompt(companyName: string, memoria: string, estilo: string, indiceConhecimento: string) {
  const legal = norm(companyName).includes("legal");
  const perfil = legal
    ? "Empresa de credito consignado; aplique regras financeiras/Categoria Especial quando os dados da campanha confirmarem esse produto."
    : "COHAPM e cooperativa habitacional, nao empresa de credito. Nao aplique consignado, benchmarks, identidades, produtos ou contas da Legal e Viver.";
  return `Voce e o Gestor de Trafego IA da ${companyName}. Hoje e ${today()} (fuso de Brasilia). Responde ao gestor (Roberto) em portugues brasileiro.
PERFIL EMPRESARIAL: ${perfil}
HOJE e essa data e mais nenhuma: NUNCA redefina 'hoje' a partir do ultimo dia com dado. A coleta fecha em D-1, entao o ultimo dia coletado costuma ser ONTEM; chamar esse dia de 'hoje' e ERRO. Ao declarar uma janela, diga a data de hoje e, separadamente, qual foi o ultimo dia com dado.

== QUEM VOCE E ==
Voce nao e um assistente que responde perguntas: e o profissional responsavel por onde o dinheiro de midia e colocado e por que. A conversa e entre pares - sem didatismo, sem entusiasmo de vendedor, sem se desculpar por dar ma noticia. Sua missao: captar mais e melhor pelo menor custo sustentavel - SEM comprar volume barato que nao vira negocio, SEM arriscar a conta de anuncios, SEM queimar os numeros de WhatsApp, SEM degradar pagina e perfil (ativo organico e infraestrutura de midia - ja houve conta com ~R$94 mil gastos derrubada por propagacao de restricao do organico) e SEM transformar base sem consentimento em publico.
Voce e um SUPER GESTOR: facilita a vida de quem usa o sistema. Monta a solucao completa, decide o caminho operacional padrao e emite o card pronto. O humano aprova (ou recusa) atos drasticos — ele NAO monta o card por voce, NAO te ensina o contrato e NAO preenche campos que o espelho/config ja tem.

== AUTONOMIA vs APROVACAO (15/08/2026 — incidente criar criativo) ==
- DECIDA E EMITA: legenda_referencias (quando legenda_fonte=agente), partes ESP-40 (marca/canal/objetivo/periodo/produto/rotulo com defaults da casa), molde REAL do espelho ou sem_molde+drive_file_id, identidade Instagram da config, Threads OFF, Coluna da direita OFF em video, plataformas padrao facebook+instagram, utm_campaign (use o que o gestor deu; se nao deu, derive do rotulo/periodo).
- NUNCA INVENTE: nome de molde, creative_id, external_id, meta_video_id, anuncio que nao existe no espelho, nem o SLATE do pedido (trocar 3 videos+carrossel+card por "5 videos" e falta grave). Inventar e falta grave — releia get_criativos_conteudo / get_acervo_para_anuncio / get_aprovacoes / a mensagem do gestor.
- NUNCA ENTREVISTE O CONTRATO: nao peca ao gestor "confirme que a legenda foi baseada no Video10", "qual molde uso", "me diga as partes do nome". Isso e trabalho SEU. Se faltou dado tecnico, consulte a tool de novo e reemitir.
- SO PERGUNTE o que e DECISÃO DE NEGOCIO do gestor e nao da para inferir: orcamento diario quando ele nao informou; escolha entre pecas EQUIVALENTES que voce ja listou com veredito; identificador UTM quando ele quiser um rotulo especifico no Dash (senao derive).
- Card e o produto: a solucao chega montada no ActionCard. Texto de chat explica o plano em 1 bloco; a ferramenta propose_action fecha o ato.

== HIERARQUIA DE PRIORIDADES (quando duas coisas boas se contradizem, esta ordem decide) ==
1. Nao causar dano irreversivel: conta de anuncios, qualidade de numero de WhatsApp, ativo organico, exposicao regulatoria.
2. Verdade sobre o dado: lacuna declarada vale mais que numero bonito - e declarar lacuna onde NAO ha lacuna tambem e dano (confira antes de dizer "nao temos").
3. Proteger o custo: teto resolvido por teto_vigente (meta de negocio governa quando existir; historico e apenas consistencia), protecao de custo no conjunto, gasto sob controle.
4. Volume e escala - depois das tres acima.
5. Elegancia da analise - nunca acima de nenhuma.

== DOUTRINA DE DECISAO ==
- DIGA DE QUEM FALA: empresa e categoria regulatoria antes do nivel (conta/campanha/conjunto/anuncio). Doutrina de credito NAO se aplica a empresa que nao e de credito. NUNCA compare empresas de categorias distintas.
- LEITURA HIBRIDA PIPEBOARD: preferir tools de DB (get_overview, get_campaign_detail, get_estrutura_conjuntos, get_criativos_conteudo, funil/ranking) para o que ja esta sincronizado. Se faltar dado (breakdown, activities, pages, pixels, audiences, insights pontuais, config fresca do dia), chame listar_ferramentas_pipeboard e ler_pipeboard — NUNCA diga que "saiu de escopo" ou "nao tenho tool" se o Pipeboard expoe leitura para aquilo. Escrita continua so via propose_action.
- DICAS / RECOMENDACOES DA META NOS ANUNCIOS (20/08/2026): se o gestor perguntar se a Meta emitiu recomendacao, dica, boost ou opportunity score nos anuncios/campanhas/conjuntos, chame get_meta_dicas (e get_recommendations SO se quiser a fila INTERNA de custo). Cite SEMPRE o veredito interno — e PROIBIDO repetir a dica da Meta como se fosse nossa. NAO abra listar_ferramentas_pipeboard nem ler_pipeboard para essa pergunta. get_recommendations NAO e o badge do Ads Manager. Se get_meta_dicas vier vazio apos sync e o gestor apontar badge na UI, diga a assimetria documentada pela Meta (API pode listar menos que Ads Manager) — nao invente o texto da dica.
- Toda recomendacao tem 5 partes: evidencia (numero+janela), mecanismo, criterio de sucesso, prazo de leitura e REVERSA. Sem reversa, nao sai.
- Uma decisao por leitura. Escolha a janela ANTES de olhar o resultado; se duas janelas discordam, mostre as duas e diga qual decide.
- Sazonalidade: use somente calendario e produto comprovados para ${companyName}; produto nao identificado = nao invoque.
- Voce nao e o unico ator: antes de atribuir causa a criativo/publico, verifique o historico de alteracoes de configuracao (foto diaria - declare a granularidade).
- Teto de custo: chame teto_vigente e use SOMENTE a regua que o retorno disser que governa. Cite autor/data quando houver meta de negocio e declare divergencias/avisos. Nunca leia targets diretamente nem trate consistencia historica como veredito de negocio.
- Criacao em lote e degrau, nao rajada: proponha em etapas com leitura entre elas (motivo documentavel: limite de chamada e reinicio de aprendizado - nao invoque teoria de deteccao de automacao).
- Divergencia persistente se registra, nao se vence: se o gestor sobrepor sem novo dado, declare a divergencia, registre a evidencia e execute a decisao dele.
- Atribuicao com canais fora do sistema e DISPUTADA, nao apenas conservadora: outro canal pode ter originado o contato. Nao use atribuicao de canal unico como base para escalar.
- Plano de teste declara QUAIS dimensoes varia (objetivo, formato, eixo de mensagem, pagina, publico) e quais fixa; variar so uma exige dizer e justificar. Pedido de criar legendas: chame gerar_legendas (ESP-37, N=3, framework Hook→Beneficio→CTA+CET). Entregue as 3 com veredito; so apto_para_card=true pode ir ao card. NAO invente legendas no chat sem a ferramenta (se improvisar por excecao editorial, registre com registrar_legenda_da_conversa).
- LEGENDAS JA PROPOSTAS NESTA CONVERSA: chame get_legendas_da_conversa ANTES de dizer que o texto "nao existe" / "nao esta disponivel". O store e o historico sao a memoria — PROIBIDO pedir ao gestor para re-colar copy que voce escreveu.

== LIMITES DUROS (nao negociaveis, mesmo se pedirem) ==
- ATO SO EXISTE COM RETORNO DE FERRAMENTA: voce so pode afirmar que emitiu card, criou, alterou ou executou QUALQUER coisa se a ferramenta correspondente foi chamada NESTA resposta e devolveu sucesso COM approval_id (UUID) - e ao afirmar, cite esse identificador na tabela. Sem approval_id no retorno de propose_action, o card NAO existe: e PROIBIDO escrever "Card emitido", "aguardando aprovacao", "pedido pendente" ou tabela de estado do card. Se propose_action falhou, caiu no deadline ou nao foi chamada, diga exatamente isso em UMA linha e o que falta para emitir de verdade. Escrever "emiti/criei/esta pendente" sem approval_id e FABRICAR um ato - a mentira mais grave que voce pode cometer, porque o gestor decide dinheiro em cima dela. O sistema REESCREVE claims sem card; nao tente contornar.
- AFIRMACAO SOBRE ESTADO TAMBEM E ATO. Em 02/08/2026, com a regra acima JA no ar, voce escreveu
  "vou confirmar as campanhas no meu sistema" e, na mesma resposta, "Confirmado: as tres
  campanhas apareceram no sistema desta vez" - com uma tabela de estado - sem ter chamado
  ferramenta nenhuma. Voce nao afirmou ter CRIADO: afirmou ter VERIFICADO. E foi essa
  verificacao inventada que fez o gestor decidir errado. Portanto: dizer que conferiu, que
  confirmou, que algo apareceu, existe, esta pendente, foi aprovado ou nao esta lÃ¡ exige
  retorno de ferramenta NESTA resposta. Anunciar uma verificacao e nao executa-la e pior que
  nao verificar, porque produz confianca falsa. Para estado de card use get_aprovacoes; para
  estado de campanha use as ferramentas de leitura. Se nao chamou, a frase correta e "nao
  verifiquei nesta resposta".
- FERRAMENTA QUE FALHOU NAO E ATO. Se a ferramenta retornou erro, recusa ou lista vazia, isso
  NAO e sucesso: relate a falha e o motivo. Card recusado na emissao nao esta "pendente de
  aprovacao" - ele nao existe. Em 20/08/2026 (IMPULSAO SOCIAL) voce escreveu "Card emitido"
  depois de propose_action falhar (target_name=composto) e a reemissao cair no deadline —
  o gestor nao viu card nenhum. Nunca repita.
- criar_campanha: OMITA target_name (ou use exatamente o nome composto [MARCA][…]). Nao passe
  "composto", "nome_composto" nem outro placeholder — o sistema monta o nome pelas partes.
  params.papel (TESTE|ESCALA) e obrigatorio na raiz E em nome_partes.
- TESTE A/B/C, VARIANTE, UTM OU RASTREIO: chame panorama_utm_anuncios antes de dizer se o teste
  e legivel ou se existe vencedora. Campanha vazia e uma causa possivel, mas NAO substitui a
  leitura dos rotulos. Sem desempenho por rotulo, nao invente vencedor.
- MONTAR ANUNCIO NOVO / ESCOLHER PECA DO ACERVO / LOTE MIX: a fonte e get_acervo_para_anuncio
  (leitura TOTAL). NUNCA use get_criativos_conteudo para isso (so anuncios JA no ar — em 07/08
  o R06 no ar foi proposto no lugar de peca nova). Protocolo obrigatorio em lote/mix (ex. "10
  criativos", "mix video+foto+carrossel"): (1) chame get_acervo_para_anuncio SEM produto e cite
  taxonomia_drive + inventario_global (19 videos = 10 Educacao financeira + 9 Caminho Triste/feliz;
  Capas; 9 Carrosseis; 4 Cards instrucionais); (2) so depois filtre por produto — filtro NAO
  autoriza dizer "so existem N"; (3) VIDEOS 22/23/25/26/27 estao LIBERADOS desde 20/08/2026
  (FIN-04 v4) — NAO diga que estao bloqueados; legenda com "consulte o CET na sua
  simulacao" BASTA (NAO peca percentual); (4) CARROSSEL Meta HABILITADO: params.child_attachments = 2 a 10 slides com image_hash cada
  (upload_midia por slide antes); NAO diga que so entra como imagem estatica; (5) Capas
  (Videos/Educacao financeira/Capa) = inventariar sempre; (6) Cards = mecanismo instrucional
  "leia a legenda", nao imagem generica; (7) complemente com get_drive_criativos se precisar.
  Se na_biblioteca_da_meta=false, upload_midia(drive_file_id). Video: so card com status ready.
- SLATE DO GESTOR (anti-alucinacao, 20/08/2026): quando o gestor definir um lote (ex. "3 videos
  + 1 carrossel + 1 card"), ESSE e o unico conjunto valido nesta conversa. Repita tipos+nomes
  antes de auditar ou emitir. PROIBIDO trocar por outro conjunto (ex. "5 videos 22-27" so porque
  estao liberados no acervo). Inventario apto ≠ pedido. Se perder o slate no historico, peca
  confirmacao — nao invente.
- EMITE OS N (anti-loop, 20/08/2026 v28.45): se o gestor disser "emite os N" / "emite os cards" e o
  slate (drive_file_id / meta ids / legendas) JA estiver nesta conversa (mensagem atual,
  historico reinjetado OU conversation_legendas via get_legendas_da_conversa), EMITA agora com
  propose_action×N — PRIMEIRO, sem releitura obrigatoria de nota_visual / checar_par /
  get_acervo completo, sem reabrir compliance se a legenda ja foi confirmada, e SEM pedir ao
  gestor para repetir "emite os N". PROIBIDO gastar o turno re-narrando o slate ou re-buscando
  acervo quando os IDs ja estao no store. Use get_acervo_para_anuncio com drive_file_ids so
  se precisar confirmar biblioteca. ANUNCIO em conjunto ENGAJAMENTO/RECONHECIMENTO: sem_molde
  + page_id; o codigo preenche destino Page/IG automaticamente — NAO passe LP de conversao e
  NAO diga que falta destino_url/produto CLT. Se o teto cortar no meio, emita o que couber e
  diga o que falta — nunca "manda emite de novo" nem "Continuando automaticamente" sem chamar
  propose_action de novo.
- CET (FIN-04 v4): "consulte o CET na sua simulacao" e formulacao APROVADA pelo gestor e pela
  regra. Se o gestor pediu essa formulacao, USE e NAO volte a exigir numero. Nao ha taxa de CET
  fixa da LEV no sistema. Aceitar e depois recusar a mesma formulacao e falta grave.
- PECA ESPECIFICA DO DRIVE: antes de recomendar, classificar ou listar uma peca como candidata,
  chame nota_visual_da_peca com o drive_file_id atual (o id vem de get_acervo_para_anuncio ou
  get_analise_visual_drive). get_analise_visual_drive serve para inventario/triagem; nao autoriza
  repetir classificacao antiga. Se nao houver espaco para ler as notas das candidatas, nao
  recomende nenhuma pelo nome. Em especial, nunca recomende o video 19 sem sua nota vigente, que
  declara aparencia de credito empresarial e incerteza.
- COMPLIANCE DE LEGENDA + PECA: existe caminho conjunto e ele e checar_par_texto_e_peca. Quando
  legenda e drive_file_id estiverem disponiveis, chame-o e repasse cobertura/lacunas; nunca diga
  que o par nao e avaliado. Se um dos dois nao veio, peca o dado faltante sem negar a capacidade.
  Antes de declarar legenda ausente: get_legendas_da_conversa (e o bloco LEGENDAS DA CONVERSA no
  historico). Em 20/08/2026 o agente gerou 5 legendas de impulsão e depois pediu ao gestor para
  colar 3 de novo porque o HIST_CAP cortou o final do slate — isso e PROIBIDO.
- VEREDITO DE PECA EM REVISAO: voce PROPOE, nao decide. registrar_veredito_peca_em_revisao emite um
  CARD que so o administrador aprova; enquanto isso a peca segue impedida. Nunca diga que liberou uma
  peca: diga que emitiu proposta e que a decisao e do responsavel. A assinatura do veredito e de quem
  aprovar, nao o nome que voce informar. Nunca UPDATE a mao. Em 10/08/2026 um subagente escreveu
  veredito direto assinando com o nome do fundador e liberou 5 pecas do FIN-04 sem decisao dele: essa
  porta foi fechada por isso, e o caminho de proposta e o unico que existe.
- Voce nao gasta nem publica por conta propria: toda acao real passa por card aprovado por humano, e as travas por acao sao dele. CONTRATO VIGENTE DESDE 15/08/2026 (atualizado no mesmo dia): aprovar criar_campanha / criar_conjunto_a_partir_de / criar_anuncio_a_partir_de / escalar_duplicar CRIA o objeto ACTIVE — a aprovacao JA autoriza entrega. Existem ativar_campanha, ativar_conjunto e ativar_criativo para religar o que estiver PAUSED; pausar_* nos tres niveis para desligar. Texto antigo dizendo que nasce PAUSED ou que ativacao e so no Gerenciador esta VENCIDO. Voce continua sem caminho para gastar/pausar/ativar sem card aprovado. Trava fechada = explique o que falta e entregue o plano; nunca contorne.
- Categoria especial (Produtos e servicos financeiros, a antiga Credito): nas campanhas criadas PELO SISTEMA ela e GRAVADA por construcao na criacao - diga isso. Nas campanhas antigas ou criadas fora, o campo nao e coletado e a conferencia continua humana, no Gerenciador. Nunca afirme conformidade de campanha que o sistema nao criou.
- Conta em quarentena e somente leitura e VENCE a flag da empresa. Conta sem dono declarado nao existe para voce. Conta nao operacional (nunca teve campanha/gasto) e invisivel para analise.
- Base/lista sem procedencia de consentimento declarada: a proposta de publico NAO sai (pergunte origem e base legal; consulte o tema base_legal_lista).
- Nao prometa resultado; nao trate lead como contrato; nao chame CPL de lucro.
- Fora do escopo: politica de credito, esteira, atendimento humano, produto, e plataformas alem da Meta (nao ha dado de nenhuma outra).
- Nunca fale de implementacao (nome de funcao, versao, tabela, token, limite de chamada) - traduza para linguagem de negocio.

== ESCOPO (limite rigido) ==
Voce cuida EXCLUSIVAMENTE de TRAFEGO PAGO: midia, criativo, publico, orcamento, custo, atribuicao e a conversao final que prova se o trafego comprado virou negocio.
CRM/Dash, proposta e contrato SAIRAM do escopo do sistema em 28/07/2026: nao existe fonte de conversao final aqui, e voce NAO busca esse dado por nenhuma via. Consequencia declarada: voce otimiza resultado de midia como PROXY e diz isso.
ESTA FORA DO SEU ESCOPO e voce NAO comenta, analisa nem recomenda: relacao com bancos, roteamento de propostas, esteira interna, politica de credito, operacao de atendimento humano, margem por banco, processos internos. Se perguntarem, responda que isso e tratado internamente pela empresa e siga para o que e trafego.

== PROTOCOLO OBRIGATORIO ANTES DE RESPONDER ==
1. PLANEJE: identifique o que a pergunta exige e QUAIS tools trazem cada parte. Prefira chamar as tools necessarias na MESMA rodada.
2. COLETE: rode as tools. Nunca responda de memoria sobre numeros - so o que a tool devolveu nesta conversa vale como dado.
3. CONFIRA cada numero antes de escrever: (a) de qual tool veio? (b) qual periodo exato? (c) a cobertura de dados cobre esse periodo inteiro (campos dias_com_dado / cobertura_real / cobertura)? (d) o denominador e estavel ou esta em ingestao?
4. SEGMENTE antes de concluir tendencia: medias historicas escondem mudancas. Se houver serie por mes (ex.: atribuicao.por_mes), leia o mes mais recente, nao a media.
5. RESPONDA com numero + fonte + ressalva. Se algo nao fecha, diga que nao fecha em vez de escolher a versao mais bonita.

== PROIBIDO: RESPOSTA SO DE INTENCAO / DIALOGO OPERACIONAL (20/08/2026) ==
NUNCA envie ao gestor uma mensagem cujo unico conteudo seja narrar o que voce VAI fazer
("Vou cruzar…", "vou ler o conjunto…", "vou consultar…", "deixe-me verificar…",
"vou checar as dicas…"). Isso NAO e resposta: e ruido de intencao. O turno so termina
quando houver UMA resposta completa e elaborada — veredito, evidencia e recomendacao
(ex.: dica da Meta de musica: diga se e viavel ou nao e o que fazer, sem filler).
Chame as tools em silencio; o texto visivel e so o julgamento final. Se o tempo apertar,
entregue o que ja apurou com lacunas declaradas — nunca um "vou…" sozinho.

== REGRAS ANTI-ALUCINACAO (nao negociaveis) ==
R1. Todo NUMERO DESTA CONTA (gasto, leads, propostas, contratos, custos, datas, quantidades) precisa ter vindo de uma consulta feita NESTE turno OU de um bloco "[RETORNOS DE FERRAMENTA JA APURADOS EM ...]" do historico - esse bloco e o registro literal do que a ferramenta devolveu numa rodada anterior desta MESMA conversa, reinjetado pelo sistema, e vale como consulta (cite a data que ele traz). Nunca diga que nao conseguiu consultar algo cujo retorno esta nesse bloco: se esta la, foi consultado. O que o bloco NAO cobre e ATO e ESTADO ATUAL - ver os dois limites duros acima. Se nao veio, escreva "nao disponivel" e diga o que precisaria ser integrado. NUNCA estime, arredonde de cabeca ou complete lacuna com plausibilidade. Se um numero que voce lembra divergir do que a consulta devolveu, A CONSULTA ESTA CERTA - use o dado dela e nao anuncie correcao.
R1b. CONHECIMENTO DE PLATAFORMA NAO E NUMERO DESTA CONTA. Perguntas conceituais - o que a Categoria Especial de Credito restringe, o que e fadiga de criativo, qual a diferenca entre CBO e ABO, por que otimizar para o evento errado distorce a entrega, o que caracteriza promessa enganosa - voce RESPONDE com seu conhecimento de Meta Ads, de forma tecnica e completa. Nao diga "nao disponivel" para pergunta de conhecimento: isso e o oposto do que se espera de um gestor senior. Separe visivelmente as duas coisas: conhecimento de plataforma e uma explicacao; dado desta conta vem com numero e fonte. Quando faltar o dado para confirmar como ESTA CONTA esta configurada, entregue o conceito e diga que a verificacao exige leitura do Gerenciador.
R2. NUNCA afirme como ESTA CONTA esta configurada (canal de captacao, CBO/ABO, marcacao de categoria especial, evento de otimizacao, janela de atribuicao, publico, pixel) sem dado que prove. Explicar o CONCEITO e permitido e desejavel; afirmar o ESTADO da conta sem dado, nao. Para categoria especial financeira: chame get_campaign_detail ou auditar_compliance_financeira (campo special_ad_categories da CAMPANHA) ou ler_pipeboard get_campaign_details — PROIBIDO dizer que "nao ha ferramenta" ou pedir ao gestor para abrir o Gerenciador so por isso. A Meta aplica a categoria na campanha; os anuncios herdam.
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
ja funciona (voce informa o nome EXATO do molde no espelho), porque configuracao de conjunto nao
pode ser inventada — ou, em peca nova de ANUNCIO, sem_molde=true + drive_file_id do acervo.
EXCECAO CONJUNTO SOCIAL (engajamento/reconhecimento, 20/08/2026 v28.42): (A) target_name=sem_molde
+ objetivo_tag=ENGAJAMENTO|RECONHECIMENTO + page_id da config; OU (B) qualquer molde de conjunto
da conta (mesmo OFFSITE_CONVERSIONS/pixel LEAD) — o executor DESCARTA conversion fields e grava
engajamento: POST_ENGAGEMENT + destination_type=ON_POST + promoted_object={page_id};
reconhecimento: REACH + page_id. NUNCA misture REACH como goal de campanha OUTCOME_ENGAGEMENT.
PROIBIDO dizer "nao ha molde POST_ENGAGEMENT", "so no Ads Manager", "aguardar Ryan" ou
"configuracao de conjunto nao pode ser inventada" para bloquear IMPULSAO: o caminho existe —
EMITA o card. Campanha, conjunto e anuncio novos nascem ACTIVE na aprovacao do card. Se um
objeto existente estiver PAUSED e o gestor pedir religar, use ativar_campanha / ativar_conjunto
/ ativar_criativo. Para desligar, use pausar_campanha / pausar_conjunto / pausar_criativo.
OBJETIVO ODAX (criar_campanha): OUTCOME_LEADS (default da casa, LP/CLT), OUTCOME_SALES,
OUTCOME_TRAFFIC, OUTCOME_ENGAGEMENT, OUTCOME_AWARENESS, OUTCOME_APP_PROMOTION. Sinonimos:
ENGAJAMENTO/ENGAGEMENT/POST_ENGAGEMENT → OUTCOME_ENGAGEMENT; RECONHECIMENTO/AWARENESS/REACH →
OUTCOME_AWARENESS. Se omitir params.objetivo, o codigo deriva da objetivo_tag. Brand boost /
impulsao de Page ou Instagram (@legaleviver_): canal=SOCIAL, objetivo_tag=ENGAJAMENTO (ou
RECONHECIMENTO), SEM produto CLT, destino = Page (nao LP). Excecao autorizada pelo gestor em
20/08/2026 (IMPULSAO) — nao remove o padrao CLT+LP das demais campanhas. Conjunto engajamento:
sem_molde OU molde so para targeting; optimization_goal=POST_ENGAGEMENT (default),
destination_type=ON_POST, promoted_object={page_id}, billing_event=IMPRESSIONS. Conjunto
reconhecimento: optimization_goal=REACH (default). Instagram actor da config fica disponivel
para o anuncio seguinte. ANUNCIO (criar_anuncio) no conjunto de engajamento: sem_molde=true +
drive_file_id / child_attachments + page_id + objetivo_tag=ENGAJAMENTO + canal=SOCIAL; o codigo
preenche destino_url = Page/IG (v28.45). NUNCA force LP /simulacao-clt nesse caminho. FIN-01 em
copy educativa de impulsão: se a regra pedir "Consulte sua margem…", anexe a frase e emita —
nao recuse o lote autorizado. Campanha+conjunto bastam como degraus previos; NAO invente
criativo de boost fora do slate.
ORCAMENTO: se o gestor nao disse quanto quer gastar por dia, PERGUNTE (unico valor que nao se
inventa). Se ele ja disse (ex.: 60 no conjunto), use isso e nao reabra.
UTM: o sistema monta a string. Se o gestor deu identificador (ex.: TEST-RR-AGO262), use em
params.utm_campaign; se nao deu, o codigo deriva do rotulo/periodo — nao trave a emissao por isso.
LEGENDA DO AGENTE: ao emitir criar_anuncio com legenda gerada por voce, passe legenda_fonte=agente
e legenda_referencias com o anuncio que motivou a copy (ex.: o Video10 que sera substituido). Se
omitir, o codigo tenta autofill — MAS voce deve preencher. NUNCA peca ao gestor para "confirmar a
referencia da legenda".
PLATAFORMAS: padrao facebook+instagram; Threads proibido; video no Facebook exclui Coluna da
direita. Nao entreviste o gestor so para repetir o padrao da casa — declare no card.
Se a legenda do molde reprovar em compliance, a criacao e recusada automaticamente - relate o
veredito ao gestor e sugira ajuste de texto, sem tentar contornar.

== BASE DE CONHECIMENTO CONSULTAVEL (get_conhecimento) ==
Voce tem uma base tecnica propria. Consulte-a com get_conhecimento(tema) SEMPRE que a pergunta
for conceitual, de politica da Meta, de definicao de metrica, de metodo de diagnostico, ou
quando for propor/auditar criativo. Nao responda de memoria sobre politica ou metrica quando
existe tema para consultar - e nao diga "nao disponivel" para assunto coberto abaixo.
Para regras de ANUNCIOS FINANCEIROS / categoria especial / CREDIT: tema EXATO = compliance
(secoes "Categoria especial" e "Politica de produtos e servicos financeiros"). Em paralelo use
auditar_compliance_financeira(name_like=campanha) para o ESTADO desta conta. Nunca diga que a
lista oficial "nao veio" sem ter chamado get_conhecimento(tema=compliance).
Temas disponiveis:
${indiceConhecimento}
Tema marcado como VENCIDO pode ser citado como referencia, mas declare ao gestor que precisa
ser reverificado na fonte oficial antes de virar decisao.

== CONHECIMENTO DE PLATAFORMA (resumo para resposta rapida; o detalhe esta na base acima) ==
${legal ? `CATEGORIA ESPECIAL "PRODUTOS E SERVICOS FINANCEIROS": obrigatoria quando a campanha for de credito/financiamento. Confirme o produto antes de aplicar.
PROMESSA ENGANOSA em credito: nunca prometa aprovacao, taxa certa ou dinheiro imediato.` : `COHAPM: categoria especial financeira e doutrina de credito NAO se aplicam por padrao. So use uma categoria especial se uma leitura atual da campanha e uma razao regulatoria da propria COHAPM a comprovarem.`}
CBO vs ABO: no CBO o orcamento fica na campanha e a Meta distribui entre conjuntos; no ABO cada conjunto tem seu proprio orcamento. CBO acelera aprendizado e concentra entrega no conjunto que responde melhor; ABO da controle por publico e evita que um conjunto absorva tudo. Estrutura hibrida na mesma conta e comum, mas dificulta comparacao justa entre conjuntos.
EVENTO DE OTIMIZACAO: a Meta entrega para quem tem propensao a gerar o EVENTO otimizado. Otimizar para formulario ou clique entrega volume barato de quem preenche facil; otimizar para evento profundo (proposta, contrato) entrega menos volume e mais propensao a comprar. Alimentar a Meta com sinal raso e a causa mais comum de "lead barato que nao vira venda".
FADIGA DE CRIATIVO: frequencia crescente com CTR caindo e custo por resultado subindo no mesmo publico. Antes de trocar criativo, verificar se a queda nao e de entrega, orcamento ou sazonalidade.
APRENDIZADO LIMITADO: conjunto que nao atinge o volume minimo de eventos na janela sai da fase de aprendizado sem estabilizar, e o custo oscila. Fracionar orcamento em muitos conjuntos e a causa tipica.
ATRIBUICAO: a janela padrao atual e 7 dias de clique e 1 dia de visualizacao. Janela maior credita mais conversoes a Meta e infla o resultado aparente; janela menor subestima. Comparar periodos com janelas diferentes invalida a comparacao.

== GLOSSARIO ==
${legal ? "Lead(LP) e nome historico da Legal para clique no link; reporte como custo por clique no link." : "Nao importe glossario, teto ou definicao historica de outra empresa."} Formulario = form preenchido. Conversa = WhatsApp iniciado (linha separada, nao etapa). Proposta/contrato: fora do escopo do sistema - nao cite.

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
    return s.length > 200 ? s.slice(0, 200) + "â€¦" : s;
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
const RE_CONTINUACAO = /^sua resposta anterior foi cortada|^\[continuacao automatica do sistema|^montando os pedidos de aprovacao — continuando|^continuando automaticamente a partir/;
const RE_PEDIDO_DE_ATO = /\b(crie|criar|cria|criacao|suba|subir|lance|lancar|proponha|propor|duplique|duplicar|escale|escalar|pause|pausar|ative|ativar|altere|alterar|aumente|aumentar|reduza|reduzir|emita|emitir|emissao|emitindo|aprove|aprovar|replique|replicar|monte|montar|quero subir|vamos criar)\b/;
/** Placeholders que o modelo usa no lugar de omitir target_name em criar_campanha. */
const RE_TARGET_PLACEHOLDER = /^(composto|nome[_\s-]?composto|novo[_\s-]?nome|campanha(\s+nova)?|nova|n\/a|na|—|-|\.|\*)$/i;
/** Claim de card emitido — so e verdade se actionCards tiver approval_id real. */
const RE_CLAIM_CARD_EMITIDO =
  /##\s*card\s+emitido|\bcard\s+emitido\b|\bemiti\s+(o\s+)?(pedido|card|os\s+cards?)\b|\bpedido\s+(de\s+aprova[cç][aã]o\s+)?(foi\s+)?(emitido|registrado)\b|\baguardando\s+(sua\s+)?aprova/i;

type TurnCheckpoint = {
  v: 1;
  segmento: number;
  objetivo: string;
  pedido_ato: boolean;
  tools_resumo: { tool: string; action_type?: string; erro?: string }[];
  cards: { approval_id: string; summary: string; status: string }[];
  reply_parcial: string;
  created_at: string;
};

function montarPromptRetomada(cp: TurnCheckpoint): string {
  const toolsLinha = cp.tools_resumo.length
    ? cp.tools_resumo.map((t) =>
      `- ${t.tool}${t.action_type ? `(${t.action_type})` : ""}${t.erro ? ` [nao lido: ${t.erro}]` : ""}`).join("\n")
    : "- (nenhuma ferramenta concluida ainda neste pedido)";
  const cardsLinha = cp.cards.length
    ? cp.cards.map((c) => `- ${c.summary} (${c.status}, id ${c.approval_id})`).join("\n")
    : "- (nenhum ActionCard emitido ainda)";
  const parcial = (cp.reply_parcial || "").trim();
  return (
    `[CONTINUACAO AUTOMATICA DO SISTEMA — segmento ${cp.segmento}]\n` +
    `Objetivo original do gestor (NAO peca para reformular nem "focar" o pedido):\n"""\n${cp.objetivo}\n"""\n\n` +
    `Ja feito neste pedido:\nFerramentas:\n${toolsLinha}\n\nCards ja emitidos:\n${cardsLinha}\n\n` +
    (parcial
      ? `Texto ja entregue ao gestor (NAO repita; retome depois):\n"""\n${parcial.slice(-3500)}\n"""\n\n`
      : "") +
    "INSTRUCOES OBRIGATORIAS:\n" +
    "1. NAO cumprimente. NAO diga que faltou tempo. NAO peca o gestor para repetir ou focar.\n" +
    "2. Retome do ponto em que parou. Se o objetivo era criar campanha/conjunto/anuncio (ou emitir card), " +
    "chame propose_action AGORA com os dados reais ja coletados — NAO invente IDs nem parametros.\n" +
    "3. Se os cards necessarios ja existem, confirme em 2-4 linhas o que ficou pendente de aprovacao humana.\n" +
    "4. Use ferramentas so do que ainda falta; nao releia o que ja consta acima como concluido."
  );
}

function resumirToolsParaCheckpoint(toolsUsed: any[], toolResults: { tool: string; erro?: string; args?: any }[]): TurnCheckpoint["tools_resumo"] {
  const byIdx = toolResults.map((tr) => ({
    tool: String(tr.tool ?? ""),
    action_type: tr.args && typeof tr.args === "object" ? String((tr.args as any).action_type ?? "") || undefined : undefined,
    erro: tr.erro ? String(tr.erro).slice(0, 120) : undefined,
  }));
  if (byIdx.length) return byIdx.slice(-40);
  return toolsUsed.map((t) => ({
    tool: String(t.tool ?? ""),
    action_type: t.args && typeof t.args === "object" ? String(t.args.action_type ?? "") || undefined : undefined,
  })).slice(-40);
}

function toolsIncluemPropose(tools: { tool?: string }[]): boolean {
  return tools.some((t) => String(t.tool ?? "") === "propose_action");
}

/**
 * v28.40: HARD STOP — se a prosa afirma "card emitido" sem approval_id real em
 * actionCards, reescreve. Doutrina sozinha nao bastou (incidente IMPULSAO 20/08).
 */
function sanitizarClaimEmitSemCard(
  reply: string,
  cards: CardInfo[],
  toolResults: { tool?: string; retorno?: any; erro?: string }[],
): { reply: string; reescreveu: boolean } {
  const raw = String(reply ?? "").trim();
  if (!raw || cards.length > 0) return { reply: raw, reescreveu: false };
  if (!RE_CLAIM_CARD_EMITIDO.test(raw)) return { reply: raw, reescreveu: false };

  const proposes = toolResults.filter((t) => String(t.tool ?? "") === "propose_action");
  const errosPropose = proposes
    .map((t) => {
      if (t.erro) return String(t.erro);
      const r = t.retorno;
      if (r && typeof r === "object" && (r as any).erro) return String((r as any).erro);
      return null;
    })
    .filter(Boolean) as string[];
  const deadlineSkip = proposes.some((t) =>
    /deadline|nao foi lido|consulta_nao_realizada/i.test(String(t.erro ?? "")));

  let motivo = "propose_action nao devolveu approval_id nesta rodada";
  if (deadlineSkip) {
    motivo = "o orcamento de tempo esgotou antes de concluir propose_action — o card NAO existe";
  } else if (errosPropose.length) {
    motivo = `propose_action recusou: ${errosPropose[0]}`;
  }

  const aviso =
    `**Nenhum pedido de aprovação foi emitido nesta rodada.** ${motivo}. ` +
    `Afirmar "card emitido" sem o identificador devolvido pela ferramenta é fabricar um ato — ` +
    `não há card na fila. Peça de novo a emissão (ou aguarde a continuação automática) e eu ` +
    `volto a chamar propose_action até obter o approval_id real.`;

  // Remove a secao "## Card emitido…" (ate o proximo ## ou fim) e o claim solto.
  let limpo = raw
    .replace(/##\s*card\s+emitido[^\n]*\n[\s\S]*?(?=\n##\s|\n---\s*\n|$)/gi, "")
    .replace(/\bcard\s+emitido[^\n.]*/gi, "")
    .replace(/\bemiti\s+(o\s+)?(pedido|card|os\s+cards?)[^\n.]*/gi, "")
    .trim();
  if (limpo.length < 80 || RE_CLAIM_CARD_EMITIDO.test(limpo)) {
    limpo = "";
  }
  const novo = limpo ? `${aviso}\n\n${limpo}` : aviso;
  return { reply: novo, reescreveu: true };
}

/** target_name livre/placeholder em criar_* — trata como omitido (nome vem das partes). */
function targetNameCriacaoUtil(raw: string): string {
  const t = String(raw ?? "").trim();
  if (!t || RE_TARGET_PLACEHOLDER.test(t)) return "";
  return t;
}

/** Resposta que ja fecha o turno: clarificacao, contradicao, recusa pendente de decisao. */
function replyFechaTurno(texto: string): boolean {
  const raw = String(texto ?? "").trim();
  if (raw.length < 100) return false;
  const t = deacc(raw.toLowerCase());
  if (RE_INTENCAO.test(raw)) return false;
  if (RE_CONTINUAR_AUTO.test(t) || /continuando automaticamente/.test(t)) return false;
  const perguntaOuDecisao =
    /\?/.test(raw) ||
    /\b(preciso (da sua|que voce|confirmar|saber|da decisao)|qual (o |a )?(objetivo|opcao|caminho|meta|foco)|me (confirma|diga|escolha|oriente)|antes de (criar|emitir|propor|subir|montar)|contradic|incompatib|nao (posso|vou) (criar|emitir|propor)|aguardo (sua|a) (resposta|decisao|confirmacao)|escolha (uma|o|a)|decida)\b/.test(t);
  if (perguntaOuDecisao) return true;
  // Prosa longa sem narrar intencao: o gestor ja tem a resposta do turno.
  return raw.length >= 280;
}

// v28.32: pergunta tipica que estourava 150s porque o modelo abria Pipeboard em vez de
// get_meta_dicas. Sem verbo de ato — se pedir emitir card, cai no caminho normal.
const RE_DICAS_META = /dica.*meta|recomendac.*(meta|facebook|anuncio|impulsionar|boost)|meta emitiu|meta.*recomend|impulsionar.*(anuncio|eles|campanha)|opportunity score|recomendacao da meta/;

function isPedidoDicasMeta(pedido: string): boolean {
  const p = deacc(pedido.toLowerCase());
  if (RE_PEDIDO_DE_ATO.test(p)) return false;
  return RE_DICAS_META.test(p);
}

// v28.11 / v28.36: job assincrono so quando o pedido e largo o bastante (familias ou chars).
// Sync e o default. Guardas cobrem capacidades que a rota assincrona nao tem.
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
  const pedirContinuar = body?.continuar === true;
  let message = String(body?.message ?? "").trim();
  const rawAtts: any[] = Array.isArray(body?.attachments) ? body.attachments.slice(0, 4) : [];
  if (!pedirContinuar && !message && !rawAtts.length) return json({ error: "message obrigatorio" }, 400);

  const company = await resolveCompany(body?.company ? String(body.company) : undefined);
  if (!company) return json({ error: "empresa nao encontrada" }, 400);

  // v28.37: retomada de turno sincrono a partir de turn_checkpoint (espelho do job).
  let turnCheckpoint: TurnCheckpoint | null = null;
  let segmentoAtual = 1;
  let objetivoOriginal = message;
  let ehRetomada = false;
  if (pedirContinuar || RE_CONTINUAR_AUTO.test(deacc(message.toLowerCase()))) {
    const cid = body?.conversation_id ? String(body.conversation_id) : "";
    if (!cid) {
      if (pedirContinuar) return json({ error: "continuar exige conversation_id" }, 400);
    } else {
      const { data: convCp } = await supa.from("chat_conversations")
        .select("id, company_id, turn_checkpoint")
        .eq("id", cid).maybeSingle();
      if (pedirContinuar && (!convCp || convCp.company_id !== company.id)) {
        return json({ error: "conversa nao encontrada" }, 404);
      }
      const cp = convCp?.turn_checkpoint as TurnCheckpoint | null;
      if (cp && cp.v === 1 && cp.objetivo) {
        turnCheckpoint = cp;
        segmentoAtual = Math.max(1, Number(cp.segmento ?? 1));
        objetivoOriginal = String(cp.objetivo);
        message = montarPromptRetomada({ ...cp, segmento: segmentoAtual });
        ehRetomada = true;
        // Consome o checkpoint ANTES de processar (anti-reentrega duplicada, igual ao job).
        await supa.from("chat_conversations").update({ turn_checkpoint: null }).eq("id", cid);
      } else if (pedirContinuar) {
        return json({
          ok: true, versao: VERSAO, conversation_id: cid, continuar: false,
          aviso: "sem_checkpoint", reply: "", finish_reason: "sem_checkpoint",
        }, 200);
      }
    }
  }

  // v28.11: pedido longo de ANALISE nao disputa os 150s da plataforma - vai para o job, que
  // nao tem esse teto. A decisao acontece AQUI, antes de qualquer chamada ao modelo e antes
  // de gravar a pergunta (quem grava e o job, senao a pergunta entraria duas vezes).
  // Se o encaminhamento falhar, NAO se perde o turno: cai no caminho sincrono e a falha vai
  // declarada na telemetria - rota nova nao pode derrubar o chat.
  // Continuacao automatica NUNCA vai ao job (propose_action + fio).
  const rota = ehRetomada
    ? { rotear: false, motivo: "retomada de checkpoint sincrono", familias: 0 }
    : decidirRotaAssincrona(message, rawAtts.length);
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
    const { data: conv } = await supa.from("chat_conversations").select("id,company_id").eq("id", convId).maybeSingle();
    if (!conv) convId = null;
    else if (String(conv.company_id) !== company.id) {
      return json({ error: "conversation_company_mismatch" }, 409);
    }
  }
  // Pedido novo (nao retomada): descarta checkpoint orfao para nao misturar objetivos.
  if (convId && !ehRetomada) {
    await supa.from("chat_conversations").update({ turn_checkpoint: null }).eq("id", convId);
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
  const temLegendaNoTexto = (s: string) =>
    /legenda criada|legendas geradas|variante\s*[123]\s*[—\-]|get_legendas_da_conversa|\[LEGENDAS DA CONVERSA/i.test(s);
  const history = cronologico.map((m, i) => {
    const c = String(m.content ?? "");
    const assistComLegenda = m.role === "assistant" && temLegendaNoTexto(c);
    const cap = (m.role === "user" && i === ultimoUserIdx)
      ? HIST_CAP_USER_RECENTE
      : (assistComLegenda ? HIST_CAP_ASSIST_COM_LEGENDA : HIST_CAP);
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
    if (m.role === "user" || (m.role === "assistant" && assistComLegenda)) {
      // v28.44: assistente com legendas preserva INICIO+FINAL — o corte so no inicio
      // escondia Carrossel 5 / cards no fim do slate e gerava amnesia falsa.
      const cabeca = Math.floor(cap * 0.55);
      const cauda = cap - cabeca;
      return comEvidencia(
        c.slice(0, cabeca) +
        `\n[AVISO DO SISTEMA: ${omitidos} caracteres do MEIO desta mensagem foram omitidos do historico por limite de tamanho. O INICIO e o FINAL estao preservados - a mensagem NAO termina neste corte; se houver legenda no trecho final, ela existe — consulte tambem get_legendas_da_conversa / bloco LEGENDAS DA CONVERSA.]\n` +
        c.slice(-cauda));
    }
    return comEvidencia(
      c.slice(0, cap) + `\n[AVISO DO SISTEMA: o final desta mensagem (${omitidos} caracteres) foi omitido do historico por limite de tamanho. Se a mensagem tinha legendas, chame get_legendas_da_conversa antes de declarar ausencia.]`);
  });

  const blocoLegendas = await carregarBlocoLegendasConversa(company.id, convId!);
  if (blocoLegendas) {
    history.push({ role: "assistant", content: blocoLegendas });
  }

  // Retomada: o prompt de checkpoint vai so ao LLM (abaixo), nao vira bolha de usuario.
  // O gestor ve a costura das respostas assistant + cards — sem eco interno.
  if (!ehRetomada) {
    await supa.from("chat_messages").insert({ conversation_id: convId, company_id: company.id, role: "user", content: msgText, user_id: userId, attachments: attMeta.length ? attMeta : null });
  }

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

  async function chamar(comTools: boolean, maxTokens = MAX_TOKENS, semRaciocinio = false, retry429 = 0): Promise<any> {
    const restanteMs = HARD_LIMIT_MS - decorrido() - RESERVA_GRAVACAO_MS;
    if (restanteMs < 8_000) {
      return { erro: "orcamento_tempo_esgotado", detalhe: `restam ${restanteMs}ms — sem tempo util para nova geracao` };
    }
    const usarCache = !cacheDesativado;
    const payload: any = { model: MODEL, messages: usarCache ? messages : semCache(messages), max_tokens: maxTokens };
    if (comTools) { payload.tools = TOOLS; payload.tool_choice = "auto"; }
    // v21: na sintese o raciocinio e excluido para que TODO o orcamento va para o texto.
    if (!reasoningDesativado) payload.reasoning = semRaciocinio ? REASONING_SINTESE : REASONING_LOOP;
    // v28.32: AbortSignal — sem isso uma unica geracao com contexto grande segura o HTTP
    // alem dos ~150s do gateway (ms_total=170s medido em 20/08 com 504 no cliente).
    const capMs = Math.min(OPENROUTER_CALL_CAP_MS, restanteMs);
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), capMs);
    let resp: Response;
    let text: string;
    try {
      resp = await fetch("https://openrouter.ai/api/v1/chat/completions", {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${OPENROUTER_KEY}` },
        body: JSON.stringify(payload),
        signal: ac.signal,
      });
      text = await resp.text();
    } catch (e) {
      const nome = String((e as any)?.name ?? "");
      if (nome === "AbortError" || /abort/i.test(String((e as any)?.message ?? e))) {
        return { erro: "openrouter_timeout", detalhe: `chamada abortada apos ${capMs}ms (orcamento de parede)` };
      }
      return { erro: "openrouter_fetch_failed", detalhe: String((e as any)?.message ?? e).slice(0, 200) };
    } finally {
      clearTimeout(timer);
    }
    if (!resp.ok) {
      // v21: degradacao em 2 passos. Tira o reasoning primeiro (parametro novo, nao provado)
      // e so depois o cache (provado funcionando em 4 turnos v20 - nao vale perder de graca).
      if (resp.status === 400 || resp.status === 422) {
        if (!reasoningDesativado) {
          reasoningDesativado = true; reasoningRejeitado = true;
          return await chamar(comTools, maxTokens, semRaciocinio, retry429);
        }
        if (usarCache) {
          cacheDesativado = true; cacheRejeitado = true;
          return await chamar(comTools, maxTokens, semRaciocinio, retry429);
        }
      }
      // v28.43: 429/502/503 — backoff curto se ainda cabe no HARD_LIMIT.
      if ((resp.status === 429 || resp.status === 502 || resp.status === 503) && retry429 < 3) {
        const sobra = HARD_LIMIT_MS - decorrido() - RESERVA_GRAVACAO_MS;
        if (sobra > 12_000) {
          const ra = Number(resp.headers.get("retry-after"));
          const waitMs = Math.min(
            Number.isFinite(ra) && ra > 0 ? Math.floor(ra * 1000) : 1000 * (retry429 + 1),
            Math.min(8_000, sobra - 8_000),
          );
          if (waitMs > 0) await new Promise((r) => setTimeout(r, waitMs));
          return await chamar(comTools, maxTokens, semRaciocinio, retry429 + 1);
        }
      }
      return { erro: `openrouter_http_${resp.status}`, detalhe: text.slice(0, 300) };
    }
    try { return { parsed: JSON.parse(text) }; } catch { return { erro: "openrouter_non_json", detalhe: text.slice(0, 300) }; }
  }

  // v28.32/v28.34: atalho para pergunta de dicas da Meta — sync Opportunity Score ao vivo,
  // le o banco e sintetiza UMA vez, sem Pipeboard. Em falha de sintese: prosa deterministica.
  let atalhoMetaDicas = false;
  if (isPedidoDicasMeta(msgText) && !rawAtts.length) {
    atalhoMetaDicas = true;
    let syncMeta: unknown = null;
    try {
      syncMeta = await t_sincronizar_meta_dicas(ctx.companyId, ctx.mcpKey);
    } catch (e) {
      syncMeta = { ok: false, erro: String((e as any)?.message ?? e).slice(0, 160) };
    }
    {
      const bruto = JSON.stringify(syncMeta ?? null);
      const cortado = bruto.length > TOOLRES_TETO_PERSIST;
      toolsUsed.push({ tool: "sincronizar_meta_dicas", args: { company_id: ctx.companyId } });
      toolResults.push({
        tool: "sincronizar_meta_dicas",
        args: { company_id: ctx.companyId },
        chars: bruto.length,
        cortado,
        retorno: cortado ? bruto.slice(0, TOOLRES_TETO_PERSIST) : (syncMeta ?? null),
      });
    }
    const [dicas, recos] = await Promise.all([
      runTool("get_meta_dicas", { dias: 14 }, ctx),
      runTool("get_recommendations", {}, ctx),
    ]);
    for (const [nome, result] of [["get_meta_dicas", dicas], ["get_recommendations", recos]] as const) {
      const bruto = JSON.stringify(result ?? null);
      const cortado = bruto.length > TOOLRES_TETO_PERSIST;
      toolsUsed.push({ tool: nome, args: nome === "get_meta_dicas" ? { dias: 14 } : {} });
      toolResults.push({
        tool: nome,
        args: nome === "get_meta_dicas" ? { dias: 14 } : {},
        chars: bruto.length,
        cortado,
        retorno: cortado ? bruto.slice(0, TOOLRES_TETO_PERSIST) : (result ?? null),
      });
    }
    // Sintese com contexto ENXUTO: historico longo desta conversa (carrossel/cards) era o
    // que fazia Grok estourar 150s numa pergunta de dicas. System + pergunta + dados bastam.
    // v28.33: payload compacto (campos acionaveis) para caber no orcamento de 2 min.
    const dicasLlm = compactMetaDicasParaLlm(dicas);
    const recosLlm = compactRecosParaLlm(recos);
    const msgsAtalho = [
      { role: "system", content: cacheSystem },
      {
        role: "user",
        content:
          `Pergunta do gestor: ${msgText}\n\n` +
          "Os retornos abaixo JA foram sincronizados na Graph (Opportunity Score) e lidos do banco " +
          "(dicas da Meta + fila INTERNA de custo). " +
          "Responda AGORA em prosa clara, por secoes, sem chamar ferramentas e SEM colar JSON. " +
          "Cite o veredito interno de cada dica da Meta. A fila interna NAO e badge do Ads Manager. " +
          "Se a lista de dicas da Meta estiver vazia, diga que a Graph nao devolveu dica nesta janela " +
          "e lembre a assimetria API vs UI se o gestor apontar badge — nao invente.\n\n" +
          `Dicas da Meta (compacto):\n${JSON.stringify(dicasLlm).slice(0, TOOLRES_TETO_PERSIST)}\n\n` +
          `Fila interna (compacto):\n${JSON.stringify(recosLlm).slice(0, Math.min(6000, TOOLRES_TETO_PERSIST))}`,
      },
    ];
    const msgsBackup = messages.splice(0, messages.length, ...msgsAtalho);
    // Ate 4500 tokens de prosa; o AbortSignal respeita o restante do HARD_LIMIT (~2 min).
    const rf = await chamar(false, Math.min(tokensDisponiveis(), 4500), true);
    messages.splice(0, messages.length, ...msgsBackup);
    if (!rf.erro) {
      const p = rf.parsed;
      tokensIn += Number(p?.usage?.prompt_tokens ?? 0);
      tokensOut += Number(p?.usage?.completion_tokens ?? 0);
      somarCache(p?.usage); somarReasoning(p?.usage);
      finishReason = String(p?.choices?.[0]?.finish_reason ?? "") + "+atalho_meta_dicas";
      reply = String(p?.choices?.[0]?.message?.content ?? "").trim();
      iteracoes = 1;
    }
    if (!reply) {
      // Sem inventar dicas: prosa deterministica a partir dos campos estruturados.
      finishReason = `atalho_meta_dicas_${rf?.erro || "sem_conteudo"}+resumo_deterministico`;
      deadlineTools = true;
      reply = formatarResumoMetaDicasPt(dicas, recos);
      iteracoes = 1;
    }
  }

  if (!atalhoMetaDicas) for (let iter = 0; iter < MAX_ITER; iter++) {
    // v19/v28.32: orcamento de tempo. Checa ANTES de cada geracao (incluindo a 1a apos
    // tools): sem isso o loop consumia os 150s coletando e o gateway devolvia 504.
    if (decorrido() > TOOLS_DEADLINE_MS && (iter > 0 || toolsUsed.length > 0)) {
      deadlineTools = true;
      break;
    }
    if (decorrido() > HARD_LIMIT_MS - RESERVA_GRAVACAO_MS - 12_000) {
      deadlineTools = true;
      break;
    }
    iteracoes = iter + 1;
    // v27: orcamento dimensionado pelo tempo restante, nao fixo.
    const r = await chamar(true, tokensDisponiveis());
    if (r.erro === "orcamento_tempo_esgotado" || r.erro === "openrouter_timeout") {
      deadlineTools = true;
      finishReason = String(r.erro);
      break;
    }
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
        // v28.32: deadline POR ferramenta — o lote inteiro nao pode segurar o HTTP.
        if (decorrido() > TOOLS_DEADLINE_MS) {
          deadlineTools = true;
          const nomeSkip = String(tc.function?.name ?? "");
          let argsSkip: any = {}; try { argsSkip = JSON.parse(tc.function?.arguments ?? "{}"); } catch { /* */ }
          messages.push({ role: "tool", tool_call_id: tc.id, content: JSON.stringify({
            erro: "consulta_nao_realizada_nesta_rodada",
            aviso: "O orcamento de tempo de coleta acabou antes desta consulta. O dado NAO foi lido — nao o trate como zero nem como inexistente. Responda com o que ja tem." }) });
          toolResults.push({ tool: nomeSkip, args: argsSkip, chars: 0, cortado: false, retorno: null,
            erro: "deadline de coleta — o dado NAO foi lido" });
          continue;
        }
        // v20: teto de ferramentas. A API exige resposta para CADA tool_call_id, entao nao
        // e possivel simplesmente pular - devolvemos um resultado que DECLARA o teto, para
        // o modelo nao tratar o dado como zero nem como inexistente (R3).
        const nomeTc = String(tc.function?.name ?? "");
        let args: any = {}; try { args = JSON.parse(tc.function?.arguments ?? "{}"); } catch { /* */ }
        const jaUsou = toolsUsed.filter((t) => t.tool === nomeTc).length;
        const limiteDesta = MAX_POR_FERRAMENTA[nomeTc] ?? MAX_POR_FERRAMENTA_DEFAULT;
        // v28.31: criar_anuncio (e demais criacoes) nao competem com releituras pelo teto global.
        const eCriacao =
          nomeTc === "propose_action" &&
          ACOES_CRIACAO_NO_TETO.includes(String(args?.action_type ?? ""));
        const tetoGlobal = !eCriacao && toolsUsed.filter((t) => {
          if (t.tool !== "propose_action") return true;
          const at = String((t.args as any)?.action_type ?? "");
          return !ACOES_CRIACAO_NO_TETO.includes(at);
        }).length >= MAX_TOOLS_TURNO;
        if (tetoGlobal || jaUsou >= limiteDesta) {
          tetoTools = true;
          messages.push({ role: "tool", tool_call_id: tc.id, content: JSON.stringify({
            erro: "consulta_nao_realizada_nesta_rodada",
            aviso: "Esta consulta nao foi executada nesta rodada. O dado NAO foi lido - nao o trate como zero nem como inexistente. Responda com o que ja tem e diga ao gestor, em UMA linha e em linguagem natural, que este item ficou para a proxima. NAO cite nome de ferramenta, numero de limite nem detalhe de implementacao. Se o pedido era EMITIR cards e o slate/legendas ja estavam no chat, NAO peca para repetir 'emite' — emita o que couber agora e declare o que falta sem pedir eco." }) });
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

  if (!reply && !atalhoMetaDicas) {
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
    } else if (rf.erro === "openrouter_timeout" || rf.erro === "orcamento_tempo_esgotado") {
      finishReason = String(finishReason || rf.erro) + "+sintese_abortada";
      deadlineTools = true;
    }
  }
  // v18/v28.35: emenda preambulos substantivos; DESCARTA narracao de intencao.
  // "vou consultar/cruzar/ler…" nunca vira reply — e o sintoma do dump mid-thought.
  // RE_INTENCAO e constante de modulo (v28.38).
  let preambulosUsados = 0;
  if (preambulos.length) {
    const substantivos = preambulos.filter((p) => p.length >= 120 && !RE_INTENCAO.test(p));
    const aproveitar = reply ? substantivos : (substantivos.length ? substantivos : preambulos.filter((p) => !RE_INTENCAO.test(p)));
    if (aproveitar.length) {
      preambulosUsados = aproveitar.length;
      const pre = aproveitar.join("\n\n").trim();
      reply = reply ? pre + "\n\n" + reply : pre;
    }
  }

  // v28.40: HARD — claim de "card emitido" sem actionCards e mentira; reescreve.
  const claimSan = sanitizarClaimEmitSemCard(String(reply ?? ""), actionCards, toolResults);
  if (claimSan.reescreveu) {
    reply = claimSan.reply;
    finishReason = String(finishReason || "stop") + "+claim_emit_sem_card";
  }

  // v28.38: CONTINUACAO AUTOMATICA — so quando o turno esta realmente incompleto.
  // Nao continuar apos resposta completa (clarificacao / decisao humana / analise fechada).
  const pedidoAto = RE_PEDIDO_DE_ATO.test(deacc(objetivoOriginal.toLowerCase())) ||
    (turnCheckpoint?.pedido_ato === true) ||
    // v28.40: se propose_action de criacao rodou (ou tentou) sem card, trata como ato.
    (actionCards.length === 0 && toolsIncluemPropose(toolsUsed));
  const cardsNesteSegmento = actionCards.length;
  const cardsJaNoPedido = (turnCheckpoint?.cards?.length ?? 0) + cardsNesteSegmento;
  const toolsNesteSegmento = toolsUsed.length;
  const replyTrim = String(reply ?? "").trim();
  // Claim falso ja sanitizado: nao conta como "turno fechado" se ainda falta o card.
  const turnoJaFechado = replyFechaTurno(replyTrim) && !(
    claimSan.reescreveu || (pedidoAto && cardsJaNoPedido === 0 && toolsIncluemPropose(toolsUsed))
  );
  const tentouEmitir =
    toolsIncluemPropose(toolsUsed) ||
    toolsIncluemPropose(turnCheckpoint?.tools_resumo ?? []);
  const midLoopFraco =
    !replyTrim ||
    RE_INTENCAO.test(replyTrim) ||
    replyTrim.length < 100;
  // Ato incompleto: card ainda nao saiu E havia trabalho de emissao em curso
  // (propose tentado, ou mid-loop sem prosa util). Clarificacao com zero cards NAO entra.
  const atoEmAndamentoSemCard =
    pedidoAto &&
    cardsJaNoPedido === 0 &&
    !turnoJaFechado &&
    (tentouEmitir || (toolsNesteSegmento > 0 && midLoopFraco));

  // v28.45: propose_action ja rodou e FALHOU com erro duro (destino/compliance/contrato) —
  // NAO auto-continuar so para re-narrar "nenhum card". Continua so se foi deadline/timeout
  // (ainda cabe retomar propose) ou se ainda nao tentou emitir.
  const proposesDuros = toolResults.filter((t) => {
    if (String(t.tool ?? "") !== "propose_action") return false;
    const err = String(t.erro ?? "");
    if (/deadline|orcamento|consulta_nao_realizada|nao foi lido/i.test(err)) return false;
    const r = t.retorno;
    if (r && typeof r === "object" && (r as any).erro) {
      const e = String((r as any).erro);
      return /peca_nova_sem_molde|compliance_bloqueou|pedido_incompleto|verificacao_do_pedido|molde_|legenda_|destino_/i.test(e);
    }
    return false;
  });
  const soFalhaDuraSemCard =
    pedidoAto &&
    cardsJaNoPedido === 0 &&
    proposesDuros.length > 0 &&
    !toolResults.some((t) =>
      String(t.tool ?? "") === "propose_action" &&
      /deadline|orcamento|consulta_nao_realizada|nao foi lido/i.test(String(t.erro ?? "")));

  const turnoIncompletoPorTempo = deadlineTools && !turnoJaFechado && (
    !replyTrim ||
    atoEmAndamentoSemCard
  ) && !soFalhaDuraSemCard;
  const podeContinuarSegmento = segmentoAtual < MAX_TURN_SEGMENTS;
  let continuarTurno = false;
  let usouFallback = false;

  if (soFalhaDuraSemCard && !continuarTurno) {
    const errs = proposesDuros.map((t) => {
      const r = t.retorno as any;
      return String(r?.erro ?? t.erro ?? "erro");
    });
    const uniq = [...new Set(errs)].slice(0, 3).join("; ");
    if (!replyTrim || claimSan.reescreveu || midLoopFraco) {
      reply =
        `Nao emiti card(s) nesta rodada: propose_action recusou (${uniq}). ` +
        `Corrija o motivo acima e peca de novo a emissao — nao vou ficar em loop automatico sem progresso.`;
      finishReason = String(finishReason || "stop") + "+propose_erro_duro_sem_continuar";
    }
  }

  if (!replyTrim || turnoIncompletoPorTempo) {
    if (turnoIncompletoPorTempo && podeContinuarSegmento) {
      // Junta cards deste segmento com os do checkpoint anterior.
      const cardsMerged = [
        ...(turnCheckpoint?.cards ?? []),
        ...actionCards.map((c) => ({
          approval_id: c.approval_id,
          summary: c.summary,
          status: c.status,
        })),
      ];
      const toolsMerged = [
        ...(turnCheckpoint?.tools_resumo ?? []),
        ...resumirToolsParaCheckpoint(toolsUsed, toolResults),
      ].slice(-60);
      const replyParcial = [
        turnCheckpoint?.reply_parcial,
        replyTrim,
      ].filter(Boolean).join("\n\n").trim();

      const novoCp: TurnCheckpoint = {
        v: 1,
        segmento: segmentoAtual + 1,
        objetivo: objetivoOriginal,
        pedido_ato: pedidoAto,
        tools_resumo: toolsMerged,
        cards: cardsMerged,
        reply_parcial: replyParcial.slice(-8000),
        created_at: new Date().toISOString(),
      };
      await supa.from("chat_conversations")
        .update({ turn_checkpoint: novoCp, updated_at: new Date().toISOString() })
        .eq("id", convId);

      if (!replyTrim) {
        if (cardsNesteSegmento > 0) {
          reply = `Emiti ${cardsNesteSegmento} pedido(s) de aprovação. Continuando o restante automaticamente…`;
        } else if (pedidoAto && (tentouEmitir || toolsNesteSegmento > 0)) {
          reply = REPLY_CONTINUANDO_ATO;
        } else {
          reply = REPLY_CONTINUANDO;
        }
      } else if (pedidoAto && cardsNesteSegmento === 0 && tentouEmitir) {
        // propose_action em curso sem card — progress de emissao e honesto.
        reply = replyTrim + "\n\n_Continuando automaticamente para emitir o(s) pedido(s) de aprovação…_";
      } else if (replyTrim) {
        // Mid-loop com prosa fraca: continue generico, sem fingir emissao de card.
        reply = replyTrim + "\n\n_Continuando automaticamente…_";
      }
      continuarTurno = true;
      finishReason = `continuar_turno+seg${segmentoAtual}`;
    } else if (!replyTrim) {
      // Ultimo segmento ou sem trabalho retomavel: ainda assim NAO use o texto antigo
      // de "Peça de novo…" em pedido de ato — diga o que falta com o que ja tem.
      if (pedidoAto) {
        const nCards = cardsJaNoPedido;
        reply = nCards > 0
          ? `Consegui emitir ${nCards} pedido(s) de aprovação neste fio. Se ainda faltar algum card do pedido original, peça só o que falta (ex.: o conjunto) — o que já saiu está na fila de aprovação.`
          : "Cheguei ao limite desta janela antes de emitir o card. Os dados já coletados ficaram no histórico desta conversa — envie de novo o mesmo pedido (ou só a parte que faltou) e eu retomo sem recomeçar do zero.";
        finishReason = deadlineTools ? "orcamento_ato_sem_card" : "erro_ato_sem_conteudo";
      } else {
        reply = deadlineTools
          ? "Nao deu tempo de concluir esta rodada dentro do limite do servidor. Peça de novo de forma mais focada (ex.: só as dicas da Meta neste conjunto, ou só emitir o card já montado) — assim a resposta chega inteira."
          : "Nao consegui produzir a resposta desta vez. Tente de novo, ou divida o pedido em partes menores.";
        finishReason = deadlineTools ? "orcamento_tempo_sem_conteudo" : "erro_sem_conteudo";
      }
      usouFallback = true;
    }
  }

  // Turno completo: garante checkpoint limpo.
  if (!continuarTurno && convId) {
    await supa.from("chat_conversations").update({ turn_checkpoint: null }).eq("id", convId);
  }

  const diagnostico = { finish_reason: finishReason, iteracoes, ms_total: decorrido(),
    deadline_tools: deadlineTools, preambulos_detectados: preambulos.length,
    preambulos_recuperados: preambulosUsados, tools: toolsUsed.map((t) => t.tool),
    teto_tools: tetoTools, cache_write: cacheWrite, cache_read: cacheRead,
    cache_rejeitado: cacheRejeitado, reasoning_rejeitado: reasoningRejeitado,
    reasoning_tokens: reasoningTokens, usou_fallback: usouFallback,
    hist_msgs_cortadas: histMsgsCortadas,
    atalho_meta_dicas: atalhoMetaDicas,
    // v28.11: quanto do contexto anterior a rodada enxergou, e quanto ela deixa para a proxima.
    toolres_gravados: toolResults.length, toolres_turnos_reinjetados: toolresTurnos,
    toolres_ferramentas_reinjetadas: toolresFerramentas, toolres_chars_reinjetados: toolresChars,
    rota_familias: rota.familias, rota_falhou: rotaFalhou || null,
    tokens_in: tokensIn, tokens_out: tokensOut, versao: VERSAO,
    continuar_turno: continuarTurno, segmento_turno: segmentoAtual,
    retomada: ehRetomada, pedido_ato: pedidoAto };

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
    hist_msgs_cortadas: histMsgsCortadas, atalho_meta_dicas: atalhoMetaDicas,
    toolres_gravados: toolResults.length, toolres_turnos_reinjetados: toolresTurnos,
    toolres_ferramentas_reinjetadas: toolresFerramentas, toolres_chars_reinjetados: toolresChars,
    roteado_para_job: false, motivo_do_roteamento: rota.motivo, familias_de_assunto: rota.familias,
    rota_falhou: rotaFalhou || null,
    tokens_in: tokensIn, tokens_out: tokensOut, attachments_processed: attMeta, attachment_warnings: attNotas,
    action_cards: actionCards,
    continuar: continuarTurno,
    segmento: segmentoAtual,
  });
});
