import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { AccountsTable } from "./accounts-table";
import { AccountSelector, ALL_ACCOUNTS } from "./account-selector";
import { CampaignsTable } from "./campaigns-table";
import type { AccountRow, CampaignRow, TipoConta } from "@/lib/breakdown";

// Tabelas e seletor de conta. Sao os componentes que o gestor OLHA para decidir,
// entao o que vale prender e: numero formatado em pt-BR, vazio dizendo que esta
// vazio (e por que), CPL sem divisao por zero, e conta sem dado nao se
// disfarcando de conta ativa.

const NB = " "; // espaço não-quebrável do pt-BR

function conta(over: Partial<AccountRow> = {}): AccountRow {
  return {
    account_id: "act_1",
    account_name: "Conta JCR2",
    company_id: "c1",
    tipo_conta: "leadgen",
    campaigns: 3,
    spend: 1000,
    clicks: 500,
    link_clicks: 400,
    landing_page_views: 300,
    messaging_started: 20,
    form_leads: 40,
    leads: 50,
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
    account_name: "Conta JCR2",
    campaign_id: "cmp_1",
    campanha: "Leads Julho",
    objective: null,
    tipo: "leadgen",
    status: "ACTIVE",
    spend: 600,
    impressions: 10000,
    reach: 8000,
    frequency: 1.2,
    clicks: 500,
    link_clicks: 400,
    landing_page_views: 300,
    messaging_started: 0,
    form_leads: 30,
    leads: 30,
    sales: 0,
    revenue: 0,
    cpl: 20,
    cpc_link: 1.5,
    last_synced_at: null,
    ...over,
  };
}

describe("AccountsTable", () => {
  it("vazio explica o motivo (filtro), nao so 'sem dados'", () => {
    // Diferenca util: "nao ha conta" e "o filtro nao deixou nenhuma passar" sao
    // problemas diferentes para o gestor.
    render(<AccountsTable accounts={[]} onSelect={vi.fn()} />);
    expect(
      screen.getByText("Nenhuma conta com dados para o filtro selecionado."),
    ).toBeInTheDocument();
  });

  it("conta quantas contas ha", () => {
    render(
      <AccountsTable accounts={[conta(), conta({ account_id: "act_2" })]} onSelect={vi.fn()} />,
    );
    expect(screen.getByText("2 conta(s)")).toBeInTheDocument();
  });

  it("formata gasto em real e inteiros com separador", () => {
    render(<AccountsTable accounts={[conta({ spend: 1234.5, leads: 1200 })]} onSelect={vi.fn()} />);
    expect(screen.getByText(`R$${NB}1.234,50`)).toBeInTheDocument();
    expect(screen.getByText("1.200")).toBeInTheDocument();
  });

  it("calcula o CPL da linha", () => {
    render(<AccountsTable accounts={[conta({ spend: 1000, leads: 50 })]} onSelect={vi.fn()} />);
    expect(screen.getByText(`R$${NB}20,00`)).toBeInTheDocument();
  });

  it("ZERO leads mostra travessao, nao divisao por zero", () => {
    render(<AccountsTable accounts={[conta({ spend: 1000, leads: 0 })]} onSelect={vi.fn()} />);
    expect(screen.getByText("—")).toBeInTheDocument();
  });

  it("clicar na linha seleciona a conta", async () => {
    const onSelect = vi.fn();
    render(<AccountsTable accounts={[conta({ account_id: "act_9" })]} onSelect={onSelect} />);
    await userEvent.click(screen.getByText("Conta JCR2"));
    expect(onSelect).toHaveBeenCalledWith("act_9");
  });

  it("mostra o tipo da conta como selo", () => {
    render(<AccountsTable accounts={[conta({ tipo_conta: "mensagem" })]} onSelect={vi.fn()} />);
    expect(screen.getByText("Mensagem")).toBeInTheDocument();
  });

  it("números ficam alinhados à direita com tabular-nums", () => {
    // Coluna de dinheiro desalinhada e difícil de comparar de bater o olho.
    const { container } = render(<AccountsTable accounts={[conta()]} onSelect={vi.fn()} />);
    const celulas = [...container.querySelectorAll("td")].filter((c) =>
      c.className.includes("tabular-nums"),
    );
    expect(celulas.length).toBeGreaterThanOrEqual(6);
    for (const c of celulas) expect(c.className).toContain("text-right");
  });
});

