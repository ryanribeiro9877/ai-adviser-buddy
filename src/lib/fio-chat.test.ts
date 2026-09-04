import { describe, it, expect } from "vitest";
import {
  MAX_CONTINUATIONS,
  MAX_CONTINUATIONS_UPLOAD,
  actionCardIds,
  capContinuacoes,
  countSubstantiveAssistantsSinceLastUser,
  devePararContinuacao,
  hasSubstantiveReplyAfterLastUser,
  isJobFailureStub,
  isProgressOnlyReply,
  isTruncated,
  lastUserContent,
  liveOverlayText,
  looksLikeCompleteTurn,
  mergeAssistantContent,
  mergeLivePiece,
  mesmaProsa,
  needsAutoContinue,
  storedAttachments,
  toolNames,
  type Message,
} from "./fio-chat";

// Esta e a semantica que decide se o gestor FOI RESPONDIDO. Ela governa tres
// coisas visiveis: se o cartao "A resposta nao chegou" fica ou sai, se o front
// continua costurando o turno, e que texto aparece na bolha em construcao.
//
// O projeto acumulou cinco fail-opens onde ausencia de sinal virava aprovacao, e
// um episodio em que o sistema afirmou ter feito o que nao fez. A familia de
// defeito aqui e a mesma: um retorno VAZIO sendo lido como sucesso. Por isso a
// maioria dos casos abaixo prova o lado negativo — que vazio, stub de progresso
// e stub de falha do job NAO contam como resposta.

let seq = 0;
function msg(role: string, content: string | null, over: Partial<Message> = {}): Message {
  seq += 1;
  return {
    id: `m${seq}`,
    role,
    content,
    tool_calls: null,
    attachments: null,
    model: null,
    created_at: "2026-09-04T12:00:00Z",
    ...over,
  };
}

const RESPOSTA_REAL = "O gasto de ontem foi R$ 412,80 e o custo por lead ficou em R$ 18,30.";
const STUB_PROGRESSO = "Continuando automaticamente para emitir os cards restantes.";
const STUB_FALHA_JOB =
  "O processamento em segundo plano falhou. Reenvie a pergunta para tentar de novo.";

describe("isProgressOnlyReply — vazio nao e resposta", () => {
  // Se isto virasse `false`, uma reply vazia passaria a contar como resposta
  // real: o cartao de falha sairia da tela e o gestor ficaria olhando um turno
  // sem nada, achando que foi atendido.
  it("trata string vazia como nao-resposta", () => {
    expect(isProgressOnlyReply("")).toBe(true);
  });

  it("trata so-espacos como nao-resposta", () => {
    expect(isProgressOnlyReply("   \n\t  ")).toBe(true);
  });

  it("reconhece o stub de checkpoint como progresso", () => {
    expect(isProgressOnlyReply(STUB_PROGRESSO)).toBe(true);
    expect(isProgressOnlyReply("Montando os pedidos de aprovação agora.")).toBe(true);
    expect(isProgressOnlyReply("[continuação automática do sistema] segmento 2")).toBe(true);
  });

  it("aceita curto com 'continuando' apenas abaixo de 80 caracteres", () => {
    expect(isProgressOnlyReply("continuando")).toBe(true);
    // Passou de 80: prosa longa que menciona "continuando" e resposta de verdade,
    // nao stub — o corte por tamanho existe para nao engolir conteudo.
    const longa = `Sobre o conjunto 2, seguimos continuando o teste porque o custo por lead ainda esta dentro da meta combinada com o gestor.`;
    expect(longa.length).toBeGreaterThan(80);
    expect(isProgressOnlyReply(longa)).toBe(false);
  });

  it("status do upload NUNCA e progresso, mesmo curto", () => {
    // Excecao deliberada: esse bloco e o inventario que o gestor le para saber o
    // que subiu e o que ficou de fora. Classificar como progresso o esconderia.
    expect(isProgressOnlyReply("## Status do upload")).toBe(false);
  });

  it("prosa comum e resposta", () => {
    expect(isProgressOnlyReply(RESPOSTA_REAL)).toBe(false);
  });
});

