import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";

// Lista vazia ≠ falha de carga; análise que falhou tem de aparecer, não sumir.

let ctx = {
  selectedCompany: { id: "c1", name: "JCR2", industry: null } as {
    id: string;
    name: string;
    industry: string | null;
  } | null,
  selectedCompanyId: "c1" as string | null,
  isAdmin: true,
};

let linhas: Record<string, unknown>[] = [];
let erroLista: unknown = null;
let campanhaEspelho: Record<string, unknown> | null = {
  id: "camp-uuid",
  external_account_id: "act_1",
};
let snapshots: Record<string, unknown>[] = [];
const fromMock = vi.fn();
const rpcMock = vi.fn();
const invokeMock = vi.fn();
const toastErrorMock = vi.fn();
const toastSuccessMock = vi.fn();
const logAuditMock = vi.fn();
const channelMock = {
  on: vi.fn().mockReturnThis(),
  subscribe: vi.fn().mockReturnThis(),
};

let searchAtual: { item?: string } = {};

vi.mock("@tanstack/react-router", () => ({
  createFileRoute: () => (opts: Record<string, unknown>) => ({ options: opts }),
  useSearch: () => searchAtual,
}));

vi.mock("@/lib/app-context", () => ({
  useApp: () => ctx,
  logAudit: (...a: unknown[]) => logAuditMock(...a),
}));

vi.mock("sonner", () => ({
  toast: {
    error: (...a: unknown[]) => toastErrorMock(...a),
    success: (...a: unknown[]) => toastSuccessMock(...a),
  },
}));

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    from: (...a: unknown[]) => fromMock(...a),
    rpc: (...a: unknown[]) => rpcMock(...a),
    functions: { invoke: (...a: unknown[]) => invokeMock(...a) },
    channel: () => channelMock,
    removeChannel: vi.fn(),
  },
}));

vi.mock("@/components/metric-card", () => ({
  EmptyCompany: () => <div data-testid="empty-company" />,
}));

import { addDaysYmd, hojeYmdBrasilia } from "@/lib/relatorios";
import { Route } from "./ritmo";

const Ritmo = (Route.options as unknown as { component: () => ReactNode }).component;

function encadear(data: unknown, error: unknown = null) {
  const result = Promise.resolve({ data, error });
  const q: {
    select: () => unknown;
    eq: () => unknown;
    order: () => unknown;
    gte: () => unknown;
    lte: () => unknown;
    maybeSingle: () => typeof result;
    then: typeof result.then;
  } = {
    select: () => q,
    eq: () => q,
    order: () => q,
    gte: () => q,
    lte: () => q,
    maybeSingle: () => result,
    then: result.then.bind(result),
  };
  return q;
}

function montar() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<Ritmo />, {
    wrapper: ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={qc}>{children}</QueryClientProvider>
    ),
  });
}

function missaoFalhou(): Record<string, unknown> {
  return {
    id: "m1",
    company_id: "c1",
    campaign_id: "120",
    campaign_name: "Consignado SP",
    ad_account_id: null,
    status: "analise_falhou",
    periodo_inicio: "2026-09-10",
    periodo_fim: "2026-09-20",
    metrica: "conversas",
    dissertacao: "subir conversas",
    sonho: null,
    extra_investimento: 0,
    teto_gasto_janela: null,
    erro_analise: "timeout",
    criado_em: "2026-09-10T11:00:00Z",
  };
}

