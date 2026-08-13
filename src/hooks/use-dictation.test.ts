import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useDictation } from "./use-dictation";

// CORRECAO de uma avaliacao anterior minha: eu havia declarado este hook como
// nao-testavel "porque depende da Web Speech API". Nao depende - o proprio
// docstring diz que a Web Speech foi REMOVIDA. Ele usa MediaRecorder e recebe a
// transcricao por INJECAO DE DEPENDENCIA (`transcribe`), o que o torna
// perfeitamente testavel: eu controlo a transcricao e dublo os contratos de
// browser, que sao poucos e bem definidos.
//
// O que importa provar aqui: uma chamada em voo por vez (senao a mesma fala vai
// duas vezes para a edge, custando dinheiro), erro em sequencia PARA a sessao em
// vez de deixar estado zumbi, e cancelar RESTAURA o texto original.

// ---------- dublês dos contratos de browser ----------

class FakeMediaRecorder {
  static ultimaInstancia: FakeMediaRecorder | null = null;
  static mimesSuportados = ["audio/webm;codecs=opus", "audio/webm", "audio/mp4"];
  static isTypeSupported(m: string) {
    return FakeMediaRecorder.mimesSuportados.includes(m);
  }
  state: "inactive" | "recording" = "inactive";
  mimeType: string;
  timeslice: number | undefined;
  ondataavailable: ((e: { data: Blob }) => void) | null = null;
  onstop: (() => void | Promise<void>) | null = null;

  constructor(_stream: unknown, opts?: { mimeType?: string }) {
    this.mimeType = opts?.mimeType ?? "";
    FakeMediaRecorder.ultimaInstancia = this;
  }
  start(timeslice?: number) {
    this.timeslice = timeslice;
    this.state = "recording";
  }
  stop() {
    this.state = "inactive";
    void this.onstop?.();
  }
  /** Simula a chegada de um chunk de áudio. */
  emitirChunk(bytes = 1000) {
    this.ondataavailable?.({ data: new Blob([new Uint8Array(bytes)]) });
  }
}

const trackStop = vi.fn();
const ctxClose = vi.fn(() => Promise.resolve());
const connectMock = vi.fn();

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  trackStop.mockClear();
  ctxClose.mockClear();
  connectMock.mockClear();
  FakeMediaRecorder.ultimaInstancia = null;
  FakeMediaRecorder.mimesSuportados = ["audio/webm;codecs=opus", "audio/webm", "audio/mp4"];

  vi.stubGlobal("MediaRecorder", FakeMediaRecorder);
  vi.stubGlobal("navigator", {
    ...navigator,
    mediaDevices: {
      getUserMedia: vi.fn(() => Promise.resolve({ getTracks: () => [{ stop: trackStop }] })),
    },
  });
  vi.stubGlobal(
    "AudioContext",
    class {
      close = ctxClose;
      createAnalyser() {
        return { fftSize: 0 } as unknown as AnalyserNode;
      }
      createMediaStreamSource() {
        return { connect: connectMock };
      }
    },
  );
  vi.spyOn(console, "log").mockImplementation(() => {});
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

function montar(over: Partial<Parameters<typeof useDictation>[0]> = {}) {
  const onText = vi.fn();
  const transcribe = vi.fn(() => Promise.resolve("texto ditado"));
  const onLimitReached = vi.fn();
  const onTranscribeError = vi.fn();
  const hook = renderHook(() =>
    useDictation({ onText, transcribe, onLimitReached, onTranscribeError, ...over }),
  );
  return { ...hook, onText, transcribe, onLimitReached, onTranscribeError };
}

/** Inicia a sessão e devolve o recorder dublado. */
async function iniciar(h: ReturnType<typeof montar>, base = "") {
  await act(async () => {
    await h.result.current.start(base);
  });
  return FakeMediaRecorder.ultimaInstancia!;
}

describe("start", () => {
  it("pede o microfone e entra em listening", async () => {
    const h = montar();
    await iniciar(h);
    expect(navigator.mediaDevices.getUserMedia).toHaveBeenCalledWith({ audio: true });
    expect(h.result.current.state).toBe("listening");
  });

  it("escolhe o melhor mime disponivel, na ordem de preferencia", async () => {
    const h = montar();
    const rec = await iniciar(h);
    expect(rec.mimeType).toBe("audio/webm;codecs=opus");
  });

  it("cai para o proximo mime quando o preferido nao e suportado", async () => {
    FakeMediaRecorder.mimesSuportados = ["audio/mp4"];
    const h = montar();
    const rec = await iniciar(h);
    expect(rec.mimeType).toBe("audio/mp4");
  });

  it("grava em chunks de 2,5s", async () => {
    // O timeslice e o que faz a autocorrecao acontecer durante a fala, em vez de
    // so no fim.
    const h = montar();
    const rec = await iniciar(h);
    expect(rec.timeslice).toBe(2500);
  });

  it("expoe o analyser (a barra de nivel de voz da UI)", async () => {
    const h = montar();
    await iniciar(h);
    expect(h.result.current.analyser).not.toBeNull();
    expect(connectMock).toHaveBeenCalled();
  });
});

