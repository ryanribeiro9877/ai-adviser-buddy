// Prova isolada do preset Jurídico COHAPM (sem rede).
import {
  BAIRROS_CANONICOS_JURIDICO_SALVADOR,
  companyElegivelPresetGeoJuridico,
  detectarMeioCohapm,
  deveAplicarPresetGeoJuridico,
  geoBateExatoComPreset,
  meioExplicitoDoParams,
  type PresetGeoJuridico,
} from "./geo_preset_juridico.ts";
import { ehLocalSalvadorBA } from "./geo_targeting.ts";
import { COMPANY_COHAPM, COMPANY_LEGAL } from "./meta_company_tokens.ts";

function assert(cond: unknown, msg: string) {
  if (!cond) throw new Error(`FALHA: ${msg}`);
}

assert(BAIRROS_CANONICOS_JURIDICO_SALVADOR.length === 134, `lista canônica 134 (tem ${BAIRROS_CANONICOS_JURIDICO_SALVADOR.length})`);
assert(companyElegivelPresetGeoJuridico(COMPANY_COHAPM), "COHAPM elegivel");
assert(!companyElegivelPresetGeoJuridico(COMPANY_LEGAL), "Legal nao elegivel");
assert(!companyElegivelPresetGeoJuridico(null), "null nao elegivel");

assert(detectarMeioCohapm("COHAPM_JURIDICO_ENGAJ_TOFU") === "juridico", "campanha JURIDICO");
assert(detectarMeioCohapm("JUR_TOFU_SSA-50KM") === "juridico", "conjunto JUR_");
assert(detectarMeioCohapm("CJ_INSS_45+_BAIRROS") === "juridico", "CJ_INSS");
assert(detectarMeioCohapm("COHAPM_LAFELICITA_ENGAJ") === "la_felicita", "LAFELICITA");
assert(detectarMeioCohapm("CONJ.1_LAF_8CRIATIVOS_JUNJUL26_AD01") === "la_felicita", "_LAF_ no criativo");
assert(detectarMeioCohapm("LF_TOFU_SSA") === "la_felicita", "LF_");
assert(detectarMeioCohapm("[SALT] [LF | CONV | OBRA]") === "la_felicita", "SALT LF");
assert(detectarMeioCohapm("JURIDICO e LA FELICITA misturados") === null, "ambiguidade");
assert(detectarMeioCohapm("Traffic Campaign") === null, "sem sinal");
assert(detectarMeioCohapm("COHAPM - VISTTA") === "sistema_ocular", "pasta VISTTA");
assert(detectarMeioCohapm("COHAPM_SISTEMA_OCULAR_CONV") === "sistema_ocular", "campanha ocular");
assert(!deveAplicarPresetGeoJuridico(COMPANY_COHAPM, "sistema_ocular"), "ocular nao herda geo JUR");
assert(detectarMeioCohapm("VISTTA e JURIDICO") === null, "ambiguidade ocular×jur");

assert(meioExplicitoDoParams({ meio: "juridico" }) === "juridico", "meio explicito");
assert(meioExplicitoDoParams({ meio: "la_felicita" }) === "la_felicita", "meio lf");
assert(deveAplicarPresetGeoJuridico(COMPANY_COHAPM, "juridico"), "aplica JUR");
assert(!deveAplicarPresetGeoJuridico(COMPANY_COHAPM, "la_felicita"), "LF nao aplica");
assert(!deveAplicarPresetGeoJuridico(COMPANY_LEGAL, "juridico"), "Legal nunca");

assert(
  ehLocalSalvadorBA({ primary_city: "Salvador", region: "Bahia", country_code: "BR" }),
  "SSA+BA",
);
assert(
  !ehLocalSalvadorBA({ primary_city: "São Paulo", region: "São Paulo", country_code: "BR" }),
  "rejeita SP",
);
assert(
  !ehLocalSalvadorBA({ primary_city: "Salvador", region: "Bahia", country_code: "US" }),
  "rejeita US",
);

const preset: PresetGeoJuridico = {
  id: "x",
  company_id: COMPANY_COHAPM,
  meio: "juridico",
  city: "Salvador",
  region: "Bahia",
  region_code: "BA",
  country_code: "BR",
  nomes_oficiais: ["A", "B"],
  keys_meta: [
    { key: "1", name: "A", primary_city: "Salvador", region: "Bahia", country_code: "BR" },
    { key: "2", name: "B", primary_city: "Salvador", region: "Bahia", country_code: "BR" },
  ],
  falhas_resolucao: null,
  keys_resolvidas_em: null,
};

const ok = geoBateExatoComPreset(
  { neighborhoods: [{ key: "2" }, { key: "1" }], location_types: ["home"] },
  preset,
);
assert(ok.ok === true, "ordem irrelevante ok");

const bad = geoBateExatoComPreset(
  { neighborhoods: [{ key: "1" }, { key: "99" }], location_types: ["home"] },
  preset,
);
assert(bad.ok === false && (bad as any).erro === "geo_diferente_do_preset_juridico", "rejeita key estranha");

const cities = geoBateExatoComPreset(
  { neighborhoods: [{ key: "1" }, { key: "2" }], cities: [{ key: "9" }] },
  preset,
);
assert(cities.ok === false && (cities as any).erro === "geo_juridico_chave_nao_permitida", "rejeita cities");

console.log("OK geo_preset_juridico prova");
