import { describe, expect, it } from "vitest";
import {
  avisoContinuacaoRecorte,
  campanhaEstaAtiva,
  campanhaEhCascaMeta,
  nomeBaseCampanha,
  seguirContinuacoesDoRecorte,
  filtrarCampanhasAtivasDoRecorte,
  CHAVES_SECAO_RELATORIO,
  especialistasPorSecoes,
  extrairJsonRelatorio,
  flattenCampanhasPipeboard,
  humanizarMarkdownRelatorio,
  filtrarConjuntosDoRecorte,
  injetarDiaADiaNoMarkdown,
  injetarRankingCampanhasNoMarkdown,
  injetarRankingCriativosNoMarkdown,
  removerSecaoDoMarkdownRelatorio,
  injetarRankingConjuntosNoMarkdown,
  quadroDiaADiaRelatorio,
  rankingCriativosRelatorio,
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

  // 13/10/2026: a leitura passou a emitir "R$ 1.008,67". O ranking le o gasto desse texto e
  // repete o custo como veio; o formato antigo ("R$ 1008.70") ainda esta em execucoes gravadas.
  it("le reais pt-BR com milhar e o formato antigo sem trocar a ordem de grandeza", () => {
    const r = rankingConjuntosRelatorio([
      {
        nome: "CONJ.1_LAF", campanha: "LAF", conjunto_id: "1",
        totais_janela: { gasto: "R$ 1.008,67", impressoes: 60000, cliques_no_link: 600, resultados_na_base: 8, custo_por_resultado: "R$ 126,08" },
      },
      {
        nome: "CONJ.2_LAF", campanha: "LAF", conjunto_id: "2",
        totais_janela: { gasto: "R$ 1008.70", impressoes: 100, cliques_no_link: 1, resultados_na_base: 0 },
      },
    ]);
    const porNome = Object.fromEntries(r.linhas.map((l) => [l.nome, l]));
    expect(porNome["CONJ.1_LAF"].gasto).toBe(1008.67);
    expect(porNome["CONJ.2_LAF"].gasto).toBe(1008.7);
    expect(r.markdown).toContain("| R$ 1.008,67 |");
    expect(r.markdown).toContain("| R$ 126,08 |");
    expect(r.markdown).toContain("| R$ 1.008,70 |");
    expect(r.markdown).not.toMatch(/R\$ \d+\.\d{2}\b/);
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
    // O status é o de quando o relatório rodou, não o da janela: a coluna diz isso.
    expect(r.markdown).toContain("| Status agora |");
    expect(r.markdown).toContain("| Post B | Ativa |");
    expect(
      rankingCampanhasRelatorio([{ campaign_id: "3", nome: "Parada", status: "PAUSED", gasto: 1 }])
        .markdown,
    ).toContain("| Parada | Pausada |");
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

// 16/10/2026: a agenda "Ocular LP" fixava a COHAPM_OCULAR_LEADS_SITE_CAMACARI_2026-10. O time
// duplicou para a _V2 e pausou a original; o relatório de 15/10 leu só a pausada e a V2
// (R$ 114,67 e 1 formulário no dia) sumiu sem aviso. Campanha fixa parada não pode calar.
describe("seguirContinuacoesDoRecorte", () => {
  const camp = (over: Partial<CampanhaRelatorio>): CampanhaRelatorio => ({
    external_id: "x",
    nome: "x",
    status: "ACTIVE",
    objective: "OUTCOME_LEADS",
    tipo: "leadgen",
    gasto: 0,
    last_synced_at: null,
    fonte: "ao_vivo",
    ...over,
  });
  const original = camp({
    external_id: "120250379199290182",
    nome: "COHAPM_OCULAR_LEADS_SITE_CAMACARI_2026-10",
    status: "PAUSED",
  });
  const v2 = camp({
    external_id: "120250509426200182",
    nome: "COHAPM_OCULAR_LEADS_SITE_CAMACARI_2026-10_V2",
  });
  const vistta = camp({
    external_id: "120250378044230182",
    nome: "COHAPM_VISTTA_TRAFEGO_LP_OUT26",
  });

  it("nome-base tira _V2, cópia e (2), e não come mês nem leva", () => {
    expect(nomeBaseCampanha("COHAPM_OCULAR_LEADS_SITE_CAMACARI_2026-10_V2")).toBe(
      nomeBaseCampanha("COHAPM_OCULAR_LEADS_SITE_CAMACARI_2026-10"),
    );
    expect(nomeBaseCampanha("Campanha X - Cópia")).toBe("campanha x");
    expect(nomeBaseCampanha("Campanha X – Copy 2")).toBe("campanha x");
    expect(nomeBaseCampanha("Campanha X (2)")).toBe("campanha x");
    expect(nomeBaseCampanha("COHAPM_JURIDICO_CONV_LEVA01")).toBe("cohapm_juridico_conv_leva01");
    expect(nomeBaseCampanha("COHAPM_VISTTA_CONV_WA_SET26- SETEMBRO")).not.toBe(
      nomeBaseCampanha("COHAPM_VISTTA_CONV_WA_SET26"),
    );
  });

  it("fixa pausada puxa a ativa de mesmo nome-base, logo depois dela", () => {
    const r = seguirContinuacoesDoRecorte([original], [original, vistta, v2]);
    expect(r.campanhas.map((c) => c.external_id)).toEqual([original.external_id, v2.external_id]);
    expect(r.continuacoes).toEqual([
      {
        origem: { external_id: original.external_id, nome: original.nome, status: "PAUSED" },
        seguidas: [{ external_id: v2.external_id, nome: v2.nome }],
      },
    ]);
    expect(r.paradas).toEqual([]);
  });

  it("mesmo nome exato também é continuação (Jurídico tem duas iguais)", () => {
    const parada = camp({
      external_id: "120250394928030182",
      nome: "COHAPM_JURIDICO_CONV_WA_2026-10",
      status: "PAUSED",
    });
    const ativa = camp({
      external_id: "120250394932500182",
      nome: "COHAPM_JURIDICO_CONV_WA_2026-10",
    });
    const r = seguirContinuacoesDoRecorte([parada], [ativa, parada]);
    expect(r.campanhas.map((c) => c.external_id)).toEqual([parada.external_id, ativa.external_id]);
  });

  it("fixa ativa fica como está; casca e nome parecido não entram", () => {
    expect(seguirContinuacoesDoRecorte([v2], [original, v2]).campanhas).toEqual([v2]);
    const set = camp({ external_id: "1", nome: "COHAPM_VISTTA_CONV_WA_SET26", status: "PAUSED" });
    const r = seguirContinuacoesDoRecorte(
      [set],
      [
        set,
        camp({ external_id: "2", nome: "COHAPM_VISTTA_CONV_WA_SET26- SETEMBRO" }),
        camp({ external_id: "3", nome: "Traffic Campaign" }),
      ],
    );
    expect(r.campanhas.map((c) => c.external_id)).toEqual(["1"]);
    expect(r.paradas).toEqual([{ external_id: "1", nome: set.nome, status: "PAUSED" }]);
  });

  it("se a ativa já está fixa junto, não duplica nem avisa", () => {
    const r = seguirContinuacoesDoRecorte([original, v2], [original, v2]);
    expect(r.campanhas.map((c) => c.external_id)).toEqual([original.external_id, v2.external_id]);
    expect(r.continuacoes).toEqual([]);
    expect(r.paradas).toEqual([]);
  });

  it("aviso abre o relatório com as duas campanhas e o status de agora", () => {
    const comV2 = avisoContinuacaoRecorte(seguirContinuacoesDoRecorte([original], [original, v2]));
    expect(comV2.markdown).toContain(original.nome);
    expect(comV2.markdown).toContain(v2.nome);
    expect(comV2.markdown).toContain("pausada agora na Meta");
    expect(comV2.markdown).toContain("edite a agenda");
    expect(comV2.cobertura).toContain(v2.external_id);

    const sem = avisoContinuacaoRecorte(
      seguirContinuacoesDoRecorte([original], [original, vistta]),
    );
    expect(sem.markdown).toContain("nenhuma campanha ativa de mesmo nome");
    expect(sem.markdown).not.toContain(vistta.nome);

    expect(avisoContinuacaoRecorte(seguirContinuacoesDoRecorte([v2], [v2]))).toEqual({
      markdown: "",
      cobertura: "",
    });
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

  it("SET26 nao arrasta a campanha SET26- SETEMBRO, nem o contrario", () => {
    const conjuntos = [
      { conjunto: "velha", campanha: "COHAPM_VISTTA_CONV_WA_SET26", campaign_external_id: "120249817715740182" },
      { conjunto: "nova", campanha: "COHAPM_VISTTA_CONV_WA_SET26- SETEMBRO", campaign_external_id: "120250158071500182" },
    ];
    const setembro = filtrarConjuntosDoRecorte(
      { conjuntos },
      ["COHAPM_VISTTA_CONV_WA_SET26- SETEMBRO"],
      ["120250158071500182"],
    );
    expect((setembro.conjuntos as { conjunto: string }[]).map((c) => c.conjunto)).toEqual(["nova"]);
    const antiga = filtrarConjuntosDoRecorte(
      { conjuntos },
      ["COHAPM_VISTTA_CONV_WA_SET26"],
      ["120249817715740182"],
    );
    expect((antiga.conjuntos as { conjunto: string }[]).map((c) => c.conjunto)).toEqual(["velha"]);
  });

  it("dois AGOSTO com o mesmo nome seguem o ID da Meta, nao o texto", () => {
    const r = filtrarConjuntosDoRecorte(
      {
        conjuntos: [
          { conjunto: "A1", campanha: "AGOSTO", campaign_external_id: "11111111" },
          { conjunto: "A2", campanha: "AGOSTO", campaign_external_id: "22222222" },
        ],
      },
      ["AGOSTO"],
      ["11111111"],
    );
    expect((r.conjuntos as { conjunto: string }[]).map((c) => c.conjunto)).toEqual(["A1"]);
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

  it("alerta da campanha com sufixo de mes nao entra no recorte do prefixo", () => {
    const r = recortarAlertasDoRecorte(
      {
        alertas_ativos: [
          { title: "Teto", description: "COHAPM_VISTTA_CONV_WA_SET26- SETEMBRO passou de R$ 120" },
          { title: "Teto", description: "COHAPM_VISTTA_CONV_WA_SET26 passou de R$ 80" },
        ],
      },
      ["COHAPM_VISTTA_CONV_WA_SET26"],
      ["120249817715740182"],
    );
    const textos = (r.alertas_do_recorte as { description: string }[]).map((a) => a.description);
    expect(textos).toEqual(["COHAPM_VISTTA_CONV_WA_SET26 passou de R$ 80"]);
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

// Dia a dia: cada dia da janela separado, por campanha, conjunto e criativo, com total no fim.
// Os números do caso vêm do formato da Lafelicità LP (06–12/10/2026): dois conjuntos, criativo
// repetido nos dois, dias sem entrega no meio. Dia sem linha é "—", nunca zero inventado.
describe("quadroDiaADiaRelatorio", () => {
  const linha = (p: Partial<Record<string, unknown>>) => ({
    dia: "2026-10-06",
    campaign_id: "120250380225140182",
    conjunto_id: "s-prof",
    ad_id: "a1",
    gasto: 0,
    impressoes: 0,
    cliques_link: 0,
    visitas: 0,
    formularios: 0,
    conversas: 0,
    ...p,
  });
  const entradaLp = {
    periodo: { inicio: "2026-10-06", fim: "2026-10-12" },
    campanhas: [
      {
        campaign_id: "120250380225140182",
        nome: "COHAPM_LAFELICITA_LEADS_LP_2026-10",
        base: "formularios",
        conjuntos: [
          { conjunto_id: "s-prof", nome: "TOFU_PROFISSOES-ALTA-RENDA_SETORES_8CIDADES" },
          { conjunto_id: "s-alto", nome: "TOFU_ALTO-PADRAO_SEGUNDA-CASA-VIAGEM_SSA-LF-CAM-FSA" },
        ],
        anuncios: [
          { ad_id: "a1", nome: "VID_VENHA-CONFERIR_M4_V1", conjunto_id: "s-prof" },
          { ad_id: "a2", nome: "IMG_FRONTAL-ESCASSEZ_M5_V1", conjunto_id: "s-prof" },
          { ad_id: "a3", nome: "VID_VENHA-CONFERIR_M4_V1", conjunto_id: "s-alto" },
        ],
      },
    ],
    linhas: [
      linha({
        dia: "2026-10-06",
        ad_id: "a1",
        gasto: 10,
        impressoes: 500,
        cliques_link: 5,
        visitas: 1,
      }),
      linha({ dia: "2026-10-06", ad_id: "a3", conjunto_id: "s-alto", gasto: 20, impressoes: 800 }),
      linha({
        dia: "2026-10-07",
        ad_id: "a1",
        gasto: 100.5,
        impressoes: 3000,
        cliques_link: 40,
        visitas: 6,
        formularios: 9,
      }),
      linha({
        dia: "2026-10-07",
        ad_id: "a3",
        conjunto_id: "s-alto",
        gasto: 30,
        impressoes: 1000,
        formularios: 3,
      }),
      linha({ dia: "2026-10-12", ad_id: "a1", gasto: 200, impressoes: 4000, formularios: 14 }),
      linha({ dia: "2026-10-12", ad_id: "a2", gasto: 50.25, impressoes: 1500 }),
      linha({
        dia: "2026-10-12",
        ad_id: "a3",
        conjunto_id: "s-alto",
        gasto: 300,
        impressoes: 5000,
        formularios: 14,
      }),
    ],
  };

  it("campanha dia a dia: uma linha por dia da janela e o total que fecha", () => {
    const { markdown } = quadroDiaADiaRelatorio(entradaLp);
    expect(markdown).toContain("### COHAPM_LAFELICITA_LEADS_LP_2026-10 (120250380225140182)");
    expect(markdown).toContain(
      "| Dia | Gasto | Impressões | Cliques no link | Visitas à página | Formulários | Custo por formulário |",
    );
    expect(markdown).toContain("| 06 ter | R$ 30,00 | 1.300 | 5 | 1 | 0 | — |");
    expect(markdown).toContain("| 07 qua | R$ 130,50 | 4.000 | 40 | 6 | 12 | R$ 10,88 |");
    expect(markdown).toContain("| 08 qui | — | — | — | — | — | — |");
    expect(markdown).toContain("| 12 seg | R$ 550,25 | 10.500 | 0 | 0 | 28 | R$ 19,65 |");
    expect(markdown).toContain(
      "| **Total** | **R$ 710,75** | **15.800** | **45** | **7** | **40** | **R$ 17,77** |",
    );
  });

  it("por conjunto: dias em colunas, gasto · resultado, total com custo; maior gasto primeiro", () => {
    const { markdown } = quadroDiaADiaRelatorio(entradaLp);
    expect(markdown).toContain(
      "| Conjunto | 06 ter | 07 qua | 08 qui | 09 sex | 10 sáb | 11 dom | 12 seg | Total (7 dias) |",
    );
    const prof =
      "| TOFU_PROFISSOES-ALTA-RENDA_SETORES_8CIDADES | R$ 10,00 · 0 | R$ 100,50 · 9 | — | — | — | — | R$ 250,25 · 14 | R$ 360,75 · 23 · R$ 15,68 |";
    const alto =
      "| TOFU_ALTO-PADRAO_SEGUNDA-CASA-VIAGEM_SSA-LF-CAM-FSA | R$ 20,00 · 0 | R$ 30,00 · 3 | — | — | — | — | R$ 300,00 · 14 | R$ 350,00 · 17 · R$ 20,59 |";
    expect(markdown).toContain(prof);
    expect(markdown).toContain(alto);
    expect(markdown.indexOf(prof)).toBeLessThan(markdown.indexOf(alto));
  });

  it("por criativo dentro de cada conjunto, sem custo quando não houve resultado", () => {
    const { markdown } = quadroDiaADiaRelatorio(entradaLp);
    expect(markdown).toContain("#### Por criativo — TOFU_PROFISSOES-ALTA-RENDA_SETORES_8CIDADES");
    expect(markdown).toContain(
      "| VID_VENHA-CONFERIR_M4_V1 | R$ 10,00 · 0 | R$ 100,50 · 9 | — | — | — | — | R$ 200,00 · 14 | R$ 310,50 · 23 · R$ 13,50 |",
    );
    expect(markdown).toContain(
      "| IMG_FRONTAL-ESCASSEZ_M5_V1 | — | — | — | — | — | — | R$ 50,25 · 0 | R$ 50,25 · 0 |",
    );
    expect(markdown).toContain(
      "#### Por criativo — TOFU_ALTO-PADRAO_SEGUNDA-CASA-VIAGEM_SSA-LF-CAM-FSA",
    );
  });

  it("declara a base contada e o que é o travessão", () => {
    const { markdown } = quadroDiaADiaRelatorio(entradaLp);
    expect(markdown).toMatch(/Resultado contado: formulários enviados/);
    expect(markdown).toMatch(/— = sem entrega registrada no dia/);
    // Sem a frase de abertura que apontava para a Quebra por campanha, que saiu do relatório.
    expect(markdown.startsWith("### COHAPM_LAFELICITA_LEADS_LP_2026-10")).toBe(true);
    expect(markdown).not.toContain("Quebra por campanha");
  });

  it("campanha sem nenhuma linha na janela diz isso, sem tabela de zeros", () => {
    const { markdown, com_entrega } = quadroDiaADiaRelatorio({ ...entradaLp, linhas: [] });
    expect(com_entrega).toBe(0);
    expect(markdown).toContain("Sem entrega registrada de 06/10 a 12/10.");
    expect(markdown).not.toContain("| Dia |");
  });

  it("base conversa troca as colunas e some com visitas quando não houve", () => {
    const { markdown } = quadroDiaADiaRelatorio({
      periodo: { inicio: "2026-10-12", fim: "2026-10-12" },
      campanhas: [
        {
          campaign_id: "120250394932500182",
          nome: "COHAPM_JURIDICO_CONV_WA_2026-10",
          base: "conversas",
          conjuntos: [{ conjunto_id: "j1", nome: "[LF | CONV] JUR_WA_CONJ.1" }],
          anuncios: [{ ad_id: "x1", nome: "AD_C1_JUROS_ALTO", conjunto_id: "j1" }],
        },
      ],
      linhas: [
        linha({
          dia: "2026-10-12",
          campaign_id: "120250394932500182",
          conjunto_id: "j1",
          ad_id: "x1",
          gasto: 40,
          impressoes: 900,
          cliques_link: 12,
          conversas: 5,
        }),
      ],
    });
    expect(markdown).toContain(
      "| Dia | Gasto | Impressões | Cliques no link | Conversas | Custo por conversa |",
    );
    expect(markdown).not.toContain("Visitas à página");
    // Janela de um dia: a coluna do dia já é o total, com custo.
    expect(markdown).toContain("| Conjunto | 12 seg |");
    expect(markdown).toContain("| [LF \\| CONV] JUR_WA_CONJ.1 | R$ 40,00 · 5 · R$ 8,00 |");
  });

  it("entrada inválida não derruba o relatório", () => {
    expect(quadroDiaADiaRelatorio(null).markdown).toBe("");
    expect(quadroDiaADiaRelatorio({ periodo: { inicio: "x", fim: "y" } }).markdown).toBe("");
  });
});

describe("injetarDiaADiaNoMarkdown", () => {
  const tabela = "### Campanha X (1)\n\n| Dia | Gasto |\n|---|---|\n| 06 ter | R$ 1,00 |";

  // 16/10/2026: a leitura corrida da IA repetia, frase a frase, os números das tabelas logo
  // abaixo. A seção fica só com as tabelas.
  it("troca tudo o que a IA escreveu na seção pelas tabelas", () => {
    const md = injetarDiaADiaNoMarkdown({
      md: "## Quebra por campanha\ntab\n\n## Dia a dia por campanha, conjunto e criativo\nO melhor dia foi 12/10.\n| colada | pela IA |\n### Campanha Y\nmais prosa\n\n## Fadiga de criativo\nok",
      tabela,
    });
    expect(md).not.toContain("O melhor dia foi 12/10.");
    expect(md).not.toContain("| colada | pela IA |");
    expect(md).not.toContain("mais prosa");
    expect(md).toContain("## Dia a dia por campanha, conjunto e criativo\n\n### Campanha X (1)");
    expect(md.indexOf("### Campanha X (1)")).toBeLessThan(md.indexOf("## Fadiga de criativo"));
    expect(md).toContain("## Fadiga de criativo\nok");
  });

  it("sem a seção, entra logo depois da Quebra por campanha", () => {
    const md = injetarDiaADiaNoMarkdown({
      md: "## Quebra por campanha\n| # |\n\n## Conjuntos e estrutura\nx",
      tabela,
    });
    expect(md).toContain("## Dia a dia por campanha, conjunto e criativo");
    expect(md.indexOf("## Dia a dia")).toBeGreaterThan(md.indexOf("## Quebra por campanha"));
    expect(md.indexOf("## Dia a dia")).toBeLessThan(md.indexOf("## Conjuntos e estrutura"));
  });

  it("tabela vazia não mexe no texto", () => {
    expect(injetarDiaADiaNoMarkdown({ md: "## Resumo executivo\nx", tabela: "" })).toBe(
      "## Resumo executivo\nx",
    );
  });
});

describe("removerSecaoDoMarkdownRelatorio", () => {
  it("tira a Quebra por campanha inteira e deixa o dia a dia, com os subtítulos dele", () => {
    const md = removerSecaoDoMarkdownRelatorio({
      md: "## Funil de mídia\nf\n\n## Quebra por campanha\n\nTodas as 1 campanha(s)\n| # | Campanha |\n|---|---|\n| 1 | X |\n## Dia a dia por campanha, conjunto e criativo\n\n### X (1)\n\n#### Por conjunto\n| a |\n\n## Conjuntos e estrutura\nc",
      titulo: "Quebra por campanha",
    });
    expect(md).not.toContain("Quebra por campanha");
    expect(md).not.toContain("Todas as 1 campanha(s)");
    expect(md).toBe(
      "## Funil de mídia\nf\n\n## Dia a dia por campanha, conjunto e criativo\n\n### X (1)\n\n#### Por conjunto\n| a |\n\n## Conjuntos e estrutura\nc",
    );
  });

  it("sem a seção ou sem título, devolve o texto como veio", () => {
    const md = "## Resumo executivo\nx\n";
    expect(removerSecaoDoMarkdownRelatorio({ md, titulo: "Quebra por campanha" })).toBe(md);
    expect(removerSecaoDoMarkdownRelatorio({ md: "## A\nx", titulo: "" })).toBe("## A\nx");
  });
});

// Lafelicità LP, 16/10/2026: 17 criativos entregaram e o relatório mostrou 12 (o prompt cortava
// nas 12 de maior gasto); o VID_VENHA-CONFERIR_M4_V1 roda em dois conjuntos e aparecia sem dizer
// de qual. Os números abaixo são os da Meta naquele dia.
describe("rankingCriativosRelatorio", () => {
  const CAMP = "120250380225140182";
  const PROF = "TOFU_PROFISSOES-ALTA-RENDA_SETORES_8CIDADES";
  const ALTO = "TOFU_ALTO-PADRAO_SEGUNDA-CASA-VIAGEM_SSA-LF-CAM-FSA";
  const POLO = "TOFU_POLO-CAMACARI_PINOS-1500M_40-65";
  const linha = (p: Partial<Record<string, unknown>>) => ({
    dia: "2026-10-16",
    campaign_id: CAMP,
    conjunto_id: "s-prof",
    ad_id: "c35",
    gasto: 0,
    impressoes: 0,
    cliques_link: 0,
    visitas: 0,
    formularios: 0,
    conversas: 0,
    ...p,
  });
  const entradaLp = {
    periodo: { inicio: "2026-10-16", fim: "2026-10-16" },
    campanhas: [
      {
        campaign_id: CAMP,
        nome: "COHAPM_LAFELICITA_LEADS_LP_2026-10",
        base: "formularios",
        conjuntos: [
          { conjunto_id: "s-prof", nome: PROF },
          { conjunto_id: "s-alto", nome: ALTO },
          { conjunto_id: "s-polo", nome: POLO },
        ],
        anuncios: [
          { ad_id: "c35", nome: "LF_LP_CAR_35_ADS0910", conjunto_id: "s-prof", ativo: true },
          { ad_id: "v4a", nome: "VID_VENHA-CONFERIR_M4_V1", conjunto_id: "s-alto", ativo: true },
          { ad_id: "v4p", nome: "VID_VENHA-CONFERIR_M4_V1", conjunto_id: "s-prof", ativo: true },
          { ad_id: "c04", nome: "LF_LP_CAR_04_ADS0910", conjunto_id: "s-polo", ativo: true },
          { ad_id: "c12", nome: "LF_LP_CAR_12_ADS0910", conjunto_id: "s-prof", ativo: true },
          { ad_id: "m2", nome: "LF_LP_FLEX-IMG_M2_ADS0910", conjunto_id: "s-prof", ativo: true },
          { ad_id: "v6", nome: "VID_VENHA-CONFERIR_M6_V1", conjunto_id: "s-prof", ativo: false },
          { ad_id: "o4", nome: "IMG_CARD-OFERTA_M4_V1", conjunto_id: "s-alto", ativo: false },
        ],
      },
    ],
    linhas: [
      linha({ ad_id: "c35", gasto: 174.59, impressoes: 7208, cliques_link: 211, formularios: 21 }),
      linha({
        ad_id: "v4a",
        conjunto_id: "s-alto",
        gasto: 86.32,
        impressoes: 1562,
        cliques_link: 34,
        formularios: 2,
      }),
      linha({ ad_id: "c04", conjunto_id: "s-polo", gasto: 1.18, impressoes: 11, cliques_link: 1 }),
      linha({ ad_id: "c12", gasto: 0.56, impressoes: 10, cliques_link: 1 }),
      linha({ ad_id: "v4p", gasto: 0.04, impressoes: 2 }),
      // Pausado com linha zerada: não entregou, não entra.
      linha({ ad_id: "v6" }),
      // Fora da janela: não soma.
      linha({ dia: "2026-10-15", ad_id: "c35", gasto: 185.48, impressoes: 6730, formularios: 26 }),
    ],
  };

  it("todos os criativos que entregaram, por menor que seja o gasto, com o conjunto ao lado", () => {
    const { markdown, total } = rankingCriativosRelatorio(entradaLp);
    expect(total).toBe(5);
    expect(markdown).toContain(
      "| # | Criativo | Conjunto | Gasto | Impressões | Cliques no link | CTR | Formulários | Custo por formulário |",
    );
    expect(markdown).toContain(
      `| 1 | LF_LP_CAR_35_ADS0910 | ${PROF} | R$ 174,59 | 7.208 | 211 | 2,93% | 21 | R$ 8,31 |`,
    );
    expect(markdown).toContain(
      `| 2 | VID_VENHA-CONFERIR_M4_V1 | ${ALTO} | R$ 86,32 | 1.562 | 34 | 2,18% | 2 | R$ 43,16 |`,
    );
    expect(markdown).toContain(
      `| 3 | LF_LP_CAR_04_ADS0910 | ${POLO} | R$ 1,18 | 11 | 1 | 9,09% | 0 | sem resultado |`,
    );
    expect(markdown).toContain(
      `| 4 | LF_LP_CAR_12_ADS0910 | ${PROF} | R$ 0,56 | 10 | 1 | 10,00% | 0 | sem resultado |`,
    );
    // O mesmo nome no outro conjunto é outra linha, e o conjunto diz qual é qual.
    expect(markdown).toContain(
      `| 5 | VID_VENHA-CONFERIR_M4_V1 | ${PROF} | R$ 0,04 | 2 | 0 | 0,00% | 0 | sem resultado |`,
    );
    expect(markdown).toMatch(/Resultado contado: formulários enviados/);
    // Uma campanha só: sem coluna de campanha repetindo o mesmo nome em toda linha.
    expect(markdown).not.toContain("| Campanha |");
  });

  it("ativo sem entrega fica no fim, sem posição; pausado sem entrega não entra", () => {
    const { markdown, sem_entrega, linhas } = rankingCriativosRelatorio(entradaLp);
    expect(sem_entrega).toBe(1);
    expect(markdown).toContain(
      `| — | LF_LP_FLEX-IMG_M2_ADS0910 | ${PROF} | — | — | — | — | — | ativo, sem entrega na janela |`,
    );
    expect(linhas[linhas.length - 1].nome).toBe("LF_LP_FLEX-IMG_M2_ADS0910");
    expect(markdown).not.toContain("VID_VENHA-CONFERIR_M6_V1");
    expect(markdown).not.toContain("IMG_CARD-OFERTA_M4_V1");
    expect(markdown).toMatch(/1 criativo\(s\) ativo\(s\) sem entrega/);
  });

  it("não corta a lista: 20 criativos com entrega viram 20 linhas", () => {
    const anuncios = Array.from({ length: 20 }, (_, i) => ({
      ad_id: `ad${i}`,
      nome: `PECA_${String(i).padStart(2, "0")}`,
      conjunto_id: "s-prof",
      ativo: true,
    }));
    const { total, markdown } = rankingCriativosRelatorio({
      ...entradaLp,
      campanhas: [{ ...entradaLp.campanhas[0], anuncios }],
      linhas: anuncios.map((a, i) => linha({ ad_id: a.ad_id, gasto: i + 0.01, impressoes: 5 })),
    });
    expect(total).toBe(20);
    expect(markdown).toContain("| 20 | PECA_00 |");
    expect(markdown.indexOf("PECA_19")).toBeLessThan(markdown.indexOf("PECA_00"));
  });

  it("mesmo nome duas vezes no mesmo conjunto: o fim do ID desempata", () => {
    const { markdown } = rankingCriativosRelatorio({
      ...entradaLp,
      campanhas: [
        {
          ...entradaLp.campanhas[0],
          anuncios: [
            { ad_id: "1111", nome: "PECA", conjunto_id: "s-prof", ativo: true },
            { ad_id: "2222", nome: "PECA", conjunto_id: "s-prof", ativo: true },
          ],
        },
      ],
      linhas: [linha({ ad_id: "1111", gasto: 2 }), linha({ ad_id: "2222", gasto: 1 })],
    });
    expect(markdown).toContain("| 1 | PECA (…1111) |");
    expect(markdown).toContain("| 2 | PECA (…2222) |");
  });

  it("duas campanhas de bases diferentes: coluna de campanha e a base de cada uma", () => {
    const { markdown } = rankingCriativosRelatorio({
      periodo: { inicio: "2026-10-12", fim: "2026-10-13" },
      campanhas: [
        {
          campaign_id: "111",
          nome: "LP_FORM",
          base: "formularios",
          conjuntos: [{ conjunto_id: "f1", nome: "CONJ_F" }],
          anuncios: [{ ad_id: "fa", nome: "AD_F", conjunto_id: "f1", ativo: true }],
        },
        {
          campaign_id: "222",
          nome: "WA_CONV",
          base: "conversas",
          conjuntos: [{ conjunto_id: "w1", nome: "[LF | CONV] W1" }],
          anuncios: [{ ad_id: "wa", nome: "AD_W", conjunto_id: "w1", ativo: true }],
        },
      ],
      linhas: [
        linha({
          dia: "2026-10-12",
          campaign_id: "111",
          conjunto_id: "f1",
          ad_id: "fa",
          gasto: 30,
          impressoes: 600,
          cliques_link: 6,
          formularios: 3,
        }),
        linha({
          dia: "2026-10-13",
          campaign_id: "222",
          conjunto_id: "w1",
          ad_id: "wa",
          gasto: 40,
          impressoes: 900,
          cliques_link: 12,
          conversas: 5,
        }),
      ],
    });
    expect(markdown).toContain(
      "| # | Criativo | Conjunto | Campanha | Gasto | Impressões | Cliques no link | CTR | Resultados | Custo por resultado |",
    );
    expect(markdown).toContain(
      "| 1 | AD_W | [LF \\| CONV] W1 | WA_CONV | R$ 40,00 | 900 | 12 | 1,33% | 5 | R$ 8,00 |",
    );
    expect(markdown).toContain(
      "| 2 | AD_F | CONJ_F | LP_FORM | R$ 30,00 | 600 | 6 | 1,00% | 3 | R$ 10,00 |",
    );
    expect(markdown).toMatch(/LP_FORM: formulários enviados; WA_CONV: conversas iniciadas/);
    expect(markdown).toMatch(/de 12\/10 a 13\/10/);
  });

  it("sem nenhuma entrega na janela diz isso; entrada inválida não gera nada", () => {
    const { markdown, total } = rankingCriativosRelatorio({
      ...entradaLp,
      campanhas: [{ ...entradaLp.campanhas[0], anuncios: [] }],
      linhas: [],
    });
    expect(total).toBe(0);
    expect(markdown).toBe("Nenhum criativo com entrega registrada em 16/10.");
    expect(rankingCriativosRelatorio(null).markdown).toBe("");
    expect(rankingCriativosRelatorio({ periodo: { inicio: "x", fim: "y" } }).markdown).toBe("");
  });
});

describe("injetarRankingCriativosNoMarkdown", () => {
  const tabela =
    "Todos os 2 criativo(s).\n\n| # | Criativo | Conjunto |\n|---|---|---|\n| 1 | A | C1 |";

  it("troca a tabela da IA pela completa e mantém a leitura dela embaixo", () => {
    const md = injetarRankingCriativosNoMarkdown({
      md: "## Conjuntos e estrutura\nx\n\n## Ranking de criativos\n\n| Peça | Gasto |\n|---|---|\n| A | R$ 1 |\nSó A tem amostra que não é pequena.\n\n## Ranking de conjuntos\ny",
      tabela,
    });
    expect(md).not.toContain("| Peça | Gasto |");
    expect(md).toContain(
      `## Ranking de criativos\n\n${tabela}\n\nSó A tem amostra que não é pequena.`,
    );
    expect(md.indexOf("Só A tem amostra")).toBeLessThan(md.indexOf("## Ranking de conjuntos"));
    expect(md).toContain("## Conjuntos e estrutura\nx");
  });

  it("sem a seção, entra antes da próxima do catálogo", () => {
    const md = injetarRankingCriativosNoMarkdown({
      md: "## Conjuntos e estrutura\nx\n\n## Fadiga de criativo\nf",
      tabela,
    });
    expect(md.indexOf("## Ranking de criativos")).toBeGreaterThan(md.indexOf("x"));
    expect(md.indexOf("## Ranking de criativos")).toBeLessThan(md.indexOf("## Fadiga de criativo"));
  });

  it("tabela vazia não mexe no texto", () => {
    expect(injetarRankingCriativosNoMarkdown({ md: "## Resumo executivo\nx", tabela: "" })).toBe(
      "## Resumo executivo\nx",
    );
  });
});
