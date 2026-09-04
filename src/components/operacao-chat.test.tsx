import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { TooltipProvider } from "@/components/ui/tooltip";
import { OperacaoChat } from "./operacao-chat";

// OperacaoChat e a tela por onde o gestor conversa com o sistema. O que estes
// testes protegem NAO e a aparencia: e o que a tela diz quando o back-end falha,
// devolve vazio ou nao devolve nada.
//
// O modo de falha mais caro aqui e silencio: a pergunta sai, nada volta, e a tela
// fica igual a "respondido". Os casos abaixo cobrem essa familia —
//   (a) carregando x nao ha nada (a versao visual de ausencia-vira-aprovacao);
//   (b) erro do back-end: o texto do gestor volta para o campo em vez de sumir;
//   (c) retorno 200 SEM job_id / SEM reply, que nao pode passar por sucesso;
//   (d) turno orfao: o cartao de falha vem do BANCO, nao do estado local;
//   (e) aprovacao: cartao que nao renderiza e ato sem portao, e RPC recusada
//       precisa desfazer o otimismo, senao o gestor acredita ter sancionado o
//       que o banco recusou.
//
// ActionCard, JobProgressCard e Markdown entram dublados: cada um tem (ou merece)
// teste proprio, e aqui eles so precisam ser observaveis.

type Resposta = { data: unknown; error: unknown };

const EMPRESA = "8f1e2c3d-4a5b-6c7d-8e9f-0a1b2c3d4e5f";
const CONV = "c0nv-1111";

let porTabela: Record<string, () => Promise<Resposta>> = {};
let buscaAtual: { conv?: string; reco?: string } = {};
let ehAdmin = true;
const invokeMock = vi.fn();
const navigateMock = vi.fn();
const decideApprovalMock = vi.fn();
const reexecutarApprovalMock = vi.fn();
const toastErrorMock = vi.fn();
const toastSuccessMock = vi.fn();

vi.mock("@/integrations/supabase/client", () => {
  // Construtor encadeavel e "awaitable": as consultas do chat terminam em
  // .order(), .limit() ou .maybeSingle(), e todas precisam resolver.
  const construir = (tabela: string) => {
    const resolver = (): Promise<Resposta> => {
      const f = porTabela[tabela];
      return f ? f() : Promise.resolve({ data: [], error: null });
    };
    const alvo: Record<string, unknown> = {
      maybeSingle: () => resolver(),
      single: () => resolver(),
      then: (ok?: never, err?: never) => resolver().then(ok, err),
    };
    for (const m of ["select", "eq", "gte", "lte", "order", "limit", "in"]) {
      alvo[m] = () => alvo;
    }
    return alvo;
  };
  return {
    supabase: {
      from: (t: string) => construir(t),
      functions: { invoke: (...a: unknown[]) => invokeMock(...a) },
      channel: () => ({ on: () => ({ subscribe: () => ({ topic: "chat" }) }) }),
      removeChannel: () => {},
    },
  };
});

vi.mock("@/lib/app-context", () => ({
  useApp: () => ({ selectedCompany: { id: EMPRESA, name: "Acme" }, isAdmin: ehAdmin }),
}));

vi.mock("@tanstack/react-router", () => ({
  useNavigate: () => navigateMock,
  useSearch: () => buscaAtual,
}));

vi.mock("@/hooks/use-dictation", () => ({
  useDictation: () => ({
    state: "idle",
    analyser: null,
    elapsedMs: 0,
    start: vi.fn(),
    stop: vi.fn(),
    cancel: vi.fn(),
  }),
}));

vi.mock("@/components/markdown", () => ({
  Markdown: ({ children }: { children?: string }) => <div data-testid="md">{children}</div>,
}));

vi.mock("./approvals-queue", () => ({ APPROVAL_SELECT: "id, status, summary" }));

vi.mock("./action-card", () => ({
  decideApproval: (...a: unknown[]) => decideApprovalMock(...a),
  reexecutarApproval: (...a: unknown[]) => reexecutarApprovalMock(...a),
  ActionCard: ({
    approval,
    isAdmin,
    deciding,
    onDecide,
    onRetry,
  }: {
    approval: { id: string; summary: string; status: string };
    isAdmin: boolean;
    deciding: boolean;
    onDecide: (id: string, d: "approved" | "rejected", reason?: string) => void;
    onRetry: (id: string) => void;
  }) => (
    <div data-testid="card" data-id={approval.id} data-status={approval.status}>
      <span>{approval.summary}</span>
      <button disabled={!isAdmin || deciding} onClick={() => onDecide(approval.id, "approved")}>
        {`aprovar ${approval.id}`}
      </button>
      <button disabled={!isAdmin || deciding} onClick={() => onRetry(approval.id)}>
        {`retry ${approval.id}`}
      </button>
    </div>
  ),
}));

