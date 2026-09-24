function deacc(s: string): string {
  return s.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
}

/** Verbos de emitir/criar/pausar — so estes autorizam propose_action. */
export const RE_PEDIDO_DE_ATO =
  /\b(crie|criar|cria|suba|subir|lance|lancar|proponha|propor|duplique|duplicar|escale|escalar|pause|pausar|ative|ativar|altere|alterar|aumente|aumentar|reduza|reduzir|emita|emitir|emissao|emitindo|aprove|aprovar|replique|replicar|monte|montar|quero subir|vamos criar)\b/;

const RE_VERBO_FORTE_ATO =
  /\b(suba|subir|lance|lancar|proponha|propor|duplique|duplicar|escale|escalar|pause|pausar|ative|ativar|emita|emitir|emissao|emitindo|aprove|aprovar|replique|replicar|quero subir|vamos criar)\b/;

/** "monte um ranking" / "crie um relatorio" — o objeto do verbo e entrega de leitura. */
const RE_VERBO_COM_ENTREGA_ANALITICA =
  /\b(crie|criar|cria|monte|montar|faca|fazer)\s+(um |uma |o |a |os |as )?(ranking|ranqueamento|relatorio|verificacao|diagnostico|analise|tabela|lista|panorama|comparativo|resumo|parecer)\b/;

/** "altere o orcamento" / "monte os conjuntos" — verbo fraco com objeto de escrita. */
const RE_VERBO_FRACO_COM_OBJETO_DE_ESCRITA =
  /\b(crie|criar|cria|altere|alterar|aumente|aumentar|reduza|reduzir|monte|montar)\s+.{0,50}\b(cards?|aprovacoes?|campanhas?|conjuntos?|anuncios?|criativos?|or[cç]amentos?|publicos?|lances?)\b/;

/**
 * Leitura de desempenho: o gestor quer numero, ranking ou verificacao — nao card.
 * "monte um ranking dos conjuntos" tem verbo de ato no regex, mas o objeto e a analise.
 */
export function ehLeituraDeDesempenho(pedido: string): boolean {
  const p = deacc(String(pedido ?? "").toLowerCase());
  if (!p) return false;
  const temAlvo = /\b(campanhas?|conjuntos?|anuncios?|criativ|ad ?sets?)\b/.test(p);
  if (!temAlvo) return false;
  return (
    /\b(ranking|ranqueamento|ranquear)\b/.test(p) ||
    /\b(verificacao|verifique|verificar|identifique|identificar)\b/.test(p) ||
    /\b(gastando mais|mais gast|gasto (por|dos|das|nas|nos)|quais.{0,40}gast)\b/.test(p) ||
    /\b(desempenho|pior|melhor).{0,40}(conjunto|campanha|anuncio)\b/.test(p) ||
    /\b(mesmas? informacoes|todos os valores|valores dos conjuntos)\b/.test(p) ||
    /\b(cenario|desde a criacao|data inicial|quanto gastou|preco de conversa)\b/.test(p) ||
    ehPedidoRelacaoNumerica(p)
  );
}

/**
 * Relação geográfica / público-alvo por conjunto. NÃO é tabela de gasto.
 * Medido 18/09/2026: "relação geográfica de cada conjunto" caía em
 * ehPedidoRelacaoNumerica só pela palavra "relação" e o job despejava
 * criativos/CPL no lugar do targeting.
 */
export function ehPedidoRelacaoGeoPublico(pedido: string): boolean {
  const p = deacc(String(pedido ?? "").toLowerCase());
  if (!p) return false;
  const nivel =
    /\bconjuntos?\b/.test(p) ||
    /\bcampanhas?\b/.test(p) ||
    /\bad ?sets?\b/.test(p);
  if (!nivel) return false;
  const geo =
    /\bgeo\w*\b/.test(p) ||
    /\b(bairro|cidades?|regioes?|localizac\w*|segmentac\w*)\b/.test(p);
  const publico =
    /\bpublico[- ]alvo\b/.test(p) ||
    (/\bpublico\b/.test(p) && /\b(definid|abrang|alvo|targeting|segment)\b/.test(p)) ||
    /\btargeting\b/.test(p);
  return geo || publico;
}

