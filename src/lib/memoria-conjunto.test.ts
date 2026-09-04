import { describe, it, expect } from "vitest";
import {
  ERRO_CONJUNTO_ERRADO,
  ERRO_CRUZAMENTO_LINHA_PRODUTO,
  ERRO_VOZ_LINHA_ERRADA,
  classificarLinhaProdutoCohapm,
  conjuntoNomeCasaComNumero,
  escolherConjuntosDaMesmaLinha,
  escolherConjuntosPorNumeroELinha,
  escolherNomeCriativoTravado,
  ehFlagSemMolde,
  ehNomeCompostoEstruturado,
  ehProsaDeLegenda,
  ehSentinelaSemMolde,
  extrairLinksWaMePorConjunto,
  extrairNomesCriativoDaFala,
  extrairSlateDaFala,
  filtrarOperacionais,
  nomeCompostoForaDeEscopoTrafego,
  nomeCriativoDoConjunto,
  numeroAnuncioDaChave,
  numeroConjuntoDaFala,
  numeroConjuntoDeSinais,
  pecaChaveDoSlate,
  pecasDoConjunto,
  pareceNomeDePecaNaoMolde,
  recusarConjuntoErrado,
  recusarCruzamentoLinhaProduto,
  statusObjetoOperacional,
  temSlateNoTexto,
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

  it("classifica VISTTA/Sistema Ocular e recusa cruzamento com Juridico", () => {
    expect(classificarLinhaProdutoCohapm("COHAPM - VISTTA")).toBe("sistema_ocular");
    expect(classificarLinhaProdutoCohapm("COHAPM_SISTEMA_OCULAR_CONV")).toBe("sistema_ocular");
    const r = recusarCruzamentoLinhaProduto({
      estruturaNomes: [campJur, setJur],
      pecaSinais: ["COHAPM Sistema Ocular · VISTTA/2026/08. Agosto/Criativo 01.jpeg"],
    });
    expect(r.ok).toBe(false);
  });

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

  it("legenda Juridico em peca APENAS_OCULOS/VISTTA e voz errada, nao troca de campanha", () => {
    expect(classificarLinhaProdutoCohapm("AD_CONJ.2_APENAS_OCULOS_3")).toBe("sistema_ocular");
    const caption =
      "Você tem sentido vista cansada ou dor de cabeça no fim do dia? Acompanhar a saúde dos olhos com exames regulares previne problemas graves. Toque no botão abaixo e fale com nossa equipe pelo WhatsApp oficial do Jurídico COHAPM.";
    const r = recusarCruzamentoLinhaProduto({
      estruturaNomes: ["COHAPM_VISTTA_CONV_WA_SET26", "CONJ.2_VISTTA_WA_7199185-8107"],
      pecaSinais: ["AD_CONJ.2_APENAS_OCULOS_3", caption],
    });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.erro).toBe(ERRO_VOZ_LINHA_ERRADA);
      expect(r.detalhe).toMatch(/NAO mude a campanha/);
    }
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

  it("texto sem os tres sinais nao e slate (nao inventa peca de conversa solta)", () => {
    // temSlateNoTexto e o portao: sem conjunto + drive_file_id + .mp4 juntos, o
    // resto do fluxo nao deve tratar a fala como contrato de pecas.
    expect(temSlateNoTexto(fala)).toBe(true);
    expect(temSlateNoTexto("CONJ.1 tem 8 criativos")).toBe(false);
    expect(temSlateNoTexto("")).toBe(false);
    expect(temSlateNoTexto(null as unknown as string)).toBe(false);
  });

  it("peca cujo nome vira slug vazio ainda recebe chave estavel (cai no drive id)", () => {
    // Sem o fallback duas pecas de nome ilegivel colidiriam em "conjunto_2_",
    // e a segunda sobrescreveria a primeira no slate.
    expect(
      pecaChaveDoSlate({ conjunto: 2, nome: "###.mp4", drive_file_id: "1AAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" }),
    ).toBe("conjunto_2_1AAAAAAAAAAA");
  });
});

