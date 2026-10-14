// Prova: deno run --allow-read supabase/functions/_shared/_prova_campanha_nomeada.ts
//
// 14/10/2026: "dentro da campanha COHAPM_LAFELICITA_LEADS_LP_2026-10 faça um comparativo dos
// últimos 3 dias ... gastos, impressões e cliques no link" devolveu as 11 campanhas da linha
// La Felicità, em 01/10 → 14/10, sem dia a dia e sem cliques no link. O nome estava no meio da
// frase e o extrator só lia nome sozinho na linha.
import {
  markdownRelacaoPorConjunto,
  metricasDoPedido,
  montarRelacaoDeDetalhe,
  pedidoPedeDiaADia,
  serieDiariaEnxuta,
} from "./coleta_completa.ts";
import { ehPedidoRelacaoNumerica, pedidoExigeInterpretacao } from "./intencao_turno.ts";
import { campanhasNomeadasNoPedido, resolverJanelaPedido } from "./leitura_desempenho.ts";

function assert(cond: boolean, msg: string) {
  if (!cond) throw new Error(msg);
}

/** Celulas de uma linha de tabela markdown, ignorando o `\|` escapado dentro do nome. */
function celulas(linha: string): number {
  return linha.replace(/\\\|/g, "").split("|").length - 2;
}

// Campanhas operacionais da COHAPM em 14/10/2026 (campaigns, sem DELETED/ARCHIVED).
const CAMPS = [
  "[SALT] [LF | CONV | OBRA + GEO + LISTA | WA][03.03.26][1.ATT]",
  "[SALT] [LF | CONV | OBRA + GEO + LISTA | WA][03.03.26][2][ATT]",
  "[SALT] [LF | CONV | OBRA + GEO + LISTA | WA][03.03.26][3][ATT]",
  "[SALT] [LF | CONV | OBRA + GEO + LISTA | WA][03.03.26][4][ATT]",
  "COHAPM_JURIDICO_CONV_LEVA01",
  "COHAPM_JURIDICO_CONV_WA_2026-08",
  "COHAPM_JURIDICO_CONV_WA_2026-10",
  "COHAPM_JURIDICO_CONV_WA_2026-10",
  "COHAPM_LAFELICITA_CONV_AGO26",
  "COHAPM_LAFELICITA_CONV_WA_2026 - SETEMBRO",
  "COHAPM_LAFELICITA_CONV_WA_2026-08",
  "COHAPM_LAFELICITA_ENGAJ_TOFU_2026-10",
  "COHAPM_LAFELICITA_ENGAJ_TOFU_TESTE-CRIATIVO_2026-08",
  "COHAPM_LAFELICITA_LEADS_LP_2026-10",
  "COHAPM_OCULAR_LEADS_SITE_CAMACARI_2026-10",
  "COHAPM_VISTTA_CONV_WA_SET26",
  "COHAPM_VISTTA_CONV_WA_SET26- SETEMBRO",
  "COHAPM_VISTTA_TRAFEGO_LP_OUT26",
  "Publicação do Instagram: À noite, o Residencial...",
  "Sales Campaign",
].map((name, i) => ({ name, external_id: String(1000 + i) }));
const nomes = (l: { name?: string | null }[]) => l.map((c) => c.name);

const pedido = [
  "dentro da campanha COHAPM_LAFELICITA_LEADS_LP_2026-10 faça um comparativo dos últimos 3 dias em relação aos criativos trazendo os dados de cada um dos dias separadamente por cada criativo.",
  "dados que devem ser trazidos:",
  "gastos, impressões e cliques no link",
].join("\n");

// Continua no caminho da colheita deterministica (tabela, sem leitura do modelo).
assert(ehPedidoRelacaoNumerica(pedido), "pedido do print e relacao numerica");
assert(!pedidoExigeInterpretacao(pedido), "comparativo de numeros e tabela, nao analise");

// 1. Recorte: so a campanha nomeada, mesmo no meio da frase.
const lp = campanhasNomeadasNoPedido(CAMPS, pedido);
assert(
  JSON.stringify(nomes(lp)) === JSON.stringify(["COHAPM_LAFELICITA_LEADS_LP_2026-10"]),
  `so a LP entra, vieram ${JSON.stringify(nomes(lp))}`,
);
const setembro = campanhasNomeadasNoPedido(
  CAMPS,
  "gastos por criativo da COHAPM_VISTTA_CONV_WA_SET26- SETEMBRO na semana",
);
assert(
  JSON.stringify(nomes(setembro)) === JSON.stringify(["COHAPM_VISTTA_CONV_WA_SET26- SETEMBRO"]),
  `SET26 nao entra dentro de SET26- SETEMBRO, vieram ${JSON.stringify(nomes(setembro))}`,
);
const duas = campanhasNomeadasNoPedido(
  CAMPS,
  "compare a COHAPM_VISTTA_CONV_WA_SET26 com a COHAPM_LAFELICITA_CONV_WA_2026 - SETEMBRO",
);
assert(
  JSON.stringify(nomes(duas)) ===
    JSON.stringify(["COHAPM_VISTTA_CONV_WA_SET26", "COHAPM_LAFELICITA_CONV_WA_2026 - SETEMBRO"]),
  `duas nomeadas, na ordem do pedido, vieram ${JSON.stringify(nomes(duas))}`,
);
const homonimas = campanhasNomeadasNoPedido(CAMPS, "conjuntos da COHAPM_JURIDICO_CONV_WA_2026-10, gasto e impressões");
assert(homonimas.length === 2, `nome de duas campanhas traz as duas, vieram ${homonimas.length}`);
const salt = campanhasNomeadasNoPedido(
  CAMPS,
  "na campanha [SALT] [LF | CONV | OBRA + GEO + LISTA | WA][03.03.26][2][ATT] traga gastos por criativo",
);
assert(
  JSON.stringify(nomes(salt)) === JSON.stringify(["[SALT] [LF | CONV | OBRA + GEO + LISTA | WA][03.03.26][2][ATT]"]),
  `nome fora do padrao COHAPM_ tambem recorta, vieram ${JSON.stringify(nomes(salt))}`,
);
assert(
  campanhasNomeadasNoPedido(CAMPS, "gastos por criativo da campanha ativa do lafelicità").length === 0,
  "sem nome completo nao inventa recorte",
);

