// Prova: deno run --allow-read supabase/functions/_shared/_prova_coleta_completa.ts
import {
  aplicarCompactacaoEstrutura,
  aplicarCompactacaoCriativos,
  compactarConjuntoEstrutura,
  filtrarRelacaoAtivos,
  markdownRelacaoGeo,
  markdownRelacaoPorConjunto,
  markdownTabelaConjuntos,
  montarRelacaoDeDetalhe,
  anexarTabelaMarkdownDetalhe,
  recortarConjuntosPorPedido,
  soAtivosDoPedido,
} from "./coleta_completa.ts";
import { FERRAMENTAS_BASE } from "./ferramentas_base.ts";
import { ehPedidoRelacaoGeoPublico, ehPedidoRelacaoNumerica, extrairCriteriosDoPedido, extrairNomesDeCampanhaCitados, pedidoExigeInterpretacao } from "./intencao_turno.ts";
import { casarCampanhasCitadas, resolverJanelaPedido } from "./leitura_desempenho.ts";

function assert(cond: boolean, msg: string) {
  if (!cond) throw new Error(msg);
}

const pedidoJuridico =
  "preciso que você verifique a campanha do jurídico e, apenas dos conjuntos e criativos ativos hoje, você gera pra mim uma relação mostrando os gastos, conversas geradas, impressões, preços por conversa gerada e orçamento por conjuntos e por criativos.";

assert(ehPedidoRelacaoNumerica(pedidoJuridico), "pedido do gestor e relacao numerica");
assert(soAtivosDoPedido(pedidoJuridico), "ativos hoje restringe status");
assert(soAtivosDoPedido("campanha ativa do lafelicita"), "ativa no feminino tambem restringe");

const pedidoGeo =
  "preciso que você traga pra mim uma relação geográfica de cada um dos conjuntos referentes a campanha ativa do lafelicità. traga de cada um dos conjuntos especificando como foi definido o público-alvo";
assert(ehPedidoRelacaoGeoPublico(pedidoGeo), "pedido geo/publico");
assert(!ehPedidoRelacaoNumerica(pedidoGeo), "geo nao e relacao de gasto/criativo");
assert(soAtivosDoPedido(pedidoGeo), "campanha ativa no pedido geo");

const pausaConj4 = aplicarCompactacaoCriativos({
  anuncios: [
    {
      anuncio: "WA_LAF_C4_AD10_Agosto10_V1",
      campanha: "COHAPM_LAFELICITA_CONV_WA_2026-08",
      conjunto: "LAF_WA_CONJ.4_9392-3821",
      status: "ACTIVE",
    },
    {
      anuncio: "WA_LAF_C4_AD01_Agosto01_V1",
      campanha: "COHAPM_LAFELICITA_CONV_WA_2026-08",
      conjunto: "LAF_WA_CONJ.4_9392-3821",
      status: "ACTIVE",
    },
  ],
}, "na campanha do lafelicita que esta ativa, pause os criativos do conjunto 4 e mantenha o AD10");
const nomes = (pausaConj4.anuncios as { anuncio: string }[]).map((a) => a.anuncio);
assert(nomes.includes("WA_LAF_C4_AD10_Agosto10_V1"), "AD10 ativo da La Felicita nao some no recorte");
assert(nomes.includes("WA_LAF_C4_AD01_Agosto01_V1"), "os outros ativos do conjunto 4 tambem ficam");

