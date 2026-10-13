// Prova: deno run --allow-read supabase/functions/_shared/_prova_reais_pt_br.ts
//
// 13/10/2026: a leitura de desempenho escrevia reais com ponto decimal e sem milhar
// ("R$ 29.67", "R$ 1008.70"). O texto ia cru para `totais_janela` e para a serie diaria de
// get_detalhe_anuncios/get_campaign_detail, e dali para a coluna Custo do "Ranking de
// conjuntos" do relatorio, ao lado de valores ja em pt-BR ("R$ 1.008,67"). "R$ 1.008" lido em
// pt-BR e mil e oito reais; em en-US e um real. Relatorio nao pode ter numero ambiguo.
//
// O que esta prova segura:
//   [1] a leitura emite "R$ 1.008,67" (milhar com ponto, decimal com virgula);
//   [2] todo leitor que converte o texto de volta em numero recupera o mesmo valor (ida e volta),
//       inclusive o formato antigo, que ainda pode estar em execucao gravada;
//   [3] nenhuma edge guarda copia local do formatador antigo.

import { custosDaContaPorBase, somarSnaps, totaisDe } from "./leitura_desempenho.ts";
import { brl, reaisDeTexto } from "./resposta_canonica.ts";
import { markdownRelacaoPorConjunto } from "./coleta_completa.ts";
import { rankingConjuntosRelatorio } from "./relatorios.ts";

let falhas = 0;
function assert(cond: boolean, msg: string) {
  if (!cond) {
    console.error(`  FALHOU: ${msg}`);
    falhas++;
  }
}

// [1] Formato da leitura.
const tot = somarSnaps([
  { spend: 600.5, impressions: 40000, clicks: 900, link_clicks: 400, messaging_started: 4 },
  { spend: 408.17, impressions: 20000, clicks: 300, link_clicks: 200, messaging_started: 4 },
]);
const t = totaisDe(tot, "conversas");
assert(t.gasto === "R$ 1.008,67", `gasto pt-BR: ${t.gasto}`);
assert(t.custo_por_resultado === "R$ 126,08", `custo por resultado pt-BR: ${t.custo_por_resultado}`);
assert(t.cpm === "R$ 16,81", `cpm pt-BR: ${t.cpm}`);
assert(t.cpc_link === "R$ 1,68", `cpc link pt-BR: ${t.cpc_link}`);
assert(t.cpc_todos === "R$ 0,84", `cpc todos pt-BR: ${t.cpc_todos}`);

const conta = custosDaContaPorBase(
  [
    { campaign_id: "a", spend: 1500, messaging_started: 10 },
    { campaign_id: "b", spend: 29.67, form_leads: 1, link_clicks: 3 },
  ],
  { spend: 1529.67, forms: 1, msg: 10, link: 3 },
);
assert(conta.custo_por_conversa === "R$ 150,00", `custo por conversa da conta: ${conta.custo_por_conversa}`);
assert(conta.gasto_base_do_por_conversa === "R$ 1.500,00", `gasto base conversa: ${conta.gasto_base_do_por_conversa}`);
assert(conta.custo_por_formulario === "R$ 29,67", `custo por formulario da conta: ${conta.custo_por_formulario}`);

// [2] Ida e volta: formatar e ler de novo devolve o valor arredondado a centavo.
for (const v of [0, 0.004, 0.005, 1, 29.67, 999.995, 1008.67, 12345.6, 1234567.891, -12.5]) {
  const esperado = Math.round(v * 100) / 100;
  const lido = reaisDeTexto(brl(v));
  assert(lido === esperado, `ida e volta ${v}: ${brl(v)} -> ${lido}`);
}
assert(reaisDeTexto("R$ 1008.70") === 1008.7, "formato antigo continua legivel");
assert(reaisDeTexto("R$ 29.67") === 29.67, "formato antigo sem milhar");
assert(reaisDeTexto(1008.67) === 1008.67, "numero passa direto");
assert(reaisDeTexto("sem resultado") === null, "texto sem numero nao vira zero");
assert(reaisDeTexto(null) === null, "nulo nao vira zero");

// Relatorio: o ranking le o gasto do texto e devolve o custo da leitura sem reescrever.
const ranking = rankingConjuntosRelatorio([
  {
    nome: "CONJ.1_LAF",
    campanha: "COHAPM_LAFELICITA",
    totais_janela: { gasto: t.gasto, impressoes: 60000, cliques_no_link: 600, resultados_na_base: 8, custo_por_resultado: t.custo_por_resultado },
  },
  {
    nome: "CONJ.2_LAF",
    campanha: "COHAPM_LAFELICITA",
    totais_janela: { gasto: "R$ 1008.70", impressoes: 100, cliques_no_link: 1, resultados_na_base: 0 },
  },
]);
const conj1 = ranking.linhas.find((l) => l.nome === "CONJ.1_LAF");
const conj2 = ranking.linhas.find((l) => l.nome === "CONJ.2_LAF");
assert(conj1?.gasto === 1008.67, `ranking le gasto pt-BR: ${conj1?.gasto}`);
assert(conj2?.gasto === 1008.7, `ranking le gasto no formato antigo: ${conj2?.gasto}`);
assert(ranking.markdown.includes("| R$ 1.008,67 |"), "coluna Gasto em pt-BR");
assert(ranking.markdown.includes("| R$ 126,08 |"), "coluna Custo em pt-BR");
assert(!/R\$ \d+\.\d{2}\b/.test(ranking.markdown), "nenhum valor com ponto decimal no ranking");

// Serie da relacao: dia com gasto >= R$ 1.000 sem impressao nem conversa ainda e entrega.
const md = markdownRelacaoPorConjunto({
  campanha: "COHAPM_LAFELICITA",
  janela: "2026-10-01 → 2026-10-12",
  soAtivos: false,
  comSerie: true,
  conjuntos: [{
    nome: "CONJ.1_LAF",
    status: "ACTIVE",
    orcamento_diario_centavos: 3000,
    serie_diaria: [
      { dia: "2026-10-10", gasto: "R$ 1.200,00", impressoes: 0, conversas: 0 },
      { dia: "2026-10-11", gasto: "R$ 0,00", impressoes: 0, conversas: 0 },
    ],
  }],
  anuncios: [{ nome: "AD_LAF_01", conjunto: "CONJ.1_LAF", status: "ACTIVE" }],
});
assert(md.includes("2026-10-10"), "dia de R$ 1.200,00 entra na serie");
assert(!md.includes("2026-10-11"), "dia zerado continua fora");
assert(md.includes("| R$ 30,00 |"), "orcamento na mesma tabela tambem em pt-BR");

// [3] Nenhuma copia local do formatador antigo nas edges.
const ANTIGO = /const brl = \(n: number\) => "R\$ " \+/;
for (const edge of ["traffic-chat", "traffic-agent-job"]) {
  const src = Deno.readTextFileSync(new URL(`../${edge}/index.ts`, import.meta.url));
  assert(!ANTIGO.test(src), `${edge} sem brl local de ponto decimal`);
  assert(/import \{[^}]*\bbrl\b[^}]*\} from "\.\.\/_shared\/resposta_canonica\.ts"/.test(src), `${edge} usa o brl canonico`);
}
const leitura = Deno.readTextFileSync(new URL("./leitura_desempenho.ts", import.meta.url));
assert(!ANTIGO.test(leitura), "leitura_desempenho sem brl local de ponto decimal");

if (falhas) {
  console.error(`${falhas} falha(s) em reais_pt_br`);
  Deno.exit(1);
}
console.log("ok reais_pt_br");
