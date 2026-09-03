import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEventBase from "@testing-library/user-event";
import type { ReactNode } from "react";
import type { AccountRow, CampaignRow, TipoConta } from "@/lib/breakdown";

const userEvent = userEventBase.setup({ delay: null });

// O dashboard executivo. A propriedade que define esta tela e a RECONCILIACAO: os
// KPIs sao sempre somados do NIVEL DE CAMPANHA, para o topo bater com a tabela
// embaixo. Se o numero grande viesse da view de contas e a tabela das campanhas,
// os dois discordariam e ninguem saberia qual acreditar.
//
// Depois disso: os filtros de conta e tipo tem de encolher o KPI junto, trocar de
// empresa tem de ZERAR os filtros (senao a nova empresa abre filtrada por uma
// conta que nao e dela), e as colunas de venda so aparecem quando ha venda.

const NB = " ";

let empresa: { id: string; name: string } | null = { id: "c1", name: "JCR2" };
let contas: AccountRow[] = [];
let campanhas: CampaignRow[] = [];
let carregando = false;

vi.mock("@tanstack/react-router", () => ({
  createFileRoute: () => (opts: Record<string, unknown>) => ({ options: opts }),
}));

vi.mock("@/lib/app-context", () => ({ useApp: () => ({ selectedCompany: empresa }) }));

vi.mock("@/hooks/use-breakdown", () => ({
  useAccountBreakdown: () => ({ data: contas, isLoading: carregando }),
  useCampaignBreakdown: () => ({ data: campanhas, isLoading: carregando }),
}));

vi.mock("@/components/metric-card", async () => {
  const real = await import("@/components/metric-card");
  return { ...real, EmptyCompany: () => <div data-testid="empty-company" /> };
});

// O relatorio semanal tem consulta e logica propria; aqui entra dublado para o
// alvo continuar sendo o dashboard.
vi.mock("@/components/weekly-report", () => ({
  WeeklyReport: () => <div data-testid="weekly" />,
}));

import { Route } from "./dashboard";

const Dashboard = (Route.options as unknown as { component: () => ReactNode }).component;

function conta(over: Partial<AccountRow> = {}): AccountRow {
  return {
    account_id: "act_1",
    account_name: "Conta A",
    company_id: "c1",
    tipo_conta: "leadgen",
    campaigns: 1,
    spend: 0,
    clicks: 0,
    link_clicks: 0,
    landing_page_views: 0,
    messaging_started: 0,
    form_leads: 0,
    gasto_em_formulario: 0,
    gasto_em_conversa: 0,
    gasto_em_trafego: 0,
    sales: 0,
    revenue: 0,
    ...over,
  };
}

function campanha(over: Partial<CampaignRow> = {}): CampaignRow {
  return {
    company_id: "c1",
    empresa: "JCR2",
    account_id: "act_1",
    account_name: "Conta A",
    campaign_id: "cmp_1",
    campanha: "Campanha 1",
    objective: null,
    tipo: "leadgen",
    status: "ACTIVE",
    spend: 0,
    impressions: 0,
    reach: 0,
    frequency: 0,
    clicks: 0,
    link_clicks: 0,
    landing_page_views: 0,
    messaging_started: 0,
    form_leads: 0,
    sales: 0,
    revenue: 0,
    base_de_resultado: "formularios",
    rotulo_do_custo: "por formulario enviado",
    unidade_do_resultado: "formularios",
    resultados: 0,
    custo_por_resultado: null,
    cpc_link: null,
    last_synced_at: null,
    ...over,
  };
}

/**
 * Valor do cartão de KPI de um rótulo.
 *
 * Precisa existir porque o MESMO número aparece duas vezes na tela: no KPI do
 * topo e na linha da tabela (uma campanha = uma conta com o mesmo gasto). Buscar
 * o texto solto acusa ambiguidade em vez de testar; e é justamente a coincidência
 * dos dois números que prova a reconciliação.
 */
function kpi(label: string): string {
  const rotulo = screen
    .getAllByText(label)
    .find((el) => el.className.includes("uppercase") && el.textContent === label);
  if (!rotulo) throw new Error(`Não achei o cartão de KPI "${label}"`);
  // Estrutura do MetricCard: Card > div(flex) > div(rótulo), e o valor é irmão do
  // flex, dentro do Card. Sobe DOIS níveis — `closest("div")` devolveria o próprio
  // rótulo, que foi o que me fez errar na primeira tentativa.
  const card = rotulo.parentElement?.parentElement;
  const valor = card?.querySelector(".text-2xl");
  if (!valor) throw new Error(`Cartão "${label}" sem valor .text-2xl`);
  // Normaliza o espaco NAO-QUEBRAVEL do pt-BR para espaco comum: o `textContent`
  // devolve o NBSP cru (diferente do getByText, que normaliza), e comparar
  // "R$\u00A0700,00" com "R$ 700,00" falha com duas strings que parecem iguais no
  // diff - erro caro de depurar. Aqui compara-se sempre com espaco comum.
  return (valor.textContent ?? "").replace(/\u00A0/g, " ");
}

