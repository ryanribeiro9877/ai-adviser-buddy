import { validarSpecConjunto } from "./conjunto_spec.ts";

function assert(cond: unknown, msg: string) {
  if (!cond) throw new Error(`FALHA: ${msg}`);
}

const base = {
  nome: "LF_CONJ_2",
  campaign_id: "120000000000000001",
  orcamento_diario_reais: 40,
  optimization_goal: "CONVERSATIONS",
  billing_event: "IMPRESSIONS",
  bid_strategy: "LOWEST_COST_WITHOUT_CAP",
  destination_type: "WHATSAPP",
  promoted_object: { page_id: "105", whatsapp_phone_number: "5571999999999" },
  status: "ACTIVE",
  targeting: {
    age_min: 25,
    age_max: 55,
    geo_locations: {
      cities: [{ key: "267730", name: "Salvador" }],
      neighborhoods: [{ key: "1", name: "Horto" }, { key: "2", name: "Pituba" }],
      custom_locations: [{ latitude: -12.9, longitude: -38.4, radius: 1, distance_unit: "kilometer", name: "CAB" }],
    },
    flexible_spec: [{
      industries: [{ id: "10", name: "Imobiliaria" }],
      interests: [{ id: "11", name: "Praia" }],
    }],
    targeting_automation: { advantage_audience: 0 },
  },
};

const parcial = validarSpecConjunto({
  ...base,
  targeting: { age_min: 25, geo_locations: { cities: [{ key: "1" }] } },
});
assert(!parcial.ok && parcial.erro === "targeting_parcial", "sem advantage_audience recusa");

const ok = validarSpecConjunto(base);
assert(ok.ok, "spec completo");
if (ok.ok) {
  assert(ok.corpo.status === "PAUSED", "nasce pausado mesmo se pediram ACTIVE");
  const t = JSON.parse(ok.corpo.targeting);
  assert(t.targeting_automation.advantage_audience === 0, "advantage_audience vai no corpo");
  assert(ok.resumo.includes("R$ 40.00"), "verba legivel");
  assert(ok.resumo.includes("Salvador"), "cidade legivel");
  assert(ok.resumo.includes("2 bairro"), "contagem de bairros");
  assert(ok.resumo.includes("1 pino"), "contagem de pinos");
  assert(ok.resumo.includes("Imobiliaria (industries)"), "termo com classe");
  assert(ok.resumo.includes("Praia (interests)"), "interesse com classe");
  assert(!ok.resumo.trim().startsWith("{"), "nao e json cru");
}

console.log("OK conjunto_spec");
