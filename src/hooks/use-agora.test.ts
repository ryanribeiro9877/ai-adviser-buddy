import { describe, it, expect, vi, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useAgora } from "./use-agora";

// Relogio local que faz "há 2h" e "expira em 3h" envelhecerem sozinhos. Nao le
// nada do banco - se algum dia virar polling de dados, este arquivo e o lugar
// de perceber.

afterEach(() => {
  vi.useRealTimers();
});

describe("useAgora", () => {
  it("comeca no instante atual", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-13T12:00:00Z"));
    const { result } = renderHook(() => useAgora());
    expect(result.current).toBe(Date.parse("2026-08-13T12:00:00Z"));
  });

  it("avanca a cada intervalo", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-13T12:00:00Z"));
    const { result } = renderHook(() => useAgora(true, 30_000));
    act(() => {
      vi.advanceTimersByTime(30_000);
    });
    expect(result.current).toBe(Date.parse("2026-08-13T12:00:30Z"));
    act(() => {
      vi.advanceTimersByTime(30_000);
    });
    expect(result.current).toBe(Date.parse("2026-08-13T12:01:00Z"));
  });

  it("respeita o intervalo informado", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-13T12:00:00Z"));
    const { result } = renderHook(() => useAgora(true, 1_000));
    act(() => {
      vi.advanceTimersByTime(1_000);
    });
    expect(result.current).toBe(Date.parse("2026-08-13T12:00:01Z"));
  });

  it("com ativo=false NAO avanca (a tela em segundo plano nao gasta render)", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-13T12:00:00Z"));
    const { result } = renderHook(() => useAgora(false));
    const inicial = result.current;
    act(() => {
      vi.advanceTimersByTime(120_000);
    });
    expect(result.current).toBe(inicial);
  });

  it("LIMPA o intervalo ao desmontar (senao vaza timer a cada navegacao)", () => {
    vi.useFakeTimers();
    const clear = vi.spyOn(globalThis, "clearInterval");
    const { unmount } = renderHook(() => useAgora());
    unmount();
    expect(clear).toHaveBeenCalled();
    clear.mockRestore();
  });

  it("ao reativar, sincroniza na hora em vez de esperar o proximo tique", () => {
    // Sem o setAgora() imediato no efeito, a tela voltaria mostrando o horario
    // de quando foi desativada, ate 30s desatualizado.
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-13T12:00:00Z"));
    const { result, rerender } = renderHook(({ ativo }) => useAgora(ativo), {
      initialProps: { ativo: false },
    });
    act(() => {
      vi.setSystemTime(new Date("2026-08-13T12:05:00Z"));
    });
    expect(result.current).toBe(Date.parse("2026-08-13T12:00:00Z"));
    rerender({ ativo: true });
    expect(result.current).toBe(Date.parse("2026-08-13T12:05:00Z"));
  });
});
