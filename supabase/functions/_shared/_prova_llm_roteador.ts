// Prova do catalogo + roteador (modelo unico + esforco por modo).
// Rode: deno run --allow-read --allow-env supabase/functions/_shared/_prova_llm_roteador.ts
// (--allow-env porque a prova do modo legado precisa ligar o segredo LLM_ROTEADOR)
import { acharModelo, atendeCapacidade, CATALOGO_ECONOMIA, CATALOGO_PREMIUM, CATALOGO_TODOS } from "./llm_catalogo.ts";
import {
  bodyOpenRouter,
  diagnosticoRota,
  ehTarefaDeTriagem,
  ehTarefaInterativa,
  esforcoDoModo,
  MAX_TOKENS_PISO_RACIOCINIO,
  MODELO_PADRAO,
  type ModoRaciocinio,
  resolverChamadaLlm,
  tetoDeSaida,
  type TipoTarefaLlm,
} from "./llm_roteador.ts";

function assert(cond: boolean, msg: string) {
  if (!cond) throw new Error(msg);
}

assert(CATALOGO_ECONOMIA.length === 15, `economia=${CATALOGO_ECONOMIA.length}`);
assert(CATALOGO_PREMIUM.length === 15, `premium=${CATALOGO_PREMIUM.length}`);
const slugs = CATALOGO_TODOS.map((m) => m.slug);
assert(new Set(slugs).size === 30, "slugs duplicados no catalogo");
assert(CATALOGO_ECONOMIA.every((m) => m.faixa === "economia" && m.tools), "economia deve ter tools");
assert(CATALOGO_PREMIUM.every((m) => m.faixa === "premium"), "premium mal marcado");
assert(!!acharModelo(MODELO_PADRAO), `${MODELO_PADRAO} precisa estar no catalogo`);
// O padrao da casa so pode ser universal se declarar TODAS as capacidades — a de visao
// inclusive, senao o pipeline de peca do Drive cairia em excecao.
assert(
  atendeCapacidade(acharModelo(MODELO_PADRAO), { tools: true, visao: true, json: true, prosa: true }),
  `${MODELO_PADRAO} precisa declarar tools+visao+json+prosa`,
);

// ---------------------------------------------------------------------------
// 1. TODO tipo de tarefa sai no padrao da casa, com rede de fallback nao vazia.
// ---------------------------------------------------------------------------
const TIPOS: TipoTarefaLlm[] = [
  "planner", "subagente", "visao", "coordenacao", "sintese",
  "chat_loop", "legendas", "compliance", "reco", "waba",
];
for (const tipo of TIPOS) {
  for (const temImagem of [false, true]) {
    const r = resolverChamadaLlm({ tipo, temImagem, pergunta: "qual o gasto de ontem?" });
    assert(r.model === MODELO_PADRAO, `${tipo}${temImagem ? "+img" : ""} model=${r.model}`);
    assert(r.padraoDaCasa, `${tipo}: padraoDaCasa deveria ser true`);
    assert(r.fallbacks.length >= 2, `${tipo}: rede de fallback vazia demais (${r.fallbacks.length})`);
    assert(!r.fallbacks.includes(MODELO_PADRAO), `${tipo}: padrao repetido na rede`);
    assert(!r.legado, `${tipo}: nao e legado`);
  }
}
// Variantes do chat que antes trocavam de modelo continuam no padrao.
for (const opts of [
  { tipo: "chat_loop" as const, pedidoAto: true },
  { tipo: "chat_loop" as const, pergunta: "dos anuncios registrados, eles pertencem a qual pasta do drive?" },
  { tipo: "subagente" as const, especialista: "analise_visual_drive" },
  { tipo: "sintese" as const, faixaForcada: "economia" as const },
]) {
  const r = resolverChamadaLlm(opts);
  assert(r.model === MODELO_PADRAO, `${JSON.stringify(opts)} -> ${r.model}`);
}

// Rede de visao so com modelo de visao: se o Grok cair num quadro do Drive, o fallback
// tambem precisa ler pixel.
const visao = resolverChamadaLlm({ tipo: "visao" });
assert(
  visao.fallbacks.every((s) => acharModelo(s)?.visao === true),
  `fallback sem visao na rota de visao: ${visao.fallbacks.join(",")}`,
);
assert(visao.fallbacks[0] === "google/gemini-2.5-flash", `preferido antigo deve abrir a rede: ${visao.fallbacks[0]}`);

