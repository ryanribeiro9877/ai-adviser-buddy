// supabase/functions/meta-actions/index.ts (v1) — F4.2
// Executor da fila de aprovações: consome approval_requests (status=approved, não
// executados), valida as 3 CAMADAS (master_enabled + flag da ação + rate limit) e o
// modo dry_run de meta_execution_config, e executa na Meta Graph API.
// - dry_run=true (default): LÊ o estado atual e AUDITA o que faria — não escreve,
//   não marca executed_at. Avalia e reporta as flags, mas não exige que estejam ON.
// - real (dry_run=false): exige master + flag da ação + rate; GET antes → POST → GET
//   depois; audit 'meta_action_executed'; executed_at + execution_result no pedido.
// Ações executáveis: pausar_criativo, pausar_campanha, alterar_orcamento (budget de
// campanha). escalar_criativo NÃO é automatizado (pulado com nota — decisão manual).
// Token: META_ADS_TOKEN (redigido de qualquer saída). Auth: x-mcp-key.
// Body opcional: { approval_id?: uuid } para processar um pedido específico.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const TOKEN = (Deno.env.get("META_ADS_TOKEN") ?? "").trim();
const GRAPH = "https://graph.facebook.com/v21.0";
const EXECUTAVEIS = ["pausar_criativo", "pausar_campanha", "alterar_orcamento"];

