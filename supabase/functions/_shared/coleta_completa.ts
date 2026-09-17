// Compacta e recorta leituras pagináveis ANTES do teto de payload.
//
// Medido em 17/09/2026 (job dc46c40d, Jurídico): get_estrutura_conjuntos devolveu 24
// conjuntos e cortarLista mandou 9; get_detalhe_anuncios parou em 6 de 15; get_criativos
// cortou 7 de 20. O especialista AINDA leu — a síntese recebeu relatorio vazio porque o
// LLM estourou o relógio paginando. Compactar o item e esgotar a lista no HANDLER
// elimina a paginação como trabalho do modelo.

import { classificarLinhaProdutoCohapm } from "./memoria_conjunto.ts";
import { inferirMeioDrive, type MeioDrive } from "./pedido_drive_criativos.ts";

export const TETO_PAYLOAD_FERRAMENTA = 11_500;

export function reaisDeOrcamentoMeta(v: unknown): number | null {
  const n = Number(v);
  if (!Number.isFinite(n) || n <= 0) return null;
  // Graph guarda daily_budget em centavos. Valores já em reais (ex.: 30) ficam como estão.
  if (Number.isInteger(n) && n >= 100) return n / 100;
  return n;
}

function nomesDeGeo(v: unknown): string[] | null {
  if (!Array.isArray(v)) return null;
  const nomes = v
    .map((c) => {
      if (typeof c === "string") return c.trim();
      if (c && typeof c === "object") {
        const o = c as Record<string, unknown>;
        return String(o.name ?? o.key ?? "").trim();
      }
      return "";
    })
    .filter(Boolean);
  return nomes.length ? nomes.slice(0, 16) : null;
}

/** Conjunto da RPC get_estrutura_conjuntos sem targeting gordo (interesses/públicos/cidades objeto). */
export function compactarConjuntoEstrutura(item: unknown): Record<string, unknown> {
  const c = item && typeof item === "object" ? item as Record<string, unknown> : {};
  return {
    conjunto: c.conjunto ?? c.nome ?? c.name ?? null,
    status: c.status ?? null,
    campanha: c.campanha ?? null,
    campanha_status: c.campanha_status ?? null,
    entregando: c.entregando ?? null,
    orcamento_diario_reais: reaisDeOrcamentoMeta(c.daily_budget ?? c.orcamento_diario_centavos),
    leitura_orcamento: c.leitura_orcamento ?? null,
    optimization_goal: c.optimization_goal ?? null,
    destination_type: c.destination_type ?? null,
    pegada: c.pegada ?? null,
    gasto: c.gasto ?? null,
    form_leads: c.form_leads ?? null,
    idade_min: c.idade_min ?? null,
    idade_max: c.idade_max ?? null,
    bairros_qtd: c.bairros_qtd ?? null,
    paises: c.paises ?? null,
    cidades: nomesDeGeo(c.cidades),
    meio: classificarLinhaProdutoCohapm(
      String(c.conjunto ?? c.nome ?? c.name ?? ""),
      String(c.campanha ?? ""),
    ),
  };
}

export function recortarConjuntosPorPedido(
  conjuntos: unknown[],
  pedido: string,
): { lista: unknown[]; recorte: MeioDrive | null; total_antes: number } {
  const total_antes = conjuntos.length;
  const meio = inferirMeioDrive(pedido);
  if (!meio) return { lista: conjuntos, recorte: null, total_antes };
  const filtrados = conjuntos.filter((item) => {
    const c = item && typeof item === "object" ? item as Record<string, unknown> : {};
    const linha = classificarLinhaProdutoCohapm(
      String(c.conjunto ?? c.nome ?? c.name ?? ""),
      String(c.campanha ?? ""),
    );
    return linha === meio;
  });
  return { lista: filtrados, recorte: meio, total_antes };
}

export function recortarCriativosPorPedido(
  lista: unknown[],
  pedido: string,
): { lista: unknown[]; recorte: MeioDrive | null; total_antes: number } {
  const total_antes = lista.length;
  const meio = inferirMeioDrive(pedido);
  if (!meio) return { lista, recorte: null, total_antes };
  const filtrados = lista.filter((item) => {
    const c = item && typeof item === "object" ? item as Record<string, unknown> : {};
    const linha = classificarLinhaProdutoCohapm(
      String(c.campanha ?? ""),
      String(c.anuncio ?? c.nome ?? c.name ?? ""),
    );
    return linha === meio;
  });
  return { lista: filtrados, recorte: meio, total_antes };
}

