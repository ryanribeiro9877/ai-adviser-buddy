import { useCallback, useEffect, useRef, useState } from "react";

const MAX_MS = 10 * 60 * 1000; // limite duro de 10 minutos

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
 * Ditado por voz para o chat. Engine principal: Web Speech API (transcrição ao
 * vivo, texto aparecendo enquanto fala). Fallback (sem SpeechRecognition, ex.
 * Firefox): MediaRecorder → `transcribe`, preenchendo ao parar. Um `getUserMedia`
 * próprio alimenta o visualizador de ondas em ambos os casos.
 * `onText` recebe sempre o texto COMPLETO (base + transcrição). Nunca envia nada.
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

  const srRef = useRef<SpeechRecognitionLike | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const recStreamRef = useRef<MediaStream | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const mimeRef = useRef("audio/webm");

  const vizStreamRef = useRef<MediaStream | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const timerRef = useRef<number | null>(null);
  const startedAtRef = useRef(0);

  const stopTimer = useCallback(() => {
    if (timerRef.current !== null) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  const teardownViz = useCallback(() => {
    setAnalyser(null);
    vizStreamRef.current?.getTracks().forEach((t) => t.stop());
    vizStreamRef.current = null;
    audioCtxRef.current?.close().catch(() => {});
    audioCtxRef.current = null;
  }, []);

  const endSession = useCallback(
    (canceled: boolean) => {
      userStoppedRef.current = true;
      canceledRef.current = canceled;
      stopTimer();

      const sr = srRef.current;
      const rec = recorderRef.current;
      teardownViz();

      if (sr) {
        srRef.current = null;
        try {
          sr.stop();
        } catch {
          /* noop */
        }
        if (canceled) optsRef.current.onText(baseRef.current);
        setState("idle");
      } else if (rec) {
        // fallback: onstop transcreve (ou descarta se cancelado) e ajusta o state.
        if (rec.state !== "inactive") rec.stop();
        else setState("idle");
      } else {
        setState("idle");
      }
    },
    [stopTimer, teardownViz],
  );

  // Segurança: encerra tudo ao desmontar.
  useEffect(() => () => endSession(true), [endSession]);

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
      let interim = "";
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const r = e.results[i];
        const txt = r[0]?.transcript ?? "";
        if (r.isFinal) finalRef.current += ` ${txt}`;
        else interim += ` ${txt}`;
      }
      optsRef.current.onText(join(baseRef.current, `${finalRef.current} ${interim}`));
    };
    sr.onend = () => {
      srRef.current = null;
      if (userStoppedRef.current || canceledRef.current) return;
      if (Date.now() - startedAtRef.current >= MAX_MS) return;
      try {
        startSR(); // auto-restart (Chrome encerra sozinho após silêncio)
      } catch {
        /* noop */
      }
    };
    sr.onerror = (e) => {
      if (e.error === "not-allowed" || e.error === "service-not-allowed") {
        optsRef.current.onPermissionError?.();
        endSession(true);
      }
      // no-speech / aborted / network: ignora; onend reinicia.
    };
    srRef.current = sr;
    sr.start();
  }, [endSession]);

  const startFallbackRecorder = useCallback(async () => {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    recStreamRef.current = stream;
    const mime = pickMime();
    mimeRef.current = mime ?? "audio/webm";
    const rec = mime ? new MediaRecorder(stream, { mimeType: mime }) : new MediaRecorder(stream);
    recorderRef.current = rec;
    chunksRef.current = [];
    rec.ondataavailable = (e) => {
      if (e.data.size > 0) chunksRef.current.push(e.data);
    };
    rec.onstop = async () => {
      const canceled = canceledRef.current;
      const blob = new Blob(chunksRef.current, { type: mimeRef.current });
      recStreamRef.current?.getTracks().forEach((t) => t.stop());
      recStreamRef.current = null;
      recorderRef.current = null;
      if (canceled || blob.size === 0) {
        setState("idle");
        return;
      }
      setState("transcribing");
      try {
        const text = await optsRef.current.transcribe(blob, rec.mimeType || mimeRef.current);
        if (text) optsRef.current.onText(join(baseRef.current, text));
      } finally {
        setState("idle");
      }
    };
    rec.start();
  }, []);

  const startViz = useCallback(async () => {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    vizStreamRef.current = stream;
    const Ctx =
      window.AudioContext ??
      (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    const ctx = new Ctx();
    audioCtxRef.current = ctx;
    const source = ctx.createMediaStreamSource(stream);
    const an = ctx.createAnalyser();
    an.fftSize = 64;
    source.connect(an);
    setAnalyser(an);
  }, []);

  const start = useCallback(
    async (baseText: string) => {
      baseRef.current = baseText;
      finalRef.current = "";
      userStoppedRef.current = false;
      canceledRef.current = false;
      await startViz(); // primeiro prompt de permissão; propaga erro para o chamador
      startTimer();
      setState("listening");
      if (getSRCtor()) startSR();
      else await startFallbackRecorder();
    },
    [startViz, startTimer, startSR, startFallbackRecorder],
  );

  const stop = useCallback(() => endSession(false), [endSession]);
  const cancel = useCallback(() => endSession(true), [endSession]);

  return { state, elapsedMs, analyser, start, stop, cancel };
}