describe("inventario operacional — DELETED/ARCHIVED nao existem para operacao", () => {
  // Nunca teve teste. Se este filtro inverter, o sistema passa a emitir card
  // para objeto Meta apagado, e o erro so aparece no Gerenciador.
  it("apagado e arquivado saem; pausado e ativo continuam no inventario", () => {
    expect(statusObjetoOperacional("ACTIVE")).toBe(true);
    expect(statusObjetoOperacional("PAUSED")).toBe(true);
    expect(statusObjetoOperacional("CAMPAIGN_PAUSED")).toBe(true);
    expect(statusObjetoOperacional("ADSET_PAUSED")).toBe(true);
    expect(statusObjetoOperacional("DELETED")).toBe(false);
    expect(statusObjetoOperacional("ARCHIVED")).toBe(false);
  });

  it("compara sem depender de caixa nem de espaco em volta", () => {
    expect(statusObjetoOperacional(" deleted ")).toBe(false);
    expect(statusObjetoOperacional("Archived")).toBe(false);
  });

  it("status ausente NAO esconde o objeto — falta de dado nao e apagamento", () => {
    expect(statusObjetoOperacional(null)).toBe(true);
    expect(statusObjetoOperacional(undefined)).toBe(true);
  });

  it("filtrarOperacionais tolera lista nula e tira so os apagados", () => {
    expect(filtrarOperacionais(null)).toEqual([]);
    expect(filtrarOperacionais(undefined)).toEqual([]);
    const rows = [
      { status: "ACTIVE", name: "ativo" },
      { status: "DELETED", name: "apagado" },
      { status: "ARCHIVED", name: "arquivado" },
      { status: "ADSET_PAUSED", name: "pausado" },
    ];
    expect(filtrarOperacionais(rows).map((r) => r.name)).toEqual(["ativo", "pausado"]);
  });
});

describe("numeroConjuntoDeSinais — um numero so, ou nenhum", () => {
  // O numero daqui alimenta recusarConjuntoErrado. Se sinais divergentes
  // devolvessem um numero, a trava recusaria (ou liberaria) pelo motivo errado.
  it("sinais que concordam viram o numero", () => {
    expect(numeroConjuntoDeSinais("CONJ.1_LAF_8CRIATIVOS", "conjunto 1 do LAF")).toBe(1);
  });

  it("sinais divergentes (CONJ.1 e CONJ.4) nao adivinham", () => {
    expect(numeroConjuntoDeSinais("CONJ.1_LAF", "CONJ.4_LAF")).toBe(null);
  });

  it("sinal vazio ou nulo e ignorado, nao conta como divergencia", () => {
    expect(numeroConjuntoDeSinais(null, undefined, "   ", "CONJ.2_LAF")).toBe(2);
  });

  it("sem sinal nenhum, ou sinal sem numero, devolve null", () => {
    expect(numeroConjuntoDeSinais()).toBe(null);
    expect(numeroConjuntoDeSinais("peca sem numero de conjunto")).toBe(null);
  });
});

describe("recusarConjuntoErrado — quando NAO deve recusar", () => {
  it("pedido sem numero nao inventa recusa (sinal incompleto)", () => {
    const r = recusarConjuntoErrado({
      destNome: "CONJ.4_LAF_10CRIATIVOS_AGO26",
      pecaSinais: ["peca sem numero"],
    });
    expect(r).toEqual({ ok: true, pedido: null, dest: 4 });
  });

  it("pedido e destino no mesmo numero passam", () => {
    const r = recusarConjuntoErrado({ pedidoNumero: 2, destNome: "JURIDICO_CONJ.02 - MATURACAO" });
    expect(r).toEqual({ ok: true, pedido: 2, dest: 2 });
  });

  it("deriva o numero do pedido dos sinais da peca quando nao vem explicito", () => {
    const r = recusarConjuntoErrado({
      destNome: "CONJ.4_LAF_10CRIATIVOS_AGO26",
      pecaSinais: ["CONJ.1_LAF_8CRIATIVOS_JUNJUL26_AD01"],
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.pedido).toBe(1);
  });

  it("destino sem CONJ.N no nome e dito com esse nome na recusa", () => {
    // A mensagem tem de deixar claro que o destino nao tem numero, senao o
    // modelo tenta "corrigir" para um numero que nunca existiu no nome.
    const r = recusarConjuntoErrado({ pedidoNumero: 3, destNome: "" });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.dest).toBe(null);
      expect(r.detalhe).toMatch(/um conjunto sem CONJ\.N no nome/);
      expect(r.detalhe).toMatch(/\(sem nome\)/);
    }
  });
});

