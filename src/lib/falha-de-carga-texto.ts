/**
 * Extrai a causa legivel de um erro de consulta, para a tela poder DIZER por que
 * falhou em vez de sumir com o assunto.
 *
 * Fica em lib, e nao dentro do componente, pelo motivo que este projeto ja
 * aprendeu duas vezes: logica pura presa em .tsx e logica que nao recebe teste.
 *
 * O contrato importante e o do fim: nada de devolver a string "undefined",
 * "null" ou "[object Object]" para o gestor. Quando nao ha causa utilizavel,
 * devolve "" e quem chama simplesmente nao mostra motivo — melhor sem motivo do
 * que com motivo falso.
 */
export function mensagemDeErro(erro: unknown): string {
  if (erro == null) return "";
  if (typeof erro === "string") return erro.trim();

  if (typeof erro === "object") {
    // PostgrestError e Error caem os dois aqui; `message` e o campo comum.
    const m = (erro as { message?: unknown }).message;
    if (typeof m === "string" && m.trim()) return m.trim();

    // Supabase as vezes traz o detalhe so em `error_description` / `details`.
    for (const campo of ["error_description", "details", "hint", "code"] as const) {
      const v = (erro as Record<string, unknown>)[campo];
      if (typeof v === "string" && v.trim()) return v.trim();
    }
    return "";
  }

  // Numero ou boolean como erro nao ajuda ninguem a entender o que houve.
  return "";
}
