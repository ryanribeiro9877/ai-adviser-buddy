import { describe, it, expect } from "vitest";
import {
  esperaGravacaoAposErroHttp,
  statusDeErroInvoke,
  turnoSincronoOrfao,
} from "./chat-http-erro";

describe("esperaGravacaoAposErroHttp", () => {
  it("504 espera a gravacao tardia", () => {
    expect(esperaGravacaoAposErroHttp({ status: 504, elapsedMs: 150_000 })).toBe(45_000);
  });

  it("502 rapido nao martela REST por 45s", () => {
    expect(esperaGravacaoAposErroHttp({ status: 502, elapsedMs: 9_747 })).toBe(5_000);
  });

  it("conexao fechada espera pouco", () => {
    expect(esperaGravacaoAposErroHttp({ status: 0, elapsedMs: 3_000 })).toBe(12_000);
  });

  it("408 segue a mesma politica do 504 (a edge pode estar gravando)", () => {
    expect(esperaGravacaoAposErroHttp({ status: 408, elapsedMs: 1_000 })).toBe(45_000);
  });

  it("502 LENTO ja gastou a janela: espera media, nao os 5s do 502 rapido", () => {
    // A distincao e o proposito do arquivo: 502 em 9s significa que a funcao ja
    // devolveu; 502 em 40s significa que ela demorou e pode ter gravado.
    expect(esperaGravacaoAposErroHttp({ status: 502, elapsedMs: 40_000 })).toBe(20_000);
  });

  it("500 anda junto com o 502 nas duas pontas", () => {
    expect(esperaGravacaoAposErroHttp({ status: 500, elapsedMs: 9_000 })).toBe(5_000);
    expect(esperaGravacaoAposErroHttp({ status: 500, elapsedMs: 30_000 })).toBe(20_000);
  });

  it("status fora da politica cai no padrao curto", () => {
    expect(esperaGravacaoAposErroHttp({ status: 429, elapsedMs: 1_000 })).toBe(8_000);
  });

  it("sem status trata como conexao fechada, sem tempo trata como zero", () => {
    // O objeto vem de um catch: os dois campos podem faltar, e o resultado tem
    // de ser uma espera valida em vez de NaN.
    expect(esperaGravacaoAposErroHttp({ elapsedMs: 0 })).toBe(12_000);
    expect(
      esperaGravacaoAposErroHttp({ status: 502 } as unknown as {
        status: number;
        elapsedMs: number;
      }),
    ).toBe(5_000);
  });

  it("tempo negativo nao vira espera negativa", () => {
    expect(esperaGravacaoAposErroHttp({ status: 502, elapsedMs: -1 })).toBe(5_000);
  });
});

describe("statusDeErroInvoke", () => {
  it("le status do context do FunctionsHttpError", () => {
    expect(statusDeErroInvoke({ context: { status: 502 } })).toBe(502);
    expect(statusDeErroInvoke({})).toBeUndefined();
  });
});

describe("turnoSincronoOrfao", () => {
  it("apos 502 nao fica em Analisando ate 2 min", () => {
    const r = turnoSincronoOrfao({
      lastRole: "user",
      idadeMs: 30_000,
      httpFalhou: true,
      timeoutMs: 120_000,
    });
    expect(r.processando).toBe(false);
    expect(r.falhou).toBe(true);
  });

  it("sem falha HTTP, spinner ate o timeout", () => {
    const r = turnoSincronoOrfao({
      lastRole: "user",
      idadeMs: 30_000,
      httpFalhou: false,
      timeoutMs: 120_000,
    });
    expect(r.processando).toBe(true);
    expect(r.falhou).toBe(false);
  });

  it("passado o timeout sem falha HTTP, o turno e dado por falho", () => {
    const r = turnoSincronoOrfao({
      lastRole: "user",
      idadeMs: 130_000,
      httpFalhou: false,
      timeoutMs: 120_000,
    });
    expect(r).toEqual({ processando: false, falhou: true });
  });

  it("ultima fala do assistente nao e turno orfao", () => {
    // Sem esta guarda a tela mostraria "Analisando" depois de uma resposta que
    // ja chegou — o spinner viraria permanente.
    expect(
      turnoSincronoOrfao({
        lastRole: "assistant",
        idadeMs: 999_000,
        httpFalhou: true,
        timeoutMs: 120_000,
      }),
    ).toEqual({ processando: false, falhou: false });
  });

  it("sem idade conhecida nao acusa nem spinner nem falha", () => {
    expect(
      turnoSincronoOrfao({
        lastRole: "user",
        idadeMs: null,
        httpFalhou: true,
        timeoutMs: 120_000,
      }),
    ).toEqual({ processando: false, falhou: false });
  });
});
