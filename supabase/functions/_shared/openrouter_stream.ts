// Leitura do chat/completions com stream.
//
// Sem stream o corpo so chega no fim. Em 24/09/2026 o Grok 4.7 ficou 70s sem um byte
// (openrouter_timeout, tokens 0) e o fallback (Haiku) foi abortado com o que restava
// da janela de 118s — o gestor recebeu a prosa de falha temporaria. Com stream, silencio
// de IDLE_SILENCIO_MS corta o primario e ainda sobra parede para o proximo modelo.
// Geracao que emite pedacos segue ate o teto da chamada.

export const IDLE_SILENCIO_MS = 18_000;

type ToolAcc = { id: string; type: string; name: string; arguments: string };

/** Junta os eventos SSE da OpenRouter num chat completion que o loop ja sabe ler. */
export function completionDeEventosSse(raw: string): Record<string, unknown> {
  let model = "";
  let content = "";
  let finish = "";
  let usage: unknown = null;
  const tools = new Map<number, ToolAcc>();
  for (const line of String(raw ?? "").split("\n")) {
    const t = line.trim();
    if (!t.startsWith("data:")) continue;
    const data = t.slice(5).trim();
    if (!data || data === "[DONE]") continue;
    let j: Record<string, unknown>;
    try {
      j = JSON.parse(data) as Record<string, unknown>;
    } catch {
      continue;
    }
    if (j.model) model = String(j.model);
    if (j.usage) usage = j.usage;
    const choices = j.choices as { finish_reason?: string; delta?: Record<string, unknown>; message?: Record<string, unknown> }[] | undefined;
    const ch = choices?.[0];
    if (!ch) continue;
    if (ch.finish_reason) finish = String(ch.finish_reason);
    const d = (ch.delta ?? ch.message ?? {}) as {
      content?: unknown;
      tool_calls?: { index?: number; id?: string; type?: string; function?: { name?: string; arguments?: string } }[];
    };
    if (typeof d.content === "string") content += d.content;
    if (Array.isArray(d.tool_calls)) {
      for (const tc of d.tool_calls) {
        const idx = Number(tc.index ?? 0);
        const cur = tools.get(idx) ?? { id: "", type: "function", name: "", arguments: "" };
        if (tc.id) cur.id = String(tc.id);
        if (tc.type) cur.type = String(tc.type);
        if (tc.function?.name) cur.name += String(tc.function.name);
        if (typeof tc.function?.arguments === "string") cur.arguments += tc.function.arguments;
        tools.set(idx, cur);
      }
    }
  }
  const tool_calls = [...tools.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([, tc]) => ({
      id: tc.id,
      type: tc.type || "function",
      function: { name: tc.name, arguments: tc.arguments },
    }));
  return {
    model,
    usage,
    choices: [{
      finish_reason: finish || (tool_calls.length ? "tool_calls" : "stop"),
      message: { role: "assistant", content, tool_calls },
    }],
  };
}

export type LeituraOpenRouter = {
  status: number;
  ok: boolean;
  text: string;
  aborted: boolean;
  motivoAbort: "idle" | "cap" | null;
  headers: Headers;
};

/**
 * POST chat/completions. Aborta se nenhum byte chegar em `idleMs` (provedor mudo)
 * ou se a chamada passar de `capMs`. Resposta SSE volta como JSON de completion.
 */
export async function buscarChatOpenRouter(opts: {
  payload: Record<string, unknown>;
  apiKey: string;
  capMs: number;
  idleMs?: number;
}): Promise<LeituraOpenRouter> {
  const idleMs = opts.idleMs ?? IDLE_SILENCIO_MS;
  const ac = new AbortController();
  let motivo: "idle" | "cap" | null = null;
  const cap = setTimeout(() => {
    motivo = "cap";
    ac.abort();
  }, Math.max(1_000, opts.capMs));
  let idle = setTimeout(() => {
    motivo = "idle";
    ac.abort();
  }, idleMs);
  const touch = () => {
    clearTimeout(idle);
    idle = setTimeout(() => {
      motivo = "idle";
      ac.abort();
    }, idleMs);
  };
  const payload = {
    ...opts.payload,
    stream: true,
    stream_options: { include_usage: true },
  };
  try {
    const resp = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${opts.apiKey}` },
      body: JSON.stringify(payload),
      signal: ac.signal,
    });
    touch();
    if (!resp.ok || !resp.body) {
      clearTimeout(idle);
      return { status: resp.status, ok: resp.ok, text: await resp.text(), aborted: false, motivoAbort: null, headers: resp.headers };
    }
    const ct = resp.headers.get("content-type") ?? "";
    if (!ct.includes("event-stream")) {
      clearTimeout(idle);
      return { status: resp.status, ok: true, text: await resp.text(), aborted: false, motivoAbort: null, headers: resp.headers };
    }
    const reader = resp.body.getReader();
    const dec = new TextDecoder();
    let raw = "";
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      touch();
      raw += dec.decode(value, { stream: true });
    }
    raw += dec.decode();
    return {
      status: 200,
      ok: true,
      text: JSON.stringify(completionDeEventosSse(raw)),
      aborted: false,
      motivoAbort: null,
      headers: resp.headers,
    };
  } catch (e) {
    const nome = String((e as { name?: string; message?: string })?.name ?? "");
    const msg = String((e as { message?: string })?.message ?? e);
    if (nome === "AbortError" || /abort/i.test(msg)) {
      return { status: 0, ok: false, text: "", aborted: true, motivoAbort: motivo ?? "cap", headers: new Headers() };
    }
    throw e;
  } finally {
    clearTimeout(cap);
    clearTimeout(idle);
  }
}
