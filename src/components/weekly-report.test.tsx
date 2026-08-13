import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEventBase from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";

const userEvent = userEventBase.setup({ delay: null });

// O relatorio semanal. Duas saidas, com publicos diferentes:
//   - o TEXTO copiado, que vai colado no WhatsApp do cliente;
//   - a PLANILHA, que ele abre no Excel.
// O que organiza os testes e a honestidade das duas: o texto declara a cobertura
// quando faltou dia, mostra so o ROTULO do que nao esta disponivel (o motivo
// tecnico fica na tela, nao na mensagem ao cliente), e a exportacao recusa
// periodo sem dado em vez de gerar planilha vazia.

let resposta: { data: unknown; error: unknown } = { data: null, error: null };
let respostaExport: { data: unknown; error: unknown } = { data: null, error: null };
const rpcMock = vi.fn();
const exportarMock = vi.fn();
const toastErrorMock = vi.fn();
const toastSuccessMock = vi.fn();
const writeTextMock = vi.fn();

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    rpc: (nome: string, args: unknown) => {
      rpcMock(nome, args);
      return Promise.resolve(nome === "get_report_export_data" ? respostaExport : resposta);
    },
  },
}));

vi.mock("sonner", () => ({
  toast: {
    error: (...a: unknown[]) => toastErrorMock(...a),
    success: (...a: unknown[]) => toastSuccessMock(...a),
  },
}));

vi.mock("@/lib/relatorio-xlsx", () => ({
  exportarRelatorioRico: (...a: unknown[]) => exportarMock(...a),
}));

import { WeeklyReport } from "./weekly-report";

function relatorio(over: Record<string, unknown> = {}) {
  return {
    periodo: { inicio: "2026-08-03", fim: "2026-08-09", dias_com_dado: 7, dias_no_periodo: 7 },
    investimento: 1500,
    formularios: 30,
    custo_por_formulario: 50,
    cliques_link: 600,
    custo_por_clique: 2.5,
    visualizacoes_pagina: 450,
    ctr_pct: 3.2,
    conversao_view_form_pct: 6.7,
    por_campanha: [],
    nao_disponivel: [],
    ...over,
  };
}

function montar() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const Wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={qc}>{children}</QueryClientProvider>
  );
  return render(<WeeklyReport companyId="c1" empresaNome="JCR2" />, { wrapper: Wrapper });
}

/** Copia e devolve o texto que foi para a área de transferência. */
async function copiar(): Promise<string> {
  await userEvent.click(await screen.findByRole("button", { name: /Copiar/ }));
  await waitFor(() => expect(writeTextMock).toHaveBeenCalled());
  return writeTextMock.mock.calls[0][0] as string;
}

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  // Quinta-feira, 13/08/2026. A semana anterior é 03/08 (seg) a 09/08 (dom).
  vi.setSystemTime(new Date("2026-08-13T12:00:00Z"));
  resposta = { data: relatorio(), error: null };
  respostaExport = { data: { serie_diaria: [{ d: "2026-08-03" }] }, error: null };
  rpcMock.mockReset();
  exportarMock.mockReset().mockResolvedValue("relatorio_jcr2.xlsx");
  toastErrorMock.mockReset();
  toastSuccessMock.mockReset();
  writeTextMock.mockReset().mockResolvedValue(undefined);
  // `navigator.clipboard` é getter-only no jsdom: Object.assign estoura com
  // "Cannot set property clipboard". defineProperty é o caminho.
  Object.defineProperty(navigator, "clipboard", {
    value: { writeText: writeTextMock },
    configurable: true,
  });
});

afterEach(() => {
  vi.useRealTimers();
});

describe("período inicial", () => {
  it("abre na SEMANA ANTERIOR, segunda a domingo", async () => {
    // E o periodo que o gestor reporta: a semana fechada, nao a corrente (que
    // ainda esta incompleta e daria numero parcial ao cliente).
    montar();
    await waitFor(() => expect(rpcMock).toHaveBeenCalled());
    const args = rpcMock.mock.calls[0][1] as { p_start: string; p_end: string };
    expect(args.p_start).toBe("2026-08-03"); // segunda
    expect(args.p_end).toBe("2026-08-09"); // domingo
  });

  it("consulta a RPC da tela com a empresa", async () => {
    montar();
    await waitFor(() =>
      expect(rpcMock).toHaveBeenCalledWith(
        "get_weekly_report_data",
        expect.objectContaining({ p_company_id: "c1" }),
      ),
    );
  });
});

