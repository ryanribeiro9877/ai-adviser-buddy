import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { withFilterDefaults } from "@/lib/filters";

let empresa: { id: string; name: string } | null = { id: "c1", name: "JCR2" };
let falhou = false;

vi.mock("@tanstack/react-router", () => ({
  createFileRoute: () => (opts: Record<string, unknown>) => ({ options: opts }),
}));

vi.mock("@/lib/app-context", () => ({ useApp: () => ({ selectedCompany: empresa }) }));

vi.mock("@/hooks/use-filters", () => ({
  useGlobalFilters: () => ({ filters: withFilterDefaults({}) }),
}));

vi.mock("@/hooks/use-breakdown", () => ({
  useAdSets: () => ({
    data: [],
    isLoading: false,
    isError: falhou,
    error: falhou ? new Error("consulta falhou") : null,
    refetch: () => {},
  }),
  useCampaignBreakdown: () => ({ data: [], isLoading: false }),
}));

vi.mock("@/components/metric-card", () => ({
  EmptyCompany: () => <div data-testid="empty-company" />,
}));

vi.mock("@/components/global-filters", () => ({
  GlobalFilters: () => <div data-testid="filtros" />,
}));

import { Route } from "./conjuntos";

const Conjuntos = (Route.options as unknown as { component: () => ReactNode }).component;

beforeEach(() => {
  empresa = { id: "c1", name: "JCR2" };
  falhou = false;
});

describe("falha de consulta nao e lista vazia", () => {
  it("FALHA se identifica como falha, nao como 'nenhum conjunto'", () => {
    falhou = true;
    render(<Conjuntos />);
    expect(
      screen.getByText(/não foi possível carregar os conjuntos desta empresa/i),
    ).toBeInTheDocument();
    expect(screen.queryByText(/nenhum conjunto para esta empresa/i)).not.toBeInTheDocument();
  });
});
