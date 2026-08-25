import { describe, it, expect } from "vitest";
import {
  ERRO_CONJUNTO_ERRADO,
  ERRO_CRUZAMENTO_LINHA_PRODUTO,
  classificarLinhaProdutoCohapm,
  conjuntoNomeCasaComNumero,
  escolherConjuntosDaMesmaLinha,
  escolherConjuntosPorNumeroELinha,
  escolherNomeCriativoTravado,
  ehFlagSemMolde,
  ehNomeCompostoEstruturado,
  ehSentinelaSemMolde,
  extrairLinksWaMePorConjunto,
  extrairNomesCriativoDaFala,
  extrairSlateDaFala,
  nomeCompostoForaDeEscopoTrafego,
  numeroConjuntoDaFala,
  pecasDoConjunto,
  pareceNomeDePecaNaoMolde,
  recusarConjuntoErrado,
  recusarCruzamentoLinhaProduto,
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

  it("casa CONJ.1_LAF_ com underscore e slash (incidente 25/08)", () => {
    expect(numeroConjuntoDaFala("CONJ.1_LAF_8CRIATIVOS_JUN/JUL26")).toBe(1);
    expect(conjuntoNomeCasaComNumero("CONJ.1_LAF_8CRIATIVOS_JUN/JUL26", 1)).toBe(true);
    expect(conjuntoNomeCasaComNumero("CONJ.1_LAF_8CRIATIVOS_JUNJUL26", 1)).toBe(true);
    expect(conjuntoNomeCasaComNumero("CONJ.01_LAF_x", 1)).toBe(true);
    expect(conjuntoNomeCasaComNumero("CONJ.4_LAF_10CRIATIVOS_AGO26", 1)).toBe(false);
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

describe("cruzamento linha produto COHAPM", () => {
  const pecaLaf = "CONJ.1_LAF_8CRIATIVOS_JUNJUL26_AD01_ChegandoEmCasa_V3";
  const campJur = "COHAPM_JURIDICO_CONV_LEVA01";
  const setJur = "JURIDICO_CONJ.01 - MATURACAO";
  const campLaf = "COHAPM_LAFELICITA_CONV_AGO26";
  const setLaf = "LAFELICITA_CONJ.01 - DESCOBERTA";

  it("recusa peca La Felicità em conjunto Jurídico (incidente 25/08)", () => {
    expect(classificarLinhaProdutoCohapm(pecaLaf)).toBe("la_felicita");
    const r = recusarCruzamentoLinhaProduto({
      estruturaNomes: [campJur, setJur],
      pecaSinais: [pecaLaf],
    });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.erro).toBe(ERRO_CRUZAMENTO_LINHA_PRODUTO);
      expect(r.detalhe).toMatch(/ERRO GRAVE/);
    }
  });

  it("recusa o inverso (Jurídico em La Felicità)", () => {
    const r = recusarCruzamentoLinhaProduto({
      estruturaNomes: [campLaf, setLaf],
      pecaSinais: ["JUR_CONV_CONJ03_AD01_Emprestimo_Pessoal_LEVA02"],
    });
    expect(r.ok).toBe(false);
  });

  it("nao escolhe JURIDICO_CONJ.01 mais novo para peca LAF", () => {
    const hits = [
      { name: setJur, campaign: campJur, created_at: "2026-08-25T17:00:00Z" },
      { name: setLaf, campaign: campLaf, created_at: "2026-08-20T10:00:00Z" },
    ];
    const alinhados = escolherConjuntosDaMesmaLinha(hits, [pecaLaf], (h) => h.campaign);
    expect(alinhados.map((h) => h.name)).toEqual([setLaf]);
  });

  it("recusa CONJ.1 peca no dest CONJ.4 e nao auto-pick o mais novo", () => {
    const set1 = "CONJ.1_LAF_8CRIATIVOS_JUN/JUL26";
    const set4 = "CONJ.4_LAF_10CRIATIVOS_AGO26";
    const r = recusarConjuntoErrado({
      pedidoNumero: 1,
      destNome: set4,
      pecaSinais: [pecaLaf],
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.erro).toBe(ERRO_CONJUNTO_ERRADO);
    const hits = [
      { name: set4, campaign: campLaf, created_at: "2026-08-20T10:00:00Z" },
      { name: set1, campaign: campLaf, created_at: "2026-06-01T10:00:00Z" },
    ];
    const pick = escolherConjuntosPorNumeroELinha(hits, 1, [pecaLaf], (h) => h.campaign);
    expect(pick.map((h) => h.name)).toEqual([set1]);
    const inv = recusarConjuntoErrado({
      pedidoNumero: 4,
      destNome: set1,
      pecaSinais: ["CONJ.4_LAF_10CRIATIVOS_AGO26_AD01"],
    });
    expect(inv.ok).toBe(false);
  });
});

describe("extrairSlateDaFala", () => {
  const fala = `### CONJ.1 — descoberta
| Nº | Criativo | Pasta | drive_file_id | Motivação |
| 1 | 01. Chegando em casa.mp4 | Junho/Vídeos | \`1gs0uF34wD3h4KRrknI5mcZ_Q32iod-tn\` | Abre pela chegada |
**CTA:** conhecer o La Felicità.
| Junho | Vídeos | 99. Inventario.mp4 | \`1AAAAAAAAAAAAAAAAAAAAAAAAAAAAAA\` |`;

  it("pega a peca numerada do CONJ.1 e ignora inventario sem numero", () => {
    const slate = extrairSlateDaFala(fala);
    expect(pecasDoConjunto(slate, 1)).toHaveLength(1);
    expect(slate[0].drive_file_id).toBe("1gs0uF34wD3h4KRrknI5mcZ_Q32iod-tn");
    expect(slate[0].cta).toMatch(/La Felicit/i);
    expect(slate.some((p) => p.nome.includes("Inventario"))).toBe(false);
  });
});
