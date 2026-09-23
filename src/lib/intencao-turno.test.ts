import { describe, it, expect } from "vitest";
import {
  deveForcarEmissao,
  ehPedidoDeAto,
  ehPedidoEmitirConjunto,
  ehPedidoLeituraCruzada,
  ehPerguntaDeLeitura,
  ehLeituraDeDesempenho,
  ehPedidoRelacaoNumerica,
  ehPedidoRelacaoGeoPublico,
  recusaFalsaMoldeTrafego,
  recusaFalsaClassificacaoSemMetrica,
  replyOmitiuValoresDosConjuntos,
  pedidoAtoPrecisaMetrica,
  ehPedidoUploadLote,
  ehUploadLoteCurto,
  ehPedidoDetalhamentoCampanha,
  ehPedidoOrigemDriveDosAnuncios,
  pedidoPedeVariosCards,
  pedidoSoLegendasSemEmissao,
  pedidoComentarioDoPostSemEmissao,
  replyLeituraIncompleta,
  objetivoDoFio,
} from "./intencao-turno";

describe("pedidoSoLegendasSemEmissao", () => {
  const pedidoJuridico =
    "pronto, agora quero que você selecione 6 vídeos diferentes de dentro do drive do jurídico (qualquer pasta) e crie legendas para cada um deles.";

  it("nao trata pedido de legendas como emissao de card", () => {
    expect(ehPedidoDeAto(pedidoJuridico)).toBe(true);
    expect(pedidoSoLegendasSemEmissao(pedidoJuridico)).toBe(true);
  });

  it("mantem emissao quando o gestor pede card, aprovacao ou anuncio", () => {
    expect(
      pedidoSoLegendasSemEmissao(
        "selecione 6 videos, crie legendas e emita os primeiros cards para aprovacao",
      ),
    ).toBe(false);
    expect(pedidoSoLegendasSemEmissao("crie legendas e monte os anuncios")).toBe(false);
    expect(pedidoSoLegendasSemEmissao("emita os 3 cards do conjunto 2")).toBe(false);
  });
});

