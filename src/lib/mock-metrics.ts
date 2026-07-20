// Deterministic mock generator so numbers are stable per company/day.
function hash(str: string) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return Math.abs(h);
}

function rand(seed: number) {
  const x = Math.sin(seed) * 10000;
  return x - Math.floor(x);
}

export type DashboardMetrics = {
  investment: number;
  impressions: number;
  reach: number;
  clicks: number;
  ctr: number;
  cpc: number;
  leads: number;
  cpl: number;
  sales: number;
  cpa: number;
  revenue: number;
  roas: number;
  frequency: number;
  conversionRate: number;
};

export function generateMetrics(companyId: string, days = 30): DashboardMetrics {
  const base = hash(companyId);
  const investment = Math.round(15000 + rand(base) * 40000);
  const impressions = Math.round(400000 + rand(base + 1) * 900000);
  const reach = Math.round(impressions * (0.55 + rand(base + 2) * 0.25));
  const clicks = Math.round(impressions * (0.008 + rand(base + 3) * 0.02));
  const leads = Math.round(clicks * (0.05 + rand(base + 4) * 0.08));
  const sales = Math.round(leads * (0.08 + rand(base + 5) * 0.12));
  const revenue = Math.round(sales * (180 + rand(base + 6) * 320));
  return {
    investment,
    impressions,
    reach,
    clicks,
    ctr: (clicks / impressions) * 100,
    cpc: investment / Math.max(clicks, 1),
    leads,
    cpl: investment / Math.max(leads, 1),
    sales,
    cpa: investment / Math.max(sales, 1),
    revenue,
    roas: revenue / Math.max(investment, 1),
    frequency: impressions / Math.max(reach, 1),
    conversionRate: (sales / Math.max(clicks, 1)) * 100,
  };
}

export function generateTimeSeries(companyId: string, days = 30) {
  const base = hash(companyId);
  return Array.from({ length: days }, (_, i) => {
    const d = new Date();
    d.setDate(d.getDate() - (days - 1 - i));
    const seed = base + i;
    const invest = 400 + rand(seed) * 1400;
    const revenue = invest * (1 + rand(seed + 100) * 3.5);
    return {
      date: d.toISOString().slice(5, 10),
      investment: Math.round(invest),
      revenue: Math.round(revenue),
    };
  });
}

export const fmtBRL = (n: number) =>
  n.toLocaleString("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 });
export const fmtInt = (n: number) => n.toLocaleString("pt-BR");
export const fmtPct = (n: number) => `${n.toFixed(2)}%`;
export const fmtDec = (n: number, d = 2) => n.toFixed(d);
