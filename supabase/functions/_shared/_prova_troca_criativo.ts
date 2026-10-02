import {
  fronteiraDePersonalizacao,
  temRegrasDePlacement,
  validarTrocaCriativo,
  vereditoDepoisDaTroca,
} from "./troca_criativo.ts";

function assert(cond: unknown, msg: string) {
  if (!cond) throw new Error(`FALHA: ${msg}`);
}

assert(!validarTrocaCriativo({ ad_id: "1" }).ok, "id curto recusa");
const ids = validarTrocaCriativo({ ad_id: "120000000000000111", creative_id: "120000000000000222" });
assert(ids.ok, "ids validos");

const com = { asset_feed_spec: { asset_customization_rules: [{ customization_spec: {} }] } };
const sem = { object_story_spec: { page_id: "1" } };
assert(temRegrasDePlacement(com), "detecta regras");
assert(!temRegrasDePlacement(sem), "sem regras");
assert(!fronteiraDePersonalizacao(true, false).ok, "cruzar fronteira recusa");
assert(fronteiraDePersonalizacao(false, false).ok === true, "mesmo lado passa");

assert(vereditoDepoisDaTroca(null).declarado_pronto === false, "sem releitura nao esta pronto");
assert(vereditoDepoisDaTroca("").rotulo === "effective_status_nao_lido", "status vazio nao declara");
assert(vereditoDepoisDaTroca("IN_PROCESS").declarado_pronto === false, "em revisao nao e corrigido");
assert(vereditoDepoisDaTroca("ACTIVE").declarado_pronto === true, "so depois de ler ACTIVE");
assert(vereditoDepoisDaTroca("ACTIVE").rotulo === "conferido", "rotulo conferido");

console.log("OK troca_criativo");