describe("isJobFailureStub — stub de falha nao encerra o turno", () => {
  it("reconhece as duas frases que o job grava no catch", () => {
    expect(isJobFailureStub(STUB_FALHA_JOB)).toBe(true);
    expect(isJobFailureStub("O modelo ficou sobrecarregado nesta rodada.")).toBe(true);
  });

  it("ignora caixa", () => {
    expect(isJobFailureStub("PROCESSAMENTO EM SEGUNDO PLANO FALHOU")).toBe(true);
  });

  it("resposta real nao e stub", () => {
    expect(isJobFailureStub(RESPOSTA_REAL)).toBe(false);
  });

  it("vazio nao e stub de falha (quem cuida do vazio e isProgressOnlyReply)", () => {
    expect(isJobFailureStub("")).toBe(false);
  });
});

describe("hasSubstantiveReplyAfterLastUser — o cartao de falha depende disto", () => {
  // Esta e a guarda mais cara do arquivo. `true` de mais some com o cartao de
  // falha enquanto o turno segue sem resposta; `false` de mais deixa o cartao
  // para sempre depois de uma resposta que chegou.
  it("pergunta sem nada depois: nao foi respondida", () => {
    expect(hasSubstantiveReplyAfterLastUser([msg("user", "quanto gastei ontem?")])).toBe(false);
  });

  it("assistant VAZIO depois da pergunta nao conta como resposta", () => {
    expect(
      hasSubstantiveReplyAfterLastUser([msg("user", "quanto gastei?"), msg("assistant", "")]),
    ).toBe(false);
  });

  it("assistant nulo depois da pergunta nao conta como resposta", () => {
    expect(
      hasSubstantiveReplyAfterLastUser([msg("user", "quanto gastei?"), msg("assistant", null)]),
    ).toBe(false);
  });

  it("so stub de progresso nao conta como resposta", () => {
    expect(
      hasSubstantiveReplyAfterLastUser([
        msg("user", "quanto gastei?"),
        msg("assistant", STUB_PROGRESSO),
      ]),
    ).toBe(false);
  });

  it("so stub de falha do job nao conta como resposta", () => {
    expect(
      hasSubstantiveReplyAfterLastUser([
        msg("user", "quanto gastei?"),
        msg("assistant", STUB_FALHA_JOB),
      ]),
    ).toBe(false);
  });

  it("resposta real conta", () => {
    expect(
      hasSubstantiveReplyAfterLastUser([
        msg("user", "quanto gastei?"),
        msg("assistant", RESPOSTA_REAL),
      ]),
    ).toBe(true);
  });

  it("resposta real seguida de stub de progresso continua contando", () => {
    // O stub chega DEPOIS da resposta boa; nao pode apagar o fato de ter havido
    // resposta, senao o cartao de falha reaparece sobre um turno concluido.
    expect(
      hasSubstantiveReplyAfterLastUser([
        msg("user", "quanto gastei?"),
        msg("assistant", RESPOSTA_REAL),
        msg("assistant", STUB_PROGRESSO),
      ]),
    ).toBe(true);
  });

  it("nova pergunta depois de uma resposta antiga: turno atual esta sem resposta", () => {
    expect(
      hasSubstantiveReplyAfterLastUser([
        msg("user", "quanto gastei?"),
        msg("assistant", RESPOSTA_REAL),
        msg("user", "e o CPL da campanha 3?"),
      ]),
    ).toBe(false);
  });

  it("fio vazio nao inventa resposta", () => {
    expect(hasSubstantiveReplyAfterLastUser([])).toBe(false);
  });
});