describe("texto do WhatsApp", () => {
  it("traz as métricas na ordem, com os rótulos que o gestor usa", async () => {
    montar();
    const txt = await copiar();
    expect(txt).toContain("📅 03/08 a 09/08");
    expect(txt).toContain("💰 Investimento: R$");
    expect(txt).toContain("📝 Formulários: 30");
    expect(txt).toContain("🎯 Custo por formulário: R$");
    expect(txt).toContain("🔗 Cliques no link: 600");
    expect(txt).toContain("📊 CTR: 3,2");
    // A ordem importa: e a mesma das mensagens que ele ja mandava a mao.
    expect(txt.indexOf("Investimento")).toBeLessThan(txt.indexOf("Formulários"));
    expect(txt.indexOf("Formulários")).toBeLessThan(txt.indexOf("Cliques no link"));
  });

  it("métrica ausente vira travessão, não 'null'", async () => {
    resposta = { data: relatorio({ custo_por_formulario: null, ctr_pct: null }), error: null };
    montar();
    const txt = await copiar();
    expect(txt).toContain("🎯 Custo por formulário: —");
    expect(txt).not.toContain("null");
  });

  it("lista as campanhas quando há", async () => {
    resposta = {
      data: relatorio({
        por_campanha: [{ campanha: "Leads Julho", gasto: 900, formularios: 18 }],
      }),
      error: null,
    };
    montar();
    const txt = await copiar();
    expect(txt).toContain("Por campanha:");
    expect(txt).toContain("• Leads Julho: R$");
    expect(txt).toContain("18 formulários");
  });

  it("sem campanha, não gera seção vazia", async () => {
    resposta = { data: relatorio({ por_campanha: [] }), error: null };
    montar();
    expect(await copiar()).not.toContain("Por campanha:");
  });

  it("do 'não disponível' vai só o RÓTULO — o motivo técnico fica na tela", async () => {
    // A mensagem e para o cliente. Mandar "conversas_whatsapp: coluna ausente na
    // view X" seria despejar detalhe interno em quem nao tem contexto.
    resposta = {
      data: relatorio({
        nao_disponivel: ["conversas_whatsapp: coluna ausente na view", "leads_crm: sem integração"],
      }),
      error: null,
    };
    montar();
    const txt = await copiar();
    expect(txt).toContain("• conversas whatsapp");
    expect(txt).toContain("• leads crm");
    expect(txt).not.toContain("coluna ausente");
    expect(txt).not.toContain("sem integração");
  });

  it("DECLARA a cobertura quando faltou dia no período", async () => {
    // Sem isso o cliente le o total como se fosse a semana inteira.
    resposta = {
      data: relatorio({
        periodo: { inicio: "2026-08-03", fim: "2026-08-09", dias_com_dado: 4, dias_no_periodo: 7 },
      }),
      error: null,
    };
    montar();
    expect(await copiar()).toContain("⚠️ Cobertura: 4 de 7 dias com dado.");
  });

  it("semana completa NÃO leva aviso de cobertura", async () => {
    resposta = { data: relatorio(), error: null };
    montar();
    expect(await copiar()).not.toContain("Cobertura:");
  });
});

describe("copiar", () => {
  it("confirma que o texto foi para a área de transferência", async () => {
    montar();
    await copiar();
    expect(toastSuccessMock).toHaveBeenCalledWith("Relatório copiado — cole no WhatsApp.");
  });

  it("navegador bloqueando a cópia INSTRUI a selecionar manualmente", async () => {
    // O texto continua na tela: a saida existe, so nao e automatica.
    writeTextMock.mockRejectedValue(new Error("NotAllowedError"));
    montar();
    await userEvent.click(await screen.findByRole("button", { name: /Copiar/ }));
    await waitFor(() =>
      expect(toastErrorMock).toHaveBeenCalledWith(
        "O navegador bloqueou a cópia. Selecione o texto abaixo manualmente.",
      ),
    );
  });
});

