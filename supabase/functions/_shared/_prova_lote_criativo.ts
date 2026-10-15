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

// 15/10/2026, conversa bf4a8869 (18:55 UTC). "conjunto 2" sozinho bastava para as DUAS metades
// da regra e o turno virava lote criativo: prazo de coleta 90s em vez de 55s. O card 2 comecou
// aos 72s, o compliance nao voltou e o gateway cortou o turno em 150s sem resposta gravada.
// O objetivo do turno e o composto de objetivoDoFio com as duas falas anteriores.
ok(!pedidoLoteCriativo("desative o conjunto 2 por favor"), "pausar o conjunto 2 virou lote criativo");
ok(
  !pedidoLoteCriativo(
    "crie um novo conjunto com o nome CONJ.4 MELHORES_CRIATIVOS e coloque as mesmas configurações que estão dentro dos conjuntos que já existem para público.\npara valores defina o 23,00\n" +
      "utilize esse número 71 9108-8073 da campanha pausada, continue com as mesmas configurações do conjunto 2 (bairros selecionados, público, idade) e emita o card com o nome do qual informei antes\n" +
      "agora atribua a esse conjunto os criativos:\n\nAD_C2_CARTAO_ARMADILHA\nAD_C3_VALOR_INCORRETO\nAD_C1_JUROS_ALTO",
  ),
  "objetivo do turno de 18:55 (tres anuncios ja existentes) virou lote criativo",
);
// O que "conjunto 2-4" ainda sinaliza quando vem com legenda ou com pedido de mais pecas.
ok(pedidoLoteCriativo("gere as legendas do conjunto 3"), "legendas do conjunto 3 deixou de ser lote");
ok(pedidoLoteCriativo("separe mais criativos para o conjunto 3"), "separe mais para o conjunto 3 deixou de ser lote");
ok(
  pedidoLoteCriativo(
    "separe mais 6 criativos diferentes, tanto um do outro (conjunto 2 e 3) quanto do conjunto inicial, e gere as legendas",
  ),
  "pedido original dos conjuntos 2 e 3 deixou de ser lote",
);
ok(
  pedidoLoteCriativo("escolha 6 diferentes do conjunto que está ativo e diferentes um do outro"),
  "6 diferentes sem legenda deixou de ser lote",
);

console.log("ok: _prova_lote_criativo");
