import { defineConfig } from "vitest/config";

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
    // Coverage instrumentation + jsdom fica mais lento; 5s default falhava
    // intermitente em app-shell / global-filters / empresas.
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
