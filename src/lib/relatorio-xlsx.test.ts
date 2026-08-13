import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from "vitest";
import {
  nomeArquivo,
  montarWorkbook,
  exportarRelatorioRico,
  type DadosExport,
  type SerieDia,
} from "./relatorio-xlsx";

// `montarWorkbook` faz `await import("exceljs")`, e o ExcelJS é grande: a PRIMEIRA
// chamada paga a carga do módulo, que sob instrumentação de cobertura passou de
// 5s e estourou o timeout padrão — teste verde nas execuções normais e vermelho
// sob `--coverage`, que é o pior tipo de flaky.
//
// A carga é aquecida aqui, num hook com orçamento próprio e generoso, em vez de
// afrouxar o `testTimeout` global: o padrão de 5s é o que pega travamento de
// verdade nos outros 470 testes, e não vale perdê-lo por causa de um import.
beforeAll(async () => {
  await import("exceljs");
}, 120_000);

// Este e o relatorio que vai para o CLIENTE. Duas coisas o definem e sao o que
// estes testes protegem:
//  1. as metricas sao gravadas como FORMULA, nao como valor - o cliente abre no
//     Excel e audita a conta. Trocar formula por numero calculado no JS mataria
//     a auditabilidade sem mudar nada visivel na tela.
//  2. toda divisao vai dentro de IFERROR(...,"-") - um "#DIV/0!" num relatorio
//     que vai para fora e uma falha visivel e constrangedora.

function dia(d: string, over: Partial<SerieDia> = {}): SerieDia {
  return { d, gasto: 100, imp: 1000, clk: 50, lclk: 40, views: 30, forms: 5, conv: 2, ...over };
}

function dados(over: Partial<DadosExport> = {}): DadosExport {
  return {
    periodo: { inicio: "2026-07-01", fim: "2026-07-07", dias_com_dado: 7, dias_no_periodo: 7 },
    serie_diaria: [dia("2026-07-01"), dia("2026-07-02"), dia("2026-07-03")],
    por_campanha: [
      { nome: "Campanha A", gasto: 300, imp: 3000, lclk: 120, views: 90, forms: 15, conv: 6 },
    ],
    top_anuncios: [{ nome: "Anúncio 1", gasto: 150, lclk: 60, forms: 8 }],
    tetos: { custo_por_formulario: 20 },
    nao_disponivel: [],
    ...over,
  };
}

describe("nomeArquivo", () => {
  it("monta relatorio_<empresa>_<inicio>_a_<fim>.xlsx", () => {
    expect(nomeArquivo(dados(), "JCR2 Advogados")).toBe(
      "relatorio_jcr2-advogados_2026-07-01_a_2026-07-07.xlsx",
    );
  });

  it("troca pontuacao e espaco por hifen, e baixa a caixa", () => {
    expect(nomeArquivo(dados(), "X---Y")).toContain("relatorio_x-y_");
    expect(nomeArquivo(dados(), "ACME")).toContain("relatorio_acme_");
  });

  it("DOCUMENTA: acentos sao PRESERVADOS no nome do arquivo", () => {
    // \p{L} casa ç e ã, entao eles sobrevivem ao slug. Nao e bug (o nome fica
    // legivel), mas e bom saber antes de investigar um download com nome
    // estranho em sistema de arquivos exotico.
    expect(nomeArquivo(dados(), "Ação Legal")).toContain("relatorio_ação-legal_");
  });

  it("DOCUMENTA: pontuacao na borda deixa hifen sobrando", () => {
    expect(nomeArquivo(dados(), "Empresa & Cia.")).toContain("relatorio_empresa-cia-_");
  });

  it("empresa vazia nao quebra o nome", () => {
    expect(nomeArquivo(dados(), "")).toBe("relatorio__2026-07-01_a_2026-07-07.xlsx");
  });

  it("as datas do periodo entram cruas, mantendo a ordenacao ISO", () => {
    const n = nomeArquivo(
      dados({
        periodo: { inicio: "2026-01-05", fim: "2026-12-31", dias_com_dado: 1, dias_no_periodo: 1 },
      }),
      "X",
    );
    expect(n).toContain("2026-01-05_a_2026-12-31");
  });
});

