// supabase/functions/dash-lev-leads-alvo/index.ts (v1)
// A API /api/leads ignora ordenacao e filtro (provado por sondagem: 11 variacoes, mesmas datas)
// e sao 601 paginas. Mas para CAPI e atribuicao de contrato nao precisamos dos 180 mil leads:
// precisamos dos leads QUE GERARAM PROPOSTA. Esta edge busca esses leads UM A UM por id,
// a partir de lev_propostas.
// Body: { somente_pagas?: boolean (default true), limite?: number (default 150) }
// PII: telefone/nome apenas em SHA-256. CPF nao replicado.
// Auth: x-mcp-key.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const DASH = "https://dash.legaleviver.com.br";
const EMAIL = (Deno.env.get("DASH_LEV_EMAIL") ?? "").trim();
const SENHA = (Deno.env.get("DASH_LEV_PASSWORD") ?? "").trim();
const supa = createClient(SUPABASE_URL, SERVICE_ROLE, { auth: { persistSession: false } });
let JWT = "";
function json(obj: unknown, status = 200) {
  let s = JSON.stringify(obj);
  if (SENHA) s = s.split(SENHA).join("[REDACTED]");
  if (JWT) s = s.split(JWT).join("[REDACTED]");
  return new Response(s, { status, headers: { "content-type": "application/json" } });
}
async function sha256(v: string) {
  const b = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(v));
  return [...new Uint8Array(b)].map((x) => x.toString(16).padStart(2, "0")).join("");
}
async function hTel(v: unknown) {
  const d = String(v ?? "").replace(/\D/g, "");
  if (d.length < 10) return null;
  return await sha256(d.startsWith("55") ? d : `55${d}`);
}
async function hTxt(v: unknown) {
  const s = String(v ?? "").trim().toLowerCase();
  return s ? await sha256(s) : null;
}
const num = (v: unknown) => { const n = Number(String(v ?? "").replace(",", ".")); return Number.isFinite(n) ? n : null; };
const ts = (v: unknown) => { const s = String(v ?? ""); return s && s !== "null" ? s : null; };
const bool = (v: unknown) => v === true || v === "true" || v === 1;

Deno.serve(async (r_) => {
  if (r_.method !== "POST") return json({ error: "POST only" }, 405);
  const prov = (r_.headers.get("x-mcp-key") ?? "").trim();
  const { data: cfg } = await supa.from("mcp_config").select("api_key").eq("id", 1).maybeSingle();
  if (!cfg?.api_key || prov !== cfg.api_key) return json({ error: "unauthorized" }, 401);

  let body: any = {}; try { body = await r_.json(); } catch { /* */ }
  const somentePagas = body?.somente_pagas !== false;
  const limite = Math.max(1, Math.min(Number(body?.limite ?? 150), 400));

  const lg = await fetch(`${DASH}/api/auth/login`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email: EMAIL, password: SENHA }) });
  let lb: any = {}; try { lb = JSON.parse(await lg.text()); } catch { /* */ }
  JWT = String(lb.access_token ?? lb.accessToken ?? lb.token ?? lb.jwt ?? "");
  if (!JWT) return json({ etapa: "login", status: lg.status }, 502);

  // lead_ids alvo, ainda ausentes em lev_leads
  let q = supa.from("lev_propostas").select("lead_id").not("lead_id", "is", null);
  if (somentePagas) q = q.eq("pago", true);
  const { data: props } = await q;
  const idsProp = [...new Set((props ?? []).map((x: any) => Number(x.lead_id)))];
  const { data: jaTem } = await supa.from("lev_leads").select("lead_id");
  const existentes = new Set((jaTem ?? []).map((x: any) => Number(x.lead_id)));
  const alvo = idsProp.filter((id) => !existentes.has(id)).slice(0, limite);

  if (!alvo.length) {
    return json({ ok: true, nota: "nenhum lead alvo pendente", total_lead_ids_com_proposta: idsProp.length, ja_no_banco: existentes.size });
  }

  let ok = 0, faltando = 0, erros: any[] = [];
  let rotaFunciona: boolean | null = null;
  for (const id of alvo) {
    const r = await fetch(`${DASH}/api/leads/${id}`, { headers: { authorization: `Bearer ${JWT}` } });
    const t = await r.text();
    if (rotaFunciona === null) rotaFunciona = r.status !== 404;
    if (r.status === 404) { faltando++; if (erros.length < 3) erros.push({ id, status: 404 }); continue; }
    if (!r.ok) { if (erros.length < 3) erros.push({ id, status: r.status, corpo: t.slice(0, 120) }); continue; }
    let l: any; try { l = JSON.parse(t); } catch { continue; }
    l = l?.data ?? l;
    if (!l || !l.id) continue;
    const partes = String(l.nome ?? "").trim().split(/\s+/);
    const row = {
      lead_id: Number(l.id), criado: ts(l.criado), atualizado: ts(l.updated_at),
      origem: l.origem ?? null, utm_source: l.utm_source ?? null, utm_medium: l.utm_medium ?? null,
      utm_campaign: l.utm_campaign != null ? String(l.utm_campaign) : null,
      utm_content: l.utm_content != null ? String(l.utm_content) : null,
      status: l.status ?? null, status_pipeline: l.status_pipeline ?? null,
      fase_contato: l.fase_contato ?? null, score_conversao: num(l.score_conversao),
      prioridade_score: l.prioridade_score ?? null,
      custo_aquisicao: num(l.custo_aquisicao), custo_total: num(l.custo_total),
      banco_escolhido: l.banco_escolhido ?? null,
      tentativas_ligacao: l.tentativas_ligacao != null ? Number(l.tentativas_ligacao) : null,
      ultima_interacao: ts(l.ultima_interacao), interesse_ativo: bool(l.interesse_ativo),
      autorizacao_lgpd: bool(l.autorizacao_lgpd), marketing_opt_out: bool(l.marketing_opt_out),
      is_test: bool(l.is_test),
      telefone_sha256: await hTel(l.telefone ?? l.telefone_informado),
      nome_sha256: await hTxt(partes[0]),
      sobrenome_sha256: partes.length > 1 ? await hTxt(partes[partes.length - 1]) : null,
      synced_at: new Date().toISOString(),
    };
    const { error } = await supa.from("lev_leads").upsert([row], { onConflict: "lead_id" });
    if (error) { if (erros.length < 3) erros.push({ id, upsert: error.message }); continue; }
    ok++;
  }

  return json({ ok: true, rota_individual_funciona: rotaFunciona,
    total_lead_ids_com_proposta: idsProp.length, tentados: alvo.length,
    gravados: ok, nao_encontrados_404: faltando, erros,
    dica: rotaFunciona === false ? "a rota /api/leads/:id nao existe - sera necessaria varredura paginada" : "rota individual OK" });
});
