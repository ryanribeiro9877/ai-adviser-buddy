// Estado dos filtros globais (F0.1) — vive na URL (query params) para que a
// visão seja compartilhável e sobreviva ao reload. Nada de localStorage aqui.
//
// Campos do filtro: empresa · período · plataforma · status · tipo.
// - empresa: uuid da company (o seletor do header integra com este param).
// - período: preset + range resolvido dinamicamente (default "Todo o período").
// - plataforma: Meta Ads fixo hoje (dropdown preparado para o futuro).
// - status: active | paused (valores reais do banco).
// - tipo: categoria da campanha (leadgen | mensagem | trafego | engajamento | …).

import { format, startOfMonth, subDays } from "date-fns";
import type { TipoConta } from "@/lib/breakdown";

export type PeriodPreset = "all" | "7d" | "30d" | "month" | "custom";
export type FilterStatus = "all" | "active" | "paused";
export type FilterTipo = "all" | TipoConta;
export type FilterPlatform = "meta"; // única plataforma hoje

// Fallback do primeiro dia real de dados (usado se a consulta de min falhar).
export const MIN_DATE_FALLBACK = "2026-03-03";

// Formato de data usado na URL e nas queries ao Supabase (snapshot_date é date).
export type ISODate = string; // "yyyy-MM-dd"

export type FilterSearch = {
  company?: string;
  preset?: PeriodPreset;
  start?: ISODate;
  end?: ISODate;
  status?: FilterStatus;
  tipo?: FilterTipo;
  platform?: FilterPlatform;
};

// Estado normalizado (com defaults aplicados) que os componentes consomem.
export type GlobalFilterState = Required<Pick<FilterSearch, "preset" | "status" | "tipo" | "platform">> & {
  company?: string;
  start?: ISODate;
  end?: ISODate;
};

const PRESETS: PeriodPreset[] = ["all", "7d", "30d", "month", "custom"];
const STATUSES: FilterStatus[] = ["all", "active", "paused"];

export function todayISO(): ISODate {
  return format(new Date(), "yyyy-MM-dd");
}

// Aplica defaults ao que veio da URL.
export function withFilterDefaults(s: FilterSearch): GlobalFilterState {
  return {
    company: s.company,
    preset: s.preset ?? "all",
    start: s.start,
    end: s.end,
    status: s.status ?? "all",
    tipo: s.tipo ?? "all",
    platform: s.platform ?? "meta",
  };
}

// Resolve o range de datas concreto a partir do preset + min(snapshot_date).
// "all" (default) = do primeiro dia real de dados até hoje, calculado dinamicamente.
export function resolveRange(
  f: GlobalFilterState,
  minDate: ISODate,
): { start: ISODate; end: ISODate } {
  const today = todayISO();
  switch (f.preset) {
    case "7d":
      return { start: format(subDays(new Date(), 6), "yyyy-MM-dd"), end: today };
    case "30d":
      return { start: format(subDays(new Date(), 29), "yyyy-MM-dd"), end: today };
    case "month":
      return { start: format(startOfMonth(new Date()), "yyyy-MM-dd"), end: today };
    case "custom":
      return { start: f.start ?? minDate, end: f.end ?? today };
    case "all":
    default:
      return { start: minDate, end: today };
  }
}

// true quando algum filtro difere do padrão (para exibir "Limpar filtros").
export function hasActiveFilters(f: GlobalFilterState): boolean {
  return f.preset !== "all" || f.status !== "all" || f.tipo !== "all";
}

// true quando o período não é "Todo o período" (dispara o aviso nas telas
// acumuladas — Anúncios/Conjuntos).
export function isPeriodNarrowed(f: GlobalFilterState): boolean {
  return f.preset !== "all";
}

const isUuid = (v: unknown): v is string =>
  typeof v === "string" && /^[0-9a-f-]{36}$/i.test(v);

const isISODate = (v: unknown): v is ISODate =>
  typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v);

// Valida/normaliza os query params (usado no validateSearch de cada rota).
// Só devolve chaves definidas para manter a URL limpa.
export function validateFilterSearch(search: Record<string, unknown>): FilterSearch {
  const out: FilterSearch = {};
  if (isUuid(search.company)) out.company = search.company;
  if (PRESETS.includes(search.preset as PeriodPreset)) out.preset = search.preset as PeriodPreset;
  if (isISODate(search.start)) out.start = search.start;
  if (isISODate(search.end)) out.end = search.end;
  if (STATUSES.includes(search.status as FilterStatus)) out.status = search.status as FilterStatus;
  if (typeof search.tipo === "string") out.tipo = search.tipo as FilterTipo;
  if (search.platform === "meta") out.platform = "meta";
  return out;
}

// Remove chaves vazias/no-default antes de escrever na URL (URLs curtas).
export function cleanFilterSearch(s: FilterSearch): FilterSearch {
  const out: FilterSearch = {};
  if (s.company) out.company = s.company;
  if (s.preset && s.preset !== "all") out.preset = s.preset;
  if (s.preset === "custom" && s.start) out.start = s.start;
  if (s.preset === "custom" && s.end) out.end = s.end;
  if (s.status && s.status !== "all") out.status = s.status;
  if (s.tipo && s.tipo !== "all") out.tipo = s.tipo;
  // platform sempre "meta" hoje — não polui a URL.
  return out;
}

export const STATUS_LABEL: Record<FilterStatus, string> = {
  all: "Todos os status",
  active: "Ativas",
  paused: "Pausadas",
};

export const PRESET_LABEL: Record<PeriodPreset, string> = {
  all: "Todo o período",
  "7d": "Últimos 7 dias",
  "30d": "Últimos 30 dias",
  month: "Este mês",
  custom: "Personalizado",
};

// Casa o status bruto (Meta) contra o filtro active/paused.
// Campanhas usam "active"/"paused"; ads/ad_sets usam effective_status
// (ACTIVE, PAUSED, ADSET_PAUSED, CAMPAIGN_PAUSED, ARCHIVED, …).
export function matchesStatus(raw: string, filter: FilterStatus): boolean {
  if (filter === "all") return true;
  const active = (raw || "").toUpperCase() === "ACTIVE";
  return filter === "active" ? active : !active;
}
