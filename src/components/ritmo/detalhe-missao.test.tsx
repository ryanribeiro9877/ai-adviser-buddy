import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { DetalheMissao, type MissaoRitmo } from "./detalhe-missao";

const fromMock = vi.fn();
const rpcMock = vi.fn();
const invokeMock = vi.fn();

vi.mock("@/lib/app-context", () => ({
  logAudit: vi.fn(),
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
  fromMock.mockImplementation((tabela: string) => {
    if (tabela === "campaigns") return encadear({ id: "camp-uuid" });
    return encadear([]);
  });
  rpcMock.mockResolvedValue({ data: { ok: true }, error: null });
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

  it("Autorizar fica visível e desabilitado no plano pronto", async () => {
    montar(<DetalheMissao missao={missao({ status: "plano_pronto" })} isAdmin companyId="c1" />);
    const autorizar = await screen.findByRole("button", { name: "Autorizar" });
    expect(autorizar).toBeDisabled();
    expect(autorizar).toHaveAttribute("title", "Próxima entrega");
  });
});
