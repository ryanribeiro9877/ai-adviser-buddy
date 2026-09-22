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

function nomesDeGeo(v: unknown, max = 16): string[] | null {
  if (!Array.isArray(v)) return null;
  const nomes = v
    .map((c) => {
      if (typeof c === "string") return c.trim();
      if (c && typeof c === "object") {
        const o = c as Record<string, unknown>;
        const nome = String(o.name ?? o.key ?? "").trim();
        const extra = o.radius != null
          ? ` raio ${o.radius}${o.distance_unit === "kilometer" ? "km" : o.distance_unit ? ` ${o.distance_unit}` : ""}`
          : "";
        return (nome + extra).trim();
      }
      return "";
    })
    .filter(Boolean);
  if (!nomes.length) return null;
  const uniq = [...new Set(nomes)];
  return uniq.length > max ? [...uniq.slice(0, max), `+${uniq.length - max}`] : uniq;
}

function geoDoItem(c: Record<string, unknown>): Record<string, unknown> | null {
  const t = c.targeting && typeof c.targeting === "object"
    ? c.targeting as Record<string, unknown>
    : null;
  const g = (t?.geo_locations ?? c.geo_locations ?? c.geo);
  return g && typeof g === "object" && !Array.isArray(g) ? g as Record<string, unknown> : null;
}

function nomesDePublicos(v: unknown, max = 8): string[] | null {
  if (!Array.isArray(v) || !v.length) return null;
  const nomes = v
    .map((x) => {
      if (typeof x === "string") return x.trim();
      if (x && typeof x === "object") {
        const o = x as Record<string, unknown>;
        return String(o.name ?? o.id ?? "").trim();
      }
      return "";
    })
    .filter(Boolean);
  return nomes.length ? nomes.slice(0, max) : null;
}

function nomesDeInteresses(flex: unknown, max = 12): string[] | null {
  if (!Array.isArray(flex) || !flex.length) return null;
  const names: string[] = [];
  for (const spec of flex) {
    if (!spec || typeof spec !== "object") continue;
    const o = spec as Record<string, unknown>;
    for (const key of ["interests", "behaviors", "life_events", "family_statuses", "industries", "work_positions"]) {
      const arr = o[key];
      if (!Array.isArray(arr)) continue;
      for (const x of arr) {
        const n = typeof x === "string"
          ? x
          : (x && typeof x === "object" ? String((x as Record<string, unknown>).name ?? "") : "");
        if (n.trim()) names.push(n.trim());
      }
    }
  }
  const uniq = [...new Set(names)];
  return uniq.length ? uniq.slice(0, max) : null;
}

function rotuloGenero(v: unknown): string | null {
  if (v == null) return null;
  const arr = Array.isArray(v) ? v : [v];
  if (!arr.length) return null;
  const map: Record<string, string> = { "1": "homens", "2": "mulheres" };
  const labels = arr.map((x) => map[String(x)] ?? (String(x) === "0" ? null : String(x))).filter(Boolean);
  return labels.length ? labels.join(" + ") : "sem recorte de gênero";
}

function advantageDoTargeting(t: Record<string, unknown> | null, c: Record<string, unknown>): boolean {
  const auto = (t?.targeting_automation ?? c.targeting_automation);
  if (auto && typeof auto === "object") {
    const a = auto as Record<string, unknown>;
    return a.advantage_audience === 1 || a.advantage_audience === true || a.advantage_audience === "1";
  }
  return t?.advantage_audience === true || c.advantage_audience === true;
}

