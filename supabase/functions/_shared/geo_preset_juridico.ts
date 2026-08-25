// supabase/functions/_shared/geo_preset_juridico.ts
// Preset geográfico OBRIGATÓRIO — SOMENTE meio Jurídico da COHAPM (Salvador–BA).
// La Felicità NÃO herda. Legal é Viver NÃO herda.
// Fonte canônica de nomes: tabela geo_targeting_presets (+ espelho em BAIRROS_CANONICOS_*).

import { COMPANY_COHAPM } from "./meta_company_tokens.ts";
import {
  buscarGeolocalizacoesMeta,
  ehLocalSalvadorBA,
  normalizarGeoDoPedido,
  type GeoKeyItem,
} from "./geo_targeting.ts";

export const MEIO_JURIDICO = "juridico" as const;
export const MEIO_LA_FELICITA = "la_felicita" as const;
export type MeioCohapmGeo = typeof MEIO_JURIDICO | typeof MEIO_LA_FELICITA;

export const GEO_PRESET_CITY = "Salvador";
export const GEO_PRESET_REGION = "Bahia";
export const GEO_PRESET_REGION_CODE = "BA";
export const GEO_PRESET_COUNTRY = "BR";

/** Lista canônica (nomes oficiais) — espelho do seed em geo_targeting_presets. */
export const BAIRROS_CANONICOS_JURIDICO_SALVADOR: readonly string[] = [
  "Acupe",
  "Águas Claras",
  "Alto da Terezinha",
  "Alto das Pombas",
  "Alto do Cabrito",
  "Alto do Coqueirinho",
  "Areia Branca",
  "Arenoso",
  "Arraial do Retiro",
  "Bairro da Paz",
  "Barreiras",
  "Beiru/Tancredo Neves",
  "Boa Viagem",
  "Boa Vista de Brotas",
  "Boa Vista de São Caetano",
  "Boca da Mata",
  "Bom Juá",
  "Bonfim",
  "Cabula VI",
  "Caixa D'Água",
  "Cajazeiras",
  "Cajazeiras II",
  "Cajazeiras IV",
  "Cajazeiras V",
  "Cajazeiras VI",
  "Cajazeiras VII",
  "Cajazeiras VIII",
  "Cajazeiras X",
  "Cajazeiras XI",
  "Calabar",
  "Calabetão",
  "Calçada",
  "Caminho de Areia",
  "Campinas de Pirajá",
  "Canabrava",
  "Candeal",
  "Capelinha",
  "Cassange",
  "Castelo Branco",
  "Chapada do Rio Vermelho",
  "Cidade Nova",
  "Colinas de Periperi",
  "Cosme de Farias",
  "Coutos",
  "Curuzu",
  "Dom Avelar",
  "Doron",
  "Engenho Velho da Federação",
  "Engenho Velho de Brotas",
  "Engomadeira",
  "Escada",
  "Fazenda Coutos",
  "Fazenda Grande do Retiro",
  "Fazenda Grande I",
  "Fazenda Grande II",
  "Fazenda Grande III",
  "Fazenda Grande IV",
  "Federação",
  "Garcia",
  "Granjas Rurais Presidente Vargas",
  "IAPI",
  "Ilha Amarela",
  "Ilha de Bom Jesus dos Passos",
  "Ilha de Maré",
  "Itacaranha",
  "Itapuã por microárea",
  "Itinga",
  "Jardim Cajazeiras",
  "Jardim das Margaridas",
  "Jardim Nova Esperança",
  "Jardim Santo Inácio",
  "Lapinha",
  "Liberdade",
  "Lobato",
  "Luiz Anselmo",
  "Mangueira",
  "Marechal Rondon",
  "Mares",
  "Massaranduba",
  "Mata Escura",
  "Matatu",
  "Mirantes de Periperi",
  "Monte Serrat",
  "Moradas da Lagoa",
  "Mussurunga",
  "Narandiba",
  "Nordeste de Amaralina",
  "Nova Brasília",
  "Nova Constituinte",
  "Nova Esperança",
  "Nova Sussuarana",
  "Novo Horizonte",
  "Novo Marotinho",
  "Palestina",
  "Paripe",
  "Pau da Lima",
  "Pau Miúdo",
  "Periperi",
  "Pernambués",
  "Pero Vaz",
  "Pirajá",
  "Plataforma",
  "Porto Seco Pirajá",
  "Praia Grande",
  "Resgate",
  "Retiro",
  "Ribeira",
  "Rio Sena",
  "Roma",
  "Saboeiro",
  "Santa Cruz",
  "Santa Luzia",
  "Santa Mônica",
  "Santo Agostinho",
  "São Caetano",
  "São Cristóvão",
  "São Gonçalo do Retiro",
  "São João do Cabrito",
  "São Marcos",
  "São Rafael",
  "São Tomé de Paripe",
  "Saramandaia",
  "Saúde",
  "Sete de Abril",
  "Sussuarana",
  "Tororó",
  "Trobogy",
  "Uruguai",
  "Vale das Pedrinhas",
  "Vale dos Lagos",
  "Valéria",
  "Vila Canária",
  "Vila Ruy Barbosa/Jardim Cruzeiro",
  "Vista Alegre",
];

