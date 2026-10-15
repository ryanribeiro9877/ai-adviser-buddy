/** Pedido de escolher N criativos + gerar legendas (sem necessariamente emitir card). */
/** Quantas legendas o pedido pede. Sem numero explicito, o lote classico fica em 6. */
export function nLegendasPedidas(pedido: string): number {
  const p = deacc(String(pedido ?? "").toLowerCase());
  const total = p.match(/\b(\d{1,2})\s+criativos?\b/);
  if (total) {
    const n = Number(total[1]);
    if (n >= 2 && n <= 24) return n;
  }
  return 6;
}

export function pedidoLoteCriativo(pedido: string): boolean {
  const p = deacc(String(pedido ?? "").toLowerCase());
  // 15/10/2026 (bf4a8869, 18:55): "conjunto 2" sozinho casava as DUAS metades da regra, e
  // "desative o conjunto 2" virava lote criativo. Conjunto 2-4 agora so conta junto de legenda
  // ou de pedido de mais pecas. Espelho de supabase/functions/_shared/lote_criativo.ts.
  const pedeVariasPecas =
    /\b(6 criativ|seis criativ|7 criativ|sete criativ|8 criativ|oito criativ|mais 6|separ[ae] mais|criativos diferentes|pecas diferentes|videos? diferentes)\b/.test(
      p,
    ) ||
    /\b(escolh|selecion|separ[ae])\w*.{0,80}\b(6|seis|7|sete|8|oito)\b/.test(p) ||
    /\b(8 videos|oito videos|7 videos|sete videos)\b/.test(p);
  const citaConjunto2a4 = /\bconjunto [2-4]\b/.test(p);
  const pedeLegenda = /\b(legendas?|gerar copy|gere as legendas|gere legendas)\b/.test(p);
  const loteConjComOito =
    pedeLegenda && /\bconj(?:unto)?\.?\s*0*[1-4]\b/.test(p) && /\b(8|oito)\b/.test(p);
  return (
    loteConjComOito ||
    (citaConjunto2a4 && pedeLegenda) ||
    (pedeVariasPecas &&
      (pedeLegenda ||
        /\b(conjunto [2-4]|6 criativ|seis criativ|7 criativ|sete criativ|8 criativ|8 diferentes|seis diferentes|6 diferentes|7 diferentes)\b/.test(
          p,
        )))
  );
}

/** A prosa ja admite que o lote NAO fechou — auto-continuar em vez de encerrar. */
export function replyLoteCriativoIncompleto(texto: string): boolean {
  const t = deacc(String(texto ?? "").toLowerCase());
  return (
    /\b(legendas? pendentes|nao cobertos por falta|consulta nao realizada nesta rodada|faltou tempo de coleta|as tres legendas do conjunto|ferramenta.{0,40}indisponivel|redator indisponivel|aguardar.{0,40}ferramenta|escrever.{0,40}(na mao|manualmente))\b/.test(
      t,
    ) || /\bnao vou invent/.test(t)
  );
}

/** Prosa de lote com perguntas DENTRO das legendas — nao e clarificacao ao gestor. */
export function replyLoteComLegendas(texto: string): boolean {
  const t = deacc(String(texto ?? "").toLowerCase());
  const nLegenda = t.match(/\blegenda\b/g)?.length ?? 0;
  return nLegenda >= 2 && /\b(veredito|drive file id|drive_file_id|conjunto [1-4])\b/.test(t);
}

function deacc(s: string): string {
  return s.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
}