describe("trava de nome — caminhos que o incidente nao cobriu", () => {
  const contrato = [
    "JUR_CONV_CONJ03_AD01_Emprestimo_Pessoal_LEVA02",
    "JUR_CONV_CONJ03_AD02_Emprestimo_Conta_Corrente_LEVA02",
    "JUR_CONV_CONJ03_AD03_Cartao_Armadilha_LEVA02",
  ];

  it("nome livre pedido pelo gestor e honrado exatamente como veio", () => {
    const r = escolherNomeCriativoTravado({
      nomePedido: "JUR_CONV_CONJ03_AD02_Emprestimo_Conta_Corrente_LEVA02",
      nomesContrato: contrato,
      conjuntoNumero: 3,
    });
    expect(r).toEqual({
      ok: true,
      nome: "JUR_CONV_CONJ03_AD02_Emprestimo_Conta_Corrente_LEVA02",
      origem: "pedido",
    });
  });

  it("o _AD0N da peca escolhe o nome do MESMO anuncio", () => {
    // Sem isto a peca do AD02 poderia sair com o nome do AD01.
    const r = escolherNomeCriativoTravado({
      nomesContrato: contrato,
      pecaChave: "conjunto_3_video_AD02_conta_corrente",
      conjuntoNumero: 3,
    });
    expect(r).toEqual({
      ok: true,
      nome: "JUR_CONV_CONJ03_AD02_Emprestimo_Conta_Corrente_LEVA02",
      origem: "conversa",
    });
  });

  it("mais de um nome livre e ambiguidade declarada, nao escolha silenciosa", () => {
    const r = escolherNomeCriativoTravado({ nomesContrato: contrato, conjuntoNumero: 3 });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.erro).toBe("nome_do_contrato_ambiguo");
      expect(r.nomes_contrato).toEqual(contrato);
    }
  });

  it("sem contrato e sem pedido, exige o nome em vez de gerar um", () => {
    const r = escolherNomeCriativoTravado({ nomesContrato: [] });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.erro).toBe("nome_obrigatorio");
      expect(r.detalhe).toMatch(/PROIBIDO gerar/);
    }
  });

  it("sem contrato nenhum, o padrao estruturado pedido passa (nao ha memoria a perder)", () => {
    // A recusa por [MARCA][CANAL] existe para nao APAGAR nome ja combinado;
    // quando nao ha nome combinado, recusar seria travar sem motivo.
    const r = escolherNomeCriativoTravado({
      nomePedido: "[COHAPM][WA][LEADS][JURIDICO][NOVO][AGO26]",
      nomesContrato: [],
    });
    expect(r).toEqual({
      ok: true,
      nome: "[COHAPM][WA][LEADS][JURIDICO][NOVO][AGO26]",
      origem: "pedido",
    });
  });

  it("todos usados e um nome so no pool: reusa esse nome em vez de travar", () => {
    const um = [contrato[0]];
    const r = escolherNomeCriativoTravado({ nomesContrato: um, nomesJaUsados: um });
    expect(r).toEqual({ ok: true, nome: contrato[0], origem: "conversa" });
  });

  it("pecaChave que casa por texto puxa o nome do contrato", () => {
    const r = escolherNomeCriativoTravado({
      nomesContrato: contrato,
      pecaChave: "Cartao_Armadilha",
    });
    expect(r).toEqual({ ok: true, nome: contrato[2], origem: "conversa" });
  });

  it("o mesmo nome citado duas vezes na fala entra uma vez", () => {
    const fala = `1. ${contrato[0]}\nrepetindo: ${contrato[0]}`;
    expect(extrairNomesCriativoDaFala(fala)).toEqual([contrato[0]]);
  });

  it("numeroAnuncioDaChave le _AD0N e devolve null quando nao ha anuncio na chave", () => {
    expect(numeroAnuncioDaChave(contrato[0])).toBe(1);
    expect(numeroAnuncioDaChave("JUR_CONV_CONJ03_AD12_x")).toBe(12);
    expect(numeroAnuncioDaChave("conjunto_3_sem_marcador")).toBe(null);
    expect(numeroAnuncioDaChave(null as unknown as string)).toBe(null);
  });

  it("casa CONJ0N, CONJ_0N e CONJ.0N no nome do criativo", () => {
    expect(nomeCriativoDoConjunto("JUR_CONV_CONJ03_AD01_x", 3)).toBe(true);
    expect(nomeCriativoDoConjunto("JUR_CONJ_03_AD01", 3)).toBe(true);
    expect(nomeCriativoDoConjunto("JUR_CONJ.03_AD01", 3)).toBe(true);
    expect(nomeCriativoDoConjunto("JUR_CONV_CONJ04_AD01", 3)).toBe(false);
  });

  it("[LEADS] e [WPP] sozinhos tambem saem do escopo de trafego", () => {
    // O teste existente casa no primeiro token ([WA]) e nunca chega nos outros.
    expect(nomeCompostoForaDeEscopoTrafego("[COHAPM][LEADS][JURIDICO][AGO26]")).toBe(true);
    expect(nomeCompostoForaDeEscopoTrafego("[COHAPM][WPP][JURIDICO][AGO26]")).toBe(true);
    expect(nomeCompostoForaDeEscopoTrafego("[COHAPM][SITE][JURIDICO][AGO26]")).toBe(false);
  });

  it("nome vazio ou sentinela sem_molde conta como peca, nao como molde", () => {
    expect(pareceNomeDePecaNaoMolde("")).toBe(true);
    expect(pareceNomeDePecaNaoMolde(null as unknown as string)).toBe(true);
    expect(pareceNomeDePecaNaoMolde("sem_molde")).toBe(true);
  });
});

