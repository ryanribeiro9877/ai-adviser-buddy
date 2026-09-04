// Gate de dead-code para o `verify`. Knip (oxc-resolver) falha neste host
// Windows com ERR_DLOPEN_FAILED no binding nativo; ts-prune cobre o mesmo
// escopo de exports nao referenciados no TypeScript do front.
//
// Exit 0 se so restarem entrypoints / gerados conhecidos.
// Exit 1 se aparecer export "morto" fora da allowlist.

import { execFileSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const ALLOW = [
  /[/\\]vite\.config\.ts:\d+ - default$/,
  /[/\\]src[/\\]router\.tsx:\d+ - getRouter$/,
  /[/\\]src[/\\]server\.ts:\d+ - default$/,
  /[/\\]src[/\\]start\.ts:\d+ - startInstance$/,
  /[/\\]src[/\\]integrations[/\\]supabase[/\\]types\.ts:\d+ - (TablesInsert|TablesUpdate|Constants)$/,
];

let out = "";
try {
  out = execFileSync("bunx", ["ts-prune", "-p", "tsconfig.json"], {
    cwd: root,
    encoding: "utf8",
    shell: true,
  });
} catch (e) {
  out = String(e.stdout ?? e.message ?? "");
}

const lines = out
  .split(/\r?\n/)
  .map((l) => l.trim())
  .filter((l) => l && !l.includes("used in module"));

const unexpected = lines.filter((l) => !ALLOW.some((re) => re.test(l)));

if (unexpected.length) {
  console.error("[check-deadcode] exports sem referencia fora da allowlist:");
  for (const l of unexpected) console.error(" ", l);
  process.exit(1);
}

console.log(`[check-deadcode] ok: ${lines.length} entry/gen allowlisted, 0 unexpected.`);
