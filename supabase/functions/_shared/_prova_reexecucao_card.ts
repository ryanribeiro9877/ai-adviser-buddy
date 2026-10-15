import { payloadDoCardConjunto, validarSpecConjunto } from "./conjunto_spec.ts";
import { montarCriativoCarrossel, montarCriativoDeClique } from "./criativo_whatsapp.ts";
import { conferirReexecucaoDoCard } from "./reexecucao_card.ts";

function assert(cond: unknown, msg: string) {
  if (!cond) throw new Error(`FALHA: ${msg}`);
}

// ---------- criar_conjunto ----------
const pedidoConjunto = {
  nome: "CONJ.4 MELHORES_CRIATIVOS",
  campaign_id: "120250394932500182",
  orcamento_diario_reais: 23,
  optimization_goal: "CONVERSATIONS",
  billing_event: "IMPRESSIONS",
  bid_strategy: "LOWEST_COST_WITHOUT_CAP",
  destination_type: "WHATSAPP",
  promoted_object: { page_id: "105656372312257", whatsapp_phone_number: "557191088073" },
  targeting: {
    age_min: 25,
    age_max: 65,
    geo_locations: { cities: [{ key: "267730", name: "Salvador" }], location_types: ["home", "recent"] },
    targeting_automation: { advantage_audience: 0 },
  },
};
const spec = validarSpecConjunto(pedidoConjunto);
assert(spec.ok, "spec do conjunto monta");
if (spec.ok) {
  const contexto = { conta_destino: "act_1", justificativa: "j", reversa: "r", metrica_sucesso: "m", resumo_legivel: spec.resumo };
  const cardNovo = { ...payloadDoCardConjunto(spec), campanha_destino_nome: "X", ...contexto, proposto_por: "traffic-chat" };
  const r = conferirReexecucaoDoCard("criar_conjunto", cardNovo, spec.corpo);
  assert(r.ok, `card novo de conjunto reexecuta: ${JSON.stringify(r)}`);

  // Forma gravada antes da correcao. Com o validador corrigido ela tambem reexecuta: os dois
  // cards de 15/10/2026 voltam a funcionar no botao "Pode tentar de novo".
  const cardLegado = { ...spec.corpo, targeting: spec.targeting, orcamento_diario_reais: spec.reais, nome_novo: spec.corpo.name, ...contexto };
  const rl = conferirReexecucaoDoCard("criar_conjunto", cardLegado, spec.corpo);
  assert(rl.ok, `card legado de conjunto reexecuta: ${JSON.stringify(rl)}`);

  const semPromoted = { ...cardNovo } as Record<string, unknown>;
  delete semPromoted.promoted_object;
  const rs = conferirReexecucaoDoCard("criar_conjunto", semPromoted, spec.corpo);
  assert(!rs.ok && rs.erro === "card_nao_reexecutavel", "payload que a executora recusaria nao vira card");
  assert(!rs.ok && rs.detalhe.includes("promoted_object_obrigatorio"), "recusa cita a recusa da executora");

  const verbaTrocada = { ...cardNovo, daily_budget: "9900", orcamento_diario_reais: 99 };
  const rv = conferirReexecucaoDoCard("criar_conjunto", verbaTrocada, spec.corpo);
  assert(!rv.ok && rv.detalhe.includes("daily_budget"), "corpo divergente do validado nao vira card");

  const outraOrdem = { ...cardNovo, targeting: { targeting_automation: { advantage_audience: 0 }, geo_locations: { location_types: ["home", "recent"], cities: [{ name: "Salvador", key: "267730" }] }, age_max: 65, age_min: 25 } };
  const ro = conferirReexecucaoDoCard("criar_conjunto", outraOrdem, spec.corpo);
  assert(ro.ok, "ordem de chaves (o jsonb reordena) nao e divergencia");
}

// ---------- criar_criativo (WhatsApp) ----------
// Payload igual ao do traffic-chat: corpo montado, depois os params, depois os campos do card.
const paramsCriativo = {
  nome: "CRIATIVO_CTWA_1",
  video_id: "999",
  thumbnail_url: "https://x/t.jpg",
  page_id: "105656372312257",
  instagram_actor_id: "17841400000000000",
  message: "Revise seu contrato",
  destination_type: "WHATSAPP",
  page_welcome_message: { saudacao: "Ola!", pergunta: "Quero revisar meu contrato" },
};
const criativo = montarCriativoDeClique(paramsCriativo);
assert(criativo.ok, "criativo monta");
if (criativo.ok) {
  const card = {
    ...criativo.body,
    ...paramsCriativo,
    nome_novo: criativo.body.name,
    instagram_actor_id: String(paramsCriativo.instagram_actor_id),
    conta_destino: "act_1",
    saudacao: criativo.saudacao,
    pergunta: criativo.pergunta,
    justificativa: "j",
  };
  const r = conferirReexecucaoDoCard("criar_criativo", card, criativo.body);
  assert(r.ok, `card de criativo reexecuta: ${JSON.stringify(r)}`);

  const semTexto = { ...card } as Record<string, unknown>;
  delete semTexto.message;
  const rs = conferirReexecucaoDoCard("criar_criativo", semTexto, criativo.body);
  assert(!rs.ok && rs.detalhe.includes("message_obrigatoria"), "criativo que a executora recusaria nao vira card");
}

// ---------- criar_criativo_carrossel ----------
const paramsCarrossel = {
  nome: "CARROSSEL_1",
  page_id: "105656372312257",
  instagram_actor_id: "17841400000000000",
  message: "Conheca",
  link: "https://exemplo.com.br",
  child_attachments: [{ image_hash: "a1", name: "Um" }, { image_hash: "b2", name: "Dois" }],
};
const carrossel = montarCriativoCarrossel(paramsCarrossel);
assert(carrossel.ok, "carrossel monta");
if (carrossel.ok) {
  const card = { ...carrossel.body, ...paramsCarrossel, nome_novo: carrossel.body.name, conta_destino: "act_1" };
  const r = conferirReexecucaoDoCard("criar_criativo_carrossel", card, carrossel.body);
  assert(r.ok, `card de carrossel reexecuta: ${JSON.stringify(r)}`);
}

// Acoes sem montagem compartilhada passam direto.
assert(conferirReexecucaoDoCard("criar_campanha", {}, {}).ok, "acao fora da prova nao e barrada aqui");

console.log("OK reexecucao_card");
