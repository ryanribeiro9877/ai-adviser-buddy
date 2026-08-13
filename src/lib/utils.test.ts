import { describe, it, expect } from "vitest";
import { cn } from "./utils";
import { FEATURES } from "./features";

// `cn` e usada em praticamente todo componente. O motivo de existir nao e
// concatenar classes (clsx sozinho faria isso) e sim o twMerge: sem ele, passar
// uma classe de override deixa as DUAS na string e quem vence e a ordem do CSS,
// nao a intencao de quem chamou.

describe("cn", () => {
  it("junta classes soltas", () => {
    expect(cn("a", "b")).toBe("a b");
  });

  it("ignora falsy (o padrao de classe condicional)", () => {
    expect(cn("a", false, null, undefined, "", "b")).toBe("a b");
  });

  it("aceita objeto e array, como o clsx", () => {
    expect(cn({ a: true, b: false }, ["c", "d"])).toBe("a c d");
  });

  it("RESOLVE conflito do Tailwind mantendo a ultima — a razao do twMerge", () => {
    expect(cn("p-2", "p-4")).toBe("p-4");
    expect(cn("text-red-500", "text-blue-500")).toBe("text-blue-500");
  });

  it("nao confunde utilitarios diferentes que comecam igual", () => {
    // px e py sao eixos distintos: colapsar os dois seria bug visual silencioso.
    expect(cn("px-2", "py-4")).toBe("px-2 py-4");
  });

  it("permite override condicional (o uso real em componente)", () => {
    const base = "rounded-md p-2";
    expect(cn(base, "p-6")).toBe("rounded-md p-6");
  });

  it("sem argumento devolve string vazia", () => {
    expect(cn()).toBe("");
  });
});

describe("FEATURES", () => {
  it("approvalsMenu segue desligada (a rota existe, o menu nao)", () => {
    // O menu de aprovacoes foi ocultado, nao deletado: o fluxo renasce dentro do
    // chat Operacao. Se este teste falhar, foi decisao de produto - atualize-o
    // junto com a decisao, nao antes.
    expect(FEATURES.approvalsMenu).toBe(false);
  });

  it("toda flag e booleana (nada de string 'false')", () => {
    for (const [nome, valor] of Object.entries(FEATURES)) {
      expect(typeof valor, nome).toBe("boolean");
    }
  });
});
