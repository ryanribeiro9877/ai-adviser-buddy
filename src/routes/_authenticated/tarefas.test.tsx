import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";

// A tela de saúde das tarefas. O que vale prender aqui é a distinção que motivou a tela
// inteira: "rodou e não achou nada" NÃO é "não rodou". Enquanto as duas apareciam como
// silêncio, ninguém percebia cron parada. Também vale prender o gate de admin no
// reexecutar e o aviso de que tarefa HTTP não termina no disparo.

let ctx = { isAdmin: true };
let linhas: Record<string, unknown>[] = [];
let erroPainel: { message: string } | null = null;
let erroReexec: { message: string } | null = null;
const rpcMock = vi.fn();
const toastSuccessMock = vi.fn();
const toastErrorMock = vi.fn();

vi.mock("@tanstack/react-router", () => ({
  createFileRoute: () => (opts: Record<string, unknown>) => ({ options: opts }),
}));

vi.mock("@/lib/app-context", () => ({
  useApp: () => ctx,
}));

vi.mock("sonner", () => ({
  toast: {
    success: (...a: unknown[]) => toastSuccessMock(...a),
    error: (...a: unknown[]) => toastErrorMock(...a),
  },
}));

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    rpc: (nome: string, args?: unknown) => {
      rpcMock(nome, args);
      if (nome === "painel_tarefas_agendadas") {
        return Promise.resolve({ data: erroPainel ? null : linhas, error: erroPainel });
      }
      return Promise.resolve({ data: null, error: erroReexec });
    },
  },
}));

import { Route } from "./tarefas";

const Tarefas = (Route.options as unknown as { component: () => ReactNode }).component;

function tarefa(over: Record<string, unknown> = {}) {
  return {
    tarefa: "alertas-de-midia",
    titulo: "Alertas de midia",
    pergunta: "Alguma campanha ativa estourou custo?",
    periodicidade: "diaria",
    tipo: "sql",
    empresa: null,
    ultima_em: new Date(Date.now() - 3600_000).toISOString(),
    desfecho: "sucesso",
    duracao_ms: 1400,
    itens_processados: 12,
    achados: 2,
    mensagem_erro: null,
    atrasada: false,
    rodadas_7d: 7,
    falhas_7d: 0,
    agendada_no_cron: true,
    ...over,
  };
}

function montar() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const Wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={qc}>{children}</QueryClientProvider>
  );
  return render(<Tarefas />, { wrapper: Wrapper });
}

beforeEach(() => {
  ctx = { isAdmin: true };
  linhas = [];
  erroPainel = null;
  erroReexec = null;
  rpcMock.mockReset();
  toastSuccessMock.mockReset();
  toastErrorMock.mockReset();
});

describe("desfecho em linguagem de gestor", () => {
  // O ponto central de toda a entrega: os dois estados que antes se confundiam.
  it("distingue 'rodou e nao achou nada' de 'nunca rodou'", async () => {
    linhas = [
      tarefa({
        tarefa: "t-vazia",
        titulo: "Varredura vazia",
        desfecho: "sucesso_vazio",
        achados: 0,
      }),
      tarefa({ tarefa: "t-nova", titulo: "Tarefa nova", desfecho: null, ultima_em: null }),
    ];
    montar();
    expect(await screen.findByText("Rodou, nada a fazer")).toBeInTheDocument();
    expect(screen.getByText("Nunca rodou")).toBeInTheDocument();
    expect(screen.getByText(/nunca rodou/)).toBeInTheDocument();
  });

  it("traduz o codigo do banco: nao mostra 'sucesso_vazio' cru na tela", async () => {
    linhas = [tarefa({ desfecho: "sucesso_vazio" })];
    montar();
    await screen.findByText("Rodou, nada a fazer");
    expect(screen.queryByText("sucesso_vazio")).not.toBeInTheDocument();
  });

  it("traduz a periodicidade em vez de mostrar o codigo", async () => {
    linhas = [tarefa({ periodicidade: "horaria" })];
    montar();
    expect(await screen.findByText(/de hora em hora/)).toBeInTheDocument();
    expect(screen.queryByText(/horaria/)).not.toBeInTheDocument();
  });
});

