import { describe, it, expect } from "vitest";
import {
  conferirOrcamentoReais,
  ehFlagOrcamentoConfirmadoReais,
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

  it("valor nao positivo ou nao finito e recusado antes de qualquer conta", () => {
    // Orcamento 0 ou negativo passaria adiante e a Meta recusaria depois, com
    // mensagem que nao diz ao gestor o que ele fez de errado.
    for (const reais of [0, -5, Number.NaN, Number.POSITIVE_INFINITY]) {
      const r = conferirOrcamentoReais({ reais });
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.erro).toBe("orcamento_invalido");
    }
  });

  it("valor que nao e o do contrato nem os centavos dele e recusado citando o do gestor", () => {
    // O caminho mais perigoso: 50 quando o combinado foi 30. Nao e centavos, e
    // divergencia — e a mensagem tem de repetir o numero que o gestor falou.
    const r = conferirOrcamentoReais({ reais: 50, contrato: 30 });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.erro).toBe("orcamento_diferente_do_contrato");
      expect(r.detalhe).toContain("R$ 30.00/dia");
      expect(r.detalhe).toContain("R$ 50.00");
    }
  });

  it("contrato zero ou nulo nao vale como contrato", () => {
    expect(conferirOrcamentoReais({ reais: 30, contrato: 0 })).toEqual({ ok: true, reais: 30 });
    expect(conferirOrcamentoReais({ reais: 30, contrato: null })).toEqual({ ok: true, reais: 30 });
  });
});

describe("ehFlagOrcamentoConfirmadoReais", () => {
  // A flag e a unica coisa entre "3000 e engano de centavos" e "3000 e proposito".
  it("aceita o booleano, o 1 numerico e a string que o LLM manda", () => {
    expect(ehFlagOrcamentoConfirmadoReais(true)).toBe(true);
    expect(ehFlagOrcamentoConfirmadoReais(1)).toBe(true);
    expect(ehFlagOrcamentoConfirmadoReais("true")).toBe(true);
    expect(ehFlagOrcamentoConfirmadoReais("  TRUE  ")).toBe(true);
  });

  it("qualquer outra coisa e falso — confirmar por acidente libera centavos como reais", () => {
    expect(ehFlagOrcamentoConfirmadoReais(false)).toBe(false);
    expect(ehFlagOrcamentoConfirmadoReais(0)).toBe(false);
    expect(ehFlagOrcamentoConfirmadoReais(null)).toBe(false);
    expect(ehFlagOrcamentoConfirmadoReais(undefined)).toBe(false);
    expect(ehFlagOrcamentoConfirmadoReais("sim")).toBe(false);
  });
});

describe("pareceOrcamentoCentavosComoReais — bordas da heuristica", () => {
  it("recusa nao finito, nao inteiro e valor baixo", () => {
    expect(pareceOrcamentoCentavosComoReais(Number.NaN)).toBe(false);
    expect(pareceOrcamentoCentavosComoReais(0)).toBe(false);
    expect(pareceOrcamentoCentavosComoReais(400)).toBe(false);
  });

  it("recusa valor que nao e multiplo de 100 (1234 nao e 12,34 em centavos)", () => {
    expect(pareceOrcamentoCentavosComoReais(1234)).toBe(false);
  });

  it("recusa quando o valor em reais sairia fora da faixa plausivel de diaria", () => {
    // 9000 -> R$ 90/dia esta acima do teto de 80 da heuristica; assumir centavos
    // aqui corrigiria um valor que talvez fosse proposital.
    expect(pareceOrcamentoCentavosComoReais(9000)).toBe(false);
  });
});

describe("extrairOrcamentoDiarioDaFala — bordas", () => {
  it("fala vazia, nula ou sem numero nao inventa orcamento", () => {
    expect(extrairOrcamentoDiarioDaFala("")).toBe(null);
    expect(extrairOrcamentoDiarioDaFala("   ")).toBe(null);
    expect(extrairOrcamentoDiarioDaFala(null as unknown as string)).toBe(null);
    expect(extrairOrcamentoDiarioDaFala("sem numero nenhum na fala")).toBe(null);
  });

  it("ano nao e dinheiro: 2026 na fala nao vira orcamento", () => {
    expect(extrairOrcamentoDiarioDaFala("o orcamento de 2026 ainda nao fechou")).toBe(null);
  });

  it("valor acima do teto nao e diaria de conjunto", () => {
    expect(extrairOrcamentoDiarioDaFala("orcamento de 9999")).toBe(null);
  });

  it("valor entre parenteses so conta perto de contexto de orcamento", () => {
    // "(30,00)" no meio de um contrato de conjuntos e orcamento; o mesmo
    // "(45,00)" numa lista de tarefas nao e.
    expect(extrairOrcamentoDiarioDaFala("o item (45,00) ficou para a proxima etapa")).toBe(null);
  });
});
