import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";

// A tela legada de aprovacoes (menu oculto por feature-flag, rota ainda viva e
// acessivel por URL). Diferente do ActionCard, esta tela grava o UPDATE direto,
// sem passar pela RPC decide_approval - o que torna o teste do gate de admin e
// da auditoria ainda mais importante aqui.

let ctx = {
  selectedCompany: { id: "c1", name: "JCR2" } as { id: string; name: string } | null,
  isAdmin: true,
  user: { id: "u1" },
};
let linhas: Record<string, unknown>[] = [];
let erroDoUpdate: unknown = null;
const updateMock = vi.fn();
const logAuditMock = vi.fn();
const toastErrorMock = vi.fn();
const toastSuccessMock = vi.fn();

vi.mock("@tanstack/react-router", () => ({
  createFileRoute: () => (opts: Record<string, unknown>) => ({ options: opts }),
}));

vi.mock("@/lib/app-context", () => ({
  useApp: () => ctx,
  logAudit: (...a: unknown[]) => logAuditMock(...a),
}));

vi.mock("@/components/metric-card", () => ({
  EmptyCompany: () => <div data-testid="empty-company" />,
}));

vi.mock("sonner", () => ({
  toast: {
    error: (...a: unknown[]) => toastErrorMock(...a),
    success: (...a: unknown[]) => toastSuccessMock(...a),
  },
}));

const rpcMock = vi.fn();

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    from: () => ({
      select: () => ({ eq: () => ({ order: () => Promise.resolve({ data: linhas }) }) }),
      update: (patch: unknown) => ({
        eq: (c: string, v: unknown) => {
          updateMock(patch, c, v);
          return Promise.resolve({ error: erroDoUpdate });
        },
      }),
    }),
    rpc: (...a: unknown[]) => rpcMock(...a),
  },
}));

import { Route } from "./aprovacoes";

const Aprovacoes = (Route.options as unknown as { component: () => ReactNode }).component;

function pedido(over: Record<string, unknown> = {}) {
  return {
    id: "p1",
    summary: "Pausar a campanha Leads Julho",
    entity_type: "campaign",
    status: "pending",
    payload: {},
    created_at: "2026-08-13T10:00:00Z",
    executed_at: null,
    ultima_falha: null,
    ...over,
  };
}

function montar() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const Wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={qc}>{children}</QueryClientProvider>
  );
  return render(<Aprovacoes />, { wrapper: Wrapper });
}

beforeEach(() => {
  ctx = { selectedCompany: { id: "c1", name: "JCR2" }, isAdmin: true, user: { id: "u1" } };
  linhas = [];
  erroDoUpdate = null;
  updateMock.mockReset();
  rpcMock.mockReset().mockResolvedValue({ error: null });
  logAuditMock.mockReset().mockResolvedValue(undefined);
  toastErrorMock.mockReset();
  toastSuccessMock.mockReset();
});

describe("sem empresa", () => {
  it("mostra o vazio", () => {
    ctx = { ...ctx, selectedCompany: null };
    montar();
    expect(screen.getByTestId("empty-company")).toBeInTheDocument();
  });
});

describe("separação pendentes / histórico", () => {
  it("conta os pendentes no titulo da secao", async () => {
    linhas = [pedido({ id: "a" }), pedido({ id: "b" }), pedido({ id: "c", status: "approved" })];
    montar();
    expect(await screen.findByText("Pendentes (2)")).toBeInTheDocument();
  });

  it("sem pendente diz que nao ha, em vez de secao vazia", async () => {
    linhas = [pedido({ status: "approved" })];
    montar();
    expect(await screen.findByText("Nenhuma solicitação pendente.")).toBeInTheDocument();
  });

  it("decididos vao para Historico", async () => {
    linhas = [pedido({ id: "d", status: "rejected" })];
    montar();
    expect(await screen.findByText("Histórico")).toBeInTheDocument();
  });

  it("sem decididos, a secao Historico nao aparece", async () => {
    linhas = [pedido()];
    montar();
    await screen.findByText("Pendentes (1)");
    expect(screen.queryByText("Histórico")).not.toBeInTheDocument();
  });
});

