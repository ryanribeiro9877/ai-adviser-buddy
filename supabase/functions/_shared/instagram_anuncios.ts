// Leitura e relinque de identidade Instagram em anuncios JA criados.
// A Graph nao expoe handle no criativo; so o id. Username vem de
// instagram_accounts da conta / GET no IBA. object_story_spec.instagram_* e imutavel:
// relinque = novo adcreative + update_ad (creative_id).

import {
  aplicarIdentidadeInstagramNoSpec,
  campoIdentidadeInstagramPorFormato,
  type IdentidadeInstagramResolvida,
} from "./identidade_instagram.ts";
import { sanitizarVideoDataParaGraph } from "./destino_url_lp.ts";
import { classificarLinhaProdutoCohapm } from "./memoria_conjunto.ts";

export const HANDLE_COHAPM_OFICIAL = "cohapm";
export const HANDLE_COOP_COHAPM = "coop_cohapm";
export const ERRO_CAMPANHA_FORA_ESCOPO_IG = "campanha_fora_do_escopo_instagram";

export type ClasseVinculoIg =
  | "cohapm"
  | "coop_cohapm"
  | "outro"
  | "sem_vinculo"
  | "id_sem_handle";

export type GraphRes = { status: number; body: any };
export type GraphClient = {
  get: (path: string) => Promise<GraphRes>;
  post: (path: string, body: Record<string, string>) => Promise<GraphRes>;
};

async function parseGraphRes(r: Response): Promise<GraphRes> {
  const t = await r.text();
  try {
    return { status: r.status, body: JSON.parse(t) };
  } catch {
    return { status: r.status, body: t.slice(0, 400) };
  }
}

export function criarGraphClient(
  token: string,
  graph = "https://graph.facebook.com/v21.0",
): GraphClient {
  return {
    async get(path: string) {
      if (path.startsWith("http")) return await parseGraphRes(await fetch(path));
      const sep = path.includes("?") ? "&" : "?";
      return await parseGraphRes(
        await fetch(`${graph}${path}${sep}access_token=${encodeURIComponent(token)}`),
      );
    },
    async post(path: string, body: Record<string, string>) {
      const form = new URLSearchParams({ ...body, access_token: token });
      return await parseGraphRes(await fetch(`${graph}${path}`, { method: "POST", body: form }));
    },
  };
}

export function normalizarHandleIg(s: string | null | undefined): string {
  return String(s ?? "")
    .trim()
    .replace(/^@+/, "")
    .toLowerCase();
}

export function idsInstagramDoCreative(creative: unknown): {
  id: string | null;
  campo: "instagram_user_id" | "instagram_actor_id" | null;
} {
  const c = creative && typeof creative === "object" ? (creative as Record<string, unknown>) : {};
  const spec =
    c.object_story_spec && typeof c.object_story_spec === "object"
      ? (c.object_story_spec as Record<string, unknown>)
      : {};
  const user = String(spec.instagram_user_id ?? c.instagram_user_id ?? "").trim();
  const actor = String(spec.instagram_actor_id ?? c.instagram_actor_id ?? "").trim();
  if (user) return { id: user, campo: "instagram_user_id" };
  if (actor) return { id: actor, campo: "instagram_actor_id" };
  return { id: null, campo: null };
}

export function classificarVinculoIg(opts: {
  id?: string | null;
  handle?: string | null;
  oficialId?: string | null;
  oficialHandle?: string | null;
}): ClasseVinculoIg {
  const h = normalizarHandleIg(opts.handle);
  const id = String(opts.id ?? "").trim();
  const ofH = normalizarHandleIg(opts.oficialHandle) || HANDLE_COHAPM_OFICIAL;
  const ofId = String(opts.oficialId ?? "").trim();
  if (h === HANDLE_COOP_COHAPM || h.includes("coop_cohapm")) return "coop_cohapm";
  if (h && (h === ofH || h === HANDLE_COHAPM_OFICIAL)) return "cohapm";
  if (ofId && id && id === ofId) return "cohapm";
  if (!id && !h) return "sem_vinculo";
  if (h) return "outro";
  return "id_sem_handle";
}

/** Relinca tudo que ainda nao esta no IBA oficial. */
export function precisaRelincarParaOficial(
  idAtual: string | null | undefined,
  oficialId: string,
): boolean {
  const a = String(idAtual ?? "").trim();
  const d = String(oficialId ?? "").trim();
  if (!d) return false;
  return a !== d;
}

