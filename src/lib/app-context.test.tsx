import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, renderHook } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import type { User } from "@supabase/supabase-js";

// Aqui se decide `isAdmin`, que e o que libera os botoes de aprovar/rejeitar em
// conta de anuncio real. A propriedade mais importante do arquivo e FALHAR
// FECHADO: enquanto a consulta de papel nao resolve, e sempre que o resultado
// nao contem 'admin', o papel e viewer. Um default aberto daria poder de
// sancionar gasto a quem so deveria visualizar.

const navigateMock = vi.fn();
vi.mock("@tanstack/react-router", () => ({ useNavigate: () => navigateMock }));

let papeis: { role: string }[] | null = [];
let empresas: { id: string; name: string; industry: string | null }[] | null = [];
let erroEmpresas: unknown = null;
let usuarioDaSessao: { id: string } | null = { id: "u1" };
const insertMock = vi.fn();

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    from: (tabela: string) => {
      if (tabela === "user_roles") {
        return { select: () => ({ eq: () => Promise.resolve({ data: papeis, error: null }) }) };
      }
      if (tabela === "companies") {
        return {
          select: () => ({ order: () => Promise.resolve({ data: empresas, error: erroEmpresas }) }),
        };
      }
      return { insert: (...a: unknown[]) => insertMock(...a) };
    },
    auth: { getUser: () => Promise.resolve({ data: { user: usuarioDaSessao } }) },
  },
}));

import { AppProvider, useApp, logAudit } from "./app-context";

const USUARIO = { id: "u1", email: "ryan@cohapm.com.br" } as unknown as User;
const EMPRESA_A = { id: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa", name: "JCR2", industry: null };
const EMPRESA_B = { id: "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb", name: "Outra", industry: "x" };

/** Sonda: expõe o contexto na tela para os testes lerem. */
function Sonda() {
  const ctx = useApp();
  return (
    <div>
      <span data-testid="role">{ctx.role}</span>
      <span data-testid="isAdmin">{String(ctx.isAdmin)}</span>
      <span data-testid="selecionada">{ctx.selectedCompanyId ?? "nenhuma"}</span>
      <span data-testid="nome">{ctx.selectedCompany?.name ?? "-"}</span>
      <span data-testid="qtd">{ctx.companies.length}</span>
      <button onClick={() => ctx.setSelectedCompanyId(EMPRESA_B.id)}>trocar</button>
    </div>
  );
}

function montar() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <AppProvider user={USUARIO}>
        <Sonda />
      </AppProvider>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  navigateMock.mockReset();
  insertMock.mockReset().mockResolvedValue({ error: null });
  papeis = [];
  empresas = [];
  erroEmpresas = null;
  usuarioDaSessao = { id: "u1" };
  localStorage.clear();
  window.history.replaceState({}, "", "/");
});

describe("papel — falha fechado", () => {
  it("sem papel nenhum: viewer", async () => {
    papeis = [];
    montar();
    await waitFor(() => expect(screen.getByTestId("role").textContent).toBe("viewer"));
    expect(screen.getByTestId("isAdmin").textContent).toBe("false");
  });

  it("com 'admin' entre os papeis: admin", async () => {
    papeis = [{ role: "viewer" }, { role: "admin" }];
    montar();
    await waitFor(() => expect(screen.getByTestId("role").textContent).toBe("admin"));
    expect(screen.getByTestId("isAdmin").textContent).toBe("true");
  });

  it("ANTES de a consulta resolver, o papel ja e viewer (nunca admin)", () => {
    // O render sincrono acontece com rolesQuery.data === undefined. Se o default
    // fosse admin, existiria uma janela em que o botao de aprovar aparece para
    // quem nao pode - curta, mas clicavel.
    papeis = [{ role: "admin" }];
    montar();
    expect(screen.getByTestId("role").textContent).toBe("viewer");
    expect(screen.getByTestId("isAdmin").textContent).toBe("false");
  });

  it("papel desconhecido NAO vira admin", async () => {
    papeis = [{ role: "superuser" }, { role: "owner" }];
    montar();
    await waitFor(() => expect(screen.getByTestId("qtd")).toBeInTheDocument());
    expect(screen.getByTestId("role").textContent).toBe("viewer");
  });

  it("consulta sem dado (null) nao estoura e mantem viewer", async () => {
    papeis = null;
    montar();
    await waitFor(() => expect(screen.getByTestId("role").textContent).toBe("viewer"));
  });
});

