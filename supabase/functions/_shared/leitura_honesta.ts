// Falha, vazio e zero nao sao a mesma coisa.
// Uma consulta que quebra devolve consulta_falhou. Um JSON de ferramenta que nao
// faz parse recusa a chamada. Ninguem trata isso como lista vazia nem como {}.

export function consultaFalhou(onde: string, motivo: string) {
  return {
    consulta_falhou: true as const,
    onde,
    motivo: String(motivo ?? "").slice(0, 400),
    aviso:
      "A consulta falhou. Isto NAO e lista vazia, NAO e zero e NAO significa que esta tudo em ordem. Relate a falha. Nao conclua a partir dela.",
  };
}

export function parseArgumentosDeFerramenta(raw: string | null | undefined):
  | { ok: true; args: Record<string, unknown> }
  | { ok: false; erro: "argumentos_invalidos"; detalhe: string; nudge: string } {
  const texto = raw == null ? "" : String(raw);
  const recusa = (detalhe: string) => ({
    ok: false as const,
    erro: "argumentos_invalidos" as const,
    detalhe,
    nudge:
      "Reemita a mesma ferramenta com um objeto JSON valido. A chamada NAO rodou. Nao trate isto como dado e nao invente o retorno.",
  });
  if (!texto.trim()) return recusa("argumentos ausentes");
  try {
    const parsed = JSON.parse(texto);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return recusa("argumentos nao sao um objeto JSON");
    }
    return { ok: true, args: parsed as Record<string, unknown> };
  } catch (e) {
    return recusa(String((e as Error)?.message ?? e).slice(0, 180));
  }
}
