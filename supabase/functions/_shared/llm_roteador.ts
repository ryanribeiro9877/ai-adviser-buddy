// Roteador de MODELO e de ESFORCO DE RACIOCINIO. Decide os dois antes da chamada.
//
// 03/09/2026 — UM modelo para todo agente e toda tarefa: x-ai/grok-4.6.
// A escolha por tarefa (Haiku no planner, Luna no loop, Gemini na visao, Sonnet na sintese)
// resolvia custo e resolvia mal a comparacao: cada bloco do turno respondia com um modelo
// diferente, entao "a resposta piorou" nunca tinha uma causa unica para investigar. O padrao
// unico troca essa economia por leitura: um modelo, um comportamento, um lugar para ajustar.
// Capacidades conferidas na /api/v1/models da OpenRouter (03/09/2026): text+image+file na
// entrada, tools, response_format/structured_outputs, 500k de contexto — cobre TODOS os tipos
// de tarefa da casa, inclusive o pipeline de visao das pecas do Drive. Sem excecao de modelo.
//
// O catalogo por faixa (llm_catalogo.ts) NAO morreu: virou a REDE. O padrao vai na frente e a
// faixa entra como `models` de fallback, com a preferencia antiga do tipo em primeiro lugar —
// se o Grok cair, recusar ou faltar provedor, o turno continua no modelo que a casa media
// melhor para aquele bloco. Turno caro e melhor que turno perdido.
//
// ESFORCO POR MODO, nao por tarefa: pesquisa profunda (tier `deep` do traffic-agent-job) pede
// `xhigh`; todo o resto pede `high`. Os dois valores sao os que a OpenRouter aceita para este
// modelo (supported_efforts: low|medium|high|xhigh, default high) e o raciocinio dele e
// OBRIGATORIO — `enabled:false` / effort "none" e RECUSADO pelo modelo. Por isso o esforco
// sai daqui e nao de constante de edge: quem escolhe o modelo e quem sabe o que ele aceita.
// bodyOpenRouter sobrepoe qualquer `reasoning` que a edge tenha mandado no extra.
//
// CORRECAO do cabecalho antigo (valia ate 02/09): "Sem hop extra de LLM no chat sincrono" nao
// e mais verdade. O commit do Gestor/Roteador inverteu isso: o chat chama o AG-01 antes do
// turno para saber quais agentes atendem e carregar so as ferramentas do setor. A chamada nao
// entra em serie (corre junto com historico/memoria, teto de 7s, falha aberta), mas existe —
// e como o Grok raciocina em toda chamada, e ela que paga mais caro pelo padrao unico: o teto
// curto pode estourar e a delegacao cai para "todas as ferramentas" (agentes_degradado).
//
// Segredo LLM_ROTEADOR=legado volta ao openrouter/auto e devolve o raciocinio para as
// constantes das edges (comportamento 21/08) — escape mantido intacto.

