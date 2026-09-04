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
    // Metade do par: vazio legitimo NAO pode acusar falha. Junto com o teste
    // seguinte, este par reprova se alguem reunificar os dois estados.
    expect(screen.queryByText(/não foi possível carregar/i)).not.toBeInTheDocument();
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

// Terceiro estado, o que faltava. Os dois testes acima ja separavam CARREGANDO
// de VAZIO; ninguem havia separado VAZIO de FALHOU. Verificado na tela, nao
// deduzido: com `permission denied` a barra lateral dizia "Nenhuma conversa
// ainda" e o fio abria sem uma unica mensagem — os dois apresentando erro de
// consulta como estado legitimo da conta.
describe("OperacaoChat — falha de consulta nao e 'nao ha nada'", () => {
  const NEGADO = {
    data: null,
    error: { message: 'permission denied for table "chat_conversations"' },
  };

  it("lista: FALHA se identifica como falha e nao como historico vazio", async () => {
    porTabela = { chat_conversations: () => Promise.resolve(NEGADO) };
    montar();

    expect(await screen.findByText(/não foi possível carregar as conversas/i)).toBeInTheDocument();
    // A frase do vazio nao pode aparecer: era ela que fazia o historico do
    // gestor parecer conta nova.
    expect(screen.queryByText(/nenhuma conversa ainda/i)).not.toBeInTheDocument();
  });

  it("lista: a falha oferece tentar de novo, e a lista aparece quando a consulta passa", async () => {
    porTabela = { chat_conversations: () => Promise.resolve(NEGADO) };
    montar();
    const botao = await screen.findByRole("button", { name: /tentar de novo/i });

    porTabela.chat_conversations = () => Promise.resolve({ data: [conversa()], error: null });
    await userEvent.setup({ delay: null }).click(botao);

    await waitFor(() =>
      expect(screen.queryByText(/não foi possível carregar as conversas/i)).not.toBeInTheDocument(),
    );
  });

  it("fio: FALHA nas mensagens nao deixa a conversa abrir muda", async () => {
    // Era o pior dos dois: uma conversa existente abria SEM NENHUMA mensagem e
    // sem aviso. O gestor podia reenviar um pedido ja feito, ou concluir que a
    // resposta que leu ontem se perdeu.
    abrirConversa([]);
    porTabela.chat_messages = () =>
      Promise.resolve({
        data: null,
        error: { message: 'permission denied for table "chat_messages"' },
      });
    montar();

    expect(
      await screen.findByText(/não foi possível carregar as mensagens desta conversa/i),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /tentar de novo/i })).toBeInTheDocument();
  });

  it("fio: conversa genuinamente sem mensagens NAO acusa falha", async () => {
    // O par do teste acima. Conversa vazia de verdade existe (recem-criada), e
    // acusar falha nela seria o defeito espelhado.
    abrirConversa([]);
    montar();
    await waitFor(() =>
      expect(screen.queryByText(/converse com o gestor de tráfego/i)).not.toBeInTheDocument(),
    );
    expect(screen.queryByText(/não foi possível carregar as mensagens/i)).not.toBeInTheDocument();
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

// ---------------------------------------------------------------------------
// A COSTURA DE RESPOSTA LONGA
//
// As DECISOES da costura ja estao defendidas em fio-chat.test.ts (isTruncated,
// needsAutoContinue, looksLikeCompleteTurn, devePararContinuacao). O que faltava
// era o LACO em volta: quem encadeia as chamadas de invoke, decide o corpo de
// cada uma, respeita o teto e — o que mais importa — o que acontece com o texto
// que JA CHEGOU quando um segmento no meio falha.
//
// Perder texto ja recebido e o pior desfecho possivel desta tela, e a costura e
// exatamente o mecanismo capaz de causar isso: sao N chamadas HTTP para produzir
// UMA resposta, e qualquer uma delas pode morrer no meio.
//
// Os quatro desfechos cobertos aqui:
//   (1) continuacao que NAO deveria parar e para  -> perde o resto da resposta;
//   (2) continuacao que DEVERIA parar e nao para  -> gasta turnos e repete bolha;
//   (3) segmento repetido / fora de ordem         -> texto duplicado na tela;
//   (4) resposta que termina no meio              -> silencio passando por fim.

/** Resposta da edge, com o desfecho fechado por padrao. */
function respostaChat(over: Record<string, unknown> = {}) {
  return {
    data: { ok: true, conversation_id: CONV, reply: "corpo", finish_reason: "stop", ...over },
    error: null,
  };
}

/** Promessa que so resolve quando o teste quiser: prova o MEIO da costura. */
function pendente<T>() {
  let resolver!: (v: T) => void;
  const promessa = new Promise<T>((r) => {
    resolver = r;
  });
  return { promessa, resolver };
}

/** Corpo da n-esima chamada de invoke (0 = o envio original). */
function corpoDaChamada(n: number) {
  return (invokeMock.mock.calls[n]?.[1] as { body?: Record<string, unknown> })?.body ?? {};
}

/**
 * Conversa aberta cujo `chat_messages` reflete o que a edge JA GRAVOU. A
 * garantia do componente e "o texto recebido ja esta gravado no banco" — sem
 * modelar isso, um teste de perda de texto nao prova nada.
 */
function conversaComBanco(gravadas: () => unknown[]) {
  buscaAtual = { conv: CONV };
  porTabela = {
    chat_conversations: () => Promise.resolve({ data: [conversa()], error: null }),
    chat_messages: () => Promise.resolve({ data: gravadas(), error: null }),
    approval_requests: () => Promise.resolve({ data: [], error: null }),
    chat_jobs: () => Promise.resolve({ data: null, error: null }),
  };
}

describe("costura por tamanho (finish_reason=length)", () => {
  it("emenda os segmentos ate a edge dizer stop, e nao alem", async () => {
    conversaComBanco(() => []);
    invokeMock
      .mockResolvedValueOnce(respostaChat({ reply: "parte 1", finish_reason: "length" }))
      .mockResolvedValueOnce(respostaChat({ reply: "parte 2", finish_reason: "length" }))
      .mockResolvedValueOnce(respostaChat({ reply: "parte 3", finish_reason: "stop" }));
    montar();
    await enviar("faca a leitura completa da semana");

    // 1 envio + 2 continuacoes. A terceira resposta veio com stop, entao o laco
    // NAO pede um quarto segmento: continuar depois de stop gasta um turno para
    // receber texto repetido.
    await waitFor(() => expect(invokeMock).toHaveBeenCalledTimes(3));
    await new Promise((r) => setTimeout(r, 80));
    expect(invokeMock).toHaveBeenCalledTimes(3);
  });

  it("a continuacao por tamanho manda o CONTINUE_PROMPT, nao a flag de checkpoint", async () => {
    // A distincao e cara: mandar `continuar: true` sem checkpoint gravado volta
    // com `aviso: sem_checkpoint` e queima o turno inteiro.
    conversaComBanco(() => []);
    invokeMock
      .mockResolvedValueOnce(respostaChat({ reply: "parte 1", finish_reason: "length" }))
      .mockResolvedValueOnce(respostaChat({ reply: "parte 2", finish_reason: "stop" }));
    montar();
    await enviar("faca a leitura completa da semana");

    await waitFor(() => expect(invokeMock).toHaveBeenCalledTimes(2));
    const corpo = corpoDaChamada(1);
    expect(String(corpo.message)).toMatch(/continue exatamente do ponto onde parou/i);
    expect(corpo.continuar).toBeUndefined();
    expect(corpo.conversation_id).toBe(CONV);
  });

  it("respeita o teto de 6 segmentos quando a edge NUNCA diz stop", async () => {
    // Desfecho (2): sem teto, uma edge que devolve `length` para sempre faria o
    // front pedir segmento indefinidamente — turnos e dinheiro sem fim.
    conversaComBanco(() => []);
    invokeMock.mockResolvedValue(
      respostaChat({ reply: "mais um pedaco", finish_reason: "length" }),
    );
    montar();
    await enviar("faca a leitura completa da semana");

    // 1 envio + MAX_CONTINUATIONS (6).
    await waitFor(() => expect(invokeMock).toHaveBeenCalledTimes(7), { timeout: 10_000 });
    await new Promise((r) => setTimeout(r, 120));
    expect(invokeMock).toHaveBeenCalledTimes(7);
  });

  it("pedido de upload em lote ganha teto maior (8), e o curto ganha teto menor (3)", async () => {
    // Prova que capContinuacoes esta LIGADO ao laco, e nao apenas testado a
    // parte: cortar um lote de criativos na 6a peca entrega menos do que o
    // gestor pediu, sem nada acusando.
    conversaComBanco(() => []);
    invokeMock.mockResolvedValue(respostaChat({ reply: "subi mais um", finish_reason: "length" }));
    montar();
    await enviar("suba os vídeos restantes da biblioteca");
    await waitFor(() => expect(invokeMock).toHaveBeenCalledTimes(9), { timeout: 12_000 });

    invokeMock.mockClear();
    invokeMock.mockResolvedValue(respostaChat({ reply: "subi mais um", finish_reason: "length" }));
    await enviar("suba os 3 vídeos pendentes");
    await waitFor(() => expect(invokeMock).toHaveBeenCalledTimes(4), { timeout: 10_000 });
  });

  it("stop na primeira resposta nao dispara costura nenhuma", async () => {
    conversaComBanco(() => []);
    invokeMock.mockResolvedValueOnce(respostaChat({ reply: "resposta curta e completa" }));
    montar();
    await enviar("quanto gastei ontem");

    await waitFor(() => expect(invokeMock).toHaveBeenCalledTimes(1));
    await new Promise((r) => setTimeout(r, 80));
    expect(invokeMock).toHaveBeenCalledTimes(1);
  });
});

describe("costura por checkpoint (continuar=true)", () => {
  it("retoma com a flag de checkpoint, e nao com o CONTINUE_PROMPT", async () => {
    conversaComBanco(() => []);
    invokeMock
      .mockResolvedValueOnce(
        respostaChat({
          reply: "primeiro trecho",
          finish_reason: "continuar_turno",
          continuar: true,
        }),
      )
      .mockResolvedValueOnce(respostaChat({ reply: "trecho final", finish_reason: "stop" }));
    montar();
    await enviar("monte os pedidos de aprovacao da semana");

    await waitFor(() => expect(invokeMock).toHaveBeenCalledTimes(2));
    const corpo = corpoDaChamada(1);
    expect(corpo.continuar).toBe(true);
    expect(corpo.message).toBeUndefined();
  });

  it("continuar=true sem finish_reason de checkpoint NAO retoma", async () => {
    // As duas condicoes sao obrigatorias. Retomar so com a flag pede segmento
    // para um turno que nao tem checkpoint gravado.
    conversaComBanco(() => []);
    invokeMock.mockResolvedValueOnce(respostaChat({ reply: "resposta", continuar: true }));
    montar();
    await enviar("quanto gastei ontem");

    await waitFor(() => expect(invokeMock).toHaveBeenCalledTimes(1));
    await new Promise((r) => setTimeout(r, 80));
    expect(invokeMock).toHaveBeenCalledTimes(1);
  });

  it("resposta que JA fecha o turno (clarificacao) nao e continuada, mesmo com continuar=true", async () => {
    // Desfecho (2) na sua forma mais irritante: o sistema pergunta algo ao
    // gestor e, em vez de esperar, continua sozinho falando com o proprio
    // checkpoint. Guarda da v28.38, aqui provada no laco.
    conversaComBanco(() => []);
    invokeMock.mockResolvedValueOnce(
      respostaChat({
        reply:
          "Antes de emitir os cards, qual objetivo você quer priorizar nesta rodada: reduzir o custo por lead ou aumentar o volume de leads?",
        finish_reason: "continuar_turno",
        continuar: true,
      }),
    );
    montar();
    await enviar("monte os pedidos de aprovacao da semana");

    await waitFor(() => expect(invokeMock).toHaveBeenCalledTimes(1));
    await new Promise((r) => setTimeout(r, 100));
    expect(invokeMock).toHaveBeenCalledTimes(1);
  });

  it("aviso 'sem_checkpoint' encerra a costura na hora", async () => {
    conversaComBanco(() => []);
    invokeMock
      .mockResolvedValueOnce(
        respostaChat({
          reply: "primeiro trecho",
          finish_reason: "continuar_turno",
          continuar: true,
        }),
      )
      // A edge avisa que nao ha checkpoint: insistir e pedir o mesmo nada de novo.
      .mockResolvedValueOnce(
        respostaChat({
          reply: "",
          aviso: "sem_checkpoint",
          finish_reason: "continuar_turno",
          continuar: true,
        }),
      );
    montar();
    await enviar("monte os pedidos de aprovacao da semana");

    await waitFor(() => expect(invokeMock).toHaveBeenCalledTimes(2));
    await new Promise((r) => setTimeout(r, 100));
    expect(invokeMock).toHaveBeenCalledTimes(2);
  });

  it("para de continuar quando o banco JA tem duas respostas substantivas no turno", async () => {
    // Esta e a trava do episodio em que o modelo anunciou seis cards que nao
    // existiam: o laco reconsulta o banco antes de cada segmento de checkpoint.
    // Aqui o banco ja mostra duas respostas -> nao pede a terceira.
    conversaComBanco(() => [
      linha("user", "monte os pedidos de aprovacao da semana"),
      linha("assistant", "Primeira parte, com o gasto por campanha da semana."),
      linha("assistant", "Segunda parte, com o custo por lead de cada conjunto."),
    ]);
    invokeMock.mockResolvedValue(
      respostaChat({ reply: "mais um trecho", finish_reason: "continuar_turno", continuar: true }),
    );
    montar();
    await enviar("monte os pedidos de aprovacao da semana");

    // Janela larga de proposito: cada iteracao do laco reconsulta o banco e
    // invalida queries, e uma espera curta daria verde mesmo com a trava
    // removida — o teste passaria sem provar nada. Medido: com a trava
    // neutralizada, o 2o invoke sai dentro desta janela.
    await waitFor(() => expect(invokeMock).toHaveBeenCalledTimes(1));
    await new Promise((r) => setTimeout(r, 900));
    expect(invokeMock).toHaveBeenCalledTimes(1);
  });
});

describe("costura interrompida no meio — o texto que chegou NAO se perde", () => {
  it("segmento que falha mostra o aviso de interrupcao, em vez de terminar em silencio", async () => {
    // Desfecho (4), o mais caro: a costura morre na 2a chamada e a tela poderia
    // simplesmente parar, indistinguivel de uma resposta que acabou.
    conversaComBanco(() => [
      linha("user", "faca a leitura completa da semana"),
      linha("assistant", "parte 1 que chegou antes da queda"),
    ]);
    invokeMock
      .mockResolvedValueOnce(
        respostaChat({ reply: "parte 1 que chegou antes da queda", finish_reason: "length" }),
      )
      .mockResolvedValueOnce({ data: null, error: { message: "Failed to fetch" } });
    montar();
    await enviar("faca a leitura completa da semana");

    expect(await screen.findByText(/a resposta foi interrompida/i)).toBeInTheDocument();
  });

  it("o texto do primeiro segmento continua na tela depois da interrupcao", async () => {
    // A garantia do componente e que o recebido esta gravado no banco. Se a
    // interrupcao levasse o texto embora, o gestor perderia a parte que JA foi
    // paga e entregue.
    conversaComBanco(() => [
      linha("user", "faca a leitura completa da semana"),
      linha("assistant", "parte 1 que chegou antes da queda"),
    ]);
    invokeMock
      .mockResolvedValueOnce(
        respostaChat({ reply: "parte 1 que chegou antes da queda", finish_reason: "length" }),
      )
      .mockResolvedValueOnce({ data: null, error: { message: "Failed to fetch" } });
    montar();
    await enviar("faca a leitura completa da semana");

    await screen.findByText(/a resposta foi interrompida/i);
    expect(screen.getByText("parte 1 que chegou antes da queda")).toBeInTheDocument();
  });

  it("segmento que volta 200 mas SEM data tambem conta como interrupcao", async () => {
    // 200 vazio e a familia de defeito deste projeto: ausencia passando por
    // sucesso. Aqui ela viraria "resposta terminou" sem nada avisando.
    conversaComBanco(() => [
      linha("user", "faca a leitura completa da semana"),
      linha("assistant", "parte 1"),
    ]);
    invokeMock
      .mockResolvedValueOnce(respostaChat({ reply: "parte 1", finish_reason: "length" }))
      .mockResolvedValueOnce({ data: null, error: null });
    montar();
    await enviar("faca a leitura completa da semana");

    expect(await screen.findByText(/a resposta foi interrompida/i)).toBeInTheDocument();
  });

  it("durante a costura, o texto ja recebido aparece na tela (nao fica escondido atras do spinner)", async () => {
    // Se o acumulado nao aparecesse, uma costura de 6 segmentos deixaria o
    // gestor 6 requisicoes olhando um spinner, sem saber que ja havia resposta.
    conversaComBanco(() => []);
    const segundo = pendente<Resposta>();
    invokeMock
      .mockResolvedValueOnce(respostaChat({ reply: "parte 1 visivel", finish_reason: "length" }))
      .mockReturnValueOnce(segundo.promessa);
    montar();
    await enviar("faca a leitura completa da semana");

    // Com a 2a chamada ainda pendurada, a bolha ao vivo mostra o que chegou.
    await waitFor(() =>
      expect(
        screen.getAllByTestId("md").some((n) => n.textContent?.includes("parte 1 visivel")),
      ).toBe(true),
    );
    // E diz que ainda esta costurando, com o contador de segmentos.
    expect(screen.getByText(/continuando a resposta… \(1\/6\)/)).toBeInTheDocument();

    segundo.resolver(respostaChat({ reply: "parte 2", finish_reason: "stop" }));
  });
});

describe("costura com segmento repetido ou fora de ordem", () => {
  it("segmento identico ao anterior nao duplica a prosa na bolha ao vivo", async () => {
    // Desfecho (3): a edge reenvia o mesmo trecho (retry interno, checkpoint
    // relido). Duplicar na tela faz a resposta parecer gaguejar e, em lote de
    // criativos, faz o gestor achar que ha peca repetida.
    conversaComBanco(() => []);
    const terceiro = pendente<Resposta>();
    invokeMock
      .mockResolvedValueOnce(
        respostaChat({
          reply: "trecho repetido",
          finish_reason: "continuar_turno",
          continuar: true,
        }),
      )
      .mockResolvedValueOnce(
        respostaChat({
          reply: "trecho repetido",
          finish_reason: "continuar_turno",
          continuar: true,
        }),
      )
      .mockReturnValueOnce(terceiro.promessa);
    montar();
    await enviar("monte os pedidos de aprovacao da semana");

    await waitFor(() => expect(invokeMock).toHaveBeenCalledTimes(3));
    const bolha = screen
      .getAllByTestId("md")
      .find((n) => n.textContent?.includes("trecho repetido"));
    expect(bolha).toBeDefined();
    // Uma ocorrencia, nao duas.
    expect(bolha!.textContent!.match(/trecho repetido/g)).toHaveLength(1);

    terceiro.resolver(respostaChat({ reply: "fim", finish_reason: "stop" }));
  });

  it("stub de progresso no meio da costura nao substitui o texto real ja recebido", async () => {
    // A edge grava stubs de progresso ("continuando automaticamente…"). Se um
    // deles sobrescrevesse o acumulado, o gestor veria a resposta REGREDIR para
    // um aviso de sistema — texto recebido perdido na tela.
    conversaComBanco(() => []);
    const terceiro = pendente<Resposta>();
    invokeMock
      .mockResolvedValueOnce(
        respostaChat({
          reply: "numeros reais do gasto da semana",
          finish_reason: "continuar_turno",
          continuar: true,
        }),
      )
      .mockResolvedValueOnce(
        respostaChat({
          reply: "Continuando automaticamente para emitir os cards restantes.",
          finish_reason: "continuar_turno",
          continuar: true,
        }),
      )
      .mockReturnValueOnce(terceiro.promessa);
    montar();
    await enviar("monte os pedidos de aprovacao da semana");

    await waitFor(() => expect(invokeMock).toHaveBeenCalledTimes(3));
    const bolhas = screen.getAllByTestId("md").map((n) => n.textContent ?? "");
    expect(bolhas.some((t) => t.includes("numeros reais do gasto da semana"))).toBe(true);

    terceiro.resolver(respostaChat({ reply: "fim", finish_reason: "stop" }));
  });
});

// ---------------------------------------------------------------------------
// O SEGUNDO LACO DE COSTURA: retomada depois de erro de HTTP
//
// Achado desta rodada. O componente tem DOIS lacos de continuacao, nao um. Este
// e o caminho de recuperacao: o gateway devolve 504 enquanto a edge ainda grava
// (medido 20/08), o front acha a resposta no banco e retoma o turno a partir do
// checkpoint. Ninguem tinha teste, e a diferenca com o laco normal era de
// comportamento, nao de forma: ele colapsava `sem_checkpoint` (fim legitimo)
// com segmento que falhou (interrupcao) num unico `break` silencioso.
//
// Ou seja: o caminho MAIS propenso a ser interrompido — porque ja entrou nele
// por causa de uma falha — era o unico que nao avisava quando era interrompido.

/** Erro de invoke com status, para o front escolher a janela de espera. */
function erroHttp(status: number) {
  return { data: null, error: { message: "FunctionsHttpError", context: { status } } };
}

/**
 * Leva a tela ao laco de recuperacao: 504 no envio + resposta JA gravada no
 * banco (user seguido de assistant) faz `waitAssistantAfterUser` achar o turno
 * e retomar em vez de falhar.
 */
function conversaRecuperavel(texto: string, gravadas: () => unknown[]) {
  conversaComBanco(gravadas);
  invokeMock.mockResolvedValueOnce(erroHttp(504));
  return texto;
}

describe("costura na retomada pos-erro-HTTP", () => {
  const TEXTO = "faca a leitura completa da semana";
  const gravado = () => [linha("user", TEXTO), linha("assistant", "parte 1 gravada antes do 504")];

  it("retoma o turno com a flag de checkpoint depois de recuperar do 504", async () => {
    conversaRecuperavel(TEXTO, gravado);
    invokeMock.mockResolvedValueOnce(respostaChat({ reply: "parte 2", finish_reason: "stop" }));
    montar();
    await enviar(TEXTO);

    // 1 envio (504) + 1 retomada. E a retomada usa a flag, nao o CONTINUE_PROMPT:
    // aqui NAO ha resposta em maos para emendar, ha checkpoint no banco.
    await waitFor(() => expect(invokeMock).toHaveBeenCalledTimes(2));
    expect(corpoDaChamada(1).continuar).toBe(true);
    // Recuperou: nao pode cair no toast de "nao foi possivel obter resposta".
    expect(toastErrorMock).not.toHaveBeenCalled();
  });

  it("retomada que falha AVISA que a resposta foi interrompida", async () => {
    // Antes desta rodada este caminho terminava calado: o laco dava break, o
    // overlay sumia e a tela ficava identica a de um turno concluido.
    conversaRecuperavel(TEXTO, gravado);
    invokeMock.mockResolvedValueOnce({ data: null, error: { message: "Failed to fetch" } });
    montar();
    await enviar(TEXTO);

    expect(await screen.findByText(/a resposta foi interrompida/i)).toBeInTheDocument();
    // E o texto que chegou antes do 504 continua na tela.
    expect(screen.getByText("parte 1 gravada antes do 504")).toBeInTheDocument();
  });

  it("retomada com 200 sem corpo tambem AVISA (ausencia nao e conclusao)", async () => {
    conversaRecuperavel(TEXTO, gravado);
    invokeMock.mockResolvedValueOnce({ data: null, error: null });
    montar();
    await enviar(TEXTO);

    expect(await screen.findByText(/a resposta foi interrompida/i)).toBeInTheDocument();
  });

  it("'sem_checkpoint' encerra SEM acusar interrupcao — fim legitimo e coisa diferente", async () => {
    // O par do teste acima, e a razao de os tres desfechos nao poderem viver no
    // mesmo `if`: nao havia o que retomar, entao nada foi interrompido. Avisar
    // aqui seria alarme falso, e alarme falso e o que faz aviso verdadeiro ser
    // ignorado depois.
    conversaRecuperavel(TEXTO, gravado);
    invokeMock.mockResolvedValueOnce(respostaChat({ reply: "", aviso: "sem_checkpoint" }));
    montar();
    await enviar(TEXTO);

    await waitFor(() => expect(invokeMock).toHaveBeenCalledTimes(2));
    await new Promise((r) => setTimeout(r, 200));
    expect(screen.queryByText(/a resposta foi interrompida/i)).not.toBeInTheDocument();
  });

  it("para de retomar quando o banco JA tem duas respostas substantivas", async () => {
    conversaRecuperavel(TEXTO, () => [
      linha("user", TEXTO),
      linha("assistant", "Primeira parte, com o gasto por campanha da semana."),
      linha("assistant", "Segunda parte, com o custo por lead de cada conjunto."),
    ]);
    invokeMock.mockResolvedValue(
      respostaChat({ reply: "mais um trecho", finish_reason: "continuar_turno", continuar: true }),
    );
    montar();
    await enviar(TEXTO);

    // Recuperou e NAO pediu segmento: o turno ja tem duas respostas no banco.
    await waitFor(() => expect(invokeMock).toHaveBeenCalledTimes(1));
    await new Promise((r) => setTimeout(r, 900));
    expect(invokeMock).toHaveBeenCalledTimes(1);
  });
});
