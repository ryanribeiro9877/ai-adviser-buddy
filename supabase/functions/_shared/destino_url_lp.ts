// Destino canônico de anúncios LP/Site da Legal e Viver.
//
// COMPORTAMENTO (11/08/2026):
//   CORRIGIR automaticamente, não recusar, quando o molde traz URL do domínio
//   legaleviver.com.br sem o path /simulacao-clt (ex.: https://legaleviver.com.br/).
//   Justificativa: a Graph já prova o canônico nos moldes bons (asset_feed_spec /
//   object_story_spec); a raiz é o mesmo produto com path incompleto — há dezenas
//   de moldes operacionais nessa forma. Recusar bloquearia a operação; inventar
//   URL para WhatsApp/outros domínios NÃO entra no escopo.
//
// Espelho SQL: public.resolver_destino_url_lp_legal_e_viver (mesmos critérios, PO-17).

export const COMPANY_LEGAL_E_VIVER = "ded20b38-f42e-4c71-800c-31b97ea48bcf";
export const DESTINO_CANONICO_LP_LEGAL_E_VIVER =
  "https://legaleviver.com.br/simulacao-clt";
const DOMINIO_LP_LEGAL_E_VIVER = "legaleviver.com.br";

export type ResolucaoDestinoUrlLp = {
  aplicavel: boolean;
  url_original: string | null;
  url_final: string | null;
  corrigiu: boolean;
  motivo:
    | "empresa_fora_do_escopo"
    | "url_ausente"
    | "url_invalida"
    | "dominio_fora_do_escopo_lp"
    | "ja_canonico"
    | "corrigido_para_canonico";
};

/** Normaliza host (sem www) e path (sem barra final) para comparação. */
function hostEPath(url: string): { host: string; path: string } | null {
  try {
    const u = new URL(url.trim());
    const host = u.hostname.replace(/^www\./i, "").toLowerCase();
    let path = u.pathname || "/";
    if (path.length > 1 && path.endsWith("/")) path = path.slice(0, -1);
    return { host, path };
  } catch {
    return null;
  }
}

/**
 * Resolve o destino de LP/Site da Legal e Viver.
 * Só mexe quando company = LEV e a URL é do domínio legaleviver.com.br.
 * WhatsApp (wa.me, api.whatsapp.com) e outros domínios: aplicavel=false, URL intacta.
 */
export function resolverDestinoUrlLpLegalEViver(
  companyId: string | null | undefined,
  url: string | null | undefined,
): ResolucaoDestinoUrlLp {
  const original = url == null ? null : String(url).trim() || null;
  if (!companyId || companyId !== COMPANY_LEGAL_E_VIVER) {
    return {
      aplicavel: false,
      url_original: original,
      url_final: original,
      corrigiu: false,
      motivo: "empresa_fora_do_escopo",
    };
  }
  if (!original) {
    return {
      aplicavel: false,
      url_original: null,
      url_final: null,
      corrigiu: false,
      motivo: "url_ausente",
    };
  }
  const hp = hostEPath(original);
  if (!hp) {
    return {
      aplicavel: false,
      url_original: original,
      url_final: original,
      corrigiu: false,
      motivo: "url_invalida",
    };
  }
  if (hp.host !== DOMINIO_LP_LEGAL_E_VIVER) {
    return {
      aplicavel: false,
      url_original: original,
      url_final: original,
      corrigiu: false,
      motivo: "dominio_fora_do_escopo_lp",
    };
  }

  const ja =
    hp.path === "/simulacao-clt" &&
    /^https:\/\//i.test(original) &&
    !/^https?:\/\/www\./i.test(original) &&
    !original.includes("?") &&
    !original.includes("#") &&
    original.replace(/\/$/, "") === DESTINO_CANONICO_LP_LEGAL_E_VIVER;

  if (ja) {
    return {
      aplicavel: true,
      url_original: original,
      url_final: DESTINO_CANONICO_LP_LEGAL_E_VIVER,
      corrigiu: false,
      motivo: "ja_canonico",
    };
  }

  return {
    aplicavel: true,
    url_original: original,
    url_final: DESTINO_CANONICO_LP_LEGAL_E_VIVER,
    corrigiu: true,
    motivo: "corrigido_para_canonico",
  };
}

/** Grava o link canônico em video_data.link e call_to_action.value.link, se existirem. */
export function aplicarLinkNoVideoData(vd: Record<string, unknown>, link: string): Record<string, unknown> {
  const novo: Record<string, unknown> = { ...vd, link };
  const cta = vd.call_to_action;
  if (cta && typeof cta === "object") {
    const ctaObj = cta as Record<string, unknown>;
    const value = ctaObj.value;
    if (value && typeof value === "object") {
      novo.call_to_action = {
        ...ctaObj,
        value: { ...(value as Record<string, unknown>), link },
      };
    } else {
      novo.call_to_action = { ...ctaObj, value: { link } };
    }
  }
  return novo;
}
