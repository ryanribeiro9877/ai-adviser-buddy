// Prova das recusas que a executora tira so do payload do card (precondicoes_criacao.ts).
//
// POR QUE EXISTE. Card aprovado e morto em recusa_do_proprio_sistema: 15/10/2026 (criar_conjunto,
// promoted_object em texto), 22/08 (criar_conjunto_a_partir_de mensagens sem whatsapp, tres
// cards), 21/08 (engajamento com CONVERSATIONS). Em todos o payload gravado ja dizia que a
// executora ia recusar. A mesma funcao agora roda antes do card nascer e no inicio da executora.
//
// Payloads "executou" sao copias de cards reais que a Meta aceitou (sem justificativa/avisos).
// Roda com: deno run --no-code-cache --allow-read --allow-env supabase/functions/_shared/_prova_precondicoes_criacao.ts

import { recusaDoPayloadDeCriacao } from "./precondicoes_criacao.ts";
import { conferirReexecucaoDoCard } from "./reexecucao_card.ts";

const falhas: string[] = [];
function ok(cond: unknown, msg: string) {
  if (!cond) falhas.push(msg);
}
function recusa(acao: string, p: Record<string, unknown>): string | null {
  return recusaDoPayloadDeCriacao(acao, JSON.parse(JSON.stringify(p)))?.erro ?? null;
}

// ---------- cards reais que executaram ----------
const campanhaEngaj = {
  page_id: "105656372312257", objetivo: "OUTCOME_ENGAGEMENT", nome_novo: "COHAPM_LAFELICITA_ENGAJ_TOFU_2026-10",
  nome_origem: "livre", conta_destino: "act_1622612945584817", destino_social: true, status_inicial: "ACTIVE",
  familia_objetivo: "engajamento", special_ad_categories: [],
};
const campanhaLeads = {
  page_id: null, objetivo: "OUTCOME_LEADS", nome_novo: "COHAPM_LAFELICITA_CONV_WA_TESTE_PERFIL_SET26",
  nome_origem: "livre", conta_destino: "act_1622612945584817", destino_social: false, status_inicial: "ACTIVE",
  familia_objetivo: "conversao", special_ad_categories: [],
};
const conjuntoCidades = {
  meio: "la_felicita", age_max: 65, age_min: 30, page_id: "105656372312257", objetivo: "OUTCOME_LEADS",
  idade_max: 65, idade_min: 30, nome_novo: "TOFU_CLASSE-MEDIA_BENS-MEDIO-ALTO_8CIDADES", sem_molde: true,
  molde_nome: "sem_molde", nome_origem: "livre", conta_destino: "act_1622612945584817",
  geo_locations: {
    cities: [
      { key: "267730", name: "Salvador" }, { key: "2684455", name: "Lauro de Freitas" },
      { key: "246867", name: "Camaçari" }, { key: "259674", name: "Mata de São João" },
      { key: "2684711", name: "Simões Filho" }, { key: "247422", name: "Candeias" },
      { key: "252968", name: "Feira de Santana" },
    ],
    location_types: ["home"],
  },
  destino_social: false, status_inicial: "ACTIVE", destination_type: "WHATSAPP", familia_objetivo: "mensagens",
  destino_mensagens: true, molde_external_id: "sem_molde", optimization_goal: "CONVERSATIONS", advantage_audience: 0,
  threads_desabilitado: true, campanha_destino_nome: "COHAPM_LAFELICITA_ENGAJ_TOFU_2026-10",
  whatsapp_phone_number: "557193923821", formato_midia_previsto: "video", orcamento_diario_reais: 300,
  plataformas_publicacao: ["facebook", "instagram"], campanha_destino_external_id: "120250312323360182",
  plataformas_default_aplicado: false, whats_app_business_phone_number_id: "1304408279415696",
};
const conjuntoPino = {
  ...conjuntoCidades,
  age_min: 25, idade_min: 25, nome_novo: "LAF_WA_CONJ.3_3180-3158_GEO_CAB",
  geo_locations: {
    location_types: ["home", "recent"],
    custom_locations: [{ radius: 80, latitude: -12.949141, longitude: -38.431033, distance_unit: "kilometer" }],
  },
  campanha_destino_nome: "COHAPM_LAFELICITA_CONV_WA_2026 - SETEMBRO", whatsapp_phone_number: "557131803158",
  orcamento_diario_reais: 30, campanha_destino_external_id: "120250192130160182", plataformas_default_aplicado: true,
  whats_app_business_phone_number_id: "1120827284438765",
};
const anuncioVideo = {
  legenda: "O fim de semana na praia pode virar endereço. Lotes no La Felicità.", page_id: "105656372312257",
  url_tags: "utm_source={{site_source_name}}&utm_medium=paid&utm_campaign=ad-c2-setembro-09&utm_content=ad-c2-setembro-09",
  nome_novo: "AD_C2_SETEMBRO_09", sem_molde: true, molde_nome: null, creative_id: null,
  destino_url: "https://api.whatsapp.com/send", nome_origem: "livre", utm_campaign: "ad-c2-setembro-09",
  conta_destino: "act_1622612945584817", drive_file_id: "1qzq8W2dmDb_M8IRKlCi5uH1OgzyarkKm",
  meta_video_id: "2884072215324908", status_inicial: "ACTIVE", tipo_de_pedido: "peca_nova", meta_image_hash: null,
  child_attachments: null, instagram_user_id: "17841439127453101", molde_external_id: null,
  instagram_actor_id: "17841439127453101", call_to_action_type: "WHATSAPP_MESSAGE",
  campanha_destino_nome: "COHAPM_LAFELICITA_ENGAJ_TOFU_2026-10",
  conjunto_destino_nome: "CONJ.1_TOFU_CLASSE-MEDIA_BENS-MEDIO-ALTO_8CIDADES", whatsapp_phone_number: "557193923821",
  conjunto_pedido_numero: 1, plataformas_publicacao: ["facebook", "instagram"],
  objetivo_campanha_destino: "OUTCOME_ENGAGEMENT", conjunto_destino_external_id: "120250316784130182",
  destino_do_anuncio: { caso: "mensagens_whatsapp", aplicavel: true, url_final: "https://api.whatsapp.com/send" },
};

