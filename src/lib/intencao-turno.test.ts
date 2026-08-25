import { describe, it, expect } from "vitest";
import {
  ehPedidoDeAto,
  ehPedidoEmitirConjunto,
  ehPerguntaDeLeitura,
  recusaFalsaMoldeTrafego,
  ehPedidoUploadLote,
  ehUploadLoteCurto,
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

describe("ehPedidoUploadLote", () => {
  it("reconhece subir videos restantes", () => {
    expect(ehPedidoUploadLote("suba os 2 últimos vídeos que ficaram pendentes")).toBe(true);
    expect(ehPedidoUploadLote("carregue as peças na biblioteca")).toBe(true);
    expect(ehPedidoUploadLote(
      "termine de subir os vídeos e me informe quais dos 34 já estão na meta e quais ficaram de fora",
    )).toBe(true);
    expect(ehPedidoUploadLote("qual o gasto de ontem?")).toBe(false);
  });

  it("reconhece recorte curto (2 pendentes) sem teatro de 8 blocos", () => {
    expect(ehUploadLoteCurto("suba os 2 últimos vídeos que ficaram pendentes")).toBe(true);
    expect(ehUploadLoteCurto("suba os restantes", 2)).toBe(true);
    expect(ehUploadLoteCurto("suba os restantes", 20)).toBe(false);
  });
});