describe("cartão", () => {
  it("mostra resumo, tipo de entidade e status em pt-BR", async () => {
    linhas = [pedido()];
    montar();
    expect(await screen.findByText("Pausar a campanha Leads Julho")).toBeInTheDocument();
    expect(screen.getByText("campaign")).toBeInTheDocument();
    expect(screen.getByText("Pendente")).toBeInTheDocument();
  });

  it.each([
    ["approved", "Aprovado"],
    ["rejected", "Rejeitado"],
  ])("status %s aparece como %s", async (status, rotulo) => {
    linhas = [pedido({ status })];
    montar();
    expect(await screen.findByText(rotulo)).toBeInTheDocument();
  });

  it("mostra o payload quando ha parametros", async () => {
    linhas = [pedido({ payload: { campaign_id: "cmp_1" } })];
    montar();
    expect(await screen.findByText(/"campaign_id": "cmp_1"/)).toBeInTheDocument();
  });

  it("payload vazio nao gera bloco vazio", async () => {
    linhas = [pedido({ payload: {} })];
    montar();
    await screen.findByText("Pausar a campanha Leads Julho");
    expect(document.querySelector("pre")).toBeNull();
  });

  it("aprovado sem execucao diz que AGUARDA execucao", async () => {
    linhas = [pedido({ status: "approved" })];
    montar();
    expect(await screen.findByText("Aprovado — aguardando execução.")).toBeInTheDocument();
  });

  it("aprovado e executado informa quando", async () => {
    linhas = [pedido({ status: "approved", executed_at: "2026-08-13T14:00:00Z" })];
    montar();
    expect(await screen.findByText(/Executado em/)).toBeInTheDocument();
  });

  it("falha da execucao aparece e SUBSTITUI o 'aguardando'", async () => {
    linhas = [
      pedido({
        status: "approved",
        ultima_falha: { motivo_para_o_gestor: "A Meta recusou o orçamento" },
      }),
    ];
    montar();
    expect(await screen.findByText("A última tentativa de execução falhou")).toBeInTheDocument();
    expect(screen.queryByText(/aguardando execução/)).not.toBeInTheDocument();
  });
});

describe("gate de admin", () => {
  it("admin ve os botoes em pedido PENDENTE", async () => {
    linhas = [pedido()];
    montar();
    expect(await screen.findByRole("button", { name: /Aprovar/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Rejeitar/ })).toBeInTheDocument();
  });

  it("nao-admin NAO ve botao nenhum", async () => {
    ctx = { ...ctx, isAdmin: false };
    linhas = [pedido()];
    montar();
    await screen.findByText("Pausar a campanha Leads Julho");
    expect(screen.queryByRole("button", { name: /Aprovar/ })).not.toBeInTheDocument();
  });

  it("pedido do HISTORICO nao e revisavel, nem para admin", async () => {
    // Redecidir algo ja decidido reescreveria a assinatura de quem decidiu antes.
    linhas = [pedido({ status: "approved" })];
    montar();
    await screen.findByText("Aprovado");
    expect(screen.queryByRole("button", { name: /Aprovar/ })).not.toBeInTheDocument();
  });
});

describe("decidir", () => {
  it("aprovar grava status, revisor e data", async () => {
    linhas = [pedido({ id: "p9" })];
    montar();
    await userEvent.click(await screen.findByRole("button", { name: /Aprovar/ }));
    await waitFor(() => expect(updateMock).toHaveBeenCalled());
    const [patch, col, val] = updateMock.mock.calls[0];
    expect(patch).toMatchObject({ status: "approved", reviewed_by: "u1" });
    // reviewed_at tem de ser gravado: sem ele nao se sabe QUANDO foi decidido.
    expect((patch as { reviewed_at: string }).reviewed_at).toBeTruthy();
    expect([col, val]).toEqual(["id", "p9"]);
  });

  it("rejeitar grava status rejected", async () => {
    linhas = [pedido()];
    montar();
    await userEvent.click(await screen.findByRole("button", { name: /Rejeitar/ }));
    await waitFor(() => expect(updateMock.mock.calls[0][0]).toMatchObject({ status: "rejected" }));
  });

  it("REGISTRA em auditoria com a acao correspondente", async () => {
    linhas = [pedido({ id: "p9" })];
    montar();
    await userEvent.click(await screen.findByRole("button", { name: /Aprovar/ }));
    await waitFor(() =>
      expect(logAuditMock).toHaveBeenCalledWith({
        companyId: "c1",
        action: "approval.approved",
        targetType: "approval",
        targetId: "p9",
      }),
    );
  });

  it("auditoria de rejeicao usa approval.rejected", async () => {
    linhas = [pedido()];
    montar();
    await userEvent.click(await screen.findByRole("button", { name: /Rejeitar/ }));
    await waitFor(() =>
      expect(logAuditMock.mock.calls[0][0]).toMatchObject({ action: "approval.rejected" }),
    );
  });

  it("confirma ao usuario o que foi feito", async () => {
    linhas = [pedido()];
    montar();
    await userEvent.click(await screen.findByRole("button", { name: /Aprovar/ }));
    await waitFor(() => expect(toastSuccessMock).toHaveBeenCalledWith("Aprovado"));
  });

  it("erro no UPDATE avisa e NAO audita (auditar o que nao aconteceu e pior)", async () => {
    erroDoUpdate = { message: "permission denied for table approval_requests" };
    linhas = [pedido()];
    montar();
    await userEvent.click(await screen.findByRole("button", { name: /Aprovar/ }));
    await waitFor(() =>
      expect(toastErrorMock).toHaveBeenCalledWith("permission denied for table approval_requests"),
    );
    expect(logAuditMock).not.toHaveBeenCalled();
    expect(toastSuccessMock).not.toHaveBeenCalled();
  });
});

describe("cabeçalho", () => {
  it("declara que TODA alteracao passa por aqui antes de ser aplicada", async () => {
    montar();
    expect(await screen.findByText(/passa por aqui antes de ser aplicada/)).toBeInTheDocument();
  });

  it("título da página", () => {
    const head = (Route.options as unknown as { head: () => { meta: { title: string }[] } }).head();
    expect(head.meta[0].title).toBe("Aprovações pendentes");
  });
});
