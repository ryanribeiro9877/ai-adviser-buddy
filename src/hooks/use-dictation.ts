import { useCallback, useEffect, useRef, useState } from "react";

const MAX_MS = 10 * 60 * 1000; // limite duro de 10 minutos
const TIMESLICE_MS = 3000; // chunks do MediaRecorder de 3s
const TICK_FAST_MS = 3000; // re-transcreve a cada 3s até 2 min
const TICK_SLOW_MS = 10000; // depois de 2 min, a cada 10s (áudio longo)
const SLOW_AFTER_MS = 2 * 60 * 1000;
const SR_WATCHDOG_MS = 4000; // sem onresult em 4s → cai no modo incremental
const ENGINE_KEY = "dictation-engine";

// --- Tipos mínimos da Web Speech API (a lib DOM nem sempre os traz) ----------
type SRAlternative = { transcript: string };
interface SRResult extends ArrayLike<SRAlternative> {
  isFinal: boolean;
}
interface SRResultList extends ArrayLike<SRResult> {}
interface SREvent {
  resultIndex: number;
  results: SRResultList;
}
interface SRErrorEvent {
  error: string;
}
interface SpeechRecognitionLike {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  start(): void;
  stop(): void;
  abort(): void;
  onresult: ((e: SREvent) => void) | null;
  onend: (() => void) | null;
  onerror: ((e: SRErrorEvent) => void) | null;
}
type SRCtor = new () => SpeechRecognitionLike;

function getSRCtor(): SRCtor | undefined {
  if (typeof window === "undefined") return undefined;
  const w = window as unknown as { SpeechRecognition?: SRCtor; webkitSpeechRecognition?: SRCtor };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition;
}

function savedEngine(): "speech" | "edge" | null {
  try {
    const v = localStorage.getItem(ENGINE_KEY);
    return v === "speech" || v === "edge" ? v : null;
  } catch {
    return null;
  }
}
function rememberEngine(e: "speech" | "edge") {
  try {
    localStorage.setItem(ENGINE_KEY, e);
  } catch {
    /* localStorage indisponível */
  }
}

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
 * Ditado por voz. Duas engines com seleção automática:
 *  - Web Speech API (contínuo, texto ao vivo) quando funciona;
 *  - modo incremental UNIVERSAL via `transcribe` (a cada ~3s re-transcreve o áudio
 *    acumulado e substitui o trecho ditado) — usado no fallback e quando o Web
 *    Speech não entrega resultado (Firefox, Brave/Opera/Arc, erro de rede).
 * O MediaRecorder roda desde o início (em paralelo ao Web Speech) para não perder
 * áudio na troca a quente. `onText` recebe sempre o texto COMPLETO. Nunca envia.
 */
