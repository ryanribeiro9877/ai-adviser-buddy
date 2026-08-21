// supabase/functions/meta-token-monitor/index.ts (v2) — ESP-30 + multi-empresa
// Monitor de EXPIRACAO e ESCOPO dos tokens Meta + modelo BM/contas de anuncio.
//
// v2 (21/08/2026): uma corrida por EMPRESA com o token DELA (META_ADS_TOKEN /
// META_ADS_TOKEN_COHAPM). Nunca usa o token da Legal para coletar a COHAPM e vice-versa.
//
// REGRA DURA: o segredo vive so na env var. meta_tokens guarda METADADO, jamais o valor.
//
// Body: {} = coleta real | { teste: true, company_id? } = alerta sintetico.
// Auth: x-mcp-key. Cron diario 09:15 UTC.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { chaveMcpDe, mcpKeyValida } from "../_shared/mcp_auth.ts";
import {
  EMPRESAS_META,
  empresasComTokenAds,
  empresasComTokenWaba,
  redactAllMetaTokens,
  tokenRefMetadado,
  tokenWabaPorCompanyId,
} from "../_shared/meta_company_tokens.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const GRAPH = "https://graph.facebook.com/v21.0";
const AVISO_DIAS = 14;
const VERSAO = "meta-token-monitor-v2";

const ESCOPOS_ESPERADOS: Record<string, string[]> = {
  ads: ["ads_management", "ads_read", "business_management", "pages_read_engagement", "pages_manage_ads"],
  waba: ["whatsapp_business_management", "whatsapp_business_messaging", "business_management"],
};

const STATUS_LABEL: Record<number, string> = {
  1: "ATIVA", 2: "DESATIVADA", 3: "UNSETTLED (cobranca pendente)", 7: "PENDING_RISK_REVIEW",
  8: "PENDING_SETTLEMENT", 9: "IN_GRACE_PERIOD", 100: "PENDING_CLOSURE", 101: "FECHADA",
};

const supa = createClient(SUPABASE_URL, SERVICE_ROLE, { auth: { persistSession: false } });

function json(obj: unknown, status = 200) {
  return new Response(redactAllMetaTokens(JSON.stringify(obj)), {
    status,
    headers: { "content-type": "application/json" },
  });
}
async function g(path: string, token: string) {
  const sep = path.includes("?") ? "&" : "?";
  const r = await fetch(`${GRAPH}${path}${sep}access_token=${encodeURIComponent(token)}`);
  const t = await r.text();
  try {
    return { status: r.status, body: JSON.parse(redactAllMetaTokens(t)) };
  } catch {
    return { status: r.status, body: redactAllMetaTokens(t.slice(0, 400)) };
  }
}
function epochToIso(v: unknown): string | null {
  const n = Number(v ?? 0);
  return n > 0 ? new Date(n * 1000).toISOString() : null;
}
function escoposDe(dd: any): string[] {
  return Array.from(new Set([
    ...(Array.isArray(dd?.scopes) ? dd.scopes.map(String) : []),
    ...(Array.isArray(dd?.granular_scopes)
      ? dd.granular_scopes.map((s: any) => String(s?.scope ?? "")).filter(Boolean)
      : []),
  ]));
}

async function upsertAlert(companyId: string, severity: string, title: string, description: string) {
  const { data: dup } = await supa.from("alerts").select("id").eq("company_id", companyId).eq("title", title)
    .eq("resolved", false).limit(1).maybeSingle();
  if (dup) return { created: false, motivo: "dedup: alerta identico ja ativo" };
  const { error } = await supa.from("alerts").insert({
    company_id: companyId, severity, title, description, resolved: false,
  });
  return error ? { created: false, motivo: error.message } : { created: true };
}

async function coletarToken(
  papel: "ads" | "waba",
  tokenRef: string,
  token: string,
  companyId: string,
) {
  const quem = await g("/me?fields=id,name", token);
  const debug = await g(`/debug_token?input_token=${encodeURIComponent(token)}`, token);
  const dd: any = (debug.body as any)?.data ?? {};
  const scopes = escoposDe(dd);
  const expiraIso = epochToIso(dd?.expires_at);
  const dataAccessIso = epochToIso(dd?.data_access_expires_at);
  const isValid = dd?.is_valid ?? null;
  const faltando = ESCOPOS_ESPERADOS[papel].filter((e) => !scopes.includes(e));

  const linha = {
    token_ref: tokenRef,
    papel,
    company_id: companyId,
    app_id: dd?.app_id ? String(dd.app_id) : null,
    tipo: dd?.type ?? null,
    subject_id: (quem.body as any)?.id ? String((quem.body as any).id) : null,
    subject_nome: (quem.body as any)?.name ?? null,
    is_valid: isValid,
    expires_at: expiraIso,
    data_access_expires_at: dataAccessIso,
    scopes,
    granular_scopes: Array.isArray(dd?.granular_scopes) ? dd.granular_scopes : null,
    verificado_em: new Date().toISOString(),
    bruto: { me: quem.body, debug_token: debug.body },
  };
  const { error } = await supa.from("meta_tokens").upsert(linha, { onConflict: "token_ref" });

  const alertas: any[] = [];
  const diasExp = expiraIso ? (new Date(expiraIso).getTime() - Date.now()) / 86400000 : null;
  const diasDa = dataAccessIso ? (new Date(dataAccessIso).getTime() - Date.now()) / 86400000 : null;
  if (isValid !== true) {
    alertas.push(await upsertAlert(companyId, "critical",
      `[TOKEN] ${tokenRef} INVALIDO`,
      `debug_token is_valid=${isValid}. Renovar o Edge Secret ${tokenRef} desta empresa.`));
  } else if (diasExp !== null && diasExp <= 0) {
    alertas.push(await upsertAlert(companyId, "critical", `[TOKEN] ${tokenRef} EXPIRADO`,
      `expires_at=${expiraIso}. Renovar imediatamente.`));
  } else if ((diasExp !== null && diasExp <= AVISO_DIAS) || (diasDa !== null && diasDa <= AVISO_DIAS)) {
    const q = diasExp !== null && diasExp <= AVISO_DIAS ? diasExp : diasDa;
    alertas.push(await upsertAlert(companyId, "high", `[TOKEN] ${tokenRef} expira em breve`,
      `Faltam ~${Math.max(0, Math.floor(q ?? 0))} dia(s).`));
  }
  if (faltando.length) {
    alertas.push(await upsertAlert(companyId, "high", `[TOKEN] ${tokenRef} sem escopo esperado`,
      `Faltam: ${faltando.join(", ")}.`));
  }

  return {
    token_ref: tokenRef, papel, company_id: companyId, gravado: !error,
    erro_gravacao: error?.message ?? null, valido: isValid, tipo: dd?.type ?? null,
    app_id: dd?.app_id ?? null, escopos_faltando: faltando, alertas,
  };
}

