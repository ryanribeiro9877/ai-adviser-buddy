import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useIsMobile } from "./use-mobile";

// O corte e 768px. Vale testar porque o hook decide entre duas arvores de UI
// diferentes (menu lateral x gaveta), e o valor inicial e `undefined` - se algum
// consumidor tratasse undefined como "desktop" sem o `!!`, o primeiro render em
// celular sairia com a arvore errada.

const listeners = new Set<() => void>();

function definirLargura(px: number) {
  Object.defineProperty(window, "innerWidth", { value: px, writable: true, configurable: true });
}

beforeEach(() => {
  listeners.clear();
  // matchMedia registrando os ouvintes de verdade, para dar para disparar o
  // change e observar a reacao.
  window.matchMedia = ((query: string) =>
    ({
      media: query,
      get matches() {
        return window.innerWidth < 768;
      },
      addEventListener: (_e: string, cb: () => void) => listeners.add(cb),
      removeEventListener: (_e: string, cb: () => void) => listeners.delete(cb),
      addListener: () => {},
      removeListener: () => {},
      dispatchEvent: () => false,
      onchange: null,
    }) as unknown as MediaQueryList) as typeof window.matchMedia;
  definirLargura(1280);
});

afterEach(() => {
  vi.restoreAllMocks();
});

/** Simula o redimensionamento da janela. */
function redimensionar(px: number) {
  act(() => {
    definirLargura(px);
    listeners.forEach((cb) => cb());
  });
}

describe("useIsMobile", () => {
  it("largura de desktop: false", () => {
    definirLargura(1280);
    const { result } = renderHook(() => useIsMobile());
    expect(result.current).toBe(false);
  });

  it("largura de celular: true", () => {
    definirLargura(390);
    const { result } = renderHook(() => useIsMobile());
    expect(result.current).toBe(true);
  });

  it("767px ainda e mobile; 768px ja e desktop", () => {
    // O limite exato: `< 768`, nao `<=`. Um off-by-one aqui trocaria a arvore
    // de UI exatamente na largura de tablet em retrato.
    definirLargura(767);
    expect(renderHook(() => useIsMobile()).result.current).toBe(true);
    definirLargura(768);
    expect(renderHook(() => useIsMobile()).result.current).toBe(false);
  });

  it("reage ao redimensionamento", () => {
    definirLargura(1280);
    const { result } = renderHook(() => useIsMobile());
    expect(result.current).toBe(false);
    redimensionar(390);
    expect(result.current).toBe(true);
    redimensionar(1024);
    expect(result.current).toBe(false);
  });

  it("SEMPRE devolve booleano, nunca undefined", () => {
    // O estado interno comeca undefined; o `!!` no retorno e o que garante que
    // nenhum consumidor recebe undefined e o trate como desktop por acidente.
    const { result } = renderHook(() => useIsMobile());
    expect(typeof result.current).toBe("boolean");
  });

  it("REMOVE o ouvinte ao desmontar (senao vaza a cada navegacao)", () => {
    const { unmount } = renderHook(() => useIsMobile());
    expect(listeners.size).toBe(1);
    unmount();
    expect(listeners.size).toBe(0);
  });

  it("consulta o media query com o breakpoint - 1", () => {
    const spy = vi.spyOn(window, "matchMedia");
    renderHook(() => useIsMobile());
    expect(spy).toHaveBeenCalledWith("(max-width: 767px)");
  });
});
