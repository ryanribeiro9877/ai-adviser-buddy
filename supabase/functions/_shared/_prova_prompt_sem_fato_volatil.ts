// deno run --allow-read supabase/functions/_shared/_prova_prompt_sem_fato_volatil.ts
//
// Varre o texto que entra no turno: descricao e parametros do fallback local, e o texto
// novo das migrations a partir da limpeza ($desc$, $dou$, $new$). Nao depende de rede.
// A mesma regra, no banco, e public.varredura_prompt_sem_fato_volatil() — o apply da
// migration levanta excecao se a tabela viva ainda tiver nome, cifra, data ou identificador.
//
// $old$ nao entra: e o trecho que a migration apaga. agent_context e agent_knowledge tambem
// nao: e la que o fato da empresa e o incidente passam a morar.

import { FERRAMENTAS_BASE } from "./ferramentas_base.ts";

const CORTE = "20261002220000";
const NOME = /cohapm|felicita|vistta|_laf_/i;
const CIFRA = /R\$/;
const DATA = /[0-9]{2}\/[0-9]{2}\/[0-9]{4}/;
const ID = /[0-9]{10,}|wa\.me\/[0-9]/;
const EXEMPLO_AG04 = /essa peca da La Felicita pode entrar na campanha do juridico/i;

function classes(texto: string): string[] {
  const achou: string[] = [];
  if (NOME.test(texto)) achou.push("nome");
  if (CIFRA.test(texto)) achou.push("cifra");
  if (DATA.test(texto)) achou.push("data");
  if (ID.test(texto)) achou.push("identificador");
  return achou;
}

function assert(cond: unknown, msg: string) {
  if (!cond) throw new Error(`FALHA: ${msg}`);
}

const falhas: string[] = [];
function registrar(onde: string, achou: string[]) {
  if (achou.length) falhas.push(`${onde}: ${achou.join(",")}`);
}

for (const [chave, f] of Object.entries(FERRAMENTAS_BASE)) {
  registrar(`fallback ${chave} descricao`, classes(f.descricao));
  registrar(`fallback ${chave} parametros`, classes(JSON.stringify(f.parametros)));
}

const raiz = new URL("../../../supabase/migrations/", import.meta.url);
const tags = ["desc", "dou", "new"];
let migrationsVarridas = 0;
let viuFuncao = false;
for await (const ent of Deno.readDir(raiz)) {
  if (!ent.name.endsWith(".sql") || ent.name < CORTE) continue;
  migrationsVarridas++;
  const sql = await Deno.readTextFile(new URL(ent.name, raiz));
  for (const tag of tags) {
    const re = new RegExp(`\\$${tag}\\$([\\s\\S]*?)\\$${tag}\\$`, "g");
    let m: RegExpExecArray | null;
    let i = 0;
    while ((m = re.exec(sql))) {
      i++;
      registrar(`${ent.name} $${tag}$ #${i}`, classes(m[1]));
    }
  }
  if (sql.includes("function public.varredura_prompt_sem_fato_volatil")) {
    viuFuncao = true;
    assert(sql.includes("cohapm|felicita|vistta|_laf_"), "a funcao SQL perdeu o padrao de nome");
    assert(sql.includes("R[$]"), "a funcao SQL perdeu o padrao de cifra");
    assert(sql.includes("[0-9]{2}/[0-9]{2}/[0-9]{4}"), "a funcao SQL perdeu o padrao de data");
    assert(sql.includes("[0-9]{10,}"), "a funcao SQL perdeu o padrao de identificador");
    assert(sql.includes("wa\\.me/[0-9]"), "a funcao SQL perdeu o padrao de wa.me");
    assert(
      sql.includes("essa peca da La Felicita pode entrar na campanha do juridico"),
      "a excecao do AG-04 saiu da funcao SQL",
    );
  }
}

assert(migrationsVarridas >= 1, "nenhuma migration de limpeza para varrer");
assert(viuFuncao, "a funcao de varredura sumiu da migration");

assert(classes(EXEMPLO_AG04.source.replace(/\\/g, "")).includes("nome") || NOME.test(
  "essa peca da La Felicita pode entrar na campanha do juridico",
), "o exemplo do AG-04 tem de ser nome, para a excecao existir");
const semExemplo = "essa peca da La Felicita pode entrar na campanha do juridico"
  .replace(EXEMPLO_AG04, "");
assert(classes(semExemplo).length === 0, "tirar o exemplo do AG-04 zera a varredura");
assert(classes("COHAPM tem tres vozes").includes("nome"), "nome de empresa reprova");
assert(classes("20 = R$ 20,00").includes("cifra"), "cifra reprova");
assert(classes("erro de 02/09/2026").includes("data"), "data reprova");
assert(classes("wa.me/5571993451315").includes("identificador"), "telefone reprova");
assert(
  classes("retorno com zero arquivos quase sempre e recorte errado, nao pasta vazia").length === 0,
  "principio nao e fato volatil",
);

if (falhas.length) {
  console.error(falhas.join("\n"));
  throw new Error(`${falhas.length} texto(s) de prompt com fato volatil`);
}

console.log("ok: _prova_prompt_sem_fato_volatil");
