import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { DetalheMissao, type MissaoRitmo } from "./detalhe-missao";

const fromMock = vi.fn();
const rpcMock = vi.fn();
const invokeMock = vi.fn();
const logAuditMock = vi.fn();
const toastErrorMock = vi.fn();
const toastSuccessMock = vi.fn();

vi.mock("@/lib/app-context", () => ({
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
  },
}));

function encadear(data: unknown) {
  const result = Promise.resolve({ data, error: null });
  const q = {
    select: () => q,
    eq: () => q,
    order: () => q,
    gte: () => q,
    lte: () => q,
    in: () => q,
    maybeSingle: () => result,
    then: result.then.bind(result),
  };
  return q;
}

function montar(el: ReactNode) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(el, {
    wrapper: ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={qc}>{children}</QueryClientProvider>
    ),
  });
}

function missao(patch: Partial<MissaoRitmo> & Pick<MissaoRitmo, "status">): MissaoRitmo {
  return {
    id: "m2",
    company_id: "c1",
    campaign_id: "120",
    campaign_name: "Consignado SP",
    ad_account_id: "act_1",
    periodo_inicio: "2026-09-10",
    periodo_fim: "2026-09-20",
    metrica: "conversas",
    dissertacao: "subir conversas",
    sonho: 50,
    extra_investimento: 0,
    baseline_gasto_diario: 10,
    baseline_json: {},
    teto_gasto_janela: 110,
    plano_json: {
      leitura: { texto: "Campanha ativa, learning ok." },
      baseline: { gasto_diario: 10, janela: "7d_com_gasto", dias_usados: 7, confianca: "alta" },
      teto_janela: 110,
      possibilidades: {
        nada_muda: { d3: 5, d7: 10, d15: 20, d30: 40 },
        plano: { d3: 12, d7: 24, d15: 40, d30: 80 },
        maximo_envelope: { d3: 15, d7: 30, d15: 50, d30: 90 },
      },
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
      recusas: ["copy recusada"],
      lacunas: ["sem reach único do período"],
    },
    leitura_json: { texto: "Campanha ativa, learning ok." },
    projecoes_json: null,
    confianca_baseline: "alta",
    fonte_campanhas: "espelho",
    autonomia_concedida_em: null,
    autonomia_concedida_por: null,
    encerrada_em: null,
    encerrada_por: null,
    encerrada_motivo: null,
    erro_analise: null,
    job_id: null,
    criado_por: null,
    criado_em: "2026-09-10T11:00:00Z",
    atualizado_em: "2026-09-10T11:00:00Z",
    ...patch,
  };
}

beforeEach(() => {
  logAuditMock.mockReset();
  toastErrorMock.mockReset();
  toastSuccessMock.mockReset();
  Element.prototype.hasPointerCapture = vi.fn(() => false);
  Element.prototype.releasePointerCapture = vi.fn();
  Element.prototype.scrollIntoView = vi.fn();
  fromMock.mockImplementation((tabela: string) => {
    if (tabela === "campaigns") return encadear({ id: "camp-uuid" });
    if (tabela === "ritmo_atos") return encadear([]);
    if (tabela === "ritmo_diarios") return encadear([]);
    if (tabela === "meta_execution_config") return encadear({ dry_run: false });
    return encadear([]);
  });
  rpcMock.mockImplementation(async (nome: string) => {
    if (nome === "autorizar_ritmo_missao") return { data: { ok: true }, error: null };
    if (nome === "encerrar_ritmo_missao") return { data: { ok: true }, error: null };
    return { data: null, error: null };
  });
  invokeMock.mockResolvedValue({ data: { ok: true }, error: null });
});

