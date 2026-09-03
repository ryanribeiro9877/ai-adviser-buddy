// Tipos e utilitários para as views de breakdown por conta/campanha.
// As views PostgREST retornam numeric/bigint como string — sempre coagir com num().

export type TipoConta =
  | "trafego"
  | "mensagem"
  | "leadgen"
  | "vendas"
  | "engajamento"
  | "alcance"
  | "video"
  | "app"
  | "outro"
  | "sem_dados";

/**
 * Base de resultado declarada, igual a de _shared/metrica_canonica.ts e a de
 * public.base_de_resultado(). O painel NAO decide a base: ela vem pronta da view
 * v_campaign_breakdown. Aqui o tipo existe so para o TypeScript recusar rotulo trocado.
 */
export type BaseDeResultado =
  | "formularios"
  | "conversas"
  | "formularios_e_conversas"
  | "cliques_no_link";

export type AccountRow = {
  account_id: string;
  account_name: string;
  company_id: string;
  tipo_conta: TipoConta;
  campaigns: number;
  spend: number;
  clicks: number;
  link_clicks: number;
  landing_page_views: number;
  messaging_started: number;
  form_leads: number;
  // Gasto SEPARADO por base. Uma conta mistura campanha de formulario, de conversa e de
  // trafego; dividir o gasto total pelos formularios da conta inflava o custo em ate 5,4x.
  gasto_em_formulario: number;
  gasto_em_conversa: number;
  gasto_em_trafego: number;
  sales: number;
  revenue: number;
};

export type CampaignRow = {
  company_id: string;
  empresa: string;
  account_id: string;
  account_name: string;
  campaign_id: string;
  campanha: string;
  objective: string | null;
  tipo: TipoConta;
  status: string;
  spend: number;
  impressions: number;
  reach: number;
  frequency: number;
  clicks: number;
  link_clicks: number;
  landing_page_views: number;
  messaging_started: number;
  form_leads: number;
  sales: number;
  revenue: number;
  // Base decidida no banco (public.base_de_resultado), com o resultado e o custo dela.
  // Substituiu `leads` (coluna orfa, removida em 03/09/2026) e `cpl` (= gasto / leads).
  base_de_resultado: BaseDeResultado;
  rotulo_do_custo: string;
  unidade_do_resultado: string;
  resultados: number;
  custo_por_resultado: number | null;
  cpc_link: number | null;
  last_synced_at: string | null;
};

// Coerção segura string|number|null -> number
export const num = (v: unknown): number => {
  const n = typeof v === "string" ? parseFloat(v) : (v as number);
  return Number.isFinite(n) ? n : 0;
};

// --- Mapa tipo -> apresentação -------------------------------------------------

type TipoMeta = {
  label: string;
  // classes de badge (tema escuro)
  badge: string;
  // cor sólida (hex) para gráficos
  color: string;
};

export const TIPO_META: Record<TipoConta, TipoMeta> = {
  trafego: {
    label: "Tráfego",
    badge: "bg-blue-500/15 text-blue-400 border-blue-500/30",
    color: "#60a5fa",
  },
  mensagem: {
    label: "Mensagem",
    badge: "bg-emerald-500/15 text-emerald-400 border-emerald-500/30",
    color: "#34d399",
  },
  leadgen: {
    label: "Leadgen",
    badge: "bg-violet-500/15 text-violet-400 border-violet-500/30",
    color: "#a78bfa",
  },
  vendas: {
    label: "Vendas",
    badge: "bg-amber-500/15 text-amber-400 border-amber-500/30",
    color: "#fbbf24",
  },
  engajamento: {
    label: "Engajamento",
    badge: "bg-zinc-500/15 text-zinc-300 border-zinc-500/30",
    color: "#a1a1aa",
  },
  alcance: {
    label: "Alcance",
    badge: "bg-slate-500/15 text-slate-300 border-slate-500/30",
    color: "#94a3b8",
  },
  video: {
    label: "Vídeo",
    badge: "bg-pink-500/15 text-pink-400 border-pink-500/30",
    color: "#f472b6",
  },
  app: { label: "App", badge: "bg-cyan-500/15 text-cyan-400 border-cyan-500/30", color: "#22d3ee" },
  outro: {
    label: "Outro",
    badge: "bg-zinc-500/15 text-zinc-400 border-zinc-500/30",
    color: "#a1a1aa",
  },
  sem_dados: {
    label: "Sem dados",
    badge: "bg-muted text-muted-foreground border-border",
    color: "#6b7280",
  },
};

