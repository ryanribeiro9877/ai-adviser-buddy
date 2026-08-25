// supabase/functions/_shared/geo_targeting.ts
// Geolocalizacao no criar_conjunto: normaliza geo_locations / bairros e busca keys Meta.
// Formato Marketing API: targeting.geo_locations.{neighborhoods|cities|regions|…}[{key}].
// Puro (sem Deno.env) — busca Graph fica em buscarGeolocalizacoesMeta (recebe token).

export const GEO_TIPOS_BUSCA = [
  "neighborhood",
  "city",
  "region",
  "zip",
  "geo_market",
  "subcity",
  "medium_geo_area",
  "small_geo_area",
  "large_geo_area",
] as const;

export type GeoTipoBusca = (typeof GEO_TIPOS_BUSCA)[number];

export const GEO_CHAVES_TARGETING = [
  "countries",
  "country_groups",
  "regions",
  "cities",
  "zips",
  "places",
  "geo_markets",
  "electoral_districts",
  "neighborhoods",
  "custom_locations",
  "location_types",
  "location_cluster_ids",
] as const;

const MAX_LOCAIS = 250;
const MAX_BUSCA_POR_CHAMADA = 40;
const CONCORRENCIA_BUSCA = 6;
const GRAPH_SEARCH = "https://graph.facebook.com/v21.0/search";

export type GeoKeyItem = { key: string; name?: string };

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === "object" && !Array.isArray(v);
}

function looksLikeKey(s: string): boolean {
  // Keys Meta de neighborhood/city costumam ser numericas (as vezes com prefixo).
  return /^[A-Za-z0-9:_-]{2,64}$/.test(s) && /\d/.test(s);
}

/** Converte item solto (string key | {key,name}) em GeoKeyItem. Nomes sem key = null. */
export function itemParaGeoKey(raw: unknown): GeoKeyItem | null {
  if (raw == null) return null;
  if (typeof raw === "string" || typeof raw === "number") {
    const s = String(raw).trim();
    if (!s) return null;
    if (!looksLikeKey(s)) return null;
    return { key: s };
  }
  if (isPlainObject(raw)) {
    const key = String(raw.key ?? raw.id ?? "").trim();
    if (!key) return null;
    const name = String(raw.name ?? raw.nome ?? "").trim() || undefined;
    return name ? { key, name } : { key };
  }
  return null;
}

/**
 * Aceita params.geo_locations (objeto Meta) OU params.bairros / neighborhoods (lista de keys).
 * Recusa nomes sem key — resolve antes com buscar_geolocalizacao.
 */
