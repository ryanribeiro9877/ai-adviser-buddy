// deno run --allow-read supabase/functions/_shared/_prova_linha_produto.ts
// P0 25/08/2026: peca La Felicità NUNCA entra em campanha/conjunto Jurídico (e o inverso).
import {
  ERRO_CRUZAMENTO_LINHA_PRODUTO,
  classificarLinhaProdutoCohapm,
  escolherConjuntosDaMesmaLinha,
  recusarCruzamentoLinhaProduto,
} from "./memoria_conjunto.ts";

function assert(cond: unknown, msg: string) {
  if (!cond) throw new Error(`FALHA: ${msg}`);
}

const pecaLafAd01 = "CONJ.1_LAF_8CRIATIVOS_JUNJUL26_AD01_ChegandoEmCasa_V3";
const pecaLafAd02 = "CONJ.1_LAF_8CRIATIVOS_JUNJUL26_AD02_FamiliaGourmet_V1";
const campJur = "COHAPM_JURIDICO_CONV_LEVA01";
const setJur = "JURIDICO_CONJ.01 - MATURACAO";
const campLaf = "COHAPM_LAFELICITA_CONV_AGO26";
const setLaf = "LAFELICITA_CONJ.01 - DESCOBERTA";
const pecaJur = "JUR_CONV_CONJ03_AD01_Emprestimo_Pessoal_LEVA02";

assert(classificarLinhaProdutoCohapm(pecaLafAd01) === "la_felicita", "_LAF_ no nome do criativo");
assert(classificarLinhaProdutoCohapm(pecaLafAd02) === "la_felicita", "AD02 LAF");
assert(classificarLinhaProdutoCohapm("CONJ.1_LAF_8CRIATIVOS_JUN/JUL26") === "la_felicita", "pasta slate LAF");
assert(classificarLinhaProdutoCohapm(campJur) === "juridico", "campanha JURIDICO");
assert(classificarLinhaProdutoCohapm(setJur) === "juridico", "conjunto JURIDICO_CONJ.01");
assert(classificarLinhaProdutoCohapm(campLaf) === "la_felicita", "campanha LAFELICITA");
assert(classificarLinhaProdutoCohapm(pecaJur) === "juridico", "JUR_CONV_ criativo");
assert(classificarLinhaProdutoCohapm("imovel") === "la_felicita", "produto imovel");
assert(classificarLinhaProdutoCohapm("Traffic Campaign") === null, "sem sinal");
assert(classificarLinhaProdutoCohapm("CONJ.1 sem marca") === null, "CONJ.N sozinho nao classifica");

const incidente = recusarCruzamentoLinhaProduto({
  estruturaNomes: [campJur, setJur],
  pecaSinais: [pecaLafAd01, "CONJ.1_LAF_8CRIATIVOS_JUN/JUL26"],
});
assert(!incidente.ok && incidente.erro === ERRO_CRUZAMENTO_LINHA_PRODUTO, "incidente 25/08 recusa");
assert(/ERRO GRAVE/.test(incidente.ok ? "" : incidente.detalhe), "copy diz ERRO GRAVE");
assert(/La Felicit/i.test(incidente.ok ? "" : incidente.detalhe), "nomeia La Felicita");
assert(/Jur[ií]dico/i.test(incidente.ok ? "" : incidente.detalhe), "nomeia Juridico");
assert(incidente.ok === false && incidente.detalhe.includes(campJur), "cita campanha escolhida");
assert(incidente.ok === false && incidente.detalhe.includes(pecaLafAd01), "cita a peca");

const inverso = recusarCruzamentoLinhaProduto({
  estruturaNomes: [campLaf, setLaf],
  pecaSinais: [pecaJur],
});
assert(!inverso.ok && inverso.erro === ERRO_CRUZAMENTO_LINHA_PRODUTO, "inverso JUR→LAF recusa");

const okLaf = recusarCruzamentoLinhaProduto({
  estruturaNomes: [campLaf, setLaf],
  pecaSinais: [pecaLafAd01],
});
assert(okLaf.ok, "LAF em LAF passa");

const okJur = recusarCruzamentoLinhaProduto({
  estruturaNomes: [campJur, setJur],
  pecaSinais: [pecaJur],
});
assert(okJur.ok, "JUR em JUR passa");

const incompleto = recusarCruzamentoLinhaProduto({
  estruturaNomes: [campJur, setJur],
  pecaSinais: ["01. Chegando em casa.mp4"],
});
assert(incompleto.ok, "sem sinal na peca nao inventa recusa");

const hits = [
  { name: setJur, campaign: campJur, created_at: "2026-08-25T17:00:00Z" },
  { name: setLaf, campaign: campLaf, created_at: "2026-08-20T10:00:00Z" },
];
const alinhados = escolherConjuntosDaMesmaLinha(hits, [pecaLafAd01], (h) => h.campaign);
assert(alinhados.length === 1 && alinhados[0].name === setLaf, "auto-pick CONJ.1 prefere LAF, nao o Juridico mais novo");

const soJur = escolherConjuntosDaMesmaLinha(
  [{ name: setJur, campaign: campJur, created_at: "2026-08-25T17:00:00Z" }],
  [pecaLafAd01],
  (h) => h.campaign,
);
assert(soJur.length === 0, "nao escolhe Juridico quando a peca e LAF");

const chat = Deno.readTextFileSync(new URL("../traffic-chat/index.ts", import.meta.url));
const meta = Deno.readTextFileSync(new URL("../meta-actions/index.ts", import.meta.url));
const job = Deno.readTextFileSync(new URL("../traffic-agent-job/index.ts", import.meta.url));
const mcp = Deno.readTextFileSync(new URL("../mcp-server/index.ts", import.meta.url));
assert(chat.includes("recusarCruzamentoLinhaProduto"), "traffic-chat chama o gate na emissao");
assert(chat.includes("if (cruzAd) return cruzAd"), "criar_anuncio recusa ANTES do card");
assert(meta.includes("recusarCruzamentoLinhaProduto"), "meta-actions chama o gate no apply");
assert(meta.includes("nomesDestinoEspelhoCohapm"), "apply resolve nomes no espelho");
assert(job.includes("recusarCruzamentoLinhaProduto"), "job checa cruzamento em compliance");
assert(mcp.includes("recusarCruzamentoLinhaProduto"), "mcp checar_par recusa cruzamento");
assert(chat.includes("cruzamento_linha_produto") || chat.includes("ERRO_CRUZAMENTO_LINHA_PRODUTO"), "erro nomeado no chat");
assert(/ERRO GRAVE/.test(chat), "prompt do chat trata como erro grave");

console.log("ok: _prova_linha_produto");
