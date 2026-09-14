import { describe, expect, it } from "vitest";
import {
  calcularBaseline,
  calcularTeto,
  nDiasPrazo,
  gastoNaJanela,
  sonhoAtingido,
  motivoParada,
  validarPedidoMissao,
  parsePlanoRitmo,
  atosDoPrimeiroPasse,
  decidirPortaoAto,
  unidadeSonho,
  extrairJsonRitmo,
  datasCivisInclusive,
  rotuloAcaoRitmo,
  montarAndamentoRitmo,
} from "./ritmo";

const serie = [
  { date: "2026-09-01", spend: 100 },
  { date: "2026-09-02", spend: 0 },
  { date: "2026-09-03", spend: 50 },
  { date: "2026-09-04", spend: 50 },
  { date: "2026-09-05", spend: 0 },
];

describe("nDiasPrazo", () => {
  it("conta inclusive", () => {
    expect(nDiasPrazo("2026-09-10", "2026-09-19")).toBe(10);
    expect(nDiasPrazo("2026-09-10", "2026-09-10")).toBe(1);
  });
});

describe("calcularBaseline", () => {
  it("ignora dias com gasto 0 e usa os 7 civis imediatamente antes do início", () => {
    const b = calcularBaseline(serie, "2026-09-06", "2026-09-06");
    expect(b.dias_usados).toBe(3);
    expect(b.gasto_diario).toBeCloseTo(200 / 3);
    expect(b.confianca).toBe("alta");
  });

  it("menos de 3 dias com gasto → confiança baixa", () => {
    const b = calcularBaseline(
      [{ date: "2026-09-04", spend: 80 }, { date: "2026-09-05", spend: 0 }],
      "2026-09-06",
      "2026-09-06",
    );
    expect(b.dias_usados).toBe(1);
    expect(b.confianca).toBe("baixa");
  });

  it("zero dias com gasto → baseline 0", () => {
    const b = calcularBaseline([{ date: "2026-09-05", spend: 0 }], "2026-09-06", "2026-09-06");
    expect(b.gasto_diario).toBe(0);
    expect(b.dias_usados).toBe(0);
    expect(b.confianca).toBe("baixa");
  });
});

describe("calcularTeto", () => {
  it("teto = baseline × dias + extra", () => {
    expect(calcularTeto(10, 7, 100)).toBe(170);
    expect(calcularTeto(0, 10, 50)).toBe(50);
    expect(calcularTeto(10, 7, 0)).toBe(70);
  });
});

describe("gastoNaJanela", () => {
  it("soma só a campanha na janela civil (fixture já é da campanha)", () => {
    expect(gastoNaJanela(serie, "2026-09-01", "2026-09-03")).toBe(150);
  });
});

describe("sonhoAtingido", () => {
  it("volume: acumulado desde max(início, concessão) ≥ sonho", () => {
    const dias = [
      { date: "2026-09-10", valor: 10 },
      { date: "2026-09-11", valor: 40 },
    ];
    expect(sonhoAtingido("conversas", 50, dias, "2026-09-10", "2026-09-10")).toBe(true);
    expect(sonhoAtingido("conversas", 51, dias, "2026-09-10", "2026-09-10")).toBe(false);
  });

  it("CTR: sem 3 dias com entrega não declara sonho", () => {
    const dias = [
      { date: "2026-09-10", valor: 2, impressoes: 100, cliques: 2 },
      { date: "2026-09-11", valor: 3, impressoes: 100, cliques: 3 },
    ];
    expect(sonhoAtingido("ctr", 2, dias, "2026-09-10", "2026-09-10")).toBe(false);
  });
});

describe("motivoParada", () => {
  it("prazo, teto, sonho e humano, nesta leitura pontual", () => {
    expect(
      motivoParada({
        hojeYmd: "2026-09-20",
        periodoFim: "2026-09-19",
        gastoJanela: 10,
        teto: 100,
        sonhoBateu: false,
        encerrarHumano: false,
        masterLigado: true,
      }),
    ).toBe("prazo");
    expect(
      motivoParada({
        hojeYmd: "2026-09-10",
        periodoFim: "2026-09-19",
        gastoJanela: 100,
        teto: 100,
        sonhoBateu: false,
        encerrarHumano: false,
        masterLigado: true,
      }),
    ).toBe("teto");
  });
});