const supa = createClient(SUPABASE_URL, SERVICE_ROLE, { auth: { persistSession: false } });
function redact(s: string): string {
  if (!TOKEN) return s;
  return s.split(TOKEN).join("[TOKEN-REDACTED]").replace(/access_token=[A-Za-z0-9]+/g, "access_token=[TOKEN-REDACTED]");
}
function json(obj: unknown, status = 200) {
  return new Response(redact(JSON.stringify(obj)), { status, headers: { "content-type": "application/json" } });
}
async function g(path: string, method = "GET", body?: Record<string, string>) {
  const form = new URLSearchParams({ ...(body ?? {}), access_token: TOKEN });
  const sep = path.includes("?") ? "&" : "?";
  const r = method === "GET"
    ? await fetch(`${GRAPH}${path}${sep}${form.toString()}`)
    : await fetch(`${GRAPH}${path}`, { method, body: form });
  const t = await r.text();
  try { return { status: r.status, body: JSON.parse(redact(t)) }; } catch { return { status: r.status, body: redact(t.slice(0, 300)) }; }
}
async function audit(companyId: string, userId: string, action: string, approvalId: string, details: unknown) {
  await supa.from("audit_log").insert({
    company_id: companyId, user_id: userId, action, target_type: "approval_request", target_id: approvalId,
    details: JSON.parse(redact(JSON.stringify(details))),
  });
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return json({ error: "POST only" }, 405);
  if (!TOKEN) return json({ error: "META_ADS_TOKEN ausente" }, 500);
  const provided = (req.headers.get("x-mcp-key") ?? "").trim();
  const { data: cfg } = await supa.from("mcp_config").select("api_key").eq("id", 1).maybeSingle();
  if (!cfg?.api_key || provided !== cfg.api_key) return json({ error: "unauthorized" }, 401);

  let body: any = {}; try { body = await req.json(); } catch { /* */ }
  const onlyId: string | null = body?.approval_id ?? null;

  const { data: conf } = await supa.from("meta_execution_config").select("*").eq("id", 1).single();
  if (!conf) return json({ error: "meta_execution_config ausente" }, 500);

  let q = supa.from("approval_requests").select("*").eq("status", "approved").is("executed_at", null);
  if (onlyId) q = q.eq("id", onlyId);
  const { data: fila } = await q.order("created_at", { ascending: true }).limit(10);
  if (!fila?.length) return json({ ok: true, processados: 0, nota: "fila vazia (nenhum aprovado pendente de execução)", config: { master: conf.master_enabled, dry_run: conf.dry_run } });

  // rate limit: execuções REAIS na última hora
  const { count: naHora } = await supa.from("audit_log")
    .select("id", { count: "exact", head: true })
    .eq("action", "meta_action_executed")
    .gte("created_at", new Date(Date.now() - 3600e3).toISOString());
  let executadasNaHora = naHora ?? 0;

  const resultados: any[] = [];
  for (const r of fila) {
    const acao = String(r.action);
    const alvoExt = String(r.payload?.target_external_id ?? "");
    const alvoNome = String(r.payload?.target_name ?? r.summary);
    const sistema = r.reviewed_by ?? r.requested_by;

    if (!EXECUTAVEIS.includes(acao)) {
      resultados.push({ id: r.id, acao, resultado: "pulado", motivo: "ação não automatizada (decisão manual)" });
      continue;
    }
    if (!alvoExt) {
      resultados.push({ id: r.id, acao, resultado: "falha", motivo: "payload sem target_external_id" });
      await audit(r.company_id, sistema, "meta_action_failed", r.id, { motivo: "sem target_external_id", acao });
      continue;
    }

    // estado atual na Meta (sempre, inclusive dry-run)
    const antes = await g(`/${alvoExt}?fields=name,status,effective_status,daily_budget`);
    const flagsOk = conf.master_enabled === true && conf.action_flags?.[acao] === true;
    const rateOk = executadasNaHora < conf.max_actions_per_hour;

    // monta a chamada
    let post: Record<string, string> | null = null;
    if (acao === "pausar_criativo" || acao === "pausar_campanha") post = { status: "PAUSED" };
    if (acao === "alterar_orcamento") {
      const reais = Number(r.payload?.novo_orcamento_diario_reais ?? 0);
      if (!(reais > 0)) {
        resultados.push({ id: r.id, acao, resultado: "falha", motivo: "novo_orcamento_diario_reais ausente/inválido" });
        await audit(r.company_id, sistema, "meta_action_failed", r.id, { motivo: "orcamento invalido", payload: r.payload });
        continue;
      }
      post = { daily_budget: String(Math.round(reais * 100)) }; // centavos
    }

    if (conf.dry_run) {
      await audit(r.company_id, sistema, "meta_action_dry_run", r.id, {
        SIMULADO: true, acao, alvo: alvoNome, alvo_external_id: alvoExt,
        chamaria: post, estado_atual_meta: antes.body,
        flags_permitiriam: { master: conf.master_enabled, flag_acao: conf.action_flags?.[acao] === true, rate_ok: rateOk },
        nota: "dry_run=true: NADA foi enviado à Meta; executed_at NÃO preenchido",
      });
      resultados.push({ id: r.id, acao, alvo: alvoNome, resultado: "SIMULADO", chamaria: post, estado_atual: antes.body?.status, flags_permitiriam: flagsOk && rateOk });
      continue;
    }

    // modo REAL: 3 camadas obrigatórias
    if (!flagsOk || !rateOk) {
      const motivo = !conf.master_enabled ? "master_enabled=false" : (conf.action_flags?.[acao] !== true ? `flag ${acao}=false` : "rate limit atingido");
      await audit(r.company_id, sistema, "meta_action_blocked", r.id, { motivo, acao, alvo: alvoNome });
      resultados.push({ id: r.id, acao, alvo: alvoNome, resultado: "bloqueado", motivo });
      continue;
    }
    const exec = await g(`/${alvoExt}`, "POST", post!);
    const depois = await g(`/${alvoExt}?fields=name,status,effective_status,daily_budget`);
    const sucesso = exec.status === 200;
    await audit(r.company_id, sistema, sucesso ? "meta_action_executed" : "meta_action_failed", r.id, {
      acao, alvo: alvoNome, alvo_external_id: alvoExt, chamada: post, resposta_meta: exec, antes: antes.body, depois: depois.body,
    });
    if (sucesso) {
      executadasNaHora++;
      await supa.from("approval_requests").update({
        executed_at: new Date().toISOString(),
        execution_result: { ok: true, antes: antes.body, depois: depois.body },
      }).eq("id", r.id);
    }
    resultados.push({ id: r.id, acao, alvo: alvoNome, resultado: sucesso ? "EXECUTADO" : "falha_meta", antes: antes.body?.status, depois: depois.body?.status });
  }

  return json({ ok: true, modo: conf.dry_run ? "DRY-RUN" : "REAL", processados: resultados.length, resultados,
    config: { master: conf.master_enabled, dry_run: conf.dry_run, flags: conf.action_flags, max_por_hora: conf.max_actions_per_hour } });
});
