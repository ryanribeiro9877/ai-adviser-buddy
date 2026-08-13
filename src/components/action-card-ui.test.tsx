import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { ActionCard, FalhaDaExecucao, type Approval } from "./action-card";

// O cartao onde a sancao humana acontece. Arquivo separado de action-card.test.tsx,
// que cobre o contrato da RPC; aqui e a UI.
//
// A propriedade que organiza tudo: o cartao nunca deve deixar o gestor decidir
// no escuro nem achar que decidiu o que nao decidiu. Cada teste abaixo protege
// um pedaco disso.

vi.mock("@tanstack/react-router", () => ({
  Link: ({ children, to }: { children: ReactNode; to: string }) => <a href={to}>{children}</a>,
}));

vi.mock("@/integrations/supabase/client", () => ({ supabase: { rpc: vi.fn() } }));

const AGORA = new Date("2026-08-13T12:00:00Z");

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  vi.setSystemTime(AGORA);
});

afterEach(() => {
  vi.useRealTimers();
});

function pedido(over: Partial<Approval> = {}): Approval {
  return {
    id: "p1",
    action: "pausar_campanha",
    entity_type: "campaign",
    summary: "Pausar a campanha Leads Julho",
    payload: {},
    status: "pending",
    review_note: null,
    reviewed_at: null,
    requested_by: "u1",
    reviewed_by: null,
    created_at: "2026-08-13T10:00:00Z",
    conversation_id: null,
    expires_at: null,
    executed_at: null,
    execution_result: null,
    ultima_falha: null,
    ...over,
  };
}

function montar(over: Partial<Approval> = {}, props: Record<string, unknown> = {}) {
  const onDecide = vi.fn();
  const r = render(
    <ActionCard
      approval={pedido(over)}
      isAdmin={true}
      deciding={false}
      onDecide={onDecide}
      {...props}
    />,
  );
  return { ...r, onDecide };
}

describe("cabeçalho", () => {
  it("traduz a acao para linguagem de gestor", () => {
    montar({ action: "escalar_duplicar" });
    expect(screen.getByText("Escalar (duplicar +20%)")).toBeInTheDocument();
  });

  it("acao desconhecida aparece crua, em vez de sumir", () => {
    // Preferivel ver "acao_nova_do_backend" a ver um cartao sem titulo.
    montar({ action: "acao_nova_do_backend" });
    expect(screen.getByText("acao_nova_do_backend")).toBeInTheDocument();
  });

  it("mostra o resumo do pedido", () => {
    montar();
    expect(screen.getByText("Pausar a campanha Leads Julho")).toBeInTheDocument();
  });

  it("pendente diz 'Aguardando aprovação'", () => {
    montar({ status: "pending" });
    expect(screen.getByText("Aguardando aprovação")).toBeInTheDocument();
  });

  it("aprovada diz que ainda falta APLICAR no Gerenciador", () => {
    // Distincao central do produto: aprovar registra a decisao, nao executa.
    montar({ status: "approved" });
    expect(screen.getByText("Aprovada — aplicar no Gerenciador")).toBeInTheDocument();
  });

  it("veredito de compliance diz 'veredito registrado' — nao ha o que aplicar", () => {
    // registrar_veredito_peca se resolve DENTRO do banco: aprovar E o ato.
    // Dizer "aplicar no Gerenciador" mandaria o gestor procurar algo que nao existe.
    montar({ status: "approved", action: "registrar_veredito_peca" });
    expect(screen.getByText("Aprovada — veredito registrado")).toBeInTheDocument();
  });

  it("status desconhecido aparece cru", () => {
    montar({ status: "cancelada_manual" });
    expect(screen.getByText("cancelada_manual")).toBeInTheDocument();
  });
});

describe("aviso das travas — a honestidade do cartão", () => {
  it("pendente avisa que aprovar NAO aplica nada na Meta", () => {
    // Se este texto sair, o gestor passa a acreditar que o clique mexeu na conta.
    montar({ status: "pending" });
    expect(screen.getByText(/não aplica nada na Meta/)).toBeInTheDocument();
    expect(screen.getByText(/registra a decisão/)).toBeInTheDocument();
  });

  it("pendente avisa do prazo de 24h e da rejeicao automatica", () => {
    montar({ status: "pending" });
    expect(screen.getByText(/expira em 24h/)).toBeInTheDocument();
    expect(screen.getByText(/vira rejeitada automaticamente com nota/)).toBeInTheDocument();
  });

  it("pedido ja decidido nao repete o aviso", () => {
    montar({ status: "approved" });
    expect(screen.queryByText(/não aplica nada na Meta/)).not.toBeInTheDocument();
  });
});

