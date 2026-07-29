// supabase/functions/traffic-agent-job/index.ts (v1.1)
// v1.1 - RELATORIO DE SUBAGENTE COMPLETO + SINTESE CIENTE DE CORTE (achado da auditoria
//   verificada de 28/07 noite): no questionario do auditor, o subagente estrutura_conta
//   terminou o relatorio em finish=length (teto de 3.500 tokens) ANTES dos numeros de
//   CBO/ABO, e a sintese - que so enxerga relatorios - converteu "nao chegou ate mim" em
//   "relatorio de estrutura retornou vazio", um FALSO NEGATIVO: get_estrutura_conjuntos
//   devolvia 25.432 bytes com 53 conjuntos naquele instante. Duas correcoes:
//   (1) SUB_MAX_TOKENS 3500 -> 5000 e CONTINUACAO INTERNA do relatorio (ate 3 partes,
//       mesma tecnica da sintese: contexto preservado em memoria, zero re-coleta),
//       guardada pelo prazo do job;
//   (2) cada relatorio chega a sintese marcado COMPLETO ou INCOMPLETO, e o prompt da
//       sintese obriga a declarar "o levantamento de X veio incompleto" em vez de
//       "nao disponivel" - truncamento nao pode virar inexistencia (regra R3 aplicada
//       tambem ao proprio pipeline).
// SUBAGENTES + JOB ASSINCRONO (EdgeRuntime.waitUntil) - remove o teto de 150s em vez de
// negociar com ele, como declarado no v27 do traffic-chat.
//
// DESENHO:
//   POST identico ao traffic-chat (message, conversation_id?, company?) -> responde em ~1s
//   com {ok, async:true, job_id, conversation_id} e processa em BACKGROUND:
//     FASE 1  PLANNER    - 1 chamada LLM devolve JSON {subagentes:[{nome,foco}]}; o CODIGO
//                          valida contra a whitelist (LLM identifica, codigo decide). JSON
//                          invalido -> degrada DECLARADO para todos os subagentes.
//                          ROTEAMENTO MINIMO: o planner escolhe o MENOR conjunto que cobre a
//                          pergunta - tarefa de um unico dominio vai para UM especialista.
//     FASE 2  SUBAGENTES - executados em PARALELO, com ESCOPO ESTRITO: um especialista por
//                          capacidade implementada, ferramentas restritas, e ordem explicita
//                          de RECUSAR (registrando em LACUNAS) tarefa fora do proprio dominio:
//                            desempenho_campanhas  (numeros de midia: gasto, funil, CTR,
//                                                   ranking, series, metas)
//                            criativos             (conteudo real das pecas: legendas,
//                                                   titulos, CTA, gasto por legenda)
//                            compliance            (auditoria das legendas na base de regras
//                                                   FIN/CRI/LGL, ate 8 verificacoes - a
//                                                   auditoria completa que o teto sincrono
//                                                   de 12 tools nunca deixou terminar)
//                            estrutura_conta       (CBO/ABO, orcamento, lance, targeting)
//                            whatsapp_waba         (tier/qualidade dos numeros, envios,
//                                                   leitura e cliques por template - as
//                                                   tabelas do F5.4/F5.5 viram ferramenta)
//                            alertas_recomendacoes (pendencias do sistema)
//                            conhecimento          (base tecnica agent_knowledge)
//     FASE 3  SINTESE    - pergunta INTEIRA + relatorios; se finish=length, CONTINUACAO
//                          INTERNA em memoria (contexto preservado, ZERO re-coleta de tool
//                          - mata a costura do front e seu custo medido de ~76k tokens).
//   Resultado = UMA mensagem completa em chat_messages (Realtime ja entrega ao front).
//   Ciclo de vida/progresso/telemetria em chat_jobs (migracao subagentes_tabela_chat_jobs).
//
// LIMITES HONESTOS (v1):
//   - Worker de background do Supabase tem teto de parede (~400s). JOB_LIMIT_MS=330s com
//     reserva; se estourar, a sintese fecha com o que tem e DECLARA o corte (licao 10).
//     Job preso >15min vira error via cron expira-chat-jobs-hora.
//   - Subagentes sao READ-ONLY: propose_action NAO existe aqui. Acao continua no chat
//     sincrono, com aprovacao de admin. Decisao deliberada de v1, nao esquecimento.
//   - As funcoes de ferramenta sao COPIA FIEL do traffic-chat v27.1 (sem propose/cards).
//     Risco conhecido: copia diverge com o tempo (licao do CORS do JurisAI). Pendencia
//     registrada: extrair para _shared/traffic-tools.ts quando os dois estabilizarem.
//   - Sem prompt caching na v1 (prompts diferem por subagente; avaliar depois com medida).
// Auth: Bearer <user JWT> OU x-mcp-key (identico ao traffic-chat).

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const OPENROUTER_KEY = (Deno.env.get("OPENROUTER_API_KEY") ?? "").trim();
const MODEL = (Deno.env.get("OPENROUTER_MODEL") ?? "anthropic/claude-sonnet-5").trim();

// Orcamentos do JOB (parede de ~400s do worker; 330s de trabalho + reserva de gravacao).
const JOB_LIMIT_MS = 330_000;
const RESERVA_FINAL_MS = 12_000;
const TOKENS_POR_SEGUNDO = 60;
// Planner: classificacao curta, sem raciocinio longo.
const PLANNER_MAX_TOKENS = 1200;
// Subagente: ate 6 rodadas de tool + relatorio.
// v1.1: 3500 -> 5000 (o corte em 3500 produziu falso negativo em producao) e o relatorio
// ganha continuacao interna de ate SUB_RELATORIO_MAX_PARTES partes, guardada pelo prazo.
const SUB_MAX_ITER = 6;
const SUB_MAX_TOKENS = 5000;
const SUB_RELATORIO_MAX_PARTES = 3;
const SUB_REASONING = { max_tokens: 2000 };
// Sintese: partes de ate 10000 tokens, com continuacao interna ate 4 partes.
const SINT_MAX_TOKENS = 10_000;
const SINT_MAX_PARTES = 4;
const REASONING_OFF = { enabled: false };

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
const norm = (s: string) => deacc(s.toLowerCase()).replace(/[-_\s]+/g, "");

async function resolveCompany(name?: string): Promise<{ id: string; name: string } | null> {
  const { data } = await supa.from("companies").select("id,name");
  if (!data?.length) return null;
  if (name) {
    const hit = data.find((c) => norm(c.name).includes(norm(name)));
    if (hit) return hit;
  }
  return data.find((c) => c.name.toLowerCase().includes("legal")) ?? data[0];
}

