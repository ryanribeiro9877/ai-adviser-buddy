// supabase/functions/_shared/meta_company_tokens.ts
//
// Tokens Meta POR EMPRESA — nunca misturar COHAPM e Legal no mesmo request Graph.
//
// Edge Secrets — nomes literais, sem alias e sem fallback cruzado:
//   Legal:  META_ADS_TOKEN / WHATSAPP_ACCESS_TOKEN
//   COHAPM: META_ADS_TOKEN_COHAPM / WHATSAPP_ACCESS_TOKEN_COHAPM
//
// REGRA: escolha o token pelo company_id do card/job/sync. Se o secret da empresa
// estiver ausente, FALHE de forma honesta — NÃO faça fallback para o token da outra
// empresa (isso misturaria ativos e dados).

export const COMPANY_LEGAL = "ded20b38-f42e-4c71-800c-31b97ea48bcf";
export const COMPANY_COHAPM = "57f755b9-c23d-4f58-a488-8173d697c010";

export type PapelMeta = "ads" | "waba";

export type EmpresaMetaCfg = {
  company_id: string;
  slug: string;
  nome: string;
  /** Contas act_… operacionais desta empresa (monitor/BM). */
  ad_accounts: string[];
  /** Business Manager id (Graph) — owned/client WABA discovery. */
  business_id: string | null;
  ads_secret_names: string[];
  waba_secret_names: string[];
};

/** Cadastro fechado — só estas empresas têm token Graph no runtime. */
export const EMPRESAS_META: EmpresaMetaCfg[] = [
  {
    company_id: COMPANY_LEGAL,
    slug: "LEGAL",
    nome: "Legal é Viver",
    ad_accounts: ["act_3302001729967572"],
    // Legado: META_BUSINESS_ID no secret; se ausente, discovery cai em assigned.
    business_id: null,
    ads_secret_names: ["META_ADS_TOKEN"],
    waba_secret_names: ["WHATSAPP_ACCESS_TOKEN"],
  },
  {
    company_id: COMPANY_COHAPM,
    slug: "COHAPM",
    nome: "COHAPM",
    ad_accounts: ["act_1622612945584817"],
    // BM "Cohapm" (visto em act_1622612945584817.business)
    business_id: "870473609113498",
    ads_secret_names: ["META_ADS_TOKEN_COHAPM"],
    waba_secret_names: ["WHATSAPP_ACCESS_TOKEN_COHAPM"],
  },
];

/** BM Graph id para discovery de WABA (owned/client). */
export function businessIdPorCompanyId(companyId: string | null | undefined): string {
  const cfg = cfgEmpresa(companyId);
  if (!cfg) return "";
  if (cfg.business_id) return cfg.business_id;
  if (cfg.company_id === COMPANY_LEGAL) {
    return (Deno.env.get("META_BUSINESS_ID") ?? "").trim();
  }
  return "";
}

function lerSecret(nomes: string[]): { valor: string; ref: string } | null {
  for (const nome of nomes) {
    const v = (Deno.env.get(nome) ?? "").trim();
    if (v) return { valor: v, ref: nome };
  }
  return null;
}

export function cfgEmpresa(companyId: string | null | undefined): EmpresaMetaCfg | null {
  if (!companyId) return null;
  const id = String(companyId).trim();
  return EMPRESAS_META.find((e) => e.company_id === id) ?? null;
}

export function tokenAdsPorCompanyId(companyId: string | null | undefined): {
  token: string;
  ref: string;
  company_id: string;
  slug: string;
} | null {
  const cfg = cfgEmpresa(companyId);
  if (!cfg) return null;
  const s = lerSecret(cfg.ads_secret_names);
  if (!s) return null;
  return { token: s.valor, ref: s.ref, company_id: cfg.company_id, slug: cfg.slug };
}

export function tokenWabaPorCompanyId(companyId: string | null | undefined): {
  token: string;
  ref: string;
  company_id: string;
  slug: string;
} | null {
  const cfg = cfgEmpresa(companyId);
  if (!cfg) return null;
  const s = lerSecret(cfg.waba_secret_names);
  if (!s) return null;
  return { token: s.valor, ref: s.ref, company_id: cfg.company_id, slug: cfg.slug };
}

/** token_ref único em meta_tokens (unique). Legal mantém refs legadas. */
export function tokenRefMetadado(papel: PapelMeta, slug: string): string {
  if (slug === "LEGAL") {
    return papel === "ads" ? "META_ADS_TOKEN" : "WHATSAPP_ACCESS_TOKEN";
  }
  return papel === "ads" ? `META_ADS_TOKEN_${slug}` : `WHATSAPP_ACCESS_TOKEN_${slug}`;
}

/** Redige TODOS os tokens conhecidos de todas as empresas (nunca vazar na resposta). */
export function redactAllMetaTokens(s: string): string {
  let o = s;
  for (const emp of EMPRESAS_META) {
    for (const nomes of [emp.ads_secret_names, emp.waba_secret_names]) {
      for (const nome of nomes) {
        const v = (Deno.env.get(nome) ?? "").trim();
        if (v) o = o.split(v).join("[TOKEN-REDACTED]");
      }
    }
  }
  return o.replace(/access_token=[A-Za-z0-9_\-.]+/g, "access_token=[TOKEN-REDACTED]");
}

export function empresaPorAdAccount(actOrId: string | null | undefined): EmpresaMetaCfg | null {
  if (!actOrId) return null;
  const raw = String(actOrId).replace(/^act_/, "");
  const act = `act_${raw}`;
  return EMPRESAS_META.find((e) => e.ad_accounts.some((a) => a === act || a.replace(/^act_/, "") === raw)) ?? null;
}

/** Lista empresas que TÊM o secret Ads presente no runtime (p/ crons multi-empresa). */
export function empresasComTokenAds(): Array<EmpresaMetaCfg & { token: string; ref: string }> {
  const out: Array<EmpresaMetaCfg & { token: string; ref: string }> = [];
  for (const e of EMPRESAS_META) {
    const s = lerSecret(e.ads_secret_names);
    if (s) out.push({ ...e, token: s.valor, ref: s.ref });
  }
  return out;
}

export function empresasComTokenWaba(): Array<EmpresaMetaCfg & { token: string; ref: string }> {
  const out: Array<EmpresaMetaCfg & { token: string; ref: string }> = [];
  for (const e of EMPRESAS_META) {
    const s = lerSecret(e.waba_secret_names);
    if (s) out.push({ ...e, token: s.valor, ref: s.ref });
  }
  return out;
}
