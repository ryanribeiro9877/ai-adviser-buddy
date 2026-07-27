// supabase/functions/dash-lev-sync/index.ts (v3) - INGESTAO com varredura controlada
// v3: descobrimos que /api/leads NAO vem ordenado por data (pagina 1 traz mar-jul misturados).
//   Mudancas:
//   - acao="sondar": testa parametros de ordenacao/filtro na API para achar um jeito de
//     pedir apenas o recorte recente (sort/order/data_inicio/from/updated_since...).
//   - pagina_inicial: permite continuar a varredura de onde parou (varias execucoes).
//   - desde agora FILTRA o que gravar (nao interrompe mais a paginacao).
// PII: telefone e nome gravados apenas como SHA-256 normalizado. CPF nao e replicado.
// Auth: x-mcp-key.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const DASH = "https://dash.legaleviver.com.br";
const EMAIL = (Deno.env.get("DASH_LEV_EMAIL") ?? "").trim();
const SENHA = (Deno.env.get("DASH_LEV_PASSWORD") ?? "").trim();

const supa = createClient(SUPABASE_URL, SERVICE_ROLE, { auth: { persistSession: false } });
let JWT = "";
function redact(s: string): string {
  let o = s;
  if (SENHA) o = o.split(SENHA).join("[SENHA-REDACTED]");
  if (JWT) o = o.split(JWT).join("[JWT-REDACTED]");
  return o;
}
function json(obj: unknown, status = 200) {
  return new Response(redact(JSON.stringify(obj)), { status, headers: { "content-type": "application/json" } });
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

async function req(path: string) {
  const r = await fetch(`${DASH}${path}`, { headers: { "content-type": "application/json", ...(JWT ? { authorization: `Bearer ${JWT}` } : {}) } });
  const t = await r.text();
  let b: any = null; try { b = JSON.parse(t); } catch { b = t.slice(0, 150); }
  return { status: r.status, body: b };
}
function arr(p: any): any[] {
  if (Array.isArray(p)) return p;
  for (const k of ["data", "items", "results", "rows", "records"]) if (Array.isArray(p?.[k])) return p[k];
  return [];
}

Deno.serve(async (r_) => {
  if (r_.method !== "POST") return json({ error: "POST only" }, 405);
  const prov = (r_.headers.get("x-mcp-key") ?? "").trim();
  const { data: cfg } = await supa.from("mcp_config").select("api_key").eq("id", 1).maybeSingle();
  if (!cfg?.api_key || prov !== cfg.api_key) return json({ error: "unauthorized" }, 401);
  if (!EMAIL || !SENHA) return json({ error: "credenciais ausentes" }, 500);

  let body: any = {}; try { body = await r_.json(); } catch { /* */ }
  const acao = String(body?.acao ?? "leads");
  const maxPag = Math.max(1, Math.min(Number(body?.paginas ?? 20), 60));
  const tam = Math.max(20, Math.min(Number(body?.tamanho ?? 300), 500));
  const pagIni = Math.max(1, Number(body?.pagina_inicial ?? 1));
  const desde = body?.desde ? new Date(String(body.desde)).getTime() : null;

  const lg = await fetch(`${DASH}/api/auth/login`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email: EMAIL, password: SENHA }) });
  let lb: any = {}; try { lb = JSON.parse(await lg.text()); } catch { /* */ }
  JWT = String(lb.access_token ?? lb.accessToken ?? lb.token ?? lb.jwt ?? "");
  if (!JWT) return json({ etapa: "login", status: lg.status }, 502);

  // ---------- SONDAR PARAMETROS ----------
  if (acao === "sondar") {
    const tentativas = [
      "/api/leads?limit=3",
      "/api/leads?limit=3&sort=criado&order=desc",
      "/api/leads?limit=3&sortBy=criado&sortOrder=DESC",
      "/api/leads?limit=3&orderBy=criado&order=DESC",
      "/api/leads?limit=3&order=-criado",
      "/api/leads?limit=3&data_inicio=2026-07-01",
      "/api/leads?limit=3&from=2026-07-01",
      "/api/leads?limit=3&start_date=2026-07-01",
      "/api/leads?limit=3&criado_gte=2026-07-01",
      "/api/leads?limit=3&updated_since=2026-07-01",
      "/api/leads?limit=3&search=",
    ];
    const res: any[] = [];
    for (const t of tentativas) {
      const r = await req(t);
      const a = arr(r.body);
      const datas = a.map((x: any) => String(x.criado ?? "").slice(0, 10));
      res.push({ query: t.replace("/api/leads?", ""), status: r.status, devolveu: a.length,
        datas, total_count: r.body?.total_count ?? r.body?.total ?? null });
    }
    return json({ ok: true, acao, nota: "compare 'datas': se algum parametro mudar a ordem/recorte, ele funciona", resultados: res });
  }

  // ---------- PROPOSTAS ----------
  if (acao === "propostas") {
    let p = pagIni, grav = 0, lidas = 0, parou = "limite_paginas";
    while (p < pagIni + maxPag) {
      const r = await req(`/api/propostas?page=${p}&limit=${tam}&perPage=${tam}`);
      if (r.status !== 200) { parou = `http_${r.status}`; break; }
      const a = arr(r.body);
      if (!a.length) { parou = "fim"; break; }
      lidas += a.length;
      const rows = a.map((x: any) => ({
        proposta_id: Number(x.id), lead_id: x.lead_id != null ? Number(x.lead_id) : null,
        criado: ts(x.criado), atualizado: ts(x.atualizado), banco: x.banco ?? null,
        status_proposta: x.status_proposta ?? null,
        valor_financiado: num(x.valor_financiado), valor_liquido: num(x.valor_liquido),
        valor_parcela: num(x.valor_parcela), prazo: x.prazo != null ? Number(x.prazo) : null,
        pago: bool(x.pago), assinatura_iniciada: bool(x.assinatura_iniciada),
        assinatura_concluida: bool(x.assinatura_concluida),
        contract_number: x.contract_number != null ? String(x.contract_number) : null,
        synced_at: new Date().toISOString(),
      })).filter((x) => Number.isFinite(x.proposta_id));
      if (rows.length) {
        const { error } = await supa.from("lev_propostas").upsert(rows, { onConflict: "proposta_id" });
        if (error) { parou = `upsert:${error.message}`; break; }
        grav += rows.length;
      }
      if (a.length < tam) { parou = "ultima_pagina"; break; }
      p++;
    }
    return json({ ok: true, acao, pagina_inicial: pagIni, ultima_pagina_lida: p, lidas, gravados: grav, parou_por: parou });
  }

  // ---------- LEADS ----------
  let p = pagIni, grav = 0, lidas = 0, ignorados = 0, parou = "limite_paginas";
  let maisAntigo = "", maisRecente = "";
  while (p < pagIni + maxPag) {
    const r = await req(`/api/leads?page=${p}&limit=${tam}&perPage=${tam}`);
    if (r.status !== 200) { parou = `http_${r.status}`; break; }
    const a = arr(r.body);
    if (!a.length) { parou = "fim"; break; }
    lidas += a.length;
    const rows: any[] = [];
    for (const l of a) {
      const id = Number(l.id);
      if (!Number.isFinite(id)) continue;
      const c = String(l.criado ?? "");
      if (c) { if (!maisAntigo || c < maisAntigo) maisAntigo = c; if (c > maisRecente) maisRecente = c; }
      if (desde && c && new Date(c).getTime() < desde) { ignorados++; continue; }
      const partes = String(l.nome ?? "").trim().split(/\s+/);
      rows.push({
        lead_id: id, criado: ts(l.criado), atualizado: ts(l.updated_at),
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
      });
    }
    if (rows.length) {
      const { error } = await supa.from("lev_leads").upsert(rows, { onConflict: "lead_id" });
      if (error) { parou = `upsert:${error.message}`; break; }
      grav += rows.length;
    }
    if (a.length < tam) { parou = "ultima_pagina"; break; }
    p++;
  }
  return json({ ok: true, acao: "leads", pagina_inicial: pagIni, ultima_pagina_lida: p,
    lidas, gravados: grav, ignorados_por_data: ignorados, parou_por: parou,
    janela_vista: { mais_antigo: maisAntigo.slice(0, 10), mais_recente: maisRecente.slice(0, 10) },
    privacidade: "telefone/nome apenas em SHA-256; CPF nao replicado" });
});
