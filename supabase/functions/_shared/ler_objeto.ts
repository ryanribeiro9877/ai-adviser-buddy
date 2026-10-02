// Ficha ao vivo de um objeto da Meta. Nao le o espelho.
// Os campos sao pedidos por nome: o padrao da Graph omite promoted_object.

const GRAPH = "https://graph.facebook.com/v21.0";

export const CAMPOS_CONJUNTO = [
  "id",
  "name",
  "status",
  "effective_status",
  "daily_budget",
  "lifetime_budget",
  "start_time",
  "end_time",
  "optimization_goal",
  "billing_event",
  "bid_strategy",
  "bid_amount",
  "destination_type",
  "promoted_object",
  "targeting",
  "campaign_id",
].join(",");

export const CAMPOS_ANUNCIO = [
  "id",
  "name",
  "status",
  "effective_status",
  "adset_id",
  "campaign_id",
  "creative{id,name,object_story_spec,degrees_of_freedom_spec,asset_feed_spec,body,title,call_to_action_type,thumbnail_url}",
].join(",");

export const CAMPOS_CAMPANHA = [
  "id",
  "name",
  "status",
  "effective_status",
  "objective",
  "special_ad_categories",
  "daily_budget",
  "lifetime_budget",
  "bid_strategy",
  "start_time",
  "stop_time",
].join(",");

export const CAMPOS_CRIATIVO = [
  "id",
  "name",
  "object_story_spec",
  "degrees_of_freedom_spec",
  "asset_feed_spec",
  "body",
  "title",
  "thumbnail_url",
  "call_to_action_type",
].join(",");

export type NivelObjeto = "campanha" | "conjunto" | "anuncio" | "criativo";
export type ParteFicha = "tudo" | "targeting" | "promoted_object" | "creative" | "cabecalho";

const CAMPOS: Record<NivelObjeto, string> = {
  campanha: CAMPOS_CAMPANHA,
  conjunto: CAMPOS_CONJUNTO,
  anuncio: CAMPOS_ANUNCIO,
  criativo: CAMPOS_CRIATIVO,
};

export function nivelDoArgumento(v: unknown): NivelObjeto | null {
  const s = String(v ?? "").trim().toLowerCase();
  if (s === "campanha" || s === "campaign") return "campanha";
  if (s === "conjunto" || s === "adset" || s === "ad_set") return "conjunto";
  if (s === "anuncio" || s === "ad") return "anuncio";
  if (s === "criativo" || s === "creative" || s === "adcreative") return "criativo";
  return null;
}

export function partirFicha(ficha: Record<string, unknown>, parte: ParteFicha): Record<string, unknown> {
  if (parte === "tudo") return ficha;
  if (parte === "targeting") return { id: ficha.id ?? null, targeting: ficha.targeting ?? null };
  if (parte === "promoted_object") return { id: ficha.id ?? null, promoted_object: ficha.promoted_object ?? null };
  if (parte === "creative") return { id: ficha.id ?? null, creative: ficha.creative ?? null };
  const { targeting: _t, promoted_object: _p, creative: _c, ...cabeca } = ficha;
  return cabeca;
}

export async function lerObjetoAoVivo(opts: {
  token: string;
  id: string;
  nivel: NivelObjeto;
  parte?: ParteFicha;
  /** Quando vier, a Graph devolve só estes campos. A releitura pede o que foi enviado. */
  campos?: string;
}): Promise<Record<string, unknown>> {
  const id = String(opts.id ?? "").trim();
  if (!/^\d{5,}$/.test(id)) {
    return {
      consulta_falhou: true,
      onde: "ler_objeto",
      motivo: "id invalido",
      aviso: "Passe o id numerico da Meta. Sem id nao ha ficha, e ausencia nao e objeto vazio.",
    };
  }
  const fields = String(opts.campos ?? "").trim() || CAMPOS[opts.nivel];
  const qs = new URLSearchParams({ fields, access_token: opts.token });
  let r: Response;
  try {
    r = await fetch(`${GRAPH}/${id}?${qs.toString()}`);
  } catch (e) {
    return {
      consulta_falhou: true,
      onde: "ler_objeto",
      motivo: String((e as Error)?.message ?? e).slice(0, 200),
      aviso: "A Graph nao respondeu. Isto NAO significa que o campo esta vazio.",
    };
  }
  const t = await r.text();
  let body: Record<string, unknown>;
  try {
    body = JSON.parse(t) as Record<string, unknown>;
  } catch {
    return {
      consulta_falhou: true,
      onde: "ler_objeto",
      motivo: `resposta_nao_json_${r.status}`,
      aviso: "A Graph nao devolveu JSON. Nao trate isso como objeto sem o campo.",
    };
  }
  if (!r.ok || body.error) {
    const err = body.error as { message?: string } | undefined;
    return {
      consulta_falhou: true,
      onde: "ler_objeto",
      motivo: String(err?.message ?? `http_${r.status}`).slice(0, 300),
      aviso: "A leitura ao vivo falhou. Nao conclua a partir do espelho.",
    };
  }
  if (opts.campos) {
    return { ...body, nivel: opts.nivel, fonte: "graph_ao_vivo", sem_corte: true, campos: fields };
  }
  const parte = opts.parte ?? "tudo";
  const ficha = partirFicha(body, parte);
  const json = JSON.stringify(ficha);
  if (json.length > 48_000 && parte === "tudo") {
    return {
      id: body.id ?? id,
      nivel: opts.nivel,
      fonte: "graph_ao_vivo",
      grande_demais_para_um_bloco: true,
      partes: ["cabecalho", "targeting", "promoted_object", "creative"],
      aviso:
        "A ficha inteira nao cabe num bloco. Peca parte=targeting, parte=promoted_object ou parte=creative. Nao invente o que ficou de fora.",
      cabecalho: partirFicha(body, "cabecalho"),
    };
  }
  return {
    ...ficha,
    nivel: opts.nivel,
    fonte: "graph_ao_vivo",
    parte,
    sem_corte: true,
  };
}
