import { describe, expect, it } from "vitest";
import { limparJargaoRelatorio, rotuloSeveridadeRelatorio } from "./relatorios-apresentacao";

describe("limparJargaoRelatorio", () => {
  it("traduz falha de ferramenta e chave JSON, sem apagar o número", () => {
    const t = limparJargaoRelatorio(
      "desempenho_campanhas falhou (openrouter_timeout); amostra_pequena=true; budget_remaining=0",
    );
    expect(t).toMatch(/leitura de desempenho/i);
    expect(t).toMatch(/tempo esgotado/i);
    expect(t).toMatch(/amostra pequena/i);
    expect(t).toMatch(/orçamento restante zerado/i);
    expect(t).not.toMatch(/desempenho_campanhas/);
    expect(t).not.toMatch(/openrouter_timeout/);
  });

  it("traduz o aviso de síntese cortada sem falar JSON para o gestor", () => {
    const t = limparJargaoRelatorio(
      "Lista conferida ao vivo. Falhas: nenhuma. síntese não devolveu JSON válido",
    );
    expect(t).toMatch(/narrativa abaixo foi recuperada/i);
    expect(t).not.toMatch(/JSON/);
  });
});

describe("rotuloSeveridadeRelatorio", () => {
  it("não deixa o enum cru na cara do gestor", () => {
    expect(rotuloSeveridadeRelatorio("atencao")).toBe("Atenção");
    expect(rotuloSeveridadeRelatorio("urgente")).toBe("Urgente");
  });
});
