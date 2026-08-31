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
});
