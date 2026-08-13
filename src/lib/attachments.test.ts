import { describe, it, expect } from "vitest";
import * as XLSX from "xlsx";
import {
  kindFromMime,
  fileToBase64,
  toOutgoing,
  ACCEPT,
  MAX_FILES,
  MAX_BYTES,
} from "./attachments";

// Anexo do chat: arquivo escolhido pelo usuario, convertido no NAVEGADOR e
// mandado para a edge. Mesma superficie de risco do importador da Infobip - e
// aqui a planilha passa pelo SheetJS antes de virar CSV.

describe("kindFromMime", () => {
  it.each([
    ["image/png", "", "image"],
    ["image/jpeg", "", "image"],
    ["image/webp", "", "image"],
    ["application/pdf", "", "pdf"],
    ["text/csv", "", "sheet"],
    ["application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", "", "sheet"],
    ["application/vnd.ms-excel", "", "sheet"],
    ["text/plain", "", "text"],
    ["application/zip", "", "file"],
  ])("mime %s -> %s", (mime, nome, esperado) => {
    expect(kindFromMime(mime, nome)).toBe(esperado);
  });

  it("cai para a EXTENSAO quando o mime nao ajuda", () => {
    // Navegador e sistema operacional as vezes mandam mime vazio ou genérico;
    // sem o fallback por extensao o anexo viraria "file" e a edge perderia o
    // tratamento de planilha.
    expect(kindFromMime("", "relatorio.pdf")).toBe("pdf");
    expect(kindFromMime("", "dados.xlsx")).toBe("sheet");
    expect(kindFromMime("", "dados.xls")).toBe("sheet");
    expect(kindFromMime("", "dados.csv")).toBe("sheet");
    expect(kindFromMime("", "nota.txt")).toBe("text");
    expect(kindFromMime("application/octet-stream", "planilha.xlsx")).toBe("sheet");
  });

  it("mime undefined nao estoura", () => {
    expect(kindFromMime(undefined)).toBe("file");
    expect(kindFromMime(undefined, "x.pdf")).toBe("pdf");
  });

  it("nao diferencia caixa no mime nem na extensao", () => {
    expect(kindFromMime("IMAGE/PNG")).toBe("image");
    expect(kindFromMime("", "DADOS.XLSX")).toBe("sheet");
  });

  it("imagem vence, mesmo com extensao conflitante", () => {
    // A ordem das checagens importa: image/ e a primeira.
    expect(kindFromMime("image/png", "coisa.pdf")).toBe("image");
  });

  it("desconhecido vira 'file' em vez de undefined", () => {
    expect(kindFromMime("application/x-coisa", "arquivo.bin")).toBe("file");
  });
});

describe("fileToBase64", () => {
  it("devolve base64 PURO, sem o prefixo data:", () => {
    // A edge espera base64 cru; mandar com prefixo faria o decode falhar do
    // outro lado, com erro que nao aponta para ca.
    const blob = new Blob(["ola"], { type: "text/plain" });
    return expect(fileToBase64(blob)).resolves.toBe(btoa("ola"));
  });

  it("blob vazio devolve string vazia, nao erro", async () => {
    expect(await fileToBase64(new Blob([], { type: "text/plain" }))).toBe("");
  });

  it("preserva bytes de conteudo binario", async () => {
    const bytes = new Uint8Array([0, 1, 2, 253, 254, 255]);
    const b64 = await fileToBase64(new Blob([bytes]));
    expect([...atob(b64)].map((c) => c.charCodeAt(0))).toEqual([...bytes]);
  });
});

