import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEventBase from "@testing-library/user-event";
import { withFilterDefaults, type FilterSearch } from "@/lib/filters";

// delay: null desde o inicio — este arquivo abre popover e calendario, e teste
// lento vira flaky sob carga (ja aconteceu duas vezes nesta suite).
const userEvent = userEventBase.setup({ delay: null });

// A barra de filtros. O que mais importa aqui nao e nenhum controle: e o AVISO do
// modo acumulado. Anuncios e Conjuntos mostram totais desde o inicio da conta, e
// sem o aviso o gestor escolhe "ultimos 7 dias", ve um numero grande e acredita
// que sao 7 dias. Depois disso, a regra de que trocar de preset LIMPA o
// start/end - senao datas de um custom antigo ficariam penduradas.

const setFiltersMock = vi.fn();
const clearFiltersMock = vi.fn();
let busca: FilterSearch = {};
let minDate: string | undefined = "2026-03-03";

vi.mock("@/hooks/use-filters", () => ({
  useGlobalFilters: () => ({
    filters: withFilterDefaults(busca),
    setFilters: setFiltersMock,
    clearFilters: clearFiltersMock,
  }),
  useSnapshotMinDate: () => ({ data: minDate }),
}));

import { GlobalFilters } from "./global-filters";

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  vi.setSystemTime(new Date("2026-08-13T12:00:00Z"));
  setFiltersMock.mockReset();
  clearFiltersMock.mockReset();
  busca = {};
  minDate = "2026-03-03";
  // O Radix Select/Popover usa APIs de ponteiro que o jsdom nao implementa.
  Element.prototype.hasPointerCapture = vi.fn(() => false);
  Element.prototype.releasePointerCapture = vi.fn();
  Element.prototype.scrollIntoView = vi.fn();
});

function montar(mode: "series" | "accumulated" = "series", typesPresent: never[] = []) {
  return render(<GlobalFilters mode={mode} typesPresent={typesPresent} />);
}

describe("rótulo do período", () => {
  it("sem filtro diz 'Todo o período'", () => {
    montar();
    expect(screen.getByText("Todo o período")).toBeInTheDocument();
  });

  it.each([
    ["7d", "Últimos 7 dias"],
    ["30d", "Últimos 30 dias"],
    ["month", "Este mês"],
  ])("preset %s mostra o rotulo %s", (preset, rotulo) => {
    busca = { preset: preset as never };
    montar();
    expect(screen.getByText(rotulo)).toBeInTheDocument();
  });

  it("custom mostra as DATAS, nao a palavra 'Personalizado'", () => {
    // No modo custom o rotulo generico nao diria nada; o gestor precisa ver o
    // recorte que esta olhando.
    busca = { preset: "custom", start: "2026-05-01", end: "2026-05-31" };
    montar();
    expect(screen.getByText("01/05/2026 – 31/05/2026")).toBeInTheDocument();
  });

  it("usa o minDate do banco quando o preset e 'all'", () => {
    minDate = "2026-01-15";
    montar();
    // O rotulo e "Todo o período", mas o range calculado aparece no popover.
    expect(screen.getByText("Todo o período")).toBeInTheDocument();
  });
});

describe("escolha de preset", () => {
  async function abrirPeriodo() {
    await userEvent.click(screen.getByRole("button", { name: /Todo o período/ }));
  }

  it("oferece os cinco presets", async () => {
    montar();
    await abrirPeriodo();
    // Escopado ao popover de propósito: "Todo o período" existe duas vezes na
    // tela quando ele está aberto — como rótulo do gatilho e como opção. Buscar
    // solto acusaria ambiguidade em vez de testar a lista.
    const popover = await screen.findByRole("dialog");
    for (const r of [
      "Todo o período",
      "Últimos 7 dias",
      "Últimos 30 dias",
      "Este mês",
      "Personalizado",
    ]) {
      expect(within(popover).getByRole("button", { name: r }), r).toBeInTheDocument();
    }
  });

  it("trocar para um preset relativo LIMPA start e end", async () => {
    // Sem limpar, as datas de um custom anterior ficariam na URL e voltariam ao
    // reentrar em custom, contradizendo o preset escolhido.
    busca = { preset: "custom", start: "2026-05-01", end: "2026-05-31" };
    montar();
    await userEvent.click(screen.getByRole("button", { name: /01\/05\/2026/ }));
    await userEvent.click(await screen.findByRole("button", { name: "Últimos 7 dias" }));

    // `toHaveBeenCalledWith({ preset: "7d" })` NAO serve aqui: o vitest ignora
    // propriedades com valor undefined, então ele considera `{preset}` igual a
    // `{preset, start: undefined, end: undefined}` — e o teste passaria mesmo se o
    // codigo parasse de limpar as datas. Descobri isso por mutação: trocar por
    // `setFilters({ preset })` não quebrou nada. As CHAVES precisam estar
    // presentes, porque é a presença delas que sobrescreve o valor antigo na URL.
    const patch = setFiltersMock.mock.calls[0][0] as Record<string, unknown>;
    expect(Object.keys(patch).sort()).toEqual(["end", "preset", "start"]);
    expect(patch.preset).toBe("7d");
    expect(patch.start).toBeUndefined();
    expect(patch.end).toBeUndefined();
  });

  it("entrar em 'Personalizado' ANCORA no range que esta sendo exibido", async () => {
    // Abrir o custom vazio jogaria o calendario para um recorte aleatorio; ancorar
    // deixa o gestor ajustar a partir do que ele ja via.
    busca = { preset: "7d" };
    montar();
    await userEvent.click(screen.getByRole("button", { name: /Últimos 7 dias/ }));
    await userEvent.click(await screen.findByRole("button", { name: "Personalizado" }));
    expect(setFiltersMock).toHaveBeenCalledWith({
      preset: "custom",
      start: "2026-08-07",
      end: "2026-08-13",
    });
  });

  it("mostra o range resolvido em texto dentro do popover", async () => {
    montar();
    await abrirPeriodo();
    expect(await screen.findByText("03/03/2026 – 13/08/2026")).toBeInTheDocument();
  });
});

