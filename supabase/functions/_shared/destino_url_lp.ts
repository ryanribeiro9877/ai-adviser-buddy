// Destino de anúncio por PRODUTO (não por domínio) — Legal e Viver.
//
// CORREÇÃO 11/08/2026: a versão anterior corrigia por DOMÍNIO (legaleviver.com.br →
// /simulacao-clt), o que reescreveria um anúncio de outro produto do mesmo domínio para a
// LP de CLT. O critério certo é o PRODUTO/OFERTA do anúncio.
//
// A decisão de produto + URL é tomada na EMISSÃO pela RPC resolver_destino_do_anuncio e
// viaja no card em payload.destino_do_anuncio. A executora NÃO reinfere nem reescreve por
// domínio: ela apenas HONRA a decisão da emissão. Três casos:
//   - caso 'clt' com corrigir=true  → aplica url_final (/simulacao-clt).
//   - caso 'clt' já canônico        → nada a fazer.
//   - 'outro_sem_lp_decidida' / 'outro' / 'indeterminado' → PRESERVA a URL do molde.
// Sem decisão no payload (card antigo ou externo) → PRESERVA (fail-safe: nunca reescreve
// às cegas).

export const COMPANY_LEGAL_E_VIVER = "ded20b38-f42e-4c71-800c-31b97ea48bcf";

export type DestinoDoAnuncio = {
  aplicavel?: boolean;
  produto?: string | null;
  sinal?: string | null;
  confianca?: string | null;
  caso?: "clt" | "outro" | "outro_sem_lp_decidida" | "indeterminado" | string | null;
  url_do_molde?: string | null;
  url_canonica?: string | null;
  url_final?: string | null;
  corrigir?: boolean | null;
  mensagem?: string | null;
};

/** Lê a decisão de destino resolvida na emissão (RPC), que a executora deve honrar. */
export function destinoDoPedido(p: any): DestinoDoAnuncio | null {
  const d = p?.destino_do_anuncio ?? null;
  if (!d || typeof d !== "object") return null;
  return d as DestinoDoAnuncio;
}

/** Deve a executora reescrever o link do criativo? Só quando a emissão decidiu CLT + corrigir. */
export function deveCorrigirParaCanonico(d: DestinoDoAnuncio | null): d is DestinoDoAnuncio & { url_final: string } {
  return !!d && d.caso === "clt" && d.corrigir === true && typeof d.url_final === "string" && d.url_final.length > 0;
}

// Forma de compatibilidade para os call sites da executora (peça nova vídeo, peça nova imagem,
// replicação, reuso). Mantém as chaves { aplicavel, corrigiu, url_final, url_original } que o
// código já consome, mas com SEMÂNTICA POR PRODUTO: só é "aplicável" quando o produto é CLT
// (única LP decidida). Produto OUTRO / indeterminado → aplicavel=false → a URL do molde é
// preservada. A decisão vem da emissão (payload.destino_do_anuncio); sem ela, preserva.
export type DestinoCompat = {
  aplicavel: boolean;
  corrigiu: boolean;
  url_final: string | null;
  url_original: string | null;
  produto: string | null;
  sinal: string | null;
  caso: string | null;
  mensagem: string | null;
};

export function destinoDoPedidoCompat(p: any): DestinoCompat {
  const d = destinoDoPedido(p);
  if (!d) {
    return {
      aplicavel: false,
      corrigiu: false,
      url_final: null,
      url_original: null,
      produto: null,
      sinal: null,
      caso: null,
      mensagem: null,
    };
  }
  return {
    aplicavel: d.caso === "clt",
    corrigiu: deveCorrigirParaCanonico(d),
    url_final: d.url_final ?? null,
    url_original: d.url_do_molde ?? null,
    produto: d.produto ?? null,
    sinal: d.sinal ?? null,
    caso: d.caso ?? null,
    mensagem: d.mensagem ?? null,
  };
}

/** Grava o link em video_data.link e call_to_action.value.link, se existirem. */
export function aplicarLinkNoVideoData(vd: Record<string, unknown>, link: string): Record<string, unknown> {
  return aplicarLinkNoBloco(vd, link);
}

/** Grava o link em link_data.link e call_to_action.value.link, se existirem (anúncio de imagem). */
export function aplicarLinkNoLinkData(ld: Record<string, unknown>, link: string): Record<string, unknown> {
  return aplicarLinkNoBloco(ld, link);
}

// video_data e link_data compartilham o formato { link, call_to_action: { value: { link } } }.
function aplicarLinkNoBloco(bloco: Record<string, unknown>, link: string): Record<string, unknown> {
  const novo: Record<string, unknown> = { ...bloco, link };
  const cta = bloco.call_to_action;
  if (cta && typeof cta === "object") {
    const ctaObj = cta as Record<string, unknown>;
    const value = ctaObj.value;
    if (value && typeof value === "object") {
      novo.call_to_action = {
        ...ctaObj,
        value: { ...(value as Record<string, unknown>), link },
      };
    } else {
      novo.call_to_action = { ...ctaObj, value: { link } };
    }
  }
  return novo;
}
