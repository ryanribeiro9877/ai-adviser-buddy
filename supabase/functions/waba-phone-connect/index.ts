// Conecta números WABA à Cloud API (ON_PREMISE DISCONNECTED → register).
// A API On-Premises encerrou em 23/10/2025; não existe "ligar de novo" no on-prem.
// Status CONNECTED só muda na Meta — esta edge NÃO inventa CONNECTED no banco.
//
// Ações:
//   inspect (default) — GET Graph do número/WABA + Página (ads token)
//   request_code      — SMS/VOICE de verificação (precisa ter o chip na mão)
//   verify_code       — envia o código recebido
//   register          — POST /{phone-id}/register { messaging_product, pin }
//
// PIN nunca é logado nem devolvido. Auth: x-mcp-key / Bearer (mcp_key_valida).

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { chaveMcpDe, mcpKeyValida } from "../_shared/mcp_auth.ts";
import {
  COMPANY_COHAPM,
  redactAllMetaTokens,
  tokenAdsPorCompanyId,
  tokenWabaPorCompanyId,
} from "../_shared/meta_company_tokens.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const GRAPH = "https://graph.facebook.com/v22.0";
const VERSAO = "waba-phone-connect-v1";
const PAGE_COHAPM = "105656372312257";
const PHONE_FIELDS = [
  "id",
  "display_phone_number",
  "verified_name",
  "status",
  "platform_type",
  "code_verification_status",
  "quality_rating",
  "messaging_limit_tier",
  "name_status",
  "is_official_business_account",
  "last_onboarded_time",
  "throughput",
].join(",");
const WABA_FIELDS = [
  "id",
  "name",
  "account_review_status",
  "ownership_type",
  "timezone_id",
  "currency",
  "on_behalf_of_business_info",
  "owner_business_info",
].join(",");

const CORS = {
  "access-control-allow-origin": "*",
  "access-control-allow-headers": "authorization, x-mcp-key, content-type",
};

const json = (value: unknown, status = 200) =>
  new Response(redactAllMetaTokens(JSON.stringify(value)), {
    status,
    headers: { "content-type": "application/json", ...CORS },
  });

function graphError(body: unknown): { code: number | null; message: string; subcode: number | null } {
  const err = (body as { error?: { code?: number; message?: string; error_subcode?: number } } | null)?.error;
  return {
    code: err?.code ?? null,
    message: String(err?.message ?? "").slice(0, 400),
    subcode: err?.error_subcode ?? null,
  };
}

async function graphGet(path: string, token: string) {
  const url = new URL(`${GRAPH}/${path.replace(/^\//, "")}`);
  url.searchParams.set("access_token", token);
  const resp = await fetch(url.toString());
  const text = await resp.text();
  let body: unknown = null;
  try {
    body = JSON.parse(text);
  } catch {
    body = { raw: text.slice(0, 300) };
  }
  return { ok: resp.ok, status: resp.status, body };
}