export function stripAccents(s: string): string {
  return String(s ?? "")
    .normalize("NFD")
    .replace(/\p{M}/gu, "");
}

/** Empresa elegível ao preset (COHAPM). Legal nunca entra. */
export function companyElegivelPresetGeoJuridico(companyId: string | null | undefined): boolean {
  return String(companyId ?? "").trim() === COMPANY_COHAPM;
}

/**
 * Detecta meio COHAPM a partir de nomes (campanha/conjunto/molde) e texto livre.
 * La Felicità tem prioridade de isolamento: se LF e JUR misturados → null (não aplica preset).
 */
export function detectarMeioCohapm(
  ...sinais: Array<string | null | undefined>
): MeioCohapmGeo | null {
  const raw = sinais
    .filter((s) => s != null && String(s).trim())
    .map((s) => String(s))
    .join(" || ");
  if (!raw.trim()) return null;
  const n = stripAccents(raw).toLowerCase();

  const lf =
    /la[\s_-]*felicita/.test(n) ||
    /lafelicita/.test(n) ||
    /_laf_/.test(n) ||
    /(^|[^a-z0-9])laf([^a-z0-9]|$)/.test(n) ||
    /\blaf_/.test(n) ||
    /(^|[^a-z0-9])lf([^a-z0-9]|$)/.test(n) ||
    /_lf_/.test(n) ||
    /\blf_/.test(n) ||
    /\[\s*lf\s*[\|\]]/.test(n);

  const jur =
    /juridico/.test(n) ||
    /(^|[^a-z0-9])jur([^a-z0-9]|$)/.test(n) ||
    /_jur_/.test(n) ||
    /\bjur_/.test(n) ||
    /cj_inss/.test(n) ||
    /coop_social_juridico/.test(n);

  if (lf && jur) return null;
  if (lf) return MEIO_LA_FELICITA;
  if (jur) return MEIO_JURIDICO;
  return null;
}

/** params.meio / marca_meio explícitos. */
export function meioExplicitoDoParams(
  params: Record<string, unknown> | null | undefined,
): MeioCohapmGeo | null {
  const m = stripAccents(String(params?.meio ?? params?.marca_meio ?? ""))
    .toLowerCase()
    .trim()
    .replace(/\s+/g, "_");
  if (!m) return null;
  if (m === "juridico" || m === "jur" || m === "juridico_cohapm") return MEIO_JURIDICO;
  if (
    m === "la_felicita" ||
    m === "lafelicita" ||
    m === "lf" ||
    m === "la_felicita_cohapm"
  ) {
    return MEIO_LA_FELICITA;
  }
  return null;
}

/**
 * Resolve meio para o gate de geo. Só retorna juridico/la_felicita em COHAPM.
 * Prioridade: params.meio explícito > sinais de nome.
 */
export function resolverMeioGeoCohapm(
  companyId: string | null | undefined,
  params: Record<string, unknown> | null | undefined,
  ...sinaisNome: Array<string | null | undefined>
): MeioCohapmGeo | null {
  if (!companyElegivelPresetGeoJuridico(companyId)) return null;
  return (
    meioExplicitoDoParams(params) ??
    detectarMeioCohapm(
      ...(sinaisNome ?? []),
      params?.nome_novo != null ? String(params.nome_novo) : null,
      params?.nome != null ? String(params.nome) : null,
      params?.campanha_destino != null ? String(params.campanha_destino) : null,
      params?.campanha_destino_nome != null ? String(params.campanha_destino_nome) : null,
      params?.molde_nome != null ? String(params.molde_nome) : null,
    )
  );
}