// ============================================================================
// FERRAMENTAS - copia fiel do traffic-chat v27.1 (somente leitura; sem propose_action).
// Pendencia registrada: extrair para _shared/traffic-tools.ts.
// ============================================================================
async function t_overview(companyId: string) {
  const { data: camps } = await supa.from("campaigns").select("name,status,category,spend,external_account_id").eq("company_id", companyId);
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
  const dias = new Set((snaps ?? []).map((r) => r.snapshot_date)).size;
  return {
    campanhas_ativas: ativos.length, campanhas_total: (camps ?? []).length,
    ultimos_7_dias: { gasto: brl(s.spend), dias_com_dado: dias, impressoes: s.imp, cliques_link: s.link,
      formularios: s.forms, conversas_whatsapp: s.msg,
      custo_por_formulario: s.forms ? brl(s.spend / s.forms) : null,
      custo_por_lead_lp: s.link ? brl(s.spend / s.link) : null },
    campanhas_ativas_lista: ativos.map((c) => ({ nome: c.name, categoria: c.category, conta: c.external_account_id, gasto_acumulado: brl(Number(c.spend || 0)) })),
    nota: "status vem do effective_status real da Meta (cron 09:10). dias_com_dado<7 indica cobertura incompleta: nao conclua queda sem checar isso.",
  };
}
async function t_alerts(companyId: string) {
  const { data } = await supa.from("alerts").select("severity,title,description,created_at,resolved")
    .eq("company_id", companyId).eq("resolved", false).order("created_at", { ascending: false }).limit(20);
  return { alertas_ativos: data ?? [] };
}
async function t_recos(companyId: string) {
  const { data } = await supa.from("ai_recommendations").select("category,impact,title,description,status,created_at")
    .eq("company_id", companyId).eq("status", "new").order("created_at", { ascending: false }).limit(20);
  return { recomendacoes_pendentes: data ?? [], nota: "regua destas recomendacoes e custo de MIDIA, nao contrato pago." };
}
async function t_targets(companyId: string) {
  const { data } = await supa.from("targets").select("metric,valor,fonte,updated_at").eq("company_id", companyId).eq("active", true).is("campaign_id", null);
  return { metas_tetos: (data ?? []).map((t) => ({ metrica: t.metric, teto: brl(Number(t.valor)), fonte: t.fonte })) };
}
async function t_funnel(companyId: string, date_from?: string, date_to?: string) {
  let q = supa.from("metric_snapshots").select("snapshot_date,spend,impressions,clicks,link_clicks,form_leads,messaging_started").eq("company_id", companyId);
  if (date_from) q = q.gte("snapshot_date", date_from);
  if (date_to) q = q.lte("snapshot_date", date_to);
  const { data } = await q;
  const s = (data ?? []).reduce((a, r) => ({
    spend: a.spend + Number(r.spend || 0), imp: a.imp + Number(r.impressions || 0), clk: a.clk + Number(r.clicks || 0),
    link: a.link + Number(r.link_clicks || 0), forms: a.forms + Number(r.form_leads || 0), msg: a.msg + Number(r.messaging_started || 0),
  }), { spend: 0, imp: 0, clk: 0, link: 0, forms: 0, msg: 0 });
  const datas = (data ?? []).map((r) => r.snapshot_date).sort();
  return { periodo_solicitado: { de: date_from ?? "inicio", ate: date_to ?? "hoje" },
    cobertura_real: { primeiro_dia: datas[0] ?? null, ultimo_dia: datas[datas.length - 1] ?? null, dias_com_dado: new Set(datas).size },
    funil_midia: { impressoes: s.imp, cliques: s.clk, cliques_no_link_lead: s.link, formularios: s.forms, conversas_whatsapp: s.msg },
    gasto: brl(s.spend),
    custos: { por_lead_lp: s.link ? brl(s.spend / s.link) : null, por_formulario: s.forms ? brl(s.spend / s.forms) : null, por_conversa: s.msg ? brl(s.spend / s.msg) : null },
    nota: "funil de MIDIA. Conversao final (CRM) esta fora de escopo por decisao de 28/07." };
}
async function t_ads_ranking(companyId: string, days = 7) {
  const from = new Date(Date.now() - days * 864e5).toISOString().slice(0, 10);
  const { data: ads } = await supa.from("ads").select("external_id,name,campaign_id").eq("company_id", companyId);
  const { data: camps } = await supa.from("campaigns").select("id,name,category").eq("company_id", companyId).eq("status", "active");
  const campMap = new Map((camps ?? []).map((c) => [c.id, c]));
  const active = (ads ?? []).filter((a) => campMap.has(a.campaign_id));
  if (!active.length) return { ranking: [], nota: "sem criativos em campanhas ativas" };
  const ids = active.map((a) => a.external_id);
  const { data: snaps } = await supa.from("ad_metric_snapshots").select("ad_external_id,spend,form_leads,messaging_started").gte("snapshot_date", from).in("ad_external_id", ids);
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
      custo_por_resultado: v.res ? brl(v.spend / v.res) : "sem resultado", amostra_pequena: v.res < 20, _c: v.res ? v.spend / v.res : 1e9 };
  }).sort((a, b) => a._c - b._c).map(({ _c, ...r }) => r);
  return { janela_dias: days, ranking: rows.slice(0, 15),
    nota: "RECORTE por custo MEDIO de midia. A Meta aloca por custo MARGINAL: PROIBIDO prescrever pausa so por esta ordenacao (Breakdown Effect)." };
}
async function t_campaign_detail(companyId: string, name_like: string) {
  const { data: all } = await supa.from("campaigns").select("id,name,status,category,spend").eq("company_id", companyId);
  const needle = norm(name_like);
  const camps = (all ?? []).filter((c) => norm(c.name).includes(needle)).slice(0, 3);
  if (!camps.length) return { erro: `nenhuma campanha com nome contendo '${name_like}'` };
  const c = camps[0];
  const from = new Date(Date.now() - 14 * 864e5).toISOString().slice(0, 10);
  const { data: serie } = await supa.from("metric_snapshots").select("snapshot_date,spend,impressions,link_clicks,form_leads,messaging_started").eq("campaign_id", c.id).gte("snapshot_date", from).order("snapshot_date");
  return { campanha: { nome: c.name, status: c.status, categoria: c.category, gasto_acumulado: brl(Number(c.spend || 0)) },
    serie_diaria_14d: (serie ?? []).map((s) => ({ dia: s.snapshot_date, gasto: brl(Number(s.spend || 0)), impressoes: s.impressions, formularios: s.form_leads, conversas: s.messaging_started })),
    outras_encontradas: camps.slice(1).map((x) => x.name) };
}