// ---------------------------------------------------------------------------
// 2. Esforco de raciocinio: quem dita e o MODO, e a NATUREZA da tarefa vence o tier.
//
// Esta secao pergunta o contrato as funcoes que decidem (ehTarefaDeTriagem /
// ehTarefaInterativa / esforcoDoModo) em vez de fixar "high"/"xhigh" por tipo. A versao
// anterior afirmava que TODO tipo saia em `padrao`/`high`: virou mentira no dia em que
// `triagem` (planner/coordenacao) e `interativo` (chat_loop) nasceram, e o job ficou vermelho
// semanas afirmando isso. Com as faixas ainda sendo medidas, literal aqui e manutencao a cada
// reajuste — o que se afirma e a REGRA, nao o valor de hoje.
// ---------------------------------------------------------------------------
const modoNatural = (tipo: TipoTarefaLlm): ModoRaciocinio | null =>
  ehTarefaDeTriagem(tipo) ? "triagem" : ehTarefaInterativa(tipo) ? "interativo" : null;

for (const tipo of TIPOS) {
  const natural = modoNatural(tipo);
  const conferir = (r: { modo: ModoRaciocinio; esforco: string | null }, esperado: ModoRaciocinio, ctx: string) => {
    assert(r.modo === esperado, `${tipo} ${ctx}: modo=${r.modo}, esperado ${esperado}`);
    assert(
      r.esforco === esforcoDoModo(esperado),
      `${tipo} ${ctx}: esforco=${r.esforco}, esperado ${esforcoDoModo(esperado)} (esforco vem do modo)`,
    );
  };

  // Sem tier: natureza propria manda; quem nao tem sai no `padrao` da casa.
  const esperadoDefault = natural ?? "padrao";
  conferir(resolverChamadaLlm({ tipo }), esperadoDefault, "default");

  // lite/standard nao promovem ninguem.
  for (const tier of ["lite", "standard"] as const) {
    conferir(resolverChamadaLlm({ tipo, tier }), esperadoDefault, `tier=${tier}`);
  }

  // deep e `profundo: true` promovem — menos quem tem natureza propria: triagem de um job deep
  // continua triagem (pagar xhigh para escolher o nome de um especialista foi o que matou o
  // Roteador do chat), e chat_loop continua interativo porque o teto de 118s do turno nao muda
  // com o tier de proposito.
  const esperadoPromovido = natural ?? "profundo";
  conferir(resolverChamadaLlm({ tipo, tier: "deep" }), esperadoPromovido, "tier=deep");
  conferir(resolverChamadaLlm({ tipo, profundo: true }), esperadoPromovido, "profundo=true");

  // `profundo: false` vence o tier deep — e a natureza vence os dois.
  conferir(resolverChamadaLlm({ tipo, tier: "deep", profundo: false }), esperadoDefault, "deep+profundo=false");
}

// Sem isto, o bloco acima viraria tautologia: se as duas listas de natureza esvaziassem, todo
// `esperado` cairia em padrao/profundo e a prova deixaria de exercer "natureza vence tier"
// continuando verde. O contrato so esta provado se os tres casos existirem de verdade.
assert(TIPOS.some(ehTarefaDeTriagem), "nenhum tipo de triagem em TIPOS: 'natureza vence tier' nao foi exercido");
assert(TIPOS.some(ehTarefaInterativa), "nenhum tipo interativo em TIPOS: 'natureza vence tier' nao foi exercido");
assert(
  TIPOS.some((t) => modoNatural(t) === null),
  "nenhum tipo neutro em TIPOS: a promocao por tier deep nao foi exercida",
);

// O esforco entra no body como effort (unico controle que o padrao da casa aceita) e
// SOBREPOE o reasoning que a edge mandou — as constantes antigas desligavam o raciocinio.
const chat = resolverChamadaLlm({ tipo: "chat_loop", pergunta: "qual o gasto de ontem?" });
const body = bodyOpenRouter(chat, { max_tokens: 10, messages: [], reasoning: { enabled: false } });
assert(body.model === MODELO_PADRAO, "body.model");
// O que importa aqui e a FIACAO — o esforco da rota chega ao body e sobrepoe o
// `reasoning: { enabled: false }` que a edge mandou. O valor da faixa e assunto da secao 2;
// fixar "high" aqui era o que fazia esta linha cair junto quando chat_loop virou interativo.
assert(chat.esforco != null, "roteador nao-legado tem de ditar esforco");
assert(
  JSON.stringify(body.reasoning) === JSON.stringify({ effort: chat.esforco }),
  `body.reasoning=${JSON.stringify(body.reasoning)} deveria carregar effort=${chat.esforco} da rota`,
);
assert(Array.isArray(body.models) && (body.models as string[]).includes(chat.fallbacks[0]), "fallbacks no body");
assert((body.provider as { sort: string }).sort === "price", "provider no body");