vi.mock("./job-progress-card", () => ({
  JobProgressCard: ({
    jobId,
    onDone,
    onResend,
  }: {
    jobId: string;
    onDone: () => void;
    onResend: () => void;
  }) => (
    <div data-testid="job" data-job={jobId}>
      <button onClick={onDone}>job concluiu</button>
      <button onClick={onResend}>job reenviar</button>
    </div>
  ),
}));

vi.mock("sonner", () => ({
  toast: Object.assign((...a: unknown[]) => toastErrorMock(...a), {
    error: (...a: unknown[]) => toastErrorMock(...a),
    success: (...a: unknown[]) => toastSuccessMock(...a),
  }),
}));

// --- fixtures ---------------------------------------------------------------

let seq = 0;
function linha(role: string, content: string | null, over: Record<string, unknown> = {}) {
  seq += 1;
  return {
    id: `m${seq}`,
    role,
    content,
    tool_calls: null,
    attachments: null,
    model: null,
    created_at: new Date().toISOString(),
    ...over,
  };
}

const haMinutos = (n: number) => new Date(Date.now() - n * 60_000).toISOString();

function conversa(over: Record<string, unknown> = {}) {
  return { id: CONV, title: "Leitura da semana", updated_at: haMinutos(5), ...over };
}

function aprovacao(over: Record<string, unknown> = {}) {
  return {
    id: "ap1",
    status: "pending",
    summary: "Escalar orçamento em 20%",
    conversation_id: CONV,
    ...over,
  };
}

/** Resolve so quando alguem quiser: prova isLoading DE VERDADE. */
const nuncaResolve = () => new Promise<Resposta>(() => {});

function montar() {
  // retry: false para um erro de query nao virar espera de backoff no teste.
  // TooltipProvider porque os botoes do compositor usam Tooltip do Radix, que
  // exige o provider — em producao ele vem do app-shell, nao deste componente.
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const Wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={qc}>
      <TooltipProvider>{children}</TooltipProvider>
    </QueryClientProvider>
  );
  return { qc, ...render(<OperacaoChat />, { wrapper: Wrapper }) };
}

/**
 * Digita e envia. `delay: null` de proposito: cada tecla re-renderiza um
 * componente de 1750 linhas (mais o useEffect de auto-grow do textarea), e o
 * atraso default entre teclas multiplicava isso por 20 numa maquina que ja esta
 * paginando. Sem o atraso o arquivo inteiro cai de ~62 s para a casa dos 20 s.
 */
async function enviar(texto: string) {
  const user = userEvent.setup({ delay: null });
  const campo = await screen.findByPlaceholderText(/pergunte/i);
  await user.type(campo, texto);
  await user.click(screen.getByRole("button", { name: "Enviar" }));
}

/** Abre a conversa pelo ?conv=<id> (o mesmo caminho do link do cartao). */
function abrirConversa(msgs: unknown[], extras: Record<string, () => Promise<Resposta>> = {}) {
  buscaAtual = { conv: CONV };
  porTabela = {
    chat_conversations: () => Promise.resolve({ data: [conversa()], error: null }),
    chat_messages: () => Promise.resolve({ data: msgs, error: null }),
    approval_requests: () => Promise.resolve({ data: [], error: null }),
    chat_jobs: () => Promise.resolve({ data: null, error: null }),
    ...extras,
  };
}

beforeEach(() => {
  porTabela = {};
  buscaAtual = {};
  ehAdmin = true;
  invokeMock.mockReset();
  navigateMock.mockReset();
  decideApprovalMock.mockReset();
  decideApprovalMock.mockResolvedValue({ error: null });
  reexecutarApprovalMock.mockReset();
  reexecutarApprovalMock.mockResolvedValue({ error: null });
  toastErrorMock.mockReset();
  toastSuccessMock.mockReset();
  if (!URL.createObjectURL) {
    URL.createObjectURL = () => "blob:fake";
    URL.revokeObjectURL = () => {};
  }
});

