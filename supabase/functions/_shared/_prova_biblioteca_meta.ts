import {
  anuncioDaGraph,
  aprendizadoDaConta,
  fundirVideoDoEspelho,
  listarAteOFim,
  nomeComUpload,
  referenciasDoCriativo,
  type RespostaHttp,
} from "./biblioteca_meta.ts";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

const criativo = referenciasDoCriativo({
  video_id: "1596865345181641",
  image_hash: "abcdef1234567890",
  object_story_spec: {
    link_data: {
      child_attachments: [
        { image_hash: "1111222233334444", video_id: "2069053877047431" },
      ],
    },
    video_data: { video_id: "1596865345181641", image_hash: "abcdef1234567890" },
  },
  asset_feed_spec: {
    videos: [{ video_id: "1403032212031824" }],
    images: [{ hash: "ffffeeee11112222" }],
  },
});
assert(criativo.videos.includes("1596865345181641"), "video do criativo");
assert(criativo.videos.includes("2069053877047431"), "video do slide");
assert(criativo.videos.includes("1403032212031824"), "video do asset feed");
assert(criativo.hashes.includes("1111222233334444"), "hash do slide");
assert(criativo.hashes.includes("ffffeeee11112222"), "hash do asset feed");
assert(!criativo.videos.includes("12"), "id curto não é video");

const ad = anuncioDaGraph({
  id: "1200",
  name: "LAF 1",
  effective_status: "ACTIVE",
  creative: { video_id: "1596865345181641" },
});
assert(ad?.video_ids[0] === "1596865345181641", "anúncio carrega o video");
assert(ad?.effective_status === "ACTIVE", "status efetivo");

const fundido = fundirVideoDoEspelho(
  [{ id: "1200", nome: "LAF 1", effective_status: "ACTIVE", video_ids: [], image_hashes: [] }],
  [{ external_id: "1200", name: "LAF 1", effective_status: "ACTIVE", meta_video_id: "1596865345181641" },
    { external_id: "1300", name: "Pausado", effective_status: "PAUSED", meta_video_id: "999001" }],
);
assert(fundido.find((a) => a.id === "1200")?.video_ids.includes("1596865345181641"), "espelho completa o video");
assert(fundido.some((a) => a.id === "1300"), "anúncio só no espelho entra no mapa");

assert(
  nomeComUpload("", "999", { nome: "01. Setembro.mp4" }) === "01. Setembro.mp4",
  "nome vem do upload quando a Meta não manda título",
);

function pagina(data: unknown[], next?: string): RespostaHttp {
  return { ok: true, status: 200, json: { data, paging: next ? { next } : {} } };
}

const completa = await listarAteOFim(
  "p1",
  async (url) => (url === "p1" ? pagina([{ id: "1" }], "p2") : pagina([{ id: "2" }])),
  Date.now() + 10_000,
);
assert(completa.completo && completa.itens.length === 2, "segue a próxima página até o fim");

let relogio = 0;
const truncada = await listarAteOFim(
  "p1",
  async () => pagina([{ id: "1" }], "p2"),
  5,
  () => {
    relogio += 10;
    return relogio;
  },
);
assert(!truncada.completo && truncada.erro === "listagem_truncada", "prazo estourado não é lista pronta");

const falha = await listarAteOFim(
  "p1",
  async () => ({ ok: false, status: 500, json: { error: { message: "boom access_token=SEGREDO" } } }),
  Date.now() + 10_000,
);
assert(!falha.completo, "http ruim não é biblioteca vazia");
assert(!String(falha.erro).includes("SEGREDO"), "erro não devolve token");

const semLista = await listarAteOFim(
  "p1",
  async () => ({ ok: true, status: 200, json: { data: { id: "nao-e-lista" } } }),
  Date.now() + 10_000,
);
assert(!semLista.completo && semLista.erro === "resposta_sem_lista", "objeto no lugar da lista é falha");

const agora = Date.parse("2026-10-03T12:00:00Z");
const recente = aprendizadoDaConta(
  { completo: true, itens: [{ created_time: "2026-10-02T15:00:00Z" }] },
  agora,
);
assert(recente.ate === "2026-10-09", "campanha de ontem libera a faxina em 09/10");
const antiga = aprendizadoDaConta(
  { completo: true, itens: [{ created_time: "2026-08-01T00:00:00Z" }] },
  agora,
);
assert(antiga.ate === null && !antiga.desconhecido, "campanha antiga não adia");
const cega = aprendizadoDaConta({ completo: false, itens: [] }, agora);
assert(cega.desconhecido, "campanha truncada não libera a faxina");

const edge = await Deno.readTextFile(new URL("../listar-ativos-orfaos/index.ts", import.meta.url));
assert(!/p_gastos\s*:/.test(edge), "a edge não substitui o gasto do banco");
assert(!/p_cards\s*:/.test(edge), "a edge não substitui o card aberto");

console.log("ok: _prova_biblioteca_meta");
