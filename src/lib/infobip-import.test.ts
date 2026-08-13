import { describe, it, expect, vi, beforeEach } from "vitest";
import * as XLSX from "xlsx";
import { parseDataBR, lerArquivoInfobip, enviarLotes } from "./infobip-import";

// Este modulo le PLANILHA ENVIADA PELO USUARIO - a entrada menos confiavel do
// sistema, e a mesma superficie das duas CVE HIGH do SheetJS que motivaram a
// subida para 0.20.3. Os testes montam .xlsx de verdade e passam pelo parser
// real, em vez de simular o retorno do XLSX.

// enviarLotes fala com o Supabase; o client e importado no topo do modulo.
const upsertMock = vi.fn();
vi.mock("@/integrations/supabase/client", () => ({
  supabase: { from: () => ({ upsert: upsertMock }) },
}));

beforeEach(() => {
  upsertMock.mockReset();
  upsertMock.mockResolvedValue({ error: null });
});

/** Monta um .xlsx real na memoria e devolve como File, igual ao do input. */
function planilha(linhas: Record<string, unknown>[], aba = "Data", nome = "export.xlsx"): File {
  const ws = XLSX.utils.json_to_sheet(linhas);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, aba);
  const buf = XLSX.write(wb, { bookType: "xlsx", type: "array" }) as ArrayBuffer;
  return new File([buf], nome, {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });
}

const EMPRESA = "8f1e2c3d-4a5b-6c7d-8e9f-0a1b2c3d4e5f";

describe("parseDataBR", () => {
  it("converte dd/MM/yyyy HH:mm:ss assumindo America/Sao_Paulo (-03:00)", () => {
    expect(parseDataBR("22/07/2026 14:35:09")).toBe("2026-07-22T14:35:09-03:00");
  });

  it("aceita separador T e hora sem segundos", () => {
    expect(parseDataBR("22/07/2026T14:35")).toBe("2026-07-22T14:35:00-03:00");
  });

  it("data sem hora vira meia-noite local", () => {
    expect(parseDataBR("22/07/2026")).toBe("2026-07-22T00:00:00-03:00");
  });

  it("devolve null para vazio, null e undefined", () => {
    expect(parseDataBR("")).toBeNull();
    expect(parseDataBR(null)).toBeNull();
    expect(parseDataBR(undefined)).toBeNull();
  });

  it("devolve null para texto que nao e data", () => {
    expect(parseDataBR("lixo")).toBeNull();
    expect(parseDataBR("N/A")).toBeNull();
  });

  it("passa Date adiante como ISO (caso o SheetJS ja tenha convertido a celula)", () => {
    const d = new Date(Date.UTC(2026, 6, 22, 17, 35, 9));
    expect(parseDataBR(d)).toBe("2026-07-22T17:35:09.000Z");
  });

  it("Date invalido nao vira ISO invalido", () => {
    expect(parseDataBR(new Date("nada"))).toBeNull();
  });

  it("converte serial do Excel dentro da faixa considerada plausivel", () => {
    // 45000 = 15/03/2023. A faixa aceita e 20000 < n < 90000.
    expect(parseDataBR("45000")).toBe("2023-03-15T00:00:00.000Z");
    expect(parseDataBR(45000)).toBe("2023-03-15T00:00:00.000Z");
  });

  // --- Comportamentos REAIS que valem registro ------------------------------

  it("DOCUMENTA: nao valida faixa de dia/mes - 99/99/2026 vira string malformada", () => {
    // O regex casa (\d{2})/(\d{2})/(\d{4}) e monta a string sem conferir se o
    // dia e o mes existem. Impacto medido: o Postgres RECUSA
    // ("22008 date/time field value out of range"), entao a falha e alta, nao
    // corrompe dado - mas derruba o LOTE INTEIRO de 500 linhas em enviarLotes,
    // com erro cru e sem dizer qual linha ou celula causou.
    expect(parseDataBR("99/99/2026")).toBe("2026-99-99T00:00:00-03:00");
    expect(parseDataBR("31/02/2026")).toBe("2026-02-31T00:00:00-03:00");
  });

  it("DOCUMENTA: serial ABAIXO da faixa cai no parse solto e vira ano absurdo", () => {
    // "15000" nao entra no ramo de serial (precisa > 20000), cai em new Date(s)
    // e o V8 le como ANO 15000. Tambem recusado pelo Postgres ("22009 time zone
    // displacement out of range"), com o mesmo efeito de derrubar o lote.
    expect(parseDataBR("15000")).toBe("+015000-01-01T03:00:00.000Z");
  });

  it("aceita ISO solto (o export as vezes traz formato diferente)", () => {
    expect(parseDataBR("2026-07-22")).toBe("2026-07-22T00:00:00.000Z");
  });
});

