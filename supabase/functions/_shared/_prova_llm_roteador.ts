// Prova do catalogo + roteador. Rode: deno run supabase/functions/_shared/_prova_llm_roteador.ts
import { CATALOGO_ECONOMIA, CATALOGO_PREMIUM, CATALOGO_TODOS, acharModelo } from "./llm_catalogo.ts";
import { bodyOpenRouter, resolverChamadaLlm } from "./llm_roteador.ts";

function assert(cond: boolean, msg: string) {
  if (!cond) throw new Error(msg);
}

assert(CATALOGO_ECONOMIA.length === 15, `economia=${CATALOGO_ECONOMIA.length}`);
assert(CATALOGO_PREMIUM.length === 15, `premium=${CATALOGO_PREMIUM.length}`);
const slugs = CATALOGO_TODOS.map((m) => m.slug);
assert(new Set(slugs).size === 30, "slugs duplicados no catalogo");
assert(CATALOGO_ECONOMIA.every((m) => m.faixa === "economia" && m.tools), "economia deve ter tools");
assert(CATALOGO_PREMIUM.every((m) => m.faixa === "premium"), "premium mal marcado");
assert(!!acharModelo("openai/gpt-5.6-luna"), "luna no catalogo");
assert(!!acharModelo("anthropic/claude-sonnet-5"), "sonnet-5 no catalogo");

const chat = resolverChamadaLlm({ tipo: "chat_loop", pergunta: "qual o gasto de ontem?" });
assert(!chat.legado, "roteador padrao nao e legado");
assert(chat.faixa === "economia", "chat simples deve ser economia");
assert(chat.model === "openai/gpt-5.6-luna", `chat model=${chat.model}`);
assert(chat.fallbacks.length >= 2, "precisa de fallback");
assert(chat.provider?.sort === "price", "economia ordena por preco do provedor");

const ato = resolverChamadaLlm({ tipo: "chat_loop", pedidoAto: true });
assert(ato.model === "anthropic/claude-haiku-4.5", `ato model=${ato.model}`);
assert(ato.faixa === "economia", "ato nao sobe para Opus no sincrono");

const vis = resolverChamadaLlm({ tipo: "chat_loop", temImagem: true });
assert(vis.model === "google/gemini-2.5-flash", `vis model=${vis.model}`);

const plan = resolverChamadaLlm({ tipo: "planner" });
assert(plan.model === "anthropic/claude-haiku-4.5", `planner=${plan.model}`);
assert(plan.faixa === "economia", "planner e economia");

const sub = resolverChamadaLlm({ tipo: "subagente", especialista: "desempenho_campanhas" });
assert(sub.model === "openai/gpt-5.6-luna", `sub=${sub.model}`);

const visao = resolverChamadaLlm({ tipo: "visao" });
assert(visao.model === "google/gemini-2.5-flash", `visao=${visao.model}`);

const lite = resolverChamadaLlm({ tipo: "sintese", faixaForcada: "economia" });
assert(lite.faixa === "economia", "sintese lite/standard fica economia");
assert(lite.model === "openai/gpt-5.6-luna-pro", `sintese lite=${lite.model}`);

const deep = resolverChamadaLlm({ tipo: "sintese" });
assert(deep.faixa === "premium", "sintese deep e premium");
assert(deep.model === "anthropic/claude-sonnet-5", `sintese deep=${deep.model}`);
assert(!deep.provider, "premium nao forca sort=price");

const rec = resolverChamadaLlm({ tipo: "reco" });
assert(rec.model === "openai/gpt-4o-mini", `reco=${rec.model}`);

const body = bodyOpenRouter(chat, { max_tokens: 10, messages: [] });
assert(body.model === chat.model, "body.model");
assert(Array.isArray(body.models) && (body.models as string[]).includes(chat.fallbacks[0]), "fallbacks no body");
assert((body.provider as { sort: string }).sort === "price", "provider no body");

const premiumBody = bodyOpenRouter(deep, { max_tokens: 8 });
assert(premiumBody.model === "anthropic/claude-sonnet-5", "premium body");
assert(premiumBody.provider == null, "premium sem sort price");

console.log("ok llm_roteador", { chat: chat.model, ato: ato.model, deep: deep.model });
