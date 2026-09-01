// supabase/functions/meta-actions/index.ts (v5.61)
// v5.61 (01/09/2026) - APPLY RECUSAVA OCULOS VISTTA COMO SE FOSSE PECAS DE JURIDICO. A
//   guarda lia a legenda ("WhatsApp oficial do Juridico") junto com o nome
//   AD_CONJ.2_APENAS_OCULOS_3 e mandava reemitir em campanha JURIDICO. Identidade da peca
//   nao inclui prosa; copy vazada e voz_linha_errada.
// v5.60 (01/09/2026) - RENOMEAR SO EXISTIA PARA CAMPANHA, E AINDA TRAVADO EM UM DRIVER. Dois
//   anuncios do CONJ.2_VISTTA nasceram com o NOME DO CONJUNTO no lugar do nome do criativo, e a
//   unica saida oferecida ao gestor foi "renomeie na mao no Gerenciador" — porque nao havia
//   renomear_conjunto nem renomear_criativo. Renomear e a mesma escrita nos tres niveis (POST
//   /{id} com `name`), entao as duas acoes entram pelo caminho generico que ja existia, com
//   espelho de nome em ad_sets/ads igual ao de campaigns. Junto cai a trava de driver: a
//   exigencia de pipeboard em renomear_campanha vinha de como a ferramenta foi introduzida, nao
//   de limite da Meta, e em 01/09 ela recusou um rename legitimo com driver_nao_suporta_acao.
// v5.59 (01/09/2026) - ANUNCIO CTWA MORRIA EM UM PATCH QUE NAO PRECISAVA EXISTIR. Os dois
//   cards de anuncio do CONJ.1_VISTTA (14:00) falharam em update_adset_promoted_object com
//   OAuthException #1 pela graph — com o conjunto JA gravado certo pelo pipeboard no create.
//   Agora le promoted_object antes: se ja bate (page_id + digitos, tolerando o 9 extra),
//   nao escreve nada. Se precisar mesmo escrever e a graph recusar, tenta pipeboard
//   update_adset — mesma razao do create (numero que so existe na Pagina). So aborta o card
//   se os dois falharem, porque numero errado no conjunto manda a conversa pro lugar errado.
// v5.58 (01/09/2026) - CTWA 1487246 e do DRIVER. Comparacao controlada: mesmo
//   promoted_object {page_id:105656372312257, whatsapp_phone_number:"557191894229"},
//   mesmo destination_type=WHATSAPP, mesmo CONVERSATIONS — graph deu 400/1487246 as
//   11:49 e pipeboard criou o conjunto 120249829825270182 as 12:46. O diagnostico do
//   card agora aponta o driver (era mandar o gestor mexer em WABA a toa).
// v5.57 (01/09/2026) - CTWA: promoted_object so com DIGITOS (o display "+55 71 9189-4229"
//   ia no payload e era invalido) e falha 1487246 vira diagnostico no card, em vez da
//   frase crua da Meta.
// v5.56 (01/09/2026) - CTWA Messenger OFF: destination_type=WHATSAPP so (JUR/LF).
//   Gestor exclui campanha de teste do Gerenciador; criar 100% pelo agente.
// v5.55 (01/09/2026) - Destino MANUAL do Gerenciador na 1a tentativa:
//   MESSAGING_MESSENGER_WHATSAPP + numero +55 71 9189-4229 (dropdown). CONJ.1 teste
//   no Ads Manager mostrou Messenger+WhatsApp; a API ia so WHATSAPP e levava 1487246.
// v5.54 (01/09/2026) - CTWA destino MANUAL: tenta WHATSAPP e MESSAGING_MESSENGER_WHATSAPP
//   (Messenger+WhatsApp do Gerenciador), E.164 com +, smart_pse_enabled=false. Nao usa
//   destino automatico. Cards VISTTA 07:41 ainda 1487246 apos 12/13 digitos.
// v5.53 (31/08/2026) - CTWA: resolver WhatsApp da Pagina (formato 55+DDD+8 +
//   whats_app_business_phone_number_id) e retry em Meta 1487246. Cards VISTTA
//   falhavam com "number is not linked" enquanto o Gerenciador listava o numero.
// v5.52 (26/08/2026) - vincular_instagram_dos_anuncios: novo adcreative + update_ad
//   para @cohapm na campanha La Felicità em trabalho (ACTIVE+PAUSED).
// v5.50 (25/08/2026) - HARD BLOCK cruzamento Juridico × La Felicità no apply (nao emite
//   peca LAF em JURIDICO_CONJ e o inverso). Recusa antes da Graph.
// v5.49 (24/08/2026) - recusa orcamento em centavos-como-reais; modo corrigir_orcamento_adsets
//   para o incidente CONJ.1/2 LAF (R$ 3000 gravado, gestor pediu R$ 30).
// v5.48 (24/08/2026) - sentinela sem_molde compartilhada (ehSentinelaSemMolde / ehFlagSemMolde).
// v5.47 (24/08/2026) - criar_conjunto sem_molde tambem para trafego/website (defaults WEBSITE+LPV).
// v5.46 (22/08/2026) - Fail-closed Instagram: se publisher_platforms inclui instagram
//   (ou default facebook+instagram), recusa instagram_nao_vinculado sem identidade.
//   Nao sobrescreve nome_novo por composto [WA][LEADS] em campanha de trafego.
// v5.45 (22/08/2026) - video_data POST: nunca image_url + image_hash juntos (Graph recusa).
//   GET do molde devolve os dois; sanitizarVideoDataParaGraph fica com o hash.
// v5.44 (22/08/2026) - Replica CTWA → conjunto WEBSITE: reescreve CTA+link (CONTACT_US + wa.me),
//   sem app_destination. Espelho do conjunto grava destination_type/optimization_goal.
// v5.43 (22/08/2026) - Trafego WEBSITE (LANDING_PAGE_VIEWS + wa.me no criativo) nao e CTWA.
//   Nome CONV / familia mensagens nao recusa destination_type=WEBSITE (card 5b9fd669).
// v5.42 (22/08/2026) - definir_whatsapp_conjunto: PATCH promoted_object.whatsapp_phone_number
//   (Gerenciador trava o campo). Tenta formatos + pausa temporaria se o PATCH direto falhar.
// v5.41 (22/08/2026) - CTWA: criativo WHATSAPP_MESSAGE + api.whatsapp.com/send; numero no
//   promoted_object do conjunto (nao CONTACT_US + wa.me). Corrige "Criativo invalido para o
//   objetivo" nos JUR_CONV ACTIVE sob CONVERSATIONS+WHATSAPP. Patch automatico do conjunto
//   antes do adcreative; modo reparar_criativos_ctwa para anuncios ja criados.
// v5.40 (22/08/2026) - CTWA video sem_molde: NAO envia video_data.link (Graph 1443050
//   cards a703e076/934e1a2f). CTA+wa.me quando conjunto destination_type=WHATSAPP.
//   sanitizarVideoDataParaGraph em todo POST de peca nova video.
// v5.39 (22/08/2026) - alterar_categoria_especial_campanha: update_campaign com
//   special_ad_categories (incl. [] para remover); espelho campaigns sincronizado.
// v5.38 (21/08/2026) - Targeting create_adset: Advantage+ sem age_max; age_min<=25;
//   familia mensagens NAO herda publico/idade do molde LF (base limpa + geo + placements).
//   Meta 1870188 no card JURIDICO_CONJ.01.
// v5.37 (21/08/2026) - Remove IG Explore/explore_home (Meta 2490589 descontinuou).
// v5.36 (21/08/2026) - CTWA/mensagens: forca bid_strategy=LOWEST_COST_WITHOUT_CAP e
//   remove bid_amount herdado do molde (card 1687f34f, Meta 2490487: teto sem valor).
// v5.35 (21/08/2026) - FAMILIA MENSAGENS (CTWA): CONVERSATIONS + destination_type=WHATSAPP
//   + page_id sob campanha OUTCOME_ENGAGEMENT. Nao forcar POST_ENGAGEMENT/ON_POST.
//   Card 7d6563df: recusa optimization_goal_nao_suportado_para_engajamento.
// v5.34 (21/08/2026) - GEO PRESET JURIDICO COHAPM: no criar_conjunto, meio Jurídico
//   injeta/valida preset Salvador–BA; La Felicità isolada (não herda).
// v5.33 (21/08/2026) - GEO/BAIRROS no criar_conjunto: payload.geo_locations sobrescreve
//   targeting.geo_locations herdado do molde/sem_molde (neighborhoods/cities/custom/…).
// v5.31 (20/08/2026) - ANUNCIO engajamento: destino_url pode ser Page/IG (nao so LP CLT).
//   destino_do_anuncio.caso=engajamento_social e honrado via destinoDoPedidoCompat.
// v5.30 (20/08/2026) - ENGAGEMENT exige destination_type=ON_POST com POST_ENGAGEMENT
//   (card 1b905e3a: Meta recusou goal sem ON_POST). REACH nao entra no caminho engajamento.
// v5.29 (20/08/2026) - criar_conjunto SEM MOLDE para familia engajamento/reconhecimento:
//   sem_molde / molde_external_id=sem_molde → targeting BR Advantage+ minimo + POST_ENGAGEMENT
//   + ON_POST (ou REACH em reconhecimento) + promoted_object={page_id}. Molde LEADS: so targeting.
// v5.28 (20/08/2026) - ENGAJAMENTO/RECONHECIMENTO: criar_campanha aceita ODAX social
//   (OUTCOME_ENGAGEMENT/AWARENESS + sinonimos). criar_conjunto, quando familia engajamento
//   ou reconhecimento (payload ou objective da campanha destino), sobrescreve molde
//   OFFSITE_CONVERSIONS+pixel por POST_ENGAGEMENT+ON_POST|REACH + promoted_object={page_id}.
// v5.27 (20/08/2026) - teto horario por EMPRESA (Map), alinhado a contar_acoes_na_hora.
// v5.26 (15/08/2026) - campanha/conjunto tambem nascem ACTIVE; ativar_campanha / ativar_conjunto.
// v5.25 (15/08/2026) - criar_anuncio nasce ACTIVE na aprovacao; ativar_criativo (update_ad ACTIVE).
// v5.24 (15/08/2026) - Identidade Instagram oficial Legal = @legaleviver_ (IBA).
//   Hard-block de identidades proibidas em resolverIdentidadeInstagram. Campo do spec
//   continua pelo FORMATO do id (IBA 1784... → instagram_user_id; legado → instagram_actor_id).
// v5.23 (12/08/2026) - ESP-29: driver de transporte resolvido POR ACAO (driverParaAcao):
//   override em meta_execution_config.driver_por_acao > driver_escrita (empresa) > graph.
//   pode_executar_acao/resolver_driver aplicam a matriz de capacidade (renomear=pipeboard-only).
// v5.32 (21/08/2026) - NOME LIVRE: criar/renomear aceitam nome_novo/novo_nome free-form.
//   nome_partes deixa de ser obrigatorio; padrao estruturado e so metadado/sugestao opcional.
// v5.22 (12/08/2026) - ESP-39: testes vs escala em campanhas separadas (negocio).
//   Nao forca mais nomenclatura estruturada no nome.
// v5.21 (12/08/2026) - ESP-40 (legado): nome_partes alinhado ao composto. Superado em v5.32.
// v5.20 (12/08/2026) - ESP-25: escalar_duplicar. Criacao de conjunto com +20% so se
//   avaliar_escala.apto na proposta E de novo na execucao; orcamento travado na escada;
//   targeting herdado do molde (sem redes livres). redistribuir fica de fora.
// v5.19 (12/08/2026) - ESP-24: pausar_conjunto (ad set → PAUSED via update_adset/Graph).
//   Ativar continua FORA do sistema (gestor no Gerenciador). Sem ativar_*.
// v5.18 (12/08/2026) - ESP-35: PECA NOVA SEM MOLDE. Quando creative_id ausente e ha
//   meta_video_id ou meta_image_hash, monta object_story_spec do zero com page_id + CTA +
//   destino_url vindos do payload/config (meta_execution_config.page_id / cta_padrao).
//   Replicacao pura continua exigindo molde. Destino sem molde: so URL explicita no payload
//   (CLT via destino_do_anuncio na emissao). Fail-closed se page/CTA/URL faltarem.
// v5.17 (12/08/2026) - ESP-26: TETO DE ORCAMENTO NA EXECUCAO, NAO SO NA PROPOSTA.
//   criar_conjunto_a_partir_de e alterar_orcamento passam a chamar a MESMA RPC
//   avaliar_orcamento_diario (via _shared/avaliar_orcamento.ts) antes de escrever na Meta.
//   A comparacao local contra teto_sanidade_orcamento_diario SAIU desses dois caminhos: dois
//   juizes para a mesma pergunta era o defeito. Fail-closed: RPC indisponivel = nao executa.
//   A mensagem ao gestor (exposicao acumulada dos conjuntos ACTIVE) fica no audit.
// v5.16 (11/08/2026) - CAMPO DA IDENTIDADE ESCOLHIDO PELO FORMATO DO ID.
//   campoIdentidadeInstagramPorFormato(): 1784... -> instagram_user_id; caso contrario ->
//   instagram_actor_id. Evidencia Pipeboard tools/list (create_ad_creative vs
//   create_existing_post_ad_creative). Oficial Legal atual: @legaleviver_ (IBA).
// v5.15 (11/08/2026) - THREADS OFF; plataformas de publicacao na criacao de conjunto.
//   Threads desabilitado por padrao (empresa sem cadastro). Facebook+video aplica
//   automaticamente os 8 placements sem right_hand_column.
// v5.14 (11/08/2026) - PADRAO OBRIGATORIO DE POSICIONAMENTO DE VIDEO NA CRIACAO DO CONJUNTO
//   (decisao do Ryan 11/08 + auditoria dos 3 conjuntos de video ACTIVE). criar_conjunto_a_partir_de
//   com formato_midia_previsto=video nasce ja com publisher_platforms=["facebook"] e os 8
//   facebook_positions observados (sem right_hand_column). IMAGEM nao exclui nada; formato ausente
//   preserva o molde e avisa (nunca aplica a regra de video no escuro). A acao corretiva
//   ajustar_posicionamentos_do_conjunto passou a reusar EXATAMENTE o mesmo padrao (aplicarPadrao-
//   PosicionamentoVideo), deterministico e igual ao da criacao.
// v5.13 (11/08/2026) - AJUSTE SANCIONADO DE POSICIONAMENTOS. A nova acao
//   ajustar_posicionamentos_do_conjunto passa pelas mesmas flags, dry_run, teto horario, card,
//   audit e reconciliacao das demais escritas. O formato governa a exclusao: VIDEO remove
//   facebook.right_hand_column; IMAGEM nao inventa exclusao. Pipeboard update_adset(targeting)
//   foi comprovado por tools/list (request 610). A Graph rele targeting e espelhar() atualiza
//   ad_sets. Anuncio substituto pode depender do card de posicionamento reconciliado.
// v5.12 (11/08/2026) - IDENTIDADE OFICIAL DO BUSINESS; CONFIG PREVALECE SOBRE O MOLDE. O id
//   17841428674060566 (v5.11) mostrou-se ERRADO: a Meta gravava o instagram_user_id no creative,
//   mas a previa mantinha o aviso de Threads porque esse id NAO e identidade valida do Business.
//   A sonda meta-identity-probe confirmou que o Business (id 3109716642547310) expoe
//   17841423949227215 (@legaleviver_) em owned_instagram_accounts/instagram_accounts. Decisao do
//   Ryan (11/08): esse passa a ser o id oficial em meta_execution_config. A RPC
//   identidade_instagram_para_criacao inverteu a prioridade - a CONFIG oficial PREVALECE e o molde
//   so e fallback -, porque os moldes antigos expoem o id velho e copiar deles o reinjetaria. Este
//   arquivo nao muda de logica: le a identidade da MESMA RPC, entao herda o config-first.
// v5.11 (11/08/2026) - IDENTIDADE INSTAGRAM PREENCHIDA, NAO SO AVISADA. Para peca nova
//   (video_data ou link_data), resolve a identidade pela RPC identidade_instagram_para_criacao.
//   [SUPERADO pela v5.12: a prioridade era molde-primeiro e o id da empresa era 17841428674060566.]
// v5.10 (11/08/2026) - DESTINO POR PRODUTO, NAO POR DOMINIO. A correcao do link deixa de ser por
//   dominio (v5.6) e passa a HONRAR a decisao de produto tomada na emissao (payload.destino_do_anuncio,
//   via RPC resolver_destino_do_anuncio/inferir_produto_anuncio). destinoDoPedidoCompat(p): so
//   "aplicavel" quando o produto e credito CLT (unica LP decidida -> /simulacao-clt); produto OUTRO
//   ou indeterminado -> URL do molde PRESERVADA (nunca reescreve as cegas). A recusa sem story_spec
//   so dispara para CLT que precisa corrigir. Espelho SQL: destino_por_produto (PO-17).
// v5.9 (11/08/2026) - PECA NOVA DE IMAGEM. meta_image_hash deixa de ser foto_nao_suportada e
//   passa a montar object_story_spec.link_data a partir do molde (troca image_hash), espelhando
//   a disciplina do video. Pipeboard create_ad_creative ja aceita image_hash plano (argsCreative
//   DeGraph desembrulha link_data). Carrossel CONTINUA recusado. Video XOR imagem: conflito
//   recusa por nome. Avisos de veiculacao derivados do FORMATO (imagem VEICULA na Coluna da
//   direita; video nao). Upload de imagem nova: via upload-midia/adimages (nao via Pipeboard).
// v5.8 (11/08/2026) - POSICIONAMENTO E IDENTIDADE. (1) personalizacao_por_posicionamento_nao_suportada:
//   pedido que pede midia por posicionamento (ex.: imagem so na Coluna da direita, que nao aceita
//   video) RECUSA por nome - a executora monta um unico video_data, nao asset por posicionamento.
//   (2) avisos_de_veiculacao no card da peca nova: anuncio de VIDEO nao veicula na Coluna da direita
//   do Facebook (regra do posicionamento, nao tamanho do video); molde sem instagram_user_id nasce
//   sem identidade Instagram/Threads e perde esses posicionamentos. O aviso ANTES da aprovacao vive
//   em pedido_de_anuncio_completo (mensagem_para_o_gestor), derivado de creative_estado_graph.
// v5.7 (11/08/2026) - MOLDE DINAMICO SERVE DE CONFIG. Peca nova tambem herda page_id+link+CTA
//   de asset_feed_spec (videos[] + link_urls + call_to_action_types string plana) quando o
//   molde nao expoe video_data no story_spec. Monta object_story_spec minimo; molde de
//   imagem continua recusado. Identidade IG herdada se existir. Destino LP canonico (v5.6)
//   permanece. Portao: creative_estado_graph.serve_de_molde_video.
// v5.6 (11/08/2026) - DESTINO CANONICO LP/SITE (SUPERADO pela v5.10, que decide por PRODUTO).
//   Anuncios de credito CLT usam https://legaleviver.com.br/simulacao-clt. A correcao por dominio
//   foi substituida por decisao de produto na emissao; a recusa sem story_spec permanece, mas so
//   para o caso CLT que precisa corrigir.
// v5.5 (07/08/2026) - ABO DE VERDADE PELO PIPEBOARD. O gestor decidiu o regime: ABO (campanha SEM
//   orcamento, dinheiro em cada conjunto). Ate aqui montarCriacao montava ABO "por construcao"
//   (corpo sem orcamento), mas o conector Pipeboard INJETAVA daily_budget=1000, e TODA campanha
//   criada pelo Pipeboard nascia CBO - foi o que aconteceu com a NOVA-01 (120254323578040191).
//   DESCOBERTA (sonda tools/list do Pipeboard + teste descartavel controlado, 07/08): o
//   create_campaign do conector tem um parametro DEDICADO, use_adset_level_budgets (boolean,
//   default false). EXPERIMENTO, mesmo caminho de codigo, so o flag mudando:
//   [TESTE-ABO-DESCARTAR-01] com use_adset_level_budgets=true -> Graph SEM daily_budget (o conector
//   respondeu budget_strategy=ad_set_level); [TESTE-ABO-DESCARTAR-02] com false -> Graph
//   daily_budget=1000. As duas campanhas foram apagadas (effective_status=DELETED). Conserto:
//   (1) criar_campanha aceita regime_orcamento no pedido; ABO (default) manda
//       use_adset_level_budgets=true e nenhum orcamento de campanha; regime != 'abo' RECUSA por
//       nome (regime_orcamento_nao_suportado), e o contrato recusa o MESMO no validador
//       (contrato_de_execucao.valores_aceitos=['abo']) para preservar a PO-17.
//   (2) o flag e do CONECTOR: escreverCriacao o remove antes de qualquer POST direto na Graph.
//   (3) a sonda de reconciliacao passa a provar a captura da injecao: a conferencia "limpa" de
//       campanha usa TESTE-A (ABO real na Graph), e um caso novo usa a NOVA-01 (ABO pedida, R$10
//       injetado) exigindo divergencia - antes a v41 usava a propria NOVA-01 como caso "conferido".
// v5.4 (07/08/2026) - TRES DEFEITOS DA MESMA FAMILIA: o sistema sabia da falha e nao contava.
//   (1) FALHA INVISIVEL NO CARD. Card b5e2f338: aprovado 20:55:58, create_adset recusado pelo
//       Pipeboard 20:56:01 por conflito de orcamento, e o card ficou status=approved /
//       executed_at=NULL / execution_result=NULL. get_aprovacoes leu esse estado e devolveu
//       "aprovado, ainda NAO executado"; o agente completou a lacuna e disse ao gestor "aguarde
//       alguns instantes, o conjunto esta sendo criado". A falha so existia no audit_log.
//       Agora TODA saida por meta_action_failed/meta_action_blocked marca approval_requests
//       .ultima_falha - com nome da recusa, motivo em linguagem de gestor, tentativa e se o card
//       segue re-executavel. A marcacao esta pendurada em audit(), nao em cada `continue`: sao 12
//       saidas nos dois caminhos, e marcar uma a uma garante que a proxima nasca invisivel.
//       executed_at NAO mudou de significado - continua sendo "a escrita terminou e o card esta
//       fechado", que e do que dependem a varredura (executed_at is null) e o fechamento apos
//       escrita PARCIAL. ultima_falha e eixo novo, ortogonal, e some no sucesso.
//   (2) CBO x ABO RECUSA ANTES DE CHAMAR A META. Mesmo padrao do gate de Dynamic Creative da
//       v5.2: le o orcamento da campanha PAI e recusa por nome (campanha_usa_orcamento_proprio_cbo)
//       em vez de descobrir pelo texto de erro da plataforma depois de gastar a aprovacao do
//       gestor. Falha de leitura recusa - nao ha default seguro entre "a campanha manda no
//       dinheiro" e "o conjunto manda no dinheiro". contrato_de_estado_execucao fecha o outro
//       lado, entao o card nem chega a aprovacao.
//   (3) A CAMPANHA NASCEU DIFERENTE DO PEDIDO E A CONFERENCIA NAO OLHAVA. MEDIDO: o corpo enviado
//       em create_campaign nao tinha daily_budget nem bid_strategy; a Graph devolve, para
//       120254323578040191, daily_budget=1000 (R$ 10,00/dia) e bid_strategy=
//       LOWEST_COST_WITHOUT_CAP. As campanhas TESTE-A/B/C foram criadas com o MESMO corpo -
//       inclusive is_adset_budget_sharing_enabled "false" - porem pelo driver GRAPH, e estao sem
//       orcamento. A unica variavel e o DRIVER: o conector Pipeboard INJETA orcamento de campanha
//       quando create_campaign nao traz um. O erro do Pipeboard estava certo; a campanha e CBO de
//       verdade, e ninguem pediu isso. A reconciliacao de campanha passa a pedir daily_budget/
//       lifetime_budget e a tratar CAMPO NAO PEDIDO QUE VOLTOU COM VALOR como divergencia
//       (exigir_ausentes) - antes o comparador so olhava campo presente no pedido, e o pedido era
//       vazio justamente ali. O espelho tambem para de gravar o literal daily_budget=0, que era um
//       palpite ("ABO: orcamento vive no conjunto") apresentado como fato e que ficou dias dizendo
//       o contrario da Meta.
// v5.3 (07/08/2026) - A CONFERENCIA POS-ESCRITA ESTAVA CONFERINDO O NIVEL ERRADO, E CHAMAVA
//   CEGUEIRA DE DIVERGENCIA. Dois defeitos, um em cima do outro.
//   (1) CAMPOS POR NIVEL. reconciliarAposEscrita tinha um parametro `campos` com default fixo -
//       "id,name,status,effective_status,adset_id,creative{id}", a lista DO ANUNCIO - e a unica
//       chamada existente nunca passava nada. Campanha e conjunto eram lidos pedindo adset_id e
//       creative{id}. A Graph NAO ignora campo inexistente: ela derruba a consulta INTEIRA com
//       OAuthException #100. A lista agora vem de nivelDaAcao(); nao existe mais default global,
//       e acao sem nivel mapeado FALHA DECLARANDO em vez de adivinhar lista.
//       PRECEDENTE: GT-12, quando pedir url_tags no nivel de anuncio derrubou a coleta completa
//       com o mesmo #100. A licao ficou na coleta e nao chegou na reconciliacao. Pior: o default
//       do anuncio foi escrito na manha de 07/08 para consertar exatamente esse #100 no anuncio -
//       consertou um nivel e quebrou os outros dois. Por isso a correcao e derivar do tipo, nao
//       trocar o palpite. O PEDIDO comparado tambem passou a ser por nivel (pedidoDeReconciliacao):
//       objective num conjunto ou daily_budget num anuncio e o mesmo defeito pelo outro lado.
//       daily_budget compara por NUMERO (centavos nos dois lados; texto faria 7200 divergir de
//       "7200.0").
//   (2) FALHA DE LEITURA != DIVERGENCIA. Corpo com `error` ou HTTP != 200 nao autoriza nenhuma
//       conclusao sobre o objeto, e era exatamente isso que acontecia: o `lido` virava envelope de
//       erro, o comparador lia name=null e anunciava divergencia. Agora ha estado explicito
//       (conferido | leitura_falhou | nivel_desconhecido) e DUAS acoes de audit_log:
//       meta_action_reconciliacao_falhou = nao consegui olhar;
//       meta_action_reconciliacao_divergente = olhei e a Meta tem outro valor.
//       Mesma distincao que o resto do sistema ja faz (UNKNOWN != NULL, coletor parado != conta sem
//       entrega). execution_result e o resultado devolvido carregam o estado, nao so um ok.
//   EVIDENCIA MEDIDA que motivou a versao: campanha 120254323578040191
//   ([LEV][LP][LEADS][CLT][NOVA-01][AGO26]), criada com sucesso via Pipeboard e PAUSED na Meta,
//   gerou meta_action_reconciliacao_divergente as 20:03:59Z com
//   divergencias: ["name: pediu=[LEV][LP][LEADS][CLT][NOVA-01][AGO26] graph=null"] e
//   objeto_criado: {"error":{"code":100,"message":"(#100) Tried accessing nonexisting field
//   (adset_id)"}}. As 17:16:45Z o anuncio 120254319507370191 tinha caido igual, com
//   "nonexisting field (daily_budget)". A campanha e o anuncio estavam CERTOS; a conferencia e que
//   estava quebrada. Os dois falsos positivos permanecem no audit_log como historia.
//   O MESMO DEFEITO existia no caminho v1 (modificar existente), que lia
//   "name,status,effective_status,daily_budget" para qualquer alvo - #100 garantido em
//   pausar_criativo (nivel de anuncio). Corrigido junto: consertar so a metade de cima deixaria a
//   de baixo para a proxima execucao real descobrir, que e como este bug chegou aqui.
//   modo=sonda_reconciliacao: bateria SO DE LEITURA sobre objetos que ja existem, exercitando o
//   mesmo reconciliarAposEscrita nos tres niveis, com teste negativo (divergencia real ainda
//   dispara) e casos de falha de leitura. Ela nao emite alarme de verdade - declara o que o
//   executor emitiria. Sem ela, provar a reconciliacao custava criar objeto na Meta.
// v5.2 (07/08/2026) - DESTINO DYNAMIC CREATIVE RECUSA ANTES DE QUALQUER ESCRITA. A Graph nao
//   aceita create_ad avulso em adset com is_dynamic_creative=true. Antes, montarCriacao criava o
//   adcreative e so descobria isso no POST /ads, deixando creative orfao. Agora le o conjunto
//   destino primeiro e recusa por nome; contrato/pedido fecham o card antes da aprovacao.
// v5.1 (07/08/2026) - CARROSSEL E FOTO PARAM DE FALHAR EM SILENCIO. montarCriacao ignorava
//   child_attachments e meta_image_hash: o pedido caia no ramo de replicacao pura e a Meta
//   publicava o criativo do MOLDE. O gestor aprovava "sobe o carrossel novo", a peca antiga ia
//   ao ar, o dinheiro saia. Era o oposto da rota de video, que desde a v4.4 recusa com nome.
//   Agora os dois campos recusam por nome (carrossel_nao_suportado / foto_nao_suportada) antes
//   de ler o molde. O contrato fecha o outro lado (contrato_de_execucao.suportado=false), entao
//   o card nem chega a aprovacao - este gate e o ULTIMO, nao o unico.
// v5 (06/08/2026) - DRIVER DE ESCRITA Pipeboard. So o ULTIMO passo muda.
//   driver_escrita vem de meta_execution_config (o mesmo campo que pode_executar_acao devolve).
//   Default e 'graph': com ele o comportamento das chamadas Meta permanece o de hoje.
//   'pipeboard' chama o MCP hospedado (tools/call), NUNCA com access_token preenchido.
//   dry_run nativo do conector so existe em create_campaign/update_campaign — nos demais
//   niveis o dry_run local continua e o card declara a lacuna. Depois de escrita real,
//   reconciliacao pela Graph e obrigatoria (o Pipeboard nao expoe log exportavel).
//   Monitor de token_status da conexao (login pessoal) entra em toda corrida com token.
//   Nenhuma action_flag e ligada por este card.
// v4.4 (04/08/2026) - GT-13: a executora aceita PECA NOVA. criar_anuncio_a_partir_de passa a ler
//   payload.meta_video_id e, quando ele existe, COPIA o object_story_spec do molde e TROCA a
//   midia (video_id + capa), em vez de replicar o criativo inteiro. Duas coisas sao inegociaveis
//   neste caminho: (1) a capa e OBRIGATORIA e sai do proprio video novo, escolhida POR PESO -
//   is_preferred da Meta foi medido e pode ser o quadro mais fraco; (2) NAO ha degradacao para
//   reusar_creative_id. No caminho de replicacao pura esse fallback e correto, porque o pedido e
//   publicar o criativo do molde; com peca nova ele publicaria a PECA ERRADA - o gestor aprova
//   "sobe o video novo" e a Meta entrega o antigo, gastando, sem ninguem notar. Cada
//   pre-requisito ausente (spec, video_data, page_id, link, capa) recusa com nome proprio.
//   O espelho passa a gravar procedencia do texto: legenda_fonte, legenda_referencias e
//   compliance_verificado_em. Sem elas, "quem escreveu esta legenda" so tem resposta no card,
//   que expira em 24h.
// v4.3.1 (04/08/2026) - o default do espelho deixa de ser literal. Ele apontava para "ACTIVE",
//   escrito na v4.2, e a v4.3 passou a criar PAUSED: default de contrato revogado gravava verde
//   falso no espelho quando a releitura na Graph nao trazia status. Agora segue o status que a
//   propria executora enviou (bodyFinal.status), com PAUSED apenas como ultimo recurso.
// v4.3 (03/08/2026) - REVERSAO DO CONTRATO DE ATIVACAO. O objeto volta a nascer PAUSED.
//   Motivo: o gestor Roberto pediu por audio em 03/08 14:45 - "ela tem que nascer pausada para
//   poder olhar e ativar ou nao" - e o Ryan acatou. A mudanca de 31/07 (aprovar = ativar) foi
//   decisao tecnica que NAO passou pelo gestor, e ele operou dias acreditando ter um freio manual
//   que nao existia mais. O desenho novo separa CRIAR de GASTAR em dois atos com donos
//   diferentes: aprovar card = criar (nao gasta); ativar no Gerenciador = gastar (gestor).
//   Aviso de arqueologia: o bloco "TRAVAS" mais abaixo neste cabecalho descrevia
//   status=PAUSED e categoria CREDIT e ficou correto por acidente na parte do PAUSED - mas a
//   categoria certa e FINANCIAL_PRODUCTS_SERVICES desde a v4.1. Corrigido nesta versao.
// v4.2 (03/08/2026) - ESPELHO NO ATO. A executora passa a gravar em campaigns/ad_sets/ads o
//   objeto que acabou de criar, com marca criado_pelo_sistema e link para o card de origem.
//   Motivo: o windsor-sync nao devolve campanha sem entrega, logo o sistema ficava cego para o
//   que ele mesmo criava - justamente na fase de montagem da estrutura. Falha de espelho nao
//   derruba a execucao (o objeto ja existe na Meta) mas e declarada no audit_log e no card.
// v4.1 (31/07/2026, minutos depois) - a Meta APOSENTOU a categoria especial CREDIT
//   (erro 2909060: "nao esta mais disponivel; escolha Produtos e servicos financeiros").
//   special_ad_categories agora envia FINANCIAL_PRODUCTS_SERVICES. Segunda evolucao de
//   plataforma pega na mesma noite pela execucao real - fail-loud pagando de novo.
// v4 (31/07/2026) - tres mudancas da primeira execucao real:
//   (1) is_adset_budget_sharing_enabled=false na criacao de campanha ABO - campo que a Meta
//       passou a EXIGIR (erro 100/4834011 recusou os 3 primeiros cards reais). false = cada
//       conjunto com o proprio orcamento, sem os 20% compartilhaveis: e o default que casa
//       com a disciplina de teto por conjunto; ligar compartilhamento = decisao declarada.
//   (2) APROVACAO = ATIVACAO (decisao do Ryan, 31/07): objeto criado nasce ACTIVE, nao mais
//       PAUSED. O portao passou a ser a APROVACAO HUMANA no card (sino) - quem aprova card
//       de ANUNCIO esta ligando entrega/gasto no ato; o resumo do card e o execution_result
//       dizem isso com todas as letras.
//   (3) Idempotencia verificada e mantida: executed_at so no sucesso; varredura exige
//       executed_at null; falha continua re-executavel. (v3) — F4.2 + criação + ISOLAMENTO POR EMPRESA
// v3 — A configuracao de execucao deixou de ser global. meta_execution_config era singleton
//   (check constraint travava id=1) e a linha unica valia para TODAS as empresas: ligar
//   master_enabled alcançaria as 8 campanhas da COHAPM sob a configuracao calibrada para a
//   Legal e Viver. Agora existe uma linha por empresa, e o executor carrega a config pela
//   company_id DO PROPRIO CARD, dentro do loop - nao mais uma vez no inicio.
//   Empresa sem linha propria NAO executa nada (antes herdaria a config da Legal).
//   Mesma classe do bug do contasOk[0] no traffic-chat: seguro por acidente com uma empresa,
//   errado com duas.
// v2 — ACOES DE CRIACAO. O v1 sabia MODIFICAR objeto existente (POST /{id}); criar e
// diferente em quatro pontos que exigiram caminho proprio:
//   (a) nao existe target_external_id: o alvo e a CONTA, e o v1 falhava sem esse campo;
//   (b) o endpoint e de COLECAO (POST /act_X/campaigns), nao de objeto;
//   (c) existem 20 contas meta_ads em integrations - criar na conta errada nao tem reversa
//       simples, por isso toda criacao valida a conta contra meta_execution_config
//       .contas_permitidas_criacao e RECUSA se nao estiver na lista;
//   (d) configuracao de conjunto (optimization_goal, billing_event, promoted_object,
//       destination_type, targeting, attribution_spec) nao pode ser inventada. Por isso
//       conjunto e anuncio sao REPLICADOS: o executor LE o molde na Graph API e troca apenas
//       nome, destino, orcamento e status.
// TRAVAS (decisoes do Ryan, todas no codigo):
//   status=PAUSED forcado em tudo que nasce (v4.3 restaurou isso); special_ad_categories=
//   ['FINANCIAL_PRODUCTS_SERVICES'] forcado na campanha (v4.1 - a Meta aposentou CREDIT);
//   teto de sanidade de orcamento; 3 camadas (master + flag + rate) preservadas;
//   dry_run mostra exatamente o que criaria sem escrever nada.
// UTM: o anuncio novo recebe url_tags gerado pelo traffic-chat. Como creative existente e
//   imutavel, criamos um adcreative NOVO reaproveitando o object_story_spec do molde (sem
//   upload de midia) so para poder aplicar as UTMs. Se o molde nao expuser object_story_spec
//   (tipico de Advantage+ com asset_feed_spec), reusamos o creative_id e DECLARAMOS que as
//   UTMs serao as do molde - degradar com aviso, nunca silenciosamente.
// v1: executor da fila de aprovações (pausar_criativo, pausar_campanha, alterar_orcamento).
//   escalar_criativo segue NAO automatizado (pulado com nota — decisão manual).
// Token Ads: por empresa via meta_company_tokens (redigido). Auth: x-mcp-key.

