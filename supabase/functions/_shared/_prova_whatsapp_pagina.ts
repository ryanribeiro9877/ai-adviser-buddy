// Prova local: deno run supabase/functions/_shared/_prova_whatsapp_pagina.ts
import {
  variantesDigitosWhatsAppBr,
  preferidoWhatsAppParaAds,
  mesmaLinhaWhatsApp,
  casarNumeroWhatsApp,
  ehRecusaWhatsappNaoLigado,
  candidatosPromotedObjectCtwa,
  parecerPedidoWhatsAppConjunto,
  diagnosticoRecusaWhatsApp,
  formatDisplayWhatsAppGerenciador,
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
// A recusa 1487246 de 01/09 veio com "+55 71 9189-4229" no promoted_object: display
// nunca entra no payload, so digitos.
assert(cands[0].promoted.whatsapp_phone_number === "557191894229", "primeiro e o 12 digitos");
assert(cands[0].destination_type === "WHATSAPP", "primeiro destino so WhatsApp");
assert(cands.every((c) => c.destination_type === "WHATSAPP"), "nenhum Messenger no retry");
assert(
  cands.every((c) => /^\+?\d+$/.test(c.promoted.whatsapp_phone_number)),
  "nenhum candidato leva display formatado",
);
assert(cands.some((c) => c.promoted.whatsapp_phone_number === "5571991894229"), "tambem tenta 13");
assert(cands.some((c) => c.promoted.whatsapp_phone_number === "+557191894229"), "E.164 com +");

assert(formatDisplayWhatsAppGerenciador("557191894229") === "+55 71 9189-4229", "display CONJ.1");

// Sem match no inventario a API recusa: o parecer nao pode prometer o conjunto.
const parecerSemMatch = parecerPedidoWhatsAppConjunto("5571991894229");
assert(parecerSemMatch.pode_usar_no_conjunto === false, "sem WABA nao promete conjunto");
assert(parecerSemMatch.e_ativo_whatsapp_da_conta === false, "nao e ativo da conta");
assert(parecerSemMatch.whatsapp_phone_number === "557191894229", "parecer devolve digitos");
assert(parecerSemMatch.display_gerenciador === "+55 71 9189-4229", "display separado do payload");
assert(parecerSemMatch.destination_type === "WHATSAPP", "destino so WA");

const parecerComMatch = parecerPedidoWhatsAppConjunto("5571991894229", match);
assert(parecerComMatch.pode_usar_no_conjunto === true, "ativo da conta pode emitir");
assert(
  parecerComMatch.whats_app_business_phone_number_id === "1282892438232205",
  "parecer leva o id da WABA",
);
assert(parecerPedidoWhatsAppConjunto("abc").pode_usar_no_conjunto === false, "lixo nao usa");

const diag = diagnosticoRecusaWhatsApp({
  numero: "5571991894229",
  temIdWaba: false,
  formatosTentados: ["wa_12", "wa_plus"],
});
assert(diag.includes("+55 71 9189-4229"), "diagnostico nomeia o numero");
assert(/WhatsApp Manager/.test(diag), "diagnostico diz onde resolver");

console.log("ok: _prova_whatsapp_pagina");
