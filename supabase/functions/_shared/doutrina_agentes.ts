// Doutrina por papel — a skill gestor-trafego-meta chegando a quem escreve.
//
// Ate 05/10/2026 so a leitura da colheita recebia secoes da skill direto no prompt; o resto
// dependia de o subagente gastar uma das suas 1-2 chamadas de ferramenta em get_conhecimento,
// e a sintese, a coordenacao, o relatorio autonomo, o Ritmo e a Sentinela nao recebiam nada.
// Cada um tinha um pedaco de doutrina reescrito a mao no proprio prompt (seis copias).
//
// Aqui fica o UNICO mapa papel → secoes. O texto vem de agent_knowledge (a mesma base que
// get_conhecimento serve e que o AG-08 governa); se a leitura falhar, vem do espelho embutido
// gerado do mesmo .md. Cada papel tem teto de caracteres: doutrina que estoura o relogio da
// resposta nao ajuda ninguem.

import { DOUTRINA_EMBUTIDA } from "./doutrina_conteudo.gen.ts";

export type PapelDoutrina =
  | "sintese"
  | "leitura"
  | "desempenho"
  | "criativos"
  | "estrutura"
  | "sentinela"
  | "reco"
  | "relatorio"
  | "ritmo"
  | "vigia"
  | "whatsapp"
  | "compliance"
  | "legendas"
  | "coordenacao";

type Recorte = { tema: string; secao: string; max?: number; soCredito?: boolean };

const G = "gestor_trafego_meta";
const D = "doutrina_diagnostico";
const M = "metas_conjuntas";
const B = "metricas_bases";
const K = "mecanica_meta";
const C = "contrato_card";

