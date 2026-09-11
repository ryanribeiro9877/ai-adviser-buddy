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
