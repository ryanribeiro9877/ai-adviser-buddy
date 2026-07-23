import { useCallback, useEffect, useRef, useState } from "react";

const MAX_MS = 10 * 60 * 1000; // limite duro de 10 minutos

export type Recording = { blob: Blob; mime: string };

// Escolhe um container suportado: Opus/WebM (Chrome/Edge/Firefox) → mp4 (Safari).
function pickMime(): string | undefined {
  if (typeof MediaRecorder === "undefined") return undefined;
  const prefs = ["audio/webm;codecs=opus", "audio/webm", "audio/mp4"];
  for (const m of prefs) {
    if (MediaRecorder.isTypeSupported(m)) return m;
  }
  return undefined; // deixa o browser decidir
}

/**
 * Gravação de áudio via MediaRecorder. API por callback (não promise) para
 * suportar o auto-stop dos 10 min pelo mesmo caminho do stop manual.
 * - `onComplete(rec)` recebe o áudio ao parar; `null` se cancelado/vazio.
 * - `onLimitReached()` dispara quando o limite de 10 min corta a gravação.
 * - `start()` propaga erro de permissão (o chamador trata com toast).
 */
export function useAudioRecorder(opts: {
  onComplete: (rec: Recording | null) => void;
  onLimitReached?: () => void;
}) {
  const optsRef = useRef(opts);
  optsRef.current = opts;

  const [isRecording, setIsRecording] = useState(false);
  const [elapsedMs, setElapsedMs] = useState(0);

  const recorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const mimeRef = useRef<string>("audio/webm");
  const canceledRef = useRef(false);
  const timerRef = useRef<number | null>(null);
  const startedAtRef = useRef(0);

  const releaseStream = useCallback(() => {
    if (timerRef.current !== null) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
  }, []);

  // Segurança: libera o microfone se o componente desmontar gravando.
  useEffect(() => releaseStream, [releaseStream]);

  // Client-only (evita mismatch de hidratação: no SSR seria sempre false).
  const [isSupported, setIsSupported] = useState(false);
  useEffect(() => {
    setIsSupported(!!navigator.mediaDevices?.getUserMedia && typeof MediaRecorder !== "undefined");
  }, []);

  const stopWith = useCallback((canceled: boolean) => {
    const rec = recorderRef.current;
    if (!rec) return;
    canceledRef.current = canceled;
    if (rec.state !== "inactive") rec.stop();
  }, []);

  const start = useCallback(async () => {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    streamRef.current = stream;
    const mime = pickMime();
    mimeRef.current = mime ?? "audio/webm";
    const rec = mime ? new MediaRecorder(stream, { mimeType: mime }) : new MediaRecorder(stream);
    recorderRef.current = rec;
    chunksRef.current = [];
    canceledRef.current = false;

    rec.ondataavailable = (e) => {
      if (e.data.size > 0) chunksRef.current.push(e.data);
    };
    rec.onstop = () => {
      const canceled = canceledRef.current;
      const blob = new Blob(chunksRef.current, { type: mimeRef.current });
      recorderRef.current = null;
      releaseStream();
      setIsRecording(false);
      setElapsedMs(0);
      const rmime = rec.mimeType || mimeRef.current;
      optsRef.current.onComplete(canceled || blob.size === 0 ? null : { blob, mime: rmime });
    };

    rec.start();
    startedAtRef.current = Date.now();
    setIsRecording(true);
    setElapsedMs(0);
    timerRef.current = window.setInterval(() => {
      const ms = Date.now() - startedAtRef.current;
      setElapsedMs(ms);
      if (ms >= MAX_MS) {
        optsRef.current.onLimitReached?.();
        stopWith(false);
      }
    }, 250);
  }, [releaseStream, stopWith]);

  const stop = useCallback(() => stopWith(false), [stopWith]);
  const cancel = useCallback(() => stopWith(true), [stopWith]);

  return { isSupported, isRecording, elapsedMs, start, stop, cancel };
}
