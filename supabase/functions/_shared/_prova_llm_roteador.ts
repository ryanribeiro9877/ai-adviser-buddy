// Prova do catalogo + roteador (modelo unico + esforco por modo).
// Rode: deno run --allow-read --allow-env supabase/functions/_shared/_prova_llm_roteador.ts
// (--allow-env porque a prova do modo legado precisa ligar o segredo LLM_ROTEADOR)
import { acharModelo, atendeCapacidade, CATALOGO_ECONOMIA, CATALOGO_PREMIUM, CATALOGO_TODOS } from "./llm_catalogo.ts";
import {
  bodyOpenRouter,
  diagnosticoRota,
  ehTarefaDeFusao,
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
// `fusao` e a terceira natureza (05/09/2026): tipos que fundem material ja raciocinado e por
// isso NAO sobem para xhigh em job deep. Ela entra aqui pela mesma porta das outras duas —
// perguntando o predicado — para que reajuste de banda nao vire manutencao de prova. Qual esforco
// o modo `fusao` vale e assunto do roteador, nao desta linha: ela so afirma que a natureza existe
// e vence o tier. Ja mudou uma vez (high -> low, quando `high` convergiu 1 em 3) sem tocar aqui.
const modoNatural = (tipo: TipoTarefaLlm): ModoRaciocinio | null =>
  ehTarefaDeTriagem(tipo)
    ? "triagem"
    : ehTarefaInterativa(tipo)
    ? "interativo"
    : ehTarefaDeFusao(tipo)
    ? "fusao"
    : null;

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
assert(TIPOS.some(ehTarefaDeFusao), "nenhum tipo de fusao em TIPOS: 'fusao nao sobe para xhigh' nao foi exercido");
assert(
  TIPOS.some((t) => modoNatural(t) === null),
  "nenhum tipo neutro em TIPOS: a promocao por tier deep nao foi exercida",
);

// A REGRA da decisao de 05/09, afirmada como regra e nao como valor: tier deep NAO promove quem
// funde. Comparar deep com standard prova isso sem escrever "high" — se um dia a banda da casa
// mudar, esta linha continua valendo; se alguem religar a promocao da sintese, ela cai.
for (const tipo of TIPOS.filter(ehTarefaDeFusao)) {
  const deep = resolverChamadaLlm({ tipo, tier: "deep" });
  const std = resolverChamadaLlm({ tipo, tier: "standard" });
  assert(
    deep.esforco === std.esforco,
    `${tipo}: tier deep promoveu quem funde (deep=${deep.esforco}, standard=${std.esforco})`,
  );
  assert(
    deep.esforco !== esforcoDoModo("profundo"),
    `${tipo}: esforco de fusao igualou o do modo profundo (${deep.esforco}) — a fusao voltou a subir`,
  );
  // E o que NAO muda: a fusao continua na rede premium. A decisao foi baixar o RACIOCINIO, nao
  // rebaixar o modelo de quem escreve para o gestor.
  assert(deep.faixa === "premium", `${tipo}: fusao deveria seguir premium, veio ${deep.faixa}`);
}

// E o subagente, que e o que NAO desce, continua subindo. Sem esta linha a mudanca de cima
// poderia ter levado a coleta junto e a prova ficaria verde.
assert(
  resolverChamadaLlm({ tipo: "subagente", tier: "deep" }).esforco === esforcoDoModo("profundo"),
  "subagente deep deixou de usar o esforco profundo: a coleta nao entra na decisao de fusao",
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
// 2b. A sobreposicao de `reasoning` tem de DECLARAR (05/09/2026).
//
// O roteador vencer o chamador esta certo; vencer em silencio nao. `chamarSinteseParte` pediu
// `REASONING_OFF` por semanas e rodou `xhigh`, e nada no codigo nem na telemetria dizia isso —
// quem lia o job via "raciocinio desligado" e a conta de tempo errava por 5x. Estas linhas
// prendem o par pedido/aplicado.
// ---------------------------------------------------------------------------
{
  const rota = resolverChamadaLlm({ tipo: "sintese", tier: "deep" });
  const b = bodyOpenRouter(rota, { max_tokens: 8, reasoning: { enabled: false } });
  // O aplicado continua sendo o do roteador: declarar nao e ceder.
  assert(
    JSON.stringify(b.reasoning) === JSON.stringify({ effort: rota.esforco }),
    `sobreposicao deve continuar vencendo: ${JSON.stringify(b.reasoning)}`,
  );
  const d = diagnosticoRota(rota);
  assert(d.reasoning_sobreposto === true, "sobreposicao silenciosa: falta reasoning_sobreposto na telemetria");
  assert(
    JSON.stringify(d.reasoning_pedido) === JSON.stringify({ enabled: false }),
    `telemetria deve guardar o pedido do chamador: ${JSON.stringify(d.reasoning_pedido)}`,
  );
}
{
  // Sem divergencia, sem campo: a PRESENCA do par e que sinaliza. Se aparecesse sempre, viraria
  // ruido e ninguem repararia no dia em que importa.
  const rota = resolverChamadaLlm({ tipo: "sintese", tier: "deep" });
  bodyOpenRouter(rota, { max_tokens: 8, reasoning: { effort: rota.esforco } });
  const d = diagnosticoRota(rota);
  assert(!("reasoning_sobreposto" in d), "pedido igual ao aplicado nao e sobreposicao");
  assert(!("reasoning_pedido" in d), "pedido igual ao aplicado nao deveria virar campo");
}
{
  // Chamador que nao pede nada tambem nao e sobreposicao — a maioria das edges esta aqui.
  const rota = resolverChamadaLlm({ tipo: "subagente", tier: "deep" });
  bodyOpenRouter(rota, { max_tokens: 8 });
  assert(!("reasoning_sobreposto" in diagnosticoRota(rota)), "ausencia de pedido nao e sobreposicao");
}

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

// Os dois rotulos antigos (`esforco_padrao`/`esforco_profundo`) mentiam depois que as naturezas
// nasceram: o primeiro lia um `chat_loop`, que e INTERATIVO, e o segundo uma `sintese` deep, que
// desde 05/09 nao e mais profunda. Resumo que rotula errado e pior que resumo ausente — foi assim
// que "raciocinio desligado" ficou escrito num caminho que rodava xhigh. Agora cada linha diz de
// quem ela fala, e o subagente aparece ao lado justamente para mostrar que a coleta NAO desceu.
console.log("ok llm_roteador", {
  padrao: MODELO_PADRAO,
  tipos_conferidos: TIPOS.length,
  esforco_chat_loop: chat.esforco,
  esforco_sintese_deep: deepSint.esforco,
  esforco_subagente_deep: resolverChamadaLlm({ tipo: "subagente", tier: "deep" }).esforco,
  rede_chat: chat.fallbacks,
  piso_max_tokens: MAX_TOKENS_PISO_RACIOCINIO,
});
