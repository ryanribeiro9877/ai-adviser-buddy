// Transporte Pipeboard (MCP Streamable HTTP) para o ultimo passo do meta-actions.
// Nunca preencher access_token: o conector usa a conexao dele. Preencher abriria injecao.
// Leitura/monitoramento/reconciliacao continuam na Graph (META_ADS_TOKEN).

const PIPEBOARD_URL = "https://meta-ads.mcp.pipeboard.co/";

export type DriverEscrita = "graph" | "pipeboard";

export function driverDe(cfg: { driver_escrita?: unknown } | null | undefined): DriverEscrita {
  // CHECK no banco so permite graph|pipeboard. Qualquer outra coisa cai em graph
  // (default seguro) em vez de inventar string livre.
  return cfg?.driver_escrita === "pipeboard" ? "pipeboard" : "graph";
}

// ESP-29: driver POR ACAO. Precedencia: override (driver_por_acao[acao]) > empresa
// (driver_escrita) > graph. Mesmo criterio do RPC resolver_driver. So normaliza o
// transporte do ultimo passo; a matriz de capacidade (ex.: renomear_campanha e
// pipeboard-only) e conferida no RPC pode_executar_acao/resolver_driver.
export function driverParaAcao(
  cfg: { driver_escrita?: unknown; driver_por_acao?: unknown } | null | undefined,
  acao: string,
): DriverEscrita {
  const porAcao = (cfg?.driver_por_acao && typeof cfg.driver_por_acao === "object")
    ? cfg.driver_por_acao as Record<string, unknown>
    : {};
  const override = porAcao?.[acao];
  const bruto = override != null && String(override).trim() !== ""
    ? String(override)
    : (cfg?.driver_escrita as unknown);
  return bruto === "pipeboard" ? "pipeboard" : "graph";
}

export async function pipeboardToken(
  lerSegredo?: (nome: string) => Promise<string>,
): Promise<string> {
  const env = (Deno.env.get("PIPEBOARD_API_TOKEN") ?? "").trim();
  if (env) return env;
  if (lerSegredo) {
    const db = (await lerSegredo("pipeboard_api_token")).trim();
    if (db) return db;
  }
  return "";
}

function parseMaybeJson(v: unknown): unknown {
  if (typeof v !== "string") return v;
  const s = v.trim();
  if (!s) return v;
  if (!(s.startsWith("{") || s.startsWith("["))) return v;
  try {
    return JSON.parse(s);
  } catch {
    return v;
  }
}

/** Remove access_token se alguem tentar passar. Sempre. */
function semToken(args: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(args)) {
    if (k === "access_token") continue;
    if (v === undefined) continue;
    out[k] = v;
  }
  return out;
}

function extrairTextoMcp(result: any): string {
  if (!result) return "";
  if (typeof result === "string") return result;
  if (typeof result?.structuredContent !== "undefined") {
    try {
      return JSON.stringify(result.structuredContent);
    } catch {
      /* */
    }
  }
  const parts = Array.isArray(result?.content) ? result.content : [];
  return parts
    .map((p: any) => (typeof p?.text === "string" ? p.text : ""))
    .filter(Boolean)
    .join("\n");
}

// DUPLA CODIFICACAO DO PIPEBOARD (medido 06-07/08/2026). O texto do content do MCP ja e um JSON e,
// dentro dele, `result` vem como OUTRA string JSON com o corpo real. Ate 07/08 o desembrulho vivia
// so no monitor de conexao, e o resto do wrapper lia o envelope: extrairId devolvia null porque
// {result: "..."} nao tem id, e escreverCreative/escreverAd pontuam ok = r.ok && !!r.id. Uma
// criacao BEM-SUCEDIDA no Pipeboard virava meta_action_failed - sem executed_at, sem espelho, card
// re-executavel - e a varredura seguinte criava o anuncio DE NOVO. Por isso o desembrulho e da
// raiz, nao do monitor. Idempotente de proposito: quem ja desembrulha depois (o parseResult do
// pipeboard-metrics-sync) recebe um objeto sem `result` string e nao faz nada. Limite de
// profundidade porque envelope aninhado sem fim e resposta corrompida, nao dado.
function desembrulharResult(body: any, profundidade = 0): any {
  if (profundidade >= 3) return body;
  if (!body || typeof body !== "object" || Array.isArray(body)) return body;
  if (typeof body.result !== "string") return body;
  try {
    return desembrulharResult(JSON.parse(body.result), profundidade + 1);
  } catch {
    return body;
  }
}

