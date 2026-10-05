// Fatos da leitura: a conta que o modelo NAO deve fazer de cabeca.
//
// 05/10/2026 (La Felicità, 107 conversas/dia a no maximo R$ 7,00): a leitura recebia so os
// totais — a serie diaria ficava de fora "porque e anexada depois" — e a pergunta era de
// TENDENCIA. O modelo tinha de adivinhar a curva, e quando o relogio cortava o gestor recebia
// a tabela crua. Aqui a serie vira numero conferivel (media dos dias fechados, metade x metade,
// custo contra o teto, orcamento que a meta exige) e serve a dois fins:
//   1. bloco FATOS CALCULADOS na entrada da leitura (o modelo interpreta, nao soma);
//   2. analise de reserva, sem LLM, quando a leitura nao fecha — nunca mais so a tabela.

import { reaisDoItemDeOrcamento, statusEhAtivo } from "./coleta_completa.ts";
import type { CriteriosPedido } from "./intencao_turno.ts";

type Obj = Record<string, unknown>;

export type DiaSerie = { dia: string; gasto: number; conversas: number; parcial: boolean };

export type LinhaFatos = {
  nome: string;
  nivel: "campanha" | "conjunto" | "criativo";
  conjunto?: string;
  orcamentoDia?: number | null;
  dias: DiaSerie[];
  fechados: DiaSerie[];
  aberto: DiaSerie | null;
  gastoFechado: number;
  conversasFechado: number;
  custoFechado: number | null;
  mediaDia: number;
  primeiraMetade: { dias: string[]; conversasDia: number; custo: number | null } | null;
  segundaMetade: { dias: string[]; conversasDia: number; custo: number | null } | null;
  tendencia: "subindo" | "caindo" | "estavel" | "sem_base";
};

function num(v: unknown): number {
  if (typeof v === "number") return Number.isFinite(v) ? v : 0;
  const s = String(v ?? "").replace(/[^\d,.-]/g, "");
  if (!s) return 0;
  // "1.234,56" (pt-BR) ou "1234.56"
  const n = s.includes(",") && s.lastIndexOf(",") > s.lastIndexOf(".")
    ? Number(s.replace(/\./g, "").replace(",", "."))
    : Number(s.replace(/,/g, ""));
  return Number.isFinite(n) ? n : 0;
}

export function brl(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return "—";
  return `R$ ${n.toFixed(2).replace(".", ",")}`;
}

function um(n: number): string {
  return (Math.round(n * 10) / 10).toFixed(1).replace(".", ",");
}

function lerSerie(serie: unknown): DiaSerie[] {
  if (!Array.isArray(serie)) return [];
  return serie
    .filter((d) => d && typeof d === "object")
    .map((d) => {
      const o = d as Obj;
      return {
        dia: String(o.dia ?? o.snapshot_date ?? "").slice(0, 10),
        gasto: num(o.gasto),
        conversas: num(o.conversas),
        parcial: o.dia_parcial === true || o.dia_parcial_em_coleta === true,
      };
    })
    .filter((d) => d.dia);
}

function somarSeries(series: DiaSerie[][]): DiaSerie[] {
  const m = new Map<string, DiaSerie>();
  for (const s of series) {
    for (const d of s) {
      const a = m.get(d.dia) ?? { dia: d.dia, gasto: 0, conversas: 0, parcial: false };
      a.gasto += d.gasto;
      a.conversas += d.conversas;
      a.parcial = a.parcial || d.parcial;
      m.set(d.dia, a);
    }
  }
  return [...m.values()].sort((a, b) => a.dia.localeCompare(b.dia));
}

function metade(dias: DiaSerie[]) {
  if (!dias.length) return null;
  const g = dias.reduce((s, d) => s + d.gasto, 0);
  const c = dias.reduce((s, d) => s + d.conversas, 0);
  return { dias: dias.map((d) => d.dia), conversasDia: c / dias.length, custo: c > 0 ? g / c : null };
}

/**
 * `diasJanela` sao os dias FECHADOS da janela pedida. Criativo que estreou no meio da janela
 * conta so a partir da estreia (primeiro dia com gasto) — dia antes de existir nao e dia zero.
 */
