// Prova local destino_url_lp (video_data.link / CTWA). Rode:
//   deno run supabase/functions/_shared/_prova_destino_url_lp.ts
import {
  aplicarLinkNoVideoData,
  aplicarLinkNoLinkData,
  sanitizarVideoDataParaGraph,
  urlWhatsAppMe,
  ehUrlWhatsApp,
  ctaPadraoMensagensWhatsApp,
  destinoDoPedidoCompat,
} from "./destino_url_lp.ts";

function assert(cond: boolean, msg: string) {
  if (!cond) throw new Error(msg);
}

// Meta 1443050: video_data NAO pode ter link no topo.
const vd = aplicarLinkNoVideoData(
  { video_id: "1", message: "oi", call_to_action: { type: "CONTACT_US", value: {} } },
  "https://wa.me/5571991088073",
);
assert(!("link" in vd), "video_data sem link no topo");
assert(
  (vd.call_to_action as any).value.link === "https://wa.me/5571991088073",
  "CTA.value.link preenchido",
);

const herdado = sanitizarVideoDataParaGraph({
  video_id: "2",
  link: "https://www.facebook.com/profile.php?id=1",
  call_to_action: { type: "LEARN_MORE", value: { link: "https://x.com" } },
});
assert(!("link" in herdado), "sanitizar remove link");

const ld = aplicarLinkNoLinkData(
  { image_hash: "abc", call_to_action: { type: "LEARN_MORE", value: {} } },
  "https://legaleviver.com.br/simulacao-clt",
);
assert(ld.link === "https://legaleviver.com.br/simulacao-clt", "link_data.link ok");

assert(urlWhatsAppMe("5571991088073") === "https://wa.me/5571991088073", "phone");
assert(urlWhatsAppMe("https://wa.me/5571993058759") === "https://wa.me/5571993058759", "wa.me");
assert(ehUrlWhatsApp("https://wa.me/1") === true, "eh wa");
assert(ctaPadraoMensagensWhatsApp("LEARN_MORE") === "CONTACT_US", "cta CTWA");
assert(ctaPadraoMensagensWhatsApp("CONTACT_US") === "CONTACT_US", "cta keep");

const d = destinoDoPedidoCompat({
  destino_do_anuncio: {
    caso: "mensagens_whatsapp",
    url_final: "https://wa.me/5571991088073",
    aplicavel: true,
  },
});
assert(d.aplicavel === true && d.caso === "mensagens_whatsapp", "compat CTWA");

console.log("ok: _prova_destino_url_lp");