// 2. Janela: "ultimos 3 dias" sao tres dias fechados ate ontem (o last_3d da Meta).
const j = resolverJanelaPedido(pedido, "2026-10-14");
assert(j.date_from === "2026-10-11", `inicio ${j.date_from}`);
assert(j.date_to === "2026-10-13", `fim ${j.date_to}`);
assert(j.dia_aberto === null, "hoje nao entra sem o gestor pedir");
assert(j.ultimos_dias === 3, `ultimos_dias ${j.ultimos_dias}`);
const sete = resolverJanelaPedido("gastos por criativo dos ultimos 7 dias", "2026-10-14");
assert(sete.date_from === "2026-10-07" && sete.date_to === "2026-10-13", `7 dias ${sete.date_from}→${sete.date_to}`);
const tresHoje = resolverJanelaPedido("gastos por criativo nos últimos três dias até hoje", "2026-10-14");
assert(
  tresHoje.date_from === "2026-10-12" && tresHoje.date_to === "2026-10-13" && tresHoje.dia_aberto === "2026-10-14",
  `tres ate hoje ${tresHoje.date_from}→${tresHoje.date_to} aberto ${tresHoje.dia_aberto}`,
);
assert(!resolverJanelaPedido("gastos por criativo", "2026-10-14").date_from, "sem periodo continua sem inicio");

// 3. Dia a dia e metricas pedidas.
assert(pedidoPedeDiaADia(pedido), "cada um dos dias liga a serie");
assert(pedidoPedeDiaADia("gastos por dia por criativo"), "por dia");
assert(pedidoPedeDiaADia("traga o dia a dia dos criativos"), "dia a dia");
assert(!pedidoPedeDiaADia("gastos por conjunto e por criativo"), "sem dia nao liga serie");
assert(
  JSON.stringify(metricasDoPedido(pedido)) === JSON.stringify(["gasto", "impressoes", "cliques_no_link"]),
  `metricas ${JSON.stringify(metricasDoPedido(pedido))}`,
);
assert(metricasDoPedido("relação dos criativos da campanha").length === 0, "sem metrica nomeada fica o padrao");

