// Objetivo ODAX (campanha) + otimizacao de conjunto para engajamento/reconhecimento.
// Casa padrao continua LEADS/LP/CLT; esta familia e a excecao autorizada (ex.: IMPULSAO SOCIAL).

export const ODAX_OBJETIVOS = [
  "OUTCOME_LEADS",
  "OUTCOME_SALES",
  "OUTCOME_TRAFFIC",
  "OUTCOME_ENGAGEMENT",
  "OUTCOME_AWARENESS",
  "OUTCOME_APP_PROMOTION",
] as const;

export type ObjetivoOdax = (typeof ODAX_OBJETIVOS)[number];

export type FamiliaObjetivo = "conversao" | "engajamento" | "reconhecimento" | "trafego" | "app";

const SINONIMOS_ODAX: Record<string, ObjetivoOdax> = {
  LEADS: "OUTCOME_LEADS",
  LEAD_GENERATION: "OUTCOME_LEADS",
  LEADGEN: "OUTCOME_LEADS",
  CONVERSIONS: "OUTCOME_SALES",
  SALES: "OUTCOME_SALES",
  VENDAS: "OUTCOME_SALES",
  TRAFFIC: "OUTCOME_TRAFFIC",
  TRAFEGO: "OUTCOME_TRAFFIC",
  LINK_CLICKS: "OUTCOME_TRAFFIC",
  MESSAGES: "OUTCOME_ENGAGEMENT",
  MENSAGEM: "OUTCOME_ENGAGEMENT",
  ENGAGEMENT: "OUTCOME_ENGAGEMENT",
  ENGAJAMENTO: "OUTCOME_ENGAGEMENT",
  POST_ENGAGEMENT: "OUTCOME_ENGAGEMENT",
  PAGE_LIKES: "OUTCOME_ENGAGEMENT",
  PAGE_ENGAGEMENT: "OUTCOME_ENGAGEMENT",
  PROFILE_VISIT: "OUTCOME_ENGAGEMENT",
  PROFILE_AND_PAGE_ENGAGEMENT: "OUTCOME_ENGAGEMENT",
  AWARENESS: "OUTCOME_AWARENESS",
  RECONHECIMENTO: "OUTCOME_AWARENESS",
  REACH: "OUTCOME_AWARENESS",
  BRAND_AWARENESS: "OUTCOME_AWARENESS",
  APP: "OUTCOME_APP_PROMOTION",
  APP_PROMOTION: "OUTCOME_APP_PROMOTION",
};

/** Tags ESP-40 → ODAX (quando o agente omite params.objetivo). */
const TAG_PARA_ODAX: Record<string, ObjetivoOdax> = {
  LEADS: "OUTCOME_LEADS",
  SALES: "OUTCOME_SALES",
  VENDAS: "OUTCOME_SALES",
  TRAFFIC: "OUTCOME_TRAFFIC",
  TRAFEGO: "OUTCOME_TRAFFIC",
  ENGAGEMENT: "OUTCOME_ENGAGEMENT",
  ENGAJAMENTO: "OUTCOME_ENGAGEMENT",
  AWARENESS: "OUTCOME_AWARENESS",
  RECONHECIMENTO: "OUTCOME_AWARENESS",
  APP: "OUTCOME_APP_PROMOTION",
};

const OPT_ENGAJAMENTO = new Set([
  "POST_ENGAGEMENT",
  "PAGE_LIKES",
  "EVENT_RESPONSES",
  "THRUPLAY",
  "PROFILE_VISIT",
  "PROFILE_AND_PAGE_ENGAGEMENT",
]);

const OPT_RECONHECIMENTO = new Set([
  "REACH",
  "IMPRESSIONS",
  "AD_RECALL_LIFT",
]);

function normalizarChave(raw: unknown): string {
  return String(raw ?? "").trim().toUpperCase().replace(/[\s-]+/g, "_");
}

export function normalizarObjetivoOdax(raw: unknown): ObjetivoOdax | null {
  const k = normalizarChave(raw);
  if (!k) return null;
  if ((ODAX_OBJETIVOS as readonly string[]).includes(k)) return k as ObjetivoOdax;
  return SINONIMOS_ODAX[k] ?? null;
}

export function odaxDeObjetivoTag(tag: unknown): ObjetivoOdax | null {
  const k = normalizarChave(tag);
  if (!k) return null;
  return TAG_PARA_ODAX[k] ?? SINONIMOS_ODAX[k] ?? null;
}

/**
 * Resolve ODAX a partir de params.objetivo e/ou objetivo_tag.
 * Sem nenhum dos dois → default OUTCOME_LEADS (doutrina da casa).
 * Com valor invalido → null (caller recusa com objetivo_nao_suportado).
 */
