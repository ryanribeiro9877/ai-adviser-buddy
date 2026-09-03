// Snapshot local das definicoes de ferramenta. NAO e a verdade: a verdade e
// public.agent_ferramentas, que tambem carrega a doutrina de uso (o texto longo que so entra
// no turno quando a ferramenta e efetivamente chamada).
//
// Este arquivo existe para FALHA ABERTA. Se a leitura da tabela falhar, o turno continua com
// estas definicoes e a telemetria marca degradado — mesma postura de catalogoFallback() em
// agentes.ts. Um turno caro e melhor que um turno perdido.
//
// A LINHA QUE DIVIDE descricao de doutrina: descricao carrega o que decide SE a ferramenta e
// chamada (o que ela faz, o que exige, quando nao usar); doutrina carrega o que decide COMO
// ler o retorno. Por isso a doutrina pode faltar num turno degradado sem soltar guarda de ato:
// o que nao pode ser perdido nunca mora la.
//
// Gerado uma vez a partir dos arrays TOOLS (traffic-chat) e DEF (traffic-agent-job) que este
// registro substituiu, em 03/09/2026.

export type FerramentaBase = {
  descricao: string;
  parametros: Record<string, unknown>;
  /** Onde a ferramenta existe: 'chat' (traffic-chat) e/ou 'job' (traffic-agent-job). */
  superficies: string[];
  /**
   * Propriedades que o handler DAQUELA superficie nao implementa. Declaracao de capacidade,
   * nao schema paralelo: anunciar um filtro que o handler ignora faz o modelo acreditar num
   * recorte que nunca aconteceu.
   */
  omitidos?: Record<string, string[]>;
};