export function soAtivosDoPedido(pedido: string): boolean {
  const p = String(pedido ?? "").toLowerCase();
  return /\bativos?\b/.test(p) && !/\b(pausad|historico|todas? as campanhas)\b/.test(p);
}

export function statusEhAtivo(status: unknown): boolean {
  return String(status ?? "").trim().toUpperCase() === "ACTIVE";
}

/** Série diária enxuta: o que o gestor pede numa relação (gasto, impressão, conversa). */
export function serieDiariaEnxuta(dias: unknown[]): Record<string, unknown>[] {
  return (Array.isArray(dias) ? dias : []).map((d) => {
    const o = d && typeof d === "object" ? d as Record<string, unknown> : {};
    return {
      dia: o.dia ?? o.snapshot_date ?? null,
      gasto: o.gasto ?? null,
      impressoes: o.impressoes ?? o.impressions ?? null,
      conversas: o.conversas ?? o.messaging_started ?? null,
      formularios: o.formularios ?? o.form_leads ?? null,
    };
  });
}

export function jsonCabeNoTeto(v: unknown, teto = TETO_PAYLOAD_FERRAMENTA): boolean {
  try {
    return JSON.stringify(v).length <= teto;
  } catch {
    return false;
  }
}

/**
 * Corta a LISTA preservando JSON. Depois do compact, isto vira no-op na conta Jurídico
 * (24 conjuntos cabem). Continua existindo para contas grandes.
 */
export function cortarListaDeclarando(
  obj: Record<string, unknown>,
  campo: string,
  teto = TETO_PAYLOAD_FERRAMENTA,
): Record<string, unknown> {
  const lista = Array.isArray(obj[campo]) ? (obj[campo] as unknown[]) : null;
  if (!lista) return obj;
  const baseLen = JSON.stringify({ ...obj, [campo]: [] }).length;
  const mantidos: unknown[] = [];
  let usados = 0;
  for (const item of lista) {
    const tam = JSON.stringify(item).length + 1;
    if (baseLen + usados + tam > teto) break;
    mantidos.push(item);
    usados += tam;
  }
  const omitidos = lista.length - mantidos.length;
  const out: Record<string, unknown> = { ...obj, [campo]: mantidos, exibidos: mantidos.length };
  if (omitidos > 0) {
    out.omitidos = omitidos;
    out.aviso_corte =
      `A lista '${campo}' foi truncada: ${mantidos.length} de ${lista.length} itens enviados. ` +
      `Os ${omitidos} restantes EXISTEM no banco - nao os trate como inexistentes nem como zero.`;
  }
  return out;
}

export function aplicarCompactacaoEstrutura(
  obj: Record<string, unknown>,
  pedido: string,
  pagina = 1,
): Record<string, unknown> {
  const brutos = Array.isArray(obj.conjuntos) ? obj.conjuntos as unknown[] : [];
  const compactos = brutos.map(compactarConjuntoEstrutura);
  const recorte = recortarConjuntosPorPedido(compactos, pedido);
  const soAtivos = soAtivosDoPedido(pedido);
  const lista = soAtivos
    ? recorte.lista.filter((c) => {
      const o = c as Record<string, unknown>;
      return statusEhAtivo(o.status) && (o.entregando === true || statusEhAtivo(o.campanha_status));
    })
    : recorte.lista;
  const notaRecorte = recorte.recorte
    ? {
      recorte: recorte.recorte,
      total_antes_do_recorte: recorte.total_antes,
      nota_recorte:
        `Recorte ${recorte.recorte}: ${lista.length} conjunto(s) desta linha ` +
        `(${recorte.total_antes} na amostra da empresa).`,
    }
    : {};
  const cheio: Record<string, unknown> = {
    ...obj,
    ...notaRecorte,
    conjuntos: lista,
    pagina: 1,
    exibidos: lista.length,
    restantes: 0,
    omitidos: 0,
    total_filtrados: lista.length,
  };
  if (pagina === 1 && jsonCabeNoTeto(cheio)) return cheio;
  const TAM = 30;
  const p = Math.max(1, Number(pagina) || 1);
  const offset = (p - 1) * TAM;
  const fatia = lista.slice(offset, offset + TAM);
  return {
    ...obj,
    ...notaRecorte,
    conjuntos: fatia,
    pagina: p,
    exibidos: fatia.length,
    restantes: Math.max(0, lista.length - offset - fatia.length),
    omitidos: 0,
    total_filtrados: lista.length,
  };
}

