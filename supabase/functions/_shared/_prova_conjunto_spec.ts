import { payloadDoCardConjunto, validarSpecConjunto } from "./conjunto_spec.ts";

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

  // 15/10/2026: dois criar_conjunto aprovados morreram em promoted_object_obrigatorio. O card
  // gravou o corpo ja serializado (promoted_object em texto) e a executora so aceitava objeto.
  const cardLegado = JSON.parse(JSON.stringify({ ...ok.corpo, targeting: ok.targeting, nome_novo: ok.corpo.name }));
  assert(typeof cardLegado.promoted_object === "string", "card legado guarda promoted_object em texto");
  const reexec = validarSpecConjunto(cardLegado);
  assert(reexec.ok, "card legado (promoted_object em texto) reexecuta");
  if (reexec.ok) {
    assert(reexec.corpo.promoted_object === ok.corpo.promoted_object, "mesmo promoted_object na reexecucao");
    assert(!reexec.corpo.promoted_object.startsWith('"'), "promoted_object nao e serializado duas vezes");
  }

  const doCard = JSON.parse(JSON.stringify(payloadDoCardConjunto(ok)));
  assert(typeof doCard.promoted_object === "object", "card novo guarda promoted_object como objeto");
  const reexecNovo = validarSpecConjunto(doCard);
  assert(reexecNovo.ok, "card novo reexecuta");
  if (reexecNovo.ok) {
    assert(JSON.stringify(JSON.parse(reexecNovo.corpo.promoted_object)) === JSON.stringify(base.promoted_object), "promoted_object identico");
    assert(reexecNovo.corpo.daily_budget === ok.corpo.daily_budget, "verba identica");
    assert(reexecNovo.corpo.name === ok.corpo.name, "nome identico");
  }
}

const promotedTextoQuebrado = validarSpecConjunto({ ...base, promoted_object: "{page_id: 105" });
assert(
  !promotedTextoQuebrado.ok && promotedTextoQuebrado.erro === "promoted_object_invalido",
  "promoted_object em texto que nao e JSON recusa com nome proprio",
);
const promotedVazio = validarSpecConjunto({ ...base, promoted_object: {} });
assert(!promotedVazio.ok && promotedVazio.erro === "promoted_object_obrigatorio", "promoted_object vazio recusa");
const promotedTextoVazio = validarSpecConjunto({ ...base, promoted_object: "{}" });
assert(!promotedTextoVazio.ok && promotedTextoVazio.erro === "promoted_object_obrigatorio", "promoted_object '{}' recusa");

console.log("OK conjunto_spec");