// ---------------------------------------------------------------------------

describe("OperacaoChat — carregando nao e 'nao ha nada'", () => {
  it("lista de conversas mostra esqueleto enquanto carrega, nao o vazio", async () => {
    // Dizer "Nenhuma conversa ainda" durante a carga faz o gestor achar que o
    // historico foi perdido. Sao dois estados diferentes e a tela precisa
    // distinguir.
    porTabela = { chat_conversations: nuncaResolve };
    const { container } = montar();
    await new Promise((r) => setTimeout(r, 50));
    expect(screen.queryByText(/nenhuma conversa ainda/i)).not.toBeInTheDocument();
    expect(container.querySelectorAll(".animate-pulse").length).toBeGreaterThan(0);
  });

  it("lista mostra o vazio quando a busca volta sem linhas", async () => {
    porTabela = { chat_conversations: () => Promise.resolve({ data: [], error: null }) };
    montar();
    expect(await screen.findByText(/nenhuma conversa ainda/i)).toBeInTheDocument();
  });

  it("sem conversa aberta mostra o convite, nao esqueleto de mensagem", async () => {
    porTabela = { chat_conversations: () => Promise.resolve({ data: [conversa()], error: null }) };
    montar();
    expect(await screen.findByText(/converse com o gestor de tráfego/i)).toBeInTheDocument();
    expect(screen.queryByText(/a resposta não chegou/i)).not.toBeInTheDocument();
  });

  it("conversa aberta com mensagens carregando mostra esqueleto, nao o convite", async () => {
    abrirConversa([]);
    porTabela.chat_messages = nuncaResolve;
    const { container } = montar();
    await waitFor(() =>
      expect(screen.queryByText(/converse com o gestor de tráfego/i)).not.toBeInTheDocument(),
    );
    expect(container.querySelectorAll(".animate-pulse").length).toBeGreaterThan(0);
    // O ponto: nada de cartao de falha nem de "nada aqui" enquanto carrega.
    expect(screen.queryByText(/a resposta não chegou/i)).not.toBeInTheDocument();
  });
});

describe("OperacaoChat — turno orfao vem do banco, nao do estado local", () => {
  // Estes casos nao enviam nada: provam que quem apenas ABRE a conversa (outra
  // aba, F5, volta de navegacao) tambem ve o desfecho. Antes disso o estado
  // vivia so na memoria de quem enviou.
  it("pergunta sem resposta ha mais de 2 min mostra falha e oferece reenviar", async () => {
    abrirConversa([linha("user", "faça a leitura da semana", { created_at: haMinutos(3) })]);
    montar();
    expect(await screen.findByText(/a resposta não chegou/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /reenviar pergunta/i })).toBeInTheDocument();
    // Nao pode dizer que ainda esta analisando: passou do orcamento.
    expect(screen.queryByText(/analisando os dados/i)).not.toBeInTheDocument();
  });

  it("pergunta recente mostra 'analisando', nao falha", async () => {
    abrirConversa([linha("user", "faça a leitura da semana", { created_at: haMinutos(0.5) })]);
    montar();
    expect(await screen.findByText(/analisando os dados/i)).toBeInTheDocument();
    expect(screen.queryByText(/a resposta não chegou/i)).not.toBeInTheDocument();
  });

  it("resposta substantiva no fio tira o cartao de falha", async () => {
    abrirConversa([
      linha("user", "faça a leitura", { created_at: haMinutos(9) }),
      linha("assistant", "O gasto de ontem foi R$ 412,80.", { created_at: haMinutos(8) }),
    ]);
    montar();
    await screen.findByText(/gasto de ontem/i);
    expect(screen.queryByText(/a resposta não chegou/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/analisando os dados/i)).not.toBeInTheDocument();
  });

  it("stub de falha do job NAO conta como resposta: falha e reenvio continuam", async () => {
    // O job grava esse texto no catch. Se contasse como resposta, o turno
    // apareceria concluido tendo falhado — o sistema afirmando ter feito o que
    // nao fez.
    abrirConversa([
      linha("user", "faça a leitura", { created_at: haMinutos(9) }),
      linha("assistant", "O processamento em segundo plano falhou.", {
        created_at: haMinutos(8),
      }),
    ]);
    porTabela.chat_jobs = () =>
      Promise.resolve({
        data: { id: "job9", message: "faça a leitura", status: "error", erro: "sintese_vazia" },
        error: null,
      });
    montar();
    // Cartao do job segue em cena (com Reenviar), em vez de sumir calado.
    expect(await screen.findByTestId("job")).toHaveAttribute("data-job", "job9");
  });

  it("job com resposta real ja no fio nao mostra mais o cartao", async () => {
    abrirConversa([
      linha("user", "faça a leitura", { created_at: haMinutos(9) }),
      linha("assistant", "Segue a leitura completa da semana.", { created_at: haMinutos(8) }),
    ]);
    porTabela.chat_jobs = () =>
      Promise.resolve({
        data: { id: "job9", message: "faça a leitura", status: "error", erro: "x" },
        error: null,
      });
    montar();
    await screen.findByText(/leitura completa da semana/i);
    expect(screen.queryByTestId("job")).not.toBeInTheDocument();
  });
});