describe("mergeAssistantContent — nunca perder texto que chegou", () => {
  it("emenda dois trechos reais", () => {
    expect(mergeAssistantContent("parte A", "parte B")).toBe("parte A\nparte B");
  });

  it("segmento vazio nao apaga a resposta que ja estava na bolha", () => {
    // Regressao caríssima: um segundo segmento vazio zerando a bolha deixaria a
    // tela em branco depois de o texto ter chegado.
    expect(mergeAssistantContent(RESPOSTA_REAL, "")).toBe(RESPOSTA_REAL);
    expect(mergeAssistantContent(RESPOSTA_REAL, "   ")).toBe(RESPOSTA_REAL);
  });

  it("bolha vazia recebe o primeiro texto", () => {
    expect(mergeAssistantContent("", RESPOSTA_REAL)).toBe(RESPOSTA_REAL);
  });

  it("nao duplica a mesma prosa (mesmo com acento e caixa diferentes)", () => {
    expect(mergeAssistantContent("Orçamento diário", "orcamento diario")).toBe("Orçamento diário");
  });

  it("stub de progresso nao sobrescreve resposta real", () => {
    expect(mergeAssistantContent(RESPOSTA_REAL, STUB_PROGRESSO)).toBe(RESPOSTA_REAL);
  });

  it("resposta real substitui o stub de progresso", () => {
    expect(mergeAssistantContent(STUB_PROGRESSO, RESPOSTA_REAL)).toBe(RESPOSTA_REAL);
  });

  it("dois stubs de progresso nao empilham", () => {
    expect(mergeAssistantContent(STUB_PROGRESSO, "continuando")).toBe(STUB_PROGRESSO);
  });
});

describe("mergeLivePiece — a bolha ao vivo", () => {
  it("pedaco vazio nao mexe no acumulado", () => {
    expect(mergeLivePiece(RESPOSTA_REAL, "")).toBe(RESPOSTA_REAL);
  });

  it("primeiro pedaco real entra inteiro", () => {
    expect(mergeLivePiece("", RESPOSTA_REAL)).toBe(RESPOSTA_REAL);
  });

  it("dois pedacos reais ficam separados por linha em branco", () => {
    expect(mergeLivePiece("parte A", "parte B")).toBe("parte A\n\nparte B");
  });

  it("stub de progresso nao substitui texto real ja acumulado", () => {
    expect(mergeLivePiece(RESPOSTA_REAL, STUB_PROGRESSO)).toBe(RESPOSTA_REAL);
  });

  it("stub sobre stub nao cresce", () => {
    expect(mergeLivePiece(STUB_PROGRESSO, "continuando")).toBe(STUB_PROGRESSO);
  });

  it("stub de progresso sobre acumulado vazio zera (nao vira conteudo)", () => {
    expect(mergeLivePiece("", STUB_PROGRESSO)).toBe("");
  });

  it("status do upload assume a bolha inteira", () => {
    // Deliberado: o inventario mais recente e o que vale, nao a soma dos antigos.
    expect(mergeLivePiece("parte antiga", "## Status do upload\n- 3 de 5")).toBe(
      "## Status do upload\n- 3 de 5",
    );
  });

  it("repeticao da mesma prosa nao duplica", () => {
    expect(mergeLivePiece(RESPOSTA_REAL, RESPOSTA_REAL)).toBe(RESPOSTA_REAL);
  });
});

describe("liveOverlayText — tela nunca fica muda", () => {
  it("acumulado vazio vira aviso de continuacao", () => {
    expect(liveOverlayText("")).toBe("continuando a resposta…");
  });

  it("acumulado so com stub vira aviso de continuacao", () => {
    expect(liveOverlayText(STUB_PROGRESSO)).toBe("continuando a resposta…");
  });

  it("acumulado real aparece como esta", () => {
    expect(liveOverlayText(RESPOSTA_REAL)).toBe(RESPOSTA_REAL);
  });
});