// Alinhado com as outras 24 edges e com _shared/mcp_auth.ts, que tipam contra
// @2. O pin antigo em 2.49.1 fazia o SupabaseClient desta edge ser um tipo
// diferente do que mcpKeyValida/julgarOrcamentoDiario esperam.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { chaveMcpDe, mcpKeyValida } from "../_shared/mcp_auth.ts";
import { traduzirFalha } from "../_shared/aprovacoes.ts";
import {
  COMPANY_COHAPM,
  businessIdPorCompanyId,
  empresaPorAdAccount,
  empresasComTokenAds,
  redactAllMetaTokens,
  tokenAdsPorCompanyId,
  tokenWabaPorCompanyId,
} from "../_shared/meta_company_tokens.ts";
import {
  candidatosPromotedObjectCtwa,
  diagnosticoRecusaWhatsApp,
  ehRecusaWhatsappNaoLigado,
  listarWhatsAppDaPagina,
  resolverWhatsAppCtwa,
  variantesDigitosWhatsAppBr,
  type CandidatoPromotedCtwa,
} from "../_shared/whatsapp_pagina.ts";
import {
  aplicarIdentidadeInstagramNoSpec,
  avisoIdentidadeInstagram,
  campoIdentidadeInstagramPorFormato,
  ERRO_INSTAGRAM_NAO_VINCULADO,
  exigirIdentidadeRedes,
  idInstagramDeParams,
  identidadeInstagramProibida,
  SEM_IDENTIDADE_INSTAGRAM,
  type IdentidadeInstagramResolvida,
} from "../_shared/identidade_instagram.ts";
import {
  criarGraphClient,
  HANDLE_COHAPM_OFICIAL,
  listarAnunciosInstagramDaCampanha,
  recusarCampanhaForaEscopoIg,
  relincarInstagramNoAnuncio,
} from "../_shared/instagram_anuncios.ts";
import {
  ehFlagSemMolde,
  ehNomeCompostoEstruturado,
  ehSentinelaSemMolde,
  nomeCompostoForaDeEscopoTrafego,
  recusarConjuntoErrado,
  recusarCruzamentoLinhaProduto,
} from "../_shared/memoria_conjunto.ts";
import {
  aplicarPadraoPosicionamentoVideo,
  aplicarPosicionamentoPorPlataformas,
  FACEBOOK_POSITIONS_VIDEO_PADRAO,
  PUBLISHER_PLATFORMS_VIDEO_PADRAO,
  sanitizarTargetingCreateAdset,
  targetingCompativelComFormato,
} from "../_shared/posicionamento.ts";
import {
  aplicarLinkNoVideoData,
  aplicarLinkNoLinkData,
  destinoDoPedidoCompat,
  ehUrlWhatsApp,
  urlWhatsAppMe,
  digitosWhatsApp,
  ctaPadraoMensagensWhatsApp,
  ctaPadraoTrafegoWebsite,
  ctaValueCtwa,
  LINK_CTWA_API_WHATSAPP,
  sanitizarVideoDataParaGraph,
  aplicarDestinoWebsiteNoVideoData,
  aplicarDestinoWebsiteNoLinkData,
} from "../_shared/destino_url_lp.ts";
import { julgarOrcamentoDiario } from "../_shared/avaliar_orcamento.ts";
import {
  conferirOrcamentoReais,
  ehFlagOrcamentoConfirmadoReais,
} from "../_shared/orcamento_reais.ts";
import { classificarPapelCampanha } from "../_shared/nomenclatura.ts";
import {
  aplicarGeoNoTargeting,
  normalizarGeoDoPedido,
} from "../_shared/geo_targeting.ts";
import { aplicarGateGeoCriarConjunto } from "../_shared/geo_preset_juridico.ts";
import {
  resolverObjetivoOdax,
  familiaDeObjetivo,
  ehFamiliaSocialTopo,
  ehPedidoMensagens,
  ehPedidoTrafegoWebsite,
  defaultsConjuntoSocialTopo,
  defaultsConjuntoMensagens,
  defaultsConjuntoTrafegoWebsite,
  targetingPadraoSocialTopo,
  mensagemObjetivoNaoSuportado,
} from "../_shared/objetivo_odax.ts";
import { empresaEhCredito } from "../_shared/empresa_credito.ts";
import {
  acaoDeAuditoriaDaReconciliacao,
  argsAdDeGraph,
  argsAdsetDeGraph,
  argsCampanhaDeGraph,
  argsCreativeDeGraph,
  camposDeReconciliacao,
  compararPedidoComGraph,
  driverParaAcao,
  monitorConexaoPipeboard,
  nivelDaAcao,
  pipeboardCall,
  pipeboardListTools,
  pipeboardToken,
  reconciliacaoNivelDesconhecido,
  type ConexaoPipeboard,
  type DriverEscrita,
  type NivelMeta,
  type Reconciliacao,
} from "../_shared/pipeboard.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
/** Token Ads ativo no request — trocado por empresa via ativarTokenEmpresa (sem fallback cruzado). */
let TOKEN = "";
const GRAPH = "https://graph.facebook.com/v21.0";
const EXECUTAVEIS = [
  "pausar_criativo",
  "ativar_criativo",
  "pausar_campanha",
  "ativar_campanha",
  "pausar_conjunto",
  "ativar_conjunto",
  "alterar_orcamento",
  "renomear_campanha",
  "renomear_conjunto",
  "renomear_criativo",
  "alterar_categoria_especial_campanha",
  "ajustar_posicionamentos_do_conjunto",
];
/** Renomear e a mesma escrita nos tres niveis: o campo `name` do objeto que ja existe. */
const RENOMEACOES = ["renomear_campanha", "renomear_conjunto", "renomear_criativo"];
const CRIACAO = ["criar_campanha", "criar_conjunto_a_partir_de", "criar_anuncio_a_partir_de", "escalar_duplicar"];

const supa = createClient(SUPABASE_URL, SERVICE_ROLE, { auth: { persistSession: false } });

function ativarTokenEmpresa(companyId: string | null | undefined): {
  ok: true;
  slug: string;
  ref: string;
} | { ok: false; motivo: string } {
  const t = tokenAdsPorCompanyId(companyId);
  if (!t) {
    TOKEN = "";
    return {
      ok: false,
      motivo: companyId
        ? `token Ads ausente para company_id=${companyId} (sem fallback para outra empresa)`
        : "company_id ausente — nao e possivel escolher token Ads",
    };
  }
  TOKEN = t.token;
  return { ok: true, slug: t.slug, ref: t.ref };
}

function ativarTokenPorAdAccount(adAccount: string | null | undefined): {
  ok: true;
  slug: string;
  ref: string;
  company_id: string;
} | { ok: false; motivo: string } {
  const emp = empresaPorAdAccount(adAccount);
  if (!emp) {
    TOKEN = "";
    return {
      ok: false,
      motivo: `ad_account ${adAccount ?? "(vazio)"} nao mapeado em EMPRESAS_META`,
    };
  }
  const a = ativarTokenEmpresa(emp.company_id);
  if (!a.ok) return a;
  return { ok: true, slug: a.slug, ref: a.ref, company_id: emp.company_id };
}

function redact(s: string): string {
  return redactAllMetaTokens(s);
}
function json(obj: unknown, status = 200) {
  return new Response(redact(JSON.stringify(obj)), {
    status,
    headers: { "content-type": "application/json" },
  });
}
async function g(path: string, method = "GET", body?: Record<string, string>) {
  const form = new URLSearchParams({ ...(body ?? {}), access_token: TOKEN });
  const sep = path.includes("?") ? "&" : "?";
  const r =
    method === "GET"
      ? await fetch(`${GRAPH}${path}${sep}${form.toString()}`)
      : await fetch(`${GRAPH}${path}`, { method, body: form });
  const t = await r.text();
  try {
    return { status: r.status, body: JSON.parse(redact(t)) };
  } catch {
    return { status: r.status, body: redact(t.slice(0, 300)) };
  }
}

async function segredoIntegracao(nome: string): Promise<string> {
  const { data } = await supa
    .from("integration_secrets")
    .select("value")
    .eq("name", nome)
    .maybeSingle();
  return String(data?.value ?? "");
}

type ResultadoEscrita = {
  status: number;
  body: any;
  id: string | null;
  driver: DriverEscrita;
  ferramenta?: string;
  dry_run_nativo?: boolean | null;
  nota_dry_run?: string | null;
  erro?: string;
  ok?: boolean;
};

// Ultimo passo: Graph (inalterado) ou Pipeboard. Travas, montarCriacao e espelhar ficam fora.
async function escreverCriacao(
  driver: DriverEscrita,
  acao: string,
  conta: string,
  path: string,
  body: Record<string, string>,
  pbToken: string,
  opts?: { dry_run?: boolean },
): Promise<ResultadoEscrita> {
  if (driver !== "pipeboard") {
    // use_adset_level_budgets e parametro do CONECTOR Pipeboard, nao da Graph. A Graph faz ABO
    // simplesmente NAO recebendo orcamento de campanha (medido nas TESTE-A/B/C, driver graph, sem
    // daily_budget). Enviar o flag a Graph arriscaria um erro de parametro desconhecido, entao ele
    // sai do corpo aqui - o unico ponto por onde o POST direto na Graph passa.
    const graphBody = { ...body };
    delete graphBody.use_adset_level_budgets;
    const exec = await g(path, "POST", graphBody);
    const id = (exec.body as any)?.id ?? null;
    return {
      status: exec.status,
      body: exec.body,
      id,
      driver: "graph",
      dry_run_nativo: null,
      ok: exec.status === 200 && !!id,
    };
  }

  if (opts?.dry_run && acao !== "criar_campanha") {
    // dry_run nativo so documentado em create_campaign/update_campaign. Nos demais niveis
    // nao inventamos: simulamos localmente e declaramos a lacuna (lacuna 5.1 do briefing).
    return {
      status: 200,
      body: { simulado_local: true, path, body },
      id: null,
      driver: "pipeboard",
      dry_run_nativo: false,
      nota_dry_run:
        "Pipeboard nao expoe dry_run nativo neste nivel (so create_campaign/update_campaign). Simulacao local; nada foi persistido.",
      ok: true,
    };
  }

  let tool = "";
  let args: Record<string, unknown> = {};
  if (acao === "criar_campanha") {
    tool = "create_campaign";
    args = argsCampanhaDeGraph(conta, body, { dry_run: !!opts?.dry_run });
  } else if (acao === "criar_conjunto_a_partir_de" || acao === "escalar_duplicar") {
    tool = "create_adset";
    args = argsAdsetDeGraph(conta, body);
  } else {
    return {
      status: 0,
      body: null,
      id: null,
      driver: "pipeboard",
      erro: `acao sem mapeamento Pipeboard: ${acao}`,
      ok: false,
    };
  }

  const r = await pipeboardCall(tool, args, pbToken);
  return {
    status: r.status || (r.ok ? 200 : 502),
    body: r.body,
    id: r.id,
    driver: "pipeboard",
    ferramenta: tool,
    dry_run_nativo: opts?.dry_run ? true : null,
    erro: r.erro,
    ok: opts?.dry_run ? r.ok || r.dry_run === true || !r.erro : r.ok && !!r.id,
  };
}

async function escreverCreative(
  driver: DriverEscrita,
  conta: string,
  path: string,
  body: Record<string, string>,
  pbToken: string,
): Promise<ResultadoEscrita> {
  // Carrossel: Pipeboard create_ad_creative nao monta child_attachments completo.
  // Forca Graph quando o object_story_spec traz 2+ slides.
  const forcarGraph = specTemCarrossel(body.object_story_spec);
  const driverEfetivo: DriverEscrita = forcarGraph ? "graph" : driver;

  if (driverEfetivo !== "pipeboard") {
    const cc = await g(path, "POST", body);
    const id = (cc.body as any)?.id ?? null;
    return {
      status: cc.status,
      body: cc.body,
      id,
      driver: "graph",
      ok: cc.status === 200 && !!id,
    };
  }
  const r = await pipeboardCall("create_ad_creative", argsCreativeDeGraph(conta, body), pbToken);
  return {
    status: r.status || (r.ok ? 200 : 502),
    body: r.body,
    id: r.id,
    driver: "pipeboard",
    ferramenta: "create_ad_creative",
    erro: r.erro,
    ok: r.ok && !!r.id,
  };
}

async function escreverAd(
  driver: DriverEscrita,
  conta: string,
  path: string,
  body: Record<string, string>,
  creativeId: string,
  pbToken: string,
): Promise<ResultadoEscrita> {
  if (driver !== "pipeboard") {
    const exec = await g(path, "POST", body);
    const id = (exec.body as any)?.id ?? null;
    return {
      status: exec.status,
      body: exec.body,
      id,
      driver: "graph",
      ok: exec.status === 200 && !!id,
    };
  }
  const r = await pipeboardCall("create_ad", argsAdDeGraph(conta, body, creativeId), pbToken);
  return {
    status: r.status || (r.ok ? 200 : 502),
    body: r.body,
    id: r.id,
    driver: "pipeboard",
    ferramenta: "create_ad",
    erro: r.erro,
    ok: r.ok && !!r.id,
  };
}

async function escreverUpdate(
  driver: DriverEscrita,
  acao: string,
  alvoExt: string,
  post: Record<string, string>,
  pbToken: string,
  opts?: { dry_run?: boolean },
): Promise<ResultadoEscrita> {
  // v5.60: renomear_campanha era travada em pipeboard aqui. A trava nasceu de como a ferramenta
  // foi introduzida (update_campaign nativo do Pipeboard), nao de limite da Meta: renomear e
  // POST /{id} com `name`, que a Graph faz nos tres niveis, pelo mesmo caminho generico abaixo.
  // A trava virou parede — 01/09/2026 ela recusou renomear campanha da COHAPM com
  // driver_nao_suporta_acao ate abrirem override em driver_por_acao. Agora os dois drivers valem.
  if (driver !== "pipeboard") {
    const exec = await g(`/${alvoExt}`, "POST", post);
    return {
      status: exec.status,
      body: exec.body,
      id: alvoExt,
      driver: "graph",
      dry_run_nativo: null,
      ok: exec.status === 200,
    };
  }

  let tool = "update_ad";
  if (
    acao === "pausar_campanha" ||
    acao === "ativar_campanha" ||
    acao === "renomear_campanha" ||
    acao === "alterar_categoria_especial_campanha"
  ) {
    tool = "update_campaign";
  }
  if (
    acao === "alterar_orcamento" ||
    acao === "ajustar_posicionamentos_do_conjunto" ||
    acao === "pausar_conjunto" ||
    acao === "ativar_conjunto" ||
    acao === "renomear_conjunto"
  ) {
    tool = "update_adset";
  }

  if (opts?.dry_run && tool !== "update_campaign") {
    return {
      status: 200,
      body: { simulado_local: true, alvo: alvoExt, post },
      id: alvoExt,
      driver: "pipeboard",
      dry_run_nativo: false,
      nota_dry_run:
        "Pipeboard nao expoe dry_run nativo neste nivel (so create_campaign/update_campaign). Simulacao local; nada foi persistido.",
      ok: true,
    };
  }

  const args: Record<string, unknown> = { ...post };
  if (tool === "update_campaign") args.campaign_id = alvoExt;
  else if (tool === "update_adset") args.adset_id = alvoExt;
  else args.ad_id = alvoExt;
  if (post.daily_budget) args.daily_budget = Number(post.daily_budget);
  // Pipeboard espera array tipado; Graph form manda JSON string.
  if (post.special_ad_categories != null) {
    try {
      args.special_ad_categories = JSON.parse(post.special_ad_categories);
    } catch {
      args.special_ad_categories = post.special_ad_categories;
    }
  }
  if (opts?.dry_run) args.dry_run = true;

  const r = await pipeboardCall(tool, args, pbToken);
  return {
    status: r.status || (r.ok ? 200 : 502),
    body: r.body,
    id: alvoExt,
    driver: "pipeboard",
    ferramenta: tool,
    dry_run_nativo:
      opts?.dry_run && tool === "update_campaign" ? true : opts?.dry_run ? false : null,
    erro: r.erro,
    ok: r.ok,
  };
}

// v5.3: a lista de campos vem do NIVEL do objeto (nivelDaAcao), nao de um default de parametro.
// Nao existe default aqui de proposito: o parametro com valor fixo era o defeito, porque quem
// chamava nunca passava nada e os tres niveis liam a lista de UM deles.
async function reconciliarAposEscrita(
  novoId: string,
  acao: string,
  pedido: Record<string, unknown>,
): Promise<{ graph: { status: number; body: unknown }; reconciliacao: Reconciliacao }> {
  const nivel = nivelDaAcao(acao);
  if (!nivel) {
    return {
      graph: { status: 0, body: null },
      reconciliacao: reconciliacaoNivelDesconhecido(acao),
    };
  }
  const campos = camposDeReconciliacao(nivel);
  const depois = await g(`/${novoId}?fields=${campos}`);
  return {
    graph: depois,
    reconciliacao: compararPedidoComGraph(pedido, depois.body, {
      http_status: depois.status,
      campos,
      // A executora NUNCA envia orcamento ao criar campanha (montarCriacao monta ABO por
      // contrato). Se a Graph devolver orcamento de campanha, alguem no caminho o colocou - e em
      // 07/08/2026 esse alguem foi o conector Pipeboard. Sem esta linha a divergencia e invisivel,
      // porque o comparador so olha campo presente no pedido e o pedido e vazio aqui.
      exigir_ausentes: nivel === "campanha" ? ["daily_budget", "lifetime_budget"] : undefined,
    }),
  };
}

// O PEDIDO tambem e por nivel. Mandar objective na comparacao de um conjunto, ou daily_budget na de
// um anuncio, produz divergencia falsa pelo lado do pedido - o mesmo defeito visto do outro angulo.
// So entra o que a executora REALMENTE enviou naquele nivel.
function pedidoDeReconciliacao(
  acao: string,
  body: Record<string, string>,
  payload: any,
): Record<string, unknown> {
  const nivel = nivelDaAcao(acao);
  if (nivel === "campanha") {
    const out: Record<string, unknown> = {
      name: body.name,
      status: body.status,
      objective: body.objective ?? payload?.objetivo,
    };
    if (body.special_ad_categories != null) {
      try {
        out.special_ad_categories = JSON.parse(body.special_ad_categories);
      } catch {
        out.special_ad_categories = body.special_ad_categories;
      }
    } else if (Array.isArray(payload?.special_ad_categories)) {
      out.special_ad_categories = payload.special_ad_categories;
    }
    return out;
  }
  if (nivel === "conjunto") {
    return {
      name: body.name,
      status: body.status,
      daily_budget: body.daily_budget, // centavos; a comparacao e numerica
      campaign_id: body.campaign_id, // conjunto no pai errado e caro e silencioso
    };
  }
  if (nivel === "anuncio") {
    return { name: body.name, status: body.status, adset_id: body.adset_id };
  }
  return {};
}
// v4.4 (04/08/2026) - GT-13: a thumbnail do video_data e OBRIGATORIA na Meta, e ela nao vem de
// graca: o quadro do molde e o do video ANTIGO. Os quadros do video novo saem de
// GET /{video_id}/thumbnails, gerados pela Meta na ingestao.
// POR PESO, NAO POR is_preferred: foi medido nos 19 videos do Drive que o quadro marcado como
// preferido pela Meta pode ser justamente o mais fraco - abertura em fundo liso, quase uniforme,
// que pesa uma fracao dos demais. Peso em bytes e o proxy de densidade visual disponivel sem
// baixar e decodificar imagem, o que este runtime nao faz.
// SEM PESO MENSURAVEL A FUNCAO RECUSA. Escolher por posicao seria escolher no escuro e entregar
// como se fosse critério; quem precisar de capa especifica passa thumbnail_url no payload.
async function escolherThumbnail(
  videoId: string,
  urlExplicita: string,
): Promise<{
  url?: string;
  erro?: string;
  indice?: number;
  bytes?: number;
  total?: number;
  criterio?: string;
}> {
  if (urlExplicita)
    return { url: urlExplicita, criterio: "url informada no payload (nao foi escolhida por peso)" };

  const r = await g(`/${videoId}/thumbnails?fields=id,uri,width,height,is_preferred`);
  if (r.status !== 200) {
    return {
      erro: `a Meta nao devolveu os quadros do video ${videoId} (HTTP ${r.status}). Sem quadro nao ha capa, e a Meta exige capa em video_data.`,
    };
  }
  const lista: any[] = Array.isArray((r.body as any)?.data) ? (r.body as any).data : [];
  if (!lista.length) {
    return {
      erro: `o video ${videoId} nao tem quadro gerado pela Meta ainda. A geracao acontece na ingestao e pode nao ter terminado - tente de novo, ou passe thumbnail_url no payload.`,
    };
  }

  const medidos: { i: number; uri: string; bytes: number | null }[] = [];
  for (let i = 0; i < lista.length; i++) {
    const uri = String(lista[i]?.uri ?? "");
    if (!uri) {
      medidos.push({ i, uri, bytes: null });
      continue;
    }
    let bytes: number | null = null;
    try {
      const h = await fetch(uri, { method: "HEAD" });
      const cl = h.headers.get("content-length");
      bytes = h.ok && cl ? Number(cl) : null;
    } catch {
      bytes = null;
    }
    medidos.push({ i, uri, bytes });
  }
  const comPeso = medidos.filter((m) => typeof m.bytes === "number" && (m.bytes as number) > 0);
  if (!comPeso.length) {
    return {
      erro: `nenhum dos ${lista.length} quadros do video ${videoId} respondeu ao HEAD com content-length, entao NAO ha como escolher por densidade visual. Escolher por posicao seria escolher no escuro. Passe thumbnail_url no payload se quiser uma capa especifica.`,
    };
  }
  comPeso.sort((a, b) => (b.bytes as number) - (a.bytes as number));
  const melhor = comPeso[0];
  return {
    url: melhor.uri,
    indice: melhor.i,
    bytes: melhor.bytes as number,
    total: lista.length,
    criterio: `quadro mais pesado entre os ${comPeso.length} de ${lista.length} que responderam ao HEAD (peso = proxy de densidade visual; is_preferred da Meta foi IGNORADO de proposito)`,
  };
}

// ==================== v5.3: SONDA DE RECONCILIACAO (SOMENTE LEITURA) ====================
// POR QUE EXISTE: ate aqui a reconciliacao so era exercitada por uma ESCRITA REAL. Provar que ela
// funciona custava criar objeto na Meta - e foi por isso que os dois falsos positivos de 07/08 so
// apareceram DEPOIS de a campanha e o anuncio existirem, com dinheiro e evidencia envolvidos.
// A sonda le objetos que JA existem, chama o MESMO reconciliarAposEscrita e a MESMA
// acaoDeAuditoriaDaReconciliacao do caminho de execucao, e nao emite POST nenhum na Meta.
//
// O PEDIDO VEM DO ESPELHO LOCAL (campaigns/ad_sets/ads), nao da propria Graph: comparar a Graph com
// ela mesma provaria apenas que a leitura respondeu, nunca que o comparador compara. O espelho e
// fonte independente, gravada no ato da criacao por espelhar().
//
// A SONDA NAO EMITE meta_action_reconciliacao_divergente NEM _falhou DE VERDADE. Alarme fabricado
// por teste fica indistinguivel de alarme real semanas depois, e o que esta em jogo nesta rodada e
// justamente poder confiar nesse alarme. Ela DECLARA a acao que o executor emitiria, calculada pela
// funcao compartilhada, e grava o resultado sob a acao propria meta_action_reconciliacao_sonda.
type CasoSonda = {
  nome: string;
  acao: string;
  external_id: string;
  espera: "conferido_ok" | "divergente" | "falhou";
  pedido: Record<string, unknown>;
  campos_forcados?: string;
  nota?: string;
};

const SONDA_CAMPANHA = "120254323578040191"; // [LEV][LP][LEADS][CLT][NOVA-01][AGO26]
// v5.5: a conferencia "limpa" de campanha precisa de uma campanha SEM orcamento na Graph. NOVA-01
// nao serve mais: ela nasceu com R$ 10/dia injetados pelo Pipeboard, entao usa-la como caso
// "conferido_ok" fazia o proprio exigir_ausentes acusar divergencia (a v41 reportava esse caso como
// FALHOU sem saber). TESTE-A foi criada pelo driver GRAPH, sem orcamento, e continua ABO na Graph.
const SONDA_CAMPANHA_ABO_LIMPA = "120254137750140191"; // [LEV][LP][LEADS][CLT][TESTE-A][AGO26]
const SONDA_CAMPANHA_CBO_INJETADA = "120254323578040191"; // NOVA-01: ABO pedida, R$10 injetado
const SONDA_CONJUNTO_LAL = "120253389922700191"; // molde LAL 1%
const SONDA_CONJUNTO_AMPLO = "120249671585580191"; // molde amplo BR 18-65
const SONDA_ANUNCIO = "120254319507370191"; // anuncio de prova do GT-13
const SONDA_ID_INEXISTENTE = "120000000000000000";

async function pedidoDoEspelho(
  nivel: NivelMeta,
  externalId: string,
): Promise<{ pedido: Record<string, unknown>; fonte: string } | null> {
  if (nivel === "campanha") {
    const { data } = await supa
      .from("campaigns")
      .select("name,status,objective")
      .eq("provider", "meta_ads")
      .eq("external_id", externalId)
      .maybeSingle();
    if (!data) return null;
    // campaigns guarda status em minusculo; o comparador normaliza caixa dos dois lados.
    return {
      pedido: { name: data.name, status: data.status, objective: data.objective },
      fonte: "espelho campaigns",
    };
  }
  if (nivel === "conjunto") {
    const { data } = await supa
      .from("ad_sets")
      .select("name,status,daily_budget,campaign_id")
      .eq("provider", "meta_ads")
      .eq("external_id", externalId)
      .maybeSingle();
    if (!data) return null;
    // ad_sets.campaign_id e uuid INTERNO - o id da Meta esta em campaigns.external_id.
    let campanhaExt: string | null = null;
    if (data.campaign_id) {
      const { data: c } = await supa
        .from("campaigns")
        .select("external_id")
        .eq("id", data.campaign_id)
        .maybeSingle();
      campanhaExt = c?.external_id ?? null;
    }
    return {
      pedido: {
        name: data.name,
        status: data.status,
        daily_budget: data.daily_budget, // NUMERO no espelho, string na Graph: e o par que a comparacao numerica existe para nao confundir
        ...(campanhaExt ? { campaign_id: campanhaExt } : {}),
      },
      fonte: campanhaExt
        ? "espelho ad_sets + campaigns.external_id"
        : "espelho ad_sets (campanha nao resolvida no espelho)",
    };
  }
  const { data } = await supa
    .from("ads")
    .select("name,status,adset_external_id")
    .eq("provider", "meta_ads")
    .eq("external_id", externalId)
    .maybeSingle();
  if (!data) return null;
  return {
    pedido: {
      name: data.name,
      status: data.status,
      ...(data.adset_external_id ? { adset_id: data.adset_external_id } : {}),
    },
    fonte: "espelho ads",
  };
}

