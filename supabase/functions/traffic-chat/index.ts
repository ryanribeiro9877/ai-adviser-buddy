// supabase/functions/traffic-chat/index.ts (v7)
// v7: CORS — preflight OPTIONS + Access-Control-Allow-Origin em TODAS as respostas
//     (regressão da v4: ao reescrever para anexos, o json() perdeu os headers CORS
//     e o browser passou a ser bloqueado; pg_net não faz preflight e mascarou isso).
// v6: SheetJS via import LAZY (import no topo estourava o boot — WORKER_RESOURCE_LIMIT).
// v4/v5: anexos multimodais (imagem/PDF direto; planilha->CSV; texto) + metadados persistidos.
// v3: modelo padrão anthropic/claude-sonnet-5 (env OPENROUTER_MODEL tem precedência).
// v2: busca de campanha sem acentos; ranking marca amostra pequena.
// Auth: Bearer <user JWT> OU x-mcp-key. Body: { message, conversation_id?, company?, attachments? }

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const OPENROUTER_KEY = (Deno.env.get("OPENROUTER_API_KEY") ?? "").trim();
const MODEL = (Deno.env.get("OPENROUTER_MODEL") ?? "anthropic/claude-sonnet-5").trim();

const supa = createClient(SUPABASE_URL, SERVICE_ROLE, { auth: { persistSession: false } });

const CORS = {
  "access-control-allow-origin": "*",
  "access-control-allow-headers": "authorization, x-client-info, apikey, content-type, x-mcp-key",
  "access-control-allow-methods": "POST, OPTIONS",
};
function json(obj: unknown, status = 200) {
  return new Response(JSON.stringify(obj), { status, headers: { "content-type": "application/json", ...CORS } });
}
const today = () => new Date().toISOString().slice(0, 10);
const brl = (n: number) => "R$ " + (Math.round(n * 100) / 100).toFixed(2);
const deacc = (s: string) => s.normalize("NFD").replace(/[\u0300-\u036f]/g, "");

async function resolveCompany(name?: string): Promise<{ id: string; name: string } | null> {
  const { data } = await supa.from("companies").select("id,name");
  if (!data?.length) return null;
  if (name) {
    const hit = data.find((c) => deacc(c.name.toLowerCase()).includes(deacc(name.toLowerCase())));
    if (hit) return hit;
  }
  return data.find((c) => c.name.toLowerCase().includes("legal")) ?? data[0];
}

const IMG_MIMES = ["image/png", "image/jpeg", "image/jpg", "image/webp", "image/gif"];
const SHEET_MIMES = [
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/vnd.ms-excel", "text/csv",
];
function b64ToU8(b64: string): Uint8Array {
  const bin = atob(b64);
  const u8 = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
  return u8;
}
async function sheetToText(name: string, mime: string, b64: string): Promise<{ text: string; nota: string }> {
  if (mime === "text/csv" || /\.csv$/i.test(name)) {
    const txt = new TextDecoder().decode(b64ToU8(b64));
    const linhas = txt.split("\n").filter((l) => l.trim() !== "");
    const corte = linhas.slice(0, 400);
    return { text: `[PLANILHA CSV "${name}"${linhas.length > 400 ? ` — TRUNCADA em 400 de ${linhas.length} linhas` : ""}]\n` + corte.join("\n"),
             nota: `${linhas.length} linha(s) csv` };
  }
  const XLSX = await import("https://esm.sh/xlsx@0.18.5"); // lazy: só paga o custo quando chega xlsx
  const wb = XLSX.read(b64ToU8(b64), { type: "array" });
  const partes: string[] = [];
  let totalLinhas = 0;
  const MAX_LINHAS = 400;
  for (const sn of wb.SheetNames) {
    const csv: string = XLSX.utils.sheet_to_csv(wb.Sheets[sn]);
    const linhas = csv.split("\n").filter((l) => l.trim() !== "");
    totalLinhas += linhas.length;
    const usadas = partes.reduce((a, p) => a + p.split("\n").length, 0);
    const corte = linhas.slice(0, Math.max(0, MAX_LINHAS - usadas));
    if (corte.length) partes.push(`--- aba: ${sn} (${linhas.length} linhas) ---\n` + corte.join("\n"));
  }
  const truncado = totalLinhas > MAX_LINHAS;
  return {
    text: `[PLANILHA "${name}" convertida p/ CSV${truncado ? ` — TRUNCADA em ${MAX_LINHAS} linhas de ${totalLinhas}` : ""}]\n` + partes.join("\n\n"),
    nota: `${wb.SheetNames.length} aba(s), ${totalLinhas} linha(s)${truncado ? " (truncada)" : ""}`,
  };
}

