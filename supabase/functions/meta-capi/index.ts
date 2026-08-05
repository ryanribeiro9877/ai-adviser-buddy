// supabase/functions/meta-capi/index.ts (v1)
// Duas acoes:
//  1) acao="descobrir" (default) - lista os Pixels/Datasets da conta de anuncios com
//     id, nome e last_fired_time, para identificar QUAL dataset usar na CAPI.
//     Precisa apenas do META_ADS_TOKEN que ja existe.
//  2) acao="testar" - envia UM evento de teste para a CAPI usando META_DATASET_ID e
//     META_CAPI_TOKEN (Edge Secrets a serem criadas pelo Ryan). Usa test_event_code:
//     o evento aparece na aba "Testar eventos" do Gerenciador de Eventos e NAO afeta
//     otimizacao nem atribuicao das campanhas. Nenhum dado pessoal real e enviado.
// Auth: x-mcp-key. Tokens redigidos de toda saida.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { chaveMcpDe, mcpKeyValida } from "../_shared/mcp_auth.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ADS_TOKEN = (Deno.env.get("META_ADS_TOKEN") ?? "").trim();
const CAPI_TOKEN = (Deno.env.get("META_CAPI_TOKEN") ?? "").trim();
const DATASET = (Deno.env.get("META_DATASET_ID") ?? "").trim();
const AD_ACCOUNT = "act_3302001729967572";
const GRAPH = "https://graph.facebook.com/v21.0";

const supa = createClient(SUPABASE_URL, SERVICE_ROLE, { auth: { persistSession: false } });
function redact(s: string): string {
  let o = s;
  for (const t of [ADS_TOKEN, CAPI_TOKEN]) if (t) o = o.split(t).join("[TOKEN-REDACTED]");
  return o.replace(/access_token=[A-Za-z0-9]+/g, "access_token=[TOKEN-REDACTED]");
}
function json(obj: unknown, status = 200) {
  return new Response(redact(JSON.stringify(obj)), { status, headers: { "content-type": "application/json" } });
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return json({ error: "POST only" }, 405);
  const auth = await mcpKeyValida(supa, chaveMcpDe(req, "header-only"));
  if (!auth.ok) return json({ error: "unauthorized", motivo: auth.motivo }, 401);

  let body: any = {}; try { body = await req.json(); } catch { /* vazio ok */ }
  const acao = String(body?.acao ?? "descobrir");

  if (acao === "descobrir") {
    if (!ADS_TOKEN) return json({ error: "META_ADS_TOKEN ausente" }, 500);
    const r = await fetch(`${GRAPH}/${AD_ACCOUNT}/adspixels?fields=id,name,last_fired_time,is_unavailable,enable_automatic_matching&limit=50&access_token=${encodeURIComponent(ADS_TOKEN)}`);
    const t = await r.text();
    if (!r.ok) return json({ etapa: "listar_pixels", status: r.status, detalhe: redact(t.slice(0, 400)) }, 502);
    let p: any;
    try { p = JSON.parse(t); } catch { return json({ error: "resposta_nao_json" }, 502); }
    const lista = (p?.data ?? []).map((x: any) => ({
      dataset_id: x.id,
      nome: x.name,
      ultimo_evento_recebido: x.last_fired_time ?? "nunca",
      indisponivel: x.is_unavailable ?? false,
      correspondencia_automatica: x.enable_automatic_matching ?? null,
    }));
    return json({
      ok: true, acao,
      pixels_datasets_encontrados: lista.length, lista,
      secrets_ja_configuradas: {
        META_DATASET_ID: DATASET ? "presente" : "AUSENTE",
        META_CAPI_TOKEN: CAPI_TOKEN ? "presente" : "AUSENTE",
      },
      proximo_passo: lista.length
        ? "Escolher o dataset_id da lista (de preferencia o com evento recente), gerar o token da CAPI nele e salvar as duas secrets."
        : "Nenhum pixel na conta: criar um dataset em Gerenciador de Eventos > Conectar Fontes de Dados > Web > API de Conversoes.",
    });
  }

  if (acao === "testar") {
    if (!DATASET || !CAPI_TOKEN) {
      return json({ error: "faltam secrets", META_DATASET_ID: DATASET ? "ok" : "AUSENTE", META_CAPI_TOKEN: CAPI_TOKEN ? "ok" : "AUSENTE" }, 400);
    }
    const testCode = String(body?.test_event_code ?? "TEST12345");
    async function sha256(v: string) {
      const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(v.trim().toLowerCase()));
      return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
    }
    const payload = {
      data: [{
        event_name: "ContratoPago",
        event_time: Math.floor(Date.now() / 1000),
        action_source: "system_generated",
        event_id: `teste-capi-${Date.now()}`,
        user_data: {
          em: [await sha256("teste.integracao@exemplo.com")],
          ph: [await sha256("5571999999999")],
        },
        custom_data: { currency: "BRL", value: 1.00 },
      }],
      test_event_code: testCode,
    };
    const r = await fetch(`${GRAPH}/${DATASET}/events?access_token=${encodeURIComponent(CAPI_TOKEN)}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
    });
    const t = await r.text();
    let resp: any;
    try { resp = JSON.parse(t); } catch { resp = redact(t.slice(0, 300)); }
    return json({
      ok: r.ok, acao, http: r.status, resposta_meta: resp,
      evento_enviado: { nome: "ContratoPago", valor: "BRL 1.00", test_event_code: testCode, dados_pessoais: "ficticios com hash SHA-256" },
      onde_conferir: "Gerenciador de Eventos > seu dataset > aba 'Testar eventos' - deve aparecer 'ContratoPago' em segundos.",
      nota: "Por usar test_event_code, este evento NAO entra em otimizacao nem atribuicao.",
    }, r.ok ? 200 : 502);
  }

  return json({ error: "acao invalida: use 'descobrir' ou 'testar'" }, 400);
});