function extrairId(obj: any): string | null {
  if (!obj || typeof obj !== "object") return null;
  for (const k of ["id", "campaign_id", "adset_id", "ad_id", "creative_id"]) {
    const v = obj[k];
    if (v !== undefined && v !== null && String(v).trim()) return String(v);
  }
  if (obj.data && typeof obj.data === "object") return extrairId(obj.data);
  if (obj.result && typeof obj.result === "object") return extrairId(obj.result);
  return null;
}

export type PipeboardResposta = {
  ok: boolean;
  status: number;
  body: any;
  id: string | null;
  dry_run?: boolean;
  erro?: string;
  bruto?: unknown;
};

export async function pipeboardCall(
  tool: string,
  args: Record<string, unknown>,
  token: string,
): Promise<PipeboardResposta> {
  if (!token) {
    return {
      ok: false,
      status: 0,
      body: null,
      id: null,
      erro: "PIPEBOARD_API_TOKEN ausente (Edge Secret ou integration_secrets.pipeboard_api_token)",
    };
  }
  const safe = semToken(args);
  let r: Response;
  let raw: string;
  try {
    r = await fetch(PIPEBOARD_URL, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        accept: "application/json, text/event-stream",
        authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "tools/call",
        params: { name: tool, arguments: safe },
      }),
    });
    raw = await r.text();
  } catch (e) {
    return {
      ok: false,
      status: 0,
      body: null,
      id: null,
      erro: `pipeboard_rede: ${String((e as any)?.message ?? e)}`,
    };
  }

  let parsed: any = null;
  try {
    parsed = JSON.parse(raw);
  } catch {
    // Alguns transports devolvem SSE; tenta a ultima linha JSON.
    const linhas = raw
      .split("\n")
      .map((l) => l.replace(/^data:\s*/, "").trim())
      .filter(Boolean);
    for (let i = linhas.length - 1; i >= 0; i--) {
      try {
        parsed = JSON.parse(linhas[i]);
        break;
      } catch {
        /* */
      }
    }
  }
  if (!parsed) {
    return {
      ok: false,
      status: r.status,
      body: raw.slice(0, 400),
      id: null,
      erro: "pipeboard_non_json",
      bruto: raw.slice(0, 400),
    };
  }
  if (parsed.error) {
    return {
      ok: false,
      status: r.status,
      body: parsed.error,
      id: null,
      erro: String(parsed.error?.message ?? "pipeboard_rpc_error"),
      bruto: parsed,
    };
  }

  const texto = extrairTextoMcp(parsed.result);
  let corpo: any = parsed.result?.structuredContent ?? null;
  if (!corpo && texto) {
    try {
      corpo = JSON.parse(texto);
    } catch {
      corpo = { texto };
    }
  }
  if (!corpo) corpo = parsed.result ?? parsed;
  corpo = desembrulharResult(corpo);

  const sucesso =
    corpo?.success === true || (!!extrairId(corpo) && corpo?.success !== false && !corpo?.error);
  const id = extrairId(corpo);
  return {
    ok: sucesso || (!!id && corpo?.error == null),
    status: r.status,
    body: corpo,
    id,
    dry_run: corpo?.dry_run === true,
    erro: corpo?.error ? String(corpo.error) : undefined,
    bruto: parsed,
  };
}

/** Lista schemas do conector sem executar nenhuma ferramenta. Uso: sondas de capacidade. */
export async function pipeboardListTools(token: string): Promise<{
  ok: boolean;
  status: number;
  tools: any[];
  erro?: string;
}> {
  if (!token) return { ok: false, status: 0, tools: [], erro: "PIPEBOARD_API_TOKEN ausente" };
  try {
    const r = await fetch(PIPEBOARD_URL, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        accept: "application/json, text/event-stream",
        authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list", params: {} }),
    });
    const raw = await r.text();
    const linhas = raw
      .split("\n")
      .map((l) => l.replace(/^data:\s*/, "").trim())
      .filter(Boolean);
    let parsed: any = null;
    for (const candidato of [raw, ...linhas.reverse()]) {
      try {
        parsed = JSON.parse(candidato);
        break;
      } catch {
        /* tenta o proximo */
      }
    }
    const tools = Array.isArray(parsed?.result?.tools) ? parsed.result.tools : [];
    return {
      ok: r.ok && tools.length > 0,
      status: r.status,
      tools,
      ...(parsed?.error ? { erro: String(parsed.error?.message ?? "tools/list falhou") } : {}),
    };
  } catch (e) {
    return { ok: false, status: 0, tools: [], erro: `pipeboard_rede: ${String((e as any)?.message ?? e)}` };
  }
}

