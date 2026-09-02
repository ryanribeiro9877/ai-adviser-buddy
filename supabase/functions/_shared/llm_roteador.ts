// Roteador de modelo por TAREFA (nao por provedor).
// Decide faixa (economia vs premium) e o slug OpenRouter ANTES da chamada.
// Sem hop extra de LLM no chat sincrono (teto ~118s). O "raciocinio" e deterministico
// no codigo; no job, o planner ja parte a pergunta em blocos e cada bloco ganha um modelo.
// Segredo LLM_ROTEADOR=legado volta ao openrouter/auto (comportamento 21/08).

import {
  CATALOGO_ECONOMIA,
  CATALOGO_PREMIUM,
  acharModelo,
  filtrarCatalogo,
  type FaixaLlm,
  type LlmModelo,
} from "./llm_catalogo.ts";
import { ehPedidoLeituraCruzada } from "./intencao_turno.ts";
export type { FaixaLlm };
import {
  extrasAutoRouter,
  isAutoRouterModel,
  modeloOpenRouterPadrao,
  modeloOpenRouterSubPadrao,
  type AutoCostTier,
} from "./openrouter_auto.ts";

export type TipoTarefaLlm =
  | "planner"
  | "subagente"
  | "visao"
  | "coordenacao"
  | "sintese"
  | "chat_loop"
  | "legendas"
  | "compliance"
  | "reco"
  | "waba";

export type RotaLlm = {
  model: string;
  fallbacks: string[];
  faixa: FaixaLlm;
  tipo: TipoTarefaLlm;
  motivo: string;
  legado: boolean;
  sessionId?: string | null;
  costTier?: AutoCostTier;
  provider?: { sort: "price" | "throughput" | "latency" };
};

function envGet(k: string): string {
  try {
    return (Deno.env.get(k) ?? "").trim();
  } catch {
    return "";
  }
}

export function roteadorLegado(): boolean {
  return envGet("LLM_ROTEADOR").toLowerCase() === "legado";
}

function preferirNaLista(lista: LlmModelo[], slug: string): LlmModelo[] {
  const i = lista.findIndex((m) => m.slug === slug);
  if (i <= 0) return lista;
  return [lista[i], ...lista.slice(0, i), ...lista.slice(i + 1)];
}

function montarCadeia(lista: LlmModelo[], primario: string, n = 4): { model: string; fallbacks: string[] } {
  const ord = preferirNaLista(lista, primario);
  const slugs = (ord.length ? ord : CATALOGO_ECONOMIA).map((m) => m.slug);
  const model = slugs[0];
  const fallbacks = slugs.slice(1, n).filter((s) => s !== model);
  return { model, fallbacks };
}

/**
 * Escolhe o modelo mais barato ainda excelente para o tipo de bloco.
 * Custo menor vence EMPATANDO qualidade: so sobe para premium quando o bloco
 * e sintese/julgamento fundo (deep) ou coordenacao.
 */
