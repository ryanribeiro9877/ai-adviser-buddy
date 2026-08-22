import { describe, it, expect } from "vitest";
import {
  conjuntoNomeCasaComNumero,
  extrairLinksWaMePorConjunto,
  numeroConjuntoDaFala,
  pareceNomeDePecaNaoMolde,
} from "./memoria-conjunto";

describe("numeroConjuntoDaFala", () => {
  it("pega conjunto 2 no pedido de emissao", () => {
    expect(
      numeroConjuntoDaFala(
        "emita primeiro os 3 primeiros cards do conjunto 2, lembre-se de apontar para o link",
      ),
    ).toBe(2);
  });

  it("nao confunde os 3 primeiros com conjunto 3", () => {
    expect(numeroConjuntoDaFala("emita os 3 primeiros cards agora")).toBe(null);
  });
});

describe("extrairLinksWaMePorConjunto", () => {
  it("lê os wa.me definidos para 02 e 03", () => {
    const mapa = extrairLinksWaMePorConjunto(
      "no 02 você define o link: http://wa.me/5571993058759\nno 03 o link: http://wa.me/5571993316245",
    );
    expect(mapa[2]).toBe("http://wa.me/5571993058759");
    expect(mapa[3]).toBe("http://wa.me/5571993316245");
  });

  it("lê tabela de cards de conjunto", () => {
    const mapa = extrairLinksWaMePorConjunto(
      "| 1 | JURIDICO_CONJ.02 - MATURACAO | http://wa.me/5571993058759 |",
    );
    expect(mapa[2]).toBe("http://wa.me/5571993058759");
  });
});

describe("conjuntoNomeCasaComNumero", () => {
  it("casa JURIDICO_CONJ.02", () => {
    expect(conjuntoNomeCasaComNumero("JURIDICO_CONJ.02 - MATURACAO", 2)).toBe(true);
    expect(conjuntoNomeCasaComNumero("JURIDICO_CONJ.01 - MATURACAO", 2)).toBe(false);
  });
});

describe("pareceNomeDePecaNaoMolde", () => {
  it("trata video do drive como peca nova", () => {
    expect(pareceNomeDePecaNaoMolde("Contrato com taxa de juros abusiva (2)-VEED.mp4")).toBe(true);
    expect(pareceNomeDePecaNaoMolde("conjunto_2_criativo_1")).toBe(true);
    expect(pareceNomeDePecaNaoMolde("JUR_CONV_AD01_Conta_de_Luz")).toBe(false);
  });
});
