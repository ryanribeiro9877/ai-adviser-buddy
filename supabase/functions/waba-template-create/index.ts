// supabase/functions/waba-template-create/index.ts (create-v1) — F5.3
// CRIAÇÃO de templates com inteligência de categoria (UTILITY R$0,06 vs MARKETING R$0,45).
// Clona o padrão provado da waba-template-replicate (auth, 3 camadas de flag, dry_run,
// tabela de planos, watcher), acrescentando:
//   REDATOR: LLM (OpenRouter) escreve o template a partir de um objetivo em linguagem de
//     negócio, sob REGRAS DE CATEGORIA embutidas (v1 só cria UTILITY — mensagens ligadas a
//     uma interação/transação existente, sem linguagem promocional).
//   GUARDIÃO (bloqueante, fail-closed): (a) checks determinísticos de categoria no código
//     (termos promocionais, variáveis bem formadas, limites da Meta); (b) compliance-check
//     com o corpo como legenda — veredito ausente/ambíguo BLOQUEIA.
// Ações (body.acao):
//   "draft" (default) { objetivo, template_name, target_waba_ids[], language?, footer? }
//       -> redator + guardião; grava 'rascunho' ou 'reprovado_guardiao'. NUNCA submete.
//   "submit"          { creation_id } -> exige master + action_flags.criar_template +
//       dry_run=false (config POR EMPRESA — sem leitura de id=1) + rate limit; POST à Meta.
//   "watch"           resolve pendências 'enviado' (aprovado/rejeitado) + alerta em rejeição.
// Auth: x-mcp-key. Token: WHATSAPP_ACCESS_TOKEN somente (ESP-32 — sem fallback Ads).

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { chaveMcpDe, mcpKeyValida } from "../_shared/mcp_auth.ts";
import { bodyOpenRouter, resolverChamadaLlm } from "../_shared/llm_roteador.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const TOKEN = (Deno.env.get("WHATSAPP_ACCESS_TOKEN") ?? "").trim();
const OR_KEY = (Deno.env.get("OPENROUTER_API_KEY") ?? "").trim();
const GRAPH = "https://graph.facebook.com/v21.0";
const VERSAO = "create-v1";

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
    company_id: companyId, user_id: userId, action, target_type: "waba_template_creation",
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

