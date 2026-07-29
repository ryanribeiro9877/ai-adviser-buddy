// Exportação rica do relatório (5 abas formatadas, métricas por FÓRMULA).
// Usa ExcelJS porque o SheetJS CE não escreve estilo; os exports de tabela simples
// seguem em SheetJS. Import dinâmico: a lib só é baixada quando alguém exporta.

export type SerieDia = {
  d: string;
  gasto: number;
  imp: number;
  clk: number;
  lclk: number;
  views: number;
  forms: number;
  conv: number;
};
export type Campanha = {
  nome: string;
  gasto: number;
  imp: number;
  lclk: number;
  views: number;
  forms: number;
  conv: number;
};
export type Anuncio = { nome: string; gasto: number; lclk: number; forms: number };
export type Tetos = Partial<{
  custo_por_formulario: number;
  custo_por_lead_lp: number;
  custo_por_conversa: number;
  custo_por_lead_dashboard: number;
}>;
export type DadosExport = {
  periodo: { inicio: string; fim: string; dias_com_dado: number; dias_no_periodo: number };
  serie_diaria: SerieDia[];
  por_campanha: Campanha[];
  top_anuncios: Anuncio[];
  tetos: Tetos;
  nao_disponivel: string[];
};

// Paleta e formatos do exemplar.
const AZUL = "FF1F3864";
const ZEBRA = "FFF2F6FA";
const CINZA = "FFBFBFBF";
const FONTE = "Arial";
const F_MOEDA = '"R$" #,##0.00';
const F_INT = "#,##0";
const F_PCT = "0.0%";
const F_DATA = "DD/MM/YYYY";

const ddmm = (iso: string) => iso.split("-").reverse().join("/");

/** Agrupa a série diária em semanas segunda→domingo. */
function porSemana(serie: SerieDia[]) {
  const sem = new Map<string, { inicio: string; fim: string } & Omit<SerieDia, "d">>();
  for (const d of serie) {
    const dt = new Date(`${d.d}T12:00:00Z`);
    const dow = dt.getUTCDay(); // 0=dom
    const seg = new Date(dt);
    seg.setUTCDate(dt.getUTCDate() - ((dow + 6) % 7));
    const dom = new Date(seg);
    dom.setUTCDate(seg.getUTCDate() + 6);
    const chave = seg.toISOString().slice(0, 10);
    const cur =
      sem.get(chave) ??
      ({
        inicio: chave,
        fim: dom.toISOString().slice(0, 10),
        gasto: 0,
        imp: 0,
        clk: 0,
        lclk: 0,
        views: 0,
        forms: 0,
        conv: 0,
      } as { inicio: string; fim: string } & Omit<SerieDia, "d">);
    cur.gasto += d.gasto;
    cur.imp += d.imp;
    cur.clk += d.clk;
    cur.lclk += d.lclk;
    cur.views += d.views;
    cur.forms += d.forms;
    cur.conv += d.conv;
    sem.set(chave, cur);
  }
  return [...sem.values()].sort((a, b) => a.inicio.localeCompare(b.inicio));
}

/** Nome do arquivo gerado (também usado no toast de sucesso). */
export function nomeArquivo(dados: DadosExport, empresa: string): string {
  const slug = empresa.replace(/[^\p{L}\p{N}]+/gu, "-").toLowerCase();
  return `relatorio_${slug}_${dados.periodo.inicio}_a_${dados.periodo.fim}.xlsx`;
}