const TETO_TOOL_JSON = 11500;
function cortarLista(obj: Record<string, unknown>, campo: string, teto = TETO_TOOL_JSON) {
  const lista = Array.isArray(obj[campo]) ? (obj[campo] as unknown[]) : null;
  if (!lista) return obj;
  const baseLen = JSON.stringify({ ...obj, [campo]: [] }).length;
  const mantidos: unknown[] = [];
  let usados = 0;
  for (const item of lista) {
    const tam = JSON.stringify(item).length + 1;
    if (baseLen + usados + tam > teto) break;
    mantidos.push(item);
    usados += tam;
  }
  const omitidos = lista.length - mantidos.length;
  const out: Record<string, unknown> = { ...obj, [campo]: mantidos, exibidos: mantidos.length };
  if (omitidos > 0) {
    out.omitidos = omitidos;
    out.aviso_corte = `A lista '${campo}' foi truncada: ${mantidos.length} de ${lista.length} itens enviados. Os ${omitidos} restantes EXISTEM no banco - nao os trate como inexistentes nem como zero.`;
  }
  return out;
}
async function t_criativos_conteudo(somenteAtivas: boolean) {
  const { data, error } = await supa.rpc("get_criativos_conteudo", { p_somente_ativas: somenteAtivas });
  if (error) return { erro: `falha ao ler conteudo dos criativos: ${error.message}` };
  if (!data || typeof data !== "object") return { erro: "retorno inesperado de get_criativos_conteudo" };
  const obj = data as Record<string, unknown>;
  const lista = Array.isArray(obj.criativos) ? (obj.criativos as Record<string, unknown>[]) : [];
  const grupos = new Map<string, Record<string, unknown>>();
  for (const c of lista) {
    const legenda = String(c.legenda ?? "").trim();
    if (!legenda) continue;
    const chave = norm(legenda).slice(0, 300);
    const g = grupos.get(chave);
    if (!g) {
      grupos.set(chave, { legenda, titulo: c.titulo ?? null, cta: c.cta ?? null,
        anuncios: 1, exemplos: [c.anuncio], gasto_total: Number(c.gasto_acumulado || 0),
        formularios_total: Number(c.formularios || 0), alguma_em_campanha_ativa: c.campanha_ativa === true });
    } else {
      g.anuncios = Number(g.anuncios) + 1;
      if ((g.exemplos as unknown[]).length < 3) (g.exemplos as unknown[]).push(c.anuncio);
      g.gasto_total = Number(g.gasto_total) + Number(c.gasto_acumulado || 0);
      g.formularios_total = Number(g.formularios_total) + Number(c.formularios || 0);
      if (c.campanha_ativa === true) g.alguma_em_campanha_ativa = true;
    }
  }
  const unicas = [...grupos.values()].sort((a, b) => Number(b.gasto_total) - Number(a.gasto_total));
  const cortado = cortarLista(obj, "criativos", 4000) as Record<string, unknown>;
  const comUnicas = cortarLista({ ...cortado, legendas_unicas: unicas,
    total_legendas_distintas: unicas.length,
    nota_legendas: "legendas_unicas cobre TODOS os criativos coletados. Para auditoria de compliance completa, cheque cada texto distinto UMA vez.",
  }, "legendas_unicas", 6500);
  return { ...comUnicas, somente_campanhas_ativas: somenteAtivas };
}
async function t_estrutura_conjuntos() {
  const { data, error } = await supa.rpc("get_estrutura_conjuntos");
  if (error) return { erro: `falha ao ler estrutura dos conjuntos: ${error.message}` };
  if (!data || typeof data !== "object") return { erro: "retorno inesperado de get_estrutura_conjuntos" };
  return cortarLista(data as Record<string, unknown>, "conjuntos");
}
async function t_check_compliance(legenda: string, mcpKey: string) {
  if (!legenda) return { erro: "forneca a legenda" };
  const r = await fetch(`${SUPABASE_URL}/functions/v1/compliance-check`, { method: "POST", headers: { "content-type": "application/json", "x-mcp-key": mcpKey }, body: JSON.stringify({ legenda }) });
  const t = await r.text();
  try { return JSON.parse(t); } catch { return { erro: `compliance-check falhou (${r.status})` }; }
}
const TETO_CONHECIMENTO = 10000;
function dividirSecoes(md: string): { titulo: string; corpo: string }[] {
  const linhas = md.split("\n");
  const out: { titulo: string; corpo: string }[] = [];
  let tituloAtual = "(inicio)";
  let buffer: string[] = [];
  for (const l of linhas) {
    if (/^##\s+/.test(l)) {
      if (buffer.length) out.push({ titulo: tituloAtual, corpo: buffer.join("\n").trim() });
      tituloAtual = l.replace(/^#+\s*/, "").trim();
      buffer = [];
    } else buffer.push(l);
  }
  if (buffer.length) out.push({ titulo: tituloAtual, corpo: buffer.join("\n").trim() });
  return out.filter((s) => s.corpo.length > 0);
}
async function t_conhecimento(tema: string, secao?: string) {
  if (!tema) return { erro: "informe o tema" };
  const { data, error } = await supa.from("agent_knowledge")
    .select("tema,descricao,conteudo,fonte,verificado_em,revalidar_ate")
    .eq("vigente", true).eq("tema", tema.trim().toLowerCase()).maybeSingle();
  if (error) return { erro: `falha ao ler conhecimento: ${error.message}` };
  if (!data) return { erro: `tema '${tema}' nao encontrado` };
  const hoje = new Date().toISOString().slice(0, 10);
  const vencido = data.revalidar_ate ? String(data.revalidar_ate) < hoje : false;
  const meta: Record<string, unknown> = { tema: data.tema, verificado_em: data.verificado_em, revalidar_ate: data.revalidar_ate, fonte: data.fonte };
  if (vencido) meta.aviso_validade = "Conhecimento VENCIDO: trate como NAO CONFIRMADO e declare que precisa reverificacao antes de virar decisao.";
  const conteudo = String(data.conteudo ?? "");
  const secoes = dividirSecoes(conteudo);
  if (secao) {
    const alvo = norm(secao);
    const hit = secoes.find((x) => norm(x.titulo).includes(alvo));
    if (!hit) return { ...meta, erro: `secao '${secao}' nao encontrada`, secoes_disponiveis: secoes.map((x) => x.titulo) };
    return { ...meta, secao: hit.titulo, conteudo: hit.corpo.slice(0, TETO_CONHECIMENTO) };
  }
  if (conteudo.length <= TETO_CONHECIMENTO) return { ...meta, conteudo };
  const entregues: string[] = [];
  let usados = 0;
  for (const sx of secoes) {
    const bloco = `## ${sx.titulo}\n${sx.corpo}`;
    if (usados + bloco.length > TETO_CONHECIMENTO) break;
    entregues.push(bloco); usados += bloco.length;
  }
  const n = entregues.length;
  return { ...meta, conteudo: entregues.join("\n\n"),
    secoes_entregues: secoes.slice(0, n).map((x) => x.titulo),
    secoes_nao_entregues: secoes.slice(n).map((x) => x.titulo),
    instrucao: n < secoes.length ? "Tema extenso, veio parcial. As secoes nao entregues EXISTEM: chame de novo com 'secao'." : undefined };
}

// [WABA - F5.4/F5.5 viram ferramenta] Leitura das tabelas alimentadas pelo waba-sync (09:30)
// e monitoradas pelo evaluate_waba_tier_alerts (09:40).
async function t_waba_status(companyId: string) {
  const { data: nums } = await supa.from("waba_phone_numbers")
    .select("display_phone_number,verified_name,status,quality_rating,messaging_limit_tier,platform_type")
    .eq("company_id", companyId).eq("platform_type", "CLOUD_API");
  const { data: snaps } = await supa.from("waba_phone_snapshots")
    .select("snapshot_date").eq("company_id", companyId).order("snapshot_date", { ascending: false }).limit(1);
  const porTier = new Map<string, number>();
  const porQual = new Map<string, number>();
  for (const n of nums ?? []) {
    porTier.set(n.messaging_limit_tier ?? "sem tier", (porTier.get(n.messaging_limit_tier ?? "sem tier") ?? 0) + 1);
    porQual.set(n.quality_rating ?? "sem dado", (porQual.get(n.quality_rating ?? "sem dado") ?? 0) + 1);
  }
  return {
    numeros_vivos_cloud_api: (nums ?? []).length,
    distribuicao_tier: Object.fromEntries(porTier),
    distribuicao_qualidade: Object.fromEntries(porQual),
    numeros: (nums ?? []).map((n) => ({ numero: n.display_phone_number, nome: n.verified_name, tier: n.messaging_limit_tier, qualidade: n.quality_rating, status: n.status })),
    ultimo_snapshot: snaps?.[0]?.snapshot_date ?? null,
    nota: "Tier define o limite diario de envios (TIER_UNLIMITED e o alvo). Mudancas de tier/qualidade geram alerta automatico diario; qualidade YELLOW/RED antecede queda de tier.",
  };
}
async function t_waba_template_insights(companyId: string, days = 30) {
  const from = new Date(Date.now() - days * 864e5).toISOString().slice(0, 10);
  const { data: rows } = await supa.from("waba_template_analytics_daily")
    .select("template_external_id,template_name,date,sent,delivered,read,clicked")
    .eq("company_id", companyId).gte("date", from);
  const { data: tpls } = await supa.from("waba_templates").select("external_id,name").eq("company_id", companyId);
  const nomePor = new Map((tpls ?? []).map((t) => [t.external_id, t.name]));
  const agg = new Map<string, { nome: string; sent: number; delivered: number; read: number; clicked: number }>();
  for (const r of rows ?? []) {
    const nome = (r.template_name && String(r.template_name).trim()) || nomePor.get(r.template_external_id) || r.template_external_id;
    const cur = agg.get(nome) ?? { nome, sent: 0, delivered: 0, read: 0, clicked: 0 };
    cur.sent += Number(r.sent || 0); cur.delivered += Number(r.delivered || 0);
    cur.read += Number(r.read || 0); cur.clicked += Number(r.clicked || 0);
    agg.set(nome, cur);
  }
  const lista = [...agg.values()].sort((a, b) => b.clicked - a.clicked || b.sent - a.sent);
  const { data: ontem } = await supa.from("waba_analytics_daily")
    .select("sent").eq("company_id", companyId).eq("date", new Date(Date.now() - 864e5).toISOString().slice(0, 10));
  const sentOntem = (ontem ?? []).reduce((a, r) => a + Number(r.sent || 0), 0);
  return cortarLista({
    janela_dias: days,
    templates: lista.map((t) => ({ template: t.nome, envios: t.sent, entregues: t.delivered, leituras: t.read, cliques: t.clicked,
      taxa_clique_sobre_envio: t.sent ? Math.round((t.clicked / t.sent) * 1000) / 10 + "%" : null })),
    templates_distintos: lista.length,
    templates_sem_clique: lista.filter((t) => t.clicked === 0).length,
    envios_ontem_agregado: sentOntem,
    nota: "cliques podem superar leituras (recibo de leitura desligado nao conta leitura; ha multiplos cliques por mensagem). O detalhe POR NUMERO ainda NAO e coletado (dado agregado da conta) - ausencia de recorte por numero nao significa zero.",
  }, "templates");
}

async function runTool(name: string, args: any, ctx: { companyId: string; mcpKey: string }) {
  try {
    switch (name) {
      case "get_overview": return await t_overview(ctx.companyId);
      case "get_alerts": return await t_alerts(ctx.companyId);
      case "get_recommendations": return await t_recos(ctx.companyId);
      case "get_targets": return await t_targets(ctx.companyId);
      case "get_funnel": return await t_funnel(ctx.companyId, args?.date_from, args?.date_to);
      case "get_ads_ranking": return await t_ads_ranking(ctx.companyId, Number(args?.days ?? 7));
      case "get_campaign_detail": return await t_campaign_detail(ctx.companyId, String(args?.name_like ?? ""));
      case "get_criativos_conteudo": return await t_criativos_conteudo(args?.somente_ativas === false ? false : true);
      case "get_estrutura_conjuntos": return await t_estrutura_conjuntos();
      case "check_compliance": return await t_check_compliance(String(args?.legenda ?? "").trim(), ctx.mcpKey);
      case "get_conhecimento": return await t_conhecimento(String(args?.tema ?? ""), args?.secao ? String(args.secao) : undefined);
      case "get_waba_status": return await t_waba_status(ctx.companyId);
      case "get_waba_template_insights": return await t_waba_template_insights(ctx.companyId, Number(args?.days ?? 30));
      default: return { erro: `tool desconhecida: ${name}` };
    }
  } catch (e) { return { erro: String((e as any)?.message ?? e) }; }
}

// Schemas (subset do v27.1)
const DEF: Record<string, any> = {
  get_overview: { type: "function", function: { name: "get_overview", description: "Visao geral de MIDIA: campanhas ativas (status real), gasto/resultados 7d, dias_com_dado.", parameters: { type: "object", properties: {} } } },
  get_alerts: { type: "function", function: { name: "get_alerts", description: "Alertas ativos do sistema.", parameters: { type: "object", properties: {} } } },
  get_recommendations: { type: "function", function: { name: "get_recommendations", description: "Recomendacoes pendentes da IA (regua = custo de midia).", parameters: { type: "object", properties: {} } } },
  get_targets: { type: "function", function: { name: "get_targets", description: "Metas e tetos de custo vigentes.", parameters: { type: "object", properties: {} } } },
  get_funnel: { type: "function", function: { name: "get_funnel", description: "Funil de MIDIA num periodo, com cobertura_real.", parameters: { type: "object", properties: { date_from: { type: "string" }, date_to: { type: "string" } } } } },
  get_ads_ranking: { type: "function", function: { name: "get_ads_ranking", description: "RECORTE por custo MEDIO (Breakdown Effect: serve p/ ENTENDER, proibido prescrever pausa so por isto).", parameters: { type: "object", properties: { days: { type: "number" } } } } },
  get_campaign_detail: { type: "function", function: { name: "get_campaign_detail", description: "Detalhe e serie diaria 14d de uma campanha pelo nome.", parameters: { type: "object", properties: { name_like: { type: "string" } }, required: ["name_like"] } } },
  get_criativos_conteudo: { type: "function", function: { name: "get_criativos_conteudo", description: "Legendas/titulo/CTA reais dos anuncios (legendas_unicas cobre tudo p/ compliance).", parameters: { type: "object", properties: { somente_ativas: { type: "boolean" } } } } },
  get_estrutura_conjuntos: { type: "function", function: { name: "get_estrutura_conjuntos", description: "CBO vs ABO, orcamento, lance, targeting por conjunto.", parameters: { type: "object", properties: {} } } },
  check_compliance: { type: "function", function: { name: "check_compliance", description: "Valida UMA legenda contra a base de regras versionada (FIN/CRI/LGL).", parameters: { type: "object", properties: { legenda: { type: "string" } }, required: ["legenda"] } } },
  get_conhecimento: { type: "function", function: { name: "get_conhecimento", description: "Base tecnica: politicas Meta, metricas, otimizacao, criativo. Use 'secao' p/ temas extensos.", parameters: { type: "object", properties: { tema: { type: "string" }, secao: { type: "string" } }, required: ["tema"] } } },
  get_waba_status: { type: "function", function: { name: "get_waba_status", description: "Numeros WhatsApp vivos: tier de envio (caminho p/ TIER_UNLIMITED), qualidade (GREEN/YELLOW/RED) e status, por numero e agregado.", parameters: { type: "object", properties: {} } } },
  get_waba_template_insights: { type: "function", function: { name: "get_waba_template_insights", description: "Insights por TEMPLATE WhatsApp numa janela: envios, entregues, leituras, cliques e taxa de clique. Detalhe por numero ainda nao e coletado (declarado no retorno).", parameters: { type: "object", properties: { days: { type: "number", description: "janela em dias (default 30)" } } } } },
};

// Whitelist de subagentes: UM POR CAPACIDADE IMPLEMENTADA, escopo estrito (decisao do Ryan
// 28/07: tarefa de criativo vai pro de criativo, tarefa de insight vai pro de desempenho -
// especialista nao atende fora do proprio dominio, recusa e registra em LACUNAS).
const SUBAGENTES: Record<string, { tools: string[]; maxPorTool: Record<string, number>; maxToolsTotal: number; missao: string }> = {
  desempenho_campanhas: {
    tools: ["get_overview", "get_funnel", "get_ads_ranking", "get_campaign_detail", "get_targets"],
    maxPorTool: { get_campaign_detail: 3 }, maxToolsTotal: 9,
    missao: "NUMEROS DE MIDIA das campanhas Meta: gasto, impressoes, cliques, CTR, formularios, conversas, custos vs tetos, ranking de criativos por custo (recorte, nunca prescricao de pausa - Breakdown Effect), series diarias e cobertura de dados. Todo numero com fonte, janela e dias_com_dado.",
  },
  criativos: {
    tools: ["get_criativos_conteudo", "get_conhecimento"],
    maxPorTool: { get_criativos_conteudo: 2, get_conhecimento: 3 }, maxToolsTotal: 5,
    missao: "CONTEUDO REAL DAS PECAS em operacao: legendas, titulos, CTAs, gasto e formularios por legenda distinta, hooks e formatos (fundamentar na base de conhecimento de criativo). NAO faz auditoria de compliance (dominio do especialista compliance) nem analisa metricas de campanha (dominio do desempenho_campanhas).",
  },
  compliance: {
    tools: ["check_compliance", "get_criativos_conteudo", "get_conhecimento"],
    maxPorTool: { check_compliance: 8, get_criativos_conteudo: 1, get_conhecimento: 2 }, maxToolsTotal: 11,
    missao: "AUDITORIA DE COMPLIANCE: pegar legendas_unicas em get_criativos_conteudo e validar CADA legenda distinta em check_compliance (uma chamada por legenda, ATE COBRIR TODAS). Reportar veredito por legenda, violacoes FIN/CRI/LGL e riscos de Categoria Especial de Credito.",
  },
  estrutura_conta: {
    tools: ["get_estrutura_conjuntos", "get_conhecimento"],
    maxPorTool: { get_estrutura_conjuntos: 1, get_conhecimento: 2 }, maxToolsTotal: 3,
    missao: "ESTRUTURA da conta: CBO vs ABO, orcamentos por conjunto, estrategia de lance, targeting e compatibilidade com Categoria Especial de Credito. Apontar riscos com o dado visivel, sem inventar configuracao nao coletada.",
  },
  whatsapp_waba: {
    tools: ["get_waba_status", "get_waba_template_insights", "get_conhecimento"],
    maxPorTool: { get_waba_status: 1, get_waba_template_insights: 2, get_conhecimento: 2 }, maxToolsTotal: 5,
    missao: "CANAL WHATSAPP: tier de envio dos numeros (caminho para o TIER_UNLIMITED), qualidade GREEN/YELLOW/RED, envios, entregas, leituras e CLIQUES por template com taxa de clique. Declarar que o recorte por numero ainda nao e coletado quando relevante.",
  },
  alertas_recomendacoes: {
    tools: ["get_alerts", "get_recommendations"],
    maxPorTool: { get_alerts: 1, get_recommendations: 1 }, maxToolsTotal: 2,
    missao: "PENDENCIAS DO SISTEMA: alertas ativos (severidade, motivo) e recomendacoes aguardando decisao do gestor. Reportar sem re-analisar os dominios dos outros especialistas.",
  },
  conhecimento: {
    tools: ["get_conhecimento"],
    maxPorTool: { get_conhecimento: 5 }, maxToolsTotal: 5,
    missao: "FUNDAMENTO TECNICO puro (politicas Meta, definicao de metricas, metodo de otimizacao, boas praticas de criativo), citando o tema consultado e declarando [VENCIDO] quando for o caso. So e acionado quando a pergunta exige conceito alem do que os outros especialistas ja fundamentam.",
  },
};

// ============================================================================
// LLM
// ============================================================================
async function chamarLLM(messages: any[], opts: { tools?: any[]; maxTokens: number; reasoning?: any }): Promise<any> {
  const payload: any = { model: MODEL, messages, max_tokens: opts.maxTokens };
  if (opts.tools?.length) { payload.tools = opts.tools; payload.tool_choice = "auto"; }
  if (opts.reasoning) payload.reasoning = opts.reasoning;
  let resp = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${OPENROUTER_KEY}` }, body: JSON.stringify(payload),
  });
  let text = await resp.text();
  if (!resp.ok && (resp.status === 400 || resp.status === 422) && payload.reasoning) {
    // Degradacao: remove reasoning e retenta (mesmo padrao do traffic-chat v21).
    delete payload.reasoning;
    resp = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${OPENROUTER_KEY}` }, body: JSON.stringify(payload),
    });
    text = await resp.text();
  }
  if (!resp.ok) return { erro: `openrouter_http_${resp.status}`, detalhe: text.slice(0, 300) };
  try { return { parsed: JSON.parse(text) }; } catch { return { erro: "openrouter_non_json", detalhe: text.slice(0, 300) }; }
}
function usoDe(parsed: any) {
  const u = parsed?.usage ?? {};
  return { tin: Number(u.prompt_tokens ?? 0), tout: Number(u.completion_tokens ?? 0),
    reas: Number(u.completion_tokens_details?.reasoning_tokens ?? 0) + Number(u.reasoning_tokens ?? 0) };
}