export const DOUTRINA_POR_PAPEL: Record<PapelDoutrina, { teto: number; recortes: Recorte[] }> = {
  sintese: {
    teto: 5_000,
    recortes: [
      { tema: G, secao: "Hierarquia de decisao" },
      { tema: G, secao: "Principios", max: 2_000 },
      { tema: G, secao: "Recomendacao de ato" },
      { tema: G, secao: "Anti-alucinacao" },
    ],
  },
  leitura: {
    teto: 12_000,
    recortes: [
      { tema: G, secao: "Hierarquia de decisao" },
      { tema: M, secao: "Conta de viabilidade" },
      { tema: M, secao: "Tendencia com janela curta" },
      { tema: M, secao: "Criativo que estreia" },
      { tema: M, secao: "Onde buscar o volume" },
      { tema: D, secao: "Ordem de investigacao" },
      { tema: D, secao: "Decomposicao do custo" },
      { tema: D, secao: "Manter mexer ou matar" },
      { tema: D, secao: "Fadiga criativa" },
      { tema: K, secao: "Fase de aprendizado" },
      { tema: K, secao: "Efeito de breakdown" },
      { tema: G, secao: "Anti-alucinacao" },
    ],
  },
  desempenho: {
    teto: 7_000,
    recortes: [
      { tema: D, secao: "Ordem de investigacao" },
      { tema: D, secao: "Decomposicao do custo" },
      { tema: D, secao: "Fadiga criativa" },
      { tema: D, secao: "Manter mexer ou matar" },
      { tema: B, secao: "Base por campanha" },
      { tema: B, secao: "Janelas e datas" },
      { tema: K, secao: "Fase de aprendizado" },
      { tema: K, secao: "Efeito de breakdown" },
      { tema: M, secao: "Conta de viabilidade" },
      { tema: D, secao: "Escala" },
    ],
  },
  criativos: {
    teto: 3_500,
    recortes: [
      { tema: D, secao: "Fadiga criativa" },
      { tema: K, secao: "Efeito de breakdown" },
      { tema: M, secao: "Criativo que estreia" },
      { tema: D, secao: "Perfil vencedor" },
    ],
  },
  estrutura: {
    teto: 5_000,
    recortes: [
      { tema: K, secao: "CBO e ABO" },
      { tema: K, secao: "Fase de aprendizado" },
      { tema: K, secao: "Advantage+" },
      { tema: K, secao: "Leilao" },
      { tema: C, secao: "Campos obrigatorios" },
      { tema: C, secao: "Familias de ato" },
    ],
  },
  sentinela: {
    teto: 5_000,
    recortes: [
      { tema: G, secao: "Recomendacao de ato" },
      { tema: D, secao: "Manter mexer ou matar" },
      { tema: D, secao: "Fadiga criativa" },
      { tema: B, secao: "Base por campanha" },
      { tema: B, secao: "Tetos" },
      { tema: D, secao: "Quando a resposta e pergunta" },
    ],
  },
  reco: {
    teto: 2_500,
    recortes: [
      { tema: G, secao: "Recomendacao de ato" },
      { tema: B, secao: "Nomenclatura", max: 1_200 },
    ],
  },
  relatorio: {
    teto: 7_000,
    recortes: [
      { tema: G, secao: "Recomendacao de ato" },
      { tema: D, secao: "Ordem de investigacao" },
      { tema: D, secao: "Decomposicao do custo" },
      { tema: D, secao: "Fadiga criativa" },
      { tema: D, secao: "Manter mexer ou matar" },
      { tema: D, secao: "Escala" },
      { tema: B, secao: "Base por campanha" },
      { tema: B, secao: "Tetos" },
    ],
  },
  ritmo: {
    teto: 5_000,
    recortes: [
      { tema: C, secao: "Campos obrigatorios" },
      { tema: C, secao: "Familias de ato" },
      { tema: D, secao: "Escala" },
      { tema: K, secao: "Fase de aprendizado" },
      { tema: M, secao: "Conta de viabilidade" },
      { tema: C, secao: "Criacao em lote" },
    ],
  },
  vigia: {
    teto: 2_200,
    recortes: [
      { tema: D, secao: "Decomposicao do custo" },
      { tema: K, secao: "Fase de aprendizado", max: 900 },
    ],
  },
  whatsapp: {
    teto: 3_500,
    recortes: [
      { tema: "whatsapp_ativos", secao: "Numero WABA" },
      { tema: "whatsapp_ativos", secao: "Qualidade e tier" },
      { tema: "whatsapp_ativos", secao: "Numero oficial" },
      { tema: "whatsapp_ativos", secao: "Sinais para alerta" },
    ],
  },
  compliance: {
    teto: 4_500,
    recortes: [
      { tema: "armadilhas_operacao", secao: "Compliance so da legenda" },
      { tema: "compliance_credito", secao: "Fail-closed", soCredito: true },
      { tema: "compliance_credito", secao: "Copy e peca", soCredito: true },
      { tema: "compliance_credito", secao: "Fair Lending", soCredito: true },
      { tema: "compliance_credito", secao: "Checklist", soCredito: true },
    ],
  },
  legendas: {
    teto: 2_200,
    recortes: [{ tema: "compliance_credito", secao: "Copy e peca", soCredito: true }],
  },
  coordenacao: {
    teto: 1_400,
    recortes: [{ tema: G, secao: "Anti-alucinacao" }],
  },
};

export const TEMAS_DA_DOUTRINA = [...new Set(
  Object.values(DOUTRINA_POR_PAPEL).flatMap((p) => p.recortes.map((r) => r.tema)),
)];

export type BaseDoutrina = Map<string, { conteudo: string; vencido: boolean; origem: "banco" | "embutida" }>;

function deacc(s: string): string {
  return s.normalize("NFD").replace(/[̀-ͯ]/g, "");
}
const norm = (s: string) => deacc(s.toLowerCase()).replace(/[-_\s:]+/g, "");

