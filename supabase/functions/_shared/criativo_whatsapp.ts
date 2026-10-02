// Criativo de clique para WhatsApp. Puro: o card e o executor chamam a mesma montagem.
// Criativo e imutavel. Texto, botao ou saudacao errados nascem de novo e o anuncio e repontado.

import { LINK_CTWA_API_WHATSAPP } from "./destino_url_lp.ts";
import { campoIdentidadeInstagramPorFormato } from "./identidade_instagram.ts";

const DESTINOS_CONVERSA = new Set([
  "WHATSAPP",
  "CONVERSATIONS",
  "MESSAGING_MESSENGER_WHATSAPP",
  "MESSAGING_INSTAGRAM_DIRECT_MESSENGER_WHATSAPP",
]);

export function destinoEhConversaWhatsapp(destination: unknown): boolean {
  const d = String(destination ?? "").trim().toUpperCase();
  if (!d) return false;
  if (DESTINOS_CONVERSA.has(d)) return true;
  return d.includes("WHATSAPP");
}

export type RecusaCriativo = { ok: false; erro: string; detalhe: string };

export function montarPageWelcomeMessage(raw: unknown): { ok: true; valor: Record<string, unknown>; saudacao: string; pergunta: string } | RecusaCriativo {
  if (raw == null || raw === "") {
    return {
      ok: false,
      erro: "page_welcome_message_obrigatoria",
      detalhe:
        "Criativo de conjunto WhatsApp sem page_welcome_message nao nasce. A saudacao e o primeiro contato de todo lead.",
    };
  }
  if (typeof raw === "object" && !Array.isArray(raw)) {
    const o = raw as Record<string, unknown>;
    const saudacaoDireta = String(o.saudacao ?? o.texto ?? "").trim();
    const perguntaDireta = String(o.pergunta ?? o.autofill ?? "").trim();
    const jaEMeta = o.text_format != null || o.type != null || o.landing_screen_type != null;
    if (!jaEMeta && (saudacaoDireta || perguntaDireta)) {
      if (!saudacaoDireta || !perguntaDireta) {
        return {
          ok: false,
          erro: "page_welcome_message_incompleta",
          detalhe: "A saudacao na tela e a pergunta pre-preenchida sao as duas obrigatorias.",
        };
      }
      return {
        ok: true,
        saudacao: saudacaoDireta,
        pergunta: perguntaDireta,
        valor: {
          type: "VISUAL_EDITOR",
          version: 2,
          landing_screen_type: "welcome_message",
          media_type: "text",
          text_format: {
            customer_action_type: "autofill_message",
            message: {
              text: saudacaoDireta,
              autofill_message: { content: perguntaDireta },
            },
          },
        },
      };
    }
    if (jaEMeta && Object.keys(o).length > 0) {
      const texto = textoDaSaudacao(o);
      return {
        ok: true,
        valor: o,
        saudacao: texto.saudacao || "(saudacao no objeto Meta)",
        pergunta: texto.pergunta || "(pergunta no objeto Meta)",
      };
    }
  }
  return {
    ok: false,
    erro: "page_welcome_message_invalida",
    detalhe: "page_welcome_message e um objeto {saudacao, pergunta} ou o objeto Meta text_format.",
  };
}

function textoDaSaudacao(o: Record<string, unknown>): { saudacao: string; pergunta: string } {
  const tf = o.text_format;
  if (!tf || typeof tf !== "object") return { saudacao: "", pergunta: "" };
  const msg = (tf as Record<string, unknown>).message;
  if (!msg || typeof msg !== "object") return { saudacao: "", pergunta: "" };
  const m = msg as Record<string, unknown>;
  const auto = m.autofill_message;
  const pergunta = auto && typeof auto === "object"
    ? String((auto as Record<string, unknown>).content ?? "").trim()
    : "";
  return { saudacao: String(m.text ?? "").trim(), pergunta };
}