export async function esgotarPaginasRpc(
  fetchPage: (offset: number, limit: number) => Promise<Record<string, unknown>>,
  campo: string,
  opts?: { tam?: number; max?: number },
): Promise<Record<string, unknown>> {
  const tam = Math.max(1, opts?.tam ?? 100);
  const max = Math.max(tam, opts?.max ?? 400);
  const todos: unknown[] = [];
  let last: Record<string, unknown> = {};
  let offset = 0;
  while (offset < max) {
    const data = await fetchPage(offset, tam);
    last = data && typeof data === "object" ? data : {};
    if (typeof last.erro === "string") {
      if (!todos.length) return last;
      break;
    }
    const lista = Array.isArray(last[campo]) ? last[campo] as unknown[] : [];
    todos.push(...lista);
    const restantes = Number(last.restantes ?? 0);
    if (!lista.length || restantes <= 0 || lista.length < tam) break;
    offset += tam;
  }
  return { ...last, [campo]: todos, restantes: 0, nesta_pagina: todos.length, exibidos: todos.length };
}

export function compactarItemCriativo(item: unknown): Record<string, unknown> {
  const c = item && typeof item === "object" ? item as Record<string, unknown> : {};
  const legenda = String(c.legenda ?? "");
  return {
    anuncio: c.anuncio ?? c.nome ?? c.name ?? null,
    campanha: c.campanha ?? null,
    conjunto: c.conjunto ?? c.adset ?? c.adset_name ?? null,
    campanha_ativa: c.campanha_ativa === true,
    status_anuncio: c.status_anuncio ?? c.status ?? null,
    object_type: c.object_type ?? null,
    cta: c.cta ?? null,
    destino: c.destino ?? null,
    destino_url: c.destino_url ?? null,
    gasto_acumulado: c.gasto_acumulado ?? null,
    formularios: c.formularios ?? null,
    conversas: c.conversas ?? c.messaging_started ?? null,
    impressoes: c.impressoes ?? c.impressions ?? null,
    legenda_resumo: legenda.slice(0, 180),
    legenda_foi_cortada: legenda.length > 180,
  };
}

export function aplicarCompactacaoCriativos(
  obj: Record<string, unknown>,
  pedido: string,
  pagina = 1,
): Record<string, unknown> {
  const campo = Array.isArray(obj.criativos) ? "criativos" : "anuncios";
  const brutos = Array.isArray(obj[campo]) ? obj[campo] as unknown[] : [];
  const compactos = brutos.map(compactarItemCriativo);
  const recorte = recortarCriativosPorPedido(compactos, pedido);
  const soAtivos = soAtivosDoPedido(pedido);
  const lista = soAtivos
    ? recorte.lista.filter((c) => {
      const o = c as Record<string, unknown>;
      return statusEhAtivo(o.status_anuncio) && o.campanha_ativa !== false;
    })
    : recorte.lista;
  const notaRecorte = recorte.recorte
    ? {
      recorte: recorte.recorte,
      total_antes_do_recorte: recorte.total_antes,
      nota_recorte:
        `Recorte ${recorte.recorte}: ${lista.length} peca(s) desta linha ` +
        `(${recorte.total_antes} na amostra).`,
    }
    : {};
  const cheio: Record<string, unknown> = {
    ...obj,
    ...notaRecorte,
    [campo]: lista,
    pagina: 1,
    exibidos: lista.length,
    restantes: 0,
    omitidos: 0,
    total_filtrados: lista.length,
  };
  if (pagina === 1 && jsonCabeNoTeto(cheio, 12_000)) return cheio;
  const TAM = 20;
  const p = Math.max(1, Number(pagina) || 1);
  const offset = (p - 1) * TAM;
  const fatia = lista.slice(offset, offset + TAM);
  return {
    ...obj,
    ...notaRecorte,
    [campo]: fatia,
    pagina: p,
    exibidos: fatia.length,
    restantes: Math.max(0, lista.length - offset - fatia.length),
    omitidos: 0,
    total_filtrados: lista.length,
  };
}

export function filtrarRelacaoAtivos(
  conjuntos: Record<string, unknown>[],
  anuncios: Record<string, unknown>[],
): { conjuntos: Record<string, unknown>[]; anuncios: Record<string, unknown>[] } {
  const conj = conjuntos.filter((c) => statusEhAtivo(c.status));
  const ids = new Set(conj.map((c) => String(c.conjunto_id ?? "")));
  const ads = anuncios.filter((a) =>
    statusEhAtivo(a.status) &&
    (statusEhAtivo(a.conjunto_status) || ids.has(String(a.conjunto_id ?? "")))
  );
  return { conjuntos: conj, anuncios: ads };
}