// ============================================================================
// FASE 1 - PLANNER (LLM identifica, codigo decide)
// ============================================================================
function extrairJSON(txt: string): any | null {
  const limpo = txt.replace(/```json|```/g, "").trim();
  const ini = limpo.indexOf("{");
  const fim = limpo.lastIndexOf("}");
  if (ini < 0 || fim <= ini) return null;
  try { return JSON.parse(limpo.slice(ini, fim + 1)); } catch { return null; }
}
async function planejar(pergunta: string, tel: any): Promise<{ plano: { nome: string; foco: string }[]; degradado: boolean }> {
  const nomes = Object.keys(SUBAGENTES);
  const sys = `Voce e o ROTEADOR de um gestor de trafego Meta Ads. Dada a pergunta do gestor, encaminhe a tarefa para o MENOR conjunto de especialistas que a cobre por inteiro - tarefa de um unico dominio vai para UM unico especialista.
Especialistas disponiveis (use exatamente estes nomes):
- desempenho_campanhas: numeros de midia (gasto, CTR, custos, ranking, series, metas)
- criativos: conteudo real das pecas (legendas, titulos, CTA, hooks, formatos)
- compliance: auditoria das legendas contra as regras de credito (FIN/CRI/LGL)
- estrutura_conta: CBO/ABO, orcamento por conjunto, lance, targeting
- whatsapp_waba: numeros WhatsApp (tier, qualidade) e templates (envios, leituras, cliques)
- alertas_recomendacoes: alertas ativos e recomendacoes pendentes
- conhecimento: fundamento tecnico puro (so quando a pergunta exige conceito alem do operacional)
REGRAS DE ATRIBUICAO: taxa de clique/insight de CAMPANHA -> desempenho_campanhas; taxa de clique de TEMPLATE WhatsApp -> whatsapp_waba; texto/ideia de anuncio -> criativos; "pode anunciar isso?"/violacao -> compliance. NAO inclua especialista cujo dominio a pergunta nao toca.
Responda APENAS com JSON valido, sem markdown, no formato:
{"subagentes":[{"nome":"...","foco":"instrucao curta e especifica do que ELE deve levantar"}]}
Para auditoria ampla da conta, inclua todos os pertinentes.`;
  const r = await chamarLLM(
    [{ role: "system", content: sys }, { role: "user", content: pergunta.slice(0, 12000) }],
    { maxTokens: PLANNER_MAX_TOKENS, reasoning: REASONING_OFF },
  );
  if (r.erro) return { plano: nomes.map((n) => ({ nome: n, foco: "cobrir a parte da pergunta pertinente a sua especialidade" })), degradado: true };
  const u = usoDe(r.parsed); tel.planner = { tokens_in: u.tin, tokens_out: u.tout };
  const bruto = extrairJSON(String(r.parsed?.choices?.[0]?.message?.content ?? ""));
  const lista = Array.isArray(bruto?.subagentes) ? bruto.subagentes : null;
  if (!lista?.length) return { plano: nomes.map((n) => ({ nome: n, foco: "cobrir a parte da pergunta pertinente a sua especialidade" })), degradado: true };
  const plano = lista
    .map((x: any) => ({ nome: String(x?.nome ?? "").trim(), foco: String(x?.foco ?? "").trim().slice(0, 400) }))
    .filter((x: any) => nomes.includes(x.nome));
  if (!plano.length) return { plano: nomes.map((n) => ({ nome: n, foco: "cobrir a parte da pergunta pertinente a sua especialidade" })), degradado: true };
  // dedupe mantendo o primeiro foco
  const vistos = new Set<string>();
  const final = plano.filter((p: any) => (vistos.has(p.nome) ? false : (vistos.add(p.nome), true)));
  return { plano: final, degradado: false };
}

