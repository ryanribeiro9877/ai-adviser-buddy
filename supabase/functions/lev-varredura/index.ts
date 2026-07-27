// supabase/functions/lev-varredura/index.ts (v1)
// Varredura automatica e retomavel de /api/leads do Dash da Legal.
// Contexto: a API ignora ordenacao e filtro de data (11 variacoes testadas, mesmo resultado)
// e nao expoe /api/leads/:id. Logo, a unica forma de ter os 180.292 leads e varrer todas as
// paginas. Esta edge processa alguns lotes por execucao e guarda o progresso em
// public.lev_sync_state, de modo que um cron a complete sozinha.
// PII: telefone e nome apenas em SHA-256 normalizado. CPF nao e replicado.
// Body opcional: { lotes?: number (default 10) }. Auth: x-mcp-key.

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
function arrOf(p: any): any[] {
  if (Array.isArray(p)) return p;
  for (const k of ["data", "items", "results", "rows", "records"]) if (Array.isArray(p?.[k])) return p[k];
  return [];
}

Deno.serve(async (r_) => {
  if (r_.method !== "POST") return json({ error: "POST only" }, 405);
  const prov = (r_.headers.get("x-mcp-key") ?? "").trim();
  const { data: cfg } = await supa.from("mcp_config").select("api_key").eq("id", 1).maybeSingle();
  if (!cfg?.api_key || prov !== cfg.api_key) return json({ error: "unauthorized" }, 401);

  let body: any = {}; try { body = await r_.json(); } catch { /* */ }
  const lotes = Math.max(1, Math.min(Number(body?.lotes ?? 10), 20));

  const { data: st } = await supa.from("lev_sync_state").select("*").eq("id", 1).single();
  if (!st) return json({ error: "lev_sync_state ausente" }, 500);
  if (st.concluido) {
    const { count } = await supa.from("lev_leads").select("lead_id", { count: "exact", head: true });
    return json({ ok: true, concluido: true, nota: "varredura ja finalizada", leads_no_banco: count ?? null });
  }

  const lg = await fetch(`${DASH}/api/auth/login`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email: EMAIL, password: SENHA }) });
  let lb: any = {}; try { lb = JSON.parse(await lg.text()); } catch { /* */ }
  JWT = String(lb.access_token ?? lb.accessToken ?? lb.token ?? lb.jwt ?? "");
  if (!JWT) {
    await supa.from("lev_sync_state").update({ ultimo_erro: `login_${lg.status}`, atualizado: new Date().toISOString() }).eq("id", 1);
    return json({ etapa: "login", status: lg.status }, 502);
  }

  const tam = Number(st.tamanho) || 500;
  let pagina = Number(st.proxima_pagina) || 1;
  let gravados = 0, lidos = 0, concluido = false, erro: string | null = null, totalEsperado = st.total_esperado;
  let totalPaginas = st.total_paginas;

  for (let i = 0; i < lotes; i++) {
    const r = await fetch(`${DASH}/api/leads?page=${pagina}&limit=${tam}&perPage=${tam}`, { headers: { authorization: `Bearer ${JWT}` } });
    if (!r.ok) { erro = `http_${r.status}_pagina_${pagina}`; break; }
    let payload: any; try { payload = JSON.parse(await r.text()); } catch { erro = `json_invalido_pagina_${pagina}`; break; }
    if (payload?.total_count) {
      totalEsperado = Number(payload.total_count);
      totalPaginas = Math.ceil(totalEsperado / tam);
    }
    const a = arrOf(payload);
    if (!a.length) { concluido = true; break; }
    lidos += a.length;

    const rows: any[] = [];
    for (const l of a) {
      const id = Number(l.id);
      if (!Number.isFinite(id)) continue;
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
      if (error) { erro = `upsert_pagina_${pagina}: ${error.message}`; break; }
      gravados += rows.length;
    }
    pagina++;
    if (a.length < tam) { concluido = true; break; }
    if (totalPaginas && pagina > totalPaginas) { concluido = true; break; }
  }

  await supa.from("lev_sync_state").update({
    proxima_pagina: pagina,
    total_paginas: totalPaginas,
    total_esperado: totalEsperado,
    leads_gravados: Number(st.leads_gravados) + gravados,
    concluido,
    ultimo_erro: erro,
    atualizado: new Date().toISOString(),
  }).eq("id", 1);

  const { count } = await supa.from("lev_leads").select("lead_id", { count: "exact", head: true });
  return json({ ok: true, lotes_processados: lotes, paginas_lidas: lidos > 0 ? lotes : 0,
    registros_lidos: lidos, gravados, proxima_pagina: pagina, total_paginas: totalPaginas,
    concluido, ultimo_erro: erro, leads_no_banco: count ?? null,
    progresso_pct: totalPaginas ? Math.round(100 * (pagina - 1) / totalPaginas) : null });
});
