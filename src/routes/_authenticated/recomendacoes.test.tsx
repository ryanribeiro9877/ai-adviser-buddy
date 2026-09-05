import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";

const fail = { data: null, error: { message: "permission denied for table ai_recommendations" } };

vi.mock("@tanstack/react-router", () => ({
  createFileRoute: () => (opts: Record<string, unknown>) => ({ options: opts }),
  useNavigate: () => vi.fn(),
  useSearch: () => ({ tab: "recomendacoes" }),
}));

vi.mock("@/lib/app-context", () => ({
  useApp: () => ({ selectedCompany: { id: "c1", name: "JCR2" } }),
  logAudit: vi.fn(),
}));

vi.mock("@/integrations/supabase/client", () => {
  const chain: Record<string, unknown> = {};
  chain.select = () => chain;
  chain.eq = () => chain;
  chain.order = () => Promise.resolve(fail);
  return { supabase: { from: () => chain } };
});

vi.mock("@/components/metric-card", () => ({
  EmptyCompany: () => <div data-testid="empty-company" />,
}));

vi.mock("@/components/operacao-chat", () => ({
  OperacaoChat: () => <div data-testid="chat" />,
}));

vi.mock("@/components/approvals-queue", () => ({
  ApprovalsQueue: () => <div data-testid="aprovacoes" />,
}));

import { Route } from "./recomendacoes";

const Operacao = (Route.options as unknown as { component: () => ReactNode }).component;

function montar() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <Operacao />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  // nada a resetar: o mock ja e so falha
});

describe("falha de consulta nao e 'nenhuma recomendacao'", () => {
  it("FALHA se identifica como falha", async () => {
    montar();
    expect(
      await screen.findByText(/não foi possível carregar as recomendações desta empresa/i),
    ).toBeInTheDocument();
    expect(screen.queryByText(/nenhuma recomendação neste filtro/i)).not.toBeInTheDocument();
  });
});
