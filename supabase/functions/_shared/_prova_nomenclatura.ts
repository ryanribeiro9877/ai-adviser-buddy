// Prova local do helper ESP-40/39 (nomenclatura). Rode: deno run supabase/functions/_shared/_prova_nomenclatura.ts
import {
  montarNomeMeta,
  resolverNomePartesDoParams,
  resolverNomeFinal,
  conferirNomeComPartes,
  classificarPapelCampanha,
} from "./nomenclatura.ts";

function assert(cond: boolean, msg: string) {
  if (!cond) throw new Error(msg);
}

const ok = montarNomeMeta({
  marca: "lev",
  canal: "lp",
  objetivo_tag: "leads",
  produto: "clt",
  papel: "teste",
  rotulo: "hook-a",
  periodo: "ago26",
}, { exigirPapel: true });
assert(ok.ok === true, "deveria montar");
if (ok.ok) {
  assert(ok.nome === "[LEV][LP][LEADS][CLT][TESTE][HOOK-A][AGO26]", `nome=${ok.nome}`);
}

const escala = montarNomeMeta({
  marca: "LEV",
  canal: "LP",
  objetivo_tag: "LEADS",
  produto: "CLT",
  papel: "ESCALA",
  periodo: "AGO26",
}, { exigirPapel: true });
assert(escala.ok && escala.nome === "[LEV][LP][LEADS][CLT][ESCALA][AGO26]", "escala");

const semPapelCamp = montarNomeMeta({
  marca: "LEV",
  canal: "LP",
  objetivo_tag: "LEADS",
  periodo: "AGO26",
}, { exigirPapel: true });
// `?? false` e nao `!` nem cast: `faltando` e opcional no tipo porque `resolverNomeFinal`
// repassa o do montado, que pode vir ausente. Aqui a ausencia tem de REPROVAR — recusa que
// nao diz qual campo falta obriga o chamador a adivinhar, e era o que o optional chaining
// deixava passar como sucesso silencioso (undefined e falsy, mas `assert` recebia
// `boolean | undefined` e o compilador estava certo em reclamar).
assert(
  !semPapelCamp.ok && (semPapelCamp.faltando?.includes("papel") ?? false),
  `papel so na sugestao composta, e a recusa tem de nomear o campo faltante; faltando=${
    JSON.stringify(semPapelCamp.ok ? null : semPapelCamp.faltando)
  }`,
);

const livre = resolverNomeFinal({ nomeLivre: "Campanha Verao RR" });
assert(livre.ok && livre.origem === "livre" && livre.nome === "Campanha Verao RR", "nome livre");

const livreGanha = resolverNomeFinal({
  nomeLivre: "Meu Nome Livre",
  params: { marca: "LEV", canal: "LP", objetivo_tag: "LEADS", periodo: "AGO26", papel: "TESTE" },
});
assert(livreGanha.ok && livreGanha.nome === "Meu Nome Livre" && livreGanha.origem === "livre", "livre > composto");

const conjSemPapel = montarNomeMeta({
  marca: "LEV",
  canal: "WPP",
  objetivo_tag: "LEADS",
  periodo: "01.05.26",
});
assert(conjSemPapel.ok && conjSemPapel.nome === "[LEV][WPP][LEADS][01.05.26]", "conjunto sem papel");

assert(classificarPapelCampanha("[LEV][LP][LEADS][CLT][TESTE][B][AGO26]") === "teste", "class teste");
assert(classificarPapelCampanha("[LEV][LP][LEADS][CLT][ESCALA][V1][AGO26]") === "escala", "class escala");
assert(classificarPapelCampanha("[LEV][LP][LEADS][CLT][TESTE-B][AGO26]") === "teste", "legacy TESTE-B");
assert(classificarPapelCampanha("[LEV][LP][LEADS][01.05.26]") === "desconhecido", "legacy sem papel");

const viaOdax = resolverNomePartesDoParams(
  { marca: "LEV", canal: "LP", periodo: "AGO26", produto: "CLT", papel: "TESTE", rotulo: "B" },
  { objetivoOdax: "OUTCOME_LEADS", exigirPapel: true },
);
assert(viaOdax.ok && viaOdax.nome === "[LEV][LP][LEADS][CLT][TESTE][B][AGO26]", "odax+papel");

const conf = conferirNomeComPartes("[LEV][LP][LEADS][ESCALA][AGO26]", {
  marca: "LEV",
  canal: "LP",
  objetivo_tag: "LEADS",
  papel: "ESCALA",
  periodo: "AGO26",
}, { exigirPapel: true });
assert(conf.ok === true, "conferir ok");

console.log("ok: _prova_nomenclatura");
