// Prova do espelho Deno de lote-criativo. O CONJ.4 (02/09/2026) nao casava
// (so 6/8 e conjunto 2/3) e o teto de coleta caiu para 55s.
// Roda: deno run --allow-read supabase/functions/_shared/_prova_lote_criativo.ts

import { pedidoLoteCriativo } from "./lote_criativo.ts";

function ok(cond: boolean, msg: string) {
  if (!cond) {
    console.error(`FALHOU: ${msg}`);
    Deno.exit(1);
  }
}

ok(
  pedidoLoteCriativo(
    "agora faça o mesmo para o conjunto 4, seguindo o mesmo processo de seleção e legendas, mas dessa vez serão 7 criativos, todos diferentes dos criativos que estão nos outros conjuntos. realize esse processo e emita os primeiros cards para aprovação",
  ),
  "pedido literal do CONJ.4 nao e lote",
);

ok(
  pedidoLoteCriativo(
    "escolha 6 criativos diferentes do conjunto ativo e gere as legendas",
  ),
  "lote de 6 + legendas quebrou",
);

ok(
  !pedidoLoteCriativo("quanto gastamos ontem no conjunto 1?"),
  "pergunta de gasto virou lote",
);

console.log("ok: _prova_lote_criativo");
