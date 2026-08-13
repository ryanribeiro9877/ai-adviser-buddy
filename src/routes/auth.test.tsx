import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";

// A porta de entrada do sistema. O teste que mais importa neste arquivo e o de
// login RECUSADO: se a tela navegar para /dashboard mesmo com credencial errada,
// o usuario cai numa aplicacao sem sessao e ve telas vazias em vez de "senha
// invalida" - falha que parece bug de dados e nao de autenticacao.

const navigateMock = vi.fn();
const getSessionMock = vi.fn();
const signInMock = vi.fn();
const signUpMock = vi.fn();
const toastErrorMock = vi.fn();
const toastSuccessMock = vi.fn();

// O roteador entra mockado porque `createFileRoute` e `Link` exigem contexto de
// rota montado; o que interessa aqui e a logica do componente, nao o roteador.
vi.mock("@tanstack/react-router", () => ({
  createFileRoute: () => (opts: Record<string, unknown>) => ({ options: opts }),
  useNavigate: () => navigateMock,
  Link: ({ children, to }: { children: ReactNode; to: string }) => <a href={to}>{children}</a>,
}));

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    auth: {
      getSession: () => getSessionMock(),
      signInWithPassword: (a: unknown) => signInMock(a),
      signUp: (a: unknown) => signUpMock(a),
    },
  },
}));

vi.mock("sonner", () => ({
  toast: {
    error: (...a: unknown[]) => toastErrorMock(...a),
    success: (...a: unknown[]) => toastSuccessMock(...a),
  },
}));

import { Route } from "./auth";

// `as unknown as` de propósito: em tempo de teste o `createFileRoute` acima é o
// mock, mas o tsc enxerga os tipos REAIS do TanStack Router, em que `component` é
// um RouteComponent (aceita props) e não uma função sem argumento. Sem passar por
// unknown o compilador recusa a conversão — corretamente.
const AuthPage = (Route.options as unknown as { component: () => ReactNode }).component;

beforeEach(() => {
  navigateMock.mockReset();
  getSessionMock.mockReset().mockResolvedValue({ data: { session: null } });
  signInMock.mockReset().mockResolvedValue({ error: null });
  signUpMock.mockReset().mockResolvedValue({ error: null });
  toastErrorMock.mockReset();
  toastSuccessMock.mockReset();
});

/** Preenche e submete o formulario de entrar. */
async function entrar(email = "ryan@cohapm.com.br", senha = "senha-correta") {
  await userEvent.type(screen.getByLabelText("Email"), email);
  await userEvent.type(screen.getByLabelText("Senha"), senha);
  await userEvent.click(screen.getByRole("button", { name: "Entrar" }));
}

describe("sessão já existente", () => {
  it("redireciona direto para o dashboard, substituindo o histórico", async () => {
    // `replace: true` importa: sem ele, voltar cai de novo no /auth.
    getSessionMock.mockResolvedValue({ data: { session: { user: { id: "u1" } } } });
    render(<AuthPage />);
    await waitFor(() =>
      expect(navigateMock).toHaveBeenCalledWith({ to: "/dashboard", replace: true }),
    );
  });

  it("sem sessão, permanece na tela de login", async () => {
    render(<AuthPage />);
    await waitFor(() => expect(getSessionMock).toHaveBeenCalled());
    expect(navigateMock).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Entrar" })).toBeInTheDocument();
  });
});

describe("entrar", () => {
  it("envia email e senha ao Supabase", async () => {
    render(<AuthPage />);
    await entrar("ryan@cohapm.com.br", "s3nh4-boa");
    await waitFor(() =>
      expect(signInMock).toHaveBeenCalledWith({
        email: "ryan@cohapm.com.br",
        password: "s3nh4-boa",
      }),
    );
  });

  it("sucesso: avisa e navega para o dashboard", async () => {
    render(<AuthPage />);
    await entrar();
    await waitFor(() => expect(toastSuccessMock).toHaveBeenCalledWith("Bem-vindo!"));
    expect(navigateMock).toHaveBeenCalledWith({ to: "/dashboard", replace: true });
  });

  it("credencial errada NAO navega, e mostra a mensagem do erro", async () => {
    // O teste central do arquivo.
    signInMock.mockResolvedValue({ error: { message: "Invalid login credentials" } });
    render(<AuthPage />);
    await entrar("ryan@cohapm.com.br", "senha-errada");
    await waitFor(() => expect(toastErrorMock).toHaveBeenCalledWith("Invalid login credentials"));
    expect(navigateMock).not.toHaveBeenCalled();
    expect(toastSuccessMock).not.toHaveBeenCalled();
  });

  it("erro NAO deixa o botão travado em 'Entrando…'", async () => {
    // Se o loading nao voltar, o usuario ve o erro mas nao consegue tentar de
    // novo sem recarregar a pagina.
    signInMock.mockResolvedValue({ error: { message: "Invalid login credentials" } });
    render(<AuthPage />);
    await entrar();
    await waitFor(() => expect(toastErrorMock).toHaveBeenCalled());
    expect(screen.getByRole("button", { name: "Entrar" })).toBeEnabled();
  });

  it("desabilita o botão enquanto a chamada não volta", async () => {
    let liberar: (v: { error: null }) => void = () => {};
    signInMock.mockReturnValue(new Promise((r) => (liberar = r)));
    render(<AuthPage />);
    await entrar();
    await waitFor(() => expect(screen.getByRole("button", { name: "Entrando…" })).toBeDisabled());
    liberar({ error: null });
  });

  it("o campo de senha é do tipo password (não vaza na tela)", () => {
    render(<AuthPage />);
    expect(screen.getByLabelText("Senha")).toHaveAttribute("type", "password");
  });

  it("email e senha são obrigatórios no formulário", () => {
    render(<AuthPage />);
    expect(screen.getByLabelText("Email")).toBeRequired();
    expect(screen.getByLabelText("Senha")).toBeRequired();
  });

  it("usa autoComplete de senha atual, não de senha nova", () => {
    // current-password faz o gerenciador de senhas preencher em vez de sugerir
    // uma nova, que e o que acontece com new-password numa tela de login.
    render(<AuthPage />);
    expect(screen.getByLabelText("Senha")).toHaveAttribute("autocomplete", "current-password");
  });
});