async function t_overview(companyId: string) {
  const { data: camps } = await supa.from("campaigns")
    .select("name,status,category,spend,leads,form_leads,messaging_started")
    .eq("company_id", companyId);
  const ativos = (camps ?? []).filter((c) => c.status === "active");
  const from = new Date(Date.now() - 7 * 864e5).toISOString().slice(0, 10);
  const { data: snaps } = await supa.from("metric_snapshots")
    .select("spend,impressions,link_clicks,form_leads,messaging_started,leads,snapshot_date")
    .eq("company_id", companyId).gte("snapshot_date", from);
  const s = (snaps ?? []).reduce((a, r) => ({
    spend: a.spend + Number(r.spend || 0), imp: a.imp + Number(r.impressions || 0),
    link: a.link + Number(r.link_clicks || 0), forms: a.forms + Number(r.form_leads || 0),
    msg: a.msg + Number(r.messaging_started || 0), leads: a.leads + Number(r.leads || 0),
  }), { spend: 0, imp: 0, link: 0, forms: 0, msg: 0, leads: 0 });
  return {
    campanhas_ativas: ativos.length, campanhas_total: (camps ?? []).length,
    ultimos_7_dias: { gasto: brl(s.spend), impressoes: s.imp, cliques_link: s.link, formularios: s.forms, conversas_whatsapp: s.msg, leads_dashboard: s.leads,
      custo_por_formulario: s.forms ? brl(s.spend / s.forms) : null,
      custo_por_lead: s.leads ? brl(s.spend / s.leads) : null },
    campanhas_ativas_lista: ativos.map((c) => ({ nome: c.name, categoria: c.category, gasto_acumulado: brl(Number(c.spend || 0)) })),
  };
}
async function t_alerts(companyId: string) {
  const { data } = await supa.from("alerts")
    .select("severity,title,description,created_at,resolved")
    .eq("company_id", companyId).eq("resolved", false).order("created_at", { ascending: false }).limit(20);
  return { alertas_ativos: data ?? [] };
}
async function t_recos(companyId: string) {
  const { data } = await supa.from("ai_recommendations")
    .select("category,impact,title,description,status,created_at")
    .eq("company_id", companyId).eq("status", "new").order("created_at", { ascending: false }).limit(20);
  return { recomendacoes_pendentes: data ?? [] };
}
async function t_targets(companyId: string) {
  const { data } = await supa.from("targets").select("metric,valor,fonte,updated_at").eq("company_id", companyId).eq("active", true).is("campaign_id", null);
  return { metas_tetos: (data ?? []).map((t) => ({ metrica: t.metric, teto: brl(Number(t.valor)), fonte: t.fonte, atualizado_em: t.updated_at })) };
}
async function t_funnel(companyId: string, date_from?: string, date_to?: string) {
  let q = supa.from("metric_snapshots")
    .select("spend,impressions,clicks,link_clicks,form_leads,messaging_started,leads")
    .eq("company_id", companyId);
  if (date_from) q = q.gte("snapshot_date", date_from);
  if (date_to) q = q.lte("snapshot_date", date_to);
  const { data } = await q;
  const s = (data ?? []).reduce((a, r) => ({
    spend: a.spend + Number(r.spend || 0), imp: a.imp + Number(r.impressions || 0), clk: a.clk + Number(r.clicks || 0),
    link: a.link + Number(r.link_clicks || 0), forms: a.forms + Number(r.form_leads || 0), msg: a.msg + Number(r.messaging_started || 0), leads: a.leads + Number(r.leads || 0),
  }), { spend: 0, imp: 0, clk: 0, link: 0, forms: 0, msg: 0, leads: 0 });
  return { periodo: { de: date_from ?? "inicio", ate: date_to ?? "hoje" },
    funil: { impressoes: s.imp, cliques: s.clk, cliques_no_link_lead: s.link, formularios: s.forms, conversas_whatsapp_linha_separada: s.msg },
    gasto: brl(s.spend),
    custos: { por_lead_lp: s.link ? brl(s.spend / s.link) : null, por_formulario: s.forms ? brl(s.spend / s.forms) : null, por_conversa: s.msg ? brl(s.spend / s.msg) : null } };
}
async function t_ads_ranking(companyId: string, days = 7) {
  const from = new Date(Date.now() - days * 864e5).toISOString().slice(0, 10);
  const { data: ads } = await supa.from("ads").select("external_id,name,status,campaign_id").eq("company_id", companyId);
  const { data: camps } = await supa.from("campaigns").select("id,name,status,category").eq("company_id", companyId).eq("status", "active");
  const campMap = new Map((camps ?? []).map((c) => [c.id, c]));
  const active = (ads ?? []).filter((a) => campMap.has(a.campaign_id));
  if (!active.length) return { ranking: [], nota: "sem criativos em campanhas ativas" };
  const ids = active.map((a) => a.external_id);
  const { data: snaps } = await supa.from("ad_metric_snapshots")
    .select("ad_external_id,spend,form_leads,messaging_started").gte("snapshot_date", from).in("ad_external_id", ids);
  const agg = new Map<string, { spend: number; res: number }>();
  for (const s of snaps ?? []) {
    const ad = active.find((a) => a.external_id === s.ad_external_id); if (!ad) continue;
    const cat = campMap.get(ad.campaign_id)?.category;
    const res = cat === "mensagem" ? Number(s.messaging_started || 0) : Number(s.form_leads || 0);
    const cur = agg.get(s.ad_external_id) ?? { spend: 0, res: 0 };
    cur.spend += Number(s.spend || 0); cur.res += res; agg.set(s.ad_external_id, cur);
  }
  const rows = [...agg.entries()].filter(([, v]) => v.spend > 0).map(([id, v]) => {
    const ad = active.find((a) => a.external_id === id)!;
    return { criativo: ad.name, campanha: campMap.get(ad.campaign_id)?.name, gasto: brl(v.spend), resultados: v.res,
      custo_por_resultado: v.res ? brl(v.spend / v.res) : "sem resultado",
      amostra_pequena_pouco_confiavel: v.res < 20, _c: v.res ? v.spend / v.res : 1e9 };
  }).sort((a, b) => a._c - b._c).map(({ _c, ...r }) => r);
  return { janela_dias: days, ranking_do_melhor_para_o_pior: rows.slice(0, 15),
    nota: "criativos com amostra_pequena_pouco_confiavel=true tem poucos resultados; nao os declare 'melhor criativo' sem ressalva" };
}
async function t_campaign_detail(companyId: string, name_like: string) {
  const { data: all } = await supa.from("campaigns").select("id,name,status,category,spend,leads,form_leads").eq("company_id", companyId);
  const needle = deacc(name_like.toLowerCase());
  const camps = (all ?? []).filter((c) => deacc(c.name.toLowerCase()).includes(needle)).slice(0, 3);
  if (!camps.length) return { erro: `nenhuma campanha com nome contendo '${name_like}' (busca ignora acentos)` };
  const c = camps[0];
  const from = new Date(Date.now() - 14 * 864e5).toISOString().slice(0, 10);
  const { data: serie } = await supa.from("metric_snapshots").select("snapshot_date,spend,impressions,link_clicks,form_leads,messaging_started").eq("campaign_id", c.id).gte("snapshot_date", from).order("snapshot_date");
  return { campanha: { nome: c.name, status: c.status, categoria: c.category, gasto_acumulado: brl(Number(c.spend || 0)) },
    serie_diaria_14d: (serie ?? []).map((s) => ({ dia: s.snapshot_date, gasto: brl(Number(s.spend || 0)), impressoes: s.impressions, formularios: s.form_leads, conversas: s.messaging_started })),
    outras_encontradas: camps.slice(1).map((x) => x.name) };
}

