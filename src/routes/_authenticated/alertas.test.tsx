import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";

// A tela de alertas. Tres coisas valem prender: a ordem por SEVERIDADE (um
// critical embaixo de tres low e um critical que ninguem ve), o gate de admin no
// resolver, e o fato de resolver TAMBEM recarregar o sino - o sino e projecao do
// banco, entao se o alerta sai daqui tem de sair de la.

let ctx = {
  selectedCompany: { id: "c1", name: "JCR2" } as { id: string; name: string } | null,
  isAdmin: true,
};
let busca: { item?: string } = {};
let linhas: Record<string, unknown>[] = [];
const updateEqMock = vi.fn();
const recarregarMock = vi.fn();
const logAuditMock = vi.fn();
const toastSuccessMock = vi.fn();

vi.mock("@tanstack/react-router", () => ({
  createFileRoute: () => (opts: Record<string, unknown>) => ({ options: opts }),
  useSearch: () => busca,
}));

vi.mock("@/lib/app-context", () => ({
  useApp: () => ctx,
  logAudit: (...a: unknown[]) => logAuditMock(...a),
}));

vi.mock("@/hooks/use-notificacoes", () => ({
  useNotificacoes: () => ({ recarregar: recarregarMock }),
}));

vi.mock("@/components/metric-card", () => ({
  EmptyCompany: () => <div data-testid="empty-company" />,
}));

vi.mock("sonner", () => ({ toast: { success: (...a: unknown[]) => toastSuccessMock(...a) } }));

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    from: () => ({
      select: () => ({
        eq: () => ({ order: () => Promise.resolve({ data: linhas }) }),
      }),
      update: (patch: unknown) => ({
        eq: (col: string, val: unknown) => {
          updateEqMock(patch, col, val);
          return Promise.resolve({ error: null });
        },
      }),
    }),
  },
}));

import { Route } from "./alertas";

const Alertas = (Route.options as unknown as { component: () => ReactNode }).component;

function alerta(over: Record<string, unknown> = {}) {
  return {
    id: "a1",
    title: "CPL acima do teto",
    description: "O custo por lead passou de R$ 20",
    severity: "high",
    resolved: false,
    created_at: "2026-08-13T12:00:00Z",
    ...over,
  };
}

function montar() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const Wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={qc}>{children}</QueryClientProvider>
  );
  return render(<Alertas />, { wrapper: Wrapper });
}

beforeEach(() => {
  ctx = { selectedCompany: { id: "c1", name: "JCR2" }, isAdmin: true };
  busca = {};
  linhas = [];
  updateEqMock.mockReset();
  recarregarMock.mockReset();
  logAuditMock.mockReset().mockResolvedValue(undefined);
  toastSuccessMock.mockReset();
  // jsdom nao implementa scrollIntoView, e o efeito de destaque o chama.
  Element.prototype.scrollIntoView = vi.fn();
});

describe("sem empresa", () => {
  it("mostra o vazio", () => {
    ctx = { selectedCompany: null, isAdmin: true };
    montar();
    expect(screen.getByTestId("empty-company")).toBeInTheDocument();
  });
});

describe("lista", () => {
  it("vazio aparece como mensagem, nao como area em branco", async () => {
    linhas = [];
    montar();
    expect(await screen.findByText("Nenhum alerta ativo.")).toBeInTheDocument();
  });

  it("mostra titulo, descricao e severidade em portugues", async () => {
    linhas = [alerta()];
    montar();
    expect(await screen.findByText("CPL acima do teto")).toBeInTheDocument();
    expect(screen.getByText("O custo por lead passou de R$ 20")).toBeInTheDocument();
    // A gravidade aparece traduzida: o codigo cru do banco ("high") nao chega ao gestor.
    expect(screen.getByText("Alto")).toBeInTheDocument();
    expect(screen.queryByText("high")).not.toBeInTheDocument();
  });

  // O padrao novo (padrao_versao = 2) guarda os blocos em colunas proprias. A tela tem de
  // mostrar cada um rotulado, e nao despejar a description numa linha corrida — era isso
  // que tornava o alerta ilegivel.
  it("alerta no padrao novo mostra onde, quanto, janela e o que fazer", async () => {
    linhas = [
      alerta({
        padrao_versao: 2,
        description: "A campanha ja consumiu R$ 1.200,00 e nao trouxe um unico lead.",
        onde: "Campanha [LAF] Institucional",
        quanto: "R$ 1.200,00 gastos, 0 lead",
        janela: "total acumulado da campanha",
        acao: "Testar o caminho do lead de ponta a ponta.",
        linha_produto: "La Felicità",
        vistas: 3,
        primeira_deteccao: "2026-08-11T12:00:00Z",
      }),
    ];
    montar();
    expect(
      await screen.findByText("A campanha ja consumiu R$ 1.200,00 e nao trouxe um unico lead."),
    ).toBeInTheDocument();
    expect(screen.getByText("Campanha [LAF] Institucional")).toBeInTheDocument();
    expect(screen.getByText("R$ 1.200,00 gastos, 0 lead")).toBeInTheDocument();
    expect(screen.getByText("total acumulado da campanha")).toBeInTheDocument();
    expect(screen.getByText(/Testar o caminho do lead/)).toBeInTheDocument();
    // A linha de produto tem de estar visivel: alerta de uma linha lido no contexto de
    // outra ja aconteceu neste sistema e e erro grave.
    expect(screen.getByText("La Felicità")).toBeInTheDocument();
    expect(screen.getByText(/confirmado em 3 rodadas/)).toBeInTheDocument();
  });

  it("alerta resolvido mostra o rotulo 'Resolvido' em vez da severidade", async () => {
    linhas = [alerta({ resolved: true })];
    montar();
    expect(await screen.findByText("Resolvido")).toBeInTheDocument();
    expect(screen.queryByText("high")).not.toBeInTheDocument();
  });
});