describe("exportar planilha", () => {
  it("usa uma RPC PRÓPRIA, mais rica que a da tela", async () => {
    // A da tela nao tem serie diaria nem anuncios; exportar com ela produziria
    // uma planilha pobre sem ninguem perceber.
    montar();
    await userEvent.click(await screen.findByRole("button", { name: /Exportar/ }));
    await waitFor(() =>
      expect(rpcMock).toHaveBeenCalledWith(
        "get_report_export_data",
        expect.objectContaining({ p_company_id: "c1", p_start: "2026-08-03" }),
      ),
    );
  });

  it("gera o arquivo e informa o nome", async () => {
    montar();
    await userEvent.click(await screen.findByRole("button", { name: /Exportar/ }));
    await waitFor(() => expect(exportarMock).toHaveBeenCalled());
    expect(exportarMock.mock.calls[0][1]).toBe("JCR2");
    expect(toastSuccessMock).toHaveBeenCalledWith("Planilha gerada: relatorio_jcr2.xlsx");
  });

  it("período SEM dado recusa em vez de gerar planilha vazia", async () => {
    // Planilha vazia chegaria ao cliente parecendo relatorio.
    respostaExport = { data: { serie_diaria: [] }, error: null };
    montar();
    await userEvent.click(await screen.findByRole("button", { name: /Exportar/ }));
    await waitFor(() =>
      expect(toastErrorMock).toHaveBeenCalledWith("Sem dados no período para exportar."),
    );
    expect(exportarMock).not.toHaveBeenCalled();
  });

  it("resposta sem serie_diaria também recusa", async () => {
    respostaExport = { data: {}, error: null };
    montar();
    await userEvent.click(await screen.findByRole("button", { name: /Exportar/ }));
    await waitFor(() =>
      expect(toastErrorMock).toHaveBeenCalledWith("Sem dados no período para exportar."),
    );
  });

  it("erro da RPC vira mensagem TRUNCADA, não um paredão", async () => {
    respostaExport = { data: null, error: new Error("x".repeat(400)) };
    montar();
    await userEvent.click(await screen.findByRole("button", { name: /Exportar/ }));
    await waitFor(() => expect(toastErrorMock).toHaveBeenCalled());
    const msg = toastErrorMock.mock.calls[0][0] as string;
    expect(msg).toContain("Não foi possível gerar a planilha:");
    expect(msg.length).toBeLessThan(200);
  });

  it("falha na geração do arquivo também é reportada", async () => {
    exportarMock.mockRejectedValue(new Error("ExcelJS quebrou"));
    montar();
    await userEvent.click(await screen.findByRole("button", { name: /Exportar/ }));
    await waitFor(() =>
      expect(toastErrorMock).toHaveBeenCalledWith(
        expect.stringContaining("Não foi possível gerar a planilha: ExcelJS quebrou"),
      ),
    );
  });

  it("desabilita o botão enquanto exporta, e reabilita no fim", async () => {
    let liberar: (v: string) => void = () => {};
    exportarMock.mockReturnValue(new Promise((r) => (liberar = r)));
    montar();
    const btn = await screen.findByRole("button", { name: /Exportar/ });
    await userEvent.click(btn);
    await waitFor(() => expect(btn).toBeDisabled());
    liberar("x.xlsx");
    await waitFor(() => expect(btn).toBeEnabled());
  });

  it("reabilita o botão mesmo quando dá erro (finally)", async () => {
    // Sem o finally, um erro deixaria o botao morto ate recarregar a pagina.
    exportarMock.mockRejectedValue(new Error("falhou"));
    montar();
    const btn = await screen.findByRole("button", { name: /Exportar/ });
    await userEvent.click(btn);
    await waitFor(() => expect(toastErrorMock).toHaveBeenCalled());
    expect(btn).toBeEnabled();
  });
});

describe("estados de carga e erro", () => {
  it("mostra esqueleto enquanto a consulta não volta", () => {
    resposta = { data: new Promise(() => {}) as never, error: null };
    const { container } = montar();
    expect(container.querySelectorAll(".animate-pulse").length).toBeGreaterThan(0);
  });

  it("sem relatório, não deixa copiar texto inexistente", async () => {
    resposta = { data: null, error: null };
    montar();
    await waitFor(() => expect(rpcMock).toHaveBeenCalled());
    const btn = screen.queryByRole("button", { name: /Copiar/ });
    if (btn) {
      await userEvent.click(btn);
      expect(writeTextMock).not.toHaveBeenCalled();
    }
  });
});
