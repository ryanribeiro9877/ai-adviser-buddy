import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEventBase from "@testing-library/user-event";

// `delay: null` remove a espera entre teclas do userEvent. Sem isso este arquivo
// leva ~13s isolado e, na suíte cheia (em paralelo com os outros 30 arquivos), um
// teste trivial estourava o timeout de 5s — flaky que só aparece sob carga. O
// padrão de 5s é o que pega travamento de verdade nos demais; a lentidão era aqui.
const userEvent = userEventBase.setup({ delay: null });
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { TooltipProvider } from "@/components/ui/tooltip";
import type { ReactNode } from "react";

// A tabela de metas e tetos. E o unico lugar da UI que EDITA um numero que
// recalibra os alertas de todos. Tres propriedades organizam os testes:
//   1. o parser aceita pt-BR e recusa lixo ANTES de tocar no banco;
//   2. antes de gravar, o codigo RELE a linha - o "anterior" registrado e o do
//      banco, nao o que estava na tela (que pode estar velho);
//   3. cada edicao ENTRA na memoria da linha (edicao_1, edicao_2, ...), que e um
//      historico dentro do proprio registro.

let isAdmin = true;
let linhas: Record<string, unknown>[] = [];
let leituraFresh: { data: unknown; error: unknown } = { data: null, error: null };
let erroDoUpdate: unknown = null;
const updateMock = vi.fn();
const logAuditMock = vi.fn();
const toastErrorMock = vi.fn();
const toastSuccessMock = vi.fn();

vi.mock("@/lib/app-context", () => ({
  useApp: () => ({ isAdmin }),
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
    from: () => ({
      select: (cols: string) => {
        // A releitura pede so "valor, memoria"; a listagem pede o resto.
        if (cols.includes("memoria") && !cols.includes("metric")) {
          return { eq: () => ({ single: () => Promise.resolve(leituraFresh) }) };
        }
        return {
          eq: () => ({
            is: () => ({
              eq: () => ({ order: () => Promise.resolve({ data: linhas, error: null }) }),
            }),
          }),
        };
      },
      update: (patch: unknown) => ({
        eq: (c: string, v: unknown) => {
          updateMock(patch, c, v);
          return Promise.resolve({ error: erroDoUpdate });
        },
      }),
    }),
  },
}));

import { TargetsTable } from "./targets-table";

function meta(over: Record<string, unknown> = {}) {
  return {
    id: "t1",
    metric: "custo_por_lead_dashboard",
    valor: 20,
    fonte: "derivado_meta_p75_diario",
    memoria: {},
    updated_at: "2026-08-13T10:00:00Z",
    ...over,
  };
}

// O TooltipProvider e obrigatorio: a coluna de metrica usa Tooltip do Radix para
// explicar como cada teto e calculado, e o Radix estoura ("`Tooltip` must be used
// within `TooltipProvider`") sem o provedor acima. Na aplicacao ele vem do root -
// esta e uma dependencia IMPLICITA do componente, e o teste a torna explicita.
function montar() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const Wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={qc}>
      <TooltipProvider>{children}</TooltipProvider>
    </QueryClientProvider>
  );
  return render(<TargetsTable companyId="c1" />, { wrapper: Wrapper });
}

/**
 * Entra em modo de edição da primeira linha e escreve o valor.
 * `valor` vazio significa "campo limpo": o userEvent.type recusa string vazia
 * ("Expected key descriptor"), então o clear sozinho já é o cenário.
 */
async function editar(valor: string) {
  await userEvent.click(await screen.findByRole("button", { name: "Editar" }));
  const input = screen.getByRole("textbox");
  await userEvent.clear(input);
  if (valor !== "") await userEvent.type(input, valor);
  await userEvent.click(screen.getByRole("button", { name: "Salvar" }));
}

beforeEach(() => {
  isAdmin = true;
  linhas = [meta()];
  leituraFresh = { data: { valor: 20, memoria: {} }, error: null };
  erroDoUpdate = null;
  updateMock.mockReset();
  logAuditMock.mockReset().mockResolvedValue(undefined);
  toastErrorMock.mockReset();
  toastSuccessMock.mockReset();
});