export function deveAplicarPresetGeoJuridico(
  companyId: string | null | undefined,
  meio: MeioCohapmGeo | null,
): boolean {
  return companyElegivelPresetGeoJuridico(companyId) && meio === MEIO_JURIDICO;
}

export type KeyMetaPreset = {
  key: string;
  name: string;
  query?: string;
  type?: string;
  primary_city?: string;
  region?: string;
  country_code?: string;
};

export type PresetGeoJuridico = {
  id: string;
  company_id: string;
  meio: string;
  city: string;
  region: string;
  region_code: string;
  country_code: string;
  nomes_oficiais: string[];
  keys_meta: KeyMetaPreset[] | null;
  falhas_resolucao: Array<{ nome: string; motivo: string }> | null;
  keys_resolvidas_em: string | null;
};

export type SupaLite = {
  from: (t: string) => {
    select: (cols: string) => {
      eq: (c: string, v: unknown) => {
        eq: (c2: string, v2: unknown) => {
          eq: (c3: string, v3: unknown) => {
            maybeSingle: () => Promise<{ data: any; error: any }>;
          };
          maybeSingle?: () => Promise<{ data: any; error: any }>;
        };
        maybeSingle?: () => Promise<{ data: any; error: any }>;
      };
    };
    update: (row: Record<string, unknown>) => {
      eq: (c: string, v: unknown) => Promise<{ error: any }>;
    };
  };
};

export async function carregarPresetGeoJuridico(
  supa: any,
  companyId: string,
): Promise<{ preset: PresetGeoJuridico | null; erro?: string; detalhe?: string }> {
  const { data, error } = await supa
    .from("geo_targeting_presets")
    .select(
      "id,company_id,meio,city,region,region_code,country_code,nomes_oficiais,keys_meta,falhas_resolucao,keys_resolvidas_em",
    )
    .eq("company_id", companyId)
    .eq("meio", MEIO_JURIDICO)
    .eq("vigente", true)
    .maybeSingle();
  if (error) {
    return {
      preset: null,
      erro: "falha_ao_ler_geo_targeting_presets",
      detalhe: error.message,
    };
  }
  if (!data) {
    return {
      preset: null,
      erro: "preset_geo_juridico_ausente",
      detalhe:
        "Nao ha linha vigente em geo_targeting_presets para COHAPM/juridico. Aplique a migration do preset Salvador–BA.",
    };
  }
  const nomes = Array.isArray(data.nomes_oficiais)
    ? data.nomes_oficiais.map((n: unknown) => String(n ?? "").trim()).filter(Boolean)
    : [];
  if (!nomes.length) {
    return {
      preset: null,
      erro: "preset_geo_juridico_sem_nomes",
      detalhe: "geo_targeting_presets.nomes_oficiais veio vazio.",
    };
  }
  return {
    preset: {
      id: String(data.id),
      company_id: String(data.company_id),
      meio: String(data.meio),
      city: String(data.city ?? GEO_PRESET_CITY),
      region: String(data.region ?? GEO_PRESET_REGION),
      region_code: String(data.region_code ?? GEO_PRESET_REGION_CODE),
      country_code: String(data.country_code ?? GEO_PRESET_COUNTRY),
      nomes_oficiais: nomes,
      keys_meta: Array.isArray(data.keys_meta) ? data.keys_meta : null,
      falhas_resolucao: Array.isArray(data.falhas_resolucao) ? data.falhas_resolucao : null,
      keys_resolvidas_em: data.keys_resolvidas_em != null ? String(data.keys_resolvidas_em) : null,
    },
  };
}