describe("OperacaoChat — erro do back-end nao pode virar silencio", () => {
  it("erro no invoke devolve o texto ao campo e avisa com a mensagem do corpo", async () => {
    // Conversa NOVA de proposito: sem conversation_id o front nao tem onde
    // esperar a gravacao, entao este e o caminho de erro puro.
    porTabela = { chat_conversations: () => Promise.resolve({ data: [], error: null }) };
    invokeMock.mockResolvedValue({
      data: null,
      error: {
        message: "Edge Function returned a non-2xx status code",
        context: { status: 500, json: async () => ({ error: "limite diário da conta atingido" }) },
      },
    });
    montar();
    await enviar("quanto gastei ontem");

    await waitFor(() =>
      expect(toastErrorMock).toHaveBeenCalledWith("limite diário da conta atingido"),
    );
    // O que o gestor digitou NAO pode ser engolido pela falha.
    expect(await screen.findByDisplayValue("quanto gastei ontem")).toBeInTheDocument();
  });

  it("erro sem corpo JSON cai na mensagem generica, sem estourar", async () => {
    porTabela = { chat_conversations: () => Promise.resolve({ data: [], error: null }) };
    invokeMock.mockResolvedValue({
      data: null,
      error: {
        message: "Failed to fetch",
        context: {
          status: 502,
          json: async () => {
            throw new Error("corpo nao-JSON");
          },
        },
      },
    });
    montar();
    await enviar("e o CPL de ontem");

    await waitFor(() =>
      expect(toastErrorMock).toHaveBeenCalledWith(
        "Não foi possível obter resposta agora. Tente novamente.",
      ),
    );
    expect(await screen.findByDisplayValue("e o CPL de ontem")).toBeInTheDocument();
  });

  it("excecao no invoke tambem devolve o texto e avisa", async () => {
    porTabela = { chat_conversations: () => Promise.resolve({ data: [], error: null }) };
    invokeMock.mockRejectedValue(new Error("Failed to fetch"));
    montar();
    await enviar("resume a semana");

    await waitFor(() => expect(toastErrorMock).toHaveBeenCalled());
    expect(String(toastErrorMock.mock.calls[0][0])).toMatch(/demorou demais|erro de conexão/i);
    expect(await screen.findByDisplayValue("resume a semana")).toBeInTheDocument();
  });

  it("HTTP falhou mas a edge ja tinha gravado: recupera em vez de acusar erro", async () => {
    // Medido em 20/08: HTTP 504 as 13:27:06 e a assistant no banco as 13:27:27.
    // Falhar na hora jogaria fora uma resposta que existe.
    const texto = "faça a leitura da semana";
    abrirConversa([
      linha("user", texto),
      linha("assistant", "Primeira parte: o gasto por campanha."),
      linha("assistant", "Segunda parte: o custo por lead."),
    ]);
    invokeMock.mockResolvedValue({
      data: null,
      error: { message: "504 Gateway Timeout", context: { status: 502, json: async () => ({}) } },
    });
    montar();
    await enviar(texto);

    // Achou a resposta gravada: nada de toast de erro nem de campo repovoado.
    await waitFor(() => expect(screen.queryByDisplayValue(texto)).not.toBeInTheDocument());
    expect(toastErrorMock).not.toHaveBeenCalled();
  });
});

