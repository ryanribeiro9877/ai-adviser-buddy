/** Espelho de src/lib/relatorios.ts — Deno nao importa o frontend. */
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
  const texto = String(md ?? "");
  if (!texto) return texto;
  let out = texto;
  for (const s of SECOES_RELATORIO) {
    const re = new RegExp(`^(#{1,4}[ \\t]*)${s.chave}\\b`, "gmi");
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
  const end = raw.lastIndexOf("}");
  if (start < 0 || end <= start) {
    return {
      corpo_md: trimmed,
      achados: [],
      cobertura: "síntese não devolveu JSON estruturado",
    };
  }
  try {
    const j = JSON.parse(raw.slice(start, end + 1)) as Record<string, unknown>;
    return {
      corpo_md: String(j.corpo_md ?? j.narrativa ?? "").trim() || trimmed,
      achados: normalizarAchados(j.achados),
      cobertura: String(j.cobertura ?? "").trim(),
    };
  } catch {
    return {
      corpo_md: trimmed,
      achados: [],
      cobertura: "síntese não devolveu JSON válido",
    };
  }
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
