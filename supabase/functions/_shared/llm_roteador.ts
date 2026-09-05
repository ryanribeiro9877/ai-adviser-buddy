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
// bodyOpenRouter sobrepoe qualquer `reasoning` que a edge tenha mandado no extra — mas desde
// 05/09/2026 ele sobrepoe DECLARANDO: o pedido do chamador sai em `reasoning_pedido` ao lado do
// `esforco_raciocinio` aplicado, com `reasoning_sobreposto: true`, e um `console.warn` no log da
// edge. Ver `bodyOpenRouter`.
//
// EXCECAO A "esforco por modo": tipos que FUNDEM material ja raciocinado nao sobem para `xhigh`
// nem em job deep (`TIPOS_DE_FUSAO`). Medido em 05/09, ver o bloco daquela lista.
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
export type ModoRaciocinio = "triagem" | "interativo" | "fusao" | "padrao" | "profundo";

/**
 * Faixa de esforco por NATUREZA DA TAREFA, nao por agente nem por ponto de chamada.
 *
 * `triagem` nasceu de uma medicao, nao de uma preferencia. O AG-01 devolve `{"agentes":[...]}`
 * — um veredito de ~40 tokens visiveis — e em `high` o Grok 4.6 gastava ~1.900 tokens de
 * raciocinio para produzi-lo, estourando o teto de 1200 do proprio chamador: raciocinio
 * grande demais para caber, e resposta vazia toda vez (agentes_degradado em 5 de 5 turnos).
 * Escolher entre oito agentes catalogados nao e um problema que melhora pensando mais.
 *
 * `low` e o PISO, nao uma escolha de gosto: o raciocinio do padrao da casa e `mandatory:true`
 * — `enabled:false` e effort "none" sao recusados pelo modelo. Nao da para desligar.
 *
 * O que NAO e triagem continua onde o gestor pediu: analise em `high`, pesquisa profunda em
 * `xhigh`. A faixa existe para separar CLASSIFICAR de ANALISAR, nao para economizar no que o
 * gestor le.
 */
export const ESFORCO_TRIAGEM: EsforcoRaciocinio = "low";
/**
 * `interativo` e a faixa de quem escreve COM O GESTOR ESPERANDO, dentro de um teto duro.
 *
 * Nao e triagem — aqui sai a analise que o gestor le — e por isso tem nome proprio: a razao de
 * ser `low` nao e a tarefa ser simples, e o relogio nao caber. Medido em 03/09 no corpo real do
 * loop de ferramentas (52k de contexto, ferramentas de verdade, duas repeticoes por faixa):
 *
 *   esforco | parede por ida | raciocinio | tokens VISIVEIS | resposta
 *   high    | 54,2-57,9s     | 2.405-2.472| 927-1.009       | 2.855-2.973 chars, com numeros
 *   medium  | 43,3-43,7s     | 1.697-2.057| 750-944         | 2.128-2.682 chars, com numeros
 *   low     | 23,3s          |   284      | 773             | 2.358 chars, com numeros
 *
 * A leitura que decide: o raciocinio cai 9x de high para low, e a RESPOSTA VISIVEL nao se mexe
 * — 773 tokens contra 927, ambas com tabela, numero e leitura critica. O gestor paga 33s a mais
 * por ida para receber texto do mesmo tamanho e da mesma natureza.
 *
 * E o turno faz 3-4 idas. Em `high` isso e 168-224s contra teto de 118s: o turno NAO TERMINA, e
 * foi exatamente isso que producao mostrou — 110,1s de mediana, `continuar_turno+seg1`, e o
 * gestor recebendo "Vou localizar os anuncios..." em vez da analise. `medium` tambem nao cabe
 * (3 x 43,5 = 130s). So `low` cabe, com folga.
 *
 * Ou seja: aqui `low` nao troca qualidade por tempo — troca RACIOCINIO INVISIVEL por um turno
 * que chega ao fim. Em `high` a qualidade media era zero, porque nao havia resposta.
 */
export const ESFORCO_INTERATIVO: EsforcoRaciocinio = "low";
/**
 * `fusao` e o MAIS BAIXO QUE ESTE MODELO ACEITA, e o numero e escolhido por isso e nada mais.
 *
 * Quem funde pede `REASONING_OFF` desde sempre (`chamarSinteseParte` no traffic-agent-job). O
 * modelo RECUSA desligar — `enabled:false` e effort "none" nao passam, e `low` e o piso dos
 * `supported_efforts`. Entao este valor nao e uma opiniao sobre quanto o escritor deve pensar:
 * e a traducao mais fiel possivel de um pedido que o provedor nao atende literalmente.
 *
 * `low` e o mesmo piso de `triagem` e `interativo`, e por coincidencia nenhuma: os tres sao
 * casos em que o raciocinio caro nao compra o produto. Ver `TIPOS_DE_FUSAO`.
 */
