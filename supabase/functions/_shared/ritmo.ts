/** Espelho de src/lib/ritmo.ts — Deno nao importa o frontend. */
/** Nucleo deterministico do Ritmo — envelope, sonho, portao e parse do plano. */

export const METRICAS_RITMO = [
  "conversas",
  "cliques_no_link",
  "formularios",
  "alcance",
  "impressoes",
  "ctr",
  "ctr_link",
] as const;

export type MetricaRitmo = (typeof METRICAS_RITMO)[number];

export const ACOES_PERMITIDAS_RITMO = [
  "pausar_criativo",
  "ativar_criativo",
  "escalar_criativo",
  "pausar_conjunto",
  "ativar_conjunto",
  "alterar_orcamento",
  "ajustar_posicionamentos_do_conjunto",
  "alterar_geo_do_conjunto",
  "vincular_instagram_dos_anuncios",
  "criar_conjunto_a_partir_de",
  "criar_anuncio_a_partir_de",
  "escalar_duplicar",
] as const;

export type AcaoRitmo = (typeof ACOES_PERMITIDAS_RITMO)[number];

export const ACOES_SIGNIFICATIVAS_RITMO = [
  "alterar_orcamento",
  "escalar_criativo",
  "criar_conjunto_a_partir_de",
  "criar_anuncio_a_partir_de",
  "escalar_duplicar",
  "alterar_geo_do_conjunto",
  "ajustar_posicionamentos_do_conjunto",
] as const;

export type AcaoSignificativaRitmo = (typeof ACOES_SIGNIFICATIVAS_RITMO)[number];

export type Horizontes = {
  d3: number | null;
  d7: number | null;
  d15: number | null;
  d30: number | null;
};

export type BaselineRitmo = {
  gasto_diario: number;
  janela: string;
  dias_usados: number;
  confianca: "alta" | "baixa";
};

export type AtoPlanoEntrada = {
  acao: string;
  alvo_external_id?: string;
  quando?: string;
};

export type AtoPlano = AtoPlanoEntrada & {
  executavel: boolean;
};

export type PlanoRitmo = {
  leitura?: Record<string, unknown>;
  baseline: BaselineRitmo;
  teto_janela: number;
  possibilidades: {
    nada_muda: Horizontes;
    plano: Horizontes;
    maximo_envelope: Horizontes;
  };
  sonho?: { valor: number | null; atingivel_no_prazo: boolean | null; nota: string | null };
  atos: AtoPlano[];
  recusas: string[];
  lacunas?: string[];
  premissas?: string[];
};

export type SerieDiaria = { date: string; spend: number };

export type DiaMetrica = {
  date: string;
  valor?: number;
  impressoes?: number;
  cliques?: number;
  cliques_link?: number;
};

export type MotivoParada = "prazo" | "sonho" | "teto" | "humano" | "trava" | null;

const RE_YMD = /^\d{4}-\d{2}-\d{2}$/;

function ymdValido(ymd: unknown): ymd is string {
  if (typeof ymd !== "string" || !RE_YMD.test(ymd)) return false;
  const [y, m, d] = ymd.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
}

function utcMs(ymd: string): number {
  const [y, m, d] = ymd.split("-").map(Number);
  return Date.UTC(y, m - 1, d);
}

