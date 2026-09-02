// deno run supabase/functions/_shared/_prova_origem_drive_anuncios.ts
import {
  conjuntoDoPedidoOrigem,
  pistasCampanhaDoPedido,
  recortarAdsOrigem,
  resolverOrigemDoAd,
  resumirPastasOrigem,
  tCasarCriativoPerformance,
  type AdParaOrigem,
  type CardOrigem,
} from "./origem_drive_anuncios.ts";
import { deveDescerPastaDrive, pastaIntermediariaCalendario, pedidoExigeInventarioDrive } from "./pedido_drive_criativos.ts";
import { ehPedidoOrigemDriveDosAnuncios, replyLeituraIncompleta } from "./intencao_turno.ts";

function assert(cond: unknown, msg: string) {
  if (!cond) throw new Error(msg);
}

const pedidoRef =
  "foque exclusivamente no conjunto 1 e me traga essa informação:\n" +
  "dos anúncios que estão registrados dentro desse conjunto, eles pertencem a qual pasta do drive?";

assert(ehPedidoOrigemDriveDosAnuncios(pedidoRef), "pedido referencia e origem Drive dos anuncios");
assert(!pedidoExigeInventarioDrive(pedidoRef), "origem NAO e inventario de pecas novas");
assert(
  pedidoExigeInventarioDrive("verifique os criativos do La Felicita no drive nas pastas Reels"),
  "inventario de pasta nova continua Drive",
);
assert(
  !ehPedidoOrigemDriveDosAnuncios("verifique na pasta Apenas oculos do drive e selecione um video"),
  "selecionar peca nova nao e origem de anuncio no ar",
);
assert(conjuntoDoPedidoOrigem(pedidoRef) === 1, "extrai conjunto 1");
assert(pistasCampanhaDoPedido("campanha COHAPM_VISTTA_CONV_WA_SET26").includes("VISTTA"), "pista VISTTA");

assert(pastaIntermediariaCalendario("2026"), "ano e intermediario");
assert(pastaIntermediariaCalendario("08. Agosto"), "mes numerado e intermediario");
assert(
  deveDescerPastaDrive("2026", { meio: "sistema_ocular", soReelsVideos: true }, 0),
  "VISTTA/2026 deve ser descido (nao so Reels no nivel 0)",
);
assert(
  !deveDescerPastaDrive("Brutos", { meio: "sistema_ocular", soReelsVideos: true }, 0),
  "Brutos continua ignorado",
);
assert(
  deveDescerPastaDrive("Reels", { meio: "sistema_ocular", soReelsVideos: true }, 0),
  "Reels no nivel 0 continua valido",
);
assert(
  deveDescerPastaDrive("Apenas oculos", { meio: "sistema_ocular", soReelsVideos: true }, 3),
  "subpasta de Reels deve descer",
);

const ads: AdParaOrigem[] = [
  {
    name: "AD_CONJ.1_APENAS_OCULOS_1",
    external_id: "ad1",
    status: "CAMPAIGN_PAUSED",
    adset_name: "CONJ.1_VISTTA_WA_7199189-4229",
    campaign_name: "COHAPM_VISTTA_CONV_WA_SET26",
    campaign_external_id: "camp1",
    criado_pelo_sistema: true,
    criado_por_approval_id: "ap1",
  },
  {
    name: "AD_CONJ.1_APENAS_OCULOS_2",
    external_id: "ad2",
    status: "CAMPAIGN_PAUSED",
    adset_name: "CONJ.1_VISTTA_WA_7199189-4229",
    campaign_name: "COHAPM_VISTTA_CONV_WA_SET26",
    campaign_external_id: "camp1",
    criado_pelo_sistema: true,
    criado_por_approval_id: "ap2",
  },
  {
    name: "AD_CONJ.1_LAF_REEL_1",
    external_id: "laf1",
    status: "ACTIVE",
    adset_name: "CONJ.1_LAF_WA",
    campaign_name: "COHAPM_LAFELICITA_CONV_AGO26",
    campaign_external_id: "campLaf",
    criado_pelo_sistema: true,
    criado_por_approval_id: "apL",
  },
];

