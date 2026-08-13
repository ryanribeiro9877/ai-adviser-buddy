import "@testing-library/jest-dom/vitest";
import { afterEach, vi } from "vitest";
import { cleanup } from "@testing-library/react";

// Desmonta a árvore React entre testes: sem isto, um teste enxerga o DOM do
// anterior e passa (ou falha) pelo motivo errado.
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

// jsdom não implementa matchMedia, e use-mobile.tsx chama no primeiro render.
if (!window.matchMedia) {
  window.matchMedia = ((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => false,
  })) as unknown as typeof window.matchMedia;
}