describe("ehPerguntaDeLeitura", () => {
  it("reconhece pergunta sobre link do anuncio vs conjunto", () => {
    expect(
      ehPerguntaDeLeitura(
        "antes da aprovação, o anúncio está com o mesmo link de destino do conjunto?",
      ),
    ).toBe(true);
    expect(
      ehPedidoDeAto("antes da aprovação, o anúncio está com o mesmo link de destino do conjunto?"),
    ).toBe(false);
  });

  it("nao classifica pedido de emitir card como pergunta", () => {
    expect(ehPerguntaDeLeitura("emita os 3 cards do conjunto 2")).toBe(false);
    expect(ehPedidoDeAto("emita os 3 cards do conjunto 2")).toBe(true);
    expect(
      ehPedidoDeAto(
        "agora faça o mesmo para o conjunto 4, seguindo o mesmo processo de seleção e legendas, mas dessa vez serão 7 criativos, todos diferentes dos criativos que estão nos outros conjuntos. realize esse processo e emita os primeiros cards para aprovação",
      ),
    ).toBe(true);
  });

  it("reconhece consulta de status sem verbo de ato", () => {
    expect(ehPerguntaDeLeitura("consulte novamente o resultado dos 3 vídeos")).toBe(true);
  });

  it("reconhece checagem de link sem interrogacao", () => {
    expect(ehPerguntaDeLeitura("o anúncio está com o mesmo link de destino do conjunto")).toBe(
      true,
    );
  });

  it("ranking de gasto dos conjuntos e leitura, nao emissao de card", () => {
    const ocular =
      "preciso que você realize uma verificação nos conjuntos da campanha do sistema ocular e identifique quais deles estão gastando mais e monte um ranking disso completo e me retorne aqui por favor";
    expect(ehLeituraDeDesempenho(ocular)).toBe(true);
    expect(ehPedidoDeAto(ocular)).toBe(false);
    expect(ehPerguntaDeLeitura(ocular)).toBe(true);
    expect(ehPedidoEmitirConjunto(ocular)).toBe(false);
    expect(ehPedidoDetalhamentoCampanha(ocular)).toBe(true);
    expect(deveForcarEmissao({ pedido: ocular, chamouPropose: false, cardsEmitidos: 0 })).toBe(
      false,
    );
    expect(ehPedidoDeAto("monte um ranking dos conjuntos por gasto")).toBe(false);
    expect(ehPedidoDeAto("monte os conjuntos da campanha nova")).toBe(true);
    expect(ehPedidoDeAto("altere o orçamento do conjunto que mais gasta")).toBe(true);
  });

  it("relacao numerica de conjuntos e criativos e leitura, nao emissao", () => {
    const pedido =
      "preciso que você verifique a campanha do jurídico e, apenas dos conjuntos e criativos ativos hoje, você gera pra mim uma relação mostrando os gastos, conversas geradas, impressões, preços por conversa gerada e orçamento por conjuntos e por criativos.";
    expect(ehPedidoRelacaoNumerica(pedido)).toBe(true);
    expect(ehLeituraDeDesempenho(pedido)).toBe(true);
    expect(ehPedidoDetalhamentoCampanha(pedido)).toBe(true);
    expect(ehPedidoDeAto(pedido)).toBe(false);
    expect(ehPerguntaDeLeitura(pedido)).toBe(true);
  });

  it("relacao geografica e publico-alvo nao e tabela de gasto", () => {
    const pedido =
      "preciso que você traga pra mim uma relação geográfica de cada um dos conjuntos referentes a campanha ativa do lafelicità.\ntraga de cada um dos conjuntos especificando como foi definido o público-alvo em que essa campanha abrange";
    expect(ehPedidoRelacaoGeoPublico(pedido)).toBe(true);
    expect(ehPedidoRelacaoNumerica(pedido)).toBe(false);
    expect(ehPedidoDetalhamentoCampanha(pedido)).toBe(false);
    expect(ehPedidoDeAto(pedido)).toBe(false);
    expect(ehPerguntaDeLeitura(pedido)).toBe(true);
  });

  it("traga as mesmas informacoes / valores dos conjuntos e leitura, nao ato", () => {
    const ocular =
      "agora traga as mesmas informações referentes a campanha ativa hoje do ocular com todos os valores dos conjuntos ativos";
    expect(ehPedidoRelacaoNumerica(ocular)).toBe(true);
    expect(ehLeituraDeDesempenho(ocular)).toBe(true);
    expect(ehPedidoDeAto(ocular)).toBe(false);
    expect(ehPerguntaDeLeitura(ocular)).toBe(true);
    expect(ehPedidoDetalhamentoCampanha(ocular)).toBe(true);
    expect(
      deveForcarEmissao({ pedido: ocular, chamouPropose: false, cardsEmitidos: 0 }),
    ).toBe(false);
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
    expect(
      ehPedidoUploadLote(
        "termine de subir os vídeos e me informe quais dos 34 já estão na meta e quais ficaram de fora",
      ),
    ).toBe(true);
    expect(ehPedidoUploadLote("qual o gasto de ontem?")).toBe(false);
  });

  it("reconhece recorte curto (2 pendentes) sem teatro de 8 blocos", () => {
    expect(ehUploadLoteCurto("suba os 2 últimos vídeos que ficaram pendentes")).toBe(true);
    expect(ehUploadLoteCurto("suba os restantes", 2)).toBe(true);
    expect(ehUploadLoteCurto("suba os restantes", 20)).toBe(false);
  });
});