describe("validarPedidoMissao", () => {
  it("recusa dissertação vazia, prazo > 90 dias e métrica desconhecida", () => {
    expect(
      validarPedidoMissao({
        campaignId: "1",
        periodoInicio: "2026-09-10",
        periodoFim: "2026-12-20",
        metrica: "conversas",
        dissertacao: "subir conversas",
      }).ok,
    ).toBe(false);
    expect(
      validarPedidoMissao({
        campaignId: "1",
        periodoInicio: "2026-09-10",
        periodoFim: "2026-09-12",
        metrica: "leads",
        dissertacao: "x",
      }).ok,
    ).toBe(false);
  });
});

describe("atosDoPrimeiroPasse", () => {
  it("só quando=imediato e no máximo uma ação significativa", () => {
    const atos = [
      { acao: "pausar_criativo", quando: "imediato", alvo_external_id: "a1" },
      { acao: "alterar_orcamento", quando: "imediato", alvo_external_id: "c1" },
      { acao: "criar_anuncio_a_partir_de", quando: "imediato", alvo_external_id: "x" },
      { acao: "pausar_conjunto", quando: "apos_janela", alvo_external_id: "s1" },
    ];
    const out = atosDoPrimeiroPasse(atos);
    expect(out.map((a) => a.acao)).toEqual(["pausar_criativo", "alterar_orcamento"]);
  });
});

describe("decidirPortaoAto", () => {
  const base = {
    status: "em_execucao" as const,
    companyIdMissao: "emp-a",
    companyIdAto: "emp-a",
    campaignIdMissao: "camp-1",
    campaignIdAto: "camp-1",
    hojeYmd: "2026-09-12",
    periodoInicio: "2026-09-10",
    periodoFim: "2026-09-20",
    gastoJanela: 50,
    teto: 200,
    masterLigado: true,
    concessaoEm: "2026-09-10T15:00:00Z",
    acao: "pausar_criativo",
  };
  it("nega campanha diferente, status errado, prazo vencido, teto, criar_campanha", () => {
    expect(decidirPortaoAto({ ...base, campaignIdAto: "outra" }).ok).toBe(false);
    expect(decidirPortaoAto({ ...base, status: "plano_pronto" }).ok).toBe(false);
    expect(decidirPortaoAto({ ...base, hojeYmd: "2026-09-21" }).ok).toBe(false);
    expect(decidirPortaoAto({ ...base, gastoJanela: 200, acao: "alterar_orcamento" }).ok).toBe(false);
    expect(decidirPortaoAto({ ...base, acao: "criar_campanha" }).ok).toBe(false);
  });
  it("libera pausa na campanha da missão dentro do prazo", () => {
    expect(decidirPortaoAto(base).ok).toBe(true);
  });
});

describe("parsePlanoRitmo", () => {
  it("ato sem external_id não é executável; recusa do Guardião derruba criar_anuncio", () => {
    const p = parsePlanoRitmo({
      baseline: { gasto_diario: 10, janela: "7d_com_gasto", dias_usados: 7, confianca: "alta" },
      teto_janela: 100,
      possibilidades: {
        nada_muda: { d3: 1, d7: 2, d15: 3, d30: 4 },
        plano: { d3: 2, d7: 4, d15: 6, d30: 8 },
        maximo_envelope: { d3: 3, d7: 6, d15: 9, d30: 12 },
      },
      atos: [
        { acao: "criar_anuncio_a_partir_de", alvo_external_id: "ad1", quando: "imediato" },
        { acao: "pausar_criativo", quando: "imediato" },
      ],
      recusas: ["Guardião recusou a copy da peça ad1"],
    });
    expect(p).not.toBeNull();
    expect(p!.atos[0].executavel).toBe(false);
    expect(p!.atos[1].executavel).toBe(false);
  });
});

describe("unidadeSonho", () => {
  it("CTR é percentual", () => {
    expect(unidadeSonho("ctr")).toBe("pct");
    expect(unidadeSonho("conversas")).toBe("qtd");
  });
});

describe("extrairJsonRitmo", () => {
  it("tira o json do meio da prosa", () => {
    expect(extrairJsonRitmo('foo {"a":1} bar')).toEqual({ a: 1 });
    expect(extrairJsonRitmo("sem json")).toBeNull();
  });
});