// ---------------- GUARDIÃO camada A: regras determinísticas de UTILITY ----------------
const TERMOS_PROMO = [
  "promoção", "promocao", "desconto", "oferta", "imperdível", "imperdivel", "aproveite",
  "últimas", "ultimas", "grátis", "gratis", "ganhe", "só hoje", "so hoje", "corra",
  "não perca", "nao perca", "melhor taxa", "condições especiais", "condicoes especiais",
  "exclusivo para você", "liquidação", "liquidacao", "cupom", "bônus", "bonus",
];
function checarUtility(bodyText: string, nome: string): string[] {
  const erros: string[] = [];
  const low = bodyText.toLowerCase();
  for (const t of TERMOS_PROMO) if (low.includes(t)) erros.push(`termo promocional proibido em UTILITY: "${t}"`);
  if (!/^[a-z0-9_]{1,512}$/.test(nome)) erros.push("template_name inválido: use minúsculas, números e _ (padrão Meta)");
  if (bodyText.length > 1024) erros.push(`corpo com ${bodyText.length} chars (máx. 1024)`);
  const vars = [...bodyText.matchAll(/\{\{(\d+)\}\}/g)].map((m) => Number(m[1]));
  for (let i = 1; i <= vars.length; i++) if (!vars.includes(i)) { erros.push(`variáveis fora de sequência: esperado {{${i}}}`); break; }
  if ((bodyText.match(/\p{Extended_Pictographic}/gu) ?? []).length > 1) erros.push("mais de 1 emoji (UTILITY pede sobriedade)");
  if (!/\{\{1\}\}/.test(bodyText)) erros.push("sem {{1}} — UTILITY deve referenciar a interação da pessoa (nome/protocolo/pedido)");
  return erros;
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return json({ error: "POST only" }, 405);
  if (!TOKEN) return json({ error: "WHATSAPP_ACCESS_TOKEN ausente" }, 500);
  const auth = await mcpKeyValida(supa, chaveMcpDe(req, "header-only"));
  if (!auth.ok) return json({ error: "unauthorized", motivo: auth.motivo }, 401);
  const { data: cfg } = await supa.from("mcp_config").select("api_key").eq("id", 1).maybeSingle();
  if (!cfg?.api_key) return json({ error: "cascade_key_unavailable" }, 500);

  const { data: comp } = await supa.from("companies").select("id").ilike("name", "%legal%").limit(1).maybeSingle();
  if (!comp) return json({ error: "empresa não encontrada" }, 500);
  const { data: adm } = await supa.from("user_roles").select("user_id").eq("role", "admin").limit(1).maybeSingle();
  const actor = adm?.user_id ?? null;

  let body: any = {}; try { body = await req.json(); } catch { /* */ }
  const acao = String(body?.acao ?? "draft");

  // Config POR EMPRESA (nunca id=1 — lição do isolamento multi-tenant)
  const { data: conf } = await supa.from("meta_execution_config").select("*").eq("company_id", comp.id).single();
  if (!conf) return json({ error: "meta_execution_config da empresa ausente" }, 500);

  // ---------------- WATCHER ----------------
  if (acao === "watch") {
    const { data: pend } = await supa.from("waba_template_creations")
      .select("*").eq("status", "enviado").order("submitted_at").limit(50);
    if (!pend?.length) return json({ ok: true, versao: VERSAO, acao, pendentes: 0 });
    const res: any[] = [];
    for (const r of pend) {
      const q = await g(`/${r.target_waba_id}/message_templates?fields=name,language,status,category,rejected_reason&name=${encodeURIComponent(r.template_name)}&limit=50`);
      const hit = (q.body?.data ?? []).find((t: any) => t.name === r.template_name && t.language === r.language);
      if (!hit) { res.push({ id: r.id, template: r.template_name, estado: "ainda não visível na Meta" }); continue; }
      const st = String(hit.status ?? "").toUpperCase();
      if (st === "APPROVED" || st === "REJECTED") {
        const novo = st === "APPROVED" ? "aprovado" : "rejeitado";
        await supa.from("waba_template_creations").update({
          status: novo, resolved_at: new Date().toISOString(),
          rejected_reason: hit.rejected_reason ?? null, meta_response: hit,
        }).eq("id", r.id);
        await audit(r.company_id, actor, `waba_template_creation_${novo}`, r.id, { template: r.template_name, waba: r.target_waba_id, meta: hit });
        if (novo === "rejeitado") await alerta(r.company_id, "high",
          `[WABA] Template CRIADO foi rejeitado: ${r.template_name}`,
          `Motivo da Meta: ${hit.rejected_reason ?? "não informado"}. Revisar objetivo/corpo e gerar novo rascunho.`);
        res.push({ id: r.id, template: r.template_name, estado: novo, motivo: hit.rejected_reason ?? null });
      } else res.push({ id: r.id, template: r.template_name, estado: `em análise (${st})` });
    }
    return json({ ok: true, versao: VERSAO, acao, pendentes: pend.length, resultados: res });
  }

  // ---------------- SUBMIT (execução real, 3 camadas + rate limit) ----------------
  if (acao === "submit") {
    const cid = String(body?.creation_id ?? "").trim();
    if (!cid) return json({ error: "creation_id obrigatório" }, 400);
    const { data: c } = await supa.from("waba_template_creations").select("*").eq("id", cid).maybeSingle();
    if (!c) return json({ error: "rascunho não encontrado" }, 404);
    if (c.status !== "rascunho") return json({ error: `status atual é '${c.status}' — só 'rascunho' (aprovado pelo guardião) pode ser submetido` }, 400);

    const flagsOk = conf.master_enabled === true && conf.action_flags?.criar_template === true && conf.dry_run === false;
    if (!flagsOk) return json({ ok: false, versao: VERSAO, bloqueado: true,
      motivo: conf.dry_run !== false ? "dry_run=true" : (!conf.master_enabled ? "master_enabled=false" : "flag criar_template=false"),
      proximo_passo: "ligar master + flag criar_template + dry_run=false (janela curta) e repetir" });

    const { count: naHora } = await supa.from("waba_template_creations")
      .select("id", { count: "exact", head: true })
      .eq("dry_run", false).gte("submitted_at", new Date(Date.now() - 3600e3).toISOString());
    if ((naHora ?? 0) >= conf.max_actions_per_hour) return json({ ok: false, bloqueado: true, motivo: `rate limit ${conf.max_actions_per_hour}/h` });

    const comps = c.components ?? [];
    const post = await g(`/${c.target_waba_id}/message_templates`, "POST", {
      name: c.template_name, language: c.language, category: c.category,
      components: JSON.stringify(comps),
    });
    const ok = post.status === 200 && post.body?.id;
    await supa.from("waba_template_creations").update({
      status: ok ? "enviado" : "falhou", dry_run: false,
      meta_template_id: ok ? String(post.body.id) : null, meta_response: post.body,
      submitted_at: new Date().toISOString(), resolved_at: ok ? null : new Date().toISOString(),
    }).eq("id", cid);
    await audit(c.company_id, actor, ok ? "waba_template_creation_sent" : "waba_template_creation_failed", cid,
      { template: c.template_name, alvo: c.target_waba_id, resposta_meta: post.body });
    return json({ ok, versao: VERSAO, acao, template: c.template_name, alvo: c.target_waba_id,
      resultado: ok ? "ENVIADO (aguarda análise da Meta)" : "falha", meta: post.body,
      proximo_passo: ok ? "rodar acao='watch' após alguns minutos; FECHAR as flags" : "ler meta_response; FECHAR as flags" });
  }

  // ---------------- DRAFT (redator + guardião; nunca submete) ----------------
  const objetivo = String(body?.objetivo ?? "").trim();
  const nome = String(body?.template_name ?? "").trim().toLowerCase();
  const language = String(body?.language ?? "pt_BR").trim();
  const categoria = String(body?.category ?? "UTILITY").trim().toUpperCase();
  const alvos: string[] = Array.isArray(body?.target_waba_ids) ? body.target_waba_ids.map(String) : [];
  if (!objetivo) return json({ error: "objetivo obrigatório (o que o template deve comunicar, em linguagem de negócio)" }, 400);
  if (!nome) return json({ error: "template_name obrigatório (minúsculas_com_underscore)" }, 400);
  if (!alvos.length) return json({ error: "target_waba_ids obrigatório (array — criação não faz fan-out automático na v1)" }, 400);
  if (categoria !== "UTILITY") return json({ error: "v1 cria apenas UTILITY (economia R$0,06 vs R$0,45; MARKETING fora de escopo por decisão)" }, 400);
  if (!OR_KEY) return json({ error: "OPENROUTER_API_KEY ausente — redator indisponível" }, 500);

  // referência de estilo: um UTILITY aprovado da casa
  const { data: ref } = await supa.from("waba_templates").select("name,components")
    .eq("status", "APPROVED").eq("category", "UTILITY").not("components", "is", null).limit(1).maybeSingle();
  const refBody = (() => {
    try { return (ref?.components ?? []).find((x: any) => x.type === "BODY")?.text ?? ""; } catch { return ""; }
  })();

  // REDATOR
  const sys = `Você é redator de templates de WhatsApp Business para uma empresa de crédito consignado (Brasil).
Escreva UM template da categoria UTILITY seguindo as regras da Meta À RISCA:
- UTILITY = mensagem ligada a uma interação/solicitação JÁ EXISTENTE da pessoa (atualização de pedido, proposta, análise, agendamento, documento). NUNCA promocional: proibido desconto, oferta, urgência de venda, convite a comprar.
- Use variáveis {{1}}, {{2}}... em sequência ({{1}} normalmente é o nome ou protocolo da pessoa).
- Máx. 1024 caracteres, tom sóbrio, no máximo 1 emoji, português do Brasil.
- Responda APENAS um JSON válido, sem markdown: {"body_text": "...", "exemplos": ["exemplo p/ {{1}}", "..."], "footer_text": "opcional, curto ou null"}
${refBody ? `Referência de estilo aprovado da casa: "${refBody.slice(0, 300)}"` : ""}`;
  const rota = resolverChamadaLlm({ tipo: "waba" });
  const rl = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${OR_KEY}` },
    body: JSON.stringify(bodyOpenRouter(rota, {
      max_tokens: 900, reasoning: { enabled: false },
      messages: [{ role: "system", content: sys }, { role: "user", content: `Objetivo do template: ${objetivo}` }],
    })),
  });
  const rj = await rl.json().catch(() => null);
  const bruto = String(rj?.choices?.[0]?.message?.content ?? "").trim().replace(/^```json|```$/g, "").trim();
  let red: any = null; try { red = JSON.parse(bruto); } catch { /* */ }
  if (!red?.body_text) return json({ error: "redator não devolveu JSON válido", bruto: bruto.slice(0, 300) }, 502);
  const bodyText = String(red.body_text);
  const exemplos: string[] = Array.isArray(red.exemplos) ? red.exemplos.map(String) : [];
  const nVars = [...bodyText.matchAll(/\{\{\d+\}\}/g)].length;

  // GUARDIÃO A: determinístico
  const errosA = checarUtility(bodyText, nome);
  if (nVars > 0 && exemplos.length !== nVars) errosA.push(`Meta exige 1 exemplo por variável (${nVars} vars, ${exemplos.length} exemplos)`);

  // GUARDIÃO B: compliance-check (bloqueante, fail-closed)
  let compl: any = null; let complOk = false;
  try {
    const cc = await fetch(`${SUPABASE_URL}/functions/v1/compliance-check`, {
      method: "POST", headers: { "content-type": "application/json", "x-mcp-key": cfg.api_key },
      body: JSON.stringify({ legenda: bodyText }),
    });
    compl = await cc.json().catch(() => null);
    const verd = String(compl?.veredito ?? compl?.verdict ?? "").toUpperCase();
    complOk = cc.status === 200 && (verd.includes("APROV") || verd.includes("GREEN") || verd.includes("PASS") || compl?.aprovado === true);
    if (!complOk && cc.status === 200 && !verd && compl?.aprovado === undefined) {
      // contrato mudou/ambíguo: fail-closed com o payload guardado p/ diagnóstico
      compl = { fail_closed: true, resposta: compl };
    }
  } catch (e) { compl = { fail_closed: true, erro: String(e).slice(0, 200) }; }

  const reprovado = errosA.length > 0 || !complOk;
  const componentes: any[] = [{ type: "BODY", text: bodyText,
    ...(nVars > 0 ? { example: { body_text: [exemplos] } } : {}) }];
  if (red.footer_text) componentes.push({ type: "FOOTER", text: String(red.footer_text).slice(0, 60) });

  const linhas: any[] = [];
  for (const alvo of alvos) {
    const { data: ins } = await supa.from("waba_template_creations").insert({
      company_id: comp.id, target_waba_id: alvo, template_name: nome, language, category: categoria,
      objetivo, components: componentes,
      redator_meta: { model: rota.model, tokens: rj?.usage ?? null, faixa: rota.faixa },
      guardiao: { deterministico: errosA, compliance: compl, aprovado: !reprovado },
      status: reprovado ? "reprovado_guardiao" : "rascunho",
      dry_run: true, requested_by: actor,
      rejected_reason: reprovado ? [...errosA, ...(complOk ? [] : ["compliance-check não aprovou (fail-closed)"])].join(" | ") : null,
    }).select("id").single();
    await audit(comp.id, actor, reprovado ? "waba_template_creation_blocked" : "waba_template_creation_drafted",
      ins?.id ?? "-", { template: nome, alvo, guardiao_erros: errosA, compliance_ok: complOk });
    linhas.push({ alvo, creation_id: ins?.id, status: reprovado ? "REPROVADO PELO GUARDIÃO" : "rascunho aprovado" });
  }

  return json({ ok: !reprovado, versao: VERSAO, acao: "draft", template: nome, categoria,
    corpo_gerado: bodyText, exemplos, footer: red.footer_text ?? null,
    guardiao: { deterministico: errosA, compliance_aprovou: complOk },
    rascunhos: linhas,
    proximo_passo: reprovado
      ? "corrigir objetivo/nome e gerar novo draft — nada foi nem será submetido"
      : "revisar o corpo; para submeter: acao='submit' com creation_id, com master + flag criar_template + dry_run=false (janela curta)" });
});
