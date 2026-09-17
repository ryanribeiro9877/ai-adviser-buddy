/** Relatórios autônomos: catálogo, horário em Brasília, merge ao vivo × espelho. */

export const TZ_BRASIL = "America/Sao_Paulo";

export type FrequenciaRelatorio = "diaria" | "dias_uteis" | "semanal" | "cada_n_horas";
export type RecorteCampanhas = "todas_ativas" | "ids_fixos";
export type JanelaAnalise = "ontem" | "3d" | "7d" | "14d";
export type FonteCampanhas = "ao_vivo" | "espelho";
export type StatusRelatorioGerado = "queued" | "running" | "done" | "error";

export type TipoAchado =
  | "teto"
  | "custo_elevado"
  | "monitoramento_reforcado"
  | "fadiga"
  | "escala"
  | "pausa_com_guarda"
  | "hipotese";

export type ChaveSecaoRelatorio =
  | "resumo_executivo"
  | "status_entrega"
  | "investimento_pacing"
  | "custo_vs_teto"
  | "funil_midia"
  | "por_campanha"
  | "por_conjunto"
  | "criativos_ranking"
  | "conjuntos_ranking"
  | "fadiga"
  | "diagnostico_custo"
  | "escala"
  | "alertas"
  | "recomendacoes"
  | "compliance"
  | "comparativo"
  | "whatsapp"
  | "cobertura"
  | "opiniaoes";

export type SecaoRelatorio = {
  chave: ChaveSecaoRelatorio;
  titulo: string;
  descricao: string;
  especialistas: string[];
};

export const SECOES_RELATORIO: readonly SecaoRelatorio[] = [
  {
    chave: "resumo_executivo",
    titulo: "Resumo executivo",
    descricao: "Três achados, nível (conta/campanha/conjunto/anúncio) e janela de atribuição.",
    especialistas: ["desempenho_campanhas", "conhecimento"],
  },
  {
    chave: "status_entrega",
    titulo: "Status real e entrega",
    descricao: "effective_status, saldo, rejeição — não o status espelhado.",
    especialistas: ["desempenho_campanhas", "estrutura_conta"],
  },
  {
    chave: "investimento_pacing",
    titulo: "Investimento e pacing",
    descricao: "Gasto versus teto diário e ritmo de entrega.",
    especialistas: ["desempenho_campanhas"],
  },
  {
    chave: "custo_vs_teto",
    titulo: "Custo versus teto vigente",
    descricao: "Custo na base da campanha (formulário, conversa ou clique), com o teto que governa.",
    especialistas: ["desempenho_campanhas"],
  },
  {
    chave: "funil_midia",
    titulo: "Funil de mídia",
    descricao: "Impressão → clique (qualificado) → resultado. Sem misturar bases.",
    especialistas: ["desempenho_campanhas"],
  },
  {
    chave: "por_campanha",
    titulo: "Quebra por campanha",
    descricao: "Desempenho de cada campanha do recorte, na janela pedida.",
    especialistas: ["desempenho_campanhas"],
  },
  {
    chave: "por_conjunto",
    titulo: "Conjuntos e estrutura",
    descricao: "CBO/ABO, learning, orçamento. Avaliar no nível certo.",
    especialistas: ["estrutura_conta", "desempenho_campanhas"],
  },
  {
    chave: "criativos_ranking",
    titulo: "Ranking de criativos",
    descricao: "Anúncios por gasto, CTR e resultado. Conteúdo real das peças.",
    especialistas: ["criativos"],
  },
  {
    chave: "conjuntos_ranking",
    titulo: "Ranking de conjuntos",
    descricao: "Todos os conjuntos do recorte, do melhor para o pior, na janela. Sem cortar a lista.",
    especialistas: ["desempenho_campanhas", "estrutura_conta"],
  },
  {
    chave: "fadiga",
    titulo: "Fadiga de criativo",
    descricao: "Frequência alta e queda de CTR no criativo.",
    especialistas: ["criativos", "desempenho_campanhas"],
  },
  {
    chave: "diagnostico_custo",
    titulo: "Diagnóstico de custo",
    descricao: "Fadiga versus leilão caro versus problema depois do clique.",
    especialistas: ["desempenho_campanhas"],
  },
  {
    chave: "escala",
    titulo: "Escala",
    descricao: "Elegível só com custo até 80% do teto e amostra suficiente.",
    especialistas: ["desempenho_campanhas"],
  },
  {
    chave: "alertas",
    titulo: "Alertas ativos",
    descricao: "Fila de alertas da casa no recorte.",
    especialistas: ["alertas_recomendacoes"],
  },
  {
    chave: "recomendacoes",
    titulo: "Recomendações e dicas Meta",
    descricao: "Fila interna da régua da casa e Opportunity Score da Meta.",
    especialistas: ["alertas_recomendacoes"],
  },
  {
    chave: "compliance",
    titulo: "Compliance",
    descricao: "Só se esta empresa for de crédito. Sem CREDIT em quem não é.",
    especialistas: ["compliance"],
  },
  {
    chave: "comparativo",
    titulo: "Comparativo com a janela anterior",
    descricao: "Mesma métrica, janela anterior da mesma duração. Sem misturar atribuição.",
    especialistas: ["desempenho_campanhas"],
  },
  {
    chave: "whatsapp",
    titulo: "WhatsApp / WABA",
    descricao: "Números, tier e destino CTWA — só se a empresa usa o canal.",
    especialistas: ["whatsapp_waba"],
  },
  {
    chave: "cobertura",
    titulo: "Cobertura e lacunas",
    descricao: "O que não foi medido, sync atrasado, amostra pequena.",
    especialistas: ["desempenho_campanhas", "conhecimento"],
  },
  {
    chave: "opiniaoes",
    titulo: "Opiniões com evidência e reversa",
    descricao: "Palpite só com número, mecanismo, métrica de sucesso, janela e como desfazer.",
    especialistas: ["desempenho_campanhas", "conhecimento"],
  },
];

