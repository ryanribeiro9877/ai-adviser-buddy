// A URL de imagem da Meta e assinada e expira. A grade pede a capa de dezenas
// de anúncios ao mesmo tempo, então o arquivo tem de ser nosso: bucket privado,
// caminho empresa/creative_id, e a coluna thumbnail_url guarda esse caminho.
// Criativo e imutável — o mesmo creative_id não é baixado de novo.

import { cfgEmpresa, tokenAdsPorCompanyId } from "./meta_company_tokens.ts";
import { hashDaImagem, partirStatus, urlDaMiniatura, videoIdDoCriativo } from "./pipeboard_structure.ts";

const GRAPH = "https://graph.facebook.com/v21.0";
export const BUCKET_CRIATIVOS = "criativos";

const CAMPOS_ANUNCIO =
  "id,status,effective_status,creative{id,thumbnail_url,image_url,image_hash,object_story_spec,video_id,object_type}";

const EFETIVOS = new Set([
  "ACTIVE",
  "PAUSED",
  "DELETED",
  "ARCHIVED",
  "IN_PROCESS",
  "WITH_ISSUES",
  "CAMPAIGN_PAUSED",
  "ADSET_PAUSED",
  "PENDING_REVIEW",
  "DISAPPROVED",
  "PREAPPROVED",
  "PENDING_BILLING_INFO",
]);
const CONFIGURADOS = new Set(["ACTIVE", "PAUSED", "DELETED", "ARCHIVED"]);

export type LinhaMiniatura = {
  id: string;
  company_id: string;
  external_id: string;
  creative_id: string | null;
  thumbnail_url: string | null;
  account_id: string | null;
  miniatura_motivo: string | null;
  miniatura_tentada_em: string | null;
  status: string | null;
  effective_status: string | null;
};

export type RelatorioMiniaturas = {
  candidatos: number;
  processados: number;
  gravadas: number;
  sem_imagem: number;
  tentar_de_novo: number;
  entrega_atualizada: number;
  ja_tinham_arquivo: number;
  sem_token: string[];
  sem_acesso: number;
  token_recusado: string[];
  cortado_por_prazo: boolean;
  erros: string[];
};

export function caminhoDaMiniatura(companyId: string, creativeId: string, ext: string): string | null {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(companyId)) return null;
  if (!/^[0-9A-Za-z_-]{3,}$/.test(creativeId)) return null;
  const e = ext === "png" || ext === "webp" || ext === "gif" ? ext : "jpg";
  return `${companyId}/${creativeId}.${e}`;
}

export function jaEArquivoDesteCriativo(
  thumbnail: string | null | undefined,
  companyId: string,
  creativeId: string,
): boolean {
  return String(thumbnail ?? "").startsWith(`${companyId}/${creativeId}.`);
}

export function tipoDeImagem(bytes: Uint8Array, contentType: string | null): { mime: string; ext: string } | null {
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return { mime: "image/jpeg", ext: "jpg" };
  }
  if (bytes.length >= 8 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) {
    return { mime: "image/png", ext: "png" };
  }
  if (bytes.length >= 6 && bytes[0] === 0x47 && bytes[1] === 0x49 && bytes[2] === 0x46) {
    return { mime: "image/gif", ext: "gif" };
  }
  if (
    bytes.length >= 12 &&
    bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46 &&
    bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50
  ) {
    return { mime: "image/webp", ext: "webp" };
  }
  const tipo = String(contentType ?? "").split(";")[0].trim().toLowerCase();
  if (tipo === "image/jpeg") return { mime: tipo, ext: "jpg" };
  if (tipo === "image/png") return { mime: tipo, ext: "png" };
  if (tipo === "image/webp") return { mime: tipo, ext: "webp" };
  if (tipo === "image/gif") return { mime: tipo, ext: "gif" };
  return null;
}

function limpar(msg: string): string {
  return msg.replace(/access_token=[^&\s]+/gi, "access_token").replace(/\s+/g, " ").trim().slice(0, 160);
}

function sinal(ms: number): AbortSignal {
  const c = new AbortController();
  setTimeout(() => c.abort(), ms);
  return c.signal;
}

function contaCoberta(companyId: string, accountId: string | null): boolean {
  const cfg = cfgEmpresa(companyId);
  if (!cfg) return false;
  const id = String(accountId ?? "").replace(/^act_/, "");
  if (!/^\d+$/.test(id)) return false;
  return cfg.ad_accounts.some((conta) => conta.replace(/^act_/, "") === id);
}