export function ctaIncompativelComDestino(cta: unknown, destination: unknown): RecusaCriativo | null {
  const c = String(cta ?? "").trim().toUpperCase();
  const d = String(destination ?? "").trim().toUpperCase();
  if (!d) {
    return {
      ok: false,
      erro: "destination_type_obrigatorio",
      detalhe: "Sem o destino do conjunto nao da para saber se o botao cabe. Passe destination_type.",
    };
  }
  if (destinoEhConversaWhatsapp(d)) {
    if (c !== "WHATSAPP_MESSAGE") {
      return {
        ok: false,
        erro: "cta_incompativel_com_destino",
        detalhe:
          `CTA ${c || "(vazio)"} nao cabe em conjunto ${d}. O botao tem de ser WHATSAPP_MESSAGE com app_destination WHATSAPP. ` +
          "LEARN_MORE / Saiba mais dentro de conjunto de conversas derruba o conjunto inteiro (1885882).",
      };
    }
    return null;
  }
  if ((d === "WEBSITE" || d === "LANDING_PAGE_VIEWS") && (c === "WHATSAPP_MESSAGE" || c === "MESSAGE_PAGE")) {
    return {
      ok: false,
      erro: "cta_incompativel_com_destino",
      detalhe: `CTA ${c} nao cabe em destino ${d}.`,
    };
  }
  if (!c) {
    return {
      ok: false,
      erro: "cta_obrigatorio",
      detalhe: "Informe call_to_action_type.",
    };
  }
  return null;
}

export type CriativoMontado = {
  ok: true;
  body: Record<string, string>;
  resumo: string;
  saudacao: string;
  pergunta: string;
};

function specDoPedido(pedido: Record<string, unknown>): Record<string, unknown> | null {
  const bruto = pedido.object_story_spec;
  if (bruto && typeof bruto === "object" && !Array.isArray(bruto)) return bruto as Record<string, unknown>;
  if (typeof bruto !== "string" || !bruto.trim()) return null;
  try {
    const parsed = JSON.parse(bruto);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as Record<string, unknown> : null;
  } catch {
    return null;
  }
}

/** Quantos slides o pedido traz. Zero quando nao ha carrossel. */
export function contarSlidesDoPedido(pedido: Record<string, unknown> | null | undefined): number {
  const p = pedido ?? {};
  if (Array.isArray(p.child_attachments)) return p.child_attachments.length;
  const spec = specDoPedido(p);
  const kids = (spec?.link_data as { child_attachments?: unknown } | undefined)?.child_attachments;
  return Array.isArray(kids) ? kids.length : 0;
}

/**
 * O nome da acao decide. criar_criativo com 2+ slides e recusado antes do card,
 * senão o carrossel sai pelo Pipeboard e morre em "No media provided".
 * criar_criativo_carrossel com menos de 2 slides tambem e recusado, senão o nome
 * vira atalho para forcar Graph em criativo comum.
 */
export function recusarContagemDeSlides(
  acao: string,
  pedido: Record<string, unknown> | null | undefined,
): RecusaCriativo | null {
  const n = contarSlidesDoPedido(pedido);
  if (acao === "criar_criativo" && n >= 2) {
    return {
      ok: false,
      erro: "carrossel_na_acao_errada",
      detalhe:
        "Dois ou mais slides nao entram em criar_criativo. Use criar_criativo_carrossel. O Pipeboard aceita o parametro child_attachments e devolve No media provided (medido em dry_run em 02/10/2026).",
    };
  }
  if (acao === "criar_criativo_carrossel" && n < 2) {
    return {
      ok: false,
      erro: "carrossel_sem_slides_suficientes",
      detalhe:
        "criar_criativo_carrossel exige dois ou mais slides. Criativo de uma peca usa criar_criativo.",
    };
  }
  return null;
}

