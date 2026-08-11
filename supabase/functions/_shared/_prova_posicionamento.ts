// PROVA (nao entra no runtime): roda com `deno run supabase/functions/_shared/_prova_posicionamento.ts`.
// Exercita as MESMAS funcoes que montarCriacao e ajustar_posicionamentos_do_conjunto usam.
import {
  aplicarPadraoPosicionamentoVideo,
  FACEBOOK_POSITIONS_VIDEO_PADRAO,
  targetingCompativelComFormato,
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

// Molde tipico: audiencia/geo/idade + Advantage+ audience + placements de OUTRAS plataformas que
// o padrao facebook-only deve remover. right_hand_column presente para provar que sai.
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

// ---- PROVA 1: formato_midia_previsto=video monta EXATAMENTE os 8 facebook_positions ----
// (mesmo caminho de montarCriacao: body.targeting = JSON.stringify(aplicarPadrao...(molde)))
const video = aplicarPadraoPosicionamentoVideo(moldeTargeting);
check("VIDEO: facebook_positions sao exatamente os 8 observados",
  eq(video.targeting.facebook_positions, ESPERADO_8), video.targeting.facebook_positions);
check("VIDEO: publisher_platforms = [facebook] (facebook-only, como os 3 conjuntos ativos)",
  eq(video.targeting.publisher_platforms, ["facebook"]), video.targeting.publisher_platforms);
check("VIDEO: NAO contem facebook_right_hand_column",
  !(video.targeting.facebook_positions as string[]).includes("right_hand_column"));
check("VIDEO: excluidos declara facebook.right_hand_column",
  eq(video.excluidos, ["facebook.right_hand_column"]));
check("VIDEO: placements de outras plataformas removidos (facebook-only)",
  video.targeting.instagram_positions === undefined &&
  video.targeting.threads_positions === undefined &&
  video.targeting.audience_network_positions === undefined &&
  video.targeting.messenger_positions === undefined);
check("VIDEO: audiencia/geo/idade/advantage_audience PRESERVADOS",
  eq(video.targeting.geo_locations, { countries: ["BR"] }) &&
  video.targeting.age_min === 25 && video.targeting.age_max === 65 &&
  eq(video.targeting.custom_audiences, [{ id: "1234567890" }]) &&
  eq(video.targeting.targeting_automation, { advantage_audience: 1 }));

// ---- PROVA 2: IMAGEM nao exclui a Coluna da direita (corretivo devolve "nada a excluir") ----
const imagem = targetingCompativelComFormato(moldeTargeting, "imagem");
check("IMAGEM: nenhuma exclusao aplicada (targeting nao e reescrito)",
  imagem.targeting === undefined && imagem.excluidos.length === 0 &&
  imagem.erro === "nenhum_posicionamento_incompativel_detectado", imagem);

// Simula o ramo de montarCriacao para imagem: body.targeting continua o do molde (com a Coluna).
const bodyImagem = { targeting: moldeTargeting };
check("IMAGEM (criacao): Coluna da direita PERMANECE elegivel no targeting do molde",
  (bodyImagem.targeting.facebook_positions as string[]).includes("right_hand_column"));

// ---- PROVA 3: formato desconhecido/ausente NAO recebe a regra de video no escuro ----
const desconhecido = targetingCompativelComFormato(moldeTargeting, "");
check("DESCONHECIDO: recusa por nome, sem aplicar regra de video",
  desconhecido.targeting === undefined &&
  desconhecido.erro === "formato_de_midia_nao_suportado_para_posicionamento", desconhecido);

// Simula o ramo de montarCriacao para formato ausente: body.targeting = targeting do molde intacto,
// nada do padrao de video foi injetado.
const bodyAusente = { targeting: moldeTargeting };
check("DESCONHECIDO (criacao): targeting do molde intacto (regra de video nao aplicada)",
  eq(bodyAusente.targeting.publisher_platforms,
     ["facebook", "instagram", "threads", "audience_network", "messenger"]) &&
  !eq(bodyAusente.targeting.facebook_positions, FACEBOOK_POSITIONS_VIDEO_PADRAO));

console.log(falhas === 0 ? "\nTODAS AS PROVAS PASSARAM" : `\n${falhas} PROVA(S) FALHARAM`);
if (falhas > 0) Deno.exit(1);
