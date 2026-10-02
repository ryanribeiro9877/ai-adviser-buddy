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
const PESSOA = /\bRoberto\b/i;
const CIFRA = /R\$/;
const DATA = /[0-9]{2}\/[0-9]{2}\/[0-9]{4}/;
const ID = /[0-9]{10,}|wa\.me\/[0-9]/;
const EXEMPLO_AG04 = "essa peca da La Felicita pode entrar na campanha do juridico";
const DATAS_AG06 = ["01/09/2026", "10/09/2026"];

function classes(texto: string): string[] {
  const achou: string[] = [];
  if (NOME.test(texto)) achou.push("nome");
  if (PESSOA.test(texto)) achou.push("nome_pessoa");
  if (CIFRA.test(texto)) achou.push("cifra");
  if (DATA.test(texto)) achou.push("data");
  if (ID.test(texto)) achou.push("identificador");
  return achou;
}

// Excecao por codigo e campo. A frase do AG-04 em outro agente continua achado.
// As duas datas do AG-06 sao arquitetura; uma data nova no mesmo campo continua achado.
function textoVarrido(texto: string, codigo?: string, campo?: string): string {
  let t = texto;
  if (codigo === "AG-04" && campo === "exemplos") {
    t = t.replace(new RegExp(EXEMPLO_AG04, "i"), "");
  }
  if (codigo === "AG-06" && campo === "limites") {
    for (const data of DATAS_AG06) t = t.split(data).join("");
  }
  return t;
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
  }
}

assert(migrationsVarridas >= 1, "nenhuma migration de limpeza para varrer");
assert(viuFuncao, "a funcao de varredura sumiu da migration");

const varreduraNova = await Deno.readTextFile(
  new URL("20261002231000_varredura_enxerga_as_personas.sql", raiz),
);
assert(varreduraNova.includes("'escopo'"), "a varredura nao devolve o que varreu");
assert(varreduraNova.includes("\\mRoberto\\M"), "a funcao SQL perdeu o nome de pessoa");
assert(
  varreduraNova.includes("chave = 'AG-04' and campo = 'exemplos'"),
  "a excecao do AG-04 deixou de ser por codigo e campo",
);
assert(varreduraNova.includes("personas vigentes"), "o escopo das personas nao esta declarado");
assert(varreduraNova.includes("chave = 'AG-06' and campo = 'limites'"), "a excecao do AG-06 nao e por codigo");
assert(varreduraNova.includes("01/09/2026"), "a data de arquitetura do AG-06 saiu da excecao");
assert(varreduraNova.includes("10/09/2026"), "a data do comentario saiu da excecao");
assert(varreduraNova.includes("escopo da varredura veio zero"), "escopo zero passa em silencio");
assert(!varreduraNova.includes("(ex.: Roberto)"), "o exemplo de pessoa voltou para o parametro");
assert(
  varreduraNova.includes("CONVERSAO FINAL NAO EXISTE NESTE SISTEMA:"),
  "a regra do AG-02 sumiu junto com a atribuicao",
);
assert(
  !/desde 28\/07\/2026, por decisao da empresa/.test(
    varreduraNova.slice(0, varreduraNova.indexOf("drop function")),
  ),
  "o AG-02 ainda atribui a regra a uma empresa",
);

assert(classes(EXEMPLO_AG04).includes("nome"), "o exemplo do AG-04 tem de ser nome, para a excecao existir");
assert(
  classes(textoVarrido(EXEMPLO_AG04, "AG-04", "exemplos")).length === 0,
  "no AG-04, no campo exemplos, a frase e excecao",
);
assert(
  classes(textoVarrido(EXEMPLO_AG04, "AG-02", "exemplos")).includes("nome"),
  "a mesma frase em outro agente continua achado",
);
assert(classes("Opcional: quem pediu o veredito (ex.: Roberto).").includes("nome_pessoa"), "nome de pessoa reprova");
assert(classes("nao existe neste sistema desde 28/07/2026, por decisao da empresa").includes("data"), "data do AG-02 reprova");
const limitesAg06 =
  "decisao do sistema registrada em 01/09/2026. renomear existe desde 01/09/2026. COMENTARIO (10/09/2026).";
assert(
  classes(textoVarrido(limitesAg06, "AG-06", "limites")).length === 0,
  "as duas datas de arquitetura do AG-06 sao excecao nomeada",
);
assert(
  classes(textoVarrido(limitesAg06 + " nova regra em 15/10/2026.", "AG-06", "limites")).includes("data"),
  "data nova no AG-06 continua achado",
);
assert(classes("COHAPM tem tres vozes").includes("nome"), "nome de empresa reprova");
assert(classes("20 = R$ 20,00").includes("cifra"), "cifra reprova");
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
