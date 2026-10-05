// Leitura SSE da OpenRouter que NAO perde o que ja chegou.
//
// Sem stream, o aborto do relogio joga fora a resposta inteira: o corpo so existe quando o
// modelo termina. Com stream, cada pedaco do texto chega enquanto e escrito; se o relogio
// cortar, o que ja veio volta com `finish_reason: "timeout_parcial"` e `cortado: true`.
// O retorno imita o JSON nao-stream (`choices[0].message.content`, `usage`, `model`) para os
// chamadores lerem do mesmo jeito.

export type StreamLido = {
  content: string;
  cortado: boolean;
  erro?: string;
  parsed: Record<string, unknown>;
};

export async function lerStreamOpenRouter(
  body: ReadableStream<Uint8Array>,
  signal?: AbortSignal,
): Promise<StreamLido> {
  const reader = body.getReader();
  const dec = new TextDecoder();
  let buf = "";
  let content = "";
  let finish = "";
  let model = "";
  let usage: Record<string, unknown> | undefined;
  let erro: string | undefined;
  let cortado = false;
  let fim = false;

  const consumirLinha = (linha: string) => {
    const l = linha.trim();
    if (!l.startsWith("data:")) return; // comentarios ": OPENROUTER PROCESSING" e linhas vazias
    const dado = l.slice(5).trim();
    if (dado === "[DONE]") {
      fim = true;
      return;
    }
    let j: Record<string, any>;
    try {
      j = JSON.parse(dado);
    } catch {
      return;
    }
    if (j.error) erro = String(j.error?.message ?? j.error?.code ?? JSON.stringify(j.error)).slice(0, 300);
    if (j.model) model = String(j.model);
    if (j.usage) usage = j.usage;
    const ch = Array.isArray(j.choices) ? j.choices[0] : null;
    if (ch?.delta?.content) content += String(ch.delta.content);
    if (ch?.message?.content) content += String(ch.message.content);
    if (ch?.finish_reason) finish = String(ch.finish_reason);
  };

  try {
    while (!fim) {
      if (signal?.aborted) {
        cortado = true;
        break;
      }
      const { value, done } = await reader.read();
      if (done) break;
      buf += dec.decode(value, { stream: true });
      let i: number;
      while ((i = buf.indexOf("\n")) >= 0) {
        consumirLinha(buf.slice(0, i));
        buf = buf.slice(i + 1);
        if (fim) break;
      }
    }
    if (buf) consumirLinha(buf);
  } catch {
    // Aborto do relogio (ou queda da conexao) no meio do corpo: fica o que ja chegou.
    cortado = true;
  } finally {
    try {
      reader.releaseLock();
    } catch { /* ja liberado */ }
  }
  if (cortado && !finish) finish = "timeout_parcial";
  if (!finish && erro) finish = "erro_stream";
  return {
    content,
    cortado,
    erro,
    parsed: {
      model,
      choices: [{ message: { role: "assistant", content }, finish_reason: finish || "stop" }],
      ...(usage ? { usage } : {}),
      ...(erro ? { erro_stream: erro } : {}),
    },
  };
}
