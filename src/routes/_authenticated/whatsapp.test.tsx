import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import type { ReactNode } from "react";

// Tela fina: o valor esta em nao montar os paineis sem empresa (as duas
// consultariam com companyId undefined) e em passar a empresa CERTA para os dois.

let empresa: { id: string; name: string; industry: string | null } | null = {
  id: "c1",
  name: "JCR2",
  industry: null,
};

vi.mock("@tanstack/react-router", () => ({
  createFileRoute: () => (opts: Record<string, unknown>) => ({ options: opts }),
}));

vi.mock("@/lib/app-context", () => ({ useApp: () => ({ selectedCompany: empresa }) }));

vi.mock("@/components/metric-card", () => ({
  EmptyCompany: () => <div data-testid="empty-company" />,
}));
vi.mock("@/components/whatsapp-panel", () => ({
  WhatsAppPanel: ({ companyId }: { companyId: string }) => (
    <div data-testid="waba" data-company={companyId} />
  ),
}));
vi.mock("@/components/infobip-panel", () => ({
  InfobipPanel: ({ companyId }: { companyId: string }) => (
    <div data-testid="infobip" data-company={companyId} />
  ),
}));

import { Route } from "./whatsapp";

const Pagina = (Route.options as unknown as { component: () => ReactNode }).component;

beforeEach(() => {
  empresa = { id: "c1", name: "JCR2", industry: null };
});

describe("sem empresa", () => {
  it("mostra o vazio e NAO monta nenhum painel", () => {
    // Montar com empresa undefined faria as duas consultas irem ao banco com
    // filtro vazio.
    empresa = null;
    render(<Pagina />);
    expect(screen.getByTestId("empty-company")).toBeInTheDocument();
    expect(screen.queryByTestId("waba")).not.toBeInTheDocument();
    expect(screen.queryByTestId("infobip")).not.toBeInTheDocument();
  });
});

describe("com empresa", () => {
  it("monta os dois paineis com a MESMA empresa", () => {
    render(<Pagina />);
    expect(screen.getByTestId("waba").dataset.company).toBe("c1");
    expect(screen.getByTestId("infobip").dataset.company).toBe("c1");
  });

  it("nomeia a empresa no subtitulo", () => {
    render(<Pagina />);
    expect(screen.getByText(/desempenho dos templates de JCR2/)).toBeInTheDocument();
  });

  it("declara que a tela e somente leitura e de onde vem o dado", () => {
    // Expectativa: a tela nao age no WhatsApp, so mostra o resultado do sync.
    render(<Pagina />);
    expect(screen.getByText(/Somente leitura/)).toBeInTheDocument();
    expect(screen.getByText(/sync diário da API oficial/)).toBeInTheDocument();
  });

  it("tem titulo de nivel 1", () => {
    render(<Pagina />);
    expect(screen.getByRole("heading", { level: 1, name: /WhatsApp/ })).toBeInTheDocument();
  });
});

describe("título da página", () => {
  it("declara WhatsApp", () => {
    const head = (Route.options as unknown as { head: () => { meta: { title: string }[] } }).head();
    expect(head.meta[0].title).toBe("WhatsApp");
  });
});