async function bateriaDaSonda(): Promise<{ casos: CasoSonda[]; sem_espelho: string[] }> {
  const casos: CasoSonda[] = [];
  const sem_espelho: string[] = [];
  const alvos: { nivel: NivelMeta; acao: string; id: string; apelido: string }[] = [
    { nivel: "campanha", acao: "criar_campanha", id: SONDA_CAMPANHA_ABO_LIMPA, apelido: "campanha_abo_limpa" },
    {
      nivel: "conjunto",
      acao: "criar_conjunto_a_partir_de",
      id: SONDA_CONJUNTO_LAL,
      apelido: "conjunto_molde_lal1",
    },
    {
      nivel: "conjunto",
      acao: "criar_conjunto_a_partir_de",
      id: SONDA_CONJUNTO_AMPLO,
      apelido: "conjunto_molde_amplo",
    },
    { nivel: "anuncio", acao: "criar_anuncio_a_partir_de", id: SONDA_ANUNCIO, apelido: "anuncio_gt13" },
  ];

  for (const a of alvos) {
    const esp = await pedidoDoEspelho(a.nivel, a.id);
    if (!esp) {
      sem_espelho.push(`${a.apelido} (${a.id}) nao esta no espelho - sem fonte independente de pedido`);
      continue;
    }
    casos.push({
      nome: `${a.apelido}_conferido`,
      acao: a.acao,
      external_id: a.id,
      espera: "conferido_ok",
      pedido: esp.pedido,
      nota: `pedido vindo do ${esp.fonte}; prova que os campos do nivel ${a.nivel} devolvem OBJETO e batem`,
    });

    // TESTE NEGATIVO: divergencia REAL tem de continuar disparando. Alarme que parou de tocar nao
    // prova que o problema acabou - prova que pode ter sido silenciado.
    if (a.nivel === "conjunto") {
      const centavos = Number(esp.pedido.daily_budget ?? 0);
      casos.push({
        nome: `${a.apelido}_divergencia_real_orcamento`,
        acao: a.acao,
        external_id: a.id,
        espera: "divergente",
        pedido: { ...esp.pedido, daily_budget: centavos + 1 },
        nota: "orcamento propositalmente 1 centavo diferente: se isto nao disparar, a conferencia de dinheiro esta cega",
      });
      casos.push({
        nome: `${a.apelido}_orcamento_texto_vs_numero`,
        acao: a.acao,
        external_id: a.id,
        espera: "conferido_ok",
        pedido: { ...esp.pedido, daily_budget: `${centavos}.0` },
        nota: "mesmo valor em centavos escrito como texto decimal: comparacao por TEXTO acusaria divergencia falsa, a numerica nao",
      });
    } else {
      casos.push({
        nome: `${a.apelido}_divergencia_real_nome_e_status`,
        acao: a.acao,
        external_id: a.id,
        espera: "divergente",
        pedido: {
          ...esp.pedido,
          name: `${String(esp.pedido.name ?? "")} [DIVERGENCIA-FORCADA-PELA-SONDA]`,
          status: "ACTIVE",
        },
        nota: "nome e status propositalmente errados contra objeto que existe e foi lido",
      });
    }
  }

  // PROVA v5.5: a reconciliacao de campanha PEGA a injecao de orcamento do Pipeboard. NOVA-01 foi
  // pedida SEM orcamento (ABO) e a Graph a devolve com daily_budget=1000 que o conector injetou. O
  // pedido reconstruido do espelho NAO carrega orcamento (a executora nunca envia orcamento de
  // campanha), e reconciliarAposEscrita aplica exigir_ausentes=[daily_budget,lifetime_budget]: se
  // isto nao virar divergencia, a conferencia de dinheiro da campanha esta cega - que foi o defeito
  // ate a v41. Depende de NOVA-01 seguir com o orcamento injetado ate o Ryan decidir (o card manda
  // deixa-la PAUSED e orfa), e e por isso um caso REAL, nao fabricado.
  const espInjecao = await pedidoDoEspelho("campanha", SONDA_CAMPANHA_CBO_INJETADA);
  if (espInjecao) {
    casos.push({
      nome: "campanha_abo_injecao_de_orcamento_pega",
      acao: "criar_campanha",
      external_id: SONDA_CAMPANHA_CBO_INJETADA,
      espera: "divergente",
      pedido: espInjecao.pedido,
      nota: "campanha ABO (pedido sem orcamento) que a Graph devolve com daily_budget=1000 injetado pelo Pipeboard: exigir_ausentes tem de acusar a divergencia. Fonte do pedido: espelho, que nao guarda orcamento de campanha.",
    });
  } else {
    sem_espelho.push(
      "NOVA-01 (campanha CBO injetada) nao esta no espelho - nao da para provar a captura da injecao de orcamento",
    );
  }

  // Falha de leitura 1: objeto que nao existe.
  casos.push({
    nome: "leitura_falhou_id_inexistente",
    acao: "criar_campanha",
    external_id: SONDA_ID_INEXISTENTE,
    espera: "falhou",
    pedido: { name: "nao importa - nada sera lido", status: "PAUSED" },
    nota: "id inexistente: a Graph responde erro, e erro de leitura NAO e divergencia",
  });
  // Falha de leitura 2: o defeito de 07/08 reproduzido de proposito - campos DO ANUNCIO pedidos no
  // nivel de CAMPANHA. Antes desta versao este caso virava meta_action_reconciliacao_divergente
  // com "name: pediu=... graph=null". Agora tem de virar _falhou.
  casos.push({
    nome: "leitura_falhou_campo_de_outro_nivel",
    acao: "criar_campanha",
    external_id: SONDA_CAMPANHA,
    espera: "falhou",
    pedido: { name: "[LEV][LP][LEADS][CLT][NOVA-01][AGO26]", status: "PAUSED" },
    campos_forcados: "id,name,status,effective_status,adset_id,creative{id}",
    nota: "reproduz o default global de 07/08 (lista do anuncio na campanha): #100 derruba a consulta inteira",
  });
  // Nivel desconhecido: falha declarando, sem tentar leitura nenhuma.
  casos.push({
    nome: "nivel_desconhecido_declara_em_vez_de_adivinhar",
    acao: "acao_sem_nivel_conhecido",
    external_id: SONDA_CAMPANHA,
    espera: "falhou",
    pedido: { name: "nao importa - nenhuma leitura e tentada" },
    nota: "acao sem nivel mapeado nao recebe lista de campos por palpite",
  });

  return { casos, sem_espelho };
}

async function rodarSondaReconciliacao(companyId: string) {
  const { casos, sem_espelho } = await bateriaDaSonda();
  const detalhes: any[] = [];
  for (const caso of casos) {
    let rec: Reconciliacao;
    let httpStatus = 0;
    if (caso.campos_forcados) {
      const lida = await g(`/${caso.external_id}?fields=${caso.campos_forcados}`);
      httpStatus = lida.status;
      rec = compararPedidoComGraph(caso.pedido, lida.body, {
        http_status: lida.status,
        campos: caso.campos_forcados,
      });
    } else {
      const r = await reconciliarAposEscrita(caso.external_id, caso.acao, caso.pedido);
      rec = r.reconciliacao;
      httpStatus = r.graph.status;
    }
    const obtido: CasoSonda["espera"] =
      rec.estado !== "conferido" ? "falhou" : rec.ok ? "conferido_ok" : "divergente";
    detalhes.push({
      nome: caso.nome,
      acao: caso.acao,
      external_id: caso.external_id,
      nivel: nivelDaAcao(caso.acao),
      espera: caso.espera,
      obtido,
      veredito: obtido === caso.espera ? "PASSOU" : "FALHOU",
      acao_de_auditoria_que_o_executor_emitiria: acaoDeAuditoriaDaReconciliacao(rec),
      estado: rec.estado,
      ok: rec.ok,
      http_status: httpStatus,
      campos_pedidos: rec.campos_pedidos,
      campos_comparados: rec.campos_comparados,
      pedido: caso.pedido,
      divergencias: rec.divergencias,
      erro_leitura: rec.erro_leitura,
      lido: rec.lido,
      nota: caso.nota ?? null,
    });
  }

  const resumo = {
    total: detalhes.length,
    passou: detalhes.filter((d) => d.veredito === "PASSOU").length,
    falhou: detalhes.filter((d) => d.veredito === "FALHOU").length,
    escritas_na_meta: 0,
    alarmes_gravados_no_audit_log: 0,
  };
  const resultado = {
    versao: "meta-actions-v5.5-sonda-reconciliacao",
    somente_leitura: true,
    nota: "Nenhum POST na Meta. As acoes de auditoria sao DECLARADAS pela funcao compartilhada, nao emitidas - alarme de teste nao entra na mesma gaveta do alarme real.",
    resumo,
    alvos_sem_espelho: sem_espelho,
    casos: detalhes,
  };
  await supa.from("audit_log").insert({
    company_id: companyId,
    action: "meta_action_reconciliacao_sonda",
    target_type: "sonda_reconciliacao",
    target_id: SONDA_CAMPANHA,
    details: JSON.parse(redact(JSON.stringify(resultado))),
  });
  return resultado;
}

async function audit(
  companyId: string,
  userId: string,
  action: string,
  approvalId: string,
  details: unknown,
) {
  await supa.from("audit_log").insert({
    company_id: companyId,
    user_id: userId,
    action,
    target_type: "approval_request",
    target_id: approvalId,
    details: JSON.parse(redact(JSON.stringify(details))),
  });

  // v5.4: o audit_log deixa de ser o UNICO lugar onde a falha aparece. As duas acoes que
  // significam "esta tentativa acabou mal" tambem marcam o card, que e onde os leitores olham.
  // As demais (executed, espelho_falhou, reconciliacao_*) NAO marcam: nelas o objeto existe.
  if (action === "meta_action_failed" || action === "meta_action_blocked") {
    const d: any = details ?? {};
    await marcarFalhaNoCard(approvalId, {
      etapa: action === "meta_action_blocked" ? "bloqueio" : String(d.etapa ?? "execucao"),
      recusa: d.motivo ? String(d.motivo) : null,
      mensagem: d.detalhe ? String(d.detalhe) : null,
      bruto: d.resposta ?? d.detalhe ?? d.motivo ?? null,
      driver: d.driver_escrita ?? null,
      bloqueado: action === "meta_action_blocked",
    });
  }
}
// ==================== v5.4: TODA TENTATIVA QUE TERMINA MAL MARCA O CARD ====================
// O card b5e2f338 ficou status=approved / executed_at=NULL / execution_result=NULL depois de o
// Pipeboard recusar create_adset. Quem lesse esse card - e o agente leu - so podia concluir
// "ainda nao executou". A falha estava no audit_log, e get_aprovacoes nao olha o audit_log.
// Daqui em diante nenhum `continue` deste executor sai sem dizer no CARD o que aconteceu.
// NAO mexemos em executed_at de proposito: ele continua significando "a escrita terminou e o card
// esta fechado", que e o que a varredura (executed_at is null) e o fechamento pos-escrita-parcial
// dependem. ultima_falha e o eixo novo: "a ultima tentativa acabou, e acabou assim".
// POR QUE ISTO PENDURA NO audit() E NAO EM CADA `continue`: sao 12 saidas de falha/bloqueio so
// neste arquivo, nos dois caminhos (criacao e modificacao). Marcar uma a uma garante que a
// proxima saida nova nasca invisivel de novo - que e literalmente a historia deste bug. Toda
// saida ja chama audit(); pendurar aqui e o unico ponto por onde TODAS passam.
async function marcarFalhaNoCard(
  cardId: string,
  dados: {
    etapa: string;
    recusa?: string | null;
    mensagem?: string | null;
    bruto?: unknown;
    driver?: string | null;
    re_executavel?: boolean;
    bloqueado?: boolean;
  },
) {
  const t = dados.bloqueado
    ? {
        recusa: String(dados.recusa ?? "bloqueado_por_trava_do_sistema"),
        motivo_para_o_gestor: `a execucao NAO foi tentada porque uma trava do sistema barrou o pedido: ${String(dados.recusa ?? "motivo nao registrado")}. Nada foi enviado a Meta. Enquanto a trava estiver assim, aprovar de novo nao muda o resultado.`,
      }
    : traduzirFalha(dados.bruto ?? dados.recusa ?? dados.etapa, dados.recusa, dados.mensagem);

  const { data: atual } = await supa
    .from("approval_requests")
    .select("ultima_falha")
    .eq("id", cardId)
    .maybeSingle();

  await supa
    .from("approval_requests")
    .update({
      ultima_falha: {
        em: new Date().toISOString(),
        etapa: dados.etapa,
        recusa: t.recusa,
        motivo_para_o_gestor: t.motivo_para_o_gestor,
        detalhe_tecnico: redact(
          typeof dados.bruto === "string" ? dados.bruto : JSON.stringify(dados.bruto ?? null),
        ).slice(0, 1000),
        tentativa: Number((atual as any)?.ultima_falha?.tentativa ?? 0) + 1,
        // Falha ANTES de qualquer escrita mantem o card elegivel para nova tentativa, de
        // proposito. Isso NAO significa "esta sendo processado": a tentativa terminou.
        re_executavel: dados.re_executavel !== false,
        driver_escrita: dados.driver ?? null,
      },
    })
    .eq("id", cardId);
}

// v2: normaliza act_123 e 123 para o mesmo formato, porque integrations guarda sem prefixo
// e a lista branca guarda com prefixo.
const actId = (v: string) => {
  const s = String(v ?? "").trim();
  return s.startsWith("act_") ? s : `act_${s}`;
};

// v5.1: espelho EXATO de public.campo_presente_no_pedido(jsonb, text). Os dois lados do portao
// (contrato/verificacao no banco e executor aqui) precisam recusar o MESMO conjunto de pedidos:
// se um considerar "" ou [] presente e o outro nao, volta a existir completo=true com o executor
// recusando - o padrao que a PO-17 v2 proibe. Vazio nao e pedido: string em branco, array vazio
// e objeto vazio contam como ausentes nos dois lugares.
export function campoPresente(v: unknown): boolean {
  if (v === null || v === undefined) return false;
  if (Array.isArray(v)) return v.length > 0;
  if (typeof v === "string") return v.trim() !== "";
  if (typeof v === "object") return Object.keys(v as Record<string, unknown>).length > 0;
  return true;
}

/** Carrossel Meta: 2–10 child_attachments com image_hash (+ link opcional no card). */
export function normalizarChildAttachments(
  raw: unknown,
  linkPadrao: string,
  ctaTipo: string,
): { ok: true; cards: Record<string, unknown>[] } | { ok: false; erro: string; detalhe: string } {
  if (!campoPresente(raw)) {
    return { ok: true, cards: [] };
  }
  if (!Array.isArray(raw)) {
    return {
      ok: false,
      erro: "carrossel_invalido",
      detalhe: "child_attachments deve ser um array de 2 a 10 slides.",
    };
  }
  if (raw.length < 2 || raw.length > 10) {
    return {
      ok: false,
      erro: "carrossel_tamanho_invalido",
      detalhe: `Carrossel exige 2 a 10 slides; recebi ${raw.length}.`,
    };
  }
  const cards: Record<string, unknown>[] = [];
  for (let i = 0; i < raw.length; i++) {
    const c = raw[i] as Record<string, unknown> | null;
    if (!c || typeof c !== "object") {
      return {
        ok: false,
        erro: "carrossel_slide_invalido",
        detalhe: `Slide ${i + 1} nao e objeto.`,
      };
    }
    const hash = String(c.image_hash ?? c.meta_image_hash ?? "").trim();
    if (!hash) {
      return {
        ok: false,
        erro: "carrossel_slide_sem_image_hash",
        detalhe: `Slide ${i + 1} sem image_hash. Faca upload_midia de cada peca antes.`,
      };
    }
    const linkCard = String(c.link ?? linkPadrao ?? "").trim();
    if (!linkCard) {
      return {
        ok: false,
        erro: "carrossel_slide_sem_link",
        detalhe: `Slide ${i + 1} sem link e sem link pai no pedido.`,
      };
    }
    const card: Record<string, unknown> = {
      image_hash: hash,
      link: linkCard,
      call_to_action: {
        type: String(c.call_to_action_type ?? ctaTipo ?? "LEARN_MORE").trim() || "LEARN_MORE",
        value: { link: linkCard },
      },
    };
    const name = String(c.name ?? c.headline ?? "").trim();
    const description = String(c.description ?? "").trim();
    if (name) card.name = name;
    if (description) card.description = description;
    cards.push(card);
  }
  return { ok: true, cards };
}

function specTemCarrossel(objectStorySpecJson: string | undefined): boolean {
  if (!objectStorySpecJson) return false;
  try {
    const spec = JSON.parse(objectStorySpecJson);
    const kids = spec?.link_data?.child_attachments;
    return Array.isArray(kids) && kids.length >= 2;
  } catch {
    return false;
  }
}

async function resolverIdentidadeInstagram(
  companyId: string | null,
  creativeMolde: string,
  payload?: Record<string, unknown> | null,
): Promise<IdentidadeInstagramResolvida> {
  const idParams = idInstagramDeParams(payload);
  const handleParams = String(payload?.instagram_handle ?? "").trim() || null;
  if (idParams) {
    return {
      encontrada: true,
      instagram_actor_id: idParams,
      instagram_handle: handleParams,
      fonte: "config_empresa",
      procedencia: "payload/config na emissao",
      vinculo_pagina_confirmado: null,
    };
  }
  // ESP-35: creativeMolde pode ser vazio — a RPC ja prioriza meta_execution_config.
  if (!companyId) return SEM_IDENTIDADE_INSTAGRAM;
  const { data, error } = await supa.rpc("identidade_instagram_para_criacao", {
    p_company_id: companyId,
    p_creative_id: creativeMolde || null,
  });
  if (error || !data || typeof data !== "object") return SEM_IDENTIDADE_INSTAGRAM;
  const id = String((data as any).instagram_actor_id ?? "").trim();
  const handle = String((data as any).instagram_handle ?? "").trim() || handleParams;
  if (!id) return SEM_IDENTIDADE_INSTAGRAM;
  // Hard block: identidades banidas nunca entram no creative (mesmo se reaparecerem na config).
  if (identidadeInstagramProibida(id) || identidadeInstagramProibida(handle)) {
    console.error("identidade_instagram_proibida_bloqueada", { companyId, id, handle });
    return SEM_IDENTIDADE_INSTAGRAM;
  }
  return {
    encontrada: true,
    instagram_actor_id: id,
    instagram_handle: handle,
    fonte:
      (data as any).fonte === "molde_creative_estado_graph"
        ? "molde_creative_estado_graph"
        : "config_empresa",
    procedencia: String((data as any).procedencia ?? "").trim() || null,
    vinculo_pagina_confirmado:
      typeof (data as any).vinculo_pagina_confirmado === "boolean"
        ? (data as any).vinculo_pagina_confirmado
        : null,
  };
}

function recusarSemIdentidadeNasPlataformas(
  p: Record<string, unknown> | null | undefined,
  identidade: IdentidadeInstagramResolvida,
): { erro: string; detalhe: string } | null {
  const check = exigirIdentidadeRedes({
    plataformas: p?.plataformas_publicacao ?? p?.publisher_platforms,
    identidade,
    idParams: idInstagramDeParams(p),
  });
  if (check.ok) return null;
  return { erro: check.erro || ERRO_INSTAGRAM_NAO_VINCULADO, detalhe: check.detalhe };
}

/** Nomes no espelho: apply deve recusar mesmo se o payload omitiu campanha_destino_nome. */
async function nomesDestinoEspelhoCohapm(opts: {
  companyId: string;
  campanhaExternalId?: string;
  conjuntoExternalId?: string;
}): Promise<{ campanha: string; conjunto: string }> {
  let campanha = "";
  let conjunto = "";
  if (opts.conjuntoExternalId) {
    const { data } = await supa
      .from("ad_sets")
      .select("name,campaign_id")
      .eq("company_id", opts.companyId)
      .eq("external_id", opts.conjuntoExternalId)
      .maybeSingle();
    conjunto = String((data as { name?: string } | null)?.name ?? "");
    const campId = (data as { campaign_id?: string } | null)?.campaign_id;
    if (campId) {
      const { data: camp } = await supa.from("campaigns").select("name").eq("id", campId).maybeSingle();
      campanha = String((camp as { name?: string } | null)?.name ?? "");
    }
  }
  if (!campanha && opts.campanhaExternalId) {
    const { data: camp } = await supa
      .from("campaigns")
      .select("name")
      .eq("company_id", opts.companyId)
      .eq("external_id", opts.campanhaExternalId)
      .maybeSingle();
    campanha = String((camp as { name?: string } | null)?.name ?? "");
  }
  return { campanha, conjunto };
}

