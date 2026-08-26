import { describe, it, expect } from "vitest";
import {
  ehCardDeCriacao,
  linhasPreviaDoCard,
  previaDoCardAprovacao,
  tituloDoCardAprovacao,
} from "./approval-card-texto";

describe("tituloDoCardAprovacao", () => {
  it("criação de anúncio", () => {
    expect(tituloDoCardAprovacao("criar_anuncio_a_partir_de")).toBe("Card de criação de anúncio");
  });
  it("criação de campanha", () => {
    expect(tituloDoCardAprovacao("criar_campanha")).toBe("Card de criação de campanha");
  });
  it("vincular instagram", () => {
    expect(tituloDoCardAprovacao("vincular_instagram_dos_anuncios")).toBe(
      "Card de vincular Instagram",
    );
  });
  it("nao despeja o ensaio do summary como titulo", () => {
    const ensaio =
      'Criar anuncio "X" com PECA NOVA do acervo — compliance atencao, nasce ACTIVE\nCompliance (atencao): LGL-03';
    expect(tituloDoCardAprovacao("criar_anuncio_a_partir_de", ensaio)).toBe(
      "Card de criação de anúncio",
    );
  });
});

describe("previaDoCardAprovacao", () => {
  it("anúncio mostra campanha, conjunto e criativo", () => {
    expect(
      previaDoCardAprovacao("criar_anuncio_a_partir_de", {
        campanha_destino_nome: "JURIDICO_CAMP",
        conjunto_destino_nome: "JURIDICO_CONJ.01 - MATURACAO",
        nome_novo: "JUR_CONV_AD02_Devolucao_Valores",
      }),
    ).toEqual({
      campanha: "JURIDICO_CAMP",
      conjunto: "JURIDICO_CONJ.01 - MATURACAO",
      criativo: "JUR_CONV_AD02_Devolucao_Valores",
    });
  });

  it("conjunto mostra campanha e o nome novo do conjunto", () => {
    expect(
      previaDoCardAprovacao("criar_conjunto_a_partir_de", {
        campanha_destino_nome: "Camp A",
        nome_novo: "Conj novo",
      }),
    ).toEqual({ campanha: "Camp A", conjunto: "Conj novo" });
  });

  it("campanha mostra só o nome novo", () => {
    expect(previaDoCardAprovacao("criar_campanha", { nome_novo: "Camp nova" })).toEqual({
      campanha: "Camp nova",
    });
  });

  it("linhas na ordem Campanha / Conjunto / Criativo", () => {
    const linhas = linhasPreviaDoCard("criar_anuncio_a_partir_de", {
      campanha_destino_nome: "C",
      conjunto_destino_nome: "J",
      nome_novo: "Ad",
    });
    expect(linhas.map((l) => l.rotulo)).toEqual(["Campanha", "Conjunto", "Criativo"]);
  });

  it("completa nomes a partir do summary curto quando o payload nao tem campanha", () => {
    const linhas = linhasPreviaDoCard(
      "criar_anuncio_a_partir_de",
      { conjunto_destino_nome: "J", nome_novo: "Ad" },
      "Campanha: C\nConjunto: J\nCriativo: Ad",
    );
    expect(linhas).toEqual([
      { rotulo: "Campanha", valor: "C" },
      { rotulo: "Conjunto", valor: "J" },
      { rotulo: "Criativo", valor: "Ad" },
    ]);
  });

  it("ehCardDeCriacao", () => {
    expect(ehCardDeCriacao("criar_anuncio_a_partir_de")).toBe(true);
    expect(ehCardDeCriacao("pausar_campanha")).toBe(false);
  });
});