function ymdDeMs(ms: number): string {
  const dt = new Date(ms);
  const y = dt.getUTCFullYear();
  const m = String(dt.getUTCMonth() + 1).padStart(2, "0");
  const d = String(dt.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function num(v: unknown): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function maxYmd(a: string, b: string): string {
  return utcMs(a) >= utcMs(b) ? a : b;
}

function ehAcaoPermitida(acao: unknown): acao is AcaoRitmo {
  return (
    typeof acao === "string" &&
    (ACOES_PERMITIDAS_RITMO as readonly string[]).includes(acao)
  );
}

function ehAcaoSignificativa(acao: unknown): acao is AcaoSignificativaRitmo {
  return (
    typeof acao === "string" &&
    (ACOES_SIGNIFICATIVAS_RITMO as readonly string[]).includes(acao)
  );
}

function ehAcaoSignificativaGasto(acao: string): boolean {
  if (acao === "alterar_orcamento") return true;
  if (acao.startsWith("escalar_")) return true;
  if (acao.startsWith("criar_")) return true;
  return false;
}

function baselineNeutro(): BaselineRitmo {
  return { gasto_diario: 0, janela: "7d_com_gasto", dias_usados: 0, confianca: "baixa" };
}

export function nDiasPrazo(inicio: unknown, fim: unknown): number {
  if (!ymdValido(inicio) || !ymdValido(fim)) return 0;
  const diff = (utcMs(fim) - utcMs(inicio)) / 864e5 + 1;
  if (!Number.isFinite(diff) || diff < 1) return diff < 1 && diff >= 0 ? 1 : 0;
  return Math.floor(diff);
}

export function calcularBaseline(
  series: unknown,
  periodoInicio: unknown,
  hojeAnalise: unknown,
): BaselineRitmo {
  try {
    if (!ymdValido(periodoInicio) || !ymdValido(hojeAnalise)) return baselineNeutro();
    if (!Array.isArray(series)) return baselineNeutro();

    const ancora =
      utcMs(String(hojeAnalise)) <= utcMs(String(periodoInicio))
        ? String(periodoInicio)
        : String(hojeAnalise);

    const ancoraMs = utcMs(ancora);
    const janelaInicioMs = ancoraMs - 7 * 864e5;
    const janelaFimMs = ancoraMs - 864e5;

    const porData = new Map<string, number>();
    for (const row of series) {
      if (!row || typeof row !== "object") continue;
      const r = row as Record<string, unknown>;
      const date = r.date;
      if (!ymdValido(date)) continue;
      porData.set(date, num(r.spend));
    }

    let soma = 0;
    let diasUsados = 0;
    for (let ms = janelaInicioMs; ms <= janelaFimMs; ms += 864e5) {
      const ymd = ymdDeMs(ms);
      const spend = porData.get(ymd) ?? 0;
      if (spend > 0) {
        soma += spend;
        diasUsados += 1;
      }
    }

    const gastoDiario = diasUsados > 0 ? soma / diasUsados : 0;
    return {
      gasto_diario: gastoDiario,
      janela: "7d_com_gasto",
      dias_usados: diasUsados,
      confianca: diasUsados >= 3 ? "alta" : "baixa",
    };
  } catch {
    return baselineNeutro();
  }
}

export function calcularTeto(baselineDiario: unknown, nDias: unknown, extra: unknown): number {
  const b = num(baselineDiario);
  const n = num(nDias);
  const e = num(extra);
  const teto = b * n + e;
  if (!Number.isFinite(teto) || teto < 0) return 0;
  return teto;
}

export function gastoNaJanela(series: unknown, inicio: unknown, fim: unknown): number {
  try {
    if (!ymdValido(inicio) || !ymdValido(fim)) return 0;
    if (!Array.isArray(series)) return 0;

    const iniMs = utcMs(inicio);
    const fimMs = utcMs(fim);
    let total = 0;

    for (const row of series) {
      if (!row || typeof row !== "object") continue;
      const r = row as Record<string, unknown>;
      const date = r.date;
      if (!ymdValido(date)) continue;
      const ms = utcMs(date);
      if (ms >= iniMs && ms <= fimMs) total += num(r.spend);
    }
    return total;
  } catch {
    return 0;
  }
}

export function ehMetricaVolume(metrica: unknown): boolean {
  if (typeof metrica !== "string") return false;
  return (
    metrica === "conversas" ||
    metrica === "cliques_no_link" ||
    metrica === "formularios" ||
    metrica === "alcance" ||
    metrica === "impressoes"
  );
}

export function unidadeSonho(metrica: unknown): "pct" | "qtd" {
  if (metrica === "ctr" || metrica === "ctr_link") return "pct";
  return "qtd";
}

const ROTULOS_METRICA: Record<MetricaRitmo, string> = {
  conversas: "Conversas",
  cliques_no_link: "Cliques no link",
  formularios: "Formulários",
  alcance: "Alcance",
  impressoes: "Impressões",
  ctr: "CTR",
  ctr_link: "CTR link",
};

export function rotuloMetrica(metrica: unknown): string {
  if (typeof metrica === "string" && metrica in ROTULOS_METRICA) {
    return ROTULOS_METRICA[metrica as MetricaRitmo];
  }
  return "";
}

export function sonhoAtingido(
  metrica: unknown,
  sonho: unknown,
  dias: unknown,
  periodoInicio: unknown,
  concessaoYmd: unknown,
): boolean {
  try {
    const meta = num(sonho);
    if (meta <= 0) return false;
    if (!ymdValido(periodoInicio) || !ymdValido(concessaoYmd)) return false;
    if (!Array.isArray(dias)) return false;

    const corte = maxYmd(String(periodoInicio), String(concessaoYmd));
    const corteMs = utcMs(corte);

    if (ehMetricaVolume(metrica)) {
      let acumulado = 0;
      for (const row of dias) {
        if (!row || typeof row !== "object") continue;
        const r = row as DiaMetrica;
        if (!ymdValido(r.date)) continue;
        if (utcMs(r.date) >= corteMs) acumulado += num(r.valor);
      }
      return acumulado >= meta;
    }

    if (metrica === "ctr" || metrica === "ctr_link") {
      const comEntrega: DiaMetrica[] = [];
      for (const row of dias) {
        if (!row || typeof row !== "object") continue;
        const r = row as DiaMetrica;
        if (!ymdValido(r.date)) continue;
        if (num(r.impressoes) > 0) comEntrega.push(r);
      }
      comEntrega.sort((a, b) => utcMs(a.date) - utcMs(b.date));
      const ultimos = comEntrega.slice(-3);
      if (ultimos.length < 3) return false;

      let totalImpressoes = 0;
      let totalCliques = 0;
      for (const d of ultimos) {
        totalImpressoes += num(d.impressoes);
        totalCliques +=
          metrica === "ctr_link" ? num(d.cliques_link) : num(d.cliques);
      }
      if (totalImpressoes <= 0) return false;
      const ctr = (100 * totalCliques) / totalImpressoes;
      return ctr >= meta;
    }

    return false;
  } catch {
    return false;
  }
}

export function motivoParada(ctx: {
  hojeYmd: unknown;
  periodoFim: unknown;
  gastoJanela: unknown;
  teto: unknown;
  sonhoBateu: unknown;
  encerrarHumano: unknown;
  masterLigado: unknown;
}): MotivoParada {
  try {
    if (ctx.encerrarHumano === true) return "humano";
    if (ctx.masterLigado === false) return "trava";
    if (ymdValido(ctx.hojeYmd) && ymdValido(ctx.periodoFim)) {
      if (utcMs(String(ctx.hojeYmd)) > utcMs(String(ctx.periodoFim))) return "prazo";
    }
    if (ctx.sonhoBateu === true) return "sonho";
    if (ctx.teto != null && Number.isFinite(Number(ctx.teto))) {
      const teto = num(ctx.teto);
      const gasto = num(ctx.gastoJanela);
      if (gasto >= teto) return "teto";
    }
    return null;
  } catch {
    return null;
  }
}

export function validarPedidoMissao(p: {
  campaignId: unknown;
  periodoInicio: unknown;
  periodoFim: unknown;
  metrica: unknown;
  dissertacao: unknown;
  sonho?: unknown;
  extra?: unknown;
}): { ok: boolean; motivo?: string } {
  try {
    const campaignId = String(p.campaignId ?? "").trim();
    if (!campaignId) return { ok: false, motivo: "campanha_obrigatoria" };

    const dissertacao = String(p.dissertacao ?? "").trim();
    if (!dissertacao) return { ok: false, motivo: "dissertacao_obrigatoria" };

    const metrica = String(p.metrica ?? "");
    if (!(METRICAS_RITMO as readonly string[]).includes(metrica)) {
      return { ok: false, motivo: "metrica_desconhecida" };
    }

    const nDias = nDiasPrazo(p.periodoInicio, p.periodoFim);
    if (nDias < 1 || nDias > 90) return { ok: false, motivo: "prazo_invalido" };

    if (p.sonho != null && p.sonho !== "") {
      const s = num(p.sonho);
      if (s <= 0) return { ok: false, motivo: "sonho_invalido" };
    }

    if (p.extra != null && p.extra !== "") {
      const e = num(p.extra);
      if (e < 0 || !Number.isFinite(e)) return { ok: false, motivo: "extra_invalido" };
    }

    return { ok: true };
  } catch {
    return { ok: false, motivo: "erro" };
  }
}

export function atosDoPrimeiroPasse(atos: unknown): AtoPlanoEntrada[] {
  try {
    if (!Array.isArray(atos)) return [];

    const imediatos = atos.filter(
      (a) => a && typeof a === "object" && (a as AtoPlanoEntrada).quando === "imediato",
    ) as AtoPlanoEntrada[];

    const out: AtoPlanoEntrada[] = [];
    for (const ato of imediatos) {
      out.push(ato);
      if (ehAcaoSignificativa(ato.acao)) break;
    }
    return out;
  } catch {
    return [];
  }
}

export function decidirPortaoAto(ctx: {
  status: unknown;
  companyIdMissao: unknown;
  companyIdAto: unknown;
  campaignIdMissao: unknown;
  campaignIdAto: unknown;
  hojeYmd: unknown;
  periodoInicio: unknown;
  periodoFim: unknown;
  gastoJanela: unknown;
  teto: unknown;
  masterLigado: unknown;
  concessaoEm: unknown;
  acao: unknown;
}): { ok: boolean; motivo?: string } {
  try {
    if (ctx.status !== "em_execucao") return { ok: false, motivo: "status" };
    if (!ctx.concessaoEm) return { ok: false, motivo: "sem_concessao" };
    if (String(ctx.companyIdMissao) !== String(ctx.companyIdAto)) {
      return { ok: false, motivo: "empresa" };
    }
    if (String(ctx.campaignIdMissao) !== String(ctx.campaignIdAto)) {
      return { ok: false, motivo: "campanha" };
    }
    if (ctx.masterLigado !== true) return { ok: false, motivo: "trava" };

    const acao = String(ctx.acao ?? "");
    if (!ehAcaoPermitida(acao)) return { ok: false, motivo: "acao" };

    if (
      !ymdValido(ctx.hojeYmd) ||
      !ymdValido(ctx.periodoInicio) ||
      !ymdValido(ctx.periodoFim)
    ) {
      return { ok: false, motivo: "prazo" };
    }
    const hojeMs = utcMs(String(ctx.hojeYmd));
    if (hojeMs < utcMs(String(ctx.periodoInicio)) || hojeMs > utcMs(String(ctx.periodoFim))) {
      return { ok: false, motivo: "prazo" };
    }

    if (ehAcaoSignificativaGasto(acao)) {
      const gasto = num(ctx.gastoJanela);
      const teto = num(ctx.teto);
      if (gasto >= teto) return { ok: false, motivo: "teto" };
    }

    return { ok: true };
  } catch {
    return { ok: false, motivo: "erro" };
  }
}

function atoExecutavel(
  ato: AtoPlanoEntrada,
  recusas: string[],
): boolean {
  const id = String(ato.alvo_external_id ?? "").trim();
  if (!id) return false;
  if (!ehAcaoPermitida(ato.acao)) return false;
  if (String(ato.acao).startsWith("criar_") && recusas.length > 0) return false;
  return true;
}

export function parsePlanoRitmo(raw: unknown): PlanoRitmo | null {
  try {
    if (!raw || typeof raw !== "object") return null;
    const p = raw as Record<string, unknown>;

    const baselineRaw = p.baseline;
    if (!baselineRaw || typeof baselineRaw !== "object") return null;

    const possRaw = p.possibilidades;
    if (!possRaw || typeof possRaw !== "object") return null;

    const recusas = Array.isArray(p.recusas)
      ? p.recusas.filter((r): r is string => typeof r === "string")
      : [];

    const atosRaw = Array.isArray(p.atos) ? p.atos : [];
    const atos: AtoPlano[] = atosRaw
      .filter((a): a is AtoPlanoEntrada => !!a && typeof a === "object")
      .map((a) => ({
        ...a,
        executavel: atoExecutavel(a, recusas),
      }));

    const br = baselineRaw as Record<string, unknown>;
    const baseline: BaselineRitmo = {
      gasto_diario: num(br.gasto_diario),
      janela: String(br.janela ?? "7d_com_gasto"),
      dias_usados: num(br.dias_usados),
      confianca: br.confianca === "alta" ? "alta" : "baixa",
    };

    const poss = possRaw as Record<string, unknown>;
    const lerHorizontes = (h: unknown): Horizontes => {
      if (!h || typeof h !== "object") {
        return { d3: null, d7: null, d15: null, d30: null };
      }
      const o = h as Record<string, unknown>;
      return {
        d3: o.d3 == null ? null : num(o.d3),
        d7: o.d7 == null ? null : num(o.d7),
        d15: o.d15 == null ? null : num(o.d15),
        d30: o.d30 == null ? null : num(o.d30),
      };
    };

    return {
      leitura:
        p.leitura && typeof p.leitura === "object"
          ? (p.leitura as Record<string, unknown>)
          : undefined,
      baseline,
      teto_janela: num(p.teto_janela),
      possibilidades: {
        nada_muda: lerHorizontes(poss.nada_muda),
        plano: lerHorizontes(poss.plano),
        maximo_envelope: lerHorizontes(poss.maximo_envelope),
      },
      sonho:
        p.sonho && typeof p.sonho === "object"
          ? (p.sonho as PlanoRitmo["sonho"])
          : undefined,
      atos,
      recusas,
      lacunas: Array.isArray(p.lacunas)
        ? p.lacunas.filter((l): l is string => typeof l === "string")
        : undefined,
      premissas: Array.isArray(p.premissas)
        ? p.premissas.filter((x): x is string => typeof x === "string")
        : undefined,
    };
  } catch {
    return null;
  }
}

export function extrairJsonRitmo(texto: unknown): unknown | null {
  try {
    if (typeof texto !== "string") return null;
    const ini = texto.indexOf("{");
    const fim = texto.lastIndexOf("}");
    if (ini < 0 || fim < 0 || fim <= ini) return null;
    return JSON.parse(texto.slice(ini, fim + 1));
  } catch {
    return null;
  }
}

/** Dias civis inclusive; vazio se as datas não forem YMD válidas ou se o fim vier antes. */
export function datasCivisInclusive(inicio: unknown, fim: unknown): string[] {
  if (!ymdValido(inicio) || !ymdValido(fim)) return [];
  if (utcMs(inicio) > utcMs(fim)) return [];
  const out: string[] = [];
  for (let ms = utcMs(inicio); ms <= utcMs(fim); ms += 864e5) {
    out.push(ymdDeMs(ms));
  }
  return out;
}

const ROTULOS_ACAO_RITMO: Record<string, string> = {
  pausar_criativo: "Pausar anúncio",
  ativar_criativo: "Ativar anúncio",
  escalar_criativo: "Escalar anúncio",
  pausar_conjunto: "Pausar conjunto",
  ativar_conjunto: "Ativar conjunto",
  alterar_orcamento: "Alterar orçamento",
  ajustar_posicionamentos_do_conjunto: "Ajustar posicionamentos",
  alterar_geo_do_conjunto: "Alterar geo",
  alterar_publico_do_conjunto: "Alterar público",
  vincular_instagram_dos_anuncios: "Vincular Instagram",
  criar_conjunto_a_partir_de: "Criar conjunto",
  criar_anuncio_a_partir_de: "Criar anúncio",
  escalar_duplicar: "Duplicar para escala",
  verificar_parada: "Checagem de parada",
};

export function rotuloAcaoRitmo(acao: unknown): string {
  if (typeof acao !== "string") return "";
  const t = acao.trim();
  if (!t) return "";
  return ROTULOS_ACAO_RITMO[t] ?? t.replaceAll("_", " ");
}

export type SnapAndamento = {
  date: string;
  spend: number;
  impressions: number;
  reach: number | null;
  clicks: number;
  link_clicks: number;
  form_leads: number;
  messaging_started: number;
};

export type AtoAndamento = {
  data: string;
  acao: string;
  alvo_external_id?: string | null;
  resultado?: string | null;
  tique?: string | null;
  evidencia?: string | null;
  replano?: boolean;
};

export type DiaAndamento = {
  data: string;
  gasto: number;
  metrica_valor: number | null;
  impressoes: number;
  cliques: number;
  cliques_link: number;
  conversas: number;
  formularios: number;
  alcance: number | null;
  custo: number | null;
  tem_coleta: boolean;
  atos: AtoAndamento[];
  vs_gasto: number | null;
  vs_metrica: number | null;
  acumulado_gasto: number;
  acumulado_metrica: number | null;
  fechado: boolean;
  lacunas: string[];
  narrativa: string;
};

export type AndamentoRitmo = {
  metrica: string;
  rotulo_metrica: string;
  dias: DiaAndamento[];
  gasto_janela: number;
  metrica_janela: number | null;
  sonho: number | null;
  teto: number | null;
};

function ymdDeCampo(v: unknown): string {
  return String(v ?? "").slice(0, 10);
}

function fmtYmdBr(ymd: string): string {
  if (!ymdValido(ymd)) return ymd;
  return `${ymd.slice(8, 10)}/${ymd.slice(5, 7)}/${ymd.slice(0, 4)}`;
}

function fmtReaisRitmo(n: number): string {
  const sinal = n < 0 ? "−" : "";
  const arred = Math.round(Math.abs(n) * 100) / 100;
  const [int, dec] = arred.toFixed(2).split(".");
  const milhar = int.replace(/\B(?=(\d{3})+(?!\d))/g, ".");
  return `${sinal}R$ ${milhar},${dec}`;
}

function fmtNumeroRitmo(n: number, metrica: string): string {
  if (metrica === "ctr" || metrica === "ctr_link") {
    return `${(Math.round(n * 100) / 100).toFixed(2)}%`;
  }
  if (Number.isInteger(n)) return String(n);
  return String(Math.round(n * 100) / 100);
}

function rotuloResultadoAto(r: unknown): string {
  if (r === "ok") return "ok";
  if (r === "simulado") return "simulado";
  if (r === "falhou") return "falhou";
  if (r === "bloqueado") return "bloqueado";
  if (r === "pendente" || r === "executando") return String(r);
  return typeof r === "string" && r.trim() ? r.trim() : "sem resultado";
}

function lerSnapAndamento(v: unknown): SnapAndamento | null {
  if (!v || typeof v !== "object") return null;
  const o = v as Record<string, unknown>;
  const date = ymdDeCampo(o.date ?? o.snapshot_date);
  if (!ymdValido(date)) return null;
  const reachRaw = o.reach;
  return {
    date,
    spend: num(o.spend),
    impressions: num(o.impressions),
    reach: reachRaw == null || reachRaw === "" ? null : num(reachRaw),
    clicks: num(o.clicks),
    link_clicks: num(o.link_clicks),
    form_leads: num(o.form_leads),
    messaging_started: num(o.messaging_started),
  };
}

function somarSnap(a: SnapAndamento, b: SnapAndamento): SnapAndamento {
  return {
    date: a.date,
    spend: a.spend + b.spend,
    impressions: a.impressions + b.impressions,
    reach: a.reach == null && b.reach == null ? null : num(a.reach) + num(b.reach),
    clicks: a.clicks + b.clicks,
    link_clicks: a.link_clicks + b.link_clicks,
    form_leads: a.form_leads + b.form_leads,
    messaging_started: a.messaging_started + b.messaging_started,
  };
}

function valorMetricaNoSnap(metrica: string, s: SnapAndamento): number | null {
  if (metrica === "conversas") return s.messaging_started;
  if (metrica === "cliques_no_link") return s.link_clicks;
  if (metrica === "formularios") return s.form_leads;
  if (metrica === "impressoes") return s.impressions;
  if (metrica === "alcance") return s.reach;
  if (metrica === "ctr") return s.impressions > 0 ? (100 * s.clicks) / s.impressions : null;
  if (metrica === "ctr_link") {
    return s.impressions > 0 ? (100 * s.link_clicks) / s.impressions : null;
  }
  return null;
}

function custoDoDia(metrica: string, gasto: number, valor: number | null): number | null {
  if (!ehMetricaVolume(metrica)) return null;
  if (valor == null || valor <= 0 || gasto <= 0) return null;
  return gasto / valor;
}

function lerAtoAndamento(v: unknown): AtoAndamento | null {
  if (!v || typeof v !== "object") return null;
  const o = v as Record<string, unknown>;
  const data = ymdDeCampo(o.data);
  const acao = typeof o.acao === "string" ? o.acao.trim() : "";
  if (!ymdValido(data) || !acao) return null;
  return {
    data,
    acao,
    alvo_external_id: typeof o.alvo_external_id === "string" ? o.alvo_external_id : null,
    resultado: typeof o.resultado === "string" ? o.resultado : null,
    tique: typeof o.tique === "string" ? o.tique : null,
    evidencia: typeof o.evidencia === "string" ? o.evidencia : null,
    replano: o.replano === true,
  };
}

function fraseAgentes(atos: AtoAndamento[]): string {
  if (atos.length === 0) {
    return "Os agentes neste dia não escreveram na Meta.";
  }
  const partes = atos.map((a) => {
    const alvo = a.alvo_external_id ? ` ${a.alvo_external_id}` : "";
    return `${rotuloAcaoRitmo(a.acao).toLowerCase()}${alvo} (${rotuloResultadoAto(a.resultado)})`;
  });
  if (partes.length === 1) return `Os agentes neste dia: ${partes[0]}.`;
  return `Os agentes neste dia: ${partes.join("; ")}.`;
}

function fraseContraste(
  metrica: string,
  rotulo: string,
  vsGasto: number | null,
  vsMetrica: number | null,
): string {
  if (vsGasto == null && vsMetrica == null) {
    return "Primeiro dia da janela, sem contraste.";
  }
  const bits: string[] = [];
  if (vsGasto != null) {
    const dir = vsGasto > 0 ? "mais" : vsGasto < 0 ? "menos" : "igual";
    bits.push(
      dir === "igual" ? "gasto igual ao dia anterior" : `gasto ${fmtReaisRitmo(vsGasto)} (${dir})`,
    );
  }
  if (vsMetrica != null) {
    const dir = vsMetrica > 0 ? "mais" : vsMetrica < 0 ? "menos" : "igual";
    const n = fmtNumeroRitmo(Math.abs(vsMetrica), metrica);
    bits.push(
      dir === "igual" ? `${rotulo.toLowerCase()} igual ao dia anterior` : `${rotulo.toLowerCase()} ${dir} ${n}`,
    );
  }
  return `Contra o dia anterior: ${bits.join("; ")}.`;
}

function narrativaDoDia(opts: {
  dia: Omit<DiaAndamento, "narrativa">;
  metrica: string;
  rotulo: string;
  sonho: number | null;
  teto: number | null;
}): string {
  const { dia, metrica, rotulo, sonho, teto } = opts;
  const cabeca = dia.fechado
    ? `${fmtYmdBr(dia.data)} — fechamento das 18:30.`
    : `${fmtYmdBr(dia.data)} — andamento até agora (o fechamento sai às 18:30).`;
  const linhas: string[] = [cabeca, ""];
  if (!dia.tem_coleta) {
    linhas.push(
      "Campanha neste dia: sem linha de coleta — números do dia não medidos, não zerados.",
    );
  } else {
    const valorTxt =
      dia.metrica_valor == null
        ? `${rotulo.toLowerCase()} não medido`
        : `${fmtNumeroRitmo(dia.metrica_valor, metrica)} ${rotulo.toLowerCase()}`;
    const custoTxt =
      dia.custo != null ? ` (${fmtReaisRitmo(dia.custo)} por ${rotulo.toLowerCase().replace(/s$/, "")})` : "";
    linhas.push(`A campanha gastou ${fmtReaisRitmo(dia.gasto)} e gerou ${valorTxt}${custoTxt}.`);
    linhas.push(fraseContraste(metrica, rotulo, dia.vs_gasto, dia.vs_metrica));
  }
  const acumM =
    dia.acumulado_metrica == null
      ? `${rotulo.toLowerCase()} não medido`
      : `${fmtNumeroRitmo(dia.acumulado_metrica, metrica)} ${rotulo.toLowerCase()}`;
  const sonhoTxt = sonho != null && sonho > 0 ? ` (sonho ${fmtNumeroRitmo(sonho, metrica)})` : "";
  const tetoTxt = teto != null ? ` de um teto de ${fmtReaisRitmo(teto)}` : "";
  linhas.push(
    `No prazo da força-tarefa: ${acumM}${sonhoTxt}; gasto ${fmtReaisRitmo(dia.acumulado_gasto)}${tetoTxt}.`,
  );
  linhas.push("");
  linhas.push(fraseAgentes(dia.atos));
  if (dia.lacunas.length > 0) {
    linhas.push("");
    linhas.push(`Lacuna: ${dia.lacunas.join(" ")}`);
  }
  return linhas.join("\n");
}

/**
 * Série diária da missão: um dia civil de Brasília por linha, com o que a
 * campanha apresentou e o que os agentes tentaram. `fechado` no dia de hoje
 * só é verdadeiro quando o fechamento das 18:30 já rodou (`entrada.fechado`).
 */
export function montarAndamentoRitmo(entrada: unknown): AndamentoRitmo | null {
  if (!entrada || typeof entrada !== "object" || Array.isArray(entrada)) return null;
  const o = entrada as Record<string, unknown>;
  const metrica = typeof o.metrica === "string" ? o.metrica : "";
  if (!METRICAS_RITMO.includes(metrica as MetricaRitmo)) return null;
  const periodoInicio = ymdDeCampo(o.periodo_inicio);
  const periodoFim = ymdDeCampo(o.periodo_fim);
  const corte = ymdDeCampo(o.corte ?? o.periodo_inicio);
  const hoje = ymdDeCampo(o.hoje);
  if (!ymdValido(periodoInicio) || !ymdValido(periodoFim) || !ymdValido(corte) || !ymdValido(hoje)) {
    return null;
  }
  const inicio = corte < periodoInicio ? periodoInicio : corte;
  const fim = hoje < periodoFim ? hoje : periodoFim;
  const datas = datasCivisInclusive(inicio, fim);
  const porData = new Map<string, SnapAndamento>();
  if (Array.isArray(o.snaps)) {
    for (const raw of o.snaps) {
      const s = lerSnapAndamento(raw);
      if (!s) continue;
      const prev = porData.get(s.date);
      porData.set(s.date, prev ? somarSnap(prev, s) : s);
    }
  }
  const atosPorData = new Map<string, AtoAndamento[]>();
  if (Array.isArray(o.atos)) {
    for (const raw of o.atos) {
      const a = lerAtoAndamento(raw);
      if (!a) continue;
      const lista = atosPorData.get(a.data) ?? [];
      lista.push(a);
      atosPorData.set(a.data, lista);
    }
  }
  const sonho = o.sonho == null || o.sonho === "" ? null : num(o.sonho);
  const teto = o.teto == null || o.teto === "" ? null : num(o.teto);
  const fechadoHoje = o.fechado === true;
  const rotulo = rotuloMetrica(metrica) || metrica;
  const volume = ehMetricaVolume(metrica);

  let accGasto = 0;
  let accImp = 0;
  let accCliques = 0;
  let accLink = 0;
  let accConv = 0;
  let accForm = 0;
  let accReach = 0;
  let temReach = false;
  let accVolume = 0;
  let temColetaJanela = false;
  const dias: DiaAndamento[] = [];

  for (let i = 0; i < datas.length; i++) {
    const data = datas[i];
    const snap = porData.get(data) ?? null;
    const tem_coleta = snap != null;
    const gasto = snap ? snap.spend : 0;
    const impressoes = snap ? snap.impressions : 0;
    const cliques = snap ? snap.clicks : 0;
    const cliques_link = snap ? snap.link_clicks : 0;
    const conversas = snap ? snap.messaging_started : 0;
    const formularios = snap ? snap.form_leads : 0;
    const alcance = snap ? snap.reach : null;
    const metrica_valor = snap ? valorMetricaNoSnap(metrica, snap) : null;
    if (tem_coleta) {
      temColetaJanela = true;
      accGasto += gasto;
      accImp += impressoes;
      accCliques += cliques;
      accLink += cliques_link;
      accConv += conversas;
      accForm += formularios;
      if (alcance != null) {
        accReach += alcance;
        temReach = true;
      }
      if (volume && metrica_valor != null) accVolume += metrica_valor;
    }
    let acumulado_metrica: number | null = null;
    if (temColetaJanela) {
      if (metrica === "ctr") acumulado_metrica = accImp > 0 ? (100 * accCliques) / accImp : null;
      else if (metrica === "ctr_link") {
        acumulado_metrica = accImp > 0 ? (100 * accLink) / accImp : null;
      } else if (metrica === "alcance") acumulado_metrica = temReach ? accReach : null;
      else if (metrica === "conversas") acumulado_metrica = accConv;
      else if (metrica === "cliques_no_link") acumulado_metrica = accLink;
      else if (metrica === "formularios") acumulado_metrica = accForm;
      else if (metrica === "impressoes") acumulado_metrica = accImp;
      else acumulado_metrica = accVolume;
    }
    const prev = i > 0 ? dias[i - 1] : null;
    const vs_gasto = prev && prev.tem_coleta && tem_coleta ? gasto - prev.gasto : null;
    const vs_metrica =
      prev && prev.metrica_valor != null && metrica_valor != null
        ? metrica_valor - prev.metrica_valor
        : null;
    const lacunas: string[] = [];
    if (!tem_coleta) {
      lacunas.push("Sem linha de coleta neste dia civil.");
    }
    const fechado = data < hoje || (data === hoje && fechadoHoje);
    const atoDia = atosPorData.get(data) ?? [];
    const bruto: Omit<DiaAndamento, "narrativa"> = {
      data,
      gasto,
      metrica_valor,
      impressoes,
      cliques,
      cliques_link,
      conversas,
      formularios,
      alcance,
      custo: custoDoDia(metrica, gasto, metrica_valor),
      tem_coleta,
      atos: atoDia,
      vs_gasto,
      vs_metrica,
      acumulado_gasto: accGasto,
      acumulado_metrica,
      fechado,
      lacunas,
    };
    dias.push({
      ...bruto,
      narrativa: narrativaDoDia({ dia: bruto, metrica, rotulo, sonho, teto }),
    });
  }

  let metrica_janela: number | null = null;
  if (temColetaJanela) {
    if (metrica === "ctr") metrica_janela = accImp > 0 ? (100 * accCliques) / accImp : null;
    else if (metrica === "ctr_link") metrica_janela = accImp > 0 ? (100 * accLink) / accImp : null;
    else if (metrica === "alcance") metrica_janela = temReach ? accReach : null;
    else if (metrica === "conversas") metrica_janela = accConv;
    else if (metrica === "cliques_no_link") metrica_janela = accLink;
    else if (metrica === "formularios") metrica_janela = accForm;
    else if (metrica === "impressoes") metrica_janela = accImp;
    else metrica_janela = accVolume;
  }

  return {
    metrica,
    rotulo_metrica: rotulo,
    dias,
    gasto_janela: accGasto,
    metrica_janela,
    sonho: sonho != null && sonho > 0 ? sonho : null,
    teto: teto != null && Number.isFinite(teto) ? teto : null,
  };
}