describe("empresa inicial", () => {
  it("a URL manda sobre o localStorage", async () => {
    // Decisao de produto (F0.1): o link compartilhado tem de abrir na empresa do
    // link, nao na ultima que a pessoa olhou.
    localStorage.setItem("gt-selected-company", EMPRESA_B.id);
    window.history.replaceState({}, "", `/?company=${EMPRESA_A.id}`);
    empresas = [EMPRESA_A, EMPRESA_B];
    montar();
    await waitFor(() => expect(screen.getByTestId("selecionada").textContent).toBe(EMPRESA_A.id));
  });

  it("sem company na URL, o localStorage semeia", async () => {
    localStorage.setItem("gt-selected-company", EMPRESA_B.id);
    empresas = [EMPRESA_A, EMPRESA_B];
    montar();
    await waitFor(() => expect(screen.getByTestId("selecionada").textContent).toBe(EMPRESA_B.id));
  });

  it("company invalido na URL e IGNORADO (cai no localStorage)", async () => {
    localStorage.setItem("gt-selected-company", EMPRESA_B.id);
    window.history.replaceState({}, "", "/?company=nao-e-uuid");
    empresas = [EMPRESA_A, EMPRESA_B];
    montar();
    await waitFor(() => expect(screen.getByTestId("selecionada").textContent).toBe(EMPRESA_B.id));
  });

  it("sem URL e sem localStorage, seleciona a PRIMEIRA da lista", async () => {
    empresas = [EMPRESA_A, EMPRESA_B];
    montar();
    await waitFor(() => expect(screen.getByTestId("selecionada").textContent).toBe(EMPRESA_A.id));
    expect(localStorage.getItem("gt-selected-company")).toBe(EMPRESA_A.id);
  });

  it("empresa salva que NAO existe mais cai para a primeira da lista", async () => {
    // Perder acesso a uma empresa nao pode deixar a tela travada num id morto.
    localStorage.setItem("gt-selected-company", "cccccccc-cccc-cccc-cccc-cccccccccccc");
    empresas = [EMPRESA_A];
    montar();
    await waitFor(() => expect(screen.getByTestId("selecionada").textContent).toBe(EMPRESA_A.id));
  });

  it("lista vazia nao seleciona nada, em vez de estourar", async () => {
    empresas = [];
    montar();
    await waitFor(() => expect(screen.getByTestId("qtd").textContent).toBe("0"));
    expect(screen.getByTestId("selecionada").textContent).toBe("nenhuma");
    expect(screen.getByTestId("nome").textContent).toBe("-");
  });

  it("erro ao buscar empresas nao derruba o provider", async () => {
    empresas = null;
    erroEmpresas = { message: "permission denied" };
    montar();
    await waitFor(() => expect(screen.getByTestId("role")).toBeInTheDocument());
    expect(screen.getByTestId("qtd").textContent).toBe("0");
  });
});

describe("setSelectedCompanyId", () => {
  it("grava no localStorage E reflete na URL", async () => {
    empresas = [EMPRESA_A, EMPRESA_B];
    montar();
    await waitFor(() => expect(screen.getByTestId("qtd").textContent).toBe("2"));
    screen.getByText("trocar").click();

    await waitFor(() => expect(localStorage.getItem("gt-selected-company")).toBe(EMPRESA_B.id));
    const arg = navigateMock.mock.calls[0][0] as {
      to: string;
      replace: boolean;
      search: (p: Record<string, unknown>) => unknown;
    };
    expect(arg).toMatchObject({ to: ".", replace: true });
    // preserva os outros params da URL em vez de zerar os filtros
    expect(arg.search({ preset: "7d" })).toEqual({ preset: "7d", company: EMPRESA_B.id });
  });

  it("selectedCompany acompanha o id selecionado", async () => {
    empresas = [EMPRESA_A, EMPRESA_B];
    montar();
    await waitFor(() => expect(screen.getByTestId("nome").textContent).toBe("JCR2"));
    screen.getByText("trocar").click();
    await waitFor(() => expect(screen.getByTestId("nome").textContent).toBe("Outra"));
  });
});

describe("useApp fora do provider", () => {
  it("estoura com mensagem clara, em vez de devolver null e quebrar longe", () => {
    // Erro explicito aqui economiza uma cacada por "cannot read property of null"
    // em algum componente tres niveis abaixo.
    expect(() => renderHook(() => useApp())).toThrow(/useApp must be used inside AppProvider/);
  });
});

describe("logAudit", () => {
  it("grava a linha de auditoria com usuario e empresa", async () => {
    await logAudit({ companyId: EMPRESA_A.id, action: "aprovar_pedido", targetId: "p1" });
    expect(insertMock).toHaveBeenCalledWith({
      company_id: EMPRESA_A.id,
      user_id: "u1",
      action: "aprovar_pedido",
      target_type: null,
      target_id: "p1",
      details: {},
    });
  });

  it("SEM sessao nao grava nada (nao existe auditoria anonima)", async () => {
    // Linha de auditoria sem autor e pior que nenhuma: da a impressao de
    // rastreabilidade sem entregar.
    usuarioDaSessao = null;
    await logAudit({ companyId: EMPRESA_A.id, action: "x" });
    expect(insertMock).not.toHaveBeenCalled();
  });

  it("campos opcionais viram null/objeto vazio, nao undefined", async () => {
    await logAudit({ companyId: null, action: "y" });
    expect(insertMock).toHaveBeenCalledWith(
      expect.objectContaining({
        company_id: null,
        target_type: null,
        target_id: null,
        details: {},
      }),
    );
  });

  it("encaminha os detalhes quando informados", async () => {
    await logAudit({ companyId: null, action: "y", details: { de: 100, para: 200 } });
    expect(insertMock.mock.calls[0][0]).toMatchObject({ details: { de: 100, para: 200 } });
  });
});