ok(recusa("criar_campanha", campanhaEngaj) === null, `campanha de engajamento real recusada: ${recusa("criar_campanha", campanhaEngaj)}`);
ok(recusa("criar_campanha", campanhaLeads) === null, `campanha de leads real recusada: ${recusa("criar_campanha", campanhaLeads)}`);
ok(recusa("criar_conjunto_a_partir_de", conjuntoCidades) === null, `conjunto com 7 cidades real recusado: ${recusa("criar_conjunto_a_partir_de", conjuntoCidades)}`);
ok(recusa("criar_conjunto_a_partir_de", conjuntoPino) === null, `conjunto com pino real recusado: ${recusa("criar_conjunto_a_partir_de", conjuntoPino)}`);
ok(recusa("criar_anuncio_a_partir_de", anuncioVideo) === null, `anuncio de video real recusado: ${recusa("criar_anuncio_a_partir_de", anuncioVideo)}`);
ok(conferirReexecucaoDoCard("criar_conjunto_a_partir_de", conjuntoCidades, null).ok, "prova de reexecucao aprova conjunto real");
ok(conferirReexecucaoDoCard("criar_anuncio_a_partir_de", anuncioVideo, null).ok, "prova de reexecucao aprova anuncio real");

// ---------- recusas reais de 21-22/08/2026 (card nasceu, executora recusou) ----------
const semWhatsapp: Record<string, unknown> = { ...conjuntoPino, objetivo: "OUTCOME_LEADS" };
delete semWhatsapp.whatsapp_phone_number;
delete semWhatsapp.whats_app_business_phone_number_id;
ok(
  recusa("criar_conjunto_a_partir_de", semWhatsapp) === "whatsapp_phone_number_obrigatorio_para_mensagens",
  `mensagens sem whatsapp (cards 7183231d/679df3ee/3555f123) deveria recusar: ${recusa("criar_conjunto_a_partir_de", semWhatsapp)}`,
);
const reex = conferirReexecucaoDoCard("criar_conjunto_a_partir_de", semWhatsapp, null);
ok(!reex.ok && reex.erro === "whatsapp_phone_number_obrigatorio_para_mensagens", "a prova devolve o erro da executora, nao um generico");
ok(!reex.ok && reex.detalhe.includes("whatsapp_phone_number"), "a prova devolve o detalhe acionavel da executora");