/** Relação/tabela de gasto, conversa, impressão e orçamento por conjunto e por criativo. */
export function ehPedidoRelacaoNumerica(pedido: string): boolean {
  const p = deacc(String(pedido ?? "").toLowerCase());
  if (!p) return false;
  if (ehPedidoRelacaoGeoPublico(p)) return false;
  const nivel = /\bconjuntos?\b/.test(p) || /\bcriativ/.test(p) || /\banuncios?\b/.test(p);
  if (!nivel) return false;
  const metrica =
    /\b(gastos?|conversas?|impressoes|orcamento|preco|cpl|cpa|ctr|alcance|frequencia|valores?)\b/.test(p);
  const tabela =
    /\b(relacao|tabela|liste|lista|informacoes)\b/.test(p) ||
    /\bmostrando os gastos\b/.test(p) ||
    /\b(traga|traz|trazer|mostre|mostrar)\b/.test(p) ||
    (/\b(gastos?|valores?)\b/.test(p) && /\b(conversas?|impressoes|orcamento|conjuntos?)\b/.test(p));
  return tabela && metrica;
}

export function ehPedidoDeAto(pedido: string): boolean {
  const p = deacc(String(pedido ?? "").toLowerCase());
  if (!p) return false;
  if (RE_VERBO_FORTE_ATO.test(p)) return true;
  // "monte um ranking dos conjuntos" nao e criar conjunto: o objeto do verbo e a analise.
  if (RE_VERBO_COM_ENTREGA_ANALITICA.test(p)) {
    return RE_VERBO_FRACO_COM_OBJETO_DE_ESCRITA.test(
      p.replace(RE_VERBO_COM_ENTREGA_ANALITICA, " "),
    );
  }
  if (ehLeituraDeDesempenho(p) && !RE_VERBO_FRACO_COM_OBJETO_DE_ESCRITA.test(p)) return false;
  return RE_PEDIDO_DE_ATO.test(p);
}

/**
 * Pergunta de leitura: o gestor quer saber um fato, nao emitir card.
 * "antes da aprovacao, o anuncio esta com o mesmo link?" NAO e pedido de ato.
 */
export function ehPerguntaDeLeitura(pedido: string): boolean {
  const raw = String(pedido ?? "").trim();
  if (!raw || ehPedidoDeAto(raw)) return false;
  const p = deacc(raw.toLowerCase());
  if (/\?/.test(raw)) return true;
  if (ehPedidoRelacaoGeoPublico(p) || ehLeituraDeDesempenho(p) || RE_VERBO_COM_ENTREGA_ANALITICA.test(p)) return true;
  return /\b(antes da aprova|esta com o mesmo|qual (o |a )?(link|destino|url)|o anuncio esta|o card esta|confere se|verifique se|me diga se|consult(ar|e|a)\b)/.test(
    p,
  );
}

/**
 * O gestor mandou EMITIR/PAUSAR/CRIAR e o turno acabou sem UMA chamada de propose_action.
 *
 * O DEFEITO QUE ISTO CONSERTA (01/09/2026, 19:00–19:30, conjunto CONJ.2 do VISTTA): em cinco
 * rodadas seguidas o gestor pediu cards — de pausa e de anuncio — e a resposta anunciou
 * "6 Cards de Pausa Emitidos" e "2 Cards Emitidos" com tabela e approval_id. O registro de
 * ferramentas dessas rodadas mostra get_acervo_para_anuncio, get_slate_da_conversa,
 * registrar_peca_da_conversa e gerar_legendas — e NENHUM propose_action. Nenhum card foi
 * criado em 30 minutos. O modelo narrou o ato em vez de praticar.
 *
 * O guarda de texto que ja existia so reescrevia a mentira: o gestor deixava de ser enganado,
 * mas continuava sem os cards. Reescrever nao emite. Aqui a decisao e outra — devolver o turno
 * ao modelo exigindo a chamada de verdade.
 *
 * NAO dispara quando propose_action FOI chamada e recusou: recusa e informacao honesta, com
 * motivo, e insistir so repetiria o mesmo erro. Tambem nao dispara sem tempo de janela, nem
 * duas vezes no mesmo turno — insistir sem fim gastaria a janela inteira sem entregar nada.
 */