describe("parâmetros da ação", () => {
  it("ficam recolhidos mas presentes — decidir sem eles e decidir no escuro", () => {
    montar({ payload: { campaign_id: "cmp_1", novo_orcamento: 5000 } });
    expect(screen.getByText("Parâmetros da ação")).toBeInTheDocument();
    expect(screen.getByText(/"novo_orcamento": 5000/)).toBeInTheDocument();
  });

  it("payload vazio nao gera secao vazia", () => {
    montar({ payload: {} });
    expect(screen.queryByText("Parâmetros da ação")).not.toBeInTheDocument();
  });

  it("payload nulo nao estoura", () => {
    montar({ payload: null });
    expect(screen.queryByText("Parâmetros da ação")).not.toBeInTheDocument();
  });

  it("a justificativa do payload aparece em destaque", () => {
    montar({ payload: { justificativa: "CPL 3x acima do teto por 5 dias" } });
    expect(screen.getByText("CPL 3x acima do teto por 5 dias")).toBeInTheDocument();
  });

  it("justificativa nao-string e ignorada em vez de renderizada torta", () => {
    montar({ payload: { justificativa: { texto: "x" } } });
    expect(screen.queryByText(/\[object Object\]/)).not.toBeInTheDocument();
  });
});

describe("prazo", () => {
  it("mostra o contador enquanto pendente", () => {
    montar({ status: "pending", expires_at: "2026-08-13T15:00:00Z" });
    expect(screen.getByText("expira em 3h")).toBeInTheDocument();
  });

  it("prazo curto (<= 2h) recebe destaque visual", () => {
    const { container } = render(
      <ActionCard
        approval={pedido({ expires_at: "2026-08-13T13:30:00Z" })}
        isAdmin
        deciding={false}
        onDecide={vi.fn()}
      />,
    );
    const prazo = screen.getByText("expira em 1h 30min");
    expect(prazo.className).toContain("text-destructive");
    expect(container).toBeTruthy();
  });

  it("prazo longo nao usa a cor de urgencia", () => {
    montar({ expires_at: "2026-08-14T12:00:00Z" });
    expect(screen.getByText("expira em 24h").className).not.toContain("text-destructive");
  });

  // O contador e um span cujo texto e EXATAMENTE "expira em 3h". Casar so
  // /expira em/ pegaria tambem o aviso estatico das travas ("A aprovação expira
  // em 24h — sem decisão…"), que e outra coisa e aparece em todo pendente.
  const CONTADOR = /^expira em \d/;

  it("sem expires_at nao mostra contador", () => {
    montar({ expires_at: null });
    expect(screen.queryByText(CONTADOR)).not.toBeInTheDocument();
  });

  it("pedido decidido nao mostra contador, mesmo com expires_at", () => {
    montar({ status: "approved", expires_at: "2026-08-13T15:00:00Z" });
    expect(screen.queryByText(CONTADOR)).not.toBeInTheDocument();
  });
});

describe("expirado", () => {
  const expirado = { status: "pending" as const, expires_at: "2026-08-13T11:00:00Z" };

  it("troca o rotulo para 'Expirada sem decisão'", () => {
    montar(expirado);
    expect(screen.getByText("Expirada sem decisão")).toBeInTheDocument();
    expect(screen.queryByText("Aguardando aprovação")).not.toBeInTheDocument();
  });

  it("DESABILITA aprovar e rejeitar", () => {
    montar(expirado);
    expect(screen.getByRole("button", { name: /Aprovar/ })).toBeDisabled();
    expect(screen.getByRole("button", { name: /Rejeitar/ })).toBeDisabled();
  });

  it("explica POR QUE nao pode mais decidir", () => {
    montar(expirado);
    expect(screen.getByText("Pedido expirado — não pode mais ser aprovado")).toBeInTheDocument();
  });
});

describe("gate de admin", () => {
  it("admin pode aprovar e rejeitar", () => {
    montar();
    expect(screen.getByRole("button", { name: /Aprovar/ })).toBeEnabled();
    expect(screen.getByRole("button", { name: /Rejeitar/ })).toBeEnabled();
  });

  it("nao-admin ve os botoes DESABILITADOS, com o motivo visivel", () => {
    // Decisao deliberada: a RLS bloquearia o UPDATE de qualquer forma, e um botao
    // que falha em silencio e pior que um desabilitado que explica.
    render(<ActionCard approval={pedido()} isAdmin={false} deciding={false} onDecide={vi.fn()} />);
    expect(screen.getByRole("button", { name: /Aprovar/ })).toBeDisabled();
    expect(screen.getByRole("button", { name: /Rejeitar/ })).toBeDisabled();
    expect(screen.getByText("Somente administrador pode aprovar ou rejeitar")).toBeInTheDocument();
  });

  it("admin nao ve mensagem de bloqueio", () => {
    montar();
    expect(screen.queryByText(/Somente administrador/)).not.toBeInTheDocument();
  });

  it("pedido decidido nao oferece botoes a ninguem", () => {
    montar({ status: "approved" });
    expect(screen.queryByRole("button", { name: /Aprovar/ })).not.toBeInTheDocument();
  });
});