export function normalizarGeoDoPedido(params: Record<string, unknown> | null | undefined): {
  geo?: Record<string, unknown>;
  erro?: string;
  detalhe?: string;
  resumo?: string;
  contagem?: Record<string, number>;
} {
  if (!params || typeof params !== "object") return {};

  const listaBairros = params.bairros ?? params.neighborhoods;
  const geoRaw = params.geo_locations;

  if (listaBairros != null && geoRaw != null) {
    return {
      erro: "geo_e_bairros_conflitantes",
      detalhe:
        "Passe OU params.geo_locations (objeto Meta completo) OU params.bairros (lista de keys). Nao os dois.",
    };
  }

  if (listaBairros != null) {
    if (!Array.isArray(listaBairros)) {
      return {
        erro: "bairros_deve_ser_array",
        detalhe: "params.bairros deve ser um array de keys Meta (ou {key,name}).",
      };
    }
    if (listaBairros.length === 0) {
      return { erro: "bairros_vazio", detalhe: "Lista de bairros veio vazia." };
    }
    if (listaBairros.length > MAX_LOCAIS) {
      return {
        erro: "bairros_acima_do_limite",
        detalhe: `Maximo ${MAX_LOCAIS} locais por conjunto (limite operacional alinhado a Meta cities). Recebi ${listaBairros.length}.`,
      };
    }
    const keys: GeoKeyItem[] = [];
    const semKey: string[] = [];
    for (const item of listaBairros) {
      const g = itemParaGeoKey(item);
      if (g) keys.push(g);
      else semKey.push(String(item ?? "").slice(0, 80));
    }
    if (semKey.length) {
      return {
        erro: "bairros_sem_key_meta",
        detalhe:
          `Ha ${semKey.length} item(ns) sem key Meta (so nome?). Resolva com buscar_geolocalizacao e passe keys. ` +
          `Exemplos: ${semKey.slice(0, 5).join(" | ")}`,
      };
    }
    const uniq = new Map<string, GeoKeyItem>();
    for (const k of keys) uniq.set(k.key, k);
    const neighborhoods = [...uniq.values()].map((k) =>
      k.name ? { key: k.key, name: k.name } : { key: k.key },
    );
    const geo: Record<string, unknown> = {
      neighborhoods,
      location_types: ["home", "recent"],
    };
    return {
      geo,
      resumo: `${neighborhoods.length} bairro(s) (neighborhoods)`,
      contagem: { neighborhoods: neighborhoods.length },
    };
  }

  if (geoRaw == null) return {};

  if (!isPlainObject(geoRaw)) {
    return {
      erro: "geo_locations_invalido",
      detalhe: "params.geo_locations deve ser objeto JSON no formato Meta.",
    };
  }

  const geo: Record<string, unknown> = {};
  const contagem: Record<string, number> = {};
  let totalLocais = 0;

  for (const chave of GEO_CHAVES_TARGETING) {
    if (!(chave in geoRaw)) continue;
    const val = geoRaw[chave];
    if (chave === "location_types") {
      if (Array.isArray(val) && val.length) geo.location_types = val.map(String);
      continue;
    }
    if (chave === "countries" || chave === "country_groups") {
      if (Array.isArray(val) && val.length) {
        geo[chave] = val.map(String);
        contagem[chave] = val.length;
        totalLocais += val.length;
      }
      continue;
    }
    if (chave === "custom_locations") {
      if (!Array.isArray(val)) {
        return {
          erro: "custom_locations_invalido",
          detalhe: "custom_locations deve ser array de {latitude,longitude,radius,…}.",
        };
      }
      if (val.length > MAX_LOCAIS) {
        return { erro: "geo_acima_do_limite", detalhe: `custom_locations > ${MAX_LOCAIS}.` };
      }
      geo.custom_locations = val;
      contagem.custom_locations = val.length;
      totalLocais += val.length;
      continue;
    }
    if (!Array.isArray(val)) {
      return {
        erro: `geo_${chave}_invalido`,
        detalhe: `geo_locations.${chave} deve ser array.`,
      };
    }
    if (val.length === 0) continue;
    const items: GeoKeyItem[] = [];
    for (const item of val) {
      const g = itemParaGeoKey(item);
      if (!g) {
        return {
          erro: "geo_item_sem_key",
          detalhe:
            `geo_locations.${chave} exige objetos com key Meta (ou string key). Item invalido: ${JSON.stringify(item).slice(0, 120)}. ` +
            `Use buscar_geolocalizacao para resolver nomes.`,
        };
      }
      items.push(g);
    }
    if (items.length > MAX_LOCAIS) {
      return { erro: "geo_acima_do_limite", detalhe: `${chave} > ${MAX_LOCAIS}.` };
    }
    geo[chave] = items.map((k) => (k.name ? { key: k.key, name: k.name } : { key: k.key }));
    contagem[chave] = items.length;
    totalLocais += items.length;
  }

  if (Object.keys(geo).filter((k) => k !== "location_types").length === 0) {
    return {
      erro: "geo_locations_vazio",
      detalhe:
        "geo_locations sem countries/regions/cities/neighborhoods/zips/custom_locations/places. Informe ao menos uma chave com items.",
    };
  }
  if (totalLocais > MAX_LOCAIS) {
    return {
      erro: "geo_acima_do_limite",
      detalhe: `Total de locais ${totalLocais} > ${MAX_LOCAIS}.`,
    };
  }
  if (!geo.location_types) geo.location_types = ["home", "recent"];

  const partes = Object.entries(contagem).map(([k, n]) => `${n} ${k}`);
  return { geo, resumo: partes.join(", "), contagem };
}

/** Substitui geo_locations no targeting herdado (mantem idade/plataformas/etc.). */
export function aplicarGeoNoTargeting(
  targeting: Record<string, unknown>,
  geo: Record<string, unknown>,
): Record<string, unknown> {
  return { ...targeting, geo_locations: geo };
}

export type ResultadoBuscaGeo = {
  query: string;
  tipo_pedido: string;
  encontrados: Array<{
    key: string;
    name: string;
    type?: string;
    country_code?: string;
    region?: string;
    region_id?: number | string;
    primary_city?: string;
    primary_city_id?: number | string;
  }>;
  escolhido: { key: string; name: string; type?: string } | null;
  ambiguo: boolean;
  nao_encontrado: boolean;
  erro?: string;
};

function stripAccentsGeo(s: string): string {
  return String(s ?? "")
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase();
}

