import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";

// Lista vazia ≠ falha de carga; análise que falhou tem de aparecer, não sumir.

let ctx = {
  selectedCompany: { id: "c1", name: "JCR2", industry: null } as {
    id: string;
    name: string;
    industry: string | null;
  } | null,
  selectedCompanyId: "c1" as string | null,
  isAdmin: true,
};

let linhas: Record<string, unknown>[] = [];
let erroLista: unknown = null;
const fromMock = vi.fn();
const rpcMock = vi.fn();
const invokeMock = vi.fn();
const toastErrorMock = vi.fn();
const toastSuccessMock = vi.fn();
const channelMock = {
  on: vi.fn().mockReturnThis(),
  subscribe: vi.fn().mockReturnThis(),
};

vi.mock("@tanstack/react-router", () => ({
  createFileRoute: () => (opts: Record<string, unknown>) => ({ options: opts }),
}));

vi.mock("@/lib/app-context", () => ({
  useApp: () => ctx,
}));

vi.mock("sonner", () => ({
  toast: {
    error: (...a: unknown[]) => toastErrorMock(...a),
    success: (...a: unknown[]) => toastSuccessMock(...a),
  },
}));

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    from: (...a: unknown[]) => fromMock(...a),
    rpc: (...a: unknown[]) => rpcMock(...a),
    functions: { invoke: (...a: unknown[]) => invokeMock(...a) },
    channel: () => channelMock,
    removeChannel: vi.fn(),
  },
}));

vi.mock("@/components/metric-card", () => ({
  EmptyCompany: () => <div data-testid="empty-company" />,
}));

import { Route } from "./ritmo";

const Ritmo = (Route.options as unknown as { component: () => ReactNode }).component;

function encadear(data: unknown, error: unknown = null) {
  const result = Promise.resolve({ data, error });
  const q: {
    select: () => unknown;
    eq: () => unknown;
    order: () => unknown;
    then: typeof result.then;
  } = {
    select: () => q,
    eq: () => q,
    order: () => q,
    then: result.then.bind(result),
  };
  return q;
}

function montar() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<Ritmo />, {
    wrapper: ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={qc}>{children}</QueryClientProvider>
    ),
  });
}

function missaoFalhou(): Record<string, unknown> {
  return {
    id: "m1",
    company_id: "c1",
    campaign_id: "120",
    campaign_name: "Consignado SP",
    ad_account_id: null,
    status: "analise_falhou",
    periodo_inicio: "2026-09-10",
    periodo_fim: "2026-09-20",
    metrica: "conversas",
    dissertacao: "subir conversas",
    sonho: null,
    extra_investimento: 0,
    teto_gasto_janela: null,
    erro_analise: "timeout",
    criado_em: "2026-09-10T11:00:00Z",
  };
}

beforeEach(() => {
  ctx = {
    selectedCompany: { id: "c1", name: "JCR2", industry: null },
    selectedCompanyId: "c1",
    isAdmin: true,
  };
  linhas = [];
  erroLista = null;
  toastErrorMock.mockReset();
  toastSuccessMock.mockReset();
  channelMock.on.mockClear();
  channelMock.subscribe.mockClear();
  fromMock.mockImplementation((tabela: string) => {
    if (tabela === "ritmo_missoes") return encadear(linhas, erroLista);
    return encadear([]);
  });
  rpcMock.mockResolvedValue({ data: [], error: null });
  invokeMock.mockResolvedValue({ data: { ok: false }, error: null });
});

describe("Ritmo", () => {
  it("pede empresa quando nenhuma está selecionada", () => {
    ctx.selectedCompany = null;
    ctx.selectedCompanyId = null;
    montar();
    expect(screen.getByTestId("empty-company")).toBeInTheDocument();
  });

  it("mostra o título quando há empresa selecionada", async () => {
    montar();
    expect(screen.getByRole("heading", { name: "Ritmo" })).toBeInTheDocument();
    expect(
      screen.getByText("Força-tarefa da campanha, com uma autorização."),
    ).toBeInTheDocument();
    expect(await screen.findByText("Nenhuma força-tarefa nesta empresa")).toBeInTheDocument();
  });

  it("lista vazia mostra o convite e o botão de nova força-tarefa", async () => {
    montar();
    expect(await screen.findByText("Nenhuma força-tarefa nesta empresa")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Nova força-tarefa" })).toBeInTheDocument();
  });

  it("mostra o erro da análise falha em vez de silêncio", async () => {
    linhas = [missaoFalhou()];
    montar();
    expect(await screen.findByText("timeout")).toBeInTheDocument();
    expect(screen.getByText("Análise falhou")).toBeInTheDocument();
    expect(screen.queryByText("Nenhuma força-tarefa nesta empresa")).not.toBeInTheDocument();
  });

  it("falha de carga das missões não finge lista vazia", async () => {
    erroLista = { message: "consulta recusada" };
    montar();
    expect(
      await screen.findByText(/não foi possível carregar as forças-tarefa/i),
    ).toBeInTheDocument();
    expect(screen.queryByText("Nenhuma força-tarefa nesta empresa")).not.toBeInTheDocument();
  });

  it("visualizador não vê o botão de nova força-tarefa", async () => {
    ctx.isAdmin = false;
    montar();
    expect(await screen.findByText("Nenhuma força-tarefa nesta empresa")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Nova força-tarefa" })).not.toBeInTheDocument();
  });

  it("submit sem campanha avisa em português", async () => {
    montar();
    await userEvent.click(await screen.findByRole("button", { name: "Nova força-tarefa" }));
    await userEvent.click(screen.getByRole("button", { name: "Criar força-tarefa" }));
    expect(toastErrorMock).toHaveBeenCalledWith("Escolha uma campanha ativa.");
  });
});
