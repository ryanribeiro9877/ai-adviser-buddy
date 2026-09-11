// Prova de que meta-actions executa ato Ritmo pelo portao, sem card.
//
// POR QUE EXISTE. Primeira escrita Meta da forca-tarefa. Sem esta leitura de
// fonte, um ramo que chama Graph antes do portao, ou que inserta
// approval_requests "para reusar o executor", voltaria calado — o card
// reapareceria na fila de Aprovacoes e o 403 deixaria de ser fail-closed.
//
// O scan de Graph NAO e no arquivo inteiro: modos antigos e o corpo de
// executarUmPedido tem g(`/ mais acima. A prova fecha o if (origem ritmo):
// 403 do portao acontece no ramo, e Graph so depois (via executarUmPedido,
// fora do bloco do if). Insert em approval_requests no ramo falha.
//
// Roda com: deno run --allow-read supabase/functions/_shared/_prova_ritmo_meta_actions.ts

const falhas: string[] = [];

function ok(cond: boolean, msg: string) {
  if (!cond) falhas.push(msg);
}

const src = await Deno.readTextFile(new URL("../meta-actions/index.ts", import.meta.url));

ok(
  /origem\s*===\s*"ritmo"/.test(src) || src.includes('origem=ritmo') ||
    src.includes('String(body?.origem ?? "") === "ritmo"'),
  "ramo origem === \"ritmo\" ausente em meta-actions/index.ts",
);
ok(src.includes("pode_executar_ato_ritmo"), "meta-actions tem de chamar pode_executar_ato_ritmo");
ok(src.includes("executarUmPedido"), "o loop de card tem de estar faturado em executarUmPedido");

function pularString(s: string, i: number): number {
  const q = s[i];
  if (q !== '"' && q !== "'" && q !== "`") return i;
  let j = i + 1;
  while (j < s.length) {
    if (s[j] === "\\") {
      j += 2;
      continue;
    }
    if (s[j] === q) return j + 1;
    j++;
  }
  return s.length;
}

function blocoChaves(s: string, abre: number): string {
  let depth = 0;
  for (let i = abre; i < s.length; i++) {
    const c = s[i];
    if (c === '"' || c === "'" || c === "`") {
      i = pularString(s, i) - 1;
      continue;
    }
    if (c === "/" && s[i + 1] === "/") {
      const nl = s.indexOf("\n", i);
      i = nl < 0 ? s.length - 1 : nl;
      continue;
    }
    if (c === "/" && s[i + 1] === "*") {
      const fim = s.indexOf("*/", i + 2);
      i = fim < 0 ? s.length - 1 : fim + 1;
      continue;
    }
    if (c === "{") depth++;
    else if (c === "}") {
      depth--;
      if (depth === 0) return s.slice(abre, i + 1);
    }
  }
  return "";
}

const reIf =
  /if\s*\(\s*String\(\s*body\?\.origem\s*\?\?\s*""\s*\)\s*===\s*"ritmo"\s*\)/;
const mIf = src.match(reIf);
const idxIf = mIf ? src.search(reIf) : -1;
const abre = idxIf >= 0 ? src.indexOf("{", idxIf) : -1;
const ramo = abre >= 0 ? blocoChaves(src, abre) : "";

ok(ramo.length > 0, "bloco if (origem ritmo) nao encontrado (brace-match)");

ok(ramo.includes("pode_executar_ato_ritmo"), "ramo ritmo tem de chamar pode_executar_ato_ritmo");
ok(
  /json\(\s*\{\s*error:\s*"portao_ritmo"/.test(ramo) && /,\s*403\s*\)/.test(ramo),
  'ramo ritmo tem de devolver json({ error: "portao_ritmo", porta }, 403)',
);

const idxOk = ramo.search(/ok\s*!==\s*true/) >= 0
  ? ramo.search(/ok\s*!==\s*true/)
  : ramo.search(/if\s*\(\s*!ok\s*\)/);
ok(idxOk >= 0, "ramo ritmo tem de testar ok !== true (ou if (!ok)) antes do 403");

const idx403 = ramo.search(/,\s*403\s*\)/);
const idxG = ramo.search(/g\(\s*`\//);
ok(
  idxG < 0 || (idx403 >= 0 && idx403 < idxG),
  "no ramo ritmo, 403 do portao tem de vir ANTES de qualquer g(`/ — Graph so dentro de executarUmPedido",
);
const idxExec = ramo.indexOf("executarUmPedido(");
ok(
  idx403 >= 0 && idxExec >= 0 && idx403 < idxExec,
  "403 do portao tem de retornar antes de chamar executarUmPedido (onde vive g(`/)",
);
ok(
  !/\.from\(\s*"approval_requests"\s*\)\s*\n?\s*\.insert/.test(ramo) &&
    !ramo.includes('.from("approval_requests").insert'),
  'ramo ritmo nao pode from("approval_requests").insert',
);
ok(!/skip_approval/i.test(ramo), "ramo ritmo nao pode expor skip_approval");
ok(
  ramo.includes('persistencia: "ritmo"') || ramo.includes('persistencia: "ritmo"') ||
    /persistencia:\s*"ritmo"/.test(ramo),
  'ramo ritmo tem de chamar executarUmPedido com persistencia: "ritmo"',
);

if (falhas.length > 0) {
  console.error("FALHOU: meta-actions nao executa ato Ritmo pelo portao, sem card.\n");
  for (const f of falhas) console.error(`  - ${f}`);
  Deno.exit(1);
}

console.log(
  "OK  meta-actions origem ritmo: portao 403 antes de Graph no ramo, sem insert em approval_requests.",
);