export function resolverChamadaLlm(opts: {
  tipo: TipoTarefaLlm;
  pergunta?: string;
  temImagem?: boolean;
  pedidoAto?: boolean;
  faixaForcada?: FaixaLlm;
  especialista?: string;
  sessionId?: string | null;
  costTier?: AutoCostTier;
}): RotaLlm {
  const tipo = opts.tipo;
  const sessionId = opts.sessionId ?? null;

  if (roteadorLegado()) {
    const model = tipo === "sintese" || tipo === "coordenacao"
      ? modeloOpenRouterPadrao()
      : (tipo === "chat_loop" ? modeloOpenRouterPadrao() : modeloOpenRouterSubPadrao());
    const costTier = opts.costTier ?? (tipo === "sintese" || tipo === "coordenacao" ? "high" : "medium");
    return {
      model,
      fallbacks: [],
      faixa: isAutoRouterModel(model) ? (costTier === "high" || costTier === "xhigh" || costTier === "max" ? "premium" : "economia") : (acharModelo(model)?.faixa ?? "economia"),
      tipo,
      motivo: `legado OPENROUTER_MODEL (${model})`,
      legado: true,
      sessionId,
      costTier,
    };
  }

  const visao = !!opts.temImagem || tipo === "visao" || opts.especialista === "analise_visual_drive";
  let faixa: FaixaLlm = "economia";
  let primario = "openai/gpt-5.6-luna";
  let req: { tools?: boolean; visao?: boolean; json?: boolean; prosa?: boolean } = { tools: true };
  let motivo = "";

  switch (tipo) {
    case "planner":
      primario = "anthropic/claude-haiku-4.5";
      req = { tools: false, json: true };
      motivo = "planner JSON curto — Haiku (barato e fiel ao schema)";
      break;
    case "subagente":
      primario = "openai/gpt-5.6-luna";
      req = { tools: true };
      motivo = `subagente ${opts.especialista ?? "generico"} — Luna (tools, custo baixo)`;
      if (visao) {
        primario = "google/gemini-2.5-flash";
        req = { tools: true, visao: true };
        motivo = "subagente visao — Gemini Flash";
      }
      break;
    case "visao":
      primario = "google/gemini-2.5-flash";
      req = { visao: true, json: true };
      motivo = "quadro/imagem — Gemini 2.5 Flash";
      break;
    case "legendas":
      primario = "google/gemini-3.7-flash";
      req = { json: true, prosa: true };
      motivo = "copy Hook-Beneficio-CTA — Gemini 3.7 Flash";
      break;
    case "compliance":
      primario = visao ? "google/gemini-2.5-flash" : "anthropic/claude-haiku-4.5";
      req = visao ? { visao: true, json: true } : { json: true };
      motivo = visao ? "compliance com peca — Gemini Flash" : "compliance texto — Haiku JSON";
      break;
    case "reco":
      primario = "openai/gpt-4o-mini";
      req = { json: true };
      motivo = "card de reco curto — gpt-4o-mini";
      break;
    case "waba":
      primario = "openai/gpt-5.6-luna";
      req = { json: true, prosa: true };
      motivo = "template UTILITY — Luna";
      break;
    case "chat_loop":
      if (visao) {
        primario = "google/gemini-2.5-flash";
        req = { tools: true, visao: true };
        motivo = "chat com anexo visual — Gemini Flash (um modelo no turno inteiro)";
      } else if (opts.pedidoAto) {
        primario = "anthropic/claude-haiku-4.5";
        req = { tools: true, json: true };
        motivo = "chat com propose_action — Haiku (JSON de card fiel, ainda economia)";
      } else if (ehPedidoLeituraCruzada(opts.pergunta ?? "")) {
        primario = "openai/gpt-5.6-luna-pro";
        req = { tools: true, prosa: true };
        motivo = "chat leitura cruzada ads×Drive — Luna Pro (nao declarar lacuna sem a tool de origem)";
      } else {
        primario = "openai/gpt-5.6-luna";
        req = { tools: true, prosa: true };
        motivo = "chat operacional — Luna (custo baixo, tools, PT-BR)";
      }
      break;
    case "coordenacao":
      faixa = "premium";
      primario = "anthropic/claude-sonnet-5";
      req = { json: true };
      motivo = "coordenacao — Sonnet 5 (julga relatorios)";
      break;
    case "sintese":
      if (opts.faixaForcada === "economia") {
        faixa = "economia";
        primario = "openai/gpt-5.6-luna-pro";
        req = { prosa: true };
        motivo = "sintese lite/standard — Luna Pro (prosa boa sem frontier)";
      } else {
        faixa = "premium";
        primario = "anthropic/claude-sonnet-5";
        req = { prosa: true };
        motivo = "sintese deep — Sonnet 5 (resposta excelente no bloco final)";
      }
      break;
    default:
      motivo = "fallback economia Luna";
  }

  if (opts.faixaForcada) faixa = opts.faixaForcada;
  if (faixa === "premium" && tipo !== "sintese" && tipo !== "coordenacao") {
    // Nunca jogar o loop sincrono/subagente no Opus por acidente.
    faixa = "economia";
    motivo += " [faixa premium recusada neste tipo — permanece economia]";
  }

  const lista = filtrarCatalogo(faixa, req);
  const cadeia = montarCadeia(lista.length ? lista : (faixa === "premium" ? CATALOGO_PREMIUM : CATALOGO_ECONOMIA), primario);
  return {
    model: cadeia.model,
    fallbacks: cadeia.fallbacks,
    faixa,
    tipo,
    motivo,
    legado: false,
    sessionId,
    provider: faixa === "economia" ? { sort: "price" } : undefined,
  };
}

/** Campos para espalhar no body do chat/completions. */
export function bodyOpenRouter(
  rota: RotaLlm,
  extra: Record<string, unknown> = {},
): Record<string, unknown> {
  if (rota.legado) {
    return {
      model: rota.model,
      ...extra,
      ...extrasAutoRouter({
        model: rota.model,
        sessionId: rota.sessionId,
        costTier: rota.costTier ?? "medium",
      }),
    };
  }
  const body: Record<string, unknown> = {
    model: rota.model,
    ...extra,
  };
  if (rota.fallbacks.length) body.models = rota.fallbacks;
  if (rota.provider) body.provider = rota.provider;
  const sid = String(rota.sessionId ?? "").trim();
  if (sid) body.session_id = sid;
  return body;
}

export function diagnosticoRota(rota: RotaLlm): Record<string, unknown> {
  return {
    modelo_pedido: rota.model,
    modelos_fallback: rota.fallbacks,
    faixa: rota.faixa,
    tipo_tarefa: rota.tipo,
    motivo_rota: rota.motivo,
    legado: rota.legado,
  };
}