import {
  atendeCapacidade,
  CATALOGO_ECONOMIA,
  CATALOGO_PREMIUM,
  acharModelo,
  filtrarCatalogo,
  type FaixaLlm,
  type LlmModelo,
  type RequisitoCapacidade,
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

/** Modelo unico da casa. Trocar aqui troca em todo agente e toda tarefa. */
export const MODELO_PADRAO = "x-ai/grok-4.6";

/** Valores aceitos pela OpenRouter para o padrao da casa (supported_efforts). */
export type EsforcoRaciocinio = "low" | "medium" | "high" | "xhigh";

/** Profundidade que o traffic-agent-job ja classificava antes desta mudanca. */
export type TierProfundidade = "lite" | "standard" | "deep";
export type ModoRaciocinio = "padrao" | "profundo";

export const ESFORCO_PADRAO: EsforcoRaciocinio = "high";
export const ESFORCO_PROFUNDO: EsforcoRaciocinio = "xhigh";

export type RotaLlm = {
  model: string;
  fallbacks: string[];
  /** Faixa do catalogo que serve de rede de fallback (nao e mais o modelo primario). */
  faixa: FaixaLlm;
  tipo: TipoTarefaLlm;
  motivo: string;
  legado: boolean;
  /** `profundo` = pesquisa profunda (tier deep). Decide o esforco de raciocinio. */
  modo: ModoRaciocinio;
  /** Esforco aplicado no body. `null` = roteador nao dita (modo legado). */
  esforco: EsforcoRaciocinio | null;
  /** O primario e o padrao da casa? `false` denuncia excecao de capacidade. */
  padraoDaCasa: boolean;
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

/** Modo de raciocinio a partir do tier que o job ja calcula (ou de um booleano explicito). */
export function modoRaciocinio(opts: { tier?: TierProfundidade; profundo?: boolean }): ModoRaciocinio {
  if (typeof opts.profundo === "boolean") return opts.profundo ? "profundo" : "padrao";
  return opts.tier === "deep" ? "profundo" : "padrao";
}

export function esforcoDoModo(modo: ModoRaciocinio): EsforcoRaciocinio {
  return modo === "profundo" ? ESFORCO_PROFUNDO : ESFORCO_PADRAO;
}

function preferirNaLista(lista: LlmModelo[], slug: string): LlmModelo[] {
  const i = lista.findIndex((m) => m.slug === slug);
  if (i <= 0) return lista;
  return [lista[i], ...lista.slice(0, i), ...lista.slice(i + 1)];
}

/**
 * Cadeia OpenRouter: padrao da casa na frente, rede da faixa atras.
 * `preferido` (a escolha antiga daquele tipo de bloco) vira o PRIMEIRO fallback — a rede
 * continua ordenada pelo que a casa mediu melhor para aquele trabalho.
 */
function montarCadeia(
  rede: LlmModelo[],
  primario: string,
  preferido: string,
  n = 4,
): { model: string; fallbacks: string[] } {
  const ord = preferirNaLista(rede.length ? rede : CATALOGO_ECONOMIA, preferido);
  const fallbacks = ord.map((m) => m.slug).filter((s) => s !== primario).slice(0, n - 1);
  return { model: primario, fallbacks };
}

/**
 * Decide modelo + esforco de raciocinio de uma chamada.
 * O modelo e o mesmo para todos os tipos; o que o `tipo` ainda governa e (1) a CAPACIDADE
 * exigida do bloco — que e o unico motivo capaz de tirar o padrao da frente — e (2) a ordem
 * da rede de fallback. O esforco vem do MODO (profundo vs padrao), nunca do tipo.
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
  /** Tier de capacidade do job (`deep` = pesquisa profunda). */
  tier?: TierProfundidade;
  /** Sobrepoe o tier quando o chamador sabe o modo direto. */
  profundo?: boolean;
}): RotaLlm {
  const tipo = opts.tipo;
  const sessionId = opts.sessionId ?? null;
  const modo = modoRaciocinio(opts);

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
      motivo: `legado OPENROUTER_MODEL (${model}) — raciocinio volta a ser das constantes da edge`,
      legado: true,
      modo,
      esforco: null,
      padraoDaCasa: false,
      sessionId,
      costTier,
    };
  }

  const visao = !!opts.temImagem || tipo === "visao" || opts.especialista === "analise_visual_drive";
  let faixa: FaixaLlm = "economia";
  // Escolha anterior do tipo: nao e mais o primario, e a primeira carta da rede de fallback.
  let preferido = "openai/gpt-5.6-luna";
  let req: RequisitoCapacidade = { tools: true };
  let motivo = "";

  switch (tipo) {
    case "planner":
      preferido = "anthropic/claude-haiku-4.5";
      req = { tools: false, json: true };
      motivo = "planner/roteador: JSON curto e fiel ao schema";
      break;
    case "subagente":
      preferido = "openai/gpt-5.6-luna";
      req = { tools: true };
      motivo = `subagente ${opts.especialista ?? "generico"}: loop de tools`;
      if (visao) {
        preferido = "google/gemini-2.5-flash";
        req = { tools: true, visao: true };
        motivo = "subagente de visao: tools + pixel da peca";
      }
      break;
    case "visao":
      preferido = "google/gemini-2.5-flash";
      req = { visao: true, json: true };
      motivo = "quadro/imagem: le pixel e devolve JSON";
      break;
    case "legendas":
      preferido = "google/gemini-3.7-flash";
      req = { json: true, prosa: true };
      motivo = "copy Hook-Beneficio-CTA: prosa PT-BR em JSON";
      break;
    case "compliance":
      preferido = visao ? "google/gemini-2.5-flash" : "anthropic/claude-haiku-4.5";
      req = visao ? { visao: true, json: true } : { json: true };
      motivo = visao ? "compliance com peca: JSON + pixel" : "compliance de texto: JSON";
      break;
    case "reco":
      preferido = "openai/gpt-4o-mini";
      req = { json: true };
      motivo = "card de reco curto: JSON";
      break;
    case "waba":
      preferido = "openai/gpt-5.6-luna";
      req = { json: true, prosa: true };
      motivo = "template UTILITY: prosa sobria em JSON";
      break;
    case "chat_loop":
      if (visao) {
        preferido = "google/gemini-2.5-flash";
        req = { tools: true, visao: true };
        motivo = "chat com anexo visual: tools + pixel";
      } else if (opts.pedidoAto) {
        preferido = "anthropic/claude-haiku-4.5";
        req = { tools: true, json: true };
        motivo = "chat com propose_action: JSON de card fiel";
      } else if (ehPedidoLeituraCruzada(opts.pergunta ?? "")) {
        preferido = "openai/gpt-5.6-luna-pro";
        req = { tools: true, prosa: true };
        motivo = "chat leitura cruzada ads×Drive: nao declarar lacuna sem a tool de origem";
      } else {
        preferido = "openai/gpt-5.6-luna";
        req = { tools: true, prosa: true };
        motivo = "chat operacional: tools + PT-BR";
      }
      break;
    case "coordenacao":
      faixa = "premium";
      preferido = "anthropic/claude-sonnet-5";
      req = { json: true };
      motivo = "coordenacao: julga relatorios";
      break;
    case "sintese":
      if (opts.faixaForcada === "economia") {
        faixa = "economia";
        preferido = "openai/gpt-5.6-luna-pro";
        req = { prosa: true };
        motivo = "sintese lite/standard: prosa longa";
      } else {
        faixa = "premium";
        preferido = "anthropic/claude-sonnet-5";
        req = { prosa: true };
        motivo = "sintese deep: resposta excelente no bloco final";
      }
      break;
    default:
      motivo = "fallback: rede economia";
  }

  if (opts.faixaForcada) faixa = opts.faixaForcada;
  if (faixa === "premium" && tipo !== "sintese" && tipo !== "coordenacao") {
    // A rede de fallback do loop sincrono/subagente nunca vira Opus por acidente.
    faixa = "economia";
    motivo += " [rede premium recusada neste tipo — permanece economia]";
  }

  const rede0 = filtrarCatalogo(faixa, req);
  const rede = rede0.length ? rede0 : (faixa === "premium" ? CATALOGO_PREMIUM : CATALOGO_ECONOMIA);
  // Unica coisa que tira o padrao da frente: o catalogo dizer que ele NAO tem a capacidade
  // que o bloco exige. Preferencia nao tira; cautela nao tira.
  const padraoDaCasa = atendeCapacidade(acharModelo(MODELO_PADRAO), req);
  const primario = padraoDaCasa
    ? MODELO_PADRAO
    : (rede.some((m) => m.slug === preferido) ? preferido : rede[0].slug);
  if (!padraoDaCasa) {
    const faltando = (["tools", "visao", "json", "prosa"] as const).filter((k) => req[k]).join("+");
    motivo += ` [${MODELO_PADRAO} nao declara ${faltando} no catalogo — primario ${primario}]`;
  }
  const cadeia = montarCadeia(rede, primario, preferido);
  const esforco = esforcoDoModo(modo);
  motivo += ` | raciocinio ${esforco} (modo ${modo})`;
  return {
    model: cadeia.model,
    fallbacks: cadeia.fallbacks,
    faixa,
    tipo,
    motivo,
    legado: false,
    modo,
    esforco,
    padraoDaCasa,
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
  // O esforco do roteador VENCE o `reasoning` que a edge mandou no extra: as constantes das
  // edges pedem orcamento em tokens ou desligam o raciocinio, e o padrao da casa nao aceita
  // nenhum dos dois (raciocinio obrigatorio, controle so por effort).
  if (rota.esforco) body.reasoning = { effort: rota.esforco };
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
    // Sem estes tres nao da para auditar se o modo profundo pensou mais nem se alguma
    // chamada saiu do padrao da casa.
    modo_raciocinio: rota.modo,
    esforco_raciocinio: rota.esforco,
    padrao_da_casa: rota.padraoDaCasa,
  };
}