export type ConexaoPipeboard = {
  ok: boolean;
  token_status: string | null;
  connection_id: string | null;
  alerta: string | null;
  bruto?: unknown;
  erro?: string;
};

export async function monitorConexaoPipeboard(token: string): Promise<ConexaoPipeboard> {
  if (!token) {
    return {
      ok: false,
      token_status: null,
      connection_id: null,
      alerta: "PIPEBOARD_API_TOKEN ausente — monitor de conexao impossivel",
      erro: "token_ausente",
    };
  }
  const r = await pipeboardCall("list_meta_connections", {}, token);
  if (!r.ok && !r.body) {
    return {
      ok: false,
      token_status: null,
      connection_id: null,
      alerta: `monitor falhou: ${r.erro ?? "sem resposta"}`,
      erro: r.erro,
      bruto: r.bruto ?? r.body,
    };
  }
  // O desembrulho da dupla codificacao (que aqui evitava anunciar "token_status=desconhecido,
  // login pode ter expirado" com o Pipeboard respondendo "active") saiu daqui na v5.1 e passou a
  // ser feito por pipeboardCall, para todos os chamadores. Nada de desembrulhar de novo: r.body
  // ja chega com summary/connections a vista.
  const corpo = r.body;
  const lista = Array.isArray(corpo)
    ? corpo
    : Array.isArray(corpo?.connections)
      ? corpo.connections
      : Array.isArray(corpo?.data)
        ? corpo.data
        : corpo
          ? [corpo]
          : [];
  const primeira = lista[0] ?? null;
  const status = primeira
    ? String(primeira.token_status ?? primeira.status ?? "").trim() || null
    : null;
  const id = primeira ? String(primeira.connection_id ?? primeira.id ?? "").trim() || null : null;
  const ativo = (status ?? "").toLowerCase() === "active";
  return {
    ok: ativo,
    token_status: status,
    connection_id: id,
    alerta: ativo
      ? null
      : `Pipeboard token_status=${status ?? "desconhecido"} — login pessoal pode ter expirado; reconectar em pipeboard.co/connections antes de escrever`,
    bruto: corpo,
  };
}

/** Converte o body form-urlencoded da Graph (strings) no args tipado do Pipeboard. */
export function argsCampanhaDeGraph(
  conta: string,
  body: Record<string, string>,
  opts?: { dry_run?: boolean },
): Record<string, unknown> {
  const cats = parseMaybeJson(body.special_ad_categories);
  const out: Record<string, unknown> = {
    account_id: conta,
    name: body.name,
    objective: body.objective,
    status: body.status ?? "PAUSED",
  };
  if (cats !== undefined) out.special_ad_categories = cats;
  if (body.buying_type) out.buying_type = body.buying_type;
  if (body.daily_budget) out.daily_budget = Number(body.daily_budget);
  if (body.lifetime_budget) out.lifetime_budget = Number(body.lifetime_budget);
  if (body.bid_strategy) out.bid_strategy = body.bid_strategy;
  if (body.is_adset_budget_sharing_enabled !== undefined) {
    out.is_adset_budget_sharing_enabled = body.is_adset_budget_sharing_enabled === "true";
  }
  // ABO REAL PELO PIPEBOARD (medido 07/08/2026, sonda tools/list + teste descartavel controlado).
  // O create_campaign do conector tem um parametro DEDICADO: use_adset_level_budgets (boolean,
  // default false). Com false — que era o comportamento ate aqui — e sem daily_budget no corpo, o
  // conector INJETA daily_budget=1000 (R$ 10,00/dia) e bid_strategy=LOWEST_COST_WITHOUT_CAP, e a
  // campanha nasce CBO. EXPERIMENTO controlado, mesmo caminho de codigo, so o flag mudando:
  // [TESTE-ABO-DESCARTAR-01] com true -> Graph sem daily_budget (Pipeboard devolveu
  // budget_strategy=ad_set_level); [TESTE-ABO-DESCARTAR-02] com false -> Graph daily_budget=1000.
  // Por isso ABO manda use_adset_level_budgets=true e NAO envia orcamento de campanha nenhum.
  // Este campo e do CONECTOR, nao da Graph: quem escreve pela Graph (driver graph) NAO o recebe.
  if (body.use_adset_level_budgets !== undefined) {
    out.use_adset_level_budgets = body.use_adset_level_budgets === "true";
  }
  // dry_run nativo so existe em create_campaign / update_campaign (medido 05/08).
  if (opts?.dry_run) out.dry_run = true;
  return out;
}