export function montarCriativoDeClique(p: Record<string, unknown> | null | undefined): CriativoMontado | RecusaCriativo {
  const pedido = p ?? {};
  const recusaSlides = recusarContagemDeSlides("criar_criativo", pedido);
  if (recusaSlides) return recusaSlides;
  const videoId = String(pedido.video_id ?? pedido.meta_video_id ?? "").trim();
  const imageHash = String(pedido.image_hash ?? pedido.meta_image_hash ?? "").trim();
  if (!!videoId === !!imageHash) {
    return {
      ok: false,
      erro: "peca_obrigatoria",
      detalhe: "Informe video_id ou image_hash, um dos dois. A peca vem de upload_midia ou do acervo.",
    };
  }
  const thumb = String(pedido.thumbnail_url ?? pedido.image_url ?? "").trim();
  if (videoId && !thumb) {
    return {
      ok: false,
      erro: "thumbnail_url_obrigatoria",
      detalhe: "Video sem thumbnail_url: a Meta recusa com 1443226.",
    };
  }
  const pageId = String(pedido.page_id ?? "").trim();
  if (!pageId) {
    return { ok: false, erro: "page_id_obrigatorio", detalhe: "Criativo sem page_id nao tem emissor." };
  }
  const ig = String(pedido.instagram_actor_id ?? pedido.instagram_user_id ?? "").trim();
  if (!ig) {
    return {
      ok: false,
      erro: "instagram_actor_id_obrigatorio",
      detalhe: "Sem instagram_actor_id o anuncio so roda no Facebook.",
    };
  }
  const message = String(pedido.message ?? pedido.legenda ?? pedido.texto ?? "").trim();
  if (!message) {
    return { ok: false, erro: "message_obrigatoria", detalhe: "O texto principal do anuncio e obrigatorio." };
  }
  const destination = pedido.destination_type ?? pedido.destino;
  const cta = String(pedido.call_to_action_type ?? (destinoEhConversaWhatsapp(destination) ? "WHATSAPP_MESSAGE" : "")).trim();
  const ctaRecusa = ctaIncompativelComDestino(cta, destination);
  if (ctaRecusa) return ctaRecusa;

  const conversa = destinoEhConversaWhatsapp(destination);
  let welcome: { valor: Record<string, unknown>; saudacao: string; pergunta: string } | null = null;
  if (conversa || pedido.page_welcome_message != null) {
    const w = montarPageWelcomeMessage(pedido.page_welcome_message);
    if (!w.ok) return w;
    welcome = w;
  }
  if (conversa && !welcome) {
    return {
      ok: false,
      erro: "page_welcome_message_obrigatoria",
      detalhe:
        "Criativo de conjunto WhatsApp sem page_welcome_message nao nasce. A saudacao e o primeiro contato de todo lead.",
    };
  }

  const appDest = String(pedido.app_destination ?? (conversa ? "WHATSAPP" : "")).trim().toUpperCase();
  if (conversa && appDest !== "WHATSAPP") {
    return {
      ok: false,
      erro: "app_destination_incompativel",
      detalhe: "Conversa WhatsApp exige app_destination WHATSAPP.",
    };
  }

  const nome = String(pedido.nome ?? pedido.nome_novo ?? pedido.name ?? "criativo").trim() || "criativo";
  const desligar = pedido.disable_all_enhancements !== false;
  const ctaObj: Record<string, unknown> = conversa
    ? { type: "WHATSAPP_MESSAGE", value: { app_destination: "WHATSAPP", link: LINK_CTWA_API_WHATSAPP } }
    : { type: cta.toUpperCase(), ...(pedido.link ? { value: { link: String(pedido.link) } } : {}) };

  const miolo: Record<string, unknown> = {
    message,
    call_to_action: ctaObj,
    ...(welcome ? { page_welcome_message: welcome.valor } : {}),
  };
  if (videoId) {
    miolo.video_id = videoId;
    miolo.image_url = thumb;
  } else {
    miolo.image_hash = imageHash;
    if (pedido.link && !conversa) miolo.link = String(pedido.link);
  }

  const spec: Record<string, unknown> = {
    page_id: pageId,
    [campoIdentidadeInstagramPorFormato(ig)]: ig,
    ...(videoId ? { video_data: miolo } : { link_data: miolo }),
  };

  const body: Record<string, string> = {
    name: nome,
    object_story_spec: JSON.stringify(spec),
  };
  if (desligar) {
    body.degrees_of_freedom_spec = JSON.stringify({
      creative_features_spec: {
        standard_enhancements: { enroll_status: "OPT_OUT" },
      },
    });
  }

  const linhas = [
    `Criativo "${nome}"`,
    videoId ? `Peca: video ${videoId}` : `Peca: imagem ${imageHash}`,
    `Texto: ${message.slice(0, 180)}`,
    `Botao: ${String(ctaObj.type)}`,
    welcome ? `Saudacao: ${welcome.saudacao}` : "Saudacao: (destino nao e conversa)",
    welcome ? `Pergunta: ${welcome.pergunta}` : "",
    `Pagina ${pageId}, Instagram ${ig}`,
    desligar ? "Melhorias de imagem: desligadas" : "Melhorias de imagem: ligadas",
  ].filter(Boolean);

  return {
    ok: true,
    body,
    resumo: linhas.join(". "),
    saudacao: welcome?.saudacao ?? "",
    pergunta: welcome?.pergunta ?? "",
  };
}

