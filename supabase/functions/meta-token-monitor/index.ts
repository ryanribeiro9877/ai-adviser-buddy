// supabase/functions/meta-token-monitor/index.ts (v1) — ESP-30
// Monitor de EXPIRACAO e ESCOPO dos tokens Meta + modelo BM/contas de anuncio.
//
// POR QUE EXISTE: o bm-monitor (F4.4) ja vigia STATUS/cobranca da conta e o
// meta-identity-probe ja LE escopo/validade ao vivo, mas NADA gravava QUANDO o token
// expira nem QUAIS escopos ele carrega ao longo do tempo. Token vencendo derruba todo o
// sistema em silencio. Esta funcao le /me + /debug_token de cada token, grava METADADO em
// public.meta_tokens (NUNCA o valor), mapeia BM -> contas de anuncio (meta_business_managers,
// meta_ad_accounts) e levanta alerta (dedup) quando o token esta invalido, expira em
// <= AVISO_DIAS ou falta escopo esperado. Leitura via saude_dos_tokens(company_id).
//
// REGRA DURA: o segredo do token vive so na env var (META_ADS_TOKEN/WHATSAPP_ACCESS_TOKEN).
// meta_tokens guarda app_id/tipo/validade/escopos, jamais o valor.
//
// Body: {} = coleta real | { teste: true } = alerta sintetico [TESTE].
// Auth: x-mcp-key. Cron diario recomendado (ex.: 09:15 UTC, antes do bm-monitor).

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { chaveMcpDe, mcpKeyValida } from "../_shared/mcp_auth.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const T_ADS = (Deno.env.get("META_ADS_TOKEN") ?? "").trim();
const T_WABA = (Deno.env.get("WHATSAPP_ACCESS_TOKEN") ?? "").trim();
const GRAPH = "https://graph.facebook.com/v21.0";
const AVISO_DIAS = 14;

const ESCOPOS_ESPERADOS: Record<string, string[]> = {
  ads: ["ads_management", "ads_read", "business_management", "pages_read_engagement", "pages_manage_ads"],
  waba: ["whatsapp_business_management", "whatsapp_business_messaging", "business_management"],
};

const STATUS_LABEL: Record<number, string> = {
  1: "ATIVA", 2: "DESATIVADA", 3: "UNSETTLED (cobranca pendente)", 7: "PENDING_RISK_REVIEW",
  8: "PENDING_SETTLEMENT", 9: "IN_GRACE_PERIOD", 100: "PENDING_CLOSURE", 101: "FECHADA",
};

const supa = createClient(SUPABASE_URL, SERVICE_ROLE, { auth: { persistSession: false } });

function redact(s: string): string {
  let o = s;
  for (const t of [T_ADS, T_WABA]) if (t) o = o.split(t).join("[TOKEN-REDACTED]");
  return o.replace(/access_token=[A-Za-z0-9_\-.]+/g, "access_token=[TOKEN-REDACTED]");
}
function json(obj: unknown, status = 200) {
  return new Response(redact(JSON.stringify(obj)), { status, headers: { "content-type": "application/json" } });
}
async function g(path: string, token: string) {
  const sep = path.includes("?") ? "&" : "?";
  const r = await fetch(`${GRAPH}${path}${sep}access_token=${encodeURIComponent(token)}`);
  const t = await r.text();
  try { return { status: r.status, body: JSON.parse(redact(t)) }; } catch { return { status: r.status, body: redact(t.slice(0, 400)) }; }
}
// debug_token devolve unix seconds; 0 = nunca expira (system user).
function epochToIso(v: unknown): string | null {
  const n = Number(v ?? 0);
  return n > 0 ? new Date(n * 1000).toISOString() : null;
}
function escoposDe(dd: any): string[] {
  return Array.from(new Set([
    ...(Array.isArray(dd?.scopes) ? dd.scopes.map(String) : []),
    ...(Array.isArray(dd?.granular_scopes) ? dd.granular_scopes.map((s: any) => String(s?.scope ?? "")).filter(Boolean) : []),
  ]));
}

async function upsertAlert(companyId: string, severity: string, title: string, description: string) {
  const { data: dup } = await supa.from("alerts").select("id").eq("company_id", companyId).eq("title", title).eq("resolved", false).limit(1).maybeSingle();
  if (dup) return { created: false, motivo: "dedup: alerta identico ja ativo" };
  const { error } = await supa.from("alerts").insert({ company_id: companyId, severity, title, description, resolved: false });
  return error ? { created: false, motivo: error.message } : { created: true };
}

