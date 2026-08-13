import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";

// Tela de metas e tetos. Duas coisas valem teste: o gate de admin (editar meta
// recalibra os alertas de todo mundo) e o tratamento de erro de PERMISSAO no
// botao de reavaliar, que ESCONDE o botao em vez de repetir toast a cada clique.

const rpcMock = vi.fn();
const toastErrorMock = vi.fn();
const toastSuccessMock = vi.fn();
let ctx = {
  isAdmin: true,
  selectedCompany: { id: "c1", name: "JCR2", industry: null } as {
    id: string;
    name: string;
    industry: string | null;
  } | null,
  selectedCompanyId: "c1" as string | null,
};

vi.mock("@tanstack/react-router", () => ({
  createFileRoute: () => (opts: Record<string, unknown>) => ({ options: opts }),
}));

vi.mock("@/lib/app-context", () => ({ useApp: () => ctx }));

vi.mock("@/integrations/supabase/client", () => ({
  supabase: { rpc: (...a: unknown[]) => rpcMock(...a) },
}));

vi.mock("sonner", () => ({
  toast: {
    error: (...a: unknown[]) => toastErrorMock(...a),
    success: (...a: unknown[]) => toastSuccessMock(...a),
  },
}));

vi.mock("@/components/metric-card", () => ({
  EmptyCompany: () => <div data-testid="empty-company" />,
}));

vi.mock("@/components/targets-table", () => ({
  TargetsTable: ({ companyId }: { companyId: string }) => (
    <div data-testid="targets" data-company={companyId} />
  ),
}));

import { Route } from "./metas";

const Metas = (Route.options as unknown as { component: () => ReactNode }).component;

beforeEach(() => {
  rpcMock.mockReset().mockResolvedValue({ data: 3, error: null });
  toastErrorMock.mockReset();
  toastSuccessMock.mockReset();
  ctx = {
    isAdmin: true,
    selectedCompany: { id: "c1", name: "JCR2", industry: null },
    selectedCompanyId: "c1",
  };
});

describe("sem empresa selecionada", () => {
  it("mostra o vazio e nao monta a tabela", () => {
    ctx = { isAdmin: true, selectedCompany: null, selectedCompanyId: null };
    render(<Metas />);
    expect(screen.getByTestId("empty-company")).toBeInTheDocument();
    expect(screen.queryByTestId("targets")).not.toBeInTheDocument();
  });

  it("nao oferece o botao de reavaliar (nao ha o que reavaliar)", () => {
    ctx = { isAdmin: true, selectedCompany: null, selectedCompanyId: null };
    render(<Metas />);
    expect(screen.queryByRole("button", { name: /Reavaliar/ })).not.toBeInTheDocument();
  });
});

describe("com empresa", () => {
  it("monta a tabela com a empresa e mostra o nome dela", () => {
    render(<Metas />);
    expect(screen.getByTestId("targets").dataset.company).toBe("c1");
    expect(screen.getByText("JCR2")).toBeInTheDocument();
  });

  it("explica que a mudanca vale na proxima avaliacao, nao na hora", () => {
    // Expectativa importante: editar a meta nao dispara alerta imediato. Sem o
    // aviso, o gestor edita e acha que o sistema ignorou.
    render(<Metas />);
    expect(screen.getByText(/cron diário, 06:15/)).toBeInTheDocument();
  });
});

describe("gate de admin", () => {
  it("admin ve o botao de reavaliar", () => {
    render(<Metas />);
    expect(screen.getByRole("button", { name: /Reavaliar/ })).toBeInTheDocument();
  });

  it("nao-admin NAO ve o botao e recebe o aviso de somente leitura", () => {
    ctx = { ...ctx, isAdmin: false };
    render(<Metas />);
    expect(screen.queryByRole("button", { name: /Reavaliar/ })).not.toBeInTheDocument();
    expect(screen.getByText(/Somente administradores podem editar metas/)).toBeInTheDocument();
  });

  it("admin nao recebe o aviso de somente leitura", () => {
    render(<Metas />);
    expect(screen.queryByText(/Somente administradores podem editar/)).not.toBeInTheDocument();
  });
});

describe("reavaliar alertas", () => {
  it("chama a RPC e informa quantos alertas ficaram ativos", async () => {
    rpcMock.mockResolvedValue({ data: 7, error: null });
    render(<Metas />);
    await userEvent.click(screen.getByRole("button", { name: /Reavaliar/ }));
    await waitFor(() => expect(rpcMock).toHaveBeenCalledWith("evaluate_alerts"));
    expect(toastSuccessMock).toHaveBeenCalledWith("7 alertas ativos");
  });

  it("RPC devolvendo null informa zero, nao 'null alertas'", async () => {
    rpcMock.mockResolvedValue({ data: null, error: null });
    render(<Metas />);
    await userEvent.click(screen.getByRole("button", { name: /Reavaliar/ }));
    await waitFor(() => expect(toastSuccessMock).toHaveBeenCalledWith("0 alertas ativos"));
  });

  it("desabilita o botao enquanto roda", async () => {
    let liberar: (v: { data: number; error: null }) => void = () => {};
    rpcMock.mockReturnValue(new Promise((r) => (liberar = r)));
    render(<Metas />);
    const btn = screen.getByRole("button", { name: /Reavaliar/ });
    await userEvent.click(btn);
    await waitFor(() => expect(btn).toBeDisabled());
    liberar({ data: 1, error: null });
    await waitFor(() => expect(btn).toBeEnabled());
  });

  it("erro comum mostra toast e MANTEM o botao (pode ser instabilidade)", async () => {
    rpcMock.mockResolvedValue({ data: null, error: { message: "timeout" } });
    render(<Metas />);
    await userEvent.click(screen.getByRole("button", { name: /Reavaliar/ }));
    await waitFor(() =>
      expect(toastErrorMock).toHaveBeenCalledWith("Não foi possível reavaliar os alertas agora."),
    );
    expect(screen.getByRole("button", { name: /Reavaliar/ })).toBeInTheDocument();
  });

  it.each([
    ["codigo 42501", { code: "42501", message: "algo" }],
    ["mensagem permission denied", { message: "permission denied for function" }],
    ["mensagem not allowed", { message: "Not allowed" }],
  ])("erro de permissao (%s) ESCONDE o botao e nao mostra toast", async (_caso, error) => {
    // Diferenca deliberada: falta de permissao nao muda batendo de novo. Repetir
    // o toast a cada clique seria ruido; esconder o botao diz a verdade uma vez.
    rpcMock.mockResolvedValue({ data: null, error });
    render(<Metas />);
    await userEvent.click(screen.getByRole("button", { name: /Reavaliar/ }));
    await waitFor(() =>
      expect(screen.queryByRole("button", { name: /Reavaliar/ })).not.toBeInTheDocument(),
    );
    expect(toastErrorMock).not.toHaveBeenCalled();
  });

  it("erro de permissao nao derruba o resto da tela", async () => {
    rpcMock.mockResolvedValue({ data: null, error: { code: "42501", message: "x" } });
    render(<Metas />);
    await userEvent.click(screen.getByRole("button", { name: /Reavaliar/ }));
    await waitFor(() =>
      expect(screen.queryByRole("button", { name: /Reavaliar/ })).not.toBeInTheDocument(),
    );
    expect(screen.getByTestId("targets")).toBeInTheDocument();
  });
});

describe("título da página", () => {
  it("declara Metas & Tetos", () => {
    const head = (Route.options as unknown as { head: () => { meta: { title: string }[] } }).head();
    expect(head.meta[0].title).toBe("Metas & Tetos");
  });
});
