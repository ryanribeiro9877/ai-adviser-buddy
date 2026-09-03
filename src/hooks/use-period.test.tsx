import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import type { CampaignRow } from "@/lib/breakdown";

// Aqui mora a reconciliacao "banco = tela": os METADADOS da campanha (nome,
// conta, tipo) vem da view de breakdown, e os NUMEROS do periodo vem somados de
// metric_snapshots. Errar a juncao produz a pior classe de bug deste sistema -
// numero plausivel e errado, que ninguem percebe olhando.

const metaMock = vi.fn();
vi.mock("@/hooks/use-breakdown", () => ({
  useCampaignBreakdown: () => metaMock(),
}));

let linhasSnapshot: Record<string, unknown>[] = [];
let erroSnapshot: unknown = null;

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    from: () => ({
      select: () => ({
        eq: () => ({
          gte: () => ({
            lte: () => Promise.resolve({ data: linhasSnapshot, error: erroSnapshot }),
          }),
        }),
      }),
    }),
  },
}));

import { usePeriodCampaigns } from "./use-period";

const EMPRESA = "8f1e2c3d-4a5b-6c7d-8e9f-0a1b2c3d4e5f";
const RANGE = { start: "2026-07-01", end: "2026-07-31" };

function campanhaMeta(over: Partial<CampaignRow> = {}): CampaignRow {
  return {
    company_id: EMPRESA,
    empresa: "JCR2",
    account_id: "act_1",
    account_name: "Conta",
    campaign_id: "cmp_1",
    campanha: "Campanha A",
    objective: "LEAD_GENERATION",
    tipo: "leadgen",
    status: "ACTIVE",
    spend: 999, // valor do agregado total — deve ser SUBSTITUIDO pelo do periodo
    impressions: 999,
    reach: 999,
    frequency: 0,
    clicks: 999,
    link_clicks: 999,
    landing_page_views: 999,
    messaging_started: 999,
    form_leads: 999,
    sales: 999,
    revenue: 999,
    base_de_resultado: "formularios" as const,
    rotulo_do_custo: "por formulario enviado",
    unidade_do_resultado: "formularios",
    resultados: 999,
    custo_por_resultado: 999,
    cpc_link: 999,
    last_synced_at: null,
    ...over,
  };
}

function snapshot(campaign_id: string, over: Record<string, unknown> = {}) {
  return {
    campaign_id,
    spend: 0,
    impressions: 0,
    reach: 0,
    clicks: 0,
    link_clicks: 0,
    landing_page_views: 0,
    messaging_started: 0,
    form_leads: 0,
    sales: 0,
    revenue: 0,
    ...over,
  };
}

function montar(companyId: string | null = EMPRESA, range = RANGE) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const Wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={qc}>{children}</QueryClientProvider>
  );
  return renderHook(() => usePeriodCampaigns(companyId, range), { wrapper: Wrapper });
}

beforeEach(() => {
  metaMock.mockReset().mockReturnValue({ data: [], isLoading: false, isError: false });
  linhasSnapshot = [];
  erroSnapshot = null;
});