/** Conjunto da RPC get_estrutura_conjuntos sem targeting gordo (objetos de raio/interesse). */
export function compactarConjuntoEstrutura(item: unknown): Record<string, unknown> {
  const c = item && typeof item === "object" ? item as Record<string, unknown> : {};
  const targeting = c.targeting && typeof c.targeting === "object"
    ? c.targeting as Record<string, unknown>
    : null;
  const geo = geoDoItem(c);
  const bairros = nomesDeGeo(c.bairros ?? geo?.neighborhoods);
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
    idade_min: c.idade_min ?? targeting?.age_min ?? null,
    idade_max: c.idade_max ?? targeting?.age_max ?? null,
    bairros_qtd: c.bairros_qtd ?? (Array.isArray(geo?.neighborhoods) ? (geo!.neighborhoods as unknown[]).length : null),
    paises: c.paises ?? geo?.countries ?? null,
    cidades: nomesDeGeo(c.cidades ?? geo?.cities),
    regioes: nomesDeGeo(c.regioes ?? geo?.regions),
    bairros,
    tipos_localizacao: c.tipos_localizacao ?? geo?.location_types ?? null,
    genders: rotuloGenero(c.genders ?? targeting?.genders),
    advantage_plus: advantageDoTargeting(targeting, c),
    publicos: nomesDePublicos(c.publicos_personalizados ?? targeting?.custom_audiences),
    publicos_excluidos: nomesDePublicos(c.publicos_excluidos ?? targeting?.excluded_custom_audiences),
    interesses_nomes: nomesDeInteresses(c.interesses ?? targeting?.flexible_spec),
    plataformas: c.plataformas ?? targeting?.publisher_platforms ?? null,
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
  const p = String(pedido ?? "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  return /\bativ[oa]s?\b/.test(p) && !/\b(pausad|historico|todas? as campanhas)\b/.test(p);
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

/** Prefixa tabela_markdown para o corte bruto de 14k nao comer os totais dos conjuntos. */
export function anexarTabelaMarkdownDetalhe(det: Record<string, unknown>): Record<string, unknown> {
  if (!det || typeof det !== "object") return det;
  if (typeof det.erro === "string" || det.ambiguo === true) return det;
  const camp = det.campanha && typeof det.campanha === "object"
    ? det.campanha as Record<string, unknown>
    : {};
  const jan = det.janela && typeof det.janela === "object"
    ? det.janela as Record<string, unknown>
    : {};
  const conjuntos = Array.isArray(det.conjuntos) ? det.conjuntos as Record<string, unknown>[] : [];
  if (!conjuntos.length) return det;
  const md = markdownTabelaConjuntos({
    campanha: String(camp.nome ?? camp.name ?? "campanha"),
    janela: jan.date_from && jan.date_to
      ? `${jan.date_from} → ${jan.date_to}`
      : String(jan.date_to ?? ""),
    conjuntos,
  });
  return { tabela_markdown: md, ...det };
}

function txtOrcamento(v: unknown): string {
  const n = reaisDeOrcamentoMeta(v);
  if (n == null) return "—";
  return `R$ ${n.toFixed(2)}`;
}

function markdownLinhasConjuntos(conjuntos: Record<string, unknown>[]): string[] {
  const linhas = [
    "| Conjunto | Status | Orçamento/dia | Gasto | Impressões | Conversas | Preço/conversa | Destino |",
    "|---|---|---:|---:|---:|---:|---:|---|",
  ];
  for (const c of conjuntos) {
    const tot = c.totais_janela && typeof c.totais_janela === "object"
      ? c.totais_janela as Record<string, unknown>
      : null;
    linhas.push(
      `| ${c.nome ?? c.conjunto ?? "—"} | ${c.status ?? "—"} | ${txtOrcamento(c.orcamento_diario_reais ?? c.orcamento_diario_centavos ?? c.daily_budget)} | ${tot?.gasto ?? c.gasto ?? "—"} | ${tot?.impressoes ?? "—"} | ${tot?.conversas ?? tot?.resultados_na_base ?? "—"} | ${tot?.custo_por_resultado ?? "—"} | ${c.destination_type ?? "—"} |`,
    );
  }
  return linhas;
}

/** Só a tabela de conjuntos — cabe na frente do JSON e sobrevive ao corte de 14k. */
export function markdownTabelaConjuntos(args: {
  campanha: string;
  janela: string;
  conjuntos: Record<string, unknown>[];
}): string {
  return [
    `Campanha: **${args.campanha}**. Janela: **${args.janela}**.`,
    "",
    "## Conjuntos",
    ...markdownLinhasConjuntos(args.conjuntos),
  ].join("\n");
}

/** Tabela pronta para a síntese: conjuntos, depois criativos dentro de cada conjunto. */
export function markdownRelacaoPorConjunto(args: {
  campanha: string;
  janela: string;
  conjuntos: Record<string, unknown>[];
  anuncios: Record<string, unknown>[];
}): string {
  const linhasConj = markdownLinhasConjuntos(args.conjuntos);

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

function txtOuTraco(v: unknown): string {
  if (v == null || v === "") return "—";
  if (Array.isArray(v)) return v.length ? v.join(", ") : "—";
  if (typeof v === "boolean") return v ? "sim" : "não";
  return String(v);
}

function textoGeoDoCompacto(c: Record<string, unknown>): string {
  const partes: string[] = [];
  const paises = c.paises;
  if (Array.isArray(paises) && paises.length) partes.push(`país ${paises.join(", ")}`);
  const cidades = c.cidades;
  if (Array.isArray(cidades) && cidades.length) partes.push(`cidade ${cidades.join(", ")}`);
  const regioes = c.regioes;
  if (Array.isArray(regioes) && regioes.length) partes.push(`região ${regioes.join(", ")}`);
  const bairros = c.bairros;
  if (Array.isArray(bairros) && bairros.length) partes.push(`bairro ${bairros.join(", ")}`);
  else if (Number(c.bairros_qtd) > 0) partes.push(`${c.bairros_qtd} bairro(s)`);
  const tipos = c.tipos_localizacao;
  if (Array.isArray(tipos) && tipos.length) {
    const rotulo = tipos.map((t) => t === "home" ? "moram" : t === "recent" ? "estiveram" : String(t)).join(" ou ");
    partes.push(`quem ${rotulo}`);
  }
  return partes.length ? partes.join(" · ") : "geo não coletado";
}

function textoPublicoDoCompacto(c: Record<string, unknown>): string {
  const idadeMin = c.idade_min ?? "—";
  const idadeMax = c.idade_max ?? "—";
  const partes = [`idade ${idadeMin}–${idadeMax}`];
  partes.push(`gênero ${txtOuTraco(c.genders)}`);
  partes.push(c.advantage_plus === true
    ? "Advantage+ audience ligado (idade/geo são ponto de partida; a Meta pode expandir)"
    : "Advantage+ audience desligado");
  const ints = c.interesses_nomes;
  partes.push(Array.isArray(ints) && ints.length ? `interesses ${ints.join(", ")}` : "sem interesses manuais");
  const pubs = c.publicos;
  partes.push(Array.isArray(pubs) && pubs.length ? `públicos ${pubs.join(", ")}` : "sem público personalizado/LAL");
  const excl = c.publicos_excluidos;
  if (Array.isArray(excl) && excl.length) partes.push(`exclui ${excl.join(", ")}`);
  const plat = c.plataformas;
  if (Array.isArray(plat) && plat.length) partes.push(`plataformas ${plat.join(", ")}`);
  return partes.join(" · ");
}

/** Tabela pronta: geo + definição de público por conjunto. Sem criativo, sem CPL. */
export function markdownRelacaoGeo(args: {
  campanha: string;
  campanha_status?: string;
  conjuntos: Record<string, unknown>[];
}): string {
  const linhas = [
    "| Conjunto | Status | Geo | Público-alvo | Destino |",
    "|---|---|---|---|---|",
  ];
  const detalhes: string[] = [];
  for (const bruto of args.conjuntos) {
    const c = compactarConjuntoEstrutura(bruto);
    const geo = textoGeoDoCompacto(c);
    const pub = textoPublicoDoCompacto(c);
    linhas.push(
      `| ${c.conjunto ?? "—"} | ${c.status ?? "—"} | ${geo} | ${pub} | ${c.destination_type ?? "—"} |`,
    );
    detalhes.push(
      `### ${c.conjunto ?? "conjunto"}`,
      `- Status: ${c.status ?? "—"} · campanha ${args.campanha_status ?? "—"} · entregando ${c.entregando === true ? "sim" : "não"}`,
      `- Geo: ${geo}`,
      `- Público: ${pub}`,
      `- Otimização: ${c.optimization_goal ?? "—"} · destino ${c.destination_type ?? "—"}`,
      "",
    );
  }
  return [
    `Campanha: **${args.campanha}**${args.campanha_status ? ` (${args.campanha_status})` : ""}.`,
    "",
    "## Relação geográfica e público-alvo por conjunto",
    ...linhas,
    "",
    ...detalhes,
  ].join("\n");
}

export function montarRelacaoGeoDeCampanha(
  campanha: { nome?: unknown; status?: unknown },
  conjuntos: Record<string, unknown>[],
  soAtivos: boolean,
): string | null {
  let lista = conjuntos.filter((c) => {
    const st = String(c.status ?? "").toUpperCase();
    return st !== "DELETED" && st !== "ARCHIVED";
  });
  if (soAtivos) lista = lista.filter((c) => statusEhAtivo(c.status));
  if (!lista.length) return null;
  return markdownRelacaoGeo({
        campanha: String(campanha.nome ?? "campanha"),
    campanha_status: campanha.status != null ? String(campanha.status) : undefined,
    conjuntos: lista,
  });
}