const gordos = Array.from({ length: 24 }, (_, i) => ({
  conjunto: i < 8 ? `JURIDICO_CONJ.${i + 1}` : `LAFELICITA_CONJ.${i}`,
  campanha: i < 8 ? "COHAPM_JURIDICO_CONV" : "COHAPM_LAFELICITA_CONV",
  status: "ACTIVE",
  campanha_status: "ACTIVE",
  entregando: true,
  daily_budget: 3000,
  targeting: { geo_locations: { cities: [{ key: "1", name: "Salvador" }], custom_locations: Array.from({ length: 40 }, () => ({ radius: 1 })) } },
  interesses: Array.from({ length: 30 }, () => ({ id: "x", name: "y" })),
  gasto: 10 + i,
}));
const compacto = aplicarCompactacaoEstrutura({ conjuntos: gordos, nota: "x" }, pedidoJuridico, 1);
const lista = compacto.conjuntos as unknown[];
assert(lista.length === 8, `recorte juridico+ativos deveria deixar 8, ficou ${lista.length}`);
assert(Number(compacto.restantes ?? 0) === 0, "lista compacta do recorte cabe numa chamada");
assert(Number(compacto.omitidos ?? 0) === 0, "nao pode omitir conjuntos do recorte");
const item = compactarConjuntoEstrutura(gordos[0]);
assert(!("interesses" in item), "targeting gordo nao entra no compacto");
assert(!("targeting" in item), "objeto targeting cru nao entra no compacto");
assert(item.orcamento_diario_reais === 30, `orcamento em reais, veio ${item.orcamento_diario_reais}`);
assert(Array.isArray(item.cidades) && String(item.cidades[0]).includes("Salvador"), "cidade sai como nome");

const recorteLf = recortarConjuntosPorPedido(
  gordos.map(compactarConjuntoEstrutura),
  "conjuntos da la felicita",
);
assert(recorteLf.lista.length === 16, "recorte LF nao pode engolir juridico");

const md = markdownRelacaoPorConjunto({
  campanha: "COHAPM_JURIDICO_CONV",
  janela: "2026-09-04 → 2026-09-17",
  conjuntos: [{
    nome: "JURIDICO_CONJ.1", status: "ACTIVE", orcamento_diario_reais: 30, destination_type: "WHATSAPP",
    totais_janela: { gasto: "R$ 12.00", impressoes: 400, conversas: 2, custo_por_resultado: "R$ 6.00" },
  }],
  anuncios: [{
    nome: "AD_JUR_01", conjunto: "JURIDICO_CONJ.1", status: "ACTIVE", destino: "https://wa.me/5571",
    totais_janela: { gasto: "R$ 12.00", impressoes: 400, conversas: 2, custo_por_resultado: "R$ 6.00" },
  }],
});
assert(md.includes("## Conjuntos"), "tabela de conjuntos");
assert(md.includes("## Criativos por conjunto"), "criativos agrupados por conjunto");
assert(md.includes("### JURIDICO_CONJ.1"), "anuncios debaixo do conjunto");
assert(md.includes("R$ 12.00"), "gasto visivel");

const soConj = markdownTabelaConjuntos({
  campanha: "COHAPM_VISTTA_CONV_WA_SET26",
  janela: "2026-09-01 → 2026-09-21",
  conjuntos: [{
    nome: "CONJ.1_VISTTA", status: "ACTIVE", orcamento_diario_reais: 60,
    totais_janela: { gasto: "R$ 498.64", impressoes: 14096, conversas: 73, custo_por_resultado: "R$ 6.83" },
  }],
});
assert(soConj.includes("R$ 6.83"), "custo por conjunto na tabela curta");
assert(!soConj.includes("## Criativos por conjunto"), "tabela curta nao lista criativo");

const comTabela = anexarTabelaMarkdownDetalhe({
  campanha: { nome: "COHAPM_VISTTA_CONV_WA_SET26" },
  janela: { date_from: "2026-09-01", date_to: "2026-09-21" },
  conjuntos: [{ nome: "CONJ.1_VISTTA", totais_janela: { custo_por_resultado: "R$ 6.83" } }],
});
assert(typeof comTabela.tabela_markdown === "string", "tabela_markdown na frente do detalhe");
assert(String(comTabela.tabela_markdown).includes("R$ 6.83"), "custo no prefixo");

const filtrado = filtrarRelacaoAtivos(
  [{ nome: "A", status: "ACTIVE", conjunto_id: "1" }, { nome: "B", status: "PAUSED", conjunto_id: "2" }],
  [
    { nome: "ad-a", status: "ACTIVE", conjunto_id: "1", conjunto_status: "ACTIVE" },
    { nome: "ad-b", status: "PAUSED", conjunto_id: "1", conjunto_status: "ACTIVE" },
  ],
);
assert(filtrado.conjuntos.length === 1 && filtrado.anuncios.length === 1, "so ACTIVE");