const TOOLS = [
  { type: "function", function: { name: "get_overview", description: "Visão geral da empresa: campanhas ativas, gasto/resultados dos últimos 7 dias, custos.", parameters: { type: "object", properties: {} } } },
  { type: "function", function: { name: "get_alerts", description: "Alertas ativos (CPL acima do alvo, regra dos 3 dias, entrega, orçamento, etc).", parameters: { type: "object", properties: {} } } },
  { type: "function", function: { name: "get_recommendations", description: "Recomendações pendentes (criativos vencedores para escalar/replicar).", parameters: { type: "object", properties: {} } } },
  { type: "function", function: { name: "get_targets", description: "Metas e tetos de custo vigentes (CPL, custo/formulário, custo/conversa).", parameters: { type: "object", properties: {} } } },
  { type: "function", function: { name: "get_funnel", description: "Funil agregado num período: impressões→cliques→lead(link)→formulários; conversas em linha separada; custos por etapa.", parameters: { type: "object", properties: { date_from: { type: "string", description: "YYYY-MM-DD" }, date_to: { type: "string", description: "YYYY-MM-DD" } } } } },
  { type: "function", function: { name: "get_ads_ranking", description: "Ranking de criativos ativos por custo/resultado numa janela de dias (melhor→pior). Atenção ao campo amostra_pequena_pouco_confiavel.", parameters: { type: "object", properties: { days: { type: "number", description: "janela em dias, default 7" } } } } },
  { type: "function", function: { name: "get_campaign_detail", description: "Detalhe e série diária (14d) de uma campanha pelo nome (busca parcial, ignora acentos).", parameters: { type: "object", properties: { name_like: { type: "string" } }, required: ["name_like"] } } },
];