describe("datasCivisInclusive", () => {
  it("conta inclusive e recusa invertido", () => {
    expect(datasCivisInclusive("2026-09-12", "2026-09-14")).toEqual([
      "2026-09-12",
      "2026-09-13",
      "2026-09-14",
    ]);
    expect(datasCivisInclusive("2026-09-14", "2026-09-12")).toEqual([]);
  });
});

describe("montarAndamentoRitmo", () => {
  const base = {
    metrica: "conversas",
    sonho: 40,
    teto: 448.78,
    periodo_inicio: "2026-09-12",
    periodo_fim: "2026-09-14",
    corte: "2026-09-12",
    hoje: "2026-09-14",
    fechado: false,
    snaps: [
      {
        snapshot_date: "2026-09-12",
        spend: 63.06,
        messaging_started: 17,
        impressions: 1000,
        clicks: 40,
        link_clicks: 20,
      },
      {
        date: "2026-09-13",
        spend: 58,
        messaging_started: 10,
        impressions: 800,
        clicks: 30,
        link_clicks: 15,
      },
    ],
    atos: [
      {
        data: "2026-09-13",
        acao: "pausar_conjunto",
        alvo_external_id: "s1",
        resultado: "ok",
      },
    ],
  };

  it("abre um dia por data civil, soma conversas e agrupa atos", () => {
    const a = montarAndamentoRitmo(base);
    expect(a).not.toBeNull();
    expect(a!.dias.map((d) => d.data)).toEqual(["2026-09-12", "2026-09-13", "2026-09-14"]);
    expect(a!.dias[0].metrica_valor).toBe(17);
    expect(a!.dias[1].metrica_valor).toBe(10);
    expect(a!.dias[2].tem_coleta).toBe(false);
    expect(a!.metrica_janela).toBe(27);
    expect(a!.gasto_janela).toBeCloseTo(121.06);
    expect(a!.dias[1].atos).toHaveLength(1);
    expect(a!.dias[1].atos[0].acao).toBe("pausar_conjunto");
    expect(a!.dias[2].atos).toHaveLength(0);
  });

  it("hoje sem fechamento fica como andamento até agora; dia anterior fecha", () => {
    const a = montarAndamentoRitmo(base)!;
    expect(a.dias[0].fechado).toBe(true);
    expect(a.dias[2].fechado).toBe(false);
    expect(a.dias[0].narrativa).toMatch(/fechamento das 18:30/);
    expect(a.dias[2].narrativa).toMatch(/andamento até agora/);
    expect(a.dias[2].narrativa).toMatch(/não medidos/);
    expect(a.dias[0].narrativa).toMatch(/não escreveram na Meta/);
    expect(a.dias[1].narrativa).toMatch(/pausar conjunto s1 \(ok\)/);
  });

  it("CTR acumula taxa da janela, não soma percentuais", () => {
    const a = montarAndamentoRitmo({
      metrica: "ctr",
      periodo_inicio: "2026-09-12",
      periodo_fim: "2026-09-13",
      hoje: "2026-09-13",
      snaps: [
        { date: "2026-09-12", spend: 10, impressions: 100, clicks: 2 },
        { date: "2026-09-13", spend: 10, impressions: 100, clicks: 4 },
      ],
    });
    expect(a!.dias[0].metrica_valor).toBeCloseTo(2);
    expect(a!.dias[1].metrica_valor).toBeCloseTo(4);
    expect(a!.metrica_janela).toBeCloseTo(3);
    expect(a!.dias[1].custo).toBeNull();
  });

  it("recusa métrica desconhecida", () => {
    expect(montarAndamentoRitmo({ ...base, metrica: "leads" })).toBeNull();
    expect(montarAndamentoRitmo("oi")).toBeNull();
  });
});

describe("rotuloAcaoRitmo", () => {
  it("traduz o catálogo e não inventa vazio", () => {
    expect(rotuloAcaoRitmo("pausar_conjunto")).toBe("Pausar conjunto");
    expect(rotuloAcaoRitmo("")).toBe("");
    expect(rotuloAcaoRitmo("acao_nova")).toBe("acao nova");
  });
});
