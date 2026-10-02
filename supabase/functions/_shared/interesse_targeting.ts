// Interesse / detalhamento de publico no conjunto publicado.
// A Meta aceita POST /{adset_id} targeting (o mesmo transporte de alterar_geo).
// Nao existe filtro de renda familiar nem "pesquisou nos ultimos N dias".
// Interesse e afinidade; Advantage+ (advantage_audience=1) dilui o recorte.

const GRAPH_SEARCH = "https://graph.facebook.com/v21.0/search";
export const MAX_INTERESSES = 20;
export const MAX_BUSCA_INTERESSES = 20;
const CONCORRENCIA_BUSCA = 4;

export const TERMOS_GEO_NAO_INTERESSE = [
  "lauro de freitas",
  "praia do forte",
  "linha verde",
] as const;

export type InteresseRef = { id: string; name: string; classe?: ClasseSegmentacao; grupo?: number };

export const CLASSES_SEGMENTACAO = ["interests", "behaviors", "work_positions", "industries"] as const;
export type ClasseSegmentacao = (typeof CLASSES_SEGMENTACAO)[number];

export type TermoSegmentacao = {
  id: string;
  name: string;
  classe: ClasseSegmentacao;
  grupo?: number;
};

export function classeValida(v: unknown): ClasseSegmentacao | null {
  const s = String(v ?? "").trim().toLowerCase();
  if (s === "interest" || s === "interests" || s === "adinterest") return "interests";
  if (s === "behavior" || s === "behaviors" || s === "comportamento" || s === "comportamentos") return "behaviors";
  if (s === "work_positions" || s === "work_position" || s === "cargo" || s === "profissao") return "work_positions";
  if (s === "industries" || s === "industry" || s === "setor" || s === "industria") return "industries";
  return null;
}