async function runTool(name: string, args: any, companyId: string) {
  try {
    switch (name) {
      case "get_overview": return await t_overview(companyId);
      case "get_alerts": return await t_alerts(companyId);
      case "get_recommendations": return await t_recos(companyId);
      case "get_targets": return await t_targets(companyId);
      case "get_funnel": return await t_funnel(companyId, args?.date_from, args?.date_to);
      case "get_ads_ranking": return await t_ads_ranking(companyId, Number(args?.days ?? 7));
      case "get_campaign_detail": return await t_campaign_detail(companyId, String(args?.name_like ?? ""));
      default: return { erro: `tool desconhecida: ${name}` };
    }
  } catch (e) { return { erro: String(e?.message ?? e) }; }
}

function systemPrompt(companyName: string) {
  return `Você é o Gestor de Tráfego IA da empresa ${companyName}. Hoje é ${today()}.\n` +
    `Papel: analista sênior de tráfego pago (Meta Ads) que responde ao gestor (Roberto) em português brasileiro, direto e objetivo.\n` +
    `REGRAS:\n` +
    `1. Baseie TODA resposta em dados obtidos pelas tools — nunca invente números. Se a tool não trouxer o dado, diga que não está disponível.\n` +
    `2. Valores em R$ com 2 casas. Datas em DD/MM.\n` +
    `3. Seja conciso: responda em poucos parágrafos ou lista curta; destaque o número que decide.\n` +
    `4. Glossário do funil: Lead = clique no link (LP); Formulário = form preenchido; Conversa = WhatsApp iniciado (linha separada, não etapa); Proposta pertence ao Dash da Legal (fora deste sistema).\n` +
    `5. Você tem acesso SOMENTE LEITURA. Se pedirem para pausar/escalar/alterar orçamento, explique o que você faria e diga que a execução automática chega na fase de ações — por ora a mudança é manual no Gerenciador.\n` +
    `6. Ao citar custo vs teto, use as metas da tool get_targets.\n` +
    `7. Criativo com amostra pequena (poucos resultados) não é conclusão — sempre ressalve o volume.\n` +
    `8. ANEXOS: quando a mensagem trouxer imagens, PDFs ou planilhas, analise-os com atenção (extraia números, tabelas e gráficos) e, quando fizer sentido, CRUZE com os dados do banco via tools (ex.: comparar um print de gerenciador com nossos snapshots). Cite de onde veio cada número (anexo vs banco).`;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });
  if (req.method !== "POST") return json({ error: "POST only" }, 405);
  if (!OPENROUTER_KEY) return json({ error: "missing_openrouter_key" }, 500);

  const authz = req.headers.get("authorization") ?? "";
  const bearer = authz.toLowerCase().startsWith("bearer ") ? authz.slice(7).trim() : "";
  const mcpProvided = (req.headers.get("x-mcp-key") ?? "").trim() || bearer;
  const { data: cfg } = await supa.from("mcp_config").select("api_key").eq("id", 1).maybeSingle();
  let userId: string | null = null;
  let authed = false;
  if (cfg?.api_key && mcpProvided === cfg.api_key) { authed = true; }
  else if (bearer) {
    const { data: u } = await supa.auth.getUser(bearer);
    if (u?.user) { authed = true; userId = u.user.id; }
  }
  if (!authed) return json({ error: "unauthorized" }, 401);

  let body: any = {};
  try { body = await req.json(); } catch { /* */ }
  const message = String(body?.message ?? "").trim();
  const rawAtts: any[] = Array.isArray(body?.attachments) ? body.attachments.slice(0, 4) : [];
  if (!message && !rawAtts.length) return json({ error: "message obrigatório" }, 400);

  const company = await resolveCompany(body?.company ? String(body.company) : undefined);
  if (!company) return json({ error: "empresa não encontrada" }, 400);

  let convId: string | null = body?.conversation_id ?? null;
  if (convId) {
    const { data: conv } = await supa.from("chat_conversations").select("id").eq("id", convId).maybeSingle();
    if (!conv) convId = null;
  }
  if (!convId) {
    const { data: conv, error: ce } = await supa.from("chat_conversations")
      .insert({ company_id: company.id, title: (message || rawAtts[0]?.name || "anexo").slice(0, 60), kind: "chat", created_by: userId })
      .select("id").single();
    if (ce) return json({ error: "conv_create_failed", detail: ce.message }, 500);
    convId = conv.id;
  }

  const userContent: any[] = [];
  const attMeta: any[] = [];
  const attNotas: string[] = [];
  for (const a of rawAtts) {
    const name = String(a?.name ?? "arquivo");
    const mime = String(a?.mime ?? "").toLowerCase();
    const b64 = String(a?.data_base64 ?? "");
    if (!b64) continue;
    const sizeKb = Math.round((b64.length * 3) / 4 / 1024);
    if (sizeKb > 8500) { attNotas.push(`"${name}" ignorado (>8MB)`); continue; }
    try {
      if (IMG_MIMES.includes(mime)) {
        userContent.push({ type: "image_url", image_url: { url: `data:${mime};base64,${b64}` } });
        attMeta.push({ name, mime, kb: sizeKb, tipo: "imagem" });
      } else if (mime === "application/pdf") {
        userContent.push({ type: "file", file: { filename: name, file_data: `data:application/pdf;base64,${b64}` } });
        attMeta.push({ name, mime, kb: sizeKb, tipo: "pdf" });
      } else if (SHEET_MIMES.includes(mime) || /\.(xlsx|xls|csv)$/i.test(name)) {
        const { text, nota } = await sheetToText(name, mime, b64);
        userContent.push({ type: "text", text });
        attMeta.push({ name, mime, kb: sizeKb, tipo: "planilha", extracao: nota });
      } else if (mime.startsWith("text/")) {
        const txt = new TextDecoder().decode(b64ToU8(b64)).slice(0, 40000);
        userContent.push({ type: "text", text: `[ARQUIVO DE TEXTO "${name}"]\n` + txt });
        attMeta.push({ name, mime, kb: sizeKb, tipo: "texto" });
      } else {
        attNotas.push(`"${name}" tipo não suportado (${mime || "desconhecido"})`);
      }
    } catch (e) {
      attNotas.push(`"${name}" falhou: ${String((e as any)?.message ?? e).slice(0, 120)}`);
    }
  }
  const msgText = message || "Analise o(s) anexo(s).";
  userContent.unshift({ type: "text", text: msgText + (attNotas.length ? `\n\n[avisos de anexo: ${attNotas.join("; ")}]` : "") });

  const { data: hist } = await supa.from("chat_messages")
    .select("role,content").eq("conversation_id", convId)
    .in("role", ["user", "assistant"]).order("created_at", { ascending: false }).limit(16);
  const history = (hist ?? []).reverse().map((m) => ({ role: m.role, content: m.content ?? "" }));

  await supa.from("chat_messages").insert({
    conversation_id: convId, company_id: company.id, role: "user", content: msgText, user_id: userId,
    attachments: attMeta.length ? attMeta : null,
  });

  const messages: any[] = [{ role: "system", content: systemPrompt(company.name) }, ...history,
    { role: "user", content: userContent.length === 1 ? msgText : userContent }];
  const toolsUsed: any[] = [];
  let tokensIn = 0, tokensOut = 0, reply = "";

  for (let iter = 0; iter < 6; iter++) {
    const resp = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${OPENROUTER_KEY}` },
      body: JSON.stringify({ model: MODEL, messages, tools: TOOLS, tool_choice: "auto", max_tokens: 1600 }),
    });
    const text = await resp.text();
    if (!resp.ok) return json({ error: `openrouter_http_${resp.status}`, detail: text.slice(0, 300) }, 502);
    let parsed: any; try { parsed = JSON.parse(text); } catch { return json({ error: "openrouter_non_json", detail: text.slice(0, 300) }, 502); }
    tokensIn += Number(parsed?.usage?.prompt_tokens ?? 0);
    tokensOut += Number(parsed?.usage?.completion_tokens ?? 0);
    const msg = parsed?.choices?.[0]?.message;
    if (!msg) return json({ error: "openrouter_empty" }, 502);

    if (msg.tool_calls?.length) {
      messages.push(msg);
      for (const tc of msg.tool_calls) {
        let args: any = {}; try { args = JSON.parse(tc.function?.arguments ?? "{}"); } catch { /* */ }
        const result = await runTool(tc.function?.name, args, company.id);
        toolsUsed.push({ tool: tc.function?.name, args });
        messages.push({ role: "tool", tool_call_id: tc.id, content: JSON.stringify(result).slice(0, 12000) });
      }
      continue;
    }
    reply = msg.content ?? "";
    break;
  }
  if (!reply) reply = "Não consegui concluir a análise dentro do limite de passos. Tente uma pergunta mais específica.";

  await supa.from("chat_messages").insert({
    conversation_id: convId, company_id: company.id, role: "assistant", content: reply,
    tool_calls: toolsUsed.length ? toolsUsed : null, model: MODEL, tokens_in: tokensIn, tokens_out: tokensOut,
  });
  await supa.from("chat_conversations").update({ updated_at: new Date().toISOString() }).eq("id", convId);

  return json({ ok: true, conversation_id: convId, reply, tools_used: toolsUsed.map((t) => t.tool), tokens_in: tokensIn, tokens_out: tokensOut, attachments_processed: attMeta, attachment_warnings: attNotas });
});