describe("atrasadas", () => {
  it("separa as atrasadas numa secao propria e conta no resumo", async () => {
    linhas = [
      tarefa({ tarefa: "t-atrasada", titulo: "Coleta travada", atrasada: true }),
      tarefa({ tarefa: "t-ok", titulo: "Coleta em dia", atrasada: false }),
    ];
    montar();
    expect(
      await screen.findByText(/Atrasadas — deveriam ter rodado e não rodaram/),
    ).toBeInTheDocument();
    expect(screen.getByText("Em dia")).toBeInTheDocument();
    expect(screen.getByText("atrasadas")).toBeInTheDocument();
  });

  it("nao mostra a secao de atrasadas quando esta tudo em dia", async () => {
    linhas = [tarefa()];
    montar();
    await screen.findByText("Alertas de midia");
    expect(screen.queryByText(/Atrasadas —/)).not.toBeInTheDocument();
  });

  it("mostra a mensagem de erro da ultima falha", async () => {
    linhas = [tarefa({ desfecho: "falha", mensagem_erro: "chave do chamador nao confere" })];
    montar();
    expect(await screen.findByText("chave do chamador nao confere")).toBeInTheDocument();
    expect(screen.getByText("Falhou")).toBeInTheDocument();
  });

  // Tarefa no catálogo mas fora do cron é justamente o modo de falha do pedido:
  // "declarada mas não executa". Tem de estar visível.
  it("marca tarefa do catalogo que nao esta agendada no cron", async () => {
    linhas = [tarefa({ agendada_no_cron: false })];
    montar();
    expect(await screen.findByText("sem agendamento")).toBeInTheDocument();
  });
});

describe("reexecutar", () => {
  it("admin dispara e recebe o aviso de que o resultado demora", async () => {
    linhas = [tarefa()];
    montar();
    await userEvent.click(await screen.findByRole("button", { name: /Reexecutar/ }));
    await waitFor(() =>
      expect(rpcMock).toHaveBeenCalledWith("reexecutar_tarefa", { p_tarefa: "alertas-de-midia" }),
    );
    expect(toastSuccessMock).toHaveBeenCalledWith(expect.stringContaining("alguns minutos"));
  });

  it("nao admin nao ve o botao", async () => {
    ctx = { isAdmin: false };
    linhas = [tarefa()];
    montar();
    await screen.findByText("Alertas de midia");
    expect(screen.queryByRole("button", { name: /Reexecutar/ })).not.toBeInTheDocument();
  });

  it("tarefa sem agendamento nao oferece reexecucao", async () => {
    linhas = [tarefa({ agendada_no_cron: false })];
    montar();
    await screen.findByText("Alertas de midia");
    expect(screen.queryByRole("button", { name: /Reexecutar/ })).not.toBeInTheDocument();
  });

  it("erro no disparo vira aviso, nao silencio", async () => {
    linhas = [tarefa()];
    erroReexec = { message: "permissao negada" };
    montar();
    await userEvent.click(await screen.findByRole("button", { name: /Reexecutar/ }));
    await waitFor(() =>
      expect(toastErrorMock).toHaveBeenCalledWith(expect.stringContaining("permissao negada")),
    );
    expect(toastSuccessMock).not.toHaveBeenCalled();
  });
});

describe("estados de borda", () => {
  it("catalogo vazio aparece como mensagem, nao como area em branco", async () => {
    linhas = [];
    montar();
    expect(await screen.findByText("Nenhuma tarefa cadastrada no catálogo.")).toBeInTheDocument();
  });

  it("falha ao ler o painel aparece na tela", async () => {
    erroPainel = { message: "rpc ausente" };
    montar();
    expect(await screen.findByText(/Não foi possível ler a saúde das tarefas/)).toBeInTheDocument();
  });
});