describe("OperacaoChat — 200 sem conteudo nao e sucesso", () => {
  it("analise profunda que volta sem job_id avisa e devolve o texto", async () => {
    // O fail-open classico: `error` nulo e corpo sem job_id. Se a guarda olhasse
    // so o erro, a tela ficaria sem cartao, sem resposta e sem aviso.
    porTabela = { chat_conversations: () => Promise.resolve({ data: [], error: null }) };
    invokeMock.mockResolvedValue({ data: { ok: true, conversation_id: CONV }, error: null });
    montar();
    await userEvent.click(screen.getByRole("button", { name: /análise profunda/i }));
    await enviar("investigue a dispersão do CPL");

    await waitFor(() =>
      expect(toastErrorMock).toHaveBeenCalledWith(
        "Não foi possível iniciar a análise profunda. Tente novamente.",
      ),
    );
    expect(await screen.findByDisplayValue("investigue a dispersão do CPL")).toBeInTheDocument();
    expect(screen.queryByTestId("job")).not.toBeInTheDocument();
  });

  it("edge encaminhou para job: abre o cartao de progresso em vez de nada", async () => {
    // async=true vem SEM reply. Sem o cartao, a tela ficaria muda esperando o
    // Realtime — o silencio que este produto nao pode ter.
    abrirConversa([linha("user", "investigue a dispersão do CPL")]);
    invokeMock.mockResolvedValue({
      data: { ok: true, conversation_id: CONV, async: true, job_id: "job42" },
      error: null,
    });
    montar();
    await enviar("investigue a dispersão do CPL");

    await waitFor(() => expect(screen.getByTestId("job")).toHaveAttribute("data-job", "job42"));
  });

  it("cartao do job oferece reenvio e dispara novo envio", async () => {
    abrirConversa([linha("user", "investigue a dispersão", { created_at: haMinutos(4) })]);
    porTabela.chat_jobs = () =>
      Promise.resolve({
        data: { id: "job7", message: "investigue a dispersão", status: "running", erro: null },
        error: null,
      });
    invokeMock.mockResolvedValue({
      data: {
        ok: true,
        conversation_id: CONV,
        reply: "Segue a investigação.",
        finish_reason: "stop",
      },
      error: null,
    });
    montar();
    await screen.findByTestId("job");
    await userEvent.click(screen.getByRole("button", { name: /job reenviar/i }));
    await waitFor(() => expect(invokeMock).toHaveBeenCalled());
    // Reenviou o texto do job, nao o campo vazio.
    expect(invokeMock.mock.calls[0][1]).toMatchObject({
      body: expect.objectContaining({ message: "investigue a dispersão" }),
    });
  });
});

