// Prova: deno run --no-code-cache --allow-read --allow-env supabase/functions/_shared/_prova_recorte_linha_destino.ts
//
// 15/10/2026, job cb099406: "campanhas do La Felicità que derrama na LP e do sistema ocular, que
// também derrama na LP ... no dia de hoje ... não a campanha que derrama no WhatsApp". Quatro
// defeitos no mesmo pedido, e a resposta saiu vazia depois de 7 minutos:
//   (1) duas linhas no pedido = nenhuma campanha na colheita (inferirMeioDrive devolve null);
//   (2) COHAPM_OCULAR_* nao era Sistema Ocular (`\bocular\b` nao casa depois de `_`);
//   (3) "no dia de hoje" virava 14 dias;
//   (4) o especialista leu 17 ferramentas, morreu no timeout e o que leu foi jogado fora.
import { inferirMeioDrive, inferirMeiosDoPedido } from "./pedido_drive_criativos.ts";
import { classificarLinhaProdutoCohapm } from "./memoria_conjunto.ts";
import { resolverJanelaPedido } from "./leitura_desempenho.ts";
import { metricasDoPedido, serieDiariaEnxuta } from "./coleta_completa.ts";
import { ehPedidoRelacaoNumerica } from "./intencao_turno.ts";
import { destinoDaCampanha, destinoDoPedido, recortarCampanhasDaLeitura } from "./recorte_linha_destino.ts";
import { relatorioDeResgate, textoDeResgate } from "./resgate_de_coleta.ts";

let falhas = 0;
function ok(cond: boolean, msg: string) {
  if (cond) console.log(`  ok: ${msg}`);
  else {
    falhas++;
    console.error(`  FALHOU: ${msg}`);
  }
}

const PEDIDO = "traz para mim aqui as informações que você tem sobre as campanhas do La Felicità, que derrama na LP e do sistema ocular, que também derrama na LP. Traz as informações de verba por conjunto, como está a performance dos criativos no dia de hoje, a performance também da campanha e dos conjuntos no dia de hoje. Você faz essa separação sempre por conjunto e por criativo. Você traz o dado da campanha, aí traz o dado do conjunto separado, cada um. Aí traz o dado de criativos dentro do conjunto de cada um dos conjuntos separados. Nesses dados, você tem que trazer para mim o valor gasto dos criativos do conjunto e da campanha no geral, né? Que é o valor total da campanha. as impressões que tiveram, né? no dia, como é o dia de hoje, então vai ser até o momento exato que eu estou te enviando essa mensagem. Você traz para mim também... Você traz para mim também É os cliques no link que tiveram e as visitas no perfil, né? No site destino e os formulários gerados. Então você me traz esses dados aqui apenas do sistema ocular, né? Que derrama na LP e do La Felicità, campanha que derrama na LP, não a campanha que derrama no WhatsApp, é a campanha que derrama na LP.";

// Campanhas operacionais da COHAPM em 15/10/2026, com o destination_type dos conjuntos (ad_sets).
type Camp = { name: string; status: string; sets: { destination_type?: string; optimization_goal?: string }[] };
const W = { destination_type: "WEBSITE", optimization_goal: "OFFSITE_CONVERSIONS" };
const WA = { destination_type: "WHATSAPP", optimization_goal: "CONVERSATIONS" };
const CAMPS: Camp[] = [
  { name: "COHAPM_JURIDICO_CONV_WA_2026-10", status: "ACTIVE", sets: [WA] },
  { name: "COHAPM_LAFELICITA_LEADS_LP_2026-10", status: "ACTIVE", sets: [W] },
  { name: "COHAPM_OCULAR_LEADS_SITE_CAMACARI_2026-10_V2", status: "ACTIVE", sets: [W] },
  { name: "COHAPM_VISTTA_TRAFEGO_LP_OUT26", status: "ACTIVE", sets: [] },
  { name: "[SALT] [LF | CONV | OBRA + GEO + LISTA | WA][03.03.26][1.ATT]", status: "PAUSED", sets: [WA] },
  { name: "COHAPM_LAFELICITA_CONV_AGO26", status: "PAUSED", sets: [{ destination_type: "WEBSITE", optimization_goal: "LANDING_PAGE_VIEWS" }] },
  { name: "COHAPM_LAFELICITA_CONV_WA_2026 - SETEMBRO", status: "PAUSED", sets: [WA] },
  { name: "COHAPM_LAFELICITA_ENGAJ_TOFU_2026-10", status: "PAUSED", sets: [WA] },
  { name: "COHAPM_LAFELICITA_ENGAJ_TOFU_TESTE-CRIATIVO_2026-08", status: "PAUSED", sets: [{ destination_type: "UNDEFINED", optimization_goal: "LANDING_PAGE_VIEWS" }] },
  { name: "COHAPM_OCULAR_LEADS_SITE_CAMACARI_2026-10", status: "PAUSED", sets: [W] },
  { name: "COHAPM_VISTTA_CONV_WA_SET26", status: "PAUSED", sets: [WA] },
  { name: "Publicação do Instagram: À noite, o Residencial...", status: "PAUSED", sets: [{ destination_type: "INSTAGRAM_PROFILE" }] },
];
const destinoDe = (c: Camp) => destinoDaCampanha(c.name, c.sets);