// ============================================================================
// FASE 2 - SUBAGENTE (loop restrito, relatorio final)
// ============================================================================
async function rodarSubagente(nome: string, foco: string, pergunta: string, ctx: { companyId: string; mcpKey: string }, prazo: () => number) {
  const cfg = SUBAGENTES[nome];
  const tools = cfg.tools.map((t) => DEF[t]);
  const sys = `Voce e o subagente '${nome}' de um gestor de trafego Meta Ads (credito consignado, Categoria Especial CREDIT).
MISSAO: ${cfg.missao}
FOCO DESTE JOB: ${foco || "cobrir a parte da pergunta pertinente a sua especialidade"}
ESCOPO ESTRITO: voce so atende o que a sua MISSAO cobre. Se o foco recebido pedir algo de OUTRO dominio (ex.: metricas de campanha para um especialista de criativo), NAO tente responder com suas ferramentas - registre na linha LACUNAS que aquilo e de outro especialista e siga apenas com a sua parte.
REGRAS: todo numero vem de ferramenta CHAMADA AGORA (nunca de memoria); distinga zero / nao existe / nao coletado; incorpore campos 'nota'/'aviso' dos retornos; amostra pequena e hipotese; nao misture janelas.
Ao terminar a coleta, escreva um RELATORIO conciso e denso em markdown com numeros + fonte + janela, terminando com a linha 'LACUNAS:' listando o que nao conseguiu cobrir (ou 'nenhuma').`;
  const messages: any[] = [{ role: "system", content: sys }, { role: "user", content: `Pergunta original do gestor (para contexto):\n${pergunta.slice(0, 8000)}` }];
  const usadas: string[] = [];
  let tin = 0, tout = 0, reas = 0, relatorio = "", finish = "";
  for (let iter = 0; iter < SUB_MAX_ITER; iter++) {
    if (prazo() <= 0) { finish = "prazo_do_job"; break; }
    const r = await chamarLLM(messages, { tools, maxTokens: SUB_MAX_TOKENS, reasoning: SUB_REASONING });
    if (r.erro) { relatorio = `(subagente ${nome} falhou: ${r.erro})`; finish = "erro_llm"; break; }
    const u = usoDe(r.parsed); tin += u.tin; tout += u.tout; reas += u.reas;
    finish = String(r.parsed?.choices?.[0]?.finish_reason ?? "");
    const msg = r.parsed?.choices?.[0]?.message;
    if (!msg) { relatorio = `(subagente ${nome}: resposta vazia do provider)`; break; }
    if (msg.tool_calls?.length) {
      messages.push(msg);
      for (const tc of msg.tool_calls) {
        const nomeTc = String(tc.function?.name ?? "");
        const jaUsou = usadas.filter((t) => t === nomeTc).length;
        const limite = cfg.maxPorTool[nomeTc] ?? 2;
        if (usadas.length >= cfg.maxToolsTotal || jaUsou >= limite || !cfg.tools.includes(nomeTc)) {
          messages.push({ role: "tool", tool_call_id: tc.id, content: JSON.stringify({
            erro: "consulta_nao_realizada",
            aviso: "Teto de consultas deste especialista atingido ou ferramenta fora do seu escopo. O dado NAO foi lido - nao trate como zero. Feche o relatorio com o que tem e registre em LACUNAS." }) });
          continue;
        }
        let args: any = {}; try { args = JSON.parse(tc.function?.arguments ?? "{}"); } catch { /* */ }
        const result = await runTool(nomeTc, args, ctx);
        usadas.push(nomeTc);
        messages.push({ role: "tool", tool_call_id: tc.id, content: JSON.stringify(result).slice(0, 14000) });
      }
      continue;
    }
    relatorio = String(msg.content ?? "");
    break;
  }
  if (!relatorio) {
    // Estourou iteracoes/prazo coletando: forca o relatorio com o que ha.
    messages.push({ role: "user", content: "PARE de usar ferramentas. Escreva AGORA o relatorio final com os dados ja coletados, terminando com a linha LACUNAS:." });
    const rf = await chamarLLM(messages, { maxTokens: SUB_MAX_TOKENS, reasoning: REASONING_OFF });
    if (!rf.erro) {
      const u = usoDe(rf.parsed); tin += u.tin; tout += u.tout;
      relatorio = String(rf.parsed?.choices?.[0]?.message?.content ?? "");
      finish = String(rf.parsed?.choices?.[0]?.finish_reason ?? finish) + "+forcado";
    }
  }
  // v1.1: CONTINUACAO INTERNA DO RELATORIO. Se o relatorio cortou em length, continua em
  // memoria (mesma tecnica da sintese: contexto preservado, zero re-coleta) ate fechar em
  // stop, esgotar as partes ou o prazo apertar. Sem tools de proposito: e hora de ESCREVER.
  let partes = relatorio ? 1 : 0;
  while (relatorio && finish.startsWith("length") && partes < SUB_RELATORIO_MAX_PARTES && prazo() > 25_000) {
    messages.push({ role: "assistant", content: relatorio });
    messages.push({ role: "user", content: "Seu relatorio foi cortado por limite de tamanho. Continue EXATAMENTE do ponto onde parou, na proxima palavra. Nao repita nada, nao reescreva secoes; ao concluir, termine com a linha LACUNAS:." });
    const maxTok = Math.max(1500, Math.min(SUB_MAX_TOKENS, Math.floor((prazo() / 1000) * TOKENS_POR_SEGUNDO)));
    const rc = await chamarLLM(messages, { maxTokens: maxTok, reasoning: REASONING_OFF });
    if (rc.erro) break;
    const u = usoDe(rc.parsed); tin += u.tin; tout += u.tout;
    const pedaco = String(rc.parsed?.choices?.[0]?.message?.content ?? "");
    if (!pedaco) break;
    relatorio += pedaco;
    finish = String(rc.parsed?.choices?.[0]?.finish_reason ?? "length");
    partes++;
  }
  const relatorioCompleto = !!relatorio && !finish.startsWith("length");
  if (!relatorio) relatorio = `(subagente ${nome}: sem relatorio - registre como lacuna do job)`;
  return { nome, relatorio, completo: relatorioCompleto, partes, tools: usadas, tokens_in: tin, tokens_out: tout, reasoning_tokens: reas, finish };
}