export function linhaDeFatos(
  nome: string,
  nivel: LinhaFatos["nivel"],
  dias: DiaSerie[],
  extra: { conjunto?: string; orcamentoDia?: number | null } = {},
): LinhaFatos {
  const ordenados = [...dias].sort((a, b) => a.dia.localeCompare(b.dia));
  const estreia = ordenados.findIndex((d) => d.gasto > 0 || d.conversas > 0);
  const vivos = estreia >= 0 ? ordenados.slice(estreia) : [];
  const fechados = vivos.filter((d) => !d.parcial);
  const aberto = vivos.find((d) => d.parcial) ?? null;
  const gastoFechado = fechados.reduce((s, d) => s + d.gasto, 0);
  const conversasFechado = fechados.reduce((s, d) => s + d.conversas, 0);
  const meio = Math.floor(fechados.length / 2);
  const primeira = fechados.length >= 2 ? metade(fechados.slice(0, meio)) : null;
  const segunda = fechados.length >= 2 ? metade(fechados.slice(fechados.length - meio)) : null;
  let tendencia: LinhaFatos["tendencia"] = "sem_base";
  if (primeira && segunda) {
    const a = primeira.conversasDia;
    const b = segunda.conversasDia;
    if (a === 0 && b === 0) tendencia = "estavel";
    else if (b >= a * 1.2 && b - a >= 2) tendencia = "subindo";
    else if (b <= a * 0.8 && a - b >= 2) tendencia = "caindo";
    else tendencia = "estavel";
  }
  return {
    nome,
    nivel,
    conjunto: extra.conjunto,
    orcamentoDia: extra.orcamentoDia ?? null,
    dias: vivos,
    fechados,
    aberto,
    gastoFechado,
    conversasFechado,
    custoFechado: conversasFechado > 0 ? gastoFechado / conversasFechado : null,
    mediaDia: fechados.length ? conversasFechado / fechados.length : 0,
    primeiraMetade: primeira,
    segundaMetade: segunda,
    tendencia,
  };
}

export type FatosCampanha = {
  campanha: string;
  campanhaLinha: LinhaFatos;
  conjuntos: LinhaFatos[];
  criativos: LinhaFatos[];
  orcamentoDiaTotal: number | null;
};

/** `det` e o pacote de get_detalhe_anuncios (conjuntos + anuncios com serie_diaria). */
export function fatosDeDetalhe(det: Obj, soAtivos: boolean): FatosCampanha | null {
  if (!det || typeof det !== "object" || typeof det.erro === "string") return null;
  const camp = (det.campanha && typeof det.campanha === "object" ? det.campanha : {}) as Obj;
  let conjuntos = Array.isArray(det.conjuntos) ? det.conjuntos as Obj[] : [];
  let anuncios = Array.isArray(det.anuncios) ? det.anuncios as Obj[] : [];
  if (soAtivos) {
    conjuntos = conjuntos.filter((c) => statusEhAtivo(c.status));
    const ids = new Set(conjuntos.map((c) => String(c.conjunto_id ?? "")));
    const nomes = new Set(conjuntos.map((c) => String(c.nome ?? c.conjunto ?? "")));
    anuncios = anuncios.filter((a) =>
      statusEhAtivo(a.status) &&
      (statusEhAtivo(a.conjunto_status) || ids.has(String(a.conjunto_id ?? "")) || nomes.has(String(a.conjunto ?? "")))
    );
  }
  const temSerie = anuncios.some((a) => Array.isArray(a.serie_diaria) && a.serie_diaria.length);
  if (!temSerie) return null;

  const criativos: LinhaFatos[] = [];
  const seriesPorConj = new Map<string, DiaSerie[][]>();
  for (const a of anuncios) {
    const conj = String(a.conjunto ?? a.conjunto_id ?? "sem conjunto");
    const s = lerSerie(a.serie_diaria);
    criativos.push(linhaDeFatos(String(a.nome ?? a.ad_id ?? "anúncio"), "criativo", s, { conjunto: conj }));
    const arr = seriesPorConj.get(conj) ?? [];
    arr.push(s);
    seriesPorConj.set(conj, arr);
  }
  const linhasConj: LinhaFatos[] = [];
  let orcTotal = 0;
  let temOrc = false;
  const nomesConj = new Set<string>();
  for (const c of conjuntos) {
    const nome = String(c.nome ?? c.conjunto ?? "");
    nomesConj.add(nome);
    const orc = reaisDoItemDeOrcamento(c);
    if (orc != null && statusEhAtivo(c.status)) {
      orcTotal += orc;
      temOrc = true;
    }
    const series = seriesPorConj.get(nome) ?? seriesPorConj.get(String(c.conjunto_id ?? "")) ?? [];
    const dias = series.length ? somarSeries(series) : lerSerie(c.serie_diaria);
    linhasConj.push(linhaDeFatos(nome, "conjunto", dias, { orcamentoDia: orc }));
  }
  for (const [nome, series] of seriesPorConj) {
    if (!nomesConj.has(nome)) linhasConj.push(linhaDeFatos(nome, "conjunto", somarSeries(series)));
  }
  const nomeCamp = String(camp.nome ?? camp.name ?? "campanha");
  const campanhaLinha = linhaDeFatos(
    nomeCamp,
    "campanha",
    somarSeries(criativos.map((c) => c.dias)),
    { orcamentoDia: temOrc ? orcTotal : null },
  );
  return {
    campanha: nomeCamp,
    campanhaLinha,
    conjuntos: linhasConj,
    criativos,
    orcamentoDiaTotal: temOrc ? orcTotal : null,
  };
}