const rel = montarRelacaoDeDetalhe({
  campanha: { nome: "COHAPM_JURIDICO_CONV" },
  janela: { date_from: "2026-09-04", date_to: "2026-09-17" },
  conjuntos: [{ nome: "JURIDICO_CONJ.1", status: "ACTIVE", conjunto_id: "1", totais_janela: { gasto: "R$ 1.00" } }],
  anuncios: [{ nome: "AD", status: "ACTIVE", conjunto: "JURIDICO_CONJ.1", conjunto_status: "ACTIVE", totais_janela: { gasto: "R$ 1.00" } }],
}, true);
assert(!!rel && rel.includes("JURIDICO_CONJ.1"), "montar relacao a partir do detalhe");

const geoMd = markdownRelacaoGeo({
  campanha: "COHAPM_LAFELICITA_CONV_WA_2026-08",
  campanha_status: "ACTIVE",
  conjuntos: [{
    conjunto: "LAF_WA_CONJ.1_9213-6179",
    status: "ACTIVE",
    destination_type: "WHATSAPP",
    idade_min: "18",
    idade_max: "65",
    targeting: {
      age_min: 18,
      age_max: 65,
      targeting_automation: { advantage_audience: 1 },
      publisher_platforms: ["facebook", "instagram"],
      geo_locations: {
        neighborhoods: [{ key: "267730", name: "Salvador", region: "Bahia", country: "BR" }],
        location_types: ["home", "recent"],
      },
    },
  }],
});
assert(geoMd.includes("relação geográfica") || geoMd.includes("Relação geográfica"), "titulo geo");
assert(geoMd.includes("Salvador"), "nome da geo");
assert(geoMd.includes("Advantage+"), "advantage no publico");
assert(!geoMd.includes("Preço/conversa"), "geo nao despeja CPL");
assert(!geoMd.includes("## Criativos por conjunto"), "geo nao lista criativo");

const est = FERRAMENTAS_BASE.get_estrutura_conjuntos;
assert(!!est.parametros.properties && "pagina" in (est.parametros.properties as object), "pagina existe no schema");
assert(!(est.omitidos?.job ?? []).includes("pagina"), "pagina nao pode ser omitida no job");

const job = await Deno.readTextFile(new URL("../traffic-agent-job/index.ts", import.meta.url));
assert(job.includes("maxEspecialistas: 1"), "relacao numerica cabe em 1 especialista");
assert(job.includes("colherRelacaoNumerica"), "colheita deterministica no job");
assert(
  job.indexOf('"criativos"') < job.indexOf('"criativos_drive"') ||
  /"criativos",\s*\n\s*"criativos_drive"/.test(job),
  "pecas no ar entram antes do inventario Drive",
);
assert(job.includes("job-v4.31"), "versao da telemetria andou");
assert(job.includes("interpretarColheita"), "leitura do pedido nao pode pular o modelo");
assert(job.includes("pedidoExigeInterpretacao"), "colheita distingue tabela de leitura");
assert(job.includes("tetoDaLeitura"), "leitura usa o teto inteiro da invocacao");
assert(job.includes("blocoMetodoDaLeitura"), "a leitura consulta a base tecnica");
assert(!job.includes("A interpretação não fechou nesta rodada"), "codigo de timeout nao vai para o gestor");