describe("needsAutoContinue — as duas condicoes sao obrigatorias", () => {
  // Continuar sem checkpoint gasta um turno inteiro para receber
  // `aviso: sem_checkpoint`; nao continuar quando havia checkpoint deixa a
  // resposta pela metade no banco e a tela sem o resto.
  it("resposta ausente nao pede continuacao", () => {
    expect(needsAutoContinue(undefined)).toBe(false);
    expect(needsAutoContinue(null)).toBe(false);
  });

  it("continuar=true com finish_reason de checkpoint pede continuacao", () => {
    expect(
      needsAutoContinue({
        ok: true,
        conversation_id: "c1",
        reply: "parcial",
        continuar: true,
        finish_reason: "continuar_turno",
      }),
    ).toBe(true);
  });

  it("continuar=true sem finish_reason nao basta", () => {
    expect(
      needsAutoContinue({ ok: true, conversation_id: "c1", reply: "x", continuar: true }),
    ).toBe(false);
  });

  it("finish_reason de checkpoint sem continuar=true nao basta", () => {
    expect(
      needsAutoContinue({
        ok: true,
        conversation_id: "c1",
        reply: "x",
        finish_reason: "continuar_turno",
      }),
    ).toBe(false);
  });

  it("turno encerrado com stop nao pede continuacao", () => {
    expect(
      needsAutoContinue({
        ok: true,
        conversation_id: "c1",
        reply: "x",
        continuar: true,
        finish_reason: "stop",
      }),
    ).toBe(false);
  });
});

describe("isTruncated — costura por tamanho", () => {
  it("reconhece os finish_reason de corte", () => {
    expect(isTruncated("length")).toBe(true);
    expect(isTruncated("length_limit")).toBe(true);
  });

  it("stop e ausencia nao sao corte", () => {
    expect(isTruncated("stop")).toBe(false);
    expect(isTruncated(undefined)).toBe(false);
    expect(isTruncated("")).toBe(false);
  });
});

describe("looksLikeCompleteTurn — quando parar de continuar sozinho", () => {
  it("texto curto nunca fecha o turno", () => {
    expect(looksLikeCompleteTurn("ok")).toBe(false);
  });

  it("pergunta de clarificacao fecha o turno", () => {
    const t =
      "Antes de emitir os cards, qual objetivo você quer priorizar nesta rodada: reduzir o custo por lead ou aumentar o volume?";
    expect(t.length).toBeGreaterThan(100);
    expect(looksLikeCompleteTurn(t)).toBe(true);
  });

  it("pedido de decisao sem interrogacao tambem fecha o turno", () => {
    const t =
      "Preciso da sua confirmação antes de seguir com este ajuste, porque o impacto no orçamento diário é relevante.";
    expect(t.length).toBeGreaterThan(100);
    expect(looksLikeCompleteTurn(t)).toBe(true);
  });

  it("lote de criativos incompleto NAO fecha o turno", () => {
    // Se fechasse, o front pararia de continuar e o lote ficaria pela metade —
    // e o gestor veria menos pecas do que pediu, sem nada acusando.
    const t = `Subi as duas primeiras peças do conjunto 1, mas as legendas pendentes ainda não foram escritas nesta rodada.`;
    expect(t.length).toBeGreaterThan(100);
    expect(looksLikeCompleteTurn(t)).toBe(false);
  });

  it("leitura incompleta NAO fecha o turno", () => {
    const t = `Consolidei o gasto por campanha, porém o levantamento veio incompleto e falta o detalhamento por anúncio.`;
    expect(t.length).toBeGreaterThan(100);
    expect(looksLikeCompleteTurn(t)).toBe(false);
  });

  it("status de upload fora da meta NAO fecha o turno", () => {
    const t = `## Status do upload\nSubi 3 de 5 vídeos até agora; os outros dois estão ainda fora da meta e seguem na fila.`;
    expect(t.length).toBeGreaterThan(100);
    expect(looksLikeCompleteTurn(t)).toBe(false);
  });

  it("prosa longa sem pergunta nem pedido de decisao nao fecha o turno", () => {
    const t = `O gasto da semana somou R$ 2.840,00 distribuídos entre as três campanhas ativas, com o melhor custo por lead no conjunto 2.`;
    expect(t.length).toBeGreaterThan(100);
    expect(looksLikeCompleteTurn(t)).toBe(false);
  });

  it("stub de progresso longo nao fecha o turno", () => {
    expect(looksLikeCompleteTurn(`[continuação automática do sistema] ${"x".repeat(120)}`)).toBe(
      false,
    );
  });
});