export function deveForcarEmissao(t: {
  pedido: string;
  chamouPropose: boolean;
  cardsEmitidos: number;
  semTempo?: boolean;
  jaInsistiu?: boolean;
}): boolean {
  if (t.jaInsistiu || t.semTempo) return false;
  if (t.chamouPropose || t.cardsEmitidos > 0) return false;
  if (pedidoSoLegendasSemEmissao(t.pedido)) return false;
  if (pedidoComentarioDoPostSemEmissao(t.pedido)) return false;
  return ehPedidoDeAto(t.pedido);
}

const RE_ATO_DE_LEGENDA =
  /\b(crie|criar|cria|gere|gerar|monte|montar|escreva|escrever|produza|produzir)\s+(as\s+|os\s+|umas?\s+|novas?\s+|novos\s+)?(legendas?|copys?|copy|textos?)\b/;

/**
 * "selecione 6 videos e CRIE LEGENDAS para cada um" tem verbo de ato, mas o ato e escrever
 * copy — nao emitir card. Sem esta excecao o turno passa a exigir propose_action e o sistema
 * emitiria anuncio que o gestor nao pediu (02/09/2026, Drive do Juridico).
 */
export function pedidoSoLegendasSemEmissao(pedido: string): boolean {
  const p = deacc(String(pedido ?? "").toLowerCase());
  if (!p) return false;
  if (
    /\b(cards?|aprovacao|aprovacoes|emit\w*|publiq\w*|publicar|anunci\w*|pause|pausar|suba|subir)\b/.test(
      p,
    )
  ) {
    return false;
  }
  return RE_ATO_DE_LEGENDA.test(p);
}

/**
 * Desativar comentario do post (Instagram/Business Suite) nao e ato de anuncio.
 * Sem esta excecao, "altere os comentarios" casa `altere` e o turno exige propose_action
 * — e o modelo tenta pausar campanha ou inventa card (10/09/2026, 14 turbinagens).
 * Pause/card no mesmo pedido continua sendo emissao.
 */
export function pedidoComentarioDoPostSemEmissao(pedido: string): boolean {
  const p = deacc(String(pedido ?? "").toLowerCase());
  if (!p) return false;
  if (!/comentari/.test(p)) return false;
  if (
    !/(desativ|deslig|desabilit|fech\w+\s+coment|permitir comentari|alter\w*.{0,60}comentari|comentari.{0,40}(off|deslig|desativ|fech))/.test(
      p,
    )
  ) {
    return false;
  }
  if (
    /\b(cards?|aprovacao|aprovacoes|emit\w*|pause|pausar|suba|subir|or[cç]amento|renome)/.test(p)
  ) {
    return false;
  }
  return true;
}

/** "emita os cards dos 2 primeiros conjuntos" — nao e anuncio avulso nem ranking de conjuntos. */
export function ehPedidoEmitirConjunto(pedido: string): boolean {
  if (!ehPedidoDeAto(pedido) || ehPerguntaDeLeitura(pedido) || ehLeituraDeDesempenho(pedido)) {
    return false;
  }
  const t = deacc(String(pedido ?? "").toLowerCase());
  return /\bconjuntos?\b/.test(t);
}

/**
 * "emita os proximos cards" pede um lote na mesma janela.
 * "emita o card do Rayban" pede uma peca so.
 */
export function pedidoPedeVariosCards(pedido: string): boolean {
  const p = deacc(String(pedido ?? "").toLowerCase());
  if (!p) return false;
  if (/\b(so|apenas|somente)\s+(um|1)\s+card\b/.test(p)) return false;
  if (/\b(o|esse|este|um|1)\s+card\b/.test(p) && !/\bcards\b/.test(p)) return false;
  return /\bcards\b/.test(p);
}

const RE_CONTINUA_ATO_FIO =
  /\b(conjunto|campanha|anuncio|numeros?|whatsapp|waba|telefone|wa\.me)\b/;

/**
 * Follow-up sem verbo de ato ("serão 4 conjuntos, números…") continua o criar/emitir
 * do turno anterior. Sem isto o sincrono trata a fala como Q&A curto.
 *
 * Medido 22/09/2026 (Ocular): "traga as mesmas informações / valores dos conjuntos"
 * NÃO é follow-up do "altere vermelho e amarelo" — é leitura nova. Sem esta guarda
 * o composto herdava o ato, o Executor entrava e a prosa virava "nenhum card".
 */