export function montarCriativoCarrossel(p: Record<string, unknown> | null | undefined): CriativoMontado | RecusaCriativo {
  const pedido = p ?? {};
  const recusaSlides = recusarContagemDeSlides("criar_criativo_carrossel", pedido);
  if (recusaSlides) return recusaSlides;
  const n = contarSlidesDoPedido(pedido);
  if (n > 10) {
    return {
      ok: false,
      erro: "carrossel_tamanho_invalido",
      detalhe: `Carrossel exige 2 a 10 slides; recebi ${n}.`,
    };
  }
  const pageId = String(pedido.page_id ?? "").trim();
  if (!pageId) {
    return { ok: false, erro: "page_id_obrigatorio", detalhe: "Criativo sem page_id nao tem emissor." };
  }
  const ig = String(pedido.instagram_actor_id ?? pedido.instagram_user_id ?? "").trim();
  if (!ig) {
    return {
      ok: false,
      erro: "instagram_actor_id_obrigatorio",
      detalhe: "Sem instagram_actor_id o anuncio so roda no Facebook.",
    };
  }
  const message = String(pedido.message ?? pedido.legenda ?? pedido.texto ?? "").trim();
  if (!message) {
    return { ok: false, erro: "message_obrigatoria", detalhe: "O texto principal do anuncio e obrigatorio." };
  }
  const linkPai = String(pedido.link ?? pedido.destino_url ?? "").trim();
  const ctaTipo = String(pedido.call_to_action_type ?? "LEARN_MORE").trim() || "LEARN_MORE";
  const bruto = Array.isArray(pedido.child_attachments)
    ? pedido.child_attachments
    : ((specDoPedido(pedido)?.link_data as { child_attachments?: unknown[] } | undefined)?.child_attachments ?? []);
  const cards: Record<string, unknown>[] = [];
  for (let i = 0; i < bruto.length; i++) {
    const c = bruto[i] as Record<string, unknown> | null;
    if (!c || typeof c !== "object") {
      return { ok: false, erro: "carrossel_slide_invalido", detalhe: `Slide ${i + 1} nao e objeto.` };
    }
    const hash = String(c.image_hash ?? c.meta_image_hash ?? "").trim();
    if (!hash) {
      return {
        ok: false,
        erro: "carrossel_slide_sem_image_hash",
        detalhe: `Slide ${i + 1} sem image_hash. Faca upload_midia de cada peca antes.`,
      };
    }
    const link = String(c.link ?? linkPai).trim();
    if (!link) {
      return {
        ok: false,
        erro: "carrossel_slide_sem_link",
        detalhe: `Slide ${i + 1} sem link e sem link pai no pedido.`,
      };
    }
    const card: Record<string, unknown> = {
      image_hash: hash,
      link,
      call_to_action: { type: ctaTipo, value: { link } },
    };
    const name = String(c.name ?? c.headline ?? "").trim();
    const description = String(c.description ?? "").trim();
    if (name) card.name = name;
    if (description) card.description = description;
    cards.push(card);
  }
  const nome = String(pedido.nome ?? pedido.nome_novo ?? pedido.name ?? "carrossel").trim() || "carrossel";
  const spec: Record<string, unknown> = {
    page_id: pageId,
    [campoIdentidadeInstagramPorFormato(ig)]: ig,
    link_data: {
      message,
      link: linkPai || String((cards[0]?.link ?? "")),
      child_attachments: cards,
      multi_share_optimized: true,
      call_to_action: { type: ctaTipo, value: { link: linkPai || String(cards[0]?.link ?? "") } },
    },
  };
  const body: Record<string, string> = {
    name: nome,
    object_story_spec: JSON.stringify(spec),
  };
  return {
    ok: true,
    body,
    resumo: `Carrossel "${nome}" com ${cards.length} slides. Pagina ${pageId}, Instagram ${ig}. Sai pela Graph: o Pipeboard aceita child_attachments e devolve No media provided.`,
    saudacao: "",
    pergunta: "",
  };
}