export function argsAdsetDeGraph(
  conta: string,
  body: Record<string, string>,
): Record<string, unknown> {
  const out: Record<string, unknown> = {
    account_id: conta,
    campaign_id: body.campaign_id,
    name: body.name,
    status: body.status ?? "PAUSED",
  };
  if (body.daily_budget) out.daily_budget = String(body.daily_budget);
  if (body.lifetime_budget) out.lifetime_budget = String(body.lifetime_budget);
  if (body.targeting) out.targeting = parseMaybeJson(body.targeting);
  if (body.optimization_goal) out.optimization_goal = body.optimization_goal;
  if (body.billing_event) out.billing_event = body.billing_event;
  if (body.bid_amount) out.bid_amount = Number(body.bid_amount);
  if (body.bid_strategy) out.bid_strategy = body.bid_strategy;
  if (body.promoted_object) out.promoted_object = parseMaybeJson(body.promoted_object);
  if (body.destination_type) out.destination_type = body.destination_type;
  if (body.attribution_spec) out.attribution_spec = parseMaybeJson(body.attribution_spec);
  if (body.dsa_beneficiary) out.dsa_beneficiary = body.dsa_beneficiary;
  if (body.dsa_payor) out.dsa_payor = body.dsa_payor;
  return out;
}

// Pipeboard create_ad_creative NAO aceita object_story_spec Graph cru como fonte de midia.
// Evidencia 07/08/2026: POST com object_story_spec.video_data.video_id devolveu
// "No media provided. Specify 'image_hash', 'image_hashes', 'video_id', 'videos', 'images',
// or 'object_story_id'." — o conector exige os campos PLANOS (video_id/page_id/link_url/...).
// Esta funcao desembrulha o spec Graph (o que montarCriacao ja monta) para o schema do
// conector. Nunca preenche access_token.
export function argsCreativeDeGraph(
  conta: string,
  body: Record<string, string>,
): Record<string, unknown> {
  const out: Record<string, unknown> = {
    account_id: conta,
    name: body.name,
  };
  if (body.url_tags) out.url_tags = body.url_tags;

  const spec: any = body.object_story_spec ? parseMaybeJson(body.object_story_spec) : null;
  if (spec && typeof spec === "object") {
    if (spec.page_id) out.page_id = String(spec.page_id);
    const ig = spec.instagram_user_id ?? spec.instagram_actor_id;
    if (ig) out.instagram_actor_id = String(ig);

    const vd: any = spec.video_data ?? null;
    if (vd && typeof vd === "object") {
      if (vd.video_id) out.video_id = String(vd.video_id);
      if (vd.message) out.message = String(vd.message);
      if (vd.image_url) out.thumbnail_url = String(vd.image_url);
      const cta: any = vd.call_to_action ?? null;
      if (cta?.type) out.call_to_action_type = String(cta.type);
      const link = cta?.value?.link ?? vd.link ?? null;
      if (link) out.link_url = String(link);
      return out;
    }

    const ld: any = spec.link_data ?? null;
    if (ld && typeof ld === "object") {
      const kids = Array.isArray(ld.child_attachments) ? ld.child_attachments : [];
      if (kids.length >= 2) {
        // Carrossel: Pipeboard exige midia plana; image_hashes cobre os slides.
        // A escrita completa do carrossel e forçada via Graph em escreverCreative.
        out.image_hashes = kids
          .map((c: any) => String(c?.image_hash ?? "").trim())
          .filter(Boolean);
        if (ld.message) out.message = String(ld.message);
        if (ld.link) out.link_url = String(ld.link);
        const cta: any = ld.call_to_action ?? kids[0]?.call_to_action ?? null;
        if (cta?.type) out.call_to_action_type = String(cta.type);
        const linkCta = cta?.value?.link;
        if (linkCta && !out.link_url) out.link_url = String(linkCta);
        return out;
      }
      if (ld.image_hash) out.image_hash = String(ld.image_hash);
      if (ld.message) out.message = String(ld.message);
      if (ld.name) out.headline = String(ld.name);
      if (ld.description) out.description = String(ld.description);
      if (ld.link) out.link_url = String(ld.link);
      const cta: any = ld.call_to_action ?? null;
      if (cta?.type) out.call_to_action_type = String(cta.type);
      const linkCta = cta?.value?.link;
      if (linkCta && !out.link_url) out.link_url = String(linkCta);
      return out;
    }
  }

  // Fallback: se o body ja vier no vocabulario plano do Pipeboard, repassa.
  if (body.video_id) out.video_id = body.video_id;
  if (body.image_hash) out.image_hash = body.image_hash;
  if (body.page_id) out.page_id = body.page_id;
  if (body.link_url) out.link_url = body.link_url;
  if (body.message) out.message = body.message;
  if (body.thumbnail_url) out.thumbnail_url = body.thumbnail_url;
  if (body.call_to_action_type) out.call_to_action_type = body.call_to_action_type;
  if (body.asset_feed_spec) out.asset_feed_spec = parseMaybeJson(body.asset_feed_spec);
  return out;
}

