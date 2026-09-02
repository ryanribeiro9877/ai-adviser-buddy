// deno run --allow-read supabase/functions/_shared/_prova_pedido_drive_criativos.ts
import {
  aplicarRecorteAcervo,
  caminhoEhReelsOuVideos,
  compactarInventarioDriveParaAgente,
  deaccPedido,
  inferirMeioDeProduto,
  inferirMeioDrive,
  itemDriveDoMeio,
  leituraDriveVoltouVazia,
  parseMeioDriveArg,
  pastaFormatoIgnorada,
  deveDescerPastaDrive,
  pedidoExigeInventarioDrive,
  pedidoQualquerPastaDrive,
  pedidoSoReelsVideos,
  pedidoUsaSlateExistente,
  recortarItensDrive,
  recortarItensDriveComAviso,
  recorteDriveDoPedido,
  replyPedeCaminhoDaPastaDrive,
  serieCarrosselDrive,
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
// Pinar o numero exato quebrava a prova a cada bump legitimo; o que ela precisa
// garantir e que o job continua carimbando versao.
assert(/job-v\d+\.\d+/.test(job), "job carimba versao");
assert(
  job.includes('acao: "thumbnails"') && job.includes("company_id: companyId || undefined"),
  "multiquadro passa company_id ao thumbnails da empresa",
);
assert(job.includes("v4.4"), "job ainda tem conserto Drive v4.4");
assert(chat.includes("MSG_NUDGE_DRIVE"), "chat tem nudge se nao coletar Drive");
assert(chat.includes("R1-DRIVE"), "chat R1-DRIVE");
assert(/chat-v\d+\.\d+/.test(chat), "chat carimba versao");
assert(chat.includes("get_slate_da_conversa"), "chat expoe slate duravel");
assert(pedidoUsaSlateExistente(
  "vamos iniciar com o conjunto 1, de acordo com sua analise e definicao dos 8 videos que selecionou, gere legendas para cada um deles",
), "legendas do slate nao e inventario Drive");
assert(!pedidoExigeInventarioDrive(
  "gere legendas para os 8 videos que selecionou do conjunto 1",
), "nao forca Drive em pedido de legendas do slate");
assert(inferirMeioDeProduto("imovel") === "la_felicita", "produto imovel e La Felicita");
assert(inferirMeioDeProduto("juridico_whatsapp") === "juridico", "produto juridico");
assert(inferirMeioDeProduto("sistema ocular") === "sistema_ocular", "produto ocular");
assert(inferirMeioDrive("criativos do Sistema Ocular no drive") === "sistema_ocular", "pedido ocular");
assert(inferirMeioDrive("pasta VISTTA") === "sistema_ocular", "pedido VISTTA");
assert(parseMeioDriveArg("vistta") === "sistema_ocular", "arg vistta");
assert(serieCarrosselDrive("2Carrossel 2.png") === "2", "serie carrossel 2");
assert(serieCarrosselDrive("4Carrossel 3.png") === "4", "serie carrossel 4");
assert(serieCarrosselDrive("Criativo 01.jpeg") === null, "jpeg raiz nao e carrossel");
assert(!itemDriveDoMeio(
  { pasta_monitorada: "COHAPM Sistema Ocular · VISTTA", meio: "sistema_ocular" },
  "juridico",
), "item ocular nao entra no recorte juridico");
assert(!job.includes('nome: "criativos", foco: FOCO_CRIATIVOS_OVERVIEW') || job.includes("pedidoExigeInventarioDrive(raw)"), "overview magro nao captura Drive");
assert(!pedidoExigeInventarioDrive(
  "foque exclusivamente no conjunto 1: dos anuncios registrados, eles pertencem a qual pasta do drive?",
), "origem dos anuncios no ar nao e inventario de pecas novas");
assert(
  deveDescerPastaDrive("2026", { meio: "sistema_ocular", soReelsVideos: true }, 0),
  "ano VISTTA deve descer na varredura",
);

// ── 02/09/2026: "6 videos do drive do juridico (qualquer pasta)" voltou vazio ─────────────
// O modelo mandou formatos=[Reels,Videos]; Exports Finais nao tem essas subpastas, o recorte
// reprovou os 42 videos e a resposta pediu o caminho da pasta ao gestor.
const pedidoJuridico =
  "pronto, agora quero que você selecione 6 vídeos diferentes de dentro do drive do jurídico (qualquer pasta) e crie legendas para cada um deles.";
assert(pedidoQualquerPastaDrive(pedidoJuridico), "qualquer pasta reconhecido");
assert(
  pedidoQualquerPastaDrive("todos os vídeos que estão nas subpastas dentro dessa pasta raiz podem ser utilizados"),
  "todas as subpastas reconhecido",
);
assert(inferirMeioDrive(pedidoJuridico) === "juridico", "meio juridico do pedido");
const recorteJur = recorteDriveDoPedido(pedidoJuridico, { meio: "juridico", formatos: ["Videos", "Reels"] });
assert(recorteJur.meio === "juridico", "recorte mantem o meio");
assert(
  recorteJur.soReelsVideos === false,
  "arg formatos do modelo nao pode vencer 'qualquer pasta' do gestor",
);

// Mesmo com o recorte de formato ligado, zerar uma lista que TEM pecas do meio e proibido.
const itensJur = [
  { nome: "01. Conta de luz.mp4", caminho: "COHAPM Jurídico · Exports Finais/CONTA DE LUZ", tipo: "video/mp4" },
  { nome: "02. Emprestimo.mp4", caminho: "COHAPM Jurídico · Exports Finais/EMPRÉSTIMOS", tipo: "video/mp4" },
  { nome: "casa.mp4", caminho: "COHAPM La Felicità · 06. Junho/Vídeos", tipo: "video/mp4" },
];
const corteJur = recortarItensDriveComAviso(itensJur, { meio: "juridico", soReelsVideos: true });
assert(corteJur.itens.length === 2, "fail-open devolve os videos do Juridico");
assert(corteJur.formatoIgnorado, "fail-open declara que o formato foi descartado");
assert(
  recortarItensDrive(itensJur, { meio: "juridico", soReelsVideos: true }).length === 2,
  "recortarItensDrive herda o fail-open",
);
// La Felicita tem Reels/Videos de verdade: o recorte continua valendo (nao virou passa-tudo).
const corteLaf = recortarItensDriveComAviso(itensJur, { meio: "la_felicita", soReelsVideos: true });
assert(corteLaf.itens.length === 1 && !corteLaf.formatoIgnorado, "recorte LF continua filtrando");

const acervoJur = aplicarRecorteAcervo({
  inventario_global: { videos: 148, imagens: 20 },
  itens: itensJur,
}, { meio: "juridico", soReelsVideos: true }) as Record<string, unknown>;
assert((acervoJur.itens as unknown[]).length === 2, "acervo do Juridico nao volta vazio");
assert(typeof acervoJur.recorte_formato_ignorado === "string", "acervo avisa que ignorou o formato");

const invJur = compactarInventarioDriveParaAgente({
  arquivos: itensJur.map((i) => ({ ...i, drive_file_id: `id_${i.nome}` })),
}, { meio: "juridico", soReelsVideos: true }) as Record<string, unknown>;
assert(invJur.total_arquivos === 2, "inventario do Juridico nao volta vazio");
assert(typeof invJur.recorte_formato_ignorado === "string", "inventario avisa que ignorou o formato");

// Varredura: sem recorte de formato, EMPRESTIMOS desce ja no nivel 0 da raiz.
assert(
  deveDescerPastaDrive("EMPRÉSTIMOS", { meio: "juridico", soReelsVideos: false }, 0),
  "subpasta tematica do Juridico deve descer",
);
assert(
  !deveDescerPastaDrive("Brutos", { meio: "juridico", soReelsVideos: false }, 0),
  "Brutos continua fora",
);

// Leitura vazia detectada tanto no objeto quanto no retorno persistido como texto.
assert(
  leituraDriveVoltouVazia([
    { tool: "get_acervo_para_anuncio", retorno: { itens: [], inventario_global: { videos: 0 } } },
    { tool: "get_drive_criativos", retorno: { total_arquivos: 0, arquivos: [] } },
  ]),
  "leitura vazia do incidente nao foi detectada",
);
assert(
  leituraDriveVoltouVazia([
    { tool: "get_drive_criativos", retorno: '{"total_arquivos": 0, "arquivos": []}' },
  ]),
  "retorno string vazio nao foi detectado",
);
assert(
  !leituraDriveVoltouVazia([
    { tool: "get_drive_criativos", retorno: { total_arquivos: 42, arquivos: [{ nome: "a.mp4" }] } },
    { tool: "get_acervo_para_anuncio", retorno: { itens: [] } },
  ]),
  "uma leitura com pecas basta para nao ser turno vazio",
);
assert(
  !leituraDriveVoltouVazia([{ tool: "get_overview", retorno: { itens: [] } }]),
  "tool que nao lista Drive nao conta",
);
assert(
  !leituraDriveVoltouVazia([{ tool: "get_drive_criativos", erro: "sem acesso ao Drive" }]),
  "erro de acesso nao e leitura vazia (nao adianta reler igual)",
);

// A prosa do incidente: pedir a pasta ao gestor e declarar inventario vazio.
assert(
  replyPedeCaminhoDaPastaDrive(
    "Leitura do inventário retornou vazio. Para localizar os 6 vídeos, preciso do caminho exato da pasta no Drive Jurídico.",
  ),
  "reply que pede a pasta nao foi detectada",
);
assert(
  replyPedeCaminhoDaPastaDrive(
    "A leitura atual do Drive Jurídico não expôs os arquivos das subpastas de Exports Finais. O retorno veio vazio para inventário, acervo e análise visual.",
  ),
  "reply que declara vazio nao foi detectada",
);
assert(
  !replyPedeCaminhoDaPastaDrive(
    "Selecionei 6 vídeos do Jurídico e escrevi as legendas de cada um; os drive_file_id estão na tabela.",
  ),
  "resposta boa foi marcada como desistencia",
);

assert(chat.includes("MSG_NUDGE_DRIVE_VAZIO"), "chat tem nudge de leitura vazia do Drive");
assert(chat.includes("recorte_formato_ignorado"), "chat declara recorte descartado");
assert(chat.includes("driveVazioIncompleto"), "chat auto-continua quando o Drive volta vazio");
assert(chat.includes("pedidoSoLegendasSemEmissao"), "chat nao trata legendas como emissao");

console.log("ok pedido_drive_criativos");
