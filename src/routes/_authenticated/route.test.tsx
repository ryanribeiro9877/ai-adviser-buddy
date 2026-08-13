import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, act } from "@testing-library/react";
import type { ReactNode } from "react";

// A guarda de rota de tudo que exige login. Duas propriedades importam, e as
// duas sao do tipo que quebra sem erro nenhum aparecer:
//  1. ENQUANTO a sessao nao foi checada, nao redireciona - mostra tela em branco.
//     Redirecionar antes faria o usuario logado ser jogado no /auth a cada
//     recarga, o que se parece com "deslogou sozinho".
//  2. Depois de checar, sem usuario, redireciona com replace - sem replace, o
//     botao voltar devolve para a tela protegida.

const getSessionMock = vi.fn();
const onAuthStateChangeMock = vi.fn();
const unsubscribeMock = vi.fn();

vi.mock("@tanstack/react-router", () => ({
  createFileRoute: () => (opts: Record<string, unknown>) => ({ options: opts }),
  Navigate: ({ to, replace }: { to: string; replace?: boolean }) => (
    <div data-testid="navigate" data-to={to} data-replace={String(!!replace)} />
  ),
}));

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    auth: {
      getSession: () => getSessionMock(),
      onAuthStateChange: (cb: (e: string, s: unknown) => void) => onAuthStateChangeMock(cb),
    },
  },
}));

vi.mock("@/lib/app-context", () => ({
  AppProvider: ({ user, children }: { user: { id: string }; children: ReactNode }) => (
    <div data-testid="provider" data-user={user.id}>
      {children}
    </div>
  ),
}));

vi.mock("@/components/app-shell", () => ({
  AppShell: () => <div data-testid="shell" />,
}));

import { Route } from "./route";

const AuthedLayout = (Route.options as unknown as { component: () => ReactNode }).component;

beforeEach(() => {
  getSessionMock.mockReset().mockResolvedValue({ data: { session: null } });
  onAuthStateChangeMock
    .mockReset()
    .mockReturnValue({ data: { subscription: { unsubscribe: unsubscribeMock } } });
  unsubscribeMock.mockReset();
});

describe("enquanto a sessão não foi checada", () => {
  it("NAO redireciona — mostra tela em branco", async () => {
    // O teste mais importante do arquivo. `getSession` e assincrono; no primeiro
    // render `ready` e false.
    getSessionMock.mockReturnValue(new Promise(() => {}));
    const { container } = render(<AuthedLayout />);
    await new Promise((r) => setTimeout(r, 30));
    expect(screen.queryByTestId("navigate")).not.toBeInTheDocument();
    expect(screen.queryByTestId("shell")).not.toBeInTheDocument();
    expect(container.querySelector(".min-h-screen")).toBeTruthy();
  });
});

describe("sem usuário", () => {
  it("redireciona para /auth com replace", async () => {
    getSessionMock.mockResolvedValue({ data: { session: null } });
    render(<AuthedLayout />);
    const nav = await screen.findByTestId("navigate");
    expect(nav.dataset.to).toBe("/auth");
    // Sem replace, o botao voltar devolveria para a tela protegida.
    expect(nav.dataset.replace).toBe("true");
  });

  it("nao monta o AppProvider nem o AppShell", async () => {
    render(<AuthedLayout />);
    await screen.findByTestId("navigate");
    expect(screen.queryByTestId("provider")).not.toBeInTheDocument();
    expect(screen.queryByTestId("shell")).not.toBeInTheDocument();
  });
});

describe("com usuário", () => {
  it("monta o provider com o usuário da sessão e renderiza a aplicação", async () => {
    getSessionMock.mockResolvedValue({ data: { session: { user: { id: "u42" } } } });
    render(<AuthedLayout />);
    const provider = await screen.findByTestId("provider");
    expect(provider.dataset.user).toBe("u42");
    expect(screen.getByTestId("shell")).toBeInTheDocument();
    expect(screen.queryByTestId("navigate")).not.toBeInTheDocument();
  });
});

describe("reação a mudança de sessão", () => {
  it("LOGOUT em outra aba expulsa desta tambem", async () => {
    // onAuthStateChange e o que faz o logout propagar entre abas; sem reagir a
    // ele, a aba antiga continuaria mostrando dados de uma sessao encerrada.
    getSessionMock.mockResolvedValue({ data: { session: { user: { id: "u42" } } } });
    render(<AuthedLayout />);
    await screen.findByTestId("provider");

    const callback = onAuthStateChangeMock.mock.calls[0][0] as (e: string, s: unknown) => void;
    act(() => callback("SIGNED_OUT", null));

    await waitFor(() => expect(screen.getByTestId("navigate")).toBeInTheDocument());
  });

  it("LOGIN durante a tela em branco monta a aplicação", async () => {
    getSessionMock.mockResolvedValue({ data: { session: null } });
    render(<AuthedLayout />);
    await screen.findByTestId("navigate");

    const callback = onAuthStateChangeMock.mock.calls[0][0] as (e: string, s: unknown) => void;
    act(() => callback("SIGNED_IN", { user: { id: "u7" } }));

    await waitFor(() => expect(screen.getByTestId("provider").dataset.user).toBe("u7"));
  });

  it("CANCELA a inscrição ao desmontar (senão vaza listener por navegação)", async () => {
    const { unmount } = render(<AuthedLayout />);
    await screen.findByTestId("navigate");
    unmount();
    expect(unsubscribeMock).toHaveBeenCalledTimes(1);
  });
});

describe("configuração da rota", () => {
  it("desliga SSR (a checagem de sessão é do navegador)", () => {
    // Renderizar isto no servidor daria sempre "sem sessao" e mandaria todo
    // mundo para /auth no primeiro byte.
    expect((Route.options as unknown as { ssr: boolean }).ssr).toBe(false);
  });
});