function tokenRecusado(motivo: string): boolean {
  return /validating access token|OAuthException|error validating|session has expired/i.test(motivo);
}

function pendente(row: LinhaMiniatura, agora: number): boolean {
  const motivo = String(row.miniatura_motivo ?? "");
  if (motivo.startsWith("sem_acesso")) return false;
  const creativeId = String(row.creative_id ?? "");
  const tentada = row.miniatura_tentada_em ? Date.parse(row.miniatura_tentada_em) : NaN;
  const recente = Number.isFinite(tentada) && agora - tentada < 6 * 3600 * 1000;
  const semEntrega = !row.effective_status && String(row.status ?? "").toUpperCase() === "ACTIVE";
  if (semEntrega && !(recente && motivo.startsWith("tentar_de_novo"))) return true;
  if (!creativeId) return false;
  if (jaEArquivoDesteCriativo(row.thumbnail_url, row.company_id, creativeId)) return false;
  if (motivo === `sem_imagem:${creativeId}`) return false;
  if (recente && motivo.startsWith("tentar_de_novo")) return false;
  const url = String(row.thumbnail_url ?? "");
  return !url || /^https?:/i.test(url);
}

function prioridade(row: LinhaMiniatura): number {
  if (!row.effective_status && String(row.status ?? "").toUpperCase() === "ACTIVE") return 0;
  return 1;
}

async function lerJson(url: URL): Promise<{ ok: true; body: any } | { ok: false; motivo: string }> {
  let r: Response;
  try {
    r = await fetch(url, { signal: sinal(20_000) });
  } catch (e) {
    return { ok: false, motivo: `tentar_de_novo: ${limpar(String((e as Error)?.message ?? e))}` };
  }
  const texto = await r.text();
  let body: any = null;
  try {
    body = JSON.parse(texto);
  } catch {
    body = null;
  }
  if (!r.ok || body?.error) {
    return { ok: false, motivo: `tentar_de_novo: ${limpar(String(body?.error?.message ?? `http ${r.status}`))}` };
  }
  return { ok: true, body };
}

async function lerAnuncio(token: string, externalId: string) {
  const url = new URL(`${GRAPH}/${externalId}`);
  url.searchParams.set("fields", CAMPOS_ANUNCIO);
  url.searchParams.set("access_token", token);
  return await lerJson(url);
}

async function urlPeloHash(token: string, accountId: string, hash: string): Promise<string | null> {
  const act = accountId.replace(/^act_/, "");
  if (!/^\d+$/.test(act) || !hash) return null;
  const url = new URL(`${GRAPH}/act_${act}/adimages`);
  url.searchParams.set("hashes", JSON.stringify([hash]));
  url.searchParams.set("fields", "hash,url");
  url.searchParams.set("access_token", token);
  const lido = await lerJson(url);
  if (!lido.ok) return null;
  const lista = Array.isArray(lido.body?.data) ? lido.body.data : [];
  const daLista = lista.find((item: any) => String(item?.hash ?? "") === hash)?.url;
  if (typeof daLista === "string" && daLista.startsWith("https://")) return daLista;
  const mapa = lido.body?.images?.[hash]?.url;
  if (typeof mapa === "string" && mapa.startsWith("https://")) return mapa;
  return null;
}

async function baixar(urlImagem: string): Promise<
  | { ok: true; bytes: Uint8Array; mime: string; ext: string }
  | { ok: false; motivo: string }
> {
  if (!urlImagem.startsWith("https://")) return { ok: false, motivo: "tentar_de_novo: url sem https" };
  let r: Response;
  try {
    r = await fetch(urlImagem, { signal: sinal(20_000) });
  } catch (e) {
    return { ok: false, motivo: `tentar_de_novo: ${limpar(String((e as Error)?.message ?? e))}` };
  }
  if (!r.ok) return { ok: false, motivo: `tentar_de_novo: download http ${r.status}` };
  const bytes = new Uint8Array(await r.arrayBuffer());
  if (bytes.byteLength < 32 || bytes.byteLength > 5_000_000) {
    return { ok: false, motivo: "tentar_de_novo: tamanho inesperado" };
  }
  const tipo = tipoDeImagem(bytes, r.headers.get("content-type"));
  if (!tipo) return { ok: false, motivo: "tentar_de_novo: resposta nao e imagem" };
  return { ok: true, bytes, mime: tipo.mime, ext: tipo.ext };
}