function missaoPlanoPronto(): Record<string, unknown> {
  return {
    id: "m2",
    company_id: "c1",
    campaign_id: "120",
    campaign_name: "Consignado SP",
    ad_account_id: "act_1",
    status: "plano_pronto",
    periodo_inicio: "2026-09-10",
    periodo_fim: "2026-09-20",
    metrica: "conversas",
    dissertacao: "subir conversas",
    sonho: 50,
    extra_investimento: 0,
    teto_gasto_janela: 110,
    autonomia_concedida_em: null,
    erro_analise: null,
    criado_em: "2026-09-10T11:00:00Z",
    plano_json: {
      leitura: { texto: "Campanha ativa, learning ok." },
      baseline: { gasto_diario: 10, janela: "7d_com_gasto", dias_usados: 7, confianca: "alta" },
      teto_janela: 110,
      possibilidades: {
        nada_muda: { d3: 5, d7: 10, d15: 20, d30: 40 },
        plano: { d3: 12, d7: 24, d15: 40, d30: 80 },
        maximo_envelope: { d3: 15, d7: 30, d15: 50, d30: 90 },
      },
      sonho: { valor: 50, atingivel_no_prazo: true, nota: null },
      atos: [
        {
          acao: "pausar_criativo",
          alvo_external_id: "ad1",
          quando: "imediato",
          evidencia: "CTR caiu",
          mecanismo: "fadiga do criativo",
          metrica_sucesso: "CTR 2%",
          janela_leitura: "3 dias",
          reversa: "reativar o anúncio",
        },
      ],
      recusas: [],
      lacunas: ["sem reach único do período"],
      premissas: [],
    },
  };
}

beforeEach(() => {
  ctx = {
    selectedCompany: { id: "c1", name: "JCR2", industry: null },
    selectedCompanyId: "c1",
    isAdmin: true,
  };
  searchAtual = {};
  linhas = [];
  erroLista = null;
  campanhaEspelho = { id: "camp-uuid", external_account_id: "act_1" };
  snapshots = [];
  toastErrorMock.mockReset();
  toastSuccessMock.mockReset();
  logAuditMock.mockReset();
  channelMock.on.mockClear();
  channelMock.subscribe.mockClear();
  fromMock.mockImplementation((tabela: string) => {
    if (tabela === "ritmo_missoes") return encadear(linhas, erroLista);
    if (tabela === "campaigns") return encadear(campanhaEspelho);
    if (tabela === "metric_snapshots") return encadear(snapshots);
    if (tabela === "ritmo_atos") return encadear([]);
    if (tabela === "meta_execution_config") return encadear({ dry_run: false });
    return encadear([]);
  });
  rpcMock.mockImplementation(async (nome: string) => {
    if (nome === "listar_campanhas_para_relatorio") {
      return {
        data: [
          {
            external_id: "120",
            nome: "Consignado SP",
            status: "ACTIVE",
            objetivo: null,
            tipo: null,
            gasto: 0,
            last_synced_at: null,
          },
        ],
        error: null,
      };
    }
    if (nome === "enfileirar_ritmo_analise") {
      return { data: "nova-missao-id", error: null };
    }
    if (nome === "reenviar_ritmo_analise") {
      return { data: "m1", error: null };
    }
    if (nome === "encerrar_ritmo_missao") {
      return { data: { ok: true }, error: null };
    }
    if (nome === "autorizar_ritmo_missao") {
      return { data: { ok: true }, error: null };
    }
    return { data: null, error: null };
  });
  invokeMock.mockImplementation(async (nome: string) => {
    if (nome === "pipeboard-read") return { data: { ok: false }, error: null };
    return { data: { ok: true }, error: null };
  });
});

