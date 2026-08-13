import { describe, it, expect } from "vitest";
import {
  maiorUrgencia,
  persistente,
  destinoNotificacao,
  agruparPorTitulo,
  haQuanto,
  textoExpiracao,
  expirado,
  primeiraLinha,
  planejarToasts,
  rotuloGrupo,
  URGENCIA,
  NOTIFICACOES_VAZIAS,
  TOASTS_MAX,
  type ItemNotificacao,
  type UrgenciaNotif,
  type EventoRealtime,
} from "./notificacoes";
import { ehNovaPendencia } from "./notificacoes";

// O sino decide o que INTERROMPE o gestor. Errar para mais vira ruido e ensina
// a ignorar o sino; errar para menos esconde pedido que expira em 24h. As duas
// falhas sao silenciosas, por isso valem teste.

const AGORA = Date.parse("2026-08-13T12:00:00Z");

function item(over: Partial<ItemNotificacao> = {}): ItemNotificacao {
  return {
    id: "n1",
    tipo: "aprovacao",
    titulo: "Escalar orçamento",
    descricao: null,
    urgencia: "medium",
    created_at: "2026-08-13T11:00:00Z",
    expires_at: null,
    minutos_para_expirar: null,
    conversation_id: null,
    ...over,
  };
}

describe("maiorUrgencia", () => {
  it("escolhe a pior do conjunto", () => {
    expect(
      maiorUrgencia([{ urgencia: "low" }, { urgencia: "critical" }, { urgencia: "medium" }]),
    ).toBe("critical");
    expect(maiorUrgencia([{ urgencia: "medium" }, { urgencia: "high" }])).toBe("high");
  });

  it("conjunto vazio devolve low (nao interrompe ninguem)", () => {
    expect(maiorUrgencia([])).toBe("low");
  });

  it("respeita a ordem critical > high > medium > low", () => {
    const ordem: UrgenciaNotif[] = ["critical", "high", "medium", "low"];
    for (let i = 0; i < ordem.length; i++) {
      for (let j = i + 1; j < ordem.length; j++) {
        expect(maiorUrgencia([{ urgencia: ordem[j] }, { urgencia: ordem[i] }])).toBe(ordem[i]);
      }
    }
  });
});

describe("persistente", () => {
  it("critical e high nao somem sozinhos", () => {
    expect(persistente("critical")).toBe(true);
    expect(persistente("high")).toBe(true);
  });

  it("medium e low saem sozinhos", () => {
    expect(persistente("medium")).toBe(false);
    expect(persistente("low")).toBe(false);
  });

  it("bate com a convencao de cor vermelha do URGENCIA", () => {
    // As duas coisas dizem "isto e grave"; divergir faria o toast vermelho
    // sumir sozinho, ou o cinza ficar preso na tela.
    for (const u of Object.keys(URGENCIA) as UrgenciaNotif[]) {
      expect(persistente(u)).toBe(URGENCIA[u].vermelha);
    }
  });
});

describe("destinoNotificacao", () => {
  it("alerta vai para /alertas com o item destacado", () => {
    expect(destinoNotificacao(item({ tipo: "alerta", id: "a9" }))).toEqual({
      pathname: "/alertas",
      search: { item: "a9" },
    });
  });

  it("aprovacao vai para a aba Aprovações da Operação, nao para /aprovacoes", () => {
    // /aprovacoes segue oculta por feature-flag; mandar para la daria tela vazia.
    expect(destinoNotificacao(item({ tipo: "aprovacao", id: "p3" }))).toEqual({
      pathname: "/recomendacoes",
      search: { tab: "aprovacoes", item: "p3" },
    });
  });
});