describe("aprovar", () => {
  it("chama onDecide com approved e SEM motivo", async () => {
    const { onDecide } = montar();
    await userEvent.click(screen.getByRole("button", { name: /Aprovar/ }));
    expect(onDecide).toHaveBeenCalledWith("p1", "approved");
  });

  it("em decisao, os botoes ficam desabilitados", () => {
    render(<ActionCard approval={pedido()} isAdmin deciding onDecide={vi.fn()} />);
    expect(screen.getByRole("button", { name: /Aprovar/ })).toBeDisabled();
    expect(screen.getByRole("button", { name: /Rejeitar/ })).toBeDisabled();
  });
});

describe("rejeitar — o motivo é obrigatório", () => {
  it("abre o campo de motivo em vez de rejeitar direto", async () => {
    const { onDecide } = montar();
    await userEvent.click(screen.getByRole("button", { name: /Rejeitar/ }));
    expect(screen.getByPlaceholderText("Motivo da rejeição (obrigatório)")).toBeInTheDocument();
    expect(onDecide).not.toHaveBeenCalled();
  });

  it("confirmar fica DESABILITADO enquanto o motivo esta vazio", async () => {
    // O motivo e o que ensina o sistema: rejeicao sem motivo nao informa nada a
    // quem for revisar depois.
    montar();
    await userEvent.click(screen.getByRole("button", { name: /Rejeitar/ }));
    expect(screen.getByRole("button", { name: /Confirmar rejeição/ })).toBeDisabled();
  });

  it("motivo so com espaco tambem nao libera", async () => {
    montar();
    await userEvent.click(screen.getByRole("button", { name: /Rejeitar/ }));
    await userEvent.type(screen.getByPlaceholderText(/Motivo da rejeição/), "   ");
    expect(screen.getByRole("button", { name: /Confirmar rejeição/ })).toBeDisabled();
  });

  it("com motivo, confirma e encaminha o texto", async () => {
    const { onDecide } = montar();
    await userEvent.click(screen.getByRole("button", { name: /Rejeitar/ }));
    await userEvent.type(screen.getByPlaceholderText(/Motivo da rejeição/), "Fora do teto");
    await userEvent.click(screen.getByRole("button", { name: /Confirmar rejeição/ }));
    expect(onDecide).toHaveBeenCalledWith("p1", "rejected", "Fora do teto");
  });

  it("cancelar fecha o campo e APAGA o que foi digitado", async () => {
    // Sem limpar, reabrir traria um motivo de outra intencao ja escrito.
    montar();
    await userEvent.click(screen.getByRole("button", { name: /Rejeitar/ }));
    await userEvent.type(screen.getByPlaceholderText(/Motivo da rejeição/), "texto antigo");
    await userEvent.click(screen.getByRole("button", { name: "Cancelar" }));
    await userEvent.click(screen.getByRole("button", { name: /Rejeitar/ }));
    expect(screen.getByPlaceholderText(/Motivo da rejeição/)).toHaveValue("");
  });
});

describe("estado da execução", () => {
  it("aprovado sem execucao diz que AGUARDA execucao", () => {
    montar({ status: "approved", executed_at: null });
    expect(screen.getByText("Aprovado — aguardando execução.")).toBeInTheDocument();
  });

  it("executado com sucesso informa quando", () => {
    montar({ status: "approved", executed_at: "2026-08-13T14:00:00Z" });
    expect(screen.getByText(/Executado em/)).toBeInTheDocument();
  });

  it("execucao com ok:false avisa de ESCRITA PARCIAL", () => {
    // O pior caso operacional: parte foi escrita na Meta. Tratar como sucesso
    // faria o gestor tentar de novo e duplicar.
    montar({
      status: "approved",
      executed_at: "2026-08-13T14:00:00Z",
      execution_result: { ok: false },
    });
    expect(screen.getByText(/escrita parcial/)).toBeInTheDocument();
    expect(screen.getByText(/confira no Gerenciador antes de tentar de novo/)).toBeInTheDocument();
  });

  it("rejeitado mostra o motivo registrado", () => {
    montar({ status: "rejected", review_note: "Verba acima do teto" });
    expect(screen.getByText("Verba acima do teto")).toBeInTheDocument();
  });

  it("rejeitado sem nota nao inventa motivo", () => {
    montar({ status: "rejected", review_note: null });
    expect(screen.queryByText(/Motivo:/)).not.toBeInTheDocument();
  });
});