// v2: monta o corpo de criacao lendo o molde quando necessario. Retorna o path de colecao,
// o body do POST e, opcionalmente, um passo previo (criacao de adcreative).
// v5.1: exportada para que as recusas nomeadas sejam verificaveis fora de uma execucao real. Sem
// isso, a unica forma de provar que carrossel recusa era emitir um card de verdade - caro demais
// para uma prova que precisa ser repetida a cada mudanca de contrato.
export async function montarCriacao(
  acao: string,
  p: any,
  conta: string,
  tetoSanidade: number,
  companyId: string | null = null,
) {
  if (acao === "criar_campanha") {
    const nome = String(p?.nome_novo ?? p?.nome ?? p?.name ?? "").trim();
    if (!nome) return { erro: "payload sem nome_novo (nome livre obrigatorio)" };

    // Nome livre e a fonte da verdade. nome_partes e metadado opcional (nao bloqueia).
    const partes = (p?.nome_partes ?? null) as Record<string, unknown> | null;
    const nomePartesGravar =
      partes && typeof partes === "object" ? partes : null;

    // ============ v5.5: REGIME DE ORCAMENTO DECLARADO; ABO REAL PELO PIPEBOARD ============
    // O gestor decide o regime no pedido (regime_orcamento). Hoje o UNICO regime suportado e ABO -
    // orcamento vive em cada CONJUNTO, a campanha fica SEM orcamento -, que e o desenho de todo o
    // sistema: o gate campanha_usa_orcamento_proprio_cbo existe justamente para manter conjunto
    // fora de campanha CBO. Ausente = 'abo' (o default historico e a decisao do gestor). Valor
    // diferente de 'abo' RECUSA por nome; o contrato (contrato_de_execucao.valores_aceitos=['abo'])
    // recusa o MESMO conjunto no validador, para nunca haver validador=aceita com executor=recusa.
    const regime = (String(p?.regime_orcamento ?? "").trim().toLowerCase() || "abo");
    if (regime !== "abo") {
      return {
        erro: "regime_orcamento_nao_suportado",
        detalhe:
          `O pedido declara regime_orcamento="${regime}", e este sistema so cria campanha em ABO (orcamento no conjunto, campanha sem orcamento). CBO — orcamento na campanha — nao e suportado: o conjunto so entra em campanha sem orcamento proprio (e o que o gate campanha_usa_orcamento_proprio_cbo garante), entao criar a campanha ja com orcamento fecharia o caminho do conjunto. Peca a campanha em ABO (ou omita o regime, que ja assume ABO).`,
      };
    }

    // ABO de verdade: use_adset_level_budgets=true e a chave. Sem ele, o Pipeboard injeta
    // daily_budget=1000 (provado por teste descartavel controlado em 07/08/2026). Nenhum orcamento
    // de campanha e enviado. O flag e do CONECTOR; escreverCriacao o remove antes de um POST Graph.
    const resolvidoObj = resolverObjetivoOdax({
      objetivo: p?.objetivo,
      objetivo_tag: (p?.nome_partes as any)?.objetivo_tag ?? p?.objetivo_tag,
    });
    if (!resolvidoObj.ok) {
      return mensagemObjetivoNaoSuportado(resolvidoObj.bruto);
    }
    const objetivo = resolvidoObj.objetivo;
    const ehCredito = empresaEhCredito(companyId);
    const catsPayload = Array.isArray(p?.special_ad_categories)
      ? (p.special_ad_categories as unknown[]).map((x) => String(x).trim()).filter(Boolean)
      : null;
    // Legal: FINANCIAL obrigatorio. COHAPM/nao-credito: [] salvo pedido explicito no card.
    const catsEspeciais = catsPayload != null
      ? catsPayload
      : (ehCredito ? ["FINANCIAL_PRODUCTS_SERVICES"] : []);
    return {
      path: `/${conta}/campaigns`,
      body: {
        name: nome,
        objective: objetivo,
        status: "ACTIVE", // v5.26: aprovar criar_campanha = cria ACTIVE
        special_ad_categories: JSON.stringify(catsEspeciais),
        buying_type: "AUCTION",
        is_adset_budget_sharing_enabled: "false", // v4: exigido pela Meta em ABO; false = sem compartilhamento de orcamento entre conjuntos
        use_adset_level_budgets: "true", // v5.5: ABO real — impede o Pipeboard de injetar orcamento de campanha (CBO)
      } as Record<string, string>,
      regime_orcamento: "abo",
      nome_partes: nomePartesGravar,
      familia_objetivo: familiaDeObjetivo(objetivo),
      special_ad_categories: catsEspeciais,
    };
  }

  if (acao === "criar_conjunto_a_partir_de" || acao === "escalar_duplicar") {
    const moldeRaw = String(p?.molde_external_id ?? "").trim();
    const semMoldeConj =
      acao === "criar_conjunto_a_partir_de" &&
      (ehFlagSemMolde(p?.sem_molde) || ehSentinelaSemMolde(moldeRaw));
    const molde = semMoldeConj ? "" : moldeRaw;
    const campanha = String(p?.campanha_destino_external_id ?? "");
    const nome = String(p?.nome_novo ?? "").trim();
    let reais = Number(p?.orcamento_diario_reais ?? 0);
    if (!campanha || !nome)
      return {
        erro: "payload incompleto (campanha_destino_external_id, nome_novo)",
      };
    if (companyId && companyId === COMPANY_COHAPM) {
      const espelho = await nomesDestinoEspelhoCohapm({
        companyId,
        campanhaExternalId: campanha,
      });
      const cruz = recusarCruzamentoLinhaProduto({
        estruturaNomes: [p?.campanha_destino_nome, p?.campanha_destino, espelho.campanha],
        pecaSinais: [nome, p?.meio, p?.produto, p?.molde_nome],
      });
      if (!cruz.ok) return { erro: cruz.erro, detalhe: cruz.detalhe };
    }
    if (!semMoldeConj && !molde)
      return {
        erro: "payload incompleto (molde_external_id, campanha_destino_external_id, nome_novo)",
        detalhe:
          "Informe o conjunto molde (empresta targeting) OU sem_molde=true / molde_external_id=sem_molde para criar do zero.",
      };
    if (!(reais > 0)) return { erro: "orcamento_diario_reais ausente ou invalido" };
    const checkOrc = conferirOrcamentoReais({
      reais,
      confirmadoReais: ehFlagOrcamentoConfirmadoReais(p?.orcamento_confirmado_reais),
    });
    if (!checkOrc.ok) return { erro: checkOrc.erro, detalhe: checkOrc.detalhe };
    reais = checkOrc.reais;

    // Nome livre e a fonte da verdade. nome_partes e metadado opcional.
    let nomeFinal = nome;
    let nomePartesGravar: Record<string, unknown> | null = null;
    if (acao === "criar_conjunto_a_partir_de") {
      const partes = (p?.nome_partes ?? null) as Record<string, unknown> | null;
      if (partes && typeof partes === "object") {
        nomePartesGravar = partes;
      }
      // Mantem nome_novo livre; nao exige alinhamento com composto.
      nomeFinal = nome;
    }
    // ESP-26: o juiz e a RPC, nao a comparacao local. Sem companyId nao ha como consultar.
    if (!companyId) {
      return {
        erro: "avaliacao_de_orcamento_indisponivel",
        detalhe: "company_id ausente no pedido de criacao de conjunto — sem ele nao consulto avaliar_orcamento_diario.",
      };
    }
    // ESP-25: escala revalida aptidao na execucao (fail-closed se ajanela mudou).
    // ESP-39: destino nao pode ser campanha TESTE.
    if (acao === "escalar_duplicar") {
      const { data: aval, error: avalErr } = await supa.rpc("avaliar_escala", {
        p_company_id: companyId,
        p_adset_external_id: molde,
      });
      if (avalErr) {
        return {
          erro: "avaliacao_de_escala_indisponivel",
          detalhe: `Nao revalidei avaliar_escala na execucao (${avalErr.message}). Sem aptidao atual, NAO crio a copia.`,
        };
      }
      if (aval?.apto_a_escalar !== true) {
        return {
          erro: "conjunto_deixou_de_estar_apto_a_escalar",
          detalhe: String(aval?.porque_nao ?? "avaliar_escala recusou na revalidacao da fila."),
          avaliacao_escala: aval,
        };
      }
      const proposto = Number(aval?.medidas?.orcamento_proposto_dia ?? 0);
      if (!(proposto > 0) || Math.abs(proposto - reais) > 0.05) {
        return {
          erro: "orcamento_de_escala_divergiu_da_escada",
          detalhe: `Pedido R$ ${reais} vs escada atual R$ ${proposto}. Escala nao aceita orcamento livre — emita card novo.`,
          avaliacao_escala: aval,
        };
      }

      const nomeDestPayload = String(p?.campanha_destino_nome ?? "").trim();
      let nomeDest = nomeDestPayload;
      if (!nomeDest) {
        const campMeta = await g(`/${campanha}?fields=name`);
        if (campMeta.status === 200) {
          nomeDest = String((campMeta.body as any)?.name ?? "").trim();
        }
      }
      const papelDest = classificarPapelCampanha(nomeDest || String(p?.campanha_destino_papel ?? ""));
      const papelPayload = String(p?.campanha_destino_papel ?? "").trim().toLowerCase();
      if (papelDest === "teste" || papelPayload === "teste") {
        return {
          erro: "escala_nao_vai_em_campanha_teste",
          detalhe:
            `ESP-39: campanha destino "${nomeDest || campanha}" e TESTE. Escala/vencedores ficam em campanha ESCALA separada. Emita card com campanha_destino ESCALA.`,
          papel_destino: papelDest || papelPayload,
        };
      }
      const papelOrig = String(p?.campanha_origem_papel ?? "").trim().toLowerCase()
        || classificarPapelCampanha(String(p?.campanha_origem_nome ?? ""));
      const mesmaCampanha =
        String(p?.campanha_origem_external_id ?? "") === campanha
        || String(p?.campanha_origem_nome ?? "") === nomeDest;
      if (papelOrig === "teste" && (!nomeDest || mesmaCampanha || papelDest !== "escala")) {
        return {
          erro: "escala_exige_campanha_escala",
          detalhe:
            "ESP-39: origem TESTE exige destino ESCALA explicito (campanha_destino). Nao crio a copia na mesma campanha de teste.",
          papel_origem: papelOrig,
          papel_destino: papelDest,
        };
      }
    }
    {
      const julgado = await julgarOrcamentoDiario(supa, companyId, reais, 1);
      if (!julgado.ok) {
        return { erro: julgado.motivo, detalhe: julgado.detalhe, avaliacao_orcamento: julgado.avaliacao };
      }
    }

    // ============ v5.4: ORCAMENTO DA CAMPANHA PAI, ANTES DE ESCREVER ============
    // Mesmo padrao do gate de Dynamic Creative da v5.2: le o estado do objeto PAI e recusa por
    // nome, em vez de descobrir pelo texto de erro da plataforma depois de gastar a aprovacao.
    // EVIDENCIA (07/08/2026, card b5e2f338): create_adset com daily_budget foi recusado porque a
    // campanha 120254323578040191 tem daily_budget proprio (CBO) - e ela tem esse orcamento sem
    // que ninguem o tenha pedido, porque o conector Pipeboard o injetou na criacao. Enquanto essa
    // injecao existir, campanha criada pelo sistema pode nascer CBO, e este gate e o que impede o
    // conjunto de morrer na Meta depois da aprovacao do gestor.
    // A leitura vem da Graph com o token proprio (nao do espelho): o espelho pode estar velho, e
    // aqui estamos a um passo da escrita. Falha de leitura RECUSA - nao ha default seguro entre
    // "a campanha manda no dinheiro" e "o conjunto manda no dinheiro".
    const orc = await g(`/${campanha}?fields=daily_budget,lifetime_budget`);
    if (orc.status !== 200) {
      return {
        erro: "falha_ao_verificar_campanha_destino",
        detalhe:
          "Nao consegui ler o orcamento da campanha de destino, e sem isso nao da para saber se definir R$/dia neste conjunto vai conflitar com a campanha. Nao vou criar o conjunto sem essa confirmacao: se a campanha tiver orcamento proprio, a Meta recusa a criacao e a aprovacao do gestor e gasta a toa. Tente de novo quando a consulta a campanha estiver disponivel.",
      };
    }
    const ob: any = orc.body ?? {};
    const cbo = Number(ob.daily_budget ?? 0) > 0 || Number(ob.lifetime_budget ?? 0) > 0;
    if (cbo) {
      return {
        erro: "campanha_usa_orcamento_proprio_cbo",
        // A saida "peca o conjunto SEM orcamento" saiu daqui de proposito: ela nao existe. O
        // contrato torna orcamento_diario_reais obrigatorio e este mesmo bloco recusa reais <= 0
        // logo acima, entao o gestor que seguisse o conselho bateria numa segunda recusa.
        detalhe:
          "Nao criei o conjunto porque a campanha de destino ja tem orcamento PROPRIO (Otimizacao de Orcamento de Campanha, o CBO), e a Meta nao aceita orcamento na campanha e no conjunto ao mesmo tempo. Ou o dinheiro vive na CAMPANHA e ela distribui entre os conjuntos, ou vive em CADA CONJUNTO e a campanha fica sem. Para seguir: escolha uma campanha de destino SEM orcamento proprio, e ai o R$/dia deste conjunto vale. Criar conjunto SEM orcamento, herdando o da campanha, ainda NAO e suportado por este sistema - o orcamento diario e obrigatorio no pedido -, entao nao adianta pedir assim.",
        campanha_orcamento_centavos: Number(ob.daily_budget ?? 0) || Number(ob.lifetime_budget ?? 0),
      };
    }

    // Resolve familia cedo (payload → tag → objective da campanha).
    // v5.35: mensagens (CTWA) distinta de engajamento social.
    let familiaPayload = String(p?.familia_objetivo ?? "").trim().toLowerCase();
    const tagPartes = String((p?.nome_partes as any)?.objetivo_tag ?? p?.objetivo_tag ?? "").trim();
    const pedidoTrafegoWeb = ehPedidoTrafegoWebsite({
      optimization_goal: p?.optimization_goal,
      destination_type: p?.destination_type,
      familia_objetivo: p?.familia_objetivo,
      objetivo: p?.objetivo,
    });
    const pedidoMensagensExec = ehPedidoMensagens({
      optimization_goal: p?.optimization_goal,
      destination_type: p?.destination_type,
      familia_objetivo: p?.familia_objetivo,
      objetivo_tag: tagPartes,
      objetivo: p?.objetivo,
      nome: `${p?.campanha_destino_nome ?? ""} ${p?.nome_novo ?? ""} ${nomeFinal}`,
    });
    if (pedidoTrafegoWeb) {
      familiaPayload = "trafego";
    } else if (pedidoMensagensExec) {
      familiaPayload = "mensagens";
    } else if (!familiaPayload || familiaPayload === "conversao") {
      if (ehFamiliaSocialTopo(tagPartes) || ehFamiliaSocialTopo(p?.objetivo)) {
        familiaPayload = familiaDeObjetivo(p?.objetivo ?? tagPartes);
      }
    }
    if ((!familiaPayload || familiaPayload === "conversao") && !pedidoMensagensExec) {
      const campObj = await g(`/${campanha}?fields=objective,name`);
      if (campObj.status === 200) {
        const objCamp = String((campObj.body as any)?.objective ?? "");
        const nomeCamp = String((campObj.body as any)?.name ?? "");
        if (ehPedidoTrafegoWebsite({
          optimization_goal: p?.optimization_goal,
          destination_type: p?.destination_type,
          familia_objetivo: p?.familia_objetivo,
          objetivo: p?.objetivo,
        })) {
          familiaPayload = "trafego";
        } else if (
          ehPedidoMensagens({
            optimization_goal: p?.optimization_goal,
            destination_type: p?.destination_type,
            familia_objetivo: p?.familia_objetivo,
            objetivo_tag: tagPartes,
            objetivo: p?.objetivo,
            nome: `${nomeCamp} ${p?.nome_novo ?? ""}`,
          })
        ) {
          familiaPayload = "mensagens";
        } else if (ehFamiliaSocialTopo(objCamp)) {
          familiaPayload = familiaDeObjetivo(objCamp);
        }
      }
    }
    const socialTopo =
      familiaPayload === "engajamento" || familiaPayload === "reconhecimento";
    const mensagensTopo = familiaPayload === "mensagens";
    const trafegoTopo = familiaPayload === "trafego";

    let mb: any = {};
    if (!semMoldeConj) {
      const campos = [
        "optimization_goal",
        "billing_event",
        "bid_strategy",
        "targeting",
        "promoted_object",
        "destination_type",
        "attribution_spec",
        "bid_amount",
        "dsa_beneficiary",
        "dsa_payor",
      ].join(",");
      const m = await g(`/${molde}?fields=${campos}`);
      if (m.status !== 200) return { erro: "falha ao ler o conjunto molde na Meta", detalhe: m.body };
      mb = m.body ?? {};
    }

    const body: Record<string, string> = {
      name: nomeFinal,
      campaign_id: campanha,
      daily_budget: String(Math.round(reais * 100)), // centavos
      status: "ACTIVE", // v5.26: aprovar criar_conjunto / escalar_duplicar = cria ACTIVE
    };

    if (semMoldeConj) {
      body.bid_strategy = "LOWEST_COST_WITHOUT_CAP";
      body.targeting = JSON.stringify(targetingPadraoSocialTopo());
    } else {
      // Replica apenas o que o molde realmente tem - nada e inventado.
      if (mb.optimization_goal) body.optimization_goal = String(mb.optimization_goal);
      if (mb.billing_event) body.billing_event = String(mb.billing_event);
      if (mb.bid_strategy) body.bid_strategy = String(mb.bid_strategy);
      if (mb.destination_type) body.destination_type = String(mb.destination_type);
      if (mb.bid_amount) body.bid_amount = String(mb.bid_amount);
      if (mb.targeting) body.targeting = JSON.stringify(mb.targeting);
      if (mb.promoted_object) body.promoted_object = JSON.stringify(mb.promoted_object);
      if (mb.attribution_spec) body.attribution_spec = JSON.stringify(mb.attribution_spec);
      if (mb.dsa_beneficiary) body.dsa_beneficiary = String(mb.dsa_beneficiary);
      if (mb.dsa_payor) body.dsa_payor = String(mb.dsa_payor);
    }

    // ESP-25: escala herda targeting do molde (so remove Threads se presente). Sem redes livres.
    let posicionamento: Record<string, unknown>;
    if (acao === "escalar_duplicar") {
      if (mb.targeting && typeof mb.targeting === "object") {
        const t = { ...(mb.targeting as Record<string, unknown>) };
        delete t.threads_positions;
        if (Array.isArray(t.publisher_platforms)) {
          t.publisher_platforms = (t.publisher_platforms as unknown[])
            .map(String)
            .filter((pl) => pl !== "threads");
        }
        body.targeting = JSON.stringify(t);
      }
      posicionamento = {
        herdar_targeting_do_molde: true,
        threads_removido_se_presente: true,
        declaracao:
          "Escala por duplicacao: targeting copiado do molde (Threads removido se havia). Redes nao sao pedidas de novo — o passo e so +20% de orcamento em copia PAUSED.",
      };
    } else {
    // ===== v5.15: PLATAFORMAS PEDIDAS + VIDEO SEM COLUNA + THREADS OFF (Ryan 11/08) =====
    const formatoPrevisto = String(p?.formato_midia_previsto ?? "").trim().toLowerCase();
    const plataformasPedidas = p?.plataformas_publicacao ?? p?.publisher_platforms ?? null;
    // v5.38: mensagens/CTWA — base limpa (nao herda idade/A+/LAL do molde LF).
    // Molde so servia para targeting; no Juridico isso puxava age_max+Advantage+ e Meta 1870188.
    const baseTargeting = (() => {
      if (semMoldeConj || mensagensTopo) return targetingPadraoSocialTopo();
      if (mb.targeting && typeof mb.targeting === "object") {
        return mb.targeting as Record<string, unknown>;
      }
      return {};
    })();

    if (plataformasPedidas != null) {
      const derivado = aplicarPosicionamentoPorPlataformas(
        baseTargeting,
        formatoPrevisto || "desconhecido",
        plataformasPedidas,
      );
      if (derivado.erro || !derivado.targeting) {
        return {
          erro: derivado.erro ?? "posicionamento_por_plataformas_nao_derivado",
          detalhe: derivado.detalhe ?? null,
        };
      }
      body.targeting = JSON.stringify(derivado.targeting);
      posicionamento = {
        formato_midia_previsto: formatoPrevisto || null,
        padrao_aplicado: true,
        sem_molde: semMoldeConj,
        plataformas_publicacao: derivado.plataformas,
        excluidos: derivado.excluidos,
        perfil: derivado.perfil,
        declaracao: derivado.declaracao,
        facebook_positions: derivado.targeting.facebook_positions ?? null,
        publisher_platforms: derivado.targeting.publisher_platforms ?? null,
      };
    } else if (formatoPrevisto === "video") {
      const { targeting, excluidos } = aplicarPadraoPosicionamentoVideo(baseTargeting);
      body.targeting = JSON.stringify(targeting);
      posicionamento = {
        formato_midia_previsto: "video",
        padrao_aplicado: true,
        sem_molde: semMoldeConj,
        origem_padrao: "3_conjuntos_video_active_observados_11_08",
        publisher_platforms: [...PUBLISHER_PLATFORMS_VIDEO_PADRAO],
        facebook_positions: [...FACEBOOK_POSITIONS_VIDEO_PADRAO],
        excluidos: [...excluidos, "threads"],
        declaracao:
          "Conjunto de video: posicionamentos manuais aplicados conforme padrao observado nos 3 conjuntos ativos; Coluna da direita excluida; Threads desabilitado (empresa sem cadastro). Prefira declarar plataformas_publicacao explicitamente.",
      };
    } else if (formatoPrevisto === "imagem") {
      const t = { ...baseTargeting };
      delete t.threads_positions;
      if (Array.isArray(t.publisher_platforms)) {
        t.publisher_platforms = (t.publisher_platforms as unknown[])
          .map(String)
          .filter((pl) => pl !== "threads");
      }
      body.targeting = JSON.stringify(t);
      posicionamento = {
        formato_midia_previsto: "imagem",
        padrao_aplicado: false,
        sem_molde: semMoldeConj,
        nota: "Imagem: Coluna da direita elegivel. Threads removido se presente. Declare plataformas_publicacao para fixar as redes.",
      };
    } else {
      return {
        erro: "plataformas_de_publicacao_obrigatorias",
        detalhe:
          "Antes de criar o conjunto, declare plataformas_publicacao (facebook, instagram, …). Threads esta desabilitado. Tambem declare formato_midia_previsto quando Facebook fizer parte da escolha.",
      };
    }
    } // fim else criar_conjunto (plataformas)

    let ctwaCandidatos: CandidatoPromotedCtwa[] = [];

    // v5.43: trafego WEBSITE (wa.me no criativo) distinto de CTWA/mensagens.
    // v5.28/v5.29/v5.35: familia engajamento/reconhecimento/mensagens — molde so empresta targeting.
    // Campanha OUTCOME_ENGAGEMENT + mensagens → CONVERSATIONS+WHATSAPP (CTWA), NAO POST+ON_POST.
    if (mensagensTopo || socialTopo || trafegoTopo) {
      let pageId = String(p?.page_id ?? "").trim();
      if (!pageId && companyId) {
        const { data: cfgPage } = await supa
          .from("meta_execution_config")
          .select("page_id")
          .eq("company_id", companyId)
          .maybeSingle();
        pageId = String((cfgPage as any)?.page_id ?? "").trim();
      }
      const defs = trafegoTopo
        ? defaultsConjuntoTrafegoWebsite({
          destination_type: p?.destination_type,
          optimization_goal: p?.optimization_goal,
        })
        : mensagensTopo
        ? defaultsConjuntoMensagens(pageId, {
          whatsapp_phone_number: p?.whatsapp_phone_number,
          whats_app_business_phone_number_id: p?.whats_app_business_phone_number_id,
          destination_type: p?.destination_type,
          optimization_goal: p?.optimization_goal,
        })
        : defaultsConjuntoSocialTopo(
          familiaPayload as "engajamento" | "reconhecimento",
          pageId,
          p?.optimization_goal,
        );
      if ("erro" in defs) {
        return { erro: defs.erro, detalhe: defs.detalhe };
      }
      body.optimization_goal = defs.optimization_goal;
      body.billing_event = defs.billing_event;
      if (trafegoTopo) {
        delete body.promoted_object;
        delete body.attribution_spec;
      } else {
        body.promoted_object = JSON.stringify(defs.promoted_object);
        delete body.attribution_spec;
      }
      if (mensagensTopo && pageId) {
        const pedidoWa = p?.whatsapp_phone_number ?? defs.promoted_object?.whatsapp_phone_number;
        const phoneIdPedido = p?.whats_app_business_phone_number_id;
        if (TOKEN && companyId) {
          const wabaTok = tokenWabaPorCompanyId(companyId);
          const resolvido = await resolverWhatsAppCtwa({
            gAds: criarGraphClient(TOKEN),
            gWaba: wabaTok ? criarGraphClient(wabaTok.token) : null,
            pageId,
            companyId,
            businessId: businessIdPorCompanyId(companyId),
            pedido: pedidoWa,
            phoneIdPedido,
            supa,
          });
          body.promoted_object = JSON.stringify(resolvido.promoted);
          ctwaCandidatos = resolvido.candidatos;
          posicionamento = {
            ...(posicionamento && typeof posicionamento === "object" ? posicionamento : {}),
            whatsapp_resolucao: {
              digitos: resolvido.promoted.whatsapp_phone_number,
              phone_number_id: resolvido.promoted.whats_app_business_phone_number_id ?? null,
              casou_na_api: !!resolvido.match,
              candidatos: resolvido.candidatos.length,
              aviso: resolvido.aviso,
              destino: resolvido.candidatos[0]?.destination_type ?? defs.destination_type,
            },
          };
        }
        if (!ctwaCandidatos.length) {
          ctwaCandidatos = candidatosPromotedObjectCtwa({
            pageId,
            pedido: pedidoWa,
            phoneIdPedido,
            match: null,
          });
          if (ctwaCandidatos[0]) {
            body.promoted_object = JSON.stringify(ctwaCandidatos[0].promoted);
          }
        }
      }
      if (defs.destination_type) {
        body.destination_type = defs.destination_type;
      } else {
        delete body.destination_type;
      }
      if (mensagensTopo && ctwaCandidatos[0]?.destination_type) {
        body.destination_type = ctwaCandidatos[0].destination_type;
      }
      // v5.36: molde LF CONV pode trazer LOWEST_COST_WITH_BID_CAP / COST_CAP sem bid_amount
      // (ou bid_amount que a Graph nao devolve na leitura). Meta 2490487. Padrao da casa:
      // custo mais baixo sem teto — sem bid_amount.
      const bidPedido = String(p?.bid_strategy ?? "").trim().toUpperCase();
      const bidAmountPedido = p?.bid_amount != null && String(p.bid_amount).trim() !== ""
        ? String(p.bid_amount).trim()
        : "";
      const precisaTeto = bidPedido === "LOWEST_COST_WITH_BID_CAP" || bidPedido === "COST_CAP";
      if (precisaTeto && bidAmountPedido) {
        body.bid_strategy = bidPedido;
        body.bid_amount = bidAmountPedido;
      } else {
        body.bid_strategy = "LOWEST_COST_WITHOUT_CAP";
        delete body.bid_amount;
      }
      if (semMoldeConj && !body.targeting) {
        body.targeting = JSON.stringify(targetingPadraoSocialTopo());
      }
      posicionamento = {
        ...(posicionamento && typeof posicionamento === "object" ? posicionamento : {}),
        familia_objetivo: familiaPayload,
        override_social_topo: socialTopo,
        override_mensagens: mensagensTopo,
        override_trafego_website: trafegoTopo,
        sem_molde: semMoldeConj,
        optimization_goal: defs.optimization_goal,
        billing_event: defs.billing_event,
        destination_type: defs.destination_type,
        bid_strategy: body.bid_strategy,
        page_id: pageId,
        declaracao_social: trafegoTopo
          ? `Conjunto trafego WEBSITE: optimization_goal=${defs.optimization_goal}; destination_type=${defs.destination_type}; bid=${body.bid_strategy}. Link (wa.me) vai no criativo, nao no conjunto.`
          : mensagensTopo
          ? (semMoldeConj
            ? `Conjunto mensagens SEM MOLDE: CONVERSATIONS + WHATSAPP + page_id=${pageId}; bid=${body.bid_strategy}.`
            : `Conjunto mensagens: molde so emprestou targeting; CONVERSATIONS + WHATSAPP + page_id=${pageId}; bid=${body.bid_strategy} (teto do molde descartado se sem valor).`)
          : semMoldeConj
          ? `Conjunto ${familiaPayload} SEM MOLDE: targeting BR Advantage+ minimo; optimization_goal=${defs.optimization_goal}; destination_type=${defs.destination_type ?? "null"}; bid=${body.bid_strategy}; promoted_object.page_id=${pageId}.`
          : `Conjunto ${familiaPayload}: molde so emprestou targeting; optimization_goal=${defs.optimization_goal}, destination_type=${defs.destination_type ?? "null"}, bid=${body.bid_strategy}, promoted_object.page_id=${pageId} (pixel/LEAD do molde descartados).`,
      };
    }

    // v5.33/v5.34: geo/bairros do card; Jurídico COHAPM aplica preset Salvador–BA.
    // So em criar_conjunto — escala continua herdando targeting do molde sem override livre.
    if (acao === "criar_conjunto_a_partir_de") {
      const geoNorm = normalizarGeoDoPedido({
        geo_locations: p?.geo_locations,
        bairros: p?.bairros,
        neighborhoods: p?.neighborhoods,
      } as Record<string, unknown>);
      if (geoNorm.erro) {
        return { erro: geoNorm.erro, detalhe: geoNorm.detalhe };
      }
      const tokGeo = companyId ? tokenAdsPorCompanyId(companyId) : null;
      const gateGeo = companyId
        ? await aplicarGateGeoCriarConjunto({
          companyId,
          params: (p ?? {}) as Record<string, unknown>,
          sinaisMeio: [
            String(p?.campanha_destino_nome ?? ""),
            String(p?.nome_novo ?? ""),
            String(p?.molde_nome ?? ""),
            String(p?.meio ?? ""),
            String(body?.name ?? ""),
          ],
          geoNorm,
          supa,
          tokenAds: tokGeo?.token ?? null,
        })
        : { meio: null, aplica_preset: false, geo: geoNorm.geo, resumo: geoNorm.resumo, contagem: geoNorm.contagem };
      if ((gateGeo as any).erro) {
        return {
          erro: (gateGeo as any).erro,
          detalhe: (gateGeo as any).detalhe,
          meio: (gateGeo as any).meio,
        };
      }
      const geoEfetivo = (gateGeo as any).geo as Record<string, unknown> | undefined;
      if (geoEfetivo) {
        if (companyId) {
          const { data: seg } = await supa.rpc("checar_segmentacao", {
            p_company_id: companyId,
            p_targeting: { geo_locations: geoEfetivo },
          });
          if (seg && typeof seg === "object" && (seg as any).aplica === true && (seg as any).permitido === false) {
            return {
              erro: "segmentacao_recusada_pelo_gate",
              detalhe: String((seg as any).mensagem_para_o_gestor ?? (seg as any).motivo ?? "checar_segmentacao recusou o geo."),
              segmentacao: seg,
            };
          }
        }
        let tgtAtual: Record<string, unknown> = {};
        try {
          tgtAtual = body.targeting ? JSON.parse(String(body.targeting)) : {};
        } catch {
          tgtAtual = {};
        }
        if (!tgtAtual || typeof tgtAtual !== "object") tgtAtual = {};
        const tgtNovo = aplicarGeoNoTargeting(tgtAtual, geoEfetivo);
        body.targeting = JSON.stringify(tgtNovo);
        posicionamento = {
          ...(posicionamento && typeof posicionamento === "object" ? posicionamento : {}),
          geo_locations_override: true,
          geo_resumo: (gateGeo as any).resumo ?? null,
          geo_contagem: (gateGeo as any).contagem ?? null,
          geo_preset_juridico: (gateGeo as any).aplica_preset === true,
          geo_default_aplicado: (gateGeo as any).default_aplicado === true,
          meio: (gateGeo as any).meio ?? null,
        };
      }
    }

    // v5.36–v5.38: sanitize lance + targeting antes de enviar.
    const bidStrat = String(body.bid_strategy ?? "").trim().toUpperCase();
    const bidAmt = String(body.bid_amount ?? "").trim();
    const exigeValor =
      bidStrat === "LOWEST_COST_WITH_BID_CAP" ||
      bidStrat === "COST_CAP" ||
      bidStrat === "LOWEST_COST_WITH_MIN_ROAS";
    if (!bidStrat || (exigeValor && !bidAmt)) {
      body.bid_strategy = "LOWEST_COST_WITHOUT_CAP";
      delete body.bid_amount;
      if (posicionamento && typeof posicionamento === "object") {
        (posicionamento as any).bid_strategy_sanitizado = "LOWEST_COST_WITHOUT_CAP";
        (posicionamento as any).bid_motivo =
          !bidStrat
            ? "bid_strategy ausente — default sem teto"
            : `molde/pedido tinha ${bidStrat} sem bid_amount — convertido para LOWEST_COST_WITHOUT_CAP`;
      }
    }

    if (body.targeting) {
      try {
        const tgt = JSON.parse(String(body.targeting));
        if (tgt && typeof tgt === "object") {
          const limpo = sanitizarTargetingCreateAdset(tgt as Record<string, unknown>);
          body.targeting = JSON.stringify(limpo.targeting);
          if (limpo.ajustes.length && posicionamento && typeof posicionamento === "object") {
            (posicionamento as any).targeting_sanitizado = limpo.ajustes;
          }
        }
      } catch {
        /* targeting invalido — Graph vai recusar com outro erro */
      }
    }

    return {
      path: `/${conta}/adsets`,
      body,
      molde_lido: semMoldeConj ? { sem_molde: true } : mb,
      posicionamento,
      nome_partes: nomePartesGravar,
      ctwa_candidatos: ctwaCandidatos,
    };
  }

  if (acao === "criar_anuncio_a_partir_de") {
    const creativeMolde = String(p?.creative_id ?? "").trim();
    const adset = String(p?.conjunto_destino_external_id ?? "");
    let nome = String(p?.nome_novo ?? "").trim();
    const urlTags = String(p?.url_tags ?? "").trim();
    const videoNovo = String(p?.meta_video_id ?? "").trim(); // v4.4: peca nova video
    const imagemNova = String(p?.meta_image_hash ?? "").trim(); // v5.9: peca nova imagem
    const legendaNova = String(p?.legenda ?? "").trim();
    // v5.24: carrossel via child_attachments (2-10 image_hash)
    const temPedidoCarrossel = campoPresente(p?.child_attachments);
    // ESP-35: peca nova (video|imagem|carrossel) pode nascer SEM creative_id quando page/CTA/URL
    // vierem no payload ou na config da empresa. Replicacao pura continua exigindo molde.
    const pecaNovaSemMolde = !creativeMolde && !!(videoNovo || imagemNova || temPedidoCarrossel);
    if (!adset || !nome)
      return { erro: "payload incompleto (conjunto_destino_external_id, nome_novo)" };
    if (companyId && companyId === COMPANY_COHAPM) {
      const espelhoAd = await nomesDestinoEspelhoCohapm({
        companyId,
        conjuntoExternalId: adset,
        campanhaExternalId: String(p?.campanha_destino_external_id ?? "").trim() || undefined,
      });
      const cruzAd = recusarCruzamentoLinhaProduto({
        estruturaNomes: [
          p?.campanha_destino_nome,
          p?.conjunto_destino_nome,
          p?.campanha_destino,
          espelhoAd.campanha,
          espelhoAd.conjunto,
        ],
        pecaSinais: [nome, p?.drive_file_id, p?.legenda, p?.meio, p?.produto, p?.pasta],
      });
      if (!cruzAd.ok) return { erro: cruzAd.erro, detalhe: cruzAd.detalhe };
      const nPed = Number(p?.conjunto_pedido_numero);
      const cruzNum = recusarConjuntoErrado({
        pedidoNumero: Number.isFinite(nPed) && nPed >= 1 ? nPed : null,
        destNome: espelhoAd.conjunto ?? p?.conjunto_destino_nome,
        pecaSinais: [nome, p?.drive_file_id, p?.legenda, p?.meio, p?.produto, p?.pasta],
      });
      if (!cruzNum.ok) return { erro: cruzNum.erro, detalhe: cruzNum.detalhe };
    }
    if (!creativeMolde && !pecaNovaSemMolde)
      return { erro: "payload incompleto (creative_id, conjunto_destino_external_id, nome_novo)" };

    // v5.46: nome_novo do payload e a fonte da verdade — nunca sobrescrever por composto.
    nome = String(p?.nome_novo ?? p?.nome ?? p?.name ?? nome).trim();
    const casoDestino = String((p as any)?.destino_do_anuncio?.caso ?? "");
    const ehTrafegoExec =
      casoDestino === "trafego_website" ||
      /TRAFFIC|WEBSITE|LANDING_PAGE/i.test(
        `${p?.objetivo_campanha_destino ?? ""} ${p?.destination_type ?? ""} ${p?.optimization_goal ?? ""}`,
      );
    if (ehTrafegoExec && nomeCompostoForaDeEscopoTrafego(nome)) {
      return {
        erro: "nome_fora_do_escopo_trafego",
        detalhe:
          `O payload pede '${nome}', mas o conjunto/campanha e trafego WEBSITE/LPV. ` +
          "Nao gravo [WA][LEADS] nesse objeto. Use o nome livre do contrato.",
      };
    }
    if (ehNomeCompostoEstruturado(nome) && String(p?.nome_contrato ?? "").trim()) {
      nome = String(p.nome_contrato).trim();
    }

    // Nome livre e a fonte da verdade. nome_partes e metadado opcional (nao bloqueia).
    // Usa o nome_novo do payload sem exigir alinhamento ao composto.

    // ============ v5.24: FORMATOS ============
    // Carrossel HABILITADO (child_attachments). Video/imagem/carrossel sao mutuamente exclusivos.
    if (videoNovo && (imagemNova || temPedidoCarrossel)) {
      return {
        erro: "formatos_de_midia_conflitantes",
        detalhe:
          "O pedido mistura video com imagem/carrossel. Um anuncio avulso e de UM formato: video, imagem unica ou carrossel. Remova os campos conflitantes.",
      };
    }
    if (imagemNova && temPedidoCarrossel) {
      return {
        erro: "formatos_de_midia_conflitantes",
        detalhe:
          "O pedido traz meta_image_hash E child_attachments. Use so child_attachments para carrossel (varios slides) OU so meta_image_hash para imagem unica.",
      };
    }
    if (videoNovo && imagemNova) {
      return {
        erro: "formatos_de_midia_conflitantes",
        detalhe:
          "O pedido traz meta_video_id E meta_image_hash. Um anuncio avulso e de UM formato: video (video_data) ou imagem (link_data). Remova um dos dois campos.",
      };
    }
    // ============ v5.8: PERSONALIZACAO POR POSICIONAMENTO NAO E SUPORTADA ============
    // A Coluna da direita do Facebook NAO veicula video (exige imagem, de qualquer proporcao) -
    // trocar o video por um menor nunca resolve o aviso. A unica forma de veicular la e trocar a
    // MIDIA daquele posicionamento por imagem (placement asset customization: asset_feed_spec com
    // regras por posicionamento). Esta executora monta um object_story_spec com UM video_data
    // unico; nao monta asset por posicionamento. Entao, no mesmo espirito de carrossel/foto, o
    // pedido que pede asset por posicionamento RECUSA por nome em vez de publicar so o video e o
    // gestor descobrir na previa que a Coluna da direita ficou de fora.
    if (
      campoPresente(p?.assets_por_posicionamento) ||
      campoPresente(p?.placement_asset_customization) ||
      campoPresente(p?.imagem_coluna_direita) ||
      campoPresente(p?.asset_customization_rules)
    ) {
      return {
        erro: "personalizacao_por_posicionamento_nao_suportada",
        detalhe:
          "O pedido pede midia diferente por posicionamento (ex.: imagem so na Coluna da direita do Facebook, que nao aceita video). Isso e placement asset customization - asset_feed_spec com regras por posicionamento - e esta executora NAO monta isso: ela monta um object_story_spec com um unico video_data. O padrao do sistema para anuncio de video e ACEITAR que a Coluna da direita nao veicule (e avisar isso no card antes da aprovacao). Se precisar veicular imagem nesse posicionamento, monte no Gerenciador ou peca o suporte a personalizacao por posicionamento como trabalho declarado.",
      };
    }

    // ============ v5.2: ESTADO DO DESTINO, ANTES DO ADCREATIVE ============
    // is_dynamic_creative nao e campo do pedido: e estado do conjunto na Graph. Por isso nao cabe
    // no eixo contrato_de_execucao.suportado. A leitura e legitima; qualquer escrita antes dela
    // deixa creative orfao quando create_ad recusa o conjunto Dynamic Creative.
    const destino = await g(`/${adset}?fields=is_dynamic_creative`);
    if (destino.status !== 200) {
      return {
        erro: "falha_ao_verificar_conjunto_destino",
        detalhe:
          "Nao consegui confirmar se o conjunto de destino aceita um anuncio avulso. Nao vou criar a peca antes dessa confirmacao, porque uma falha posterior deixaria um item orfao. Tente novamente quando a consulta ao conjunto estiver disponivel.",
      };
    }
    const dynamicCreative =
      (destino.body as any)?.is_dynamic_creative === true ||
      String((destino.body as any)?.is_dynamic_creative ?? "").toLowerCase() === "true";
    if (dynamicCreative) {
      return {
        erro: "conjunto_destino_criativo_dinamico",
        detalhe:
          "Nao emiti o anuncio porque o conjunto de destino esta configurado para Criativo Dinamico. Esse tipo de conjunto nao aceita a criacao de um anuncio avulso. Escolha um conjunto com Criativo Dinamico desativado ou crie um novo conjunto a partir do molde; as replicas criadas pelo sistema nascem com essa opcao desativada.",
      };
    }

    // ============ v5.18 / ESP-35: PECA NOVA SEM MOLDE ============
    if (pecaNovaSemMolde) {
      const { data: confEmp } = await supa
        .from("meta_execution_config")
        .select("instagram_identity_page_id, page_id, cta_padrao")
        .eq("company_id", companyId)
        .maybeSingle();
      const pageId = String(
        p?.page_id ?? confEmp?.page_id ?? confEmp?.instagram_identity_page_id ?? "",
      ).trim();
      let ctaTipo = String(p?.call_to_action_type ?? confEmp?.cta_padrao ?? "").trim();
      const destinoPedido = destinoDoPedidoCompat(p);
      let linkFinal = String(
        (destinoPedido.aplicavel && destinoPedido.url_final
          ? destinoPedido.url_final
          : null) ??
          p?.destino_url ??
          destinoPedido.url_final ??
          "",
      ).trim();

      // v5.41: conjunto CTWA (CONVERSATIONS + WHATSAPP) exige:
      //   - promoted_object.whatsapp_phone_number no conjunto
      //   - criativo WHATSAPP_MESSAGE + https://api.whatsapp.com/send (NAO CONTACT_US + wa.me)
      // Medido 22/08/2026: CONTACT_US/wa.me → "Criativo invalido para o objetivo" nos JUR_CONV.
      // LF CONV que entrega na mesma conta: LEARN_MORE/api.whatsapp.com/send + WA no conjunto.
      const { data: conjEsp } = await supa
        .from("ad_sets")
        .select("destination_type, optimization_goal, promoted_object, name")
        .eq("company_id", companyId)
        .eq("external_id", adset)
        .maybeSingle();
      const conjuntoCtwa = ehPedidoMensagens({
        destination_type: (conjEsp as any)?.destination_type,
        optimization_goal: (conjEsp as any)?.optimization_goal,
        nome: (conjEsp as any)?.name ?? p?.conjunto_destino_nome,
      });
      let waDigitsConjunto = "";
      if (conjuntoCtwa) {
        const po = (conjEsp as any)?.promoted_object ?? {};
        const waDaJustificativa = (() => {
          const texto = `${String(p?.justificativa ?? "")} ${String(p?.metrica_sucesso ?? "")}`;
          const m =
            texto.match(/(?:whatsapp|wa\.me\/?)\s*[:=]?\s*(\+?\d[\d\s\-.]{9,}\d)/i) ||
            texto.match(/\b(55\d{10,13})\b/);
          return m ? m[1] : "";
        })();
        const waCandidatos = [
          p?.whatsapp_phone_number,
          p?.whatsapp_number,
          digitosWhatsApp(linkFinal) || null,
          digitosWhatsApp(p?.destino_url) || null,
          digitosWhatsApp(destinoPedido.url_final) || null,
          po?.whatsapp_phone_number,
          waDaJustificativa || null,
        ];
        for (const c of waCandidatos) {
          waDigitsConjunto = digitosWhatsApp(c);
          if (waDigitsConjunto) break;
        }
        if (!waDigitsConjunto) {
          return {
            erro: "destino_whatsapp_ausente_ctwa",
            detalhe:
              "O conjunto de destino e Click-to-WhatsApp (CONVERSATIONS + WHATSAPP), mas nao ha whatsapp_phone_number " +
              "(nem no conjunto nem no pedido). Informe params.whatsapp_phone_number (DDI+DDD+numero). " +
              "O telefone fica no conjunto; o criativo usa api.whatsapp.com/send + WHATSAPP_MESSAGE.",
          };
        }
        // Criativo CTWA: link canonico da API — numero NAO vai no wa.me do anuncio.
        linkFinal = LINK_CTWA_API_WHATSAPP;
        ctaTipo = ctaPadraoMensagensWhatsApp(ctaTipo || "WHATSAPP_MESSAGE");
      }

      if (!pageId) {
        return {
          erro: "page_id_ausente_sem_molde",
          detalhe:
            "Peca nova sem molde exige page_id (Pagina emissora). Configure meta_execution_config.page_id / instagram_identity_page_id ou envie page_id no payload. Sem pagina a Meta recusa o adcreative.",
        };
      }
      if (!ctaTipo) {
        return {
          erro: "cta_ausente_sem_molde",
          detalhe:
            "Peca nova sem molde exige call_to_action_type (ex.: LEARN_MORE ou CONTACT_US no CTWA). Configure meta_execution_config.cta_padrao ou envie no payload.",
        };
      }
      if (!linkFinal) {
        return {
          erro: "destino_url_ausente_sem_molde",
          detalhe:
            "Peca nova sem molde nao tem URL para herdar. Informe destino_url no pedido (LP, Page/IG ou wa.me no CTWA) ou emita com destino_do_anuncio resolvido.",
        };
      }
      if (!legendaNova) {
        return {
          erro: "legenda_obrigatoria_peca_nova",
          detalhe: "Peca nova (com ou sem molde) exige legenda no payload — nao ha texto a herdar de lugar nenhum.",
        };
      }

      const identidadeInstagram = await resolverIdentidadeInstagram(companyId, "", p);
      const igRecusa = recusarSemIdentidadeNasPlataformas(p, identidadeInstagram);
      if (igRecusa) return igRecusa;

      // ============ v5.24: CARROSSEL sem molde ============
      if (temPedidoCarrossel) {
        const norm = normalizarChildAttachments(p?.child_attachments, linkFinal, ctaTipo);
        if (!norm.ok) return { erro: norm.erro, detalhe: norm.detalhe };
        let novoLdCarr: any = {
          message: legendaNova,
          link: linkFinal,
          child_attachments: norm.cards,
          multi_share_optimized: true,
          call_to_action: { type: ctaTipo, value: { link: linkFinal } },
        };
        let novoSpecCarr: any = { page_id: pageId, link_data: novoLdCarr };
        novoSpecCarr = aplicarIdentidadeInstagramNoSpec(novoSpecCarr, identidadeInstagram);
        const avisosCarr: string[] = [
          `Anuncio CARROSSEL sem molde (v5.24): ${norm.cards.length} slides em link_data.child_attachments. Escrita via Graph (Pipeboard nao monta carrossel completo).`,
        ];
        avisosCarr.push(avisoIdentidadeInstagram(identidadeInstagram));
        if (conjuntoCtwa) {
          avisosCarr.push(
            `CTWA: destino WhatsApp ${linkFinal} com CTA ${ctaTipo} (conjunto destination_type=WHATSAPP).`,
          );
        }
        return {
          path: `/${conta}/ads`,
          body: { name: nome, adset_id: adset, status: "ACTIVE" } as Record<string, string>,
          criativo: {
            modo: "novo_adcreative_peca_nova_carrossel_sem_molde",
            path: `/${conta}/adcreatives`,
            body: {
              name: `${nome} - creative`,
              object_story_spec: JSON.stringify(novoSpecCarr),
              ...(urlTags ? { url_tags: urlTags } : {}),
            } as Record<string, string>,
          },
          peca_nova: {
            child_attachments: norm.cards,
            slides: norm.cards.length,
            link_publicado: linkFinal,
            destino_url_lp: destinoPedido,
            legenda_substituida: true,
            creative_molde: null,
            fonte_da_config: "config_empresa_sem_molde",
            identidade_ig_herdada: false,
            identidade_instagram_preenchida: identidadeInstagram.encontrada,
            identidade_instagram: identidadeInstagram,
            identidade_instagram_campo_spec: identidadeInstagram.instagram_actor_id
              ? campoIdentidadeInstagramPorFormato(identidadeInstagram.instagram_actor_id)
              : null,
            formato: "carrossel",
            page_id: pageId,
            call_to_action_type: ctaTipo,
            ctwa: conjuntoCtwa,
          },
          avisos_de_veiculacao: avisosCarr,
        };
      }

      if (videoNovo) {
        const th = await escolherThumbnail(videoNovo, String(p?.thumbnail_url ?? ""));
        if (th.erro) {
          return { erro: "thumbnail_obrigatoria_nao_resolvida", detalhe: th.erro };
        }
        // v5.41: CTWA → WHATSAPP_MESSAGE + api.whatsapp.com/send (+ app_destination).
        // v5.40: video_data NAO aceita campo link no topo (Graph 1443050).
        const ctaVideo = conjuntoCtwa
          ? ctaValueCtwa(ctaTipo)
          : { type: ctaTipo, value: { link: linkFinal } };
        let novoVd: any = sanitizarVideoDataParaGraph({
          video_id: videoNovo,
          image_url: th.url,
          message: legendaNova,
          call_to_action: ctaVideo,
        });
        let novoSpec: any = { page_id: pageId, video_data: novoVd };
        novoSpec = aplicarIdentidadeInstagramNoSpec(novoSpec, identidadeInstagram);
        const avisosVeiculacao: string[] = [
          "Anuncio de VIDEO sem molde (ESP-35): object_story_spec montado da config/pedido (page_id + CTA + destino). A Coluna da direita do Facebook nao veicula video.",
        ];
        avisosVeiculacao.push(avisoIdentidadeInstagram(identidadeInstagram));
        if (conjuntoCtwa) {
          avisosVeiculacao.push(
            `CTWA: criativo ${ctaVideo.type} + ${LINK_CTWA_API_WHATSAPP}; numero ${waDigitsConjunto} deve estar no promoted_object do conjunto.`,
          );
        }
        return {
          path: `/${conta}/ads`,
          body: { name: nome, adset_id: adset, status: "ACTIVE" } as Record<string, string>, // v4.4: aprovar criar_anuncio = cria ACTIVE (entrega sob responsabilidade do card)
          criativo: {
            modo: "novo_adcreative_peca_nova_sem_molde",
            path: `/${conta}/adcreatives`,
            body: {
              name: `${nome} - creative`,
              object_story_spec: JSON.stringify(novoSpec),
              ...(urlTags ? { url_tags: urlTags } : {}),
            } as Record<string, string>,
          },
          // v5.41: se o conjunto ainda nao tem WA, a executora atualiza promoted_object antes do creative.
          ctwa_promoted_patch: conjuntoCtwa && waDigitsConjunto
            ? {
              adset_id: adset,
              page_id: pageId,
              whatsapp_phone_number: waDigitsConjunto,
            }
            : null,
          peca_nova: {
            meta_video_id: videoNovo,
            link_publicado: linkFinal,
            destino_url_lp: destinoPedido,
            legenda_substituida: true,
            creative_molde: null,
            fonte_da_config: "config_empresa_sem_molde",
            identidade_ig_herdada: false,
            identidade_instagram_preenchida: identidadeInstagram.encontrada,
            identidade_instagram: identidadeInstagram,
            identidade_instagram_campo_spec: identidadeInstagram.instagram_actor_id
              ? campoIdentidadeInstagramPorFormato(identidadeInstagram.instagram_actor_id)
              : null,
            formato: "video",
            page_id: pageId,
            call_to_action_type: ctaTipo,
            ctwa: conjuntoCtwa,
            whatsapp_phone_number: waDigitsConjunto || null,
          },
          avisos_de_veiculacao: avisosVeiculacao,
        };
      }

      // imagem sem molde
      const ctaImg = conjuntoCtwa
        ? ctaValueCtwa(ctaTipo)
        : { type: ctaTipo, value: { link: linkFinal } };
      let novoLd: any = {
        image_hash: imagemNova,
        message: legendaNova,
        link: linkFinal,
        call_to_action: ctaImg,
      };
      let novoSpecImg: any = { page_id: pageId, link_data: novoLd };
      novoSpecImg = aplicarIdentidadeInstagramNoSpec(novoSpecImg, identidadeInstagram);
      const avisosImg: string[] = [
        "Anuncio de IMAGEM sem molde (ESP-35): object_story_spec montado da config/pedido. A Coluna da direita do Facebook ACEITA imagem.",
      ];
      avisosImg.push(avisoIdentidadeInstagram(identidadeInstagram));
      if (conjuntoCtwa) {
        avisosImg.push(
          `CTWA: criativo ${ctaImg.type} + ${LINK_CTWA_API_WHATSAPP}; numero ${waDigitsConjunto} no conjunto.`,
        );
      }
      return {
        path: `/${conta}/ads`,
        body: { name: nome, adset_id: adset, status: "ACTIVE" } as Record<string, string>, // v4.4: aprovar criar_anuncio = cria ACTIVE (entrega sob responsabilidade do card)
        criativo: {
          modo: "novo_adcreative_peca_nova_imagem_sem_molde",
          path: `/${conta}/adcreatives`,
          body: {
            name: `${nome} - creative`,
            object_story_spec: JSON.stringify(novoSpecImg),
            ...(urlTags ? { url_tags: urlTags } : {}),
          } as Record<string, string>,
        },
        ctwa_promoted_patch: conjuntoCtwa && waDigitsConjunto
          ? { adset_id: adset, page_id: pageId, whatsapp_phone_number: waDigitsConjunto }
          : null,
        peca_nova: {
          meta_image_hash: imagemNova,
          link_publicado: linkFinal,
          destino_url_lp: destinoPedido,
          legenda_substituida: true,
          creative_molde: null,
          fonte_da_config: "config_empresa_sem_molde",
          identidade_ig_herdada: false,
          identidade_instagram_preenchida: identidadeInstagram.encontrada,
          identidade_instagram: identidadeInstagram,
          identidade_instagram_campo_spec: identidadeInstagram.instagram_actor_id
            ? campoIdentidadeInstagramPorFormato(identidadeInstagram.instagram_actor_id)
            : null,
          formato: "imagem",
          page_id: pageId,
          call_to_action_type: ctaTipo,
          ctwa: conjuntoCtwa,
          whatsapp_phone_number: waDigitsConjunto || null,
        },
        avisos_de_veiculacao: avisosImg,
      };
    }

    // Le o creative do molde. asset_feed_spec entra porque criativo Dinamico guarda
    // link/CTA/videos la - sem ele so 8 moldes serviam; com ele a config e herdavel.
    const c = await g(
      `/${creativeMolde}?fields=object_story_spec,asset_feed_spec,url_tags,name,degrees_of_freedom_spec`,
    );
    const cb: any = c.body ?? {};
    const temStorySpec = c.status === 200 && cb.object_story_spec;
    const identidadeInstagram = await resolverIdentidadeInstagram(companyId, creativeMolde, p);
    {
      const igRecusaMolde = recusarSemIdentidadeNasPlataformas(p, identidadeInstagram);
      if (igRecusaMolde) return igRecusaMolde;
    }

    // ============ v4.4 / v5.7: PECA NOVA (video do Drive ja na biblioteca da conta) ============
    // FONTES DE CONFIG (ordem):
    //   1) object_story_spec.video_data do molde (anuncio avulso) - copia e troca video_id;
    //   2) asset_feed_spec do molde dinamico (videos + link_urls + call_to_action_types) -
    //      MONTA video_data com page_id do story_spec. CTA observado 11/08: string plana.
    //      URL/CTA ambiguos RECUSAM (nao escolhemos). Molde de imagem RECUSA.
    // Sem as duas fontes: recusa. Nunca inventa URL de credito. Sem degradacao para
    // reusar_creative_id na peca nova (publicaria a peca antiga).
    // v5.6: LP Legal e Viver corrige legaleviver.com.br sem /simulacao-clt para o canonico.
    if (videoNovo) {
      if (!temStorySpec) {
        return {
          erro: "molde_sem_object_story_spec",
          detalhe: `O anuncio molde (creative ${creativeMolde}) nao expoe object_story_spec. Sem page_id nao ha de onde montar o emissor, e este caminho NAO reusa o criativo do molde: reusar publicaria a peca ANTIGA. Escolha outro molde ou monte no Gerenciador.`,
        };
      }
      const pageId = cb.object_story_spec?.page_id ?? null;
      if (!pageId) {
        return {
          erro: "molde_sem_page_id",
          detalhe:
            "O object_story_spec do molde nao traz page_id, e a Meta recusa adcreative sem pagina. Nao ha default seguro: publicar por outra pagina mudaria o emissor do anuncio.",
        };
      }

      let vd: any = cb.object_story_spec?.video_data ?? null;
      let fonteConfig: "video_data" | "asset_feed_spec" | null = vd ? "video_data" : null;

      if (!vd) {
        const afs: any = cb.asset_feed_spec ?? null;
        const videosAfs = Array.isArray(afs?.videos) ? afs.videos : [];
        if (!videosAfs.length) {
          return {
            erro: "molde_sem_video_data",
            detalhe: `O molde expoe object_story_spec sem video_data e sem videos[] no asset_feed_spec (chaves do story: ${Object.keys(cb.object_story_spec ?? {}).join(", ") || "nenhuma"}; chaves do feed: ${Object.keys(afs ?? {}).join(", ") || "nenhuma"}). E molde de IMAGEM ou config incompleta - trocar por video mudaria o FORMATO. Use molde de VIDEO (avulso ou dinamico com videos no feed).`,
          };
        }
        const urls = [
          ...new Set(
            (Array.isArray(afs?.link_urls) ? afs.link_urls : [])
              .map((u: any) => String(u?.website_url ?? "").trim())
              .filter(Boolean),
          ),
        ];
        if (urls.length !== 1) {
          return {
            erro: "molde_sem_link_de_destino",
            detalhe:
              urls.length === 0
                ? "O asset_feed_spec do molde nao traz link_urls[].website_url. A URL de destino nao sera inventada."
                : `O asset_feed_spec do molde traz ${urls.length} URLs distintas e nao escolhemos entre elas. Use um molde com destino unico.`,
          };
        }
        const ctas = [
          ...new Set(
            (Array.isArray(afs?.call_to_action_types) ? afs.call_to_action_types : [])
              .map((t: any) => (typeof t === "string" ? t.trim() : ""))
              .filter(Boolean),
          ),
        ];
        if (ctas.length !== 1) {
          return {
            erro: "molde_sem_video_data",
            detalhe:
              ctas.length === 0
                ? "O asset_feed_spec do molde nao traz call_to_action_types. Sem CTA nao monto o video_data."
                : `O asset_feed_spec traz ${ctas.length} CTAs distintos e nao escolhemos entre eles.`,
          };
        }
        vd = {
          call_to_action: { type: ctas[0], value: { link: urls[0] } },
        };
        fonteConfig = "asset_feed_spec";
      }

      const linkMolde = vd?.call_to_action?.value?.link ?? vd?.link ?? null;
      if (!linkMolde) {
        return {
          erro: "molde_sem_link_de_destino",
          detalhe: `O video_data do molde nao traz link de destino (chaves: ${Object.keys(vd).join(", ")}). A URL de destino nao sera inventada. Escolha um molde que carregue o link.`,
        };
      }
      // Destino POR PRODUTO (decidido na emissao, honrado aqui): so corrige quando CLT.
      const destino = destinoDoPedidoCompat(p);
      const linkFinal = destino.aplicavel && destino.url_final ? destino.url_final : String(linkMolde);
      const th = await escolherThumbnail(videoNovo, String(p?.thumbnail_url ?? ""));
      if (th.erro) {
        return { erro: "thumbnail_obrigatoria_nao_resolvida", detalhe: th.erro };
      }

      // image_hash do molde e o quadro do video ANTIGO: mantido, a Meta publicaria a capa errada.
      let novoVd: any = { ...vd, video_id: videoNovo, image_url: th.url };
      delete novoVd.image_hash;
      // v5.40: Meta 1443050 — link no topo de video_data e recusado no POST.
      novoVd = sanitizarVideoDataParaGraph(novoVd);
      if (legendaNova) novoVd.message = legendaNova;
      if (destino.aplicavel && destino.corrigiu) {
        novoVd = aplicarLinkNoVideoData(novoVd, linkFinal);
      }

      // Avulso: preserva o story_spec do molde e so troca video_data.
      // Dinamico (asset_feed): monta story_spec minimo — o feed nao e object_story_spec.
      let novoSpec: any =
        fonteConfig === "video_data"
          ? { ...cb.object_story_spec, video_data: sanitizarVideoDataParaGraph(novoVd) }
          : { page_id: pageId, video_data: sanitizarVideoDataParaGraph(novoVd) };
      novoSpec = aplicarIdentidadeInstagramNoSpec(novoSpec, identidadeInstagram);

      // Avisos de veiculacao, derivados do que a peca REALMENTE e (video) e do que o molde
      // expoe (identidade). O card antes da aprovacao ja avisa via pedido_de_anuncio_completo;
      // aqui o mesmo aviso viaja no objeto executado, para o gestor nao descobrir na previa.
      const avisosVeiculacao: string[] = [
        "Anuncio de VIDEO: a Coluna da direita do Facebook nao veicula video (exige imagem, de qualquer proporcao). Esse posicionamento nao sera entregue - nao e tamanho nem largura do video, e regra do posicionamento.",
      ];
      avisosVeiculacao.push(avisoIdentidadeInstagram(identidadeInstagram));

      return {
        path: `/${conta}/ads`,
        body: { name: nome, adset_id: adset, status: "ACTIVE" } as Record<string, string>, // v4.4: aprovar criar_anuncio = cria ACTIVE (entrega sob responsabilidade do card)
        criativo: {
          modo: "novo_adcreative_peca_nova",
          path: `/${conta}/adcreatives`,
          body: {
            name: `${nome} - creative`,
            object_story_spec: JSON.stringify(novoSpec),
            ...(urlTags ? { url_tags: urlTags } : {}),
          } as Record<string, string>,
        },
        peca_nova: {
          meta_video_id: videoNovo,
          thumbnail: th,
          link_herdado_do_molde: linkMolde,
          link_publicado: linkFinal,
          destino_url_lp: destino,
          legenda_substituida: !!legendaNova,
          creative_molde: creativeMolde,
          fonte_da_config: fonteConfig,
          identidade_ig_herdada: identidadeInstagram.fonte === "molde_creative_estado_graph",
          identidade_instagram_preenchida: identidadeInstagram.encontrada,
          identidade_instagram: identidadeInstagram,
          identidade_instagram_campo_spec: identidadeInstagram.instagram_actor_id
            ? campoIdentidadeInstagramPorFormato(identidadeInstagram.instagram_actor_id)
            : null,
        },
        avisos_de_veiculacao: avisosVeiculacao,
      };
    }

    // ============ v5.24: PECA NOVA CARROSSEL (com molde; sem molde ja tratado acima) ============
    if (temPedidoCarrossel) {
      if (!temStorySpec) {
        return {
          erro: "molde_sem_object_story_spec",
          detalhe:
            "Carrossel com molde exige object_story_spec no molde (page_id). Ou use peca nova sem molde (page_id/CTA/destino no payload).",
        };
      }
      const pageId = cb.object_story_spec?.page_id ?? null;
      if (!pageId) {
        return {
          erro: "molde_sem_page_id",
          detalhe: "Molde sem page_id — Meta recusa adcreative sem pagina.",
        };
      }
      const ldMolde: any = cb.object_story_spec?.link_data ?? null;
      const linkMoldeCarr = ldMolde?.link ?? ldMolde?.call_to_action?.value?.link ?? null;
      const destinoPedidoCarr = destinoDoPedidoCompat(p);
      const linkFinalCarr = String(
        (destinoPedidoCarr.aplicavel && destinoPedidoCarr.url_final
          ? destinoPedidoCarr.url_final
          : null) ??
          p?.destino_url ??
          linkMoldeCarr ??
          "",
      ).trim();
      if (!linkFinalCarr) {
        return {
          erro: "destino_url_ausente_carrossel",
          detalhe: "Carrossel exige link de destino (pedido ou molde com link_data).",
        };
      }
      if (!legendaNova) {
        return {
          erro: "legenda_obrigatoria_peca_nova",
          detalhe: "Carrossel exige legenda no payload.",
        };
      }
      const ctaTipoCarr =
        String(p?.call_to_action_type ?? ldMolde?.call_to_action?.type ?? "LEARN_MORE").trim() ||
        "LEARN_MORE";
      const norm = normalizarChildAttachments(p?.child_attachments, linkFinalCarr, ctaTipoCarr);
      if (!norm.ok) return { erro: norm.erro, detalhe: norm.detalhe };
      let novoLd: any = {
        message: legendaNova,
        link: linkFinalCarr,
        child_attachments: norm.cards,
        multi_share_optimized: true,
        call_to_action: { type: ctaTipoCarr, value: { link: linkFinalCarr } },
      };
      let novoSpec: any = { page_id: pageId, link_data: novoLd };
      novoSpec = aplicarIdentidadeInstagramNoSpec(novoSpec, identidadeInstagram);
      return {
        path: `/${conta}/ads`,
        body: { name: nome, adset_id: adset, status: "ACTIVE" } as Record<string, string>,
        criativo: {
          modo: "novo_adcreative_peca_nova_carrossel",
          path: `/${conta}/adcreatives`,
          body: {
            name: `${nome} - creative`,
            object_story_spec: JSON.stringify(novoSpec),
            ...(urlTags ? { url_tags: urlTags } : {}),
          } as Record<string, string>,
        },
        peca_nova: {
          child_attachments: norm.cards,
          slides: norm.cards.length,
          link_publicado: linkFinalCarr,
          legenda_substituida: true,
          creative_molde: creativeMolde,
          formato: "carrossel",
          page_id: pageId,
          call_to_action_type: ctaTipoCarr,
          identidade_instagram_preenchida: identidadeInstagram.encontrada,
        },
        avisos_de_veiculacao: [
          `Carrossel com molde (v5.24): ${norm.cards.length} slides; escrita via Graph.`,
          avisoIdentidadeInstagram(identidadeInstagram),
        ],
      };
    }

    // ============ v5.9: PECA NOVA DE IMAGEM (hash ja na biblioteca da conta) ============
    // Espelha a disciplina do video: COPIA link_data do molde e TROCA image_hash.
    // Pipeboard create_ad_creative aceita image_hash plano (argsCreativeDeGraph desembrulha
    // link_data). Sem link_data no molde: recusa (molde de video ou incompleto) - nao inventa
    // URL. Upload de imagem nova e via upload-midia → Graph adimages (nao via Pipeboard).
    if (imagemNova) {
      if (!temStorySpec) {
        return {
          erro: "molde_sem_object_story_spec",
          detalhe: `O anuncio molde (creative ${creativeMolde}) nao expoe object_story_spec. Sem page_id/link_data nao monto anuncio de imagem, e este caminho NAO reusa o criativo do molde. Escolha um molde de IMAGEM (link_data) ou monte no Gerenciador.`,
        };
      }
      const pageId = cb.object_story_spec?.page_id ?? null;
      if (!pageId) {
        return {
          erro: "molde_sem_page_id",
          detalhe:
            "O object_story_spec do molde nao traz page_id, e a Meta recusa adcreative sem pagina. Nao ha default seguro.",
        };
      }
      const ld: any = cb.object_story_spec?.link_data ?? null;
      if (!ld) {
        return {
          erro: "molde_sem_link_data",
          detalhe: `O molde expoe object_story_spec sem link_data (chaves: ${Object.keys(cb.object_story_spec ?? {}).join(", ") || "nenhuma"}). E molde de VIDEO ou formato incompleto - trocar por imagem mudaria o FORMATO. Use molde de IMAGEM.`,
        };
      }
      if (Array.isArray(ld.child_attachments) && ld.child_attachments.length > 0) {
        return {
          erro: "molde_e_carrossel",
          detalhe:
            "O molde e um carrossel. Para publicar carrossel novo, envie child_attachments (2-10 image_hash). Para imagem unica, use molde de imagem avulsa.",
        };
      }
      const linkMolde = ld?.link ?? ld?.call_to_action?.value?.link ?? null;
      if (!linkMolde) {
        return {
          erro: "molde_sem_link_de_destino",
          detalhe: `O link_data do molde nao traz link de destino (chaves: ${Object.keys(ld).join(", ")}). A URL nao sera inventada.`,
        };
      }
      const ctaTipo = ld?.call_to_action?.type ?? null;
      if (!ctaTipo) {
        return {
          erro: "molde_sem_link_data",
          detalhe: "O link_data do molde nao traz call_to_action.type. Sem CTA nao monto o anuncio de imagem.",
        };
      }

      // Destino POR PRODUTO (decidido na emissao, honrado aqui): so corrige quando CLT.
      const destino = destinoDoPedidoCompat(p);
      const linkFinal = destino.aplicavel && destino.url_final ? destino.url_final : String(linkMolde);

      let novoLd: any = { ...ld, image_hash: imagemNova };
      if (legendaNova) novoLd.message = legendaNova;
      if (destino.aplicavel && destino.corrigiu) {
        novoLd = aplicarLinkNoLinkData(novoLd, linkFinal);
      }

      let novoSpec: any = {
        ...cb.object_story_spec,
        link_data: novoLd,
      };
      delete novoSpec.video_data; // formato imagem: nao misturar video_data
      novoSpec = aplicarIdentidadeInstagramNoSpec(novoSpec, identidadeInstagram);

      const avisosVeiculacao: string[] = [
        "Anuncio de IMAGEM: a Coluna da direita do Facebook ACEITA imagem - esse posicionamento pode veicular (diferente do anuncio de video, que a Coluna da direita recusa).",
      ];
      avisosVeiculacao.push(avisoIdentidadeInstagram(identidadeInstagram));

      return {
        path: `/${conta}/ads`,
        body: { name: nome, adset_id: adset, status: "ACTIVE" } as Record<string, string>, // v4.4: aprovar criar_anuncio = cria ACTIVE (entrega sob responsabilidade do card)
        criativo: {
          modo: "novo_adcreative_peca_nova_imagem",
          path: `/${conta}/adcreatives`,
          body: {
            name: `${nome} - creative`,
            object_story_spec: JSON.stringify(novoSpec),
            ...(urlTags ? { url_tags: urlTags } : {}),
          } as Record<string, string>,
        },
        peca_nova: {
          meta_image_hash: imagemNova,
          link_herdado_do_molde: linkMolde,
          link_publicado: linkFinal,
          destino_url_lp: destino,
          legenda_substituida: !!legendaNova,
          creative_molde: creativeMolde,
          fonte_da_config: "link_data",
          identidade_ig_herdada: identidadeInstagram.fonte === "molde_creative_estado_graph",
          identidade_instagram_preenchida: identidadeInstagram.encontrada,
          identidade_instagram: identidadeInstagram,
          identidade_instagram_campo_spec: identidadeInstagram.instagram_actor_id
            ? campoIdentidadeInstagramPorFormato(identidadeInstagram.instagram_actor_id)
            : null,
          formato: "imagem",
        },
        avisos_de_veiculacao: avisosVeiculacao,
      };
    }

    // Replicacao pura: se o molde expoe story_spec, reescrevemos o link LP canônico antes
    // de criar o adcreative novo. Sem story_spec (reusar_creative_id) nao ha como corrigir
    // o destino — e se o molde for LP da LEV com URL fora do canônico, RECUSAMOS por nome
    // em vez de publicar a raiz em silencio.
    if (temStorySpec) {
      const spec: any = cb.object_story_spec;
      const vdRep: any = spec?.video_data ?? null;
      const ldRep: any = spec?.link_data ?? null;
      // Destino POR PRODUTO (decidido na emissao): so corrige quando CLT; preserva o resto.
      // v5.44: trafego_website reescreve CTA CTWA → CONTACT_US + wa.me (sem app_destination).
      const destinoRep = destinoDoPedidoCompat(p);
      const linkPedido = String(p?.destino_url ?? destinoRep.url_final ?? "").trim();
      const ctaPedido = String(p?.call_to_action_type ?? "").trim();
      let specFinal = spec;
      if (destinoRep.caso === "trafego_website" && (destinoRep.url_final || linkPedido)) {
        const link = String(destinoRep.url_final || linkPedido);
        const cta = ctaPedido || ctaPadraoTrafegoWebsite();
        if (vdRep) {
          specFinal = {
            ...spec,
            video_data: sanitizarVideoDataParaGraph(
              aplicarDestinoWebsiteNoVideoData(vdRep, link, cta),
            ),
          };
        } else if (ldRep) {
          specFinal = {
            ...spec,
            link_data: aplicarDestinoWebsiteNoLinkData(ldRep, link, cta),
          };
        }
      } else if (destinoRep.aplicavel && destinoRep.corrigiu && vdRep && destinoRep.url_final) {
        specFinal = {
          ...spec,
          video_data: sanitizarVideoDataParaGraph(
            aplicarLinkNoVideoData(vdRep, destinoRep.url_final),
          ),
        };
      } else if (vdRep) {
        // v5.40: mesmo sem reescrita de LP, remova video_data.link se o molde trouxer.
        specFinal = { ...spec, video_data: sanitizarVideoDataParaGraph(vdRep) };
      }
      specFinal = aplicarIdentidadeInstagramNoSpec(specFinal, identidadeInstagram);
      return {
        path: `/${conta}/ads`,
        body: { name: nome, adset_id: adset, status: "ACTIVE" } as Record<string, string>, // v4.4: aprovar criar_anuncio = cria ACTIVE (entrega sob responsabilidade do card)
        criativo: {
          modo: "novo_adcreative",
          path: `/${conta}/adcreatives`,
          body: {
            name: `${nome} - creative`,
            object_story_spec: JSON.stringify(specFinal),
            ...(urlTags ? { url_tags: urlTags } : {}),
          } as Record<string, string>,
        },
        destino_url_lp: destinoRep.aplicavel ? destinoRep : null,
      };
    }

    // Sem story_spec: so reusa o creative_id. Se a emissao decidiu que o produto e CLT e o
    // destino precisa ser corrigido, recusa por nome — nao ha campo para corrigir no reuso.
    // Produto OUTRO/indeterminado nao dispara recusa: preserva o criativo do molde.
    const destinoPedido = destinoDoPedidoCompat(p);
    if (destinoPedido.aplicavel && destinoPedido.corrigiu) {
      return {
        erro: "destino_url_lp_nao_corrigivel_sem_object_story_spec",
        detalhe:
          `O molde nao expoe object_story_spec, entao o anuncio novo reusaria o criativo original com destino "${destinoPedido.url_original}". O anuncio foi identificado como credito CLT (sinal ${destinoPedido.sinal ?? "?"}), cujo destino canonico e ${destinoPedido.url_final}, e sem o spec nao ha como corrigir o link na criacao. Escolha um molde que expoe object_story_spec com link (ex.: CREATIVE_LPV2_Reel*) ou um molde que ja aponte para ${destinoPedido.url_final}.`,
      };
    }

    return {
      path: `/${conta}/ads`,
      body: { name: nome, adset_id: adset, status: "ACTIVE" } as Record<string, string>, // v4.4: aprovar criar_anuncio = cria ACTIVE (entrega sob responsabilidade do card)
      criativo: {
        modo: "reusar_creative_id",
        creative_id: creativeMolde,
        aviso:
          "O criativo do molde nao expoe object_story_spec (tipico de Advantage+ com asset_feed_spec), entao o anuncio novo REUSA o criativo original e herda as UTMs dele - a utm_campaign pedida NAO sera aplicada. Ajustar manualmente no Gerenciador se a rastreabilidade for necessaria.",
      },
    };
  }

  return { erro: `acao de criacao desconhecida: ${acao}` };
}

