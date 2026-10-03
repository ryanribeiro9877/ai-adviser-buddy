// Leitura da biblioteca de criativos da conta. Sem efeito: não apaga arquivo.
// A classificação mora em listar_ativos_orfaos. Aqui só a coleta completa
// e o mapa anúncio → video_id / image_hash. Lista cortada não segue adiante.

export const TETO_DE_PAGINAS = 40;

export type ItemDaLista = Record<string, unknown>;

export type ListaCompleta = {
  itens: ItemDaLista[];
  completo: boolean;
  erro: string | null;
};

export type RespostaHttp = { ok: boolean; status: number; json: unknown };

function objeto(v: unknown): Record<string, unknown> {
  if (typeof v === "string") {
    try {
      const p = JSON.parse(v);
      if (p && typeof p === "object" && !Array.isArray(p)) return p as Record<string, unknown>;
    } catch {
      return {};
    }
  }
  if (v && typeof v === "object" && !Array.isArray(v)) return v as Record<string, unknown>;
  return {};
}

export function limparErroMeta(msg: string): string {
  return msg.replace(/access_token=[^&\s]+/gi, "access_token").replace(/\s+/g, " ").trim().slice(0, 180);
}

export function videoValido(v: unknown): string | null {
  const s = String(v ?? "").trim();
  return /^\d{6,}$/.test(s) ? s : null;
}

export function hashValido(v: unknown): string | null {
  const s = String(v ?? "").trim();
  return /^[0-9a-fA-F]{8,}$/.test(s) ? s.toLowerCase() : null;
}

/** Campanha criada nos últimos 7 dias: a faxina da biblioteca espera o fim dessa semana. */
export function aprendizadoDaConta(
  campanhas: { completo: boolean; itens: { created_time?: unknown }[] },
  agora = Date.now(),
): { ate: string | null; desconhecido: boolean } {
  if (!campanhas.completo) return { ate: null, desconhecido: true };
  const limite = agora - 7 * 24 * 60 * 60 * 1000;
  let ate: number | null = null;
  for (const campanha of campanhas.itens) {
    const criado = Date.parse(String(campanha.created_time ?? ""));
    if (!Number.isFinite(criado) || criado < limite) continue;
    const libera = criado + 7 * 24 * 60 * 60 * 1000;
    if (ate == null || libera > ate) ate = libera;
  }
  return {
    ate: ate == null ? null : new Date(ate).toISOString().slice(0, 10),
    desconhecido: false,
  };
}

/** video_id e image_hash de um criativo, inclusive carrossel e asset_feed. */
export function referenciasDoCriativo(creative: unknown): { videos: string[]; hashes: string[] } {
  const videos = new Set<string>();
  const hashes = new Set<string>();
  const addV = (v: unknown) => {
    const s = videoValido(v);
    if (s) videos.add(s);
  };
  const addH = (v: unknown) => {
    const s = hashValido(v);
    if (s) hashes.add(s);
  };
  const c = objeto(creative);
  const spec = objeto(c.object_story_spec);
  const feed = objeto(c.asset_feed_spec);
  addV(c.video_id);
  addH(c.image_hash);
  const videoData = objeto(spec.video_data);
  const linkData = objeto(spec.link_data);
  const photoData = objeto(spec.photo_data);
  addV(videoData.video_id);
  addH(videoData.image_hash);
  addH(linkData.image_hash);
  addH(photoData.image_hash);
  const kids = Array.isArray(linkData.child_attachments) ? linkData.child_attachments : [];
  for (const kid of kids) {
    const k = objeto(kid);
    addV(k.video_id);
    addH(k.image_hash);
  }
  const feedVideos = Array.isArray(feed.videos) ? feed.videos : [];
  for (const item of feedVideos) addV(objeto(item).video_id);
  const feedImages = Array.isArray(feed.images) ? feed.images : [];
  for (const item of feedImages) {
    const o = objeto(item);
    addH(o.hash ?? o.image_hash);
  }
  return { videos: [...videos], hashes: [...hashes] };
}

/**
 * Segue paging.next até a última página. Se o prazo ou o teto estourar com
 * próxima página ainda por vir, a lista é incompleta — não é a biblioteca.
 */
export async function listarAteOFim(
  urlInicial: string,
  buscar: (url: string) => Promise<RespostaHttp>,
  prazo: number,
  agora: () => number = Date.now,
): Promise<ListaCompleta> {
  const itens: ItemDaLista[] = [];
  let url = urlInicial;
  let paginas = 0;
  while (url) {
    if (paginas >= TETO_DE_PAGINAS || agora() > prazo) {
      return { itens, completo: false, erro: "listagem_truncada" };
    }
    let resposta: RespostaHttp;
    try {
      resposta = await buscar(url);
    } catch (e) {
      return { itens, completo: false, erro: limparErroMeta(String((e as Error)?.message ?? e)) };
    }
    paginas += 1;
    const corpo = objeto(resposta.json);
    const erro = objeto(corpo.error);
    if (!resposta.ok || corpo.error) {
      return {
        itens,
        completo: false,
        erro: limparErroMeta(String(erro.message ?? `http ${resposta.status}`)),
      };
    }
    const data = Array.isArray(corpo.data) ? corpo.data : null;
    if (!data) return { itens, completo: false, erro: "resposta_sem_lista" };
    for (const item of data) {
      if (item && typeof item === "object") itens.push(item as ItemDaLista);
    }
    const paging = objeto(corpo.paging);
    url = typeof paging.next === "string" ? paging.next : "";
  }
  return { itens, completo: true, erro: null };
}

export type AnuncioMapeado = {
  id: string;
  nome: string | null;
  effective_status: string | null;
  video_ids: string[];
  image_hashes: string[];
};

export function anuncioDaGraph(row: ItemDaLista): AnuncioMapeado | null {
  const id = String(row.id ?? "").trim();
  if (!id) return null;
  const refs = referenciasDoCriativo(row.creative);
  const nome = String(row.name ?? "").trim();
  const efetivo = String(row.effective_status ?? "").trim();
  return {
    id,
    nome: nome || null,
    effective_status: efetivo || null,
    video_ids: refs.videos,
    image_hashes: refs.hashes,
  };
}

/** O espelho às vezes já tem o video_id que o criativo desta leitura não trouxe. */
export function fundirVideoDoEspelho(
  anuncios: AnuncioMapeado[],
  espelho: { external_id: string; name: string | null; effective_status: string | null; meta_video_id: string | null }[],
): AnuncioMapeado[] {
  const porId = new Map(anuncios.map((a) => [a.id, a]));
  for (const linha of espelho) {
    const id = String(linha.external_id ?? "").trim();
    if (!id) continue;
    const video = videoValido(linha.meta_video_id);
    const existente = porId.get(id);
    if (existente) {
      if (video && !existente.video_ids.includes(video)) existente.video_ids.push(video);
      continue;
    }
    porId.set(id, {
      id,
      nome: linha.name,
      effective_status: linha.effective_status,
      video_ids: video ? [video] : [],
      image_hashes: [],
    });
  }
  return [...porId.values()];
}

export function nomeComUpload(
  tituloMeta: string,
  id: string,
  upload: { nome: string | null } | undefined,
): string {
  const titulo = tituloMeta.trim();
  if (titulo) return titulo;
  const nome = String(upload?.nome ?? "").trim();
  return nome || id;
}
