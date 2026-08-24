import { describe, it, expect } from "vitest";
import {
  conferirOrcamentoReais,
  extrairOrcamentoDiarioDaFala,
  pareceOrcamentoCentavosComoReais,
} from "./orcamento-reais";

describe("extrairOrcamentoDiarioDaFala", () => {
  it("pega (30,00) no contrato dos 4 conjuntos e ignora idade 30-65", () => {
    const fala =
      "2= região metropolitana de Salvador e pessoas com idade de 30 à 65 anos.\n" +
      "a diferença entre os dois grupos não será o orçamento e sim os criativos, " +
      "o conjunto 4 receberá 10 criativos, os outros apenas 8 cada um.\n" +
      "o orçamento será o mesmo nos 4 (30,00).\n" +
      "CONJ.1_LAF_8CRIATIVOS_JUN/JUL26";
    expect(extrairOrcamentoDiarioDaFala(fala)).toBe(30);
  });
});

describe("pareceOrcamentoCentavosComoReais", () => {
  it("marca 3000 como centavos de 30", () => {
    expect(pareceOrcamentoCentavosComoReais(3000)).toBe(true);
    expect(pareceOrcamentoCentavosComoReais(30)).toBe(false);
    expect(pareceOrcamentoCentavosComoReais(30.5)).toBe(false);
  });
});

describe("conferirOrcamentoReais", () => {
  it("corrige 3000 para 30 quando o contrato e 30", () => {
    expect(conferirOrcamentoReais({ reais: 3000, contrato: 30 })).toEqual({ ok: true, reais: 30 });
  });

  it("aceita 30 quando o contrato e 30", () => {
    expect(conferirOrcamentoReais({ reais: 30, contrato: 30 })).toEqual({ ok: true, reais: 30 });
  });

  it("recusa 3000 sem contrato (heuristica de centavos)", () => {
    const r = conferirOrcamentoReais({ reais: 3000 });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.erro).toBe("orcamento_parece_centavos");
  });

  it("aceita 3000 so com confirmacao explicita", () => {
    expect(conferirOrcamentoReais({ reais: 3000, confirmadoReais: true })).toEqual({
      ok: true,
      reais: 3000,
    });
  });
});
