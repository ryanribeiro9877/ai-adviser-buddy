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
  caso?:
    | "clt"
    | "engajamento_social"
    | "mensagens_whatsapp"
    | "outro"
    | "outro_sem_lp_decidida"
    | "indeterminado"
    | string
    | null;
  url_do_molde?: string | null;
  url_canonica?: string | null;
  url_final?: string | null;
  corrigir?: boolean | null;
  mensagem?: string | null;
};

/** Page/IG profile URL for OUTCOME_ENGAGEMENT / AWARENESS ads (no LP conversion). */
export function urlDestinoSocialTopo(pageId: string, igHandle?: string | null): string {
  const pid = String(pageId ?? "").trim();
  // Prefer Page (mesmo padrao do card Capa1 IMPULSAO 20/08 que publicou com sucesso).
  if (pid) return `https://www.facebook.com/profile.php?id=${pid}`;
  const handle = String(igHandle ?? "").trim().replace(/^@/, "");
  if (handle) return `https://www.instagram.com/${handle}/`;
  return "";
}

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
    // CLT = LP; engajamento_social = Page/IG; mensagens_whatsapp = wa.me (CTWA).
    aplicavel:
      d.caso === "clt" || d.caso === "engajamento_social" || d.caso === "mensagens_whatsapp",
    corrigiu: deveCorrigirParaCanonico(d),
    url_final: d.url_final ?? null,
    url_original: d.url_do_molde ?? null,
    produto: d.produto ?? null,
    sinal: d.sinal ?? null,
    caso: d.caso ?? null,
    mensagem: d.mensagem ?? null,
  };
}

/** True se a URL e destino Click-to-WhatsApp (wa.me / api.whatsapp.com). */
export function ehUrlWhatsApp(url: unknown): boolean {
  return /wa\.me|api\.whatsapp\.com/i.test(String(url ?? ""));
}

/**
 * Normaliza telefone ou URL para https://wa.me/<digits>.
 * Aceita +55…, 5571…, wa.me/…, api.whatsapp.com/send?phone=…
 */
export function urlWhatsAppMe(phoneOrUrl: unknown): string {
  const raw = String(phoneOrUrl ?? "").trim();
  if (!raw) return "";
  if (/api\.whatsapp\.com/i.test(raw)) {
    const m = raw.match(/[?&]phone=(\d+)/i);
    if (m?.[1]) return `https://wa.me/${m[1]}`;
  }
  if (/wa\.me/i.test(raw)) {
    const m = raw.match(/wa\.me\/(\d+)/i);
    if (m?.[1]) return `https://wa.me/${m[1]}`;
  }
  const digits = raw.replace(/\D/g, "");
  if (digits.length >= 10) return `https://wa.me/${digits}`;
  return "";
}

/**
 * CTA tipico de CTWA nos anuncios Juridico/LF ja publicados: CONTACT_US + wa.me.
 * LEARN_MORE/SEE_MORE com Page URL e incompativel com destination_type=WHATSAPP.
 */
export function ctaPadraoMensagensWhatsApp(ctaAtual?: unknown): string {
  const c = String(ctaAtual ?? "").trim().toUpperCase();
  if (
    c === "CONTACT_US" ||
    c === "WHATSAPP_MESSAGE" ||
    c === "MESSAGE_PAGE" ||
    c === "SEND_MESSAGE"
  ) {
    return c;
  }
  return "CONTACT_US";
}

/**
 * Grava o destino SO em call_to_action.value.link.
 * Medido 22/08/2026 (cards a703e076 / 934e1a2f): Graph #100 subcode 1443050 —
 * "O campo link não é suportado no campo video_data de object_story_spec."
 * Remove video_data.link se existir (herdado de molde ou bug antigo).
 */
export function aplicarLinkNoVideoData(
  vd: Record<string, unknown>,
  link: string,
): Record<string, unknown> {
  const novo: Record<string, unknown> = { ...vd };
  delete novo.link;
  const cta = vd.call_to_action;
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
  } else {
    novo.call_to_action = { type: "LEARN_MORE", value: { link } };
  }
  return novo;
}

/** Grava o link em link_data.link e call_to_action.value.link (anúncio de imagem). */
export function aplicarLinkNoLinkData(
  ld: Record<string, unknown>,
  link: string,
): Record<string, unknown> {
  const novo: Record<string, unknown> = { ...ld, link };
  const cta = ld.call_to_action;
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

/** Remove link de topo em video_data antes do POST /adcreatives (Meta 1443050). */
export function sanitizarVideoDataParaGraph(
  vd: Record<string, unknown>,
): Record<string, unknown> {
  if (!vd || typeof vd !== "object") return vd;
  if (!("link" in vd)) return vd;
  const novo = { ...vd };
  delete novo.link;
  return novo;
}