export function stripInteresse(s: string): string {
  return String(s ?? "")
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

export function ehTermoGeoNaoInteresse(query: string): boolean {
  const q = stripInteresse(query);
  return TERMOS_GEO_NAO_INTERESSE.some((t) => q === t || q.includes(t));
}

export function recusarMatchInteresse(query: string, name: string): string | null {
  const q = stripInteresse(query);
  const n = stripInteresse(name);
  if (
    (q.includes("aluguel") || q.includes("aluguer")) &&
    (n.includes("carro") || n.includes("car rental") || n.includes("aluguel de carro") ||
      n.includes("aluguer de carro") || n.includes("aluguer"))
  ) {
    return "match_e_aluguel_de_carro";
  }
  return null;
}

export function normalizarIdInteresse(raw: unknown): string | null {
  const s = String(raw ?? "").trim();
  if (!/^\d{5,20}$/.test(s)) return null;
  return s;
}

export function itemParaTermo(item: unknown): TermoSegmentacao | null {
  if (!item || typeof item !== "object") return null;
  const o = item as Record<string, unknown>;
  const id = normalizarIdInteresse(o.id ?? o.interest_id ?? o.key);
  const classe = classeValida(o.classe ?? o.class ?? o.tipo);
  if (!id || !classe) return null;
  const name = String(o.name ?? o.nome ?? "").trim() || id;
  const grupoRaw = o.grupo != null ? Number(o.grupo) : undefined;
  return {
    id,
    name,
    classe,
    grupo: grupoRaw != null && Number.isFinite(grupoRaw) ? grupoRaw : undefined,
  };
}

export function itemParaInteresse(item: unknown): InteresseRef | null {
  if (typeof item === "string") {
    const id = normalizarIdInteresse(item);
    return id ? { id, name: id } : null;
  }
  if (item && typeof item === "object") {
    const o = item as Record<string, unknown>;
    const id = normalizarIdInteresse(o.id ?? o.interest_id ?? o.key);
    if (!id) return null;
    const name = String(o.name ?? o.nome ?? "").trim() || id;
    return { id, name };
  }
  return null;
}

export function parseAdvantageAudience(v: unknown, padrao: 0 | 1 = 0): 0 | 1 {
  if (v === 1 || v === true || v === "1" || v === "true") return 1;
  if (v === 0 || v === false || v === "0" || v === "false") return 0;
  return padrao;
}

export function normalizarInteressesDoPedido(params: Record<string, unknown> | null | undefined): {
  interesses: InteresseRef[];
  resumo: string;
  erro?: string;
  detalhe?: string;
} {
  const p = params && typeof params === "object" ? params : {};
  const bruto = p.interesses ?? p.interests ?? p.detalhamento;
  if (!Array.isArray(bruto) || bruto.length === 0) {
    return {
      interesses: [],
      resumo: "",
      erro: "interesses_obrigatorios",
      detalhe:
        "Passe interesses[] com {id, name, classe} devolvidos por buscar_segmentacao. classe e interests, behaviors, work_positions ou industries. Id sem classe nao entra.",
    };
  }
  const out: TermoSegmentacao[] = [];
  const seen = new Set<string>();
  const semId: string[] = [];
  const semClasse: string[] = [];
  const geo: string[] = [];
  for (const item of bruto) {
    if (typeof item === "string" && !normalizarIdInteresse(item)) {
      const nome = item.trim();
      if (ehTermoGeoNaoInteresse(nome)) geo.push(nome);
      else semId.push(nome || "(vazio)");
      continue;
    }
    const ref = itemParaTermo(item);
    if (!ref) {
      const o = item && typeof item === "object" ? item as Record<string, unknown> : null;
      const id = o ? normalizarIdInteresse(o.id ?? o.interest_id ?? o.key) : normalizarIdInteresse(item);
      const nome = o
        ? String(o.name ?? o.nome ?? "").trim()
        : String(item ?? "").trim();
      if (nome && ehTermoGeoNaoInteresse(nome)) geo.push(nome);
      else if (id && !classeValida(o?.classe ?? o?.class ?? o?.tipo)) semClasse.push(id);
      else semId.push(nome || id || JSON.stringify(item).slice(0, 80));
      continue;
    }
    if (ehTermoGeoNaoInteresse(ref.name)) {
      geo.push(ref.name);
      continue;
    }
    if (seen.has(ref.id)) continue;
    seen.add(ref.id);
    out.push(ref);
  }
  if (geo.length) {
    return {
      interesses: [],
      resumo: "",
      erro: "termo_e_geo_nao_interesse",
      detalhe:
        `${geo.join(", ")} e local (geo), nao interesse. Use buscar_geolocalizacao + alterar_geo_do_conjunto.`,
    };
  }
  if (semClasse.length) {
    return {
      interesses: [],
      resumo: "",
      erro: "classe_obrigatoria",
      detalhe:
        `Estes ids nao tem classe declarada (${semClasse.join(", ")}). ` +
        "Comportamento, cargo e setor nao sao interests. Resolva com buscar_segmentacao e passe {id,name,classe}.",
    };
  }
  if (semId.length) {
    return {
      interesses: [],
      resumo: "",
      erro: "interesses_sem_id_meta",
      detalhe:
        `Estes itens nao tem id numerico da Meta: ${semId.join(", ")}. Resolva com buscar_segmentacao e passe {id,name,classe}.`,
    };
  }
  if (!out.length) {
    return {
      interesses: [],
      resumo: "",
      erro: "interesses_obrigatorios",
      detalhe: "Nenhum interesse com id Meta apos normalizar.",
    };
  }
  if (out.length > MAX_INTERESSES) {
    return {
      interesses: [],
      resumo: "",
      erro: "interesses_acima_do_limite",
      detalhe: `Maximo ${MAX_INTERESSES} interesses por conjunto (OR no mesmo flexible_spec). Recebi ${out.length}.`,
    };
  }
  const resumo = out.map((x) => x.name).join(" OU ");
  return { interesses: out, resumo };
}

export function validarPublicoDoPedido(params: Record<string, unknown> | null | undefined):
  | {
    ok: true;
    params: Record<string, unknown>;
    resumo: string;
    advantage_audience: 0 | 1;
  }
  | { ok: false; erro: string; detalhe?: string } {
  const p = params && typeof params === "object" ? { ...params } : {};
  const norm = normalizarInteressesDoPedido(p);
  if (norm.erro) return { ok: false, erro: norm.erro, detalhe: norm.detalhe };
  const advantage_audience = parseAdvantageAudience(
    p.advantage_audience ?? p.advantage_plus ?? p.advantage,
    0,
  );
  return {
    ok: true,
    advantage_audience,
    resumo: norm.resumo,
    params: {
      interesses: norm.interesses,
      advantage_audience,
    },
  };
}

/**
 * Um bloco = OU. Blocos diferentes do flexible_spec a Meta trata como E
 * e o publico despenca. Cada id vai na chave da propria classe.
 */
export function montarFlexibleSpec(
  termos: TermoSegmentacao[],
): Array<Record<string, Array<{ id: string; name: string }>>> {
  const grupos = new Map<number, TermoSegmentacao[]>();
  for (const t of termos) {
    const g = t.grupo ?? 0;
    const arr = grupos.get(g) ?? [];
    arr.push(t);
    grupos.set(g, arr);
  }
  const blocos: Array<Record<string, Array<{ id: string; name: string }>>> = [];
  for (const g of [...grupos.keys()].sort((a, b) => a - b)) {
    const bloco: Record<string, Array<{ id: string; name: string }>> = {};
    for (const t of grupos.get(g) ?? []) {
      const lista = bloco[t.classe] ?? [];
      if (!lista.some((x) => x.id === t.id)) lista.push({ id: t.id, name: t.name });
      bloco[t.classe] = lista;
    }
    if (Object.keys(bloco).length) blocos.push(bloco);
  }
  return blocos;
}

export function idsConferemComResolucao(
  termos: TermoSegmentacao[],
  resolvidos: Array<{ id: string; classe: ClasseSegmentacao }>,
): { ok: true } | { ok: false; erro: string; detalhe: string } {
  const mapa = new Map(resolvidos.map((r) => [r.id, r.classe]));
  for (const t of termos) {
    const classe = mapa.get(t.id);
    if (!classe) {
      return {
        ok: false,
        erro: "id_nao_resolvido_nesta_conversa",
        detalhe:
          `O id ${t.id} nao foi resolvido por buscar_segmentacao nesta conversa. Id digitado a mao nao entra no card.`,
      };
    }
    if (classe !== t.classe) {
      return {
        ok: false,
        erro: "classe_diverge_da_resolucao",
        detalhe:
          `O id ${t.id} foi resolvido como ${classe} e o pedido o colocou em ${t.classe}. Nao grave comportamento dentro de interests.`,
      };
    }
  }
  return { ok: true };
}

/** Substitui flexible_spec e advantage_audience; preserva geo/idade/plataformas. */
export function aplicarPublicoNoTargeting(
  targeting: Record<string, unknown>,
  opts: {
    interesses?: Array<InteresseRef & { classe?: ClasseSegmentacao; grupo?: number }>;
    termos?: TermoSegmentacao[];
    advantage_audience: 0 | 1;
  },
): Record<string, unknown> {
  const bruto = opts.termos ?? opts.interesses ?? [];
  const termos: TermoSegmentacao[] = [];
  for (const x of bruto) {
    const classe = classeValida(x.classe);
    if (!classe || !x.id) continue;
    termos.push({ id: x.id, name: x.name, classe, grupo: x.grupo });
  }
  const next: Record<string, unknown> = { ...targeting };
  delete next.interests;
  delete next.behaviors;
  delete next.work_positions;
  delete next.industries;
  next.flexible_spec = montarFlexibleSpec(termos);
  const autoRaw = next.targeting_automation;
  const auto: Record<string, unknown> =
    autoRaw && typeof autoRaw === "object" && !Array.isArray(autoRaw)
      ? { ...(autoRaw as Record<string, unknown>) }
      : {};
  auto.advantage_audience = opts.advantage_audience;
  next.targeting_automation = auto;
  return next;
}

export type ResultadoBuscaInteresse = {
  query: string;
  parece_geo: boolean;
  escolhido: InteresseRef | null;
  ambiguo: boolean;
  nao_encontrado: boolean;
  recusados: Array<{ id: string; name: string; motivo: string }>;
  encontrados: Array<{
    id: string;
    name: string;
    audience_size?: number | null;
    path?: string[];
    topic?: string;
    recusado?: string;
  }>;
  erro?: string;
};

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

function escolherInteresse(
  query: string,
  rows: ResultadoBuscaInteresse["encontrados"],
): { escolhido: InteresseRef | null; ambiguo: boolean } {
  const q = stripInteresse(query);
  const usable = rows.filter((r) => !r.recusado);
  const exact = usable.filter((r) => stripInteresse(r.name) === q);
  if (exact.length === 1) {
    return { escolhido: { id: exact[0].id, name: exact[0].name }, ambiguo: false };
  }
  if (exact.length > 1) {
    return { escolhido: { id: exact[0].id, name: exact[0].name }, ambiguo: true };
  }
  if (usable.length === 1) {
    return { escolhido: { id: usable[0].id, name: usable[0].name }, ambiguo: false };
  }
  if (usable.length > 1) {
    return { escolhido: { id: usable[0].id, name: usable[0].name }, ambiguo: true };
  }
  return { escolhido: null, ambiguo: false };
}

function paramsDaBusca(
  classe: ClasseSegmentacao,
  query: string,
  limit: number,
  locale: string,
  token: string,
): URLSearchParams {
  if (classe === "interests") {
    return new URLSearchParams({
      type: "adinterest",
      q: query,
      limit: String(limit),
      locale,
      access_token: token,
    });
  }
  return new URLSearchParams({
    type: "adTargetingCategory",
    class: classe,
    q: query,
    limit: String(limit),
    locale,
    access_token: token,
  });
}

export async function buscarInteressesMeta(opts: {
  token: string;
  nomes: string[];
  limit_por_query?: number;
  locale?: string;
  classe?: ClasseSegmentacao;
}): Promise<{
  ok: boolean;
  total_pedidos: number;
  resolvidos: InteresseRef[];
  ambiguos: ResultadoBuscaInteresse[];
  nao_encontrados: string[];
  geo_nao_interesse: string[];
  recusados: Array<{ query: string; name: string; motivo: string }>;
  erros: Array<{ query: string; erro: string }>;
  consultas: ResultadoBuscaInteresse[];
  nota: string;
  erro?: string;
  detalhe?: string;
}> {
  const empty = (extra: Record<string, unknown> = {}) => ({
    ok: false,
    total_pedidos: 0,
    resolvidos: [] as InteresseRef[],
    ambiguos: [] as ResultadoBuscaInteresse[],
    nao_encontrados: [] as string[],
    geo_nao_interesse: [] as string[],
    recusados: [] as Array<{ query: string; name: string; motivo: string }>,
    erros: [] as Array<{ query: string; erro: string }>,
    consultas: [] as ResultadoBuscaInteresse[],
    nota: "",
    ...extra,
  });

  const nomes = (opts.nomes ?? []).map((n) => String(n ?? "").trim()).filter(Boolean);
  const uniq: string[] = [];
  const seen = new Set<string>();
  for (const n of nomes) {
    const k = stripInteresse(n);
    if (!k || seen.has(k)) continue;
    seen.add(k);
    uniq.push(n);
  }
  if (!uniq.length) {
    return empty({
      erro: "nomes_obrigatorios",
      detalhe: "Informe nomes[] com pelo menos um termo para buscar.",
    });
  }
  if (uniq.length > MAX_BUSCA_INTERESSES) {
    return empty({
      total_pedidos: uniq.length,
      erro: "lote_acima_do_limite",
      detalhe: `Maximo ${MAX_BUSCA_INTERESSES} termos por chamada. Recebi ${uniq.length}.`,
    });
  }

  const limit = Math.min(25, Math.max(1, Number(opts.limit_por_query ?? 8) || 8));
  const locale = String(opts.locale ?? "pt_BR").trim() || "pt_BR";
  const classe = opts.classe ?? "interests";

  const consultas = await mapPool(uniq, CONCORRENCIA_BUSCA, async (query) => {
    const pareceGeo = ehTermoGeoNaoInteresse(query);
    const qs = paramsDaBusca(classe, query, limit, locale, opts.token);
    const base: ResultadoBuscaInteresse = {
      query,
      parece_geo: pareceGeo,
      escolhido: null,
      ambiguo: false,
      nao_encontrado: false,
      recusados: [],
      encontrados: [],
    };
    try {
      const r = await fetch(`${GRAPH_SEARCH}?${qs.toString()}`);
      const t = await r.text();
      let body: any;
      try {
        body = JSON.parse(t);
      } catch {
        return { ...base, erro: `resposta_nao_json_${r.status}`, nao_encontrado: true };
      }
      if (!r.ok || body?.error) {
        return {
          ...base,
          erro: String(body?.error?.message ?? `http_${r.status}`).slice(0, 200),
          nao_encontrado: true,
        };
      }
      const data = Array.isArray(body?.data) ? body.data : [];
      const encontrados: ResultadoBuscaInteresse["encontrados"] = [];
      const recusados: ResultadoBuscaInteresse["recusados"] = [];
      for (const row of data) {
        const id = normalizarIdInteresse(row?.id);
        const name = String(row?.name ?? "").trim();
        if (!id || !name) continue;
        const motivo = recusarMatchInteresse(query, name);
        const item = {
          id,
          name,
          audience_size: row?.audience_size != null ? Number(row.audience_size) : null,
          path: Array.isArray(row?.path) ? row.path.map((x: unknown) => String(x)) : undefined,
          topic: row?.topic != null ? String(row.topic) : undefined,
          recusado: motivo ?? undefined,
        };
        encontrados.push(item);
        if (motivo) recusados.push({ id, name, motivo });
      }
      if (pareceGeo) {
        return { ...base, encontrados, recusados, nao_encontrado: true };
      }
      const escolha = escolherInteresse(query, encontrados);
      return {
        ...base,
        encontrados,
        recusados,
        escolhido: escolha.escolhido,
        ambiguo: escolha.ambiguo,
        nao_encontrado: !escolha.escolhido,
      };
    } catch (e) {
      return {
        ...base,
        erro: String((e as Error)?.message ?? e).slice(0, 200),
        nao_encontrado: true,
      };
    }
  });

  const resolvidos: InteresseRef[] = [];
  const seenId = new Set<string>();
  const ambiguos: ResultadoBuscaInteresse[] = [];
  const nao_encontrados: string[] = [];
  const geo_nao_interesse: string[] = [];
  const recusados: Array<{ query: string; name: string; motivo: string }> = [];
  const erros: Array<{ query: string; erro: string }> = [];

  for (const c of consultas) {
    if (c.erro) erros.push({ query: c.query, erro: c.erro });
    if (c.parece_geo) geo_nao_interesse.push(c.query);
    for (const r of c.recusados) recusados.push({ query: c.query, name: r.name, motivo: r.motivo });
    if (c.ambiguo) ambiguos.push(c);
    if (c.escolhido && !seenId.has(c.escolhido.id)) {
      seenId.add(c.escolhido.id);
      resolvidos.push({ ...c.escolhido, classe });
    } else if (!c.escolhido && !c.parece_geo) {
      nao_encontrados.push(c.query);
    }
  }

  return {
    ok: true,
    total_pedidos: uniq.length,
    resolvidos,
    ambiguos,
    nao_encontrados,
    geo_nao_interesse,
    recusados,
    erros,
    consultas,
    nota:
      "Interesse e afinidade (declarada ou inferida), NAO historico de busca e NAO renda familiar. " +
      "Nao existe filtro R$ 8.000. Empilhar termos nao aproxima teto salarial. " +
      "Lauro de Freitas, Praia do Forte e Linha Verde sao geo — alterar_geo_do_conjunto. " +
      "Aluguel de casa costuma resolver para aluguel de carro: nao use. " +
      `Para o card: params.interesses = resolvidos {id,name,classe:"${classe}"}. ` +
      "Nao troque a classe. Comportamento nao entra em interests. " +
      "Advantage+ ligado dilui o recorte; alterar_publico desliga por padrao.",
  };
}

export async function buscarSegmentacaoMeta(opts: {
  token: string;
  nomes: string[];
  classe: ClasseSegmentacao;
  limit_por_query?: number;
  locale?: string;
}) {
  return await buscarInteressesMeta(opts);
}

type ClienteResolucao = {
  from: (t: string) => {
    insert: (rows: unknown[]) => Promise<{ error: { message: string } | null }>;
    select: (cols: string) => {
      eq: (col: string, val: string) => {
        eq: (col: string, val: string) => {
          gte: (col: string, val: string) => Promise<{
            data: Array<{ termo_id: string; classe: string }> | null;
            error: { message: string } | null;
          }>;
        };
      };
    };
  };
};

export async function registrarResolucaoDeSegmentacao(
  supa: ClienteResolucao,
  opts: {
    companyId: string;
    conversaId: string | null;
    termos: Array<{ id: string; name: string; classe?: string }>;
  },
): Promise<{ ok: true } | { ok: false; motivo: string }> {
  const linhas = opts.termos
    .map((t) => {
      const classe = classeValida(t.classe);
      const id = normalizarIdInteresse(t.id);
      if (!classe || !id) return null;
      return {
        company_id: opts.companyId,
        conversa_id: opts.conversaId,
        termo_id: id,
        classe,
        nome: String(t.name ?? id),
      };
    })
    .filter((x): x is NonNullable<typeof x> => !!x);
  if (!linhas.length) return { ok: true };
  const { error } = await supa.from("segmentacao_resolvida").insert(linhas);
  if (error) return { ok: false, motivo: error.message };
  return { ok: true };
}

export async function recusarIdsNaoResolvidosNaConversa(
  supa: {
    from: (t: string) => {
      select: (cols: string) => {
        eq: (col: string, val: string) => {
          gte: (col: string, val: string) => Promise<{
            data: Array<{ termo_id: string; classe: string }> | null;
            error: { message: string } | null;
          }>;
        };
      };
    };
  },
  opts: { companyId: string; termos: TermoSegmentacao[] },
): Promise<{ ok: true } | { ok: false; erro: string; detalhe: string }> {
  const desde = new Date(Date.now() - 6 * 3600e3).toISOString();
  const { data, error } = await supa
    .from("segmentacao_resolvida")
    .select("termo_id,classe")
    .eq("company_id", opts.companyId)
    .gte("resolvido_em", desde);
  if (error) {
    return {
      ok: false,
      erro: "consulta_falhou",
      detalhe: `Nao consegui ler as resolucoes desta conversa (${error.message}). Sem isso o card nao nasce.`,
    };
  }
  const resolvidos = (data ?? [])
    .map((r) => {
      const classe = classeValida(r.classe);
      return classe ? { id: String(r.termo_id), classe } : null;
    })
    .filter((x): x is { id: string; classe: ClasseSegmentacao } => !!x);
  return idsConferemComResolucao(opts.termos, resolvidos);
}
