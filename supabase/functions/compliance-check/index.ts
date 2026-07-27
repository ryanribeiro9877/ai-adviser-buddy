// supabase/functions/compliance-check/index.ts (v2) — F4.3
// v2: (a) veredito final calculado DETERMINISTICAMENTE pela edge a partir das severidades
//     das violações (bloqueia=>reprovado; atencao=>atencao; nenhuma=>aprovado) — o modelo
//     só identifica violações; (b) max_tokens 2000 + explicações curtas por instrução;
//     (c) extração de JSON robusta (primeiro '{' ao último '}').
// v1: base. Valida LEGENDA e/ou CRIATIVO contra public.compliance_rules (versionada).
// Auth: x-mcp-key OU Bearer JWT. Body: { legenda?, image_base64?, mime? }.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const OPENROUTER_KEY = (Deno.env.get("OPENROUTER_API_KEY") ?? "").trim();
const MODEL = (Deno.env.get("OPENROUTER_MODEL") ?? "anthropic/claude-sonnet-5").trim();

const supa = createClient(SUPABASE_URL, SERVICE_ROLE, { auth: { persistSession: false } });
const CORS = { "access-control-allow-origin": "*", "access-control-allow-headers": "authorization, x-client-info, apikey, content-type, x-mcp-key", "access-control-allow-methods": "POST, OPTIONS" };
function json(obj: unknown, status = 200) {
  return new Response(JSON.stringify(obj), { status, headers: { "content-type": "application/json", ...CORS } });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });
  if (req.method !== "POST") return json({ error: "POST only" }, 405);
  if (!OPENROUTER_KEY) return json({ error: "missing_openrouter_key" }, 500);

  const authz = req.headers.get("authorization") ?? "";
  const bearer = authz.toLowerCase().startsWith("bearer ") ? authz.slice(7).trim() : "";
  const provided = (req.headers.get("x-mcp-key") ?? "").trim() || bearer;
  const { data: cfg } = await supa.from("mcp_config").select("api_key").eq("id", 1).maybeSingle();
  let authed = false;
  if (cfg?.api_key && provided === cfg.api_key) authed = true;
  else if (bearer) { const { data: u } = await supa.auth.getUser(bearer); if (u?.user) authed = true; }
  if (!authed) return json({ error: "unauthorized" }, 401);

  let body: any = {}; try { body = await req.json(); } catch { /* */ }
  const legenda = String(body?.legenda ?? "").trim();
  const imgB64 = String(body?.image_base64 ?? "").trim();
  const mime = String(body?.mime ?? "image/png");
  if (!legenda && !imgB64) return json({ error: "envie legenda e/ou image_base64" }, 400);

  const { data: rules } = await supa.from("compliance_rules")
    .select("code,categoria,severidade,regra,exemplos_violacao").eq("active", true).order("code");
  if (!rules?.length) return json({ error: "base de regras vazia" }, 500);
  const escopo = legenda && imgB64 ? "ambos" : (legenda ? "legenda" : "criativo");
  const aplicaveis = rules.filter((r) => r.categoria === "ambos" || r.categoria === escopo || escopo === "ambos");
  const sevMap = new Map(aplicaveis.map((r) => [r.code, r.severidade]));

  const regrasTxt = aplicaveis.map((r) => `${r.code} [${r.severidade}] (${r.categoria}): ${r.regra} Ex.: ${r.exemplos_violacao}`).join("\n");
  const instru = `Você é o Guardião de Compliance de anúncios de crédito consignado (Legal é Viver). Identifique VIOLAÇÕES do material contra as regras abaixo. Seja rigoroso mas justo: só aponte violação com base concreta no material; não invente. Responda SOMENTE com JSON válido, sem markdown:\n{"violacoes":[{"code":"...","trecho_ou_elemento":"...","explicacao":"máx 20 palavras"}],"sugestao_reescrita":"legenda corrigida ou null"}\nSe não houver violações: {"violacoes":[],"sugestao_reescrita":null}.\nREGRAS:\n${regrasTxt}`;

  const content: any[] = [{ type: "text", text: instru + (legenda ? `\n\nLEGENDA A AVALIAR:\n\"\"\"${legenda}\"\"\"` : "") + (imgB64 ? "\n\nO CRIATIVO (imagem) segue anexo — avalie elementos visuais e texto na arte." : "") }];
  if (imgB64) content.push({ type: "image_url", image_url: { url: `data:${mime};base64,${imgB64}` } });

  const resp = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${OPENROUTER_KEY}` },
    body: JSON.stringify({ model: MODEL, max_tokens: 2000, messages: [{ role: "user", content }] }),
  });
  const raw = await resp.text();
  if (!resp.ok) return json({ error: `openrouter_http_${resp.status}`, detail: raw.slice(0, 300) }, 502);
  let parsed: any; try { parsed = JSON.parse(raw); } catch { return json({ error: "openrouter_non_json" }, 502); }
  const out = String(parsed?.choices?.[0]?.message?.content ?? "");
  const a = out.indexOf("{"), b = out.lastIndexOf("}");
  if (a < 0 || b <= a) return json({ error: "veredito_nao_estruturado", bruto: out.slice(0, 400) }, 502);
  let veredicto: any;
  try { veredicto = JSON.parse(out.slice(a, b + 1)); } catch { return json({ error: "veredito_nao_estruturado", bruto: out.slice(0, 400) }, 502); }

  // v2: severidade vem da BASE (não do modelo) e o veredito é determinístico
  const violacoes = (Array.isArray(veredicto?.violacoes) ? veredicto.violacoes : [])
    .filter((v: any) => sevMap.has(String(v?.code)))
    .map((v: any) => ({ ...v, severidade: sevMap.get(String(v.code)) }));
  const temBloqueio = violacoes.some((v: any) => v.severidade === "bloqueia");
  const veredito = violacoes.length === 0 ? "aprovado" : (temBloqueio ? "reprovado" : "atencao");

  return json({ ok: true, escopo, regras_aplicadas: aplicaveis.length, veredito, violacoes,
    sugestao_reescrita: veredicto?.sugestao_reescrita ?? null,
    tokens_in: parsed?.usage?.prompt_tokens ?? null, tokens_out: parsed?.usage?.completion_tokens ?? null });
});
