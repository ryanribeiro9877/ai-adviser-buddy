import { describe, it, expect } from "vitest";
import {
  campanhasDaConta,
  fatiaDoPrazo,
  ordenarContasPorAtividade,
} from "../../supabase/functions/pipeboard-structure-sync/ordem";

// 08/10/2026: o nivel ads varria todas as campanhas da empresa em cada conta e
// estourava o prazo na primeira; as contas com campanha ativa nunca rodavam.

const campanhas = [
  { external_id: "lev-parada", conta: "946388181625874", ativa: false },
  { external_id: "lev-ativa", conta: "3302001729967572", ativa: true },
  { external_id: "lev-pausada", conta: "3302001729967572", ativa: false },
  { external_id: "cohapm-ativa", conta: "1622612945584817", ativa: true },
  { external_id: "sem-conta", conta: null, ativa: true },
];

describe("campanhasDaConta", () => {
  it("lista só as campanhas da própria conta", () => {
    expect(campanhasDaConta(campanhas, "946388181625874")).toEqual(["lev-parada"]);
  });

  it("põe as ativas primeiro, para o prazo cortar o que está parado", () => {
    expect(campanhasDaConta(campanhas, "3302001729967572")).toEqual(["lev-ativa", "lev-pausada"]);
  });

  it("conta sem campanha não gera chamada", () => {
    expect(campanhasDaConta(campanhas, "999")).toEqual([]);
  });
});

describe("ordenarContasPorAtividade", () => {
  it("roda primeiro a conta com mais campanha ativa e por último a parada", () => {
    const contas = [
      { external_id: "946388181625874" },
      { external_id: "act_1622612945584817" },
      { external_id: "3302001729967572" },
    ];
    const ordem = ordenarContasPorAtividade(contas, [
      ...campanhas,
      { external_id: "x", conta: "3302001729967572", ativa: true },
    ]).map((c) => c.external_id);
    expect(ordem).toEqual(["3302001729967572", "act_1622612945584817", "946388181625874"]);
  });
});

describe("fatiaDoPrazo", () => {
  it("duas contas ativas dividem o tempo que resta", () => {
    expect(fatiaDoPrazo(0, 120_000, true, 2)).toBe(60_000);
  });
  it("a última conta ativa leva todo o resto", () => {
    expect(fatiaDoPrazo(60_000, 120_000, true, 1)).toBe(120_000);
  });
  it("conta sem campanha ativa não reserva fatia", () => {
    expect(fatiaDoPrazo(0, 120_000, false, 3)).toBe(120_000);
  });
});
