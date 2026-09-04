import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEventBase from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { TooltipProvider } from "@/components/ui/tooltip";
import type { ReactNode } from "react";

const userEvent = userEventBase.setup({ delay: null });

// O painel de importacao da Infobip. E o unico ponto do front onde o usuario
// ENVIA arquivo, entao o que vale prender e o comportamento diante de arquivo
// ruim: planilha sem linha util nomeia O ARQUIVO e SEGUE para o proximo, em vez
// de abortar o lote inteiro; e a mensagem de sucesso repete a promessa de
// idempotencia ("reimportar nao duplica"), que e o que faz o gestor se sentir
// seguro para reenviar.

let isAdmin = true;
let linhas: Record<string, unknown>[] = [];
/** Erro da consulta de envios: prova que falha ≠ "nenhum dado importado". */
let erroDosEnvios: unknown = null;
const lerMock = vi.fn();
const enviarMock = vi.fn();
const exportarMock = vi.fn();
const toastErrorMock = vi.fn();
const toastSuccessMock = vi.fn();
const gteMock = vi.fn();
const lteMock = vi.fn();

vi.mock("@/lib/app-context", () => ({ useApp: () => ({ isAdmin }) }));

vi.mock("@/lib/infobip-import", () => ({
  lerArquivoInfobip: (...a: unknown[]) => lerMock(...a),
  enviarLotes: (...a: unknown[]) => enviarMock(...a),
}));

vi.mock("@/lib/xlsx-export", () => ({
  exportarXlsx: (...a: unknown[]) => exportarMock(...a),
  nomeComPeriodo: (p: string, i: string, f: string) => `${p}_${i}_a_${f}.xlsx`,
}));

vi.mock("sonner", () => ({
  toast: {
    error: (...a: unknown[]) => toastErrorMock(...a),
    success: (...a: unknown[]) => toastSuccessMock(...a),
  },
}));

vi.mock("@/integrations/supabase/client", () => {
  // Encadeamento: .from().select().eq()[.gte()][.lte()].limit()
  const chain: Record<string, unknown> = {};
  chain.gte = (...a: unknown[]) => {
    gteMock(...a);
    return chain;
  };
  chain.lte = (...a: unknown[]) => {
    lteMock(...a);
    return chain;
  };
  chain.limit = () =>
    Promise.resolve(
      erroDosEnvios ? { data: null, error: erroDosEnvios } : { data: linhas, error: null },
    );
  chain.eq = () => chain;
  chain.select = () => chain;
  return { supabase: { from: () => chain } };
});

import { InfobipPanel } from "./infobip-panel";

function montar() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const Wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={qc}>
      <TooltipProvider>{children}</TooltipProvider>
    </QueryClientProvider>
  );
  return render(<InfobipPanel companyId="c1" />, { wrapper: Wrapper });
}

function planilha(nome: string) {
  return new File(["x"], nome, {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });
}

/** Seleciona arquivos no input escondido de importação. */
async function importar(...arquivos: File[]) {
  const input = document.querySelector('input[type="file"]') as HTMLInputElement;
  await userEvent.upload(input, arquivos);
}

const META = { arquivo: "x.xlsx", tipo: "mensagens", linhas: 10, ignoradas: 0, periodo: {} };

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  vi.setSystemTime(new Date("2026-08-13T12:00:00Z"));
  isAdmin = true;
  linhas = [];
  erroDosEnvios = null;
  lerMock.mockReset().mockResolvedValue({ rows: [{ message_id: "m1" }], meta: META });
  enviarMock.mockReset().mockResolvedValue({ gravadas: 1 });
  exportarMock.mockReset();
  toastErrorMock.mockReset();
  toastSuccessMock.mockReset();
  gteMock.mockReset();
  lteMock.mockReset();
  Element.prototype.hasPointerCapture = vi.fn(() => false);
  Element.prototype.scrollIntoView = vi.fn();
});

