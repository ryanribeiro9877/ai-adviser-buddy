import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor, act, renderHook } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import type { Notificacoes } from "@/lib/notificacoes";

// O provedor do sino. E o unico lugar do front que INTERROMPE o gestor sem ele
// pedir, entao os testes aqui sao sobre nao abusar disso: nao avisar duas vezes
// do mesmo item, nao avisar de empresa que ele nao esta olhando, e nao avisar de
// algo que ele ja esta vendo na tela.

const navigateMock = vi.fn();
let pathAtual = "/dashboard";
const toastCustomMock = vi.fn();
const toastDismissMock = vi.fn();
const removeChannelMock = vi.fn();
const rpcMock = vi.fn();
const subscribeMock = vi.fn();

/** Handlers que o provedor registrou no canal, por tabela. */
let handlers: Record<string, (p: unknown) => void> = {};
let nomeDoCanal = "";
let filtros: Record<string, string> = {};

let empresaAtual: { id: string; name: string; industry: string | null } | null = {
  id: "empresa-1",
  name: "JCR2",
  industry: null,
};

vi.mock("@tanstack/react-router", () => ({
  useNavigate: () => navigateMock,
  useLocation: () => ({ pathname: pathAtual }),
}));

vi.mock("@/lib/app-context", () => ({
  useApp: () => ({ selectedCompany: empresaAtual }),
}));

vi.mock("sonner", () => ({
  toast: {
    custom: (...a: unknown[]) => toastCustomMock(...a),
    dismiss: (...a: unknown[]) => toastDismissMock(...a),
  },
}));

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    rpc: (...a: unknown[]) => rpcMock(...a),
    channel: (nome: string) => {
      nomeDoCanal = nome;
      const canal = {
        on: (_ev: string, cfg: { table: string; filter: string }, cb: (p: unknown) => void) => {
          handlers[cfg.table] = cb;
          filtros[cfg.table] = cfg.filter;
          return canal;
        },
        subscribe: () => {
          subscribeMock();
          return canal;
        },
      };
      return canal;
    },
    removeChannel: (...a: unknown[]) => removeChannelMock(...a),
  },
}));

import { NotificacoesProvider, useNotificacoes } from "./use-notificacoes";

function item(over: Record<string, unknown> = {}) {
  return {
    id: "n1",
    tipo: "aprovacao",
    titulo: "Escalar orçamento",
    descricao: "Primeira linha\nsegunda",
    urgencia: "high",
    created_at: "2026-08-13T11:00:00Z",
    expires_at: null,
    minutos_para_expirar: null,
    conversation_id: null,
    ...over,
  };
}

function resposta(itens: Record<string, unknown>[] = []): Notificacoes {
  return {
    total: itens.length,
    aprovacoes_pendentes: itens.filter((i) => i.tipo === "aprovacao").length,
    alertas_abertos: itens.filter((i) => i.tipo === "alerta").length,
    criticos: 0,
    expirando_em_2h: 0,
    itens: itens as never,
  };
}

/** Sonda que expõe o contexto na tela. */
function Sonda() {
  const ctx = useNotificacoes();
  return (
    <div>
      <span data-testid="total">{ctx.dados.total}</span>
      <span data-testid="carregando">{String(ctx.carregando)}</span>
      <span data-testid="erro">{ctx.erro ?? "-"}</span>
      <span data-testid="pedido">{ctx.pedidoDeAbrir}</span>
      <button onClick={ctx.abrirSino}>abrir</button>
      <button onClick={() => ctx.irPara(item({ id: "a9", tipo: "alerta" }) as never)}>
        ir-alerta
      </button>
      <button onClick={() => ctx.irPara(item({ id: "p3" }) as never)}>ir-aprovacao</button>
    </div>
  );
}

function montar() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const Wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={qc}>
      <NotificacoesProvider>{children}</NotificacoesProvider>
    </QueryClientProvider>
  );
  return { qc, ...render(<Sonda />, { wrapper: Wrapper }) };
}

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  navigateMock.mockReset();
  toastCustomMock.mockReset();
  toastDismissMock.mockReset();
  removeChannelMock.mockReset();
  subscribeMock.mockReset();
  rpcMock.mockReset().mockResolvedValue({ data: resposta(), error: null });
  handlers = {};
  filtros = {};
  nomeDoCanal = "";
  pathAtual = "/dashboard";
  empresaAtual = { id: "empresa-1", name: "JCR2", industry: null };
});

afterEach(() => {
  vi.useRealTimers();
});

/** Dispara um INSERT de item aberto e deixa a janela de rajada fechar. */
async function chegarNovaPendencia(id: string, tabela = "approval_requests") {
  act(() => {
    handlers[tabela]?.({ eventType: "INSERT", new: { id, status: "pending", resolved: false } });
  });
  await act(async () => {
    vi.advanceTimersByTime(3000);
    await Promise.resolve();
  });
}

