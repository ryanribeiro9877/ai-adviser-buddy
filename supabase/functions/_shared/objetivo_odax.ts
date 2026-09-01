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

export type FamiliaObjetivo =
  | "conversao"
  | "engajamento"
  | "reconhecimento"
  | "trafego"
  | "app"
  | "mensagens";

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
  // Click-to-WhatsApp / conversas: Meta aceita OUTCOME_ENGAGEMENT + CONVERSATIONS + WHATSAPP.
  MESSAGES: "OUTCOME_ENGAGEMENT",
  MENSAGEM: "OUTCOME_ENGAGEMENT",
  MENSAGENS: "OUTCOME_ENGAGEMENT",
  CONVERSATIONS: "OUTCOME_ENGAGEMENT",
  CONV: "OUTCOME_ENGAGEMENT",
  WHATSAPP: "OUTCOME_ENGAGEMENT",
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
  CONV: "OUTCOME_ENGAGEMENT",
  MESSAGES: "OUTCOME_ENGAGEMENT",
  MENSAGENS: "OUTCOME_ENGAGEMENT",
  WHATSAPP: "OUTCOME_ENGAGEMENT",
  AWARENESS: "OUTCOME_AWARENESS",
  RECONHECIMENTO: "OUTCOME_AWARENESS",
  APP: "OUTCOME_APP_PROMOTION",
};

// ODAX: goals de engajamento dependem de destination_type (conversion location).
// PROFILE_VISIT / PROFILE_AND_PAGE_ENGAGEMENT existem no Ads Manager mas a Marketing
 // API rejeita (Pipeboard/Meta 20/08/2026) — nao listamos aqui.
const OPT_ENGAJAMENTO = new Set([
  "POST_ENGAGEMENT",
  "PAGE_LIKES",
  "EVENT_RESPONSES",
  "THRUPLAY",
]);

const OPT_RECONHECIMENTO = new Set([
  "REACH",
  "IMPRESSIONS",
  "AD_RECALL_LIFT",
]);

/** destination_type exigido pela Meta para cada optimization_goal de ENGAGEMENT. */
function destinationTypeEngajamento(opt: string): string {
  switch (opt) {
    case "PAGE_LIKES":
      return "ON_PAGE";
    case "EVENT_RESPONSES":
      return "ON_EVENT";
    case "THRUPLAY":
      return "ON_VIDEO";
    default:
      // POST_ENGAGEMENT (e default da casa): On Post.
      return "ON_POST";
  }
}

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

/**
 * Click-to-WhatsApp / conversas: OUTCOME_ENGAGEMENT (ou LEADS/SALES/TRAFFIC) +
 * optimization_goal=CONVERSATIONS + destination_type=WHATSAPP.
 * Distinto de "engajamento" social (POST_ENGAGEMENT + ON_POST).
 */
/**
 * Trafego com destino SITE (wa.me como URL, LANDING_PAGE_VIEWS).
 * Distinto de CTWA: destination_type=WEBSITE, nao WHATSAPP no conjunto.
 * Medido 22/08/2026: card 5b9fd669 recusou WEBSITE porque o nome CONV forcou familia mensagens.
 */
export function ehPedidoTrafegoWebsite(params: {
  optimization_goal?: unknown;
  destination_type?: unknown;
  familia_objetivo?: unknown;
  objetivo?: unknown;
}): boolean {
  const dest = normalizarChave(params.destination_type);
  const opt = normalizarChave(params.optimization_goal);
  const fam = normalizarChave(params.familia_objetivo);
  if (dest === "WHATSAPP" || dest === "MESSENGER" || dest === "INSTAGRAM_DIRECT") return false;
  if (opt === "CONVERSATIONS") return false;
  if (dest === "WEBSITE" || dest === "UNDEFINED") return true;
  if (opt === "LANDING_PAGE_VIEWS" || opt === "LINK_CLICKS") return true;
  if (fam === "TRAFEGO" || fam === "TRAFFIC") return true;
  // Campanha OUTCOME_TRAFFIC (espelho pode ainda nao ter destination_type).
  if (normalizarObjetivoOdax(params.objetivo) === "OUTCOME_TRAFFIC") return true;
  return false;
}