export const CHAVES_SECAO_RELATORIO: readonly ChaveSecaoRelatorio[] = SECOES_RELATORIO.map(
  (s) => s.chave,
);

const CHAVE_SET = new Set<string>(CHAVES_SECAO_RELATORIO);

export function secoesRelatorioPadrao(): ChaveSecaoRelatorio[] {
  return CHAVES_SECAO_RELATORIO.slice();
}

export function validarSecoesRelatorio(
  secoes: string[],
): { ok: true; secoes: ChaveSecaoRelatorio[] } | { ok: false; invalidas: string[] } {
  if (!Array.isArray(secoes) || secoes.length === 0) {
    return { ok: false, invalidas: ["(vazio)"] };
  }
  const invalidas = secoes.filter((s) => !CHAVE_SET.has(s));
  if (invalidas.length) return { ok: false, invalidas };
  const vistas = new Set<ChaveSecaoRelatorio>();
  const out: ChaveSecaoRelatorio[] = [];
  for (const s of secoes) {
    const k = s as ChaveSecaoRelatorio;
    if (vistas.has(k)) continue;
    vistas.add(k);
    out.push(k);
  }
  return { ok: true, secoes: out };
}

export function especialistasPorSecoes(secoes: string[]): string[] {
  const v = validarSecoesRelatorio(secoes);
  const chaves = v.ok ? v.secoes : [];
  const set = new Set<string>();
  for (const s of SECOES_RELATORIO) {
    if (!chaves.includes(s.chave)) continue;
    for (const e of s.especialistas) set.add(e);
  }
  if (chaves.length && !set.has("desempenho_campanhas")) set.add("desempenho_campanhas");
  return [...set];
}

const TITULO_POR_CHAVE = new Map(SECOES_RELATORIO.map((s) => [s.chave, s.titulo] as const));

export function tituloDaSecaoRelatorio(chave: string): string {
  return TITULO_POR_CHAVE.get(chave as ChaveSecaoRelatorio) ?? String(chave ?? "");
}

export function titulosDasSecoes(secoes: string[]): string[] {
  if (!Array.isArray(secoes)) return [];
  return secoes.map((k) => tituloDaSecaoRelatorio(String(k)));
}

export function humanizarMarkdownRelatorio(md: string): string {
  let texto = String(md ?? "");
  if (!texto) return texto;
  const t = texto.trim();
  if (t.startsWith("{") && /"(?:corpo_md|narrativa)"\s*:/.test(t)) {
    const rec = extrairJsonRelatorio(t);
    if (rec.corpo_md.trim() && rec.corpo_md.trim() !== t) texto = rec.corpo_md;
  }
  let out = texto;
  for (const s of SECOES_RELATORIO) {
    const re = new RegExp(`^(#{1,4}[ \\t]*)${s.chave}\\s*$`, "gmi");
    out = out.replace(re, `$1${s.titulo}`);
  }
  return out;
}

export type CampanhaRelatorio = {
  external_id: string;
  nome: string;
  status: string;
  objective: string | null;
  tipo: string | null;
  gasto: number;
  last_synced_at: string | null;
  fonte: FonteCampanhas;
};

export type CampanhaAoVivoBruta = {
  id?: unknown;
  campaign_id?: unknown;
  name?: unknown;
  nome?: unknown;
  status?: unknown;
  effective_status?: unknown;
  objective?: unknown;
  objetivo?: unknown;
};

export function campanhaEstaAtiva(status: string): boolean {
  const s = String(status ?? "")
    .trim()
    .toLowerCase();
  return s === "active" || s === "ativa";
}

/**
 * Cascas que a Graph/Pipeboard lista como ACTIVE em toda ad account (Advantage / MM Lite)
 * e que não são linha de mídia da casa. "Todas as ativas" não pode misturá-las com postagens
 * que realmente entregam.
 */
export function campanhaEhCascaMeta(nome: string): boolean {
  const n = String(nome ?? "")
    .trim()
    .toLowerCase();
  if (!n) return false;
  if (n === "traffic campaign" || n === "sales campaign") return true;
  if (n === "mm_lite_default_ad_campaign_group") return true;
  return false;
}

export function filtrarCampanhasAtivasDoRecorte(campanhas: CampanhaRelatorio[]): {
  escolhidas: CampanhaRelatorio[];
  cascas: number;
} {
  if (!Array.isArray(campanhas)) return { escolhidas: [], cascas: 0 };
  const ativas = campanhas.filter((c) => campanhaEstaAtiva(String(c?.status ?? "")));
  const escolhidas = ativas.filter((c) => !campanhaEhCascaMeta(String(c?.nome ?? "")));
  return { escolhidas, cascas: ativas.length - escolhidas.length };
}

export function ordenarCampanhasRelatorioPorGasto(
  campanhas: CampanhaRelatorio[],
  gastoPorId?: unknown,
): CampanhaRelatorio[] {
  const lista = Array.isArray(campanhas) ? campanhas.slice() : [];
  const extra = (id: string, fallback: number): number => {
    if (gastoPorId instanceof Map) {
      const v = gastoPorId.get(id);
      return typeof v === "number" && Number.isFinite(v) ? v : fallback;
    }
    if (gastoPorId && typeof gastoPorId === "object" && !Array.isArray(gastoPorId)) {
      const v = (gastoPorId as Record<string, unknown>)[id];
      return typeof v === "number" && Number.isFinite(v) ? v : fallback;
    }
    return fallback;
  };
  lista.sort((a, b) => {
    const ga = extra(String(a?.external_id ?? ""), Number(a?.gasto ?? 0) || 0);
    const gb = extra(String(b?.external_id ?? ""), Number(b?.gasto ?? 0) || 0);
    if (gb !== ga) return gb - ga;
    return String(a?.nome ?? "").localeCompare(String(b?.nome ?? ""), "pt-BR");
  });
  return lista;
}

