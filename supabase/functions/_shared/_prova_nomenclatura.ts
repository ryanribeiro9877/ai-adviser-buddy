// Prova local do helper ESP-40 (nomenclatura). Rode: deno run supabase/functions/_shared/_prova_nomenclatura.ts
import { montarNomeMeta, resolverNomePartesDoParams, conferirNomeComPartes } from "./nomenclatura.ts";

function assert(cond: boolean, msg: string) {
  if (!cond) throw new Error(msg);
}

const ok = montarNomeMeta({
  marca: "lev",
  canal: "lp",
  objetivo_tag: "leads",
  produto: "clt",
  rotulo: "nova-01",
  periodo: "ago26",
});
assert(ok.ok === true, "deveria montar");
if (ok.ok) {
  assert(ok.nome === "[LEV][LP][LEADS][CLT][NOVA-01][AGO26]", `nome=${ok.nome}`);
}

const semProduto = montarNomeMeta({
  marca: "LEV",
  canal: "WPP",
  objetivo_tag: "LEADS",
  periodo: "01.05.26",
});
assert(semProduto.ok && semProduto.nome === "[LEV][WPP][LEADS][01.05.26]", "sem produto");

const falta = montarNomeMeta({ marca: "LEV", canal: "LP" });
assert(!falta.ok && falta.erro === "campos_de_nomenclatura_obrigatorios", "faltando");

const viaOdax = resolverNomePartesDoParams(
  { marca: "LEV", canal: "LP", periodo: "AGO26", produto: "CLT", rotulo: "TESTE-B" },
  { objetivoOdax: "OUTCOME_LEADS" },
);
assert(viaOdax.ok && viaOdax.nome === "[LEV][LP][LEADS][CLT][TESTE-B][AGO26]", "odax");

const conf = conferirNomeComPartes("[LEV][LP][LEADS][AGO26]", {
  marca: "LEV",
  canal: "LP",
  objetivo_tag: "LEADS",
  periodo: "AGO26",
});
assert(conf.ok === true, "conferir ok");

const divergiu = conferirNomeComPartes("NOME LIVRE", {
  marca: "LEV",
  canal: "LP",
  objetivo_tag: "LEADS",
  periodo: "AGO26",
});
assert(!divergiu.ok && divergiu.erro === "nome_divergiu_das_partes", "divergiu");

console.log("ok: _prova_nomenclatura");
