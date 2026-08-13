import { describe, it, expect } from "vitest";
import {
  estadoExibido,
  mostrarMotivo,
  piorEstado,
  rankEstado,
  ehFantasma,
  rotuloProvedor,
  conectadaDesde,
  ESTADO_META,
  PROVEDOR_ROTULO,
  AVISO_NAO_VERIFICADA,
  type Integracao,
  type EstadoExibido,
} from "./integracoes";

// Este modulo existe por causa de um bug de confianca: ate 03/08/2026 o
// `integrations.status` nascia 'connected' por DEFAULT e 22 de 22 linhas diziam
// "conectada" - campo constante, sem informacao. A verdade estava em
// `estado_operacional`, e nao era exibida. A precedencia agora e explicita, e o
// que estes testes protegem e justamente ela: nao inventar verde.

function integracao(over: Partial<Integracao> = {}): Integracao {
  return {
    id: "i1",
    provider: "meta_ads",
    account_name: "Conta JCR2",
    external_id: "act_123",
    status: "connected",
    estado_operacional: "ativa",
    estado_motivo: null,
    connected_at: "2026-07-21T10:00:00Z",
    ...over,
  };
}

describe("estadoExibido — a precedencia", () => {
  it("sem linha nenhuma: desconectada", () => {
    expect(estadoExibido(null)).toBe("desconectada");
    expect(estadoExibido(undefined)).toBe("desconectada");
  });

  it("connected + ativa: conectada (o unico caminho para o verde)", () => {
    expect(estadoExibido(integracao())).toBe("conectada");
  });

  it("status manda mais que estado_operacional", () => {
    // Mesmo com estado_operacional='ativa', status<>'connected' vence: nao da
    // para chamar de conectada o que a plataforma nao confirmou.
    expect(estadoExibido(integracao({ status: "erro", estado_operacional: "ativa" }))).toBe("erro");
    expect(estadoExibido(integracao({ status: "revogada", estado_operacional: "ativa" }))).toBe(
      "revogada",
    );
  });

  it("erro e revogada mantem o proprio rotulo, nao viram 'nao verificada'", () => {
    // A edge de handshake grava status='erro' quando a plataforma recusa;
    // chamar isso de "nao verificada" esconderia exatamente a falha.
    expect(estadoExibido(integracao({ status: "erro" }))).toBe("erro");
    expect(estadoExibido(integracao({ status: "revogada" }))).toBe("revogada");
  });

  it("qualquer outro status vira nao_verificada", () => {
    for (const s of ["nao_verificada", "pendente", "", "sei_la"]) {
      expect(estadoExibido(integracao({ status: s }))).toBe("nao_verificada");
    }
  });

  it("connected mas nao operacional / em quarentena", () => {
    expect(estadoExibido(integracao({ estado_operacional: "nao_operacional" }))).toBe(
      "nao_operacional",
    );
    expect(estadoExibido(integracao({ estado_operacional: "quarentena" }))).toBe("quarentena");
  });

  it("vocabulario DESCONHECIDO em estado_operacional nao inventa verde", () => {
    // O teste mais importante do arquivo: diante de valor que o front nao
    // conhece, o default e ambar, nunca "conectada".
    for (const e of ["ativo", "", "novo_estado_do_backend"]) {
      expect(estadoExibido(integracao({ estado_operacional: e }))).toBe("nao_verificada");
    }
  });

  it("nunca devolve estado fora do vocabulario declarado", () => {
    const validos = Object.keys(ESTADO_META);
    const combos = ["connected", "erro", "revogada", "x"].flatMap((status) =>
      ["ativa", "quarentena", "nao_operacional", "y"].map((eo) =>
        estadoExibido(integracao({ status, estado_operacional: eo })),
      ),
    );
    for (const c of combos) expect(validos).toContain(c);
  });
});

describe("ESTADO_META", () => {
  it("todo estado tem rotulo, tom e classe", () => {
    for (const [estado, meta] of Object.entries(ESTADO_META)) {
      expect(meta.rotulo, estado).toBeTruthy();
      expect(["verde", "ambar", "vermelho", "neutro"]).toContain(meta.tom);
      expect(meta.classe, estado).toBeTruthy();
    }
  });

  it("so 'conectada' e verde", () => {
    const verdes = Object.entries(ESTADO_META)
      .filter(([, m]) => m.tom === "verde")
      .map(([e]) => e);
    expect(verdes).toEqual(["conectada"]);
  });

  it("verificavel apenas onde reverificar resolve", () => {
    // nao_operacional e quarentena sao decisao do backend: botao de verificar
    // ali daria falsa sensacao de acao.
    expect(ESTADO_META.nao_verificada.verificavel).toBe(true);
    expect(ESTADO_META.erro.verificavel).toBe(true);
    expect(ESTADO_META.revogada.verificavel).toBe(true);
    expect(ESTADO_META.conectada.verificavel).toBe(false);
    expect(ESTADO_META.desconectada.verificavel).toBe(false);
    expect(ESTADO_META.nao_operacional.verificavel).toBe(false);
    expect(ESTADO_META.quarentena.verificavel).toBe(false);
  });
});