function patchDeStatus(ad: any): Record<string, string> {
  const partido = partirStatus(ad);
  const out: Record<string, string> = {};
  if (partido.effective_status && EFETIVOS.has(partido.effective_status)) {
    out.effective_status = partido.effective_status;
  }
  if (partido.status && CONFIGURADOS.has(partido.status)) out.status = partido.status;
  return out;
}

async function gravar(supa: any, id: string, patch: Record<string, unknown>): Promise<string | null> {
  const { error } = await supa.from("ads").update(patch).eq("id", id);
  if (!error) return null;
  if (patch.effective_status || patch.status) {
    const semStatus = { ...patch };
    delete semStatus.effective_status;
    delete semStatus.status;
    const segunda = await supa.from("ads").update(semStatus).eq("id", id);
    if (!segunda.error) return null;
    return limpar(String(segunda.error.message ?? segunda.error));
  }
  return limpar(String(error.message ?? error));
}

async function processarUm(supa: any, token: string, row: LinhaMiniatura): Promise<
  | { tipo: "token" }
  | { tipo: "gravada"; entrega: boolean }
  | { tipo: "ja_tinha"; entrega: boolean }
  | { tipo: "sem_imagem"; entrega: boolean }
  | { tipo: "sem_acesso"; entrega: boolean }
  | { tipo: "tentar_de_novo"; entrega: boolean; erro?: string }
> {
  const lido = await lerAnuncio(token, row.external_id);
  if (!lido.ok) {
    if (tokenRecusado(lido.motivo)) return { tipo: "token" };
    const sumiu = /does not exist|missing permissions|cannot be loaded/i.test(lido.motivo);
    const erro = await gravar(supa, row.id, {
      miniatura_motivo: sumiu
        ? `sem_acesso:${String(row.account_id ?? "").replace(/^act_/, "")}`
        : lido.motivo,
      miniatura_tentada_em: new Date().toISOString(),
    });
    if (sumiu) return { tipo: "sem_acesso", entrega: false };
    return { tipo: "tentar_de_novo", entrega: false, erro: erro ?? undefined };
  }

  const status = patchDeStatus(lido.body);
  const creative = lido.body?.creative ?? {};
  const creativeId = String(creative?.id ?? row.creative_id ?? "").trim();
  const video = videoIdDoCriativo(creative);
  const base: Record<string, unknown> = { ...status };
  if (creativeId) base.creative_id = creativeId;
  if (video) base.meta_video_id = video;
  else if (creative && typeof creative === "object") base.meta_video_id = null;
  const entrega = !!status.effective_status && status.effective_status !== row.effective_status;

  if (creativeId && jaEArquivoDesteCriativo(row.thumbnail_url, row.company_id, creativeId)) {
    const erro = await gravar(supa, row.id, base);
    if (erro) return { tipo: "tentar_de_novo", entrega, erro };
    return { tipo: "ja_tinha", entrega };
  }

  let fonte = urlDaMiniatura(creative);
  if (!fonte) {
    const hash = hashDaImagem(creative);
    if (hash && row.account_id) fonte = await urlPeloHash(token, row.account_id, hash);
  }
  if (!fonte || !creativeId) {
    const erro = await gravar(supa, row.id, {
      ...base,
      thumbnail_url: null,
      image_url: null,
      miniatura_motivo: creativeId ? `sem_imagem:${creativeId}` : "sem_imagem",
      miniatura_tentada_em: new Date().toISOString(),
    });
    if (erro) return { tipo: "tentar_de_novo", entrega, erro };
    return { tipo: "sem_imagem", entrega };
  }

  const arquivo = await baixar(fonte);
  if (!arquivo.ok) {
    const erro = await gravar(supa, row.id, {
      ...base,
      miniatura_motivo: arquivo.motivo,
      miniatura_tentada_em: new Date().toISOString(),
    });
    return { tipo: "tentar_de_novo", entrega, erro: erro ?? undefined };
  }

  const caminho = caminhoDaMiniatura(row.company_id, creativeId, arquivo.ext);
  if (!caminho) {
    return { tipo: "tentar_de_novo", entrega, erro: "caminho invalido" };
  }
  const binario = arquivo.bytes.buffer.slice(
    arquivo.bytes.byteOffset,
    arquivo.bytes.byteOffset + arquivo.bytes.byteLength,
  ) as ArrayBuffer;
  const sobe = await supa.storage.from(BUCKET_CRIATIVOS).upload(caminho, new Blob([binario], { type: arquivo.mime }), {
    contentType: arquivo.mime,
    upsert: true,
  });
  if (sobe.error) {
    const erro = await gravar(supa, row.id, {
      ...base,
      miniatura_motivo: `tentar_de_novo: ${limpar(String(sobe.error.message ?? sobe.error))}`,
      miniatura_tentada_em: new Date().toISOString(),
    });
    return { tipo: "tentar_de_novo", entrega, erro: erro ?? undefined };
  }

  const erro = await gravar(supa, row.id, {
    ...base,
    thumbnail_url: caminho,
    image_url: null,
    miniatura_motivo: null,
    miniatura_tentada_em: new Date().toISOString(),
  });
  if (erro) return { tipo: "tentar_de_novo", entrega, erro };
  return { tipo: "gravada", entrega };
}

