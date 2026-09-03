import { describe, it, expect } from "vitest";
import {
  num,
  tipoLabel,
  resultForCampaign,
  fmtBRL,
  fmtInt,
  fmtPct,
  fmtDec,
  fmtBudget,
  summarizeTargeting,
  metaStatus,
  TIPO_META,
  TIPO_ORDER,
  type CampaignRow,
  type TipoConta,
  type Targeting,
} from "./breakdown";

// Este modulo traduz o que vem das views PostgREST e do jsonb de targeting do
// Meta para o que o gestor le na tela. Erro aqui nao derruba nada - mostra um
// numero errado, que e pior, porque decisao de orcamento sai desse numero.

// O pt-BR usa ESPACO NAO-QUEBRAVEL (U+00A0) entre "R$" e o valor. Escrever " "
// comum aqui faz o teste falhar por um motivo invisivel no diff.
const NB = " ";

describe("num — coercao das views PostgREST", () => {
  it("converte numeric/bigint que vem como STRING", () => {
    // A razao de num() existir: PostgREST serializa numeric e bigint como
    // string, e somar isso direto concatenaria em vez de somar.
    expect(num("12.5")).toBe(12.5);
    expect(num("0")).toBe(0);
    expect(num("1e3")).toBe(1000);
  });

  it("passa number adiante intacto", () => {
    expect(num(12.5)).toBe(12.5);
    expect(num(0)).toBe(0);
    expect(num(-3)).toBe(-3);
  });

  it("vira 0 para ausencia e lixo, nunca NaN", () => {
    // NaN vazaria para a tela como "—" ou pior, contaminaria uma soma inteira.
    for (const v of [null, undefined, "", "abc", {}, [], true, NaN, Infinity, -Infinity]) {
      expect(num(v)).toBe(0);
    }
  });

  it("DOCUMENTA: parseFloat corta na virgula — '12,5' vira 12, nao 12.5", () => {
    // Hoje inofensivo: PostgREST devolve ponto decimal. Viraria perda silenciosa
    // de casa decimal se algum dia entrar dado com virgula por aqui.
    expect(num("12,5")).toBe(12);
  });

  it("DOCUMENTA: parseFloat aceita lixo no fim — '12abc' vira 12", () => {
    expect(num("12abc")).toBe(12);
    expect(num("  7  ")).toBe(7);
  });
});

describe("formatadores pt-BR", () => {
  it("fmtBRL usa simbolo, milhar com ponto e 2 casas com virgula", () => {
    expect(fmtBRL(1234.5)).toBe(`R$${NB}1.234,50`);
    expect(fmtBRL(0)).toBe(`R$${NB}0,00`);
    expect(fmtBRL(1_000_000)).toBe(`R$${NB}1.000.000,00`);
  });

  it("fmtBRL formata negativo com o sinal antes do simbolo", () => {
    expect(fmtBRL(-50)).toBe(`-R$${NB}50,00`);
  });

  it("fmtBRL arredonda para 2 casas", () => {
    expect(fmtBRL(0.005)).toBe(`R$${NB}0,01`);
    expect(fmtBRL(0.004)).toBe(`R$${NB}0,00`);
  });

  it("fmtInt arredonda e separa milhar", () => {
    expect(fmtInt(1234567)).toBe("1.234.567");
    expect(fmtInt(0)).toBe("0");
    expect(fmtInt(2.6)).toBe("3");
  });

  it("DOCUMENTA: fmtInt de negativo pequeno exibe '-0'", () => {
    // Math.round(-0.4) e -0 em JS, e o toLocaleString preserva o sinal. So
    // aparece se alguma view devolver metrica levemente negativa.
    expect(fmtInt(-0.4)).toBe("-0");
  });

  it("fmtPct sempre com 2 casas e sufixo", () => {
    expect(fmtPct(12.3456)).toBe("12.35%");
    expect(fmtPct(0)).toBe("0.00%");
  });

  it("fmtDec respeita a casa pedida", () => {
    expect(fmtDec(3.14159)).toBe("3.14");
    expect(fmtDec(3.14159, 4)).toBe("3.1416");
    expect(fmtDec(3.14159, 0)).toBe("3");
  });

  it.each([
    ["fmtBRL", fmtBRL],
    ["fmtInt", fmtInt],
    ["fmtPct", fmtPct],
    ["fmtDec", fmtDec],
  ])("%s mostra travessao em vez de estourar com nulo/NaN/Infinity", (_nome, fn) => {
    // As views devolvem NULL em metrica derivada sem denominador (custo sem
    // conversao, CTR sem impressao). Um numero faltando nao pode derrubar a tela.
    for (const v of [null, undefined, NaN, Infinity, -Infinity]) {
      expect(fn(v as number)).toBe("—");
    }
  });
});