export function argsAdDeGraph(
  conta: string,
  body: Record<string, string>,
  creativeId: string,
): Record<string, unknown> {
  return {
    account_id: conta,
    name: body.name,
    adset_id: body.adset_id,
    creative_id: creativeId,
    status: body.status ?? "PAUSED",
  };
}

// ==================== RECONCILIACAO POS-ESCRITA ====================
// A LISTA DE CAMPOS E DERIVADA DO NIVEL DO OBJETO, NUNCA DE UM DEFAULT GLOBAL.
// A Graph NAO ignora campo que nao existe no nivel consultado: ela derruba a consulta INTEIRA com
// OAuthException #100 "Tried accessing nonexisting field (X)". Uma unica chave errada na lista
// apaga a resposta toda - por isso "uma lista que serve para todos" nao existe neste dominio.
// E a mesma licao do GT-12, quando pedir url_tags no nivel de anuncio derrubou a coleta completa
// com o mesmo #100. A licao ficou na coleta e nao chegou na reconciliacao: em 07/08 um default
// global com os campos DO ANUNCIO (adset_id, creative{id}) foi usado tambem para campanha e
// conjunto, e a campanha 120254323578040191 - correta na Meta - foi reportada como divergente.
export type NivelMeta = "campanha" | "conjunto" | "anuncio";

// ORCAMENTO DE CAMPANHA ENTROU EM 07/08/2026, e entrou por evidencia. A campanha
// 120254323578040191 foi criada com um corpo SEM daily_budget e SEM bid_strategy, e a Graph
// devolve daily_budget=1000 e bid_strategy=LOWEST_COST_WITHOUT_CAP: o conector Pipeboard injetou
// orcamento de campanha (CBO) por conta propria. As campanhas TESTE-A/B/C, criadas com o MESMO
// corpo pelo driver Graph, estao sem orcamento - o driver e a unica variavel. A reconciliacao de
// campanha conferia objective, status e name e nao olhava dinheiro, entao o objeto nasceu
// diferente do pedido e ninguem soube ate um create_adset ser recusado dias depois.
// daily_budget/lifetime_budget sao campos VALIDOS no nivel de campanha (meta-campaign-status ja
// os le assim ha dias), entao nao ha risco do #100 que motivou a v5.3.
const CAMPOS_DE_RECONCILIACAO: Record<NivelMeta, string> = {
  campanha:
    "id,name,status,effective_status,objective,special_ad_categories,buying_type,daily_budget,lifetime_budget",
  conjunto: "id,name,status,effective_status,daily_budget,campaign_id,bid_strategy,targeting",
  anuncio: "id,name,status,effective_status,adset_id,creative{id}",
};

