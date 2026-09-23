// Prova isolada de idade_targeting (sem rede).
import {
  advantageAudienceLigado,
  aplicarIdadeNoTargeting,
  faixaCompativelComAdvantagePlus,
  parseIdade,
  prepararIdadeParaCriacao,
  validarIdadeContraTargetingAtual,
  validarIdadeDoPedido,
} from "./idade_targeting.ts";

function assert(cond: unknown, msg: string) {
  if (!cond) throw new Error(`FALHA: ${msg}`);
}

assert(parseIdade(25) === 25, "int");
assert(parseIdade("54") === 54, "string");
assert(parseIdade("25.5") === null, "nao inteiro");
assert(parseIdade("dezoito") === null, "texto");

const vazio = validarIdadeDoPedido({});
assert(!vazio.ok && (vazio as { erro: string }).erro === "idade_min_e_max_obrigatorios", "ambos obrigatorios");

const soMin = validarIdadeDoPedido({ idade_min: 25 });
assert(!soMin.ok, "so min recusa");

const invertido = validarIdadeDoPedido({ idade_min: 54, idade_max: 25 });
assert(!invertido.ok && (invertido as { erro: string }).erro === "idade_min_maior_que_max", "min>max");

const menor = validarIdadeDoPedido({ idade_min: 13, idade_max: 65 });
assert(!menor.ok && (menor as { erro: string }).erro === "idade_abaixo_de_18", "piso 18");

const maior = validarIdadeDoPedido({ idade_min: 18, idade_max: 70 });
assert(!maior.ok && (maior as { erro: string }).erro === "idade_acima_de_65", "teto 65 na edicao");

const criacao75 = prepararIdadeParaCriacao({ idade_min: 35, idade_max: 75 });
assert(criacao75.ok && criacao75.ok && criacao75.aplica, "criacao 35-75 aplica");
if (criacao75.ok && criacao75.aplica) {
  assert(criacao75.params.age_min === 35 && criacao75.params.age_max === 65, "teto clamp 65");
  assert(criacao75.params.advantage_audience === 0, "faixa estreita desliga A+");
  assert(!!criacao75.aviso && /65/.test(criacao75.aviso), "aviso do teto");
}
const criacaoAusente = prepararIdadeParaCriacao({});
assert(criacaoAusente.ok && criacaoAusente.ok && criacaoAusente.aplica === false, "sem idade nao mexe");

const okFaixa = validarIdadeDoPedido({ idade_min: 25, idade_max: 54 });
assert(okFaixa.ok, "25-54 ok");
if (okFaixa.ok) {
  assert(okFaixa.params.age_min === 25 && okFaixa.params.age_max === 54, "params");
  assert(okFaixa.params.advantage_audience === 0, "estreita desliga A+ por padrao");
  assert(okFaixa.resumo === "25–54 anos", "resumo");
}

const amplo = validarIdadeDoPedido({ age_min: 18, age_max: 65 });
assert(amplo.ok && amplo.ok && amplo.params.advantage_audience === undefined, "18-65 nao mexe em A+");

const aPlusForcado = validarIdadeDoPedido({
  idade_min: 30,
  idade_max: 50,
  advantage_audience: 1,
});
assert(
  !aPlusForcado.ok && (aPlusForcado as { erro: string }).erro === "advantage_plus_nao_aceita_esta_faixa",
  "A+ + faixa estreita recusa no pedido",
);

assert(faixaCompativelComAdvantagePlus(18, 65) === true, "18-65 cabe em A+");
assert(faixaCompativelComAdvantagePlus(25, 65) === true, "25-65 cabe em A+");
assert(faixaCompativelComAdvantagePlus(26, 65) === false, "26-65 nao cabe");
assert(faixaCompativelComAdvantagePlus(18, 64) === false, "teto 64 nao cabe");

const base = {
  age_min: 18,
  age_max: 65,
  geo_locations: { countries: ["BR"] },
  targeting_automation: { advantage_audience: 1 },
  flexible_spec: [{ interests: [{ id: "1", name: "x" }] }],
};
assert(advantageAudienceLigado(base) === true, "A+ ligado");

const contra = validarIdadeContraTargetingAtual(base, { age_min: 30, age_max: 50 });
assert(!contra.ok, "live A+ recusa faixa estreita sem desligar");

const contraOk = validarIdadeContraTargetingAtual(base, {
  age_min: 30,
  age_max: 50,
  advantage_audience: 0,
});
assert(contraOk.ok, "desligar A+ no pedido libera");

const merged = aplicarIdadeNoTargeting(base, { age_min: 30, age_max: 50, advantage_audience: 0 });
assert(merged.age_min === 30 && merged.age_max === 50, "aplica min e max");
assert((merged.targeting_automation as { advantage_audience: number }).advantage_audience === 0, "desliga A+");
assert((merged.geo_locations as { countries: string[] }).countries[0] === "BR", "mantem geo");
assert(Array.isArray(merged.flexible_spec), "mantem interesses");

const aPlusAmplo = aplicarIdadeNoTargeting(base, { age_min: 18, age_max: 65 });
assert(aPlusAmplo.age_min === 18, "A+ amplo seta min");
assert(aPlusAmplo.age_max === undefined, "A+ nao envia age_max");
assert(
  (aPlusAmplo.targeting_automation as { advantage_audience: number }).advantage_audience === 1,
  "A+ permanece se nao pediu desligar",
);

console.log("ok: _prova_idade_targeting");