const engajComConversa = {
  ...conjuntoPino, familia_objetivo: "engajamento", destination_type: "ON_POST", optimization_goal: "CONVERSATIONS",
  objetivo: "OUTCOME_ENGAGEMENT",
};
ok(
  recusa("criar_conjunto_a_partir_de", engajComConversa) === "destination_type_invalido_para_mensagens",
  `engajamento ON_POST com CONVERSATIONS (card 7d6563df) deveria recusar: ${recusa("criar_conjunto_a_partir_de", engajComConversa)}`,
);
const mensagensSite = {
  ...conjuntoPino, destination_type: "WEBSITE", optimization_goal: "LANDING_PAGE_VIEWS", objetivo: "OUTCOME_TRAFFIC",
};
ok(
  recusa("criar_conjunto_a_partir_de", mensagensSite) === null,
  `WEBSITE vira trafego, nao mensagens (corrigido em 22/08, card 5b9fd669): ${recusa("criar_conjunto_a_partir_de", mensagensSite)}`,
);

// Familia que so a campanha na Graph decide nao e julgada aqui.
const conversaoSemDestino = { ...conjuntoPino, familia_objetivo: "conversao", destination_type: null, optimization_goal: null, objetivo: "OUTCOME_LEADS", nome_novo: "CONJ.9", campanha_destino_nome: "X" };
ok(recusa("criar_conjunto_a_partir_de", conversaoSemDestino) === null, "familia que depende da campanha fica para a executora");

// ---------- conjunto/escala: campos do payload ----------
ok(recusa("criar_conjunto_a_partir_de", { ...conjuntoPino, nome_novo: "" }) === "payload incompleto (campanha_destino_external_id, nome_novo)", "sem nome recusa");
ok(recusa("criar_conjunto_a_partir_de", { ...conjuntoPino, sem_molde: false, molde_external_id: "" }) === "payload incompleto (molde_external_id, campanha_destino_external_id, nome_novo)", "sem molde e sem sem_molde recusa");
ok(recusa("criar_conjunto_a_partir_de", { ...conjuntoPino, orcamento_diario_reais: 0 }) === "orcamento_diario_reais ausente ou invalido", "orcamento zero recusa");
ok(recusa("criar_conjunto_a_partir_de", { ...conjuntoPino, orcamento_diario_reais: 3000 }) === "orcamento_parece_centavos", "orcamento em centavos recusa");
ok(recusa("criar_conjunto_a_partir_de", { ...conjuntoPino, orcamento_diario_reais: 3000, orcamento_confirmado_reais: true }) === null, "orcamento confirmado em reais passa");
ok(recusa("criar_conjunto_a_partir_de", { ...conjuntoPino, geo_locations: { cities: [{ name: "Salvador" }] } }) === "geo_item_sem_key", "geo sem key recusa");
ok(recusa("criar_conjunto_a_partir_de", { ...conjuntoPino, plataformas_publicacao: ["facebook", "threads"] }) !== null, "threads recusa");
ok(recusa("criar_conjunto_a_partir_de", { ...conjuntoPino, formato_midia_previsto: null }) === "formato_de_midia_obrigatorio_quando_facebook_selecionado", "facebook sem formato recusa");
const semPlataformas: Record<string, unknown> = { ...conjuntoPino, formato_midia_previsto: null };
delete semPlataformas.plataformas_publicacao;
ok(recusa("criar_conjunto_a_partir_de", semPlataformas) === "plataformas_de_publicacao_obrigatorias", "sem plataformas e sem formato recusa");
const escala = {
  nome_novo: "CONJ.1 [ESC+20 36]", molde_external_id: "120250000000000001", campanha_destino_external_id: "120250000000000002",
  orcamento_diario_reais: 36, herdar_targeting_do_molde: true,
};
ok(recusa("escalar_duplicar", escala) === null, `escala com payload completo passa: ${recusa("escalar_duplicar", escala)}`);
ok(recusa("escalar_duplicar", { ...escala, molde_external_id: "" }) !== null, "escala sem molde recusa");

// ---------- campanha ----------
ok(recusa("criar_campanha", { ...campanhaEngaj, nome_novo: "" }) === "payload sem nome_novo (nome livre obrigatorio)", "campanha sem nome recusa");
ok(recusa("criar_campanha", { ...campanhaEngaj, regime_orcamento: "cbo" }) === "regime_orcamento_nao_suportado", "campanha CBO recusa");
ok(recusa("criar_campanha", { ...campanhaEngaj, objetivo: "VENDER_MUITO" }) === "objetivo_nao_suportado", "objetivo invalido recusa");

