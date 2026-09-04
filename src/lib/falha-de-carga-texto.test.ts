import { describe, it, expect } from "vitest";
import { mensagemDeErro } from "./falha-de-carga-texto";

// O contrato que importa e o do fim: NUNCA devolver "undefined", "null" ou
// "[object Object]" para o gestor ler. Melhor sem motivo do que com motivo
// falso — motivo falso e a mesma familia de defeito que este arquivo existe
// para combater, so que na direcao oposta.

describe("mensagemDeErro — extrai a causa legivel", () => {
  it("pega message de Error", () => {
    expect(mensagemDeErro(new Error("failed to fetch"))).toBe("failed to fetch");
  });

  it("pega message de PostgrestError", () => {
    expect(
      mensagemDeErro({
        message: 'permission denied for table "approval_requests"',
        code: "42501",
      }),
    ).toBe('permission denied for table "approval_requests"');
  });

  it("aceita erro que ja e string", () => {
    expect(mensagemDeErro("timeout")).toBe("timeout");
  });

  it("apara espaco nas pontas", () => {
    expect(mensagemDeErro("  permission denied  ")).toBe("permission denied");
    expect(mensagemDeErro({ message: "  falhou  " })).toBe("falhou");
  });

  it("cai para error_description, details, hint e code quando message nao serve", () => {
    expect(mensagemDeErro({ error_description: "token expirado" })).toBe("token expirado");
    expect(mensagemDeErro({ details: "0 rows" })).toBe("0 rows");
    expect(mensagemDeErro({ hint: "verifique a policy" })).toBe("verifique a policy");
    expect(mensagemDeErro({ code: "42501" })).toBe("42501");
  });

  it("respeita a precedencia: message antes dos campos de fallback", () => {
    expect(mensagemDeErro({ message: "principal", details: "secundario" })).toBe("principal");
  });

  it("message vazia ou so-espaco nao mascara o fallback", () => {
    expect(mensagemDeErro({ message: "   ", details: "0 rows" })).toBe("0 rows");
  });
});

describe("mensagemDeErro — quando NAO ha causa utilizavel, devolve vazio", () => {
  // Cada caso abaixo, sem a guarda, viraria uma frase que nao explica nada:
  // "Motivo: undefined", "Motivo: [object Object]", "Motivo: null".
  it("null e undefined nao viram texto", () => {
    expect(mensagemDeErro(null)).toBe("");
    expect(mensagemDeErro(undefined)).toBe("");
  });

  it("objeto sem nenhum campo conhecido nao vira '[object Object]'", () => {
    expect(mensagemDeErro({})).toBe("");
    expect(mensagemDeErro({ statusCode: 500 })).toBe("");
  });

  it("message que nao e string e descartada", () => {
    expect(mensagemDeErro({ message: 42 })).toBe("");
    expect(mensagemDeErro({ message: null })).toBe("");
    expect(mensagemDeErro({ message: { nested: "x" } })).toBe("");
  });

  it("numero e boolean como erro nao ajudam, e nao aparecem", () => {
    expect(mensagemDeErro(500)).toBe("");
    expect(mensagemDeErro(false)).toBe("");
    expect(mensagemDeErro(true)).toBe("");
  });

  it("string vazia continua vazia", () => {
    expect(mensagemDeErro("")).toBe("");
    expect(mensagemDeErro("   ")).toBe("");
  });
});
