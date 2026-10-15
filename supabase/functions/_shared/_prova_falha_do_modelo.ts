// Prova de prosaFalhaDoModelo: o fim do turno do CONJ.4 (15/10/2026, conversa bf4a8869,
// mensagem a99f3fac). O log da edge registrou `openrouter_http_402` com
// "in_flight_budget_exhausted ... add credits" (13:19:08 e 13:19:16, Grok 4.7 e o fallback 4.6),
// tokens_in 0 — e o gestor leu "o modelo nao respondeu a tempo (falha temporaria)". Era saldo da
// OpenRouter, nao demora; reenviar sem saldo repete a mesma recusa.
// Roda com: deno run --no-code-cache --allow-read --allow-env supabase/functions/_shared/_prova_falha_do_modelo.ts

import { prosaFalhaDoModelo, recusaPorSaldo } from "./falha_do_modelo.ts";

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

// ===== 4) 402 DEPOIS de ferramenta lida nao vira "orcamento desta janela esgotou" =====
// Mesmo incidente, um passo antes: o segmento 2 (mensagem 93df9658, 13:19:13) leu 5 ferramentas
// e a 4a chamada do modelo levou 402. Como havia coleta, o fim do turno tratou como falta de tempo:
// gravou checkpoint e respondeu "continuando automaticamente a partir do ponto em que o orcamento
// desta janela esgotou". O front continuou na hora e o segmento 3 levou o MESMO 402 oito segundos
// depois (a99f3fac). Saldo nao volta sozinho em 8s; a continuacao so repetiu a recusa.
{
  ok(recusaPorSaldo("openrouter_http_402"), "402 nao reconhecido como recusa por saldo");
  ok(recusaPorSaldo("openrouter_http_402+prosa_modelo_falhou"), "402 com sufixo nao reconhecido");
  for (const fr of ["openrouter_timeout", "orcamento_tempo_esgotado", "openrouter_http_502", "stop", "tool_calls", ""]) {
    ok(!recusaPorSaldo(fr), `${fr || "(vazio)"} virou recusa por saldo`);
  }
  // Card que saiu antes da recusa nao pode sumir da resposta.
  const comCards = sem(prosaFalhaDoModelo("openrouter_http_402", { cardsEmitidos: 2 }));
  ok(/(saldo|credito)/.test(comCards), "402 com cards perdeu o aviso de saldo");
  ok(/2 pedido/.test(comCards), "402 com cards nao diz que 2 pedidos de aprovacao ja sairam");
  ok(!/2 pedido/.test(sem(prosaFalhaDoModelo("openrouter_http_402", { cardsEmitidos: 0 }))), "sem card citou pedido");

  const chat = await Deno.readTextFile(new URL("../traffic-chat/index.ts", import.meta.url));
  const def = chat.match(/const turnoIncompletoPorTempo = ([^;]*?)\(/);
  ok(!!def, "definicao de turnoIncompletoPorTempo nao encontrada");
  ok(/!falhaSaldoOpenRouter/.test(def?.[1] ?? ""), "402 depois de coleta ainda abre continuacao automatica");
  ok(/const falhaSaldoOpenRouter = recusaPorSaldo\(/.test(chat), "falhaSaldoOpenRouter nao vem de recusaPorSaldo");
  // A sintese pos-laco tambem bate na OpenRouter: com 402 ela so repetiria a recusa.
  ok(
    /if \(!reply && !atalhoMetaDicas && !recusaPorSaldo\(finishReason\)/.test(chat),
    "sintese pos-laco ainda roda depois de 402",
  );
}

console.log("ok: _prova_falha_do_modelo");