describe("ehPedidoDetalhamentoCampanha", () => {
  it("reconhece detalhamento de duas campanhas com janela e anuncio", () => {
    expect(
      ehPedidoDetalhamentoCampanha(
        "detalhamento das campanhas 120236111 e 120236222, janela 21/08 a 27/08, por anúncio",
      ),
    ).toBe(true);
  });

  it("reconhece ranking de gasto dos conjuntos como detalhamento", () => {
    expect(
      ehPedidoDetalhamentoCampanha(
        "monte um ranking dos conjuntos da campanha do sistema ocular por gasto",
      ),
    ).toBe(true);
  });

  it("nao classifica status pontual", () => {
    expect(ehPedidoDetalhamentoCampanha("qual o status da conta?")).toBe(false);
  });

  it("reconhece analise de campanhas com ID Meta e janela", () => {
    expect(
      ehPedidoDetalhamentoCampanha(
        "analise as campanhas 120236111111111111 e 120236222222222222, janela 21/08 a 27/08",
      ),
    ).toBe(true);
  });
});

describe("replyLeituraIncompleta", () => {
  it("detecta lacuna nesta rodada e pedido de nova pergunta", () => {
    expect(
      replyLeituraIncompleta(
        "O detalhamento dos anúncios não foi lido nesta rodada. Envie novamente uma nova pergunta.",
      ),
    ).toBe(true);
  });

  it("nao dispara em relatorio com numeros", () => {
    expect(
      replyLeituraIncompleta(
        "As duas campanhas estão ativas. Gasto da janela: R$ 420,00. Ranking por anúncio abaixo.",
      ),
    ).toBe(false);
  });

  it("pega a prosa longa de lacuna com lista entre detalhamento e nao foi lido", () => {
    expect(
      replyLeituraIncompleta(
        "O detalhamento dos anúncios de ambos os conjuntos — nome, status, gasto, impressões, alcance, cliques, CTR, engajamentos, formulários, custo e destino — não foi lido nesta rodada. Também não foi possível confirmar nesta resposta.",
      ),
    ).toBe(true);
  });

  it("pega prosa de origem Drive sem vinculo", () => {
    expect(
      replyLeituraIncompleta(
        "A pasta existe e contém 1.mp4 a 6.mp4, mas não há evidência suficiente para afirmar que os anúncios 2 a 6 correspondem. Sem vínculo registrado. drive_file_id necessário.",
      ),
    ).toBe(true);
  });
});

describe("ehPedidoOrigemDriveDosAnuncios", () => {
  const pedidoRef =
    "foque exclusivamente no conjunto 1 e me traga essa informação:\n" +
    "dos anúncios que estão registrados dentro desse conjunto, eles pertencem a qual pasta do drive?";

  it("reconhece pasta do Drive dos anuncios do conjunto", () => {
    expect(ehPedidoOrigemDriveDosAnuncios(pedidoRef)).toBe(true);
  });

  it("nao classifica selecao de peca nova", () => {
    expect(
      ehPedidoOrigemDriveDosAnuncios(
        "verifique na pasta Apenas oculos do drive e selecione um video que ainda nao esta no conj 1",
      ),
    ).toBe(false);
  });
});

describe("pedidoPedeVariosCards", () => {
  it("lote no plural e peca unica no singular", () => {
    expect(pedidoPedeVariosCards("emita os próximos cards")).toBe(true);
    expect(pedidoPedeVariosCards("emita o card do Rayban 2")).toBe(false);
    expect(pedidoPedeVariosCards("somente um card do conjunto 1")).toBe(false);
  });
});