export function ehPedidoMensagens(params: {
  optimization_goal?: unknown;
  destination_type?: unknown;
  familia_objetivo?: unknown;
  objetivo_tag?: unknown;
  nome?: unknown;
  objetivo?: unknown;
}): boolean {
  // URL/site (wa.me no criativo) prevalece sobre nome CONV / familia mensagens.
  if (ehPedidoTrafegoWebsite(params)) return false;
  const fam = normalizarChave(params.familia_objetivo);
  if (
    fam === "MENSAGENS" || fam === "MENSAGEM" || fam === "MESSAGES" ||
    fam === "CONVERSAS" || fam === "CONVERSATIONS" || fam === "WHATSAPP"
  ) {
    return true;
  }
  const opt = normalizarChave(params.optimization_goal);
  if (opt === "CONVERSATIONS") return true;
  const dest = normalizarChave(params.destination_type);
  if (
    dest === "WHATSAPP" || dest === "MESSENGER" || dest === "INSTAGRAM_DIRECT" ||
    dest.includes("MESSAGING")
  ) {
    return true;
  }
  const tag = normalizarChave(params.objetivo_tag);
  if (
    tag === "CONV" || tag === "MESSAGES" || tag === "MENSAGENS" ||
    tag === "WHATSAPP" || tag === "CONVERSAS"
  ) {
    return true;
  }
  const nome = String(params.nome ?? "").toUpperCase();
  // Nome com CONV/WA (ex.: COHAPM_JURIDICO_CONV_LEVA01) indica CTWA, nao impulsão de post.
  if (
    /_CONV_|\bCONV\b|CONVERSA|WHATSAPP|\bWA\b|CLICK.?TO.?WA|CTWA/.test(nome) &&
    !/ENGAJAMENTO|POST_ENGAGEMENT|IMPULSAO|SOCIAL.?BOOST/.test(nome)
  ) {
    return true;
  }
  return false;
}

export function ehFamiliaSocialTopo(objetivoOuTag: unknown): boolean {
  const f = familiaDeObjetivo(objetivoOuTag);
  return f === "engajamento" || f === "reconhecimento";
}

/**
 * Conjunto do zero (target_name=sem_molde): molde e opcional em qualquer familia.
 * Trafego/website usa defaults WEBSITE + LANDING_PAGE_VIEWS; social/mensagens
 * seguem os defaults ja existentes. Conversao sem molde ainda pode falhar na Graph
 * se faltar pixel — isso e erro de payload, nao exigencia de molde.
 */
export function ehFamiliaSemMoldePermitida(_familia: unknown): boolean {
  return true;
}

export type AdsetEngajamentoDefaults = {
  optimization_goal: string;
  billing_event: string;
  destination_type: string | null;
  /** promoted_object so com page_id — sem pixel/conversao. */
  promoted_object: {
    page_id: string;
    whatsapp_phone_number?: string;
    whats_app_business_phone_number_id?: string;
  };
};