export async function recuperarMiniaturas(
  supa: any,
  opts: { limite: number; deadline?: number } = { limite: 12 },
): Promise<RelatorioMiniaturas> {
  const relatorio: RelatorioMiniaturas = {
    candidatos: 0,
    processados: 0,
    gravadas: 0,
    sem_imagem: 0,
    tentar_de_novo: 0,
    entrega_atualizada: 0,
    ja_tinham_arquivo: 0,
    sem_token: [],
    sem_acesso: 0,
    token_recusado: [],
    cortado_por_prazo: false,
    erros: [],
  };
  const { data, error } = await supa
    .from("ads")
    .select(
      "id,company_id,external_id,creative_id,thumbnail_url,account_id,miniatura_motivo,miniatura_tentada_em,status,effective_status",
    )
    .is("ausente_na_graph_em", null)
    .limit(800);
  if (error) {
    relatorio.erros.push(limpar(String(error.message ?? error)));
    return relatorio;
  }
  const agora = Date.now();
  const fila = ((data ?? []) as LinhaMiniatura[])
    .filter((row) => row.company_id && row.external_id && pendente(row, agora))
    .sort((a, b) => prioridade(a) - prioridade(b));
  relatorio.candidatos = fila.length;
  const limite = Math.min(25, Math.max(1, opts.limite));
  const escolhidos = fila.slice(0, limite);

  const porEmpresa = new Map<string, LinhaMiniatura[]>();
  for (const row of escolhidos) {
    const lista = porEmpresa.get(row.company_id) ?? [];
    lista.push(row);
    porEmpresa.set(row.company_id, lista);
  }

  for (const [companyId, linhas] of porEmpresa) {
    if (opts.deadline && Date.now() > opts.deadline) {
      relatorio.cortado_por_prazo = true;
      break;
    }
    const tok = tokenAdsPorCompanyId(companyId);
    if (!tok) {
      relatorio.sem_token.push(companyId);
      continue;
    }
    let tokenRuim = false;
    for (const linha of linhas) {
      if (opts.deadline && Date.now() > opts.deadline) {
        relatorio.cortado_por_prazo = true;
        break;
      }
      if (tokenRuim) break;
      if (!contaCoberta(companyId, linha.account_id)) {
        relatorio.processados += 1;
        relatorio.sem_acesso += 1;
        const erro = await gravar(supa, linha.id, {
          miniatura_motivo: `sem_acesso:${String(linha.account_id ?? "").replace(/^act_/, "")}`,
          miniatura_tentada_em: new Date().toISOString(),
        });
        if (erro) relatorio.erros.push(erro);
        continue;
      }
      relatorio.processados += 1;
      const resultado = await processarUm(supa, tok.token, linha);
      if (resultado.tipo === "token") {
        tokenRuim = true;
        relatorio.token_recusado.push(companyId);
        relatorio.processados -= 1;
        continue;
      }
      if (resultado.entrega) relatorio.entrega_atualizada += 1;
      if (resultado.tipo === "gravada") relatorio.gravadas += 1;
      else if (resultado.tipo === "sem_imagem") relatorio.sem_imagem += 1;
      else if (resultado.tipo === "ja_tinha") relatorio.ja_tinham_arquivo += 1;
      else if (resultado.tipo === "sem_acesso") relatorio.sem_acesso += 1;
      else relatorio.tentar_de_novo += 1;
      if (resultado.tipo === "tentar_de_novo" && resultado.erro) relatorio.erros.push(resultado.erro);
    }
  }
  return relatorio;
}