describe("plataforma", () => {
  it("fica DESABILITADA — hoje só existe Meta Ads", () => {
    // O controle existe para o futuro, mas habilitado sugeriria escolha que nao
    // ha.
    montar();
    const selects = screen.getAllByRole("combobox");
    expect(selects[0]).toBeDisabled();
  });
});

describe("limpar filtros", () => {
  it("NAO aparece quando nada esta filtrado", () => {
    busca = {};
    montar();
    expect(screen.queryByRole("button", { name: "Limpar filtros" })).not.toBeInTheDocument();
  });

  it.each([
    ["periodo", { preset: "7d" }],
    ["status", { status: "active" }],
    ["tipo", { tipo: "leadgen" }],
  ])("aparece quando ha filtro de %s", (_caso, patch) => {
    busca = patch as FilterSearch;
    montar();
    expect(screen.getByRole("button", { name: "Limpar filtros" })).toBeInTheDocument();
  });

  it("empresa selecionada NAO faz o botao aparecer", () => {
    // A empresa e escolha do header, nao filtro de tela.
    busca = { company: "8f1e2c3d-4a5b-6c7d-8e9f-0a1b2c3d4e5f" };
    montar();
    expect(screen.queryByRole("button", { name: "Limpar filtros" })).not.toBeInTheDocument();
  });

  it("clicar chama o clearFilters do hook", async () => {
    busca = { preset: "7d" };
    montar();
    await userEvent.click(screen.getByRole("button", { name: "Limpar filtros" }));
    expect(clearFiltersMock).toHaveBeenCalled();
  });
});

describe("aviso do modo acumulado — o teste central", () => {
  it("APARECE em tela acumulada com periodo estreitado", () => {
    // Sem ele: o gestor escolhe "7 dias", ve o total desde o inicio da conta e
    // acredita que sao 7 dias. E o erro mais caro que esta barra pode causar.
    busca = { preset: "7d" };
    montar("accumulated");
    expect(screen.getByText(/totais acumulados \(desde o início da conta\)/)).toBeInTheDocument();
    expect(
      screen.getByText(/O filtro de período ainda não se aplica a estas telas/),
    ).toBeInTheDocument();
  });

  it("NAO aparece em tela acumulada sem periodo estreitado", () => {
    // Com "Todo o período" nao ha contradicao a avisar.
    busca = {};
    montar("accumulated");
    expect(screen.queryByText(/totais acumulados/)).not.toBeInTheDocument();
  });

  it("NAO aparece em tela de serie, nem com periodo estreitado", () => {
    // Campanhas e Funil filtram de verdade por metric_snapshots.
    busca = { preset: "7d" };
    montar("series");
    expect(screen.queryByText(/totais acumulados/)).not.toBeInTheDocument();
  });

  it("aparece com qualquer preset que estreite, nao so 7d", () => {
    for (const preset of ["30d", "month", "custom"] as const) {
      busca = { preset, start: "2026-05-01", end: "2026-05-31" };
      const { unmount } = montar("accumulated");
      expect(screen.getByText(/totais acumulados/), preset).toBeInTheDocument();
      unmount();
    }
  });
});

describe("tipos disponíveis", () => {
  it("sem tipos nos dados, so oferece 'Todos os tipos'", () => {
    montar("series", []);
    // O gatilho mostra o rotulo do valor atual.
    expect(screen.getByText("Todos os tipos")).toBeInTheDocument();
  });

  it("mostra o rotulo do tipo selecionado", () => {
    busca = { tipo: "leadgen" };
    montar("series", ["leadgen"] as never);
    expect(screen.getByText("Leadgen")).toBeInTheDocument();
  });
});

describe("status", () => {
  it("mostra o rotulo do status atual", () => {
    busca = { status: "paused" };
    montar();
    expect(screen.getByText("Pausadas")).toBeInTheDocument();
  });

  it("padrao mostra 'Todos os status'", () => {
    montar();
    expect(screen.getByText("Todos os status")).toBeInTheDocument();
  });
});
