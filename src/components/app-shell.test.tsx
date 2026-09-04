import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";

// A casca da aplicacao: navegacao, seletor de empresa e logout. Tres coisas
// valem prender aqui: o menu de aprovacoes segue OCULTO por feature-flag (a rota
// existe, o item nao), o logout tem de encerrar a sessao ANTES de navegar, e o
// papel aparece na casca - e onde o usuario descobre por que nao consegue agir.

const navigateMock = vi.fn();
const signOutMock = vi.fn();
const setSelectedCompanyIdMock = vi.fn();
const refreshCompaniesMock = vi.fn();
let caminho = "/dashboard";
let ctx = {
  user: { email: "ryan@cohapm.com.br" } as { email?: string },
  isAdmin: true,
  companies: [
    { id: "c1", name: "JCR2", industry: null },
    { id: "c2", name: "Outra", industry: null },
  ],
  selectedCompany: { id: "c1", name: "JCR2", industry: null } as {
    id: string;
    name: string;
    industry: string | null;
  } | null,
  companiesFalhou: false,
  companiesErro: null as unknown,
  refreshCompanies: refreshCompaniesMock,
  setSelectedCompanyId: setSelectedCompanyIdMock,
};

vi.mock("@tanstack/react-router", () => ({
  Link: ({ children, to, onClick }: { children: ReactNode; to: string; onClick?: () => void }) => (
    <a href={to} onClick={onClick}>
      {children}
    </a>
  ),
  Outlet: () => <div data-testid="outlet" />,
  useLocation: () => ({ pathname: caminho }),
  useNavigate: () => navigateMock,
}));

vi.mock("@/lib/app-context", () => ({ useApp: () => ctx }));

vi.mock("@/integrations/supabase/client", () => ({
  supabase: { auth: { signOut: () => signOutMock() } },
}));

vi.mock("@/components/notification-bell", () => ({
  NotificationBell: () => <div data-testid="bell" />,
}));

// A casca monta o NotificacoesProvider, que exige QueryClient e abre canal de
// Realtime. Ele tem teste proprio (use-notificacoes.test.tsx); aqui entra como
// passa-through para o alvo continuar sendo a casca.
vi.mock("@/hooks/use-notificacoes", () => ({
  NotificacoesProvider: ({ children }: { children: ReactNode }) => <>{children}</>,
  useNotificacoes: () => ({
    dados: { total: 0, itens: [] },
    carregando: false,
    erro: null,
    pedidoDeAbrir: 0,
    abrirSino: vi.fn(),
    irPara: vi.fn(),
    recarregar: vi.fn(),
  }),
}));

import { AppShell } from "./app-shell";
import { FEATURES } from "@/lib/features";

beforeEach(() => {
  navigateMock.mockReset();
  signOutMock.mockReset().mockResolvedValue({ error: null });
  setSelectedCompanyIdMock.mockReset();
  caminho = "/dashboard";
  ctx = {
    user: { email: "ryan@cohapm.com.br" },
    isAdmin: true,
    companies: [
      { id: "c1", name: "JCR2", industry: null },
      { id: "c2", name: "Outra", industry: null },
    ],
    selectedCompany: { id: "c1", name: "JCR2", industry: null },
    companiesFalhou: false,
    companiesErro: null,
    refreshCompanies: refreshCompaniesMock,
    setSelectedCompanyId: setSelectedCompanyIdMock,
  };
  refreshCompaniesMock.mockReset();
});

describe("navegação", () => {
  it("lista as telas do produto", () => {
    render(<AppShell />);
    for (const label of [
      "Dashboard executivo",
      "Empresas e contas",
      "Campanhas",
      "Conjuntos e públicos",
      "Anúncios e criativos",
      "Funil e conversões",
      "Alertas",
      "WhatsApp",
      "Metas & Tetos",
      "Operação",
      "Histórico e auditoria",
      "Configurações",
    ]) {
      expect(screen.getAllByText(label).length).toBeGreaterThan(0);
    }
  });

  it("Aprovações fica OCULTO enquanto a flag estiver desligada", () => {
    // A rota continua no codigo e acessivel por URL; so o item de menu sai. Este
    // teste amarra o menu a flag: se um dia divergirem, ele falha.
    expect(FEATURES.approvalsMenu).toBe(false);
    render(<AppShell />);
    expect(screen.queryByText("Aprovações pendentes")).not.toBeInTheDocument();
  });

  it("renderiza o conteudo da rota atual", () => {
    render(<AppShell />);
    expect(screen.getByTestId("outlet")).toBeInTheDocument();
  });

  it("cada item aponta para a propria rota", () => {
    render(<AppShell />);
    expect(screen.getAllByText("Campanhas")[0].closest("a")).toHaveAttribute("href", "/campanhas");
    expect(screen.getAllByText("Operação")[0].closest("a")).toHaveAttribute(
      "href",
      "/recomendacoes",
    );
  });
});