describe("lerArquivoInfobip", () => {
  it("mapeia os cabecalhos do export para as colunas da tabela", async () => {
    const file = planilha([
      {
        "Message Id": "abc123",
        "Service Name": "WhatsApp",
        From: "5531999",
        To: "5531888",
        "Send At": "22/07/2026 10:00:00",
        Status: "DELIVERED",
        "Purchase Price": "0.0345",
        Clicks: "2",
        "Messages Count": "1",
      },
    ]);
    const { rows, meta } = await lerArquivoInfobip(file, EMPRESA);

    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      company_id: EMPRESA,
      source_file: "export.xlsx",
      message_id: "abc123",
      service_name: "WhatsApp",
      from_number: "5531999",
      to_number: "5531888",
      send_at: "2026-07-22T10:00:00-03:00",
      status: "DELIVERED",
      price_raw: 0.0345,
      clicks: 2,
      messages_count: 1,
    });
    expect(meta.tipo).toBe("mensagens");
    expect(meta.linhas).toBe(1);
    expect(meta.ignoradas).toBe(0);
  });

  it("ignora colunas desconhecidas em vez de estourar", async () => {
    const file = planilha([{ "Message Id": "m1", "Coluna Que A Infobip Inventou": "x", Outra: 1 }]);
    const { rows } = await lerArquivoInfobip(file, EMPRESA);
    expect(rows).toHaveLength(1);
    expect(rows[0]).not.toHaveProperty("Coluna Que A Infobip Inventou");
  });

  it("guarda a linha crua em `raw` (auditoria do que veio)", async () => {
    const file = planilha([{ "Message Id": "m1", "Service Name": "WhatsApp" }]);
    const { rows } = await lerArquivoInfobip(file, EMPRESA);
    expect(rows[0].raw).toMatchObject({ "Message Id": "m1", "Service Name": "WhatsApp" });
  });

  it("descarta linha sem Message Id e a conta em `ignoradas`", async () => {
    const file = planilha([
      { "Message Id": "m1", "Service Name": "WhatsApp" },
      { "Message Id": null, "Service Name": "WhatsApp" },
      { "Message Id": "", "Service Name": "WhatsApp" },
    ]);
    const { rows, meta } = await lerArquivoInfobip(file, EMPRESA);
    // Sem message_id nao ha como deduplicar: a linha seria lixo permanente.
    expect(rows).toHaveLength(1);
    expect(meta.linhas).toBe(1);
    expect(meta.ignoradas).toBe(2);
  });

  it('troca service_name vazio por "-" para a dedup funcionar', async () => {
    // O indice unico e (message_id, service_name) e em Postgres NULL nao colide
    // com NULL: sem este fallback, reimportar o arquivo duplicaria as linhas.
    const file = planilha([
      { "Message Id": "m1", "Service Name": null },
      { "Message Id": "m2", "Service Name": "" },
    ]);
    const { rows } = await lerArquivoInfobip(file, EMPRESA);
    expect(rows.map((r) => r.service_name)).toEqual(["-", "-"]);
  });

  it('deduz tipo "billing" quando algum Service Name traz Monthly Active User', async () => {
    const file = planilha([
      { "Message Id": "m1", "Service Name": "WhatsApp" },
      { "Message Id": "m2", "Service Name": "WhatsApp Monthly Active User" },
    ]);
    const { meta } = await lerArquivoInfobip(file, EMPRESA);
    expect(meta.tipo).toBe("billing");
  });

  it("a deducao de billing nao depende de caixa", async () => {
    const file = planilha([{ "Message Id": "m1", "Service Name": "MONTHLY ACTIVE USER" }]);
    const { meta } = await lerArquivoInfobip(file, EMPRESA);
    expect(meta.tipo).toBe("billing");
  });

  it("calcula o periodo do menor ao maior send_at, fora de ordem no arquivo", async () => {
    const file = planilha([
      { "Message Id": "m1", "Send At": "22/07/2026 10:00:00" },
      { "Message Id": "m2", "Send At": "01/07/2026 10:00:00" },
      { "Message Id": "m3", "Send At": "15/07/2026 10:00:00" },
    ]);
    const { meta } = await lerArquivoInfobip(file, EMPRESA);
    expect(meta.periodo).toEqual({ inicio: "2026-07-01", fim: "2026-07-22" });
  });

  it("periodo fica nulo quando nenhuma linha tem Send At", async () => {
    const file = planilha([{ "Message Id": "m1" }]);
    const { meta } = await lerArquivoInfobip(file, EMPRESA);
    expect(meta.periodo).toEqual({ inicio: null, fim: null });
  });

  it('usa a aba "Data" quando existe, mesmo havendo outras', async () => {
    const ws1 = XLSX.utils.json_to_sheet([{ "Message Id": "de-outra-aba" }]);
    const ws2 = XLSX.utils.json_to_sheet([{ "Message Id": "da-aba-Data" }]);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws1, "Resumo");
    XLSX.utils.book_append_sheet(wb, ws2, "Data");
    const buf = XLSX.write(wb, { bookType: "xlsx", type: "array" }) as ArrayBuffer;
    const { rows } = await lerArquivoInfobip(new File([buf], "x.xlsx"), EMPRESA);
    expect(rows[0].message_id).toBe("da-aba-Data");
  });

  it('cai na primeira aba quando nao ha "Data"', async () => {
    const file = planilha([{ "Message Id": "m1" }], "Planilha1");
    const { rows } = await lerArquivoInfobip(file, EMPRESA);
    expect(rows[0].message_id).toBe("m1");
  });

  it("planilha sem nenhuma linha devolve resultado vazio, nao erro", async () => {
    const file = planilha([{ "Message Id": "m1" }]);
    const vazia = planilha([]);
    await expect(lerArquivoInfobip(file, EMPRESA)).resolves.toBeTruthy();
    const { rows, meta } = await lerArquivoInfobip(vazia, EMPRESA);
    expect(rows).toEqual([]);
    expect(meta.linhas).toBe(0);
  });

  it("tolera virgula decimal no preco", async () => {
    const file = planilha([{ "Message Id": "m1", "Purchase Price": "0,0345" }]);
    const { rows } = await lerArquivoInfobip(file, EMPRESA);
    expect(rows[0].price_raw).toBe(0.0345);
  });

  it("numero invalido vira null em vez de NaN", async () => {
    // NaN em JSON viraria `null` no wire de qualquer forma, mas passar NaN
    // adiante esconde o problema; o parser resolve na origem.
    const file = planilha([{ "Message Id": "m1", "Purchase Price": "gratis", Clicks: "" }]);
    const { rows } = await lerArquivoInfobip(file, EMPRESA);
    expect(rows[0].price_raw).toBeNull();
    expect(rows[0].clicks).toBeNull();
  });

  it("apara espaco no cabecalho e no valor", async () => {
    const file = planilha([{ "  Message Id  ": "  m1  ", "Service Name": "  WhatsApp  " }]);
    const { rows } = await lerArquivoInfobip(file, EMPRESA);
    expect(rows[0].message_id).toBe("m1");
    expect(rows[0].service_name).toBe("WhatsApp");
  });
});

