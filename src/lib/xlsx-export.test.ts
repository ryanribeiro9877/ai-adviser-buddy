import { describe, it, expect, vi, beforeEach } from "vitest";
import { nomeComPeriodo, exportarXlsx, type Linha } from "./xlsx-export";

// O SheetJS entra mockado aqui porque `writeFile` dispara download de verdade -
// no jsdom isso nao funciona, e mesmo que funcionasse o teste passaria a
// verificar o navegador em vez desta funcao. O que importa provar e o CONTRATO:
// quais dados viram planilha, com que nome de aba e de arquivo.

const jsonToSheetMock = vi.fn(() => ({ ws: true }));
const bookNewMock = vi.fn(() => ({ SheetNames: [], Sheets: {} }));
const bookAppendMock = vi.fn();
const writeFileMock = vi.fn();

vi.mock("xlsx", () => ({
  default: {
    utils: {
      json_to_sheet: (...a: unknown[]) => jsonToSheetMock(...(a as [])),
      book_new: () => bookNewMock(),
      book_append_sheet: (...a: unknown[]) => bookAppendMock(...a),
    },
    writeFile: (...a: unknown[]) => writeFileMock(...a),
  },
}));

beforeEach(() => {
  jsonToSheetMock.mockClear();
  bookNewMock.mockClear();
  bookAppendMock.mockClear();
  writeFileMock.mockClear();
});

describe("nomeComPeriodo", () => {
  it("monta prefixo_inicio_a_fim.xlsx", () => {
    expect(nomeComPeriodo("relatorio", "2026-07-22", "2026-07-28")).toBe(
      "relatorio_2026-07-22_a_2026-07-28.xlsx",
    );
  });

  it("periodo de um dia so repete a data", () => {
    expect(nomeComPeriodo("campanhas", "2026-08-13", "2026-08-13")).toBe(
      "campanhas_2026-08-13_a_2026-08-13.xlsx",
    );
  });

  it("sempre termina em .xlsx", () => {
    expect(nomeComPeriodo("x", "a", "b").endsWith(".xlsx")).toBe(true);
  });

  it("as datas entram sem reformatacao (ISO sai ISO)", () => {
    // O nome do arquivo e ordenavel por isso: ISO ordena alfabeticamente.
    expect(nomeComPeriodo("r", "2026-01-05", "2026-12-31")).toContain("2026-01-05_a_2026-12-31");
  });
});

describe("exportarXlsx", () => {
  const linhas: Linha[] = [
    { Campanha: "A", Gasto: 100 },
    { Campanha: "B", Gasto: null },
  ];

  it("passa as linhas para o SheetJS e grava com o nome pedido", async () => {
    await exportarXlsx(linhas, "saida.xlsx");
    expect(jsonToSheetMock).toHaveBeenCalledWith(linhas);
    expect(writeFileMock.mock.calls[0][1]).toBe("saida.xlsx");
  });

  it('usa "Dados" como nome de aba por padrao', async () => {
    await exportarXlsx(linhas, "saida.xlsx");
    expect(bookAppendMock.mock.calls[0][2]).toBe("Dados");
  });

  it("respeita o nome de aba informado", async () => {
    await exportarXlsx(linhas, "saida.xlsx", "Campanhas");
    expect(bookAppendMock.mock.calls[0][2]).toBe("Campanhas");
  });

  it("TRUNCA o nome da aba em 31 caracteres (limite do Excel)", async () => {
    // Passar de 31 faz o Excel recusar o arquivo inteiro - o usuario receberia
    // um .xlsx que nao abre, sem nenhuma pista do motivo.
    const nomeLongo = "Relatorio Completo De Campanhas Do Mes";
    await exportarXlsx(linhas, "saida.xlsx", nomeLongo);
    const usado = bookAppendMock.mock.calls[0][2] as string;
    expect(usado).toHaveLength(31);
    expect(nomeLongo.startsWith(usado)).toBe(true);
  });

  it("nome de aba com exatamente 31 chars passa intacto", async () => {
    const trintaEUm = "a".repeat(31);
    await exportarXlsx(linhas, "saida.xlsx", trintaEUm);
    expect(bookAppendMock.mock.calls[0][2]).toBe(trintaEUm);
  });

  it("lista vazia ainda gera arquivo, em vez de falhar em silencio", async () => {
    // Exportar um filtro sem resultado deve produzir planilha vazia; nao gerar
    // nada deixaria o usuario achando que o botao quebrou.
    await exportarXlsx([], "vazio.xlsx");
    expect(jsonToSheetMock).toHaveBeenCalledWith([]);
    expect(writeFileMock).toHaveBeenCalledTimes(1);
  });
});