console.log("[1] duas linhas no mesmo pedido");
ok(ehPedidoRelacaoNumerica(PEDIDO), "o pedido e relacao numerica (vai para a colheita)");
ok(inferirMeioDrive(PEDIDO) === null, "controle: inferirMeioDrive continua null com duas linhas (Drive nao adivinha)");
const linhas = inferirMeiosDoPedido(PEDIDO);
ok(linhas.includes("la_felicita") && linhas.includes("sistema_ocular") && linhas.length === 2, `linhas = ${linhas.join(",")}`);
ok(inferirMeioDrive("relação do jurídico por conjunto") === "juridico", "controle: uma linha so continua resolvendo");

console.log("[2] COHAPM_OCULAR_* e Sistema Ocular");
for (const n of ["COHAPM_OCULAR_LEADS_SITE_CAMACARI_2026-10_V2", "COHAPM_OCULAR_LEADS_SITE_CAMACARI_2026-10", "COHAPM_VISTTA_TRAFEGO_LP_OUT26"]) {
  ok(classificarLinhaProdutoCohapm(n) === "sistema_ocular", `${n} -> sistema_ocular`);
}
ok(classificarLinhaProdutoCohapm("COHAPM_LAFELICITA_LEADS_LP_2026-10") === "la_felicita", "controle: LAFELICITA continua La Felicità");
ok(classificarLinhaProdutoCohapm("COHAPM_JURIDICO_CONV_WA_2026-10") === "juridico", "controle: JURIDICO continua Jurídico");
ok(classificarLinhaProdutoCohapm("binocular_teste") === null, "controle: 'binocular' nao vira ocular");

console.log("[3] destino LP, com o WhatsApp negado");
ok(destinoDoPedido(PEDIDO) === "lp", `destino do pedido = ${destinoDoPedido(PEDIDO)}`);
ok(destinoDoPedido("relação da campanha do La Felicità que derrama no WhatsApp por conjunto") === "whatsapp", "WhatsApp afirmado -> whatsapp");
ok(destinoDoPedido("gasto por conjunto das campanhas de LP e de WhatsApp do jurídico") === null, "LP e WhatsApp juntos -> sem recorte de destino");
ok(destinoDoPedido("gasto e visitas na LP por conjunto do La Felicità") === null, "'visitas na LP' e metrica, nao destino");
ok(destinoDaCampanha("COHAPM_VISTTA_TRAFEGO_LP_OUT26", []) === "lp", "sem conjunto no espelho, o nome _LP_ decide");
ok(destinoDaCampanha("X", [W, WA]) === null, "conjuntos com destinos misturados -> nao adivinha");

console.log("[4] o recorte do pedido real");
const rec = recortarCampanhasDaLeitura(CAMPS, PEDIDO, destinoDe);
const nomes = rec.alvos.map((c) => c.name).sort();
const esperado = [
  "COHAPM_LAFELICITA_CONV_AGO26",
  "COHAPM_LAFELICITA_ENGAJ_TOFU_TESTE-CRIATIVO_2026-08",
  "COHAPM_LAFELICITA_LEADS_LP_2026-10",
  "COHAPM_OCULAR_LEADS_SITE_CAMACARI_2026-10",
  "COHAPM_OCULAR_LEADS_SITE_CAMACARI_2026-10_V2",
  "COHAPM_VISTTA_TRAFEGO_LP_OUT26",
].sort();
ok(JSON.stringify(nomes) === JSON.stringify(esperado), `alvos = ${nomes.join(" | ")}`);
ok(!nomes.some((n) => /JURIDICO|_WA_|\bWA\]|TOFU_2026-10/.test(n)), "nenhuma campanha de WhatsApp nem do Jurídico");
ok(rec.fora_do_destino.some((f) => f.nome === "COHAPM_LAFELICITA_CONV_WA_2026 - SETEMBRO" && f.destino === "whatsapp"), "as de WhatsApp da linha vao declaradas como fora do recorte");
const so1 = recortarCampanhasDaLeitura(CAMPS, "relação por conjunto do sistema ocular", destinoDe).alvos.map((c) => c.name);
ok(so1.includes("COHAPM_OCULAR_LEADS_SITE_CAMACARI_2026-10_V2"), "pedido so do ocular agora traz a OCULAR_LEADS_SITE (antes so as VISTTA)");
ok(recortarCampanhasDaLeitura(CAMPS, "gasto por conjunto e criativo", destinoDe).alvos.length === 0, "controle: sem linha e sem destino continua vazio (o especialista decide)");