// ============================================================================
// FASE 3 - SINTESE com continuacao INTERNA (contexto preservado, zero re-coleta)
// ============================================================================
async function sintetizar(pergunta: string, relatorios: { nome: string; relatorio: string; completo: boolean }[], estilo: string, memoria: string, prazo: () => number, tel: any) {
  const sys = `Voce e o Gestor de Trafego IA da Legal e Viver. Hoje e ${today()}. Responde ao gestor (Roberto) em portugues brasileiro.
ESCOPO RIGIDO: somente trafego pago (midia, criativo, publico, orcamento, custo). Bancos, esteira interna, politica de credito, atendimento humano e conversao final do CRM estao FORA - se a pergunta tocar nisso, declare fora de escopo e siga.
REGRAS INEGOCIAVEIS: (R1) todo numero desta conta vem dos RELATORIOS INTERNOS abaixo, coletados agora por especialistas - se um numero nao esta neles, escreva 'nao disponivel'; NUNCA estime nem complete com plausibilidade. (R1b) conhecimento de plataforma (conceitos Meta) voce explica normalmente, separado de dado da conta. (R2) nunca afirme configuracao da conta sem dado. (R3) distinga zero / nao existe / nao coletado - os relatorios marcam LACUNAS. (R3b - CORTE NAO E INEXISTENCIA) alguns relatorios chegam marcados como INCOMPLETOS (cortados por limite de tamanho): o que nao esta neles pode MUITO BEM existir no sistema. Para esses, escreva 'o levantamento do especialista veio incompleto nesta rodada' - e PROIBIDO dizer 'nao disponivel', 'retornou vazio' ou tratar a ausencia como inexistencia. (R4) nao misture janelas. (R5) amostra pequena = hipotese. (R6) ordem das datas antes de causalidade. (R8) voce NAO executa acoes: se uma acao for recomendavel, descreva-a e diga que o gestor pode pedi-la no chat para virar pedido de aprovacao. (R9) incoerencia entre numeros: aponte. Sem jargao interno (nomes de ferramenta, codigos de regra, limites de implementacao).
FORMATO (regras vigentes do sistema):
${estilo}
MEMORIA INSTITUCIONAL (fatos verificados):
${memoria}
Responda a pergunta INTEIRA, bloco a bloco na ordem pedida, com numero + fonte ('levantamento interno de hoje') + ressalva. Escreva de forma continua ate concluir.`;
  const blocos = relatorios.map((r) => `=== RELATORIO ${r.nome} [${r.completo ? "COMPLETO" : "INCOMPLETO - cortado por limite de tamanho; ausencias aqui NAO significam que o dado nao existe"}] ===\n${r.relatorio}`).join("\n\n");
  const messages: any[] = [
    { role: "system", content: sys },
    { role: "user", content: `PERGUNTA DO GESTOR (responda por completo):\n${pergunta}\n\n=== RELATORIOS DOS ESPECIALISTAS (sua unica fonte de numeros da conta) ===\n${blocos}` },
  ];
  let texto = "", partes = 0, tin = 0, tout = 0, finish = "";
  while (partes < SINT_MAX_PARTES) {
    const restanteMs = prazo();
    if (restanteMs <= 0) { finish = (finish || "stop") + "+prazo_do_job"; break; }
    const maxTok = Math.max(1500, Math.min(SINT_MAX_TOKENS, Math.floor((restanteMs / 1000) * TOKENS_POR_SEGUNDO)));
    const r = await chamarLLM(messages, { maxTokens: maxTok, reasoning: REASONING_OFF });
    if (r.erro) { if (!texto) texto = `Nao consegui produzir a sintese (${r.erro}).`; finish = "erro_llm"; break; }
    const u = usoDe(r.parsed); tin += u.tin; tout += u.tout;
    const msg = r.parsed?.choices?.[0]?.message;
    const pedaco = String(msg?.content ?? "");
    finish = String(r.parsed?.choices?.[0]?.finish_reason ?? "");
    texto += pedaco;
    partes++;
    if (finish !== "length") break;
    // Continuacao interna: mesmo contexto em memoria - nada e re-coletado, nada se perde.
    messages.push({ role: "assistant", content: pedaco });
    messages.push({ role: "user", content: "Continue EXATAMENTE do ponto onde parou, na proxima palavra. Nao repita nada, nao reescreva titulos, nao cumprimente." });
  }
  tel.sintese = { partes, tokens_in: tin, tokens_out: tout, finish_reason: finish };
  if (finish === "length") texto += "\n\n*(resposta encerrada no limite de tamanho do processamento; peca a parte que faltou que eu completo)*";
  return texto;
}