describe("listagem", () => {
  it("traduz a metrica para linguagem de gestor", async () => {
    montar();
    expect(await screen.findByText("Custo por Lead (dashboard)")).toBeInTheDocument();
  });

  it("mostra a origem do valor", async () => {
    // Distincao que importa: valor derivado dos dados nao e a mesma coisa que
    // valor que alguem digitou.
    montar();
    expect(await screen.findByText("Derivado dos dados (p75)")).toBeInTheDocument();
  });

  it("valor editado manualmente aparece como tal", async () => {
    linhas = [meta({ fonte: "manual" })];
    montar();
    expect(await screen.findByText("Editado manualmente")).toBeInTheDocument();
  });

  it("metrica desconhecida nao derruba a tabela", async () => {
    linhas = [meta({ metric: "metrica_nova_do_backend" })];
    montar();
    expect(await screen.findByText(/metrica_nova_do_backend/)).toBeInTheDocument();
  });
});

describe("gate de admin", () => {
  it("admin ve o botao de editar", async () => {
    montar();
    expect(await screen.findByRole("button", { name: "Editar" })).toBeInTheDocument();
  });

  it("nao-admin NAO ve editar nem a coluna de acoes", async () => {
    isAdmin = false;
    montar();
    await screen.findByText("Custo por Lead (dashboard)");
    expect(screen.queryByRole("button", { name: "Editar" })).not.toBeInTheDocument();
    expect(screen.queryByText("Ações")).not.toBeInTheDocument();
  });
});

describe("parser de valor — aceita pt-BR, recusa lixo", () => {
  it.each([
    ["25,50", 25.5],
    ["25.50", 25.5],
    ["R$ 25,50", 25.5],
    ["1.234,56", 1234.56],
    ["  30  ", 30],
  ])("aceita %j como %s", async (entrada, esperado) => {
    montar();
    await editar(entrada);
    await waitFor(() => expect(updateMock).toHaveBeenCalled());
    expect(updateMock.mock.calls[0][0]).toMatchObject({ valor: esperado });
  });

  it.each([["0"], ["-5"], [""], ["abc"], ["R$"]])(
    "RECUSA %j sem tocar no banco",
    async (entrada) => {
      // Meta zero ou negativa desligaria o alerta em silencio; recusar antes de
      // gravar e o unico lugar onde isso e barato de corrigir.
      montar();
      await editar(entrada);
      expect(toastErrorMock).toHaveBeenCalledWith("Informe um valor em reais maior que zero.");
      expect(updateMock).not.toHaveBeenCalled();
    },
  );

  it("arredonda para 2 casas (centavo e a menor unidade real)", async () => {
    montar();
    await editar("25,555");
    await waitFor(() => expect(updateMock).toHaveBeenCalled());
    expect(updateMock.mock.calls[0][0]).toMatchObject({ valor: 25.56 });
  });

  it("o campo abre com o valor atual em formato pt-BR", async () => {
    linhas = [meta({ valor: 20 })];
    montar();
    await userEvent.click(await screen.findByRole("button", { name: "Editar" }));
    expect(screen.getByRole("textbox")).toHaveValue("20,00");
  });
});

