// Prova do resolvedor e da fronteira. Rode: deno run supabase/functions/_shared/_prova_resposta_canonica.ts
//
// A metade mais importante desta prova sao os casos que NAO emitem canonico. A camada e util
// pela recusa: molde vencido, campo faltando e registro degradado tem que cair para o LLM em
// vez de emitir forma fixa com buraco.

import { classificarMolde } from "./molde_pergunta.ts";
import {
  brl,
  carregarRegistroDeMoldes,
  inteiro,
  lacunasDoGabarito,
  linhaDeTelemetria,
  type MoldeRegistro,
  pct,
  preencher,
  registroFallback,
  resolverRespostaCanonica,
} from "./resposta_canonica.ts";

let falhas = 0;
function assert(cond: boolean, msg: string) {
  if (!cond) {
    console.error(`  FALHOU: ${msg}`);
    falhas++;
  }
}

const HOJE = "2026-09-03";
const ctx = { hojeIso: HOJE, degradado: false };

// ============================================================================
// FORMATACAO — deterministica e sem Intl
// ============================================================================
assert(brl(1234.5) === "R$ 1.234,50", `brl(1234.5) = ${brl(1234.5)}`);
assert(brl(1498.73) === "R$ 1.498,73", `brl(1498.73) = ${brl(1498.73)}`);
assert(brl(1512) === "R$ 1.512,00", `brl(1512) = ${brl(1512)}`);
assert(brl(0) === "R$ 0,00", `brl(0) = ${brl(0)}`);
assert(brl(72) === "R$ 72,00", `brl(72) = ${brl(72)}`);
assert(brl(1234567.89) === "R$ 1.234.567,89", `brl milhao = ${brl(1234567.89)}`);
assert(brl(-45.6) === "-R$ 45,60", `brl negativo = ${brl(-45.6)}`);
assert(brl(null) === "indisponivel", "brl null nao vira zero");
assert(brl(NaN) === "indisponivel", "brl NaN nao vira zero");
assert(pct(1.5) === "1,50%", `pct(1.5) = ${pct(1.5)}`);
assert(pct(null) === "indisponivel", "pct null");
assert(inteiro(1451) === "1.451", `inteiro(1451) = ${inteiro(1451)}`);
assert(inteiro(0) === "0", `inteiro(0) = ${inteiro(0)}`);

// O formatador nao pode depender do ICU do runtime: se um dia alguem trocar por Intl, o
// separador muda de versao para versao e a prova de reprodutibilidade cai sem aviso.
assert(!brl(1234.5).includes("\u00a0"), "brl nao pode usar espaco nao-quebravel (sinal de Intl)");

// ============================================================================
// LACUNAS E PREENCHIMENTO
// ============================================================================
assert(lacunasDoGabarito("teto {teto}, gasto {gasto} e {teto}").join(",") === "teto,gasto", "lacunas sem repetir");
assert(lacunasDoGabarito("sem lacuna").length === 0, "gabarito sem lacuna");

const moldeTeste: MoldeRegistro = {
  codigo: "TESTE_MOLDE",
  classe: "molde_calculado",
  titulo: "molde de teste",
  gabarito: "Exposicao de hoje: {exposicao}. Pior dia: {pior}. Campanhas: {n}.",
  campos: [
    { nome: "exposicao", tipo: "dinheiro", origem: "avaliar_orcamento_diario.soma", obrigatorio: true },
    { nome: "pior", tipo: "dinheiro", origem: "avaliar_orcamento_diario.teto", obrigatorio: true },
    { nome: "n", tipo: "inteiro", origem: "avaliar_orcamento_diario.qtd", obrigatorio: true },
  ],
  fronteira: null,
  verificado_em: HOJE,
  revalidar_ate: "2027-01-01",
  versao: 1,
};

{
  const r = preencher(moldeTeste, { exposicao: 1209.6, pior: 1512, n: 7 });
  assert(!("falta" in r), "preenchimento completo nao pode faltar");
  if (!("falta" in r)) {
    assert(
      r.texto === "Exposicao de hoje: R$ 1.209,60. Pior dia: R$ 1.512,00. Campanhas: 7.",
      `texto preenchido: ${r.texto}`,
    );
    assert(r.campos_usados.length === 3, "tres campos usados");
    assert(r.campos_usados[0].origem === "avaliar_orcamento_diario.soma", "origem declarada");
  }
}

