/**
 * UPDATE barrado pela RLS devolve 0 linhas e error null.
 * Tratar isso como "salvo" grava uma mentira na tela.
 * A chamada precisa de .select("id") para as linhas voltarem.
 */
export async function updateQueGravou(
  resultado: PromiseLike<{
    error: { message: string } | null;
    data: unknown[] | null;
  }>,
): Promise<{ ok: true } | { ok: false; motivo: string }> {
  const { error, data } = await resultado;
  if (error) return { ok: false, motivo: error.message };
  if (!Array.isArray(data) || data.length === 0) {
    return {
      ok: false,
      motivo: "nenhuma linha foi gravada (permissao ou registro inexistente)",
    };
  }
  return { ok: true };
}