describe("transcrição durante a fala", () => {
  it("cada chunk dispara uma transcrição do áudio ACUMULADO", async () => {
    const h = montar();
    const rec = await iniciar(h);
    await act(async () => {
      rec.emitirChunk();
      await Promise.resolve();
    });
    expect(h.transcribe).toHaveBeenCalledTimes(1);
  });

  it("substitui o trecho ditado juntando base + transcricao", async () => {
    const h = montar();
    const rec = await iniciar(h, "Texto anterior");
    await act(async () => {
      rec.emitirChunk();
      await Promise.resolve();
    });
    expect(h.onText).toHaveBeenCalledWith("Texto anterior texto ditado");
  });

  it("sem base, o texto e so a transcricao", async () => {
    const h = montar();
    const rec = await iniciar(h, "");
    await act(async () => {
      rec.emitirChunk();
      await Promise.resolve();
    });
    expect(h.onText).toHaveBeenCalledWith("texto ditado");
  });

  it("colapsa espaco em excesso da transcricao", async () => {
    const h = montar({ transcribe: vi.fn(() => Promise.resolve("  muito   espaco  ")) });
    const rec = await iniciar(h, "Base");
    await act(async () => {
      rec.emitirChunk();
      await Promise.resolve();
    });
    expect(h.onText).toHaveBeenCalledWith("Base muito espaco");
  });

  it("transcricao VAZIA nao apaga o que o usuario tinha", async () => {
    // Silencio no microfone nao pode limpar o campo.
    const h = montar({ transcribe: vi.fn(() => Promise.resolve("")) });
    const rec = await iniciar(h, "Base");
    await act(async () => {
      rec.emitirChunk();
      await Promise.resolve();
    });
    expect(h.onText).not.toHaveBeenCalled();
  });

  it("UMA chamada em voo por vez — tick durante a anterior e PULADO", async () => {
    // Sem esta guarda, a mesma fala vai varias vezes para a edge de transcricao,
    // e isso custa dinheiro por chamada.
    let liberar: (v: string) => void = () => {};
    const transcribe = vi.fn(() => new Promise<string>((r) => (liberar = r)));
    const h = montar({ transcribe });
    const rec = await iniciar(h);

    await act(async () => {
      rec.emitirChunk();
      await Promise.resolve();
    });
    expect(transcribe).toHaveBeenCalledTimes(1);

    await act(async () => {
      rec.emitirChunk();
      rec.emitirChunk();
      await Promise.resolve();
    });
    expect(transcribe).toHaveBeenCalledTimes(1); // seguiu 1: os dois foram pulados

    await act(async () => {
      liberar("ok");
      await Promise.resolve();
    });
    await act(async () => {
      rec.emitirChunk();
      await Promise.resolve();
    });
    expect(transcribe).toHaveBeenCalledTimes(2); // liberou, o proximo passa
  });

  it("blob vazio nao chama a edge", async () => {
    const h = montar();
    const rec = await iniciar(h);
    await act(async () => {
      rec.ondataavailable?.({ data: new Blob([]) }); // chunk de 0 byte
      await Promise.resolve();
    });
    expect(h.transcribe).not.toHaveBeenCalled();
  });
});

describe("áudio longo: espaça as chamadas", () => {
  it("acima de 2 minutos, so transcreve a cada 4 ticks", async () => {
    // Re-transcrever o audio completo fica caro conforme ele cresce; passados
    // 2 min o intervalo efetivo vai de 2,5s para ~10s.
    const h = montar();
    const rec = await iniciar(h);

    await act(async () => {
      vi.advanceTimersByTime(2 * 60 * 1000 + 1000);
      await Promise.resolve();
    });
    h.transcribe.mockClear();

    for (let i = 0; i < 3; i++) {
      await act(async () => {
        rec.emitirChunk();
        await Promise.resolve();
      });
    }
    expect(h.transcribe).not.toHaveBeenCalled(); // ticks 1,2,3 pulados

    await act(async () => {
      rec.emitirChunk(); // 4o tick
      await Promise.resolve();
    });
    expect(h.transcribe).toHaveBeenCalledTimes(1);
  });

  it("abaixo de 2 minutos, transcreve em todo tick", async () => {
    const h = montar();
    const rec = await iniciar(h);
    for (let i = 0; i < 3; i++) {
      await act(async () => {
        rec.emitirChunk();
        await Promise.resolve();
      });
    }
    expect(h.transcribe).toHaveBeenCalledTimes(3);
  });
});