// Ordem canônica para exibir chips de tipo
export const TIPO_ORDER: TipoConta[] = [
  "trafego",
  "mensagem",
  "leadgen",
  "vendas",
  "engajamento",
  "alcance",
  "video",
  "app",
  "outro",
];

export function tipoLabel(t: string): string {
  return TIPO_META[t as TipoConta]?.label ?? t;
}

// Métrica-resultado destacada por tipo (para o drill-down de campanhas)
export type ResultMetric = {
  label: string;
  value: string;
  costLabel: string | null;
  costValue: string | null;
};

/**
 * Resultado destacado de uma campanha, na base que o BANCO declarou.
 *
 * ANTES esta funcao escolhia a base pelo `tipo` da campanha, num switch escrito a mao — a
 * setima copia da mesma regra no sistema — e o ramo `default`, que atendia as 44 campanhas
 * sem categoria, mostrava "Leads" a partir da coluna orfa `leads`, com CPL = gasto / leads.
 * A base agora vem pronta em `c.base_de_resultado` e o rotulo em `c.rotulo_do_custo`: o
 * painel apresenta, nao decide. Venda continua com tratamento proprio porque ROAS nao e
 * custo por resultado — e a unica leitura em que a receita, e nao o denominador, manda.
 */
export function resultForCampaign(c: CampaignRow): ResultMetric {
  if (c.revenue > 0) {
    return {
      label: "Vendas / Receita",
      value: `${fmtInt(c.sales)} · ${fmtBRL(c.revenue)}`,
      costLabel: "ROAS",
      costValue: `${fmtDec(c.revenue / Math.max(c.spend, 1))}x`,
    };
  }
  const rotuloDaBase: Record<BaseDeResultado, string> = {
    formularios: "Formulários",
    conversas: "Conversas",
    formularios_e_conversas: "Formulários + conversas",
    cliques_no_link: "Cliques no link",
  };
  return {
    label: rotuloDaBase[c.base_de_resultado] ?? "Resultados",
    value: fmtInt(c.resultados),
    costLabel: `Custo ${c.rotulo_do_custo ?? "por resultado"}`,
    // Custo nulo com zero resultado e INDEFINIDO, nao zero: "R$ 0,00 por lead" leria como
    // "sai de graca". O travessao e a unica leitura honesta.
    costValue: c.resultados > 0 ? fmtBRL(c.custo_por_resultado ?? c.spend / c.resultados) : "—",
  };
}

// --- Formatadores (pt-BR) ------------------------------------------------------

// Aceitam nulo porque as views devolvem NULL em métrica derivada sem denominador
// (custo sem conversão, CTR sem impressão). Nesse caso mostram a ausência em vez
// de estourar — um número faltando não pode derrubar a tela inteira.
const SEM_DADO = "—";
const finito = (n: number | null | undefined): n is number =>
  typeof n === "number" && Number.isFinite(n);

export const fmtBRL = (n: number | null | undefined) =>
  finito(n)
    ? n.toLocaleString("pt-BR", {
        style: "currency",
        currency: "BRL",
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      })
    : SEM_DADO;
export const fmtInt = (n: number | null | undefined) =>
  finito(n) ? Math.round(n).toLocaleString("pt-BR") : SEM_DADO;
export const fmtPct = (n: number | null | undefined) => (finito(n) ? `${n.toFixed(2)}%` : SEM_DADO);
export const fmtDec = (n: number | null | undefined, d = 2) =>
  finito(n) ? n.toFixed(d) : SEM_DADO;

// --- Anúncios (tabela ads) -----------------------------------------------------

export type AdRow = {
  id: string;
  name: string;
  status: string;
  object_type: string | null;
  call_to_action_type: string | null;
  title: string | null;
  body: string | null;
  thumbnail_url: string | null;
  image_url: string | null;
  permalink_url: string | null;
  spend: number;
  impressions: number;
  reach: number;
  clicks: number;
  link_clicks: number;
  // `leads` saiu daqui: sem base declarada e sem escritor vivo desde a troca de pipeline.
  form_leads: number;
  messaging_started: number;
  sales: number;
  revenue: number;
  campaign_id: string | null;
};

// --- Conjuntos de anúncios (tabela ad_sets) ------------------------------------

// Estrutura parcial do targeting (jsonb do Meta). Nem toda chave existe sempre.
export type Targeting = {
  age_min?: number;
  age_max?: number;
  genders?: number[];
  geo_locations?: {
    countries?: string[];
    regions?: Array<{ name?: string }>;
    cities?: Array<{ name?: string }>;
  };
  publisher_platforms?: string[];
  facebook_positions?: string[];
  instagram_positions?: string[];
  targeting_automation?: unknown;
  flexible_spec?: Array<{ interests?: Array<{ name?: string }> }>;
  custom_audiences?: unknown[];
};

