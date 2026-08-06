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
  const lista = Array.isArray(r.body)
    ? r.body
    : Array.isArray(r.body?.connections)
      ? r.body.connections
      : Array.isArray(r.body?.data)
        ? r.body.data
        : r.body
          ? [r.body]
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
    bruto: r.body,
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

export function argsCreativeDeGraph(
  conta: string,
  body: Record<string, string>,
): Record<string, unknown> {
  const out: Record<string, unknown> = {
    account_id: conta,
    name: body.name,
  };
  if (body.object_story_spec) out.object_story_spec = parseMaybeJson(body.object_story_spec);
  if (body.url_tags) out.url_tags = body.url_tags;
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

export type Reconciliacao = {
  ok: boolean;
  divergencias: string[];
  lido: unknown;
};

export function compararPedidoComGraph(pedido: Record<string, unknown>, lido: any): Reconciliacao {
  const divergencias: string[] = [];
  if (!lido || typeof lido !== "object") {
    return { ok: false, divergencias: ["objeto_nao_lido_na_graph"], lido };
  }
  if (pedido.name != null && String(lido.name ?? "") !== String(pedido.name)) {
    divergencias.push(`name: pediu=${pedido.name} graph=${lido.name ?? null}`);
  }
  if (pedido.status != null) {
    const a = String(pedido.status).toUpperCase();
    const b = String(lido.status ?? "").toUpperCase();
    if (b && a !== b) divergencias.push(`status: pediu=${a} graph=${b}`);
  }
  if (pedido.daily_budget != null && lido.daily_budget != null) {
    if (String(pedido.daily_budget) !== String(lido.daily_budget)) {
      divergencias.push(`daily_budget: pediu=${pedido.daily_budget} graph=${lido.daily_budget}`);
    }
  }
  if (pedido.objective != null && lido.objective != null) {
    if (String(pedido.objective) !== String(lido.objective)) {
      divergencias.push(`objective: pediu=${pedido.objective} graph=${lido.objective}`);
    }
  }
  return { ok: divergencias.length === 0, divergencias, lido };
}