export const ESFORCO_FUSAO: EsforcoRaciocinio = "low";
export const ESFORCO_PADRAO: EsforcoRaciocinio = "high";
export const ESFORCO_PROFUNDO: EsforcoRaciocinio = "xhigh";

/**
 * Piso de `max_tokens` para quem chama o padrao da casa. MEDIDO, nao estimado.
 *
 * `max_tokens` conta raciocinio + texto visivel, e o raciocinio do Grok 4.6 e obrigatorio.
 * Leitura de chat_messages.tokens_out em 05/09/2026, so respostas do padrao da casa, agrupadas
 * pelo esforco que diagnosticoRota() gravou:
 *
 *   esforco | n  | minimo | p50   | p90/max
 *   high    |  6 | 1.248  | 2.609 | 4.217
 *   low     |  4 | 1.126  | 2.339 | 2.793
 *
 * Ou seja: o teto tem de passar de 4.217 SO PARA O RACIOCINIO CABER, antes de sobrar canal
 * para a resposta. Os tetos que as edges pequenas herdaram foram escritos para modelos com o
 * raciocinio desligado e ficaram abaixo do proprio p50: 2.000 no compliance e 1.500 nos dois
 * redatores WABA. Nesses dois casos o modelo raciocina, estoura, devolve `content` vazio e a
 * edge le isso como "o modelo nao respondeu".
 *
 * 8.000 e ~2x o p90 observado. Nao e gasto: `max_tokens` e TETO, nao reserva — token nao
 * emitido nao e cobrado. O custo de errar para baixo e resposta vazia; para cima, zero.
 */
export const MAX_TOKENS_PISO_RACIOCINIO = 8_000;

/**
 * Teto de saida que respeita o piso do raciocinio.
 *
 * Existe para que o proximo chamador nao precise redescobrir a medicao acima: quem quer um
 * teto proprio passa o seu, e o piso protege quando esse numero foi escrito para um modelo
 * que nao raciocinava. No modo legado o piso nao se aplica — la o raciocinio volta a ser das
 * constantes das edges e um teto baixo e uma escolha, nao um acidente.
 */
export function tetoDeSaida(desejado?: number): number {
  if (roteadorLegado()) return desejado ?? MAX_TOKENS_PISO_RACIOCINIO;
  const n = Number(desejado ?? 0);
  return Number.isFinite(n) && n > MAX_TOKENS_PISO_RACIOCINIO ? n : MAX_TOKENS_PISO_RACIOCINIO;
}

/**
 * Tipos cujo produto e um VEREDITO CURTO E ESTRUTURADO consumido por codigo — nunca prosa
 * que chega ao gestor. Sao os dois blocos que, antes do padrao unico, rodavam com o
 * raciocinio explicitamente DESLIGADO (`REASONING_OFF` no traffic-agent-job): o padrao unico
 * os promoveu a `high` sem que ninguem pedisse, e e essa promocao silenciosa que a faixa
 * desfaz.
 *
 * `sintese`, `subagente`, `chat_loop` e `visao` NAO entram: e neles que a qualidade que o
 * gestor quer aparece.
 *
 * NOTA DE 05/09/2026: `sintese` continua fora DESTA lista — ela nao e triagem, o produto dela e
 * a prosa que chega ao gestor. Mas ela deixou de subir para `xhigh`, por `TIPOS_DE_FUSAO` logo
 * abaixo. As duas coisas nao se contradizem: aqui se decide se a tarefa e VEREDITO CURTO PARA
 * CODIGO (nao e), la se decide se ela precisa da banda mais cara (nao precisa, e a medicao
 * mostrou que com ela a resposta nao sai).
 */
const TIPOS_DE_TRIAGEM: ReadonlySet<TipoTarefaLlm> = new Set<TipoTarefaLlm>([
  "planner",
  "coordenacao",
]);

/**
 * Tipos que rodam com o gestor esperando, sob teto duro de parede (os 118s do turno).
 *
 * `chat_loop` esta aqui e `sintese`/`subagente` NAO estao — a diferenca e o relogio, nao a
 * importancia. O job e assincrono: se a escrita demora 60s, ninguem esta olhando a tela, e por
 * isso o gestor pode continuar comprando raciocinio caro la. No chat, 60s por ida significa
 * turno que nao termina.
 */
const TIPOS_INTERATIVOS: ReadonlySet<TipoTarefaLlm> = new Set<TipoTarefaLlm>([
  "chat_loop",
]);