async function coletarModelo(companyId: string, token: string) {
  const bms: any[] = [];
  const contas: any[] = [];
  const negocios = await g("/me/businesses?fields=id,name,verification_status,primary_page&limit=50", token);
  for (const b of ((negocios.body as any)?.data ?? [])) {
    await supa.from("meta_business_managers").upsert({
      bm_id: String(b.id), nome: b.name ?? null, company_id: companyId,
      verificado: b.verification_status ?? null,
      primary_page_id: b.primary_page?.id ? String(b.primary_page.id) : null,
      coletado_em: new Date().toISOString(), bruto: b,
    }, { onConflict: "bm_id" });
    bms.push({ bm_id: String(b.id), nome: b.name ?? null });

    const owned = await g(
      `/${b.id}/owned_ad_accounts?fields=account_id,name,account_status,currency&limit=200`,
      token,
    );
    for (const a of ((owned.body as any)?.data ?? [])) {
      const acct = a.account_id ? `act_${a.account_id}` : null;
      if (!acct) continue;
      const st = Number(a.account_status ?? 0);
      await supa.from("meta_ad_accounts").upsert({
        account_id: acct, nome: a.name ?? null, company_id: companyId, bm_id: String(b.id),
        account_status: st || null, status_label: STATUS_LABEL[st] ?? null, moeda: a.currency ?? null,
        coletado_em: new Date().toISOString(), bruto: a,
      }, { onConflict: "account_id" });
      contas.push({ account_id: acct, bm_id: String(b.id), status: STATUS_LABEL[st] ?? st });
    }
  }
  return { businesses: bms.length, total_contas: contas.length, bms, contas };
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return json({ error: "POST only" }, 405);
  const auth = await mcpKeyValida(supa, chaveMcpDe(req, "header-only"));
  if (!auth.ok) return json({ error: "unauthorized", motivo: auth.motivo }, 401);

  let body: any = {};
  try { body = await req.json(); } catch { /* */ }

  if (body?.teste === true) {
    const alvo = String(body?.company_id ?? EMPRESAS_META[0].company_id);
    const r = await upsertAlert(alvo, "high",
      "[TOKEN][TESTE] Token Meta expira em breve (simulacao)",
      "Alerta SINTETICO do meta-token-monitor v2.");
    return json({ ok: true, modo: "TESTE", versao: VERSAO, alerta: r });
  }

  const filtro = body?.company_id ? String(body.company_id).trim() : null;
  const adsEmpresas = empresasComTokenAds().filter((e) => !filtro || e.company_id === filtro);
  const porEmpresa: any[] = [];

  for (const emp of adsEmpresas) {
    const tokens: any[] = [];
    tokens.push(await coletarToken("ads", tokenRefMetadado("ads", emp.slug), emp.token, emp.company_id));

    const waba = tokenWabaPorCompanyId(emp.company_id);
    if (waba) {
      tokens.push(await coletarToken("waba", tokenRefMetadado("waba", emp.slug), waba.token, emp.company_id));
    } else {
      tokens.push({
        token_ref: tokenRefMetadado("waba", emp.slug),
        papel: "waba",
        company_id: emp.company_id,
        ausente: true,
      });
    }

    const modelo = await coletarModelo(emp.company_id, emp.token);
    porEmpresa.push({
      company_id: emp.company_id,
      slug: emp.slug,
      nome: emp.nome,
      ads_ref: emp.ref,
      tokens,
      modelo,
    });
  }

  // Empresas cadastradas sem secret Ads — declara ausencia (nao usa token alheio).
  for (const cfg of EMPRESAS_META) {
    if (filtro && cfg.company_id !== filtro) continue;
    if (adsEmpresas.some((e) => e.company_id === cfg.company_id)) continue;
    porEmpresa.push({
      company_id: cfg.company_id,
      slug: cfg.slug,
      nome: cfg.nome,
      pulado: true,
      motivo: `secret Ads ausente (${cfg.ads_secret_names.join(" | ")}) — nao reutiliza token de outra empresa`,
    });
  }

  return json({
    ok: true,
    versao: VERSAO,
    modo: "COLETA",
    aviso_dias: AVISO_DIAS,
    empresas: porEmpresa,
    waba_secrets_presentes: empresasComTokenWaba().map((e) => ({ slug: e.slug, ref: e.ref })),
    nota: "v2: um token por empresa. meta_tokens.company_id = empresa dona do secret. Sem fallback cruzado.",
  });
});
