import { describe, expect, it } from "vitest";
import {
  campanhaEstaAtiva,
  CHAVES_SECAO_RELATORIO,
  especialistasPorSecoes,
  extrairJsonRelatorio,
  flattenCampanhasPipeboard,
  humanizarMarkdownRelatorio,
  mergeCampanhasRelatorio,
  normalizarAchados,
  periodoDaJanela,
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
    const md = humanizarMarkdownRelatorio("## resumo_executivo\nJanela fechada.\n## criativos_ranking\n- peça");
    expect(md).toContain("## Resumo executivo");
    expect(md).toContain("## Ranking de criativos");
    expect(md).not.toMatch(/^## resumo_executivo/m);
  });

  it("titulosDasSecoes usa o catálogo, não a chave crua", () => {
    expect(titulosDasSecoes(["custo_vs_teto"])).toEqual(["Custo versus teto vigente"]);
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
