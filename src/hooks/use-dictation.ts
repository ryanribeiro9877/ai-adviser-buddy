import { useCallback, useEffect, useRef, useState } from "react";

const MAX_MS = 10 * 60 * 1000; // limite duro de 10 minutos
const TIMESLICE_MS = 2500; // chunks do MediaRecorder de 2,5s
const SLOW_AFTER_MS = 2 * 60 * 1000; // acima de 2 min, transcreve com menos frequência
const SLOW_EVERY_N_TICKS = 4; // ~10s (4 × 2,5s)

function pickMime(): string | undefined {
  if (typeof MediaRecorder === "undefined") return undefined;
  for (const m of ["audio/webm;codecs=opus", "audio/webm", "audio/mp4"]) {
    if (MediaRecorder.isTypeSupported(m)) return m;
  }
  return undefined;
}

function join(base: string, addition: string): string {
  const add = addition.replace(/\s+/g, " ").trim();
  if (!add) return base;
  return base.trim() ? `${base.trimEnd()} ${add}` : add;
}

export type DictationState = "idle" | "listening" | "transcribing";

/**
 * Ditado por voz — ENGINE ÚNICA e determinística. MediaRecorder grava em chunks
 * de 2,5s; a cada tick re-transcreve o áudio COMPLETO acumulado via `transcribe`
 * (edge `transcribe-audio`) e SUBSTITUI o trecho ditado (base + texto), o que se
 * autocorrige a cada passada. Uma chamada em voo por vez; acima de 2 min, ~10s
 * entre chamadas; passada final ao parar. Nunca envia. (Web Speech foi removido:
 * não entregava resultado em produção.)
 */
