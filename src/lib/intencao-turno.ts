function deacc(s: string): string {
  return s.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
}

/** Verbos de emitir/criar/pausar — so estes autorizam propose_action. */
export const RE_PEDIDO_DE_ATO =
  /\b(crie|criar|cria|criacao|suba|subir|lance|lancar|proponha|propor|duplique|duplicar|escale|escalar|pause|pausar|ative|ativar|altere|alterar|aumente|aumentar|reduza|reduzir|emita|emitir|emissao|emitindo|aprove|aprovar|replique|replicar|monte|montar|quero subir|vamos criar)\b/;

export function ehPedidoDeAto(pedido: string): boolean {
  return RE_PEDIDO_DE_ATO.test(deacc(String(pedido ?? "").toLowerCase()));
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
  return ehPedidoDeAto(t.pedido);
}

/** "emita os cards dos 2 primeiros conjuntos" — nao e anuncio avulso. */
export function ehPedidoEmitirConjunto(pedido: string): boolean {
  const t = deacc(String(pedido ?? "").toLowerCase());
  return ehPedidoDeAto(pedido) && /\bconjuntos?\b/.test(t);
}

const RE_CONTINUA_ATO_FIO =
  /\b(conjunto|campanha|anuncio|numeros?|whatsapp|waba|telefone|wa\.me)\b/;

/**
 * Follow-up sem verbo de ato ("serão 4 conjuntos, números…") continua o criar/emitir
 * do turno anterior. Sem isto o sincrono trata a fala como Q&A curto.
 */
export function objetivoDoFio(atual: string, anteriores: string[]): string {
  const cur = String(atual ?? "").trim();
  if (!cur) return cur;
  if (ehPedidoDeAto(cur) || ehPerguntaDeLeitura(cur)) return cur;
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
 * "suba os videos restantes" / "carregue as pecas na biblioteca".
 * O chat nao deve cortar a continuacao na 2a bolha nem pedir eco ao gestor.
 */
export function ehPedidoUploadLote(pedido: string): boolean {
  const p = deacc(String(pedido ?? "").toLowerCase());
  const verbo =
    /\b(suba|subir|envie|enviar|carregue|carregar|uploade?|faca upload|fazer upload|termine de subir|terminar de subir)\b/.test(p);
  const alvo =
    /\b(videos?|midia|pecas?|arquivos?|restantes?|faltantes?|pendentes?|biblioteca|drive|acervo|na meta|ficaram de fora)\b/.test(p);
  const inventario =
    /\b(ja estao na meta|ficaram de fora|quais dos \d+)\b/.test(p) &&
    /\b(video|peca|arquivo|biblioteca|meta)\b/.test(p);
  return (verbo && alvo) || inventario;
}

/** 1–3 pecas restantes: um bloco HTTP deve tentar fecha-las, sem teatro de 8 segmentos. */
export function ehUploadLoteCurto(pedido: string, nPendentes?: number): boolean {
  if (typeof nPendentes === "number" && nPendentes > 0 && nPendentes <= 3) return true;
  const p = deacc(String(pedido ?? "").toLowerCase());
  return /\b([123]|um|dois|tres)\b/.test(p) &&
    /\b(ultimos?|pendentes?|faltantes?|restantes?)\b/.test(p);
}

/** Detalhamento de campanha/anúncio/série diária — coleta completa, nao Q&A pontual. */
export function ehPedidoDetalhamentoCampanha(pedido: string): boolean {
  const p = deacc(String(pedido ?? "").toLowerCase());
  if (!p) return false;
  const pedeDetalhe =
    /\b(detalhamento|detalhe|detalha|detalhar|maturacao|serie diaria|desempenho.{0,60}(campanha|anuncio|conjunto|criativ)|por anuncio|por conjunto|ranking por|abertura por (anuncio|peca|criativo))\b/.test(p)
    || (/\b(campanha|anuncio|conjunto)\b/.test(p) && /\b(id\b|external_id|7 dias|sete dias|janela)\b/.test(p) &&
      /\b(gasto|ctr|formular|engaj|impress|alcance|desempenho|resultado)\b/.test(p))
    || (/\bcampanhas?\b/.test(p) && /\d{8,}/.test(p) &&
      /\b(janela|\d+\s*dias|anuncio|conjunto|desempenho|analise|detalh)\b/.test(p));
  const temAlvo = /\b(campanhas?|anuncios?|conjuntos?|criativ|ad set|adset)\b/.test(p);
  return pedeDetalhe && temAlvo;
}

/**
 * Relatorio de leitura que declara lacuna ou pede nova pergunta —
 * o sistema deve continuar o bloco, nao encerrar o turno.
 */
export function replyLeituraIncompleta(texto: string): boolean {
  const t = deacc(String(texto ?? "").toLowerCase());
  if (!t) return false;
  const lacuna =
    /nao (foi |foram )?(retornad|lid[oa]|disponivel|coletad).{0,60}nesta (rodada|consulta|resposta)/.test(t)
    || /nao ficou disponivel nesta rodada/.test(t)
    || /nao foi possivel (confirmar|verificar) nesta (resposta|rodada)/.test(t)
    || /nao (foi |foram )?possivel verificar nesta rodada/.test(t)
    || /o levantamento veio incompleto/.test(t)
    || /serie diaria.{0,400}nao (disponivel|retornada|lida)/.test(t)
    || /detalhamento (dos anuncios|por anuncio).{0,400}nao (foi |foram )?(lid|retorn)/.test(t)
    || /consulta nao realizada nesta rodada/.test(t);
  const pedeEco =
    /envie (novamente|de novo) (uma )?(nova )?pergunta/.test(t)
    || /manda(r)? enviar novamente/.test(t)
    || /peca (de novo|novamente).{0,50}(focado|pergunta|pedido|forma mais)/.test(t)
    || /item ficou para a proxima/.test(t)
    || /para o usuario poder pedir so esses depois/.test(t);
  return lacuna || pedeEco;
}