describe("objetivoDoFio", () => {
  const criar =
    "preciso criar uma nova campanha dentro da meta focada no sistema ocular, quero seguir o padrão das duas campanhas WA que estão ativas";
  const quatroConjuntos =
    "serão 4 conjuntos abrangendo 4 números respectivamente onde seria:\nconjunto1 - 7199189-4229\nconjunto2 - 7199185-8107";

  it("junta follow-up de conjuntos/numeros ao criar campanha do turno anterior", () => {
    const composto = objetivoDoFio(quatroConjuntos, [criar]);
    expect(composto).toContain("criar uma nova campanha");
    expect(composto).toContain("4 conjuntos");
    expect(ehPedidoDeAto(composto)).toBe(true);
    expect(ehPedidoEmitirConjunto(composto)).toBe(true);
  });

  it("nao junta ranking de gasto ao criar campanha do turno anterior", () => {
    expect(
      objetivoDoFio(
        "monte um ranking dos conjuntos da campanha do sistema ocular por gasto",
        [criar],
      ),
    ).toBe("monte um ranking dos conjuntos da campanha do sistema ocular por gasto");
  });

  it("nao junta ok vazio de assunto", () => {
    expect(objetivoDoFio("ok, pode seguir", [criar])).toBe("ok, pode seguir");
  });

  it("nao herda emita cards quando a fala pede so legendas", () => {
    const fala =
      "agora preciso que voce realize a analise dos criativos na pasta de setembro dentro do drive e os separe 4 para cada um dos conjuntos, que totalizam 16 criativos. gere legendas para cada um deles e as traga para que eu as avalie uma por uma.";
    const prev = "emita os cards de criacao dos 4 conjuntos na campanha SETEMBRO";
    const out = objetivoDoFio(fala, [prev]);
    expect(out).toBe(fala);
    expect(pedidoSoLegendasSemEmissao(out)).toBe(true);
    expect(ehPedidoDeAto(out)).toBe(false);
  });

  it("pedido com verbo de ato fica como esta", () => {
    expect(objetivoDoFio("emita os 3 cards do conjunto 2", [criar])).toBe(
      "emita os 3 cards do conjunto 2",
    );
  });

  it("fala vazia volta vazia, e sem historico nao ha o que compor", () => {
    expect(objetivoDoFio("", [criar])).toBe("");
    expect(objetivoDoFio("serao 4 conjuntos", [])).toBe("serao 4 conjuntos");
  });

  it("follow-up sem assunto de ato no historico nao e composto", () => {
    expect(objetivoDoFio("os numeros sao esses", ["qual o gasto de ontem?"])).toBe(
      "os numeros sao esses",
    );
  });

  it("nao junta leitura de valores do ocular ao alterar do juridico", () => {
    const alterar =
      "altere os valores dos conjuntos em status vermelho e amarelo para 40,00 e mantenha os de status verde com o mesmo valor";
    const ocular =
      "agora traga as mesmas informações referentes a campanha ativa hoje do ocular com todos os valores dos conjuntos ativos";
    expect(objetivoDoFio(ocular, [alterar])).toBe(ocular);
    expect(ehPedidoDeAto(objetivoDoFio(ocular, [alterar]))).toBe(false);
  });
});

describe("deveForcarEmissao", () => {
  // A trava do incidente de 01/09: o modelo narrou "6 Cards de Pausa Emitidos"
  // sem UMA chamada de propose_action, e nenhum card existia. Nunca teve teste —
  // se ela inverter, volta-se a aceitar o turno que so fala que emitiu.
  const base = { pedido: "emita os cards do conjunto 2", chamouPropose: false, cardsEmitidos: 0 };

  it("pedido de ato que terminou sem propose_action devolve o turno ao modelo", () => {
    expect(deveForcarEmissao(base)).toBe(true);
  });

  it("propose_action chamada NAO insiste, mesmo que ela tenha recusado", () => {
    // Recusa e informacao honesta com motivo; insistir repetiria o mesmo erro.
    expect(deveForcarEmissao({ ...base, chamouPropose: true })).toBe(false);
  });

  it("card ja emitido nao insiste", () => {
    expect(deveForcarEmissao({ ...base, cardsEmitidos: 1 })).toBe(false);
  });

  it("nao insiste duas vezes no mesmo turno nem sem tempo de janela", () => {
    // Insistir sem fim gastaria a janela inteira sem entregar nada.
    expect(deveForcarEmissao({ ...base, jaInsistiu: true })).toBe(false);
    expect(deveForcarEmissao({ ...base, semTempo: true })).toBe(false);
  });

  it("pedido de legenda tem verbo de ato mas nao e emissao de card", () => {
    expect(deveForcarEmissao({ ...base, pedido: "crie as legendas para cada video" })).toBe(false);
  });

  it("desativar comentario do post nao forca propose_action", () => {
    const pedido = "desative os comentarios de todos esses posts que estão sendo turbinados";
    expect(pedidoComentarioDoPostSemEmissao(pedido)).toBe(true);
    expect(deveForcarEmissao({ ...base, pedido })).toBe(false);
    expect(
      deveForcarEmissao({
        ...base,
        pedido: "altere os comentarios dos posts impulsionados",
      }),
    ).toBe(false);
  });

  it("comentario + pause continua sendo emissao", () => {
    expect(
      pedidoComentarioDoPostSemEmissao("desative os comentarios e pause as 14 turbinagens"),
    ).toBe(false);
    expect(
      deveForcarEmissao({
        ...base,
        pedido: "desative os comentarios e pause as 14 turbinagens",
      }),
    ).toBe(true);
  });

  it("pergunta de leitura nunca forca emissao", () => {
    expect(deveForcarEmissao({ ...base, pedido: "o anuncio esta com o mesmo link?" })).toBe(false);
  });

  it("ranking de conjuntos por gasto nunca forca emissao", () => {
    expect(
      deveForcarEmissao({
        ...base,
        pedido:
          "realize uma verificação nos conjuntos da campanha do sistema ocular e monte um ranking de gasto",
      }),
    ).toBe(false);
  });
});