async function graphPostJson(path: string, token: string, payload: Record<string, unknown>) {
  const resp = await fetch(`${GRAPH}/${path.replace(/^\//, "")}`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
    },
    body: JSON.stringify(payload),
  });
  const text = await resp.text();
  let body: unknown = null;
  try {
    body = JSON.parse(text);
  } catch {
    body = { raw: text.slice(0, 300) };
  }
  return { ok: resp.ok, status: resp.status, body };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: CORS });
  if (req.method !== "POST") return json({ error: "POST only" }, 405);

  const supa = createClient(SUPABASE_URL, SERVICE_ROLE, { auth: { persistSession: false } });
  const auth = await mcpKeyValida(supa, chaveMcpDe(req, "bearer-or-header"));
  if (!auth.ok) return json({ error: "unauthorized", motivo: auth.motivo }, 401);

  let body: Record<string, unknown> = {};
  try {
    body = await req.json();
  } catch {
    body = {};
  }

  const companyId = String(body.company_id ?? COMPANY_COHAPM).trim();
  const acao = String(body.acao ?? body.action ?? "inspect").trim().toLowerCase();
  const tw = tokenWabaPorCompanyId(companyId);
  if (!tw) {
    return json({
      ok: false,
      versao: VERSAO,
      error: "missing_waba_token_for_company",
      company_id: companyId,
    }, 400);
  }

  const { data: rows, error: qErr } = await supa
    .from("waba_phone_numbers")
    .select("external_id,display_phone_number,verified_name,status,platform_type,waba_external_id")
    .eq("company_id", companyId)
    .not("platform_type", "eq", "CLICK_TO_WHATSAPP");
  if (qErr) return json({ ok: false, error: qErr.message }, 500);

  const pedidos = Array.isArray(body.phone_ids)
    ? (body.phone_ids as unknown[]).map((x) => String(x).trim()).filter(Boolean)
    : [];
  const alvos = (rows ?? []).filter((r: { external_id: string; verified_name?: string | null }) => {
    if (pedidos.length) return pedidos.includes(r.external_id);
    const nome = String(r.verified_name ?? "").toLowerCase();
    return nome.includes("juridico") || nome.includes("jurídico");
  });
  if (!alvos.length) {
    return json({ ok: false, versao: VERSAO, error: "nenhum_numero_alvo", company_id: companyId }, 400);
  }

  const permitido = new Set((rows ?? []).map((r: { external_id: string }) => r.external_id));
  for (const id of alvos.map((a: { external_id: string }) => a.external_id)) {
    if (!permitido.has(id)) {
      return json({ ok: false, error: "phone_fora_da_empresa", phone_id: id }, 403);
    }
  }

  if (acao === "inspect") {
    const numeros = [];
    for (const alvo of alvos) {
      const phone = await graphGet(`${alvo.external_id}?fields=${PHONE_FIELDS}`, tw.token);
      const waba = await graphGet(
        `${alvo.waba_external_id}?fields=${WABA_FIELDS}`,
        tw.token,
      );
      if (phone.ok && phone.body && typeof phone.body === "object") {
        const p = phone.body as Record<string, unknown>;
        await supa.from("waba_phone_numbers").update({
          status: p.status ?? null,
          platform_type: p.platform_type ?? null,
          quality_rating: p.quality_rating ?? null,
          verified_name: p.verified_name ?? null,
          display_phone_number: p.display_phone_number ?? null,
          last_synced_at: new Date().toISOString(),
          raw: p,
        }).eq("external_id", alvo.external_id);
      }
      numeros.push({
        phone_id: alvo.external_id,
        waba_id: alvo.waba_external_id,
        inventario: {
          display: alvo.display_phone_number,
          status: alvo.status,
          platform_type: alvo.platform_type,
        },
        graph_phone: phone.ok ? phone.body : { erro: graphError(phone.body), http: phone.status },
        graph_waba: waba.ok ? waba.body : { erro: graphError(waba.body), http: waba.status },
      });
    }

    const ads = tokenAdsPorCompanyId(companyId);
    let pagina: unknown = null;
    if (ads) {
      const pageId = String(body.page_id ?? PAGE_COHAPM).trim();
      const page = await graphGet(
        `${pageId}?fields=id,name,whatsapp_number,page_backed_instagram_accounts`,
        ads.token,
      );
      const wabasPage = await graphGet(`${pageId}/whatsapp_business_accounts?fields=id,name`, ads.token);
      pagina = {
        page: page.ok ? page.body : { erro: graphError(page.body), http: page.status },
        whatsapp_business_accounts: wabasPage.ok
          ? wabasPage.body
          : { erro: graphError(wabasPage.body), http: wabasPage.status },
      };
    }

    return json({
      ok: true,
      versao: VERSAO,
      acao: "inspect",
      company_id: companyId,
      token_waba_ref: tw.ref,
      nota: "ON_PREMISE DISCONNECTED nao volta sozinho. Cloud API exige POST /register com PIN de 6 digitos. Nao chame register sem o PIN — 10 tentativas / 72h bloqueiam o numero (133016).",
      numeros,
      pagina,
    });
  }

  const phoneId = String(body.phone_id ?? "").trim();
  if (!phoneId || !permitido.has(phoneId)) {
    return json({ ok: false, error: "phone_id_obrigatorio_e_da_empresa" }, 400);
  }

  if (acao === "request_code") {
    const method = String(body.code_method ?? "SMS").toUpperCase() === "VOICE" ? "VOICE" : "SMS";
    const language = String(body.language ?? "pt_BR");
    const r = await graphPostJson(`${phoneId}/request_code`, tw.token, {
      code_method: method,
      language,
    });
    return json({
      ok: r.ok,
      versao: VERSAO,
      acao: "request_code",
      phone_id: phoneId,
      http: r.status,
      resultado: r.ok ? r.body : graphError(r.body),
    }, r.ok ? 200 : 502);
  }

  if (acao === "verify_code") {
    const code = String(body.code ?? "").replace(/\D/g, "");
    if (code.length < 4) return json({ ok: false, error: "code_ausente" }, 400);
    const r = await graphPostJson(`${phoneId}/verify_code`, tw.token, { code });
    return json({
      ok: r.ok,
      versao: VERSAO,
      acao: "verify_code",
      phone_id: phoneId,
      http: r.status,
      resultado: r.ok ? r.body : graphError(r.body),
    }, r.ok ? 200 : 502);
  }

  if (acao === "register") {
    const pin = String(body.pin ?? "").replace(/\D/g, "");
    if (pin.length !== 6) {
      return json({
        ok: false,
        error: "pin_6_digitos_obrigatorio",
        nota: "PIN de verificacao em duas etapas do numero (WhatsApp Manager). Sem isso o register falha ou trava o numero.",
      }, 400);
    }
    const payload: Record<string, unknown> = {
      messaging_product: "whatsapp",
      pin,
    };
    if (body.data_localization_region) {
      payload.data_localization_region = String(body.data_localization_region).slice(0, 2).toUpperCase();
    }
    const r = await graphPostJson(`${phoneId}/register`, tw.token, payload);
    const depois = await graphGet(`${phoneId}?fields=${PHONE_FIELDS}`, tw.token);
    if (depois.ok && depois.body && typeof depois.body === "object") {
      const p = depois.body as Record<string, unknown>;
      await supa.from("waba_phone_numbers").update({
        status: p.status ?? null,
        platform_type: p.platform_type ?? null,
        last_synced_at: new Date().toISOString(),
        raw: p,
      }).eq("external_id", phoneId);
    }
    return json({
      ok: r.ok,
      versao: VERSAO,
      acao: "register",
      phone_id: phoneId,
      http: r.status,
      resultado: r.ok ? r.body : graphError(r.body),
      status_depois: depois.ok ? depois.body : graphError(depois.body),
    }, r.ok ? 200 : 502);
  }

  return json({ ok: false, error: "acao_desconhecida", acao }, 400);
});