// ---------- anuncio ----------
ok(recusa("criar_anuncio_a_partir_de", { ...anuncioVideo, conjunto_destino_external_id: "" }) === "payload incompleto (conjunto_destino_external_id, nome_novo)", "anuncio sem conjunto recusa");
ok(recusa("criar_anuncio_a_partir_de", { ...anuncioVideo, meta_video_id: null }) === "payload incompleto (creative_id, conjunto_destino_external_id, nome_novo)", "anuncio sem peca e sem molde recusa");
ok(recusa("criar_anuncio_a_partir_de", { ...anuncioVideo, meta_image_hash: "abc" }) === "formatos_de_midia_conflitantes", "video + imagem recusa");
ok(recusa("criar_anuncio_a_partir_de", { ...anuncioVideo, meta_video_id: null, meta_image_hash: "abc", child_attachments: [{ image_hash: "a" }, { image_hash: "b" }] }) === "formatos_de_midia_conflitantes", "imagem + carrossel recusa");
ok(recusa("criar_anuncio_a_partir_de", { ...anuncioVideo, imagem_coluna_direita: "hash" }) === "personalizacao_por_posicionamento_nao_suportada", "asset por posicionamento recusa");
ok(recusa("criar_anuncio_a_partir_de", { ...anuncioVideo, legenda: "" }) === "legenda_obrigatoria_peca_nova", "peca nova sem legenda recusa");
ok(recusa("criar_anuncio_a_partir_de", { ...anuncioVideo, legenda: "", meta_video_id: null, sem_molde: false, creative_id: "999" }) === null, "replica de molde herda legenda do molde");
ok(
  recusa("criar_anuncio_a_partir_de", { ...anuncioVideo, legenda: "", meta_video_id: null, creative_id: "999", child_attachments: [{ image_hash: "a" }, { image_hash: "b" }] }) === "legenda_obrigatoria_peca_nova",
  "carrossel com molde sem legenda recusa (link_data novo nao herda texto)",
);
ok(
  recusa("criar_anuncio_a_partir_de", { ...anuncioVideo, nome_novo: "[LEV][WA][LEADS][CLT]", destination_type: "WEBSITE", destino_do_anuncio: { caso: "trafego_website" } }) === "nome_fora_do_escopo_trafego",
  "nome [WA][LEADS] em trafego recusa",
);

// Acoes sem precondicao propria passam.
ok(recusaDoPayloadDeCriacao("pausar_conjunto", {}) === null, "acao fora da lista nao e julgada aqui");

// ---------- ligacao: executora e proposta chamam a mesma funcao ----------
const exec = await Deno.readTextFile(new URL("../meta-actions/index.ts", import.meta.url));
const ramos = ["criar_campanha", "criar_conjunto_a_partir_de", "criar_anuncio_a_partir_de"];
const inicioMontar = exec.indexOf("export async function montarCriacao(");
ok(inicioMontar > 0, "montarCriacao existe");
const corpoMontar = exec.slice(inicioMontar, exec.indexOf("\n}\n", inicioMontar));
ok((corpoMontar.match(/recusaDoPayloadDeCriacao\(acao, p\)/g) ?? []).length >= ramos.length, "montarCriacao chama recusaDoPayloadDeCriacao nos tres ramos");
ok(!corpoMontar.includes('erro: "regime_orcamento_nao_suportado"'), "regime nao e mais julgado dentro da executora (dono unico)");
ok(!corpoMontar.includes('erro: "formatos_de_midia_conflitantes"'), "formatos nao sao mais julgados dentro da executora (dono unico)");
ok(!corpoMontar.includes('erro: "personalizacao_por_posicionamento_nao_suportada"'), "posicionamento nao e mais julgado dentro da executora (dono unico)");

const chat = await Deno.readTextFile(new URL("../traffic-chat/index.ts", import.meta.url));
const iniProp = chat.indexOf("async function t_propose_criacao(");
const fimProp = chat.indexOf("async function gravarCard(");
const proposta = chat.slice(iniProp, fimProp);
const gravacoes = (proposta.match(/gravarCard\(companyId/g) ?? []).length;
const provas = (proposta.match(/conferirReexecucaoDoCard\(/g) ?? []).length;
ok(gravacoes > 0 && provas === gravacoes, `todo gravarCard de criacao passa pela prova de reexecucao (${provas}/${gravacoes})`);

if (falhas.length) {
  console.error(`FALHA (${falhas.length}):\n - ${falhas.join("\n - ")}`);
  Deno.exit(1);
}
console.log("OK precondicoes_criacao");