export function rotuloStatusCampanha(status: string): string {
  const k = String(status ?? "")
    .trim()
    .toLowerCase();
  if (k === "active" || k === "ativa") return "Ativa";
  if (k === "paused" || k === "pausada" || k === "campaign_paused") return "Pausada";
  if (k === "archived" || k === "arquivada") return "Arquivada";
  return status || "—";
}

function idDaCampanhaViva(v: CampanhaAoVivoBruta): string {
  return String(v.id ?? v.campaign_id ?? "").trim();
}

export function flattenCampanhasPipeboard(body: unknown): CampanhaAoVivoBruta[] {
  if (body == null) return [];
  if (Array.isArray(body)) return body as CampanhaAoVivoBruta[];
  if (typeof body !== "object") return [];
  const o = body as Record<string, unknown>;
  const candidatos = [o.campaigns, o.data, o.resultado, o.result, o.items];
  for (const c of candidatos) {
    if (Array.isArray(c)) return c as CampanhaAoVivoBruta[];
    if (c && typeof c === "object") {
      const inner = c as Record<string, unknown>;
      const nested = inner.campaigns ?? inner.data ?? inner.items;
      if (Array.isArray(nested)) return nested as CampanhaAoVivoBruta[];
    }
  }
  return [];
}

export function mergeCampanhasRelatorio(
  espelho: CampanhaRelatorio[],
  aoVivo: CampanhaAoVivoBruta[],
): { campanhas: CampanhaRelatorio[]; fonte: FonteCampanhas } {
  const base = Array.isArray(espelho) ? espelho : [];
  const vivas = Array.isArray(aoVivo) ? aoVivo : [];
  if (!vivas.length) {
    return {
      campanhas: base.map((c) => ({ ...c, fonte: "espelho" as const })),
      fonte: "espelho",
    };
  }
  const byId = new Map(base.map((c) => [c.external_id, c]));
  const out: CampanhaRelatorio[] = [];
  const vistos = new Set<string>();
  for (const v of vivas) {
    const id = idDaCampanhaViva(v);
    if (!id || vistos.has(id)) continue;
    vistos.add(id);
    const e = byId.get(id);
    const statusBruto = String(v.effective_status ?? v.status ?? e?.status ?? "");
    out.push({
      external_id: id,
      nome: String(v.name ?? v.nome ?? e?.nome ?? "(sem nome)"),
      status: statusBruto,
      objective: String(v.objective ?? v.objetivo ?? e?.objective ?? "") || null,
      tipo: e?.tipo ?? null,
      gasto: e?.gasto ?? 0,
      last_synced_at: e?.last_synced_at ?? null,
      fonte: "ao_vivo",
    });
    byId.delete(id);
  }
  for (const e of byId.values()) out.push({ ...e, fonte: "espelho" });
  return { campanhas: out, fonte: "ao_vivo" };
}

export type PartesBrasilia = {
  y: number;
  m: number;
  d: number;
  h: number;
  min: number;
  dow: number;
};

const DOW: Record<string, number> = {
  Sun: 0,
  Mon: 1,
  Tue: 2,
  Wed: 3,
  Thu: 4,
  Fri: 5,
  Sat: 6,
};

export function partesEmBrasilia(d: Date): PartesBrasilia {
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone: TZ_BRASIL,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
    weekday: "short",
  });
  const bag: Record<string, string> = {};
  for (const p of fmt.formatToParts(d)) {
    if (p.type !== "literal") bag[p.type] = p.value;
  }
  return {
    y: Number(bag.year),
    m: Number(bag.month),
    d: Number(bag.day),
    h: Number(bag.hour),
    min: Number(bag.minute),
    dow: DOW[bag.weekday] ?? 0,
  };
}

export function instanteBrasilia(y: number, mo: number, d: number, h = 0, min = 0): Date {
  const utc = new Date(Date.UTC(y, mo - 1, d, h, min, 0));
  const p = partesEmBrasilia(utc);
  const asLocal = Date.UTC(p.y, p.m - 1, p.d, p.h, p.min, 0);
  const desired = Date.UTC(y, mo - 1, d, h, min, 0);
  return new Date(utc.getTime() + (desired - asLocal));
}

export function parseHoraLocal(hora: string): { h: number; min: number } | null {
  const m = String(hora ?? "")
    .trim()
    .match(/^(\d{1,2}):(\d{2})$/);
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (h < 0 || h > 23 || min < 0 || min > 59) return null;
  return { h, min };
}

