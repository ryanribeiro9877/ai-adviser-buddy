// PROVA (nao entra no runtime):
//   deno run supabase/functions/_shared/_prova_identidade_instagram.ts
// Prova que o campo do object_story_spec e escolhido pelo FORMATO do id, para video e para imagem,
// e que o caso sem identidade continua nascendo sem id (nenhum literal cravado).
import {
  aplicarIdentidadeInstagramNoSpec,
  avisoIdentidadeInstagram,
  campoIdentidadeInstagramPorFormato,
  SEM_IDENTIDADE_INSTAGRAM,
  type IdentidadeInstagramResolvida,
} from "./identidade_instagram.ts";

let falhas = 0;
function check(nome: string, cond: boolean, detalhe?: unknown) {
  console.log(`${cond ? "OK  " : "FALHA"} :: ${nome}`);
  if (!cond) {
    falhas++;
    if (detalhe !== undefined) console.log("      detalhe:", JSON.stringify(detalhe));
  }
}

// Identidade oficial hoje: @jcr2_legaleviver, id informado pelo Ryan (11/08/2026), formato legado.
const JCR2: IdentidadeInstagramResolvida = {
  encontrada: true,
  instagram_actor_id: "1296945687078272",
  instagram_handle: "@jcr2_legaleviver",
  fonte: "config_empresa",
  procedencia: "informado pelo Ryan 11/08/2026 (Identidade do Gerenciador)",
  vinculo_pagina_confirmado: false,
};

// Hipotetico IBA id, para provar que a logica e por formato e nao hardcode.
const IBA: IdentidadeInstagramResolvida = {
  ...JCR2,
  instagram_actor_id: "17841423949227215",
  instagram_handle: "@algum_iba",
};

console.log("== formato -> campo ==");
check(
  "1296945687078272 (legado) -> instagram_actor_id",
  campoIdentidadeInstagramPorFormato("1296945687078272") === "instagram_actor_id",
);
check(
  "17841423949227215 (IBA) -> instagram_user_id",
  campoIdentidadeInstagramPorFormato("17841423949227215") === "instagram_user_id",
);

console.log("\n== VIDEO: object_story_spec montado ==");
const specVideo = aplicarIdentidadeInstagramNoSpec(
  {
    page_id: "1095196357012756",
    instagram_user_id: "17841428674060566", // lixo herdado do molde antigo
    video_data: { video_id: "24", message: "legenda", call_to_action: { type: "LEARN_MORE" } },
  },
  JCR2,
);
console.log(JSON.stringify(specVideo, null, 2));
check("video: id no instagram_actor_id", specVideo.instagram_actor_id === "1296945687078272");
check("video: instagram_user_id removido", specVideo.instagram_user_id === undefined);
check("video: video_data preservado", !!(specVideo as any).video_data?.video_id);

console.log("\n== IMAGEM: object_story_spec montado ==");
const specImagem = aplicarIdentidadeInstagramNoSpec(
  {
    page_id: "1095196357012756",
    link_data: {
      image_hash: "abc123",
      link: "https://legaleviver.com.br/simulacao-clt",
      message: "legenda",
    },
  },
  JCR2,
);
console.log(JSON.stringify(specImagem, null, 2));
check("imagem: id no instagram_actor_id", specImagem.instagram_actor_id === "1296945687078272");
check("imagem: instagram_user_id ausente", specImagem.instagram_user_id === undefined);
check("imagem: link_data preservado", !!(specImagem as any).link_data?.image_hash);

console.log("\n== IBA (nao quebrar o dia em que o id for 1784...) ==");
const specIba = aplicarIdentidadeInstagramNoSpec({ page_id: "1095196357012756" }, IBA);
console.log(JSON.stringify(specIba));
check("IBA: id no instagram_user_id", specIba.instagram_user_id === "17841423949227215");
check("IBA: instagram_actor_id ausente", specIba.instagram_actor_id === undefined);

console.log("\n== SEM identidade: nada e inventado ==");
const specSem = aplicarIdentidadeInstagramNoSpec(
  { page_id: "1095196357012756" },
  SEM_IDENTIDADE_INSTAGRAM,
);
console.log(JSON.stringify(specSem));
check(
  "sem fonte: nenhum campo de identidade",
  specSem.instagram_actor_id === undefined && specSem.instagram_user_id === undefined,
);

console.log("\n== nota ao gestor ==");
const nota = avisoIdentidadeInstagram(JCR2);
console.log(nota);
check("nota cita @jcr2_legaleviver", nota.includes("@jcr2_legaleviver"));
check("nota cita o id", nota.includes("1296945687078272"));
check("nota declara identidade legada", nota.includes("IDENTIDADE LEGADA"));
check("nota declara vinculo nao confirmado", nota.includes("NAO foi confirmado"));
check("nota manda revalidar se a Meta recusar", nota.includes("revalidado no Gerenciador"));
check("nota mantem Threads desabilitado", nota.includes("Threads permanece DESABILITADO"));

const notaIba = avisoIdentidadeInstagram(IBA);
check("nota IBA nao alega legado", !notaIba.includes("IDENTIDADE LEGADA"));

console.log(`\n${falhas === 0 ? "TODAS AS PROVAS PASSARAM" : `${falhas} FALHA(S)`}`);
if (falhas > 0) Deno.exit(1);