describe("agruparPorTitulo", () => {
  it("junta itens de mesmo tipo e titulo, contando", () => {
    const g = agruparPorTitulo([
      item({ id: "1", titulo: "Jobs internos com falha" }),
      item({ id: "2", titulo: "Jobs internos com falha" }),
      item({ id: "3", titulo: "Outro" }),
    ]);
    expect(g).toHaveLength(2);
    expect(g[0]).toMatchObject({ quantidade: 2 });
    expect(g[1]).toMatchObject({ quantidade: 1 });
  });

  it("o representante e o PRIMEIRO do grupo (a RPC ja ordena por urgencia)", () => {
    const g = agruparPorTitulo([
      item({ id: "primeiro", urgencia: "critical" }),
      item({ id: "segundo", urgencia: "low" }),
    ]);
    expect(g[0].principal.id).toBe("primeiro");
  });

  it("mesmo titulo em tipos diferentes NAO se junta", () => {
    const g = agruparPorTitulo([
      item({ id: "1", tipo: "alerta", titulo: "Falha" }),
      item({ id: "2", tipo: "aprovacao", titulo: "Falha" }),
    ]);
    expect(g).toHaveLength(2);
  });

  it("preserva a ordem de chegada dos grupos", () => {
    const g = agruparPorTitulo([
      item({ titulo: "B" }),
      item({ titulo: "A" }),
      item({ titulo: "B" }),
    ]);
    expect(g.map((x) => x.principal.titulo)).toEqual(["B", "A"]);
  });

  it("lista vazia devolve vazio", () => {
    expect(agruparPorTitulo([])).toEqual([]);
  });
});

describe("haQuanto", () => {
  it.each([
    ["2026-08-13T11:59:30Z", "agora"],
    ["2026-08-13T11:57:00Z", "há 3 min"],
    ["2026-08-13T11:01:00Z", "há 59 min"],
    ["2026-08-13T11:00:00Z", "há 1h"],
    ["2026-08-13T02:00:00Z", "há 10h"],
    ["2026-08-12T11:00:00Z", "há 1 d"],
    ["2026-08-09T12:00:00Z", "há 4 d"],
  ])("%s -> %s", (iso, esperado) => {
    expect(haQuanto(iso, AGORA)).toBe(esperado);
  });

  it("vira de minuto para hora exatamente em 60 min", () => {
    expect(haQuanto("2026-08-13T11:00:59Z", AGORA)).toBe("há 59 min");
    expect(haQuanto("2026-08-13T11:00:00Z", AGORA)).toBe("há 1h");
  });

  it("data no futuro nao vira tempo negativo", () => {
    expect(haQuanto("2026-08-13T13:00:00Z", AGORA)).toBe("agora");
  });
});

describe("textoExpiracao", () => {
  it("sem expires_at nao mostra contador", () => {
    expect(textoExpiracao(null, AGORA)).toBeNull();
  });

  it.each([
    ["2026-08-13T12:30:00Z", "expira em 30min"],
    ["2026-08-13T14:00:00Z", "expira em 2h"],
    ["2026-08-13T14:45:00Z", "expira em 2h 45min"],
    ["2026-08-14T12:00:00Z", "expira em 24h"],
  ])("%s -> %s", (iso, esperado) => {
    expect(textoExpiracao(iso, AGORA)).toBe(esperado);
  });

  it("omite os minutos quando sao exatamente zero", () => {
    expect(textoExpiracao("2026-08-13T15:00:00Z", AGORA)).toBe("expira em 3h");
  });

  it("no instante do vencimento e depois, diz expirado", () => {
    expect(textoExpiracao("2026-08-13T12:00:00Z", AGORA)).toBe("expirado");
    expect(textoExpiracao("2026-08-13T10:00:00Z", AGORA)).toBe("expirado");
  });
});

describe("expirado", () => {
  it("null nunca esta expirado", () => {
    expect(expirado(null, AGORA)).toBe(false);
  });

  it("passado sim, futuro nao, e o instante exato conta como expirado", () => {
    expect(expirado("2026-08-13T11:59:59Z", AGORA)).toBe(true);
    expect(expirado("2026-08-13T12:00:00Z", AGORA)).toBe(true);
    expect(expirado("2026-08-13T12:00:01Z", AGORA)).toBe(false);
  });

  it("concorda com textoExpiracao no limite", () => {
    const iso = "2026-08-13T12:00:00Z";
    expect(expirado(iso, AGORA)).toBe(true);
    expect(textoExpiracao(iso, AGORA)).toBe("expirado");
  });
});

