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
      // MEDIDOS em 13/08/2026 com 477 testes, não estimados: lines 40.47%. O
      // piso fica um passo abaixo para o portão não ser instável.
      //
      // Histórico do número, que explica por que ele se move: 8.47% (87 testes)
      // → 15.12% (+breakdown, notificacoes) → 13.38% ao incluir routes/ no
      // escopo (mais código medido, não menos testado) → 24.05% (+lib restante)
      // → 26.28% → 28.38% (+app-context, guarda de rota) → 40.47% (+hooks).
      //
      // NÃO leia o agregado como "o front está 40% testado". Por diretório:
      //   src/lib          99.8%  praticamente completo
      //   src/hooks        94.1%  praticamente completo
      //   src/routes       ~54%   login e guarda cobertos; telas, não
      //   src/components   ~5.6%  ~30 arquivos — é aqui que está a lacuna
      //
      // CORREÇÃO de uma nota anterior deste arquivo: dizia que use-dictation
      // ficaria fora "porque depende da Web Speech API". Está errado — o próprio
      // docstring do hook diz que a Web Speech foi REMOVIDA; ele usa
      // MediaRecorder e recebe a transcrição por injeção de dependência, o que o
      // torna testável. Hoje está a 96% (25 testes).
      //
      // O valor deste portão é ser CATRACA (impedir que caia), não atestado.
      // Subir junto com a cobertura, nunca antes dela.
      thresholds: { lines: 40, functions: 30, statements: 40, branches: 30 },
    },
  },
});
