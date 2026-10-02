// Trocar o criativo de um anuncio. Criativo nao se edita: cria-se outro e aponta o anuncio.
// A troca nao zera o aprendizado, mas reinicia a revisao. Sem reler effective_status, nao esta pronto.

export type RecusaTroca = { ok: false; erro: string; detalhe: string };

function idNumerico(v: unknown): string {
  return /^\d{5,}$/.test(String(v ?? "").trim()) ? String(v).trim() : "";
}

export function validarTrocaCriativo(p: Record<string, unknown> | null | undefined): { ok: true; ad_id: string; creative_id: string } | RecusaTroca {
  const pedido = p ?? {};
  const adId = idNumerico(pedido.ad_id ?? pedido.target_external_id ?? pedido.alvo_external_id);
  const creativeId = idNumerico(pedido.creative_id ?? pedido.criativo_id);
  if (!adId || !creativeId) {
    return {
      ok: false,
      erro: "ids_obrigatorios",
      detalhe: "trocar_criativo_do_anuncio exige ad_id e creative_id numericos.",
    };
  }
  if (adId === creativeId) {
    return { ok: false, erro: "ids_iguais", detalhe: "ad_id e creative_id sao objetos diferentes." };
  }
  return { ok: true, ad_id: adId, creative_id: creativeId };
}

export function temRegrasDePlacement(creative: unknown): boolean {
  if (!creative || typeof creative !== "object") return false;
  const c = creative as Record<string, unknown>;
  const feed = c.asset_feed_spec;
  if (feed && typeof feed === "object" && !Array.isArray(feed)) {
    const rules = (feed as Record<string, unknown>).asset_customization_rules;
    if (Array.isArray(rules) && rules.length > 0) return true;
  }
  return false;
}

export function fronteiraDePersonalizacao(atualTemRegras: boolean, novoTemRegras: boolean): { ok: true } | RecusaTroca {
  if (atualTemRegras === novoTemRegras) return { ok: true };
  return {
    ok: false,
    erro: "fronteira_de_personalizacao",
    detalhe:
      "A Meta recusa troca que cruza asset_customization_rules (1885866). Criativo com regras de placement nao substitui um sem, nem o contrario.",
  };
}

export type VereditoTroca = {
  declarado_pronto: boolean;
  rotulo: "conferido" | "em_revisao" | "reprovado" | "effective_status_nao_lido";
  effective_status: string | null;
};

/** Sem a releitura do effective_status o resultado nao e "corrigido". */
export function vereditoDepoisDaTroca(effectiveStatus: unknown): VereditoTroca {
  const st = String(effectiveStatus ?? "").trim().toUpperCase();
  if (!st) {
    return { declarado_pronto: false, rotulo: "effective_status_nao_lido", effective_status: null };
  }
  if (st === "IN_PROCESS" || st === "PENDING_REVIEW" || st === "PREAPPROVED") {
    return { declarado_pronto: false, rotulo: "em_revisao", effective_status: st };
  }
  if (st === "DISAPPROVED" || st === "WITH_ISSUES") {
    return { declarado_pronto: false, rotulo: "reprovado", effective_status: st };
  }
  return { declarado_pronto: true, rotulo: "conferido", effective_status: st };
}