describe("toOutgoing", () => {
  it("arquivo comum vai como base64 com nome e mime preservados", async () => {
    const file = new File(["conteudo"], "nota.txt", { type: "text/plain" });
    expect(await toOutgoing(file)).toEqual({
      name: "nota.txt",
      mime: "text/plain",
      data_base64: btoa("conteudo"),
    });
  });

  it("mime ausente cai em application/octet-stream", async () => {
    const out = await toOutgoing(new File(["x"], "sem-tipo"));
    expect(out.mime).toBe("application/octet-stream");
  });

  it("PLANILHA e convertida para CSV no navegador, nao mandada crua", async () => {
    // O parse aqui e mais robusto que o fallback da edge, e economiza
    // transferir o binario inteiro.
    const ws = XLSX.utils.json_to_sheet([{ Nome: "Ryan", Gasto: 100 }]);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Aba1");
    const buf = XLSX.write(wb, { bookType: "xlsx", type: "array" }) as ArrayBuffer;
    const file = new File([buf], "dados.xlsx", {
      type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    });

    const out = await toOutgoing(file);
    expect(out.name).toBe("dados.csv");
    expect(out.mime).toBe("text/csv");
    const texto = atob(out.data_base64);
    expect(texto).toContain("--- aba: Aba1 ---");
    expect(texto).toContain("Nome,Gasto");
    expect(texto).toContain("Ryan,100");
  });

  it("planilha com varias abas: todas viram texto, com cabecalho por aba", async () => {
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet([{ a: 1 }]), "Primeira");
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet([{ b: 2 }]), "Segunda");
    const buf = XLSX.write(wb, { bookType: "xlsx", type: "array" }) as ArrayBuffer;
    const out = await toOutgoing(new File([buf], "duas.xlsx"));
    const texto = atob(out.data_base64);
    expect(texto).toContain("--- aba: Primeira ---");
    expect(texto).toContain("--- aba: Segunda ---");
  });

  it("detecta planilha pela EXTENSAO mesmo sem mime", async () => {
    const ws = XLSX.utils.json_to_sheet([{ a: 1 }]);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "S");
    const buf = XLSX.write(wb, { bookType: "xlsx", type: "array" }) as ArrayBuffer;
    const out = await toOutgoing(new File([buf], "planilha.xls"));
    expect(out.name).toBe("planilha.csv");
  });

  it("CSV NAO passa pelo SheetJS — vai como base64 do proprio arquivo", async () => {
    // Distincao que importa: csv ja e texto, reprocessar so introduziria risco
    // de reinterpretacao de separador e de aspas.
    const file = new File(["a,b\n1,2"], "dados.csv", { type: "text/csv" });
    const out = await toOutgoing(file);
    expect(out.name).toBe("dados.csv");
    expect(out.mime).toBe("text/csv");
    expect(atob(out.data_base64)).toBe("a,b\n1,2");
  });

  it("nome com acento sobrevive a conversao de planilha (UTF-8)", async () => {
    const ws = XLSX.utils.json_to_sheet([{ "Coluna Acentuada": "ação" }]);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "S");
    const buf = XLSX.write(wb, { bookType: "xlsx", type: "array" }) as ArrayBuffer;
    const out = await toOutgoing(new File([buf], "acentos.xlsx"));
    // utf8ToBase64 codifica em UTF-8 antes do btoa; decodificar de volta tem de
    // devolver o acento intacto, e nao mojibake.
    const bytes = Uint8Array.from(atob(out.data_base64), (c) => c.charCodeAt(0));
    expect(new TextDecoder().decode(bytes)).toContain("ação");
  });
});

describe("limites declarados", () => {
  it("ACCEPT cobre os tipos que kindFromMime sabe tratar", () => {
    for (const t of ["image/png", "application/pdf", ".csv", ".xlsx", ".xls", ".txt"]) {
      expect(ACCEPT).toContain(t);
    }
  });

  it("ACCEPT nao aceita tipo executavel", () => {
    for (const t of [".exe", ".sh", ".js", "application/x-msdownload"]) {
      expect(ACCEPT).not.toContain(t);
    }
  });

  it("MAX_FILES e MAX_BYTES sao os limites documentados", () => {
    expect(MAX_FILES).toBe(4);
    expect(MAX_BYTES).toBe(8 * 1024 * 1024);
  });
});