// CAMPO OBRIGATORIO FALTANDO -> falta, nunca "indisponivel" dentro do molde.
{
  const r = preencher(moldeTeste, { exposicao: 1209.6, n: 7 });
  assert("falta" in r, "campo obrigatorio faltando tem que devolver falta");
  if ("falta" in r) assert(r.falta.includes("pior"), `motivo deve nomear o campo: ${r.falta}`);
}
// Zero NAO e ausencia: R$ 0,00 e um valor legitimo.
{
  const r = preencher(moldeTeste, { exposicao: 0, pior: 0, n: 0 });
  assert(!("falta" in r), "zero e valor, nao ausencia");
  if (!("falta" in r)) assert(r.texto.includes("R$ 0,00"), "zero formatado");
}
// Gabarito com lacuna nao declarada em campos: registro divergiu do gabarito.
{
  const quebrado: MoldeRegistro = { ...moldeTeste, gabarito: "valor {nao_declarado}" };
  const r = preencher(quebrado, {});
  assert("falta" in r, "lacuna sem campo declarado tem que falhar");
}

// ============================================================================
// A FRONTEIRA
// ============================================================================
const reg = registroFallback();

// Recusa canonica: emite mesmo com registro degradado, porque nao depende de dado.
{
  const molde = classificarMolde("Escale o criativo vencedor.");
  const r = resolverRespostaCanonica({ molde, registro: reg, ctx });
  assert(r.caminho === "canonico", `recusa deveria emitir canonico; veio ${r.caminho}`);
  if (r.caminho === "canonico") {
    assert(r.texto.includes("nao existe como acao na Meta"), "texto canonico da recusa");
    assert(r.molde === "REC_ESCALAR_CRIATIVO", "molde correto");
    assert(r.classe === "texto_canonico", "classe correta");
  }
}

// Molde calculado com registro DEGRADADO -> LLM. O fallback local nao tem molde de numero,
// e o motivo tem que apontar infraestrutura, nao divergencia de seed.
{
  const molde = classificarMolde("Qual e a exposicao de orcamento diario da operacao hoje, e qual seria o pior dia possivel?");
  const r = resolverRespostaCanonica({ molde, registro: reg, ctx });
  assert(r.caminho === "llm", "molde calculado com registro degradado tem que cair para LLM");
  if (r.caminho === "llm") assert(r.motivo.includes("degradado"), `motivo: ${r.motivo}`);
}

// Registro VIVO e molde de dado ausente do seed -> motivo de divergencia, nao de infra.
{
  const r = resolverRespostaCanonica({
    molde: { codigo: "NUM_EXPOSICAO_ORCAMENTO", classe: "molde_calculado", confianca: "exata", parametros: {} },
    registro: { moldes: reg.moldes, degradado: false },
    ctx,
  });
  assert(r.caminho === "llm", "molde ausente cai para LLM");
  if (r.caminho === "llm") {
    assert(r.motivo.includes("nao existe no registro"), `motivo deve apontar divergencia: ${r.motivo}`);
  }
}

// Registro NAO degradado, campos preenchidos -> canonico.
{
  const vivo = { moldes: [...reg.moldes, moldeTeste], degradado: false };
  const r = resolverRespostaCanonica({
    molde: { codigo: "TESTE_MOLDE", classe: "molde_calculado", confianca: "exata", parametros: {} },
    registro: vivo,
    valores: { exposicao: 1209.6, pior: 1512, n: 7 },
    ctx,
  });
  assert(r.caminho === "canonico", `deveria emitir; veio ${r.caminho === "llm" ? r.motivo : ""}`);
}

