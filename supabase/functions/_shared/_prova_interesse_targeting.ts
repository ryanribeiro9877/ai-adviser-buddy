// Prova isolada de interesse_targeting (sem rede).
import {
  aplicarPublicoNoTargeting,
  ehTermoGeoNaoInteresse,
  itemParaInteresse,
  normalizarInteressesDoPedido,
  parseAdvantageAudience,
  recusarMatchInteresse,
  validarPublicoDoPedido,
} from "./interesse_targeting.ts";

function assert(cond: unknown, msg: string) {
  if (!cond) throw new Error(`FALHA: ${msg}`);
}

assert(itemParaInteresse("6003139266461")?.id === "6003139266461", "id numerico");
assert(itemParaInteresse("Imoveis") === null, "nome sem id nao vale");
assert(itemParaInteresse({ id: "6003139266461", name: "Imobiliario" })?.name === "Imobiliario", "objeto id+name");
assert(itemParaInteresse({ id: "12", name: "x" }) === null, "id curto demais");

assert(ehTermoGeoNaoInteresse("Lauro de Freitas") === true, "lauro e geo");
assert(ehTermoGeoNaoInteresse("Praia do Forte") === true, "praia e geo");
assert(ehTermoGeoNaoInteresse("Linha Verde") === true, "linha verde e geo");
assert(ehTermoGeoNaoInteresse("condominios") === false, "condominio nao e geo");

assert(
  recusarMatchInteresse("aluguel de casa", "Aluguer de carro") === "match_e_aluguel_de_carro",
  "aluguel de carro recusado",
);
assert(recusarMatchInteresse("imoveis", "Investimento imobiliario") === null, "nucleo ok");

const semId = normalizarInteressesDoPedido({ interesses: ["imoveis", "condominios"] });
assert(semId.erro === "interesses_sem_id_meta", "recusa nomes sem id");

const geo = normalizarInteressesDoPedido({
  interesses: [{ id: "6003139266461", name: "Lauro de Freitas" }],
});
assert(geo.erro === "termo_e_geo_nao_interesse", "recusa geo disfarçado de interesse");

const ok = normalizarInteressesDoPedido({
  interesses: [
    { id: "6003139266461", name: "Investimento imobiliario" },
    { id: "6003348452981", name: "Imobiliario" },
    { id: "6003139266461", name: "dup" },
  ],
});
assert(ok.interesses.length === 2, "dedupe por id");
assert(ok.resumo.includes("OU"), "resumo OR");

const vazio = validarPublicoDoPedido({});
assert(vazio.ok === false, "sem interesses recusa");

const val = validarPublicoDoPedido({
  interesses: [{ id: "6003139266461", name: "Investimento imobiliario" }],
});
assert(val.ok === true, "valida nucleo");
if (val.ok) {
  assert(val.advantage_audience === 0, "advantage default 0");
  assert((val.params.interesses as any[]).length === 1, "params.interesses");
}

assert(parseAdvantageAudience(1) === 1, "advantage 1");
assert(parseAdvantageAudience("false") === 0, "advantage 0");
assert(parseAdvantageAudience(undefined) === 0, "advantage omitido = 0");

const base = {
  age_min: 18,
  age_max: 65,
  geo_locations: { cities: [{ key: "267730", name: "Salvador" }] },
  publisher_platforms: ["facebook"],
  targeting_automation: { advantage_audience: 1 },
  interests: [{ id: "1", name: "velho" }],
};
const merged = aplicarPublicoNoTargeting(base, {
  interesses: [{ id: "6003139266461", name: "Investimento imobiliario" }],
  advantage_audience: 0,
});
assert((merged as any).age_min === 18, "mantem idade");
assert((merged as any).geo_locations.cities[0].key === "267730", "mantem geo");
assert((merged as any).publisher_platforms[0] === "facebook", "mantem plataformas");
assert((merged as any).targeting_automation.advantage_audience === 0, "desliga advantage");
assert((merged as any).interests === undefined, "remove interests legado");
assert((merged.flexible_spec as any)[0].interests[0].id === "6003139266461", "flexible_spec OR");

console.log("OK interesse_targeting prova");
