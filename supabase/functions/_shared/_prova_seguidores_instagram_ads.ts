// Prova do parser de instagram_profile_follow — o campo que o funil desta casa nao coleta.
import {
  ACTION_TYPE_FOLLOW,
  achatarLinhaInsight,
  coletarLinhasInsight,
  dataIsoValida,
  followDaLinha,
  numeroDe,
} from "./seguidores_instagram_ads.ts";

let falhas = 0;
function ok(cond: boolean, msg: string) {
  if (!cond) {
    console.error(`FALHOU: ${msg}`);
    falhas++;
  }
}

ok(dataIsoValida("2026-09-03") === "2026-09-03", "data ISO valida");
ok(dataIsoValida("09/09") === null, "data BR nao passa");
ok(ACTION_TYPE_FOLLOW === "instagram_profile_follow", "nome oficial do campo");

const compacto = {
  insights: [
    {
      campaign_id: "120254717078370191",
      campaign_name: "Post do Instagram: Se alguém pedir um código de...",
      metrics: { spend: "50.53", impressions: 100, instagram_profile_follow: "7" },
    },
  ],
};
const linhas = coletarLinhasInsight(compacto);
ok(linhas.length === 1, `esperava 1 linha, veio ${linhas.length}`);
ok(linhas[0].instagram_profile_follow === "7", "campo sobrevive ao flatten de metrics");
ok(followDaLinha(linhas[0]).valor === 7, "follow do campo numerico-string");
ok(followDaLinha(linhas[0]).fonte === "campo", "fonte=campo quando o field existe");
ok(followDaLinha(linhas[0]).campo_presente === true, "campo_presente");

const viaAction = achatarLinhaInsight({
  campaign_id: "1",
  spend: 10,
  actions: [{ action_type: "link_click", value: "136" }, { action_type: "instagram_profile_follow", value: "2" }],
});
ok(followDaLinha(viaAction).valor === 2, "follow via actions");
ok(followDaLinha(viaAction).fonte === "actions", "fonte=actions quando so o array veio");

const semFollow = achatarLinhaInsight({ campaign_id: "1", spend: 10, actions: [{ action_type: "link_click", value: "5" }] });
ok(followDaLinha(semFollow).valor === null, "ausencia nao vira zero");
ok(followDaLinha(semFollow).campo_presente === false, "campo ausente");

ok(numeroDe({ spend: "50.53" }, "spend") === 50.53, "spend string");

const contaErrada = coletarLinhasInsight({
  texto: 'get_insights failed: {\n  "message": "(#100) Tried accessing nonexisting field (insights)"\n}',
});
ok(contaErrada.length === 0, "erro do objeto da conta nao vira linha de insight");

if (falhas) {
  console.error(`_prova_seguidores_instagram_ads: ${falhas} falha(s)`);
  Deno.exit(1);
}
console.log("ok: _prova_seguidores_instagram_ads");