/**
 * Tipos que FUNDEM material que ja foi raciocinado — e por isso nao sobem para `xhigh`.
 *
 * DECISAO DE 05/09/2026, TOMADA CONTRA MEDICAO, e o bloco de cima (`sintese ... NAO entra`)
 * era a decisao anterior. Ele nao estava errado quando foi escrito: o custo de `xhigh` na
 * sintese era resposta MAIS CURTA. Hoje o custo e resposta NENHUMA, treze vezes seguidas.
 *
 * O QUE A MEDICAO DIZ. Em `job-v4.21`, com a coleta finalmente fechando (dois especialistas
 * saindo `voluntario`, 25.465 e 29.321 tokens de relatorio), a sintese foi CENSURADA em 330s
 * nas duas corridas — `sintese.ms` 330.004 e 330.003, o teto ao milissegundo, com
 * `chars_visiveis: 0`. E nao e tamanho de entrada: 12.101 e 14.329 tokens contra 8.604 do
 * regime magro que CONCLUIA em ~116s. Entrada 1,4x-1,7x maior, tempo >2,8x maior, zero token
 * visivel. O que resta e o raciocinio, e ele estava medido: 5.254 tokens de raciocinio para
 * 980 chars visiveis, ~5,4x mais raciocinio que texto.
 *
 * POR QUE ISSO NAO E "BAIXAR O ESFORCO DOS ESPECIALISTAS", que continua fechado: `subagente`
 * NAO esta nesta lista e continua em `xhigh`. A coleta e quem descobre; ela ja provou que
 * fecha assim e nao se toca. Quem desce e o ESCRITOR, que recebe conclusoes ja raciocinadas
 * uma vez e as funde. Raciocinar de novo, do zero, sobre raciocinio pronto e o gasto que a
 * medicao pegou.
 *
 * A parede nao resolve e nao ha para onde apela-la: 330s ja e o maior teto POR CHAMADA
 * observavel, porque a invocacao da plataforma morre em ~400s. Mais parede nao da mais tempo
 * a chamada.
 *
 * PRIMEIRA TENTATIVA: `high`. MEDIDA E INSUFICIENTE — 1 convergencia em 3.
 *
 *   job        coleta   entrada da sintese   sintese    resultado
 *   187a007b   26.683       12.345 tok       225,6s     `stop`, 11.603 chars, fidelidade 64,8%
 *   6c5bc61f   29.873       12.886 tok       330,0s     censurada, `sintese_vazia`
 *   32c59ac3   25.236       11.556 tok       330,0s     censurada, `sintese_vazia`
 *
 * A convergencia unica veio com 9.620 tokens de raciocinio, e ela PROVOU que o job fecha
 * inteiro — foi a primeira resposta completa com coleta de verdade. Mas duas de tres morreram
 * no mesmo teto, com entrada praticamente igual (11,6k a 12,9k tokens). Entrada igual e
 * desfecho oposto significa que `high` fica EM CIMA do limite, e ai o que decide e a variancia
 * do modelo, nao o orcamento. Um so desses jobs teria bastado para declarar vitoria falsa.
 *
 * ENTAO O ESFORCO DA FUSAO VAI PARA O PISO (`ESFORCO_FUSAO` = `low`), que e honrar de verdade o
 * `REASONING_OFF` que o chamador sempre pediu: os especialistas ja raciocinaram — com 25k a 30k
 * tokens de relatorio e saida `voluntario` —, e o escritor funde e escreve. Raciocinar de novo,
 * do zero, sobre raciocinio pronto e o gasto que a medicao pegou duas vezes.
 *
 * Se `low` convergir com folga, o tempo medido dele e o primeiro numero real que
 * `OPENROUTER_TIMEOUT_MS` tera para apertar em vez de ficar pinado no teto da plataforma. Se NAO
 * convergir, o proximo passo nao e mexer em esforco de novo: e o gate de `sintetizarSegmentada`,
 * hoje inalcancavel no deep porque pede 4 relatorios e o deep roda 2.
 */
const TIPOS_DE_FUSAO: ReadonlySet<TipoTarefaLlm> = new Set<TipoTarefaLlm>([
  "sintese",
]);

export function ehTarefaDeTriagem(tipo: TipoTarefaLlm): boolean {
  return TIPOS_DE_TRIAGEM.has(tipo);
}

export function ehTarefaDeFusao(tipo: TipoTarefaLlm): boolean {
  return TIPOS_DE_FUSAO.has(tipo);
}

