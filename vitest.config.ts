import { availableParallelism } from "node:os";
import { defineConfig } from "vitest/config";

// Quantos arquivos de teste rodam ao mesmo tempo.
//
// O default do vitest é `availableParallelism() - 1`, ou seja, dimensiona o pool
// SÓ pela contagem de CPU. Cada worker aqui carrega um jsdom inteiro + React +
// Radix, e isso custa memória, não CPU — numa máquina com muitos núcleos e pouca
// RAM o default abre workers demais e a suíte entra em thrashing de paginação.
//
// MEDIDO em 03/09/2026 (12 vCPU, 8 GB de RAM, ~1 GB livre), suíte de 50 arquivos
// e 978 testes, amostrando a RAM livre durante a execução:
//
//   workers  parede         tempo-de-teste  RAM livre mínima  resultado
//   11 (def) 102s .. 164s   253s .. 634s     6 MB             2 de 5 execuções VERMELHAS
//    6       123s           147s             —                verde
//    4       110s .. 126s    77s ..  97s     221 MB           5 de 5 verdes
//    3       169s            92s             —                verde
//
// O default não era só instável: era mais LENTO na parede. Os mesmos arquivos que
// levam 3,5s isolados levavam 113s sob 11 workers (32x) — não são testes lentos,
// é fome de CPU/memória. Daí os timeouts caírem em arquivos SORTEADOS a cada
// execução (notification-bell, targets-table, auth, empresas...), que é o que
// destrói a confiança na suíte: ninguém distingue regressão de máquina ocupada.
//
// O teto de 4 é o ponto medido; `cpus - 1` protege máquina pequena (2 núcleos não
// devem abrir 4 workers) e o piso de 2 evita cair em serial no CI.
const maxWorkers = Math.max(2, Math.min(4, availableParallelism() - 1));

// Config PROPRIA, separada do vite.config.ts de propósito. O vite.config carrega
// o plugin tanstackStart (roteamento + entrada de servidor + nitro), que existe
// para buildar a aplicação e não tem o que fazer num test runner — sob ele os
// testes tentariam levantar o pipeline de SSR. Aqui fica só o necessário:
// resolução dos aliases de path e o ambiente de DOM.
//
// `resolve.tsconfigPaths` é o suporte NATIVO do vite 8 aos paths do tsconfig
// (resolve o `@/`). Usar o plugin vite-tsconfig-paths aqui funcionaria, mas o
// próprio vite passa a avisar em toda execução — e aviso recorrente ensina a
// ignorar a saída do runner, que é onde as falhas aparecem.
export default defineConfig({
  resolve: { tsconfigPaths: true },
  test: {
    environment: "jsdom",
    globals: true,
    maxWorkers,
    // Coverage instrumentation + jsdom fica mais lento; 5s default falhava
    // intermitente em app-shell / global-filters / empresas.
    //
    // Estes 20s NÃO são a medida do que os testes precisam: com o `maxWorkers`
    // acima, o teste mais lento da suíte é de 3,0s (empresas, vinculação Meta) e
    // o arquivo mais lento de 10,3s (auth) — ~6x de folga sobre o pior teste,
    // medido em 5 execuções. A folga é grande de propósito: timeout existe para
    // pegar travamento de verdade, e o preço de um teto alto é só esperar mais
    // para ver a falha, enquanto o preço de um teto justo é falha INVENTADA em
    // máquina ocupada. Não subir este número — se voltar a estourar, a causa
    // está no pool ou no teste, não aqui.
    //
    // Ponto mais apertado da suíte hoje: empresas.test.tsx:141 tem orçamento
    // PRÓPRIO de 10s, menor que o global, justo no teste mais lento. Sob 11
    // workers ele chegou a 8,9s (89% do orçamento) e por isso aparecia na lista
    // de flaky; com 4 workers fica em 1,9s..3,0s.
    testTimeout: 20_000,
    hookTimeout: 20_000,
    setupFiles: ["./src/test/setup.ts"],
    include: ["src/**/*.{test,spec}.{ts,tsx}"],
    coverage: {
      provider: "v8",
      reporter: ["text-summary", "json-summary", "lcov"],
      // Escopo = o código de lógica da aplicação. Ficam fora `src/components/ui/`
      // (wrappers de Radix, sem lógica própria) e o routeTree.gen.ts, que é
      // gerado — incluí-los mediria ruído em vez de risco. Não se recorta este
      // escopo por conveniência: encolher a lista para o número subir é maquiar.
      include: [
        "src/lib/**/*.{ts,tsx}",
        "src/hooks/**/*.{ts,tsx}",
        "src/components/**/*.tsx",
        // routes/ entra porque tem lógica de aplicação de verdade — o login vive
        // em routes/auth.tsx. Incluir AUMENTA o denominador e derruba o número;
        // é o número honesto.
        "src/routes/**/*.tsx",
      ],
      exclude: ["src/components/ui/**", "src/lib/error-capture.ts", "src/lib/error-page.ts"],
      // MEDIDOS em 19/08/2026 com 874 testes: lines 67.74%, statements 66.62%,
      // functions 61.93%, branches 58.1%. O piso fica um passo abaixo do medido
      // para o portão não ser instável (mesma doutrina do comentário histórico).
      //
      // Histórico: 40.47% (13/08) → thresholds antigos 69/53/68/49 ficaram acima
      // do medido atual após expansão de denominador — o número honesto desceu;
      // não maquiar subindo cobertura falsa.
      thresholds: { lines: 66, functions: 60, statements: 65, branches: 57 },
    },
  },
});