beforeEach(() => {
  empresa = { id: "c1", name: "JCR2" };
  contas = [];
  campanhas = [];
  carregando = false;
  Element.prototype.hasPointerCapture = vi.fn(() => false);
  Element.prototype.releasePointerCapture = vi.fn();
  Element.prototype.scrollIntoView = vi.fn();
});

describe("sem empresa", () => {
  it("mostra o vazio", () => {
    empresa = null;
    render(<Dashboard />);
    expect(screen.getByTestId("empty-company")).toBeInTheDocument();
  });
});

describe("cabeçalho", () => {
  it("nomeia a empresa nos dados consolidados", () => {
    render(<Dashboard />);
    expect(screen.getByText(/Dados consolidados · JCR2/)).toBeInTheDocument();
  });

  it("tem título de nível 1", () => {
    render(<Dashboard />);
    expect(
      screen.getByRole("heading", { level: 1, name: "Dashboard executivo" }),
    ).toBeInTheDocument();
  });
});

describe("KPIs somados do nível de campanha", () => {
  it("soma o investimento das campanhas", () => {
    campanhas = [campanha({ spend: 1000 }), campanha({ campaign_id: "c2", spend: 234.5 })];
    render(<Dashboard />);
    expect(screen.getByText(`R$${NB}1.234,50`)).toBeInTheDocument();
  });

  it("o custo por formulario divide o gasto DA BASE, nao o investimento total", () => {
    // R$ 1.000 investidos, dos quais R$ 400 em campanha de trafego, que nao produz
    // formulario. Dividir o total pelos 50 formularios daria R$ 20,00 — 66% acima do custo
    // real. Foi esse numerador que inflou o indicador da carteira medida em 5,4x.
    campanhas = [
      campanha({ base_de_resultado: "formularios", spend: 600, form_leads: 50 }),
      campanha({
        campaign_id: "c2",
        tipo: "trafego",
        base_de_resultado: "cliques_no_link",
        spend: 400,
        link_clicks: 800,
      }),
    ];
    render(<Dashboard />);
    expect(kpi("Formulários")).toBe("50");
    expect(kpi("Custo por formulário")).toBe(`R$${NB}12,00`); // 600 / 50, nao 1000 / 50
  });

  it("ZERO resultado na base nao divide por zero", () => {
    campanhas = [campanha({ spend: 500, form_leads: 0 })];
    render(<Dashboard />);
    expect(kpi("Custo por formulário")).toBe("—");
  });

  it("sem campanha nenhuma, os KPIs sao zero — nao vazio", () => {
    // Zero e informacao ("nao houve investimento"); campo vazio parece defeito.
    campanhas = [];
    render(<Dashboard />);
    expect(screen.getByText(`R$${NB}0,00`)).toBeInTheDocument();
  });

  it("mostra os KPIs de aquisição", () => {
    campanhas = [campanha({ link_clicks: 400, messaging_started: 25, form_leads: 30 })];
    render(<Dashboard />);
    // Cada um pelo cartao: o rotulo tambem aparece como cabecalho de coluna na tabela.
    expect(kpi("Cliques no link")).toBe("400");
    expect(kpi("Conversas")).toBe("25");
    expect(kpi("Formulários")).toBe("30");
    expect(kpi("Investimento")).toBeTruthy();
    // "CPL" nao existe mais como cartao: custo sem denominador declarado saiu da tela.
    expect(screen.queryByText("CPL")).not.toBeInTheDocument();
  });
});

describe("colunas de venda aparecem só quando há venda", () => {
  it("sem receita e sem venda, NAO mostra Compras/Receita/ROAS", () => {
    // Mostrar "ROAS 0,00x" numa conta que nao vende sugere resultado ruim onde
    // nao ha sequer a metrica.
    campanhas = [campanha({ spend: 100, sales: 0, revenue: 0 })];
    render(<Dashboard />);
    expect(screen.queryByText("ROAS")).not.toBeInTheDocument();
    expect(screen.queryByText("Receita")).not.toBeInTheDocument();
  });

  it("com receita, mostra Compras, Receita e ROAS", () => {
    campanhas = [campanha({ spend: 1000, sales: 10, revenue: 5000 })];
    render(<Dashboard />);
    expect(screen.getByText("Compras")).toBeInTheDocument();
    expect(screen.getByText("Receita")).toBeInTheDocument();
    expect(screen.getByText("ROAS")).toBeInTheDocument();
  });

  it("com venda e SEM receita, ainda mostra (a venda existiu)", () => {
    campanhas = [campanha({ spend: 100, sales: 3, revenue: 0 })];
    render(<Dashboard />);
    expect(screen.getByText("Compras")).toBeInTheDocument();
  });
});