export function ehTarefaInterativa(tipo: TipoTarefaLlm): boolean {
  return TIPOS_INTERATIVOS.has(tipo);
}

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
  /**
   * O que o CHAMADOR pediu em `reasoning`, quando o roteador sobrepos. Preenchido por
   * `bodyOpenRouter` — nao sai de `resolverChamadaLlm`, porque so na hora de montar o body e
   * que existe um pedido para comparar. `undefined` = nao houve sobreposicao.
   */
  reasoningPedido?: unknown;
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

/**
 * Modo de raciocinio a partir do TIPO e do tier que o job ja calcula.
 *
 * A natureza da tarefa vence o tier de propósito: o planner de um job `deep` continua sendo
 * classificacao. Deixar `deep` promover a triagem a `xhigh` seria pagar o raciocinio mais
 * caro da casa para escolher um nome de especialista — e foi por essa porta que o Roteador
 * do chat virou codigo morto.
 */
export function modoRaciocinio(
  opts: { tipo?: TipoTarefaLlm; tier?: TierProfundidade; profundo?: boolean },
): ModoRaciocinio {
  if (opts.tipo && ehTarefaDeTriagem(opts.tipo)) return "triagem";
  // O teto do turno tambem vence o tier: um `chat_loop` marcado `deep` continua tendo 118s de
  // parede, e `xhigh` la significaria uma unica ida consumindo metade do orcamento do turno.
  if (opts.tipo && ehTarefaInterativa(opts.tipo)) return "interativo";
  // A fusao tambem vence o tier, e pelo mesmo motivo das duas de cima: o material chega
  // raciocinado. Vem ANTES do `profundo` explicito de proposito — um chamador que pede
  // `profundo: true` esta dizendo "o job e profundo", nao "raciocine de novo o que ja foi
  // raciocinado". Se algum dia a sintese precisar subir, isso passa a ser decisao desta lista
  // e nao efeito colateral de uma flag de tier.
  if (opts.tipo && ehTarefaDeFusao(opts.tipo)) return "fusao";
  if (typeof opts.profundo === "boolean") return opts.profundo ? "profundo" : "padrao";
  return opts.tier === "deep" ? "profundo" : "padrao";
}

export function esforcoDoModo(modo: ModoRaciocinio): EsforcoRaciocinio {
  if (modo === "triagem") return ESFORCO_TRIAGEM;
  if (modo === "interativo") return ESFORCO_INTERATIVO;
  if (modo === "fusao") return ESFORCO_FUSAO;
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
  /**
   * O esforco do roteador VENCE o `reasoning` que a edge mandou no extra: as constantes das
   * edges pedem orcamento em tokens ou desligam o raciocinio, e o padrao da casa nao aceita
   * nenhum dos dois (raciocinio obrigatorio, controle so por effort).
   *
   * MAS VENCE DECLARANDO, desde 05/09/2026. Antes esta linha engolia o pedido em silencio, e
   * foi assim que `chamarSinteseParte` passou semanas pedindo `REASONING_OFF` e rodando
   * `xhigh` sem que nada no codigo nem na telemetria dissesse isso — quem lia o job via
   * "raciocinio desligado" e a conta de tempo nao fechava por um fator de 5x. Sobreposicao
   * muda de intencao declarada e a mesma patologia do portao que diz que avaliou quando parou
   * no meio: o registro fica coerente consigo mesmo e mente sobre o que aconteceu.
   *
   * A FORMA ESCOLHIDA E TELEMETRIA, NAO ERRO. Erro seria mais forte, e foi considerado: hoje
   * ha chamadores pedindo `enabled:false` em edges que este trabalho nao pode alterar, e
   * derrubar producao para provar um ponto trocaria uma mentira por uma queda. Fica o par
   * pedido/aplicado em `diagnosticoRota` e um aviso no log — quem auditar ve a divergencia sem
   * precisar ler este arquivo.
   */
  if (rota.esforco) {
    const pedido = (extra as { reasoning?: unknown }).reasoning;
    const aplicado = { effort: rota.esforco };
    if (pedido !== undefined && JSON.stringify(pedido) !== JSON.stringify(aplicado)) {
      rota.reasoningPedido = pedido;
      console.warn(
        `[llm_roteador] reasoning do chamador sobreposto: tipo=${rota.tipo} modo=${rota.modo} ` +
          `pedido=${JSON.stringify(pedido)} aplicado=${JSON.stringify(aplicado)}`,
      );
    }
    body.reasoning = aplicado;
  }
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
    // O par pedido/aplicado. Fora quando nao houve divergencia, para nao poluir toda linha com
    // `null` — a presenca do campo E o sinal de que alguem pediu uma coisa e recebeu outra.
    ...(rota.reasoningPedido !== undefined
      ? { reasoning_pedido: rota.reasoningPedido, reasoning_sobreposto: true }
      : {}),
  };
}