/** Monta o workbook. Separado do download para poder ser verificado fora do browser. */
export async function montarWorkbook(dados: DadosExport, empresa: string) {
  const ExcelJS = (await import("exceljs")).default;
  const wb = new ExcelJS.Workbook();
  wb.creator = "Gestor de Tráfego IA";
  wb.created = new Date();

  const { periodo, serie_diaria: serie, por_campanha: camps, top_anuncios: ads, tetos } = dados;
  const cobertura = `${periodo.dias_com_dado} de ${periodo.dias_no_periodo} dias com dado`;

  // ---------- estilos utilitários ----------
  type Cell = {
    font?: unknown;
    fill?: unknown;
    border?: unknown;
    alignment?: unknown;
    numFmt?: string;
  };
  const borda = {
    top: { style: "thin" as const, color: { argb: CINZA } },
    left: { style: "thin" as const, color: { argb: CINZA } },
    bottom: { style: "thin" as const, color: { argb: CINZA } },
    right: { style: "thin" as const, color: { argb: CINZA } },
  };
  const titulo = (ws: import("exceljs").Worksheet, texto: string, span: number) => {
    const r = ws.addRow([texto]);
    r.font = { name: FONTE, size: 14, bold: true, color: { argb: AZUL } };
    ws.mergeCells(r.number, 1, r.number, span);
    return r;
  };
  const cabecalho = (ws: import("exceljs").Worksheet, cols: string[]) => {
    const r = ws.addRow(cols);
    r.eachCell((c: Cell) => {
      c.font = { name: FONTE, size: 10, bold: true, color: { argb: "FFFFFFFF" } };
      c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: AZUL } };
      c.border = borda;
      c.alignment = { vertical: "middle", wrapText: true };
    });
    r.height = 22;
    return r;
  };
  const zebrar = (ws: import("exceljs").Worksheet, primeira: number, ultima: number) => {
    for (let n = primeira; n <= ultima; n++) {
      const r = ws.getRow(n);
      r.eachCell((c: Cell) => {
        c.border = borda;
        if ((n - primeira) % 2 === 1) {
          c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: ZEBRA } };
        }
      });
    }
  };

  // As abas são criadas na ordem do exemplar, mas preenchidas em outra ordem:
  // a Série diária vem primeiro porque o Resumo referencia a linha TOTAL dela.
  const wsResumo = wb.addWorksheet("Resumo");
  const wsSem = wb.addWorksheet("Semana a semana");
  const wsSerie = wb.addWorksheet("Série diária");
  const wsCamp = wb.addWorksheet("Campanhas");
  const wsAds = wb.addWorksheet(`Anúncios (top ${ads.length})`);

  // ============ 1) Série diária (base das fórmulas do Resumo) ============
  titulo(wsSerie, "Série diária", 10);
  wsSerie.addRow([`${ddmm(periodo.inicio)} a ${ddmm(periodo.fim)} · ${cobertura}`]);
  wsSerie.addRow([]);
  const colsSerie = [
    "Dia",
    "Investimento",
    "Impressões",
    "Cliques",
    "Cliques no link",
    "Views da página",
    "Formulários",
    "Conversas",
    "Custo/form",
    "CTR",
  ];
  const hSerie = cabecalho(wsSerie, colsSerie);
  const primeiraSerie = hSerie.number + 1;
  for (const d of serie) {
    const n = wsSerie.rowCount + 1;
    wsSerie.addRow([
      new Date(`${d.d}T12:00:00Z`),
      d.gasto,
      d.imp,
      d.clk,
      d.lclk,
      d.views,
      d.forms,
      d.conv,
      // Derivadas por fórmula: mudar o gasto na planilha recalcula tudo.
      { formula: `IFERROR(B${n}/G${n},"-")` },
      { formula: `IFERROR(D${n}/C${n},"-")` },
    ]);
  }
  const ultimaSerie = wsSerie.rowCount;
  const linhaTotal = ultimaSerie + 1;
  wsSerie.addRow([
    "TOTAL",
    { formula: `SUM(B${primeiraSerie}:B${ultimaSerie})` },
    { formula: `SUM(C${primeiraSerie}:C${ultimaSerie})` },
    { formula: `SUM(D${primeiraSerie}:D${ultimaSerie})` },
    { formula: `SUM(E${primeiraSerie}:E${ultimaSerie})` },
    { formula: `SUM(F${primeiraSerie}:F${ultimaSerie})` },
    { formula: `SUM(G${primeiraSerie}:G${ultimaSerie})` },
    { formula: `SUM(H${primeiraSerie}:H${ultimaSerie})` },
    { formula: `IFERROR(B${linhaTotal}/G${linhaTotal},"-")` },
    { formula: `IFERROR(D${linhaTotal}/C${linhaTotal},"-")` },
  ]);
  zebrar(wsSerie, primeiraSerie, ultimaSerie);
  const rTotal = wsSerie.getRow(linhaTotal);
  rTotal.font = { name: FONTE, size: 10, bold: true };
  rTotal.eachCell((c: Cell) => {
    c.border = borda;
    c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFE2E9F3" } };
  });
  wsSerie.getColumn(1).numFmt = F_DATA;
  wsSerie.getColumn(2).numFmt = F_MOEDA;
  [3, 4, 5, 6, 7, 8].forEach((i) => (wsSerie.getColumn(i).numFmt = F_INT));
  wsSerie.getColumn(9).numFmt = F_MOEDA;
  wsSerie.getColumn(10).numFmt = F_PCT;
  wsSerie.columns.forEach((c, i) => (c.width = i === 0 ? 13 : 15));

  // ============ 2) Resumo (referencia a linha TOTAL da Série diária) ============
  titulo(wsResumo, `Relatório de tráfego — ${empresa}`, 5);
  wsResumo.addRow([
    `Período: ${ddmm(periodo.inicio)} a ${ddmm(periodo.fim)} · ${cobertura}${
      periodo.dias_com_dado < periodo.dias_no_periodo ? " · ATENÇÃO: cobertura incompleta" : ""
    }`,
  ]);
  wsResumo.addRow([]);
  const T = `'Série diária'!`; // referência entre abas
  const hResumo = cabecalho(wsResumo, ["Indicador", "Valor", "Teto", "Status", "Formato"]);
  const primeiraResumo = hResumo.number + 1;

  // Valor sempre por referência/fórmula — nada calculado em JS. Só recebem teto
  // os indicadores que têm teto equivalente em `targets` (form e conversa).
  const ind: {
    nome: string;
    formula: string;
    fmt: string;
    teto?: number;
  }[] = [
    { nome: "Investimento", formula: `${T}B${linhaTotal}`, fmt: F_MOEDA },
    { nome: "Impressões", formula: `${T}C${linhaTotal}`, fmt: F_INT },
    { nome: "Cliques", formula: `${T}D${linhaTotal}`, fmt: F_INT },
    { nome: "Cliques no link", formula: `${T}E${linhaTotal}`, fmt: F_INT },
    { nome: "Views da página", formula: `${T}F${linhaTotal}`, fmt: F_INT },
    { nome: "Formulários", formula: `${T}G${linhaTotal}`, fmt: F_INT },
    { nome: "Conversas (WhatsApp)", formula: `${T}H${linhaTotal}`, fmt: F_INT },
    {
      nome: "Custo por formulário",
      formula: `IFERROR(${T}B${linhaTotal}/${T}G${linhaTotal},"-")`,
      fmt: F_MOEDA,
      teto: tetos.custo_por_formulario,
    },
    {
      nome: "Custo por clique no link",
      formula: `IFERROR(${T}B${linhaTotal}/${T}E${linhaTotal},"-")`,
      fmt: F_MOEDA,
    },
    {
      // Sem teto aqui de propósito: no total, o investimento das campanhas de LP
      // entra no divisor e o número fica alto por construção. O teto de conversa
      // (R$ 1,55) só faz sentido por campanha — está na aba "Campanhas".
      nome: "Custo por conversa (total ÷ conversas)",
      formula: `IFERROR(${T}B${linhaTotal}/${T}H${linhaTotal},"-")`,
      fmt: F_MOEDA,
    },
    { nome: "CTR", formula: `IFERROR(${T}D${linhaTotal}/${T}C${linhaTotal},"-")`, fmt: F_PCT },
    {
      nome: "Conversão (view → formulário)",
      formula: `IFERROR(${T}G${linhaTotal}/${T}F${linhaTotal},"-")`,
      fmt: F_PCT,
    },
  ];

  for (const i of ind) {
    const n = wsResumo.rowCount + 1;
    wsResumo.addRow([
      i.nome,
      { formula: i.formula },
      i.teto ?? "—",
      i.teto ? { formula: `IF(B${n}<=C${n},"Dentro do teto","ACIMA do teto")` } : "—",
      i.fmt === F_MOEDA ? "R$" : i.fmt === F_PCT ? "%" : "nº",
    ]);
    const row = wsResumo.getRow(n);
    row.getCell(2).numFmt = i.fmt;
    if (i.teto) row.getCell(3).numFmt = F_MOEDA;
  }
  const ultimaResumo = wsResumo.rowCount;
  zebrar(wsResumo, primeiraResumo, ultimaResumo);

  // Rodapé: notas + o que a RPC declarou como indisponível (nunca omitido).
  wsResumo.addRow([]);
  const notas = wsResumo.addRow(["Notas"]);
  notas.font = { name: FONTE, size: 10, bold: true, color: { argb: AZUL } };
  wsResumo.addRow([
    "Os valores vêm da aba “Série diária”; as métricas derivadas são fórmulas — alterar um gasto lá recalcula aqui.",
  ]);
  wsResumo.addRow([
    "LP gera formulário; WPP/CTWA gera conversa. Compare cada campanha pela métrica do seu objetivo.",
  ]);
  if (periodo.dias_com_dado < periodo.dias_no_periodo) {
    wsResumo.addRow([
      `Cobertura incompleta: ${cobertura}. Não conclua queda de desempenho sem checar a coleta.`,
    ]);
  }
  for (const n of dados.nao_disponivel ?? []) wsResumo.addRow([`Não disponível — ${n}`]);
  wsResumo.columns.forEach((c, i) => (c.width = i === 0 ? 34 : i === 1 ? 16 : 14));

  // ============ 3) Semana a semana ============
  titulo(wsSem, "Semana a semana", 9);
  wsSem.addRow(["Semanas de segunda a domingo."]);
  wsSem.addRow([]);
  const hSem = cabecalho(wsSem, [
    "Semana",
    "Investimento",
    "Impressões",
    "Cliques no link",
    "Views",
    "Formulários",
    "Conversas",
    "Custo/form",
    "Conversão",
  ]);
  const primeiraSem = hSem.number + 1;
  for (const s of porSemana(serie)) {
    const n = wsSem.rowCount + 1;
    wsSem.addRow([
      `${ddmm(s.inicio)} a ${ddmm(s.fim)}`,
      s.gasto,
      s.imp,
      s.lclk,
      s.views,
      s.forms,
      s.conv,
      { formula: `IFERROR(B${n}/F${n},"-")` },
      { formula: `IFERROR(F${n}/E${n},"-")` },
    ]);
  }
  const ultimaSem = wsSem.rowCount;
  zebrar(wsSem, primeiraSem, ultimaSem);
  wsSem.getColumn(2).numFmt = F_MOEDA;
  [3, 4, 5, 6, 7].forEach((i) => (wsSem.getColumn(i).numFmt = F_INT));
  wsSem.getColumn(8).numFmt = F_MOEDA;
  wsSem.getColumn(9).numFmt = F_PCT;
  wsSem.columns.forEach((c, i) => (c.width = i === 0 ? 22 : 15));

  // ============ 4) Campanhas ============
  titulo(wsCamp, "Campanhas", 9);
  const tetosCamp = [
    tetos.custo_por_formulario ? `teto de formulário R$ ${tetos.custo_por_formulario}` : null,
    tetos.custo_por_conversa ? `teto de conversa R$ ${tetos.custo_por_conversa}` : null,
  ]
    .filter(Boolean)
    .join(" · ");
  wsCamp.addRow([
    `LP gera formulário; WPP/CTWA gera conversa — compare pela métrica do objetivo.${
      tetosCamp ? ` (${tetosCamp})` : ""
    }`,
  ]);
  wsCamp.addRow([]);
  const hCamp = cabecalho(wsCamp, [
    "Campanha",
    "Investimento",
    "Impressões",
    "Cliques no link",
    "Views",
    "Formulários",
    "Conversas",
    "Custo/form",
    "Custo/conversa",
  ]);
  const primeiraCamp = hCamp.number + 1;
  for (const c of [...camps].sort((a, b) => b.gasto - a.gasto)) {
    const n = wsCamp.rowCount + 1;
    wsCamp.addRow([
      c.nome,
      c.gasto,
      c.imp,
      c.lclk,
      c.views,
      c.forms,
      c.conv,
      // IF(=0,"-") em vez de divisão: campanha de WhatsApp não tem custo/form.
      { formula: `IF(F${n}=0,"-",B${n}/F${n})` },
      { formula: `IF(G${n}=0,"-",B${n}/G${n})` },
    ]);
  }
  const ultimaCamp = wsCamp.rowCount;
  zebrar(wsCamp, primeiraCamp, ultimaCamp);
  wsCamp.getColumn(2).numFmt = F_MOEDA;
  [3, 4, 5, 6, 7].forEach((i) => (wsCamp.getColumn(i).numFmt = F_INT));
  wsCamp.getColumn(8).numFmt = F_MOEDA;
  wsCamp.getColumn(9).numFmt = F_MOEDA;
  wsCamp.columns.forEach((c, i) => (c.width = i === 0 ? 48 : 15));

  // ============ 5) Anúncios (top 15) ============
  titulo(wsAds, `Anúncios — top ${ads.length} por investimento`, 6);
  wsAds.addRow(["O nome completo carrega a história do criativo (refresh, escala, variação)."]);
  wsAds.addRow([]);
  const tetoForm = tetos.custo_por_formulario;
  const hAds = cabecalho(wsAds, [
    "Anúncio",
    "Investimento",
    "Cliques no link",
    "Formulários",
    "Custo/form",
    tetoForm ? "Status (teto)" : "Status",
  ]);
  const primeiraAds = hAds.number + 1;
  for (const a of ads) {
    const n = wsAds.rowCount + 1;
    wsAds.addRow([
      a.nome,
      a.gasto,
      a.lclk,
      a.forms,
      { formula: `IF(D${n}=0,"-",B${n}/D${n})` },
      tetoForm
        ? {
            formula: `IF(D${n}=0,"sem formulário",IF(B${n}/D${n}<=${tetoForm},"Dentro do teto","ACIMA do teto"))`,
          }
        : "—",
    ]);
  }
  const ultimaAds = wsAds.rowCount;
  zebrar(wsAds, primeiraAds, ultimaAds);
  wsAds.getColumn(2).numFmt = F_MOEDA;
  wsAds.getColumn(3).numFmt = F_INT;
  wsAds.getColumn(4).numFmt = F_INT;
  wsAds.getColumn(5).numFmt = F_MOEDA;
  wsAds.columns.forEach((c, i) => (c.width = i === 0 ? 58 : 16));

  // Fonte padrão Arial 10 em tudo que não recebeu estilo próprio.
  for (const ws of wb.worksheets) {
    ws.eachRow((row) => {
      row.eachCell((cell: Cell & { font?: { size?: number } }) => {
        if (!cell.font || cell.font.size !== 14) {
          // Mantém bold/cor já aplicados; força só família e corpo.
          const atual = (cell.font ?? {}) as Record<string, unknown>;
          cell.font = { ...atual, name: FONTE, size: 10 } as never;
        }
      });
    });
    ws.views = [{ state: "frozen", ySplit: 4 }];
  }

  return wb;
}

export async function exportarRelatorioRico(dados: DadosExport, empresa: string): Promise<string> {
  const wb = await montarWorkbook(dados, empresa);
  const nome = nomeArquivo(dados, empresa);
  const buf = await wb.xlsx.writeBuffer();
  const url = URL.createObjectURL(
    new Blob([buf], {
      type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    }),
  );
  const a = document.createElement("a");
  a.href = url;
  a.download = nome;
  a.click();
  URL.revokeObjectURL(url);
  return nome;
}
