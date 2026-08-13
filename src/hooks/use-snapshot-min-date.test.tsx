import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { MIN_DATE_FALLBACK } from "@/lib/filters";

// Arquivo separado de use-filters.test.tsx de proposito: aquele mocka o
// @tanstack/react-query inteiro para inspecionar a chamada de navigate, o que
// impede a queryFn de rodar. Aqui a react-query e a de verdade, para o corpo da
// consulta ser exercitado.
//
// Esta data e a base do preset "Todo o periodo": se vier errada, TODA tela
// acumulada passa a somar a partir do dia errado.

let resposta: { data: unknown } = { data: [] };
const limitMock = vi.fn();

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    from: () => ({
      select: () => ({
        order: (col: string, opts: unknown) => ({
          limit: (n: number) => {
            limitMock(col, opts, n);
            return Promise.resolve(resposta);
          },
        }),
      }),
    }),
  },
}));

import { useSnapshotMinDate } from "./use-filters";

function montar() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const Wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={qc}>{children}</QueryClientProvider>
  );
  return renderHook(() => useSnapshotMinDate(), { wrapper: Wrapper });
}

beforeEach(() => {
  resposta = { data: [] };
  limitMock.mockReset();
});

describe("useSnapshotMinDate", () => {
  it("devolve o menor snapshot_date do banco", async () => {
    resposta = { data: [{ snapshot_date: "2026-03-03" }] };
    const { result } = montar();
    await waitFor(() => expect(result.current.data).toBe("2026-03-03"));
  });

  it("pede so UMA linha, ordenada crescente (nao varre a tabela)", async () => {
    // metric_snapshots cresce todo dia; buscar tudo para pegar o minimo seria
    // pagar uma varredura inteira a cada carga de tela.
    montar();
    await waitFor(() => expect(limitMock).toHaveBeenCalled());
    expect(limitMock).toHaveBeenCalledWith("snapshot_date", { ascending: true }, 1);
  });

  it("banco vazio cai no fallback declarado", async () => {
    // Conta recem-criada nao tem snapshot; sem o fallback o range ficaria
    // undefined e a consulta seguinte falharia.
    resposta = { data: [] };
    const { result } = montar();
    await waitFor(() => expect(result.current.data).toBe(MIN_DATE_FALLBACK));
  });

  it("data null tambem cai no fallback", async () => {
    resposta = { data: null };
    const { result } = montar();
    await waitFor(() => expect(result.current.data).toBe(MIN_DATE_FALLBACK));
  });

  it("linha sem a coluna cai no fallback em vez de devolver undefined", async () => {
    resposta = { data: [{}] };
    const { result } = montar();
    await waitFor(() => expect(result.current.data).toBe(MIN_DATE_FALLBACK));
  });

  it("nao reconsulta durante a sessao (staleTime infinito)", async () => {
    // O primeiro dia de dados nao muda enquanto a aba esta aberta; reconsultar a
    // cada montagem de tela seria desperdicio puro.
    resposta = { data: [{ snapshot_date: "2026-03-03" }] };
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const Wrapper = ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={qc}>{children}</QueryClientProvider>
    );
    const a = renderHook(() => useSnapshotMinDate(), { wrapper: Wrapper });
    await waitFor(() => expect(a.result.current.data).toBe("2026-03-03"));
    const chamadas = limitMock.mock.calls.length;

    const b = renderHook(() => useSnapshotMinDate(), { wrapper: Wrapper });
    await waitFor(() => expect(b.result.current.data).toBe("2026-03-03"));
    expect(limitMock.mock.calls.length).toBe(chamadas);
  });
});
