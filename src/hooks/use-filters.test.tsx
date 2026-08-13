import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook } from "@testing-library/react";
import type { FilterSearch } from "@/lib/filters";

// Os filtros globais vivem na URL. Este hook e a ponte, e o que importa provar e
// que ele escreve na URL do jeito que a rota espera: com `to: "."` (fica na
// rota atual), `replace: true` (nao empilha uma entrada de historico por clique
// de filtro) e passando uma FUNCAO de merge, nao um objeto - senao um filtro
// apagaria os outros.

const navigateMock = vi.fn();
let searchAtual: FilterSearch = {};

vi.mock("@tanstack/react-router", () => ({
  useNavigate: () => navigateMock,
  useSearch: () => searchAtual,
}));

vi.mock("@tanstack/react-query", () => ({
  useQuery: (opts: Record<string, unknown>) => ({ data: undefined, opts }),
}));

vi.mock("@/integrations/supabase/client", () => ({ supabase: {} }));

import { useGlobalFilters } from "./use-filters";

beforeEach(() => {
  navigateMock.mockReset();
  searchAtual = {};
});

/** Executa a funcao de search que o hook passou para o navigate. */
function searchResultante(prev: Record<string, unknown>) {
  const arg = navigateMock.mock.calls[0][0] as {
    search: (p: Record<string, unknown>) => unknown;
  };
  return arg.search(prev);
}

describe("useGlobalFilters — leitura", () => {
  it("aplica os defaults sobre o que veio da URL", () => {
    const { result } = renderHook(() => useGlobalFilters());
    expect(result.current.filters).toMatchObject({
      preset: "all",
      status: "all",
      tipo: "all",
      platform: "meta",
    });
  });

  it("reflete o que a URL traz", () => {
    searchAtual = { preset: "7d", status: "active" };
    const { result } = renderHook(() => useGlobalFilters());
    expect(result.current.filters.preset).toBe("7d");
    expect(result.current.filters.status).toBe("active");
  });
});

describe("useGlobalFilters — setFilters", () => {
  it("navega na rota ATUAL e sem empilhar historico", () => {
    const { result } = renderHook(() => useGlobalFilters());
    result.current.setFilters({ preset: "30d" });
    expect(navigateMock.mock.calls[0][0]).toMatchObject({ to: ".", replace: true });
  });

  it("faz MERGE com o que ja estava na URL, em vez de substituir", () => {
    // O erro classico aqui seria mandar um objeto: trocar o periodo apagaria o
    // status e o tipo que o usuario ja tinha escolhido.
    const { result } = renderHook(() => useGlobalFilters());
    result.current.setFilters({ preset: "30d" });
    expect(searchResultante({ status: "active", tipo: "leadgen" })).toEqual({
      preset: "30d",
      status: "active",
      tipo: "leadgen",
    });
  });

  it("o patch vence o valor anterior do mesmo campo", () => {
    const { result } = renderHook(() => useGlobalFilters());
    result.current.setFilters({ status: "paused" });
    expect(searchResultante({ status: "active" })).toMatchObject({ status: "paused" });
  });

  it("passa pelo cleanFilterSearch: default nao vai para a URL", () => {
    const { result } = renderHook(() => useGlobalFilters());
    result.current.setFilters({ preset: "all" });
    expect(searchResultante({ status: "active" })).toEqual({ status: "active" });
  });
});

describe("useGlobalFilters — clearFilters", () => {
  it("PRESERVA a empresa e zera o resto", () => {
    // A empresa e escolha do header, nao filtro de tela: limpar filtros nao pode
    // desselecionar o cliente que o gestor esta olhando.
    const { result } = renderHook(() => useGlobalFilters());
    result.current.clearFilters();
    const uuid = "8f1e2c3d-4a5b-6c7d-8e9f-0a1b2c3d4e5f";
    expect(
      searchResultante({ company: uuid, preset: "7d", status: "active", tipo: "leadgen" }),
    ).toEqual({ company: uuid });
  });

  it("sem empresa na URL, limpa tudo", () => {
    const { result } = renderHook(() => useGlobalFilters());
    result.current.clearFilters();
    expect(searchResultante({ preset: "7d", status: "active" })).toEqual({});
  });

  it("tambem usa rota atual e replace", () => {
    const { result } = renderHook(() => useGlobalFilters());
    result.current.clearFilters();
    expect(navigateMock.mock.calls[0][0]).toMatchObject({ to: ".", replace: true });
  });
});
