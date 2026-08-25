/** Espelho de src/lib/intencao-turno.ts */
function deacc(s: string): string {
  return s.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
}

export const RE_PEDIDO_DE_ATO =
  /\b(crie|criar|cria|criacao|suba|subir|lance|lancar|proponha|propor|duplique|duplicar|escale|escalar|pause|pausar|ative|ativar|altere|alterar|aumente|aumentar|reduza|reduzir|emita|emitir|emissao|emitindo|aprove|aprovar|replique|replicar|monte|montar|quero subir|vamos criar)\b/;

export function ehPedidoDeAto(pedido: string): boolean {
  return RE_PEDIDO_DE_ATO.test(deacc(String(pedido ?? "").toLowerCase()));
}

export function ehPerguntaDeLeitura(pedido: string): boolean {
  const raw = String(pedido ?? "").trim();
  if (!raw || ehPedidoDeAto(raw)) return false;
  const p = deacc(raw.toLowerCase());
  if (/\?/.test(raw)) return true;
  return /\b(antes da aprova|esta com o mesmo|qual (o |a )?(link|destino|url)|o anuncio esta|o card esta|confere se|verifique se|me diga se|consult(ar|e|a)\b)/.test(
    p,
  );
}

/** "emita os cards dos 2 primeiros conjuntos" — nao e anuncio avulso. */
export function ehPedidoEmitirConjunto(pedido: string): boolean {
  const t = deacc(String(pedido ?? "").toLowerCase());
  return ehPedidoDeAto(pedido) && /\bconjuntos?\b/.test(t);
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
 * Nao e clarificacao: o turno so fecha quando todos os faltantes subiram
 * (ou a ferramenta recusou teto horario de verdade).
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
