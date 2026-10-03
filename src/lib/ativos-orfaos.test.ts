import { describe, expect, it } from "vitest";
import {
  MAX_ATIVOS_POR_CARD,
  conferenciaDaLista,
  dataBr,
  diaLimite,
  podeMarcar,
  type AtivoOrfao,
} from "./ativos-orfaos";

function ativo(over: Partial<AtivoOrfao> = {}): AtivoOrfao {
  return {
    tipo: "video",
    id: "1",
    nome: null,
    motivo: null,
    anuncios: [],
    ultimo_gasto_em: null,
    gasto_total: 0,
    bloqueado_por: null,
    duplicata_de: null,
    candidato: false,
    ...over,
  };
}

describe("seleção do card", () => {
  it("para no 25", () => {
    expect(podeMarcar(24, false)).toBe(true);
    expect(podeMarcar(MAX_ATIVOS_POR_CARD, false)).toBe(false);
    expect(podeMarcar(MAX_ATIVOS_POR_CARD, true)).toBe(true);
  });
});

describe("conferência", () => {
  const hoje = new Date("2026-10-03T15:00:00Z");

  it("aponta a cópia do 01. Setembro que fica", () => {
    const c = conferenciaDaLista(
      [
        ativo({
          id: "999",
          nome: "01. Setembro.mp4",
          motivo: "duplicata",
          duplicata_de: "1596865345181641",
          candidato: true,
        }),
        ativo({
          id: "1596865345181641",
          nome: "01. Setembro.mp4",
          bloqueado_por: "em_uso",
          anuncios: [{ id: "ad", nome: "LAF_WA conjunto 1" }],
        }),
      ],
      90,
      hoje,
    );
    expect(c.setembro).toBe(2);
    expect(c.fica).toBe("1596865345181641");
    expect(c.laFelicita).toBe(0);
  });

  it("conta candidato com gasto dentro da janela", () => {
    const c = conferenciaDaLista(
      [
        ativo({
          id: "888",
          nome: "agosto.mp4",
          motivo: "anuncio_inativo",
          candidato: true,
          ultimo_gasto_em: "2026-09-01",
          anuncios: [{ id: "a", nome: "Piscina" }],
        }),
      ],
      90,
      hoje,
    );
    expect(c.comGasto).toBe(1);
    expect(c.limite).toBe(diaLimite(90, hoje));
  });

  it("gasto anterior à janela não entra na terceira conferência", () => {
    const c = conferenciaDaLista(
      [
        ativo({
          id: "777",
          nome: "velho.mp4",
          motivo: "sem_uso_90d",
          candidato: true,
          ultimo_gasto_em: "2026-01-01",
        }),
      ],
      90,
      hoje,
    );
    expect(c.comGasto).toBe(0);
  });
});

describe("data", () => {
  it("formata a data do banco sem deslocar o dia", () => {
    expect(dataBr("2026-09-01")).toBe("01/09/2026");
    expect(dataBr(null)).toBe("—");
  });
});