export function proximaExecucaoRelatorio(opts: {
  frequencia: FrequenciaRelatorio;
  horaLocal: string;
  diaSemana?: number | null;
  intervaloHoras?: number | null;
  aPartirDe: Date;
}): Date {
  const hora = parseHoraLocal(opts.horaLocal) ?? { h: 8, min: 0 };
  const origem = opts.aPartirDe;
  if (opts.frequencia === "cada_n_horas") {
    const n = Math.max(1, Math.floor(Number(opts.intervaloHoras) || 1));
    return new Date(origem.getTime() + n * 3600_000);
  }
  const p = partesEmBrasilia(origem);
  let y = p.y;
  let mo = p.m;
  let d = p.d;
  const avancarDia = () => {
    // Calendário civil (UTC date arithmetic), não "agora + 36h": 36h a partir
    // do meio-dia pulava dois dias e o relatório diário nascia amanhã+1.
    const dt = new Date(Date.UTC(y, mo - 1, d + 1));
    y = dt.getUTCFullYear();
    mo = dt.getUTCMonth() + 1;
    d = dt.getUTCDate();
  };
  const candidato = () => instanteBrasilia(y, mo, d, hora.h, hora.min);
  const dowDe = () => partesEmBrasilia(instanteBrasilia(y, mo, d, 12, 0)).dow;

  if (opts.frequencia === "diaria") {
    let c = candidato();
    if (c.getTime() <= origem.getTime()) {
      avancarDia();
      c = candidato();
    }
    return c;
  }

  if (opts.frequencia === "dias_uteis") {
    for (let i = 0; i < 14; i++) {
      const dow = dowDe();
      const c = candidato();
      if (dow !== 0 && dow !== 6 && c.getTime() > origem.getTime()) return c;
      avancarDia();
    }
    return candidato();
  }

  const alvo = ((opts.diaSemana ?? 1) % 7 + 7) % 7;
  for (let i = 0; i < 14; i++) {
    const c = candidato();
    if (dowDe() === alvo && c.getTime() > origem.getTime()) return c;
    avancarDia();
  }
  return candidato();
}

export function addDaysYmd(ymd: string, delta: number): string {
  const [y, m, d] = ymd.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d + delta));
  return dt.toISOString().slice(0, 10);
}