export function objetivoDoFio(atual: string, anteriores: string[]): string {
  const cur = String(atual ?? "").trim();
  if (!cur) return cur;
  // 23/09/2026 ocular: "gere legendas e separe os conjuntos" no meio de um fio
  // que ja tinha "emita os cards". O composto herdava o verbo de card, a janela
  // gastava o acervo inteiro e a resposta dizia que faltou emitir card.
  if (pedidoSoLegendasSemEmissao(cur)) return cur;
  if (ehPedidoDeAto(cur) || ehPerguntaDeLeitura(cur) || ehLeituraDeDesempenho(cur)) return cur;
  const prev = (anteriores ?? [])
    .map((s) => String(s ?? "").trim())
    .filter(Boolean)
    .slice(-2);
  if (!prev.length) return cur;
  const composto = `${prev.join("\n")}\n${cur}`;
  if (!ehPedidoDeAto(composto)) return cur;
  if (!RE_CONTINUA_ATO_FIO.test(deacc(cur.toLowerCase()))) return cur;
  return composto;
}

/**
 * Recusa inventada: pede molde de trafego ou desvio para ENGAGEMENT.
 * Nao e clarificacao legitima — sem_molde vale para OUTCOME_TRAFFIC.
 */
export function recusaFalsaMoldeTrafego(texto: string): boolean {
  const t = deacc(String(texto ?? "").toLowerCase());
  if (!t) return false;
  const recusa =
    /nao (consigo|posso|vou) (emitir|criar|propor)/.test(t) ||
    /cards? nao (foram|foi) emitid/.test(t) ||
    /bloqueio tecnico/.test(t) ||
    /sem dado obrigat/.test(t) ||
    /nao invente um molde/.test(t) ||
    /nao (posso|consigo) inventar/.test(t);
  const pedeMolde =
    /molde de trafego/.test(t) ||
    (/conjunto (de )?trafego/.test(t) && /nome exato/.test(t)) ||
    /nome exato.*(molde|conjunto)/.test(t) ||
    /forne(ca|cer|cendo) (o )?nome/.test(t);
  const desvioEng =
    /outcome_engagement/.test(t) ||
    /engajamento social/.test(t) ||
    /impulsao de pagina/.test(t) ||
    /crie em engajamento/.test(t) ||
    /alter(ar|em) manualmente no gerenciador/.test(t);
  return recusa && (pedeMolde || desvioEng);
}

/**
 * Recusa de emitir alterar_orcamento porque "faltou custo por conversa" /
 * "não dá para separar vermelho e amarelo". Medido 22/09/2026 (Ocular):
 * get_detalhe_anuncios JÁ tinha custo_por_resultado por conjunto; vermelho/
 * amarelo/verde neste fio é a classificação do turno do Jurídico, não um
 * status da Meta. Fechar o turno aqui impede o card.
 */
export function recusaFalsaClassificacaoSemMetrica(texto: string): boolean {
  const t = deacc(String(texto ?? "").toLowerCase());
  if (!t) return false;
  const recusa =
    /nenhum card foi emitido/.test(t) ||
    /nao ha como separar/.test(t) ||
    /sem (a )?classificacao/.test(t) ||
    /nao (vou|posso|consigo) (emitir|alterar)/.test(t);
  const metrica =
    /custo por conversa/.test(t) ||
    /separar vermelho e amarelo/.test(t) ||
    /conjunto errado/.test(t);
  return recusa && metrica;
}

/**
 * Alterar orçamento por cor/desempenho precisa da tool de métrica no mesmo
 * turno (AG-02). Sem isso o Executor só tem propose_action e recusa.
 */
export function pedidoAtoPrecisaMetrica(pedido: string): boolean {
  const p = deacc(String(pedido ?? "").toLowerCase());
  if (!p || !ehPedidoDeAto(p)) return false;
  if (pedidoSoLegendasSemEmissao(p) || pedidoComentarioDoPostSemEmissao(p)) return false;
  const cor = /\b(vermelho|amarelo|verde)\b/.test(p);
  const orc =
    /\b(or[cç]amento|valores?)\b/.test(p) ||
    /\b\d+[.,]\d{2}\b/.test(p);
  const conj = /\bconjuntos?\b/.test(p);
  return (cor && /\b(altere|alterar|reduza|reduzir|aumente|aumentar)\b/.test(p)) ||
    (conj && orc && /\b(altere|alterar|reduza|reduzir|aumente|aumentar)\b/.test(p));
}

