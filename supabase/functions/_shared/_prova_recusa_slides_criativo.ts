// As duas recusas de contagem de slides. O card (traffic-chat) e o executor
// (meta-actions) chamam a mesma funcao antes de gravar.
// Roda com: deno run supabase/functions/_shared/_prova_recusa_slides_criativo.ts

import { montarCriativoCarrossel, montarCriativoDeClique, recusarContagemDeSlides } from "./criativo_whatsapp.ts";

function ok(cond: boolean, msg: string) {
  if (!cond) {
    console.error(`FALHOU: ${msg}`);
    Deno.exit(1);
  }
}

const dois = {
  child_attachments: [
    { image_hash: "aaa", link: "https://exemplo/1" },
    { image_hash: "bbb", link: "https://exemplo/2" },
  ],
};
const um = { image_hash: "aaa", link: "https://exemplo/1" };

const recusaNomeErrado = recusarContagemDeSlides("criar_criativo", dois);
ok(recusaNomeErrado?.ok === false, "criar_criativo com 2 slides deveria recusar");
ok(recusaNomeErrado?.erro === "carrossel_na_acao_errada", "recusa deveria apontar a acao errada");
ok(
  (recusaNomeErrado?.detalhe ?? "").includes("criar_criativo_carrossel"),
  "a recusa deveria nomear criar_criativo_carrossel",
);

const recusaAtalho = recusarContagemDeSlides("criar_criativo_carrossel", um);
ok(recusaAtalho?.ok === false, "carrossel com menos de 2 slides deveria recusar");
ok(recusaAtalho?.erro === "carrossel_sem_slides_suficientes", "recusa do atalho graph");
ok(
  (recusaAtalho?.detalhe ?? "").includes("criar_criativo"),
  "a recusa deveria devolver o criativo comum para criar_criativo",
);

ok(recusarContagemDeSlides("criar_criativo", um) === null, "uma peca em criar_criativo passa");
ok(recusarContagemDeSlides("criar_criativo_carrossel", dois) === null, "dois slides no carrossel passam a contagem");

const peloMontador = montarCriativoDeClique({
  ...dois,
  page_id: "1",
  instagram_actor_id: "1784",
  message: "texto",
});
ok(!peloMontador.ok && peloMontador.erro === "carrossel_na_acao_errada", "o montador de clique recusa carrossel antes do corpo");

const atalho = montarCriativoCarrossel({
  image_hash: "aaa",
  page_id: "1",
  instagram_actor_id: "1784",
  message: "texto",
});
ok(!atalho.ok && atalho.erro === "carrossel_sem_slides_suficientes", "o montador de carrossel recusa peca unica");

console.log("ok: _prova_recusa_slides_criativo");