describe("logout", () => {
  it("encerra a sessao e manda para /auth com replace", async () => {
    render(<AppShell />);
    await userEvent.click(screen.getByRole("button", { name: /ryan@cohapm.com.br/i }));
    await userEvent.click(await screen.findByText("Sair"));
    await waitFor(() => expect(signOutMock).toHaveBeenCalled());
    // replace: sem ele o botao voltar devolveria para a tela protegida.
    expect(navigateMock).toHaveBeenCalledWith({ to: "/auth", replace: true });
  });

  it("navega DEPOIS de encerrar a sessao, nao antes", async () => {
    // Navegar primeiro deixaria a sessao viva por um instante numa tela publica.
    let liberar: (v: { error: null }) => void = () => {};
    signOutMock.mockReturnValue(new Promise((r) => (liberar = r)));
    render(<AppShell />);
    await userEvent.click(screen.getByRole("button", { name: /ryan@cohapm.com.br/i }));
    await userEvent.click(await screen.findByText("Sair"));
    expect(navigateMock).not.toHaveBeenCalled();
    liberar({ error: null });
    await waitFor(() => expect(navigateMock).toHaveBeenCalled());
  });
});

describe("papel do usuário", () => {
  it("admin aparece como Administrador", () => {
    render(<AppShell />);
    expect(screen.getByText("Administrador")).toBeInTheDocument();
  });

  it("viewer aparece como Visualizador", () => {
    // E na casca que o usuario descobre por que os botoes de acao estao
    // desabilitados nas telas.
    ctx = { ...ctx, isAdmin: false };
    render(<AppShell />);
    expect(screen.getByText("Visualizador")).toBeInTheDocument();
  });

  it("declara a postura de somente leitura na barra lateral", () => {
    render(<AppShell />);
    expect(screen.getAllByText("Modo somente leitura por padrão").length).toBeGreaterThan(0);
  });

  it("mostra o email da sessao", () => {
    render(<AppShell />);
    expect(screen.getByText("ryan@cohapm.com.br")).toBeInTheDocument();
  });
});

describe("seletor de empresa", () => {
  it("mostra a empresa selecionada", () => {
    render(<AppShell />);
    expect(screen.getByText("JCR2")).toBeInTheDocument();
  });

  it("sem empresa mostra 'Nenhuma empresa', nao vazio", () => {
    ctx = { ...ctx, selectedCompany: null };
    render(<AppShell />);
    expect(screen.getByText("Nenhuma empresa")).toBeInTheDocument();
  });

  // Este e o instancia-raiz de "ausencia vira informacao" no app: se a consulta
  // das empresas falha, `companies` chega vazio por `?? []`, nenhuma empresa e
  // selecionada, e TODA tela abaixo entra em modo "escolha uma empresa". Um erro
  // de RLS fazia a conta inteira do cliente parecer conta nova.
  it("FALHA ao carregar empresas nao vira 'Nenhuma empresa'", () => {
    ctx = { ...ctx, companies: [], selectedCompany: null, companiesFalhou: true };
    render(<AppShell />);
    expect(screen.getByText("Empresas não carregaram")).toBeInTheDocument();
    expect(screen.queryByText("Nenhuma empresa")).not.toBeInTheDocument();
  });

  it("conta genuinamente sem empresa mostra o cadastro vazio, e NAO acusa falha", async () => {
    ctx = { ...ctx, companies: [], selectedCompany: null };
    render(<AppShell />);
    await userEvent.click(screen.getByRole("button", { name: /Nenhuma empresa/ }));
    expect(await screen.findByText("Nenhuma empresa cadastrada")).toBeInTheDocument();
    expect(screen.queryByText(/não foi possível carregar/i)).not.toBeInTheDocument();
  });

  it("no menu, a falha se identifica e oferece tentar de novo", async () => {
    ctx = { ...ctx, companies: [], selectedCompany: null, companiesFalhou: true };
    render(<AppShell />);
    await userEvent.click(screen.getByRole("button", { name: /Empresas não carregaram/ }));
    expect(await screen.findByText(/não foi possível carregar as empresas/i)).toBeInTheDocument();
    // "Nenhuma empresa cadastrada" e uma afirmacao sobre o banco; nao cabe aqui.
    expect(screen.queryByText("Nenhuma empresa cadastrada")).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: /tentar de novo/i }));
    expect(refreshCompaniesMock).toHaveBeenCalled();
  });

  it("trocar de empresa chama o contexto (que reflete na URL)", async () => {
    render(<AppShell />);
    await userEvent.click(screen.getByRole("button", { name: /JCR2/ }));
    await userEvent.click(await screen.findByText("Outra"));
    expect(setSelectedCompanyIdMock).toHaveBeenCalledWith("c2");
  });

  it("oferece o caminho para gerenciar empresas", async () => {
    render(<AppShell />);
    await userEvent.click(screen.getByRole("button", { name: /JCR2/ }));
    expect((await screen.findByText("Gerenciar empresas")).closest("a")).toHaveAttribute(
      "href",
      "/empresas",
    );
  });
});

describe("sino de notificações", () => {
  it("está na casca, visível em toda tela autenticada", () => {
    render(<AppShell />);
    expect(screen.getByTestId("bell")).toBeInTheDocument();
  });
});