// Esta tela ja distinguia "periodo sem movimento" de "nada importado" — o
// comentario no fonte prova que alguem pensou nisso. Faltava o terceiro caso:
// nao ter conseguido perguntar. Erro de consulta caia no ramo `vazio` e virava
// "Nenhum dado da Infobip importado", uma afirmacao sobre o banco que ninguem
// verificou — e que manda o admin reimportar o que talvez ja exista.
describe("falha de consulta nao e 'nada importado'", () => {
  it("FALHA se identifica como falha, com opcao de tentar de novo", async () => {
    erroDosEnvios = { message: 'permission denied for table "infobip_dispatches"' };
    montar();
    expect(
      await screen.findByText(/não foi possível carregar os envios da infobip/i),
    ).toBeInTheDocument();
    expect(screen.queryByText(/nenhum dado da infobip importado/i)).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /tentar de novo/i })).toBeInTheDocument();
  });

  it("empresa genuinamente sem importacao mostra o vazio, e NAO acusa falha", async () => {
    // O par: reunificar os dois estados reprova aqui ou no teste acima.
    linhas = [];
    montar();
    expect(await screen.findByText(/nenhum dado da infobip importado/i)).toBeInTheDocument();
    expect(screen.queryByText(/não foi possível carregar/i)).not.toBeInTheDocument();
  });
});

describe("gate de admin", () => {
  it("admin tem o campo de arquivo", async () => {
    montar();
    await waitFor(() => expect(document.querySelector('input[type="file"]')).not.toBeNull());
  });

  it("nao-admin NAO tem como importar", async () => {
    isAdmin = false;
    montar();
    await new Promise((r) => setTimeout(r, 30));
    expect(document.querySelector('input[type="file"]')).toBeNull();
  });

  it("aceita apenas .xlsx", async () => {
    // O parser espera a aba Data de um xlsx; aceitar csv aqui daria erro
    // confuso la dentro em vez de recusa clara no seletor.
    montar();
    await waitFor(() => {
      const input = document.querySelector('input[type="file"]') as HTMLInputElement;
      expect(input.accept).toBe(".xlsx");
    });
  });
});

describe("importação", () => {
  it("passa a empresa para o parser e envia as linhas", async () => {
    montar();
    await importar(planilha("export.xlsx"));
    await waitFor(() => expect(lerMock).toHaveBeenCalled());
    expect(lerMock.mock.calls[0][1]).toBe("c1");
    expect(enviarMock).toHaveBeenCalled();
  });

  it("confirma o total e REPETE a promessa de idempotência", async () => {
    // "reimportar nao duplica" e o que permite o gestor reenviar sem medo — a
    // garantia vem do indice unico (message_id, service_name).
    lerMock.mockResolvedValue({ rows: [{ message_id: "m1" }], meta: { ...META, linhas: 1234 } });
    montar();
    await importar(planilha("export.xlsx"));
    await waitFor(() =>
      expect(toastSuccessMock).toHaveBeenCalledWith(
        "1.234 linha(s) processadas — reimportar não duplica.",
      ),
    );
  });

  it("processa VÁRIOS arquivos numa seleção só", async () => {
    montar();
    await importar(planilha("a.xlsx"), planilha("b.xlsx"));
    await waitFor(() => expect(lerMock).toHaveBeenCalledTimes(2));
    expect(enviarMock).toHaveBeenCalledTimes(2);
  });

  it("arquivo SEM linha útil nomeia o arquivo e SEGUE para o próximo", async () => {
    // Abortar o lote inteiro por causa de uma planilha errada obrigaria a
    // reselecionar tudo. O erro diz QUAL arquivo, e os outros entram.
    lerMock
      .mockResolvedValueOnce({ rows: [], meta: META })
      .mockResolvedValueOnce({ rows: [{ message_id: "m1" }], meta: META });
    montar();
    await importar(planilha("vazio.xlsx"), planilha("bom.xlsx"));
    await waitFor(() =>
      expect(toastErrorMock).toHaveBeenCalledWith(
        '"vazio.xlsx": nenhuma linha com Message Id na aba Data.',
      ),
    );
    // O segundo foi processado mesmo assim.
    expect(enviarMock).toHaveBeenCalledTimes(1);
    expect(toastSuccessMock).toHaveBeenCalled();
  });

  it("erro de RLS vira mensagem de PERMISSÃO, não erro cru", async () => {
    enviarMock.mockRejectedValue(new Error("new row violates row-level security policy"));
    montar();
    await importar(planilha("x.xlsx"));
    await waitFor(() =>
      expect(toastErrorMock).toHaveBeenCalledWith(
        "Sem permissão para importar (apenas administradores).",
      ),
    );
  });

  it("erro comum aparece truncado, não como paredão", async () => {
    enviarMock.mockRejectedValue(new Error("y".repeat(500)));
    montar();
    await importar(planilha("x.xlsx"));
    await waitFor(() => expect(toastErrorMock).toHaveBeenCalled());
    const msg = toastErrorMock.mock.calls[0][0] as string;
    expect(msg).toContain("Falha na importação:");
    expect(msg.length).toBeLessThan(220);
  });

  it("LIMPA o input após a seleção — reenviar o MESMO arquivo tem de funcionar", async () => {
    // Sem zerar o value, escolher o mesmo arquivo de novo nao dispara change e o
    // gestor acha que o botao quebrou.
    montar();
    const input = document.querySelector('input[type="file"]') as HTMLInputElement;
    await userEvent.upload(input, planilha("x.xlsx"));
    await waitFor(() => expect(lerMock).toHaveBeenCalled());
    expect(input.value).toBe("");
  });

  it("seleção vazia não faz nada", async () => {
    montar();
    const input = document.querySelector('input[type="file"]') as HTMLInputElement;
    await userEvent.upload(input, []);
    expect(lerMock).not.toHaveBeenCalled();
  });
});

