import { describe, expect, it } from "vitest";
import {
  apresentarRecomendacao,
  rotuloFamiliaRecomendacao,
  type RecoBruta,
} from "./recomendacao-texto";

const JARGAO = /Graph|GET \/act_|SEM_REGUA|doutrina\/RPC|opportunity_score=|veredito interno|\[auto:|fadiga\.ctr_freq|cliques_no_link\/impressoes|pipeboard|blame_field|meta_recommendations|object account|act_\d+/i;

function junta(r: RecoBruta) {
  const a = apresentarRecomendacao(r);
  return {
    a,
    texto: [
      a.titulo,
      a.onde,
      a.assunto,
      a.proposta,
      a.opiniao,
      a.opiniaoRotulo,
      a.urgencia,
      a.familia,
      ...a.numeros.map((n) => `${n.rotulo} ${n.valor}`),
      a.desde,
    ]
      .filter(Boolean)
      .join("\n"),
  };
}

describe("nota da Meta na conta (Opportunity Score)", () => {
  const reco: RecoBruta = {
    title: "Meta: Opportunity Score da conta: 97",
    description:
      'Dica da Meta coletada em 11/09/2026 | objeto account "act_1622612945584817".\n\n' +
      "A Graph devolveu opportunity_score=97 para act_1622612945584817, mas a lista GET /act_*/recommendations veio vazia. Badge do Ads Manager pode existir mesmo assim.\n\n" +
      "Veredito interno: SEM_REGUA -- Nenhuma doutrina/RPC cobre este tipo de dica ainda. A dica foi guardada; nao vira concordancia por omissao.\n" +
      "Fonte: Graph Opportunity Score /act_*/recommendations (meta-campaign-status).",
    impact: "low",
    family: "meta_dica",
    signal_key: "meta.dica.opportunity_score.snapshot",
    entity_type: "account",
    entity_name: "act_1622612945584817",
    maturity_days: 0,
    evidence_json: {
      fonte: "meta_recommendations",
      veredito: "sem_regua",
      importance: "LOW",
      blame_field: "opportunity_score",
      first_seen_on: "2026-09-11",
      opportunity_score: 97,
    },
  };

  it("explica a nota, diz que não há o que fazer e dá a opinião do SuperGestor", () => {
    const { a, texto } = junta(reco);
    expect(a.titulo).toMatch(/nota 97/i);
    expect(a.assunto).toMatch(/meta/i);
    expect(a.proposta).toMatch(/não (enviou|pediu)|nenhuma dica|nada para aplicar/i);
    expect(a.opiniaoRotulo).toMatch(/não precisa agir/i);
    expect(a.opiniao).toMatch(/super\s*gestor/i);
    expect(a.urgencia).toBe("Prioridade baixa");
    expect(a.familia).toBe("Dica da Meta");
    expect(a.onde).toMatch(/conta/i);
    expect(a.onde).not.toMatch(/0 dias/i);
    expect(texto).not.toMatch(JARGAO);
  });
});

describe("fadiga de criativo", () => {
  const reco: RecoBruta = {
    title: "Criativo com sinal de fadiga: AD_CONJ.4_APENAS_OCULOS_7",
    description:
      'Anuncio "AD_CONJ.4_APENAS_OCULOS_7" (campanha COHAPM_VISTTA_CONV_WA_SET26): CTR de link caiu de 0.97% (media 3 dias anteriores) para 0.00% no ultimo dia, com frequencia de 1.13 para 1.47. Base = cliques_no_link/impressoes. Maturidade: 9 dias de entrega. Avaliar refresh de peca ou troca de angulo. [auto: detector]',
    impact: "high",
    family: "criativo_fadiga",
    signal_key: "fadiga.ctr_freq",
    entity_type: "ad",
    entity_name: "AD_CONJ.4_APENAS_OCULOS_7",
    maturity_days: 9,
    evidence_json: {
      fonte: "metric_snapshots+ad_metric_snapshots",
      dias_entrega: 9,
      ctr_link_ultimo: 0,
      ctr_link_base_3d: 0.97,
      frequencia_ultimo: 1.47,
      frequencia_base: 1.13,
      base_clique: "link",
    },
  };

  it("fala de anúncio cansado, da proposta e da opinião a favor de olhar", () => {
    const { a, texto } = junta(reco);
    expect(a.titulo).toMatch(/cans/i);
    expect(a.assunto).toMatch(/clique/i);
    expect(a.proposta).toMatch(/peça|ângulo|trocar/i);
    expect(a.opiniaoRotulo).toMatch(/vale (fazer|olhar)/i);
    expect(a.opiniao).toMatch(/super\s*gestor/i);
    expect(a.urgencia).toBe("Prioridade alta");
    expect(a.familia).toBe("Fadiga de criativo");
    expect(a.onde).toMatch(/anúncio/i);
    expect(a.onde).toMatch(/9 dias/i);
    expect(a.numeros.some((n) => /clique/i.test(n.rotulo))).toBe(true);
    expect(texto).not.toMatch(JARGAO);
  });
});

describe("dica da Meta com julgamento", () => {
  it("discorda em linguagem de gestor, sem código interno", () => {
    const { a, texto } = junta({
      title: "Meta: Use campaign budget optimization",
      description:
        "Dica da Meta coletada em 11/09/2026 | objeto campaign \"CAMP\".\n\n" +
        "A Meta sugere ativar CBO.\n\n" +
        "Veredito interno: DISCORDA -- CBO/orcamento na campanha redistribui verba entre conjuntos.\n" +
        "Fonte: Graph recommendations (pipeboard/meta-campaign-status).",
      impact: "medium",
      family: "meta_dica",
      signal_key: "meta.dica.cbo",
      entity_type: "campaign",
      entity_name: "CAMP",
      evidence_json: { fonte: "meta_recommendations", veredito: "discorda" },
    });
    expect(a.rotuloProposta).toMatch(/meta pediu/i);
    expect(a.opiniaoRotulo).toMatch(/não siga/i);
    expect(a.opiniao).toMatch(/super\s*gestor/i);
    expect(texto).not.toMatch(JARGAO);
  });

  it("concorda quando a dica é um bloqueio mecânico", () => {
    const { a } = junta({
      title: "Meta: Anúncio reprovado",
      description: "Corrija a reprovação.\n\nVeredito interno: CONCORDA -- Dica mecanica.",
      family: "meta_dica",
      signal_key: "meta.dica.rejected",
      evidence_json: { veredito: "concorda" },
    });
    expect(a.opiniaoRotulo).toMatch(/concorda|vale fazer/i);
  });
});

describe("rótulos e fallback", () => {
  it("traduz família e urgência", () => {
    expect(rotuloFamiliaRecomendacao("custo_teto")).toBe("Custo acima da régua");
    expect(rotuloFamiliaRecomendacao("vencedor")).toBe("Criativo vencedor");
  });

  it("não despeja rascunho técnico mesmo sem sinal conhecido", () => {
    const { texto, a } = junta({
      title: "Algo novo",
      description:
        "Veredito interno: SEM_REGUA -- Nenhuma doutrina/RPC. Fonte: Graph. [auto: detector]",
      family: "geral",
      impact: "medium",
    });
    expect(a.titulo).toBe("Algo novo");
    expect(texto).not.toMatch(JARGAO);
    expect(a.opiniao).toMatch(/super\s*gestor/i);
  });
});
