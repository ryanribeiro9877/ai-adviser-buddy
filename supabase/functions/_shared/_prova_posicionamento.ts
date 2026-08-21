// PROVA (nao entra no runtime): deno run supabase/functions/_shared/_prova_posicionamento.ts
import {
  aplicarPadraoPosicionamentoVideo,
  aplicarPosicionamentoPorPlataformas,
  FACEBOOK_POSITIONS_VIDEO_PADRAO,
  targetingCompativelComFormato,
  validarPlataformasPublicacao,
} from "./posicionamento.ts";

const ESPERADO_8 = [
  "feed",
  "instream_video",
  "marketplace",
  "story",
  "search",
  "facebook_reels",
  "facebook_reels_overlay",
  "profile_feed",
];

function eq(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}
let falhas = 0;
function check(nome: string, cond: boolean, detalhe?: unknown) {
  console.log(`${cond ? "OK  " : "FALHA"} :: ${nome}`);
  if (!cond) {
    falhas++;
    if (detalhe !== undefined) console.log("      detalhe:", JSON.stringify(detalhe));
  }
}

const moldeTargeting = {
  geo_locations: { countries: ["BR"] },
  age_min: 25,
  age_max: 65,
  custom_audiences: [{ id: "1234567890" }],
  targeting_automation: { advantage_audience: 1 },
  publisher_platforms: ["facebook", "instagram", "threads", "audience_network", "messenger"],
  facebook_positions: ["feed", "right_hand_column", "marketplace"],
  instagram_positions: ["stream", "story"],
  threads_positions: ["threads_stream"],
  audience_network_positions: ["classic"],
  messenger_positions: ["messenger_home"],
};

// PROVA 1: Facebook+video => 8 placements sem right_hand_column
const fbVideo = aplicarPosicionamentoPorPlataformas(moldeTargeting, "video", ["facebook"]);
check("FB+VIDEO: 8 facebook_positions", eq(fbVideo.targeting?.facebook_positions, ESPERADO_8), fbVideo.targeting?.facebook_positions);
check("FB+VIDEO: publisher=[facebook]", eq(fbVideo.targeting?.publisher_platforms, ["facebook"]));
check("FB+VIDEO: sem right_hand_column", !(fbVideo.targeting?.facebook_positions as string[])?.includes("right_hand_column"));
check("FB+VIDEO: Threads fora", fbVideo.targeting?.threads_positions === undefined && (fbVideo.excluidos.includes("threads")));

// PROVA 2: imagem nao exclui Coluna
const img = aplicarPosicionamentoPorPlataformas(moldeTargeting, "imagem", ["facebook"]);
check("FB+IMAGEM: nao forca exclusao da Coluna nos excluidos de right_hand",
  !img.excluidos.includes("facebook.right_hand_column"), img.excluidos);

// PROVA 3: Threads recusado por nome
const thr = validarPlataformasPublicacao(["facebook", "threads"]);
check("THREADS: recusa nomeada", thr.erro === "threads_desabilitado_empresa_sem_cadastro", thr);

// PROVA 4: sem plataformas => obrigatorio
const sem = validarPlataformasPublicacao([]);
check("SEM PLATAFORMAS: obrigatorio", sem.erro === "plataformas_de_publicacao_obrigatorias", sem);

// PROVA 5: Facebook+Instagram video inclui IG e corta Threads
const fbIg = aplicarPosicionamentoPorPlataformas(moldeTargeting, "video", ["facebook", "instagram"]);
check("FB+IG: publishers corretos", eq(fbIg.targeting?.publisher_platforms, ["facebook", "instagram"]));
check("FB+IG: tem instagram_positions", Array.isArray(fbIg.targeting?.instagram_positions));
check("FB+IG: sem explore", !(fbIg.targeting?.instagram_positions as string[])?.includes("explore"));
check("FB+IG: sem explore_home", !(fbIg.targeting?.instagram_positions as string[])?.includes("explore_home"));
check("FB+IG: sem threads_positions", fbIg.targeting?.threads_positions === undefined);

// PROVA 6: corretivo video (compat) ainda monta os 8
const video = aplicarPadraoPosicionamentoVideo(moldeTargeting);
check("CORRETIVO VIDEO: 8 positions", eq(video.targeting.facebook_positions, FACEBOOK_POSITIONS_VIDEO_PADRAO));

// PROVA 7: corretivo imagem remove threads se presente
const imgCorr = targetingCompativelComFormato(moldeTargeting, "imagem");
check("CORRETIVO IMAGEM: remove threads", imgCorr.excluidos.includes("threads") && imgCorr.targeting?.threads_positions === undefined, imgCorr);

console.log(falhas === 0 ? "\nTODAS AS PROVAS PASSARAM" : `\n${falhas} PROVA(S) FALHARAM`);
if (falhas > 0) Deno.exit(1);
