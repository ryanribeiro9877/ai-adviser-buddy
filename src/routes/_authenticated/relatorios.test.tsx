import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";

// A aba Relatórios. Três coisas que não podem degradar em silêncio: empresa
// vazia, lista vazia (diferente de falha) e relatório que falhou visível.

let ctx = {
  selectedCompany: { id: "c1", name: "JCR2", industry: null } as {
    id: string;
    name: string;
    industry: string | null;
  } | null,
  selectedCompanyId: "c1" as string | null,
  isAdmin: true,
  user: { id: "u1" },
};

const fromMock = vi.fn();
const rpcMock = vi.fn();
const channelMock = {
  on: vi.fn().mockReturnThis(),
  subscribe: vi.fn().mockReturnThis(),
};

vi.mock("@tanstack/react-router", () => ({
  createFileRoute: () => (opts: Record<string, unknown>) => ({ options: opts }),
}));

vi.mock("@/lib/app-context", () => ({
  useApp: () => ctx,
  logAudit: vi.fn(),
}));

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    from: (...a: unknown[]) => fromMock(...a),
    rpc: (...a: unknown[]) => rpcMock(...a),
    functions: { invoke: vi.fn() },
    channel: () => channelMock,
    removeChannel: vi.fn(),
  },
}));

vi.mock("@/components/metric-card", () => ({
  EmptyCompany: () => <div data-testid="empty-company" />,
}));

import { Route } from "./relatorios";

const Relatorios = (Route.options as unknown as { component: () => ReactNode }).component;

function encadear(data: unknown, error: unknown = null) {
  const result = Promise.resolve({ data, error });
  const q: { select: () => unknown; eq: () => unknown; order: () => unknown; limit: () => unknown; then: typeof result.then } =
    {
      select: () => q,
      eq: () => q,
      order: () => q,
      limit: () => q,
      then: result.then.bind(result),
    };
  return q;
}

function montar() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<Relatorios />, {
    wrapper: ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={qc}>{children}</QueryClientProvider>
    ),
  });
}

beforeEach(() => {
  ctx = {
    selectedCompany: { id: "c1", name: "JCR2", industry: null },
    selectedCompanyId: "c1",
    isAdmin: true,
    user: { id: "u1" },
  };
  fromMock.mockImplementation((tabela: string) => {
    if (tabela === "relatorio_agendamentos") return encadear([]);
    if (tabela === "relatorio_gerados") {
      return encadear([
        {
          id: "r1",
          nome: "Diário",
          status: "error",
          fonte_campanhas: "espelho",
          campaign_ids_resolvidos: [],
          periodo_inicio: "2026-09-09",
          periodo_fim: "2026-09-09",
          corpo_md: null,
          achados: [],
          cobertura: null,
          erro: "timeout na síntese",
          criado_em: "2026-09-10T11:00:00Z",
          finalizado_em: "2026-09-10T11:02:00Z",
        },
      ]);
    }
    return encadear([]);
  });
  rpcMock.mockResolvedValue({ data: [], error: null });
});

describe("Relatórios", () => {
  it("pede empresa quando nenhuma está selecionada", () => {
    ctx.selectedCompany = null;
    ctx.selectedCompanyId = null;
    montar();
    expect(screen.getByTestId("empty-company")).toBeInTheDocument();
  });

  it("lista vazia de agendas não finge que há trabalho", async () => {
    montar();
    await userEvent.click(await screen.findByRole("tab", { name: "Agendamentos" }));
    expect(await screen.findByText(/Nenhuma agenda nesta empresa/i)).toBeInTheDocument();
  });

  it("mostra falha de geração em vez de silêncio", async () => {
    montar();
    expect(await screen.findByText("timeout na síntese")).toBeInTheDocument();
    expect(screen.getAllByText("Falhou").length).toBeGreaterThan(0);
  });

  it("a opinião acompanha o relatório clicado, não o último da lista", async () => {
    const opiniao = {
      tipo: "teto",
      nivel: "campanha",
      severidade: "atencao",
      mecanismo: "orcamento no conjunto",
      acao: "conferir o diario",
      metrica_sucesso: "gasto dentro do teto",
      janela_leitura: "proximo dia",
      reversa: "se o teto mudou, ignorar",
    };
    fromMock.mockImplementation((tabela: string) => {
      if (tabela === "relatorio_agendamentos") return encadear([]);
      if (tabela === "relatorio_gerados") {
        return encadear([
          {
            id: "laf",
            nome: "Relatório diário operacional",
            status: "done",
            fonte_campanhas: "ao_vivo",
            campaign_ids_resolvidos: ["120250192130160182"],
            periodo_inicio: "2026-09-25",
            periodo_fim: "2026-09-27",
            corpo_md: "## Resumo executivo\nLa Felicità na janela.",
            achados: [
              {
                ...opiniao,
                alvo_id: "120250192130160182",
                alvo_nome: "COHAPM_LAFELICITA_CONV_WA_2026 - SETEMBRO",
                evidencia: "De 25 a 27/09 a campanha gastou R$ 409,74",
              },
              {
                ...opiniao,
                alvo_id: "120250192130160182",
                alvo_nome: "COHAPM_LAFELICITA_CONV_WA_2026 - SETEMBRO",
                evidencia: "Na janela fechada, 71 conversas",
              },
            ],
            cobertura: null,
            erro: null,
            criado_em: "2026-09-28T17:03:00Z",
            finalizado_em: "2026-09-28T17:05:00Z",
          },
          {
            id: "ocu",
            nome: "Relatório diário operacional (Ocular)",
            status: "done",
            fonte_campanhas: "ao_vivo",
            campaign_ids_resolvidos: ["120249817715740182"],
            periodo_inicio: "2026-09-26",
            periodo_fim: "2026-09-26",
            corpo_md: "## Resumo executivo\nVistta no dia.",
            achados: [
              {
                ...opiniao,
                alvo_id: "120249817715740182",
                alvo_nome: "COHAPM_VISTTA_CONV_WA_SET26",
                evidencia: "Em 26/09/2026 a campanha gastou R$ 194,72",
              },
            ],
            cobertura: null,
            erro: null,
            criado_em: "2026-09-27T10:55:00Z",
            finalizado_em: "2026-09-27T10:56:00Z",
          },
        ]);
      }
      return encadear([]);
    });
    rpcMock.mockResolvedValue({
      data: [
        { external_id: "120250192130160182", nome: "COHAPM_LAFELICITA_CONV_WA_2026 - SETEMBRO", status: "active", objetivo: null, tipo: null, gasto: 0, last_synced_at: null },
        { external_id: "120249817715740182", nome: "COHAPM_VISTTA_CONV_WA_SET26", status: "active", objetivo: null, tipo: null, gasto: 0, last_synced_at: null },
      ],
      error: null,
    });
    montar();
    expect(await screen.findByText(/409,74/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: /Ocular/i }));
    expect(await screen.findByText(/194,72/)).toBeInTheDocument();
    expect(screen.queryByText(/409,74/)).not.toBeInTheDocument();
    expect(screen.getAllByText("COHAPM_VISTTA_CONV_WA_SET26").length).toBeGreaterThan(0);
  });
});
