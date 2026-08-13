import { describe, it, expect, vi, afterEach } from "vitest";
import {
  withFilterDefaults,
  resolveRange,
  hasActiveFilters,
  isPeriodNarrowed,
  validateFilterSearch,
  cleanFilterSearch,
  matchesStatus,
  todayISO,
  MIN_DATE_FALLBACK,
} from "./filters";

// Os filtros vivem na URL: o que entra vem de query param, ou seja de fora e
// sem garantia nenhuma. Estes testes prendem o contrato de validacao e o
// calculo de periodo, que alimenta toda consulta ao Supabase.

const MIN = "2026-03-03";

afterEach(() => {
  vi.useRealTimers();
});

/** Congela o relogio para os presets relativos serem deterministicos. */
function congelarEm(iso: string) {
  vi.useFakeTimers();
  vi.setSystemTime(new Date(`${iso}T12:00:00`));
}

describe("withFilterDefaults", () => {
  it("aplica os defaults num objeto vazio", () => {
    expect(withFilterDefaults({})).toEqual({
      company: undefined,
      preset: "all",
      start: undefined,
      end: undefined,
      status: "all",
      tipo: "all",
      platform: "meta",
    });
  });

  it("preserva o que veio e nao sobrescreve com default", () => {
    const s = withFilterDefaults({ preset: "7d", status: "paused", tipo: "leadgen" });
    expect(s.preset).toBe("7d");
    expect(s.status).toBe("paused");
    expect(s.tipo).toBe("leadgen");
    expect(s.platform).toBe("meta");
  });
});

describe("resolveRange", () => {
  it('"all" vai do primeiro dia de dados ate hoje', () => {
    congelarEm("2026-08-13");
    expect(resolveRange(withFilterDefaults({}), MIN)).toEqual({
      start: MIN,
      end: "2026-08-13",
    });
  });

  it('"7d" cobre 7 dias INCLUINDO hoje (subDays de 6, nao de 7)', () => {
    congelarEm("2026-08-13");
    // A distincao importa: subDays(7) daria 8 dias de janela e inflaria todo
    // numero acumulado da tela em um dia.
    expect(resolveRange(withFilterDefaults({ preset: "7d" }), MIN)).toEqual({
      start: "2026-08-07",
      end: "2026-08-13",
    });
  });

  it('"30d" cobre 30 dias incluindo hoje', () => {
    congelarEm("2026-08-13");
    expect(resolveRange(withFilterDefaults({ preset: "30d" }), MIN)).toEqual({
      start: "2026-07-15",
      end: "2026-08-13",
    });
  });

  it('"month" comeca no dia 1 do mes corrente', () => {
    congelarEm("2026-08-13");
    expect(resolveRange(withFilterDefaults({ preset: "month" }), MIN)).toEqual({
      start: "2026-08-01",
      end: "2026-08-13",
    });
  });

  it('"month" no dia 1 devolve um range de um unico dia', () => {
    congelarEm("2026-08-01");
    expect(resolveRange(withFilterDefaults({ preset: "month" }), MIN)).toEqual({
      start: "2026-08-01",
      end: "2026-08-01",
    });
  });

  it('"7d" atravessa a virada de mes sem quebrar', () => {
    congelarEm("2026-03-02");
    expect(resolveRange(withFilterDefaults({ preset: "7d" }), MIN)).toEqual({
      start: "2026-02-24",
      end: "2026-03-02",
    });
  });

  it('"custom" usa start/end informados', () => {
    congelarEm("2026-08-13");
    const f = withFilterDefaults({ preset: "custom", start: "2026-05-01", end: "2026-05-31" });
    expect(resolveRange(f, MIN)).toEqual({ start: "2026-05-01", end: "2026-05-31" });
  });

  it('"custom" sem start cai no minDate, e sem end cai em hoje', () => {
    congelarEm("2026-08-13");
    expect(resolveRange(withFilterDefaults({ preset: "custom" }), MIN)).toEqual({
      start: MIN,
      end: "2026-08-13",
    });
  });

  it("preset desconhecido cai no comportamento de 'all' em vez de estourar", () => {
    congelarEm("2026-08-13");
    const f = { ...withFilterDefaults({}), preset: "seculo" as never };
    expect(resolveRange(f, MIN)).toEqual({ start: MIN, end: "2026-08-13" });
  });
});

describe("hasActiveFilters / isPeriodNarrowed", () => {
  it("estado default nao tem filtro ativo nem periodo estreitado", () => {
    const f = withFilterDefaults({});
    expect(hasActiveFilters(f)).toBe(false);
    expect(isPeriodNarrowed(f)).toBe(false);
  });

  it.each([
    ["preset", { preset: "7d" as const }],
    ["status", { status: "active" as const }],
    ["tipo", { tipo: "leadgen" as const }],
  ])("qualquer alteracao em %s liga hasActiveFilters", (_campo, patch) => {
    expect(hasActiveFilters(withFilterDefaults(patch))).toBe(true);
  });

  it("empresa selecionada NAO conta como filtro ativo (o seletor e do header)", () => {
    const f = withFilterDefaults({ company: "8f1e2c3d-4a5b-6c7d-8e9f-0a1b2c3d4e5f" });
    expect(hasActiveFilters(f)).toBe(false);
  });

  it("isPeriodNarrowed olha so o periodo, nao status nem tipo", () => {
    expect(isPeriodNarrowed(withFilterDefaults({ status: "paused" }))).toBe(false);
    expect(isPeriodNarrowed(withFilterDefaults({ preset: "month" }))).toBe(true);
  });
});