describe("devePararContinuacao — a trava das bolhas repetidas", () => {
  // Esta e a trava do episodio em que o modelo anunciou cards que nao existiam:
  // depois de duas respostas substantivas no mesmo turno, o front para de pedir
  // mais segmentos. As excecoes existem para nao cortar trabalho legitimamente
  // longo (lote de criativos, upload em lote, leitura ainda aberta).
  it("para depois de duas respostas substantivas", () => {
    expect(
      devePararContinuacao([
        msg("user", "faça a leitura da semana"),
        msg("assistant", "Primeira parte da leitura, com o gasto por campanha."),
        msg("assistant", "Segunda parte da leitura, com o custo por lead."),
      ]),
    ).toBe(true);
  });

  it("nao para com uma so resposta", () => {
    expect(
      devePararContinuacao([
        msg("user", "faça a leitura da semana"),
        msg("assistant", "Primeira parte da leitura, com o gasto por campanha."),
      ]),
    ).toBe(false);
  });

  it("stub de progresso nao conta para o limite de duas", () => {
    expect(
      devePararContinuacao([
        msg("user", "faça a leitura da semana"),
        msg("assistant", STUB_PROGRESSO),
        msg("assistant", "Primeira parte da leitura, com o gasto por campanha."),
      ]),
    ).toBe(false);
  });

  it("lote de criativos ainda aberto nao e cortado na 2a bolha", () => {
    expect(
      devePararContinuacao([
        msg("user", "monte o lote de criativos"),
        msg("assistant", "Primeira peça montada com o vídeo do drive."),
        msg("assistant", "Seguem as legendas pendentes do conjunto 1."),
      ]),
    ).toBe(false);
  });

  it("pedido de upload em lote nao e cortado", () => {
    expect(
      devePararContinuacao([
        msg("user", "suba os vídeos restantes da biblioteca"),
        msg("assistant", "Subi o primeiro vídeo."),
        msg("assistant", "Subi o segundo vídeo."),
      ]),
    ).toBe(false);
  });

  it("leitura declarada incompleta nao e cortada", () => {
    expect(
      devePararContinuacao([
        msg("user", "faça a leitura da semana"),
        msg("assistant", "Gasto por campanha consolidado."),
        msg("assistant", "Sobre o resto, o levantamento veio incompleto."),
      ]),
    ).toBe(false);
  });

  it("fio vazio nao manda parar", () => {
    expect(devePararContinuacao([])).toBe(false);
  });
});

describe("countSubstantiveAssistantsSinceLastUser", () => {
  it("para de contar no user anterior", () => {
    expect(
      countSubstantiveAssistantsSinceLastUser([
        msg("assistant", "resposta de um turno antigo"),
        msg("user", "nova pergunta"),
        msg("assistant", "resposta nova"),
      ]),
    ).toBe(1);
  });

  it("ignora papel que nao e assistant nem user", () => {
    expect(
      countSubstantiveAssistantsSinceLastUser([
        msg("user", "pergunta"),
        msg("tool", "saida de ferramenta"),
        msg("assistant", "resposta"),
      ]),
    ).toBe(1);
  });
});

describe("lastUserContent", () => {
  it("pega a ultima pergunta, ignorando o que veio depois", () => {
    expect(
      lastUserContent([
        msg("user", "primeira"),
        msg("assistant", "resposta"),
        msg("user", "segunda"),
        msg("assistant", "outra resposta"),
      ]),
    ).toBe("segunda");
  });

  it("conteudo nulo vira string vazia", () => {
    expect(lastUserContent([msg("user", null)])).toBe("");
  });

  it("fio sem pergunta devolve vazio", () => {
    expect(lastUserContent([msg("assistant", "oi")])).toBe("");
  });
});