describe("ehPedidoLeituraCruzada", () => {
  it("pergunta de origem no Drive e leitura cruzada", () => {
    expect(ehPedidoLeituraCruzada("de qual pasta do drive sao os anuncios do conj 1?")).toBe(true);
  });

  it("cruzar anuncio no ar com peca do Drive e leitura cruzada", () => {
    expect(ehPedidoLeituraCruzada("preciso cruzar os anuncios com as pecas do drive")).toBe(true);
  });

  it("pergunta de desempenho solta nao e leitura cruzada", () => {
    expect(ehPedidoLeituraCruzada("qual o gasto de ontem?")).toBe(false);
  });
});

describe("incidente ocular 22/09 — classificacao e recusa falsa", () => {
  const confirmar =
    "isso, vermelho e amarelo altere para 40,00 e verde mantenha";
  const prosaLeitura =
    "O último pedido foi só a leitura da campanha ativa do Sistema Ocular. Não houve verbo de alterar, pausar ou criar, então nenhum card foi emitido e nenhum será inventado agora.\n\nOs quatro conjuntos ativos continuam em R$ 60,00. Se a ordem for a mesma do Jurídico — vermelho e amarelo para R$ 40,00 e verde mantido —, diga isso e os pedidos saem na hora.";
  const prosaRecusa =
    "Nenhum card foi emitido. A leitura da campanha ativa do Ocular não trouxe o custo por conversa de cada conjunto, então não há como separar vermelho e amarelo de verde sem risco de alterar o conjunto errado.";

  it("confirmacao de cor e ato que precisa de metrica", () => {
    expect(ehPedidoDeAto(confirmar)).toBe(true);
    expect(pedidoAtoPrecisaMetrica(confirmar)).toBe(true);
    expect(
      deveForcarEmissao({ pedido: confirmar, chamouPropose: false, cardsEmitidos: 0 }),
    ).toBe(true);
  });

  it("prosa de nenhum card no pedido de valores e leitura omitida", () => {
    const pedido =
      "agora traga as mesmas informações referentes a campanha ativa hoje do ocular com todos os valores dos conjuntos ativos";
    expect(replyOmitiuValoresDosConjuntos(prosaLeitura, pedido)).toBe(true);
    expect(
      replyOmitiuValoresDosConjuntos(
        "Hoje é 22/09.\n\n| Conjunto | Gasto | Conversas |\n|---|---|---|\n| CONJ.1 | R$ 10 | 2 |",
        pedido,
      ),
    ).toBe(false);
  });

  it("recusa por falta de custo por conversa e falsa quando a tool ja leu", () => {
    expect(recusaFalsaClassificacaoSemMetrica(prosaRecusa)).toBe(true);
    expect(recusaFalsaClassificacaoSemMetrica("Os três pedidos estão pendentes de aprovação.")).toBe(
      false,
    );
  });
});