describe("usePeriodCampaigns — junção metadados + período", () => {
  it("substitui os números do agregado pelos do PERÍODO", async () => {
    // O metadado traz 999 em tudo (total historico). Depois da juncao, os
    // numeros tem de ser os do periodo — senao a tela mostraria o acumulado
    // com rotulo de periodo, que e mentira silenciosa.
    metaMock.mockReturnValue({ data: [campanhaMeta()], isLoading: false, isError: false });
    linhasSnapshot = [snapshot("cmp_1", { spend: 100, form_leads: 4, link_clicks: 50 })];

    const { result } = montar();
    await waitFor(() => expect(result.current.data).toHaveLength(1));
    expect(result.current.data[0]).toMatchObject({
      campanha: "Campanha A", // metadado preservado
      tipo: "leadgen",
      spend: 100, // numero do periodo
      form_leads: 4,
      resultados: 4,
      link_clicks: 50,
    });
  });

  it("SOMA várias linhas diárias da mesma campanha", async () => {
    metaMock.mockReturnValue({ data: [campanhaMeta()], isLoading: false, isError: false });
    linhasSnapshot = [
      snapshot("cmp_1", { spend: 100, form_leads: 2 }),
      snapshot("cmp_1", { spend: 50, form_leads: 3 }),
      snapshot("cmp_1", { spend: 25, form_leads: 1 }),
    ];
    const { result } = montar();
    await waitFor(() => expect(result.current.data).toHaveLength(1));
    expect(result.current.data[0].spend).toBe(175);
    expect(result.current.data[0].resultados).toBe(6);
  });

  it("coage numeric que o PostgREST manda como STRING", async () => {
    // Sem o num(), "100" + "50" concatenaria em "10050".
    metaMock.mockReturnValue({ data: [campanhaMeta()], isLoading: false, isError: false });
    linhasSnapshot = [
      snapshot("cmp_1", { spend: "100.50", form_leads: "2" }),
      snapshot("cmp_1", { spend: "50.25", form_leads: "3" }),
    ];
    const { result } = montar();
    await waitFor(() => expect(result.current.data).toHaveLength(1));
    expect(result.current.data[0].spend).toBeCloseTo(150.75, 2);
    expect(result.current.data[0].resultados).toBe(5);
  });

  it("campanha SEM snapshot no periodo vira zero, nao undefined", async () => {
    // Zerar e o correto: a campanha existe mas nao gastou no recorte. Deixar
    // undefined faria a tela mostrar "—" ou NaN em vez de 0.
    metaMock.mockReturnValue({ data: [campanhaMeta()], isLoading: false, isError: false });
    linhasSnapshot = [];
    const { result } = montar();
    await waitFor(() => expect(result.current.data).toHaveLength(1));
    expect(result.current.data[0]).toMatchObject({ spend: 0, resultados: 0, impressions: 0 });
  });

  it("ignora linha de snapshot sem campaign_id", async () => {
    metaMock.mockReturnValue({ data: [campanhaMeta()], isLoading: false, isError: false });
    linhasSnapshot = [
      snapshot("cmp_1", { spend: 100 }),
      { ...snapshot("", { spend: 999 }), campaign_id: null },
    ];
    const { result } = montar();
    await waitFor(() => expect(result.current.data).toHaveLength(1));
    expect(result.current.data[0].spend).toBe(100);
  });

  it("snapshot de campanha que nao esta nos metadados nao inventa linha", async () => {
    // A lista sai dos METADADOS; snapshot orfao nao vira campanha sem nome.
    metaMock.mockReturnValue({ data: [campanhaMeta()], isLoading: false, isError: false });
    linhasSnapshot = [snapshot("cmp_1", { spend: 10 }), snapshot("cmp_FANTASMA", { spend: 500 })];
    const { result } = montar();
    await waitFor(() => expect(result.current.data).toHaveLength(1));
    expect(result.current.data[0].campaign_id).toBe("cmp_1");
  });

  it("preserva uma linha por campanha dos metadados", async () => {
    metaMock.mockReturnValue({
      data: [campanhaMeta(), campanhaMeta({ campaign_id: "cmp_2", campanha: "Campanha B" })],
      isLoading: false,
      isError: false,
    });
    linhasSnapshot = [snapshot("cmp_1", { spend: 10 })];
    const { result } = montar();
    await waitFor(() => expect(result.current.data).toHaveLength(2));
    expect(result.current.data.map((r) => r.campaign_id)).toEqual(["cmp_1", "cmp_2"]);
    expect(result.current.data[1].spend).toBe(0);
  });
});

describe("usePeriodCampaigns — CPL e CPC recalculados no período", () => {
  it("recalcula sobre os numeros do periodo, nao reaproveita o do agregado", async () => {
    metaMock.mockReturnValue({ data: [campanhaMeta()], isLoading: false, isError: false });
    linhasSnapshot = [snapshot("cmp_1", { spend: 200, form_leads: 8, link_clicks: 40 })];
    const { result } = montar();
    await waitFor(() => expect(result.current.data).toHaveLength(1));
    expect(result.current.data[0].custo_por_resultado).toBe(25); // 200/8
    expect(result.current.data[0].cpc_link).toBe(5); // 200/40
  });

  it("denominador ZERO vira null, nunca Infinity", async () => {
    // Infinity chegaria na tela como "—" no melhor caso e contaminaria
    // qualquer soma no pior.
    metaMock.mockReturnValue({ data: [campanhaMeta()], isLoading: false, isError: false });
    linhasSnapshot = [snapshot("cmp_1", { spend: 200, form_leads: 0, link_clicks: 0 })];
    const { result } = montar();
    await waitFor(() => expect(result.current.data).toHaveLength(1));
    expect(result.current.data[0].custo_por_resultado).toBeNull();
    expect(result.current.data[0].cpc_link).toBeNull();
  });
});

describe("usePeriodCampaigns — estados", () => {
  it("enquanto os snapshots nao chegam, devolve lista VAZIA", async () => {
    // Importante: nao devolver os metadados com os numeros do agregado. Seria
    // um flash de numero errado antes do numero certo.
    metaMock.mockReturnValue({ data: [campanhaMeta()], isLoading: false, isError: false });
    const { result } = montar();
    expect(result.current.data).toEqual([]);
  });

  it("isLoading e verdadeiro se QUALQUER uma das duas consultas estiver carregando", async () => {
    metaMock.mockReturnValue({ data: undefined, isLoading: true, isError: false });
    const { result } = montar();
    expect(result.current.isLoading).toBe(true);
  });

  it("isError e verdadeiro se QUALQUER uma falhar", async () => {
    metaMock.mockReturnValue({ data: [], isLoading: false, isError: true });
    const { result } = montar();
    expect(result.current.isError).toBe(true);
  });

  it("erro do banco nos snapshots propaga para isError", async () => {
    metaMock.mockReturnValue({ data: [campanhaMeta()], isLoading: false, isError: false });
    erroSnapshot = { message: "permission denied" };
    const { result } = montar();
    await waitFor(() => expect(result.current.isError).toBe(true));
  });

  it("sem empresa selecionada nao consulta e devolve vazio", async () => {
    metaMock.mockReturnValue({ data: [], isLoading: false, isError: false });
    const { result } = montar(null);
    expect(result.current.data).toEqual([]);
  });
});
