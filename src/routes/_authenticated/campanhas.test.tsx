import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { withFilterDefaults } from "@/lib/filters";

let empresa: { id: string; name: string } | null = { id: "c1", name: "JCR2" };
let falhou = false;

vi.mock("@tanstack/react-router", () => ({
  createFileRoute: () => (opts: Record<string, unknown>) => ({ options: opts }),
}));

vi.mock("@/lib/app-context", () => ({
  useApp: () => ({ selectedCompany: empresa, isAdmin: true, user: { id: "u1" } }),
  logAudit: vi.fn(),
}));

vi.mock("@/hooks/use-filters", () => ({
  useGlobalFilters: () => ({ filters: withFilterDefaults({}) }),
  useSnapshotMinDate: () => ({ data: "2026-03-03" }),
}));

vi.mock("@/hooks/use-period", () => ({
  usePeriodCampaigns: () => ({
    data: [],
    isLoading: false,
    isError: falhou,
    error: falhou ? new Error("consulta falhou") : null,
    refetch: () => {},
  }),
}));

vi.mock("@/components/metric-card", () => ({
  EmptyCompany: () => <div data-testid="empty-company" />,
}));

vi.mock("@/components/global-filters", () => ({
  GlobalFilters: () => <div data-testid="filtros" />,
}));

import { Route } from "./campanhas";

const Campanhas = (Route.options as unknown as { component: () => ReactNode }).component;

beforeEach(() => {
  empresa = { id: "c1", name: "JCR2" };
  falhou = false;
});

describe("falha de consulta nao e tabela vazia", () => {
  it("FALHA se identifica como falha", () => {
    falhou = true;
    render(<Campanhas />);
    expect(
      screen.getByText(/não foi possível carregar as campanhas desta empresa/i),
    ).toBeInTheDocument();
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
  });
});