describe("montarWorkbook — estrutura", () => {
  it("cria as 5 abas do relatorio", async () => {
    const wb = await montarWorkbook(dados(), "JCR2");
    expect(wb.worksheets.map((w) => w.name)).toEqual([
      "Resumo",
      "Semana a semana",
      "Série diária",
      "Campanhas",
      "Anúncios (top 1)",
    ]);
  });

  it("o nome da aba de anuncios reflete a QUANTIDADE recebida", async () => {
    const wb = await montarWorkbook(
      dados({
        top_anuncios: Array.from({ length: 10 }, (_, i) => ({
          nome: `A${i}`,
          gasto: 1,
          lclk: 1,
          forms: 1,
        })),
      }),
      "X",
    );
    expect(wb.worksheets[4].name).toBe("Anúncios (top 10)");
  });

  it("identifica o gerador no metadado do arquivo", async () => {
    const wb = await montarWorkbook(dados(), "X");
    expect(wb.creator).toBe("Gestor de Tráfego IA");
  });

  it("sem nenhum anuncio ainda gera a aba, em vez de omitir", async () => {
    const wb = await montarWorkbook(dados({ top_anuncios: [] }), "X");
    expect(wb.worksheets.map((w) => w.name)).toContain("Anúncios (top 0)");
  });
});

