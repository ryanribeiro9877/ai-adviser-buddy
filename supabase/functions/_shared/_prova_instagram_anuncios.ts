import {
  campanhaNoEscopoVinculoIg,
  classificarVinculoIg,
  idsInstagramDoCreative,
  precisaRelincarParaOficial,
  recusarCampanhaForaEscopoIg,
  specComIdentidadeOficial,
} from "./instagram_anuncios.ts";

function assert(cond: boolean, msg: string) {
  if (!cond) throw new Error(msg);
}

assert(classificarVinculoIg({ handle: "@coop_cohapm" }) === "coop_cohapm", "coop handle");
assert(
  classificarVinculoIg({
    id: "17841439127453101",
    oficialId: "17841439127453101",
    oficialHandle: "@cohapm",
  }) === "cohapm",
  "oficial por id mesmo sem handle",
);
assert(
  classificarVinculoIg({ id: "17841439127453101", handle: null, oficialId: "999" }) ===
    "id_sem_handle",
  "id sem username",
);
assert(classificarVinculoIg({ handle: "@cohapm" }) === "cohapm", "handle oficial");
assert(classificarVinculoIg({}) === "sem_vinculo", "vazio");

assert(
  precisaRelincarParaOficial("1", "17841439127453101") === true,
  "outro id precisa",
);
assert(
  precisaRelincarParaOficial("17841439127453101", "17841439127453101") === false,
  "ja oficial",
);

assert(
  campanhaNoEscopoVinculoIg("COHAPM_LAFELICITA_CONV_AGO26") === true,
  "campanha trabalho",
);
assert(campanhaNoEscopoVinculoIg("COHAPM_JURIDICO_CONV_LEVA01") === false, "juridico fora");
assert(
  campanhaNoEscopoVinculoIg("[SALT] [LF | CONV | OBRA + GEO + LISTA | WA]") === false,
  "salt fora",
);
assert(recusarCampanhaForaEscopoIg("COHAPM_JURIDICO_X").ok === false, "recusa juridico");
assert(recusarCampanhaForaEscopoIg("COHAPM_LAFELICITA_CONV_AGO26").ok === true, "aceita laf");

const ids = idsInstagramDoCreative({
  object_story_spec: { instagram_user_id: "17841439127453101", page_id: "1" },
});
assert(ids.id === "17841439127453101", "extrai user id");

const spec = specComIdentidadeOficial(
  {
    page_id: "109",
    instagram_user_id: "111",
    video_data: { video_id: "v", image_url: "u", image_hash: "h", link: "http://x" },
  },
  {
    encontrada: true,
    instagram_actor_id: "17841439127453101",
    instagram_handle: "@cohapm",
    fonte: "config_empresa",
    procedencia: "prova",
    vinculo_pagina_confirmado: null,
  },
);
assert(spec.instagram_user_id === "17841439127453101", "iba no campo user_id");
assert(spec.instagram_actor_id === undefined, "sem actor conflitante");
const vd = spec.video_data as Record<string, unknown>;
assert(vd.link === undefined, "link topo removido");
assert(!(vd.image_url && vd.image_hash), "nao envia url+hash");

console.log("ok instagram_anuncios");
