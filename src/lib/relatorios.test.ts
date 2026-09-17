import { describe, expect, it } from "vitest";
import {
  campanhaEstaAtiva,
  campanhaEhCascaMeta,
  filtrarCampanhasAtivasDoRecorte,
  CHAVES_SECAO_RELATORIO,
  especialistasPorSecoes,
  extrairJsonRelatorio,
  flattenCampanhasPipeboard,
  humanizarMarkdownRelatorio,
  filtrarConjuntosDoRecorte,
  injetarRankingCampanhasNoMarkdown,
  injetarRankingConjuntosNoMarkdown,
  janelaAnteriorDoPeriodo,
  mergeCampanhasRelatorio,
  normalizarAchados,
  ordenarCampanhasRelatorioPorGasto,
  periodoDaJanela,
  rankingCampanhasRelatorio,
  rankingConjuntosRelatorio,
  recortarAlertasDoRecorte,
  presetDiarioOperacional,
  proximaExecucaoRelatorio,
  titulosDasSecoes,
  validarSecoesRelatorio,
  type CampanhaRelatorio,
} from "./relatorios";

// O horário do relatório é a promessa que o gestor lê na tela. Errar o fuso
// (UTC em vez de Brasília) faz a cron rodar 3h cedo; aceitar seção inventada
// manda o job analisar coisa que o catálogo não cobre. Os dois são silenciosos.

describe("validarSecoesRelatorio", () => {
  it("recusa lista vazia e chave desconhecida", () => {
    expect(validarSecoesRelatorio([]).ok).toBe(false);
    const r = validarSecoesRelatorio(["resumo_executivo", "nao_existe"]);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.invalidas).toEqual(["nao_existe"]);
  });

  it("aceita o catálogo inteiro e deduplica", () => {
    const r = validarSecoesRelatorio([...CHAVES_SECAO_RELATORIO, "resumo_executivo"]);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.secoes).toEqual([...CHAVES_SECAO_RELATORIO]);
  });
});

describe("especialistasPorSecoes", () => {
  it("liga desempenho para custo e criativos para ranking", () => {
    const e = especialistasPorSecoes(["custo_vs_teto", "criativos_ranking"]);
    expect(e).toContain("desempenho_campanhas");
    expect(e).toContain("criativos");
  });
});