async function coletarToken(papel: "ads" | "waba", tokenRef: string, token: string, companyId: string) {
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

  // Alertas por token.
  const alertas: any[] = [];
  const diasExp = expiraIso ? (new Date(expiraIso).getTime() - Date.now()) / 86400000 : null;
  const diasDa = dataAccessIso ? (new Date(dataAccessIso).getTime() - Date.now()) / 86400000 : null;
  if (isValid !== true) {
    alertas.push(await upsertAlert(companyId, "critical",
      `[TOKEN] ${tokenRef} INVALIDO`,
      `debug_token retornou is_valid=${isValid}. Todo caminho que usa este token (${papel}) para de funcionar. Acao: renovar o token no painel Meta e atualizar a env var.`));
  } else if (diasExp !== null && diasExp <= 0) {
    alertas.push(await upsertAlert(companyId, "critical", `[TOKEN] ${tokenRef} EXPIRADO`,
      `expires_at=${expiraIso}. Renovar imediatamente.`));
  } else if ((diasExp !== null && diasExp <= AVISO_DIAS) || (diasDa !== null && diasDa <= AVISO_DIAS)) {
    const q = diasExp !== null && diasExp <= AVISO_DIAS ? diasExp : diasDa;
    alertas.push(await upsertAlert(companyId, "high", `[TOKEN] ${tokenRef} expira em breve`,
      `Faltam ~${Math.max(0, Math.floor(q ?? 0))} dia(s) (expires_at=${expiraIso ?? "n/a"}, data_access=${dataAccessIso ?? "n/a"}). Renovar antes do vencimento para nao parar coleta/execucao.`));
  }
  if (faltando.length) {
    alertas.push(await upsertAlert(companyId, "high", `[TOKEN] ${tokenRef} sem escopo esperado`,
      `Faltam escopos: ${faltando.join(", ")}. Risco declarado para papel '${papel}' (nao prova que a acao quebra, mas pode). Reautorizar com os escopos completos.`));
  }

  return {
    token_ref: tokenRef, papel, gravado: !error, erro_gravacao: error?.message ?? null,
    valido: isValid, tipo: dd?.type ?? null, app_id: dd?.app_id ?? null,
    expira_em: expiraIso, data_access_expira_em: dataAccessIso, nao_expira: expiraIso === null,
    escopos_faltando: faltando, alertas,
  };
}

// Mapa BM -> contas de anuncio, usando o token de ads.
async function coletarModelo(companyId: string) {
  const bms: any[] = [];
  const contas: any[] = [];
  const negocios = await g("/me/businesses?fields=id,name,verification_status,primary_page&limit=50", T_ADS);
  for (const b of ((negocios.body as any)?.data ?? [])) {
    await supa.from("meta_business_managers").upsert({
      bm_id: String(b.id), nome: b.name ?? null, company_id: companyId,
      verificado: b.verification_status ?? null,
      primary_page_id: b.primary_page?.id ? String(b.primary_page.id) : null,
      coletado_em: new Date().toISOString(), bruto: b,
    }, { onConflict: "bm_id" });
    bms.push({ bm_id: String(b.id), nome: b.name ?? null });

    const owned = await g(`/${b.id}/owned_ad_accounts?fields=account_id,name,account_status,currency&limit=200`, T_ADS);
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
  return { businesses: bms.length, contas: contas.length, bms, contas };
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return json({ error: "POST only" }, 405);
  const auth = await mcpKeyValida(supa, chaveMcpDe(req, "header-only"));
  if (!auth.ok) return json({ error: "unauthorized", motivo: auth.motivo }, 401);

  const { data: comp } = await supa.from("companies").select("id").ilike("name", "%legal%").limit(1).maybeSingle();
  if (!comp) return json({ error: "empresa nao encontrada" }, 500);

  let body: any = {}; try { body = await req.json(); } catch { /* */ }
  if (body?.teste === true) {
    const r = await upsertAlert(comp.id, "high",
      "[TOKEN][TESTE] Token Meta expira em breve (simulacao)",
      "Alerta SINTETICO do meta-token-monitor para validar o fluxo de expiracao -> tela/chat. Resolver apos o teste; nenhuma condicao real detectada.");
    return json({ ok: true, modo: "TESTE", alerta: r });
  }

  const tokens: any[] = [];
  if (T_ADS) tokens.push(await coletarToken("ads", "META_ADS_TOKEN", T_ADS, comp.id));
  else tokens.push({ token_ref: "META_ADS_TOKEN", papel: "ads", ausente: true });
  if (T_WABA) tokens.push(await coletarToken("waba", "WHATSAPP_ACCESS_TOKEN", T_WABA, comp.id));
  else tokens.push({ token_ref: "WHATSAPP_ACCESS_TOKEN", papel: "waba", ausente: true });

  let modelo: any = { pulado: true, motivo: "META_ADS_TOKEN ausente" };
  if (T_ADS) modelo = await coletarModelo(comp.id);

  return json({
    ok: true, modo: "COLETA", aviso_dias: AVISO_DIAS, tokens, modelo,
    nota: "meta_tokens guarda METADADO, nunca o valor do token. Use saude_dos_tokens(company_id) para leitura consolidada.",
  });
});
