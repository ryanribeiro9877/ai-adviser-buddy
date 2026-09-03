import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";

// Estes 4 hooks sao a fronteira entre o banco e a tela: pegam a linha crua da
// view/tabela e devolvem tipo normalizado. Duas responsabilidades, e as duas
// silenciosas quando erram:
//   1. coagir numeric/bigint que o PostgREST manda como STRING
//   2. distinguir "e zero" de "nao ha dado" - cpl, cpc_link e os orcamentos
//      PRESERVAM null; o resto cai para 0.
// Trocar um null por 0 em cpl faz a tela dizer "custo por lead R$ 0,00", que le
// como "sai de graca" em vez de "nao houve lead".

let resposta: { data: unknown; error: unknown } = { data: [], error: null };
const orderMock = vi.fn();
const eqMock = vi.fn();
const selectMock = vi.fn();
const fromMock = vi.fn();

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    from: (t: string) => {
      fromMock(t);
      return {
        select: (cols: string) => {
          selectMock(cols);
          return {
            eq: (col: string, val: unknown) => {
              eqMock(col, val);
              return {
                order: (col2: string, opts: unknown) => {
                  orderMock(col2, opts);
                  return Promise.resolve(resposta);
                },
              };
            },
          };
        },
      };
    },
  },
}));

import { useAccountBreakdown, useCampaignBreakdown, useAds, useAdSets } from "./use-breakdown";

const EMPRESA = "8f1e2c3d-4a5b-6c7d-8e9f-0a1b2c3d4e5f";

function montar<T>(hook: () => T) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const Wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={qc}>{children}</QueryClientProvider>
  );
  return renderHook(hook, { wrapper: Wrapper });
}

beforeEach(() => {
  resposta = { data: [], error: null };
  fromMock.mockReset();
  selectMock.mockReset();
  eqMock.mockReset();
  orderMock.mockReset();
});

describe("useAccountBreakdown", () => {
  it("consulta a view certa, filtrando pela empresa e ordenando por gasto", async () => {
    const { result } = montar(() => useAccountBreakdown(EMPRESA));
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(fromMock).toHaveBeenCalledWith("v_account_breakdown");
    expect(eqMock).toHaveBeenCalledWith("company_id", EMPRESA);
    // Maior gasto primeiro: e a ordem que o gestor espera ver na tabela.
    expect(orderMock).toHaveBeenCalledWith("spend", { ascending: false });
  });

  it("NAO consulta sem empresa selecionada", () => {
    const { result } = montar(() => useAccountBreakdown(null));
    expect(fromMock).not.toHaveBeenCalled();
    expect(result.current.data).toBeUndefined();
  });

  it("coage numeric que vem como string", async () => {
    resposta = {
      data: [
        {
          account_id: "a1",
          spend: "1234.56",
          campaigns: "3",
          form_leads: "7",
          gasto_em_formulario: "800.10",
        },
      ],
      error: null,
    };
    const { result } = montar(() => useAccountBreakdown(EMPRESA));
    await waitFor(() => expect(result.current.data).toHaveLength(1));
    expect(result.current.data![0].spend).toBeCloseTo(1234.56, 2);
    expect(result.current.data![0].campaigns).toBe(3);
    expect(result.current.data![0].form_leads).toBe(7);
    expect(result.current.data![0].gasto_em_formulario).toBeCloseTo(800.1, 2);
  });

  it("preenche os defaults de texto em vez de deixar null vazar para a tela", async () => {
    resposta = { data: [{ account_id: null, account_name: null, tipo_conta: null }], error: null };
    const { result } = montar(() => useAccountBreakdown(EMPRESA));
    await waitFor(() => expect(result.current.data).toHaveLength(1));
    expect(result.current.data![0]).toMatchObject({
      account_id: "",
      account_name: "(sem nome)",
      tipo_conta: "sem_dados",
    });
  });

  it("metrica ausente vira 0, nao undefined", async () => {
    resposta = { data: [{ account_id: "a1" }], error: null };
    const { result } = montar(() => useAccountBreakdown(EMPRESA));
    await waitFor(() => expect(result.current.data).toHaveLength(1));
    expect(result.current.data![0]).toMatchObject({ spend: 0, clicks: 0, revenue: 0 });
  });

  it("data null devolve lista vazia, nao estoura", async () => {
    resposta = { data: null, error: null };
    const { result } = montar(() => useAccountBreakdown(EMPRESA));
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual([]);
  });

  it("erro do banco propaga em vez de virar lista vazia", async () => {
    // Lista vazia silenciosa e o pior resultado: a tela diz "nenhuma conta"
    // quando o problema e permissao.
    resposta = { data: null, error: { message: "permission denied" } };
    const { result } = montar(() => useAccountBreakdown(EMPRESA));
    await waitFor(() => expect(result.current.isError).toBe(true));
  });
});

