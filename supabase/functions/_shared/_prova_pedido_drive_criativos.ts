// deno run --allow-read supabase/functions/_shared/_prova_pedido_drive_criativos.ts
import {
  aplicarRecorteAcervo,
  caminhoEhReelsOuVideos,
  deaccPedido,
  inferirMeioDrive,
  pastaFormatoIgnorada,
  pedidoExigeInventarioDrive,
  pedidoSoReelsVideos,
  recortarItensDrive,
  recorteDriveDoPedido,
} from "./pedido_drive_criativos.ts";

function assert(cond: unknown, msg: string) {
  if (!cond) throw new Error(msg);
}

const pedidoGestor = `agora precisamos de fato distribuir os criativos entre as 4 campanhas.
de antemão quero que você verifique os criativos determinados ao La Felicità no drive e entenda que o que iremos utilizar são apenas as pastas que possuem o nome "Reels" e "Vídeos", quaisquer outro nome ignore.
verifique que os drivers possuem o nome de Junho, Julho e Agosto respectivamente, o drive de agosto será TOTALMENTE utilizado no CONJ.4
realize uma análise completa de criativos das pastas Julho e Junho para o CONJ.1, CONJ.2 e CONJ.3`;

assert(pedidoExigeInventarioDrive(pedidoGestor), "pedido do gestor e inventario Drive");
assert(inferirMeioDrive(pedidoGestor) === "la_felicita", "meio La Felicita");
assert(pedidoSoReelsVideos(pedidoGestor), "so Reels/Videos");
assert(!pedidoExigeInventarioDrive("faca uma analise completa das campanhas ativas desde a ativacao"), "overview de campanha nao e Drive");
assert(pedidoExigeInventarioDrive("distribuir os criativos entre CONJ.1 e CONJ.2"), "distribuir criativos");
assert(caminhoEhReelsOuVideos("COHAPM La Felicità · 06. Junho/Vídeos"), "Junho/Videos");
assert(caminhoEhReelsOuVideos("COHAPM La Felicità · 07. Julho/Reels/01. Piscina.mp4"), "Julho/Reels");
assert(!caminhoEhReelsOuVideos("COHAPM La Felicità · 06. Junho/Brutos/clip.mp4"), "Brutos fora");
assert(pastaFormatoIgnorada("Brutos") && pastaFormatoIgnorada("Cards") && pastaFormatoIgnorada("Adesivo"), "pastas ignoradas");

const recorte = recorteDriveDoPedido(pedidoGestor);
const itens = recortarItensDrive([
  { nome: "01. Chegando em casa.mp4", caminho: "COHAPM La Felicità · 06. Junho/Vídeos" },
  { nome: "bruto.mp4", caminho: "COHAPM La Felicità · 06. Junho/Brutos" },
  { nome: "Emprestimo.mp4", caminho: "COHAPM Jurídico · Exports Finais/EMPRÉSTIMOS" },
], recorte);
assert(itens.length === 1 && String(itens[0].nome).includes("Chegando"), "recorte deixa so Reels/Videos LF");

const overviewRegex = /\b(supergestor|avaliacao completa|analise completa|relatorio completo|visao geral|panorama|desde.{0,50}ativac)\b/;
assert(overviewRegex.test(deaccPedido(pedidoGestor)), "o texto do gestor CASA overview - o detector Drive precisa vencer");
assert(pedidoExigeInventarioDrive(pedidoGestor) && overviewRegex.test(deaccPedido(pedidoGestor)), "Drive vence overview");

const acervo = aplicarRecorteAcervo({
  inventario_global: { videos: 96, imagens: 17 },
  itens: [
    { nome: "01. Chegando em casa.mp4", caminho: "COHAPM La Felicità · 06. Junho/Vídeos", tipo: "video/mp4" },
    { nome: "bruto.mp4", caminho: "COHAPM La Felicità · 06. Junho/Brutos", tipo: "video/mp4" },
  ],
}, recorte) as Record<string, unknown>;
assert((acervo.inventario_global as { videos: number }).videos === 1, "inventario_global vira recorte");
assert((acervo.inventario_global_empresa as { videos: number }).videos === 96, "total da empresa preservado");

const chat = await Deno.readTextFile(new URL("../traffic-chat/index.ts", import.meta.url));
const job = await Deno.readTextFile(new URL("../traffic-agent-job/index.ts", import.meta.url));
assert(chat.includes("pedidoExigeInventarioDrive"), "chat importa detector Drive");
assert(job.includes("pedidoExigeInventarioDrive"), "job importa detector Drive");
assert(job.includes("FOCO_CRIATIVOS_DRIVE"), "job tem foco Drive forcado");
assert(job.includes("inventario Drive (nao overview de campanha)"), "job forca plano Drive");
assert(job.includes("job-v4.4"), "job versao 4.4");
assert(chat.includes("MSG_NUDGE_DRIVE"), "chat tem nudge se nao coletar Drive");
assert(chat.includes("R1-DRIVE"), "chat R1-DRIVE");
assert(chat.includes("chat-v28.67"), "chat versao 28.67");
assert(!job.includes('nome: "criativos", foco: FOCO_CRIATIVOS_OVERVIEW') || job.includes("pedidoExigeInventarioDrive(raw)"), "overview magro nao captura Drive");

console.log("ok pedido_drive_criativos");
