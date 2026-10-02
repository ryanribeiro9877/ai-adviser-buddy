import { montarCriativoDeClique } from "./criativo_whatsapp.ts";

function assert(cond: unknown, msg: string) {
  if (!cond) throw new Error(`FALHA: ${msg}`);
}

const semSaudacao = montarCriativoDeClique({
  video_id: "111",
  thumbnail_url: "https://exemplo/capa.jpg",
  page_id: "105",
  instagram_actor_id: "17841400000000000",
  message: "Ola",
  destination_type: "WHATSAPP",
  call_to_action_type: "WHATSAPP_MESSAGE",
});
assert(!semSaudacao.ok && semSaudacao.erro === "page_welcome_message_obrigatoria", "whatsapp sem saudacao nao nasce");

const ctaErrado = montarCriativoDeClique({
  video_id: "111",
  thumbnail_url: "https://exemplo/capa.jpg",
  page_id: "105",
  instagram_actor_id: "17841400000000000",
  message: "Ola",
  destination_type: "WHATSAPP",
  call_to_action_type: "LEARN_MORE",
  page_welcome_message: { saudacao: "Oi", pergunta: "Quero saber" },
});
assert(!ctaErrado.ok && ctaErrado.erro === "cta_incompativel_com_destino", "Saiba mais em conjunto de conversa e recusado");

const semCapa = montarCriativoDeClique({
  video_id: "111",
  page_id: "105",
  instagram_actor_id: "17841400000000000",
  message: "Ola",
  destination_type: "WHATSAPP",
  page_welcome_message: { saudacao: "Oi", pergunta: "Quero saber" },
});
assert(!semCapa.ok && semCapa.erro === "thumbnail_url_obrigatoria", "video sem capa recusa");

const ok = montarCriativoDeClique({
  nome: "AD_LF_01",
  video_id: "999",
  thumbnail_url: "https://exemplo/capa.jpg",
  page_id: "105656372312257",
  instagram_actor_id: "17841400000000001",
  message: "Conheca o La Felicita",
  destination_type: "WHATSAPP",
  page_welcome_message: { saudacao: "Oi, aqui e o La Felicita", pergunta: "Quero saber dos imoveis" },
});
assert(ok.ok, "criativo valido");
if (ok.ok) {
  const spec = JSON.parse(ok.body.object_story_spec);
  assert(spec.video_data.page_welcome_message.text_format.message.text === "Oi, aqui e o La Felicita", "saudacao");
  assert(spec.video_data.call_to_action.type === "WHATSAPP_MESSAGE", "cta");
  assert(spec.video_data.call_to_action.value.app_destination === "WHATSAPP", "app_destination");
  assert(spec.instagram_user_id === "17841400000000001", "iba vai para instagram_user_id");
  const dof = JSON.parse(ok.body.degrees_of_freedom_spec);
  assert(dof.creative_features_spec.standard_enhancements.enroll_status === "OPT_OUT", "melhorias desligadas");
  assert(!ok.resumo.includes("{"), "card nao e json cru");
  assert(ok.resumo.includes("Oi, aqui e o La Felicita"), "card le a saudacao");
}

console.log("OK criativo_whatsapp");