export function keysValidasDoPreset(preset: PresetGeoJuridico): KeyMetaPreset[] {
  const raw = preset.keys_meta ?? [];
  const out: KeyMetaPreset[] = [];
  const seen = new Set<string>();
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const key = String((item as any).key ?? "").trim();
    if (!key || seen.has(key)) continue;
    const name = String((item as any).name ?? (item as any).query ?? "").trim() || key;
    const row = {
      key,
      name,
      query: (item as any).query != null ? String((item as any).query) : undefined,
      type: (item as any).type != null ? String((item as any).type) : undefined,
      primary_city: (item as any).primary_city != null
        ? String((item as any).primary_city)
        : undefined,
      region: (item as any).region != null ? String((item as any).region) : undefined,
      country_code: (item as any).country_code != null
        ? String((item as any).country_code)
        : undefined,
    };
    // Duplo check: se metadata de cidade/região veio, exige Salvador–BA.
    if (
      (row.primary_city || row.region || row.country_code) &&
      !ehLocalSalvadorBA(row)
    ) {
      continue;
    }
    seen.add(key);
    out.push(row);
  }
  return out;
}

export function geoLocationsDoPreset(preset: PresetGeoJuridico): {
  geo?: Record<string, unknown>;
  resumo?: string;
  contagem?: Record<string, number>;
  erro?: string;
  detalhe?: string;
  keys: KeyMetaPreset[];
} {
  const keys = keysValidasDoPreset(preset);
  if (!keys.length) {
    return {
      keys,
      erro: "preset_geo_juridico_sem_keys",
      detalhe:
        "Preset Jurídico Salvador–BA ainda nao tem keys Meta validadas. Rode a resolucao (Graph adgeolocation) antes de criar conjunto.",
    };
  }
  const neighborhoods = keys.map((k) => ({ key: k.key, name: k.name }));
  return {
    keys,
    geo: {
      neighborhoods,
      location_types: ["home", "recent"],
    },
    resumo: `${neighborhoods.length} bairro(s) preset Jurídico Salvador–BA`,
    contagem: { neighborhoods: neighborhoods.length },
  };
}

/** Conjunto de keys do pedido (so neighborhoods). Outras chaves geo → rejeição no gate Jurídico. */
export function extrairKeysNeighborhoods(
  geo: Record<string, unknown> | null | undefined,
): { keys: string[]; erro?: string; detalhe?: string } {
  if (!geo || typeof geo !== "object") return { keys: [] };
  const extras = Object.keys(geo).filter(
    (k) =>
      k !== "neighborhoods" &&
      k !== "location_types" &&
      Array.isArray((geo as any)[k]) &&
      ((geo as any)[k] as unknown[]).length > 0,
  );
  if (extras.length) {
    return {
      keys: [],
      erro: "geo_juridico_chave_nao_permitida",
      detalhe:
        `No meio Jurídico COHAPM so sao aceitos neighborhoods do preset Salvador–BA. ` +
        `Recebi tambem: ${extras.join(", ")}. Remova e use o preset (ou omita geo para default automatico).`,
    };
  }
  const nb = Array.isArray(geo.neighborhoods) ? geo.neighborhoods : [];
  const keys: string[] = [];
  const seen = new Set<string>();
  for (const item of nb) {
    const k =
      typeof item === "string" || typeof item === "number"
        ? String(item).trim()
        : String((item as any)?.key ?? (item as any)?.id ?? "").trim();
    if (!k || seen.has(k)) continue;
    seen.add(k);
    keys.push(k);
  }
  return { keys };
}

export function geoBateExatoComPreset(
  geo: Record<string, unknown>,
  preset: PresetGeoJuridico,
): { ok: true; keys: string[] } | { ok: false; erro: string; detalhe: string } {
  const doPreset = keysValidasDoPreset(preset);
  if (!doPreset.length) {
    return {
      ok: false,
      erro: "preset_geo_juridico_sem_keys",
      detalhe: "Preset sem keys Meta — nao da para validar o pedido.",
    };
  }
  const extr = extrairKeysNeighborhoods(geo);
  if (extr.erro) return { ok: false, erro: extr.erro, detalhe: extr.detalhe! };
  const pedidas = new Set(extr.keys);
  const esperadas = new Set(doPreset.map((k) => k.key));
  if (pedidas.size !== esperadas.size) {
    return {
      ok: false,
      erro: "geo_diferente_do_preset_juridico",
      detalhe:
        `Juridico COHAPM exige EXATAMENTE o preset Salvador–BA (${esperadas.size} keys). ` +
        `Recebi ${pedidas.size} neighborhood(s). Omita geo/bairros para o default automatico, ou passe o mesmo conjunto de keys.`,
    };
  }
  for (const k of pedidas) {
    if (!esperadas.has(k)) {
      return {
        ok: false,
        erro: "geo_diferente_do_preset_juridico",
        detalhe:
          `Key Meta "${k}" nao pertence ao preset Jurídico Salvador–BA. ` +
          `Qualquer geolocalizacao diferente do preset e rejeitada. La Felicità nao usa este preset.`,
      };
    }
  }
  return { ok: true, keys: [...pedidas] };
}