/**
 * Defaults de conjunto para campanha de engajamento/reconhecimento.
 * Destino e a Page (e IG vinculado), nao LP/pixel.
 *
 * ENGAGEMENT: Meta exige destination_type alinhado ao goal (ON_POST + POST_ENGAGEMENT
 * e o padrao da casa). Sem destination_type, create_adset devolve
 * "Performance Goal Incompatible with Campaign Objective" mesmo com POST_ENGAGEMENT
 * (medido 20/08/2026, card 1b905e3a).
 *
 * REACH/IMPRESSIONS como optimization_goal ficam em reconhecimento (AWARENESS).
 * Em ENGAGEMENT+ON_POST a Meta tambem lista REACH/IMPRESSIONS, mas a doutrina da casa
 * usa POST_ENGAGEMENT — nao OR-merge REACH no caminho de engajamento.
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

  // REACH/IMPRESSIONS pedidas em engajamento: recusa (nao viram ON_POST silenciosamente).
  if (pedida === "REACH" || pedida === "IMPRESSIONS" || pedida === "AD_RECALL_LIFT") {
    return {
      erro: "optimization_goal_nao_suportado_para_engajamento",
      detalhe:
        `REACH/IMPRESSIONS/AD_RECALL_LIFT sao goals de OUTCOME_AWARENESS (reconhecimento), nao de OUTCOME_ENGAGEMENT. ` +
        `Para engajamento use: ${[...OPT_ENGAJAMENTO].join(", ")} (padrao POST_ENGAGEMENT + destination_type=ON_POST). Recebi "${pedida}".`,
    };
  }

  // CONVERSATIONS nao e impulsão de post — e Click-to-WhatsApp (familia mensagens).
  if (pedida === "CONVERSATIONS" || pedida === "LINK_CLICKS") {
    return {
      erro: "optimization_goal_exige_familia_mensagens",
      detalhe:
        `optimization_goal=${pedida} sob familia engajamento (POST/Page/Event/Video) e invalido. ` +
        `Para conversas no WhatsApp use familia_objetivo=mensagens com optimization_goal=CONVERSATIONS e destination_type=WHATSAPP ` +
        `(campanha OUTCOME_ENGAGEMENT ja criada continua valida). Nao misture CONVERSATIONS com ON_POST.`,
    };
  }

  const opt = pedida && OPT_ENGAJAMENTO.has(pedida) ? pedida : "POST_ENGAGEMENT";
  if (pedida && !OPT_ENGAJAMENTO.has(pedida)) {
    return {
      erro: "optimization_goal_nao_suportado_para_engajamento",
      detalhe:
        `Para engajamento SOCIAL (impulsão de post/Page) use: ${[...OPT_ENGAJAMENTO].join(", ")} ` +
        `(com destination_type ON_POST|ON_PAGE|ON_EVENT|ON_VIDEO). Recebi "${pedida}". ` +
        `Para conversas WhatsApp use familia_objetivo=mensagens (CONVERSATIONS + WHATSAPP). ` +
        `Profile/Page visits (PROFILE_AND_PAGE_ENGAGEMENT) nao e suportado via Marketing API — use POST_ENGAGEMENT + ON_POST.`,
    };
  }
  return {
    optimization_goal: opt,
    billing_event: "IMPRESSIONS",
    destination_type: destinationTypeEngajamento(opt),
    promoted_object: { page_id: page },
  };
}

/**
 * Defaults de conjunto Click-to-WhatsApp / conversas.
 * Meta: OUTCOME_ENGAGEMENT|LEADS|SALES|TRAFFIC + CONVERSATIONS + destination_type=WHATSAPP
 * + promoted_object.page_id (whatsapp_phone_number opcional).
 * Medido 21/08/2026: o caminho "engajamento social" rejeitava CONVERSATIONS e forçava ON_POST.
 */
