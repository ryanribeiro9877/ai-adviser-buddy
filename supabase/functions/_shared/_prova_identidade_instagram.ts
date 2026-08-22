// PROVA (nao entra no runtime):
//   deno run supabase/functions/_shared/_prova_identidade_instagram.ts
// Prova que o campo do object_story_spec e escolhido pelo FORMATO do id, para video e para imagem,
// e que o caso sem identidade continua nascendo sem id (nenhum literal cravado).
import {
  aplicarIdentidadeInstagramNoSpec,
  avisoIdentidadeInstagram,
  campoIdentidadeInstagramPorFormato,
  ERRO_INSTAGRAM_NAO_VINCULADO,
  exigirIdentidadeRedes,
  identidadeInstagramProibida,
  plataformasIncluemInstagram,
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

// Identidade oficial Legal: @legaleviver_ (IBA).
const OFICIAL: IdentidadeInstagramResolvida = {
  encontrada: true,
  instagram_actor_id: "17841428674060566",
  instagram_handle: "@legaleviver_",
  fonte: "config_empresa",
  procedencia: "meta_execution_config oficial",
  vinculo_pagina_confirmado: false,
};

// Ator legado hipotetico — so para provar escolha por formato (nao e identidade oficial).
const LEGADO_HIPOTETICO: IdentidadeInstagramResolvida = {
  encontrada: true,
  instagram_actor_id: "1200000000000000",
  instagram_handle: "@legado_teste",
  fonte: "config_empresa",
  procedencia: "prova de formato",
  vinculo_pagina_confirmado: false,
};

console.log("== formato -> campo ==");
check(
  "1200000000000000 (legado) -> instagram_actor_id",
  campoIdentidadeInstagramPorFormato("1200000000000000") === "instagram_actor_id",
);
check(
  "17841428674060566 (IBA) -> instagram_user_id",
  campoIdentidadeInstagramPorFormato("17841428674060566") === "instagram_user_id",
);
check("handle oficial nao e proibido", identidadeInstagramProibida("@legaleviver_") === false);
check("id oficial nao e proibido", identidadeInstagramProibida("17841428674060566") === false);

console.log("\n== VIDEO: object_story_spec montado ==");
const specVideo = aplicarIdentidadeInstagramNoSpec(
  {
    page_id: "1095196357012756",
    instagram_actor_id: "1200000000000000",
    video_data: { video_id: "24", message: "legenda", call_to_action: { type: "LEARN_MORE" } },
  },
  OFICIAL,
);
console.log(JSON.stringify(specVideo, null, 2));
check("video: id no instagram_user_id", specVideo.instagram_user_id === "17841428674060566");
check("video: instagram_actor_id removido", specVideo.instagram_actor_id === undefined);
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
  OFICIAL,
);
console.log(JSON.stringify(specImagem, null, 2));
check("imagem: id no instagram_user_id", specImagem.instagram_user_id === "17841428674060566");
check("imagem: instagram_actor_id ausente", specImagem.instagram_actor_id === undefined);
check("imagem: link_data preservado", !!(specImagem as any).link_data?.image_hash);

console.log("\n== LEGADO hipotetico (formato) ==");
const specLegado = aplicarIdentidadeInstagramNoSpec(
  { page_id: "1095196357012756", instagram_user_id: "17841428674060566" },
  LEGADO_HIPOTETICO,
);
check("legado: campo instagram_actor_id", specLegado.instagram_actor_id === "1200000000000000");
check("legado: user_id limpo", specLegado.instagram_user_id === undefined);

console.log("\n== sem identidade ==");
const specSem = aplicarIdentidadeInstagramNoSpec(
  { page_id: "1095196357012756", instagram_user_id: "x" },
  SEM_IDENTIDADE_INSTAGRAM,
);
check("sem identidade: nao altera spec herdado", specSem.instagram_user_id === "x");

const nota = avisoIdentidadeInstagram(OFICIAL);
check("nota cita @legaleviver_", nota.includes("@legaleviver_"));
check("nota cita o id IBA", nota.includes("17841428674060566"));

console.log("\n== fail-closed Instagram nas plataformas ==");
check("default (omitido) inclui instagram", plataformasIncluemInstagram(undefined) === true);
check("facebook+instagram inclui", plataformasIncluemInstagram(["facebook", "instagram"]) === true);
check("so facebook nao exige", plataformasIncluemInstagram(["facebook"]) === false);
const recusa = exigirIdentidadeRedes({ plataformas: ["facebook", "instagram"], identidade: SEM_IDENTIDADE_INSTAGRAM });
check("sem id recusa instagram_nao_vinculado", recusa.ok === false && recusa.erro === ERRO_INSTAGRAM_NAO_VINCULADO);
const okId = exigirIdentidadeRedes({ plataformas: null, identidade: OFICIAL });
check("com id da config aceita", okId.ok === true && okId.id === "17841428674060566");
const soFb = exigirIdentidadeRedes({ plataformas: ["facebook"], identidade: SEM_IDENTIDADE_INSTAGRAM });
check("facebook-only sem id passa", soFb.ok === true);

if (falhas > 0) {
  console.error(`\n${falhas} falha(s)`);
  Deno.exit(1);
}
console.log("\nTodas as provas OK.");
