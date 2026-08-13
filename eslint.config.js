import js from "@eslint/js";
import eslintPluginPrettier from "eslint-plugin-prettier/recommended";
import globals from "globals";
import reactHooks from "eslint-plugin-react-hooks";
import reactRefresh from "eslint-plugin-react-refresh";
import tseslint from "typescript-eslint";

export default tseslint.config(
  {
    ignores: [
      "dist",
      ".output",
      ".vinxi",
      // Código Deno: tem toolchain própria (`deno check` + `deno lint`) e é
      // essa que o CI roda nele. Sob as regras daqui davam 480 erros — 473 de
      // no-explicit-any — e `eslint .` nascia vermelho, o que ensina a ignorar
      // a saída em vez de lê-la. Mesmo critério já aplicado no .prettierignore
      // (printWidth 100 do prettier vs 80 do deno fmt).
      //
      // O que sai de vista aqui NÃO desaparece: 5 prefer-const e 2
      // no-unused-expressions (ternário usado como statement em
      // traffic-agent-job — os dois ramos têm efeito, não é bug) seguem
      // reportados pelo `deno lint` no job de edges. Não foram consertados de
      // propósito: são cosméticos, estão em edges JÁ DEPLOYADAS, e hoje repo e
      // produção estão idênticos nas 24 — mexer por estilo quebraria essa
      // propriedade e redeployar produção por let→const não se paga.
      "supabase/functions",
      "docs/edges-descontinuadas",
    ],
  },
  {
    extends: [js.configs.recommended, ...tseslint.configs.recommended],
    files: ["**/*.{ts,tsx}"],
    languageOptions: {
      ecmaVersion: 2020,
      globals: globals.browser,
    },
    plugins: {
      "react-hooks": reactHooks,
      "react-refresh": reactRefresh,
    },
    rules: {
      ...reactHooks.configs.recommended.rules,
      "no-restricted-imports": [
        "error",
        {
          paths: [
            {
              name: "server-only",
              message:
                "TanStack Start does not use the Next.js `server-only` package. Rename the module to `*.server.ts` or mark it with `@tanstack/react-start/server-only`.",
            },
          ],
        },
      ],
      "react-refresh/only-export-components": ["warn", { allowConstantExport: true }],
      "@typescript-eslint/no-unused-vars": "off",
    },
  },
  eslintPluginPrettier,
);