describe("enviarLotes", () => {
  const linha = (i: number) => ({ message_id: `m${i}`, service_name: "WhatsApp" });

  it("nao chama o banco quando nao ha linha", async () => {
    expect(await enviarLotes([])).toEqual({ gravadas: 0 });
    expect(upsertMock).not.toHaveBeenCalled();
  });

  it("manda um unico lote quando cabe em 500", async () => {
    const rows = Array.from({ length: 500 }, (_, i) => linha(i));
    expect(await enviarLotes(rows)).toEqual({ gravadas: 500 });
    expect(upsertMock).toHaveBeenCalledTimes(1);
  });

  it("fatia em lotes de 500 e o ultimo lote leva o resto", async () => {
    const rows = Array.from({ length: 1201 }, (_, i) => linha(i));
    expect(await enviarLotes(rows)).toEqual({ gravadas: 1201 });
    expect(upsertMock).toHaveBeenCalledTimes(3);
    expect(upsertMock.mock.calls[0][0]).toHaveLength(500);
    expect(upsertMock.mock.calls[1][0]).toHaveLength(500);
    expect(upsertMock.mock.calls[2][0]).toHaveLength(201);
  });

  it("usa onConflict message_id,service_name (a garantia de idempotencia)", async () => {
    await enviarLotes([linha(1)]);
    expect(upsertMock.mock.calls[0][1]).toEqual({ onConflict: "message_id,service_name" });
  });

  it("propaga o erro do banco em vez de engolir", async () => {
    upsertMock.mockResolvedValueOnce({ error: { message: "violacao de constraint" } });
    await expect(enviarLotes([linha(1)])).rejects.toMatchObject({
      message: "violacao de constraint",
    });
  });

  it("DOCUMENTA: erro no meio aborta e as linhas ja gravadas NAO sao revertidas", async () => {
    // Nao ha transacao entre lotes. Com 1200 linhas e falha no 2o lote, as 500
    // primeiras ficam no banco. Nao e perda de dado (o upsert e idempotente:
    // reimportar completa o resto), mas o numero devolvido ao usuario nunca
    // chega - a funcao lanca. Quem chama precisa oferecer "reimportar".
    upsertMock
      .mockResolvedValueOnce({ error: null })
      .mockResolvedValueOnce({ error: { message: "timeout" } });
    const rows = Array.from({ length: 1200 }, (_, i) => linha(i));
    await expect(enviarLotes(rows)).rejects.toMatchObject({ message: "timeout" });
    expect(upsertMock).toHaveBeenCalledTimes(2); // parou no erro, nao seguiu para o 3o
  });
});
