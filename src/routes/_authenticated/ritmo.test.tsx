import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import type { ReactNode } from "react";

let ctx = {
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

vi.mock("@/lib/app-context", () => ({
  useApp: () => ctx,
}));

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    from: vi.fn(),
    rpc: vi.fn(),
  },
}));

vi.mock("@/components/metric-card", () => ({
  EmptyCompany: () => <div data-testid="empty-company" />,
}));

import { Route } from "./ritmo";

const Ritmo = (Route.options as unknown as { component: () => ReactNode }).component;

beforeEach(() => {
  ctx = {
    selectedCompany: { id: "c1", name: "JCR2", industry: null },
    selectedCompanyId: "c1",
  };
});

describe("Ritmo", () => {
  it("pede empresa quando nenhuma está selecionada", () => {
    ctx.selectedCompany = null;
    ctx.selectedCompanyId = null;
    render(<Ritmo />);
    expect(screen.getByTestId("empty-company")).toBeInTheDocument();
  });

  it("mostra o título quando há empresa selecionada", () => {
    render(<Ritmo />);
    expect(screen.getByRole("heading", { name: "Ritmo" })).toBeInTheDocument();
    expect(
      screen.getByText("Força-tarefa da campanha, com uma autorização."),
    ).toBeInTheDocument();
  });
});