export const FERRAMENTAS_BASE: Record<string, FerramentaBase> = {
  alterar_categoria_especial: {
    descricao:
      "Emite CARD DE APROVACAO para alterar ou REMOVER special_ad_categories de uma campanha JA CRIADA. Passe special_ad_categories=[] para remover. NAO diga que falta ferramenta para isso nem que so da na criacao.",
    parametros: {"type":"object","properties":{"campanha_atual":{"type":"string"},"special_ad_categories":{"type":"array","items":{"type":"string"}},"categorias_atuais":{"type":"array","items":{"type":"string"}},"justificativa":{"type":"string"}},"required":["campanha_atual","special_ad_categories"]},
    superficies: ["chat"],
  },
  auditar_compliance_financeira: {
    descricao:
      "Auditoria de categoria especial e regras financeiras de UMA campanha e seus anuncios (name_like). Use quando o gestor perguntar se os anuncios respeitam financas, categoria especial ou regras da Meta. NAO diga que o campo nao existe: esta tool e get_campaign_detail leem.",
    parametros: {"type":"object","properties":{"name_like":{"type":"string","description":"Nome (ou trecho) da campanha"}},"required":["name_like"]},
    superficies: ["chat"],
  },
  avaliar_escala: {
    descricao:
      "Avalia se um conjunto esta apto a escala por duplicacao com no maximo +20%, usando a arvore de decisao, custo ate 80% do teto, volume e espera. Exige adset_external_id.",
    parametros: {"type":"object","properties":{"adset_external_id":{"type":"string"}},"required":["adset_external_id"]},
    superficies: ["chat","job"],
  },
  avaliar_fadiga: {
    descricao:
      "Avalia se uma peca cansou, teve queda sem saturacao, esta com frequencia alta antes da queda ou nao tem sinal de fadiga. Exige ad_external_id.",
    parametros: {"type":"object","properties":{"ad_external_id":{"type":"string"}},"required":["ad_external_id"]},
    superficies: ["chat","job"],
  },
  avaliar_pacing: {
    descricao:
      "Calcula a capacidade diaria da estrutura e, se meta_leads_dia for informada, o PISO de verba diaria ao custo atual.",
    parametros: {"type":"object","properties":{"meta_leads_dia":{"type":"number"}}},
    superficies: ["chat","job"],
  },
  buscar_geolocalizacao: {
    descricao:
      "Resolve NOMES de bairro, cidade ou regiao para KEYS da Meta (Graph /search type=adgeolocation). Chame ANTES de criar_conjunto com geo fino. Lote maximo de 40 nomes por chamada. Default tipo=neighborhood, country_code=BR. NAO cria conjunto e NUNCA diga que falta campo de bairros.",
    parametros: {"type":"object","properties":{"nomes":{"type":"array","items":{"type":"string"},"description":"Lista de nomes (ate 40 por chamada)."},"tipo":{"type":"string","description":"neighborhood|city|region|zip (default neighborhood)."},"country_code":{"type":"string","description":"Default BR."},"cidade_contexto":{"type":"string","description":"Opcional: filtra ambiguidade (ex. Salvador)."}},"required":["nomes"]},
    superficies: ["chat"],
  },
  casar_criativo_performance: {
    descricao:
      "ESP-33: casa peca do Drive com os anuncios criados PELO SISTEMA a partir dela e devolve as metricas da janela. Passe drive_file_id e/ou ad_external_id; sem filtro lista os pares existentes. Use antes de julgar peca do acervo por desempenho. Para a pasta de origem de um CONJUNTO inteiro, use origem_drive_dos_anuncios.",
    parametros: {"type":"object","properties":{"drive_file_id":{"type":"string"},"ad_external_id":{"type":"string"},"dias":{"type":"integer","description":"Janela em dias (default 7)."}}},
    superficies: ["chat","job"],
  },
  checar_par_texto_e_peca: {
    descricao:
      "Avalia o PAR legenda + peca pela concatenacao do texto disponivel. Exige legenda e drive_file_id; passe campanha e conjunto quando for emitir. Existe caminho conjunto: nunca diga que o par nao e avaliado.",
    parametros: {"type":"object","properties":{"legenda":{"type":"string"},"drive_file_id":{"type":"string"},"campanha":{"type":"string","description":"Nome da campanha destino (COHAPM: obriga casar linha da peca)."},"conjunto":{"type":"string","description":"Nome do conjunto destino."},"nome_criativo":{"type":"string"}},"required":["legenda","drive_file_id"]},
    superficies: ["chat","job"],
  },
  check_compliance: {
    descricao:
      "GUARDIAO DE COMPLIANCE: valida deterministicamente UMA legenda (texto integral) e/ou a peca anexada contra as regras versionadas. Esboco que VOCE escreveu nesta conversa: passe o proprio texto em legenda=. Anuncio ja publicado: pegue a legenda em get_criativos_conteudo. Passe campanha, conjunto e nome_criativo ao auditar destino x peca.",
    parametros: {"type":"object","properties":{"legenda":{"type":"string","description":"Texto integral da legenda a validar (obrigatorio se nao houver imagem anexada)."},"campanha":{"type":"string"},"conjunto":{"type":"string"},"nome_criativo":{"type":"string"},"drive_file_id":{"type":"string"},"meio":{"type":"string","enum":["la_felicita","juridico","sistema_ocular"]}},"required":["legenda"]},
    superficies: ["chat","job"], omitidos: {"job":["meio","drive_file_id"]},
  },
  computar_perfil_vencedor: {
    descricao:
      "ESP-34: computa e VERSIONA o perfil do vencedor da empresa e devolve a versao gravada. Use para consolidar ou atualizar 'o que esta vencendo'. Dedup no mesmo dia, salvo forcar=true.",
    parametros: {"type":"object","properties":{"dias":{"type":"integer","description":"Janela em dias (default 7)."},"forcar":{"type":"boolean","description":"Regrava mesmo se identico ao perfil de hoje (default false)."}}},
    superficies: ["chat","job"],
  },
  custo_llm_periodo: {
    descricao:
      "Custo em USD derivado dos tokens gravados de chat e jobs no periodo (de/ate em YYYY-MM-DD).",
    parametros: {"type":"object","properties":{"de":{"type":"string","description":"Data inicial YYYY-MM-DD."},"ate":{"type":"string","description":"Data final YYYY-MM-DD."}},"required":["de","ate"]},
    superficies: ["chat","job"],
  },
  decidir_sobre_conjunto: {
    descricao:
      "Decide manter, maturar, trocar criativo ou preparar reversao para um conjunto, usando custo, volume e tendencia. Exige adset_external_id.",
    parametros: {"type":"object","properties":{"adset_external_id":{"type":"string"}},"required":["adset_external_id"]},
    superficies: ["chat","job"],
  },
  diagnosticar_custo: {
    descricao:
      "Diagnostica por que o custo por formulario de um anuncio subiu, comparando o ultimo dia com entrega aos 3 anteriores. Exige ad_external_id.",
    parametros: {"type":"object","properties":{"ad_external_id":{"type":"string"}},"required":["ad_external_id"]},
    superficies: ["chat","job"],
  },
  gerar_legendas: {
    descricao:
      "ESP-37, MOTOR DE LEGENDA: gera exatamente 3 variantes Hook -> Beneficio/prova -> CTA e grava em conversation_legendas. NAO cria anuncio. objetivo e obrigatorio; passe produto, meio e o drive_file_id do slate (get_slate_da_conversa).",
    parametros: {"type":"object","properties":{"produto":{"type":"string","description":"Ex.: imovel / la_felicita, juridico_whatsapp (COHAPM Juridico) ou consignado_clt (Legal). SEM default CLT."},"objetivo":{"type":"string","description":"O que a legenda deve comunicar (obrigatorio)."},"eixo":{"type":"string","description":"Sinonimo de objetivo."},"meio":{"type":"string","enum":["la_felicita","juridico","sistema_ocular"],"description":"Voz da marca. La Felicita = la_felicita."},"drive_file_id":{"type":"string","description":"Peca do Drive (do slate)."},"peca_chave":{"type":"string","description":"Chave estavel. Default = drive_file_id ou objetivo."},"referencias":{"type":"array","items":{"type":"string"},"description":"Ate 5 legendas de referencia (estilo)."}},"required":["objetivo"]},
    superficies: ["chat"],
  },
  get_acervo_para_anuncio: {
    descricao:
      "LEITURA do acervo do Drive para montar anuncio, com os ids da Meta e na_biblioteca_da_meta por peca. Em lote ou mix, chame SEM produto na primeira vez; quando o slate ja tem drive_file_ids, passe-os. Esta e a fonte para escolher peca do acervo — get_criativos_conteudo so tem anuncios ja no ar.",
    parametros: {"type":"object","properties":{"produto":{"type":"string","description":"Opcional. Em lote/mix deixe vazio na 1a chamada."},"incluir_inaptas":{"type":"boolean","description":"Padrao true."},"drive_file_ids":{"type":"array","items":{"type":"string"},"description":"Opcional. Recorte: so estes arquivos (slate conhecido)."},"meio":{"type":"string","enum":["la_felicita","juridico","sistema_ocular"]},"formatos":{"type":"array","items":{"type":"string"}}}},
    superficies: ["chat","job"], omitidos: {"job":["drive_file_ids"]},
  },
  get_ads_ranking: {
    descricao:
      "Ranking de criativos por gasto, alcance_soma_diaria, conversas, impressoes ou custo. Use ordenar_por=alcance quando perguntarem maior alcance. Recorte com name_like ou campaign_id (ID Meta) e passe date_from/date_to da janela. PROIBIDO dizer que alcance esta indisponivel sem chamar isto.",
    parametros: {"type":"object","properties":{"days":{"type":"number"},"ordenar_por":{"type":"string","description":"gasto|alcance|conversas|impressoes|custo"},"date_from":{"type":"string"},"date_to":{"type":"string"},"name_like":{"type":"string"},"campaign_id":{"type":"string"},"somente_ativas":{"type":"boolean"}}},
    superficies: ["chat","job"], omitidos: {"chat":["somente_ativas"]},
  },
  get_alerts: {
    descricao:
      "Alertas ativos do sistema (CPL, entrega, BM/politica, cobranca, WABA).",
    parametros: {"type":"object","properties":{}},
    superficies: ["chat","job"],
  },
  get_analise_visual_drive: {
    descricao:
      "VEREDITO VISUAL POR PECA das midias do Drive, ja persistido pelo especialista de visao: produto detectado pelos pixels, texto visivel, risco e veredito aproveitavel sim/nao/incerto com motivo. Use quando o gestor pedir para classificar as pecas da pasta. Recorte por meio e formatos.",
    parametros: {"type":"object","properties":{"meio":{"type":"string","enum":["la_felicita","juridico","sistema_ocular"]},"formatos":{"type":"array","items":{"type":"string"}}}},
    superficies: ["chat","job"],
  },
  get_aprovacoes: {
    descricao:
      "FILA REAL DE PEDIDOS DE APROVACAO desta empresa: estado, conjunto, destino_url do criativo e destination_type do conjunto. Chame ANTES de afirmar o estado de um card, se algo foi criado, se o anuncio tem o mesmo link do conjunto, ou o que esta pendente. Pergunta com '?' sem verbo de emitir se responde com esta tool, nao com propose_action.",
    parametros: {"type":"object","properties":{"apenas_abertos":{"type":"boolean","description":"true (recomendado) = so pendentes e aprovados; false = ultimos 25 de qualquer situacao."}}},
    superficies: ["chat"],
  },
  get_campaign_detail: {
    descricao:
      "Detalhe e serie diaria de UMA campanha (name_like OU campaign_id da Meta), com totais do periodo e special_ad_categories da CAMPANHA. Passe date_from/date_to quando o gestor der a janela. NAO substitui get_detalhe_anuncios, que traz a serie por anuncio e por conjunto.",
    parametros: {"type":"object","properties":{"name_like":{"type":"string"},"campaign_id":{"type":"string"},"date_from":{"type":"string"},"date_to":{"type":"string"}}},
    superficies: ["chat","job"],
  },
  get_conhecimento: {
    descricao:
      "BASE DE CONHECIMENTO TECNICA da casa: politica da Meta, compliance financeiro no Brasil, atlas de metricas, criacao e edicao de campanha/conjunto/anuncio, otimizacao e diagnostico, Marketing API e biblioteca de criativo. Use SEMPRE que a pergunta for conceitual, de politica, de metodo ou de definicao de metrica, e ao propor ou auditar criativo. Os temas validos estao no seu contexto; para anuncio financeiro e categoria especial o tema e 'compliance'.",
    parametros: {"type":"object","properties":{"tema":{"type":"string","description":"o tema exato, conforme a lista no seu contexto"},"secao":{"type":"string","description":"opcional: titulo (ou parte) de uma secao especifica do tema"}},"required":["tema"]},
    superficies: ["chat","job"],
  },
  get_criativos_conteudo: {
    descricao:
      "CONTEUDO REAL DOS ANUNCIOS JA NO AR, coletado pelo sync: legenda, titulo, CTA, se tem imagem, gasto acumulado, formularios, status, destino_url (link do CTA do criativo) e destino (whatsapp quando wa.me ou api.whatsapp, senao site). Use para qualquer pergunta sobre o que os anuncios dizem e para auditar compliance das pecas EM OPERACAO, passando a legenda daqui para check_compliance. Para achar UM anuncio especifico use busca_nome em vez de folhear a lista. NAO serve para escolher peca do acervo: isso e get_acervo_para_anuncio.",
    parametros: {"type":"object","properties":{"somente_ativas":{"type":"boolean","description":"true (recomendado) = so criativos em campanha ativa; false = historico operacional (PAUSED/CAMPAIGN_PAUSED), payload maior. Com busca_nome o default ja e false."},"busca_nome":{"type":"string","description":"Parte do nome do anuncio. Casa por pedaco e ignora maiusculas: 'reel02' acha 'AD_LPV2_A1_Reel02'."},"pagina":{"type":"integer","description":"So com busca_nome. Comeca em 1, 20 itens por pagina; leia 'restantes'."}}},
    superficies: ["chat","job"],
  },
  get_detalhe_anuncios: {
    descricao:
      "DETALHE POR ANUNCIO E POR CONJUNTO de UMA campanha: status, destino, CTA, totais da janela e serie diaria (gasto, impressoes, alcance, cliques, CTR, CPC, CPM, formularios, conversas). Aceita campaign_id (ID Meta) OU name_like; para 2 campanhas, chame 2 vezes. PAGINADO em 6 anuncios por pagina com serie: se restantes>0, pagine. PROIBIDO dizer que o detalhamento por anuncio 'nao foi retornado nesta rodada' sem ter chamado isto.",
    parametros: {"type":"object","properties":{"campaign_id":{"type":"string","description":"ID Meta da campanha (external_id)."},"name_like":{"type":"string","description":"Trecho do nome da campanha, se não tiver o ID."},"date_from":{"type":"string","description":"YYYY-MM-DD"},"date_to":{"type":"string","description":"YYYY-MM-DD"},"pagina":{"type":"number","description":"Página de anúncios, começando em 1."},"incluir_serie_diaria":{"type":"boolean","description":"Default true. false devolve mais anúncios sem a série."}}},
    superficies: ["chat","job"],
  },
  get_drive_criativos: {
    descricao:
      "INVENTARIO DA PASTA DE CRIATIVOS NOVOS no Google Drive (somente leitura): caminho, nome, tipo e data, sem thumbnail. Recorte com meio (la_felicita|juridico|sistema_ocular) e formatos (Reels, Videos). Use para LISTAR o que existe na pasta; nao substitui por get_criativos_conteudo, que traz anuncios ja no ar.",
    parametros: {"type":"object","properties":{"meio":{"type":"string","enum":["la_felicita","juridico","sistema_ocular"]},"formatos":{"type":"array","items":{"type":"string"}}}},
    superficies: ["chat","job"],
  },
  get_estrutura_conjuntos: {
    descricao:
      "ESTRUTURA DOS CONJUNTOS desta empresa: nome, status, campanha_status, entregando (true so se conjunto E campanha estao ACTIVE), estrategia de lance, orcamento, segmentacao, gasto e destination_type (WEBSITE vs WHATSAPP). PAGINADO de 20: use a pagina seguinte enquanto restantes for maior que zero.",
    parametros: {"type":"object","properties":{"pagina":{"type":"number","description":"Pagina, comecando em 1. Use a seguinte enquanto 'restantes' for maior que zero."}}},
    superficies: ["chat","job"], omitidos: {"job":["pagina"]},
  },
  get_funil_credito: {
    descricao:
      "FORA DE ESCOPO desde 28/07/2026: CRM e conversao final foram removidos do sistema por decisao da empresa. Existe so por compatibilidade e devolve um aviso de fora-de-escopo. NAO a chame; se o gestor pedir proposta, contrato ou receita, explique a exclusao e ofereca as metricas de midia.",
    parametros: {"type":"object","properties":{"dias":{"type":"number","description":"janela em dias (default 90). Use a MESMA janela do get_funnel ao comparar."}}},
    superficies: ["chat"],
  },
  get_funnel: {
    descricao:
      "Funil de MIDIA num periodo, com cobertura_real (dias efetivamente com dado). Nao contem proposta nem contrato.",
    parametros: {"type":"object","properties":{"date_from":{"type":"string"},"date_to":{"type":"string"}}},
    superficies: ["chat","job"],
  },
  get_instagram_dos_anuncios: {
    descricao:
      "LEITURA AO VIVO na Graph: o Instagram de CADA anuncio da campanha (conjuntos ACTIVE e PAUSED), com handle quando a Meta expoe, id e classificacao coop_cohapm|cohapm|outro|sem_vinculo|id_sem_handle. Chame antes de afirmar vinculo ou de emitir alteracao.",
    parametros: {"type":"object","properties":{"campanha":{"type":"string","description":"Nome da campanha (ex.: COHAPM_LAFELICITA_CONV_AGO26)."}},"required":["campanha"]},
    superficies: ["chat"],
  },
  get_legendas_da_conversa: {
    descricao:
      "MEMORIA DURAVEL das legendas desta conversa (conversation_legendas): devolve o texto INTEGRAL por peca_chave ou drive_file_id. OBRIGATORIO chamar ANTES de dizer que uma legenda 'nao existe' ou que o 'texto integral nao esta disponivel', e antes de pedir ao gestor para colar copy.",
    parametros: {"type":"object","properties":{"peca_chave":{"type":"string"},"drive_file_id":{"type":"string"}}},
    superficies: ["chat"],
  },
  get_meta_dicas: {
    descricao:
      "Dicas da Meta (Opportunity Score + campo classico recommendations), com first_seen_on/last_seen_on e veredito interno (concorda|discorda|nao_aplicavel|sem_regua).",
    parametros: {"type":"object","properties":{"dias":{"type":"integer","description":"Janela em dias (default 14)."},"veredito":{"type":"string","description":"Filtro opcional: concorda|discorda|nao_aplicavel|sem_regua"}}},
    superficies: ["chat","job"],
  },
  get_overview: {
    descricao:
      "Visao geral de MIDIA: campanhas ativas (status real da Meta), gasto e resultados dos ultimos 7 dias, com dias_com_dado para checar cobertura.",
    parametros: {"type":"object","properties":{}},
    superficies: ["chat","job"],
  },
  get_recommendations: {
    descricao:
      "FILA INTERNA de custo de midia (ai_recommendations, regua nossa). NAO e o badge do Ads Manager nem Opportunity Score — para dicas da Meta use get_meta_dicas.",
    parametros: {"type":"object","properties":{}},
    superficies: ["chat","job"],
  },
  get_slate_da_conversa: {
    descricao:
      "MEMORIA DURAVEL do SLATE desta conversa (conversation_slate): as pecas JA escolhidas, por CONJ.N, com nome, drive_file_id, angulo e CTA. OBRIGATORIO antes de dizer que 'o acervo nao traz o slate' ou de pedir ao gestor para re-colar as pecas.",
    parametros: {"type":"object","properties":{"conjunto":{"type":"number","description":"Opcional: so pecas deste CONJ.N."}}},
    superficies: ["chat"],
  },
  get_waba_status: {
    descricao:
      "INVENTARIO WHATSAPP da empresa. Obrigatorio para pergunta sobre numero operacional ou de pe, qual WA linkar, WABA, Cloud, qualidade ou tier, e para o isolamento Juridico vs La Felicita. Filtro meio=juridico|la_felicita|financeiro|outro. NAO decide se um conjunto CTWA pode ser emitido: isso e get_whatsapp_da_pagina.",
    parametros: {"type":"object","properties":{"meio":{"type":"string","description":"Opcional: juridico | la_felicita | financeiro | outro"}}},
    superficies: ["chat","job"],
  },
  get_waba_template_insights: {
    descricao:
      "Insights por TEMPLATE de WhatsApp numa janela: envios, entregues, leituras, cliques e taxa de clique.",
    parametros: {"type":"object","properties":{"days":{"type":"number","description":"janela em dias (default 30)"}}},
    superficies: ["job"],
  },
  get_whatsapp_da_pagina: {
    descricao:
      "CHECAGEM antes de emitir conjunto CTWA: diz se o numero e ativo WhatsApp da conta, olhando Pagina, WABAs do Business e conjuntos existentes. Distinto de get_waba_status, que e inventario. Escrita continua sendo propose_action.",
    parametros: {"type":"object","properties":{"numero":{"type":"string","description":"Telefone do conjunto (com ou sem o 9 extra)."}}},
    superficies: ["chat","job"],
  },
  ler_brand_identity: {
    descricao:
      "ESP-36: identidade de marca VIGENTE. COHAPM tem TRES vozes: meio=juridico | la_felicita | sistema_ocular (VISTTA). Sem meio, a RPC prefere juridico.",
    parametros: {"type":"object","properties":{"meio":{"type":"string","enum":["la_felicita","juridico","sistema_ocular"],"description":"Recorte de voz. Obrigatorio em COHAPM quando o pedido recorta um empreendimento."}}},
    superficies: ["chat","job"],
  },
  ler_entregas_digest: {
    descricao:
      "ESP-41: config de digest (cadencia, slots, e-mails, alerta critico) e entregas recentes com status por entrega. Use em 'o relatorio de hoje foi enviado?', 'chega por e-mail?', 'qual o horario do digest'.",
    parametros: {"type":"object","properties":{"dias":{"type":"integer","description":"Janela em dias (default 7)."}}},
    superficies: ["chat","job"],
  },
  ler_perfil_vencedor: {
    descricao:
      "ESP-34: le a ultima versao (ou uma versao especifica) do perfil do vencedor ja computado, com vencedores, padroes agregados, criterio, procedencia e lacunas. Leitura pura: nao recalcula.",
    parametros: {"type":"object","properties":{"versao":{"type":"integer","description":"Versao especifica; se ausente, retorna a mais recente."}}},
    superficies: ["chat","job"],
  },
  ler_pipeboard: {
    descricao:
      "Leitura AO VIVO do Pipeboard na conta Meta desta empresa. Use quando faltar dado que o banco nao cobre: config fresca do dia, breakdown, activities, pages, pixels, audiences, insight pontual.",
    parametros: {"type":"object","properties":{"ferramenta":{"type":"string","description":"Nome exato da tool Pipeboard de leitura (ex.: get_campaign_details)."},"argumentos":{"type":"object","description":"Argumentos da tool (account_id e injetado se a empresa tiver uma unica conta)."}},"required":["ferramenta"]},
    superficies: ["chat","job"],
  },
  listar_ferramentas_pipeboard: {
    descricao:
      "Catalogo ao vivo das ferramentas de LEITURA do Pipeboard. Use quando nao souber qual endpoint traz um dado que as leituras de banco nao cobrem; depois chame ler_pipeboard com o nome exato.",
    parametros: {"type":"object","properties":{}},
    superficies: ["chat","job"],
  },
  nota_visual_da_peca: {
    descricao:
      "Nota visual textual completa de UMA peca do Drive: revisao aberta, base, produto, aproveitabilidade, risco, motivo e divergencia de produto. Chame com o drive_file_id atual (vem de get_acervo_para_anuncio ou get_analise_visual_drive) antes de recomendar, classificar ou listar a peca como candidata.",
    parametros: {"type":"object","properties":{"drive_file_id":{"type":"string"}},"required":["drive_file_id"]},
    superficies: ["chat","job"],
  },
  origem_drive_dos_anuncios: {
    descricao:
      "PASTA DO DRIVE DE CADA ANUNCIO JA NO AR de um conjunto ou campanha. UMA chamada lista todos: nome, pasta, peca_nome, drive_file_id e vinculo. OBRIGATORIA quando o gestor pergunta de qual pasta do Drive sao os anuncios do CONJ.N. NAO e inventario de pecas novas (isso e get_acervo_para_anuncio), e NAO declare 'sem vinculo' sem ter chamado isto.",
    parametros: {"type":"object","properties":{"conjunto":{"type":"number","description":"Numero do conjunto (1-99). Preferivel."},"name_like":{"type":"string","description":"Trecho da campanha (ex.: VISTTA_CONV_WA_SET26) se houver mais de um CONJ.N."},"campaign_id":{"type":"string","description":"ID Meta da campanha."},"ad_external_id":{"type":"string","description":"Se quiser um anuncio so."},"incluir_apagados":{"type":"boolean","description":"Default false. DELETED/ARCHIVED ficam de fora."}}},
    superficies: ["chat","job"],
  },
  panorama_utm_anuncios: {
    descricao:
      "Coleta de url_tags e destino dos anuncios: nunca lido, lido sem/com rotulo, rotulos, ambiguidades e URLs. Chame antes de dizer se um teste A/B/C, variante ou rastreio e legivel, ou se existe vencedora.",
    parametros: {"type":"object","properties":{}},
    superficies: ["chat","job"],
  },
  pode_pausar_por_custo: {
    descricao:
      "Verifica se um anuncio pode ser AVALIADO para pausa por custo: libera quando maduro, ou pela excecao dura de zero resultado com CTR baixo e piso de gasto. Exige ad_external_id.",
    parametros: {"type":"object","properties":{"ad_external_id":{"type":"string"}},"required":["ad_external_id"]},
    superficies: ["chat","job"],
  },
  propose_action: {
    descricao:
      "Cria PEDIDO DE APROVACAO (ActionCard) para todo ato na conta Meta. NAO executa: o card fica PENDENTE, so um administrador aprova, e expira em 24h. SO use quando o gestor pedir o ato com verbo explicito (emitir, criar, subir, pausar, ativar, escalar, duplicar, renomear, alterar, vincular). PERGUNTA sem verbo de ato — inclusive 'antes da aprovacao' e 'o anuncio esta com o mesmo link' — se responde com get_aprovacoes, get_estrutura_conjuntos ou get_criativos_conteudo, NAO com esta tool. Exige justificativa, metrica_sucesso e reversa. target_name e o nome ATUAL do objeto; quando o nome nao for unico, mande params.alvo_external_id com o id da Meta. EXCLUIR nao existe em nenhum nivel: para tirar do ar use pausar_*. Sem approval_id no retorno, o card NAO existe.",
    parametros: {"type":"object","properties":{"action_type":{"type":"string","enum":["pausar_criativo","ativar_criativo","escalar_criativo","pausar_campanha","ativar_campanha","pausar_conjunto","ativar_conjunto","alterar_orcamento","renomear_campanha","renomear_conjunto","renomear_criativo","alterar_categoria_especial_campanha","ajustar_posicionamentos_do_conjunto","vincular_instagram_dos_anuncios","criar_campanha","criar_conjunto_a_partir_de","criar_anuncio_a_partir_de","escalar_duplicar"]},"target_name":{"type":"string"},"justificativa":{"type":"string"},"mecanismo":{"type":"string"},"metrica_sucesso":{"type":"string"},"janela_leitura":{"type":"string"},"reversa":{"type":"string"},"risco":{"type":"string"},"params":{"type":"object","description":"Campos da acao. alvo_external_id: id da Meta do objeto alvo, quando o nome nao for unico. Nome livre em nome / nome_novo / novo_nome. GEO: params.bairros ou params.geo_locations, com as keys de buscar_geolocalizacao."}},"required":["action_type","target_name","justificativa","metrica_sucesso","reversa"]},
    superficies: ["chat"],
  },
  registrar_legenda_da_conversa: {
    descricao:
      "Grava ou atualiza UMA legenda no store duravel desta conversa. Use quando propuser copy no chat SEM passar por gerar_legendas (ex.: slate de impulsao com legenda editorial) ou para marcar a variante escolhida pelo gestor. peca_chave estavel (carrossel_2, card_capa_1) + legenda integral, com drive_file_id quando houver.",
    parametros: {"type":"object","properties":{"peca_chave":{"type":"string"},"legenda":{"type":"string"},"drive_file_id":{"type":"string"},"variante_indice":{"type":"number"},"selecionada":{"type":"boolean"},"objetivo":{"type":"string"}},"required":["peca_chave","legenda"]},
    superficies: ["chat"],
  },
  registrar_peca_da_conversa: {
    descricao:
      "Grava UMA peca no slate duravel (conjunto + drive_file_id + nome). Use ao selecionar peca nova que deva persistir na hora; o sistema tambem extrai tabelas CONJ.N da propria conversa.",
    parametros: {"type":"object","properties":{"conjunto":{"type":"number"},"drive_file_id":{"type":"string"},"nome":{"type":"string"},"pasta":{"type":"string"},"angulo":{"type":"string"},"cta":{"type":"string"},"peca_chave":{"type":"string"}},"required":["conjunto","drive_file_id","nome"]},
    superficies: ["chat"],
  },
  registrar_veredito_peca_em_revisao: {
    descricao:
      "PROPOE veredito de compliance de uma peca em revisao emitindo um CARD DE APROVACAO. Valores: liberado_como_esta (se aprovado, desliga bloqueia_uso), ajustar_peca ou nao_usar (mantem o bloqueio).",
    parametros: {"type":"object","properties":{"drive_file_id":{"type":"string"},"veredito":{"type":"string","enum":["liberado_como_esta","ajustar_peca","nao_usar"]},"veredito_por":{"type":"string","description":"Opcional: quem pediu o veredito (ex.: Roberto). Registro informativo, NAO assinatura."},"nota":{"type":"string","description":"Opcional: condicao ou justificativa que acompanha a proposta."}},"required":["drive_file_id","veredito"]},
    superficies: ["chat"],
  },
  renomear_campanha: {
    descricao:
      "Emite CARD DE APROVACAO para renomear campanha existente, pelo update_campaign nativo do Pipeboard. NOME LIVRE: passe novo_nome com a string que o gestor quiser. Localiza a campanha pelo nome atual; ambiguidade exige o nome completo.",
    parametros: {"type":"object","properties":{"campanha_atual":{"type":"string"},"novo_nome":{"type":"string","description":"Nome livre desejado (prioridade)."},"marca":{"type":"string"},"canal":{"type":"string"},"objetivo_tag":{"type":"string"},"produto":{"type":"string"},"papel":{"type":"string","description":"TESTE ou ESCALA (opcional, so para sugestao estruturada)"},"rotulo":{"type":"string"},"periodo":{"type":"string"},"justificativa":{"type":"string"}},"required":["campanha_atual","novo_nome"]},
    superficies: ["chat"],
  },
  saude_das_integracoes: {
    descricao:
      "Saude das integracoes Meta desta empresa por evidencia de ads, snapshots, breakdown e tres relogios.",
    parametros: {"type":"object","properties":{"dias_tolerancia":{"type":"integer","description":"Opcional; padrao da RPC = 3 dias."}}},
    superficies: ["chat","job"],
  },
  saude_dos_tokens: {
    descricao:
      "ESP-30: saude dos tokens Meta (ads/waba) por METADADO gravado em meta_tokens: dias para expirar, dias para o fim do data_access, escopos faltando vs o esperado do papel e veredito (ok|expira_em_breve|expirado|data_access_expirado|escopo_incompleto|invalido). Use em 'o token vai vencer?', 'temos permissao pra X?', 'por que parou de coletar'.",
    parametros: {"type":"object","properties":{}},
    superficies: ["chat","job"],
  },
  score_de_prontidao: {
    descricao:
      "ESP-38: score 0-100 de prontidao da empresa para propor e executar anuncios, somando config de execucao (25), integracao Meta viva (25), postura de criacao (20), brand_identity (15), destino_por_produto (10) e driver resolvivel (5). Use em 'estamos prontos?', 'por que nao consigo criar anuncio?', 'o que falta'.",
    parametros: {"type":"object","properties":{}},
    superficies: ["chat","job"],
  },
  teto_vigente: {
    descricao:
      "FONTE PRIORITARIA do teto vigente de uma metrica (ex.: custo_por_formulario, custo_por_conversa, custo_por_lead_lp). Devolve qual regua governa, valor, denominador, autor/data/citacao da meta de negocio, consistencia historica e divergencias.",
    parametros: {"type":"object","properties":{"metric":{"type":"string","description":"Metrica exata, por exemplo custo_por_formulario, custo_por_conversa ou custo_por_lead_lp."}},"required":["metric"]},
    superficies: ["chat","job"],
  },
  upload_midia: {
    descricao:
      "Sobe UMA peca do Drive (imagem ou video) para a biblioteca da conta Meta e grava meta_image_hash ou meta_video_id. Use quando na_biblioteca_da_meta=false. NAO cria anuncio. Teto de arquivo = o da Meta: video ate 4 GB, imagem ate 8 MB — NAO recuse video entre 50 MB e 4 GB.",
    parametros: {"type":"object","properties":{"drive_file_id":{"type":"string","description":"Id do arquivo no Drive (vem de get_acervo_para_anuncio)."},"account_id":{"type":"string","description":"Opcional; default = unica conta permitida da empresa."}},"required":["drive_file_id"]},
    superficies: ["chat","job"],
  },
  validar_pedido_contra_contrato: {
    descricao:
      "Valida um pedido (json) contra o contrato declarado em contrato_de_execucao para a acao (criar_anuncio_a_partir_de, criar_conjunto_a_partir_de, criar_campanha...).",
    parametros: {"type":"object","properties":{"acao":{"type":"string","description":"Ex.: criar_anuncio_a_partir_de, criar_conjunto_a_partir_de, criar_campanha."},"pedido":{"type":"object","description":"Objeto com os campos do payload que o executor leria."}},"required":["acao","pedido"]},
    superficies: ["chat","job"],
  },
  vincular_instagram_dos_anuncios: {
    descricao:
      "Emite CARD DE APROVACAO para vincular o Instagram oficial @cohapm em TODOS os anuncios da campanha em trabalho que ainda nao o usam, conjuntos ativos e pausados. Le a Graph na hora da proposta.",
    parametros: {"type":"object","properties":{"campanha":{"type":"string","description":"Nome da campanha (ex.: COHAPM_LAFELICITA_CONV_AGO26)."},"justificativa":{"type":"string"}},"required":["campanha"]},
    superficies: ["chat"],
  },
};