export function campanhaNoEscopoVinculoIg(nome: string): boolean {
  const n = String(nome ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
  if (!n.trim()) return false;
  if (/juridico/.test(n) || /\[salt\]/.test(n) || /(^|[^a-z])salt([^a-z]|$)/.test(n)) return false;
  const linha = classificarLinhaProdutoCohapm(nome);
  if (linha === "juridico") return false;
  return linha === "la_felicita" || /lafelicit/.test(n.replace(/[\s_-]/g, ""));
}

export function recusarCampanhaForaEscopoIg(nome: string): {
  ok: true;
} | { ok: false; erro: string; detalhe: string } {
  if (campanhaNoEscopoVinculoIg(nome)) return { ok: true };
  return {
    ok: false,
    erro: ERRO_CAMPANHA_FORA_ESCOPO_IG,
    detalhe:
      "ERRO GRAVE: vinculo Instagram so na campanha La Felicità em trabalho (COHAPM_LAFELICITA_CONV_*), conjuntos ACTIVE e PAUSED. Campanha Jurídico, SALT e demais linhas ficam de fora.",
  };
}

export function limparStorySpecParaClone(spec: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  if (spec.page_id) out.page_id = spec.page_id;
  if (spec.video_data && typeof spec.video_data === "object") {
    out.video_data = sanitizarVideoDataParaGraph(spec.video_data as Record<string, unknown>);
  }
  if (spec.link_data && typeof spec.link_data === "object") out.link_data = spec.link_data;
  if (spec.photo_data && typeof spec.photo_data === "object") out.photo_data = spec.photo_data;
  if (spec.text_data && typeof spec.text_data === "object") out.text_data = spec.text_data;
  if (spec.instagram_user_id) out.instagram_user_id = spec.instagram_user_id;
  if (spec.instagram_actor_id) out.instagram_actor_id = spec.instagram_actor_id;
  return out;
}

export function specComIdentidadeOficial(
  spec: Record<string, unknown>,
  identidade: IdentidadeInstagramResolvida,
): Record<string, unknown> {
  return aplicarIdentidadeInstagramNoSpec(limparStorySpecParaClone(spec), identidade);
}

export type AnuncioIgLido = {
  ad_id: string;
  nome: string;
  status: string;
  effective_status: string;
  adset_id: string;
  conjunto_nome?: string | null;
  campaign_id: string;
  creative_id: string | null;
  instagram_id: string | null;
  instagram_campo: string | null;
  instagram_handle: string | null;
  classificacao: ClasseVinculoIg;
  precisa_relincar: boolean;
  object_story_id: string | null;
};

const CAMPOS_AD =
  "id,name,status,effective_status,adset_id,campaign_id,creative{id,name,object_story_spec,instagram_user_id,effective_object_story_id}";

function actPath(accountId: string): string {
  const id = String(accountId ?? "").replace(/^act_/i, "");
  return `/act_${id}`;
}

async function paginarData(g: GraphClient, path: string, maxPages = 15): Promise<any[]> {
  const out: any[] = [];
  let next: string | null = path;
  for (let i = 0; i < maxPages && next; i++) {
    const r = await g.get(next);
    if (r.status !== 200 || !r.body) break;
    const data = Array.isArray(r.body.data) ? r.body.data : [];
    out.push(...data);
    const nxt = r.body.paging?.next;
    next = typeof nxt === "string" && nxt ? nxt : null;
  }
  return out;
}

export async function mapearHandlesInstagramConta(
  g: GraphClient,
  accountId: string,
  pageId?: string | null,
): Promise<Record<string, string>> {
  const map: Record<string, string> = {};
  const contas = await paginarData(
    g,
    `${actPath(accountId)}/instagram_accounts?fields=id,username&limit=50`,
    3,
  );
  for (const row of contas) {
    const id = String(row?.id ?? "").trim();
    const u = normalizarHandleIg(row?.username);
    if (id && u) map[id] = u;
  }
  if (pageId) {
    const pg = await g.get(
      `/${pageId}?fields=instagram_business_account{id,username},connected_instagram_account{id,username}`,
    );
    const iba = (pg.body as any)?.instagram_business_account;
    const conn = (pg.body as any)?.connected_instagram_account;
    for (const obj of [iba, conn]) {
      const id = String(obj?.id ?? "").trim();
      const u = normalizarHandleIg(obj?.username);
      if (id && u) map[id] = u;
    }
  }
  return map;
}

export async function resolverHandleDoId(
  g: GraphClient,
  id: string,
  conhecidos: Record<string, string>,
): Promise<string | null> {
  if (conhecidos[id]) return conhecidos[id];
  const r = await g.get(`/${id}?fields=username,id`);
  const u = normalizarHandleIg((r.body as any)?.username);
  if (u) {
    conhecidos[id] = u;
    return u;
  }
  return null;
}

export async function listarAnunciosInstagramDaCampanha(opts: {
  g: GraphClient;
  campaignId: string;
  accountId: string;
  pageId?: string | null;
  conjuntosNomes?: Record<string, string>;
  oficialId: string;
  oficialHandle: string;
}): Promise<AnuncioIgLido[]> {
  const handles = await mapearHandlesInstagramConta(opts.g, opts.accountId, opts.pageId);
  const ads = await paginarData(
    opts.g,
    `/${opts.campaignId}/ads?fields=${CAMPOS_AD}&limit=100`,
    20,
  );
  const out: AnuncioIgLido[] = [];
  for (const ad of ads) {
    const status = String(ad?.status ?? "").toUpperCase();
    const eff = String(ad?.effective_status ?? status).toUpperCase();
    if (eff === "DELETED" || status === "DELETED" || eff === "ARCHIVED") continue;
    const creative = ad?.creative && typeof ad.creative === "object" ? ad.creative : {};
    const ids = idsInstagramDoCreative(creative);
    let handle: string | null = null;
    if (ids.id) {
      handle = await resolverHandleDoId(opts.g, ids.id, handles);
    }
    const classe = classificarVinculoIg({
      id: ids.id,
      handle,
      oficialId: opts.oficialId,
      oficialHandle: opts.oficialHandle,
    });
    const adsetId = String(ad?.adset_id ?? "");
    out.push({
      ad_id: String(ad?.id ?? ""),
      nome: String(ad?.name ?? ""),
      status,
      effective_status: eff,
      adset_id: adsetId,
      conjunto_nome: opts.conjuntosNomes?.[adsetId] ?? null,
      campaign_id: String(ad?.campaign_id ?? opts.campaignId),
      creative_id: creative?.id ? String(creative.id) : null,
      instagram_id: ids.id,
      instagram_campo: ids.campo,
      instagram_handle: handle ? `@${handle}` : null,
      classificacao: classe,
      precisa_relincar: precisaRelincarParaOficial(ids.id, opts.oficialId),
      object_story_id: String(creative?.effective_object_story_id ?? "").trim() || null,
    });
  }
  return out;
}

export async function relincarInstagramNoAnuncio(opts: {
  g: GraphClient;
  accountId: string;
  ad: AnuncioIgLido;
  identidade: IdentidadeInstagramResolvida;
}): Promise<{ ok: boolean; pulado?: boolean; creative_id_novo?: string | null; erro?: string; detalhe?: unknown }> {
  const dest = String(opts.identidade.instagram_actor_id ?? "").trim();
  if (!dest) return { ok: false, erro: "instagram_destino_ausente" };
  if (!precisaRelincarParaOficial(opts.ad.instagram_id, dest)) {
    return { ok: true, pulado: true, creative_id_novo: opts.ad.creative_id };
  }
  const conta = actPath(opts.accountId);
  const creativeId = opts.ad.creative_id;
  if (!creativeId) return { ok: false, erro: "creative_id_ausente", detalhe: opts.ad };

  const c = await opts.g.get(
    `/${creativeId}?fields=object_story_spec,url_tags,name,effective_object_story_id,object_story_id`,
  );
  if (c.status !== 200) {
    return { ok: false, erro: "falha_ao_ler_creative", detalhe: c.body };
  }
  const cb = c.body ?? {};
  const storyId = String(cb.effective_object_story_id ?? cb.object_story_id ?? opts.ad.object_story_id ?? "")
    .trim();
  const nomeCr = `${opts.ad.nome} - ig ${normalizarHandleIg(opts.identidade.instagram_handle) || HANDLE_COHAPM_OFICIAL}`;
  const campo = campoIdentidadeInstagramPorFormato(dest);
  let novo: GraphRes | null = null;

  if (storyId) {
    novo = await opts.g.post(`${conta}/adcreatives`, {
      name: nomeCr,
      object_story_id: storyId,
      [campo]: dest,
    });
  }
  if (!novo || novo.status !== 200 || !novo.body?.id) {
    const specIn = cb.object_story_spec && typeof cb.object_story_spec === "object"
      ? (cb.object_story_spec as Record<string, unknown>)
      : null;
    if (!specIn) {
      return {
        ok: false,
        erro: "creative_sem_story_spec",
        detalhe: { leitura: cb, tentativa_story_id: novo?.body ?? null },
      };
    }
    const spec = specComIdentidadeOficial(specIn, opts.identidade);
    const body: Record<string, string> = {
      name: nomeCr,
      object_story_spec: JSON.stringify(spec),
    };
    if (cb.url_tags) body.url_tags = String(cb.url_tags);
    novo = await opts.g.post(`${conta}/adcreatives`, body);
  }
  const newId = String(novo.body?.id ?? "").trim();
  if (novo.status !== 200 || !newId) {
    return { ok: false, erro: "falha_ao_criar_adcreative", detalhe: novo.body };
  }

  const upd = await opts.g.post(`/${opts.ad.ad_id}`, {
    creative: JSON.stringify({ creative_id: newId }),
  });
  if (upd.status !== 200) {
    return {
      ok: false,
      erro: "falha_ao_atualizar_anuncio",
      detalhe: { adcreative_criado: newId, update: upd.body },
    };
  }
  return { ok: true, creative_id_novo: newId };
}
