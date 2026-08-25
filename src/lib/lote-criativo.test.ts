import { describe, it, expect } from "vitest";
import { pedidoLoteCriativo, replyLoteComLegendas, replyLoteCriativoIncompleto } from "./lote-criativo";

describe("pedidoLoteCriativo", () => {
  it("reconhece pedido de 6 criativos diferentes + legendas", () => {
    expect(
      pedidoLoteCriativo(
        "escolha 6 criativos diferentes do conjunto ativo e gere as legendas",
      ),
    ).toBe(true);
  });

  it("nao classifica pergunta de gasto como lote", () => {
    expect(pedidoLoteCriativo("quanto gastamos ontem no conjunto 1?")).toBe(false);
  });

  it("nao classifica uma unica peca como lote de 6", () => {
    expect(pedidoLoteCriativo("gere as legendas para este criativo do drive")).toBe(false);
  });

  it("reconhece 8 videos do conjunto 1 + legendas", () => {
    expect(
      pedidoLoteCriativo(
        "iniciar com o conjunto 1 e gere legendas para cada um dos 8 videos que selecionou",
      ),
    ).toBe(true);
  });

  it("reconhece o pedido original de conjuntos 2 e 3", () => {
    expect(
      pedidoLoteCriativo(
        "separe mais 6 criativos diferentes, tanto um do outro (conjunto 2 e 3) quanto do conjunto inicial, e gere as legendas",
      ),
    ).toBe(true);
  });

  it("reconhece reenvio de 6 pecas diferentes sem a palavra legenda", () => {
    expect(
      pedidoLoteCriativo(
        "escolha 6 diferentes do conjunto que está ativo e diferentes um do outro",
      ),
    ).toBe(true);
  });
});

describe("replyLoteCriativoIncompleto", () => {
  it("detecta o encerramento prematuro do conjunto 3", () => {
    expect(
      replyLoteCriativoIncompleto(
        "Legendas pendentes: 3. Não cobertos por falta de tempo de coleta: as três legendas do Conjunto 3.",
      ),
    ).toBe(true);
  });

  it("lote fechado nao dispara", () => {
    expect(
      replyLoteCriativoIncompleto("Selecionei 6 vídeos e gerei as 6 legendas. Segue a tabela."),
    ).toBe(false);
  });

  it("detecta falsa ferramenta indisponivel", () => {
    expect(
      replyLoteCriativoIncompleto(
        "A ferramenta de geração de legendas está indisponível. Posso aguardar ou você escreve na mão.",
      ),
    ).toBe(true);
  });
});

describe("replyLoteComLegendas", () => {
  it("reconhece lote com veredito mesmo com interrogacao na copy", () => {
    expect(
      replyLoteComLegendas(
        "Legenda 1 — Juros altos no contrato? Vale olhar. Veredito: aprovado.\nLegenda 2 — Drive file ID abc. Veredito: aprovado.",
      ),
    ).toBe(true);
  });
});