export type AdSetRow = {
  id: string;
  name: string;
  status: string;
  daily_budget: number | null;
  lifetime_budget: number | null;
  bid_strategy: string | null;
  targeting: Targeting | null;
  spend: number;
  impressions: number;
  reach: number;
  clicks: number;
  link_clicks: number;
  form_leads: number;
  messaging_started: number;
  sales: number;
  revenue: number;
  campaign_id: string | null;
};

// Orçamento do Meta vem em centavos (5000 = R$ 50,00). 0/null => sem orçamento
// no conjunto (provável CBO na campanha) => "—".
export function fmtBudget(cents: number | null): string {
  if (cents == null || cents === 0) return "—";
  return fmtBRL(cents / 100);
}

// Converte o targeting jsonb em chips legíveis + flag Advantage+.
export function summarizeTargeting(t: Targeting | null): {
  chips: string[];
  advantagePlus: boolean;
} {
  const chips: string[] = [];
  if (!t) return { chips, advantagePlus: false };

  // Idade
  if (t.age_min && t.age_max) chips.push(`${t.age_min}–${t.age_max} anos`);
  else if (t.age_min) chips.push(`${t.age_min}+ anos`);

  // Gênero (1 = homens, 2 = mulheres; ausente = todos)
  const g = t.genders;
  if (Array.isArray(g) && g.length === 1) {
    chips.push(g[0] === 1 ? "Homens" : g[0] === 2 ? "Mulheres" : "Todos os gêneros");
  } else {
    chips.push("Todos os gêneros");
  }

  // Localização
  const geo = t.geo_locations;
  if (geo) {
    const parts: string[] = [];
    if (Array.isArray(geo.countries) && geo.countries.length) {
      parts.push(geo.countries.map((c) => (c === "BR" ? "Brasil" : c)).join(", "));
    }
    const regions = Array.isArray(geo.regions)
      ? geo.regions.map((r) => r?.name).filter(Boolean)
      : [];
    const cities = Array.isArray(geo.cities) ? geo.cities.map((c) => c?.name).filter(Boolean) : [];
    if (regions.length) parts.push(regions.join(", "));
    if (cities.length) parts.push(cities.join(", "));
    if (parts.length) chips.push(parts.join(" · "));
  }

  // Plataformas
  if (Array.isArray(t.publisher_platforms) && t.publisher_platforms.length) {
    const map: Record<string, string> = {
      facebook: "Facebook",
      instagram: "Instagram",
      audience_network: "Audience Network",
      messenger: "Messenger",
      threads: "Threads",
    };
    chips.push(t.publisher_platforms.map((p) => map[p] ?? p).join(", "));
  }

  // Interesses (flexible_spec)
  const interests: string[] = [];
  if (Array.isArray(t.flexible_spec)) {
    for (const spec of t.flexible_spec) {
      if (spec && Array.isArray(spec.interests)) {
        for (const i of spec.interests) if (i?.name) interests.push(i.name);
      }
    }
  }
  if (interests.length) {
    chips.push(`Interesses: ${interests.slice(0, 4).join(", ")}${interests.length > 4 ? "…" : ""}`);
  }

  // Públicos personalizados
  if (Array.isArray(t.custom_audiences) && t.custom_audiences.length) {
    chips.push("Público personalizado");
  }

  return { chips, advantagePlus: t.targeting_automation != null };
}

// Effective status do Meta (ads/ad_sets) -> rótulo pt-BR + variante de badge.
export type BadgeVariant = "default" | "secondary" | "destructive" | "outline";
export function metaStatus(s: string): { label: string; variant: BadgeVariant } {
  switch ((s || "").toUpperCase()) {
    case "ACTIVE":
      return { label: "Ativo", variant: "default" };
    case "PAUSED":
      return { label: "Pausado", variant: "secondary" };
    case "ADSET_PAUSED":
      return { label: "Conjunto pausado", variant: "secondary" };
    case "CAMPAIGN_PAUSED":
      return { label: "Campanha pausada", variant: "secondary" };
    case "WITH_ISSUES":
      return { label: "Com problemas", variant: "destructive" };
    case "DISAPPROVED":
      return { label: "Reprovado", variant: "destructive" };
    case "PENDING_REVIEW":
      return { label: "Em revisão", variant: "outline" };
    case "ARCHIVED":
      return { label: "Arquivado", variant: "secondary" };
    default:
      return { label: s || "—", variant: "outline" };
  }
}