const ROTULO_TEND: Record<LinhaFatos["tendencia"], string> = {
  subindo: "subindo",
  caindo: "caindo",
  estavel: "estável",
  sem_base: "sem base (menos de 2 dias fechados)",
};

function serieCurta(l: LinhaFatos): string {
  return l.dias
    .map((d) => `${d.dia.slice(8, 10)}/${d.dia.slice(5, 7)}${d.parcial ? "*" : ""}: ${d.conversas} conv / ${brl(d.gasto)}`)
    .join(" · ");
}

function veredictoTeto(l: LinhaFatos, teto: number | null): string {
  if (teto == null) return "";
  if (l.conversasFechado === 0) return l.gastoFechado > 0 ? "sem conversa nos dias fechados (gastou sem resultado)" : "sem entrega nos dias fechados";
  const c = l.custoFechado ?? 0;
  return c <= teto ? `DENTRO do teto (${brl(c)} ≤ ${brl(teto)})` : `ESTOURA o teto (${brl(c)} = ${um(c / teto)}x ${brl(teto)})`;
}

function linhaMetades(l: LinhaFatos): string {
  if (!l.primeiraMetade || !l.segundaMetade) return "";
  const p = l.primeiraMetade;
  const s = l.segundaMetade;
  // Volume subindo com custo subindo junto e comprar conversa mais cara, nao melhorar.
  const custoSobe = p.custo != null && s.custo != null && s.custo >= p.custo * 1.2;
  const custoCai = p.custo != null && s.custo != null && s.custo <= p.custo * 0.8;
  const custo = custoSobe ? " — custo por conversa SUBIU junto" : custoCai ? " — custo por conversa caiu" : "";
  return `1ª metade (${p.dias.join(", ")}): ${um(p.conversasDia)} conv/dia a ${brl(p.custo)} · 2ª metade (${s.dias.join(", ")}): ${um(s.conversasDia)} conv/dia a ${brl(s.custo)}${custo}`;
}

