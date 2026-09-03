// Prova do catalogo + roteador (modelo unico + esforco por modo).
// Rode: deno run --allow-read --allow-env supabase/functions/_shared/_prova_llm_roteador.ts
// (--allow-env porque a prova do modo legado precisa ligar o segredo LLM_ROTEADOR)
import { acharModelo, atendeCapacidade, CATALOGO_ECONOMIA, CATALOGO_PREMIUM, CATALOGO_TODOS } from "./llm_catalogo.ts";
import {
  bodyOpenRouter,
  diagnosticoRota,
  MODELO_PADRAO,
  resolverChamadaLlm,
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
// 2. Esforco de raciocinio: profundo = xhigh, padrao = high.
// ---------------------------------------------------------------------------
for (const tipo of TIPOS) {
  const padrao = resolverChamadaLlm({ tipo });
  assert(padrao.modo === "padrao", `${tipo}: modo default deve ser padrao`);
  assert(padrao.esforco === "high", `${tipo}: esforco padrao=${padrao.esforco}`);

  const lite = resolverChamadaLlm({ tipo, tier: "lite" });
  const std = resolverChamadaLlm({ tipo, tier: "standard" });
  assert(lite.esforco === "high" && std.esforco === "high", `${tipo}: lite/standard devem ser high`);

  const deep = resolverChamadaLlm({ tipo, tier: "deep" });
  assert(deep.modo === "profundo", `${tipo}: tier deep deve virar modo profundo`);
  assert(deep.esforco === "xhigh", `${tipo}: esforco deep=${deep.esforco}`);

  const explicito = resolverChamadaLlm({ tipo, profundo: true });
  assert(explicito.esforco === "xhigh", `${tipo}: profundo explicito=${explicito.esforco}`);
  const negado = resolverChamadaLlm({ tipo, tier: "deep", profundo: false });
  assert(negado.esforco === "high", `${tipo}: profundo=false vence o tier`);
}

// O esforco entra no body como effort (unico controle que o padrao da casa aceita) e
// SOBREPOE o reasoning que a edge mandou — as constantes antigas desligavam o raciocinio.
const chat = resolverChamadaLlm({ tipo: "chat_loop", pergunta: "qual o gasto de ontem?" });
const body = bodyOpenRouter(chat, { max_tokens: 10, messages: [], reasoning: { enabled: false } });
assert(body.model === MODELO_PADRAO, "body.model");
assert(JSON.stringify(body.reasoning) === '{"effort":"high"}', `body.reasoning=${JSON.stringify(body.reasoning)}`);
assert(Array.isArray(body.models) && (body.models as string[]).includes(chat.fallbacks[0]), "fallbacks no body");
assert((body.provider as { sort: string }).sort === "price", "provider no body");

const deepSint = resolverChamadaLlm({ tipo: "sintese", tier: "deep" });
const bodyDeep = bodyOpenRouter(deepSint, { max_tokens: 8, reasoning: { max_tokens: 600 } });
assert(JSON.stringify(bodyDeep.reasoning) === '{"effort":"xhigh"}', `deep body=${JSON.stringify(bodyDeep.reasoning)}`);
assert(bodyDeep.provider == null, "premium nao forca sort=price");

// Telemetria: sem esforco/modo no diagnostico nao da para auditar o modo profundo.
const diag = diagnosticoRota(deepSint);
assert(diag.esforco_raciocinio === "xhigh", `diagnostico esforco=${diag.esforco_raciocinio}`);
assert(diag.modo_raciocinio === "profundo", `diagnostico modo=${diag.modo_raciocinio}`);
assert(diag.padrao_da_casa === true, "diagnostico padrao_da_casa");
assert(diag.modelo_pedido === MODELO_PADRAO, "diagnostico modelo_pedido");
assert(String(diag.motivo_rota).includes("raciocinio xhigh"), "motivo declara o esforco");

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

console.log("ok llm_roteador", {
  padrao: MODELO_PADRAO,
  tipos_conferidos: TIPOS.length,
  esforco_padrao: chat.esforco,
  esforco_profundo: deepSint.esforco,
  rede_chat: chat.fallbacks,
});
