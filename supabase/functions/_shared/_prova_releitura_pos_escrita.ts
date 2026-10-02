import { carimboDaReleitura, compararEnviadoComGravado } from "./releitura_pos_escrita.ts";

function assert(cond: unknown, msg: string) {
  if (!cond) throw new Error(`FALHA: ${msg}`);
}

function campo(lista: { campo: string; veredito: string }[], nome: string) {
  return lista.find((c) => c.campo === nome || c.campo.endsWith(`.${nome}`));
}

const location = compararEnviadoComGravado({
  enviado: { targeting: { geo_locations: { location_types: ["home"] } } },
  gravado: { targeting: { geo_locations: { location_types: ["frequently_in", "home"] } } },
});
const loc = campo(location, "location_types");
assert(loc?.veredito === "normalizado", `location_types devia ser normalizado, veio ${loc?.veredito}`);
assert(carimboDaReleitura(location, true) === "conferido", "expansao nao alarma");

const spec = compararEnviadoComGravado({
  enviado: {
    targeting: {
      flexible_spec: [{
        behaviors: [{ id: "6110813675983", name: "A" }, { id: "6046096201583", name: "B" }],
      }],
    },
  },
  gravado: {
    targeting: {
      flexible_spec: [{
        behaviors: [{ id: "6046096201583", name: "B" }, { id: "6110813675983", name: "A" }],
      }],
    },
  },
});
const flex = campo(spec, "flexible_spec");
assert(flex?.veredito === "igual", `flexible_spec reordenado devia ser igual, veio ${flex?.veredito}`);

const audiencia = compararEnviadoComGravado({
  anterior: {
    targeting: {
      custom_audiences: [{ id: "999", name: "excluir compradores" }],
      geo_locations: { location_types: ["home", "recent"] },
    },
  },
  enviado: { targeting: { geo_locations: { location_types: ["home"] } } },
  gravado: { targeting: { geo_locations: { location_types: ["home"] } } },
});
const aud = campo(audiencia, "custom_audiences");
assert(aud?.veredito === "divergente", `custom_audiences omitido devia ser divergente, veio ${aud?.veredito}`);
assert(carimboDaReleitura(audiencia, true) === "gravado_diferente", "perda de publico nao fecha limpo");

const auto = compararEnviadoComGravado({
  anterior: {
    targeting: {
      targeting_automation: { advantage_audience: 0 },
      geo_locations: { cities: [{ key: "1" }] },
    },
  },
  enviado: { targeting: { geo_locations: { cities: [{ key: "1" }] } } },
  gravado: { targeting: { geo_locations: { cities: [{ key: "1" }] } } },
});
const adv = campo(auto, "targeting_automation");
assert(adv?.veredito === "divergente", `targeting_automation removido devia ser divergente, veio ${adv?.veredito}`);

const blocos = compararEnviadoComGravado({
  enviado: {
    targeting: {
      flexible_spec: [
        { interests: [{ id: "1" }] },
        { behaviors: [{ id: "2" }] },
      ],
    },
  },
  gravado: {
    targeting: {
      flexible_spec: [
        { behaviors: [{ id: "2", name: "b" }] },
        { interests: [{ id: "1", name: "a" }] },
      ],
    },
  },
});
assert(campo(blocos, "flexible_spec")?.veredito === "igual", "blocos reordenados continuam iguais");

console.log("OK releitura_pos_escrita");