/** Nivel do objeto que a acao toca. null = desconhecido, e desconhecido NAO recebe palpite. */
export function nivelDaAcao(acao: string): NivelMeta | null {
  switch (acao) {
    case "criar_campanha":
    case "pausar_campanha":
    case "ativar_campanha":
    case "renomear_campanha":
    case "alterar_categoria_especial_campanha":
      return "campanha";
    case "criar_conjunto_a_partir_de":
    case "escalar_duplicar":
    case "alterar_orcamento":
    case "ajustar_posicionamentos_do_conjunto":
    case "pausar_conjunto":
    case "ativar_conjunto":
      return "conjunto";
    case "criar_anuncio_a_partir_de":
    case "pausar_criativo":
    case "ativar_criativo":
      return "anuncio";
    default:
      return null;
  }
}

export function camposDeReconciliacao(nivel: NivelMeta): string {
  return CAMPOS_DE_RECONCILIACAO[nivel];
}

// "conferido" = eu OLHEI o objeto na Graph. Só nesse estado `ok` fala sobre o objeto.
// Os outros dois dizem que NAO houve leitura - nada foi concluido sobre valor nenhum.
export type EstadoReconciliacao = "conferido" | "leitura_falhou" | "nivel_desconhecido";

export type Reconciliacao = {
  ok: boolean;
  estado: EstadoReconciliacao;
  divergencias: string[];
  erro_leitura: string | null;
  campos_pedidos: string | null;
  campos_comparados: string[];
  lido: unknown;
};

// Centavos dos dois lados (o pedido grava String(Math.round(reais*100)) e a Graph devolve string).
// Comparar como TEXTO faria "7200" divergir de 7200 - falso positivo por tipo, no campo em que uma
// divergencia real custa dinheiro.
const CAMPOS_NUMERICOS = new Set(["daily_budget", "lifetime_budget", "bid_amount"]);
const CAMPOS_COMPARAVEIS = [
  "name",
  "status",
  "objective",
  "daily_budget",
  "campaign_id",
  "adset_id",
  "targeting",
  "special_ad_categories",
];

function jsonCanonico(v: unknown): string {
  if (Array.isArray(v)) {
    const itens = v.map((x) => JSON.parse(jsonCanonico(x)));
    if (itens.every((x) => ["string", "number", "boolean"].includes(typeof x))) itens.sort();
    return JSON.stringify(itens);
  }
  if (v && typeof v === "object") {
    const out: Record<string, unknown> = {};
    for (const k of Object.keys(v as Record<string, unknown>).sort()) {
      out[k] = JSON.parse(jsonCanonico((v as Record<string, unknown>)[k]));
    }
    return JSON.stringify(out);
  }
  return JSON.stringify(v);
}

function descreverFalhaDeLeitura(lido: any, httpStatus?: number): string | null {
  const httpRuim = typeof httpStatus === "number" && httpStatus !== 0 && httpStatus !== 200;
  const e = lido && typeof lido === "object" && !Array.isArray(lido) ? (lido as any).error : null;
  if (e) {
    const partes = [
      String(e.type ?? "graph_error"),
      e.code != null ? `#${e.code}` : "",
      String(e.message ?? "").trim() || "(sem mensagem)",
      e.fbtrace_id ? `fbtrace_id=${e.fbtrace_id}` : "",
    ].filter(Boolean);
    return `a Graph respondeu ERRO em vez do objeto: ${partes.join(" ")}${httpRuim ? ` (HTTP ${httpStatus})` : ""}`;
  }
  if (httpRuim) return `a Graph respondeu HTTP ${httpStatus} sem corpo de objeto`;
  if (!lido || typeof lido !== "object" || Array.isArray(lido)) {
    return "a Graph nao devolveu um objeto (resposta vazia ou em formato inesperado)";
  }
  return null;
}

/** Reconciliacao de acao cujo nivel nao se conhece: declara, nao adivinha. Nao le a Graph. */
export function reconciliacaoNivelDesconhecido(acao: string): Reconciliacao {
  return {
    ok: false,
    estado: "nivel_desconhecido",
    divergencias: [],
    erro_leitura: `nivel de objeto desconhecido para a acao "${acao}": sem nivel nao existe lista de campos, e inventar uma lista foi exatamente o defeito de 07/08. Nenhuma leitura foi tentada e nada foi concluido sobre o objeto.`,
    campos_pedidos: null,
    campos_comparados: [],
    lido: null,
  };
}