describe("Ritmo", () => {
  it("pede empresa quando nenhuma está selecionada", () => {
    ctx.selectedCompany = null;
    ctx.selectedCompanyId = null;
    montar();
    expect(screen.getByTestId("empty-company")).toBeInTheDocument();
  });

  it("mostra o título quando há empresa selecionada", async () => {
    montar();
    expect(screen.getByRole("heading", { name: "Ritmo" })).toBeInTheDocument();
    expect(
      screen.getByText("Força-tarefa da campanha, com uma autorização."),
    ).toBeInTheDocument();
    expect(await screen.findByText("Nenhuma força-tarefa nesta empresa")).toBeInTheDocument();
  });

  it("lista vazia mostra o convite e o botão de nova força-tarefa", async () => {
    montar();
    expect(await screen.findByText("Nenhuma força-tarefa nesta empresa")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Nova força-tarefa" })).toBeInTheDocument();
  });

  it("mostra o erro da análise falha em vez de silêncio", async () => {
    linhas = [missaoFalhou()];
    montar();
    expect((await screen.findAllByText("timeout")).length).toBeGreaterThan(0);
    expect(screen.getAllByText("Análise falhou").length).toBeGreaterThan(0);
    expect(screen.queryByText("Nenhuma força-tarefa nesta empresa")).not.toBeInTheDocument();
  });

  it("falha de carga das missões não finge lista vazia", async () => {
    erroLista = { message: "consulta recusada" };
    montar();
    expect(
      await screen.findByText(/não foi possível carregar as forças-tarefa/i),
    ).toBeInTheDocument();
    expect(screen.queryByText("Nenhuma força-tarefa nesta empresa")).not.toBeInTheDocument();
  });

  it("visualizador não vê o botão de nova força-tarefa", async () => {
    ctx.isAdmin = false;
    montar();
    expect(await screen.findByText("Nenhuma força-tarefa nesta empresa")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Nova força-tarefa" })).not.toBeInTheDocument();
  });

  it("submit sem campanha avisa em português", async () => {
    montar();
    await userEvent.click(await screen.findByRole("button", { name: "Nova força-tarefa" }));
    await userEvent.click(screen.getByRole("button", { name: "Criar força-tarefa" }));
    expect(toastErrorMock).toHaveBeenCalledWith("Escolha uma campanha ativa.");
  });

  it("submit válido enfileira a análise e dispara o job", async () => {
    montar();
    await userEvent.click(await screen.findByRole("button", { name: "Nova força-tarefa" }));
    await screen.findByRole("option", { name: "Consignado SP" });
    await userEvent.selectOptions(screen.getByLabelText("Campanha"), "120");
    await userEvent.type(screen.getByLabelText("Dissertação"), "subir conversas");
    await userEvent.click(screen.getByRole("button", { name: "Criar força-tarefa" }));
    await waitFor(() => {
      expect(rpcMock).toHaveBeenCalledWith(
        "enfileirar_ritmo_analise",
        expect.objectContaining({
          p_company_id: "c1",
          p_campaign_id: "120",
          p_campaign_name: "Consignado SP",
          p_ad_account_id: "act_1",
          p_metrica: "conversas",
          p_dissertacao: "subir conversas",
          p_sonho: null,
          p_extra: 0,
          p_fonte_campanhas: "espelho",
        }),
      );
    });
    expect(invokeMock).toHaveBeenCalledWith("traffic-agent-job", {
      body: { modo: "ritmo_analise", missao_id: "nova-missao-id" },
    });
    await waitFor(() => {
      expect(logAuditMock).toHaveBeenCalledWith({
        companyId: "c1",
        action: "ritmo.analise",
        targetType: "ritmo_missoes",
        targetId: "nova-missao-id",
      });
    });
    expect(rpcMock).not.toHaveBeenCalledWith("autorizar_ritmo_missao", expect.anything());
  });

  it("plano pronto mostra projeção d3=12 e o rótulo do sonho", async () => {
    linhas = [missaoPlanoPronto()];
    montar();
    expect(await screen.findByText("12")).toBeInTheDocument();
    expect(screen.getByText(/sonho \(não é previsão\)/i)).toBeInTheDocument();
    expect(screen.getByText("Se nada mudar")).toBeInTheDocument();
    expect(screen.getByText("Se executar o plano")).toBeInTheDocument();
    expect(screen.getByText("Máximo do envelope")).toBeInTheDocument();
    expect(screen.getByText(/se o ritmo novo se manter depois do prazo/i)).toBeInTheDocument();
    const autorizar = screen.getByRole("button", { name: "Autorizar" });
    expect(autorizar).toBeEnabled();
    expect(autorizar).not.toHaveAttribute("title", "Próxima entrega");
  });

  it("visualizador não vê Autorizar em plano pronto", async () => {
    ctx.isAdmin = false;
    linhas = [missaoPlanoPronto()];
    montar();
    expect(await screen.findByText("12")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Autorizar" })).not.toBeInTheDocument();
  });

  it("admin autoriza e dispara o primeiro passe sem card", async () => {
    linhas = [missaoPlanoPronto()];
    montar();
    await userEvent.click(await screen.findByRole("button", { name: "Autorizar" }));
    await waitFor(() => {
      expect(rpcMock).toHaveBeenCalledWith("autorizar_ritmo_missao", { p_id: "m2" });
    });
    expect(invokeMock).toHaveBeenCalledWith("ritmo-executar", {
      body: { modo: "primeiro_passe", missao_id: "m2" },
    });
    await waitFor(() => {
      expect(logAuditMock).toHaveBeenCalledWith({
        companyId: "c1",
        action: "ritmo.autorizar",
        targetType: "ritmo_missoes",
        targetId: "m2",
      });
    });
  });

  it("encerrar em plano_pronto descarta a missão sem autorizar", async () => {
    linhas = [missaoPlanoPronto()];
    montar();
    await userEvent.click(await screen.findByRole("button", { name: "Encerrar agora" }));
    await waitFor(() => {
      expect(rpcMock).toHaveBeenCalledWith("encerrar_ritmo_missao", {
        p_id: "m2",
        p_motivo: "descartada",
      });
    });
    expect(logAuditMock).toHaveBeenCalledWith({
      companyId: "c1",
      action: "ritmo.encerrar",
      targetType: "ritmo_missoes",
      targetId: "m2",
    });
    expect(rpcMock).not.toHaveBeenCalledWith("autorizar_ritmo_missao", expect.anything());
  });

  it("análise falhou oferece retry de análise para o admin", async () => {
    linhas = [missaoFalhou()];
    montar();
    expect((await screen.findAllByText("timeout")).length).toBeGreaterThan(0);
    expect(screen.queryByText("Os agentes estão lendo a campanha…")).not.toBeInTheDocument();
    await userEvent.click(await screen.findByRole("button", { name: "Tentar análise de novo" }));
    await waitFor(() => {
      expect(rpcMock).toHaveBeenCalledWith("reenviar_ritmo_analise", { p_id: "m1" });
    });
    expect(invokeMock).toHaveBeenCalledWith("traffic-agent-job", {
      body: { modo: "ritmo_analise", missao_id: "m1" },
    });
  });

  it("em análise mostra que os agentes estão lendo", async () => {
    linhas = [{ ...missaoFalhou(), status: "em_analise", erro_analise: null }];
    montar();
    expect(await screen.findByText("Os agentes estão lendo a campanha…")).toBeInTheDocument();
  });

  it("mostra realizado até agora somando snapshots da campanha (id interno)", async () => {
    const hoje = hojeYmdBrasilia(new Date());
    const dia1 = addDaysYmd(hoje, -1);
    linhas = [
      {
        ...missaoPlanoPronto(),
        periodo_inicio: dia1,
        periodo_fim: addDaysYmd(hoje, 9),
      },
    ];
    snapshots = [
      {
        snapshot_date: dia1,
        messaging_started: 8,
        impressions: 100,
        clicks: 2,
        link_clicks: 1,
        form_leads: 0,
        reach: 40,
      },
    ];
    montar();
    const caption = await screen.findByText(/Realizado até agora \(2 dias\):/);
    expect(caption).toHaveTextContent("8");
    const planoRow = screen.getByText("Se executar o plano").closest("tr");
    expect(planoRow).toBeTruthy();
    const d3 = within(planoRow as HTMLElement).getAllByRole("cell")[1];
    expect(d3).toHaveTextContent("12");
    expect(d3).not.toHaveTextContent("8");
    const projecoes = (planoRow as HTMLElement).closest("table");
    expect(projecoes).toBeTruthy();
    expect(within(projecoes as HTMLElement).queryByText("8")).not.toBeInTheDocument();
  });

  it("?item= seleciona e destaca a missão do sino", async () => {
    searchAtual = { item: "m2" };
    linhas = [
      { ...missaoFalhou(), id: "m1", campaign_name: "Campanha A" },
      missaoPlanoPronto(),
    ];
    montar();
    const nomes = await screen.findAllByText("Consignado SP");
    const row = nomes.find((el) => el.closest("tr"))?.closest("tr");
    expect(row?.className).toMatch(/ring-2/);
    expect(screen.getByRole("button", { name: "Autorizar" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Tentar análise de novo" })).not.toBeInTheDocument();
  });
});