/** Monta a tabela a partir do retorno de get_detalhe_anuncios. */
export function montarRelacaoDeDetalhe(
  det: Record<string, unknown>,
  soAtivos: boolean,
): string | null {
  if (!det || typeof det !== "object") return null;
  if (typeof det.erro === "string" || det.ambiguo === true) return null;
  const camp = det.campanha && typeof det.campanha === "object"
    ? det.campanha as Record<string, unknown>
    : {};
  const jan = det.janela && typeof det.janela === "object"
    ? det.janela as Record<string, unknown>
    : {};
  let conjuntos = Array.isArray(det.conjuntos) ? det.conjuntos as Record<string, unknown>[] : [];
  let anuncios = Array.isArray(det.anuncios) ? det.anuncios as Record<string, unknown>[] : [];
  if (soAtivos) {
    const f = filtrarRelacaoAtivos(conjuntos, anuncios);
    conjuntos = f.conjuntos;
    anuncios = f.anuncios;
  }
  if (!conjuntos.length && !anuncios.length) return null;
  return markdownRelacaoPorConjunto({
    campanha: String(camp.nome ?? camp.name ?? "campanha"),
    janela: jan.date_from && jan.date_to
      ? `${jan.date_from} → ${jan.date_to}`
      : String(jan.date_to ?? ""),
    conjuntos,
    anuncios,
  });
}

function txtOrcamento(v: unknown): string {
  const n = reaisDeOrcamentoMeta(v);
  if (n == null) return "—";
  return `R$ ${n.toFixed(2)}`;
}

/** Tabela pronta para a síntese: conjuntos, depois criativos dentro de cada conjunto. */
export function markdownRelacaoPorConjunto(args: {
  campanha: string;
  janela: string;
  conjuntos: Record<string, unknown>[];
  anuncios: Record<string, unknown>[];
}): string {
  const linhasConj = [
    "| Conjunto | Status | Orçamento/dia | Gasto | Impressões | Conversas | Preço/conversa | Destino |",
    "|---|---|---:|---:|---:|---:|---:|---|",
  ];
  for (const c of args.conjuntos) {
    const tot = c.totais_janela && typeof c.totais_janela === "object"
      ? c.totais_janela as Record<string, unknown>
      : null;
    linhasConj.push(
      `| ${c.nome ?? c.conjunto ?? "—"} | ${c.status ?? "—"} | ${txtOrcamento(c.orcamento_diario_reais ?? c.orcamento_diario_centavos ?? c.daily_budget)} | ${tot?.gasto ?? c.gasto ?? "—"} | ${tot?.impressoes ?? "—"} | ${tot?.conversas ?? tot?.resultados_na_base ?? "—"} | ${tot?.custo_por_resultado ?? "—"} | ${c.destination_type ?? "—"} |`,
    );
  }

  const porConj = new Map<string, Record<string, unknown>[]>();
  for (const a of args.anuncios) {
    const k = String(a.conjunto ?? a.conjunto_id ?? "sem conjunto");
    const arr = porConj.get(k) ?? [];
    arr.push(a);
    porConj.set(k, arr);
  }
  const blocosAds: string[] = [];
  for (const [nome, ads] of porConj) {
    blocosAds.push(`### ${nome}`);
    blocosAds.push("| Anúncio | Status | Gasto | Impressões | Conversas | Preço/conversa | Destino |");
    blocosAds.push("|---|---|---:|---:|---:|---:|---|");
    for (const a of ads) {
      const tot = a.totais_janela && typeof a.totais_janela === "object"
        ? a.totais_janela as Record<string, unknown>
        : null;
      blocosAds.push(
        `| ${a.nome ?? a.ad_id ?? "—"} | ${a.status ?? "—"} | ${tot?.gasto ?? "—"} | ${tot?.impressoes ?? "—"} | ${tot?.conversas ?? tot?.resultados_na_base ?? "—"} | ${tot?.custo_por_resultado ?? "—"} | ${a.destino ?? a.destination_type ?? "—"} |`,
      );
    }
    blocosAds.push("");
  }

  return [
    `Campanha: **${args.campanha}**. Janela: **${args.janela}**.`,
    "",
    "## Conjuntos (ativos da linha)",
    ...linhasConj,
    "",
    "## Criativos por conjunto",
    ...blocosAds,
  ].join("\n");
}
