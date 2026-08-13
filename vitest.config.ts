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
      // MEDIDOS em 13/08/2026 com 367 testes, não estimados: lines 26.28%,
      // statements 26.46%, functions 17.99%, branches 20.62%. O piso fica um
      // passo abaixo de cada um para o portão não ser instável.
      //
      // Histórico do número, que explica por que ele se move: 8.47% (87 testes)
      // → 15.12% (+breakdown, notificacoes) → 13.38% ao incluir routes/ no
      // escopo (mais código medido, não menos testado) → 24.05% (+relatorio-xlsx,
      // integracoes, attachments, xlsx-export, utils) → 26.28% (+hooks).
      //
      // Ainda é BAIXO e é assim que deve ser lido: `src/lib` está praticamente
      // todo coberto e os hooks de filtro/período também, mas os ~30 componentes
      // e as demais rotas não. O valor deste portão é ser CATRACA (impedir que
      // caia), não atestar que o front está testado. Subir junto com a
      // cobertura, nunca antes dela.
      thresholds: { lines: 26, functions: 17, statements: 26, branches: 20 },
    },
  },
});