/**
 * Pedido de valores/tabela dos conjuntos em que a prosa só falou de card
 * (ou não montou tabela). As tools podem ter o número; a resposta não.
 */
export function replyOmitiuValoresDosConjuntos(texto: string, pedido: string): boolean {
  if (!ehPedidoRelacaoNumerica(pedido) && !ehLeituraDeDesempenho(pedido)) return false;
  if (ehPedidoDeAto(pedido)) return false;
  const raw = String(texto ?? "").trim();
  const t = deacc(raw.toLowerCase());
  if (!t) return true;
  const pipes = (raw.match(/\|/g) || []).length;
  const temTabela = pipes >= 8 && /conjunto/i.test(raw);
  const temNumeros =
    /\bconj\b/i.test(raw) &&
    /r\$\s*\d/.test(t) &&
    /\b(gasto|conversa|impress)/.test(t);
  if (temTabela || temNumeros) return false;
  return /nenhum card|nao houve verbo|nao sera inventado|pedido de aprovacao/.test(t) ||
    raw.length < 500;
}

/**
 * "suba os videos restantes" / "carregue as pecas na biblioteca".
 * O chat nao deve cortar a continuacao na 2a bolha nem pedir eco ao gestor.
 */
export function ehPedidoUploadLote(pedido: string): boolean {
  const p = deacc(String(pedido ?? "").toLowerCase());
  const verbo =
    /\b(suba|subir|envie|enviar|carregue|carregar|uploade?|faca upload|fazer upload|termine de subir|terminar de subir)\b/.test(
      p,
    );
  const alvo =
    /\b(videos?|midia|pecas?|arquivos?|restantes?|faltantes?|pendentes?|biblioteca|drive|acervo|na meta|ficaram de fora)\b/.test(
      p,
    );
  const inventario =
    /\b(ja estao na meta|ficaram de fora|quais dos \d+)\b/.test(p) &&
    /\b(video|peca|arquivo|biblioteca|meta)\b/.test(p);
  return (verbo && alvo) || inventario;
}

/** 1–3 pecas restantes: um bloco HTTP deve tentar fecha-las, sem teatro de 8 segmentos. */
export function ehUploadLoteCurto(pedido: string, nPendentes?: number): boolean {
  if (typeof nPendentes === "number" && nPendentes > 0 && nPendentes <= 3) return true;
  const p = deacc(String(pedido ?? "").toLowerCase());
  return (
    /\b([123]|um|dois|tres)\b/.test(p) && /\b(ultimos?|pendentes?|faltantes?|restantes?)\b/.test(p)
  );
}

/** Detalhamento de campanha/anúncio/série diária — coleta completa, nao Q&A pontual. */
export function ehPedidoDetalhamentoCampanha(pedido: string): boolean {
  const p = deacc(String(pedido ?? "").toLowerCase());
  if (!p) return false;
  const pedeDetalhe =
    /\b(detalhamento|detalhe|detalha|detalhar|maturacao|serie diaria|desempenho.{0,60}(campanha|anuncio|conjunto|criativ)|por anuncio|por conjunto|ranking por|abertura por (anuncio|peca|criativo))\b/.test(
      p,
    ) ||
    /\b(ranking|ranque).{0,60}(gasto|gastando|conjunto|campanha|anuncio)\b/.test(p) ||
    /\b(conjuntos?|campanhas?).{0,80}(ranking|gastando mais|mais gast)\b/.test(p) ||
    /\bverificacao.{0,80}(conjuntos?|campanhas?).{0,80}(gast|ranking)\b/.test(p) ||
    (/\b(campanha|anuncio|conjunto)\b/.test(p) &&
      /\b(id\b|external_id|7 dias|sete dias|janela)\b/.test(p) &&
      /\b(gasto|ctr|formular|engaj|impress|alcance|desempenho|resultado)\b/.test(p)) ||
    (/\bcampanhas?\b/.test(p) &&
      /\d{8,}/.test(p) &&
      /\b(janela|\d+\s*dias|anuncio|conjunto|desempenho|analise|detalh)\b/.test(p));
  const temAlvo = /\b(campanhas?|anuncios?|conjuntos?|criativ|ad set|adset)\b/.test(p);
  return (pedeDetalhe && temAlvo) || ehPedidoRelacaoNumerica(p);
}

