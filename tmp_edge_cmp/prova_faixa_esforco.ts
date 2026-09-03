// descartavel: prova executada da FAIXA DE ESFORCO por tipo de tarefa (03/09/2026).
//
// O que esta sendo provado, e nao apenas afirmado:
// 1) triagem (planner/coordenacao) sai em `low` — inclusive dentro de um job `deep`;
// 2) analise e chat continuam em `high`;
// 3) a sintese de pesquisa profunda continua em `xhigh` — a faixa nao rebaixou a qualidade;
// 4) o esforco chega ao BODY, que e o unico lugar que a OpenRouter le.
import {
  bodyOpenRouter,
  esforcoDoModo,
  modoRaciocinio,
  resolverChamadaLlm,
  type TipoTarefaLlm,
} from "../supabase/functions/_shared/llm_roteador.ts";

function assert(c: boolean, m: string) {
  if (!c) throw new Error("FALHOU: " + m);
}

const esperado: [TipoTarefaLlm, string, string][] = [
  // tipo,            esforco esperado, por que
  ["planner", "low", "AG-01 e o planner do job: veredito curto, nao analise"],
  ["coordenacao", "low", "julga relatorio e devolve JSON; rodava com raciocinio DESLIGADO antes"],
  ["chat_loop", "low", "turno do gestor: analise SOB TETO DE 118s — high nao termina o turno"],
  ["subagente", "high", "coleta e leitura de ferramenta"],
  ["sintese", "high", "sintese padrao (lite/standard)"],
  ["visao", "high", "leitura de pixel"],
];

for (const [tipo, esf, porque] of esperado) {
  const r = resolverChamadaLlm({ tipo, pergunta: "como foi o desempenho dos ultimos 7 dias?" });
  assert(r.esforco === esf, `${tipo} deveria sair ${esf} e saiu ${r.esforco} (${porque})`);
  const body = bodyOpenRouter(r) as any;
  assert(body?.reasoning?.effort === esf, `${tipo}: esforco nao chegou ao body (${JSON.stringify(body?.reasoning)})`);
}

// A pesquisa profunda continua sendo o unico xhigh da casa.
const deep = resolverChamadaLlm({ tipo: "sintese", tier: "deep" });
assert(deep.esforco === "xhigh", `sintese deep deveria continuar xhigh, saiu ${deep.esforco}`);
assert(deep.modo === "profundo", `sintese deep deveria estar no modo profundo, saiu ${deep.modo}`);

// O ponto que quebrava: dentro de um job `deep`, a TRIAGEM nao pode ser promovida a xhigh.
const plannerDeep = resolverChamadaLlm({ tipo: "planner", tier: "deep" });
assert(plannerDeep.esforco === "low", `planner dentro de deep deveria ser low, saiu ${plannerDeep.esforco}`);
assert(plannerDeep.modo === "triagem", `planner dentro de deep deveria ser triagem, saiu ${plannerDeep.modo}`);
const coordDeep = resolverChamadaLlm({ tipo: "coordenacao", tier: "deep" });
assert(coordDeep.esforco === "low", `coordenacao dentro de deep deveria ser low, saiu ${coordDeep.esforco}`);

// O chat roda sob teto duro: nem o tier `deep` pode promove-lo e estourar o turno.
const chatDeep = resolverChamadaLlm({ tipo: "chat_loop", tier: "deep" });
assert(chatDeep.esforco === "low", `chat_loop dentro de deep deveria ser low, saiu ${chatDeep.esforco}`);
assert(chatDeep.modo === "interativo", `chat_loop deveria ser interativo, saiu ${chatDeep.modo}`);

// O que roda SEM gestor esperando nao foi rebaixado: e a fronteira da faixa.
assert(resolverChamadaLlm({ tipo: "subagente", tier: "deep" }).esforco === "xhigh", "subagente deep segue xhigh");

// A faixa e uma funcao pura do modo: quatro modos, quatro esforcos, sem sobreposicao.
assert(esforcoDoModo("triagem") === "low", "triagem deve ser low (piso: raciocinio e obrigatorio no modelo)");
assert(esforcoDoModo("interativo") === "low", "interativo deve ser low (teto de 118s do turno)");
assert(esforcoDoModo("padrao") === "high", "padrao deve continuar high");
assert(esforcoDoModo("profundo") === "xhigh", "profundo deve continuar xhigh");
assert(modoRaciocinio({ tipo: "planner", tier: "deep" }) === "triagem", "tipo de triagem vence o tier");
assert(modoRaciocinio({ tier: "deep" }) === "profundo", "sem tipo, o tier deep manda");
assert(modoRaciocinio({ tipo: "chat_loop" }) === "interativo", "chat_loop e interativo");

console.log("ok faixa de esforco", JSON.stringify({
  triagem: ["planner", "coordenacao"].map((t) => resolverChamadaLlm({ tipo: t as TipoTarefaLlm }).esforco),
  interativo: resolverChamadaLlm({ tipo: "chat_loop" }).esforco,
  analise: ["subagente", "sintese"].map((t) => resolverChamadaLlm({ tipo: t as TipoTarefaLlm }).esforco),
  profunda: resolverChamadaLlm({ tipo: "sintese", tier: "deep" }).esforco,
  planner_dentro_de_deep: plannerDeep.esforco,
}));
