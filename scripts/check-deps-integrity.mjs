// Guarda de integridade de instalacao.
//
// Por que existe: o `xlsx` vem de um tarball do CDN do SheetJS (o npm parou de
// publicar em 0.18.5 e a correcao das duas CVE HIGH so existe no CDN). O bun
// extrai esse tarball de forma INCOMPLETA de vez em quando - ja aconteceu com
// `types/index.d.ts`, que o package.json declara em "types" mas que nao foi para
// o disco. O sintoma e um `tsc` quebrado com TS7016 "Could not find a
// declaration file for module 'xlsx'" em tres arquivos, que nao parece nem de
// longe com "a instalacao veio pela metade". Mesma classe do gotcha do
// rolldown/picomatch.
//
// Esta guarda transforma esse enigma numa mensagem com o conserto.

import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

const raiz = resolve(import.meta.dirname, "..");
const falhas = [];

/** Confere que o arquivo apontado pelo campo "types" do pacote existe de fato. */
function conferirTiposDoPacote(pacote) {
  const pkgPath = resolve(raiz, "node_modules", pacote, "package.json");
  if (!existsSync(pkgPath)) {
    falhas.push(`${pacote}: nao instalado (node_modules/${pacote}/package.json ausente)`);
    return;
  }
  const pkg = JSON.parse(readFileSync(pkgPath, "utf8"));
  const declarado = pkg.types ?? pkg.typings;
  if (!declarado) return; // pacote sem tipos proprios: nada a conferir
  const alvo = resolve(raiz, "node_modules", pacote, declarado);
  if (!existsSync(alvo)) {
    falhas.push(
      `${pacote}@${pkg.version}: package.json declara "types": "${declarado}", ` +
        `mas o arquivo NAO existe no disco (extracao incompleta).`,
    );
  }
}

for (const pacote of ["xlsx", "exceljs"]) conferirTiposDoPacote(pacote);

if (falhas.length > 0) {
  console.error("\n[check-deps-integrity] instalacao incompleta:\n");
  for (const f of falhas) console.error("  - " + f);
  console.error(
    "\nConserto (nesta ordem):\n" +
      "  bun pm cache rm\n" +
      "  rm -rf node_modules\n" +
      "  bun install\n" +
      "\nNao contorne com `declare module` nem com @ts-ignore: isso apaga os tipos\n" +
      "reais da lib e o erro volta como bug de runtime em quem le planilha.\n",
  );
  process.exit(1);
}

console.log("[check-deps-integrity] ok: tipos declarados presentes no disco.");