describe("legenda vs identidade da peca", () => {
  // A separacao decide se um texto vale como IDENTIDADE (nome/linha de produto)
  // ou como COPY. Errar aqui faz a legenda mudar a campanha escolhida.
  it("nome curto de peca nao e prosa", () => {
    expect(ehProsaDeLegenda("")).toBe(false);
    expect(ehProsaDeLegenda("CONJ.1_LAF_AD01_ChegandoEmCasa")).toBe(false);
  });

  it("texto longo e prosa", () => {
    expect(ehProsaDeLegenda("a".repeat(80))).toBe(true);
  });

  it("frase com 12+ palavras e pontuacao e prosa, mesmo curta", () => {
    expect(
      ehProsaDeLegenda("voce tem sentido a vista cansada no fim do dia de trabalho hoje?"),
    ).toBe(true);
  });

  it("chamada de CTA conhecida e prosa mesmo em poucas palavras", () => {
    expect(ehProsaDeLegenda("fale com nossa equipe")).toBe(true);
  });
});

describe("cruzamento linha produto — quando NAO ha erro", () => {
  it("destino e peca na mesma linha passam, com a legenda na voz certa", () => {
    const r = recusarCruzamentoLinhaProduto({
      estruturaNomes: ["COHAPM_LAFELICITA_CONV_AGO26", "LAFELICITA_CONJ.01 - DESCOBERTA"],
      pecaSinais: [
        "CONJ.1_LAF_8CRIATIVOS_JUNJUL26_AD01_ChegandoEmCasa_V3",
        "Venha conhecer o La Felicita e fale com nossa equipe para agendar a visita.",
      ],
    });
    expect(r).toEqual({ ok: true, dest: "la_felicita", peca: "la_felicita" });
  });

  it("sem sinal nenhum nao acusa cruzamento", () => {
    const r = recusarCruzamentoLinhaProduto({ estruturaNomes: [], pecaSinais: [] });
    expect(r).toEqual({ ok: true, dest: null, peca: null });
  });

  it("sinal nulo no meio da lista e ignorado", () => {
    const r = recusarCruzamentoLinhaProduto({
      estruturaNomes: ["COHAPM_JURIDICO_CONV_LEVA01"],
      pecaSinais: [null, "   ", "JUR_CONV_CONJ03_AD01_Emprestimo_Pessoal_LEVA02"],
    });
    expect(r).toEqual({ ok: true, dest: "juridico", peca: "juridico" });
  });

  it("peca sem linha identificavel nao recorta os conjuntos candidatos", () => {
    // Filtrar por uma linha que nao foi identificada esvaziaria a lista e o
    // auto-pick cairia no "nenhum candidato" por engano.
    const hits = [{ name: "CONJ.1_ALGO" }, { name: "CONJ.2_OUTRO" }];
    expect(escolherConjuntosDaMesmaLinha(hits, ["peca neutra"], () => null)).toEqual(hits);
  });
});