describe("humanizarMarkdownRelatorio", () => {
  it("troca a chave da seção pelo título que o gestor lê", () => {
    const md = humanizarMarkdownRelatorio("## resumo_executivo\nJanela fechada.\n## criativos_ranking\n- peça\n## conjuntos_ranking\n- conjunto");
    expect(md).toContain("## Resumo executivo");
    expect(md).toContain("## Ranking de criativos");
    expect(md).toContain("## Ranking de conjuntos");
    expect(md).not.toMatch(/^## resumo_executivo/m);
  });

  it("não duplica título humano já escrito (Fadiga de criativo de criativo)", () => {
    const md = humanizarMarkdownRelatorio(
      "## Fadiga de criativo\nFrequência 1,1.\n## Alertas ativos\nUm alerta.\n## WhatsApp / WABA\nDestino WhatsApp.",
    );
    expect(md).toContain("## Fadiga de criativo\n");
    expect(md).not.toContain("de criativo de criativo");
    expect(md).toContain("## Alertas ativos\n");
    expect(md).not.toContain("ativos ativos");
    expect(md).toContain("## WhatsApp / WABA\n");
    expect(md).not.toContain("/ WABA / WABA");
  });

  it("desembrulha dump JSON cortado (relatório semanal La Felicità)", () => {
    const dump =
      '{"corpo_md":"## resumo_executivo\\nLa Felicità gastou R$ 114.\\n## Ranking de conjuntos\\n| 23 | AD_CONJ.02 | gasto {erro: meio}';
    const md = humanizarMarkdownRelatorio(dump);
    expect(md).toContain("## Resumo executivo");
    expect(md).toContain("La Felicità gastou R$ 114.");
    expect(md).not.toMatch(/"corpo_md"/);
  });

  it("titulosDasSecoes usa o catálogo, não a chave crua", () => {
    expect(titulosDasSecoes(["custo_vs_teto"])).toEqual(["Custo versus teto vigente"]);
  });
});

describe("rankingConjuntosRelatorio", () => {
  it("ordena do melhor para o pior e nao omite conjunto sem resultado", () => {
    const r = rankingConjuntosRelatorio([
      {
        nome: "Caro", campanha: "JUR", conjunto_id: "1",
        totais_janela: { gasto: "R$ 20,00", impressoes: 100, cliques_no_link: 2, resultados_na_base: 1, custo_por_resultado: "R$ 20,00" },
      },
      {
        nome: "Barato", campanha: "JUR", conjunto_id: "2",
        totais_janela: { gasto: "R$ 10,00", impressoes: 80, cliques_no_link: 4, resultados_na_base: 2, custo_por_resultado: "R$ 5,00" },
      },
      {
        nome: "Zerado", campanha: "JUR", conjunto_id: "3",
        totais_janela: { gasto: "R$ 3,00", impressoes: 10, cliques_no_link: 0, resultados_na_base: 0 },
      },
      { nome: "So estrutura", campanha: "JUR", conjunto: "So estrutura", conjunto_id: "4" },
    ]);
    expect(r.total).toBe(4);
    expect(r.linhas.map((l) => l.nome)).toEqual(["Barato", "Caro", "Zerado", "So estrutura"]);
    expect(r.markdown).toContain("| 4 | So estrutura |");
  });

  it("funde objeto ao vivo sem métrica com o conjunto da janela (não duplica linha)", () => {
    const r = rankingConjuntosRelatorio([
      {
        nome: "CONJ.1_GEO_RMS", campanha: "VISTTA", conjunto_id: "1201",
        status: "ACTIVE", anuncios: 6,
        totais_janela: { gasto: "R$ 51,31", impressoes: 1018, cliques_no_link: 14, resultados_na_base: 8, custo_por_resultado: "R$ 6,41" },
      },
      { id: "999", name: "CONJ.1_GEO_RMS", campanha: "VISTTA", status: "ACTIVE", n: 0 },
      {
        nome: "CONJ.1", campanha: "VISTTA", conjunto_id: "1202",
        status: "PAUSED", anuncios: 6,
        totais_janela: { gasto: "R$ 0,00", impressoes: 0, cliques_no_link: 0, resultados_na_base: 0 },
      },
      { id: "888", name: "CONJ.1", campanha: "VISTTA", status: "PAUSED", n: 0 },
    ]);
    expect(r.total).toBe(2);
    expect(r.linhas.map((l) => l.nome)).toEqual(["CONJ.1_GEO_RMS", "CONJ.1"]);
    expect(r.linhas[0].gasto).toBeCloseTo(51.31);
    expect(r.linhas[0].anuncios).toBe(6);
  });
});

describe("injetarRankingConjuntosNoMarkdown", () => {
  it("coloca o ranking de conjuntos logo apos o de criativos, sem apagar o resto", () => {
    const md = injetarRankingConjuntosNoMarkdown({
      md: "## Ranking de criativos\n\n| Peça |\n\n## Fadiga\ntexto",
      tabela: "| # | Conjunto |\n| 1 | A |",
    });
    expect(md.indexOf("Ranking de criativos")).toBeLessThan(md.indexOf("Ranking de conjuntos"));
    expect(md.indexOf("Ranking de conjuntos")).toBeLessThan(md.indexOf("Fadiga"));
    expect(md).toContain("| 1 | A |");
  });
});

describe("recorte todas_ativas ignora cascas Meta", () => {
  const base = (over: Partial<CampanhaRelatorio>): CampanhaRelatorio => ({
    external_id: "x",
    nome: "Post",
    status: "ACTIVE",
    objective: "LINK_CLICKS",
    tipo: "trafego",
    gasto: 0,
    last_synced_at: null,
    fonte: "ao_vivo",
    ...over,
  });

  it("reconhece Traffic/Sales/MM_LITE e não mistura com postagem ativa", () => {
    expect(campanhaEhCascaMeta("Traffic Campaign")).toBe(true);
    expect(campanhaEhCascaMeta("Sales Campaign")).toBe(true);
    expect(campanhaEhCascaMeta("MM_LITE_DEFAULT_AD_CAMPAIGN_GROUP")).toBe(true);
    expect(campanhaEhCascaMeta("Post do Instagram: Recebeu uma mensagem")).toBe(false);
    const r = filtrarCampanhasAtivasDoRecorte([
      base({ external_id: "1", nome: "Post do Instagram: A", gasto: 17 }),
      base({ external_id: "2", nome: "Traffic Campaign" }),
      base({ external_id: "3", nome: "Sales Campaign" }),
      base({ external_id: "4", nome: "MM_LITE_DEFAULT_AD_CAMPAIGN_GROUP" }),
      base({ external_id: "5", nome: "Post do Instagram: B", status: "paused", gasto: 10 }),
      base({ external_id: "6", nome: "Post do Instagram: C", gasto: 20 }),
    ]);
    expect(r.cascas).toBe(3);
    expect(r.escolhidas.map((c) => c.external_id)).toEqual(["1", "6"]);
  });

  it("ordena pelo gasto da janela, não pela ordem do Pipeboard", () => {
    const ord = ordenarCampanhasRelatorioPorGasto(
      [
        base({ external_id: "a", nome: "Primeira na lista", gasto: 1 }),
        base({ external_id: "b", nome: "Maior gasto", gasto: 20 }),
      ],
      { b: 20.44, a: 17 },
    );
    expect(ord.map((c) => c.external_id)).toEqual(["b", "a"]);
  });

  it("ranking de campanhas lista todas, da maior gasto, e injeta na quebra", () => {
    const r = rankingCampanhasRelatorio([
      { campaign_id: "1", nome: "Post A", status: "ACTIVE", gasto: 17, impressoes: 900, cliques_link: 50, formularios: 0, conversas: 0 },
      { campaign_id: "2", nome: "Post B", status: "ACTIVE", gasto: 20.44, impressoes: 573, cliques_link: 23, formularios: 0, conversas: 0 },
    ]);
    expect(r.total).toBe(2);
    expect(r.linhas[0].nome).toBe("Post B");
    expect(r.markdown).toContain("Todas as 2 campanha(s)");
    const md = injetarRankingCampanhasNoMarkdown({
      md: "## Resumo executivo\nok\n\n## Quebra por campanha\nso quatro\n\n## Fadiga\nx",
      tabela: r.markdown,
    });
    expect(md).toContain("Post B");
    expect(md).not.toContain("so quatro");
  });
});

describe("proximaExecucaoRelatorio", () => {
  it("diária: se o horário de hoje já passou, vai para amanhã em Brasília", () => {
    // 10/09/2026 16:00 BRT = 19:00 UTC. 08:00 BRT já passou → 11/09 08:00 BRT.
    const agora = new Date("2026-09-10T19:00:00Z");
    const next = proximaExecucaoRelatorio({
      frequencia: "diaria",
      horaLocal: "08:00",
      aPartirDe: agora,
    });
    expect(next.toISOString()).toBe("2026-09-11T11:00:00.000Z");
  });

  it("diária: se o horário de hoje ainda não chegou, fica hoje", () => {
    const agora = new Date("2026-09-10T10:00:00Z"); // 07:00 BRT
    const next = proximaExecucaoRelatorio({
      frequencia: "diaria",
      horaLocal: "08:00",
      aPartirDe: agora,
    });
    expect(next.toISOString()).toBe("2026-09-10T11:00:00.000Z");
  });

  it("dias úteis: sexta depois da hora pula para segunda", () => {
    // 11/09/2026 é sexta. 16:00 BRT → segunda 14/09 08:00 BRT.
    const agora = new Date("2026-09-11T19:00:00Z");
    const next = proximaExecucaoRelatorio({
      frequencia: "dias_uteis",
      horaLocal: "08:00",
      aPartirDe: agora,
    });
    expect(next.toISOString()).toBe("2026-09-14T11:00:00.000Z");
  });

  it("semanal: próximo dia da semana no horário pedido", () => {
    // 10/09/2026 é quinta. Pedir segunda (1) → 14/09 08:00 BRT.
    const agora = new Date("2026-09-10T12:00:00Z");
    const next = proximaExecucaoRelatorio({
      frequencia: "semanal",
      horaLocal: "08:00",
      diaSemana: 1,
      aPartirDe: agora,
    });
    expect(next.toISOString()).toBe("2026-09-14T11:00:00.000Z");
  });

  it("cada N horas soma a partir de agora", () => {
    const agora = new Date("2026-09-10T15:00:00Z");
    const next = proximaExecucaoRelatorio({
      frequencia: "cada_n_horas",
      horaLocal: "08:00",
      intervaloHoras: 6,
      aPartirDe: agora,
    });
    expect(next.toISOString()).toBe("2026-09-10T21:00:00.000Z");
  });
});

describe("periodoDaJanela", () => {
  it("ontem é um dia fechado; 7d são sete dias até ontem", () => {
    expect(periodoDaJanela("ontem", "2026-09-10")).toEqual({
      inicio: "2026-09-09",
      fim: "2026-09-09",
    });
    expect(periodoDaJanela("7d", "2026-09-10")).toEqual({
      inicio: "2026-09-03",
      fim: "2026-09-09",
    });
  });
});

describe("mergeCampanhasRelatorio", () => {
  const espelho = (over: Partial<CampanhaRelatorio> = {}): CampanhaRelatorio => ({
    external_id: "111",
    nome: "Espelho",
    status: "paused",
    objective: "OUTCOME_LEADS",
    tipo: "leadgen",
    gasto: 12.5,
    last_synced_at: "2026-09-09T12:00:00Z",
    fonte: "espelho",
    ...over,
  });

  it("sem ao vivo, declara espelho", () => {
    const r = mergeCampanhasRelatorio([espelho()], []);
    expect(r.fonte).toBe("espelho");
    expect(r.campanhas[0].status).toBe("paused");
  });

  it("status real vence o espelho; gasto do espelho permanece", () => {
    const r = mergeCampanhasRelatorio([espelho()], [
      { id: "111", name: "Ao vivo", effective_status: "ACTIVE", objective: "OUTCOME_LEADS" },
    ]);
    expect(r.fonte).toBe("ao_vivo");
    expect(r.campanhas).toHaveLength(1);
    expect(r.campanhas[0].status).toBe("ACTIVE");
    expect(r.campanhas[0].nome).toBe("Ao vivo");
    expect(r.campanhas[0].gasto).toBe(12.5);
    expect(r.campanhas[0].fonte).toBe("ao_vivo");
  });

  it("campanha só no espelho continua listada, com fonte honesta", () => {
    const r = mergeCampanhasRelatorio(
      [espelho(), espelho({ external_id: "222", nome: "Só espelho" })],
      [{ id: "111", effective_status: "ACTIVE" }],
    );
    const soEspelho = r.campanhas.find((c) => c.external_id === "222");
    expect(soEspelho?.fonte).toBe("espelho");
    expect(soEspelho?.nome).toBe("Só espelho");
  });
});

describe("janelaAnteriorDoPeriodo", () => {
  it("desloca 1 dia sem sobrepor", () => {
    expect(janelaAnteriorDoPeriodo({ inicio: "2026-09-09", fim: "2026-09-09" })).toEqual({
      inicio: "2026-09-08",
      fim: "2026-09-08",
    });
  });

  it("desloca 7 dias fechados", () => {
    expect(janelaAnteriorDoPeriodo({ inicio: "2026-09-03", fim: "2026-09-09" })).toEqual({
      inicio: "2026-08-27",
      fim: "2026-09-02",
    });
  });
});

describe("filtrarConjuntosDoRecorte / recortarAlertasDoRecorte", () => {
  it("isola conjuntos da campanha do contrato e nao mistura outras linhas", () => {
    const r = filtrarConjuntosDoRecorte(
      {
        conjuntos: [
          { conjunto: "JUR A", campanha: "COHAPM_JURIDICO_CONV_WA_2026-08" },
          { conjunto: "VISTTA 1", campanha: "VISTTA_SALT" },
        ],
      },
      ["COHAPM_JURIDICO_CONV_WA_2026-08"],
      ["120249788950400182"],
    );
    expect(r.exibidos).toBe(1);
    expect(r.total_antes_do_filtro).toBe(2);
    expect((r.conjuntos as { conjunto: string }[])[0].conjunto).toBe("JUR A");
  });

  it("zero no recorte de alerta nao e 'nao coletado'", () => {
    const r = recortarAlertasDoRecorte(
      {
        alertas_ativos: [
          { title: "Saldo baixo", description: "conta 999" },
          { title: "Gasto", description: "COHAPM_JURIDICO_CONV_WA_2026-08 estourou" },
        ],
      },
      ["COHAPM_JURIDICO_CONV_WA_2026-08"],
      ["120249788950400182"],
    );
    expect((r.alertas_do_recorte as unknown[]).length).toBe(1);
    expect(r.outros_da_conta).toBe(1);
  });
});

describe("flattenCampanhasPipeboard", () => {
  it("aceita array, {campaigns} e {data:{campaigns}}", () => {
    expect(flattenCampanhasPipeboard([{ id: "1" }])).toHaveLength(1);
    expect(flattenCampanhasPipeboard({ campaigns: [{ id: "1" }] })).toHaveLength(1);
    expect(flattenCampanhasPipeboard({ data: { campaigns: [{ id: "1" }] } })).toHaveLength(1);
  });
});

describe("extrairJsonRelatorio", () => {
  it("lê JSON puro e descarta achado sem evidência", () => {
    const r = extrairJsonRelatorio(
      JSON.stringify({
        corpo_md: "texto",
        cobertura: "nada faltou",
        achados: [
          { tipo: "teto", evidencia: "CPL R$ 3,10 > teto R$ 2,30", alvo_nome: "X" },
          { tipo: "escala", evidencia: "   " },
        ],
      }),
    );
    expect(r.corpo_md).toBe("texto");
    expect(r.achados).toHaveLength(1);
    expect(r.achados[0].tipo).toBe("teto");
  });

  it("texto sem JSON vira narrativa, com cobertura declarada", () => {
    const r = extrairJsonRelatorio("não veio estruturado");
    expect(r.corpo_md).toBe("não veio estruturado");
    expect(r.achados).toEqual([]);
    expect(r.cobertura).toMatch(/não devolveu JSON/i);
  });

  it("JSON cortado no meio de corpo_md devolve o markdown, não o blob", () => {
    const dump =
      '{"corpo_md":"## Resumo executivo\\nNa janela 7-13/09 La Felicità teve o melhor custo.\\n## Ranking de conjuntos\\n| 23 | peca com } no texto |';
    const r = extrairJsonRelatorio(dump);
    expect(r.corpo_md).toContain("## Resumo executivo");
    expect(r.corpo_md).toContain("La Felicità teve o melhor custo");
    expect(r.corpo_md).toContain("| 23 |");
    expect(r.corpo_md.startsWith("{")).toBe(false);
    expect(r.cobertura).toMatch(/cortada/i);
  });

  it("JSON cortado depois dos achados não zera as opiniões", () => {
    const dump =
      '{"cobertura":"nada faltou","achados":[{"tipo":"teto","evidencia":"R$ 181 vs R$ 120 no dia 14/09","alvo_nome":"VISTTA","acao":"alinhar orçamento","mecanismo":"ABO","metrica_sucesso":"gasto ≤ 120","janela_leitura":"próximo dia","reversa":"se o teto mudou, ignorar"}],"corpo_md":"## Resumo executivo\\nCampanha gastou';
    const r = extrairJsonRelatorio(dump);
    expect(r.achados).toHaveLength(1);
    expect(r.achados[0].tipo).toBe("teto");
    expect(r.achados[0].evidencia).toContain("181");
    expect(r.corpo_md).toContain("## Resumo executivo");
  });

  it("JSON válido com } no markdown não descarta achados", () => {
    const r = extrairJsonRelatorio(JSON.stringify({
      cobertura: "ok",
      achados: [{ tipo: "escala", evidencia: "CPR R$ 4,91 no CONJ.2", alvo_nome: "CONJ.2" }],
      corpo_md: "## Escala\nNão subir {verba} hoje.",
    }));
    expect(r.achados).toHaveLength(1);
    expect(r.corpo_md).toContain("Não subir {verba} hoje.");
  });
});

describe("normalizarAchados / preset", () => {
  it("ignora lixo e preenche o diário operacional com todas as seções", () => {
    expect(normalizarAchados(null)).toEqual([]);
    expect(campanhaEstaAtiva("ACTIVE")).toBe(true);
    expect(campanhaEstaAtiva("paused")).toBe(false);
    const p = presetDiarioOperacional();
    expect(p.horaLocal).toBe("08:00");
    expect(p.secoes).toEqual([...CHAVES_SECAO_RELATORIO]);
  });
});