/** Bloco que entra na ENTRADA da leitura. So numero calculado do que foi coletado. */
export function blocoFatosParaLeitura(fatos: FatosCampanha[], crit: CriteriosPedido): string {
  if (!fatos.length) return "";
  const teto = crit.tetoCustoConversa;
  const meta = crit.conversasPorDia;
  const out: string[] = [
    "FATOS CALCULADOS PELO SISTEMA (conta feita em codigo sobre a serie coletada; use estes numeros, nao refaca a soma). '*' = dia em aberto, fora do veredito de custo e da media.",
  ];
  for (const f of fatos) {
    const c = f.campanhaLinha;
    out.push(`\n## ${f.campanha}`);
    out.push(`Serie da campanha: ${serieCurta(c)}`);
    out.push(`Dias fechados: ${c.fechados.length} · conversas ${c.conversasFechado} · gasto ${brl(c.gastoFechado)} · media ${um(c.mediaDia)} conv/dia · custo ${brl(c.custoFechado)}`);
    if (c.fechados.length) {
      const melhor = [...c.fechados].sort((a, b) => b.conversas - a.conversas)[0];
      const pior = [...c.fechados].sort((a, b) => a.conversas - b.conversas)[0];
      out.push(`Melhor dia fechado: ${melhor.dia} (${melhor.conversas}) · pior: ${pior.dia} (${pior.conversas}) · ultimo fechado: ${c.fechados[c.fechados.length - 1].dia} (${c.fechados[c.fechados.length - 1].conversas})`);
    }
    if (c.aberto) out.push(`Dia em aberto ${c.aberto.dia}: ${c.aberto.conversas} conversas / ${brl(c.aberto.gasto)} ate a coleta (parcial).`);
    const metades = linhaMetades(c);
    if (metades) out.push(`Tendencia da campanha: ${ROTULO_TEND[c.tendencia]} — ${metades}`);
    if (f.orcamentoDiaTotal != null) out.push(`Orcamento/dia somado dos conjuntos ativos: ${brl(f.orcamentoDiaTotal)}`);
    if (meta != null) {
      const falta = meta - c.mediaDia;
      out.push(`CRITERIO 1 (meta ${meta}/dia): media fechada ${um(c.mediaDia)}/dia = ${Math.round((c.mediaDia / meta) * 100)}% da meta; faltam ${um(Math.max(0, falta))}/dia (${c.mediaDia > 0 ? um(meta / c.mediaDia) + "x o volume atual" : "sem base"}).`);
    }
    if (teto != null) {
      out.push(`CRITERIO 2 (teto ${brl(teto)}): campanha ${veredictoTeto(c, teto)}.`);
      if (meta != null) {
        out.push(`Conta da meta: ${meta} conversas x ${brl(teto)} = ${brl(meta * teto)}/dia de verba MAXIMA compativel com os dois criterios.`);
        if (c.custoFechado != null) {
          out.push(`No custo medio atual (${brl(c.custoFechado)}), ${meta}/dia exigiria ${brl(meta * c.custoFechado)}/dia; com ${f.orcamentoDiaTotal != null ? brl(f.orcamentoDiaTotal) : "o orcamento atual"} o custo atual compra ~${f.orcamentoDiaTotal != null ? um(f.orcamentoDiaTotal / c.custoFechado) : "—"} conversas/dia.`);
          out.push(`Para os dois criterios fecharem juntos, o custo precisa cair ${Math.round((1 - teto / c.custoFechado) * 100)}% (de ${brl(c.custoFechado)} para ${brl(teto)}).`);
        }
      }
    }
    out.push("\nConjuntos:");
    for (const l of f.conjuntos) {
      out.push(`- ${l.nome}${l.orcamentoDia != null ? ` (orc ${brl(l.orcamentoDia)}/dia)` : ""}: ${l.conversasFechado} conv / ${brl(l.gastoFechado)} em ${l.fechados.length} dia(s) fechado(s) · ${um(l.mediaDia)}/dia · ${veredictoTeto(l, teto) || brl(l.custoFechado)} · tendencia ${ROTULO_TEND[l.tendencia]}${linhaMetades(l) ? ` (${linhaMetades(l)})` : ""}`);
    }
    out.push("\nCriativos (por conjunto):");
    for (const l of f.criativos) {
      const amostra = l.conversasFechado < 5 ? " · AMOSTRA PEQUENA (<5 conversas): hipotese, nao veredito" : "";
      out.push(`- [${l.conjunto}] ${l.nome}: ${serieCurta(l) || "sem entrega"} → fechados ${l.conversasFechado} conv / ${brl(l.gastoFechado)} · ${veredictoTeto(l, teto) || brl(l.custoFechado)} · tendencia ${ROTULO_TEND[l.tendencia]}${amostra}`);
    }
  }
  return out.join("\n");
}

/**
 * Analise de RESERVA, deterministica. Sai quando a leitura do modelo nao fecha.
 * Responde os criterios do pedido com a conta; nao opina alem do que o numero sustenta.
 */
