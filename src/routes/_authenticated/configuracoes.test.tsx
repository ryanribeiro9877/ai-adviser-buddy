import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import type { ReactNode } from "react";

// Tela de conta e preferencias. O que vale prender e a exibicao do PAPEL (o
// usuario precisa saber por que nao consegue aprovar) e o texto que declara a
// postura de somente-leitura, que e promessa de produto.

let ctx = {
  user: { email: "ryan@cohapm.com.br" } as { email?: string },
  role: "admin" as "admin" | "viewer",
  isAdmin: true,
};

vi.mock("@tanstack/react-router", () => ({
  createFileRoute: () => (opts: Record<string, unknown>) => ({ options: opts }),
  Link: ({ children, to }: { children: ReactNode; to: string }) => <a href={to}>{children}</a>,
}));

vi.mock("@/lib/app-context", () => ({ useApp: () => ctx }));

import { Route } from "./configuracoes";

const Pagina = (Route.options as unknown as { component: () => ReactNode }).component;

beforeEach(() => {
  ctx = { user: { email: "ryan@cohapm.com.br" }, role: "admin", isAdmin: true };
});

describe("perfil", () => {
  it("mostra o email da sessao", () => {
    render(<Pagina />);
    expect(screen.getByText("ryan@cohapm.com.br")).toBeInTheDocument();
  });

  it("admin aparece como Administrador", () => {
    render(<Pagina />);
    expect(screen.getByText("Administrador")).toBeInTheDocument();
  });

  it("viewer aparece como Visualizador", () => {
    // Nao e cosmetico: e como o usuario descobre por que os botoes de aprovar
    // estao desabilitados em outras telas.
    ctx = { ...ctx, role: "viewer", isAdmin: false };
    render(<Pagina />);
    expect(screen.getByText("Visualizador")).toBeInTheDocument();
    expect(screen.queryByText("Administrador")).not.toBeInTheDocument();
  });
});

describe("segurança", () => {
  it("declara o modo somente leitura", () => {
    render(<Pagina />);
    expect(screen.getByText("Modo somente leitura ativo")).toBeInTheDocument();
  });

  it("aponta para a fila de aprovacoes, que e onde a mudanca acontece", () => {
    render(<Pagina />);
    expect(screen.getByText("Aprovações pendentes").closest("a")).toHaveAttribute(
      "href",
      "/aprovacoes",
    );
  });

  it("enumera o que NAO muda sem aprovacao", () => {
    render(<Pagina />);
    expect(
      screen.getByText(/Nenhuma campanha, orçamento, anúncio, público ou configuração/),
    ).toBeInTheDocument();
  });
});

describe("integrações", () => {
  it("manda conectar contas em Empresas, e diz o que e suportado hoje", () => {
    render(<Pagina />);
    expect(screen.getByText("Empresas e contas").closest("a")).toHaveAttribute("href", "/empresas");
    expect(screen.getByText(/Suportado: Meta Ads/)).toBeInTheDocument();
  });
});

describe("notificações", () => {
  it("lista as tres preferencias", () => {
    render(<Pagina />);
    for (const t of [
      "Receber alertas por email",
      "Notificar novas recomendações da IA",
      "Avisar sobre solicitações pendentes de aprovação",
    ]) {
      expect(screen.getByText(t)).toBeInTheDocument();
    }
  });

  it("nao-admin nao consegue mexer nos switches", () => {
    ctx = { ...ctx, role: "viewer", isAdmin: false };
    render(<Pagina />);
    for (const s of screen.getAllByRole("switch")) expect(s).toBeDisabled();
  });

  it("DOCUMENTA: os switches sao DECORATIVOS — nada e salvo", () => {
    // ACHADO, registrado aqui para nao se perder: os tres Switch tem
    // `defaultChecked` e nenhum onCheckedChange; nao ha estado, nao ha chamada ao
    // banco, e nao existe tabela de preferencia de notificacao no schema
    // (conferido por grep em src/ e supabase/migrations/).
    //
    // Consequencia: a tela mostra "Receber alertas por email" LIGADO e, para
    // admin, deixa alternar - o usuario acredita ter configurado algo que nao
    // existe. Nao e travamento; e a tela afirmando o que o sistema nao faz.
    //
    // Este teste falha no dia em que alguem implementar a persistencia, e e
    // isso que se quer: a mudanca fica consciente. Implementar seria feature
    // nova (tabela + persistencia + envio de email), nao conserto de teste.
    render(<Pagina />);
    const switches = screen.getAllByRole("switch");
    expect(switches).toHaveLength(3);
    // Todos nascem ligados, sempre, independentemente de qualquer preferencia.
    for (const s of switches) expect(s).toBeChecked();
  });

  it("DOCUMENTA: admin consegue alternar, mas o estado nao sai do DOM", () => {
    render(<Pagina />);
    const primeiro = screen.getAllByRole("switch")[0];
    expect(primeiro).toBeEnabled();
    // Remontar volta ao padrao ligado: nao houve persistencia nenhuma.
    const { unmount } = render(<Pagina />);
    unmount();
    expect(screen.getAllByRole("switch")[0]).toBeChecked();
  });
});

describe("título da página", () => {
  it("declara Configurações e integrações", () => {
    const head = (Route.options as unknown as { head: () => { meta: { title: string }[] } }).head();
    expect(head.meta[0].title).toBe("Configurações e integrações");
  });
});
