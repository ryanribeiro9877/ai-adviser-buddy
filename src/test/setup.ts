import "@testing-library/jest-dom/vitest";
import { afterEach, vi } from "vitest";
import { cleanup, configure } from "@testing-library/react";

// O default de `findBy*`/`waitFor` e 1000 ms, e esse numero embute a premissa de
// maquina ociosa. MEDIDO em 04/09 nesta maquina de 8 GB, com outro trabalho em
// paralelo: 558 MB de RAM livre ANTES de subir a suite, e 18,9 GB de commit
// charge — ou seja, paginacao. Nessas condicoes um processo fica sem CPU por
// mais de 1 s com facilidade, e tres testes de operacao-chat que passam
// isolados reprovaram na suite cheia esperando uma consulta que resolve em ~10 ms.
//
// Subir esta janela NAO esconde defeito, e e por isso que a correcao e aqui e nao
// em cada teste: `waitFor` retorna no instante em que a asserção passa, entao o
// teto so governa quanto tempo se espera antes de declarar FALHA. Ampliar nao
// deixa nada verde que devesse ficar vermelho; so evita vermelho por inanicao.
// Mesma doutrina do testTimeout de 20 s em vitest.config.ts, e o CI (runner de
// 2 nucleos) e ainda mais apertado que esta maquina.
configure({ asyncUtilTimeout: 5_000 });

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

// jsdom não implementa scrollTo em Element (só o de window, e mesmo esse é um
// no-op que avisa). O chat rola o fio para o fim a cada mensagem nova, num
// useEffect — sem o stub, montar OperacaoChat estoura em `scrollTo is not a
// function` no primeiro render, que não tem nada a ver com o defeito sob teste.
// Mesmo critério do ResizeObserver acima: é lacuna do ambiente, não de um teste.
if (!Element.prototype.scrollTo) {
  Element.prototype.scrollTo = function scrollTo() {};
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