console.log("[5] janela: 'no dia de hoje' e so hoje");
const j = resolverJanelaPedido(PEDIDO, "2026-10-15");
ok(j.date_from === "2026-10-15" && j.date_to === "2026-10-15" && j.dia_aberto === "2026-10-15", `janela = ${JSON.stringify(j)}`);
const j3 = resolverJanelaPedido("comparativo dos últimos 3 dias por criativo", "2026-10-15");
ok(j3.date_from === "2026-10-12" && j3.date_to === "2026-10-14" && j3.dia_aberto === null, "controle: ultimos 3 dias intacto");
const jAte = resolverJanelaPedido("desde o dia 02/10 até o dia de hoje por conjunto", "2026-10-15");
ok(jAte.date_from === "2026-10-02" && jAte.dia_aberto === "2026-10-15", "controle: 'desde 02/10 ate o dia de hoje' intacto");
const jOntem = resolverJanelaPedido("compare ontem com o dia de hoje por criativo", "2026-10-15");
ok(jOntem.date_from !== "2026-10-15", "controle: 'ontem com o dia de hoje' nao vira so hoje");

console.log("[6] colunas pedidas, com visitas na LP");
const m = metricasDoPedido(PEDIDO);
for (const c of ["gasto", "impressoes", "cliques_no_link", "visitas_lp", "formularios"]) {
  ok(m.includes(c as never), `coluna ${c}`);
}
ok(!m.includes("conversas" as never), "sem coluna de conversas (o pedido e de LP)");
ok(serieDiariaEnxuta([{ dia: "2026-10-15", visualizacoes_lp: 12 }])[0].visitas_lp === 12, "serie diaria carrega visitas na LP");

console.log("[7] especialista que leu e nao escreveu");
const detalhe = {
  campanha: { nome: "COHAPM_LAFELICITA_LEADS_LP_2026-10", status: "ACTIVE" },
  janela: { date_from: "2026-10-15", date_to: "2026-10-15" },
  totais_campanha_janela: { gasto: "R$ 227,19", impressoes: 9876 },
  conjuntos: [{ conjunto_id: "1", nome: "CONJ.1_LAF", status: "ACTIVE", orcamento_diario_reais: 120, totais_janela: { gasto: "R$ 227,19", impressoes: 9876 } }],
  anuncios: [{ ad_id: "a1", nome: "AD_LAF_01", status: "ACTIVE", conjunto: "CONJ.1_LAF", conjunto_id: "1", totais_janela: { gasto: "R$ 100,00", impressoes: 4000 } }],
};
const t = textoDeResgate("get_detalhe_anuncios", detalhe);
ok(!!t && t.includes("AD_LAF_01") && t.includes("CONJ.1_LAF") && t.includes("R$ 100,00"), "get_detalhe_anuncios vira a tabela de conjunto e criativo");
ok(textoDeResgate("get_detalhe_anuncios", { erro: "x" }) === null, "retorno com erro nao e resgatado");
ok(textoDeResgate("get_conhecimento", { conteudo: "doutrina" }) === null, "doutrina nao e dado da conta");
const rel = relatorioDeResgate("openrouter_timeout_146323", [t!, t!]);
ok(!!rel && rel.includes("AD_LAF_01") && rel.includes("LACUNAS:"), "relatorio de resgate traz os numeros e fecha com LACUNAS");
ok(rel!.split("AD_LAF_01").length === 2, "leitura repetida entra uma vez so");
ok(relatorioDeResgate("x", []) === null, "sem nada lido, continua lacuna (nao inventa relatorio)");

console.log("[8] o job usa tudo isso (fonte)");
const job = await Deno.readTextFile(new URL("../traffic-agent-job/index.ts", import.meta.url));
const iNum = job.indexOf("async function colherRelacaoNumerica");
const corpoNum = job.slice(iNum, job.indexOf("function instrucaoDaLeitura", iNum));
ok(corpoNum.includes("recortarCampanhasDaLeitura") && !corpoNum.includes("inferirMeioDrive("), "colheita numerica recorta por todas as linhas e destino");
ok(corpoNum.includes("atualizarHojeNoEspelho") && corpoNum.includes("horaDoDadoDoDia"), "colheita de hoje pede o dia ao Pipeboard e diz a hora do dado");
ok(corpoNum.includes("campanhasComEntregaNaJanela"), "pausada sem entrega na janela fica fora, declarada");
ok(job.includes("colherRelacaoNumerica({ companyId, pedido: pergunta, mcpKey })"), "a chave vai para a colheita");
const iGeo = job.indexOf("async function colherRelacaoGeo");
ok(job.slice(iGeo, iGeo + 2500).includes("recortarCampanhasDaLeitura"), "colheita de geo usa o mesmo recorte");
ok(job.includes("relatorioDeResgate(motivo, colhidos)") && job.includes("textoDeResgate(nomeTc, result)"), "especialista guarda o que leu e resgata sem relatorio");
ok(job.includes("if (r.resgate) {"), "a sintese recebe o rotulo de RESGATE, nao de falha");

if (falhas) {
  console.error(`\n_prova_recorte_linha_destino: ${falhas} falha(s)`);
  Deno.exit(1);
}
console.log("\n_prova_recorte_linha_destino: tudo ok");