export function resolverObjetivoOdax(params: {
  objetivo?: unknown;
  objetivo_tag?: unknown;
  defaultLeadsSeVazio?: boolean;
}): { ok: true; objetivo: ObjetivoOdax; origem: string } | { ok: false; bruto: string } {
  const brutoObj = String(params.objetivo ?? "").trim();
  const brutoTag = String(params.objetivo_tag ?? "").trim();
  if (!brutoObj && !brutoTag) {
    if (params.defaultLeadsSeVazio === false) {
      return { ok: false, bruto: "" };
    }
    return { ok: true, objetivo: "OUTCOME_LEADS", origem: "default_casa" };
  }
  if (brutoObj) {
    const o = normalizarObjetivoOdax(brutoObj);
    if (o) return { ok: true, objetivo: o, origem: "params.objetivo" };
    return { ok: false, bruto: normalizarChave(brutoObj) };
  }
  const viaTag = odaxDeObjetivoTag(brutoTag);
  if (viaTag) return { ok: true, objetivo: viaTag, origem: "params.objetivo_tag" };
  return { ok: false, bruto: normalizarChave(brutoTag) };
}

export function familiaDeObjetivo(objetivo: unknown): FamiliaObjetivo {
  const o = normalizarObjetivoOdax(objetivo) ?? odaxDeObjetivoTag(objetivo);
  switch (o) {
    case "OUTCOME_ENGAGEMENT":
      return "engajamento";
    case "OUTCOME_AWARENESS":
      return "reconhecimento";
    case "OUTCOME_TRAFFIC":
      return "trafego";
    case "OUTCOME_APP_PROMOTION":
      return "app";
    default:
      return "conversao";
  }
}

export function ehFamiliaSocialTopo(objetivoOuTag: unknown): boolean {
  const f = familiaDeObjetivo(objetivoOuTag);
  return f === "engajamento" || f === "reconhecimento";
}

export type AdsetEngajamentoDefaults = {
  optimization_goal: string;
  billing_event: string;
  destination_type: string | null;
  /** promoted_object so com page_id — sem pixel/conversao. */
  promoted_object: { page_id: string };
};

/**
 * Defaults de conjunto para campanha de engajamento/reconhecimento.
 * Destino e a Page (e IG vinculado), nao LP/pixel.
 */
export function defaultsConjuntoSocialTopo(
  familia: "engajamento" | "reconhecimento",
  pageId: string,
  optimizationPedida?: unknown,
): AdsetEngajamentoDefaults | { erro: string; detalhe: string } {
  const page = String(pageId ?? "").trim();
  if (!page) {
    return {
      erro: "page_id_obrigatorio_para_engajamento",
      detalhe:
        "Campanha de engajamento/reconhecimento exige page_id (Page da marca). Configure meta_execution_config.page_id ou passe params.page_id.",
    };
  }

  const pedida = normalizarChave(optimizationPedida);
  if (familia === "reconhecimento") {
    const opt = pedida && OPT_RECONHECIMENTO.has(pedida) ? pedida : "REACH";
    if (pedida && !OPT_RECONHECIMENTO.has(pedida)) {
      return {
        erro: "optimization_goal_nao_suportado_para_reconhecimento",
        detalhe: `Para OUTCOME_AWARENESS use: ${[...OPT_RECONHECIMENTO].join(", ")}. Recebi "${pedida}".`,
      };
    }
    return {
      optimization_goal: opt,
      billing_event: "IMPRESSIONS",
      destination_type: null,
      promoted_object: { page_id: page },
    };
  }

  const opt = pedida && OPT_ENGAJAMENTO.has(pedida) ? pedida : "POST_ENGAGEMENT";
  if (pedida && !OPT_ENGAJAMENTO.has(pedida)) {
    return {
      erro: "optimization_goal_nao_suportado_para_engajamento",
      detalhe: `Para OUTCOME_ENGAGEMENT use: ${[...OPT_ENGAJAMENTO].join(", ")}. Recebi "${pedida}".`,
    };
  }
  return {
    optimization_goal: opt,
    billing_event: "IMPRESSIONS",
    destination_type: null,
    promoted_object: { page_id: page },
  };
}

export function mensagemObjetivoNaoSuportado(bruto: string): {
  erro: string;
  detalhe: string;
} {
  return {
    erro: "objetivo_nao_suportado",
    detalhe:
      `objetivo '${bruto || "(vazio)"}' nao e valido na Meta/ODAX. Use: ${ODAX_OBJETIVOS.join(", ")}. ` +
      `Sinonimos aceitos: ENGAJAMENTO/ENGAGEMENT/POST_ENGAGEMENT → OUTCOME_ENGAGEMENT; ` +
      `RECONHECIMENTO/AWARENESS/REACH → OUTCOME_AWARENESS; LEADS → OUTCOME_LEADS. ` +
      `Para impulsionar Page/Instagram (brand boost) use OUTCOME_ENGAGEMENT (ou tag ENGAJAMENTO).`,
  };
}