describe("falha da execução", () => {
  const falha = {
    em: "2026-08-13T14:00:00Z",
    motivo_para_o_gestor: "A Meta recusou: orçamento abaixo do mínimo da conta",
    tentativa: 2,
    re_executavel: true,
  };

  it("aparece no CARD, que e onde o gestor olha", () => {
    montar({ status: "approved", ultima_falha: falha });
    expect(screen.getByText("A última tentativa de execução falhou")).toBeInTheDocument();
    expect(screen.getByText(falha.motivo_para_o_gestor)).toBeInTheDocument();
  });

  it("a falha SUBSTITUI a mensagem de aguardando/executado", () => {
    // Mostrar "aguardando execução" junto com "falhou" seria contradicao na tela.
    montar({ status: "approved", executed_at: null, ultima_falha: falha });
    expect(screen.queryByText(/aguardando execução/)).not.toBeInTheDocument();
  });

  it("informa tentativa e que pode tentar de novo", () => {
    render(<FalhaDaExecucao falha={falha} />);
    expect(screen.getByText("Tentativa 2")).toBeInTheDocument();
    expect(screen.getByText(/Pode tentar de novo/)).toBeInTheDocument();
  });

  it("re_executavel=false avisa que NAO da para re-executar", () => {
    render(<FalhaDaExecucao falha={{ ...falha, re_executavel: false }} />);
    expect(
      screen.getByText("Não é possível re-executar (houve escrita parcial)"),
    ).toBeInTheDocument();
  });

  it("re_executavel ausente assume que pode tentar (nao trava por omissao)", () => {
    render(<FalhaDaExecucao falha={{ motivo_para_o_gestor: "x" }} />);
    expect(screen.getByText(/Pode tentar de novo/)).toBeInTheDocument();
  });

  it("falha sem motivo ainda anuncia a falha", () => {
    // Nunca esconder que falhou, mesmo sem texto amigavel.
    render(<FalhaDaExecucao falha={{ em: "2026-08-13T14:00:00Z" }} />);
    expect(screen.getByText("A última tentativa de execução falhou")).toBeInTheDocument();
  });

  it("motivo so com espaco nao gera paragrafo vazio", () => {
    render(<FalhaDaExecucao falha={{ motivo_para_o_gestor: "   " }} />);
    expect(screen.getByText("A última tentativa de execução falhou")).toBeInTheDocument();
  });
});

describe("metadados (showMeta)", () => {
  it("mostra quem pediu e quando", () => {
    montar({}, { showMeta: true, requesterName: "Ryan" });
    expect(screen.getByText(/Pedido por Ryan em/)).toBeInTheDocument();
  });

  it("autor desconhecido vira travessao, nao 'undefined'", () => {
    montar({}, { showMeta: true });
    expect(screen.getByText(/Pedido por — em/)).toBeInTheDocument();
  });

  it("mostra quem decidiu, quando ja houve decisao", () => {
    montar(
      { status: "approved", reviewed_at: "2026-08-13T13:00:00Z" },
      { showMeta: true, requesterName: "Ryan", reviewerName: "Roberto" },
    );
    expect(screen.getByText(/Aprovado por Roberto em/)).toBeInTheDocument();
  });

  it("rejeitado mostra 'Rejeitado por'", () => {
    montar(
      { status: "rejected", reviewed_at: "2026-08-13T13:00:00Z" },
      { showMeta: true, reviewerName: "Roberto" },
    );
    expect(screen.getByText(/Rejeitado por Roberto em/)).toBeInTheDocument();
  });

  it("sem showMeta nao polui o cartao", () => {
    montar({}, { showMeta: false });
    expect(screen.queryByText(/Pedido por/)).not.toBeInTheDocument();
  });
});

describe("link para a conversa de origem", () => {
  it("aparece quando ha conversa e o consumidor pede", () => {
    montar({ conversation_id: "conv-9" }, { linkConversa: true });
    expect(screen.getByText("Ver a conversa que originou").closest("a")).toHaveAttribute(
      "href",
      "/recomendacoes",
    );
  });

  it("NAO aparece sem conversation_id (link morto e pior que ausencia)", () => {
    montar({ conversation_id: null }, { linkConversa: true });
    expect(screen.queryByText("Ver a conversa que originou")).not.toBeInTheDocument();
  });

  it("NAO aparece dentro do proprio chat (linkConversa desligado)", () => {
    montar({ conversation_id: "conv-9" }, { linkConversa: false });
    expect(screen.queryByText("Ver a conversa que originou")).not.toBeInTheDocument();
  });
});