describe("criar conta", () => {
  async function irParaCriarConta() {
    await userEvent.click(screen.getByRole("tab", { name: "Criar conta" }));
  }

  async function criarConta(nome = "Ryan", email = "novo@cohapm.com.br", senha = "senha-de-8+") {
    await userEvent.type(screen.getByLabelText("Nome"), nome);
    await userEvent.type(screen.getByLabelText("Email"), email);
    await userEvent.type(screen.getByLabelText("Senha"), senha);
    await userEvent.click(screen.getByRole("button", { name: "Criar conta" }));
  }

  it("envia nome no metadata e o redirect de confirmação", async () => {
    render(<AuthPage />);
    await irParaCriarConta();
    await criarConta("Ryan Ribeiro", "novo@cohapm.com.br", "senha-de-8+");
    await waitFor(() =>
      expect(signUpMock).toHaveBeenCalledWith({
        email: "novo@cohapm.com.br",
        password: "senha-de-8+",
        options: {
          emailRedirectTo: `${window.location.origin}/dashboard`,
          data: { full_name: "Ryan Ribeiro" },
        },
      }),
    );
  });

  it("sucesso NAO navega — a conta ainda precisa de confirmação", async () => {
    // Diferença deliberada em relação ao entrar: criar conta não dá sessão.
    // Navegar aqui levaria a uma aplicação sem sessão.
    render(<AuthPage />);
    await irParaCriarConta();
    await criarConta();
    await waitFor(() =>
      expect(toastSuccessMock).toHaveBeenCalledWith("Conta criada. Você já pode entrar."),
    );
    expect(navigateMock).not.toHaveBeenCalled();
  });

  it("erro mostra a mensagem e não navega", async () => {
    signUpMock.mockResolvedValue({ error: { message: "User already registered" } });
    render(<AuthPage />);
    await irParaCriarConta();
    await criarConta();
    await waitFor(() => expect(toastErrorMock).toHaveBeenCalledWith("User already registered"));
    expect(navigateMock).not.toHaveBeenCalled();
    expect(toastSuccessMock).not.toHaveBeenCalled();
  });

  it("exige senha de no mínimo 8 caracteres", async () => {
    render(<AuthPage />);
    await irParaCriarConta();
    expect(screen.getByLabelText("Senha")).toHaveAttribute("minlength", "8");
  });

  it("usa autoComplete de senha nova", async () => {
    render(<AuthPage />);
    await irParaCriarConta();
    expect(screen.getByLabelText("Senha")).toHaveAttribute("autocomplete", "new-password");
  });

  it("avisa que o primeiro usuário vira administrador", async () => {
    // Regra de negócio com consequência de permissão: precisa estar visível
    // ANTES de criar a conta, não depois.
    render(<AuthPage />);
    await irParaCriarConta();
    expect(
      screen.getByText(/primeiro usuário criado assume o papel de administrador/i),
    ).toBeInTheDocument();
  });
});

describe("estrutura da tela", () => {
  it("oferece as duas abas", () => {
    render(<AuthPage />);
    expect(screen.getByRole("tab", { name: "Entrar" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "Criar conta" })).toBeInTheDocument();
  });

  it("abre em Entrar, não em Criar conta", () => {
    render(<AuthPage />);
    expect(screen.getByRole("tab", { name: "Entrar" })).toHaveAttribute("aria-selected", "true");
  });

  it("define o título da página", () => {
    const head = (Route.options as unknown as { head: () => { meta: { title: string }[] } }).head();
    expect(head.meta[0].title).toContain("Entrar");
  });
});
