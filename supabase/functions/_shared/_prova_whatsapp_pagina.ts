// Prova local: deno run supabase/functions/_shared/_prova_whatsapp_pagina.ts
import {
  variantesDigitosWhatsAppBr,
  preferidoWhatsAppParaAds,
  mesmaLinhaWhatsApp,
  casarNumeroWhatsApp,
  ehRecusaWhatsappNaoLigado,
  candidatosPromotedObjectCtwa,
  SUBCODE_WA_NAO_LIGADO,
} from "./whatsapp_pagina.ts";

function assert(cond: boolean, msg: string) {
  if (!cond) throw new Error(msg);
}

// VISTTA / Ads Manager +55 71 9189-4229 vs payload 5571991894229 (9 extra).
assert(preferidoWhatsAppParaAds("5571991894229") === "557191894229", "VISTTA 13→12");
assert(preferidoWhatsAppParaAds("7199189-4229") === "557191894229", "nome conjunto 7199189-4229");
assert(preferidoWhatsAppParaAds("+55 71 9189-4229") === "557191894229", "display Gerenciador");
assert(mesmaLinhaWhatsApp("5571991894229", "557191894229"), "mesmo numero 13 e 12");
assert(mesmaLinhaWhatsApp("5571991894229", "557191088073") === false, "nao cruza JUR");

// JUR que entrega: Graph 557191088073, display +55 71 99108-8073.
assert(preferidoWhatsAppParaAds("5571991088073") === "557191088073", "JUR 13→12");
assert(preferidoWhatsAppParaAds("557191088073") === "557191088073", "JUR ja 12");
assert(variantesDigitosWhatsAppBr("5571991088073").includes("557191088073"), "variante 12 na lista");

// Landline LF CONJ.3: 12 digitos, nao inventa 9.
assert(preferidoWhatsAppParaAds("557131803158") === "557131803158", "fixo 12");

const match = casarNumeroWhatsApp("5571991894229", [
  { display: "+55 71 9189-4229", digitos: "557191894229", phone_number_id: "1282892438232205", fontes: ["page"] },
  { display: "+55 71 99108-8073", digitos: "557191088073", phone_number_id: "1229636373572780", fontes: ["jur"] },
]);
assert(match?.digitos === "557191894229", "casa VISTTA nao JUR");
assert(match?.phone_number_id === "1282892438232205", "leva o id do match");

assert(ehRecusaWhatsappNaoLigado({
  error: { error_subcode: SUBCODE_WA_NAO_LIGADO, error_user_msg: "This WhatsApp phone number is not linked to your account" },
}), "1487246");

const cands = candidatosPromotedObjectCtwa({
  pageId: "105656372312257",
  pedido: "5571991894229",
  match: {
    display: "+55 71 9189-4229",
    digitos: "557191894229",
    phone_number_id: "1282892438232205",
    fontes: ["page"],
  },
});
assert(cands[0].promoted.whatsapp_phone_number === "+55 71 9189-4229", "primeiro e o display do Gerenciador");
assert(cands[0].destination_type === "MESSAGING_MESSENGER_WHATSAPP", "primeiro destino manual Messenger+WA");
assert(cands.some((c) => c.destination_type === "WHATSAPP"), "tambem tenta dest so WA");
assert(cands.some((c) => c.promoted.whatsapp_phone_number === "5571991894229"), "tambem tenta 13");
assert(cands.some((c) => c.promoted.whatsapp_phone_number === "+557191894229"), "E.164 com +");

console.log("ok: _prova_whatsapp_pagina");
