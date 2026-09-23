// Prova isolada de geo_targeting (sem rede).
import {
  aplicarGeoNoTargeting,
  escolherPinoGeocode,
  itemParaGeoKey,
  normalizarGeoDoPedido,
  normalizarRaioKm,
  paramsGeoComAliasCidades,
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

const alias = paramsGeoComAliasCidades({
  cidades: [{ key: "267730", name: "Salvador" }, "246867"],
});
const aliasNorm = normalizarGeoDoPedido(alias);
assert((aliasNorm.contagem as any).cities === 2, "alias cidades vira geo_locations.cities");
assert(!(alias as any).countries, "alias cidades nao injeta pais");

const aliasIgnora = paramsGeoComAliasCidades({
  cidades: ["1"],
  bairros: ["2"],
});
assert((aliasIgnora as any).geo_locations == null, "alias nao mistura com bairros");

const raio = normalizarGeoDoPedido({
  geo_locations: {
    custom_locations: [{
      latitude: -12.949141,
      longitude: -38.431034,
      radius: 1,
      distance_unit: "kilometer",
      name: "Centro Administrativo da Bahia",
    }],
  },
});
assert(raio.geo && (raio.geo.custom_locations as any[])[0].radius === 1, "raio 1 km entra");

const semCoord = normalizarGeoDoPedido({
  geo_locations: { custom_locations: [{ key: "2789645", name: "Centro Administrativo da Bahia" }] },
});
assert(semCoord.erro === "custom_locations_invalido", "key de bairro nao e raio");

assert(normalizarRaioKm(1) === 1, "raio 1");
assert(normalizarRaioKm(0.5) === null, "raio abaixo de 1 recusa");
assert(normalizarRaioKm("1,5") === 1.5, "raio com virgula");

const pino = escolherPinoGeocode([
  { lat: "-12.9557", lon: "-38.4290", name: "CAB", category: "railway", type: "station", addresstype: "railway", display_name: "CAB, Salvador, Bahia, Brasil" },
  { lat: "-12.949141", lon: "-38.431034", name: "Centro Administrativo da Bahia", category: "boundary", type: "administrative", addresstype: "suburb", display_name: "Centro Administrativo da Bahia, Salvador, Bahia, Brasil" },
], "Salvador");
assert(pino?.name === "Centro Administrativo da Bahia", "CAB geocode prefere o suburbio, nao a estacao");

console.log("OK geo_targeting prova");
