import { describe, it, expect } from "vitest";
import {
  conjuntoNomeCasaComNumero,
  escolherNomeCriativoTravado,
  ehFlagSemMolde,
  ehNomeCompostoEstruturado,
  ehSentinelaSemMolde,
  extrairLinksWaMePorConjunto,
  extrairNomesCriativoDaFala,
  nomeCompostoForaDeEscopoTrafego,
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

describe("ehSentinelaSemMolde", () => {
  it("reconhece sem_molde mesmo depois da norm() do chat (que remove _)", () => {
    const norm = (s: string) =>
      s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[-_\s]+/g, "");
    expect(norm("sem_molde")).toBe("semmolde");
    expect(norm("sem_molde") === "sem_molde").toBe(false);
    expect(ehSentinelaSemMolde("sem_molde")).toBe(true);
    expect(ehSentinelaSemMolde("_sem_molde")).toBe(true);
    expect(ehSentinelaSemMolde("sem-molde")).toBe(true);
    expect(ehSentinelaSemMolde("sem molde")).toBe(true);
    expect(ehSentinelaSemMolde("JURIDICO_CONJ.01")).toBe(false);
    expect(ehFlagSemMolde(true)).toBe(true);
    expect(ehFlagSemMolde("true")).toBe(true);
    expect(ehFlagSemMolde(false)).toBe(false);
  });
});

describe("trava de nome livre do contrato", () => {
  const contrato = [
    "JUR_CONV_CONJ03_AD01_Emprestimo_Pessoal_LEVA02",
    "JUR_CONV_CONJ03_AD02_Emprestimo_Conta_Corrente_LEVA02",
    "JUR_CONV_CONJ03_AD03_Cartao_Armadilha_LEVA02",
  ];

  it("extrai os 3 nomes que o agente listou", () => {
    expect(
      extrairNomesCriativoDaFala(
        "1. JUR_CONV_CONJ03_AD01_Emprestimo_Pessoal_LEVA02 (Empréstimo pessoal)\n" +
          "2. JUR_CONV_CONJ03_AD02_Emprestimo_Conta_Corrente_LEVA02\n" +
          "3. JUR_CONV_CONJ03_AD03_Cartao_Armadilha_LEVA02 (Cartão Armadilha)",
      ),
    ).toEqual(contrato);
  });

  it("recusa [COHAPM][WA][LEADS] quando a conversa ja tem nomes", () => {
    const r = escolherNomeCriativoTravado({
      nomePedido: "[COHAPM][WA][LEADS][JURIDICO][NOVO][AGO26]",
      nomesContrato: contrato,
      conjuntoNumero: 3,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.erro).toBe("nome_trocado_pelo_padrao_estruturado");
  });

  it("auto-preenche o AD03 livre quando AD01/AD02 ja foram usados", () => {
    const r = escolherNomeCriativoTravado({
      nomePedido: "",
      nomesContrato: contrato,
      nomesJaUsados: contrato.slice(0, 2),
      conjuntoNumero: 3,
    });
    expect(r).toEqual({
      ok: true,
      nome: "JUR_CONV_CONJ03_AD03_Cartao_Armadilha_LEVA02",
      origem: "conversa",
    });
  });

  it("marca [WA][LEADS] como fora do escopo de trafego", () => {
    expect(ehNomeCompostoEstruturado("[COHAPM][WA][LEADS][JURIDICO][NOVO][AGO26]")).toBe(true);
    expect(nomeCompostoForaDeEscopoTrafego("[COHAPM][WA][LEADS][JURIDICO][NOVO][AGO26]")).toBe(true);
    expect(nomeCompostoForaDeEscopoTrafego("JUR_CONV_CONJ03_AD03_Cartao_Armadilha_LEVA02")).toBe(false);
  });
});
