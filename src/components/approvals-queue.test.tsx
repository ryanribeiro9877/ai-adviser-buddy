import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { ApprovalsQueue } from "./approvals-queue";

// A fila de aprovacoes e o portao humano das acoes em conta de anuncio real.
// O que estes testes protegem e a ORQUESTRACAO: ordem dos cartoes, os tres
// estados de tela e - o mais importante - o rollback da atualizacao otimista.
// Sem rollback, uma RPC recusada deixa o cartao marcado como aprovado e o
// gestor acredita ter sancionado o que o banco recusou.
//
// ActionCard entra dublado de proposito: ele renderiza Link do TanStack Router e
// exigiria contexto de rota, o que testaria o roteador em vez desta logica. A
// renderizacao do cartao merece teste proprio; o contrato de decideApproval esta
// coberto em action-card.test.tsx.

const decideApprovalMock = vi.fn();
const recarregarMock = vi.fn();
const toastErrorMock = vi.fn();
const toastSuccessMock = vi.fn();
let isAdminAtual = true;
let respostaDaBusca: { data: unknown; error: unknown } = { data: [], error: null };

vi.mock("./action-card", () => ({
  decideApproval: (...a: unknown[]) => decideApprovalMock(...a),
  // Dublê mínimo: expõe o status que a fila mandou (para provar o otimismo e o
  // rollback) e dois botões que chamam onDecide.
  ActionCard: ({
    approval,
    isAdmin,
    deciding,
    onDecide,
  }: {
    approval: { id: string; summary: string; status: string };
    isAdmin: boolean;
    deciding: boolean;
    onDecide: (id: string, d: "approved" | "rejected", reason?: string) => void;
  }) => (
    <div data-testid="card" data-id={approval.id} data-status={approval.status}>
      <span>{approval.summary}</span>
      <button
        disabled={!isAdmin || deciding}
        onClick={() => onDecide(approval.id, "approved")}
      >{`aprovar ${approval.id}`}</button>
      <button
        disabled={!isAdmin || deciding}
        onClick={() => onDecide(approval.id, "rejected", "  nao passa  ")}
      >{`rejeitar ${approval.id}`}</button>
    </div>
  ),
}));

vi.mock("@/lib/app-context", () => ({ useApp: () => ({ isAdmin: isAdminAtual }) }));
vi.mock("@/hooks/use-notificacoes", () => ({
  useNotificacoes: () => ({ recarregar: recarregarMock }),
}));
vi.mock("sonner", () => ({
  toast: {
    error: (...a: unknown[]) => toastErrorMock(...a),
    success: (...a: unknown[]) => toastSuccessMock(...a),
  },
}));
// `pendenteParaSempre` deixa a query travada em isLoading de verdade, em vez de
// resolver e o teste passar so pelo primeiro render sincrono.
let pendenteParaSempre = false;
vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    from: () => ({
      select: () => ({
        eq: () => (pendenteParaSempre ? new Promise(() => {}) : Promise.resolve(respostaDaBusca)),
        in: () => Promise.resolve({ data: [], error: null }),
      }),
    }),
  },
}));

const EMPRESA = "8f1e2c3d-4a5b-6c7d-8e9f-0a1b2c3d4e5f";

function pedido(over: Partial<Record<string, unknown>> = {}) {
  return {
    id: "a1",
    action: "escalar_orcamento",
    entity_type: "campaign",
    summary: "Escalar orcamento em 20%",
    payload: {},
    status: "pending",
    review_note: null,
    reviewed_at: null,
    requested_by: null,
    reviewed_by: null,
    created_at: "2026-08-13T10:00:00Z",
    conversation_id: null,
    ...over,
  };
}

function montar() {
  // retry: false para um erro de query nao virar espera de backoff no teste.
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const Wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={qc}>{children}</QueryClientProvider>
  );
  return { qc, ...render(<ApprovalsQueue companyId={EMPRESA} />, { wrapper: Wrapper }) };
}

beforeEach(() => {
  decideApprovalMock.mockReset();
  decideApprovalMock.mockResolvedValue({ error: null });
  recarregarMock.mockReset();
  toastErrorMock.mockReset();
  toastSuccessMock.mockReset();
  isAdminAtual = true;
  respostaDaBusca = { data: [], error: null };
  pendenteParaSempre = false;
});

describe("ApprovalsQueue — estados de tela", () => {
  it("mostra esqueleto enquanto carrega (nao a tela vazia)", async () => {
    // Distincao que importa: "carregando" e "nao ha pedido" sao coisas
    // diferentes, e mostrar "nenhum pedido" durante a carga faz o gestor achar
    // que a fila esvaziou.
    pendenteParaSempre = true;
    const { container } = montar();
    // espera de proposito: se a query resolvesse, o vazio apareceria aqui.
    await new Promise((r) => setTimeout(r, 50));
    expect(screen.queryByText(/nenhum pedido/i)).not.toBeInTheDocument();
    expect(screen.queryAllByTestId("card")).toHaveLength(0);
    // Skeleton (src/components/ui/skeleton.tsx) marca com a classe animate-pulse.
    expect(container.querySelectorAll(".animate-pulse").length).toBe(3);
  });

  it("mostra o vazio quando a busca volta sem linhas", async () => {
    respostaDaBusca = { data: [], error: null };
    montar();
    expect(await screen.findByText(/nenhum pedido de aprovação/i)).toBeInTheDocument();
  });

  it("renderiza um cartao por pedido", async () => {
    respostaDaBusca = { data: [pedido({ id: "a1" }), pedido({ id: "a2" })], error: null };
    montar();
    await waitFor(() => expect(screen.getAllByTestId("card")).toHaveLength(2));
  });
});

