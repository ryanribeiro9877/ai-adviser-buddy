import { describe, it, expect } from "vitest";
import { contasAtivasFora } from "../../supabase/functions/pipeboard-structure-sync/ordem";

// 06-08/10/2026: a rodada de anuncios voltava ok:true, truncado=true, com as contas da
// COHAPM "pulado_por_prazo", e o registro dizia "sucesso". A lista contas_ativas_fora e o
// que conferir_execucoes_http le para marcar a rodada como falha parcial e alertar por conta.

const COHAPM = "57f755b9-c23d-4f58-a488-8173d697c010";
const LEV = "ded20b38-f42e-4c71-800c-31b97ea48bcf";
const comAtiva = new Set(["1622612945584817", "3302001729967572"]);

describe("contasAtivasFora", () => {
  it("aponta a conta com campanha ativa pulada pelo prazo", () => {
    const fora = contasAtivasFora(
      [
        { company_id: LEV, account_id: "3302001729967572", upserted: 97 },
        { company_id: COHAPM, account_id: "1622612945584817", pulado_por_prazo: true },
      ],
      comAtiva,
    );
    expect(fora).toEqual([{ company_id: COHAPM, account_id: "1622612945584817", motivo: "pulado_por_prazo" }]);
  });

  it("ignora conta sem campanha ativa pulada: nao ha anuncio vivo para perder", () => {
    const fora = contasAtivasFora(
      [{ company_id: LEV, account_id: "946388181625874", pulado_por_prazo: true }],
      comAtiva,
    );
    expect(fora).toEqual([]);
  });

  it("aponta a conta ativa que falhou com erro, transiente ou nao", () => {
    const fora = contasAtivasFora(
      [{ company_id: LEV, account_id: "act_3302001729967572", error: "pipeboard_rede: http2" }],
      comAtiva,
    );
    expect(fora).toEqual([
      { company_id: LEV, account_id: "act_3302001729967572", motivo: "erro", erro: "pipeboard_rede: http2" },
    ]);
  });

  it("rodada completa nao gera nada", () => {
    const fora = contasAtivasFora(
      [
        { company_id: LEV, account_id: "3302001729967572" },
        { company_id: COHAPM, account_id: "1622612945584817" },
      ],
      comAtiva,
    );
    expect(fora).toEqual([]);
  });
});
