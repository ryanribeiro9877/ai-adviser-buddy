// deno run --allow-read supabase/functions/_shared/_prova_trava_linha_apos_limpeza.ts
//
// A limpeza tirou o nome proprio. A trava ficou: peca de uma linha em campanha de outra
// continua reprovando, no texto das cinco ferramentas e no portao que emite o card.

import {
  ERRO_CRUZAMENTO_LINHA_PRODUTO,
  recusarCruzamentoLinhaProduto,
} from "./memoria_conjunto.ts";

function assert(cond: unknown, msg: string) {
  if (!cond) throw new Error(`FALHA: ${msg}`);
}

const sql = Deno.readTextFileSync(
  new URL("../../../supabase/migrations/20261002220000_limpeza_prompts_ferramentas.sql", import.meta.url),
);

const fraseCruzamento = "Campanha ou conjunto de uma linha com peca de outra reprova — erro grave, nao aviso.";
const vezes = sql.split(fraseCruzamento).length - 1;
assert(vezes >= 3, `a frase de reprovacao apareceu ${vezes} vezes; checar_par, check_compliance e gerar_legendas precisam dela`);
assert(
  sql.includes("Peca de uma linha nunca entra em campanha ou conjunto de outra — erro grave, nao aviso."),
  "propose_action perdeu a trava",
);
assert(
  sql.includes("Cruzamento de linha reprova: erro grave, nao aviso."),
  "get_waba_status perdeu a trava",
);

const cruzado = recusarCruzamentoLinhaProduto({
  estruturaNomes: ["COHAPM_JURIDICO_CONV_LEVA01", "JURIDICO_CONJ.01 - MATURACAO"],
  pecaSinais: ["CONJ.1_LAF_8CRIATIVOS_JUNJUL26_AD01_ChegandoEmCasa_V3"],
});
assert(!cruzado.ok && cruzado.erro === ERRO_CRUZAMENTO_LINHA_PRODUTO, "peca de uma linha em campanha de outra reprova");
assert(/ERRO GRAVE/.test(cruzado.ok ? "" : cruzado.detalhe), "o veredito continua erro grave");

const alinhado = recusarCruzamentoLinhaProduto({
  estruturaNomes: ["COHAPM_LAFELICITA_CONV_AGO26", "LAFELICITA_CONJ.01"],
  pecaSinais: ["CONJ.1_LAF_8CRIATIVOS_JUNJUL26_AD01_ChegandoEmCasa_V3"],
});
assert(alinhado.ok, "peca e campanha da mesma linha passam");

const chat = Deno.readTextFileSync(new URL("../traffic-chat/index.ts", import.meta.url));
const meta = Deno.readTextFileSync(new URL("../meta-actions/index.ts", import.meta.url));
const job = Deno.readTextFileSync(new URL("../traffic-agent-job/index.ts", import.meta.url));
const mcp = Deno.readTextFileSync(new URL("../mcp-server/index.ts", import.meta.url));
for (const [nome, fonte] of [["chat", chat], ["meta-actions", meta], ["job", job], ["mcp", mcp]] as const) {
  assert(fonte.includes("recusarCruzamentoLinhaProduto"), `${nome} deixou de chamar o portao`);
}

assert(sql.includes("'interesses_imobiliario'"), "o nucleo imobiliario nao foi para conhecimento");
assert(sql.includes("Investimento imobiliario"), "a lista de termos sumiu em vez de mudar de gaveta");
assert(
  sql.includes("Pedido de imovel: leia get_conhecimento com tema interesses_imobiliario"),
  "buscar_interesses nao aponta o tema",
);

function blocos(tag: string): string[] {
  const re = new RegExp(`\\$${tag}\\$([\\s\\S]*?)\\$${tag}\\$`, "g");
  return [...sql.matchAll(re)].map((m) => m[1]);
}
const promptNovo = [...blocos("desc"), ...blocos("dou"), ...blocos("new")].join("\n");
assert(!promptNovo.includes("Investimento imobiliario"), "a lista de termos continuou na doutrina");
assert(!/R\$/.test(promptNovo), "cifra continuou no prompt novo");
assert(!/cohapm|felicita|vistta|_laf_/i.test(promptNovo), "nome de linha continuou no prompt novo");

console.log("ok: _prova_trava_linha_apos_limpeza");