/** Duplo check: local Meta deve ser Salvador + Bahia (BR). */
export function ehLocalSalvadorBA(row: {
  primary_city?: string;
  region?: string;
  country_code?: string;
  name?: string;
}): boolean {
  const country = String(row.country_code ?? "").trim().toUpperCase();
  if (country && country !== "BR") return false;
  const city = stripAccentsGeo(row.primary_city ?? "");
  const region = stripAccentsGeo(row.region ?? "");
  const cityOk = city.includes("salvador");
  const regionOk =
    region.includes("bahia") ||
    region === "ba" ||
    region.includes("state of bahia");
  // Ideal: cidade + UF.
  if (cityOk && regionOk) return true;
  // Graph as vezes omite region mas traz primary_city=Salvador.
  if (cityOk && !region) return true;
  // Graph as vezes omite primary_city em neighborhood mas traz region=Bahia + country BR.
  // Aceita so se region for Bahia (evita SP/RJ); o pickMelhor ainda exige nome.
  if (!city && regionOk) return true;
  return false;
}

function pickMelhor(
  query: string,
  rows: ResultadoBuscaGeo["encontrados"],
  cidadeContexto?: string,
  regiaoContexto?: string,
  exigirSalvadorBa?: boolean,
): { escolhido: ResultadoBuscaGeo["escolhido"]; ambiguo: boolean } {
  if (!rows.length) return { escolhido: null, ambiguo: false };
  const q = query.trim().toLowerCase();
  const cidade = (cidadeContexto ?? "").trim().toLowerCase();
  const regiao = (regiaoContexto ?? "").trim().toLowerCase();

  let pool = rows;
  if (exigirSalvadorBa) {
    const soSsa = rows.filter((r) => ehLocalSalvadorBA(r));
    // Sem match Salvador–BA: NAO cai no pool de outra cidade (evita key errada).
    if (!soSsa.length) return { escolhido: null, ambiguo: false };
    pool = soSsa;
  } else if (cidade) {
    const filtrado = rows.filter((r) => {
      const pc = String(r.primary_city ?? "").toLowerCase();
      const reg = String(r.region ?? "").toLowerCase();
      const nm = String(r.name ?? "").toLowerCase();
      const cityHit = pc.includes(cidade) || nm.includes(cidade);
      const regionHit = regiao
        ? reg.includes(regiao) || reg.includes(regiao.slice(0, 2))
        : true;
      return cityHit || (reg.includes(cidade) && regionHit);
    });
    if (filtrado.length) pool = filtrado;
  } else if (regiao) {
    const filtrado = rows.filter((r) => {
      const reg = String(r.region ?? "").toLowerCase();
      return reg.includes(regiao);
    });
    if (filtrado.length) pool = filtrado;
  }

  const exact = pool.filter((r) => String(r.name ?? "").toLowerCase() === q);
  if (exact.length === 1) {
    const e = exact[0];
    return { escolhido: { key: e.key, name: e.name, type: e.type }, ambiguo: false };
  }
  if (exact.length > 1) {
    return {
      escolhido: { key: exact[0].key, name: exact[0].name, type: exact[0].type },
      ambiguo: true,
    };
  }
  if (pool.length === 1) {
    return {
      escolhido: { key: pool[0].key, name: pool[0].name, type: pool[0].type },
      ambiguo: false,
    };
  }
  if (pool.length > 1) {
    return {
      escolhido: { key: pool[0].key, name: pool[0].name, type: pool[0].type },
      ambiguo: true,
    };
  }
  return { escolhido: null, ambiguo: false };
}

async function mapPool<T, R>(
  items: T[],
  concurrency: number,
  fn: (item: T, idx: number) => Promise<R>,
): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  async function worker() {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i], i);
    }
  }
  const n = Math.min(concurrency, Math.max(1, items.length));
  await Promise.all(Array.from({ length: n }, () => worker()));
  return out;
}