export function dividirSecoesMd(md: string): { titulo: string; corpo: string }[] {
  const out: { titulo: string; corpo: string }[] = [];
  let titulo = "(inicio)";
  let buf: string[] = [];
  for (const l of md.replace(/\r\n/g, "\n").split("\n")) {
    if (/^##\s+/.test(l)) {
      if (buf.length) out.push({ titulo, corpo: buf.join("\n").trim() });
      titulo = l.replace(/^#+\s*/, "").trim();
      buf = [];
    } else buf.push(l);
  }
  if (buf.length) out.push({ titulo, corpo: buf.join("\n").trim() });
  return out;
}

function hojeIso(): string {
  return new Date().toISOString().slice(0, 10);
}

/** Base so com o espelho embutido. Usada quando nao ha cliente de banco ou a leitura falhou. */
export function baseEmbutida(hoje = hojeIso()): BaseDoutrina {
  const m: BaseDoutrina = new Map();
  for (const [tema, v] of Object.entries(DOUTRINA_EMBUTIDA)) {
    m.set(tema, { conteudo: v.conteudo, vencido: v.revalidar_ate < hoje, origem: "embutida" });
  }
  return m;
}

// deno-lint-ignore no-explicit-any
type Db = { from: (t: string) => any };

/**
 * Le os temas da doutrina do banco (uma consulta). Tema ausente ou consulta com erro cai no
 * espelho embutido — doutrina nao pode sumir porque a base ficou fora do ar.
 */
export async function carregarBaseDoutrina(supa: Db | null | undefined, hoje = hojeIso()): Promise<BaseDoutrina> {
  const base = baseEmbutida(hoje);
  if (!supa) return base;
  try {
    const { data, error } = await supa.from("agent_knowledge")
      .select("tema,conteudo,revalidar_ate")
      .eq("vigente", true)
      .in("tema", TEMAS_DA_DOUTRINA);
    if (error || !Array.isArray(data)) return base;
    for (const r of data as { tema: string; conteudo: string | null; revalidar_ate: string | null }[]) {
      const conteudo = String(r.conteudo ?? "").trim();
      if (!conteudo) continue;
      base.set(r.tema, {
        conteudo,
        vencido: r.revalidar_ate ? String(r.revalidar_ate) < hoje : false,
        origem: "banco",
      });
    }
  } catch { /* fica o embutido */ }
  return base;
}

export type DoutrinaMontada = { texto: string; secoes: string[]; faltando: string[] };

/** Monta o bloco do papel dentro do teto. `credito` libera os recortes `soCredito`. */
export function montarDoutrina(
  base: BaseDoutrina,
  papel: PapelDoutrina,
  opts: { credito?: boolean } = {},
): DoutrinaMontada {
  const cfg = DOUTRINA_POR_PAPEL[papel];
  const partes: string[] = [];
  const secoes: string[] = [];
  const faltando: string[] = [];
  const cache = new Map<string, { titulo: string; corpo: string }[]>();
  let usados = 0;
  for (const r of cfg.recortes) {
    if (r.soCredito && !opts.credito) continue;
    if (usados >= cfg.teto) break;
    const t = base.get(r.tema);
    if (!t) {
      faltando.push(`${r.tema}/${r.secao}`);
      continue;
    }
    let secs = cache.get(r.tema);
    if (!secs) {
      secs = dividirSecoesMd(t.conteudo);
      cache.set(r.tema, secs);
    }
    const alvo = norm(r.secao);
    const hit = secs.find((s) => norm(s.titulo).includes(alvo));
    if (!hit || !hit.corpo) {
      faltando.push(`${r.tema}/${r.secao}`);
      continue;
    }
    const aviso = t.vencido ? " [validade vencida: use como metodo; numero de plataforma precisa ser reverificado]" : "";
    const cab = `### ${hit.titulo}${aviso}\n`;
    const espaco = cfg.teto - usados - cab.length;
    if (espaco < 200) break;
    const corpo = hit.corpo.length > Math.min(espaco, r.max ?? Infinity)
      ? hit.corpo.slice(0, Math.min(espaco, r.max ?? Infinity)).replace(/\s+\S*$/, "") + " …"
      : hit.corpo;
    const bloco = cab + corpo;
    partes.push(bloco);
    secoes.push(`${r.tema}/${hit.titulo}`);
    usados += bloco.length + 2;
  }
  return { texto: partes.join("\n\n"), secoes, faltando };
}

/** Bloco pronto para colar num system prompt (vazio quando nao ha secao). */
export function blocoDoutrina(
  base: BaseDoutrina,
  papel: PapelDoutrina,
  opts: { credito?: boolean } = {},
): string {
  const d = montarDoutrina(base, papel, opts);
  if (!d.texto) return "";
  return `\nDOUTRINA DA CASA (skill gestor-trafego-meta — aplique como criterio de julgamento; nao recite, nao cite o nome da secao ao gestor):\n${d.texto}\n`;
}