describe("useCampaignBreakdown", () => {
  it("consulta a view de campanhas", async () => {
    const { result } = montar(() => useCampaignBreakdown(EMPRESA));
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(fromMock).toHaveBeenCalledWith("v_campaign_breakdown");
  });

  it("PRESERVA null em custo_por_resultado e cpc_link", async () => {
    // A distincao que mais importa deste arquivo: null = "nao havia
    // denominador"; 0 diria "custo zero".
    resposta = {
      data: [{ campaign_id: "c1", custo_por_resultado: null, cpc_link: null }],
      error: null,
    };
    const { result } = montar(() => useCampaignBreakdown(EMPRESA));
    await waitFor(() => expect(result.current.data).toHaveLength(1));
    expect(result.current.data![0].custo_por_resultado).toBeNull();
    expect(result.current.data![0].cpc_link).toBeNull();
  });

  it("coage custo_por_resultado e cpc_link quando vem preenchidos como string", async () => {
    resposta = {
      data: [{ campaign_id: "c1", custo_por_resultado: "12.34", cpc_link: "0.56" }],
      error: null,
    };
    const { result } = montar(() => useCampaignBreakdown(EMPRESA));
    await waitFor(() => expect(result.current.data).toHaveLength(1));
    expect(result.current.data![0].custo_por_resultado).toBeCloseTo(12.34, 2);
    expect(result.current.data![0].cpc_link).toBeCloseTo(0.56, 2);
  });

  it("custo igual a ZERO nao e confundido com ausencia", async () => {
    resposta = { data: [{ campaign_id: "c1", custo_por_resultado: 0 }], error: null };
    const { result } = montar(() => useCampaignBreakdown(EMPRESA));
    await waitFor(() => expect(result.current.data).toHaveLength(1));
    expect(result.current.data![0].custo_por_resultado).toBe(0);
  });

  it("a BASE vem do banco; ausencia cai em formularios sem inventar contador", async () => {
    // O painel nao decide base. Se a view nao trouxer, o hook assume a base padrao do
    // sistema e o rotulo generico — nunca escolhe pelo contador que estiver maior.
    resposta = {
      data: [{ campaign_id: "c1", base_de_resultado: "cliques_no_link", resultados: "40" }],
      error: null,
    };
    const { result } = montar(() => useCampaignBreakdown(EMPRESA));
    await waitFor(() => expect(result.current.data).toHaveLength(1));
    expect(result.current.data![0].base_de_resultado).toBe("cliques_no_link");
    expect(result.current.data![0].resultados).toBe(40);
  });

  it("tipo ausente cai em 'outro', nao em 'sem_dados'", async () => {
    // Diferenca proposital em relacao a conta: campanha sem tipo classificado e
    // "outro" (existe, nao categorizamos), nao "sem dados".
    resposta = { data: [{ campaign_id: "c1", tipo: null }], error: null };
    const { result } = montar(() => useCampaignBreakdown(EMPRESA));
    await waitFor(() => expect(result.current.data).toHaveLength(1));
    expect(result.current.data![0].tipo).toBe("outro");
  });

  it("nome de campanha ausente vira (sem nome)", async () => {
    resposta = { data: [{ campaign_id: "c1", campanha: null, account_name: null }], error: null };
    const { result } = montar(() => useCampaignBreakdown(EMPRESA));
    await waitFor(() => expect(result.current.data).toHaveLength(1));
    expect(result.current.data![0].campanha).toBe("(sem nome)");
    expect(result.current.data![0].account_name).toBe("(sem nome)");
  });
});

