// deno run supabase/functions/_shared/_prova_memoria_conjunto.ts
import {
  escolherNomeCriativoTravado,
  ehNomeCompostoEstruturado,
  extrairNomesCriativoDaFala,
  nomeCompostoForaDeEscopoTrafego,
} from "./memoria_conjunto.ts";

function assert(cond: boolean, msg: string) {
  if (!cond) throw new Error(msg);
}

const contrato = [
  "JUR_CONV_CONJ03_AD01_Emprestimo_Pessoal_LEVA02",
  "JUR_CONV_CONJ03_AD02_Emprestimo_Conta_Corrente_LEVA02",
  "JUR_CONV_CONJ03_AD03_Cartao_Armadilha_LEVA02",
];

const extraidos = extrairNomesCriativoDaFala(
  "1. JUR_CONV_CONJ03_AD01_Emprestimo_Pessoal_LEVA02\n2. JUR_CONV_CONJ03_AD02_Emprestimo_Conta_Corrente_LEVA02\n3. JUR_CONV_CONJ03_AD03_Cartao_Armadilha_LEVA02",
);
assert(extraidos.join("|") === contrato.join("|"), "extrai os 3 nomes");

const recusa = escolherNomeCriativoTravado({
  nomePedido: "[COHAPM][WA][LEADS][JURIDICO][NOVO][AGO26]",
  nomesContrato: contrato,
  conjuntoNumero: 3,
});
assert(!recusa.ok && recusa.erro === "nome_trocado_pelo_padrao_estruturado", "recusa composto");

const ad03 = escolherNomeCriativoTravado({
  nomePedido: "",
  nomesContrato: contrato,
  nomesJaUsados: contrato.slice(0, 2),
  conjuntoNumero: 3,
});
assert(ad03.ok && ad03.nome === contrato[2], "autofill AD03");

assert(ehNomeCompostoEstruturado("[COHAPM][WA][LEADS][JURIDICO][NOVO][AGO26]"), "composto");
assert(nomeCompostoForaDeEscopoTrafego("[COHAPM][WA][LEADS][JURIDICO][NOVO][AGO26]"), "fora escopo");
assert(!nomeCompostoForaDeEscopoTrafego(contrato[2]), "livre ok");

console.log("ok: _prova_memoria_conjunto");
