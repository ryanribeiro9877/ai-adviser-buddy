// Prova de deveForcarEmissao: o caso real do CONJ.2_VISTTA (01/09/2026, 19:00–19:30), em que
// cinco rodadas seguidas anunciaram cards de pausa e de anuncio sem UMA chamada de
// propose_action, e nenhum card existiu.
// Roda com: deno run supabase/functions/_shared/_prova_forcar_emissao.ts

import { deveForcarEmissao, pedidoSoLegendasSemEmissao } from "./intencao_turno.ts";

function ok(cond: boolean, msg: string) {
  if (!cond) {
    console.error(`FALHOU: ${msg}`);
    Deno.exit(1);
  }
}

// 1) O incidente: gestor mandou emitir card de exclusao, o turno leu acervo e gerou legenda,
//    e nao chamou propose_action nenhuma vez.
{
  ok(
    deveForcarEmissao({
      pedido: "emita cards de exclusão para cada um deles",
      chamouPropose: false,
      cardsEmitidos: 0,
    }),
    "nao insistiu no pedido de emissao sem propose_action",
  );
}

// 2) "gere os cards, eles não chegaram aqui para aprovação ainda, emita-os" — o hifen nao pode
//    esconder o verbo.
{
  ok(
    deveForcarEmissao({
      pedido: "gere os cards, eles não chegaram aqui para aprovação ainda, emita-os",
      chamouPropose: false,
      cardsEmitidos: 0,
    }),
    "verbo colado em hifen nao foi reconhecido",
  );
}

// 3) propose_action FOI chamada e recusou: recusa e informacao honesta, com motivo. Insistir
//    so repetiria o mesmo erro e queimaria a janela.
{
  ok(
    !deveForcarEmissao({
      pedido: "emita os cards",
      chamouPropose: true,
      cardsEmitidos: 0,
    }),
    "insistiu mesmo apos a ferramenta ter sido chamada e recusado",
  );
}

// 4) Card saiu de verdade: nada a forcar.
{
  ok(
    !deveForcarEmissao({
      pedido: "emita os cards",
      chamouPropose: true,
      cardsEmitidos: 2,
    }),
    "insistiu com card ja emitido",
  );
}

// 5) Pergunta de leitura nao vira emissao — pedir card sobre "consulte o resultado" seria
//    inventar ato que o gestor nao pediu.
{
  ok(
    !deveForcarEmissao({
      pedido: "o anúncio está com o mesmo link?",
      chamouPropose: false,
      cardsEmitidos: 0,
    }),
    "forcou emissao em pergunta de leitura",
  );
}

// 6) Sem tempo de janela: insistir agora entrega 504 em vez de card.
{
  ok(
    !deveForcarEmissao({
      pedido: "emita os cards",
      chamouPropose: false,
      cardsEmitidos: 0,
      semTempo: true,
    }),
    "insistiu com a janela esgotada",
  );
}

// 7) Uma insistencia por turno. Duas viraria laco gastando a janela sem entregar nada.
{
  ok(
    !deveForcarEmissao({
      pedido: "emita os cards",
      chamouPropose: false,
      cardsEmitidos: 0,
      jaInsistiu: true,
    }),
    "insistiu duas vezes no mesmo turno",
  );
}

// 8) Pedido de pausa tambem e ato: foi exatamente o que o gestor pediu para o CONJ.2.
{
  ok(
    deveForcarEmissao({
      pedido: "pause os 6 criativos ativos do CONJ.2",
      chamouPropose: false,
      cardsEmitidos: 0,
    }),
    "pedido de pausa nao contou como ato",
  );
}

// 9) CONJ.4 (02/09/2026): lote de 7 + "emita os primeiros cards". Sem isto o turno
//    encerrava a coleta e a sintese cega inventava UUID.
{
  ok(
    deveForcarEmissao({
      pedido:
        "agora faça o mesmo para o conjunto 4, seguindo o mesmo processo de seleção e legendas, mas dessa vez serão 7 criativos, todos diferentes dos criativos que estão nos outros conjuntos. realize esse processo e emita os primeiros cards para aprovação",
      chamouPropose: false,
      cardsEmitidos: 0,
      semTempo: false,
    }),
    "CONJ.4 com emita os primeiros cards nao forcou propose_action",
  );
}

// 10) 02/09/2026: "selecione 6 videos do drive do juridico e crie legendas". "crie" e verbo de
//     ato, mas o ato e escrever copy. Forcar propose_action aqui emitiria anuncio nao pedido.
{
  ok(
    !deveForcarEmissao({
      pedido:
        "selecione 6 vídeos diferentes de dentro do drive do jurídico (qualquer pasta) e crie legendas para cada um deles",
      chamouPropose: false,
      cardsEmitidos: 0,
    }),
    "pedido de legendas virou pressao por card",
  );
  ok(
    pedidoSoLegendasSemEmissao(
      "selecione 6 vídeos diferentes de dentro do drive do jurídico (qualquer pasta) e crie legendas para cada um deles",
    ),
    "pedido de legendas nao foi reconhecido como sem emissao",
  );
  // O mesmo lote PEDINDO card continua sendo emissao.
  ok(
    !pedidoSoLegendasSemEmissao(
      "selecione 6 videos, crie legendas e emita os primeiros cards para aprovacao",
    ),
    "pedido com card foi tratado como so legendas",
  );
  ok(
    deveForcarEmissao({
      pedido: "selecione 6 videos, crie legendas e emita os primeiros cards para aprovacao",
      chamouPropose: false,
      cardsEmitidos: 0,
    }),
    "legendas + emita cards deixou de forcar propose_action",
  );
}

console.log("ok: _prova_forcar_emissao");