export function useDictation(opts: {
  onText: (full: string) => void;
  // Texto transcrito; "" se vazio; null em erro de invoke.
  transcribe: (blob: Blob, mime: string) => Promise<string | null>;
  onLimitReached?: () => void;
  onPermissionError?: () => void;
  onTranscribeError?: () => void;
}) {
  const optsRef = useRef(opts);
  optsRef.current = opts;

  const [state, setState] = useState<DictationState>("idle");
  const [elapsedMs, setElapsedMs] = useState(0);
  const [analyser, setAnalyser] = useState<AnalyserNode | null>(null);

  const baseRef = useRef("");
  const canceledRef = useRef(false);
  const bailedRef = useRef(false);

  const streamRef = useRef<MediaStream | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const mimeRef = useRef("audio/webm");

  const inFlightRef = useRef<Promise<void> | null>(null);
  const tickCountRef = useRef(0);
  const errorsRef = useRef(0);
  const timerRef = useRef<number | null>(null);
  const startedAtRef = useRef(0);
  const bailRef = useRef<() => void>(() => {});

  const log = (...a: unknown[]) => console.log("[dictation]", ...a);

  const stopTimer = useCallback(() => {
    if (timerRef.current !== null) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  const cleanupAudio = useCallback(() => {
    setAnalyser(null);
    audioCtxRef.current?.close().catch(() => {});
    audioCtxRef.current = null;
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    recorderRef.current = null;
  }, []);

  // Re-transcreve o áudio COMPLETO acumulado e substitui o trecho ditado.
  const doTranscribe = useCallback((final: boolean): Promise<void> => {
    const blob = new Blob(chunksRef.current, { type: mimeRef.current });
    if (blob.size === 0) return Promise.resolve();
    const p = (async () => {
      const result = await optsRef.current.transcribe(blob, mimeRef.current);
      if (result === null) {
        errorsRef.current += 1;
        log("erro no invoke (consecutivos:", errorsRef.current, ")");
        if (!final && errorsRef.current >= 2) bailRef.current();
        return;
      }
      errorsRef.current = 0;
      log("resposta:", result.length, "chars");
      if (!canceledRef.current && result) optsRef.current.onText(join(baseRef.current, result));
    })();
    inFlightRef.current = p;
    p.finally(() => {
      if (inFlightRef.current === p) inFlightRef.current = null;
    });
    return p;
  }, []);

  const maybeTick = useCallback(() => {
    const bytes = chunksRef.current.reduce((s, b) => s + b.size, 0);
    tickCountRef.current += 1;
    if (inFlightRef.current) {
      log("tick", bytes, "bytes — pulado (chamada em voo)");
      return;
    }
    const elapsed = Date.now() - startedAtRef.current;
    if (elapsed >= SLOW_AFTER_MS && tickCountRef.current % SLOW_EVERY_N_TICKS !== 0) {
      return; // áudio longo: espaça as chamadas
    }
    log("tick", bytes, "bytes → transcrevendo");
    doTranscribe(false);
  }, [doTranscribe]);

  const endSession = useCallback(
    (canceled: boolean) => {
      canceledRef.current = canceled;
      stopTimer();
      if (canceled) optsRef.current.onText(baseRef.current);
      const rec = recorderRef.current;
      if (rec && rec.state !== "inactive") {
        rec.stop(); // → onstop faz a passada final (se não cancelado) e limpa
      } else {
        cleanupAudio();
        setState("idle");
      }
    },
    [stopTimer, cleanupAudio],
  );

  // Erro do invoke 2× seguidas: para limpo, sem estado zumbi.
  const bail = useCallback(() => {
    bailedRef.current = true;
    stopTimer();
    optsRef.current.onTranscribeError?.();
    const rec = recorderRef.current;
    if (rec && rec.state !== "inactive") {
      rec.stop();
    } else {
      cleanupAudio();
      setState("idle");
    }
  }, [stopTimer, cleanupAudio]);
  bailRef.current = bail;

  useEffect(() => () => endSession(true), [endSession]); // limpeza no unmount

  const startTimer = useCallback(() => {
    startedAtRef.current = Date.now();
    setElapsedMs(0);
    timerRef.current = window.setInterval(() => {
      const ms = Date.now() - startedAtRef.current;
      setElapsedMs(ms);
      if (ms >= MAX_MS) {
        optsRef.current.onLimitReached?.();
        endSession(false);
      }
    }, 250);
  }, [endSession]);

  const start = useCallback(
    async (baseText: string) => {
      baseRef.current = baseText;
      canceledRef.current = false;
      bailedRef.current = false;
      chunksRef.current = [];
      inFlightRef.current = null;
      tickCountRef.current = 0;
      errorsRef.current = 0;

      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;

      const Ctx =
        window.AudioContext ??
        (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      const ctx = new Ctx();
      audioCtxRef.current = ctx;
      const an = ctx.createAnalyser();
      an.fftSize = 64;
      ctx.createMediaStreamSource(stream).connect(an);
      setAnalyser(an);

      const mime = pickMime();
      mimeRef.current = mime ?? "audio/webm";
      const rec = mime ? new MediaRecorder(stream, { mimeType: mime }) : new MediaRecorder(stream);
      recorderRef.current = rec;
      rec.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data);
        maybeTick();
      };
      rec.onstop = async () => {
        if (canceledRef.current || bailedRef.current) {
          cleanupAudio();
          setState("idle");
          return;
        }
        setState("transcribing");
        if (inFlightRef.current) {
          try {
            await inFlightRef.current;
          } catch {
            /* noop */
          }
        }
        await doTranscribe(true); // passada final com o áudio completo
        cleanupAudio();
        setState("idle");
      };

      log("início — mime:", mimeRef.current);
      rec.start(TIMESLICE_MS);
      startTimer();
      setState("listening");
    },
    [maybeTick, doTranscribe, startTimer, cleanupAudio],
  );

  const stop = useCallback(() => endSession(false), [endSession]);
  const cancel = useCallback(() => endSession(true), [endSession]);

  return { state, elapsedMs, analyser, start, stop, cancel };
}