describe("DetalheMissao", () => {
  it("mapeia leitura, projeções, atos com evidência e lacunas", async () => {
    montar(<DetalheMissao missao={missao({ status: "plano_pronto" })} isAdmin companyId="c1" />);
    expect(await screen.findByText("Campanha ativa, learning ok.")).toBeInTheDocument();
    expect(screen.getByText("12")).toBeInTheDocument();
    expect(screen.getByText(/sonho \(não é previsão\)/i)).toBeInTheDocument();
    expect(screen.getByText(/Evidência:/)).toBeInTheDocument();
    expect(screen.getByText("CTR caiu")).toBeInTheDocument();
    expect(screen.getByText(/Mecanismo:/)).toBeInTheDocument();
    expect(screen.getByText(/Métrica de sucesso:/)).toBeInTheDocument();
    expect(screen.getByText(/Janela de leitura:/)).toBeInTheDocument();
    expect(screen.getByText(/Reversa:/)).toBeInTheDocument();
    expect(screen.getByText("sem reach único do período")).toBeInTheDocument();
    expect(screen.getByText("copy recusada")).toBeInTheDocument();
  });

  it("visualizador não vê Autorizar no plano pronto", async () => {
    montar(
      <DetalheMissao missao={missao({ status: "plano_pronto" })} isAdmin={false} companyId="c1" />,
    );
    expect(await screen.findByText("Campanha ativa, learning ok.")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Autorizar" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Encerrar agora" })).not.toBeInTheDocument();
  });

  it("admin em plano_pronto autoriza e dispara o primeiro passe", async () => {
    montar(<DetalheMissao missao={missao({ status: "plano_pronto" })} isAdmin companyId="c1" />);
    const autorizar = await screen.findByRole("button", { name: "Autorizar" });
    expect(autorizar).toBeEnabled();
    expect(autorizar).not.toHaveAttribute("title", "Próxima entrega");
    await userEvent.click(autorizar);
    await waitFor(() => {
      expect(rpcMock).toHaveBeenCalledWith("autorizar_ritmo_missao", { p_id: "m2" });
    });
    expect(invokeMock).toHaveBeenCalledWith("ritmo-executar", {
      body: { modo: "primeiro_passe", missao_id: "m2" },
    });
    expect(logAuditMock).toHaveBeenCalledWith({
      companyId: "c1",
      action: "ritmo.autorizar",
      targetType: "ritmo_missoes",
      targetId: "m2",
    });
  });

  it("Autorizar com ok falso mostra o motivo e não dispara o tique", async () => {
    rpcMock.mockImplementation(async (nome: string) => {
      if (nome === "autorizar_ritmo_missao") {
        return { data: { ok: false, motivo: "master_desligado" }, error: null };
      }
      return { data: null, error: null };
    });
    montar(<DetalheMissao missao={missao({ status: "plano_pronto" })} isAdmin companyId="c1" />);
    await userEvent.click(await screen.findByRole("button", { name: "Autorizar" }));
    await waitFor(() => {
      expect(toastErrorMock).toHaveBeenCalledWith("master_desligado");
    });
    expect(invokeMock).not.toHaveBeenCalled();
    expect(logAuditMock).not.toHaveBeenCalled();
  });

  it("Autorizar e Encerrar ficam desabilitados enquanto a autorização pende", async () => {
    let liberar: (v: { data: unknown; error: unknown }) => void = () => {};
    rpcMock.mockImplementation((nome: string) => {
      if (nome === "autorizar_ritmo_missao") {
        return new Promise((resolve) => {
          liberar = resolve;
        });
      }
      return Promise.resolve({ data: { ok: true }, error: null });
    });
    montar(<DetalheMissao missao={missao({ status: "plano_pronto" })} isAdmin companyId="c1" />);
    await userEvent.click(await screen.findByRole("button", { name: "Autorizar" }));
    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Autorizar" })).toBeDisabled();
    });
    expect(screen.getByRole("button", { name: "Encerrar agora" })).toBeDisabled();
    liberar({ data: { ok: true }, error: null });
    await waitFor(() => {
      expect(invokeMock).toHaveBeenCalled();
    });
  });

  it("encerrar em execução usa motivo humano e audita", async () => {
    montar(
      <DetalheMissao
        missao={missao({ status: "em_execucao", autonomia_concedida_em: "2026-09-11T12:00:00Z" })}
        isAdmin
        companyId="c1"
      />,
    );
    expect(screen.queryByRole("button", { name: "Autorizar" })).not.toBeInTheDocument();
    await userEvent.click(await screen.findByRole("button", { name: "Encerrar agora" }));
    await waitFor(() => {
      expect(rpcMock).toHaveBeenCalledWith("encerrar_ritmo_missao", {
        p_id: "m2",
        p_motivo: "humano",
      });
    });
    expect(logAuditMock).toHaveBeenCalledWith({
      companyId: "c1",
      action: "ritmo.encerrar",
      targetType: "ritmo_missoes",
      targetId: "m2",
    });
  });

  it("em execução mostra o resultado simulado do ato", async () => {
    fromMock.mockImplementation((tabela: string) => {
      if (tabela === "campaigns") return encadear({ id: "camp-uuid" });
      if (tabela === "ritmo_atos") {
        return encadear([
          {
            id: "ato-1",
            missao_id: "m2",
            company_id: "c1",
            tique: "primeiro_passe",
            acao: "pausar_criativo",
            alvo_external_id: "ad1",
            resultado: "simulado",
            resposta_meta: { motivo: "dry_run" },
            criado_em: "2026-09-11T12:00:00Z",
          },
        ]);
      }
      if (tabela === "meta_execution_config") return encadear({ dry_run: true });
      return encadear([]);
    });
    montar(
      <DetalheMissao
        missao={missao({ status: "em_execucao", autonomia_concedida_em: "2026-09-11T12:00:00Z" })}
        isAdmin
        companyId="c1"
      />,
    );
    expect((await screen.findAllByText("Simulado")).length).toBeGreaterThan(0);
    expect(screen.getByText("Histórico de atos")).toBeInTheDocument();
    expect(screen.getByText("dry_run")).toBeInTheDocument();
    expect(screen.getByText("Primeiro passe")).toBeInTheDocument();
  });

  it("em execução mostra o andamento diário da campanha e dos agentes", async () => {
    fromMock.mockImplementation((tabela: string) => {
      if (tabela === "campaigns") return encadear({ id: "camp-uuid" });
      if (tabela === "ritmo_atos") {
        return encadear([
          {
            id: "ato-1",
            missao_id: "m2",
            company_id: "c1",
            tique: "primeiro_passe",
            acao: "pausar_conjunto",
            alvo_external_id: "s1",
            resultado: "ok",
            criado_em: "2026-09-13T15:00:00-03:00",
          },
        ]);
      }
      if (tabela === "ritmo_diarios") return encadear([]);
      if (tabela === "metric_snapshots") {
        return encadear([
          {
            snapshot_date: "2026-09-12",
            spend: 63.06,
            messaging_started: 17,
            impressions: 1000,
            clicks: 40,
            link_clicks: 20,
          },
          {
            snapshot_date: "2026-09-13",
            spend: 58,
            messaging_started: 10,
            impressions: 800,
            clicks: 30,
            link_clicks: 15,
          },
        ]);
      }
      if (tabela === "meta_execution_config") return encadear({ dry_run: false });
      return encadear([]);
    });
    montar(
      <DetalheMissao
        missao={missao({
          status: "em_execucao",
          periodo_inicio: "2026-09-12",
          periodo_fim: "2026-09-20",
          autonomia_concedida_em: "2026-09-12T12:00:00Z",
        })}
        isAdmin
        companyId="c1"
      />,
    );
    expect(await screen.findByText("Andamento")).toBeInTheDocument();
    expect(screen.getByText(/o texto de fechamento sai às 18:30/i)).toBeInTheDocument();
    expect(await screen.findByText("Pausar conjunto")).toBeInTheDocument();
    expect(
      await screen.findByText(/os agentes neste dia: pausar conjunto s1 \(ok\)/i),
    ).toBeInTheDocument();
  });

  it("plano pronto não oferece edição de parâmetros", async () => {
    montar(<DetalheMissao missao={missao({ status: "plano_pronto" })} isAdmin companyId="c1" />);
    expect(await screen.findByText("Campanha ativa, learning ok.")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Editar parâmetros" })).not.toBeInTheDocument();
  });

  it("visualizador em execução não edita parâmetros", async () => {
    montar(
      <DetalheMissao
        missao={missao({ status: "em_execucao", autonomia_concedida_em: "2026-09-11T12:00:00Z" })}
        isAdmin={false}
        companyId="c1"
      />,
    );
    expect(await screen.findByText("subir conversas")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Editar parâmetros" })).not.toBeInTheDocument();
  });

  it("admin em execução salva parâmetros e pede o replano", async () => {
    rpcMock.mockImplementation(async (nome: string) => {
      if (nome === "atualizar_parametros_ritmo_missao") {
        return { data: { ok: true, teto_gasto_janela: 220 }, error: null };
      }
      return { data: { ok: true }, error: null };
    });
    montar(
      <DetalheMissao
        missao={missao({ status: "em_execucao", autonomia_concedida_em: "2026-09-11T12:00:00Z" })}
        isAdmin
        companyId="c1"
      />,
    );
    await userEvent.click(await screen.findByRole("button", { name: "Editar parâmetros" }));
    const dissertacao = await screen.findByLabelText("Dissertação");
    await userEvent.clear(dissertacao);
    await userEvent.type(dissertacao, "priorizar o fim do prazo");
    await userEvent.click(screen.getByRole("button", { name: "Salvar parâmetros" }));
    await waitFor(() => {
      expect(rpcMock).toHaveBeenCalledWith("atualizar_parametros_ritmo_missao", {
        p_id: "m2",
        p_periodo_inicio: "2026-09-10",
        p_periodo_fim: "2026-09-20",
        p_metrica: "conversas",
        p_dissertacao: "priorizar o fim do prazo",
        p_sonho: 50,
        p_extra: 0,
      });
    });
    expect(invokeMock).toHaveBeenCalledWith("traffic-agent-job", {
      body: { modo: "ritmo_replano", missao_id: "m2" },
    });
    expect(logAuditMock).toHaveBeenCalledWith({
      companyId: "c1",
      action: "ritmo.parametros",
      targetType: "ritmo_missoes",
      targetId: "m2",
    });
    expect(toastSuccessMock).toHaveBeenCalledWith(
      "Parâmetros atualizados. Os agentes estão relendo o plano.",
    );
  });

  it("salvar sem mudança não chama a RPC", async () => {
    montar(
      <DetalheMissao
        missao={missao({ status: "em_execucao", autonomia_concedida_em: "2026-09-11T12:00:00Z" })}
        isAdmin
        companyId="c1"
      />,
    );
    await userEvent.click(await screen.findByRole("button", { name: "Editar parâmetros" }));
    await userEvent.click(await screen.findByRole("button", { name: "Salvar parâmetros" }));
    expect(rpcMock).not.toHaveBeenCalledWith(
      "atualizar_parametros_ritmo_missao",
      expect.anything(),
    );
    expect(invokeMock).not.toHaveBeenCalled();
    expect(toastSuccessMock).toHaveBeenCalledWith("Os parâmetros já estão esses.");
  });

  it("recusa da RPC não dispara o replano", async () => {
    rpcMock.mockImplementation(async (nome: string) => {
      if (nome === "atualizar_parametros_ritmo_missao") {
        return { data: { ok: false, motivo: "status" }, error: null };
      }
      return { data: { ok: true }, error: null };
    });
    montar(
      <DetalheMissao
        missao={missao({ status: "em_execucao", autonomia_concedida_em: "2026-09-11T12:00:00Z" })}
        isAdmin
        companyId="c1"
      />,
    );
    await userEvent.click(await screen.findByRole("button", { name: "Editar parâmetros" }));
    const dissertacao = await screen.findByLabelText("Dissertação");
    await userEvent.clear(dissertacao);
    await userEvent.type(dissertacao, "outro pedido");
    await userEvent.click(screen.getByRole("button", { name: "Salvar parâmetros" }));
    await waitFor(() => {
      expect(toastErrorMock).toHaveBeenCalledWith("Só dá para editar uma força-tarefa em execução.");
    });
    expect(invokeMock).not.toHaveBeenCalled();
    expect(logAuditMock).not.toHaveBeenCalled();
  });

  it("na área de Autorizar declara dry-run quando a config está ligada", async () => {
    fromMock.mockImplementation((tabela: string) => {
      if (tabela === "campaigns") return encadear({ id: "camp-uuid" });
      if (tabela === "ritmo_atos") return encadear([]);
      if (tabela === "ritmo_diarios") return encadear([]);
      if (tabela === "meta_execution_config") return encadear({ dry_run: true });
      return encadear([]);
    });
    montar(<DetalheMissao missao={missao({ status: "plano_pronto" })} isAdmin companyId="c1" />);
    expect(await screen.findByText("Simulação (dry-run): a Meta não muda.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Autorizar" })).toBeInTheDocument();
  });
});