const LOTE = 40;

/**
 * Resolve nomes → keys Meta com filtro estrito Salvador–BA; grava cache no preset.
 * Nomes sem match Salvador–BA vão para falhas_resolucao (NUNCA inclui key errada).
 */
export async function resolverECachearKeysPreset(opts: {
  supa: any;
  token: string;
  preset: PresetGeoJuridico;
  forcar?: boolean;
}): Promise<{
  ok: boolean;
  resolvidos: KeyMetaPreset[];
  falhas: Array<{ nome: string; motivo: string }>;
  total_nomes: number;
  gravou: boolean;
  erro?: string;
  detalhe?: string;
}> {
  const { supa, token, preset, forcar } = opts;
  const existentes = keysValidasDoPreset(preset);
  if (!forcar && existentes.length > 0) {
    return {
      ok: true,
      resolvidos: existentes,
      falhas: preset.falhas_resolucao ?? [],
      total_nomes: preset.nomes_oficiais.length,
      gravou: false,
    };
  }

  const nomes = preset.nomes_oficiais;
  const resolvidos: KeyMetaPreset[] = [];
  const falhas: Array<{ nome: string; motivo: string }> = [];
  const seenKey = new Set<string>();

  for (let i = 0; i < nomes.length; i += LOTE) {
    const lote = nomes.slice(i, i + LOTE);
    const r = await buscarGeolocalizacoesMeta({
      token,
      nomes: lote,
      tipo: "neighborhood",
      country_code: GEO_PRESET_COUNTRY,
      cidade_contexto: GEO_PRESET_CITY,
      regiao_contexto: GEO_PRESET_REGION,
      exigir_salvador_ba: true,
      limit_por_query: 10,
    });
    const porQuery = new Map(r.resolvidos.map((x) => [x.query.toLowerCase(), x]));
    for (const nome of lote) {
      const hit = porQuery.get(nome.toLowerCase());
      if (!hit) {
        const amb = r.ambiguos.find((a) => a.query.toLowerCase() === nome.toLowerCase());
        const err = r.erros.find((e) => e.query.toLowerCase() === nome.toLowerCase());
        falhas.push({
          nome,
          motivo: err?.erro
            ? `erro_graph: ${err.erro}`
            : amb
            ? "ambiguo_sem_match_salvador_ba"
            : "nao_encontrado_salvador_ba",
        });
        continue;
      }
      // Duplo check no escolhido (buscar já filtra, mas reforça).
      const meta = {
        key: hit.key,
        name: hit.name,
        query: hit.query,
        type: hit.type,
        primary_city: GEO_PRESET_CITY,
        region: GEO_PRESET_REGION,
        country_code: GEO_PRESET_COUNTRY,
      };
      if (!ehLocalSalvadorBA(meta) && hit.type === "neighborhood") {
        // Se a busca marcou ok mas sem city/region no escolhido, ainda aceitamos
        // porque exigir_salvador_ba já filtrou encontrados antes do pick.
      }
      if (seenKey.has(hit.key)) continue;
      seenKey.add(hit.key);
      resolvidos.push(meta);
    }
  }

  const { error } = await supa
    .from("geo_targeting_presets")
    .update({
      keys_meta: resolvidos,
      falhas_resolucao: falhas,
      keys_resolvidas_em: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq("id", preset.id);

  if (error) {
    return {
      ok: false,
      resolvidos,
      falhas,
      total_nomes: nomes.length,
      gravou: false,
      erro: "falha_ao_gravar_keys_preset",
      detalhe: error.message,
    };
  }

  preset.keys_meta = resolvidos;
  preset.falhas_resolucao = falhas;
  preset.keys_resolvidas_em = new Date().toISOString();

  return {
    ok: resolvidos.length > 0,
    resolvidos,
    falhas,
    total_nomes: nomes.length,
    gravou: true,
  };
}

/**
 * Gate único do criar_conjunto (propose + executor):
 * - Jurídico: default = preset; geo informada só se for exatamente o preset; resto rejeita.
 * - La Felicità / outros: no-op (geo opcional como antes).
 */
export async function aplicarGateGeoCriarConjunto(opts: {
  companyId: string;
  params: Record<string, unknown>;
  sinaisMeio: Array<string | null | undefined>;
  geoNorm: ReturnType<typeof normalizarGeoDoPedido>;
  supa: any;
  tokenAds: string | null;
}): Promise<{
  meio: MeioCohapmGeo | null;
  aplica_preset: boolean;
  geo?: Record<string, unknown>;
  resumo?: string;
  contagem?: Record<string, number>;
  default_aplicado?: boolean;
  preset_keys?: number;
  preset_falhas?: number;
  erro?: string;
  detalhe?: string;
}> {
  const meio = resolverMeioGeoCohapm(opts.companyId, opts.params, ...opts.sinaisMeio);
  const aplica = deveAplicarPresetGeoJuridico(opts.companyId, meio);
  if (!aplica) {
    return {
      meio,
      aplica_preset: false,
      geo: opts.geoNorm.geo,
      resumo: opts.geoNorm.resumo,
      contagem: opts.geoNorm.contagem,
    };
  }

  const carregado = await carregarPresetGeoJuridico(opts.supa, opts.companyId);
  if (!carregado.preset) {
    return {
      meio,
      aplica_preset: true,
      erro: carregado.erro,
      detalhe: carregado.detalhe,
    };
  }

  let preset = carregado.preset;
  if (!keysValidasDoPreset(preset).length) {
    if (!opts.tokenAds) {
      return {
        meio,
        aplica_preset: true,
        erro: "token_ads_ausente_para_resolver_preset_geo",
        detalhe:
          "Preset Jurídico sem keys Meta e sem META_ADS_TOKEN_COHAPM no runtime para resolver adgeolocation.",
      };
    }
    const res = await resolverECachearKeysPreset({
      supa: opts.supa,
      token: opts.tokenAds,
      preset,
      forcar: true,
    });
    if (!res.ok || !res.resolvidos.length) {
      return {
        meio,
        aplica_preset: true,
        erro: "preset_geo_juridico_sem_keys_salvador_ba",
        detalhe:
          `Nenhum bairro do preset resolveu para key Meta em Salvador–BA ` +
          `(${res.falhas.length}/${res.total_nomes} falhas). Nao crio conjunto com geo errada.`,
        preset_falhas: res.falhas.length,
      };
    }
    preset = { ...preset, keys_meta: res.resolvidos, falhas_resolucao: res.falhas };
  }

  const doPreset = geoLocationsDoPreset(preset);
  if (doPreset.erro || !doPreset.geo) {
    return {
      meio,
      aplica_preset: true,
      erro: doPreset.erro,
      detalhe: doPreset.detalhe,
    };
  }

  if (!opts.geoNorm.geo) {
    return {
      meio,
      aplica_preset: true,
      geo: doPreset.geo,
      resumo: doPreset.resumo,
      contagem: doPreset.contagem,
      default_aplicado: true,
      preset_keys: doPreset.keys.length,
      preset_falhas: (preset.falhas_resolucao ?? []).length,
    };
  }

  const bate = geoBateExatoComPreset(opts.geoNorm.geo, preset);
  if (!bate.ok) {
    return {
      meio,
      aplica_preset: true,
      erro: bate.erro,
      detalhe: bate.detalhe,
      preset_keys: doPreset.keys.length,
    };
  }

  return {
    meio,
    aplica_preset: true,
    geo: doPreset.geo,
    resumo: doPreset.resumo,
    contagem: doPreset.contagem,
    default_aplicado: false,
    preset_keys: doPreset.keys.length,
    preset_falhas: (preset.falhas_resolucao ?? []).length,
  };
}

/** Reexport útil para provas. */
export type { GeoKeyItem };
