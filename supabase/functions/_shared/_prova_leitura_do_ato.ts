// Prova de podeLerAposPrazoDeColeta: o caso real do CONJ.4 MELHORES_CRIATIVOS (15/10/2026,
// conversa bf4a8869, mensagem 9449ba10). O gestor pediu para criar o conjunto com o publico dos
// conjuntos juridicos e R$ 23,00. A primeira chamada do modelo levou ~57s (13:17:36 -> 13:18:33)
// depois de 12s do roteador; ao pedir get_estrutura_conjuntos e get_campaign_detail o turno ja
// passava dos 55s de coleta e as SETE leituras do bloco voltaram "deadline de coleta — o dado
// NAO foi lido" com ms_ferramentas = 0. O laco seguiu chamando o modelo para emitir o card
// (precisaProposeAto) mas recusando a leitura que o card exigia: 6 rodadas, ~240k tokens, nenhum
// card. No bloco seguinte as mesmas leituras rodaram em 774ms.
// Roda com: deno run --no-code-cache --allow-read --allow-env supabase/functions/_shared/_prova_leitura_do_ato.ts

import { podeLerAposPrazoDeColeta } from "./leitura_do_ato.ts";

function ok(cond: boolean, msg: string) {
  if (!cond) {
    console.error(`FALHOU: ${msg}`);
    Deno.exit(1);
  }
}

// Relogio do incidente: HARD_LIMIT 118s, reserva de gravacao 8s, primeira leitura pedida aos ~70s.
const RESTANTE_NO_INCIDENTE = 118_000 - 70_000 - 8_000;

// ===== 1) O incidente: ato sem card, nenhuma leitura feita, 40s de janela =====
{
  ok(
    podeLerAposPrazoDeColeta({
      ferramenta: "get_estrutura_conjuntos",
      precisaCard: true,
      restanteMs: RESTANTE_NO_INCIDENTE,
    }),
    "o incidente: get_estrutura_conjuntos foi recusada com 40s de janela e o card dependendo dela",
  );
  ok(
    podeLerAposPrazoDeColeta({
      ferramenta: "get_campaign_detail",
      precisaCard: true,
      restanteMs: RESTANTE_NO_INCIDENTE,
    }),
    "o incidente: get_campaign_detail foi recusada com 40s de janela e o card dependendo dela",
  );
}

// ===== 2) Sem janela para ler E emitir depois: continua recusando =====
{
  ok(
    !podeLerAposPrazoDeColeta({
      ferramenta: "get_estrutura_conjuntos",
      precisaCard: true,
      restanteMs: 25_000,
    }),
    "leu com 25s de janela: nao sobra tempo para o propose_action e a resposta",
  );
}

// ===== 3) Card ja saiu, ou o turno nao e ato: o prazo de coleta vale como sempre =====
{
  ok(
    !podeLerAposPrazoDeColeta({
      ferramenta: "get_estrutura_conjuntos",
      precisaCard: false,
      restanteMs: RESTANTE_NO_INCIDENTE,
    }),
    "leitura sem card pendente furou o prazo de coleta (leitura pura reserva a janela para a prosa)",
  );
}

// ===== 4) So leitura passa. Escrita e propose tem regra propria =====
{
  for (const f of ["propose_action", "upload_midia", "gerar_legendas", "registrar_peca_da_conversa", ""]) {
    ok(
      !podeLerAposPrazoDeColeta({ ferramenta: f, precisaCard: true, restanteMs: RESTANTE_NO_INCIDENTE }),
      `'${f}' passou como leitura depois do prazo de coleta`,
    );
  }
  for (const f of ["get_detalhe_anuncios", "get_campaign_detail", "ler_objeto"]) {
    ok(
      podeLerAposPrazoDeColeta({ ferramenta: f, precisaCard: true, restanteMs: RESTANTE_NO_INCIDENTE }),
      `'${f}' e leitura e foi recusada com card pendente e janela livre`,
    );
  }
}

// ===== 5) O chat usa a regra daqui no corte por ferramenta =====
{
  const chat = await Deno.readTextFile(new URL("../traffic-chat/index.ts", import.meta.url));
  ok(/podeLerAposPrazoDeColeta\(/.test(chat), "traffic-chat nao chama podeLerAposPrazoDeColeta");
  const corte = chat.indexOf('"deadline de coleta — o dado NAO foi lido"');
  const chamada = chat.indexOf("podeLerAposPrazoDeColeta({");
  ok(corte > 0 && chamada > 0 && chamada < corte && corte - chamada < 3000,
    "podeLerAposPrazoDeColeta nao esta no corte por ferramenta do prazo de coleta");
}

console.log("ok: _prova_leitura_do_ato");
