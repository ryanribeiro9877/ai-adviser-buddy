// Validacao sem efeito na Graph. Verde significa "validado", nunca "garantido".

const GRAPH = "https://graph.facebook.com/v21.0";

export type ResultadoPrevoo =
  | { ok: true; validado_em: string; carimbo: "validado" }
  | { ok: false; validado_em: string; recusa: string; corpo: unknown };

export async function validarSomenteNaMeta(opts: {
  token: string;
  caminho: string;
  body: Record<string, string>;
}): Promise<ResultadoPrevoo> {
  const validado_em = new Date().toISOString();
  const form = new URLSearchParams({
    ...opts.body,
    execution_options: JSON.stringify(["validate_only"]),
    access_token: opts.token,
  });
  let r: Response;
  try {
    r = await fetch(`${GRAPH}${opts.caminho}`, { method: "POST", body: form });
  } catch (e) {
    return {
      ok: false,
      validado_em,
      recusa: String((e as Error)?.message ?? e).slice(0, 300),
      corpo: null,
    };
  }
  const t = await r.text();
  let body: unknown = t.slice(0, 800);
  try {
    body = JSON.parse(t);
  } catch {
    /* texto cru */
  }
  const err = body && typeof body === "object"
    ? (body as { error?: { message?: string } }).error
    : undefined;
  if (!r.ok || err) {
    return {
      ok: false,
      validado_em,
      recusa: String(err?.message ?? `http_${r.status}`).slice(0, 500),
      corpo: body,
    };
  }
  return { ok: true, validado_em, carimbo: "validado" };
}

export function carimboDeValidacao(validadoEm: string) {
  return {
    validado_na_meta_em: validadoEm,
    validacao: "validado" as const,
    nota_validacao: "Validado na Meta. Nao e garantia de que a criacao real passe (video ainda processando, hash invalido).",
  };
}