// ============================================================================
// O JOB (roda em background via EdgeRuntime.waitUntil)
// ============================================================================
async function pushProgresso(jobId: string, fase: string, detalhe: string) {
  const { data } = await supa.from("chat_jobs").select("progresso").eq("id", jobId).maybeSingle();
  const arr = Array.isArray(data?.progresso) ? data!.progresso : [];
  arr.push({ fase, detalhe, em: new Date().toISOString() });
  await supa.from("chat_jobs").update({ progresso: arr }).eq("id", jobId);
}

async function processarJob(jobId: string, convId: string, companyId: string, pergunta: string, mcpKey: string) {
  const t0 = Date.now();
  const prazo = () => JOB_LIMIT_MS - (Date.now() - t0) - RESERVA_FINAL_MS;
  const tel: any = { versao: "job-v1.1", subagentes: [] };
  try {
    await supa.from("chat_jobs").update({ status: "running", started_at: new Date().toISOString() }).eq("id", jobId);

    // Contexto institucional (mesmas fontes do chat)
    const { data: ctxRows } = await supa.from("agent_context")
      .select("categoria,fato,desde").eq("vigente", true)
      .or(`company_id.is.null,company_id.eq.${companyId}`).order("categoria");
    const memoria = (ctxRows ?? []).length
      ? (ctxRows ?? []).map((r: any) => `- [${String(r.categoria).toUpperCase()}${r.desde ? " " + String(r.desde) : ""}] ${r.fato}`).join("\n")
      : "(sem fatos registrados)";
    const { data: styleRows } = await supa.from("agent_style").select("secao,regra").eq("vigente", true).order("ordem");
    const estilo = (styleRows ?? []).length
      ? (styleRows ?? []).map((r: any) => `- [${String(r.secao).toUpperCase()}] ${r.regra}`).join("\n")
      : "(sem regras cadastradas)";

    // FASE 1 - planner
    await pushProgresso(jobId, "planner", "escolhendo especialistas");
    const { plano, degradado } = await planejar(pergunta, tel);
    tel.plano = plano.map((p) => p.nome);
    tel.planner_degradado = degradado;
    await pushProgresso(jobId, "planner", `especialistas: ${plano.map((p) => p.nome).join(", ")}${degradado ? " (plano padrao - planejador nao devolveu JSON valido)" : ""}`);

    // FASE 2 - subagentes em paralelo
    await pushProgresso(jobId, "subagentes", `executando ${plano.length} em paralelo`);
    const resultados = await Promise.allSettled(
      plano.map((p) => rodarSubagente(p.nome, p.foco, pergunta, { companyId, mcpKey }, prazo)),
    );
    const relatorios: { nome: string; relatorio: string; completo: boolean }[] = [];
    for (let i = 0; i < resultados.length; i++) {
      const res = resultados[i];
      if (res.status === "fulfilled") {
        relatorios.push({ nome: res.value.nome, relatorio: res.value.relatorio, completo: res.value.completo });
        tel.subagentes.push({ nome: res.value.nome, tools: res.value.tools, tokens_in: res.value.tokens_in,
          tokens_out: res.value.tokens_out, reasoning_tokens: res.value.reasoning_tokens, finish: res.value.finish,
          partes_relatorio: res.value.partes, relatorio_completo: res.value.completo });
      } else {
        relatorios.push({ nome: plano[i].nome, relatorio: `(especialista falhou: ${String(res.reason).slice(0, 200)} - trate como LACUNA)`, completo: false });
        tel.subagentes.push({ nome: plano[i].nome, erro: String(res.reason).slice(0, 200), relatorio_completo: false });
      }
    }
    await pushProgresso(jobId, "subagentes", "relatorios prontos");

    // FASE 3 - sintese
    await pushProgresso(jobId, "sintese", "escrevendo a resposta final");
    const texto = await sintetizar(pergunta, relatorios, estilo, memoria, prazo, tel);

    tel.ms_total = Date.now() - t0;
    const finishSint = tel.sintese?.finish_reason ?? "stop";
    await supa.from("chat_messages").insert({
      conversation_id: convId, company_id: companyId, role: "assistant", content: texto, model: MODEL,
      tokens_in: (tel.planner?.tokens_in ?? 0) + tel.subagentes.reduce((a: number, s: any) => a + (s.tokens_in ?? 0), 0) + (tel.sintese?.tokens_in ?? 0),
      tokens_out: (tel.planner?.tokens_out ?? 0) + tel.subagentes.reduce((a: number, s: any) => a + (s.tokens_out ?? 0), 0) + (tel.sintese?.tokens_out ?? 0),
      diagnostico: { ...tel, finish_reason: finishSint, origem: "traffic-agent-job" },
    });
    await supa.from("chat_conversations").update({ updated_at: new Date().toISOString() }).eq("id", convId);
    await supa.from("chat_jobs").update({ status: "done", finished_at: new Date().toISOString(), diagnostico: tel }).eq("id", jobId);
  } catch (e) {
    const erro = String((e as any)?.message ?? e).slice(0, 500);
    tel.ms_total = Date.now() - t0;
    // Degradar com aviso, nunca em silencio: o gestor recebe uma mensagem, nao um vacuo.
    await supa.from("chat_messages").insert({
      conversation_id: convId, company_id: companyId, role: "assistant",
      content: "O processamento em segundo plano falhou antes de concluir. Tente de novo; se repetir, o problema esta registrado para o suporte tecnico.",
      model: MODEL, diagnostico: { ...tel, erro, origem: "traffic-agent-job", finish_reason: "erro_job" },
    }).then(() => {}, () => {});
    await supa.from("chat_jobs").update({ status: "error", erro, finished_at: new Date().toISOString(), diagnostico: tel }).eq("id", jobId);
  }
}