export function hojeYmdBrasilia(agora: Date): string {
  const p = partesEmBrasilia(agora);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${p.y}-${pad(p.m)}-${pad(p.d)}`;
}

export function periodoDaJanela(
  janela: JanelaAnalise,
  hojeYmd: string,
): { inicio: string; fim: string } {
  const fim = addDaysYmd(hojeYmd, -1);
  if (janela === "ontem") return { inicio: fim, fim };
  const n = janela === "3d" ? 3 : janela === "7d" ? 7 : 14;
  return { inicio: addDaysYmd(fim, -(n - 1)), fim };
}

/** Janela imediatamente anterior, mesma duração, sem sobrepor o período pedido. */
export function janelaAnteriorDoPeriodo(periodo: {
  inicio: string;
  fim: string;
}): { inicio: string; fim: string } {
  const ini = String(periodo.inicio ?? "").slice(0, 10);
  const fim = String(periodo.fim ?? "").slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(ini) || !/^\d{4}-\d{2}-\d{2}$/.test(fim)) {
    return { inicio: ini, fim };
  }
  const a = Date.UTC(Number(ini.slice(0, 4)), Number(ini.slice(5, 7)) - 1, Number(ini.slice(8, 10)));
  const b = Date.UTC(Number(fim.slice(0, 4)), Number(fim.slice(5, 7)) - 1, Number(fim.slice(8, 10)));
  const dias = Math.max(1, Math.round((b - a) / 864e5) + 1);
  const prevFim = addDaysYmd(ini, -1);
  return { inicio: addDaysYmd(prevFim, -(dias - 1)), fim: prevFim };
}

export function filtrarConjuntosDoRecorte(
  raw: unknown,
  nomes: string[],
  ids: string[],
): Record<string, unknown> {
  const o = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const lista = Array.isArray(o.conjuntos) ? (o.conjuntos as Record<string, unknown>[]) : [];
  const chaves = [...nomes, ...ids]
    .map((x) => String(x ?? "").trim().toLowerCase())
    .filter((x) => x.length >= 4);
  const filtrados = lista.filter((item) => {
    const campanha = String(item.campanha ?? item.campaign_name ?? "").toLowerCase();
    if (!campanha) return false;
    return chaves.some((k) => campanha.includes(k) || k.includes(campanha));
  });
  return {
    ...o,
    conjuntos: filtrados,
    recorte: "campanhas_do_relatorio",
    exibidos: filtrados.length,
    total_antes_do_filtro: lista.length,
    nota_recorte: filtrados.length
      ? `Conjuntos das campanhas do recorte (${filtrados.length} de ${lista.length} na amostra).`
      : lista.length
        ? "A amostra estrutural tem conjuntos, mas nenhum desta(s) campanha(s) — nao misturar outras linhas da conta."
        : "Nenhum conjunto na amostra estrutural.",
  };
}

export function recortarAlertasDoRecorte(
  raw: unknown,
  nomes: string[],
  ids: string[],
): Record<string, unknown> {
  const o = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const lista = Array.isArray(o.alertas_ativos)
    ? (o.alertas_ativos as Record<string, unknown>[])
    : [];
  const chaves = [...nomes, ...ids]
    .map((x) => String(x ?? "").trim().toLowerCase())
    .filter((x) => x.length >= 6);
  const doRecorte = lista.filter((a) => {
    const blob = `${a.title ?? ""} ${a.description ?? ""} ${a.alvo ?? ""}`.toLowerCase();
    return chaves.some((k) => blob.includes(k));
  });
  return {
    alertas_do_recorte: doRecorte,
    outros_da_conta: lista.length - doRecorte.length,
    nota: "Zero no recorte significa nenhum alerta nestas campanhas, nao 'nao coletado'.",
  };
}

export type LinhaRankingConjunto = {
  posicao: number;
  conjunto_id: string | null;
  nome: string;
  campanha: string;
  status: string;
  anuncios: number;
  gasto: number;
  impressoes: number;
  cliques_link: number;
  resultados: number;
  base_resultado: string;
  custo_por_resultado: number | null;
  custo_txt: string;
};

function reaisDeRelatorio(v: unknown): number {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  const s = String(v ?? "").trim();
  if (!s) return 0;
  const limpo = s.replace(/[^\d,.-]/g, "");
  if (!limpo) return 0;
  const n = limpo.includes(",")
    ? Number(limpo.replace(/\./g, "").replace(",", "."))
    : Number(limpo);
  return Number.isFinite(n) ? n : 0;
}

function fmtReaisRelatorio(n: number): string {
  if (!Number.isFinite(n)) return "—";
  const [i, d] = Math.abs(n).toFixed(2).split(".");
  const mil = i.replace(/\B(?=(\d{3})+(?!\d))/g, ".");
  return `${n < 0 ? "-" : ""}R$ ${mil},${d}`;
}

function listaConjuntosFonte(fonte: unknown): Record<string, unknown>[] {
  if (fonte == null) return [];
  if (Array.isArray(fonte)) return fonte.flatMap((x) => listaConjuntosFonte(x));
  if (typeof fonte !== "object") return [];
  const o = fonte as Record<string, unknown>;
  if (Array.isArray(o.linhas)) return listaConjuntosFonte(o.linhas);
  if (Array.isArray(o.conjuntos)) return listaConjuntosFonte(o.conjuntos);
  if (Array.isArray(o.objetos)) return listaConjuntosFonte(o.objetos);
  if (Array.isArray(o.ranking)) return listaConjuntosFonte(o.ranking);
  if (
    o.conjunto != null ||
    o.conjunto_id != null ||
    o.totais_janela != null ||
    o.name != null ||
    o.nome != null ||
    o.adset_id != null
  ) {
    return [o];
  }
  return [];
}

function normalizarConjuntoRanking(
  item: Record<string, unknown>,
): Omit<LinhaRankingConjunto, "posicao"> {
  const tot =
    item.totais_janela && typeof item.totais_janela === "object"
      ? (item.totais_janela as Record<string, unknown>)
      : null;
  const janela = tot != null;
  const nome = String(item.nome ?? item.name ?? item.conjunto ?? "").trim() || "(sem nome)";
  const campanha = String(item.campanha ?? item.campaign_name ?? "").trim();
  const id = String(item.conjunto_id ?? item.adset_id ?? item.id ?? "").trim() || null;
  const status = String(item.effective_status ?? item.status ?? item.campanha_status ?? "").trim();
  const anuncios = Number(item.anuncios ?? item.n ?? 0) || 0;
  const gasto = janela ? reaisDeRelatorio(tot.gasto) : 0;
  const impressoes = janela ? Number(tot.impressoes ?? 0) || 0 : 0;
  const cliques_link = janela ? Number(tot.cliques_no_link ?? 0) || 0 : 0;
  const resultados = janela
    ? Number(tot.resultados_na_base ?? tot.conversas ?? tot.formularios ?? 0) || 0
    : 0;
  const custoNum = janela && resultados > 0 ? gasto / resultados : null;
  const custoTxt = janela
    ? (tot.custo_por_resultado != null
      ? String(tot.custo_por_resultado)
      : custoNum == null
        ? "sem resultado"
        : fmtReaisRelatorio(custoNum))
    : "sem entrega na janela";
  return {
    conjunto_id: id,
    nome,
    campanha,
    status,
    anuncios,
    gasto,
    impressoes,
    cliques_link,
    resultados,
    base_resultado: janela ? String(tot.base_de_resultado_rotulo ?? tot.base_de_resultado ?? "") : "",
    custo_por_resultado: custoNum,
    custo_txt: custoTxt,
  };
}

function chaveConjuntoRanking(l: Omit<LinhaRankingConjunto, "posicao">): string {
  if (l.conjunto_id) return `id:${l.conjunto_id}`;
  return `nome:${l.campanha.toLowerCase()}|${l.nome.toLowerCase()}`;
}

function conjuntoSemJanela(l: Omit<LinhaRankingConjunto, "posicao">): boolean {
  return l.custo_txt === "sem entrega na janela" && l.gasto === 0 && l.impressoes === 0;
}

function mesmoNomeCampanhaRanking(
  a: Omit<LinhaRankingConjunto, "posicao">,
  b: Omit<LinhaRankingConjunto, "posicao">,
): boolean {
  return a.campanha.toLowerCase() === b.campanha.toLowerCase()
    && a.nome.toLowerCase() === b.nome.toLowerCase();
}

function colapsarFantasmasRanking(
  mapa: Map<string, Omit<LinhaRankingConjunto, "posicao">>,
): Map<string, Omit<LinhaRankingConjunto, "posicao">> {
  const out = new Map<string, Omit<LinhaRankingConjunto, "posicao">>();
  for (const n of mapa.values()) {
    let achou = false;
    for (const [ek, ev] of out) {
      const mesmoId = !!(ev.conjunto_id && n.conjunto_id && ev.conjunto_id === n.conjunto_id);
      const mesmoNome = mesmoNomeCampanhaRanking(ev, n);
      if (!mesmoId && !mesmoNome) continue;
      const umFantasma = conjuntoSemJanela(ev) || conjuntoSemJanela(n);
      if (mesmoId || umFantasma) {
        out.set(ek, fundirConjuntoRanking(ev, n));
        achou = true;
        break;
      }
    }
    if (!achou) out.set(chaveConjuntoRanking(n), n);
  }
  return out;
}

function fundirConjuntoRanking(
  a: Omit<LinhaRankingConjunto, "posicao">,
  b: Omit<LinhaRankingConjunto, "posicao">,
): Omit<LinhaRankingConjunto, "posicao"> {
  const janelaA = a.impressoes > 0 || a.gasto > 0 || a.resultados > 0 || a.custo_txt !== "sem entrega na janela";
  const janelaB = b.impressoes > 0 || b.gasto > 0 || b.resultados > 0 || b.custo_txt !== "sem entrega na janela";
  const base = janelaB && !janelaA ? b : janelaA && !janelaB ? a : a.gasto >= b.gasto ? a : b;
  const outro = base === a ? b : a;
  return {
    ...base,
    conjunto_id: base.conjunto_id || outro.conjunto_id,
    nome: base.nome !== "(sem nome)" ? base.nome : outro.nome,
    campanha: base.campanha || outro.campanha,
    status: base.status || outro.status,
    anuncios: Math.max(base.anuncios, outro.anuncios),
  };
}

function compararConjuntoMelhorPior(a: LinhaRankingConjunto, b: LinhaRankingConjunto): number {
  const aTem = a.resultados > 0;
  const bTem = b.resultados > 0;
  if (aTem !== bTem) return aTem ? -1 : 1;
  if (aTem && bTem) {
    const ca = a.custo_por_resultado ?? Number.POSITIVE_INFINITY;
    const cb = b.custo_por_resultado ?? Number.POSITIVE_INFINITY;
    if (ca !== cb) return ca - cb;
    if (b.resultados !== a.resultados) return b.resultados - a.resultados;
  }
  if (b.gasto !== a.gasto) return b.gasto - a.gasto;
  return a.nome.localeCompare(b.nome, "pt-BR");
}

/** Ranking de TODOS os conjuntos do recorte, melhor (menor custo na base) no topo. */
export function rankingConjuntosRelatorio(fonte: unknown): {
  linhas: LinhaRankingConjunto[];
  markdown: string;
  total: number;
} {
  const mapa = new Map<string, Omit<LinhaRankingConjunto, "posicao">>();
  for (const item of listaConjuntosFonte(fonte)) {
    const n = normalizarConjuntoRanking(item);
    if (!n.nome && !n.conjunto_id) continue;
    const k = chaveConjuntoRanking(n);
    const prev = mapa.get(k);
    mapa.set(k, prev ? fundirConjuntoRanking(prev, n) : n);
  }
  const linhas = [...colapsarFantasmasRanking(mapa).values()]
    .sort((a, b) => compararConjuntoMelhorPior(a as LinhaRankingConjunto, b as LinhaRankingConjunto))
    .map((l, i) => ({ ...l, posicao: i + 1 }));
  if (!linhas.length) {
    return {
      linhas,
      total: 0,
      markdown: "Nenhum conjunto no recorte desta janela.",
    };
  }
  const header =
    "| # | Conjunto | Campanha | Status | Gasto | Impressões | Cliques | Resultado | Custo | Anúncios |";
  const sep = "|---|---|---|---|---|---|---|---|---|---|";
  const rows = linhas.map((l) =>
    `| ${l.posicao} | ${l.nome} | ${l.campanha || "—"} | ${l.status || "—"} | ${fmtReaisRelatorio(l.gasto)} | ${l.impressoes} | ${l.cliques_link} | ${l.resultados} | ${l.custo_txt} | ${l.anuncios} |`
  );
  return {
    linhas,
    total: linhas.length,
    markdown: [
      `Todos os ${linhas.length} conjunto(s) do recorte, do melhor para o pior (menor custo por resultado na base da campanha; sem resultado fica abaixo).`,
      "",
      header,
      sep,
      ...rows,
    ].join("\n"),
  };
}

function injetarSecaoMarkdownRelatorio(
  md: string,
  titulo: string,
  corpo: string,
): string {
  const texto = String(md ?? "");
  const tituloOk = String(titulo ?? "").trim();
  const corpoOk = String(corpo ?? "").trim();
  if (!tituloOk || !corpoOk) return texto;
  const bloco = `## ${tituloOk}\n\n${corpoOk}`;
  const isH = (l: string) => /^#{1,4}[ \t]+\S/.test(l);
  const escapar = tituloOk.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const tituloRe = new RegExp(`^#{1,4}[ \\t]+${escapar}\\b`, "i");
  const lines = texto.split(/\r?\n/);
  const start = lines.findIndex((l) => tituloRe.test(l));
  if (start >= 0) {
    let end = lines.length;
    for (let i = start + 1; i < lines.length; i++) {
      if (isH(lines[i])) {
        end = i;
        break;
      }
    }
    return [...lines.slice(0, start), bloco, ...lines.slice(end)].join("\n").replace(/\n{3,}/g, "\n\n");
  }
  const cri = lines.findIndex((l) => /^#{1,4}[ \t]+Ranking de criativos\b/i.test(l));
  if (cri >= 0) {
    let end = lines.length;
    for (let i = cri + 1; i < lines.length; i++) {
      if (isH(lines[i])) {
        end = i;
        break;
      }
    }
    return [...lines.slice(0, end), "", bloco, ...lines.slice(end)].join("\n").replace(/\n{3,}/g, "\n\n");
  }
  return texto ? `${texto.replace(/\s*$/, "")}\n\n${bloco}\n` : `${bloco}\n`;
}

export function injetarRankingConjuntosNoMarkdown(args: unknown): string {
  if (args == null || typeof args !== "object" || Array.isArray(args)) {
    return String(args ?? "");
  }
  const o = args as { md?: unknown; tabela?: unknown; corpo_md?: unknown };
  const md = String(o.md ?? o.corpo_md ?? "");
  const tabela = String(o.tabela ?? "");
  return injetarSecaoMarkdownRelatorio(md, "Ranking de conjuntos", tabela);
}

export type LinhaRankingCampanha = {
  posicao: number;
  campaign_id: string;
  nome: string;
  status: string;
  gasto: number;
  impressoes: number;
  cliques_link: number;
  formularios: number;
  conversas: number;
};

function listaCampanhasRanking(fonte: unknown): Record<string, unknown>[] {
  if (fonte == null) return [];
  if (Array.isArray(fonte)) {
    return fonte.flatMap((x) =>
      x && typeof x === "object" && !Array.isArray(x) ? [x as Record<string, unknown>] : [],
    );
  }
  if (typeof fonte !== "object") return [];
  const o = fonte as Record<string, unknown>;
  if (Array.isArray(o.linhas)) return listaCampanhasRanking(o.linhas);
  return [];
}

/** Todas as campanhas do recorte, da maior para a menor gasto na janela. Sem cortar. */
export function rankingCampanhasRelatorio(fonte: unknown): {
  linhas: LinhaRankingCampanha[];
  markdown: string;
  total: number;
} {
  const brutas: Omit<LinhaRankingCampanha, "posicao">[] = [];
  for (const item of listaCampanhasRanking(fonte)) {
    const id = String(item.campaign_id ?? item.external_id ?? item.id ?? "").trim();
    const nome = String(item.nome ?? item.name ?? "").trim() || "(sem nome)";
    if (!id && nome === "(sem nome)") continue;
    brutas.push({
      campaign_id: id,
      nome,
      status: String(item.status ?? "").trim(),
      gasto: reaisDeRelatorio(item.gasto),
      impressoes: Number(item.impressoes ?? 0) || 0,
      cliques_link: Number(item.cliques_link ?? item.cliques_no_link ?? 0) || 0,
      formularios: Number(item.formularios ?? item.form_leads ?? 0) || 0,
      conversas: Number(item.conversas ?? item.messaging_started ?? 0) || 0,
    });
  }
  const linhas = brutas
    .sort((a, b) => (b.gasto !== a.gasto ? b.gasto - a.gasto : a.nome.localeCompare(b.nome, "pt-BR")))
    .map((l, i) => ({ ...l, posicao: i + 1 }));
  if (!linhas.length) {
    return { linhas, total: 0, markdown: "Nenhuma campanha no recorte desta janela." };
  }
  const header = "| # | Campanha | Status | Gasto | Impressões | Cliques no link | Formulários | Conversas |";
  const sep = "|---|---|---|---|---|---|---|---|";
  const rows = linhas.map(
    (l) =>
      `| ${l.posicao} | ${l.nome} | ${l.status || "—"} | ${fmtReaisRelatorio(l.gasto)} | ${l.impressoes} | ${l.cliques_link} | ${l.formularios} | ${l.conversas} |`,
  );
  return {
    linhas,
    total: linhas.length,
    markdown: [
      `Todas as ${linhas.length} campanha(s) do recorte, da maior para a menor gasto na janela. Cascas Traffic/Sales/MM_LITE não entram.`,
      "",
      header,
      sep,
      ...rows,
    ].join("\n"),
  };
}

export function injetarRankingCampanhasNoMarkdown(args: unknown): string {
  if (args == null || typeof args !== "object" || Array.isArray(args)) {
    return String(args ?? "");
  }
  const o = args as { md?: unknown; tabela?: unknown; corpo_md?: unknown };
  const md = String(o.md ?? o.corpo_md ?? "");
  const tabela = String(o.tabela ?? "");
  return injetarSecaoMarkdownRelatorio(md, "Quebra por campanha", tabela);
}

export type AchadoRelatorio = {
  tipo: TipoAchado;
  nivel: "conta" | "campanha" | "conjunto" | "anuncio";
  alvo_id: string | null;
  alvo_nome: string;
  severidade: "info" | "atencao" | "urgente";
  evidencia: string;
  mecanismo: string;
  acao: string;
  metrica_sucesso: string;
  janela_leitura: string;
  reversa: string;
};

const TIPOS_ACHADO = new Set<string>([
  "teto",
  "custo_elevado",
  "monitoramento_reforcado",
  "fadiga",
  "escala",
  "pausa_com_guarda",
  "hipotese",
]);

export function normalizarAchados(raw: unknown): AchadoRelatorio[] {
  if (!Array.isArray(raw)) return [];
  const out: AchadoRelatorio[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const o = item as Record<string, unknown>;
    const evidencia = String(o.evidencia ?? "").trim();
    if (!evidencia) continue;
    const tipo = TIPOS_ACHADO.has(String(o.tipo)) ? (o.tipo as TipoAchado) : "hipotese";
    const nivelRaw = String(o.nivel ?? "campanha");
    const nivel =
      nivelRaw === "conta" ||
      nivelRaw === "conjunto" ||
      nivelRaw === "anuncio" ||
      nivelRaw === "campanha"
        ? nivelRaw
        : "campanha";
    const sev = String(o.severidade ?? "atencao");
    out.push({
      tipo,
      nivel,
      alvo_id: o.alvo_id != null && String(o.alvo_id).trim() ? String(o.alvo_id) : null,
      alvo_nome: String(o.alvo_nome ?? o.alvo ?? "").trim() || "(sem nome)",
      severidade: sev === "urgente" || sev === "info" ? sev : "atencao",
      evidencia,
      mecanismo: String(o.mecanismo ?? "").trim(),
      acao: String(o.acao ?? "").trim(),
      metrica_sucesso: String(o.metrica_sucesso ?? "").trim(),
      janela_leitura: String(o.janela_leitura ?? "").trim(),
      reversa: String(o.reversa ?? "").trim(),
    });
  }
  return out;
}

/** Lê `"chave":"..."` mesmo se a aspa final nunca veio (síntese cortada no teto de tokens). */
function lerCampoStringJson(raw: string, chave: string): { valor: string; fechado: boolean } | null {
  const re = new RegExp(`"${chave.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}"\\s*:\\s*"`);
  const m = re.exec(raw);
  if (!m) return null;
  let i = m.index + m[0].length;
  let out = "";
  while (i < raw.length) {
    const c = raw.charAt(i);
    if (c === "\\") {
      const n = raw.charAt(i + 1);
      if (!n) return { valor: out, fechado: false };
      if (n === "u") {
        const hex = raw.slice(i + 2, i + 6);
        if (/^[0-9a-fA-F]{4}$/.test(hex)) {
          out += String.fromCharCode(parseInt(hex, 16));
          i += 6;
          continue;
        }
      }
      const map: Record<string, string> = {
        n: "\n",
        r: "\r",
        t: "\t",
        b: "\b",
        f: "\f",
        '"': '"',
        "\\": "\\",
        "/": "/",
      };
      out += map[n] ?? n;
      i += 2;
      continue;
    }
    if (c === '"') return { valor: out, fechado: true };
    out += c;
    i += 1;
  }
  return { valor: out, fechado: false };
}

function andarJsonIgnorandoString(
  raw: string,
  start: number,
  abrir: string,
  fechar: string,
): number {
  let depth = 0;
  let inStr = false;
  let esc = false;
  for (let i = start; i < raw.length; i++) {
    const c = raw.charAt(i);
    if (inStr) {
      if (esc) {
        esc = false;
        continue;
      }
      if (c === "\\") {
        esc = true;
        continue;
      }
      if (c === '"') inStr = false;
      continue;
    }
    if (c === '"') {
      inStr = true;
      continue;
    }
    if (c === abrir) depth += 1;
    if (c === fechar) {
      depth -= 1;
      if (depth === 0) return i;
    }
  }
  return -1;
}

function fatiaJsonObjeto(raw: string, start: number): string | null {
  if (raw.charAt(start) !== "{") return null;
  const end = andarJsonIgnorandoString(raw, start, "{", "}");
  return end >= 0 ? raw.slice(start, end + 1) : null;
}

function objetosJsonCompletos(inner: string): unknown[] {
  const out: unknown[] = [];
  let i = 0;
  while (i < inner.length) {
    while (i < inner.length && ", \n\r\t".includes(inner.charAt(i))) i += 1;
    if (i >= inner.length || inner.charAt(i) !== "{") break;
    const end = andarJsonIgnorandoString(inner, i, "{", "}");
    if (end < 0) break;
    try {
      out.push(JSON.parse(inner.slice(i, end + 1)));
    } catch {
      break;
    }
    i = end + 1;
  }
  return out;
}

function lerCampoArrayJson(raw: string, chave: string): unknown[] {
  const re = new RegExp(`"${chave.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}"\\s*:\\s*\\[`);
  const m = re.exec(raw);
  if (!m) return [];
  const start = m.index + m[0].length - 1;
  const end = andarJsonIgnorandoString(raw, start, "[", "]");
  if (end >= 0) {
    try {
      const parsed = JSON.parse(raw.slice(start, end + 1));
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      /* array com objeto cortado: pega só os completos */
    }
  }
  return objetosJsonCompletos(raw.slice(start + 1));
}

function recuperarJsonRelatorioTruncado(raw: string): {
  corpo_md: string;
  achados: AchadoRelatorio[];
  cobertura: string;
} | null {
  const corpo = lerCampoStringJson(raw, "corpo_md") ?? lerCampoStringJson(raw, "narrativa");
  const achados = normalizarAchados(lerCampoArrayJson(raw, "achados"));
  const cob = lerCampoStringJson(raw, "cobertura");
  if (!corpo?.valor.trim() && !achados.length && !cob?.valor.trim()) return null;
  return {
    corpo_md: String(corpo?.valor ?? "").trim(),
    achados,
    cobertura: cob?.fechado
      ? cob.valor.trim()
      : corpo?.fechado
        ? String(cob?.valor ?? "").trim()
        : (cob?.valor.trim() || "síntese cortada no fim; narrativa recuperada"),
  };
}

export function extrairJsonRelatorio(texto: string): {
  corpo_md: string;
  achados: AchadoRelatorio[];
  cobertura: string;
} {
  const trimmed = String(texto ?? "").trim();
  if (!trimmed) {
    return { corpo_md: "", achados: [], cobertura: "síntese vazia" };
  }
  const fence = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const raw = fence ? fence[1].trim() : trimmed;
  const start = raw.indexOf("{");
  if (start >= 0) {
    const fatia = fatiaJsonObjeto(raw, start);
    if (fatia) {
      try {
        const j = JSON.parse(fatia) as Record<string, unknown>;
        return {
          corpo_md: String(j.corpo_md ?? j.narrativa ?? "").trim() || trimmed,
          achados: normalizarAchados(j.achados),
          cobertura: String(j.cobertura ?? "").trim(),
        };
      } catch {
        /* objeto com chave inválida: cai na recuperação campo a campo */
      }
    }
    const rec = recuperarJsonRelatorioTruncado(raw.slice(start));
    if (rec && (rec.corpo_md || rec.achados.length || rec.cobertura)) return rec;
  }
  return {
    corpo_md: trimmed,
    achados: [],
    cobertura: start < 0
      ? "síntese não devolveu JSON estruturado"
      : "síntese não devolveu JSON válido",
  };
}

export function presetDiarioOperacional(): {
  nome: string;
  frequencia: FrequenciaRelatorio;
  horaLocal: string;
  recorte: RecorteCampanhas;
  janela: JanelaAnalise;
  secoes: ChaveSecaoRelatorio[];
} {
  return {
    nome: "Relatório diário operacional",
    frequencia: "diaria",
    horaLocal: "08:00",
    recorte: "todas_ativas",
    janela: "ontem",
    secoes: secoesRelatorioPadrao(),
  };
}