// FALHA DE LEITURA NAO E DIVERGENCIA. "Nao consegui olhar" e "olhei e a Meta tem outro valor" sao
// fatos diferentes, e colapsa-los foi o que transformou um #100 em alarme de campanha errada.
// Mesma distincao que o resto do sistema ja faz: UNKNOWN != NULL, coletor parado != conta sem
// entrega. Quem chama escolhe a acao de auditoria por `estado`, nunca so por `ok`.
export function compararPedidoComGraph(
  pedido: Record<string, unknown>,
  lido: any,
  opts?: { http_status?: number; campos?: string; exigir_ausentes?: string[] },
): Reconciliacao {
  const camposPedidos = opts?.campos ?? null;
  const falha = descreverFalhaDeLeitura(lido, opts?.http_status);
  if (falha) {
    return {
      ok: false,
      estado: "leitura_falhou",
      divergencias: [],
      erro_leitura: falha,
      campos_pedidos: camposPedidos,
      campos_comparados: [],
      lido,
    };
  }

  const divergencias: string[] = [];
  const comparados: string[] = [];

  // CAMPO QUE NAO FOI PEDIDO E QUE VOLTOU COM VALOR. Comparar so o que esta no pedido deixa passar
  // o defeito inverso: o objeto nasce com ALGO A MAIS que ninguem pediu, e o silencio parece
  // acerto. Foi assim que a campanha 120254323578040191 nasceu CBO - o corpo nao tinha orcamento,
  // o conector pos R$ 10,00/dia, e a conferencia nao tinha o que comparar porque o pedido era
  // vazio naquele campo. Zero e ausencia contam como "nao tem"; qualquer valor positivo e uma
  // divergencia real, e cara, porque muda quem manda no dinheiro.
  for (const campo of opts?.exigir_ausentes ?? []) {
    const obtido = (lido as Record<string, unknown>)[campo];
    if (obtido === undefined || obtido === null || obtido === "") continue;
    const n = Number(obtido);
    if (Number.isFinite(n) && n === 0) continue;
    comparados.push(campo);
    divergencias.push(
      `${campo}: NAO foi pedido (a executora nao enviou este campo) graph=${String(obtido)} — o objeto nasceu com valor que ninguem pediu`,
    );
  }
  // Campo que nao pertence ao nivel nao entra no pedido e portanto nao e comparado: divergencia
  // falsa pelo lado do PEDIDO (objective num conjunto, daily_budget num anuncio) e o mesmo defeito
  // visto do outro angulo.
  for (const campo of CAMPOS_COMPARAVEIS) {
    const querido = pedido[campo];
    if (querido == null || querido === "") continue;
    comparados.push(campo);
    const obtido = (lido as Record<string, unknown>)[campo];
    if (obtido === undefined || obtido === null) {
      divergencias.push(
        `${campo}: pediu=${String(querido)} graph=ausente (campo estava na lista pedida e a Meta nao o devolveu)`,
      );
      continue;
    }
    if (CAMPOS_NUMERICOS.has(campo)) {
      const a = Number(querido);
      const b = Number(obtido);
      if (Number.isFinite(a) && Number.isFinite(b)) {
        if (a !== b) divergencias.push(`${campo}: pediu=${a} graph=${b} (centavos)`);
      } else if (String(querido) !== String(obtido)) {
        divergencias.push(`${campo}: pediu=${String(querido)} graph=${String(obtido)}`);
      }
      continue;
    }
    if (campo === "targeting") {
      if (jsonCanonico(querido) !== jsonCanonico(obtido)) {
        divergencias.push(`targeting: o objeto relido nao confere com o targeting aprovado`);
      }
      continue;
    }
    const a = campo === "status" ? String(querido).toUpperCase() : String(querido);
    const b = campo === "status" ? String(obtido).toUpperCase() : String(obtido);
    if (a !== b) divergencias.push(`${campo}: pediu=${a} graph=${b}`);
  }

  return {
    ok: divergencias.length === 0,
    estado: "conferido",
    divergencias,
    erro_leitura: null,
    campos_pedidos: camposPedidos,
    campos_comparados: comparados,
    lido,
  };
}

/**
 * Acao de audit_log que a reconciliacao merece. Uma funcao so, usada pelo caminho real E pela
 * sonda: se a sonda decidisse por conta propria, ela provaria a sonda, nao o executor.
 */
export function acaoDeAuditoriaDaReconciliacao(rec: Reconciliacao | null): string | null {
  if (!rec) return null;
  if (rec.estado !== "conferido") return "meta_action_reconciliacao_falhou";
  return rec.ok ? null : "meta_action_reconciliacao_divergente";
}
