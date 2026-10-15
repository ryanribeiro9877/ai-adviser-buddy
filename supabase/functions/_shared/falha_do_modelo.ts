const PROSA_FALHA_TEMPORARIA =
  "Não concluí este turno: o modelo não respondeu a tempo (falha temporária). " +
  "Sua pergunta já está nesta conversa — use Reenviar pergunta para eu retomar sem você redigitar.";

const PROSA_SALDO_OPENROUTER =
  "Não concluí este turno: a OpenRouter recusou a chamada do modelo por saldo (HTTP 402 — os " +
  "créditos livres da conta não cobrem esta chamada). Não foi demora do modelo, e reenviar sem " +
  "saldo repete a mesma recusa. Confira os créditos da conta na OpenRouter; com saldo, use " +
  "Reenviar pergunta para eu retomar sem você redigitar.";

/**
 * 402 da OpenRouter = saldo. O resgate de 402 no chat (aplicarResgate402) ja repete e troca de
 * modelo antes de desistir; quando o erro chega ao fim do turno, continuar na hora so repete a
 * recusa. 15/10/2026, 13:19: o segmento 2 (93df9658) levou 402 depois de ler 5 ferramentas, o
 * turno respondeu "o orcamento desta janela esgotou" e continuou sozinho, e o segmento 3
 * (a99f3fac) levou o mesmo 402 oito segundos depois.
 */
export function recusaPorSaldo(finishReason: string): boolean {
  return /openrouter_http_402/.test(String(finishReason ?? ""));
}

/**
 * Prosa do turno que acabou porque a chamada do modelo falhou depois da pergunta gravada.
 *
 * 15/10/2026 (CONJ.4, conversa bf4a8869): o log registrou `openrouter_http_402` com
 * "in_flight_budget_exhausted ... add credits" no Grok 4.7 e no fallback 4.6, tokens_in 0, e o
 * gestor leu "o modelo nao respondeu a tempo". O texto unico apontava para o lugar errado.
 * 402 e saldo; o resto (timeout, vazio, 5xx, fetch) continua sendo falha temporaria.
 *
 * `cardsEmitidos`: card que saiu neste bloco antes da falha continua na fila e precisa constar.
 */
export function prosaFalhaDoModelo(
  finishReason: string,
  opts: { cardsEmitidos?: number } = {},
): string {
  const base = recusaPorSaldo(finishReason) ? PROSA_SALDO_OPENROUTER : PROSA_FALHA_TEMPORARIA;
  const n = Math.max(0, Math.floor(Number(opts.cardsEmitidos ?? 0)) || 0);
  if (!n) return base;
  return `${base}\n\nAntes da falha, ${n} pedido(s) de aprovação deste pedido já foram emitidos e estão na fila de aprovação.`;
}