describe("mostrarMotivo", () => {
  it("verde e neutro dispensam explicacao", () => {
    expect(mostrarMotivo("conectada")).toBe(false);
    expect(mostrarMotivo("desconectada")).toBe(false);
  });

  it("nos demais o motivo e a informacao util", () => {
    for (const e of [
      "nao_verificada",
      "erro",
      "revogada",
      "nao_operacional",
      "quarentena",
    ] as EstadoExibido[]) {
      expect(mostrarMotivo(e)).toBe(true);
    }
  });
});

describe("piorEstado — rollup por provedor", () => {
  it("lista vazia e desconectada", () => {
    expect(piorEstado([])).toBe("desconectada");
  });

  it("nunca mostra verde tendo uma conta quebrada embaixo", () => {
    // A razao de existir: o cartao do provedor agrega varias contas.
    expect(piorEstado(["conectada", "erro"])).toBe("erro");
    expect(piorEstado(["conectada", "conectada", "quarentena"])).toBe("quarentena");
    expect(piorEstado(["conectada", "nao_operacional"])).toBe("nao_operacional");
  });

  it("erro vence revogada, que vence nao_operacional", () => {
    expect(piorEstado(["revogada", "erro"])).toBe("erro");
    expect(piorEstado(["nao_operacional", "revogada"])).toBe("revogada");
  });

  it("todas conectadas: conectada", () => {
    expect(piorEstado(["conectada", "conectada"])).toBe("conectada");
  });

  it("desconectada e o ultimo da ordem, perde de todo estado real", () => {
    expect(piorEstado(["desconectada", "conectada"])).toBe("conectada");
    expect(piorEstado(["desconectada"])).toBe("desconectada");
  });
});

describe("rankEstado — ordenacao da lista", () => {
  it("o que precisa de atencao vem primeiro", () => {
    expect(rankEstado("erro")).toBeLessThan(rankEstado("conectada"));
    expect(rankEstado("nao_verificada")).toBeLessThan(rankEstado("conectada"));
    expect(rankEstado("conectada")).toBeLessThan(rankEstado("desconectada"));
  });

  it("estado desconhecido vai para o fim em vez de para o topo", () => {
    expect(rankEstado("inventado" as EstadoExibido)).toBeGreaterThanOrEqual(
      rankEstado("desconectada"),
    );
  });

  it("concorda com piorEstado: o de menor rank e o pior", () => {
    const estados: EstadoExibido[] = ["conectada", "quarentena", "erro"];
    const porRank = [...estados].sort((a, b) => rankEstado(a) - rankEstado(b))[0];
    expect(porRank).toBe(piorEstado(estados));
  });
});

describe("ehFantasma", () => {
  it("sem external_id e nome igual ao provedor: fantasma", () => {
    // So possivel se nenhuma chamada a plataforma aconteceu - e sintoma, nao dado.
    expect(
      ehFantasma(integracao({ external_id: null, account_name: "Meta Ads" }), "Meta Ads"),
    ).toBe(true);
  });

  it("nao diferencia caixa nem espaco em volta", () => {
    expect(
      ehFantasma(integracao({ external_id: null, account_name: "  meta ads  " }), "Meta Ads"),
    ).toBe(true);
  });

  it("com external_id NAO e fantasma, mesmo com nome do provedor", () => {
    // Ter external_id prova que houve chamada a plataforma; o nome coincidir
    // com o do provedor passa a ser coincidencia, nao sintoma.
    expect(
      ehFantasma(integracao({ external_id: "act_9", account_name: "Meta Ads" }), "Meta Ads"),
    ).toBe(false);
  });

  it("nome real da conta nao e fantasma", () => {
    expect(
      ehFantasma(integracao({ external_id: null, account_name: "Conta JCR2" }), "Meta Ads"),
    ).toBe(false);
  });

  it("external_id vazio conta como ausente", () => {
    expect(ehFantasma(integracao({ external_id: "", account_name: "Meta Ads" }), "Meta Ads")).toBe(
      true,
    );
  });
});

describe("rotuloProvedor", () => {
  it("traduz os provedores conhecidos", () => {
    expect(rotuloProvedor("meta_ads")).toBe("Meta Ads");
    expect(rotuloProvedor("ga4")).toBe("Google Analytics 4");
    expect(rotuloProvedor("gsc")).toBe("Search Console");
  });

  it("provedor novo aparece cru em vez de virar undefined na tela", () => {
    expect(rotuloProvedor("tiktok_ads")).toBe("tiktok_ads");
  });

  it("todos os rotulos do mapa sao nao-vazios", () => {
    for (const [k, v] of Object.entries(PROVEDOR_ROTULO)) expect(v, k).toBeTruthy();
  });
});

describe("conectadaDesde", () => {
  it("formata em pt-BR", () => {
    expect(conectadaDesde("2026-07-21T10:00:00Z")).toBe("conectada desde 21/07/2026");
  });

  it("null devolve null — e nunca 'desde —'", () => {
    // O texto e opcional de proposito: melhor omitir a frase que exibi-la torta.
    expect(conectadaDesde(null)).toBeNull();
  });
});

describe("AVISO_NAO_VERIFICADA", () => {
  it("diz explicitamente que nenhum dado sera coletado", () => {
    // O ponto do aviso: registrado nao e conectado. Se o texto perder essa
    // frase, o usuario acha que a integracao esta funcionando.
    expect(AVISO_NAO_VERIFICADA).toMatch(/nenhum dado será coletado/i);
  });
});
