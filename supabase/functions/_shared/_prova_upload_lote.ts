import { apurarUploadLote, anexarRelatorioUpload, itensPendentesDoAcervo } from "./upload_lote.ts";
import { ehPedidoUploadLote } from "./intencao_turno.ts";

function assert(cond: unknown, msg: string) {
  if (!cond) throw new Error(msg);
}

assert(ehPedidoUploadLote("suba os vídeos restantes"), "pedido subir restantes");
assert(ehPedidoUploadLote("carregue as pecas na biblioteca"), "pedido carregar biblioteca");
assert(ehPedidoUploadLote("termine de subir os vídeos e me informe quais dos 34 já estão na meta e quais ficaram de fora"), "pedido 34 na meta");
assert(!ehPedidoUploadLote("qual o gasto de ontem?"), "pergunta nao e upload");

const acervo = {
  itens: [
    { nome: "10. Futevolei.mp4", drive_file_id: "aaa", na_biblioteca_da_meta: false },
    { nome: "11. Piscina.mp4", drive_file_id: "bbb", na_biblioteca_da_meta: false },
    { nome: "ja.mp4", drive_file_id: "ccc", na_biblioteca_da_meta: true },
  ],
};
const pend = itensPendentesDoAcervo(acervo);
assert(pend.length === 2 && pend[0].nome.includes("Futevolei"), "pendentes do acervo");

const rel = apurarUploadLote([
  { tool: "get_acervo_para_anuncio", retorno: acervo },
  {
    tool: "upload_midia",
    args: { drive_file_id: "aaa" },
    retorno: { ok: true, enviado: true, drive_file_id: "aaa", nome: "10. Futevolei.mp4", video_id: "v1" },
  },
]);
assert(rel.faltam.length === 1 && rel.faltam[0].drive_file_id === "bbb", "falta o segundo");
assert(rel.incompleto, "lote incompleto");
assert(/Futevolei/.test(rel.markdown) && /Piscina/.test(rel.markdown), "relatorio cita nomes");
assert(/Ja na Meta/.test(rel.markdown), "inventario na meta");

const fechado = apurarUploadLote([
  { tool: "get_acervo_para_anuncio", retorno: acervo },
  { tool: "upload_midia", retorno: { ok: true, enviado: true, drive_file_id: "aaa", nome: "10. Futevolei.mp4", video_id: "v1" } },
  { tool: "upload_midia", retorno: { ok: true, enviado: true, drive_file_id: "bbb", nome: "11. Piscina.mp4", video_id: "v2" } },
]);
assert(!fechado.incompleto && fechado.faltam.length === 0, "lote fechado");

const teto = apurarUploadLote([
  { tool: "get_acervo_para_anuncio", retorno: acervo },
  { tool: "upload_midia", retorno: { recusado: true, motivo: "teto por hora atingido (100)", drive_file_id: "aaa", nome: "10. Futevolei.mp4" } },
]);
assert(teto.tetoHora && teto.faltam.length === 2, "teto nao esconde faltantes");

const md = anexarRelatorioUpload("Vou subir os primeiros 5.\n\n_Continuando automaticamente…_", rel);
assert(/Status do upload/.test(md), "anexa relatorio");
assert(!/_Continuando automaticamente/.test(md), "remove prosa de progresso vazia");

console.log("ok upload_lote");