describe("capContinuacoes — teto de segmentos por tipo de pedido", () => {
  it("pedido comum usa o teto padrao", () => {
    expect(capContinuacoes("quanto gastei ontem")).toBe(MAX_CONTINUATIONS);
  });

  it("upload em lote ganha teto maior", () => {
    expect(capContinuacoes("suba os vídeos restantes da biblioteca")).toBe(
      MAX_CONTINUATIONS_UPLOAD,
    );
  });

  it("upload em lote curto tem teto de 3", () => {
    expect(capContinuacoes("suba os 3 vídeos pendentes")).toBe(3);
  });
});

describe("actionCardIds — cartao de aprovacao que nao renderiza e ato sem portao", () => {
  // Se isto devolver [] por engano, o ActionCard nao aparece na conversa e o
  // gestor nao tem onde aprovar nem rejeitar — o pedido existe no banco e fica
  // invisivel. Falha silenciosa, com dinheiro do outro lado.
  it("extrai os approval_id dos marcadores", () => {
    expect(
      actionCardIds([
        { tipo: "action_card", approval_id: "ap1" },
        { tipo: "action_card", approval_id: "ap2" },
      ]),
    ).toEqual(["ap1", "ap2"]);
  });

  it("ignora anexo comum no meio dos marcadores", () => {
    expect(
      actionCardIds([
        { name: "print.png", mime: "image/png" },
        { tipo: "action_card", approval_id: "ap1" },
      ]),
    ).toEqual(["ap1"]);
  });

  it("descarta marcador com approval_id que nao e string", () => {
    expect(actionCardIds([{ tipo: "action_card", approval_id: 42 }])).toEqual([]);
    expect(actionCardIds([{ tipo: "action_card", approval_id: null }])).toEqual([]);
    expect(actionCardIds([{ tipo: "action_card" }])).toEqual([]);
  });

  it("descarta tipo diferente", () => {
    expect(actionCardIds([{ tipo: "outro", approval_id: "ap1" }])).toEqual([]);
  });

  it("aguenta entrada que nao e lista", () => {
    expect(actionCardIds(null)).toEqual([]);
    expect(actionCardIds(undefined)).toEqual([]);
    expect(actionCardIds("action_card")).toEqual([]);
    expect(actionCardIds({ tipo: "action_card", approval_id: "ap1" })).toEqual([]);
  });

  it("aguenta null dentro da lista", () => {
    expect(actionCardIds([null, { tipo: "action_card", approval_id: "ap1" }])).toEqual(["ap1"]);
  });
});

describe("toolNames — chips de ferramenta", () => {
  it("uma ocorrencia por nome, na ordem da primeira aparicao", () => {
    expect(
      toolNames([
        { tool: "ler_desempenho" },
        { tool: "propose_action" },
        { tool: "ler_desempenho" },
      ]),
    ).toEqual(["ler_desempenho", "propose_action"]);
  });

  it("descarta entrada sem tool utilizavel", () => {
    expect(toolNames([{ tool: "" }, { tool: 7 }, null, "x", { outro: "y" }])).toEqual([]);
  });

  it("aguenta entrada que nao e lista", () => {
    expect(toolNames(null)).toEqual([]);
    expect(toolNames({ tool: "ler_desempenho" })).toEqual([]);
  });
});

describe("storedAttachments", () => {
  it("mantem so objetos", () => {
    expect(storedAttachments([{ name: "a.pdf" }, null, "b.pdf", 3])).toEqual([{ name: "a.pdf" }]);
  });

  it("aguenta entrada que nao e lista", () => {
    expect(storedAttachments(null)).toEqual([]);
  });
});

describe("mesmaProsa", () => {
  it("ignora acento, caixa e espaco nas pontas", () => {
    expect(mesmaProsa("  Orçamento Diário ", "orcamento diario")).toBe(true);
  });

  it("distingue prosa diferente", () => {
    expect(mesmaProsa("orçamento diário", "orçamento mensal")).toBe(false);
  });
});