describe("montarWorkbook — métricas por FÓRMULA (a razão do ExcelJS)", () => {
  /** Junta todas as fórmulas de uma aba, para inspeção. */
  function formulas(ws: import("exceljs").Worksheet): string[] {
    const out: string[] = [];
    ws.eachRow((row) => {
      row.eachCell((cell) => {
        const v = cell.value as { formula?: string } | null;
        if (v && typeof v === "object" && typeof v.formula === "string") out.push(v.formula);
      });
    });
    return out;
  }

  it("a linha de total usa SUM sobre o intervalo, nao um numero pronto", async () => {
    const wb = await montarWorkbook(dados(), "X");
    const f = formulas(wb.getWorksheet("Série diária")!);
    expect(f.some((x) => /^SUM\(B\d+:B\d+\)$/.test(x))).toBe(true);
  });

  it("TODA divisao esta protegida — nada de #DIV/0! no relatorio do cliente", async () => {
    // O codigo usa DUAS formas de guarda, e as duas valem:
    //   IFERROR(B5/G5,"-")        — pega qualquer erro
    //   IF(F5=0,"-",B5/F5)        — testa o denominador antes
    // Escrever este teste so com IFERROR reprovaria a segunda forma, que esta
    // correta. O contrato e "divisao protegida", nao "uma sintaxe especifica".
    const wb = await montarWorkbook(dados(), "X");
    const todas = wb.worksheets.flatMap((ws) => formulas(ws));
    const divisoes = todas.filter((f) => f.includes("/"));
    expect(divisoes.length).toBeGreaterThan(0);
    for (const f of divisoes) expect(f, f).toMatch(/^(IFERROR\(|IF\([A-Z]+\d+=0,)/);
  });

  it("o fallback da divisao e TEXTO, nunca zero (zero mentiria sobre o custo)", async () => {
    // Custo por formulario "R$ 0,00" leria como "sai de graca"; um texto le como
    // "nao houve formulario para dividir", que e a verdade.
    //
    // O texto VARIA conforme o sentido da celula, e esta certo que varie: "-"
    // nas de custo, "sem formulário" na de veredito de teto (que devolve
    // "Dentro do teto"/"ACIMA do teto"). Por isso o teste checa a PROPRIEDADE
    // — fallback textual, jamais numerico — em vez de fixar uma string.
    const wb = await montarWorkbook(dados(), "X");
    const todas = wb.worksheets.flatMap((ws) => formulas(ws));
    const guardadas = todas.filter((f) => f.includes("/") && f.startsWith("IF"));
    expect(guardadas.length).toBeGreaterThan(0);
    for (const f of guardadas) {
      expect(f, f).toMatch(/"[^"]+"/); // ha um fallback textual
      expect(f, f).not.toMatch(/,\s*0\s*\)/); // e ele nao e zero
    }
  });

  it("série com UM dia só ainda produz fórmula de total válida", async () => {
    const wb = await montarWorkbook(dados({ serie_diaria: [dia("2026-07-01")] }), "X");
    const f = formulas(wb.getWorksheet("Série diária")!);
    expect(f.some((x) => x.startsWith("SUM("))).toBe(true);
  });

  it("série VAZIA não derruba a montagem", async () => {
    // Periodo sem nenhum dado e cenario real (conta recem-conectada).
    await expect(montarWorkbook(dados({ serie_diaria: [] }), "X")).resolves.toBeTruthy();
  });
});

describe("montarWorkbook — honestidade sobre o que falta", () => {
  it("lista cada item de nao_disponivel no Resumo", async () => {
    // O relatorio diz o que NAO tem, em vez de omitir em silencio - omitir
    // faria o cliente ler zero como "nao aconteceu" em vez de "nao medimos".
    const wb = await montarWorkbook(
      dados({ nao_disponivel: ["Conversas do WhatsApp", "Leads do CRM"] }),
      "X",
    );
    const textos: string[] = [];
    wb.getWorksheet("Resumo")!.eachRow((r) =>
      r.eachCell((c) => {
        if (typeof c.value === "string") textos.push(c.value);
      }),
    );
    expect(textos).toContain("Não disponível — Conversas do WhatsApp");
    expect(textos).toContain("Não disponível — Leads do CRM");
  });

  it("nao_disponivel vazio nao gera linha órfã", async () => {
    const wb = await montarWorkbook(dados({ nao_disponivel: [] }), "X");
    const textos: string[] = [];
    wb.getWorksheet("Resumo")!.eachRow((r) =>
      r.eachCell((c) => {
        if (typeof c.value === "string") textos.push(c.value);
      }),
    );
    expect(textos.some((t) => t.startsWith("Não disponível"))).toBe(false);
  });

  it("declara a cobertura do periodo (dias com dado de quantos)", async () => {
    // 3 de 7 dias com dado muda completamente a leitura dos totais.
    const wb = await montarWorkbook(
      dados({
        periodo: { inicio: "2026-07-01", fim: "2026-07-07", dias_com_dado: 3, dias_no_periodo: 7 },
      }),
      "X",
    );
    const textos: string[] = [];
    wb.getWorksheet("Resumo")!.eachRow((r) =>
      r.eachCell((c) => {
        if (typeof c.value === "string") textos.push(c.value);
      }),
    );
    expect(textos.join(" | ")).toContain("3 de 7 dias com dado");
  });
});

describe("montarWorkbook — agrupamento semanal", () => {
  it("agrupa segunda→domingo, e nao em blocos de 7 a partir do primeiro dia", async () => {
    // 2026-07-01 é quarta. Uma série de quarta a segunda tem de virar DUAS
    // semanas, não uma: agrupar de 7 em 7 misturaria semanas do calendário.
    const serie = [
      dia("2026-07-01"), // qua
      dia("2026-07-02"),
      dia("2026-07-03"),
      dia("2026-07-04"),
      dia("2026-07-05"), // dom — fim da 1a semana
      dia("2026-07-06"), // seg — 2a semana
    ];
    const wb = await montarWorkbook(dados({ serie_diaria: serie }), "X");
    const ws = wb.getWorksheet("Semana a semana")!;
    // conta as linhas que trazem um intervalo de datas dd/mm
    let semanas = 0;
    ws.eachRow((r) =>
      r.eachCell((c) => {
        if (typeof c.value === "string" && /\d{2}\/\d{2}.*\d{2}\/\d{2}/.test(c.value)) semanas++;
      }),
    );
    expect(semanas).toBe(2);
  });
});

describe("exportarRelatorioRico", () => {
  // O parâmetro é declarado de propósito: sem ele o vi.fn tipa as chamadas como
  // tupla vazia e o tsc recusa ler `mock.calls[0][0]` — que é justamente o Blob
  // que um dos testes inspeciona.
  const createObjectURL = vi.fn((_blob: Blob) => "blob:fake");
  const revokeObjectURL = vi.fn();
  let clickSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    // jsdom não implementa createObjectURL; sem o stub o teste falharia por
    // limitação do ambiente, não por defeito do código.
    vi.stubGlobal("URL", { ...URL, createObjectURL, revokeObjectURL });
    createObjectURL.mockClear();
    revokeObjectURL.mockClear();
    clickSpy = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    clickSpy.mockRestore();
  });

  it("dispara o download e devolve o nome do arquivo", async () => {
    const nome = await exportarRelatorioRico(dados(), "JCR2 Advogados");
    expect(nome).toBe("relatorio_jcr2-advogados_2026-07-01_a_2026-07-07.xlsx");
    expect(clickSpy).toHaveBeenCalledTimes(1);
  });

  it("LIBERA a object URL depois de usar (senão vaza memória a cada export)", async () => {
    await exportarRelatorioRico(dados(), "X");
    expect(createObjectURL).toHaveBeenCalledTimes(1);
    expect(revokeObjectURL).toHaveBeenCalledWith("blob:fake");
  });

  it("gera um arquivo xlsx com conteúdo de verdade, não um blob vazio", async () => {
    await exportarRelatorioRico(dados(), "X");
    const blob = createObjectURL.mock.calls[0][0] as unknown as Blob;
    expect(blob.type).toBe("application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    expect(blob.size).toBeGreaterThan(1000);
  });
});