describe("erro na transcrição", () => {
  it("UM erro nao derruba a sessao (pode ser instabilidade)", async () => {
    const transcribe = vi.fn().mockResolvedValueOnce(null).mockResolvedValue("recuperou");
    const h = montar({ transcribe });
    const rec = await iniciar(h);
    await act(async () => {
      rec.emitirChunk();
      await Promise.resolve();
    });
    expect(h.onTranscribeError).not.toHaveBeenCalled();
    expect(h.result.current.state).toBe("listening");
  });

  it("DOIS erros seguidos param a sessao limpa, sem estado zumbi", async () => {
    const h = montar({ transcribe: vi.fn(() => Promise.resolve(null)) });
    const rec = await iniciar(h);
    await act(async () => {
      rec.emitirChunk();
      await Promise.resolve();
    });
    await act(async () => {
      rec.emitirChunk();
      await Promise.resolve();
    });
    expect(h.onTranscribeError).toHaveBeenCalledTimes(1);
    await act(async () => {
      await Promise.resolve();
    });
    expect(h.result.current.state).toBe("idle");
  });

  it("um sucesso ZERA o contador de erros", async () => {
    // Sem o reset, dois erros separados por meia hora de sucesso derrubariam a
    // sessao como se fossem consecutivos.
    const transcribe = vi
      .fn()
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce("ok")
      .mockResolvedValueOnce(null);
    const h = montar({ transcribe });
    const rec = await iniciar(h);
    for (let i = 0; i < 3; i++) {
      await act(async () => {
        rec.emitirChunk();
        await Promise.resolve();
      });
    }
    expect(h.onTranscribeError).not.toHaveBeenCalled();
  });
});

describe("stop e cancel", () => {
  it("stop faz a passada FINAL e termina em idle", async () => {
    const h = montar();
    const rec = await iniciar(h);
    await act(async () => {
      rec.emitirChunk();
      await Promise.resolve();
    });
    h.transcribe.mockClear();

    await act(async () => {
      h.result.current.stop();
      await Promise.resolve();
      await Promise.resolve();
    });
    // A passada final usa o audio completo: e ela que corrige o texto inteiro.
    expect(h.transcribe).toHaveBeenCalledTimes(1);
    expect(h.result.current.state).toBe("idle");
  });

  it("cancel RESTAURA o texto original e nao transcreve", async () => {
    // Cancelar tem de desfazer o ditado, nao congelar o meio dele.
    const h = montar();
    const rec = await iniciar(h, "Texto original");
    await act(async () => {
      rec.emitirChunk();
      await Promise.resolve();
    });
    h.transcribe.mockClear();
    h.onText.mockClear();

    await act(async () => {
      h.result.current.cancel();
      await Promise.resolve();
    });
    expect(h.onText).toHaveBeenCalledWith("Texto original");
    expect(h.transcribe).not.toHaveBeenCalled();
    expect(h.result.current.state).toBe("idle");
  });

  it("libera microfone e AudioContext ao encerrar", async () => {
    // Nao liberar deixa o indicador de gravacao aceso no navegador.
    const h = montar();
    await iniciar(h);
    await act(async () => {
      h.result.current.cancel();
      await Promise.resolve();
    });
    expect(trackStop).toHaveBeenCalled();
    expect(ctxClose).toHaveBeenCalled();
    expect(h.result.current.analyser).toBeNull();
  });

  it("desmontar cancela a sessao (libera o microfone)", async () => {
    const h = montar();
    await iniciar(h);
    h.unmount();
    expect(trackStop).toHaveBeenCalled();
  });
});

describe("limite duro de 10 minutos", () => {
  it("avisa e encerra sozinho", async () => {
    const h = montar();
    await iniciar(h);
    await act(async () => {
      vi.advanceTimersByTime(10 * 60 * 1000 + 500);
      await Promise.resolve();
    });
    expect(h.onLimitReached).toHaveBeenCalled();
  });

  it("nao avisa antes do limite", async () => {
    const h = montar();
    await iniciar(h);
    await act(async () => {
      vi.advanceTimersByTime(9 * 60 * 1000);
      await Promise.resolve();
    });
    expect(h.onLimitReached).not.toHaveBeenCalled();
  });

  it("elapsedMs acompanha o tempo de fala", async () => {
    const h = montar();
    await iniciar(h);
    await act(async () => {
      vi.advanceTimersByTime(3000);
      await Promise.resolve();
    });
    expect(h.result.current.elapsedMs).toBeGreaterThanOrEqual(2500);
  });
});

describe("estado inicial", () => {
  it("comeca idle, sem analyser e sem tempo", () => {
    const h = montar();
    expect(h.result.current.state).toBe("idle");
    expect(h.result.current.analyser).toBeNull();
    expect(h.result.current.elapsedMs).toBe(0);
  });
});