describe("primeiraLinha", () => {
  it("null e vazio viram string vazia", () => {
    expect(primeiraLinha(null)).toBe("");
    expect(primeiraLinha("")).toBe("");
  });

  it("pega so a primeira linha e apara", () => {
    expect(primeiraLinha("  Titulo  \nsegunda linha\nterceira")).toBe("Titulo");
  });

  it("trunca com reticencia respeitando o maximo TOTAL", () => {
    const texto = "a".repeat(200);
    const saida = primeiraLinha(texto, 120);
    expect(saida).toHaveLength(120);
    expect(saida.endsWith("…")).toBe(true);
  });

  it("no limite exato nao trunca", () => {
    expect(primeiraLinha("a".repeat(120), 120)).toBe("a".repeat(120));
    expect(primeiraLinha("a".repeat(121), 120)).toHaveLength(120);
  });
});

describe("ehNovaPendencia — o filtro do realtime", () => {
  const ev = (o: Partial<EventoRealtime>): EventoRealtime => ({ eventType: "INSERT", ...o });

  it("DELETE nunca e novidade", () => {
    expect(
      ehNovaPendencia(ev({ eventType: "DELETE", old: { status: "pending" } }), "aprovacao"),
    ).toBe(false);
  });

  it("INSERT de aprovacao pendente e novidade", () => {
    expect(ehNovaPendencia(ev({ new: { status: "pending" } }), "aprovacao")).toBe(true);
  });

  it("INSERT de aprovacao ja decidida NAO e novidade", () => {
    expect(ehNovaPendencia(ev({ new: { status: "approved" } }), "aprovacao")).toBe(false);
  });

  it("INSERT de alerta aberto e novidade; resolvido nao", () => {
    expect(ehNovaPendencia(ev({ new: { resolved: false } }), "alerta")).toBe(true);
    expect(ehNovaPendencia(ev({ new: { resolved: true } }), "alerta")).toBe(false);
  });

  it("DECIDIR uma aprovacao nao vira toast", () => {
    // Muda a lista do sino, mas nao e novidade - o gestor acabou de decidir.
    expect(
      ehNovaPendencia(
        ev({ eventType: "UPDATE", old: { status: "pending" }, new: { status: "approved" } }),
        "aprovacao",
      ),
    ).toBe(false);
  });

  it("RESOLVER um alerta nao vira toast", () => {
    expect(
      ehNovaPendencia(
        ev({ eventType: "UPDATE", old: { resolved: false }, new: { resolved: true } }),
        "alerta",
      ),
    ).toBe(false);
  });

  it("REABRIR (decidido -> pendente) e novidade", () => {
    expect(
      ehNovaPendencia(
        ev({ eventType: "UPDATE", old: { status: "approved" }, new: { status: "pending" } }),
        "aprovacao",
      ),
    ).toBe(true);
  });

  it("UPDATE que nao muda o estado aberto NAO repete o toast", () => {
    expect(
      ehNovaPendencia(
        ev({ eventType: "UPDATE", old: { status: "pending" }, new: { status: "pending" } }),
        "aprovacao",
      ),
    ).toBe(false);
  });

  it("DOCUMENTA: sem REPLICA IDENTITY FULL, todo UPDATE vira toast", () => {
    // Sem ela o Postgres nao manda o registro antigo; `old` chega vazio, a
    // funcao nao tem como saber que o item ja estava aberto e trata como novo.
    // Se o sino comecar a repetir aviso, conferir a replica identity da tabela
    // ANTES de mexer nesta funcao.
    expect(
      ehNovaPendencia(
        ev({ eventType: "UPDATE", old: null, new: { status: "pending" } }),
        "aprovacao",
      ),
    ).toBe(true);
  });
});

