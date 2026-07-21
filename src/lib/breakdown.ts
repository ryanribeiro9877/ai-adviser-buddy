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
  leads: number;
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
  leads: number;
  sales: number;
  revenue: number;
  cpl: number | null;
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

export function resultForCampaign(c: CampaignRow): ResultMetric {
  switch (c.tipo) {
    case "trafego":
      return {
        label: "Cliques no link",
        value: fmtInt(c.link_clicks),
        costLabel: "CPC-link",
        costValue: c.link_clicks > 0 ? fmtBRL(num(c.cpc_link) || c.spend / c.link_clicks) : "—",
      };
    case "mensagem":
      return {
        label: "Conversas",
        value: fmtInt(c.messaging_started),
        costLabel: "Custo/conversa",
        costValue: c.messaging_started > 0 ? fmtBRL(c.spend / c.messaging_started) : "—",
      };
    case "leadgen":
      return {
        label: "Formulários",
        value: fmtInt(c.form_leads),
        costLabel: "CPL",
        costValue: c.form_leads > 0 ? fmtBRL(c.spend / c.form_leads) : "—",
      };
    case "vendas":
      return {
        label: "Vendas / Receita",
        value: `${fmtInt(c.sales)} · ${fmtBRL(c.revenue)}`,
        costLabel: c.revenue > 0 ? "ROAS" : "CPA",
        costValue:
          c.revenue > 0
            ? `${fmtDec(c.revenue / Math.max(c.spend, 1))}x`
            : c.sales > 0
              ? fmtBRL(c.spend / c.sales)
              : "—",
      };
    case "engajamento":
      return {
        label: "Interações",
        value: fmtInt(c.clicks),
        costLabel: "Impressões",
        costValue: fmtInt(c.impressions),
      };
    case "alcance":
      return {
        label: "Alcance",
        value: fmtInt(c.reach),
        costLabel: "CPM",
        costValue: c.impressions > 0 ? fmtBRL((c.spend / c.impressions) * 1000) : "—",
      };
    case "video":
      return { label: "Cliques", value: fmtInt(c.clicks), costLabel: null, costValue: null };
    case "app":
      return { label: "—", value: "—", costLabel: null, costValue: null };
    default:
      return {
        label: "Leads",
        value: fmtInt(c.leads),
        costLabel: "CPL",
        costValue: c.leads > 0 ? fmtBRL(c.spend / c.leads) : "—",
      };
  }
}

// --- Formatadores (pt-BR) ------------------------------------------------------

export const fmtBRL = (n: number) =>
  n.toLocaleString("pt-BR", {
    style: "currency",
    currency: "BRL",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
export const fmtInt = (n: number) => Math.round(n).toLocaleString("pt-BR");
export const fmtPct = (n: number) => `${n.toFixed(2)}%`;
export const fmtDec = (n: number, d = 2) => n.toFixed(d);

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
  leads: number;
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
  leads: number;
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
    const cities = Array.isArray(geo.cities)
      ? geo.cities.map((c) => c?.name).filter(Boolean)
      : [];
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
    chips.push(
      `Interesses: ${interests.slice(0, 4).join(", ")}${interests.length > 4 ? "…" : ""}`,
    );
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
