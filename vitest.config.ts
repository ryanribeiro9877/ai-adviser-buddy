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
    setupFiles: ["./src/test/setup.ts"],
    include: ["src/**/*.{test,spec}.{ts,tsx}"],
    coverage: {
      provider: "v8",
      reporter: ["text-summary", "json-summary", "lcov"],
      // Escopo = o código de lógica da aplicação. Ficam fora `src/components/ui/`
      // (wrappers de Radix, sem lógica própria) e o routeTree.gen.ts, que é
      // gerado — incluí-los mediria ruído em vez de risco. Não se recorta este
      // escopo por conveniência: encolher a lista para o número subir é maquiar.
      include: ["src/lib/**/*.{ts,tsx}", "src/hooks/**/*.{ts,tsx}", "src/components/**/*.tsx"],
      exclude: ["src/components/ui/**", "src/lib/error-capture.ts", "src/lib/error-page.ts"],
      // MEDIDOS em 13/08/2026 com 87 testes, não estimados: lines 8.47%,
      // statements 8.67%, functions 5.69%, branches 8.71%. O piso fica um passo
      // abaixo de cada um para o portão não ser instável.
      //
      // São números BAIXOS e é assim que devem ser lidos: a suíte cobre hoje
      // filters, infobip-import, decideApproval e a orquestração da fila de
      // aprovações — não o resto. O valor deste portão é ser CATRACA (impedir
      // que caia), não atestar que o front está testado. Subir junto com a
      // cobertura, nunca antes dela.
      thresholds: { lines: 8, functions: 5, statements: 8, branches: 8 },
    },
  },
});
