// Prova de qual contador da Meta conta como formulario.
// Rode: deno run supabase/functions/_shared/_prova_formularios_meta.ts
//
// As linhas abaixo sao copias enxutas de respostas reais do Pipeboard medidas em 13/10/2026
// (conta COHAPM 1622612945584817). O caso central e o da Lafelicita LP: a linha so tem o
// formulario em `conversions` e o coletor antigo gravava zero.

import {
  formulariosDaLinhaMeta,
  indicadorEhFormulario,
  resultadoOficialDaLinha,
} from "./formularios_meta.ts";

let falhas = 0;
function assert(cond: boolean, msg: string) {
  if (!cond) {
    console.error(`  FALHOU: ${msg}`);
    falhas++;
  }
}

// ============================================================================
// LP com SubmitApplication: IMG_FRONTAL-ESCASSEZ_M5_V1, 12/10, get_insights nivel ad
// ============================================================================
{
  const linha = {
    ad_id: "120250380324330182",
    actions: [
      { action_type: "link_click", value: "40" },
      { action_type: "offsite_conversion.fb_pixel_custom", value: "5" },
      { action_type: "landing_page_view", value: "7" },
    ],
    conversions: [
      { action_type: "submit_application_total", value: "4" },
      { action_type: "submit_application_website", value: "4" },
      { action_type: "customize_product_website", value: "1" },
    ],
  };
  assert(formulariosDaLinhaMeta(linha) === 4, `SubmitApplication do site deveria contar 4; veio ${formulariosDaLinhaMeta(linha)}`);
}

// ============================================================================
// LP com Lead e SubmitApplication no mesmo envio (formato da Ocular): Lead manda, sem somar
// ============================================================================
{
  const linha = {
    actions: [
      { action_type: "lead", value: "5" },
      { action_type: "offsite_conversion.fb_pixel_lead", value: "5" },
    ],
    conversions: [{ action_type: "submit_application_website", value: "7" }],
  };
  assert(formulariosDaLinhaMeta(linha) === 5, `Lead presente manda; veio ${formulariosDaLinhaMeta(linha)}`);
}

// ============================================================================
// Sem formulario nenhum: zero continua zero (WhatsApp, post impulsionado)
// ============================================================================
{
  const linha = {
    actions: [
      { action_type: "link_click", value: "12" },
      { action_type: "onsite_conversion.messaging_conversation_started_7d", value: "3" },
    ],
  };
  assert(formulariosDaLinhaMeta(linha) === 0, "conversa nao vira formulario");
  assert(formulariosDaLinhaMeta(null) === 0, "linha nula e zero, nao erro");
}

// ============================================================================
// `results` oficial: valor, indicador e o zero declarado
// ============================================================================
{
  const comValor = {
    results: [{
      indicator: "conversions:submit_application_website",
      values: [{ value: "28", attribution_windows: ["default"] }],
    }],
  };
  const r = resultadoOficialDaLinha(comValor);
  assert(r?.indicador === "conversions:submit_application_website", "indicador lido");
  assert(r?.valor === 28, `valor oficial 28; veio ${r?.valor}`);

  const semValores = { results: [{ indicator: "conversions:submit_application_website" }] };
  assert(resultadoOficialDaLinha(semValores)?.valor === 0, "indicador sem values e zero declarado");
  assert(resultadoOficialDaLinha({}) === null, "sem results nao e zero: e falta de leitura");
}

// ============================================================================
// Quais indicadores sao formulario
// ============================================================================
{
  const sim = [
    "conversions:submit_application_website",
    "actions:offsite_conversion.fb_pixel_lead",
    "actions:lead",
    "actions:onsite_conversion.lead_grouped",
    "actions:offsite_conversion.fb_pixel_complete_registration",
  ];
  const nao = [
    "actions:onsite_conversion.messaging_conversation_started_7d",
    "actions:link_click",
    "profile_visit_view",
    "actions:post_engagement",
    "actions:offsite_conversion.fb_pixel_purchase",
    "actions:offsite_conversion.custom.1199903735334842",
    "actions:offsite_conversion.fb_pixel_custom",
    "",
  ];
  for (const i of sim) assert(indicadorEhFormulario(i), `${i} e formulario`);
  for (const i of nao) assert(!indicadorEhFormulario(i), `${i || "(vazio)"} NAO e formulario`);
}

if (falhas) {
  console.error(`\nFALHOU: _prova_formularios_meta (${falhas} erro(s))`);
  Deno.exit(1);
}
console.log("ok: _prova_formularios_meta");
