// Prova de prosaFalhaDoModelo: o fim do turno do CONJ.4 (15/10/2026, conversa bf4a8869,
// mensagem a99f3fac). O log da edge registrou `openrouter_http_402` com
// "in_flight_budget_exhausted ... add credits" (13:19:08 e 13:19:16, Grok 4.7 e o fallback 4.6),
// tokens_in 0 — e o gestor leu "o modelo nao respondeu a tempo (falha temporaria)". Era saldo da
// OpenRouter, nao demora; reenviar sem saldo repete a mesma recusa.
// Roda com: deno run --no-code-cache --allow-read --allow-env supabase/functions/_shared/_prova_falha_do_modelo.ts

import { prosaFalhaDoModelo } from "./falha_do_modelo.ts";

function ok(cond: boolean, msg: string) {
  if (!cond) {
    console.error(`FALHOU: ${msg}`);
    Deno.exit(1);
  }
}

function sem(s: string): string {
  return s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
}

// ===== 1) O incidente: 402 vira aviso de saldo, nao de demora =====
{
  const t = sem(prosaFalhaDoModelo("openrouter_http_402+prosa_modelo_falhou"));
  ok(!/nao respondeu a tempo/.test(t), "402 continua dizendo que o modelo nao respondeu a tempo");
  ok(/openrouter/.test(t), "402 nao diz que quem recusou foi a OpenRouter");
  ok(/402/.test(t), "402 nao cita o codigo que o log registrou");
  ok(/(saldo|credito)/.test(t), "402 nao diz que o motivo e saldo/credito");
  const sem402 = sem(prosaFalhaDoModelo("openrouter_http_402"));
  ok(/(saldo|credito)/.test(sem402), "402 sem sufixo nao foi reconhecido");
}

// ===== 2) Demora de verdade continua com o texto de demora =====
{
  for (const fr of ["openrouter_timeout", "openrouter_empty", "openrouter_fetch_failed", "openrouter_http_502"]) {
    const t = sem(prosaFalhaDoModelo(fr));
    ok(/nao respondeu a tempo|falha temporaria/.test(t), `${fr} perdeu o texto de falha temporaria`);
    ok(!/(saldo|credito)/.test(t), `${fr} passou a falar de saldo sem ser 402`);
  }
}

// ===== 3) O chat usa a prosa daqui =====
{
  const chat = await Deno.readTextFile(new URL("../traffic-chat/index.ts", import.meta.url));
  ok(/prosaFalhaDoModelo\(/.test(chat), "traffic-chat nao chama prosaFalhaDoModelo");
  ok(!/reply = REPLY_MODELO_FALHOU;/.test(chat), "traffic-chat ainda responde REPLY_MODELO_FALHOU fixo");
}

console.log("ok: _prova_falha_do_modelo");