describe("filtro de período", () => {
  it("o padrão é 90 dias", async () => {
    montar();
    await waitFor(() => expect(gteMock).toHaveBeenCalled());
    // 90 dias antes de 13/08/2026.
    const desde = gteMock.mock.calls[0][1] as string;
    expect(desde.slice(0, 10)).toBe("2026-05-15");
  });

  it("'Tudo' não aplica recorte de data", async () => {
    montar();
    await waitFor(() => expect(gteMock).toHaveBeenCalled());
    gteMock.mockClear();
    await userEvent.click(screen.getByRole("radio", { name: /Tudo/i }));
    await waitFor(() => expect(screen.getByRole("radio", { name: /Tudo/i })).toBeInTheDocument());
    // Nenhum gte novo: a consulta passa a ser sem filtro de data.
    await new Promise((r) => setTimeout(r, 50));
    expect(gteMock).not.toHaveBeenCalled();
  });

  it("data personalizada só com INÍCIO é válida", async () => {
    // Recorte aberto de um lado e caso real: "tudo a partir de tal dia".
    montar();
    await waitFor(() => expect(gteMock).toHaveBeenCalled());
    gteMock.mockClear();
    lteMock.mockClear();
    const [de] = screen.getAllByDisplayValue("");
    await userEvent.type(de, "2026-07-01");
    await waitFor(() => expect(gteMock).toHaveBeenCalled());
    expect(gteMock.mock.calls[0][1]).toContain("2026-07-01T00:00:00-03:00");
    expect(lteMock).not.toHaveBeenCalled();
  });

  it("o fim inclui o DIA INTEIRO, no fuso de Brasília", async () => {
    // Cortar em 00:00 do dia final perderia todo o ultimo dia — e o parser do
    // import usa o mesmo fuso.
    montar();
    await waitFor(() => expect(gteMock).toHaveBeenCalled());
    lteMock.mockClear();
    const campos = screen.getAllByDisplayValue("");
    await userEvent.type(campos[1], "2026-07-31");
    await waitFor(() => expect(lteMock).toHaveBeenCalled());
    expect(lteMock.mock.calls[0][1]).toBe("2026-07-31T23:59:59.999-03:00");
  });

  it("escolher um preset LIMPA as datas personalizadas", async () => {
    // Senao o recorte antigo continuaria valendo por baixo do preset novo.
    montar();
    await waitFor(() => expect(gteMock).toHaveBeenCalled());
    const campos = screen.getAllByDisplayValue("");
    await userEvent.type(campos[0], "2026-07-01");
    await waitFor(() => expect((campos[0] as HTMLInputElement).value).toBe("2026-07-01"));
    await userEvent.click(screen.getByRole("radio", { name: /30/ }));
    await waitFor(() => expect((campos[0] as HTMLInputElement).value).toBe(""));
  });
});
