import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";

// A tela de auditoria e o registro de quem fez o que. O que importa provar e que
// ela nao MENTE por omissao: filtra pela empresa certa, mostra o vazio como
// vazio (e nao como "carregando" eterno), e nao esconde evento cujo autor nao
// consta em profiles.

let empresa: { id: string; name: string; industry: string | null } | null = {
  id: "c1",
  name: "JCR2",
  industry: null,
};
let resposta: { data: unknown } = { data: [] };
const eqMock = vi.fn();
const orderMock = vi.fn();
const limitMock = vi.fn();
const selectMock = vi.fn();

vi.mock("@tanstack/react-router", () => ({
  createFileRoute: () => (opts: Record<string, unknown>) => ({ options: opts }),
}));

vi.mock("@/lib/app-context", () => ({ useApp: () => ({ selectedCompany: empresa }) }));

vi.mock("@/components/metric-card", () => ({
  EmptyCompany: () => <div data-testid="empty-company" />,
}));

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    from: () => ({
      select: (cols: string) => {
        selectMock(cols);
        return {
          eq: (c: string, v: unknown) => {
            eqMock(c, v);
            return {
              order: (c2: string, o: unknown) => {
                orderMock(c2, o);
                return {
                  limit: (n: number) => {
                    limitMock(n);
                    return Promise.resolve(resposta);
                  },
                };
              },
            };
          },
        };
      },
    }),
  },
}));

import { Route } from "./auditoria";

const Pagina = (Route.options as unknown as { component: () => ReactNode }).component;

function linha(over: Record<string, unknown> = {}) {
  return {
    id: "e1",
    created_at: "2026-08-13T15:30:00Z",
    action: "aprovar_pedido",
    target_type: "approval",
    target_id: "p1",
    details: { de: 100, para: 200 },
    profiles: { email: "ryan@cohapm.com.br", full_name: "Ryan" },
    ...over,
  };
}

function montar() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const Wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={qc}>{children}</QueryClientProvider>
  );
  return render(<Pagina />, { wrapper: Wrapper });
}

beforeEach(() => {
  empresa = { id: "c1", name: "JCR2", industry: null };
  resposta = { data: [] };
  eqMock.mockReset();
  orderMock.mockReset();
  limitMock.mockReset();
  selectMock.mockReset();
});

describe("sem empresa", () => {
  it("mostra o vazio e nao consulta", () => {
    empresa = null;
    montar();
    expect(screen.getByTestId("empty-company")).toBeInTheDocument();
    expect(eqMock).not.toHaveBeenCalled();
  });
});

describe("consulta", () => {
  it("filtra pela empresa selecionada", async () => {
    montar();
    await waitFor(() => expect(eqMock).toHaveBeenCalledWith("company_id", "c1"));
  });

  it("mais recente primeiro e teto de 200 linhas", async () => {
    // Auditoria cresce sem limite; sem o teto a tela travaria com o tempo.
    montar();
    await waitFor(() => expect(limitMock).toHaveBeenCalledWith(200));
    expect(orderMock).toHaveBeenCalledWith("created_at", { ascending: false });
  });

  it("junta o perfil do autor na propria consulta", async () => {
    // Sem o join, a coluna Usuario mostraria uuid.
    montar();
    await waitFor(() => expect(selectMock).toHaveBeenCalled());
    expect(selectMock.mock.calls[0][0]).toContain("profiles:user_id");
  });
});

describe("tabela", () => {
  it("mostra o vazio como VAZIO, com mensagem propria", async () => {
    // Tabela sem linha e sem mensagem parece carregamento travado.
    resposta = { data: [] };
    montar();
    expect(await screen.findByText("Nenhum evento registrado.")).toBeInTheDocument();
  });

  it("renderiza acao, alvo e autor", async () => {
    resposta = { data: [linha()] };
    montar();
    expect(await screen.findByText("aprovar_pedido")).toBeInTheDocument();
    expect(screen.getByText("approval")).toBeInTheDocument();
    expect(screen.getByText("ryan@cohapm.com.br")).toBeInTheDocument();
  });

  it("evento SEM autor em profiles ainda aparece, com travessao", async () => {
    // Nao esconder o evento e o ponto: um registro de auditoria cujo autor foi
    // removido continua sendo prova de que algo aconteceu.
    resposta = { data: [linha({ profiles: null })] };
    montar();
    expect(await screen.findByText("aprovar_pedido")).toBeInTheDocument();
    expect(screen.getAllByText("—").length).toBeGreaterThan(0);
  });

  it("alvo ausente vira travessao, nao 'null'", async () => {
    resposta = { data: [linha({ target_type: null, profiles: null })] };
    montar();
    await screen.findByText("aprovar_pedido");
    expect(screen.queryByText("null")).not.toBeInTheDocument();
  });

  it("mostra os detalhes serializados", async () => {
    resposta = { data: [linha()] };
    montar();
    expect(await screen.findByText(/"de":100/)).toBeInTheDocument();
  });

  it("data em formato pt-BR", async () => {
    resposta = { data: [linha()] };
    montar();
    // Fuso fixado em America/Sao_Paulo no setup: 15:30Z = 12:30 local.
    expect(await screen.findByText(/13\/08\/2026/)).toBeInTheDocument();
  });

  it("data null nao derruba a linha", async () => {
    resposta = { data: [linha({ details: null, profiles: null })] };
    montar();
    expect(await screen.findByText("aprovar_pedido")).toBeInTheDocument();
  });

  it("varias linhas aparecem todas", async () => {
    resposta = { data: [linha({ id: "e1" }), linha({ id: "e2", action: "rejeitar_pedido" })] };
    montar();
    expect(await screen.findByText("aprovar_pedido")).toBeInTheDocument();
    expect(screen.getByText("rejeitar_pedido")).toBeInTheDocument();
  });

  it("nomeia a empresa no subtitulo", async () => {
    montar();
    expect(await screen.findByText(/na empresa JCR2/)).toBeInTheDocument();
  });
});

describe("título da página", () => {
  it("declara Histórico e auditoria", () => {
    const head = (Route.options as unknown as { head: () => { meta: { title: string }[] } }).head();
    expect(head.meta[0].title).toBe("Histórico e auditoria");
  });
});
