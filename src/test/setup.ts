import "@testing-library/jest-dom/vitest";
import { afterEach, vi } from "vitest";
import { cleanup } from "@testing-library/react";

// Timezone FIXO. Sem isto a suite passa na maquina do dev (UTC-3) e falha no CI
// (UTC): pegamos exatamente isso na primeira execucao do workflow, num teste que
// dependia de `new Date(s).toISOString()` com string nao-ISO, interpretada em
// hora local. America/Sao_Paulo nao e escolha arbitraria - e a premissa que o
// proprio codigo declara (infobip-import: "a operacao e brasileira"), entao o
// teste roda no fuso em que o sistema opera.
// Atribuir process.env.TZ invalida o cache de fuso do Node (>=16), e isto roda
// antes de qualquer teste.
process.env.TZ = "America/Sao_Paulo";

// Desmonta a árvore React entre testes: sem isto, um teste enxerga o DOM do
// anterior e passa (ou falha) pelo motivo errado.
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

// O jsdom não implementa ResizeObserver, e o Recharts o usa no
// ResponsiveContainer — sem o stub, QUALQUER tela com gráfico estoura com
// "ResizeObserver is not defined", que não tem nada a ver com o defeito sob teste.
// Fica aqui, e não em cada arquivo, porque é lacuna do ambiente e não de um teste.
if (!globalThis.ResizeObserver) {
  globalThis.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver;
}

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