const pedidoCinco = [
  "preciso de todos os dados desde a criação dessas campanhas até o dia de ontem, fechado. Traga custo, impressão, custo por conversa e gasto.",
  "traga também por dia, por conjunto, ativos e inativos, e por criativo, desde o momento em que a campanha trouxe dados reais até o dia de hoje, para entender como todas as campanhas estão performando.",
  "COHAPM_VISTTA_CONV_WA_SET26- SETEMBRO",
  "COHAPM_VISTTA_CONV_WA_SET26",
  "COHAPM_LAFELICITA_CONV_WA_2026-08",
  "COHAPM_JURIDICO_CONV_WA_2026-08",
  "COHAPM_LAFELICITA_CONV_WA_2026 - SETEMBRO",
].join("\n");
assert(pedidoExigeInterpretacao(pedidoCinco), "pedido longo e leitura, nao tabela pronta");
assert(ehPedidoRelacaoNumerica(pedidoCinco), "continua sendo relacao numerica");
assert(!soAtivosDoPedido(pedidoCinco), "ativos e inativos nao filtra so o que esta no ar");
assert(extrairNomesDeCampanhaCitados(pedidoCinco).length === 5, "cinco campanhas citadas");
const casa = casarCampanhasCitadas([
  { name: "COHAPM_VISTTA_CONV_WA_SET26- SETEMBRO", external_id: "1" },
  { name: "COHAPM_VISTTA_CONV_WA_SET26", external_id: "2" },
  { name: "COHAPM_LAFELICITA_CONV_WA_2026-08", external_id: "3" },
  { name: "COHAPM_JURIDICO_CONV_WA_2026-08", external_id: "4" },
  { name: "COHAPM_LAFELICITA_CONV_WA_2026 - SETEMBRO", external_id: "5" },
  { name: "COHAPM_OUTRA", external_id: "9" },
], extrairNomesDeCampanhaCitados(pedidoCinco));
assert(casa.escolhidas.length === 5 && casa.faltando.length === 0, `casamento ${casa.escolhidas.length}/${casa.faltando.length}`);
assert(new Set(casa.escolhidas.map((c) => c.external_id)).size === 5, "SET26 nao engole SETEMBRO");
const janela = resolverJanelaPedido(pedidoCinco, "2026-10-01");
assert(janela.desde_criacao, "desde a criacao nao cai em 14 dias");
assert(janela.date_to === "2026-09-30", `fechado em ontem, veio ${janela.date_to}`);
assert(janela.dia_aberto === "2026-10-01", "hoje fica em aberto");
const pedidoLf =
  "analise todos os dados desde o dia 02/10 até o dia de hoje da campanha ativa do lafelicità e me diga se a tendência dos criativos estagna. preciso atingir 107 conversas por dia e o teto limite de cada conversa gerada é 7,00. me traga o resultado.";
assert(pedidoExigeInterpretacao(pedidoLf), "analise com meta nao e so tabela");
assert(ehPedidoRelacaoNumerica(pedidoLf), "criativo + conversa + traga continua colheita");
const crit = extrairCriteriosDoPedido(pedidoLf);
assert(crit.conversasPorDia === 107 && crit.tetoCustoConversa === 7 && crit.pedeTendencia, `criterios ${JSON.stringify(crit)}`);
const janelaLf = resolverJanelaPedido(pedidoLf, "2026-10-05");
assert(janelaLf.date_from === "2026-10-02", `inicio ${janelaLf.date_from}`);
assert(janelaLf.date_to === "2026-10-04", `fechado ${janelaLf.date_to}`);
assert(janelaLf.dia_aberto === "2026-10-05", `aberto ${janelaLf.dia_aberto}`);
assert(!janelaLf.desde_criacao, "02/10 nao e desde a criacao");
const comDia = markdownRelacaoPorConjunto({
  campanha: "COHAPM_JURIDICO_CONV",
  janela: "2026-08-01 → 2026-09-30",
  soAtivos: false,
  comSerie: true,
  conjuntos: [{
    nome: "JURIDICO_CONJ.1", status: "PAUSED",
    serie_diaria: [{ dia: "2026-08-02", gasto: "R$ 4.00", impressoes: 10, conversas: 1 }],
  }],
  anuncios: [{
    nome: "AD_JUR_01", conjunto: "JURIDICO_CONJ.1", status: "PAUSED",
    serie_diaria: [
      { dia: "2026-08-02", gasto: "R$ 4.00", impressoes: 10, conversas: 1 },
      { dia: "2026-08-03", gasto: "R$ 0.00", impressoes: 0, conversas: 0 },
    ],
  }],
});
assert(comDia.includes("## Conjuntos\n"), "titulo nao mente que so ha ativos");
assert(!comDia.includes("ativos da linha"), "cabecalho antigo saiu");
assert(comDia.includes("2026-08-02"), "dia com entrega entra");
assert(!comDia.includes("2026-08-03"), "dia zerado nao entra");
assert(job.includes("colherRelacaoGeo"), "colheita geo no job");

console.log("ok coleta_completa");