export function defaultsConjuntoMensagens(
  pageId: string,
  opts?: {
    whatsapp_phone_number?: unknown;
    whats_app_business_phone_number_id?: unknown;
    destination_type?: unknown;
    optimization_goal?: unknown;
  },
): AdsetEngajamentoDefaults | { erro: string; detalhe: string } {
  const page = String(pageId ?? "").trim();
  if (!page) {
    return {
      erro: "page_id_obrigatorio_para_mensagens",
      detalhe:
        "Conjunto de conversas WhatsApp exige page_id (Page com WhatsApp vinculado). Configure meta_execution_config.page_id ou passe params.page_id.",
    };
  }

  const destPedida = normalizarChave(opts?.destination_type);
  // Destino AUTOMATICO (Meta escolhe IG/Messenger/WhatsApp) nao e o que o gestor pede.
  // Forca destino MANUAL WhatsApp-only. Messenger+WhatsApp manual e MESSAGING_MESSENGER_WHATSAPP.
  let dest: string | null = null;
  if (!destPedida || destPedida === "MESSAGING_MESSENGER_WHATSAPP") {
    dest = "MESSAGING_MESSENGER_WHATSAPP";
  } else if (destPedida === "WHATSAPP") {
    dest = "WHATSAPP";
  } else if (destPedida === "MESSAGING_INSTAGRAM_DIRECT_WHATSAPP") {
    dest = "MESSAGING_INSTAGRAM_DIRECT_WHATSAPP";
  } else if (destPedida === "MESSAGING_INSTAGRAM_DIRECT_MESSENGER_WHATSAPP") {
    dest = "WHATSAPP";
  } else if (destPedida.includes("WHATSAPP")) {
    dest = "WHATSAPP";
  } else if (destPedida === "MESSENGER" || destPedida === "INSTAGRAM_DIRECT") {
    dest = destPedida;
  }
  if (!dest) {
    return {
      erro: "destination_type_invalido_para_mensagens",
      detalhe:
        `Para familia mensagens use destination_type=WHATSAPP (padrao), MESSENGER ou INSTAGRAM_DIRECT. Recebi "${destPedida}". ` +
        `ON_POST/ON_PAGE sao de engajamento social, nao de conversa.`,
    };
  }

  const optPedida = normalizarChave(opts?.optimization_goal);
  const opt = !optPedida || optPedida === "CONVERSATIONS" ? "CONVERSATIONS" : optPedida;
  if (opt !== "CONVERSATIONS" && opt !== "LINK_CLICKS") {
    return {
      erro: "optimization_goal_nao_suportado_para_mensagens",
      detalhe:
        `Para familia mensagens use CONVERSATIONS (padrao) ou LINK_CLICKS. Recebi "${optPedida}".`,
    };
  }

  const waRaw = String(opts?.whatsapp_phone_number ?? "").trim();
  const waDigits = waRaw.replace(/\D/g, "");
  // Medido 22/08/2026 (JUR_CONV): conjunto WHATSAPP sem whatsapp_phone_number + criativo
  // CONTACT_US/wa.me → "Criativo invalido para o objetivo". LF CONV que entrega traz o numero.
  if (String(dest).includes("WHATSAPP") && waDigits.length < 10) {
    return {
      erro: "whatsapp_phone_number_obrigatorio_para_mensagens",
      detalhe:
        "Conjunto Click-to-WhatsApp (destination_type=WHATSAPP) exige params.whatsapp_phone_number " +
        "(digitos com DDI, ex.: 557191088073). O numero fica no promoted_object do conjunto; " +
        "o criativo usa api.whatsapp.com/send + WHATSAPP_MESSAGE — nao embuta o telefone em wa.me no anuncio.",
    };
  }
  const promoted: {
    page_id: string;
    whatsapp_phone_number?: string;
    whats_app_business_phone_number_id?: string;
  } = { page_id: page };
  if (waDigits.length >= 10) {
    // Import dinamico evitado: o canon 12-digitos vive em whatsapp_pagina; aqui so gravamos
    // os digitos crus. montarCriacao/resolverWhatsAppCtwa reescreve para o formato Ads.
    promoted.whatsapp_phone_number = waDigits;
  }
  const phoneId = String(opts?.whats_app_business_phone_number_id ?? "").trim();
  if (/^\d{5,}$/.test(phoneId)) promoted.whats_app_business_phone_number_id = phoneId;

  return {
    optimization_goal: opt,
    billing_event: "IMPRESSIONS",
    destination_type: dest,
    promoted_object: promoted,
  };
}

/**
 * Conjunto de trafego (OUTCOME_TRAFFIC) com destino website.
 * O link (ex. wa.me) vive no criativo, nao em promoted_object.whatsapp_phone_number.
 */
export function defaultsConjuntoTrafegoWebsite(opts?: {
  optimization_goal?: unknown;
  destination_type?: unknown;
}): AdsetEngajamentoDefaults {
  const optPedida = normalizarChave(opts?.optimization_goal);
  const opt = optPedida === "LINK_CLICKS" ? "LINK_CLICKS" : "LANDING_PAGE_VIEWS";
  const destPedida = normalizarChave(opts?.destination_type);
  const dest = destPedida === "UNDEFINED" ? "UNDEFINED" : "WEBSITE";
  return {
    optimization_goal: opt,
    billing_event: "IMPRESSIONS",
    destination_type: dest,
    promoted_object: { page_id: "" },
  };
}

/**
 * Targeting minimo BR Advantage+ para conjunto social/mensagens SEM molde.
 * Com advantage_audience=1 a Meta NAO aceita age_max no payload (fixo em 65) e
 * age_min so pode ser 18–25 (erro 1870188 se age_min>25 ou age_max enviado).
 */
export function targetingPadraoSocialTopo(): Record<string, unknown> {
  return {
    age_min: 18,
    geo_locations: { countries: ["BR"] },
    targeting_automation: { advantage_audience: 1 },
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
      `Sinonimos aceitos: ENGAJAMENTO/ENGAGEMENT/POST_ENGAGEMENT → OUTCOME_ENGAGEMENT (impulsão social); ` +
      `CONV/MESSAGES/WHATSAPP/CONVERSATIONS → OUTCOME_ENGAGEMENT (Click-to-WhatsApp, familia mensagens); ` +
      `RECONHECIMENTO/AWARENESS/REACH → OUTCOME_AWARENESS; LEADS → OUTCOME_LEADS. ` +
      `Nao confunda engajamento social (POST_ENGAGEMENT+ON_POST) com conversas WA (CONVERSATIONS+WHATSAPP).`,
  };
}