const recorte = recortarAdsOrigem(ads, { conjunto: 1, pistas: ["VISTTA"] });
assert(recorte.ads.length === 2 && recorte.ads.every((a) => a.campaign_name.includes("VISTTA")), "pista VISTTA isola CONJ.1 certo");

const porApproval = new Map<string, CardOrigem>([
  ["ap1", { id: "ap1", drive_file_id: "1lmOk", ad_criado: "ad1" }],
  ["ap2", { id: "ap2", drive_file_id: "1ncp2", ad_criado: "ad2" }],
]);
const pecas = new Map([
  ["1lmOk", { nome: "1.mp4", caminho: "COHAPM Sistema Ocular · VISTTA/2026/08. Agosto/Reels/Apenas oculos" }],
  ["1ncp2", { nome: "10.mp4", caminho: "COHAPM Sistema Ocular · VISTTA/2026/08. Agosto/Reels/Apenas oculos" }],
]);
const o1 = resolverOrigemDoAd(ads[0], porApproval, new Map(), pecas);
const o2 = resolverOrigemDoAd(ads[1], porApproval, new Map(), pecas);
assert(o1.vinculo === "confirmado" && o1.peca_nome === "1.mp4", "ad1 = 1.mp4");
assert(o2.vinculo === "confirmado" && o2.peca_nome === "10.mp4", "ad2 = 10.mp4, NAO 2.mp4");
assert(o1.pasta === o2.pasta, "os dois estao na mesma pasta");
const resumo = resumirPastasOrigem([o1, o2]);
assert(resumo.length === 1 && resumo[0].anuncios === 2, "pasta unica com 2 anuncios");

const prosaFalsa =
  "A pasta existe e contém 1.mp4 a 6.mp4, mas não há evidência suficiente para afirmar " +
  "que os anúncios 2 a 6 correspondem. Sem vínculo registrado. drive_file_id necessário.";
assert(replyLeituraIncompleta(prosaFalsa), "prosa 'sem vinculo' deve continuar o turno");

let chamadas = 0;
const rpc = async (_n: string, p: Record<string, unknown>) => {
  chamadas++;
  if (p.p_drive_file_id && p.p_ad_external_id) return { pares: [], total: 0 };
  return {
    pares: [{ drive_file_id: "1ncp2", ad_external_id: p.p_ad_external_id, peca_nome: "10.mp4" }],
    total: 1,
  };
};
const fb = await tCasarCriativoPerformance(rpc, {
  companyId: "c1",
  driveFileId: "16q_chutado",
  adExternalId: "120249833957750182",
});
assert(chamadas === 2, "fallback faz segunda chamada so com ad_external_id");
assert((fb as { total: number }).total === 1, "fallback acha o par real");
assert(Boolean((fb as { aviso_filtro_drive_divergente?: string }).aviso_filtro_drive_divergente), "avisa chute");

const chat = await Deno.readTextFile(new URL("../traffic-chat/index.ts", import.meta.url));
const job = await Deno.readTextFile(new URL("../traffic-agent-job/index.ts", import.meta.url));
assert(chat.includes("origem_drive_dos_anuncios"), "chat expoe a tool");
assert(job.includes("origem_drive_dos_anuncios"), "job expoe a tool");
assert(chat.includes("tCasarCriativoPerformance"), "chat usa fallback do casar");
assert(job.includes("tCasarCriativoPerformance"), "job usa fallback do casar");
assert(chat.includes("deveDescerPastaDrive"), "chat desce ano/mes VISTTA");
assert(job.includes("deveDescerPastaDrive"), "job desce ano/mes VISTTA");
assert(chat.includes("R1-ORIGEM"), "doutrina R1-ORIGEM no prompt");
assert(chat.includes(".eq(\"company_id\", companyId)") || chat.includes("tOrigemDriveDosAnuncios(supa, ctx.companyId"), "origem no chat e da empresa");

console.log("ok origem_drive_anuncios");
