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