export function useDictation(opts: {
  onText: (full: string) => void;
  transcribe: (blob: Blob, mime: string) => Promise<string>;
  onLimitReached?: () => void;
  onPermissionError?: () => void;
}) {
  const optsRef = useRef(opts);
  optsRef.current = opts;

  const [state, setState] = useState<DictationState>("idle");
  const [elapsedMs, setElapsedMs] = useState(0);
  const [analyser, setAnalyser] = useState<AnalyserNode | null>(null);

  const baseRef = useRef("");
  const finalRef = useRef("");
  const userStoppedRef = useRef(false);
  const canceledRef = useRef(false);

  const engineRef = useRef<"speech" | "edge" | null>(null);
  const gotResultRef = useRef(false);
  const srAbandonedRef = useRef(false);

  const srRef = useRef<SpeechRecognitionLike | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const mimeRef = useRef("audio/webm");

  const inFlightRef = useRef<Promise<void> | null>(null);
  const lastTickAtRef = useRef(0);
  const timerRef = useRef<number | null>(null);
  const watchdogRef = useRef<number | null>(null);
  const startedAtRef = useRef(0);

  const log = (...args: unknown[]) => console.log("[dictation]", ...args);

  const clearWatchdog = useCallback(() => {
    if (watchdogRef.current !== null) {
      clearTimeout(watchdogRef.current);
      watchdogRef.current = null;
    }
  }, []);

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
  const doTranscribe = useCallback((): Promise<void> => {
    const blob = new Blob(chunksRef.current, { type: mimeRef.current });
    if (blob.size === 0) return Promise.resolve();
    lastTickAtRef.current = Date.now();
    const p = (async () => {
      try {
        const text = await optsRef.current.transcribe(blob, mimeRef.current);
        if (!canceledRef.current && text) optsRef.current.onText(join(baseRef.current, text));
      } catch {
        /* transcribe cuida do próprio erro */
      }
    })();
    inFlightRef.current = p;
    p.finally(() => {
      if (inFlightRef.current === p) inFlightRef.current = null;
    });
    return p;
  }, []);

  const maybeTick = useCallback(() => {
    if (engineRef.current !== "edge") return;
    if (inFlightRef.current) return; // nunca 2 chamadas em voo
    const now = Date.now();
    const throttle = now - startedAtRef.current >= SLOW_AFTER_MS ? TICK_SLOW_MS : TICK_FAST_MS;
    if (now - lastTickAtRef.current < throttle) return;
    doTranscribe();
  }, [doTranscribe]);

  const switchToEdge = useCallback(
    (reason: string) => {
      if (engineRef.current === "edge") return;
      log("switching to edge (incremental) mode:", reason);
      engineRef.current = "edge";
      rememberEngine("edge");
      srAbandonedRef.current = true;
      clearWatchdog();
      if (srRef.current) {
        try {
          srRef.current.abort();
        } catch {
          /* noop */
        }
        srRef.current = null;
      }
      lastTickAtRef.current = 0; // permite um tick imediato
      maybeTick();
    },
    [clearWatchdog, maybeTick],
  );

  const endSession = useCallback(
    (canceled: boolean) => {
      userStoppedRef.current = true;
      canceledRef.current = canceled;
      stopTimer();
      clearWatchdog();

      if (srRef.current) {
        srAbandonedRef.current = true;
        try {
          srRef.current.stop();
        } catch {
          /* noop */
        }
        srRef.current = null;
      }
      if (canceled) optsRef.current.onText(baseRef.current);

      const rec = recorderRef.current;
      if (rec && rec.state !== "inactive") {
        rec.stop(); // → onstop faz a transcrição final (edge) e limpa
      } else {
        cleanupAudio();
        setState("idle");
      }
    },
    [stopTimer, clearWatchdog, cleanupAudio],
  );

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

  const startSR = useCallback(() => {
    const Ctor = getSRCtor();
    if (!Ctor) return;
    const sr = new Ctor();
    sr.lang = "pt-BR";
    sr.continuous = true;
    sr.interimResults = true;
    sr.onresult = (e) => {
      log("onresult", { results: e.results.length, resultIndex: e.resultIndex });
      if (engineRef.current === "edge") return; // já trocou; ignora
      gotResultRef.current = true;
      clearWatchdog();
      if (engineRef.current !== "speech") {
        engineRef.current = "speech";
        rememberEngine("speech");
        log("engine = speech");
      }
      let interim = "";
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const r = e.results[i];
        const txt = r[0]?.transcript ?? "";
        if (r.isFinal) finalRef.current += ` ${txt}`;
        else interim += ` ${txt}`;
      }
      optsRef.current.onText(join(baseRef.current, `${finalRef.current} ${interim}`));
    };
    sr.onerror = (e) => {
      log("onerror", e.error);
      if (e.error === "not-allowed") {
        optsRef.current.onPermissionError?.();
        endSession(true);
        return;
      }
      if (e.error === "network" || e.error === "service-not-allowed") {
        switchToEdge(`onerror ${e.error}`);
      }
      // no-speech / aborted: ignora; onend reinicia.
    };
    sr.onend = () => {
      log("onend");
      srRef.current = null;
      if (userStoppedRef.current || canceledRef.current || srAbandonedRef.current) return;
      if (engineRef.current === "edge") return;
      if (Date.now() - startedAtRef.current >= MAX_MS) return;
      try {
        startSR(); // auto-restart (Chrome encerra sozinho após silêncio)
      } catch {
        /* noop */
      }
    };
    srRef.current = sr;
    try {
      sr.start();
    } catch (err) {
      log("sr.start() falhou", err);
      switchToEdge("sr.start throw");
    }
  }, [clearWatchdog, endSession, switchToEdge]);

  const start = useCallback(
    async (baseText: string) => {
      baseRef.current = baseText;
      finalRef.current = "";
      userStoppedRef.current = false;
      canceledRef.current = false;
      srAbandonedRef.current = false;
      gotResultRef.current = false;
      engineRef.current = null;
      chunksRef.current = [];
      inFlightRef.current = null;
      lastTickAtRef.current = 0;

      // Uma única captura de mic: alimenta o visualizador E o MediaRecorder.
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
        if (canceledRef.current) {
          cleanupAudio();
          setState("idle");
          return;
        }
        if (engineRef.current === "edge") {
          setState("transcribing");
          if (inFlightRef.current) {
            try {
              await inFlightRef.current;
            } catch {
              /* noop */
            }
          }
          await doTranscribe(); // passada final com o áudio completo
        }
        cleanupAudio();
        setState("idle");
      };
      rec.start(TIMESLICE_MS);

      startTimer();
      setState("listening");

      // Seleção de engine.
      const SR = getSRCtor();
      const saved = savedEngine();
      if (SR && saved !== "edge") {
        log("tentando Web Speech (saved:", saved, ")");
        startSR();
        watchdogRef.current = window.setTimeout(() => {
          if (!gotResultRef.current) switchToEdge("sem onresult em 4s");
        }, SR_WATCHDOG_MS);
      } else {
        switchToEdge(SR ? "engine salva = edge" : "sem SpeechRecognition");
      }
    },
    [startTimer, startSR, switchToEdge, maybeTick, doTranscribe, cleanupAudio],
  );

  const stop = useCallback(() => endSession(false), [endSession]);
  const cancel = useCallback(() => endSession(true), [endSession]);

  return { state, elapsedMs, analyser, start, stop, cancel };
}