describe("fmtBudget — orcamento do Meta vem em CENTAVOS", () => {
  it("converte centavos para reais", () => {
    expect(fmtBudget(5000)).toBe(`R$${NB}50,00`);
    expect(fmtBudget(1)).toBe(`R$${NB}0,01`);
  });

  it("0 e null viram travessao (sem orcamento no conjunto, provavel CBO)", () => {
    // Distincao que importa na tela: "R$ 0,00" sugeriria orcamento zerado; o
    // travessao diz que o orcamento esta na campanha, nao no conjunto.
    expect(fmtBudget(0)).toBe("—");
    expect(fmtBudget(null)).toBe("—");
  });
});

describe("metaStatus — effective_status do Meta em pt-BR", () => {
  it.each([
    ["ACTIVE", "Ativo", "default"],
    ["PAUSED", "Pausado", "secondary"],
    ["ADSET_PAUSED", "Conjunto pausado", "secondary"],
    ["CAMPAIGN_PAUSED", "Campanha pausada", "secondary"],
    ["WITH_ISSUES", "Com problemas", "destructive"],
    ["DISAPPROVED", "Reprovado", "destructive"],
    ["PENDING_REVIEW", "Em revisão", "outline"],
    ["ARCHIVED", "Arquivado", "secondary"],
  ])("%s -> %s", (bruto, label, variant) => {
    expect(metaStatus(bruto)).toEqual({ label, variant });
  });

  it("nao diferencia caixa", () => {
    expect(metaStatus("active").label).toBe("Ativo");
    expect(metaStatus("Paused").label).toBe("Pausado");
  });

  it("status novo do Meta aparece cru, em vez de sumir", () => {
    // Preferivel mostrar "ALGO_NOVO" a esconder: o gestor ve que ha um estado
    // que a tela ainda nao traduz.
    expect(metaStatus("ALGO_NOVO")).toEqual({ label: "ALGO_NOVO", variant: "outline" });
  });

  it("vazio vira travessao", () => {
    expect(metaStatus("")).toEqual({ label: "—", variant: "outline" });
  });

  it("os dois status reprovaveis usam a variante destrutiva", () => {
    expect(metaStatus("WITH_ISSUES").variant).toBe("destructive");
    expect(metaStatus("DISAPPROVED").variant).toBe("destructive");
  });
});