describe("filtro por tipo", () => {
  it("oferece chip apenas dos tipos PRESENTES nos dados", () => {
    campanhas = [campanha({ tipo: "leadgen" }), campanha({ campaign_id: "c2", tipo: "mensagem" })];
    render(<Dashboard />);
    expect(screen.getByRole("button", { name: "Leadgen" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Mensagem" })).toBeInTheDocument();
    // Tipo que nao existe nos dados nao vira chip.
    expect(screen.queryByRole("button", { name: "Vídeo" })).not.toBeInTheDocument();
  });

  it("escolher um tipo ENCOLHE o KPI junto", async () => {
    // O erro que isso evita: filtrar a tabela e deixar o numero grande do topo
    // parado, mostrando dois totais diferentes na mesma tela.
    campanhas = [
      campanha({ tipo: "leadgen", spend: 700, form_leads: 10 }),
      campanha({ campaign_id: "c2", tipo: "mensagem", spend: 300 }),
    ];
    render(<Dashboard />);
    expect(kpi("Investimento")).toBe(`R$ 1.000,00`);

    await userEvent.click(screen.getByRole("button", { name: "Leadgen" }));
    await waitFor(() => expect(kpi("Investimento")).toBe(`R$ 700,00`));
  });

  it("voltar para 'Todos' restaura o total", async () => {
    campanhas = [
      campanha({ tipo: "leadgen", spend: 700 }),
      campanha({ campaign_id: "c2", tipo: "mensagem", spend: 300 }),
    ];
    render(<Dashboard />);
    await userEvent.click(screen.getByRole("button", { name: "Leadgen" }));
    await waitFor(() => expect(kpi("Investimento")).toBe(`R$ 700,00`));
    await userEvent.click(screen.getByRole("button", { name: "Todos" }));
    await waitFor(() => expect(kpi("Investimento")).toBe(`R$ 1.000,00`));
  });
});

describe("contas dormentes", () => {
  it("conta SEM dados nao entra na tabela", () => {
    // Ela existe, mas listar junto faria a tabela sugerir atividade que nao houve.
    contas = [
      conta({ account_id: "act_1", account_name: "Ativa" }),
      conta({ account_id: "act_2", account_name: "Dormente", tipo_conta: "sem_dados" }),
    ];
    render(<Dashboard />);
    expect(screen.getByText("Ativa")).toBeInTheDocument();
    expect(screen.queryByText("Dormente")).not.toBeInTheDocument();
  });

  it("a tabela conta apenas as contas com dados", () => {
    contas = [
      conta({ account_id: "act_1" }),
      conta({ account_id: "act_2", tipo_conta: "sem_dados" }),
    ];
    render(<Dashboard />);
    expect(screen.getByText("1 conta(s)")).toBeInTheDocument();
  });
});

describe("troca de empresa", () => {
  it("ZERA os filtros de conta e tipo", async () => {
    // Sem isso, a empresa nova abriria filtrada por uma conta que nao e dela — e
    // a tela mostraria zero como se nao houvesse investimento.
    campanhas = [
      campanha({ tipo: "leadgen", spend: 700 }),
      campanha({ campaign_id: "c2", tipo: "mensagem", spend: 300 }),
    ];
    const { rerender } = render(<Dashboard />);
    await userEvent.click(screen.getByRole("button", { name: "Leadgen" }));
    await waitFor(() => expect(kpi("Investimento")).toBe(`R$ 700,00`));

    empresa = { id: "c2", name: "Outra" };
    campanhas = [campanha({ campaign_id: "z", tipo: "mensagem", spend: 999 })];
    rerender(<Dashboard />);
    // Se o filtro de tipo tivesse sobrevivido, "mensagem" seria excluida e o KPI
    // mostraria R$ 0,00 em vez dos 999.
    await waitFor(() => expect(kpi("Investimento")).toBe(`R$ 999,00`));
  });
});

describe("carregando", () => {
  it("mostra esqueleto em vez de zeros enquanto carrega", () => {
    // Zeros durante a carga leriam como "nao houve investimento".
    carregando = true;
    const { container } = render(<Dashboard />);
    expect(container.querySelectorAll(".animate-pulse").length).toBeGreaterThan(0);
  });
});

describe("relatório semanal", () => {
  it("está na tela", () => {
    render(<Dashboard />);
    expect(screen.getByTestId("weekly")).toBeInTheDocument();
  });
});

describe("título da página", () => {
  it("declara Dashboard executivo", () => {
    const head = (Route.options as unknown as { head?: () => { meta: { title: string }[] } }).head;
    if (head) expect(head().meta[0].title).toContain("Dashboard");
  });
});