/** Busca Graph type=adgeolocation (batch com concorrencia limitada). */
export async function buscarGeolocalizacoesMeta(opts: {
  token: string;
  nomes: string[];
  tipo?: string;
  country_code?: string;
  cidade_contexto?: string;
  /** Ex.: Bahia — usado com cidade_contexto / exigir_salvador_ba. */
  regiao_contexto?: string;
  /** Se true: so aceita matches com primary_city Salvador + region Bahia (BR). */
  exigir_salvador_ba?: boolean;
  limit_por_query?: number;
}): Promise<{
  ok: boolean;
  tipo: string;
  country_code: string;
  total_pedidos: number;
  resolvidos: Array<{
    query: string;
    key: string;
    name: string;
    type?: string;
    primary_city?: string;
    region?: string;
    country_code?: string;
  }>;
  ambiguos: ResultadoBuscaGeo[];
  nao_encontrados: string[];
  erros: Array<{ query: string; erro: string }>;
  rejeitados_fora_salvador_ba: string[];
  geo_locations_sugerido: Record<string, unknown> | null;
  bairros_keys: string[];
  nota: string;
  erro?: string;
  detalhe?: string;
}> {
  const tipoRaw = String(opts.tipo ?? "neighborhood").trim().toLowerCase() || "neighborhood";
  const empty = (extra: Record<string, unknown> = {}) => ({
    ok: false,
    tipo: tipoRaw,
    country_code: "BR",
    total_pedidos: 0,
    resolvidos: [] as Array<{
      query: string;
      key: string;
      name: string;
      type?: string;
      primary_city?: string;
      region?: string;
      country_code?: string;
    }>,
    ambiguos: [] as ResultadoBuscaGeo[],
    nao_encontrados: [] as string[],
    erros: [] as Array<{ query: string; erro: string }>,
    rejeitados_fora_salvador_ba: [] as string[],
    geo_locations_sugerido: null as Record<string, unknown> | null,
    bairros_keys: [] as string[],
    nota: "",
    ...extra,
  });
  if (!(GEO_TIPOS_BUSCA as readonly string[]).includes(tipoRaw)) {
    return empty({
      erro: "tipo_geo_nao_suportado",
      detalhe: `Use: ${GEO_TIPOS_BUSCA.join(", ")}.`,
    });
  }
  const country = String(opts.country_code ?? "BR").trim().toUpperCase() || "BR";
  const nomes = (opts.nomes ?? []).map((n) => String(n ?? "").trim()).filter(Boolean);
  const uniq: string[] = [];
  const seen = new Set<string>();
  for (const n of nomes) {
    const k = n.toLowerCase();
    if (seen.has(k)) continue;
    seen.add(k);
    uniq.push(n);
  }
  if (!uniq.length) {
    return empty({
      country_code: country,
      erro: "nomes_obrigatorios",
      detalhe: "Informe nomes[] com pelo menos um local para buscar.",
    });
  }
  if (uniq.length > MAX_BUSCA_POR_CHAMADA) {
    return empty({
      country_code: country,
      total_pedidos: uniq.length,
      erro: "lote_acima_do_limite",
      detalhe:
        `Maximo ${MAX_BUSCA_POR_CHAMADA} nomes por chamada (evita timeout). Recebi ${uniq.length}. ` +
        `Chame de novo em lotes; ao final monte params.bairros com todas as keys.`,
    });
  }

  const cidadeCtx = opts.cidade_contexto;
  const regiaoCtx = opts.regiao_contexto;
  const exigirSsa = opts.exigir_salvador_ba === true;
  const limit = Math.min(50, Math.max(1, Number(opts.limit_por_query ?? (exigirSsa ? 25 : 8)) || 8));

  const resultados = await mapPool(uniq, CONCORRENCIA_BUSCA, async (query) => {
    // Com contexto Salvador–BA: tenta q enriquecida; se vazio, cai no nome puro + filtro.
    const variantesQ = exigirSsa
      ? [`${query} Salvador Bahia`, `${query} Salvador`, query]
      : cidadeCtx
      ? [`${query} ${cidadeCtx}`, query]
      : [query];

    let encontradosAll: ResultadoBuscaGeo["encontrados"] = [];
    let lastErro: string | undefined;

    for (const qBusca of variantesQ) {
      const qs = new URLSearchParams({
        type: "adgeolocation",
        q: qBusca,
        location_types: JSON.stringify([tipoRaw]),
        country_code: country,
        limit: String(limit),
        access_token: opts.token,
      });
      try {
        const r = await fetch(`${GRAPH_SEARCH}?${qs.toString()}`);
        const t = await r.text();
        let body: any;
        try {
          body = JSON.parse(t);
        } catch {
          lastErro = `resposta_nao_json_${r.status}`;
          continue;
        }
        if (!r.ok || body?.error) {
          lastErro = String(body?.error?.message ?? `http_${r.status}`).slice(0, 200);
          continue;
        }
        const data = Array.isArray(body?.data) ? body.data : [];
        const encontrados = data
          .map((row: any) => ({
            key: String(row.key ?? ""),
            name: String(row.name ?? ""),
            type: row.type != null ? String(row.type) : undefined,
            country_code: row.country_code != null ? String(row.country_code) : undefined,
            region: row.region != null ? String(row.region) : undefined,
            region_id: row.region_id,
            primary_city: row.primary_city != null ? String(row.primary_city) : undefined,
            primary_city_id: row.primary_city_id,
          }))
          .filter((x: { key: string }) => !!x.key);
        if (encontrados.length) {
          encontradosAll = encontrados;
          // Se ja tem match Salvador–BA, para; senao tenta proxima variante.
          if (!exigirSsa || encontrados.some((e: (typeof encontrados)[number]) => ehLocalSalvadorBA(e))) break;
        }
      } catch (e) {
        lastErro = String((e as Error)?.message ?? e).slice(0, 200);
      }
    }

    if (!encontradosAll.length) {
      return {
        query,
        tipo_pedido: tipoRaw,
        encontrados: [],
        escolhido: null,
        ambiguo: false,
        nao_encontrado: true,
        erro: lastErro,
      } satisfies ResultadoBuscaGeo;
    }

    const { escolhido, ambiguo } = pickMelhor(
      query,
      encontradosAll,
      cidadeCtx,
      regiaoCtx,
      exigirSsa,
    );
    return {
      query,
      tipo_pedido: tipoRaw,
      encontrados: encontradosAll.slice(0, 12),
      escolhido,
      ambiguo,
      nao_encontrado: !escolhido,
    } satisfies ResultadoBuscaGeo;
  });

  const resolvidos: Array<{
    query: string;
    key: string;
    name: string;
    type?: string;
    primary_city?: string;
    region?: string;
    country_code?: string;
  }> = [];
  const ambiguos: ResultadoBuscaGeo[] = [];
  const nao_encontrados: string[] = [];
  const erros: Array<{ query: string; erro: string }> = [];
  const rejeitados_fora_salvador_ba: string[] = [];

  for (const r of resultados) {
    if (r.erro) erros.push({ query: r.query, erro: r.erro });
    if (r.escolhido) {
      const metaRow = r.encontrados.find((e) => e.key === r.escolhido!.key);
      if (exigirSsa && metaRow && !ehLocalSalvadorBA(metaRow)) {
        rejeitados_fora_salvador_ba.push(r.query);
        nao_encontrados.push(r.query);
        continue;
      }
      resolvidos.push({
        query: r.query,
        key: r.escolhido.key,
        name: r.escolhido.name,
        type: r.escolhido.type,
        primary_city: metaRow?.primary_city,
        region: metaRow?.region,
        country_code: metaRow?.country_code,
      });
      if (r.ambiguo) ambiguos.push(r);
    } else {
      if (exigirSsa && r.encontrados.some((e) => e.key) && !r.encontrados.some((e) => ehLocalSalvadorBA(e))) {
        rejeitados_fora_salvador_ba.push(r.query);
      }
      nao_encontrados.push(r.query);
    }
  }

  const chaveTarget =
    tipoRaw === "neighborhood"
      ? "neighborhoods"
      : tipoRaw === "city"
      ? "cities"
      : tipoRaw === "region"
      ? "regions"
      : tipoRaw === "zip"
      ? "zips"
      : tipoRaw === "geo_market"
      ? "geo_markets"
      : "neighborhoods";

  const keysUniq = [...new Map(resolvidos.map((r) => [r.key, r])).values()];
  const geo_locations_sugerido = keysUniq.length
    ? {
      [chaveTarget]: keysUniq.map((r) => ({ key: r.key, name: r.name })),
      location_types: ["home", "recent"],
    }
    : null;

  return {
    ok: nao_encontrados.length === 0 && erros.length === 0,
    tipo: tipoRaw,
    country_code: country,
    total_pedidos: uniq.length,
    resolvidos,
    ambiguos,
    nao_encontrados,
    erros,
    rejeitados_fora_salvador_ba,
    geo_locations_sugerido,
    bairros_keys: keysUniq.map((r) => r.key),
    nota:
      `Busca Meta adgeolocation (${tipoRaw}, ${country}` +
      (exigirSsa ? ", filtro estrito Salvador+Bahia" : "") +
      `). ` +
      `Max ${MAX_BUSCA_POR_CHAMADA}/chamada, concorrencia ${CONCORRENCIA_BUSCA}. ` +
      `Para criar_conjunto: params.bairros = bairros_keys OU params.geo_locations = geo_locations_sugerido. ` +
      `Ambiguos: revise escolhido vs encontrados antes de emitir o card.` +
      (rejeitados_fora_salvador_ba.length
        ? ` Rejeitados fora Salvador–BA: ${rejeitados_fora_salvador_ba.length}.`
        : ""),
  };
}