export function analiseDeReserva(fatos: FatosCampanha[], crit: CriteriosPedido): string {
  if (!fatos.length) return "";
  const teto = crit.tetoCustoConversa;
  const meta = crit.conversasPorDia;
  const out: string[] = [];
  for (const f of fatos) {
    const c = f.campanhaLinha;
    out.push(`## ${f.campanha}`);
    out.push(`Base: ${c.fechados.length} dia(s) fechado(s) (${c.fechados.map((d) => d.dia).join(", ") || "—"})${c.aberto ? `; ${c.aberto.dia} em aberto, fora da média e do custo` : ""}.`);
    if (meta != null) {
      out.push(`\n**Critério 1 — ${meta} conversas/dia:** média de ${um(c.mediaDia)}/dia nos dias fechados (${Math.round((c.mediaDia / meta) * 100)}% da meta). ${c.mediaDia >= meta ? "Atinge." : `Não atinge: faltam ${um(meta - c.mediaDia)}/dia.`}`);
    }
    if (teto != null) {
      out.push(`\n**Critério 2 — teto de ${brl(teto)} por conversa:** a campanha ${veredictoTeto(c, teto)}.`);
    }
    if (c.primeiraMetade && c.segundaMetade) {
      out.push(`\n**Tendência da campanha:** ${ROTULO_TEND[c.tendencia]} — ${linhaMetades(c)}.`);
    }
    if (meta != null && teto != null) {
      const linhas = [`\n**A conta dos dois critérios juntos:** ${meta} × ${brl(teto)} = ${brl(meta * teto)}/dia de verba máxima.`];
      if (f.orcamentoDiaTotal != null) linhas.push(` O orçamento somado dos conjuntos ativos é ${brl(f.orcamentoDiaTotal)}/dia.`);
      if (c.custoFechado != null) {
        linhas.push(` No custo atual (${brl(c.custoFechado)}), essa verba compra ~${um((f.orcamentoDiaTotal ?? meta * teto) / c.custoFechado)} conversas/dia; o custo precisa cair ${Math.round((1 - teto / c.custoFechado) * 100)}% para a meta fechar sem passar do teto.`);
      }
      out.push(linhas.join(""));
    }
    const ord = [...f.criativos].filter((l) => l.dias.length).sort((a, b) => (a.custoFechado ?? 1e9) - (b.custoFechado ?? 1e9));
    const dentro = ord.filter((l) => teto != null && l.custoFechado != null && l.custoFechado <= teto);
    const subindo = ord.filter((l) => l.tendencia === "subindo");
    const caindo = ord.filter((l) => l.tendencia === "caindo" || (l.gastoFechado > 0 && l.conversasFechado === 0));
    out.push("\n**Criativos:**");
    if (teto != null) {
      out.push(dentro.length
        ? `- Dentro do teto: ${dentro.map((l) => `${l.nome} (${brl(l.custoFechado)}, ${l.conversasFechado} conv${l.conversasFechado < 5 ? ", amostra pequena" : ""})`).join("; ")}.`
        : "- Nenhum criativo fechou dentro do teto nos dias fechados.");
    }
    if (subindo.length) out.push(`- Volume subindo (2ª metade > 1ª): ${subindo.map((l) => `${l.nome} (${um(l.primeiraMetade?.conversasDia ?? 0)} → ${um(l.segundaMetade?.conversasDia ?? 0)}/dia)`).join("; ")}.`);
    if (caindo.length) out.push(`- Caindo ou sem resultado: ${caindo.map((l) => `${l.nome} (${l.conversasFechado} conv / ${brl(l.gastoFechado)})`).join("; ")}.`);
    const maior = [...f.criativos].sort((a, b) => b.conversasFechado - a.conversasFechado)[0];
    if (maior && c.conversasFechado > 0) {
      out.push(`- Quem segura o volume: ${maior.nome}, ${maior.conversasFechado} de ${c.conversasFechado} conversas fechadas (${Math.round((maior.conversasFechado / c.conversasFechado) * 100)}%), a ${brl(maior.custoFechado)}.`);
    }
    if (c.fechados.length < 4) {
      out.push(`\n_Ressalva: ${c.fechados.length} dia(s) fechado(s) é pouco para cravar tendência — leia como hipótese a reconferir nos próximos dias._`);
    }
  }
  return out.join("\n");
}