describe("OperacaoChat — aprovacao: cartao invisivel e ato sem portao", () => {
  it("marcador de action_card com pedido no banco renderiza o cartao", async () => {
    abrirConversa([
      linha("user", "escale o orçamento"),
      linha("assistant", "Proponho escalar 20%.", {
        attachments: [{ tipo: "action_card", approval_id: "ap1" }],
      }),
    ]);
    porTabela.approval_requests = () => Promise.resolve({ data: [aprovacao()], error: null });
    montar();
    expect(await screen.findByTestId("card")).toHaveAttribute("data-id", "ap1");
  });

  it("marcador sem pedido correspondente no banco nao inventa cartao", async () => {
    abrirConversa([
      linha("user", "escale o orçamento"),
      linha("assistant", "Proponho escalar 20%.", {
        attachments: [{ tipo: "action_card", approval_id: "fantasma" }],
      }),
    ]);
    porTabela.approval_requests = () => Promise.resolve({ data: [], error: null });
    montar();
    await screen.findByText(/proponho escalar/i);
    expect(screen.queryByTestId("card")).not.toBeInTheDocument();
  });

  it("aprovar leva a decisao ao banco e a tela fica com o status recarregado", async () => {
    // O banco falso ACEITA a decisao, como o de verdade faria: assim o teste
    // cobre o caminho inteiro (otimismo -> RPC -> invalidacao -> refetch) em vez
    // de parar no otimismo. Se a invalidacao sumisse, a tela ficaria mostrando
    // um status que ninguem confirmou.
    let statusNoBanco = "pending";
    abrirConversa([
      linha("assistant", "Proponho escalar 20%.", {
        attachments: [{ tipo: "action_card", approval_id: "ap1" }],
      }),
    ]);
    porTabela.approval_requests = () =>
      Promise.resolve({ data: [aprovacao({ status: statusNoBanco })], error: null });
    decideApprovalMock.mockImplementation(async (_id: string, decisao: string) => {
      statusNoBanco = decisao;
      return { error: null };
    });
    montar();
    await screen.findByTestId("card");
    await userEvent.click(screen.getByRole("button", { name: /aprovar ap1/i }));

    await waitFor(() => expect(toastSuccessMock).toHaveBeenCalledWith("Pedido aprovado"));
    expect(decideApprovalMock).toHaveBeenCalledWith("ap1", "approved", undefined);
    await waitFor(() =>
      expect(screen.getByTestId("card")).toHaveAttribute("data-status", "approved"),
    );
  });

  it("RPC recusada DESFAZ o otimismo — o cartao volta a pendente", async () => {
    // Sem o rollback o cartao fica "approved" na tela e o gestor acredita ter
    // sancionado o que o banco recusou. E dinheiro em conta de anuncio real.
    abrirConversa([
      linha("assistant", "Proponho escalar 20%.", {
        attachments: [{ tipo: "action_card", approval_id: "ap1" }],
      }),
    ]);
    porTabela.approval_requests = () => Promise.resolve({ data: [aprovacao()], error: null });
    decideApprovalMock.mockResolvedValue({ error: "somente admin decide" });
    montar();
    await screen.findByTestId("card");
    await userEvent.click(screen.getByRole("button", { name: /aprovar ap1/i }));

    await waitFor(() => expect(toastErrorMock).toHaveBeenCalledWith("somente admin decide"));
    expect(screen.getByTestId("card")).toHaveAttribute("data-status", "pending");
    expect(toastSuccessMock).not.toHaveBeenCalled();
  });

  it("nova tentativa recusada avisa e nao finge sucesso", async () => {
    abrirConversa([
      linha("assistant", "Proponho escalar 20%.", {
        attachments: [{ tipo: "action_card", approval_id: "ap1" }],
      }),
    ]);
    porTabela.approval_requests = () =>
      Promise.resolve({ data: [aprovacao({ status: "failed" })], error: null });
    reexecutarApprovalMock.mockResolvedValue({ error: "execução indisponível" });
    montar();
    await screen.findByTestId("card");
    await userEvent.click(screen.getByRole("button", { name: /retry ap1/i }));

    await waitFor(() => expect(toastErrorMock).toHaveBeenCalledWith("execução indisponível"));
    expect(toastSuccessMock).not.toHaveBeenCalled();
  });

  it("nao-admin nao consegue decidir pela tela", async () => {
    ehAdmin = false;
    abrirConversa([
      linha("assistant", "Proponho escalar 20%.", {
        attachments: [{ tipo: "action_card", approval_id: "ap1" }],
      }),
    ]);
    porTabela.approval_requests = () => Promise.resolve({ data: [aprovacao()], error: null });
    montar();
    await screen.findByTestId("card");
    expect(screen.getByRole("button", { name: /aprovar ap1/i })).toBeDisabled();
  });
});

describe("OperacaoChat — compositor", () => {
  it("nao envia mensagem vazia", async () => {
    porTabela = { chat_conversations: () => Promise.resolve({ data: [], error: null }) };
    montar();
    await screen.findByPlaceholderText(/pergunte/i);
    await userEvent.click(screen.getByRole("button", { name: /enviar/i }));
    expect(invokeMock).not.toHaveBeenCalled();
  });

  it("anexo acima de 8MB e recusado com aviso", async () => {
    porTabela = { chat_conversations: () => Promise.resolve({ data: [], error: null }) };
    const { container } = montar();
    await screen.findByPlaceholderText(/pergunte/i);
    const entrada = container.querySelector('input[type="file"]') as HTMLInputElement;
    const grande = new File(["x".repeat(10)], "planilha.csv", { type: "text/csv" });
    Object.defineProperty(grande, "size", { value: 9 * 1024 * 1024 });
    await userEvent.upload(entrada, grande);
    await waitFor(() => expect(toastErrorMock).toHaveBeenCalledWith('"planilha.csv" excede 8MB.'));
    expect(screen.queryByText(/planilha\.csv/)).not.toBeInTheDocument();
  });
});