describe("consulta da RPC", () => {
  it("chama get_notificacoes_pendentes com a empresa selecionada", async () => {
    montar();
    await waitFor(() =>
      expect(rpcMock).toHaveBeenCalledWith("get_notificacoes_pendentes", {
        p_company_id: "empresa-1",
      }),
    );
  });

  it("SEM empresa nao consulta e mostra o estado zero", async () => {
    empresaAtual = null;
    montar();
    await act(async () => {
      await Promise.resolve();
    });
    expect(rpcMock).not.toHaveBeenCalled();
    expect(screen.getByTestId("total").textContent).toBe("0");
  });

  it("expoe o total que a RPC devolveu", async () => {
    rpcMock.mockResolvedValue({ data: resposta([item(), item({ id: "n2" })]), error: null });
    montar();
    await waitFor(() => expect(screen.getByTestId("total").textContent).toBe("2"));
  });

  it("erro da RPC vira mensagem no contexto, nao tela quebrada", async () => {
    rpcMock.mockResolvedValue({ data: null, error: { message: "permission denied" } });
    montar();
    await waitFor(() => expect(screen.getByTestId("erro").textContent).toBe("permission denied"));
  });

  it("RPC devolvendo null cai no estado zero", async () => {
    rpcMock.mockResolvedValue({ data: null, error: null });
    montar();
    await waitFor(() => expect(screen.getByTestId("total").textContent).toBe("0"));
  });
});

describe("canal de realtime", () => {
  it("assina as duas tabelas FILTRANDO por empresa", async () => {
    // Sem o filtro, o admin (que pertence as duas empresas) receberia aviso da
    // empresa que nao esta olhando.
    montar();
    await waitFor(() => expect(subscribeMock).toHaveBeenCalled());
    expect(nomeDoCanal).toBe("notificacoes:empresa-1");
    expect(filtros["approval_requests"]).toBe("company_id=eq.empresa-1");
    expect(filtros["alerts"]).toBe("company_id=eq.empresa-1");
  });

  it("remove o canal ao desmontar", async () => {
    const { unmount } = montar();
    await waitFor(() => expect(subscribeMock).toHaveBeenCalled());
    unmount();
    expect(removeChannelMock).toHaveBeenCalledTimes(1);
  });

  it("SEM empresa nao abre canal", async () => {
    empresaAtual = null;
    montar();
    await act(async () => {
      await Promise.resolve();
    });
    expect(subscribeMock).not.toHaveBeenCalled();
  });
});

describe("quando avisar", () => {
  it("pendencia nova gera toast", async () => {
    rpcMock.mockResolvedValue({ data: resposta([item({ id: "n1" })]), error: null });
    montar();
    await waitFor(() => expect(subscribeMock).toHaveBeenCalled());
    await chegarNovaPendencia("n1");
    expect(toastCustomMock).toHaveBeenCalledTimes(1);
  });

  it("o MESMO id nunca avisa duas vezes na sessao", async () => {
    // Reentrega do Realtime e normal; avisar de novo treinaria o gestor a
    // ignorar o toast.
    rpcMock.mockResolvedValue({ data: resposta([item({ id: "n1" })]), error: null });
    montar();
    await waitFor(() => expect(subscribeMock).toHaveBeenCalled());
    await chegarNovaPendencia("n1");
    await chegarNovaPendencia("n1");
    expect(toastCustomMock).toHaveBeenCalledTimes(1);
  });

  it("NAO avisa de item que o gestor ja esta vendo na tela de destino", async () => {
    // Ele acabou de abrir /recomendacoes; o cartao ja esta na frente dele.
    pathAtual = "/recomendacoes";
    rpcMock.mockResolvedValue({ data: resposta([item({ id: "n1" })]), error: null });
    montar();
    await waitFor(() => expect(subscribeMock).toHaveBeenCalled());
    await chegarNovaPendencia("n1");
    expect(toastCustomMock).not.toHaveBeenCalled();
  });

  it("estando em /alertas, ainda avisa de APROVACAO (destino diferente)", async () => {
    pathAtual = "/alertas";
    rpcMock.mockResolvedValue({ data: resposta([item({ id: "n1" })]), error: null });
    montar();
    await waitFor(() => expect(subscribeMock).toHaveBeenCalled());
    await chegarNovaPendencia("n1");
    expect(toastCustomMock).toHaveBeenCalledTimes(1);
  });

  it("decidir uma aprovacao NAO gera toast (muda a lista, nao e novidade)", async () => {
    rpcMock.mockResolvedValue({ data: resposta([item({ id: "n1" })]), error: null });
    montar();
    await waitFor(() => expect(subscribeMock).toHaveBeenCalled());
    act(() => {
      handlers["approval_requests"]?.({
        eventType: "UPDATE",
        old: { status: "pending" },
        new: { id: "n1", status: "approved" },
      });
    });
    await act(async () => {
      vi.advanceTimersByTime(3000);
      await Promise.resolve();
    });
    expect(toastCustomMock).not.toHaveBeenCalled();
  });

  it("DELETE nunca gera toast", async () => {
    montar();
    await waitFor(() => expect(subscribeMock).toHaveBeenCalled());
    act(() => {
      handlers["approval_requests"]?.({ eventType: "DELETE", old: { id: "n1" } });
    });
    await act(async () => {
      vi.advanceTimersByTime(3000);
      await Promise.resolve();
    });
    expect(toastCustomMock).not.toHaveBeenCalled();
  });

  it("id que a RPC nao confirma nao gera toast", async () => {
    // Chegou evento de um item que a consulta nao devolve (ja resolvido, ou
    // fora do escopo do usuario): nao inventa aviso.
    rpcMock.mockResolvedValue({ data: resposta([]), error: null });
    montar();
    await waitFor(() => expect(subscribeMock).toHaveBeenCalled());
    await chegarNovaPendencia("fantasma");
    expect(toastCustomMock).not.toHaveBeenCalled();
  });

  it("rajada de 3+ colapsa em UM toast agrupado", async () => {
    // Cron disparando varios de uma vez nao pode empilhar 8 toasts na tela.
    rpcMock.mockResolvedValue({
      data: resposta([item({ id: "a" }), item({ id: "b" }), item({ id: "c" })]),
      error: null,
    });
    montar();
    await waitFor(() => expect(subscribeMock).toHaveBeenCalled());
    act(() => {
      for (const id of ["a", "b", "c"]) {
        handlers["approval_requests"]?.({ eventType: "INSERT", new: { id, status: "pending" } });
      }
    });
    await act(async () => {
      vi.advanceTimersByTime(3000);
      await Promise.resolve();
    });
    expect(toastCustomMock).toHaveBeenCalledTimes(1);
  });

  it("alerta aberto tambem avisa", async () => {
    rpcMock.mockResolvedValue({
      data: resposta([item({ id: "al1", tipo: "alerta" })]),
      error: null,
    });
    montar();
    await waitFor(() => expect(subscribeMock).toHaveBeenCalled());
    act(() => {
      handlers["alerts"]?.({ eventType: "INSERT", new: { id: "al1", resolved: false } });
    });
    await act(async () => {
      vi.advanceTimersByTime(3000);
      await Promise.resolve();
    });
    expect(toastCustomMock).toHaveBeenCalledTimes(1);
  });
});

