import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import type { ReactNode } from "react";

// A landing publica. A propriedade que importa aqui e a mesma da guarda de rota,
// pelo motivo oposto: quem JA esta logado nao deve ver a pagina de venda, e a
// decisao depende de uma checagem assincrona - antes dela, nao se decide nada.

const getSessionMock = vi.fn();

vi.mock("@tanstack/react-router", () => ({
  createFileRoute: () => (opts: Record<string, unknown>) => ({ options: opts }),
  Link: ({ children, to }: { children: ReactNode; to: string }) => <a href={to}>{children}</a>,
  Navigate: ({ to, replace }: { to: string; replace?: boolean }) => (
    <div data-testid="navigate" data-to={to} data-replace={String(!!replace)} />
  ),
}));

vi.mock("@/integrations/supabase/client", () => ({
  supabase: { auth: { getSession: () => getSessionMock() } },
}));

import { Route } from "./index";

const Landing = (Route.options as unknown as { component: () => ReactNode }).component;

beforeEach(() => {
  getSessionMock.mockReset().mockResolvedValue({ data: { session: null } });
});

describe("antes de checar a sessão", () => {
  it("nao mostra a landing nem redireciona", async () => {
    // Mostrar a pagina de venda e depois sumir com ela seria um flash feio para
    // quem esta logado; redirecionar antes de checar mandaria visitante para o
    // dashboard.
    getSessionMock.mockReturnValue(new Promise(() => {}));
    const { container } = render(<Landing />);
    await new Promise((r) => setTimeout(r, 30));
    expect(screen.queryByTestId("navigate")).not.toBeInTheDocument();
    expect(screen.queryByText(/Gestor de Tráfego IA/)).not.toBeInTheDocument();
    expect(container.querySelector(".min-h-screen")).toBeTruthy();
  });
});

describe("visitante sem sessão", () => {
  it("mostra a landing", async () => {
    render(<Landing />);
    expect(await screen.findByText(/Toda sua mídia paga sob/)).toBeInTheDocument();
    expect(screen.queryByTestId("navigate")).not.toBeInTheDocument();
  });

  it("oferece dois caminhos para entrar, os dois para /auth", async () => {
    render(<Landing />);
    await screen.findByText("Entrar");
    expect(screen.getByText("Entrar").closest("a")).toHaveAttribute("href", "/auth");
    expect(screen.getByText("Começar agora").closest("a")).toHaveAttribute("href", "/auth");
  });

  it("declara a postura de seguranca do produto na dobra", async () => {
    // "Somente leitura por padrao" e promessa de produto, e o sistema a cumpre
    // (a fila de aprovacao). Se o texto sair, a promessa deixa de ser feita.
    render(<Landing />);
    expect(
      await screen.findByText(/Somente leitura por padrão · alterações via aprovação/),
    ).toBeInTheDocument();
  });

  it("lista os 4 pilares do produto", async () => {
    render(<Landing />);
    await screen.findByText("Dashboard executivo");
    for (const t of ["Dashboard executivo", "Multi-plataforma", "Fila de aprovação", "IA guiada"]) {
      expect(screen.getByText(t)).toBeInTheDocument();
    }
  });
});

describe("visitante COM sessão", () => {
  it("vai direto para o dashboard, substituindo o histórico", async () => {
    getSessionMock.mockResolvedValue({ data: { session: { user: { id: "u1" } } } });
    render(<Landing />);
    const nav = await screen.findByTestId("navigate");
    expect(nav.dataset.to).toBe("/dashboard");
    // Sem replace, o botao voltar traria a landing de novo e ela redirecionaria
    // em loop visual.
    expect(nav.dataset.replace).toBe("true");
  });

  it("nao renderiza a landing junto com o redirect", async () => {
    getSessionMock.mockResolvedValue({ data: { session: { user: { id: "u1" } } } });
    render(<Landing />);
    await screen.findByTestId("navigate");
    expect(screen.queryByText(/Toda sua mídia paga sob/)).not.toBeInTheDocument();
  });
});