describe("planejarToasts", () => {
  const n = (q: number) => Array.from({ length: q }, (_, i) => item({ id: `i${i}` }));

  it("3 ou mais de uma vez colapsam num toast so (rajada de cron)", () => {
    const r = planejarToasts(n(3), 0);
    expect(r.individuais).toHaveLength(0);
    expect(r.agrupado).toHaveLength(3);
    expect(planejarToasts(n(10), 0).agrupado).toHaveLength(10);
  });

  it("cabendo no teto, cada um vira toast proprio", () => {
    const r = planejarToasts(n(2), 0);
    expect(r.individuais).toHaveLength(2);
    expect(r.agrupado).toHaveLength(0);
  });

  it("sem espaco, 2 novos colapsam", () => {
    const r = planejarToasts(n(2), TOASTS_MAX);
    expect(r.individuais).toHaveLength(0);
    expect(r.agrupado).toHaveLength(2);
  });

  it("UM item sozinho nunca colapsa, mesmo sem espaco", () => {
    // Colapsar um so nao economiza toast e ainda perde o destino direto.
    const r = planejarToasts(n(1), TOASTS_MAX);
    expect(r.individuais).toHaveLength(1);
    expect(r.agrupado).toHaveLength(0);
  });

  it("com 1 vaga e 2 novos, mostra os dois em vez de colapsar um", () => {
    // O agrupado ficaria com 1 item, e a regra acima vale: melhor os dois
    // individuais do que um toast agrupado de um item so.
    const r = planejarToasts(n(2), TOASTS_MAX - 1);
    expect(r.individuais).toHaveLength(2);
    expect(r.agrupado).toHaveLength(0);
  });

  it("nenhum novo nao planeja nada", () => {
    expect(planejarToasts([], 0)).toEqual({ individuais: [], agrupado: [] });
  });

  it("mais ativos que o teto nao gera espaco negativo", () => {
    const r = planejarToasts(n(2), 99);
    expect(r.individuais).toHaveLength(0);
    expect(r.agrupado).toHaveLength(2);
  });

  it("nenhum item se perde entre individuais e agrupado", () => {
    for (let novos = 0; novos <= 5; novos++) {
      for (let ativos = 0; ativos <= 4; ativos++) {
        const r = planejarToasts(n(novos), ativos);
        expect(r.individuais.length + r.agrupado.length).toBeGreaterThanOrEqual(novos);
      }
    }
  });
});

describe("rotuloGrupo", () => {
  it("so alertas, com plural correto", () => {
    expect(rotuloGrupo([item({ tipo: "alerta" })])).toBe("1 novo alerta");
    expect(rotuloGrupo([item({ tipo: "alerta" }), item({ tipo: "alerta" })])).toBe(
      "2 novos alertas",
    );
  });

  it("so aprovacoes, com plural correto", () => {
    expect(rotuloGrupo([item({ tipo: "aprovacao" })])).toBe("1 novo pedido de aprovação");
    expect(rotuloGrupo([item({ tipo: "aprovacao" }), item({ tipo: "aprovacao" })])).toBe(
      "2 novos pedidos de aprovação",
    );
  });

  it("misturado usa o termo neutro, sem mentir sobre o tipo", () => {
    expect(rotuloGrupo([item({ tipo: "alerta" }), item({ tipo: "aprovacao" })])).toBe(
      "2 novas pendências",
    );
  });

  it("DOCUMENTA: lista vazia cai no ramo de alertas (every de vazio e true)", () => {
    // `[].every(...)` e true para as duas checagens, e a de alertas vem primeiro.
    // Nao acontece no fluxo real (so se chama com grupo nao-vazio), mas se um dia
    // chamar, o texto sai torto em vez de estourar.
    expect(rotuloGrupo([])).toBe("0 novos alertas");
  });
});

describe("NOTIFICACOES_VAZIAS", () => {
  it("e o estado zero coerente, usado antes do primeiro fetch", () => {
    expect(NOTIFICACOES_VAZIAS).toEqual({
      total: 0,
      aprovacoes_pendentes: 0,
      alertas_abertos: 0,
      criticos: 0,
      expirando_em_2h: 0,
      itens: [],
    });
  });
});
