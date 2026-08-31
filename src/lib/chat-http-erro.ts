/**
 * Politica de espera apos falha HTTP do traffic-chat.
 *
 * 504: a edge pode ainda estar gravando (medido 20/08). 502 rapido: a funcao
 * ja devolveu; esperar 45s so gera rajada REST (ERR_CONNECTION_CLOSED).
 */
export function esperaGravacaoAposErroHttp(opts: {
  status?: number;
  elapsedMs: number;
}): number {
  const st = Number(opts.status ?? 0);
  const elapsed = Math.max(0, Number(opts.elapsedMs ?? 0));
  if (st === 504 || st === 408) return 45_000;
  if (st === 502 || st === 500) return elapsed < 25_000 ? 5_000 : 20_000;
  if (st === 0) return 12_000;
  return 8_000;
}

export function statusDeErroInvoke(error: unknown): number | undefined {
  const ctx = (error as { context?: { status?: number } } | null)?.context;
  if (typeof ctx?.status === "number" && ctx.status > 0) return ctx.status;
  return undefined;
}

export function turnoSincronoOrfao(opts: {
  lastRole?: string | null;
  idadeMs: number | null;
  httpFalhou: boolean;
  timeoutMs: number;
}): { processando: boolean; falhou: boolean } {
  if (opts.lastRole !== "user" || opts.idadeMs === null) {
    return { processando: false, falhou: false };
  }
  if (opts.httpFalhou) return { processando: false, falhou: true };
  return {
    processando: opts.idadeMs < opts.timeoutMs,
    falhou: opts.idadeMs >= opts.timeoutMs,
  };
}