describe("AccountSelector", () => {
  it("mostra 'Todas as contas' quando nada esta filtrado", () => {
    render(<AccountSelector accounts={[conta()]} value={ALL_ACCOUNTS} onChange={vi.fn()} />);
    expect(screen.getByRole("button", { name: /Todas as contas/ })).toBeInTheDocument();
  });

  it("mostra o nome da conta selecionada", () => {
    render(<AccountSelector accounts={[conta()]} value="act_1" onChange={vi.fn()} />);
    expect(screen.getByRole("button", { name: /Conta JCR2/ })).toBeInTheDocument();
  });

  it("id selecionado que nao existe na lista cai em 'Conta', sem estourar", () => {
    render(<AccountSelector accounts={[conta()]} value="act_removida" onChange={vi.fn()} />);
    expect(screen.getByRole("button", { name: /Conta/ })).toBeInTheDocument();
  });

  it("separa contas COM dado das SEM dado", async () => {
    // A distincao existe para a conta dormente nao se disfarcar de ativa na
    // escolha do gestor.
    render(
      <AccountSelector
        accounts={[conta(), conta({ account_id: "act_2", tipo_conta: "sem_dados" })]}
        value={ALL_ACCOUNTS}
        onChange={vi.fn()}
      />,
    );
    await userEvent.click(screen.getByRole("button", { name: /Todas as contas/ }));
    expect(await screen.findByText("Com dados")).toBeInTheDocument();
    expect(screen.getByText("Sem dados no período (1)")).toBeInTheDocument();
  });

  it("conta SEM dado nao e selecionavel", async () => {
    render(
      <AccountSelector
        accounts={[
          conta({ account_id: "act_2", account_name: "Dormente", tipo_conta: "sem_dados" }),
        ]}
        value={ALL_ACCOUNTS}
        onChange={vi.fn()}
      />,
    );
    await userEvent.click(screen.getByRole("button", { name: /Todas as contas/ }));
    const item = (await screen.findByText("Dormente")).closest('[role="menuitem"]');
    expect(item).toHaveAttribute("aria-disabled", "true");
  });

  it("escolher uma conta informa o consumidor", async () => {
    const onChange = vi.fn();
    render(
      <AccountSelector
        accounts={[conta({ account_id: "act_9" })]}
        value={ALL_ACCOUNTS}
        onChange={onChange}
      />,
    );
    await userEvent.click(screen.getByRole("button", { name: /Todas as contas/ }));
    await userEvent.click(await screen.findByText("Conta JCR2"));
    expect(onChange).toHaveBeenCalledWith("act_9");
  });

  it("voltar para 'Todas' limpa o filtro de conta", async () => {
    const onChange = vi.fn();
    render(<AccountSelector accounts={[conta()]} value="act_1" onChange={onChange} />);
    await userEvent.click(screen.getByRole("button", { name: /Conta JCR2/ }));
    const itens = await screen.findAllByText("Todas as contas");
    await userEvent.click(itens[itens.length - 1]);
    expect(onChange).toHaveBeenCalledWith(ALL_ACCOUNTS);
  });

  it("mostra o gasto de cada conta no menu (ajuda a escolher)", async () => {
    render(
      <AccountSelector
        accounts={[conta({ spend: 2500 })]}
        value={ALL_ACCOUNTS}
        onChange={vi.fn()}
      />,
    );
    await userEvent.click(screen.getByRole("button", { name: /Todas as contas/ }));
    expect(await screen.findByText(`R$${NB}2.500,00`)).toBeInTheDocument();
  });

  it("sem nenhuma conta, so oferece 'Todas'", async () => {
    render(<AccountSelector accounts={[]} value={ALL_ACCOUNTS} onChange={vi.fn()} />);
    await userEvent.click(screen.getByRole("button", { name: /Todas as contas/ }));
    expect(screen.queryByText("Com dados")).not.toBeInTheDocument();
    expect(screen.queryByText(/Sem dados no período/)).not.toBeInTheDocument();
  });
});

describe("CampaignsTable", () => {
  it("nomeia a conta e conta as campanhas", () => {
    render(<CampaignsTable campaigns={[campanha()]} accountName="Conta JCR2" />);
    expect(screen.getByText("Conta JCR2")).toBeInTheDocument();
    expect(screen.getByText("1 campanha(s)")).toBeInTheDocument();
  });

  it("mostra o nome da campanha", () => {
    render(<CampaignsTable campaigns={[campanha()]} accountName="x" />);
    expect(screen.getByText("Leads Julho")).toBeInTheDocument();
  });

  it("destaca a metrica-resultado DO TIPO da campanha", () => {
    // leadgen destaca formularios; trafego destacaria cliques no link. Mostrar a
    // metrica errada faria o gestor comparar coisas diferentes.
    render(
      <CampaignsTable
        campaigns={[campanha({ tipo: "leadgen", form_leads: 30 })]}
        accountName="x"
      />,
    );
    expect(screen.getByText("30")).toBeInTheDocument();
  });

  it("campanha de trafego destaca cliques no link", () => {
    render(
      <CampaignsTable
        campaigns={[campanha({ tipo: "trafego", link_clicks: 444 })]}
        accountName="x"
      />,
    );
    expect(screen.getByText("444")).toBeInTheDocument();
  });

  it("lista vazia nao estoura", () => {
    render(<CampaignsTable campaigns={[]} accountName="x" />);
    expect(screen.getByText("0 campanha(s)")).toBeInTheDocument();
  });

  it("tipo desconhecido nao derruba a tabela", () => {
    render(
      <CampaignsTable campaigns={[campanha({ tipo: "inventado" as TipoConta })]} accountName="x" />,
    );
    expect(screen.getByText("Leads Julho")).toBeInTheDocument();
  });

  it("formata o gasto em real", () => {
    render(<CampaignsTable campaigns={[campanha({ spend: 600 })]} accountName="x" />);
    expect(screen.getByText(`R$${NB}600,00`)).toBeInTheDocument();
  });
});