describe("validateFilterSearch", () => {
  it("descarta tudo que nao reconhece", () => {
    expect(
      validateFilterSearch({
        company: "nao-e-uuid",
        preset: "decada",
        start: "13/08/2026",
        end: "",
        status: "arquivado",
        platform: "tiktok",
        lixo: 1,
      }),
    ).toEqual({});
  });

  it("aceita os valores validos", () => {
    const uuid = "8f1e2c3d-4a5b-6c7d-8e9f-0a1b2c3d4e5f";
    expect(
      validateFilterSearch({
        company: uuid,
        preset: "30d",
        start: "2026-01-01",
        end: "2026-01-31",
        status: "active",
        tipo: "leadgen",
        platform: "meta",
      }),
    ).toEqual({
      company: uuid,
      preset: "30d",
      start: "2026-01-01",
      end: "2026-01-31",
      status: "active",
      tipo: "leadgen",
      platform: "meta",
    });
  });

  it("nao deixa passar tipo nao-string", () => {
    expect(validateFilterSearch({ tipo: 42 })).toEqual({});
    expect(validateFilterSearch({ tipo: null })).toEqual({});
  });

  // --- Frouxuras REAIS da validacao, presas aqui de proposito ---------------
  // Nao sao bugs de alto impacto (o consumidor trata valor desconhecido como
  // "sem filtro"), mas sao contrato: se alguem apertar a validacao, estes dois
  // testes falham e a mudanca fica consciente em vez de silenciosa.

  it("DOCUMENTA: tipo aceita qualquer string, nao ha whitelist", () => {
    expect(validateFilterSearch({ tipo: "categoria-que-nao-existe" })).toEqual({
      tipo: "categoria-que-nao-existe",
    });
  });

  it("DOCUMENTA: o regex de uuid so checa formato frouxo, nao a estrutura", () => {
    // /^[0-9a-f-]{36}$/i aceita 36 hifens; um uuid de verdade tem os hifens em
    // posicoes fixas. Consequencia pratica: um company invalido chega ao
    // Supabase e volta vazio, em vez de ser recusado aqui.
    expect(validateFilterSearch({ company: "-".repeat(36) })).toEqual({
      company: "-".repeat(36),
    });
    // e recusa o comprimento errado, que e o que segura o caso comum
    expect(validateFilterSearch({ company: "-".repeat(35) })).toEqual({});
  });
});

describe("cleanFilterSearch", () => {
  it("remove os defaults para a URL ficar curta", () => {
    expect(cleanFilterSearch({ preset: "all", status: "all", tipo: "all" })).toEqual({});
  });

  it("mantem os nao-default", () => {
    expect(cleanFilterSearch({ preset: "7d", status: "active", tipo: "leadgen" })).toEqual({
      preset: "7d",
      status: "active",
      tipo: "leadgen",
    });
  });

  it("so escreve start/end quando o preset e custom", () => {
    expect(cleanFilterSearch({ preset: "7d", start: "2026-01-01", end: "2026-01-31" })).toEqual({
      preset: "7d",
    });
    expect(cleanFilterSearch({ preset: "custom", start: "2026-01-01", end: "2026-01-31" })).toEqual(
      { preset: "custom", start: "2026-01-01", end: "2026-01-31" },
    );
  });

  it("nunca escreve platform (ha so uma hoje)", () => {
    expect(cleanFilterSearch({ platform: "meta" })).toEqual({});
  });

  it("ida e volta: cleanFilterSearch -> validateFilterSearch preserva o estado", () => {
    const original = { preset: "custom" as const, start: "2026-01-01", end: "2026-01-31" };
    const naUrl = cleanFilterSearch(original);
    expect(validateFilterSearch(naUrl as Record<string, unknown>)).toEqual(original);
  });
});

describe("matchesStatus", () => {
  it('filtro "all" aceita qualquer coisa, inclusive vazio', () => {
    for (const raw of ["ACTIVE", "PAUSED", "ARCHIVED", ""]) {
      expect(matchesStatus(raw, "all")).toBe(true);
    }
  });

  it("compara sem diferenciar maiuscula/minuscula", () => {
    expect(matchesStatus("active", "active")).toBe(true);
    expect(matchesStatus("Active", "active")).toBe(true);
    expect(matchesStatus("ACTIVE", "active")).toBe(true);
  });

  it("trata as variantes de pausa da Meta como nao-ativas", () => {
    // effective_status de ad/adset tem varias formas de pausado; a regra do
    // codigo e "ativo == ACTIVE, todo o resto e pausado".
    for (const raw of ["PAUSED", "ADSET_PAUSED", "CAMPAIGN_PAUSED", "ARCHIVED", "DELETED"]) {
      expect(matchesStatus(raw, "paused")).toBe(true);
      expect(matchesStatus(raw, "active")).toBe(false);
    }
  });

  it("status vazio/indefinido conta como pausado, nunca como ativo", () => {
    expect(matchesStatus("", "active")).toBe(false);
    expect(matchesStatus("", "paused")).toBe(true);
    expect(matchesStatus(undefined as unknown as string, "active")).toBe(false);
    expect(matchesStatus(undefined as unknown as string, "paused")).toBe(true);
  });
});

describe("todayISO", () => {
  it("formata como yyyy-MM-dd", () => {
    congelarEm("2026-08-13");
    expect(todayISO()).toBe("2026-08-13");
  });

  it("usa a data LOCAL, nao UTC (o banco guarda snapshot_date local)", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 7, 13, 23, 30, 0));
    expect(todayISO()).toBe("2026-08-13");
  });
});

describe("MIN_DATE_FALLBACK", () => {
  it("e uma data ISO valida (usada quando a consulta de min falha)", () => {
    expect(MIN_DATE_FALLBACK).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(Number.isNaN(Date.parse(MIN_DATE_FALLBACK))).toBe(false);
  });
});