// v4.2 (03/08/2026) - ESPELHO NO ATO DA CRIACAO.
// PROBLEMA QUE ISSO RESOLVE: a executora criava o objeto na Meta e nao gravava em
// campaigns/ad_sets/ads. O espelho dependia do windsor-sync, que por construcao nao devolve
// campanha sem entrega - logo o sistema ficava cego para o que ele mesmo acabou de criar,
// exatamente durante a montagem da estrutura. As 3 campanhas de 31/07 ficaram 3 dias fora do
// banco, e foi essa cegueira que fez o agente e o gestor operarem sobre estado falso.
// CAIXA DO STATUS (nao mexer sem ler): campaigns usa MINUSCULO nesta base (24 'paused' +
// 2 'active'), ad_sets e ads usam MAIUSCULO. Gravar a caixa errada faz a linha piscar a cada
// sync. Seguimos a convencao de cada tabela; a divergencia entre elas e item separado (GT-09).
// CONTA: campaigns.external_account_id e ad_sets/ads.account_id guardam o id SEM o prefixo act_.
// FALHA DE ESPELHO NAO DERRUBA A EXECUCAO: o objeto JA existe na Meta nesse ponto. Mas tambem
// nao e silenciosa - vai para o audit_log e para o execution_result do card.
async function espelhar(
  acao: string,
  novoId: string,
  objeto: any,
  p: any,
  conta: string,
  companyId: string,
  approvalId: string,
  moldeLido: any,
  creativeUsado: string | null,
  statusEnviado: string,
): Promise<{ ok: boolean; erro?: string; tabela?: string }> {
  const contaSemPrefixo = conta.replace(/^act_/, "");
  // v4.3.1 (04/08/2026): tres fontes, em ordem de autoridade. (1) o que a Meta devolveu na
  // releitura do objeto criado; (2) o que a executora ACABOU de enviar no corpo - fato conhecido,
  // nao palpite; (3) PAUSED como ultimo recurso, que e a direcao segura. O literal "ACTIVE" que
  // estava aqui foi escrito na v4.2, quando o objeto nascia ativo, e virou VERDE FALSO no
  // instante em que a v4.3 passou a criar pausado - default digitado a mao aponta para o
  // contrato do dia em que foi escrito, e este mudou duas vezes em quatro dias.
  const statusMeta = String(objeto?.status ?? statusEnviado ?? "PAUSED") || "PAUSED";
  try {
    if (acao === "criar_campanha") {
      const { error } = await supa.from("campaigns").upsert(
        {
          company_id: companyId,
          provider: "meta_ads",
          name: String(objeto?.name ?? p?.nome_novo ?? ""),
          objective: String(objeto?.objective ?? p?.objetivo ?? "OUTCOME_LEADS"),
          status: statusMeta.toLowerCase(), // campaigns = minusculo
          // v5.4: o literal `0` que estava aqui era um PALPITE apresentado como fato ("ABO:
          // orcamento vive no conjunto"). Em 07/08/2026 ele gravou 0 para uma campanha que a Meta
          // criou com R$ 10,00/dia, e o espelho passou dias afirmando o contrario do real. Agora
          // segue o objeto lido na Graph; sem leitura, NULO - que e o valor que
          // avaliar_estado_destino_execucao trata como "nao verificado" e recusa fechado, em vez
          // de um numero que finge conhecimento.
          daily_budget: objeto?.daily_budget != null ? Number(objeto.daily_budget) : null,
          lifetime_budget: objeto?.lifetime_budget != null ? Number(objeto.lifetime_budget) : null,
          external_id: novoId,
          external_account_id: contaSemPrefixo,
          special_ad_categories: Array.isArray(p?.special_ad_categories)
            ? p.special_ad_categories
            : (empresaEhCredito(companyId) ? ["FINANCIAL_PRODUCTS_SERVICES"] : []),
          criado_pelo_sistema: true,
          criado_por_approval_id: approvalId,
          nome_partes: p?.nome_partes ?? null,
        },
        { onConflict: "provider,external_id" },
      );
      return error
        ? { ok: false, erro: error.message, tabela: "campaigns" }
        : { ok: true, tabela: "campaigns" };
    }

    if (acao === "criar_conjunto_a_partir_de" || acao === "escalar_duplicar") {
      // ad_sets.campaign_id e o uuid INTERNO, nao o id da Meta - precisa resolver.
      const { data: camp } = await supa
        .from("campaigns")
        .select("id")
        .eq("provider", "meta_ads")
        .eq("external_id", String(p?.campanha_destino_external_id ?? ""))
        .maybeSingle();
      const { error } = await supa.from("ad_sets").upsert(
        {
          company_id: companyId,
          provider: "meta_ads",
          account_id: contaSemPrefixo,
          campaign_id: camp?.id ?? null, // null e aceito (FK ON DELETE SET NULL)
          external_id: novoId,
          name: String(objeto?.name ?? p?.nome_novo ?? ""),
          status: statusMeta.toUpperCase(), // ad_sets = MAIUSCULO
          daily_budget: Math.round(Number(p?.orcamento_diario_reais ?? 0) * 100), // centavos
          bid_strategy: moldeLido?.bid_strategy ?? null,
          targeting: moldeLido?.targeting ?? null,
          destination_type: String(objeto?.destination_type ?? p?.destination_type ?? "").trim() || null,
          optimization_goal: String(objeto?.optimization_goal ?? p?.optimization_goal ?? "").trim() || null,
          criado_pelo_sistema: true,
          criado_por_approval_id: approvalId,
          nome_partes: p?.nome_partes ?? null,
        },
        { onConflict: "provider,external_id" },
      );
      const aviso = camp?.id
        ? undefined
        : "conjunto gravado SEM vinculo de campanha: a campanha destino nao esta no espelho";
      return error
        ? { ok: false, erro: error.message, tabela: "ad_sets" }
        : { ok: true, tabela: "ad_sets", ...(aviso ? { erro: aviso } : {}) };
    }

    if (acao === "criar_anuncio_a_partir_de") {
      // Sobe pelo conjunto para achar a campanha - o anuncio guarda as duas referencias.
      const { data: aset } = await supa
        .from("ad_sets")
        .select("campaign_id")
        .eq("provider", "meta_ads")
        .eq("external_id", String(p?.conjunto_destino_external_id ?? ""))
        .maybeSingle();
      const { error } = await supa.from("ads").upsert(
        {
          company_id: companyId,
          provider: "meta_ads",
          account_id: contaSemPrefixo,
          campaign_id: aset?.campaign_id ?? null,
          adset_external_id: String(p?.conjunto_destino_external_id ?? ""),
          external_id: novoId,
          name: String(objeto?.name ?? p?.nome_novo ?? ""),
          creative_id: creativeUsado,
          status: statusMeta.toUpperCase(), // ads = MAIUSCULO
          criado_pelo_sistema: true,
          criado_por_approval_id: approvalId,
          nome_partes: p?.nome_partes ?? null,
          // v4.4 (GT-13): PROCEDENCIA DO TEXTO. Sem isso, um anuncio criado pelo sistema fica
          // indistinguivel de um sincronizado, e a pergunta "quem escreveu esta legenda" nao tem
          // resposta no banco - so no card, que expira. legenda_fonte vem da verificacao
          // (pedido_de_anuncio_completo), nao de palpite daqui; ausente = nao declarada, e nulo
          // e a resposta honesta. compliance_verificado_em e o instante do veredito que LIBEROU
          // o card, nao o da execucao: o que foi avaliado foi o texto, antes de existir anuncio.
          ...(p?.legenda ? { body: String(p.legenda) } : {}),
          ...(p?.legenda_fonte ? { legenda_fonte: String(p.legenda_fonte) } : {}),
          ...(p?.legenda_referencias ? { legenda_referencias: p.legenda_referencias } : {}),
          ...(p?.compliance?.validado_em
            ? { compliance_verificado_em: String(p.compliance.validado_em) }
            : {}),
        },
        { onConflict: "provider,external_id" },
      );
      return error
        ? { ok: false, erro: error.message, tabela: "ads" }
        : { ok: true, tabela: "ads" };
    }

    if (acao === "ajustar_posicionamentos_do_conjunto") {
      const { error } = await supa
        .from("ad_sets")
        .update({
          status: statusMeta.toUpperCase(),
          targeting: objeto?.targeting ?? p?.targeting_aprovado ?? null,
        })
        .eq("company_id", companyId)
        .eq("provider", "meta_ads")
        .eq("external_id", novoId);
      return error
        ? { ok: false, erro: error.message, tabela: "ad_sets" }
        : { ok: true, tabela: "ad_sets" };
    }

    return { ok: false, erro: `acao sem regra de espelho: ${acao}` };
  } catch (e) {
    return { ok: false, erro: String(e) };
  }
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return json({ error: "POST only" }, 405);
  if (empresasComTokenAds().length === 0) {
    return json({ error: "nenhum META_ADS_TOKEN* configurado para empresas Meta" }, 500);
  }
  const auth = await mcpKeyValida(supa, chaveMcpDe(req, "header-only"));
  if (!auth.ok) return json({ error: "unauthorized", motivo: auth.motivo }, 401);

  let body: any = {};
  try {
    body = await req.json();
  } catch {
    /* */
  }
  const onlyId: string | null = body?.approval_id ?? null;

  // v5.49: corrige daily_budget 100x (centavos enviados como reais). So altera se o valor
  // atual na Graph for exatamente alvo*100 (ex.: pediu R$ 30, gravou 300000 centavos).
  if (body?.modo === "corrigir_orcamento_adsets") {
    const companyId = String(body?.company_id ?? "").trim();
    const reais = Number(body?.reais ?? 0);
    const ids = (Array.isArray(body?.adset_external_ids) ? body.adset_external_ids : [])
      .map((x: unknown) => String(x ?? "").trim())
      .filter(Boolean);
    if (!companyId) return json({ error: "company_id obrigatorio" }, 400);
    if (!(reais > 0) || reais > 500) return json({ error: "reais invalido (teto 500 neste modo)" }, 400);
    if (!ids.length) return json({ error: "adset_external_ids vazio" }, 400);
    const ativ = ativarTokenEmpresa(companyId);
    if (!ativ.ok) return json({ error: ativ.motivo }, 400);
    const centavosAlvo = Math.round(reais * 100);
    const centavosErrados100x = centavosAlvo * 100;
    const resultados: Record<string, unknown>[] = [];
    for (const adsetId of ids) {
      const antes = await g(`/${adsetId}?fields=id,name,daily_budget,status,effective_status`);
      const atual = Number((antes.body as { daily_budget?: string | number })?.daily_budget ?? NaN);
      const nome = String((antes.body as { name?: string })?.name ?? "");
      if (antes.status !== 200) {
        resultados.push({ adset_id: adsetId, ok: false, motivo: "leitura_graph_falhou", graph: antes });
        continue;
      }
      if (atual === centavosAlvo) {
        await supa.from("ad_sets").update({ daily_budget: centavosAlvo })
          .eq("company_id", companyId).eq("external_id", adsetId);
        resultados.push({ adset_id: adsetId, nome, ok: true, acao: "ja_estava_certo", daily_budget: atual });
        continue;
      }
      if (atual !== centavosErrados100x) {
        resultados.push({
          adset_id: adsetId,
          nome,
          ok: false,
          motivo: "orcamento_atual_nao_e_100x_do_alvo",
          daily_budget_atual: atual,
          esperado_errado: centavosErrados100x,
          alvo: centavosAlvo,
        });
        continue;
      }
      const patch = await g(`/${adsetId}`, "POST", { daily_budget: String(centavosAlvo) });
      if (patch.status !== 200) {
        resultados.push({ adset_id: adsetId, nome, ok: false, motivo: "patch_falhou", graph: patch });
        continue;
      }
      await supa.from("ad_sets").update({ daily_budget: centavosAlvo })
        .eq("company_id", companyId).eq("external_id", adsetId);
      resultados.push({ adset_id: adsetId, nome, ok: true, acao: "corrigido", de: atual, para: centavosAlvo });
    }
    return json({
      ok: resultados.every((r) => r.ok === true),
      modo: "corrigir_orcamento_adsets",
      reais,
      centavos_alvo: centavosAlvo,
      resultados,
    });
  }

  // v5.42: troca o WhatsApp do conjunto CTWA (Gerenciador trava o campo apos criar ads).
  // Tenta formatos Graph + pausa temporaria do conjunto se o PATCH direto falhar.
  if (body?.modo === "definir_whatsapp_conjunto") {
    const companyId = String(body?.company_id ?? "57f755b9-c23d-4f58-a488-8173d697c010").trim();
    const adsetId = String(body?.adset_external_id ?? "120249671521030182").trim();
    const pageId = String(body?.page_id ?? "105656372312257").trim();
    let wa = digitosWhatsApp(body?.whatsapp_phone_number ?? "71991088073");
    if (wa && wa.length === 11 && wa.startsWith("71")) wa = `55${wa}`;
    if (wa && wa.length === 10 && wa.startsWith("71")) wa = `55${wa}`;
    const ativ = ativarTokenEmpresa(companyId);
    if (!ativ.ok) return json({ error: ativ.motivo }, 400);
    if (!wa) return json({ error: "whatsapp_phone_number invalido" }, 400);

    const antes = await g(
      `/${adsetId}?fields=id,name,status,effective_status,destination_type,optimization_goal,promoted_object`,
    );
    const pageWa = await g(
      `/${pageId}?fields=id,name,whatsapp_number,whatsapp_business_account`,
    );

    const candidatos = Array.from(
      new Set([
        wa,
        wa.startsWith("55") ? `+${wa}` : `+55${wa}`,
        wa.startsWith("55") ? wa.slice(2) : wa,
      ]),
    );
    const tentativas: any[] = [];
    let ok = false;
    let promovido: Record<string, unknown> | null = null;
    const statusAntes = String((antes.body as any)?.status ?? "ACTIVE").toUpperCase();

    const tentarPatch = async (digits: string, extra?: Record<string, string>) => {
      const po = JSON.stringify({ page_id: pageId, whatsapp_phone_number: digits });
      const r = await g(`/${adsetId}`, "POST", { promoted_object: po, ...(extra ?? {}) });
      tentativas.push({ digits, extra: extra ?? null, status: r.status, body: r.body });
      return r;
    };

    for (const digits of candidatos) {
      const r = await tentarPatch(digits);
      if (r.status === 200) {
        ok = true;
        promovido = { page_id: pageId, whatsapp_phone_number: digits };
        break;
      }
    }

    let pausou = false;
    if (!ok && statusAntes === "ACTIVE") {
      const pause = await g(`/${adsetId}`, "POST", { status: "PAUSED" });
      tentativas.push({ etapa: "pausar_conjunto", status: pause.status, body: pause.body });
      if (pause.status === 200) {
        pausou = true;
        for (const digits of candidatos) {
          const r = await tentarPatch(digits);
          if (r.status === 200) {
            ok = true;
            promovido = { page_id: pageId, whatsapp_phone_number: digits };
            break;
          }
        }
        const reativa = await g(`/${adsetId}`, "POST", { status: "ACTIVE" });
        tentativas.push({ etapa: "reativar_conjunto", status: reativa.status, body: reativa.body });
      }
    }

    if (!ok) {
      const adsPause = ["120249679551570182", "120249679554680182", "120249679565490182"];
      for (const adId of adsPause) {
        const pAd = await g(`/${adId}`, "POST", { status: "PAUSED" });
        tentativas.push({ etapa: "pausar_anuncio", ad_id: adId, status: pAd.status, body: pAd.body });
      }
      for (const digits of candidatos) {
        const r = await tentarPatch(digits);
        if (r.status === 200) {
          ok = true;
          promovido = { page_id: pageId, whatsapp_phone_number: digits };
          break;
        }
      }
      for (const adId of adsPause) {
        const rAd = await g(`/${adId}`, "POST", { status: "ACTIVE" });
        tentativas.push({ etapa: "reativar_anuncio", ad_id: adId, status: rAd.status, body: rAd.body });
      }
    }

    let clone: any = null;
    if (!ok) {
      const conta = String(body?.ad_account ?? "act_1622612945584817").trim();
      const origem = await g(
        `/${adsetId}?fields=id,name,campaign_id,daily_budget,lifetime_budget,billing_event,optimization_goal,bid_strategy,targeting,destination_type,is_dynamic_creative,start_time,dsa_beneficiary,dsa_payor`,
      );
      const o = origem.body as any;
      const nomeClone = `${String(o?.name ?? "JURIDICO_CONJ.01")} - WA 99108`;
      const po = JSON.stringify({ page_id: pageId, whatsapp_phone_number: wa });
      const createBody: Record<string, string> = {
        name: nomeClone,
        campaign_id: String(o?.campaign_id ?? ""),
        billing_event: String(o?.billing_event ?? "IMPRESSIONS"),
        optimization_goal: String(o?.optimization_goal ?? "CONVERSATIONS"),
        bid_strategy: String(o?.bid_strategy ?? "LOWEST_COST_WITHOUT_CAP"),
        destination_type: "WHATSAPP",
        promoted_object: po,
        status: "ACTIVE",
      };
      if (o?.daily_budget) createBody.daily_budget = String(o.daily_budget);
      if (o?.targeting) createBody.targeting = JSON.stringify(o.targeting);
      if (o?.is_dynamic_creative === false) createBody.is_dynamic_creative = "false";
      const criado = await g(`/${conta}/adsets`, "POST", createBody);
      tentativas.push({ etapa: "clonar_conjunto", status: criado.status, body: criado.body });
      const novoId = String((criado.body as any)?.id ?? "").trim();
      clone = { create: criado.body, novo_id: novoId || null, ads: [] as any[] };
      if (criado.status === 200 && novoId) {
        ok = true;
        promovido = { page_id: pageId, whatsapp_phone_number: wa };
        const { data: adsOrig } = await supa
          .from("ads")
          .select("external_id,name,creative_id,status")
          .eq("company_id", companyId)
          .eq("adset_external_id", adsetId);
        for (const ad of adsOrig ?? []) {
          const cr = String((ad as any).creative_id ?? "").trim();
          const nm = String((ad as any).name ?? "").trim();
          if (!cr) {
            clone.ads.push({ name: nm, ok: false, erro: "sem_creative_id" });
            continue;
          }
          const novoAd = await g(`/${conta}/ads`, "POST", {
            name: nm,
            adset_id: novoId,
            status: "ACTIVE",
            creative: JSON.stringify({ creative_id: cr }),
          });
          clone.ads.push({ name: nm, status: novoAd.status, body: novoAd.body });
        }
        const pauseOld = await g(`/${adsetId}`, "POST", { status: "PAUSED" });
        tentativas.push({ etapa: "pausar_conjunto_antigo", status: pauseOld.status, body: pauseOld.body });
        await supa.from("ad_sets").update({ status: "PAUSED" }).eq("company_id", companyId).eq("external_id", adsetId);
      }
    }

    if (ok && promovido && !clone?.novo_id) {
      await supa
        .from("ad_sets")
        .update({ promoted_object: promovido })
        .eq("company_id", companyId)
        .eq("external_id", adsetId);
    }

    const depois = await g(
      `/${adsetId}?fields=id,name,status,effective_status,destination_type,promoted_object`,
    );
    const cloneLido = clone?.novo_id
      ? await g(`/${clone.novo_id}?fields=id,name,status,destination_type,promoted_object,daily_budget`)
      : null;
    return json({
      ok,
      modo: "definir_whatsapp_conjunto",
      whatsapp_pedido: wa,
      pausou_temporariamente: pausou,
      promovido,
      clone,
      clone_lido: cloneLido?.body ?? null,
      antes: antes.body,
      depois: depois.body,
      page_whatsapp: pageWa.body,
      tentativas,
      nota: ok
        ? (clone?.novo_id
          ? `Conjunto original nao aceita troca de WhatsApp. Clone ativo ${clone.novo_id} com ${wa}; original pausado.`
          : "Numero gravado no promoted_object do conjunto. Atualize o Gerenciador.")
        : "Meta recusou PATCH e tambem a criacao do clone com esse WhatsApp.",
    }, ok ? 200 : 502);
  }

  // v5.41: repara anuncios CTWA ja criados com CONTACT_US+wa.me (erro de apresentacao).
  // Atualiza promoted_object do conjunto + troca o creative_id de cada anuncio.
  if (body?.modo === "reparar_criativos_ctwa") {
    const companyId = String(body?.company_id ?? "57f755b9-c23d-4f58-a488-8173d697c010").trim();
    const adsetId = String(body?.adset_external_id ?? "120249671521030182").trim();
    const pageId = String(body?.page_id ?? "105656372312257").trim();
    const conta = String(body?.ad_account ?? "act_1622612945584817").trim();
    const waDigits = digitosWhatsApp(
      body?.whatsapp_phone_number ?? "5571991088073",
    );
    const adsIn: Array<{ ad_id: string; video_id?: string; message?: string; name?: string }> =
      Array.isArray(body?.ads) ? body.ads : [];
    const ativ = ativarTokenEmpresa(companyId);
    if (!ativ.ok) return json({ error: ativ.motivo }, 400);
    if (!waDigits) return json({ error: "whatsapp_phone_number invalido" }, 400);

    // Conjunto com anuncios ACTIVE: Meta costuma recusar PATCH de promoted_object
    // (OAuthException #1). Nao e bloqueante — o erro de apresentacao e o CTA do criativo.
    let adsetPatch: { ok: boolean; detalhe?: unknown } = { ok: true };
    const pularAdset = body?.pular_update_adset === true;
    if (!pularAdset) {
      const po = JSON.stringify({ page_id: pageId, whatsapp_phone_number: waDigits });
      const upSet = await g(`/${adsetId}`, "POST", { promoted_object: po });
      if (upSet.status !== 200) {
        adsetPatch = { ok: false, detalhe: upSet.body };
      } else {
        await supa
          .from("ad_sets")
          .update({ promoted_object: { page_id: pageId, whatsapp_phone_number: waDigits } })
          .eq("company_id", companyId)
          .eq("external_id", adsetId);
      }
    } else {
      adsetPatch = { ok: false, detalhe: "pular_update_adset" };
    }

    const defaultsAds = [
      {
        ad_id: "120249679551570182",
        video_id: "1381748604048455",
        name: "JUR_CONV_AD01_Conta_de_Luz",
      },
      {
        ad_id: "120249679554680182",
        video_id: "28244288615228272",
        name: "JUR_CONV_AD02_Devolucao_Valores",
      },
      {
        ad_id: "120249679565490182",
        video_id: "1057599636987596",
        name: "JUR_CONV_AD03_Emprestimo_sobre_Emprestimo",
      },
    ];
    const lista = adsIn.length ? adsIn : defaultsAds;
    const resultados: any[] = [];

    for (const item of lista) {
      const adId = String(item.ad_id ?? "").trim();
      if (!adId) continue;
      // Le creative atual para message / video / thumbnail.
      const adLido = await g(
        `/${adId}?fields=id,name,creative{id,object_story_spec,body}`,
      );
      const creativeAtual = (adLido.body as any)?.creative ?? {};
      const specAtual = creativeAtual?.object_story_spec ?? {};
      const vdAtual = specAtual?.video_data ?? {};
      const videoId = String(item.video_id ?? vdAtual?.video_id ?? "").trim();
      const message = String(
        (item as { message?: string }).message ?? vdAtual?.message ?? creativeAtual?.body ?? "",
      ).trim();
      const imageUrl = String(vdAtual?.image_url ?? vdAtual?.image_hash ?? "").trim();
      if (!videoId) {
        resultados.push({ ad_id: adId, ok: false, erro: "video_id_ausente" });
        continue;
      }
      let thumb = imageUrl;
      if (!thumb || !/^https?:/i.test(thumb)) {
        const th = await escolherThumbnail(videoId, "");
        if (th.erro || !th.url) {
          resultados.push({ ad_id: adId, ok: false, erro: th.erro ?? "thumbnail_ausente" });
          continue;
        }
        thumb = th.url;
      }
      const cta = ctaValueCtwa("WHATSAPP_MESSAGE");
      const novoSpec = {
        page_id: pageId,
        video_data: sanitizarVideoDataParaGraph({
          video_id: videoId,
          image_url: thumb,
          message: message || String((adLido.body as any)?.name ?? "CTWA"),
          call_to_action: cta,
        }),
      };
      const nomeAd = String(item.name ?? (adLido.body as any)?.name ?? adId);
      const cc = await g(`/${conta}/adcreatives`, "POST", {
        name: `${nomeAd} - creative CTWA fix`,
        object_story_spec: JSON.stringify(novoSpec),
      });
      const creativeId = String((cc.body as any)?.id ?? "").trim();
      if (cc.status !== 200 || !creativeId) {
        resultados.push({ ad_id: adId, ok: false, etapa: "adcreative", detalhe: cc.body });
        continue;
      }
      const upAd = await g(`/${adId}`, "POST", {
        creative: JSON.stringify({ creative_id: creativeId }),
      });
      if (upAd.status !== 200) {
        resultados.push({
          ad_id: adId,
          ok: false,
          etapa: "update_ad",
          creative_id: creativeId,
          detalhe: upAd.body,
        });
        continue;
      }
      await supa
        .from("ads")
        .update({
          creative_id: creativeId,
          call_to_action_type: "WHATSAPP_MESSAGE",
          destino_url: LINK_CTWA_API_WHATSAPP,
          destination_url: LINK_CTWA_API_WHATSAPP,
        })
        .eq("company_id", companyId)
        .eq("external_id", adId);
      resultados.push({
        ad_id: adId,
        ok: true,
        creative_id: creativeId,
        name: nomeAd,
        whatsapp_phone_number: waDigits,
      });
    }

    const okTodos = resultados.length > 0 && resultados.every((x) => x.ok);
    return json({
      ok: okTodos,
      modo: "reparar_criativos_ctwa",
      adset_id: adsetId,
      adset_patch: adsetPatch,
      whatsapp_phone_number: waDigits,
      resultados,
      mcp_chamador: auth.chamador,
      nota:
        "Conjunto CTWA usa UM numero no promoted_object. Numeros distintos por peca exigem conjuntos separados. " +
        "Se adset_patch.ok=false, o conjunto ficou como estava; os criativos novos usam WHATSAPP_MESSAGE + api.whatsapp.com/send. " +
        "Aguarde alguns minutos e confira no Gerenciador se o erro de apresentacao sumiu.",
    });
  }

  // Sonda SOMENTE LEITURA: inventario Graph da Pagina vs conjuntos CTWA que entregam.
  // Nao cria conjunto, nao envia SMS, nao chama page_whatsapp_number_verification.
  if (body?.modo === "sonda_whatsapp_pagina") {
    const companyId = String(body?.company_id ?? COMPANY_COHAPM).trim();
    const pageId = String(body?.page_id ?? "105656372312257").trim();
    const ativ = ativarTokenEmpresa(companyId);
    if (!ativ.ok) return json({ error: ativ.motivo }, 400);
    const wabaTok = tokenWabaPorCompanyId(companyId);
    const gAds = criarGraphClient(TOKEN);
    const gWaba = wabaTok ? criarGraphClient(wabaTok.token) : null;
    const listed = await listarWhatsAppDaPagina({
      gAds,
      gWaba,
      pageId,
      companyId,
      businessId: businessIdPorCompanyId(companyId),
      supa,
    });
    const pageMeta = await g(`/${pageId}?metadata=1`);
    const fields = (pageMeta.body as any)?.metadata?.fields ?? (pageMeta.body as any)?.data ?? [];
    const camposWa = (Array.isArray(fields) ? fields : [])
      .map((f: any) => String(f?.name ?? f ?? ""))
      .filter((n: string) => /whatsapp|phone|messag/i.test(n))
      .slice(0, 80);
    const pageLive = await g(`/${pageId}?fields=id,name,whatsapp_number,has_whatsapp_number`);
    const wabasPage = await g(
      `/${pageId}/whatsapp_business_accounts?fields=id,name,phone_numbers{id,display_phone_number,verified_name,status,platform_type}&limit=25`,
    );
    const jur = await g(
      `/120249788959090182?fields=id,name,status,destination_type,optimization_goal,promoted_object,campaign{id,name,objective}`,
    );
    const laf3 = await g(
      `/120249788962200182?fields=id,name,status,destination_type,optimization_goal,promoted_object`,
    );
    const recentes = await g(
      `/act_1622612945584817/adsets?fields=id,name,created_time,status,effective_status,destination_type,optimization_goal,promoted_object,campaign{id,name,objective,created_time}&limit=40`,
    );
    const listaRecentes = Array.isArray((recentes.body as any)?.data) ? (recentes.body as any).data : [];
    const hoje = listaRecentes.filter((s: any) => String(s?.created_time ?? "").startsWith("2026-09-01"));
    const conj1 = listaRecentes.filter((s: any) => /conj\.?\s*1|CONJ\.1/i.test(String(s?.name ?? "")));
    const pedidos = Array.isArray(body?.numeros)
      ? (body.numeros as unknown[]).map((x) => String(x))
      : ["557191894229", "557191858107", "557192649576", "557191887731"];
    return json({
      ok: true,
      modo: "sonda_whatsapp_pagina",
      somente_leitura: true,
      page_id: pageId,
      page_live: pageLive.body,
      page_http: pageLive.status,
      campos_whatsapp_na_pagina: camposWa,
      wabas_da_pagina: wabasPage.body,
      inventario: listed,
      conjunto_jur_que_entrega: jur.body,
      conjunto_laf3_sem_phone_id: laf3.body,
      adsets_criados_hoje: hoje,
      adsets_nome_conj1: conj1.slice(0, 8),
      adsets_recentes_http: recentes.status,
      pedidos_vistta: pedidos.map((n) => ({
        pedido: n,
        candidatos: candidatosPromotedObjectCtwa({ pageId, pedido: n, match: null }).slice(0, 6),
      })),
      nota:
        "Destino MANUAL = WHATSAPP (Messenger OFF). Destino AUTOMATICO = Meta escolhe o canal — nao usamos. " +
        "promoted_object.whatsapp_phone_number e DIGITO; display so em texto humano. " +
        "1487246 = driver errado, nao numero errado: graph recusa numero ligado so a Pagina e o pipeboard cria " +
        "(01/09/2026, mesmo payload). Conjunto CTWA sai por driver_por_acao.criar_conjunto_a_partir_de=pipeboard.",
      mcp_chamador: auth.chamador,
    });
  }

  // Sonda SOMENTE LEITURA: prova o schema que o driver Pipeboard realmente expoe antes de
  // declarar uma nova escrita suportada. tools/list nao chama update_adset nem toca a Meta.
  if (body?.modo === "sonda_pipeboard_update_adset") {
    const token = await pipeboardToken(segredoIntegracao);
    const lista = await pipeboardListTools(token);
    const tool = lista.tools.find((t: any) => String(t?.name ?? "") === "update_adset") ?? null;
    const nomes = (lista.tools ?? []).map((t: any) => String(t?.name ?? "")).filter(Boolean);
    const igRelacionadas = (lista.tools ?? []).filter((t: any) =>
      /instagram|identity|actor|page/i.test(String(t?.name ?? "") + " " + String(t?.description ?? "")),
    );
    const waRelacionadas = (lista.tools ?? []).filter((t: any) =>
      /whatsapp|waba|phone_number|account_pages|create_adset|update_adset/i
        .test(String(t?.name ?? "") + " " + String(t?.description ?? "")),
    );
    return json({
      ok: lista.ok && !!tool,
      modo: "sonda_pipeboard_update_adset",
      somente_leitura: true,
      http_status: lista.status,
      update_adset: tool,
      tool_names: nomes,
      tools_instagram_relacionadas: igRelacionadas,
      tools_whatsapp_relacionadas: waRelacionadas.map((t: any) => ({
        name: t?.name,
        description: String(t?.description ?? "").slice(0, 220),
        leitura: /^(get_|list_|search_|estimate_|resolve_|check_|compute_|bulk_get_|fetch$)/.test(String(t?.name ?? "")),
      })),
      erro: lista.erro ?? null,
      mcp_chamador: auth.chamador,
    });
  }
  if (body?.modo === "ler_posicionamentos_conjunto") {
    const adsetId = String(body?.adset_external_id ?? "").trim();
    if (!/^\d+$/.test(adsetId)) {
      return json({ error: "adset_external_id numerico obrigatorio" }, 400);
    }
    const companyId = String(body?.company_id ?? "").trim();
    const adAccount = String(body?.ad_account ?? body?.account_id ?? "").trim();
    const ativ = companyId
      ? ativarTokenEmpresa(companyId)
      : adAccount
      ? ativarTokenPorAdAccount(adAccount)
      : { ok: false as const, motivo: "informe company_id ou ad_account para escolher o token Ads" };
    if (!ativ.ok) return json({ error: ativ.motivo }, 400);
    const lido = await g(`/${adsetId}?fields=id,name,status,effective_status,targeting`);
    return json({
      ok: lido.status === 200,
      modo: "ler_posicionamentos_conjunto",
      somente_leitura: true,
      http_status: lido.status,
      conjunto: lido.body,
      mcp_chamador: auth.chamador,
    });
  }

  // SOMENTE LEITURA: Pipeboard get_instagram_accounts (readOnlyHint=true). Devolve id+username
  // usaveis como instagram_actor_id. Nao escreve na Meta.
  if (body?.modo === "ler_instagram_via_pipeboard") {
    const accountId = String(body?.ad_account ?? "act_3302001729967572").trim();
    const handleBuscado = String(body?.username ?? "").trim().replace(/^@/, "").toLowerCase();
    const token = await pipeboardToken(segredoIntegracao);
    const r = await pipeboardCall("get_instagram_accounts", { account_id: accountId }, token);
    const listaBruta = Array.isArray(r.body)
      ? r.body
      : Array.isArray(r.body?.data)
        ? r.body.data
        : Array.isArray(r.body?.accounts)
          ? r.body.accounts
          : Array.isArray(r.body?.instagram_accounts)
            ? r.body.instagram_accounts
            : [];
    const contas = listaBruta.map((a: any) => ({
      id: a?.id != null ? String(a.id) : null,
      username: a?.username != null ? String(a.username) : null,
      name: a?.name != null ? String(a.name) : null,
      followers_count: a?.followers_count ?? null,
    }));
    const match = handleBuscado
      ? contas.filter((a: any) => String(a.username ?? "").toLowerCase() === handleBuscado)
      : [];
    return json({
      ok: r.ok,
      modo: "ler_instagram_via_pipeboard",
      somente_leitura: true,
      mcp_chamador: auth.chamador,
      account_id: accountId,
      username_buscado: handleBuscado || null,
      contas,
      match_username: match,
      total_reportado: r.body?.total ?? contas.length,
      http_status: r.status,
      erro: r.erro ?? null,
      accounts_tipo: r.body?.accounts == null
        ? "ausente"
        : Array.isArray(r.body.accounts)
          ? `array:${r.body.accounts.length}`
          : typeof r.body.accounts,
      sample_account: Array.isArray(r.body?.accounts) && r.body.accounts[0]
        ? {
          id: r.body.accounts[0]?.id ?? null,
          username: r.body.accounts[0]?.username ?? null,
          keys: Object.keys(r.body.accounts[0] ?? {}),
        }
        : null,
    });
  }
  // assigned). Serve para cravar identidade oficial com username comprovado (ex.: legaleviver_), sem
  // escrever na Meta. Nao toca approval_requests.
  if (body?.modo === "ler_contas_instagram") {
    const adAccount = String(body?.ad_account ?? "act_3302001729967572").trim();
    const pageId = String(body?.page_id ?? "1095196357012756").trim();
    const handleBuscado = String(body?.username ?? "").trim().replace(/^@/, "").toLowerCase();
    const companyIdBody = String(body?.company_id ?? "").trim();
    const ativ = companyIdBody
      ? ativarTokenEmpresa(companyIdBody)
      : ativarTokenPorAdAccount(adAccount);
    if (!ativ.ok) return json({ error: ativ.motivo }, 400);
    const conta = await g(`/${adAccount}?fields=id,name,business`);
    const businessId = (conta.body as any)?.business?.id
      ? String((conta.body as any).business.id)
      : null;
    const caminhos: Record<string, unknown> = {
      ad_account: conta,
      me: await g(`/me?fields=id,name`),
      me_instagram_accounts: await g(`/me/instagram_accounts?fields=id,username,name&limit=50`),
      me_accounts_com_ig: await g(
        `/me/accounts?fields=id,name,access_token,instagram_business_account{id,username,name}&limit=50`,
      ),
      ad_account_instagram_accounts: await g(
        `/${adAccount}/instagram_accounts?fields=id,username,name&limit=50`,
      ),
      ad_account_assigned_instagram_accounts: await g(
        `/${adAccount}/assigned_instagram_accounts?fields=id,username,name&limit=50`,
      ),
      business_id: businessId,
      business_owned_instagram_accounts: businessId
        ? await g(`/${businessId}/owned_instagram_accounts?fields=id,username,name&limit=50`)
        : null,
      business_client_instagram_accounts: businessId
        ? await g(`/${businessId}/client_instagram_accounts?fields=id,username,name&limit=50`)
        : null,
      business_instagram_accounts: businessId
        ? await g(`/${businessId}/instagram_accounts?fields=id,username,name&limit=50`)
        : null,
      page_instagram_accounts: await g(
        `/${pageId}/instagram_accounts?fields=id,username,name&limit=25`,
      ),
      page_page_backed_instagram_accounts: await g(
        `/${pageId}/page_backed_instagram_accounts?fields=id,username,name&limit=25`,
      ),
    };
    const achados: { id: string; username: string | null; name: string | null; origem: string }[] = [];
    // Se /me/accounts trouxe access_token da Pagina, tenta o campo Instagram com o token da
    // Pagina (o token de ads sozinho nao tem pages_read_engagement). O page token NUNCA volta
    // na resposta ao chamador.
    try {
      const pagesBody = (caminhos.me_accounts_com_ig as any)?.body;
      const pages = Array.isArray(pagesBody?.data) ? pagesBody.data : [];
      for (const p of pages) {
        const pageTok = String(p?.access_token ?? "").trim();
        const pid = String(p?.id ?? "").trim();
        if (p && typeof p === "object") delete (p as any).access_token;
        if (!pageTok || !pid) continue;
        const r = await fetch(
          `https://graph.facebook.com/v21.0/${pid}?fields=instagram_business_account{id,username,name},connected_instagram_account{id,username,name}&access_token=${encodeURIComponent(pageTok)}`,
        );
        const t = await r.text();
        let bodyPage: any = t;
        try {
          bodyPage = JSON.parse(t);
        } catch {
          /* */
        }
        caminhos[`page_token_probe_${pid}`] = {
          status: r.status,
          body: bodyPage,
          nota: "lido com page access_token de /me/accounts; token nao e devolvido",
        };
        if (bodyPage?.instagram_business_account?.id) {
          achados.push({
            id: String(bodyPage.instagram_business_account.id),
            username: bodyPage.instagram_business_account.username ?? null,
            name: bodyPage.instagram_business_account.name ?? null,
            origem: `page_token_probe_${pid}.instagram_business_account`,
          });
        }
        if (bodyPage?.connected_instagram_account?.id) {
          achados.push({
            id: String(bodyPage.connected_instagram_account.id),
            username: bodyPage.connected_instagram_account.username ?? null,
            name: bodyPage.connected_instagram_account.name ?? null,
            origem: `page_token_probe_${pid}.connected_instagram_account`,
          });
        }
        // Tambem aproveita o nested ja trazido por /me/accounts (sem segundo GET).
        if (p?.instagram_business_account?.id) {
          achados.push({
            id: String(p.instagram_business_account.id),
            username: p.instagram_business_account.username ?? null,
            name: p.instagram_business_account.name ?? null,
            origem: `me_accounts_com_ig.${pid}`,
          });
        }
      }
    } catch (e) {
      caminhos.page_token_probe_erro = String(e);
    }
    const visitar = (origem: string, bodyResp: any) => {
      const data = bodyResp?.body?.data ?? bodyResp?.data ?? null;
      const lista = Array.isArray(data) ? data : [];
      for (const item of lista) {
        if (!item || typeof item !== "object") continue;
        const id = String((item as any).id ?? "").trim();
        if (!id) continue;
        achados.push({
          id,
          username: (item as any).username != null ? String((item as any).username) : null,
          name: (item as any).name != null ? String((item as any).name) : null,
          origem,
        });
      }
    };
    for (const [k, v] of Object.entries(caminhos)) {
      if (v && typeof v === "object" && "body" in (v as any)) visitar(k, v);
    }
    const unicos = Array.from(new Map(achados.map((a) => [a.id, a])).values());
    const matchHandle = handleBuscado
      ? unicos.filter((a) => String(a.username ?? "").toLowerCase() === handleBuscado)
      : [];
    return json({
      ok: true,
      modo: "ler_contas_instagram",
      somente_leitura: true,
      mcp_chamador: auth.chamador,
      username_buscado: handleBuscado || null,
      contas: unicos,
      match_username: matchHandle,
      caminhos,
    });
  }

  // v5.3: sonda de reconciliacao. Retorna ANTES de tocar a fila, de proposito: com dry_run=false e
  // flags ligadas, uma corrida normal executaria cards aprovados - conferir a conferencia nao pode
  // ter esse efeito colateral.
  if (body?.modo === "sonda_reconciliacao") {
    const companyId = String(body?.company_id ?? "").trim();
    if (!companyId) {
      return json({ error: "sonda_reconciliacao exige company_id (a evidencia e por empresa)" }, 400);
    }
    const ativ = ativarTokenEmpresa(companyId);
    if (!ativ.ok) return json({ error: ativ.motivo }, 400);
    return json({
      ok: true,
      modo: "sonda_reconciliacao",
      mcp_chamador: auth.chamador,
      sonda: await rodarSondaReconciliacao(companyId),
    });
  }

  // v3: a config NAO e mais lida aqui. Cada card carrega a da sua propria empresa, dentro do
  // loop - uma leitura global voltaria a aplicar a configuracao de uma empresa a outra.

  // v5: monitor de conexao Pipeboard (login pessoal). Roda quando ha token; alerta se
  // token_status != active. Nao bloqueia o caminho graph.
  const pbToken = await pipeboardToken(segredoIntegracao);
  let pipeboardMonitor: ConexaoPipeboard | null = null;
  if (pbToken) pipeboardMonitor = await monitorConexaoPipeboard(pbToken);

  let q = supa
    .from("approval_requests")
    .select("*")
    .eq("status", "approved")
    .is("executed_at", null);
  if (onlyId) q = q.eq("id", onlyId);
  const { data: fila } = await q.order("created_at", { ascending: true }).limit(10);
  if (!fila?.length)
    return json({
      ok: true,
      processados: 0,
      nota: "fila vazia (nenhum aprovado pendente de execução)",
      pipeboard_conexao: pipeboardMonitor ?? {
        ok: false,
        token_status: null,
        connection_id: null,
        alerta:
          "PIPEBOARD_API_TOKEN ausente — monitor e driver pipeboard indisponiveis ate cadastrar o Edge Secret",
        erro: "token_ausente",
      },
      versao: "meta-actions-v5",
      mcp_chamador: auth.chamador,
      mcp_chave_legada: auth.legado,
    });

  // Teto por EMPRESA (alinha com contar_acoes_na_hora / pode_executar_acao). Contagem
  // global misturava empresas e podia barrar slate de uma por causa de outra.
  const executadasNaHoraPorEmpresa = new Map<string, number>();

  const resultados: any[] = [];
  for (const r of fila) {
    const acao = String(r.action);
    const alvoExt = String(r.payload?.target_external_id ?? "");
    const alvoNome = String(r.payload?.target_name ?? r.summary);
    const sistema = r.reviewed_by ?? r.requested_by;

    // Token Ads DA EMPRESA DESTE CARD — se COHAPM sem secret, bloqueia (nao usa Legal).
    const ativTok = ativarTokenEmpresa(r.company_id);
    if (!ativTok.ok) {
      await audit(r.company_id, sistema, "meta_action_blocked", r.id, {
        motivo: ativTok.motivo,
        acao,
      });
      resultados.push({
        id: r.id,
        acao,
        resultado: "bloqueado",
        motivo: ativTok.motivo,
      });
      continue;
    }

    // v3: config DA EMPRESA DESTE CARD. Sem linha propria, nada executa.
    const { data: conf } = await supa
      .from("meta_execution_config")
      .select("*")
      .eq("company_id", r.company_id)
      .maybeSingle();
    if (!conf) {
      await audit(r.company_id, sistema, "meta_action_blocked", r.id, {
        motivo: "empresa sem configuracao de execucao propria",
        acao,
      });
      resultados.push({
        id: r.id,
        acao,
        resultado: "bloqueado",
        motivo: "empresa sem configuracao de execucao - nada e executado sem config propria",
      });
      continue;
    }
    if (!executadasNaHoraPorEmpresa.has(r.company_id)) {
      const { count: naHoraEmpresa } = await supa
        .from("audit_log")
        .select("id", { count: "exact", head: true })
        .eq("company_id", r.company_id)
        .eq("action", "meta_action_executed")
        .gte("created_at", new Date(Date.now() - 3600e3).toISOString());
      executadasNaHoraPorEmpresa.set(r.company_id, naHoraEmpresa ?? 0);
    }
    let executadasNaHora = executadasNaHoraPorEmpresa.get(r.company_id) ?? 0;
    const contasOk: string[] = (conf.contas_permitidas_criacao ?? []).map((x: string) => actId(x));
    const tetoSanidade = Number(conf.teto_sanidade_orcamento_diario ?? 5000);
    const flagsOk = conf.master_enabled === true && conf.action_flags?.[acao] === true;
    const rateOk = executadasNaHora < conf.max_actions_per_hour;
    // v5/ESP-29: driver resolvido POR ACAO — override (driver_por_acao) > empresa
    // (driver_escrita) > graph, mesmo criterio de resolver_driver/pode_executar_acao.
    // Diz por ONDE o ultimo passo sai, nunca SE sai.
    const driver = driverParaAcao(conf, acao);

    // ==================== CAMINHO DE CRIACAO (v2) ====================
    if (CRIACAO.includes(acao)) {
      // v2: expiracao - cards vencidos ja viram 'rejected' pelo cron, mas checamos de novo
      // porque aprovacao antiga executando contra conta mudada e o risco que motivou o prazo.
      if (r.expires_at && new Date(r.expires_at) < new Date()) {
        await audit(r.company_id, sistema, "meta_action_blocked", r.id, {
          motivo: "pedido expirado",
          acao,
          prazo: r.expires_at,
          driver_escrita: driver,
        });
        resultados.push({
          id: r.id,
          acao,
          resultado: "bloqueado",
          motivo: "pedido expirado (24h)",
          driver_escrita: driver,
        });
        continue;
      }

      const conta = actId(String(r.payload?.conta_destino ?? ""));
      if (!contasOk.length || !contasOk.includes(conta)) {
        const motivo = `conta de destino ${conta || "(vazia)"} nao esta na lista de contas permitidas para criacao`;
        await audit(r.company_id, sistema, "meta_action_blocked", r.id, {
          motivo,
          acao,
          contas_permitidas: contasOk,
          driver_escrita: driver,
        });
        resultados.push({ id: r.id, acao, resultado: "bloqueado", motivo, driver_escrita: driver });
        continue;
      }

      // v28.11 (06/08/2026) - PECA EM REVISAO DE COMPLIANCE E IMPEDIMENTO, TAMBEM AQUI.
      // pedido_de_anuncio_completo passou a recusar antes de existir card, mas este gate existe
      // porque tres caminhos furam o de cima: card emitido ANTES desta correcao, pedido montado
      // por fora do traffic-chat, e peca escalada DEPOIS da aprovacao e antes da execucao. O
      // ultimo passo e o que gasta, e e o unico lugar onde nada mais vem depois.
      // Vale inclusive em dry_run, de proposito: gate que a simulacao atravessa nao e gate, e o
      // dry_run e justamente onde se conferiria que ele pega.
      // A doutrina fica na RPC (peca_bloqueada_por_revisao), a mesma que a verificacao do pedido
      // usa - reescreve-la aqui seria a mesma regra em dois lugares, divergindo com o tempo.
      if (acao === "criar_anuncio_a_partir_de") {
        const { data: bloq, error: bloqErr } = await supa.rpc("peca_bloqueada_por_revisao", {
          p_company_id: r.company_id,
          p_drive_file_id: r.payload?.drive_file_id ?? null,
          p_meta_video_id: r.payload?.meta_video_id ?? null,
          p_meta_image_hash: r.payload?.meta_image_hash ?? null,
        });
        // Verificador que nao respondeu nao liberou nada: sem resposta, nao executa.
        const indisponivel = !!bloqErr || !bloq;
        if (indisponivel || (bloq as any).bloqueada === true) {
          const motivo = indisponivel
            ? `verificacao_de_peca_em_revisao_indisponivel (${bloqErr?.message ?? "resposta vazia"})`
            : "peca_em_revisao_bloqueia_uso";
          await audit(r.company_id, sistema, "meta_action_blocked", r.id, {
            motivo,
            acao,
            driver_escrita: driver,
            dry_run: conf.dry_run === true,
            peca_em_revisao: bloq ?? null,
          });
          resultados.push({
            id: r.id,
            acao,
            resultado: "bloqueado",
            motivo: (bloq as any)?.mensagem ?? motivo,
            driver_escrita: driver,
          });
          continue;
        }
      }

      // v5.5 (07/08/2026) - PAR LEGENDA+PECA REPROVADO E IMPEDIMENTO, TAMBEM AQUI. Espelha o gate
      // de peca em revisao logo acima e pela mesma razao: pedido_de_anuncio_completo passou a CHAMAR
      // checar_par_texto_e_peca na emissao e recusar em reprova, mas tres caminhos furam o de cima -
      // card emitido ANTES desta correcao, pedido montado por fora do traffic-chat, e legenda ou peca
      // trocada DEPOIS da aprovacao. O ultimo passo e o que gasta. So bloqueia quando existem OS DOIS
      // lados (legenda e peca com texto lido) e o veredito e 'reprova'; falta de um lado NAO bloqueia
      // aqui (nao se inventa recusa por ausencia). A doutrina fica na RPC - a mesma que a emissao usa.
      if (
        acao === "criar_anuncio_a_partir_de" &&
        r.payload?.drive_file_id &&
        String(r.payload?.legenda ?? "").trim()
      ) {
        const { data: par, error: parErr } = await supa.rpc("checar_par_texto_e_peca", {
          p_company_id: r.company_id,
          p_legenda: String(r.payload.legenda),
          p_drive_file_id: String(r.payload.drive_file_id),
        });
        const cob = (par as any)?.cobertura ?? {};
        const doisLados = cob?.peca_encontrada === true && cob?.texto_da_peca_lido === true;
        // Verificador que nao respondeu nao liberou nada: fail-closed, como o gate de revisao.
        if (parErr || !par) {
          const motivo = `verificacao_do_par_texto_e_peca_indisponivel (${parErr?.message ?? "resposta vazia"})`;
          await audit(r.company_id, sistema, "meta_action_blocked", r.id, {
            motivo,
            acao,
            driver_escrita: driver,
            dry_run: conf.dry_run === true,
          });
          resultados.push({ id: r.id, acao, resultado: "bloqueado", motivo, driver_escrita: driver });
          continue;
        }
        if (doisLados && (par as any).veredito === "reprova") {
          const motivo = "par_texto_e_peca_reprova";
          const detalhe =
            "O PAR legenda+peca reprovou no compliance de texto: a peca MOSTRA valor/taxa/prazo na tela e a legenda da publicacao nao traz o CET nem referencia de consulta. O card NAO foi executado. Aceito: 'consulte o CET na sua simulacao' (ou CET numerico oficial). Percentual de CET NAO e obrigatorio.";
          await audit(r.company_id, sistema, "meta_action_blocked", r.id, {
            motivo,
            detalhe,
            acao,
            driver_escrita: driver,
            dry_run: conf.dry_run === true,
            par_texto_e_peca: par,
          });
          resultados.push({ id: r.id, acao, resultado: "bloqueado", motivo: detalhe, driver_escrita: driver });
          continue;
        }
      }

      if (driver === "pipeboard" && pipeboardMonitor && !pipeboardMonitor.ok) {
        await audit(r.company_id, sistema, "meta_action_blocked", r.id, {
          motivo: "pipeboard_conexao_inativa",
          alerta: pipeboardMonitor.alerta,
          token_status: pipeboardMonitor.token_status,
          acao,
          driver_escrita: driver,
        });
        resultados.push({
          id: r.id,
          acao,
          resultado: "bloqueado",
          motivo: pipeboardMonitor.alerta ?? "pipeboard_conexao_inativa",
          driver_escrita: driver,
        });
        continue;
      }
      if (driver === "pipeboard" && !pbToken) {
        await audit(r.company_id, sistema, "meta_action_blocked", r.id, {
          motivo: "PIPEBOARD_API_TOKEN ausente",
          acao,
          driver_escrita: driver,
        });
        resultados.push({
          id: r.id,
          acao,
          resultado: "bloqueado",
          motivo:
            "PIPEBOARD_API_TOKEN ausente — cadastre o Edge Secret antes de usar driver pipeboard",
          driver_escrita: driver,
        });
        continue;
      }

      const plano = await montarCriacao(acao, r.payload, conta, tetoSanidade, String(r.company_id ?? ""));
      if ((plano as any).erro) {
        await audit(r.company_id, sistema, "meta_action_failed", r.id, {
          motivo: (plano as any).erro,
          detalhe: (plano as any).detalhe ?? null,
          // "recusa_do_proprio_sistema" distingue, no card, o "nao" que NOS demos - antes de
          // qualquer chamada - do "nao" que veio da plataforma. Os dois sao falha; so um deles
          // significa que a Meta chegou a ser consultada.
          etapa: "recusa_do_proprio_sistema",
          acao,
          driver_escrita: driver,
        });
        resultados.push({
          id: r.id,
          acao,
          resultado: "falha",
          motivo: (plano as any).erro,
          driver_escrita: driver,
        });
        continue;
      }
      const pl: any = plano;

      if (conf.dry_run) {
        // v5: com pipeboard + dry_run, campanha chega ao conector (dry_run nativo).
        // Demais niveis: simulacao local + lacuna declarada (5.1).
        let ensaioPipeboard: ResultadoEscrita | null = null;
        if (driver === "pipeboard" && acao === "criar_campanha") {
          ensaioPipeboard = await escreverCriacao(driver, acao, conta, pl.path, pl.body, pbToken, {
            dry_run: true,
          });
        }
        await audit(r.company_id, sistema, "meta_action_dry_run", r.id, {
          SIMULADO: true,
          acao,
          conta,
          driver_escrita: driver,
          criaria_em: pl.path,
          com_body: pl.body,
          criativo: pl.criativo ?? null,
          molde_lido: pl.molde_lido ?? null,
          peca_nova: pl.peca_nova ?? null,
          pipeboard_dry_run_nativo: ensaioPipeboard?.dry_run_nativo ?? null,
          pipeboard_resposta: ensaioPipeboard?.body ?? null,
          pipeboard_nota:
            ensaioPipeboard?.nota_dry_run ??
            (driver === "pipeboard" && acao !== "criar_campanha"
              ? "dry_run nativo so em create_campaign/update_campaign; neste nivel a simulacao e local"
              : null),
          pipeboard_conexao: pipeboardMonitor,
          flags_permitiriam: {
            master: conf.master_enabled,
            flag_acao: conf.action_flags?.[acao] === true,
            rate_ok: rateOk,
          },
          nota: "dry_run=true: NADA foi criado na Meta; executed_at NÃO preenchido",
        });
        resultados.push({
          id: r.id,
          acao,
          resultado: "SIMULADO",
          conta,
          driver_escrita: driver,
          criaria_em: pl.path,
          nome_novo: pl.body?.name,
          status_inicial: pl.body?.status,
          criativo_modo: pl.criativo?.modo ?? null,
          criativo_aviso: pl.criativo?.aviso ?? null,
          peca_nova: pl.peca_nova ?? null,
          flags_permitiriam: flagsOk && rateOk,
          pipeboard_dry_run_nativo: ensaioPipeboard?.dry_run_nativo ?? null,
        });
        continue;
      }

      if (!flagsOk || !rateOk) {
        const motivo = !conf.master_enabled
          ? "master_enabled=false"
          : conf.action_flags?.[acao] !== true
            ? `flag ${acao}=false`
            : "rate limit atingido";
        await audit(r.company_id, sistema, "meta_action_blocked", r.id, {
          motivo,
          acao,
          driver_escrita: driver,
        });
        resultados.push({ id: r.id, acao, resultado: "bloqueado", motivo, driver_escrita: driver });
        continue;
      }

      // Um anuncio substituto pode depender de um ajuste sancionado no MESMO conjunto. Nao
      // contornamos a aprovacao da outra acao: o card de criacao so executa depois que o card
      // referenciado foi aprovado, executado e reconciliado com sucesso.
      if (acao === "criar_anuncio_a_partir_de" && r.payload?.depende_de_approval_id) {
        const dependenciaId = String(r.payload.depende_de_approval_id);
        const { data: dep } = await supa
          .from("approval_requests")
          .select("status,executed_at,execution_result,action,company_id")
          .eq("id", dependenciaId)
          .eq("company_id", r.company_id)
          .maybeSingle();
        const depOk =
          dep?.action === "ajustar_posicionamentos_do_conjunto" &&
          !!dep?.executed_at &&
          dep?.execution_result?.ok === true &&
          dep?.execution_result?.reconciliacao_conferida === true;
        if (!depOk) {
          const motivo = "ajuste_de_posicionamento_ainda_nao_executado_e_reconciliado";
          await audit(r.company_id, sistema, "meta_action_blocked", r.id, {
            motivo,
            acao,
            depende_de_approval_id: dependenciaId,
            dependencia: dep ?? null,
            driver_escrita: driver,
          });
          resultados.push({
            id: r.id,
            acao,
            resultado: "bloqueado",
            motivo,
            depende_de_approval_id: dependenciaId,
            driver_escrita: driver,
          });
          continue;
        }
      }

      // Passo previo: criar adcreative novo (so no caso do anuncio com object_story_spec).
      const bodyFinal: Record<string, string> = { ...pl.body };
      let creativeCriado: any = null;

      // v5.41: CTWA — garantir whatsapp_phone_number no conjunto ANTES do adcreative.
      const patchCtwa = pl.ctwa_promoted_patch as
        | { adset_id?: string; page_id?: string; whatsapp_phone_number?: string }
        | null
        | undefined;
      if (patchCtwa?.adset_id && patchCtwa.whatsapp_phone_number && patchCtwa.page_id) {
        const alvoPo = {
          page_id: String(patchCtwa.page_id),
          whatsapp_phone_number: String(patchCtwa.whatsapp_phone_number),
        };
        // v5.59: NAO reescrever o que ja esta certo. Conjunto CTWA nascido pelo Pipeboard
        // ja tem o numero, e o PATCH da Graph em promoted_object devolve OAuthException #1
        // nesses conjuntos (medido 01/09/2026 nos anuncios do CONJ.1_VISTTA: os dois cards
        // morreram aqui com o conjunto ja correto). Ler antes de escrever resolve o caso
        // comum sem nenhuma escrita.
        const lidoPo = await g(`/${patchCtwa.adset_id}?fields=promoted_object`);
        const poAtual = (lidoPo.body as any)?.promoted_object ?? null;
        const variantesAlvo = new Set(variantesDigitosWhatsAppBr(alvoPo.whatsapp_phone_number));
        const digitosAtuais = String(poAtual?.whatsapp_phone_number ?? "").replace(/\D/g, "");
        const jaCerto = !!poAtual &&
          String(poAtual.page_id ?? "") === alvoPo.page_id &&
          !!digitosAtuais &&
          (digitosAtuais === alvoPo.whatsapp_phone_number || variantesAlvo.has(digitosAtuais));

        if (!jaCerto) {
          let up = await g(`/${patchCtwa.adset_id}`, "POST", {
            promoted_object: JSON.stringify(alvoPo),
          });
          let viaPipeboard: unknown = null;
          // A Graph nao escreve numero que existe so na Pagina — foi assim que o create do
          // conjunto caiu em 1487246 e so o Pipeboard passou. Mesmo remedio aqui.
          if (up.status !== 200 && pbToken) {
            const pb = await pipeboardCall(
              "update_adset",
              { adset_id: String(patchCtwa.adset_id), promoted_object: alvoPo },
              pbToken,
            );
            viaPipeboard = pb;
            if (pb.ok || pb.status === 200) up = { status: 200, body: pb };
          }
          if (up.status !== 200) {
            await audit(r.company_id, sistema, "meta_action_failed", r.id, {
              motivo: "falha ao gravar whatsapp_phone_number no conjunto CTWA",
              etapa: "update_adset_promoted_object",
              promoted_object_atual: poAtual,
              promoted_object_pedido: alvoPo,
              resposta: up,
              tentativa_pipeboard: viaPipeboard,
              acao,
              driver_escrita: driver,
            });
            resultados.push({
              id: r.id,
              acao,
              resultado: "falha_meta",
              etapa: "adset_promoted_object",
              driver_escrita: driver,
              detalhe: up.body,
            });
            continue;
          }
        }
        // Espelho fica com o que a Meta tem de fato: quando ja estava certo, o valor lido
        // (a criacao nao espelhava promoted_object e a coluna ficava nula); quando foi
        // preciso escrever, o valor gravado.
        await supa
          .from("ad_sets")
          .update({ promoted_object: jaCerto ? poAtual : alvoPo })
          .eq("company_id", r.company_id)
          .eq("external_id", String(patchCtwa.adset_id));
      }

      // v4.4: cobre "novo_adcreative" (replicacao com UTM nova) e "novo_adcreative_peca_nova"
      // (spec do molde com a midia trocada). Os dois criam adcreative antes do anuncio.
      if (String(pl.criativo?.modo ?? "").startsWith("novo_adcreative")) {
        const cc = await escreverCreative(
          driver,
          conta,
          pl.criativo.path,
          pl.criativo.body,
          pbToken,
        );
        if (cc.status !== 200 || !cc.id) {
          await audit(r.company_id, sistema, "meta_action_failed", r.id, {
            motivo: "falha ao criar adcreative",
            etapa: "create_ad_creative",
            resposta: cc,
            acao,
            driver_escrita: driver,
          });
          resultados.push({
            id: r.id,
            acao,
            resultado: "falha_meta",
            etapa: "adcreative",
            driver_escrita: driver,
            detalhe: cc.body,
          });
          continue;
        }
        creativeCriado = cc.id;
        bodyFinal.creative = JSON.stringify({ creative_id: creativeCriado });
      } else if (pl.criativo?.modo === "reusar_creative_id") {
        bodyFinal.creative = JSON.stringify({ creative_id: pl.criativo.creative_id });
      }

      // Timeout / resposta ambigua: antes de repetir, a protecao continua sendo
      // executed_at null + varredura. Em pipeboard, se a resposta nao trouxer id, nao
      // marcamos sucesso — a proxima corrida pode conferir na Graph se o objeto nasceu.
      let exec: ResultadoEscrita;
      // Preenchido so quando a Meta recusa o numero CTWA em todos os formatos: o card
      // precisa dizer QUAL ativo falta, nao repetir a frase crua da Meta.
      let diagCtwa: string | null = null;
      if (acao === "criar_anuncio_a_partir_de") {
        const creativeId =
          creativeCriado ??
          (pl.criativo?.modo === "reusar_creative_id" ? pl.criativo.creative_id : null);
        if (!creativeId) {
          await audit(r.company_id, sistema, "meta_action_failed", r.id, {
            motivo: "sem creative_id para criar anuncio",
            etapa: "create_ad",
            detalhe:
              "Nao criei o anuncio porque nao havia criativo para associar a ele. Nada foi criado na Meta.",
            acao,
            driver_escrita: driver,
          });
          resultados.push({
            id: r.id,
            acao,
            resultado: "falha",
            motivo: "sem creative_id",
            driver_escrita: driver,
          });
          continue;
        }
        exec = await escreverAd(driver, conta, pl.path, bodyFinal, String(creativeId), pbToken);
      } else {
        exec = await escreverCriacao(driver, acao, conta, pl.path, bodyFinal, pbToken);
        const cands = Array.isArray(pl.ctwa_candidatos) ? pl.ctwa_candidatos as CandidatoPromotedCtwa[] : [];
        if (
          !exec.id &&
          (acao === "criar_conjunto_a_partir_de" || acao === "escalar_duplicar") &&
          ehRecusaWhatsappNaoLigado(exec.body) &&
          cands.length
        ) {
          const tentativasWa: unknown[] = [{ label: "primeiro", status: exec.status, body: exec.body }];
          for (const c of cands) {
            const po = JSON.stringify(c.promoted);
            const dest = String(c.destination_type ?? bodyFinal.destination_type ?? "WHATSAPP");
            if (po === bodyFinal.promoted_object && dest === String(bodyFinal.destination_type ?? "")) continue;
            const bodyTry = { ...bodyFinal, promoted_object: po, destination_type: dest };
            exec = await escreverCriacao(driver, acao, conta, pl.path, bodyTry, pbToken);
            tentativasWa.push({ label: c.label, status: exec.status, body: exec.body, promoted: c.promoted, destination_type: dest });
            if (exec.id && (exec.status === 200 || exec.ok === true) && !exec.erro) {
              bodyFinal.promoted_object = po;
              bodyFinal.destination_type = dest;
              (exec as any).ctwa_tentativas = tentativasWa;
              break;
            }
          }
          if (!exec.id) {
            (exec as any).ctwa_tentativas = tentativasWa;
            const promotedPedido = (() => {
              try {
                return JSON.parse(String(bodyFinal.promoted_object ?? "{}"));
              } catch {
                return {};
              }
            })();
          diagCtwa = diagnosticoRecusaWhatsApp({
            numero: promotedPedido?.whatsapp_phone_number ?? pl.whatsapp_phone_number,
            temIdWaba: cands.some((c) => !!c.promoted.whats_app_business_phone_number_id),
            formatosTentados: tentativasWa
              .map((t) => String((t as any)?.label ?? ""))
              .filter(Boolean),
            driver,
          });
          }
        }
      }
      const novoId = exec.id;
      const sucesso = !!novoId && !exec.erro && (exec.status === 200 || exec.ok === true);
      // Confere o estado do que nasceu: o status (PAUSED desde a v4.3) e verificado, nao assumido.
      // v5: reconciliacao pela Graph e obrigatoria apos escrita real (unica forma de saber o
      // que o Pipeboard fez — nao ha log exportavel do conector).
      let depois: { status: number; body: any } = { status: 0, body: null };
      let reconciliacao: Reconciliacao | null = null;
      if (sucesso && novoId) {
        const rec = await reconciliarAposEscrita(
          novoId,
          acao,
          pedidoDeReconciliacao(acao, bodyFinal, r.payload),
        );
        depois = rec.graph;
        reconciliacao = rec.reconciliacao;
      }
      // Objeto lido SO existe quando a leitura deu certo. Passar um envelope de erro adiante como
      // se fosse objeto e o que faz erro de leitura virar dado.
      const objetoLido = reconciliacao?.estado === "conferido" ? depois.body : null;

      await audit(
        r.company_id,
        sistema,
        sucesso ? "meta_action_executed" : "meta_action_failed",
        r.id,
        {
          acao,
          conta,
          etapa: (acao === "criar_conjunto_a_partir_de" || acao === "escalar_duplicar") ? "create_adset" : "escrita_na_meta",
          driver_escrita: driver,
          ferramenta_pipeboard: exec.ferramenta ?? null,
          criado_em: pl.path,
          body_enviado: bodyFinal,
          adcreative_criado: creativeCriado,
          ...(diagCtwa && !sucesso
            ? { motivo: "whatsapp_fora_das_wabas_da_conta", detalhe: diagCtwa }
            : {}),
          resposta: exec,
          // Objeto so quando a leitura deu certo; a resposta crua da Graph (inclusive envelope de
          // erro) fica em reconciliacao.lido, sem se disfarcar de objeto.
          objeto_criado: objetoLido,
          reconciliacao,
          reconciliacao_estado: reconciliacao?.estado ?? null,
          criativo_aviso: pl.criativo?.aviso ?? null,
          peca_nova: pl.peca_nova ?? null,
          pipeboard_conexao: driver === "pipeboard" ? pipeboardMonitor : null,
        },
      );

      if (sucesso) {
        executadasNaHora++;
        executadasNaHoraPorEmpresa.set(r.company_id, executadasNaHora);
        // v4.2: espelha ANTES de fechar o card, para que o proximo turno do agente ja veja.
        const esp = await espelhar(
          acao,
          novoId!,
          objetoLido,
          r.payload,
          conta,
          r.company_id,
          r.id,
          pl.molde_lido ?? null,
          creativeCriado ?? pl.criativo?.creative_id ?? null,
          String(bodyFinal.status ?? ""),
        );
        if (!esp.ok) {
          await audit(r.company_id, sistema, "meta_action_espelho_falhou", r.id, {
            acao,
            id_criado: novoId,
            tabela: esp.tabela ?? null,
            erro: esp.erro,
            driver_escrita: driver,
            nota: "O OBJETO EXISTE NA META. Falhou apenas a gravacao no espelho local - o sistema ficara cego para este objeto ate o proximo sync.",
          });
        }
        // v5.3: DUAS acoes, nao uma. "nao consegui olhar" (falhou) e "olhei e a Meta tem outro
        // valor" (divergente) sao fatos diferentes, e quem le o audit_log precisa distinguir sem
        // abrir o details. A escolha e da funcao compartilhada - a sonda usa a MESMA.
        const acaoRec = acaoDeAuditoriaDaReconciliacao(reconciliacao);
        if (acaoRec && reconciliacao) {
          await audit(r.company_id, sistema, acaoRec, r.id, {
            acao,
            id_criado: novoId,
            estado: reconciliacao.estado,
            divergencias: reconciliacao.divergencias,
            erro_leitura: reconciliacao.erro_leitura,
            campos_pedidos: reconciliacao.campos_pedidos,
            campos_comparados: reconciliacao.campos_comparados,
            http_status: depois.status,
            lido: reconciliacao.lido,
            driver_escrita: driver,
            nota:
              reconciliacao.estado === "conferido"
                ? "OLHEI o objeto na Graph e um valor difere do que foi pedido."
                : "NAO consegui olhar o objeto na Graph. Isto NAO afirma que o objeto esta errado - nada foi concluido sobre valor nenhum. O objeto EXISTE na Meta (a escrita voltou id).",
          });
        }
        await supa
          .from("approval_requests")
          .update({
            executed_at: new Date().toISOString(),
            // Sucesso APAGA a falha anterior: card que deu certo depois de uma tentativa ruim nao
            // pode continuar exibindo o erro velho como se fosse o estado atual.
            ultima_falha: null,
            execution_result: {
              ok: true,
              id_criado: novoId,
              objeto: objetoLido,
              adcreative_criado: creativeCriado,
              aviso: pl.criativo?.aviso ?? null,
              peca_nova: pl.peca_nova ?? null,
              espelho_gravado: esp.ok,
              espelho_tabela: esp.tabela ?? null,
              espelho_erro: esp.erro ?? null,
              driver_escrita: driver,
              reconciliacao,
              reconciliacao_estado: reconciliacao?.estado ?? null,
              reconciliacao_conferida: reconciliacao?.estado === "conferido",
              reconciliacao_erro_leitura: reconciliacao?.erro_leitura ?? null,
              lembrete:
                "Objeto criado PAUSADO (v4.3). A aprovacao CRIOU o objeto e NAO iniciou entrega nem gasto. Para comecar a entregar, o gestor precisa ATIVAR manualmente no Gerenciador - conferindo a arvore inteira antes.",
            },
          })
          .eq("id", r.id);
      }
      // Falha DEPOIS de criar adcreative deixa o card re-executavel (executed_at null) e a
      // proxima corrida cria OUTRO creative orfao. Evidencia 07/08: card e4dd146d gerou
      // 2635490320208656 e 1023859480523471 no mesmo conjunto DC. Fecha o card com ok=false
      // quando ja houve escrita parcial; retry exige card novo (decisao humana).
      if (!sucesso) {
        const t = traduzirFalha(exec.body ?? exec.erro ?? null);
        if (creativeCriado) {
          await supa
            .from("approval_requests")
            .update({
              executed_at: new Date().toISOString(),
              execution_result: {
                ok: false,
                etapa: "create_ad",
                adcreative_criado: creativeCriado,
                id_criado: null,
                detalhe: exec.body ?? exec.erro ?? null,
                recusa: t.recusa,
                motivo_para_o_gestor: t.motivo_para_o_gestor,
                driver_escrita: driver,
                nota:
                  "Escrita parcial: adcreative nasceu na Meta/Pipeboard, create_ad falhou. Card fechado para nao duplicar creative. Limpar orfao no Gerenciador se necessario.",
              },
              ultima_falha: {
                em: new Date().toISOString(),
                etapa: "create_ad",
                recusa: t.recusa,
                motivo_para_o_gestor: t.motivo_para_o_gestor,
                detalhe_tecnico: redact(JSON.stringify(exec.body ?? exec.erro ?? null)).slice(0, 1000),
                tentativa: Number(r.ultima_falha?.tentativa ?? 0) + 1,
                re_executavel: false,
                driver_escrita: driver,
              },
            })
            .eq("id", r.id);
        }
        // Sem creativeCriado, NADA foi escrito na Meta: o card segue elegivel para nova tentativa
        // e executed_at continua nulo, de proposito. Esse e o caso do b5e2f338, e ele ja saiu
        // marcado pelo audit("meta_action_failed") logo acima - o unico caminho que, antes desta
        // versao, nao deixava rastro nenhum no card.
      }
      resultados.push({
        id: r.id,
        acao,
        resultado: sucesso ? "CRIADO" : "falha_meta",
        id_criado: novoId,
        status: (objetoLido as any)?.status ?? null,
        aviso: pl.criativo?.aviso ?? null,
        detalhe: sucesso ? null : (exec.body ?? exec.erro),
        driver_escrita: driver,
        reconciliacao,
        reconciliacao_estado: reconciliacao?.estado ?? null,
        reconciliacao_erro_leitura: reconciliacao?.erro_leitura ?? null,
        adcreative_orfao: !sucesso && creativeCriado ? creativeCriado : null,
      });
      continue;
    }

    if (acao === "vincular_instagram_dos_anuncios") {
      const campNome = String(
        r.payload?.campanha_destino_nome ?? r.payload?.target_name ?? "",
      ).trim();
      const escopo = recusarCampanhaForaEscopoIg(campNome);
      if (!escopo.ok) {
        await audit(r.company_id, sistema, "meta_action_blocked", r.id, {
          motivo: escopo.erro,
          detalhe: escopo.detalhe,
          acao,
        });
        resultados.push({
          id: r.id,
          acao,
          resultado: "bloqueado",
          motivo: escopo.erro,
          detalhe: escopo.detalhe,
        });
        continue;
      }
      const campExt = String(
        r.payload?.campanha_external_id ?? r.payload?.target_external_id ?? "",
      ).trim();
      let accountId = String(r.payload?.conta_destino ?? "").replace(/^act_/i, "");
      if (!accountId || !campExt) {
        const { data: campRow } = await supa
          .from("campaigns")
          .select("external_id,external_account_id,name")
          .eq("company_id", r.company_id)
          .eq("external_id", campExt || "0")
          .maybeSingle();
        accountId = String((campRow as any)?.external_account_id ?? "").replace(/^act_/i, "");
      }
      if (!campExt || !accountId) {
        resultados.push({
          id: r.id,
          acao,
          resultado: "falha",
          motivo: "campanha_external_id ou conta_destino ausente",
        });
        continue;
      }
      const { data: cfgIg } = await supa
        .from("meta_execution_config")
        .select("page_id,instagram_identity_page_id")
        .eq("company_id", r.company_id)
        .maybeSingle();
      const pageId = String(
        (cfgIg as any)?.page_id ?? (cfgIg as any)?.instagram_identity_page_id ?? "",
      ).trim() || null;
      const destId = String(r.payload?.instagram_destino_id ?? "").trim();
      const destHandle = String(r.payload?.instagram_destino_handle ?? `@${HANDLE_COHAPM_OFICIAL}`);
      const identPayload = destId
        ? {
            encontrada: true as const,
            instagram_actor_id: destId,
            instagram_handle: destHandle,
            fonte: "config_empresa" as const,
            procedencia: "payload do card",
            vinculo_pagina_confirmado: true as boolean | null,
          }
        : await resolverIdentidadeInstagram(String(r.company_id), "", r.payload);
      if (!identPayload.encontrada || !identPayload.instagram_actor_id) {
        resultados.push({
          id: r.id,
          acao,
          resultado: "falha",
          motivo: "instagram_destino_ausente",
        });
        continue;
      }
      const gIg = criarGraphClient(TOKEN);
      const { data: setsIg } = await supa
        .from("ad_sets")
        .select("name,external_id")
        .eq("company_id", r.company_id);
      const conjuntosNomes: Record<string, string> = {};
      for (const s of setsIg ?? []) {
        if (s.external_id) conjuntosNomes[String(s.external_id)] = String(s.name ?? "");
      }
      const lista = await listarAnunciosInstagramDaCampanha({
        g: gIg,
        campaignId: campExt,
        accountId,
        pageId,
        conjuntosNomes,
        oficialId: identPayload.instagram_actor_id,
        oficialHandle: identPayload.instagram_handle ?? HANDLE_COHAPM_OFICIAL,
      });
      const lote: unknown[] = [];
      let okN = 0;
      let failN = 0;
      let skipN = 0;
      for (const ad of lista) {
        const rAd = await relincarInstagramNoAnuncio({
          g: gIg,
          accountId,
          ad,
          identidade: identPayload,
        });
        lote.push({ ad_id: ad.ad_id, nome: ad.nome, ...rAd });
        if (rAd.ok && rAd.pulado) skipN++;
        else if (rAd.ok) okN++;
        else failN++;
      }
      const sucessoLote = failN === 0;
      await supa
        .from("approval_requests")
        .update({
          executed_at: new Date().toISOString(),
          ultima_falha: sucessoLote ? null : {
            em: new Date().toISOString(),
            etapa: "vincular_instagram_dos_anuncios",
            motivo_para_o_gestor: `${failN} anuncio(s) falharam ao relincar Instagram`,
            tentativa: Number(r.ultima_falha?.tentativa ?? 0) + 1,
            re_executavel: true,
          },
          execution_result: {
            ok: sucessoLote,
            relincados: okN,
            ja_estavam: skipN,
            falhas: failN,
            lote,
            driver_escrita: "graph",
          },
        })
        .eq("id", r.id);
      await audit(r.company_id, sistema, sucessoLote ? "meta_action_executed" : "meta_action_failed", r.id, {
        acao,
        relincados: okN,
        ja_estavam: skipN,
        falhas: failN,
      });
      resultados.push({
        id: r.id,
        acao,
        resultado: sucessoLote ? "EXECUTADO" : "falha_meta",
        relincados: okN,
        ja_estavam: skipN,
        falhas: failN,
        driver_escrita: "graph",
      });
      continue;
    }

    // ==================== CAMINHO v1: MODIFICAR EXISTENTE ====================
    if (!EXECUTAVEIS.includes(acao)) {
      resultados.push({
        id: r.id,
        acao,
        resultado: "pulado",
        motivo: "ação não automatizada (decisão manual)",
      });
      continue;
    }
    if (!alvoExt) {
      resultados.push({
        id: r.id,
        acao,
        resultado: "falha",
        motivo: "payload sem target_external_id",
      });
      await audit(r.company_id, sistema, "meta_action_failed", r.id, {
        motivo: "sem target_external_id",
        acao,
      });
      continue;
    }
    if (r.expires_at && new Date(r.expires_at) < new Date()) {
      await audit(r.company_id, sistema, "meta_action_blocked", r.id, {
        motivo: "pedido expirado",
        acao,
        prazo: r.expires_at,
        driver_escrita: driver,
      });
      resultados.push({
        id: r.id,
        acao,
        resultado: "bloqueado",
        motivo: "pedido expirado (24h)",
        driver_escrita: driver,
      });
      continue;
    }

    if (driver === "pipeboard" && pipeboardMonitor && !pipeboardMonitor.ok) {
      await audit(r.company_id, sistema, "meta_action_blocked", r.id, {
        motivo: "pipeboard_conexao_inativa",
        alerta: pipeboardMonitor.alerta,
        token_status: pipeboardMonitor.token_status,
        acao,
        driver_escrita: driver,
      });
      resultados.push({
        id: r.id,
        acao,
        resultado: "bloqueado",
        motivo: pipeboardMonitor.alerta ?? "pipeboard_conexao_inativa",
        driver_escrita: driver,
      });
      continue;
    }
    if (driver === "pipeboard" && !pbToken) {
      await audit(r.company_id, sistema, "meta_action_blocked", r.id, {
        motivo: "PIPEBOARD_API_TOKEN ausente",
        acao,
        driver_escrita: driver,
      });
      resultados.push({
        id: r.id,
        acao,
        resultado: "bloqueado",
        motivo: "PIPEBOARD_API_TOKEN ausente",
        driver_escrita: driver,
      });
      continue;
    }

    // v5.3: mesma lista derivada por nivel do caminho de criacao. A lista fixa que estava aqui
    // pedia daily_budget SEMPRE - em pausar_criativo (nivel de anuncio) isso derruba o GET inteiro
    // com #100 e o "antes"/"depois" do card viram envelope de erro. O defeito era o mesmo nos dois
    // caminhos; consertar so um deixaria a metade de baixo para a proxima execucao real descobrir.
    const nivelAlvo = nivelDaAcao(acao);
    const camposAlvo = nivelAlvo ? camposDeReconciliacao(nivelAlvo) : null;
    const antes: { status: number; body: any } = camposAlvo
      ? await g(`/${alvoExt}?fields=${camposAlvo}`)
      : { status: 0, body: null };

    let post: Record<string, string> | null = null;
    if (acao === "pausar_criativo" || acao === "pausar_campanha" || acao === "pausar_conjunto") {
      post = { status: "PAUSED" };
    }
    if (acao === "ativar_criativo" || acao === "ativar_campanha" || acao === "ativar_conjunto") {
      post = { status: "ACTIVE" };
    }
    if (RENOMEACOES.includes(acao)) {
      const novoNome = String(r.payload?.novo_nome ?? "").trim();
      if (!novoNome) {
        resultados.push({ id: r.id, acao, resultado: "falha", motivo: "novo_nome ausente/vazio", driver_escrita: driver });
        await audit(r.company_id, sistema, "meta_action_failed", r.id, {
          motivo: "novo_nome ausente/vazio", payload: r.payload, driver_escrita: driver,
        });
        continue;
      }
      // Nome livre: novo_nome e a fonte da verdade. nome_partes e metadado opcional.
      post = { name: novoNome };
    }
    if (acao === "alterar_categoria_especial_campanha") {
      const rawCats = r.payload?.special_ad_categories;
      if (!Array.isArray(rawCats)) {
        resultados.push({
          id: r.id, acao, resultado: "falha",
          motivo: "special_ad_categories deve ser array (use [] para remover)",
          driver_escrita: driver,
        });
        await audit(r.company_id, sistema, "meta_action_failed", r.id, {
          motivo: "special_ad_categories ausente/invalido", payload: r.payload, driver_escrita: driver,
        });
        continue;
      }
      const cats = (rawCats as unknown[])
        .map((x) => String(x).trim().toUpperCase())
        .filter((x) => x && x !== "NONE" && x !== "NULL");
      post = { special_ad_categories: JSON.stringify(cats) };
    }
    if (acao === "alterar_orcamento") {
      let reais = Number(r.payload?.novo_orcamento_diario_reais ?? 0);
      if (!(reais > 0)) {
        resultados.push({
          id: r.id,
          acao,
          resultado: "falha",
          motivo: "novo_orcamento_diario_reais ausente/inválido",
          driver_escrita: driver,
        });
        await audit(r.company_id, sistema, "meta_action_failed", r.id, {
          motivo: "orcamento invalido",
          payload: r.payload,
          driver_escrita: driver,
        });
        continue;
      }
      const checkOrc = conferirOrcamentoReais({
        reais,
        confirmadoReais: ehFlagOrcamentoConfirmadoReais(r.payload?.orcamento_confirmado_reais),
      });
      if (!checkOrc.ok) {
        resultados.push({
          id: r.id,
          acao,
          resultado: "falha",
          motivo: checkOrc.erro,
          detalhe: checkOrc.detalhe,
          driver_escrita: driver,
        });
        await audit(r.company_id, sistema, "meta_action_failed", r.id, {
          motivo: checkOrc.erro,
          detalhe: checkOrc.detalhe,
          payload: r.payload,
          driver_escrita: driver,
        });
        continue;
      }
      reais = checkOrc.reais;
      // ESP-26: mesmo juiz da proposta (avaliar_orcamento_diario). Comparacao local SAIU.
      const julgado = await julgarOrcamentoDiario(supa, String(r.company_id), reais, 1);
      if (!julgado.ok) {
        await audit(r.company_id, sistema, "meta_action_blocked", r.id, {
          motivo: julgado.motivo,
          detalhe: julgado.detalhe,
          avaliacao_orcamento: julgado.avaliacao,
          acao,
          payload: r.payload,
          driver_escrita: driver,
        });
        resultados.push({
          id: r.id,
          acao,
          resultado: "bloqueado",
          motivo: julgado.motivo,
          detalhe: julgado.detalhe,
          driver_escrita: driver,
        });
        continue;
      }
      post = { daily_budget: String(Math.round(reais * 100)) };
    }
    if (acao === "ajustar_posicionamentos_do_conjunto") {
      const formato = String(r.payload?.formato_midia ?? "").trim().toLowerCase();
      if (antes.status !== 200 || !antes.body || typeof antes.body !== "object") {
        const motivo = "estado_atual_do_conjunto_nao_pode_ser_lido";
        await audit(r.company_id, sistema, "meta_action_blocked", r.id, {
          motivo,
          acao,
          driver_escrita: driver,
          leitura_graph: antes,
        });
        resultados.push({ id: r.id, acao, resultado: "bloqueado", motivo, driver_escrita: driver });
        continue;
      }
      const derivado = targetingCompativelComFormato(
        ((antes.body as any)?.targeting ?? {}) as Record<string, unknown>,
        formato,
      );
      if (!derivado.targeting || derivado.erro) {
        const motivo = derivado.erro ?? "posicionamentos_compativeis_nao_derivados";
        await audit(r.company_id, sistema, "meta_action_blocked", r.id, {
          motivo,
          acao,
          formato_midia: formato,
          driver_escrita: driver,
        });
        resultados.push({ id: r.id, acao, resultado: "bloqueado", motivo, driver_escrita: driver });
        continue;
      }
      post = { targeting: JSON.stringify(derivado.targeting) };
      r.payload.targeting_aprovado = derivado.targeting;
      r.payload.posicionamentos_excluidos = derivado.excluidos;
      r.payload.perfil_posicionamento = derivado.perfil;
    }

    if (conf.dry_run) {
      let ensaioPipeboard: ResultadoEscrita | null = null;
      if (
        driver === "pipeboard" &&
        (acao === "pausar_campanha" ||
          acao === "ativar_campanha" ||
          acao === "renomear_campanha" ||
          acao === "alterar_categoria_especial_campanha") &&
        post
      ) {
        ensaioPipeboard = await escreverUpdate(driver, acao, alvoExt, post, pbToken, {
          dry_run: true,
        });
      }
      await audit(r.company_id, sistema, "meta_action_dry_run", r.id, {
        SIMULADO: true,
        acao,
        alvo: alvoNome,
        alvo_external_id: alvoExt,
        driver_escrita: driver,
        chamaria: post,
        estado_atual_meta: antes.body,
        pipeboard_dry_run_nativo: ensaioPipeboard?.dry_run_nativo ?? null,
        pipeboard_resposta: ensaioPipeboard?.body ?? null,
        pipeboard_nota:
          ensaioPipeboard?.nota_dry_run ??
          (driver === "pipeboard" &&
          acao !== "pausar_campanha" &&
          acao !== "ativar_campanha" &&
          acao !== "renomear_campanha" &&
          acao !== "alterar_categoria_especial_campanha"
            ? "dry_run nativo so em create_campaign/update_campaign; neste nivel a simulacao e local"
            : null),
        pipeboard_conexao: pipeboardMonitor,
        flags_permitiriam: {
          master: conf.master_enabled,
          flag_acao: conf.action_flags?.[acao] === true,
          rate_ok: rateOk,
        },
        nota: "dry_run=true: NADA foi enviado à Meta; executed_at NÃO preenchido",
      });
      resultados.push({
        id: r.id,
        acao,
        alvo: alvoNome,
        resultado: "SIMULADO",
        chamaria: post,
        estado_atual: (antes.body as any)?.status,
        flags_permitiriam: flagsOk && rateOk,
        driver_escrita: driver,
        pipeboard_dry_run_nativo: ensaioPipeboard?.dry_run_nativo ?? null,
      });
      continue;
    }

    if (!flagsOk || !rateOk) {
      const motivo = !conf.master_enabled
        ? "master_enabled=false"
        : conf.action_flags?.[acao] !== true
          ? `flag ${acao}=false`
          : "rate limit atingido";
      await audit(r.company_id, sistema, "meta_action_blocked", r.id, {
        motivo,
        acao,
        alvo: alvoNome,
        driver_escrita: driver,
      });
      resultados.push({
        id: r.id,
        acao,
        alvo: alvoNome,
        resultado: "bloqueado",
        motivo,
        driver_escrita: driver,
      });
      continue;
    }
    const exec = await escreverUpdate(driver, acao, alvoExt, post!, pbToken);
    const depois: { status: number; body: any } = camposAlvo
      ? await g(`/${alvoExt}?fields=${camposAlvo}`)
      : { status: 0, body: null };
    // O transporte MCP pode responder HTTP 200 com erro no corpo; `ok` é o veredito normalizado.
    const sucesso = exec.ok === true;
    // O pedido de update ja e naturalmente por nivel: post traz status (pausas) ou daily_budget
    // (orcamento), nunca os dois.
    const reconciliacao: Reconciliacao | null = !sucesso
      ? null
      : camposAlvo
        ? compararPedidoComGraph(
            {
              status: post?.status,
              daily_budget: post?.daily_budget,
              name: post?.name,
              targeting: post?.targeting ? JSON.parse(post.targeting) : undefined,
            },
            depois.body,
            { http_status: depois.status, campos: camposAlvo },
          )
        : reconciliacaoNivelDesconhecido(acao);
    const alvoLido = reconciliacao?.estado === "conferido" ? depois.body : null;
    await audit(
      r.company_id,
      sistema,
      sucesso ? "meta_action_executed" : "meta_action_failed",
      r.id,
      {
        acao,
        alvo: alvoNome,
        alvo_external_id: alvoExt,
        driver_escrita: driver,
        ferramenta_pipeboard: exec.ferramenta ?? null,
        chamada: post,
        resposta: exec,
        antes: antes.body,
        depois: depois.body,
        reconciliacao,
        reconciliacao_estado: reconciliacao?.estado ?? null,
        pipeboard_conexao: driver === "pipeboard" ? pipeboardMonitor : null,
      },
    );
    if (sucesso) {
      executadasNaHora++;
      executadasNaHoraPorEmpresa.set(r.company_id, executadasNaHora);
      const acaoRec = acaoDeAuditoriaDaReconciliacao(reconciliacao);
      if (acaoRec && reconciliacao) {
        await audit(r.company_id, sistema, acaoRec, r.id, {
          acao,
          alvo_external_id: alvoExt,
          estado: reconciliacao.estado,
          divergencias: reconciliacao.divergencias,
          erro_leitura: reconciliacao.erro_leitura,
          campos_pedidos: reconciliacao.campos_pedidos,
          campos_comparados: reconciliacao.campos_comparados,
          http_status: depois.status,
          lido: reconciliacao.lido,
          driver_escrita: driver,
          nota:
            reconciliacao.estado === "conferido"
              ? "OLHEI o objeto na Graph e um valor difere do que foi pedido."
              : "NAO consegui olhar o objeto na Graph depois da escrita. Isto NAO afirma que a alteracao falhou - nada foi concluido sobre o valor.",
        });
      }
      // ESPELHO DO NOME: a escrita muda o nome na Meta, mas ate aqui o espelho seguia afirmando o
      // nome ANTIGO - o agente leu esse valor stale e errou duas vezes. As outras acoes desta
      // executora nao mexem no nome; a reconciliacao periodica so sincronizava status. Fonte de
      // autoridade: o nome LIDO de volta na Graph (depois.body.name, conferido); sem leitura, o
      // nome pedido (post.name) - mesma precedencia do espelhar() de criacao. Falha de espelho vai
      // para o audit, nao derruba a execucao (o objeto na Meta ja mudou).
      // v5.60: vale para os tres niveis. Conjunto e anuncio renomeados sem espelho deixariam o
      // mesmo rastro stale que motivou este bloco no nivel de campanha.
      if (RENOMEACOES.includes(acao)) {
        const tabelaDoNome = acao === "renomear_campanha"
          ? "campaigns"
          : acao === "renomear_conjunto"
          ? "ad_sets"
          : "ads";
        const nomeGraph = (depois.body as any)?.name;
        const nomeEspelho = String(nomeGraph ?? post?.name ?? "").trim();
        if (nomeEspelho) {
          const { error: erroEspelho } = await supa
            .from(tabelaDoNome)
            .update({ name: nomeEspelho })
            .eq("provider", "meta_ads")
            .eq("external_id", alvoExt);
          await audit(
            r.company_id,
            sistema,
            erroEspelho ? "meta_action_espelho_nome_falhou" : "meta_action_espelho_nome",
            r.id,
            {
              acao,
              alvo_external_id: alvoExt,
              campo: "name",
              tabela: tabelaDoNome,
              valor_espelhado: nomeEspelho,
              fonte: nomeGraph != null ? "graph (conferido)" : "nome pedido (graph nao relida)",
              reconciliacao_estado: reconciliacao?.estado ?? null,
              erro: erroEspelho?.message ?? null,
              nota: erroEspelho
                ? `FALHA ao espelhar ${tabelaDoNome}.name - o nome na Meta mudou mas o espelho local segue defasado ate a proxima reconciliacao`
                : `${tabelaDoNome}.name sincronizado com a Meta apos ${acao} bem-sucedido`,
            },
          );
        }
      }
      if (acao === "alterar_categoria_especial_campanha") {
        const catsGraph = (depois.body as any)?.special_ad_categories;
        let catsEspelho: string[] | null = null;
        if (Array.isArray(catsGraph)) {
          catsEspelho = catsGraph.map((x: unknown) => String(x));
        } else if (post?.special_ad_categories != null) {
          try {
            const p = JSON.parse(post.special_ad_categories);
            catsEspelho = Array.isArray(p) ? p.map((x: unknown) => String(x)) : [];
          } catch {
            catsEspelho = [];
          }
        }
        if (catsEspelho != null) {
          const { error: erroEspelho } = await supa
            .from("campaigns")
            .update({ special_ad_categories: catsEspelho })
            .eq("provider", "meta_ads")
            .eq("external_id", alvoExt);
          await audit(
            r.company_id,
            sistema,
            erroEspelho
              ? "meta_action_espelho_categoria_falhou"
              : "meta_action_espelho_categoria",
            r.id,
            {
              acao,
              alvo_external_id: alvoExt,
              campo: "special_ad_categories",
              valor_espelhado: catsEspelho,
              fonte: Array.isArray(catsGraph) ? "graph (conferido)" : "pedido (graph nao relida)",
              reconciliacao_estado: reconciliacao?.estado ?? null,
              erro: erroEspelho?.message ?? null,
            },
          );
        }
      }
      if (acao === "ajustar_posicionamentos_do_conjunto") {
        const esp = await espelhar(
          acao,
          alvoExt,
          alvoLido,
          r.payload,
          "",
          String(r.company_id),
          String(r.id),
          null,
          null,
          String((alvoLido as any)?.status ?? (antes.body as any)?.status ?? "PAUSED"),
        );
        await audit(
          r.company_id,
          sistema,
          esp.ok ? "meta_action_espelho_posicionamentos" : "meta_action_espelho_posicionamentos_falhou",
          r.id,
          {
            acao,
            alvo_external_id: alvoExt,
            espelho: esp,
            targeting_graph: (alvoLido as any)?.targeting ?? null,
            reconciliacao_estado: reconciliacao?.estado ?? null,
          },
        );
      }
      // Espelho de status apos ativar/pausar — evita UI stale ate o proximo sync.
      if (
        acao === "pausar_criativo" ||
        acao === "ativar_criativo" ||
        acao === "pausar_campanha" ||
        acao === "ativar_campanha" ||
        acao === "pausar_conjunto" ||
        acao === "ativar_conjunto"
      ) {
        const statusLido = String(
          (alvoLido as any)?.status ?? post?.status ?? "",
        ).trim();
        if (statusLido) {
          if (acao === "pausar_criativo" || acao === "ativar_criativo") {
            await supa
              .from("ads")
              .update({ status: statusLido.toUpperCase() })
              .eq("provider", "meta_ads")
              .eq("external_id", alvoExt);
          } else if (acao === "pausar_campanha" || acao === "ativar_campanha") {
            await supa
              .from("campaigns")
              .update({ status: statusLido.toLowerCase() })
              .eq("provider", "meta_ads")
              .eq("external_id", alvoExt);
          } else {
            await supa
              .from("ad_sets")
              .update({ status: statusLido.toUpperCase() })
              .eq("provider", "meta_ads")
              .eq("external_id", alvoExt);
          }
        }
      }
      await supa
        .from("approval_requests")
        .update({
          executed_at: new Date().toISOString(),
          ultima_falha: null, // sucesso apaga a falha da tentativa anterior
          execution_result: {
            ok: true,
            antes: antes.body,
            depois: alvoLido,
            driver_escrita: driver,
            reconciliacao,
            reconciliacao_estado: reconciliacao?.estado ?? null,
            reconciliacao_conferida: reconciliacao?.estado === "conferido",
            reconciliacao_erro_leitura: reconciliacao?.erro_leitura ?? null,
          },
        })
        .eq("id", r.id);
    }
    resultados.push({
      id: r.id,
      acao,
      alvo: alvoNome,
      resultado: sucesso ? "EXECUTADO" : "falha_meta",
      antes: (antes.body as any)?.status,
      depois: (alvoLido as any)?.status ?? null,
      driver_escrita: driver,
      reconciliacao,
      reconciliacao_estado: reconciliacao?.estado ?? null,
      reconciliacao_erro_leitura: reconciliacao?.erro_leitura ?? null,
    });
  }

  // v3: nao ha "modo" unico - cada card foi avaliado sob a config da sua empresa.
  return json({
    ok: true,
    versao: "meta-actions-v5",
    mcp_chamador: auth.chamador,
    mcp_chave_legada: auth.legado,
    processados: resultados.length,
    resultados,
    pipeboard_conexao: pipeboardMonitor ?? {
      ok: false,
      token_status: null,
      connection_id: null,
      alerta: pbToken
        ? null
        : "PIPEBOARD_API_TOKEN ausente — monitor e driver pipeboard indisponiveis ate cadastrar o Edge Secret",
      erro: pbToken ? undefined : "token_ausente",
    },
    nota: "configuracao de execucao e por empresa (meta_execution_config.company_id); driver_escrita diz por onde o ultimo passo sai (graph|pipeboard), nunca SE sai. Nenhuma action_flag foi alterada por este deploy.",
  });
});
