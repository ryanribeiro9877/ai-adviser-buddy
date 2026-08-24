import { describe, it, expect } from "vitest";
import {
  ehPedidoDeAto,
  ehPedidoEmitirConjunto,
  ehPerguntaDeLeitura,
  recusaFalsaMoldeTrafego,
} from "./intencao-turno";

describe("ehPerguntaDeLeitura", () => {
  it("reconhece pergunta sobre link do anuncio vs conjunto", () => {
    expect(
      ehPerguntaDeLeitura(
        "antes da aprovação, o anúncio está com o mesmo link de destino do conjunto?",
      ),
    ).toBe(true);
    expect(ehPedidoDeAto("antes da aprovação, o anúncio está com o mesmo link de destino do conjunto?")).toBe(
      false,
    );
  });

  it("nao classifica pedido de emitir card como pergunta", () => {
    expect(ehPerguntaDeLeitura("emita os 3 cards do conjunto 2")).toBe(false);
    expect(ehPedidoDeAto("emita os 3 cards do conjunto 2")).toBe(true);
  });

  it("reconhece consulta de status sem verbo de ato", () => {
    expect(ehPerguntaDeLeitura("consulte novamente o resultado dos 3 vídeos")).toBe(true);
  });

  it("reconhece checagem de link sem interrogacao", () => {
    expect(ehPerguntaDeLeitura("o anúncio está com o mesmo link de destino do conjunto")).toBe(true);
  });
});

describe("recusaFalsaMoldeTrafego", () => {
  it("pega o A vs B de molde vs engajamento", () => {
    const prosa =
      "Não consigo emitir sem dado obrigatório. Não invento um molde de tráfego que não existe. " +
      "Opção A: nome exato de um conjunto de tráfego/website. " +
      "Opção B: crie em engajamento social (OUTCOME_ENGAGEMENT) e alterem manualmente no Gerenciador. Qual é?";
    expect(recusaFalsaMoldeTrafego(prosa)).toBe(true);
    expect(ehPedidoEmitirConjunto("emita os cards dos 2 primeiros conjuntos")).toBe(true);
    expect(recusaFalsaMoldeTrafego("Qual o orçamento diário deste conjunto?")).toBe(false);
  });
});
