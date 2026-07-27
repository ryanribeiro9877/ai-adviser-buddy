// supabase/functions/meta-campaign-status/index.ts (v2)
// v2: varre TODAS as contas de anuncios de public.integrations (nao so a da Legal).
// Motivo: 9 campanhas de outra conta (946388181625874) seguiam marcadas como 'active' e
// inflavam a contagem que o agente reporta. Para contas que o token nao acessa, aplica
// regra de INATIVIDADE (sem gasto ha mais de 45 dias => paused) e reporta isso como
// inferencia, nao como status oficial da Meta.
// SOMENTE leitura na Meta + UPDATE local. Auth: x-mcp-key.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const TOKEN = (Deno.env.get("META_ADS_TOKEN") ?? "").trim();
const GRAPH = "https://graph.facebook.com/v21.0";
const supa = createClient(SUPABASE_URL, SERVICE_ROLE, { auth: { persistSession: false } });
function redact(s: string) {
  if (!TOKEN) return s;
  return s.split(TOKEN).join("[TOKEN-REDACTED]").replace(/access_token=[A-Za-z0-9]+/g, "access_token=[TOKEN-REDACTED]");
}
function json(o: unknown, st = 200) {
  return new Response(redact(JSON.stringify(o)), { status: st, headers: { "content-type": "application/json" } });
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return json({ error: "POST only" }, 405);
  if (!TOKEN) return json({ error: "META_ADS_TOKEN ausente" }, 500);
  const prov = (req.headers.get("x-mcp-key") ?? "").trim();
  const { data: cfg } = await supa.from("mcp_config").select("api_key").eq("id", 1).maybeSingle();
  if (!cfg?.api_key || prov !== cfg.api_key) return json({ error: "unauthorized" }, 401);

  const { data: integs } = await supa.from("integrations")
    .select("external_id, account_name").eq("provider", "meta_ads");
  const contas = [...new Set((integs ?? []).map((i: any) => String(i.external_id)).filter(Boolean))];

  const reais = new Map<string, string>();      // campaign_id -> effective_status
  const acessiveis: string[] = [];
  const inacessiveis: string[] = [];

  for (const c of contas) {
    let url = `${GRAPH}/act_${c}/campaigns?fields=name,effective_status&limit=200&access_token=${encodeURIComponent(TOKEN)}`;
    let pag = 0, okConta = false;
    while (url && pag < 5) {
      const r = await fetch(url);
      const t = await r.text();
      if (!r.ok) break;
      let p: any; try { p = JSON.parse(t); } catch { break; }
      okConta = true;
      for (const x of p?.data ?? []) reais.set(String(x.id), String(x.effective_status ?? ""));
      url = p?.paging?.next ?? "";
      pag++;
    }
    (okConta ? acessiveis : inacessiveis).push(c);
  }

  const { data: locais } = await supa.from("campaigns")
    .select("id, external_id, name, status, external_account_id").eq("provider", "meta_ads");

  const corrigidas: any[] = [];
  const porInatividade: any[] = [];
  let iguais = 0;

  for (const loc of locais ?? []) {
    const real = reais.get(String(loc.external_id));
    if (real) {
      const novo = real.toUpperCase() === "ACTIVE" ? "active" : "paused";
      if (novo === loc.status) { iguais++; continue; }
      await supa.from("campaigns").update({ status: novo }).eq("id", loc.id);
      corrigidas.push({ campanha: loc.name, de: loc.status, para: novo, fonte: "effective_status da Meta" });
      continue;
    }
    // sem correspondencia na Meta (conta inacessivel ou campanha removida)
    if (loc.status !== "active") { iguais++; continue; }
    const { data: ultimo } = await supa.from("metric_snapshots")
      .select("snapshot_date").eq("campaign_id", loc.id).gt("spend", 0)
      .order("snapshot_date", { ascending: false }).limit(1).maybeSingle();
    const dias = ultimo?.snapshot_date
      ? Math.floor((Date.now() - new Date(ultimo.snapshot_date).getTime()) / 864e5)
      : 9999;
    if (dias > 45) {
      await supa.from("campaigns").update({ status: "paused" }).eq("id", loc.id);
      porInatividade.push({ campanha: loc.name, conta: loc.external_account_id,
        dias_sem_gasto: dias === 9999 ? "nunca registrou gasto" : dias, fonte: "INFERENCIA por inatividade (>45d), nao status oficial" });
    } else { iguais++; }
  }

  const { count: ativasAgora } = await supa.from("campaigns")
    .select("id", { count: "exact", head: true }).eq("provider", "meta_ads").eq("status", "active");

  return json({ ok: true,
    contas_no_sistema: contas.length, contas_acessiveis: acessiveis.length, contas_inacessiveis: inacessiveis,
    campanhas_lidas_na_meta: reais.size,
    corrigidas_por_status_oficial: corrigidas.length, corrigidas,
    pausadas_por_inatividade: porInatividade.length, porInatividade,
    ja_corretas: iguais, ativas_apos_correcao: ativasAgora ?? null });
});
