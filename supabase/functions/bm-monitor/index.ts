// supabase/functions/bm-monitor/index.ts (v1) — F4.4
// Monitor da BM/conta de anúncios (Legal é Viver): coleta via Graph API —
// (1) status da conta + motivo de desativação; (2) cobrança: balance (gasto não
// faturado), funding_source_details, spend_cap — NOTA/fallback: a Graph API não
// expõe status de fatura vencida diretamente; usamos account_status=3 (UNSETTLED)
// como sinal de cobrança pendente e documentamos conferência manual no Gerenciador
// de Pagamentos para casos ambíguos; (3) anúncios com effective_status DISAPPROVED
// + ad_review_feedback; (4) issues_info de campanhas ativas.
// Grava em public.alerts com DEDUP por título (não recria alerta idêntico não resolvido).
// Severidade: critical = conta desativada/unsettled ou anúncio reprovado; high = issues.
// Body: {} = coleta real | { teste: true } = injeta alerta sintético [TESTE] p/ validar fluxo.
// Auth: x-mcp-key. Token: META_ADS_TOKEN (redigido). Cron diário recomendado 09:20 UTC.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const TOKEN = (Deno.env.get("META_ADS_TOKEN") ?? "").trim();
const AD_ACCOUNT = "act_3302001729967572";
const GRAPH = "https://graph.facebook.com/v21.0";

const supa = createClient(SUPABASE_URL, SERVICE_ROLE, { auth: { persistSession: false } });
function redact(s: string): string {
  if (!TOKEN) return s;
  return s.split(TOKEN).join("[TOKEN-REDACTED]").replace(/access_token=[A-Za-z0-9]+/g, "access_token=[TOKEN-REDACTED]");
}
function json(obj: unknown, status = 200) {
  return new Response(redact(JSON.stringify(obj)), { status, headers: { "content-type": "application/json" } });
}
async function g(path: string) {
  const sep = path.includes("?") ? "&" : "?";
  const r = await fetch(`${GRAPH}${path}${sep}access_token=${encodeURIComponent(TOKEN)}`);
  const t = await r.text();
  try { return { status: r.status, body: JSON.parse(redact(t)) }; } catch { return { status: r.status, body: redact(t.slice(0, 300)) }; }
}
const STATUS_LABEL: Record<number, string> = { 1: "ATIVA", 2: "DESATIVADA", 3: "UNSETTLED (cobrança pendente)", 7: "PENDING_RISK_REVIEW", 8: "PENDING_SETTLEMENT", 9: "IN_GRACE_PERIOD", 100: "PENDING_CLOSURE", 101: "FECHADA", 201: "ANY_ACTIVE", 202: "ANY_CLOSED" };

async function upsertAlert(companyId: string, severity: string, title: string, description: string) {
  const { data: dup } = await supa.from("alerts").select("id").eq("company_id", companyId).eq("title", title).eq("resolved", false).limit(1).maybeSingle();
  if (dup) return { created: false, motivo: "dedup: alerta idêntico já ativo" };
  const { error } = await supa.from("alerts").insert({ company_id: companyId, severity, title, description, resolved: false });
  return error ? { created: false, motivo: error.message } : { created: true };
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return json({ error: "POST only" }, 405);
  if (!TOKEN) return json({ error: "META_ADS_TOKEN ausente" }, 500);
  const provided = (req.headers.get("x-mcp-key") ?? "").trim();
  const { data: cfg } = await supa.from("mcp_config").select("api_key").eq("id", 1).maybeSingle();
  if (!cfg?.api_key || provided !== cfg.api_key) return json({ error: "unauthorized" }, 401);

  const { data: comp } = await supa.from("companies").select("id").ilike("name", "%legal%").limit(1).maybeSingle();
  if (!comp) return json({ error: "empresa não encontrada" }, 500);

  let body: any = {}; try { body = await req.json(); } catch { /* */ }
  if (body?.teste === true) {
    const r = await upsertAlert(comp.id, "critical",
      "[BM][TESTE] Conta de anúncios desativada (simulação)",
      "Alerta SINTÉTICO do bm-monitor para validar o fluxo critical → tela/chat. Resolver após o teste; nenhuma condição real detectada.");
    return json({ ok: true, modo: "TESTE", alerta: r });
  }

  const criados: any[] = [];
  // 1) conta + cobrança
  const conta = await g(`/${AD_ACCOUNT}?fields=name,account_status,disable_reason,balance,currency,funding_source_details,spend_cap,amount_spent`);
  const st = Number(conta.body?.account_status ?? 0);
  if (conta.status !== 200) {
    criados.push(await upsertAlert(comp.id, "critical", "[BM] Falha ao consultar a conta de anúncios",
      `bm-monitor não conseguiu ler ${AD_ACCOUNT} (HTTP ${conta.status}). Verificar token/permissões.`));
  } else if (st !== 1) {
    criados.push(await upsertAlert(comp.id, "critical",
      `[BM] Conta de anúncios: ${STATUS_LABEL[st] ?? "status " + st}`,
      `account_status=${st}${conta.body?.disable_reason ? ", disable_reason=" + conta.body.disable_reason : ""}. Ação: abrir Gerenciador de Pagamentos/Qualidade da Conta imediatamente.`));
  }
  const balanceCent = Number(conta.body?.balance ?? 0);
  // 2) anúncios reprovados (análise da Meta)
  const ads = await g(`/${AD_ACCOUNT}/ads?fields=name,effective_status,ad_review_feedback&limit=200`);
  const reprovados = (ads.body?.data ?? []).filter((a: any) => a.effective_status === "DISAPPROVED");
  for (const ad of reprovados.slice(0, 10)) {
    const fb = ad.ad_review_feedback?.global ? JSON.stringify(ad.ad_review_feedback.global).slice(0, 300) : "sem detalhe da Meta";
    criados.push(await upsertAlert(comp.id, "critical",
      `[BM] Anúncio REPROVADO pela Meta: ${String(ad.name).slice(0, 80)}`,
      `Feedback da revisão: ${fb}. Ação: corrigir o criativo/legenda (use o guardião de compliance) e reenviar, ou contestar a decisão.`));
  }
  // 3) issues de campanhas
  const camps = await g(`/${AD_ACCOUNT}/campaigns?fields=name,effective_status,issues_info&limit=100`);
  const comIssues = (camps.body?.data ?? []).filter((c: any) => Array.isArray(c.issues_info) && c.issues_info.length);
  for (const c of comIssues.slice(0, 10)) {
    const i = c.issues_info[0];
    criados.push(await upsertAlert(comp.id, "high",
      `[BM] Campanha com problema: ${String(c.name).slice(0, 80)}`,
      `${i.error_summary ?? i.error_type ?? "issue"}: ${String(i.error_message ?? "").slice(0, 250)}`));
  }

  return json({ ok: true, modo: "COLETA",
    conta: { status: st, label: STATUS_LABEL[st] ?? st, saldo_nao_faturado: conta.body?.currency + " " + (balanceCent / 100).toFixed(2), funding: conta.body?.funding_source_details?.display_string ?? null },
    anuncios_reprovados: reprovados.length, campanhas_com_issues: comIssues.length,
    alertas: criados,
    nota_fallback_cobranca: "Graph não expõe fatura vencida diretamente; sinal usado é account_status=3 (UNSETTLED). Conferir Gerenciador de Pagamentos em caso ambíguo." });
});