describe("TIPO_META / TIPO_ORDER / tipoLabel", () => {
  it("todo tipo da ordem canonica tem apresentacao definida", () => {
    for (const t of TIPO_ORDER) expect(TIPO_META[t]).toBeDefined();
  });

  it("toda cor e um hex valido (vai para grafico)", () => {
    for (const meta of Object.values(TIPO_META)) expect(meta.color).toMatch(/^#[0-9a-f]{6}$/i);
  });

  it("TIPO_ORDER omite sem_dados de proposito, mas TIPO_META o define", () => {
    // sem_dados nao e um tipo escolhivel: e a ausencia. Nao vira chip, mas
    // precisa de rotulo quando aparece numa linha.
    expect(TIPO_ORDER).not.toContain("sem_dados");
    expect(TIPO_META.sem_dados.label).toBe("Sem dados");
  });

  it("nao ha tipo definido fora da ordem alem de sem_dados", () => {
    const faltando = Object.keys(TIPO_META).filter(
      (t) => t !== "sem_dados" && !TIPO_ORDER.includes(t as TipoConta),
    );
    expect(faltando).toEqual([]);
  });

  it("tipoLabel traduz o conhecido e devolve o desconhecido cru", () => {
    expect(tipoLabel("leadgen")).toBe("Leadgen");
    expect(tipoLabel("video")).toBe("Vídeo");
    expect(tipoLabel("tipo_inventado")).toBe("tipo_inventado");
  });
});

// --- resultForCampaign ---------------------------------------------------------

function campanha(over: Partial<CampaignRow> = {}): CampaignRow {
  return {
    company_id: "c",
    empresa: "Empresa",
    account_id: "act_1",
    account_name: "Conta",
    campaign_id: "cmp_1",
    campanha: "Campanha",
    objective: null,
    tipo: "outro",
    status: "ACTIVE",
    spend: 0,
    impressions: 0,
    reach: 0,
    frequency: 0,
    clicks: 0,
    link_clicks: 0,
    landing_page_views: 0,
    messaging_started: 0,
    form_leads: 0,
    sales: 0,
    revenue: 0,
    base_de_resultado: "formularios",
    rotulo_do_custo: "por formulario enviado",
    unidade_do_resultado: "formularios",
    resultados: 0,
    custo_por_resultado: null,
    cpc_link: null,
    last_synced_at: null,
    ...over,
  };
}

describe("resultForCampaign — a metrica que a BASE declarada manda", () => {
  it("formularios: mostra o rotulo da base, nao 'CPL'", () => {
    const r = resultForCampaign(
      campanha({ base_de_resultado: "formularios", resultados: 20, custo_por_resultado: 15, spend: 300 }),
    );
    expect(r).toMatchObject({
      label: "Formulários",
      value: "20",
      costLabel: "Custo por formulario enviado",
    });
    expect(r.costValue).toBe(`R$${NB}15,00`);
  });

  it("conversas: custo por conversa iniciada", () => {
    const r = resultForCampaign(
      campanha({
        base_de_resultado: "conversas",
        rotulo_do_custo: "por conversa iniciada",
        resultados: 50,
        custo_por_resultado: 5,
        spend: 250,
      }),
    );
    expect(r).toMatchObject({ label: "Conversas", value: "50", costLabel: "Custo por conversa iniciada" });
    expect(r.costValue).toBe(`R$${NB}5,00`);
  });

  it("cliques no link: a base que faltava, e que o tipo NULL mandava para formulario", () => {
    // Campanha de impulsionamento de post nao produz formulario. Antes, o tipo null caia no
    // default "Leads" e o gasto dela entrava num custo por formulario que ela nunca gerou —
    // o erro de 5,4x. Agora a base vem do banco e o rotulo diz o que esta sendo medido.
    const r = resultForCampaign(
      campanha({
        tipo: "outro",
        base_de_resultado: "cliques_no_link",
        rotulo_do_custo: "por clique no link",
        resultados: 200,
        custo_por_resultado: 0.5,
        spend: 100,
      }),
    );
    expect(r).toMatchObject({ label: "Cliques no link", value: "200" });
    expect(r.costValue).toBe(`R$${NB}0,50`);
  });

  it("com receita: ROAS vence a base, porque ROAS nao e custo por resultado", () => {
    const r = resultForCampaign(campanha({ sales: 10, revenue: 5000, spend: 1000 }));
    expect(r.label).toBe("Vendas / Receita");
    expect(r.value).toBe(`10 · R$${NB}5.000,00`);
    expect(r.costLabel).toBe("ROAS");
    expect(r.costValue).toBe("5.00x");
  });

  it("receita com gasto ZERO nao divide por zero", () => {
    const r = resultForCampaign(campanha({ sales: 1, revenue: 500, spend: 0 }));
    expect(r.costValue).toBe("500.00x");
  });

  it("custo ausente cai para o calculo local, em vez de sumir com o numero", () => {
    const r = resultForCampaign(
      campanha({ base_de_resultado: "conversas", resultados: 4, custo_por_resultado: null, spend: 100 }),
    );
    expect(r.costValue).toBe(`R$${NB}25,00`);
  });

  it.each([
    ["formularios", "por formulario enviado"],
    ["conversas", "por conversa iniciada"],
    ["cliques_no_link", "por clique no link"],
  ])("base %s com ZERO resultado mostra travessao, nunca R$ 0,00", (base, rotulo) => {
    // Zero resultado e custo INDEFINIDO. "R$ 0,00 por lead" leria como "sai de graca" e o
    // gestor escalaria a campanha mais cara da carteira achando que e a mais barata.
    const r = resultForCampaign(
      campanha({
        base_de_resultado: base as CampaignRow["base_de_resultado"],
        rotulo_do_custo: rotulo,
        resultados: 0,
        custo_por_resultado: null,
        spend: 100,
      }),
    );
    expect(r.costValue).toBe("—");
    expect(r.value).toBe("0");
  });
});

// --- summarizeTargeting --------------------------------------------------------

describe("summarizeTargeting — jsonb do Meta em chips legiveis", () => {
  it("targeting nulo devolve vazio, sem Advantage+", () => {
    expect(summarizeTargeting(null)).toEqual({ chips: [], advantagePlus: false });
  });

  it("faixa etaria com minimo e maximo", () => {
    const { chips } = summarizeTargeting({ age_min: 25, age_max: 45 });
    expect(chips).toContain("25–45 anos");
  });

  it("so idade minima vira faixa aberta", () => {
    const { chips } = summarizeTargeting({ age_min: 18 });
    expect(chips).toContain("18+ anos");
  });

  it.each([
    [[1], "Homens"],
    [[2], "Mulheres"],
  ])("genero %j -> %s", (genders, esperado) => {
    expect(summarizeTargeting({ genders }).chips).toContain(esperado);
  });

  it.each([
    ["ausente", undefined],
    ["ambos", [1, 2]],
    ["lista vazia", []],
  ])("genero %s -> Todos os generos", (_caso, genders) => {
    expect(summarizeTargeting({ genders } as Targeting).chips).toContain("Todos os gêneros");
  });

  it("traduz BR para Brasil e mantem os demais paises", () => {
    const { chips } = summarizeTargeting({ geo_locations: { countries: ["BR", "PT"] } });
    expect(chips).toContain("Brasil, PT");
  });

  it("junta pais, regiao e cidade com separador", () => {
    const { chips } = summarizeTargeting({
      geo_locations: {
        countries: ["BR"],
        regions: [{ name: "Minas Gerais" }],
        cities: [{ name: "Belo Horizonte" }, { name: "Contagem" }],
      },
    });
    expect(chips).toContain("Brasil · Minas Gerais · Belo Horizonte, Contagem");
  });

  it("geo sem nenhuma parte util nao gera chip vazio", () => {
    const { chips } = summarizeTargeting({ geo_locations: { countries: [] } });
    expect(chips).not.toContain("");
  });

  it("regiao/cidade sem nome sao descartadas", () => {
    const { chips } = summarizeTargeting({
      geo_locations: { countries: ["BR"], regions: [{}, { name: "Bahia" }] },
    });
    expect(chips).toContain("Brasil · Bahia");
  });

  it("traduz as plataformas conhecidas e passa a desconhecida crua", () => {
    const { chips } = summarizeTargeting({
      publisher_platforms: ["facebook", "instagram", "threads", "plataforma_nova"],
    });
    expect(chips).toContain("Facebook, Instagram, Threads, plataforma_nova");
  });

  it("lista interesses do flexible_spec", () => {
    const { chips } = summarizeTargeting({
      flexible_spec: [{ interests: [{ name: "Direito" }, { name: "Advocacia" }] }],
    });
    expect(chips).toContain("Interesses: Direito, Advocacia");
  });

  it("corta em 4 interesses e sinaliza com reticencia", () => {
    const { chips } = summarizeTargeting({
      flexible_spec: [
        { interests: [{ name: "a" }, { name: "b" }, { name: "c" }, { name: "d" }, { name: "e" }] },
      ],
    });
    expect(chips).toContain("Interesses: a, b, c, d…");
  });

  it("junta interesses de varios blocos de flexible_spec", () => {
    const { chips } = summarizeTargeting({
      flexible_spec: [{ interests: [{ name: "a" }] }, { interests: [{ name: "b" }] }],
    });
    expect(chips).toContain("Interesses: a, b");
  });

  it("sinaliza publico personalizado sem expor quais", () => {
    const { chips } = summarizeTargeting({ custom_audiences: [{ id: "1" }] });
    expect(chips).toContain("Público personalizado");
  });

  it("custom_audiences vazio nao gera chip", () => {
    const { chips } = summarizeTargeting({ custom_audiences: [] });
    expect(chips).not.toContain("Público personalizado");
  });

  it("advantagePlus liga quando ha targeting_automation", () => {
    expect(
      summarizeTargeting({ targeting_automation: { advantage_audience: 1 } }).advantagePlus,
    ).toBe(true);
    expect(summarizeTargeting({ targeting_automation: null }).advantagePlus).toBe(false);
    expect(summarizeTargeting({}).advantagePlus).toBe(false);
  });

  it("targeting completo produz os chips na ordem esperada", () => {
    const { chips, advantagePlus } = summarizeTargeting({
      age_min: 25,
      age_max: 54,
      genders: [2],
      geo_locations: { countries: ["BR"], cities: [{ name: "Belo Horizonte" }] },
      publisher_platforms: ["facebook", "instagram"],
      flexible_spec: [{ interests: [{ name: "Direito" }] }],
      custom_audiences: [{ id: "x" }],
      targeting_automation: {},
    });
    expect(chips).toEqual([
      "25–54 anos",
      "Mulheres",
      "Brasil · Belo Horizonte",
      "Facebook, Instagram",
      "Interesses: Direito",
      "Público personalizado",
    ]);
    expect(advantagePlus).toBe(true);
  });

  it("campos com tipo inesperado nao derrubam a funcao", () => {
    // O jsonb vem do Meta: assumir formato e como a tela quebra.
    const lixo = {
      genders: "masculino",
      geo_locations: { countries: "BR", regions: null },
      publisher_platforms: {},
      flexible_spec: "nada",
      custom_audiences: "varios",
    } as unknown as Targeting;
    expect(() => summarizeTargeting(lixo)).not.toThrow();
  });
});