// ============================================================================
// HANDLER - responde rapido, processa depois.
// ============================================================================
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });
  if (req.method !== "POST") return json({ error: "POST only" }, 405);
  if (!OPENROUTER_KEY) return json({ error: "missing_openrouter_key" }, 500);

  const authz = req.headers.get("authorization") ?? "";
  const bearer = authz.toLowerCase().startsWith("bearer ") ? authz.slice(7).trim() : "";
  const mcpProvided = (req.headers.get("x-mcp-key") ?? "").trim() || bearer;
  const { data: cfg } = await supa.from("mcp_config").select("api_key").eq("id", 1).maybeSingle();
  let userId: string | null = null, authed = false;
  if (cfg?.api_key && mcpProvided === cfg.api_key) authed = true;
  else if (bearer) { const { data: u } = await supa.auth.getUser(bearer); if (u?.user) { authed = true; userId = u.user.id; } }
  if (!authed) return json({ error: "unauthorized" }, 401);

  let body: any = {};
  try { body = await req.json(); } catch { /* */ }
  const message = String(body?.message ?? "").trim();
  if (!message) return json({ error: "message obrigatorio" }, 400);

  const company = await resolveCompany(body?.company ? String(body.company) : undefined);
  if (!company) return json({ error: "empresa nao encontrada" }, 400);

  let convId: string | null = body?.conversation_id ?? null;
  if (convId) {
    const { data: conv } = await supa.from("chat_conversations").select("id").eq("id", convId).maybeSingle();
    if (!conv) convId = null;
  }
  if (!convId) {
    const { data: conv, error: ce } = await supa.from("chat_conversations")
      .insert({ company_id: company.id, title: message.slice(0, 60), kind: "chat", created_by: userId })
      .select("id").single();
    if (ce) return json({ error: "conv_create_failed", detail: ce.message }, 500);
    convId = conv.id;
  }

  await supa.from("chat_messages").insert({ conversation_id: convId, company_id: company.id, role: "user", content: message, user_id: userId });

  const { data: job, error: je } = await supa.from("chat_jobs")
    .insert({ conversation_id: convId, company_id: company.id, user_id: userId, message, status: "queued" })
    .select("id").single();
  if (je) return json({ error: "job_create_failed", detail: je.message }, 500);

  // O ponto que remove o teto de 150s: responde JA e continua em background.
  // deno-lint-ignore no-explicit-any
  (globalThis as any).EdgeRuntime?.waitUntil
    ? (globalThis as any).EdgeRuntime.waitUntil(processarJob(job.id, convId!, company.id, message, cfg?.api_key ?? ""))
    : processarJob(job.id, convId!, company.id, message, cfg?.api_key ?? "");

  return json({ ok: true, async: true, job_id: job.id, conversation_id: convId,
    aviso: "processando em segundo plano; a resposta chega na conversa (Realtime) e o ciclo de vida esta em chat_jobs" }, 202);
});