describe("ordem por severidade", () => {
  it("critical no topo, mesmo sendo o mais ANTIGO", async () => {
    // O caso que motiva a ordem: um critical antigo embaixo de tres low novos e
    // um critical que ninguem ve.
    linhas = [
      alerta({ id: "l", severity: "low", title: "Low novo", created_at: "2026-08-13T23:00:00Z" }),
      alerta({
        id: "c",
        severity: "critical",
        title: "Critical antigo",
        created_at: "2026-08-01T00:00:00Z",
      }),
      alerta({ id: "m", severity: "medium", title: "Medium", created_at: "2026-08-12T00:00:00Z" }),
    ];
    montar();
    await waitFor(() => expect(screen.getByText("Critical antigo")).toBeInTheDocument());
    const titulos = screen
      .getAllByText(/Critical antigo|Medium|Low novo/)
      .map((n) => n.textContent);
    expect(titulos).toEqual(["Critical antigo", "Medium", "Low novo"]);
  });

  it("dentro da mesma severidade, mais recente primeiro", async () => {
    linhas = [
      alerta({ id: "velho", title: "Velho", created_at: "2026-08-01T00:00:00Z" }),
      alerta({ id: "novo", title: "Novo", created_at: "2026-08-13T00:00:00Z" }),
    ];
    montar();
    await waitFor(() => expect(screen.getByText("Novo")).toBeInTheDocument());
    expect(screen.getAllByText(/^(Novo|Velho)$/).map((n) => n.textContent)).toEqual([
      "Novo",
      "Velho",
    ]);
  });

  it("severidade desconhecida vai para o fim, sem quebrar a ordenacao", async () => {
    linhas = [
      alerta({ id: "x", severity: "urgentissimo", title: "Desconhecido" }),
      alerta({ id: "c", severity: "critical", title: "Critical" }),
    ];
    montar();
    await waitFor(() => expect(screen.getByText("Critical")).toBeInTheDocument());
    expect(screen.getAllByText(/^(Critical|Desconhecido)$/).map((n) => n.textContent)).toEqual([
      "Critical",
      "Desconhecido",
    ]);
  });
});

describe("resolver", () => {
  it("admin ve o botao em alerta aberto", async () => {
    linhas = [alerta()];
    montar();
    expect(await screen.findByRole("button", { name: /Resolver/ })).toBeInTheDocument();
  });

  it("nao-admin NAO ve o botao", async () => {
    ctx = { ...ctx, isAdmin: false };
    linhas = [alerta()];
    montar();
    await screen.findByText("CPL acima do teto");
    expect(screen.queryByRole("button", { name: /Resolver/ })).not.toBeInTheDocument();
  });

  it("alerta JA resolvido nao oferece o botao, nem para admin", async () => {
    linhas = [alerta({ resolved: true })];
    montar();
    await screen.findByText("Resolvido");
    expect(screen.queryByRole("button", { name: /Resolver/ })).not.toBeInTheDocument();
  });

  it("marca resolved=true no alerta certo", async () => {
    linhas = [alerta({ id: "a9" })];
    montar();
    await userEvent.click(await screen.findByRole("button", { name: /Resolver/ }));
    await waitFor(() => expect(updateEqMock).toHaveBeenCalledWith({ resolved: true }, "id", "a9"));
  });

  it("REGISTRA em auditoria quem resolveu", async () => {
    // Resolver alerta e acao humana com consequencia: sai do sino de todos.
    linhas = [alerta({ id: "a9" })];
    montar();
    await userEvent.click(await screen.findByRole("button", { name: /Resolver/ }));
    await waitFor(() =>
      expect(logAuditMock).toHaveBeenCalledWith({
        companyId: "c1",
        action: "alert.resolve",
        targetType: "alert",
        targetId: "a9",
      }),
    );
  });

  it("recarrega o SINO tambem (ele e projecao do banco)", async () => {
    // Sem isto o alerta sai da tela e continua pendurado no sino.
    linhas = [alerta()];
    montar();
    await userEvent.click(await screen.findByRole("button", { name: /Resolver/ }));
    await waitFor(() => expect(recarregarMock).toHaveBeenCalled());
    expect(toastSuccessMock).toHaveBeenCalledWith("Alerta resolvido");
  });
});

describe("destaque via ?item= (vindo do sino)", () => {
  it("rola ate o alerta apontado", async () => {
    busca = { item: "a1" };
    linhas = [alerta({ id: "a1" })];
    montar();
    await waitFor(() => expect(Element.prototype.scrollIntoView).toHaveBeenCalled());
  });

  it("sem ?item= nao rola nada", async () => {
    busca = {};
    linhas = [alerta()];
    montar();
    await screen.findByText("CPL acima do teto");
    expect(Element.prototype.scrollIntoView).not.toHaveBeenCalled();
  });

  it("?item= de alerta que nao esta na lista nao estoura", async () => {
    busca = { item: "inexistente" };
    linhas = [alerta({ id: "a1" })];
    montar();
    await screen.findByText("CPL acima do teto");
    expect(Element.prototype.scrollIntoView).not.toHaveBeenCalled();
  });
});

describe("título da página", () => {
  it("declara Alertas", () => {
    const head = (Route.options as unknown as { head: () => { meta: { title: string }[] } }).head();
    expect(head.meta[0].title).toBe("Alertas");
  });
});
