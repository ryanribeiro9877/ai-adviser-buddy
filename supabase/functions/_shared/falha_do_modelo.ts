const PROSA_FALHA_TEMPORARIA =
  "Não concluí este turno: o modelo não respondeu a tempo (falha temporária). " +
  "Sua pergunta já está nesta conversa — use Reenviar pergunta para eu retomar sem você redigitar.";

const PROSA_SALDO_OPENROUTER =
  "Não concluí este turno: a OpenRouter recusou a chamada do modelo por saldo (HTTP 402 — os " +
  "créditos livres da conta não cobrem esta chamada). Não foi demora do modelo, e reenviar sem " +
  "saldo repete a mesma recusa. Confira os créditos da conta na OpenRouter; com saldo, use " +
  "Reenviar pergunta para eu retomar sem você redigitar.";

/**
 * Prosa do turno que acabou porque a chamada do modelo falhou depois da pergunta gravada.
 *
 * 15/10/2026 (CONJ.4, conversa bf4a8869): o log registrou `openrouter_http_402` com
 * "in_flight_budget_exhausted ... add credits" no Grok 4.7 e no fallback 4.6, tokens_in 0, e o
 * gestor leu "o modelo nao respondeu a tempo". O texto unico apontava para o lugar errado.
 * 402 e saldo; o resto (timeout, vazio, 5xx, fetch) continua sendo falha temporaria.
 */
export function prosaFalhaDoModelo(finishReason: string): string {
  if (/openrouter_http_402/.test(String(finishReason ?? ""))) return PROSA_SALDO_OPENROUTER;
  return PROSA_FALHA_TEMPORARIA;
}
