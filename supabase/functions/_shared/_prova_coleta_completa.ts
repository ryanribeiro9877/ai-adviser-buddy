// Prova: deno run --allow-read supabase/functions/_shared/_prova_coleta_completa.ts
import {
  aplicarCompactacaoEstrutura,
  compactarConjuntoEstrutura,
  filtrarRelacaoAtivos,
  markdownRelacaoGeo,
  markdownRelacaoPorConjunto,
  montarRelacaoDeDetalhe,
  recortarConjuntosPorPedido,
  soAtivosDoPedido,
} from "./coleta_completa.ts";
import { FERRAMENTAS_BASE } from "./ferramentas_base.ts";
import { ehPedidoRelacaoGeoPublico, ehPedidoRelacaoNumerica } from "./intencao_turno.ts";

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
assert(job.includes("job-v4.27"), "versao da telemetria andou");
assert(job.includes("colherRelacaoGeo"), "colheita geo no job");

console.log("ok coleta_completa");
