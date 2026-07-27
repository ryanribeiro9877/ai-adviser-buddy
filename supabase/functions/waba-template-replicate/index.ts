// supabase/functions/waba-template-replicate/index.ts (v1) — F5.2
// Replicação de templates entre WABAs + watcher de aprovação.
// SEGURANÇA (reusa as 3 camadas do F4.2 em meta_execution_config):
//   dry_run=true (default) => apenas PLANEJA (grava status 'planejado'), NÃO chama a Meta.
//   real => exige master_enabled AND action_flags.replicar_template AND rate limit.
// Alvos: somente WABAs com número CONNECTED (v_waba_inventory.situacao='ativo') que
// NÃO possuem o template (v_waba_template_gap.tem_template=false).
// Fonte: template APPROVED lido da PRÓPRIA Meta (fidelidade de components).
//
// Ações (body.acao):
//   "plan"  (default) { template_name, language?, source_waba_id?, target_waba_ids?, limite? }
//   "watch"           resolve pendências: compara 'enviado' com o status atual na Meta,
//                     marca aprovado/rejeitado e gera alerta.
// Auth: x-mcp-key. Token: META_ADS_TOKEN (tem whatsapp_business_management) — redigido.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const TOKEN = (Deno.env.get("META_ADS_TOKEN") ?? Deno.env.get("WHATSAPP_ACCESS_TOKEN") ?? "").trim();
const GRAPH = "https://graph.facebook.com/v21.0";