// ENVELHECIMENTO: passou de revalidar_ate -> LLM. Nao emite com aviso.
{
  const vencido: MoldeRegistro = { ...moldeTeste, revalidar_ate: "2026-08-01" };
  const r = resolverRespostaCanonica({
    molde: { codigo: "TESTE_MOLDE", classe: "molde_calculado", confianca: "exata", parametros: {} },
    registro: { moldes: [vencido], degradado: false },
    valores: { exposicao: 1209.6, pior: 1512, n: 7 },
    ctx,
  });
  assert(r.caminho === "llm", "molde vencido tem que cair para LLM");
  if (r.caminho === "llm") assert(r.motivo.includes("vencido"), `motivo: ${r.motivo}`);
}
// revalidar_ate == hoje ainda vale (vence DEPOIS do dia, nao no dia).
{
  const hojeMesmo: MoldeRegistro = { ...moldeTeste, revalidar_ate: HOJE };
  const r = resolverRespostaCanonica({
    molde: { codigo: "TESTE_MOLDE", classe: "molde_calculado", confianca: "exata", parametros: {} },
    registro: { moldes: [hojeMesmo], degradado: false },
    valores: { exposicao: 1, pior: 2, n: 3 },
    ctx,
  });
  assert(r.caminho === "canonico", "revalidar_ate igual a hoje ainda vale");
}

// CONFIANCA FRACA -> LLM. `fraca` existe para telemetria, nao para emitir.
{
  const r = resolverRespostaCanonica({
    molde: { codigo: "REC_ESCALAR_CRIATIVO", classe: "texto_canonico", confianca: "fraca", parametros: {} },
    registro: reg,
    ctx,
  });
  assert(r.caminho === "llm", "confianca fraca nao emite");
  if (r.caminho === "llm") assert(r.motivo.includes("provavel"), `motivo: ${r.motivo}`);
}

// Turno sem molde -> LLM.
{
  const molde = classificarMolde("hoje eu preciso de um diagnostico completo de tudo o que esta ativo");
  const r = resolverRespostaCanonica({ molde, registro: reg, ctx });
  assert(r.caminho === "llm", "analise nova cai para LLM");
}

// Molde classificado mas ausente do registro VIVO -> LLM (codigo e registro divergiram).
{
  const r = resolverRespostaCanonica({
    molde: { codigo: "MOLDE_INEXISTENTE", classe: "texto_canonico", confianca: "exata", parametros: {} },
    registro: { moldes: reg.moldes, degradado: false },
    ctx,
  });
  assert(r.caminho === "llm", "molde fora do registro cai para LLM");
  if (r.caminho === "llm") assert(r.motivo.includes("nao existe no registro"), `motivo: ${r.motivo}`);
}

// ============================================================================
// TELEMETRIA — grava nos DOIS caminhos, senao nao ha governanca
// ============================================================================
{
  const molde = classificarMolde("Escale o criativo vencedor.");
  const r = resolverRespostaCanonica({ molde, registro: reg, ctx });
  const t = linhaDeTelemetria(molde, r);
  assert(t.caminho === "canonico" && t.molde === "REC_ESCALAR_CRIATIVO", "telemetria do canonico");
  assert(t.motivo === null && t.versao === 1, "canonico sem motivo, com versao");
}
{
  const molde = classificarMolde("escreva 3 legendas para esse reel");
  const r = resolverRespostaCanonica({ molde, registro: reg, ctx });
  const t = linhaDeTelemetria(molde, r);
  assert(t.caminho === "llm" && t.motivo !== null, "telemetria do LLM tem motivo");
}

// ============================================================================
// CARGA COM BANCO INDISPONIVEL -> fallback, nunca excecao
// ============================================================================
{
  const supaQuebrado = {
    from: () => ({
      select: () => ({ eq: () => ({ order: () => Promise.reject(new Error("sem rede")) }) }),
    }),
  };
  // deno-lint-ignore no-explicit-any
  const r = await carregarRegistroDeMoldes(supaQuebrado as any);
  assert(r.degradado === true, "falha de leitura tem que devolver degradado");
  assert(r.moldes.length === 6, `fallback tem 6 moldes; veio ${r.moldes.length}`);
}
{
  const supaVazio = {
    from: () => ({ select: () => ({ eq: () => ({ order: () => Promise.resolve({ data: [], error: null }) }) }) }),
  };
  // deno-lint-ignore no-explicit-any
  const r = await carregarRegistroDeMoldes(supaVazio as any);
  assert(r.degradado === true, "tabela vazia tambem e degradado");
}

if (falhas) {
  console.error(`\nFALHOU: _prova_resposta_canonica (${falhas} erro(s))`);
  Deno.exit(1);
}
console.log("ok: _prova_resposta_canonica");