describe("gravação", () => {
  it("RELE a linha antes de gravar, e usa o valor do BANCO como anterior", async () => {
    // O valor na tela pode estar velho (outro admin editou). O "anterior" que vai
    // para a auditoria tem de ser o do banco, nao o do render.
    leituraFresh = { data: { valor: 18, memoria: {} }, error: null };
    montar();
    await editar("25");
    await waitFor(() => expect(logAuditMock).toHaveBeenCalled());
    expect(logAuditMock.mock.calls[0][0]).toMatchObject({
      action: "target.update",
      details: { anterior: 18, novo: 25 },
    });
  });

  it("marca a fonte como manual", async () => {
    montar();
    await editar("25");
    await waitFor(() => expect(updateMock).toHaveBeenCalled());
    expect(updateMock.mock.calls[0][0]).toMatchObject({ fonte: "manual" });
  });

  it("ACUMULA a edicao na memoria da linha (edicao_1)", async () => {
    leituraFresh = { data: { valor: 20, memoria: {} }, error: null };
    montar();
    await editar("25");
    await waitFor(() => expect(updateMock).toHaveBeenCalled());
    const patch = updateMock.mock.calls[0][0] as { memoria: Record<string, unknown> };
    expect(patch.memoria.edicao_1).toMatchObject({ anterior: 20, novo: 25, via: "ui" });
  });

  it("PRESERVA as edicoes anteriores e incrementa o numero", async () => {
    // A memoria e historico dentro do proprio registro: sobrescrever apagaria a
    // trilha de quem mexeu antes.
    leituraFresh = {
      data: {
        valor: 22,
        memoria: { edicao_1: { anterior: 20, novo: 22 }, observacao: "nota livre" },
      },
      error: null,
    };
    montar();
    await editar("25");
    await waitFor(() => expect(updateMock).toHaveBeenCalled());
    const patch = updateMock.mock.calls[0][0] as { memoria: Record<string, unknown> };
    expect(patch.memoria.edicao_1).toMatchObject({ anterior: 20, novo: 22 });
    expect(patch.memoria.edicao_2).toMatchObject({ anterior: 22, novo: 25 });
    // chave que nao e edicao_N sobrevive
    expect(patch.memoria.observacao).toBe("nota livre");
  });

  it("memoria que nao e objeto e tratada como vazia, sem estourar", async () => {
    leituraFresh = { data: { valor: 20, memoria: ["lista", "inesperada"] }, error: null };
    montar();
    await editar("25");
    await waitFor(() => expect(updateMock).toHaveBeenCalled());
    const patch = updateMock.mock.calls[0][0] as { memoria: Record<string, unknown> };
    expect(patch.memoria.edicao_1).toBeTruthy();
  });

  it("confirma que os alertas recalibram na PROXIMA avaliacao", async () => {
    // Expectativa: a meta nova nao dispara alerta agora.
    montar();
    await editar("25");
    await waitFor(() =>
      expect(toastSuccessMock).toHaveBeenCalledWith(
        "Meta atualizada — alertas recalibram na próxima avaliação (06:15)",
      ),
    );
  });

  it("falha na RELEITURA aborta sem gravar", async () => {
    leituraFresh = { data: null, error: { message: "timeout" } };
    montar();
    await editar("25");
    await waitFor(() =>
      expect(toastErrorMock).toHaveBeenCalledWith(
        "Não foi possível ler a meta atual. Tente novamente.",
      ),
    );
    expect(updateMock).not.toHaveBeenCalled();
  });

  it("erro no UPDATE explica que e permissao, e NAO audita", async () => {
    // A RLS e quem barra o nao-admin de verdade; a mensagem traduz isso. Auditar
    // uma edicao que nao aconteceu seria registrar mentira.
    erroDoUpdate = { message: "new row violates row-level security policy" };
    montar();
    await editar("25");
    await waitFor(() =>
      expect(toastErrorMock).toHaveBeenCalledWith(
        "Sem permissão para editar metas (apenas administradores).",
      ),
    );
    expect(logAuditMock).not.toHaveBeenCalled();
    expect(toastSuccessMock).not.toHaveBeenCalled();
  });

  it("cancelar sai da edicao sem gravar nada", async () => {
    montar();
    await userEvent.click(await screen.findByRole("button", { name: "Editar" }));
    await userEvent.type(screen.getByRole("textbox"), "99");
    await userEvent.click(screen.getByRole("button", { name: "Cancelar" }));
    expect(updateMock).not.toHaveBeenCalled();
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
  });

  it("reabrir apos cancelar traz o valor do banco, nao o rascunho", async () => {
    montar();
    await userEvent.click(await screen.findByRole("button", { name: "Editar" }));
    await userEvent.clear(screen.getByRole("textbox"));
    await userEvent.type(screen.getByRole("textbox"), "99");
    await userEvent.click(screen.getByRole("button", { name: "Cancelar" }));
    await userEvent.click(screen.getByRole("button", { name: "Editar" }));
    expect(screen.getByRole("textbox")).toHaveValue("20,00");
  });
});