const supa = createClient(SUPABASE_URL, SERVICE_ROLE, { auth: { persistSession: false } });
function redact(s: string): string {
  if (!TOKEN) return s;
  return s.split(TOKEN).join("[TOKEN-REDACTED]").replace(/access_token=[A-Za-z0-9]+/g, "access_token=[TOKEN-REDACTED]");
}
function json(obj: unknown, status = 200) {
  return new Response(redact(JSON.stringify(obj)), { status, headers: { "content-type": "application/json" } });
}
async function g(path: string, method = "GET", form?: Record<string, string>) {
  const params = new URLSearchParams({ ...(form ?? {}), access_token: TOKEN });
  const sep = path.includes("?") ? "&" : "?";
  const r = method === "GET"
    ? await fetch(`${GRAPH}${path}${sep}${params.toString()}`)
    : await fetch(`${GRAPH}${path}`, { method, body: params });
  const t = await r.text();
  try { return { status: r.status, body: JSON.parse(redact(t)) }; } catch { return { status: r.status, body: redact(t.slice(0, 300)) }; }
}
async function audit(companyId: string, userId: string | null, action: string, targetId: string, details: unknown) {
  await supa.from("audit_log").insert({
    company_id: companyId, user_id: userId, action, target_type: "waba_template_replication",
    target_id: targetId, details: JSON.parse(redact(JSON.stringify(details))),
  });
}
async function alerta(companyId: string, severity: string, title: string, description: string) {
  const { data: dup } = await supa.from("alerts").select("id")
    .eq("company_id", companyId).eq("title", title).eq("resolved", false).limit(1).maybeSingle();
  if (dup) return false;
  await supa.from("alerts").insert({ company_id: companyId, severity, title, description, resolved: false });
  return true;
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return json({ error: "POST only" }, 405);
  if (!TOKEN) return json({ error: "token Meta ausente" }, 500);
  const provided = (req.headers.get("x-mcp-key") ?? "").trim();
  const { data: cfg } = await supa.from("mcp_config").select("api_key").eq("id", 1).maybeSingle();
  if (!cfg?.api_key || provided !== cfg.api_key) return json({ error: "unauthorized" }, 401);

  const { data: comp } = await supa.from("companies").select("id").ilike("name", "%legal%").limit(1).maybeSingle();
  if (!comp) return json({ error: "empresa não encontrada" }, 500);
  const { data: adm } = await supa.from("user_roles").select("user_id").eq("role", "admin").limit(1).maybeSingle();
  const actor = adm?.user_id ?? null;

  let body: any = {}; try { body = await req.json(); } catch { /* */ }
  const acao = String(body?.acao ?? "plan");

  const { data: conf } = await supa.from("meta_execution_config").select("*").eq("id", 1).single();
  if (!conf) return json({ error: "meta_execution_config ausente" }, 500);

  // ---------------- WATCHER DE APROVAÇÃO ----------------
  if (acao === "watch") {
    const { data: pend } = await supa.from("waba_template_replications")
      .select("*").eq("status", "enviado").order("submitted_at").limit(50);
    if (!pend?.length) return json({ ok: true, acao, pendentes: 0, nota: "nenhuma replicação aguardando análise da Meta" });
    const res: any[] = [];
    for (const r of pend) {
      const q = await g(`/${r.target_waba_id}/message_templates?fields=name,language,status,category,rejected_reason&name=${encodeURIComponent(r.template_name)}&limit=50`);
      const hit = (q.body?.data ?? []).find((t: any) => t.name === r.template_name && t.language === r.language);
      if (!hit) { res.push({ id: r.id, template: r.template_name, estado: "ainda não visível na Meta" }); continue; }
      const st = String(hit.status ?? "").toUpperCase();
      if (st === "APPROVED" || st === "REJECTED") {
        const novo = st === "APPROVED" ? "aprovado" : "rejeitado";
        await supa.from("waba_template_replications").update({
          status: novo, resolved_at: new Date().toISOString(),
          rejected_reason: hit.rejected_reason ?? null, meta_response: hit,
        }).eq("id", r.id);
        await audit(r.company_id, actor, `waba_template_${novo}`, r.id, { template: r.template_name, waba: r.target_waba_id, meta: hit });
        if (novo === "rejeitado") {
          await alerta(r.company_id, "high",
            `[WABA] Template REJEITADO: ${r.template_name} (${r.target_waba_id})`,
            `Motivo da Meta: ${hit.rejected_reason ?? "não informado"}. Ação: revisar o conteúdo (guardião de compliance) e reenviar.`);
        }
        res.push({ id: r.id, template: r.template_name, estado: novo, motivo: hit.rejected_reason ?? null });
      } else {
        res.push({ id: r.id, template: r.template_name, estado: `em análise (${st})` });
      }
    }
    return json({ ok: true, acao, pendentes: pend.length, resultados: res });
  }

  // ---------------- PLANEJAR / EXECUTAR REPLICAÇÃO ----------------
  const templateName = String(body?.template_name ?? "").trim();
  const language = String(body?.language ?? "pt_BR").trim();
  const limite = Math.max(1, Math.min(Number(body?.limite ?? 5), 20));
  if (!templateName) return json({ error: "template_name obrigatório" }, 400);

  // 1) fonte: WABA que possui o template APPROVED
  let sourceWaba = String(body?.source_waba_id ?? "").trim();
  if (!sourceWaba) {
    const { data: src } = await supa.from("waba_templates").select("waba_external_id")
      .eq("name", templateName).eq("language", language).eq("status", "APPROVED").limit(1).maybeSingle();
    if (!src) return json({ error: `nenhuma WABA possui '${templateName}' (${language}) APPROVED — nada a replicar` }, 400);
    sourceWaba = src.waba_external_id;
  }
  // 2) components lidos da PRÓPRIA Meta (fonte de verdade)
  const srcQ = await g(`/${sourceWaba}/message_templates?fields=name,language,status,category,components&name=${encodeURIComponent(templateName)}&limit=50`);
  const srcT = (srcQ.body?.data ?? []).find((t: any) => t.name === templateName && t.language === language && String(t.status).toUpperCase() === "APPROVED");
  if (!srcT) return json({ error: "template de origem não lido na Meta", detalhe: srcQ.body }, 502);

  // 3) alvos: WABAs ATIVAS sem o template
  let alvos: string[] = Array.isArray(body?.target_waba_ids) ? body.target_waba_ids.map(String) : [];
  if (!alvos.length) {
    const { data: gap } = await supa.from("v_waba_template_gap")
      .select("waba_id,waba_nome").eq("template_nome", templateName).eq("idioma", language).eq("tem_template", false);
    alvos = (gap ?? []).map((r: any) => r.waba_id);
  }
  alvos = alvos.filter((a) => a !== sourceWaba).slice(0, limite);
  if (!alvos.length) return json({ ok: true, nota: "nenhum alvo elegível (todas as WABAs ativas já têm o template)", template: templateName });

  // rate limit: envios REAIS na última hora
  const { count: naHora } = await supa.from("waba_template_replications")
    .select("id", { count: "exact", head: true })
    .eq("dry_run", false).gte("submitted_at", new Date(Date.now() - 3600e3).toISOString());
  let enviadosHora = naHora ?? 0;

  const flagsOk = conf.master_enabled === true && conf.action_flags?.replicar_template === true;
  const modoReal = conf.dry_run === false && flagsOk;

  const resultados: any[] = [];
  for (const alvo of alvos) {
    const base = {
      company_id: comp.id, source_waba_id: sourceWaba, target_waba_id: alvo,
      template_name: templateName, language, category: srcT.category ?? null,
      components: srcT.components ?? null, requested_by: actor,
    };

    if (!modoReal) {
      const motivo = conf.dry_run !== false ? "dry_run=true"
        : (!conf.master_enabled ? "master_enabled=false" : "flag replicar_template=false");
      const { data: ins } = await supa.from("waba_template_replications")
        .insert({ ...base, status: "planejado", dry_run: true }).select("id").single();
      await audit(comp.id, actor, "waba_template_replication_planned", ins?.id ?? "-", { ...base, components: "(omitido)", motivo_nao_executou: motivo });
      resultados.push({ alvo, resultado: "PLANEJADO (nada enviado à Meta)", motivo });
      continue;
    }
    if (enviadosHora >= conf.max_actions_per_hour) {
      resultados.push({ alvo, resultado: "bloqueado", motivo: `rate limit ${conf.max_actions_per_hour}/h atingido` });
      continue;
    }
    // envio REAL
    const post = await g(`/${alvo}/message_templates`, "POST", {
      name: templateName, language, category: String(srcT.category ?? "UTILITY"),
      components: JSON.stringify(srcT.components ?? []),
    });
    const ok = post.status === 200 && post.body?.id;
    const { data: ins } = await supa.from("waba_template_replications").insert({
      ...base, status: ok ? "enviado" : "falhou", dry_run: false,
      meta_template_id: ok ? String(post.body.id) : null, meta_response: post.body,
      submitted_at: new Date().toISOString(),
      resolved_at: ok ? null : new Date().toISOString(),
    }).select("id").single();
    await audit(comp.id, actor, ok ? "waba_template_replication_sent" : "waba_template_replication_failed",
      ins?.id ?? "-", { template: templateName, alvo, resposta_meta: post.body });
    if (ok) enviadosHora++;
    resultados.push({ alvo, resultado: ok ? "ENVIADO (aguarda análise da Meta)" : "falha", meta: post.body });
  }

  return json({ ok: true, acao: "plan", modo: modoReal ? "REAL" : "DRY-RUN",
    template: templateName, idioma: language, categoria: srcT.category,
    origem: sourceWaba, alvos_processados: resultados.length, resultados,
    config: { master: conf.master_enabled, dry_run: conf.dry_run, flag_replicar: conf.action_flags?.replicar_template === true, max_por_hora: conf.max_actions_per_hour },
    proximo_passo: modoReal ? "rodar acao='watch' após alguns minutos para resolver aprovação" : "revisar o plano; para executar de verdade: ligar master + flag replicar_template + dry_run=false" });
});