describe("ApprovalsQueue — ordem", () => {
  it("pendentes vem antes de decididos", async () => {
    respostaDaBusca = {
      data: [
        pedido({ id: "decidido", status: "approved", created_at: "2026-08-13T23:00:00Z" }),
        pedido({ id: "pendente", status: "pending", created_at: "2026-08-01T00:00:00Z" }),
      ],
      error: null,
    };
    montar();
    await waitFor(() => expect(screen.getAllByTestId("card")).toHaveLength(2));
    // O pendente e mais ANTIGO e ainda assim vem primeiro: status manda.
    expect(screen.getAllByTestId("card").map((n) => n.dataset.id)).toEqual([
      "pendente",
      "decidido",
    ]);
  });

  it("dentro do mesmo status, mais recente primeiro", async () => {
    respostaDaBusca = {
      data: [
        pedido({ id: "antigo", created_at: "2026-08-01T00:00:00Z" }),
        pedido({ id: "novo", created_at: "2026-08-13T00:00:00Z" }),
      ],
      error: null,
    };
    montar();
    await waitFor(() => expect(screen.getAllByTestId("card")).toHaveLength(2));
    expect(screen.getAllByTestId("card").map((n) => n.dataset.id)).toEqual(["novo", "antigo"]);
  });

  it("status desconhecido vai para o fim, sem quebrar a ordenacao", async () => {
    respostaDaBusca = {
      data: [
        pedido({ id: "esquisito", status: "expirado_manual" }),
        pedido({ id: "aprovado", status: "approved" }),
        pedido({ id: "pendente", status: "pending" }),
      ],
      error: null,
    };
    montar();
    await waitFor(() => expect(screen.getAllByTestId("card")).toHaveLength(3));
    expect(screen.getAllByTestId("card").map((n) => n.dataset.id)).toEqual([
      "pendente",
      "aprovado",
      "esquisito",
    ]);
  });
});

describe("ApprovalsQueue — decisao", () => {
  beforeEach(() => {
    respostaDaBusca = { data: [pedido({ id: "a1" })], error: null };
  });

  it("aprovar chama decideApproval e avisa o sino", async () => {
    montar();
    await userEvent.click(await screen.findByText("aprovar a1"));
    await waitFor(() =>
      expect(decideApprovalMock).toHaveBeenCalledWith("a1", "approved", undefined),
    );
    expect(toastSuccessMock).toHaveBeenCalledWith("Pedido aprovado");
    // decidido = sai do sino; sem isto a notificacao fica pendurada.
    expect(recarregarMock).toHaveBeenCalled();
  });

  it("rejeitar encaminha o motivo e mostra o toast de rejeicao", async () => {
    montar();
    await userEvent.click(await screen.findByText("rejeitar a1"));
    await waitFor(() =>
      expect(decideApprovalMock).toHaveBeenCalledWith("a1", "rejected", "  nao passa  "),
    );
    expect(toastSuccessMock).toHaveBeenCalledWith("Pedido rejeitado");
  });

  it("atualiza o cartao na hora (otimismo), antes da resposta do banco", async () => {
    let liberar: (v: { error: string | null }) => void = () => {};
    decideApprovalMock.mockReturnValue(new Promise((r) => (liberar = r)));
    montar();
    await userEvent.click(await screen.findByText("aprovar a1"));
    // Ainda sem resposta do banco, o cartao ja aparece aprovado.
    await waitFor(() => expect(screen.getByTestId("card").dataset.status).toBe("approved"));
    liberar({ error: null });
  });

  it("REVERTE o cartao quando a RPC recusa, e mostra o erro", async () => {
    // O teste mais importante do arquivo. Sem o rollback, o gestor ve
    // "aprovado" numa acao que o banco recusou - e a tela mente sobre o estado
    // de uma acao que mexe em dinheiro de anuncio.
    decideApprovalMock.mockResolvedValue({ error: "permission denied for function" });
    montar();
    await userEvent.click(await screen.findByText("aprovar a1"));
    await waitFor(() =>
      expect(toastErrorMock).toHaveBeenCalledWith("permission denied for function"),
    );
    expect(screen.getByTestId("card").dataset.status).toBe("pending");
    // e nao mexe no sino, porque nada foi decidido
    expect(recarregarMock).not.toHaveBeenCalled();
    expect(toastSuccessMock).not.toHaveBeenCalled();
  });

  it("desabilita os botoes do cartao em decisao enquanto a RPC nao volta", async () => {
    let liberar: (v: { error: string | null }) => void = () => {};
    decideApprovalMock.mockReturnValue(new Promise((r) => (liberar = r)));
    montar();
    const btn = await screen.findByText("aprovar a1");
    await userEvent.click(btn);
    await waitFor(() => expect(btn).toBeDisabled());
    liberar({ error: null });
    await waitFor(() => expect(btn).toBeEnabled());
  });

  it("nao-admin recebe os botoes desabilitados", async () => {
    isAdminAtual = false;
    montar();
    expect(await screen.findByText("aprovar a1")).toBeDisabled();
    expect(screen.getByText("rejeitar a1")).toBeDisabled();
  });
});
