// Prova isolada de geo_targeting (sem rede).
import {
  aplicarGeoNoTargeting,
  itemParaGeoKey,
  normalizarGeoDoPedido,
} from "./geo_targeting.ts";

function assert(cond: unknown, msg: string) {
  if (!cond) throw new Error(`FALHA: ${msg}`);
}

assert(itemParaGeoKey("123456")?.key === "123456", "key numerica");
assert(itemParaGeoKey("Centro") === null, "nome sem digito nao e key");
assert(itemParaGeoKey({ key: "99", name: "Pituba" })?.name === "Pituba", "objeto key+name");

const b = normalizarGeoDoPedido({
  bairros: ["111", { key: "222", name: "Barra" }, "111"],
});
assert(b.geo, "geo de bairros");
assert((b.geo!.neighborhoods as any[]).length === 2, "dedupe bairros");
assert(b.resumo?.includes("2"), "resumo");

const semKey = normalizarGeoDoPedido({ bairros: ["Pituba", "Barra"] });
assert(semKey.erro === "bairros_sem_key_meta", "recusa nomes sem key");

const geoObj = normalizarGeoDoPedido({
  geo_locations: {
    neighborhoods: [{ key: "1", name: "A" }, { key: "2" }],
    cities: [{ key: "9" }],
  },
});
assert((geoObj.contagem as any).neighborhoods === 2, "contagem neighborhoods");
assert((geoObj.contagem as any).cities === 1, "contagem cities");

const conflito = normalizarGeoDoPedido({
  bairros: ["1"],
  geo_locations: { countries: ["BR"] },
});
assert(conflito.erro === "geo_e_bairros_conflitantes", "conflito");

const base = {
  age_min: 18,
  geo_locations: { countries: ["BR"] },
  publisher_platforms: ["facebook"],
};
const merged = aplicarGeoNoTargeting(base, b.geo!);
assert((merged.geo_locations as any).neighborhoods.length === 2, "merge geo");
assert((merged as any).age_min === 18, "mantem idade");
assert((merged as any).publisher_platforms[0] === "facebook", "mantem plataformas");

console.log("OK geo_targeting prova");