// 4. Tabela: colunas pedidas, dia a dia com total, e nome com `|` sem quebrar a linha.
// Numeros reais do IMG_FRONTAL-ESCASSEZ_M5_V1 (120250380324330182), conferidos com a Meta.
const dias = serieDiariaEnxuta([
  { dia: "2026-10-11", gasto: "R$ 43,72", impressoes: 768, cliques_no_link: 22, conversas: 0, formularios: 0 },
  { dia: "2026-10-12", gasto: "R$ 63,31", impressoes: 1595, cliques_no_link: 40, conversas: 0, formularios: 4 },
  { dia: "2026-10-13", gasto: "R$ 47,84", impressoes: 1301, cliques_no_link: 30, conversas: 0, formularios: 1 },
]);
assert(dias[0].cliques_no_link === 22, "serie enxuta carrega clique no link");
const conjPipe = "[SALT] [LF | CONV | OBRA + GEO + LISTA | WA][03.03.26][1.ATT]";
const md = markdownRelacaoPorConjunto({
  campanha: "COHAPM_LAFELICITA_LEADS_LP_2026-10",
  campanha_status: "ACTIVE",
  janela: "2026-10-11 → 2026-10-13",
  comSerie: true,
  metricas: ["gasto", "impressoes", "cliques_no_link"],
  conjuntos: [{
    nome: conjPipe, status: "ACTIVE", orcamento_diario_reais: 100, destination_type: "WEBSITE",
    totais_janela: { gasto: "R$ 154,87", impressoes: 3664, cliques_no_link: 92, conversas: 0 },
    serie_diaria: dias,
  }],
  anuncios: [{
    nome: "IMG_FRONTAL-ESCASSEZ_M5_V1", conjunto: conjPipe, status: "ACTIVE", destino: "https://lp.exemplo",
    totais_janela: { gasto: "R$ 154,87", impressoes: 3664, cliques_no_link: 92, conversas: 0 },
    serie_diaria: dias,
  }],
});
const linhas = md.split("\n");
const cabConj = linhas.find((l) => l.startsWith("| Conjunto |"));
assert(cabConj === "| Conjunto | Status | Orçamento/dia | Gasto | Impressões | Cliques no link | Destino |", `cabecalho conjuntos: ${cabConj}`);
const linhaConj = linhas.find((l) => l.includes("[SALT]") && l.startsWith("|"));
assert(!!linhaConj && celulas(linhaConj) === 7, `linha do conjunto com pipe no nome: ${linhaConj}`);
assert(!!linhaConj && linhaConj.includes("| 92 |"), "clique no link do conjunto na coluna certa");
const cabAd = linhas.find((l) => l.startsWith("| Anúncio |"));
assert(cabAd === "| Anúncio | Status | Gasto | Impressões | Cliques no link | Destino |", `cabecalho anuncios: ${cabAd}`);
assert(!md.includes("Conversas"), "metrica nao pedida nao entra");
const iSerieAd = linhas.findIndex((l) => l.includes("Série diária — IMG_FRONTAL-ESCASSEZ_M5_V1"));
assert(iSerieAd >= 0, "serie do criativo");
assert(linhas[iSerieAd + 1] === "| Dia | Gasto | Impressões | Cliques no link |", `cabecalho serie: ${linhas[iSerieAd + 1]}`);
assert(linhas[iSerieAd + 3] === "| 2026-10-11 | R$ 43,72 | 768 | 22 |", `dia 11: ${linhas[iSerieAd + 3]}`);
assert(linhas[iSerieAd + 6] === "| **Total** | **R$ 154,87** | **3664** | **92** |", `total: ${linhas[iSerieAd + 6]}`);

// Sem metrica pedida, a tabela de sempre continua igual (so ganha o total na serie).
const padrao = markdownRelacaoPorConjunto({
  campanha: "COHAPM_JURIDICO_CONV",
  janela: "2026-09-04 → 2026-09-17",
  comSerie: true,
  conjuntos: [{ nome: "JURIDICO_CONJ.1", status: "ACTIVE", totais_janela: { gasto: "R$ 12,00", impressoes: 400, conversas: 2, custo_por_resultado: "R$ 6,00" } }],
  anuncios: [{
    nome: "AD_JUR_01", conjunto: "JURIDICO_CONJ.1", status: "ACTIVE",
    totais_janela: { gasto: "R$ 12,00", impressoes: 400, conversas: 2, custo_por_resultado: "R$ 6,00" },
    serie_diaria: [
      { dia: "2026-09-04", gasto: "R$ 4,00", impressoes: 100, conversas: 1 },
      { dia: "2026-09-05", gasto: "R$ 8,00", impressoes: 300, conversas: 1 },
    ],
  }],
});
assert(padrao.includes("| Conjunto | Status | Orçamento/dia | Gasto | Impressões | Conversas | Preço/conversa | Destino |"), "cabecalho padrao intacto");
assert(padrao.includes("| Dia | Gasto | Impressões | Conversas |"), "serie padrao intacta");
assert(padrao.includes("| **Total** | **R$ 12,00** | **400** | **2** |"), "serie padrao ganha total");

// Totais da campanha seguem as metricas pedidas.
const rel = montarRelacaoDeDetalhe({
  campanha: { nome: "COHAPM_LAFELICITA_LEADS_LP_2026-10", status: "ACTIVE" },
  janela: { date_from: "2026-10-11", date_to: "2026-10-13" },
  totais_campanha_janela: { gasto: "R$ 1.183,45", impressoes: 24973, cliques_no_link: 493, conversas: 0 },
  conjuntos: [{ nome: "TOFU", status: "ACTIVE", totais_janela: { gasto: "R$ 1.183,45" } }],
  anuncios: [],
}, false, false, ["gasto", "impressoes", "cliques_no_link"]);
assert(
  !!rel && rel.startsWith("Totais na janela: gasto R$ 1.183,45 · impressões 24973 · cliques no link 493."),
  `totais: ${rel?.split("\n")[0]}`,
);

// 5. O job usa o recorte por nome nas duas colheitas.
const job = await Deno.readTextFile(new URL("../traffic-agent-job/index.ts", import.meta.url));
const iNum = job.indexOf("async function colherRelacaoNumerica");
const iGeo = job.indexOf("async function colherRelacaoGeo");
assert(job.slice(iNum, iGeo).includes("campanhasNomeadasNoPedido("), "colheita numerica recorta pelo nome");
assert(job.slice(iNum, iGeo).includes("pedidoPedeDiaADia("), "colheita numerica liga a serie pelo pedido");
assert(job.slice(iNum, iGeo).includes("metricasDoPedido("), "colheita numerica usa as metricas pedidas");
assert(job.slice(iGeo, iGeo + 4000).includes("campanhasNomeadasNoPedido("), "colheita geo recorta pelo nome");

console.log("ok campanha_nomeada");