describe("Esc fecha os avisos", () => {
  it("dispensa os toasts ativos, inclusive os persistentes", async () => {
    // Urgencia alta nao sai sozinha de proposito; sem uma saida pelo teclado o
    // gestor fica com o cartao preso na tela.
    rpcMock.mockResolvedValue({ data: resposta([item({ id: "n1" })]), error: null });
    montar();
    await waitFor(() => expect(subscribeMock).toHaveBeenCalled());
    await chegarNovaPendencia("n1");
    expect(toastCustomMock).toHaveBeenCalledTimes(1);

    act(() => {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    });
    expect(toastDismissMock).toHaveBeenCalledWith("notif:n1");
  });

  it("Esc sem nenhum aviso aberto nao faz nada", async () => {
    montar();
    await waitFor(() => expect(subscribeMock).toHaveBeenCalled());
    act(() => {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    });
    expect(toastDismissMock).not.toHaveBeenCalled();
  });

  it("outra tecla nao dispensa", async () => {
    rpcMock.mockResolvedValue({ data: resposta([item({ id: "n1" })]), error: null });
    montar();
    await waitFor(() => expect(subscribeMock).toHaveBeenCalled());
    await chegarNovaPendencia("n1");
    act(() => {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter" }));
    });
    expect(toastDismissMock).not.toHaveBeenCalled();
  });
});

describe("navegação e abertura do sino", () => {
  it("irPara(alerta) vai para /alertas preservando os outros params", async () => {
    montar();
    await waitFor(() => expect(subscribeMock).toHaveBeenCalled());
    act(() => screen.getByText("ir-alerta").click());
    const arg = navigateMock.mock.calls[0][0] as {
      to: string;
      search: (p: Record<string, unknown>) => unknown;
    };
    expect(arg.to).toBe("/alertas");
    expect(arg.search({ company: "x" })).toEqual({ company: "x", item: "a9" });
  });

  it("irPara(aprovacao) vai para a aba Aprovações da Operação", async () => {
    montar();
    await waitFor(() => expect(subscribeMock).toHaveBeenCalled());
    act(() => screen.getByText("ir-aprovacao").click());
    const arg = navigateMock.mock.calls[0][0] as {
      to: string;
      search: (p: Record<string, unknown>) => unknown;
    };
    expect(arg.to).toBe("/recomendacoes");
    expect(arg.search({})).toEqual({ tab: "aprovacoes", item: "p3" });
  });

  it("abrirSino incrementa o pedido (o sino escuta a mudanca)", async () => {
    montar();
    await waitFor(() => expect(subscribeMock).toHaveBeenCalled());
    expect(screen.getByTestId("pedido").textContent).toBe("0");
    act(() => screen.getByText("abrir").click());
    expect(screen.getByTestId("pedido").textContent).toBe("1");
    act(() => screen.getByText("abrir").click());
    expect(screen.getByTestId("pedido").textContent).toBe("2");
  });
});

describe("useNotificacoes fora do provedor", () => {
  it("estoura com mensagem clara", () => {
    expect(() => renderHook(() => useNotificacoes())).toThrow(
      /precisa estar dentro de NotificacoesProvider/,
    );
  });
});