/**
 * "de qual pasta do Drive sao os anuncios do CONJ.N?" — leitura de ORIGEM,
 * nao inventario de pecas novas e nao ato de emitir.
 *
 * Medido 02/09/2026: o pedido do CONJ.1 VISTTA foi tratado como inventario
 * (get_drive_criativos vazio + chute de 2.mp4) e 5 de 6 anuncios sairam
 * "sem vinculo" embora os cards de criacao tivessem pasta e drive_file_id.
 */
export function ehPedidoOrigemDriveDosAnuncios(pedido: string): boolean {
  const raw = String(pedido ?? "").trim();
  if (!raw || ehPedidoDeAto(raw)) return false;
  const p = deacc(raw.toLowerCase());
  const anuncioOuConj =
    /\b(anuncios?|criativos?)\b/.test(p) &&
    (/\bconj(?:unto)?s?\b/.test(p) || /\bregistrad/.test(p) || /\b(no ar|de pe|ativos?)\b/.test(p));
  const pasta =
    /\b(qual pasta|quais pastas|pasta do drive|pastas do drive|pertencem a qual|de qual pasta|origem.{0,40}drive|vinculo.{0,40}drive|drive_file_id)\b/.test(
      p,
    );
  if (
    /\bselecion/.test(p) &&
    /\b(video|peca|arquivo)\b/.test(p) &&
    !/\b(qual pasta|pertencem|registrad)\b/.test(p)
  ) {
    return false;
  }
  return anuncioOuConj && pasta;
}

/** Leitura que cruza anuncio no ar × peca do Drive — nao cabe no Luna mais barato. */
export function ehPedidoLeituraCruzada(pedido: string): boolean {
  if (ehPedidoOrigemDriveDosAnuncios(pedido)) return true;
  const p = deacc(String(pedido ?? "").toLowerCase());
  return (
    /\b(casar|cruzar|vincular|associar|de onde veio|origem da peca)\b/.test(p) &&
    /\b(drive|anuncio|criativo|conjunto)\b/.test(p)
  );
}

/**
 * Relatorio de leitura que declara lacuna ou pede nova pergunta —
 * o sistema deve continuar o bloco, nao encerrar o turno.
 */
export function replyLeituraIncompleta(texto: string): boolean {
  const t = deacc(String(texto ?? "").toLowerCase());
  if (!t) return false;
  const lacuna =
    /nao (foi |foram )?(retornad|lid[oa]|disponivel|coletad).{0,60}nesta (rodada|consulta|resposta)/.test(
      t,
    ) ||
    /nao ficou disponivel nesta rodada/.test(t) ||
    /nao foi possivel (confirmar|verificar) nesta (resposta|rodada)/.test(t) ||
    /nao (foi |foram )?possivel verificar nesta rodada/.test(t) ||
    /o levantamento veio incompleto/.test(t) ||
    /serie diaria.{0,400}nao (disponivel|retornada|lida)/.test(t) ||
    /detalhamento (dos anuncios|por anuncio).{0,400}nao (foi |foram )?(lid|retorn)/.test(t) ||
    /consulta nao realizada nesta rodada/.test(t) ||
    /sem vinculo (rastreavel|registrado)/.test(t) ||
    /nao ha evidencia suficiente/.test(t) ||
    /nao rastreavel no cadastro/.test(t) ||
    /drive_file_id necessario/.test(t);
  const pedeEco =
    /envie (novamente|de novo) (uma )?(nova )?pergunta/.test(t) ||
    /manda(r)? enviar novamente/.test(t) ||
    /peca (de novo|novamente).{0,50}(focado|pergunta|pedido|forma mais)/.test(t) ||
    /item ficou para a proxima/.test(t) ||
    /para o usuario poder pedir so esses depois/.test(t);
  return lacuna || pedeEco;
}