// Sintese e tipo neutro, entao tier deep a promove. O modo esperado sai de modoNatural em vez
// de "profundo" escrito a mao: ha medicao de faixa em curso e a sintese do tier profundo e
// justamente uma das candidatas a mudar de banda.
const modoSinteseDeep = modoNatural("sintese") ?? "profundo";
const deepSint = resolverChamadaLlm({ tipo: "sintese", tier: "deep" });
const bodyDeep = bodyOpenRouter(deepSint, { max_tokens: 8, reasoning: { max_tokens: 600 } });
assert(
  JSON.stringify(bodyDeep.reasoning) === JSON.stringify({ effort: esforcoDoModo(modoSinteseDeep) }),
  `deep body=${JSON.stringify(bodyDeep.reasoning)}, esperado effort=${esforcoDoModo(modoSinteseDeep)}`,
);
assert(bodyDeep.provider == null, "premium nao forca sort=price");

// Telemetria: sem esforco/modo no diagnostico nao da para auditar o modo profundo.
const diag = diagnosticoRota(deepSint);
assert(
  diag.esforco_raciocinio === esforcoDoModo(modoSinteseDeep),
  `diagnostico esforco=${diag.esforco_raciocinio}, esperado ${esforcoDoModo(modoSinteseDeep)}`,
);
assert(diag.modo_raciocinio === modoSinteseDeep, `diagnostico modo=${diag.modo_raciocinio}`);
assert(diag.padrao_da_casa === true, "diagnostico padrao_da_casa");
assert(diag.modelo_pedido === MODELO_PADRAO, "diagnostico modelo_pedido");
assert(
  String(diag.motivo_rota).includes(`raciocinio ${esforcoDoModo(modoSinteseDeep)}`),
  `motivo declara o esforco: ${diag.motivo_rota}`,
);

// ---------------------------------------------------------------------------
// 3. Modo legado continua respeitado (escape do gestor).
// ---------------------------------------------------------------------------
Deno.env.set("LLM_ROTEADOR", "legado");
try {
  const leg = resolverChamadaLlm({ tipo: "chat_loop", tier: "deep" });
  assert(leg.legado, "LLM_ROTEADOR=legado deve voltar ao comportamento antigo");
  assert(leg.model !== MODELO_PADRAO, `legado nao forca o padrao: ${leg.model}`);
  assert(leg.esforco === null, "legado nao dita esforco");
  const bodyLeg = bodyOpenRouter(leg, { max_tokens: 5, reasoning: { max_tokens: 6000 } });
  assert(
    JSON.stringify(bodyLeg.reasoning) === '{"max_tokens":6000}',
    `legado preserva o reasoning da edge: ${JSON.stringify(bodyLeg.reasoning)}`,
  );
} finally {
  Deno.env.delete("LLM_ROTEADOR");
}
const voltou = resolverChamadaLlm({ tipo: "chat_loop" });
assert(!voltou.legado && voltou.model === MODELO_PADRAO, "sem o segredo, volta ao padrao da casa");

// ---------------------------------------------------------------------------
// 4. Piso de max_tokens: o teto tem de caber o raciocinio antes da resposta.
//
// Os numeros abaixo sao os tetos que as edges pequenas carregavam em 05/09 e que a leitura de
// chat_messages reprovou (minimo 1.248 / p50 2.609 / p90 4.217 de saida no esforco `high`).
// A prova existe para que nenhum deles volte por descuido.
// ---------------------------------------------------------------------------
for (const tetoAntigo of [900, 1_200, 1_500, 2_000, 4_000]) {
  assert(
    tetoDeSaida(tetoAntigo) === MAX_TOKENS_PISO_RACIOCINIO,
    `teto ${tetoAntigo} tem de subir ao piso, veio ${tetoDeSaida(tetoAntigo)}`,
  );
}
assert(tetoDeSaida() === MAX_TOKENS_PISO_RACIOCINIO, "sem argumento, o teto e o piso");
assert(tetoDeSaida(32_000) === 32_000, "teto maior que o piso e respeitado");
assert(
  MAX_TOKENS_PISO_RACIOCINIO > 4_217,
  "o piso tem de passar do p90 de saida medido, senao nao sobra canal para a resposta",
);
// No modo legado o raciocinio volta a ser das constantes das edges: la um teto baixo e
// escolha do gestor, e o piso nao pode sobrescrever.
Deno.env.set("LLM_ROTEADOR", "legado");
try {
  assert(tetoDeSaida(900) === 900, "legado preserva o teto da edge");
} finally {
  Deno.env.delete("LLM_ROTEADOR");
}
assert(tetoDeSaida(900) === MAX_TOKENS_PISO_RACIOCINIO, "fora do legado, o piso volta a valer");

console.log("ok llm_roteador", {
  padrao: MODELO_PADRAO,
  tipos_conferidos: TIPOS.length,
  esforco_padrao: chat.esforco,
  esforco_profundo: deepSint.esforco,
  rede_chat: chat.fallbacks,
  piso_max_tokens: MAX_TOKENS_PISO_RACIOCINIO,
});