describe("useAds", () => {
  it("consulta a tabela ads com colunas explicitas (nao select *)", async () => {
    // Colunas explicitas importam aqui: `select *` traria payload de criativo
    // inteiro e a tabela tem campos grandes.
    const { result } = montar(() => useAds(EMPRESA));
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(fromMock).toHaveBeenCalledWith("ads");
    expect(selectMock.mock.calls[0][0]).not.toBe("*");
    expect(selectMock.mock.calls[0][0]).toContain("permalink_url");
  });

  it("preserva os campos de criativo que podem ser null", async () => {
    resposta = {
      data: [{ id: "ad1", name: null, title: null, image_url: null, campaign_id: null }],
      error: null,
    };
    const { result } = montar(() => useAds(EMPRESA));
    await waitFor(() => expect(result.current.data).toHaveLength(1));
    expect(result.current.data![0]).toMatchObject({
      name: "(sem nome)",
      title: null,
      image_url: null,
      campaign_id: null,
    });
  });

  it("NAO consulta sem empresa", () => {
    montar(() => useAds(null));
    expect(fromMock).not.toHaveBeenCalled();
  });
});

describe("useAdSets", () => {
  it("consulta a tabela ad_sets", async () => {
    const { result } = montar(() => useAdSets(EMPRESA));
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(fromMock).toHaveBeenCalledWith("ad_sets");
  });

  it("PRESERVA null nos orcamentos (null = sem orcamento no conjunto, provavel CBO)", async () => {
    // fmtBudget depende disso para mostrar "—" em vez de "R$ 0,00": zero
    // sugeriria orcamento zerado, quando na verdade o orcamento esta na campanha.
    resposta = {
      data: [{ id: "as1", daily_budget: null, lifetime_budget: null }],
      error: null,
    };
    const { result } = montar(() => useAdSets(EMPRESA));
    await waitFor(() => expect(result.current.data).toHaveLength(1));
    expect(result.current.data![0].daily_budget).toBeNull();
    expect(result.current.data![0].lifetime_budget).toBeNull();
  });

  it("coage orcamento preenchido (vem em centavos, como string)", async () => {
    resposta = { data: [{ id: "as1", daily_budget: "5000" }], error: null };
    const { result } = montar(() => useAdSets(EMPRESA));
    await waitFor(() => expect(result.current.data).toHaveLength(1));
    expect(result.current.data![0].daily_budget).toBe(5000);
  });

  it("passa o targeting jsonb adiante sem tentar interpretar", async () => {
    // Interpretar e trabalho do summarizeTargeting; aqui so nao se pode perder.
    const targeting = { age_min: 25, geo_locations: { countries: ["BR"] } };
    resposta = { data: [{ id: "as1", targeting }], error: null };
    const { result } = montar(() => useAdSets(EMPRESA));
    await waitFor(() => expect(result.current.data).toHaveLength(1));
    expect(result.current.data![0].targeting).toEqual(targeting);
  });

  it("targeting ausente vira null", async () => {
    resposta = { data: [{ id: "as1", targeting: null }], error: null };
    const { result } = montar(() => useAdSets(EMPRESA));
    await waitFor(() => expect(result.current.data).toHaveLength(1));
    expect(result.current.data![0].targeting).toBeNull();
  });
});
