import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const invokeMock = vi.fn();
const refreshCompaniesMock = vi.fn();
const logAuditMock = vi.fn();

const integrations = [
  {
    id: "integration-1",
    provider: "meta_ads",
    account_name: "Meta Ads",
    external_id: null,
    status: "nao_verificada",
    estado_operacional: "quarentena",
    estado_motivo: "Sem handshake",
    connected_at: null,
  },
];

vi.mock("@tanstack/react-router", () => ({
  createFileRoute: () => (options: Record<string, unknown>) => ({ options }),
}));

vi.mock("@/lib/app-context", () => ({
  useApp: () => ({
    isAdmin: true,
    companies: [{ id: "company-1", name: "Empresa Nova", industry: "Serviços" }],
    selectedCompanyId: "company-1",
    selectedCompany: { id: "company-1", name: "Empresa Nova", industry: "Serviços" },
    refreshCompanies: refreshCompaniesMock,
  }),
  logAudit: (...args: unknown[]) => logAuditMock(...args),
}));

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    from: (table: string) => {
      if (table === "integrations") {
        return {
          select: () => ({
            eq: () => Promise.resolve({ data: integrations, error: null }),
          }),
        };
      }
      return {};
    },
    functions: {
      invoke: (...args: unknown[]) => invokeMock(...args),
    },
  },
}));

vi.mock("sonner", () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
    warning: vi.fn(),
  },
}));

import { Route } from "./empresas";

const Empresas = (Route.options as unknown as { component: () => ReactNode }).component;

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <Empresas />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  invokeMock.mockReset();
  refreshCompaniesMock.mockReset();
  logAuditMock.mockReset();
});

describe("vinculação Meta via Pipeboard", () => {
  it("lista contas disponíveis e vincula a escolhida com nome editável", async () => {
    invokeMock
      .mockResolvedValueOnce({
        data: {
          accounts: [
            {
              id: "act_123456",
              external_id: "123456",
              name: "Conta Meta Original",
              status: "ACTIVE",
              currency: "BRL",
              timezone: "America/Sao_Paulo",
              already_linked_company_id: null,
              selected_company: false,
            },
          ],
          pipeboard: { ok: true, token_status: "active" },
          contract_limit: 10,
        },
        error: null,
      })
      .mockResolvedValueOnce({
        data: {
          integration: {
            id: "integration-1",
            external_id: "123456",
            account_name: "Conta do Cliente",
          },
        },
        error: null,
      });

    renderPage();

    await screen.findByText("Sem conta identificada");
    await userEvent.click(screen.getByRole("button", { name: /editar \/ vincular/i }));

    expect(await screen.findByText("Conta Meta Original")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: /conta meta original/i }));

    const nameInput = screen.getByLabelText("Nome exibido no sistema");
    await userEvent.clear(nameInput);
    await userEvent.type(nameInput, "Conta do Cliente");
    await userEvent.click(screen.getByRole("button", { name: "Vincular conta" }));

    await waitFor(() =>
      expect(invokeMock).toHaveBeenLastCalledWith("integration-verify", {
        body: {
          action: "link",
          company_id: "company-1",
          integration_id: "integration-1",
          account_id: "act_123456",
          account_name: "Conta do Cliente",
        },
      }),
    );
  }, 10_000);
});
