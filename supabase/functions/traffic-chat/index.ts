// supabase/functions/traffic-chat/index.ts (v20)
// v20 - REDUCAO DE CUSTO DE TOKENS + TETO DE FERRAMENTAS:
//   (1) PROMPT CACHING (anthropic via openrouter, cache_control ephemeral) no system prompt
//       e na pergunta do usuario. Medicao que motivou: o turno de 18:35 gastou 66.395
//       tokens de input em 3 rodadas, e quase todo o conteudo era IDENTICO entre elas
//       (system 1.700 + memoria 1.900 + tools 1.300 + pergunta 2.500 tokens). Cache read
//       custa 0,1x. NAO marcamos os tool results: mensagens role:"tool" nao aceitam blocos
//       com cache_control de forma confiavel, e nao vale arriscar o protocolo. Economia
//       esperada ~25-30% do input das rodadas 2+, nao os 65% de uma versao ideal.
//   (2) TELEMETRIA DE CUSTO: cache_creation/cache_read gravados em chat_messages.diagnostico.
//       Este projeto nao tinha nenhuma medicao de custo de LLM - agora tem.
//   (3) TETO DE 8 FERRAMENTAS POR TURNO. Medido: 2 turnos consecutivos usaram 14 tools
//       cada, incluindo 5 chamadas ao compliance-check (3-6s cada). O modelo nao tem
//       nocao de orcamento. Ao estourar, cada tool_call recebe resposta declarando o teto -
//       obrigatorio, porque a API exige uma resposta para CADA tool_call_id.
//   (5) FALLBACK DE CACHE: se o provider rejeitar cache_control com 4xx, remove o campo,
//       retenta e desativa o cache pelo resto do turno. Sem isso, um campo opcional nao
//       aceito derrubaria TODO turno com 502, nao apenas os grandes.
//   (4) Corte da lista bruta de criativos 11.500 -> 4.000 chars. Depois do dedupe do v19,
//       legendas_unicas cobre o que compliance precisa; a lista peca-por-peca perdeu uso.
// v19 - ORCAMENTO DE TEMPO (fim dos 504) + DIAGNOSTICO PERSISTIDO + DEDUPE DE LEGENDA:
//   (1) DEADLINE. Evidencia medida em 27/07: 5 respostas 504 em v21/v22/v23, todas com
//       execution_time_ms entre 150.094 e 151.004 - e um 200 em 149.508ms, ou seja passou
//       por 492ms. O sistema operava colado no teto de 150s e o resultado era sorteio.
//       v13/v16/v17 tentaram resolver reduzindo tokens; nenhuma resolveu porque o custo
//       real vem do NUMERO de rodadas de tool, nao do tamanho da geracao. Agora ha
//       orcamento explicito: para de chamar tools em TOOLS_DEADLINE_MS e vai para a
//       sintese, com max_tokens calculado pelo tempo que sobrou. Mesmo padrao que salvou
//       o windsor-sync v15: garantir a entrega do que ja foi coletado.
//   (2) DIAGNOSTICO PERSISTIDO em chat_messages.diagnostico (migracao
//       add_chat_messages_diagnostico). Antes, preambulos_detectados/recuperados existiam
//       so na resposta HTTP - instrumentacao que nao era observavel depois do instante.
//   (3) DEDUPE DE LEGENDA em get_criativos_conteudo: campo novo legendas_unicas, calculado
//       sobre a lista COMPLETA antes do corte. Resolve o audit retroativo de compliance,
//       que antes ficava incompleto porque 13 de 32 criativos eram omitidos pelo corte.
// v18 - EXPOSICAO DAS RPCs DE CONTEUDO/ESTRUTURA + CORRECAO DO TEXTO DESCARTADO (27/07):
//   (1) Duas tools novas: get_criativos_conteudo (legenda/titulo/CTA/imagem dos anuncios)
//       e get_estrutura_conjuntos (CBO vs ABO, orcamento, lance, targeting). Os dados
//       JA estavam no banco desde sempre - o que faltava era exposicao ao agente.
//   (2) CORTE ESTRUTURADO POR BYTES (nao previsto no briefing original): as duas RPCs
//       devolvem 19.900 / 27.504 / 61.844 bytes, ACIMA do slice(0,14000) aplicado a todo
//       resultado de tool. Sem tratamento o modelo receberia JSON cortado no meio -
//       falha silenciosa e violacao pratica de R1/R3. As funcoes agora cortam a LISTA
//       preservando JSON valido e declarando exibidos/omitidos/aviso.
//   (3) BUG DO TEXTO DESCARTADO corrigido: quando o modelo emitia texto JUNTO com
//       tool_calls na mesma mensagem, o loop empilhava a msg e o texto nunca chegava a
//       'reply'. Agora e acumulado em preambulos[] e emendado. Heuristica: so emenda
//       texto substantivo (>=120 chars) para nao poluir com "vou consultar os dados";
//       se 'reply' terminar vazio, emenda tudo como resgate. Contador exposto no retorno.
//   (4) Regra de FORMATO: compliance pode ser auditado SEM pedir texto ao usuario.
// v17 - AJUSTE CRITICO DE TEMPO (incidente 504 em 27/07):
//   (1) MAX_TOKENS 10000 -> 6000. Motivo medido: a plataforma mata a requisicao em 150s
//       (IDLE_TIMEOUT) e uma geracao de 10k tokens leva ~120s; somando as tool calls,
//       estourava e o usuario recebia 504 (perdia a resposta inteira).
//       Com 6000 tokens (~70s) + tools (~20s) sobra margem folgada.
//   (2) REMOVIDO o loop de continuacao no SERVIDOR. Quem costura agora e o FRONT
//       (commit 6908ec9): ele detecta finish_reason=length e faz nova requisicao no mesmo
//       conversation_id, ate 3 vezes. Duas costuras (servidor + front) seriam redundantes
//       e a do servidor garantiria o timeout, pois ambas as geracoes cairiam na mesma
//       requisicao. Teto efetivo agora: 4 chamadas x 6000 = ~24000 tokens de resposta.
//   (3) finish_reason continua no retorno - e o sinal que o front usa.
// v15: memoria institucional (agent_context) + protocolo de raciocinio + anti-alucinacao.
// v14: get_funil_credito. v12: MAX_ITER 10 + sintese final garantida.
// Auth: Bearer <user JWT> OU x-mcp-key.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const OPENROUTER_KEY = (Deno.env.get("OPENROUTER_API_KEY") ?? "").trim();
const MODEL = (Deno.env.get("OPENROUTER_MODEL") ?? "anthropic/claude-sonnet-5").trim();
const MAX_ITER = 10;
// v20: teto de ferramentas por turno. 14 tools medidas em 2 turnos consecutivos, com 5
// chamadas ao compliance-check a 3-6s cada. Corta tempo e tokens ao mesmo tempo.
const MAX_TOOLS_TURNO = 8;
const MAX_TOKENS = 6000;
const HIST = 24;
// v19 - orcamento de tempo. Teto da plataforma = 150s (IDLE_TIMEOUT, nao configuravel).
// Calibrado com os logs de 27/07: sucessos entre 38s e 102s; o de 149,5s passou por 492ms.
// TOOLS_DEADLINE: para de coletar aqui, deixando espaco para a sintese final.
// HARD_LIMIT: teto proprio abaixo de 150s, com folga para gravar no banco.
const TOOLS_DEADLINE_MS = 75_000;
const HARD_LIMIT_MS = 143_000;
const RESERVA_GRAVACAO_MS = 6_000;
// Sonnet gera ~85 tok/s; usamos 60 para ser conservador.
const TOKENS_POR_SEGUNDO = 60;

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

const IMG_MIMES = ["image/png", "image/jpeg", "image/jpg", "image/webp", "image/gif"];
const SHEET_MIMES = ["application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", "application/vnd.ms-excel", "text/csv"];
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
    return { text: `[PLANILHA CSV "${name}"${linhas.length > 400 ? ` - TRUNCADA em 400 de ${linhas.length}` : ""}]\n` + linhas.slice(0, 400).join("\n"), nota: `${linhas.length} linha(s)` };
  }
  const XLSX = await import("https://esm.sh/xlsx@0.18.5");
  const wb = XLSX.read(b64ToU8(b64), { type: "array" });
  const partes: string[] = [];
  let total = 0;
  for (const sn of wb.SheetNames) {
    const csv: string = XLSX.utils.sheet_to_csv(wb.Sheets[sn]);
    const linhas = csv.split("\n").filter((l) => l.trim() !== "");
    total += linhas.length;
    const usadas = partes.reduce((a, p) => a + p.split("\n").length, 0);
    const corte = linhas.slice(0, Math.max(0, 400 - usadas));
    if (corte.length) partes.push(`--- aba: ${sn} (${linhas.length} linhas) ---\n` + corte.join("\n"));
  }
  return { text: `[PLANILHA "${name}" -> CSV${total > 400 ? " (TRUNCADA em 400)" : ""}]\n` + partes.join("\n\n"), nota: `${wb.SheetNames.length} aba(s), ${total} linha(s)` };
}

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
  return { recomendacoes_pendentes: data ?? [], nota: "regua destas recomendacoes e custo de MIDIA, nao contrato pago. Antes de aprovar escala, cruze com get_funil_credito." };
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
    nota: "funil de MIDIA. Proposta/contrato/receita: use get_funil_credito COM A MESMA JANELA." };
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
    nota: "ranking por custo de MIDIA (formulario/conversa). NAO e ranking por contrato pago - para receita use get_funil_credito.por_campanha (campo criativo_utm_content)." };
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
async function t_funil_credito(dias: number) {
  const { data, error } = await supa.rpc("get_funil_credito", { p_dias: dias });
  if (error) return { erro: `falha ao ler conversao final: ${error.message}` };
  return data;
}

// v18: corte estruturado. Todo resultado de tool passa por slice(0,14000) antes de ir ao
// modelo. get_criativos_conteudo devolve 19.900 bytes (somente ativas) ou 61.844 (todas) e
// get_estrutura_conjuntos devolve 27.504 - todos acima do teto. Cortar bytes crus quebraria
// o JSON no meio e o modelo receberia dado mutilado sem saber (falha silenciosa). Aqui a
// LISTA e reduzida item a item preservando JSON valido, e o que ficou de fora e DECLARADO.
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
    out.aviso_corte = `A lista '${campo}' foi truncada para caber no limite de payload: ${mantidos.length} de ${lista.length} itens enviados. Os ${omitidos} restantes EXISTEM no banco mas NAO foram enviados nesta chamada - nao os trate como inexistentes nem como zero. Se precisar deles, peca um recorte mais estreito.`;
  }
  return out;
}
async function t_criativos_conteudo(somenteAtivas: boolean) {
  const { data, error } = await supa.rpc("get_criativos_conteudo", { p_somente_ativas: somenteAtivas });
  if (error) return { erro: `falha ao ler conteudo dos criativos: ${error.message}` };
  if (!data || typeof data !== "object") return { erro: "retorno inesperado de get_criativos_conteudo" };
  const obj = data as Record<string, unknown>;
  // v19: agrupa por legenda ANTES do corte. Varios anuncios compartilham o mesmo texto
  // (variacoes do mesmo criativo), entao o conjunto de textos distintos e muito menor que
  // a lista de pecas - e e o que compliance precisa. Isso torna a auditoria retroativa
  // COMPLETA mesmo quando a lista de criativos vem truncada.
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
  // v20: lista bruta cortada em 4.000 (era 11.500). O dedupe do v19 tornou legendas_unicas
  // a fonte util para compliance; a lista peca-por-peca serve so para contexto.
  const cortado = cortarLista(obj, "criativos", 4000) as Record<string, unknown>;
  const comUnicas = cortarLista({ ...cortado, legendas_unicas: unicas,
    total_legendas_distintas: unicas.length,
    nota_legendas: "legendas_unicas cobre TODOS os criativos coletados, inclusive os omitidos da lista 'criativos'. Use esta lista para auditoria de compliance completa: cada texto distinto precisa ser checado uma vez, nao uma vez por anuncio.",
  }, "legendas_unicas", 6500);
  return { ...comUnicas, somente_campanhas_ativas: somenteAtivas };
}
async function t_estrutura_conjuntos() {
  const { data, error } = await supa.rpc("get_estrutura_conjuntos");
  if (error) return { erro: `falha ao ler estrutura dos conjuntos: ${error.message}` };
  if (!data || typeof data !== "object") return { erro: "retorno inesperado de get_estrutura_conjuntos" };
  return cortarLista(data as Record<string, unknown>, "conjuntos");
}

type CardInfo = { approval_id: string; action: string; entity_type: string; target_name: string; summary: string; params: any; status: string };
async function t_propose_action(companyId: string, convId: string, requestedBy: string, args: any, cards: CardInfo[]) {
  const action = String(args?.action_type ?? "");
  const targetLike = String(args?.target_name ?? "").trim();
  const justificativa = String(args?.justificativa ?? "").trim();
  const params = args?.params ?? {};
  const VALID = ["pausar_criativo", "escalar_criativo", "pausar_campanha", "alterar_orcamento"];
  if (!VALID.includes(action)) return { erro: `action_type invalido; use: ${VALID.join(", ")}` };
  if (!targetLike) return { erro: "target_name obrigatorio" };
  if (!justificativa) return { erro: "justificativa obrigatoria com numeros reais" };
  if (action === "alterar_orcamento" && !(Number(params?.novo_orcamento_diario_reais) > 0)) return { erro: "informe params.novo_orcamento_diario_reais (> 0)" };
  const needle = norm(targetLike);
  const isAd = action === "pausar_criativo" || action === "escalar_criativo";
  let matches: { id: string; name: string; external_id?: string }[] = [];
  if (isAd) {
    const { data: camps } = await supa.from("campaigns").select("id").eq("company_id", companyId).eq("status", "active");
    const campIds = (camps ?? []).map((c) => c.id);
    const { data: ads } = await supa.from("ads").select("id,name,external_id,campaign_id").eq("company_id", companyId);
    matches = (ads ?? []).filter((a) => campIds.includes(a.campaign_id) && norm(a.name).includes(needle));
  } else {
    const { data: camps } = await supa.from("campaigns").select("id,name,external_id").eq("company_id", companyId);
    matches = (camps ?? []).filter((c) => norm(c.name).includes(needle));
  }
  if (!matches.length) return { erro: `nenhum alvo contendo '${targetLike}'. NAO invente: pergunte o nome correto.` };
  let alvo = matches[0];
  if (matches.length > 1) {
    const exact = matches.filter((m) => norm(m.name) === needle);
    if (exact.length === 1) alvo = exact[0];
    else return { ambiguo: true, opcoes: matches.slice(0, 6).map((m) => m.name), instrucao: "peca o NOME COMPLETO EXATO" };
  }
  const entityType = action === "alterar_orcamento" ? "budget" : (isAd ? "ad" : "campaign");
  const summary = ({ pausar_criativo: `Pausar o criativo "${alvo.name}"`, escalar_criativo: `Escalar o criativo "${alvo.name}"`,
    pausar_campanha: `Pausar a campanha "${alvo.name}"`,
    alterar_orcamento: `Alterar orcamento diario de "${alvo.name}" para ${brl(Number(params?.novo_orcamento_diario_reais ?? 0))}` } as Record<string, string>)[action];
  const { data: ins, error: ie } = await supa.from("approval_requests").insert({
    company_id: companyId, requested_by: requestedBy, conversation_id: convId, entity_type: entityType,
    entity_id: alvo.id, action, summary,
    payload: { ...params, target_name: alvo.name, target_external_id: alvo.external_id ?? null, justificativa, proposto_por: "traffic-chat" },
    status: "pending",
  }).select("id").single();
  if (ie) return { erro: `falha ao criar pedido: ${ie.message}` };
  await supa.from("audit_log").insert({ company_id: companyId, user_id: requestedBy, action: "approval_created",
    target_type: "approval_request", target_id: ins.id, details: { acao: action, alvo: alvo.name, justificativa, origem: "edge:traffic-chat" } });
  cards.push({ approval_id: ins.id, action, entity_type: entityType, target_name: alvo.name, summary, params, status: "pending" });
  return { ok: true, approval_id: ins.id, resumo: summary, aviso: "Pedido PENDENTE. Nada foi executado." };
}
async function t_check_compliance(legenda: string, imgAtts: { mime: string; b64: string }[], mcpKey: string) {
  const img = imgAtts[0];
  if (!legenda && !img) return { erro: "forneca a legenda e/ou anexe o criativo" };
  const body: any = {};
  if (legenda) body.legenda = legenda;
  if (img) { body.image_base64 = img.b64; body.mime = img.mime; }
  const r = await fetch(`${SUPABASE_URL}/functions/v1/compliance-check`, { method: "POST", headers: { "content-type": "application/json", "x-mcp-key": mcpKey }, body: JSON.stringify(body) });
  const t = await r.text();
  try { return JSON.parse(t); } catch { return { erro: `compliance-check falhou (${r.status})` }; }
}

const TOOLS = [
  { type: "function", function: { name: "get_overview", description: "Visao geral de MIDIA: campanhas ativas (status real da Meta), gasto e resultados dos ultimos 7 dias, com dias_com_dado para checar cobertura.", parameters: { type: "object", properties: {} } } },
  { type: "function", function: { name: "get_alerts", description: "Alertas ativos do sistema (CPL, entrega, BM/politica, cobranca, WABA).", parameters: { type: "object", properties: {} } } },
  { type: "function", function: { name: "get_recommendations", description: "Recomendacoes pendentes da IA (regua = custo de midia, nao contrato pago).", parameters: { type: "object", properties: {} } } },
  { type: "function", function: { name: "get_targets", description: "Metas e tetos de custo vigentes.", parameters: { type: "object", properties: {} } } },
  { type: "function", function: { name: "get_funnel", description: "Funil de MIDIA num periodo, com cobertura_real (dias efetivamente com dado). Nao contem proposta/contrato.", parameters: { type: "object", properties: { date_from: { type: "string" }, date_to: { type: "string" } } } } },
  { type: "function", function: { name: "get_ads_ranking", description: "Ranking de criativos por custo de MIDIA numa janela de dias.", parameters: { type: "object", properties: { days: { type: "number" } } } } },
  { type: "function", function: { name: "get_campaign_detail", description: "Detalhe e serie diaria (14d) de uma campanha pelo nome.", parameters: { type: "object", properties: { name_like: { type: "string" } }, required: ["name_like"] } } },
  { type: "function", function: { name: "get_funil_credito", description: "CONVERSAO FINAL DO TRAFEGO (fonte: CRM/Dash da Legal + gasto Meta). Retorna leads, propostas, CONTRATOS PAGOS, volume financiado, ticket, CAC por contrato pago, cobertura de UTM POR MES e contratos pagos POR CAMPANHA e POR CRIATIVO (utm_content). Use para qualquer pergunta de receita, CAC, retorno, atribuicao ou 'o que realmente vende'. NAO retorna dado por banco: analise de banco/esteira esta fora do escopo.", parameters: { type: "object", properties: { dias: { type: "number", description: "janela em dias (default 90). Use a MESMA janela do get_funnel ao comparar." } } } } },
  { type: "function", function: { name: "propose_action", description: "Cria PEDIDO DE APROVACAO (ActionCard) para pausar/escalar criativo, pausar campanha ou alterar orcamento. NAO executa.", parameters: { type: "object", properties: { action_type: { type: "string", enum: ["pausar_criativo", "escalar_criativo", "pausar_campanha", "alterar_orcamento"] }, target_name: { type: "string" }, justificativa: { type: "string" }, params: { type: "object" } }, required: ["action_type", "target_name", "justificativa"] } } },
  { type: "function", function: { name: "check_compliance", description: "GUARDIAO DE COMPLIANCE: valida legenda e/ou criativo contra base de regras versionada.", parameters: { type: "object", properties: { legenda: { type: "string" } } } } },
  { type: "function", function: { name: "get_criativos_conteudo", description: "CONTEUDO REAL DOS ANUNCIOS ja coletado pelo sync: legenda (texto do anuncio), titulo, CTA, se tem imagem, gasto acumulado, formularios e status. Use para auditar compliance das pecas EM OPERACAO sem pedir o texto ao usuario (pegue a legenda aqui e passe para check_compliance), e para qualquer pergunta sobre o que os anuncios dizem. Pode vir truncado: leia os campos exibidos/omitidos/aviso_corte e nunca trate item omitido como inexistente.", parameters: { type: "object", properties: { somente_ativas: { type: "boolean", description: "true (recomendado) = so criativos em campanha ativa; false = historico completo, payload maior e mais truncado." } } } } },
  { type: "function", function: { name: "get_estrutura_conjuntos", description: "ESTRUTURA DOS CONJUNTOS: CBO vs ABO (deduzido de onde esta o orcamento), orcamento diario/vitalicio, estrategia de lance (bid_strategy) e targeting (pais, faixa de idade, interesses). Use para perguntas de estrutura de conta, sobreposicao de publico e estrategia de lance. Traz resumo_orcamento agregado e limite_conhecido. NAO contem historico de ALTERACOES de orcamento (exigiria o endpoint /activities da Graph).", parameters: { type: "object", properties: {} } } },
];

async function runTool(name: string, args: any, ctx: any) {
  try {
    switch (name) {
      case "get_overview": return await t_overview(ctx.companyId);
      case "get_alerts": return await t_alerts(ctx.companyId);
      case "get_recommendations": return await t_recos(ctx.companyId);
      case "get_targets": return await t_targets(ctx.companyId);
      case "get_funnel": return await t_funnel(ctx.companyId, args?.date_from, args?.date_to);
      case "get_ads_ranking": return await t_ads_ranking(ctx.companyId, Number(args?.days ?? 7));
      case "get_campaign_detail": return await t_campaign_detail(ctx.companyId, String(args?.name_like ?? ""));
      case "get_funil_credito": return await t_funil_credito(Number(args?.dias ?? 90));
      case "propose_action": return await t_propose_action(ctx.companyId, ctx.convId, ctx.requestedBy, args, ctx.cards);
      case "check_compliance": return await t_check_compliance(String(args?.legenda ?? "").trim(), ctx.imgAtts, ctx.mcpKey);
      case "get_criativos_conteudo": return await t_criativos_conteudo(args?.somente_ativas === false ? false : true);
      case "get_estrutura_conjuntos": return await t_estrutura_conjuntos();
      default: return { erro: `tool desconhecida: ${name}` };
    }
  } catch (e) { return { erro: String((e as any)?.message ?? e) }; }
}

function systemPrompt(companyName: string, memoria: string) {
  return `Voce e o Gestor de Trafego IA da ${companyName}. Hoje e ${today()}. Responde ao gestor (Roberto) em portugues brasileiro.

== ESCOPO (limite rigido) ==
Voce cuida EXCLUSIVAMENTE de TRAFEGO PAGO: midia, criativo, publico, orcamento, custo, atribuicao e a conversao final que prova se o trafego comprado virou negocio.
O CRM/Dash da Legal e usado SOMENTE como fonte da conversao final (proposta, contrato pago) que a Meta nao fornece.
ESTA FORA DO SEU ESCOPO e voce NAO comenta, analisa nem recomenda: relacao com bancos, roteamento de propostas, esteira interna, politica de credito, operacao de atendimento humano, margem por banco, processos internos. Se perguntarem, responda que isso e tratado internamente pela Legal e siga para o que e trafego.

== PROTOCOLO OBRIGATORIO ANTES DE RESPONDER ==
1. PLANEJE: identifique o que a pergunta exige e QUAIS tools trazem cada parte. Prefira chamar as tools necessarias na MESMA rodada.
2. COLETE: rode as tools. Nunca responda de memoria sobre numeros - so o que a tool devolveu nesta conversa vale como dado.
3. CONFIRA cada numero antes de escrever: (a) de qual tool veio? (b) qual periodo exato? (c) a cobertura de dados cobre esse periodo inteiro (campos dias_com_dado / cobertura_real / cobertura)? (d) o denominador e estavel ou esta em ingestao?
4. SEGMENTE antes de concluir tendencia: medias historicas escondem mudancas. Se houver serie por mes (ex.: atribuicao.por_mes), leia o mes mais recente, nao a media.
5. RESPONDA com numero + fonte + ressalva. Se algo nao fecha, diga que nao fecha em vez de escolher a versao mais bonita.

== REGRAS ANTI-ALUCINACAO (nao negociaveis) ==
R1. Todo numero citado precisa ter vindo de uma tool nesta conversa. Se nao veio, escreva "nao disponivel" e diga qual fonte precisaria ser integrada. NUNCA estime, arredonde de cabeca ou complete lacuna com plausibilidade.
R2. NUNCA afirme como funciona a configuracao ou o canal de captacao (formulario instantaneo, landing page, WhatsApp, CBO/ABO, categoria especial, publico, pixel) sem dado de tool que prove. Se nao tem tool, diga que precisa checar no Gerenciador.
R3. Distinga tres coisas diferentes: (a) o dado e ZERO, (b) o dado NAO EXISTE no sistema, (c) o dado NAO FOI COLETADO no periodo (sync/cobertura). Nunca trate (b) ou (c) como (a).
R4. PROIBIDO misturar janelas temporais no mesmo raciocinio ou funil. Se as fontes tem janelas diferentes, ou iguale as janelas ou declare explicitamente que a comparacao nao e valida.
R5. Amostra pequena nao vira conclusao. Poucos resultados = hipotese, e diga o volume.
R6. Correlacao temporal nao e causa. Verifique a ORDEM das datas antes de afirmar causalidade; se houver causa mais simples e anterior, prefira ela.
R7. Nao invente nome de campanha, criativo, banco ou pessoa. Se a busca nao achou, pergunte.
R8. Ao citar uma acao, jamais diga que executou: acoes viram card PENDENTE de aprovacao.
R9. Se voce mesmo percebeu uma incoerencia entre dois numeros, aponte a incoerencia na resposta.
R10. Ao repassar dados de uma tool que traz campo 'avisos' ou 'nota', incorpore essas ressalvas.

== COMO PENSAR COMO SENIOR ==
- Dinheiro acima de volume: quando existir contrato pago, ele manda mais que CPL. Ranking por receita vem de get_funil_credito.por_campanha; ranking por custo de midia vem de get_ads_ranking. Nunca troque um pelo outro.
- Va da metrica para a decisao: diga o que fazer, com qual numero, e qual o risco.
- Prefira a explicacao mais simples e verificavel. Antes de teoria elaborada: a campanha esta ativa? teve entrega? o dado chegou?
- "nao sei" e melhor que numero inventado; "provavel, porque X" e melhor que afirmacao seca.

== GLOSSARIO ==
Lead(LP) = clique no link. Formulario = form preenchido. Conversa = WhatsApp iniciado (linha separada, nao etapa). Proposta / contrato pago = CRM, via get_funil_credito. volume_financiado = total do contrato, NAO comissao: nunca chame de lucro nem de ROAS.

== FORMATO ==
Denso e sem enfeite: destaque o numero que decide, tabela quando houver 3+ numeros comparaveis, R$ com 2 casas, datas DD/MM. Sem preambulo, sem repetir a pergunta, sem repetir a mesma ressalva em varios blocos.
Em pedido amplo: rode 3-5 tools relevantes e responda bloco a bloco na ordem pedida. Para cada item indisponivel, UMA linha dizendo o que integrar.
Compliance: voce NAO precisa pedir o texto do anuncio ao usuario. Pegue a legenda real com get_criativos_conteudo e passe para check_compliance. Se uma tool devolver 'omitidos'/'aviso_corte', diga quantos itens ficaram fora e nao conclua nada sobre eles. Escreva de forma continua ate acabar - se a mensagem for cortada por limite, o sistema emenda a continuacao automaticamente, entao NAO pare voluntariamente nem pergunte se pode continuar. Nunca responda "nao consegui".

== MEMORIA INSTITUCIONAL (fatos verificados desta conta - considere sempre) ==
${memoria}`;
}

Deno.serve(async (req) => {
  // v19: cronometro comeca AQUI, nao depois dos anexos. Processar planilha/PDF grande
  // consome segundos que precisam entrar no orcamento, senao o teto de 143s e estourado
  // por fora e volta o 504.
  const tInicio = Date.now();
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
  const rawAtts: any[] = Array.isArray(body?.attachments) ? body.attachments.slice(0, 4) : [];
  if (!message && !rawAtts.length) return json({ error: "message obrigatorio" }, 400);

  const company = await resolveCompany(body?.company ? String(body.company) : undefined);
  if (!company) return json({ error: "empresa nao encontrada" }, 400);

  const { data: ctxRows } = await supa.from("agent_context")
    .select("categoria,fato,desde").eq("vigente", true).order("categoria");
  const memoria = (ctxRows ?? []).length
    ? (ctxRows ?? []).map((r: any) => `- [${String(r.categoria).toUpperCase()}${r.desde ? " " + String(r.desde) : ""}] ${r.fato}`).join("\n")
    : "(sem fatos registrados)";

  let requestedBy = userId;
  if (!requestedBy) {
    const { data: adm } = await supa.from("user_roles").select("user_id").eq("role", "admin").limit(1).maybeSingle();
    requestedBy = adm?.user_id ?? null;
  }

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
  const imgAtts: { mime: string; b64: string }[] = [];
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
        attMeta.push({ name, mime, kb: sizeKb, tipo: "imagem" }); imgAtts.push({ mime, b64 });
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
      } else attNotas.push(`"${name}" tipo nao suportado (${mime || "desconhecido"})`);
    } catch (e) { attNotas.push(`"${name}" falhou: ${String((e as any)?.message ?? e).slice(0, 120)}`); }
  }
  const msgText = message || "Analise o(s) anexo(s).";
  userContent.unshift({ type: "text", text: msgText + (attNotas.length ? `\n\n[avisos de anexo: ${attNotas.join("; ")}]` : "") });

  const { data: hist } = await supa.from("chat_messages").select("role,content").eq("conversation_id", convId)
    .in("role", ["user", "assistant"]).order("created_at", { ascending: false }).limit(HIST);
  const history = (hist ?? []).reverse().map((m) => ({ role: m.role, content: (m.content ?? "").slice(0, 6000) }));

  await supa.from("chat_messages").insert({ conversation_id: convId, company_id: company.id, role: "user", content: msgText, user_id: userId, attachments: attMeta.length ? attMeta : null });

  // v20: prompt caching. cache_control marca o bloco como cacheavel; leituras subsequentes
  // do MESMO prefixo custam 0,1x. O system (escopo+protocolo+regras+memoria, ~3.600 tokens)
  // e a pergunta atual sao identicos em todas as rodadas do turno. TTL ~5min, e as rodadas
  // ocorrem em segundos. Anthropic exige minimo ~1024 tokens por bloco: o system passa;
  // a pergunta so e marcada se for texto simples e suficientemente longa.
  const cacheSystem = [{ type: "text", text: systemPrompt(company.name, memoria),
    cache_control: { type: "ephemeral" } }];
  const perguntaSimples = userContent.length === 1;
  const perguntaCacheavel = perguntaSimples && msgText.length >= 4000;
  const userMsgContent: any = perguntaCacheavel
    ? [{ type: "text", text: msgText, cache_control: { type: "ephemeral" } }]
    : (perguntaSimples ? msgText : userContent);
  const messages: any[] = [{ role: "system", content: cacheSystem }, ...history,
    { role: "user", content: userMsgContent }];
  const toolsUsed: any[] = [];
  const actionCards: CardInfo[] = [];
  const ctx = { companyId: company.id, convId: convId!, requestedBy: requestedBy!, cards: actionCards, imgAtts, mcpKey: cfg?.api_key ?? "" };
  let tokensIn = 0, tokensOut = 0, reply = "", iteracoes = 0, finishReason = "";
  // v19: buffer do texto emitido JUNTO com tool_calls, que antes era descartado.
  const preambulos: string[] = [];
  // v19: orcamento dinamico de geracao (tInicio declarado no topo do handler).
  const decorrido = () => Date.now() - tInicio;
  let deadlineTools = false;
  // v20: telemetria de custo. Capturamos os dois formatos possiveis - anthropic
  // (cache_creation_input_tokens / cache_read_input_tokens) e openai
  // (prompt_tokens_details.cached_tokens) - porque nao esta confirmado qual o OpenRouter
  // repassa para o claude-sonnet-5. Se ambos vierem zerados, o caching NAO esta pegando.
  let cacheWrite = 0, cacheRead = 0, tetoTools = false;
  function somarCache(usage: any) {
    cacheWrite += Number(usage?.cache_creation_input_tokens ?? 0);
    cacheRead += Number(usage?.cache_read_input_tokens ?? 0)
      + Number(usage?.prompt_tokens_details?.cached_tokens ?? 0);
  }
  function tokensDisponiveis() {
    const restanteMs = HARD_LIMIT_MS - decorrido() - RESERVA_GRAVACAO_MS;
    if (restanteMs <= 0) return 600;
    const est = Math.floor((restanteMs / 1000) * TOKENS_POR_SEGUNDO);
    return Math.max(600, Math.min(MAX_TOKENS, est));
  }

  // v20: fallback de cache. Nao esta confirmado que o OpenRouter aceita cache_control para
  // o claude-sonnet-5. Se ele IGNORAR o campo, tudo funciona sem cache (inofensivo). Se
  // REJEITAR com 4xx, sem este fallback a edge devolveria 502 em TODO turno - queda total
  // do chat por um campo opcional. Aqui: na primeira rejeicao, remove cache_control,
  // retenta, e desativa o cache pelo resto do turno para nao dobrar chamadas.
  let cacheDesativado = false, cacheRejeitado = false;
  function semCache(ms: any[]) {
    return ms.map((m) => {
      if (!Array.isArray(m.content)) return m;
      return { ...m, content: m.content.map((b: any) => {
        if (b && typeof b === "object" && "cache_control" in b) {
          const { cache_control: _drop, ...resto } = b; return resto;
        }
        return b;
      }) };
    });
  }

  async function chamar(comTools: boolean, maxTokens = MAX_TOKENS): Promise<any> {
    const usarCache = !cacheDesativado;
    const payload: any = { model: MODEL, messages: usarCache ? messages : semCache(messages), max_tokens: maxTokens };
    if (comTools) { payload.tools = TOOLS; payload.tool_choice = "auto"; }
    const resp = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${OPENROUTER_KEY}` }, body: JSON.stringify(payload),
    });
    const text = await resp.text();
    if (!resp.ok) {
      if (usarCache && (resp.status === 400 || resp.status === 422)) {
        cacheDesativado = true; cacheRejeitado = true;
        return await chamar(comTools, maxTokens);
      }
      return { erro: `openrouter_http_${resp.status}`, detalhe: text.slice(0, 300) };
    }
    try { return { parsed: JSON.parse(text) }; } catch { return { erro: "openrouter_non_json", detalhe: text.slice(0, 300) }; }
  }

  for (let iter = 0; iter < MAX_ITER; iter++) {
    // v19: orcamento de tempo. Sem isso o loop podia consumir os 150s inteiros coletando
    // dados e morrer antes de escrever - 504, perda total. Melhor resposta parcial
    // declarada que nenhuma resposta.
    if (iter > 0 && decorrido() > TOOLS_DEADLINE_MS) { deadlineTools = true; break; }
    iteracoes = iter + 1;
    const r = await chamar(true);
    if (r.erro) return json({ error: r.erro, detail: r.detalhe }, 502);
    const parsed = r.parsed;
    tokensIn += Number(parsed?.usage?.prompt_tokens ?? 0);
    tokensOut += Number(parsed?.usage?.completion_tokens ?? 0);
    somarCache(parsed?.usage);
    finishReason = String(parsed?.choices?.[0]?.finish_reason ?? "");
    const msg = parsed?.choices?.[0]?.message;
    if (!msg) return json({ error: "openrouter_empty" }, 502);
    if (msg.tool_calls?.length) {
      // v18: o modelo pode emitir texto E tool_calls na MESMA mensagem. Antes esse texto
      // entrava no historico enviado ao modelo mas nunca chegava ao usuario.
      const parcial = String(msg.content ?? "").trim();
      if (parcial) preambulos.push(parcial);
      messages.push(msg);
      for (const tc of msg.tool_calls) {
        // v20: teto de ferramentas. A API exige resposta para CADA tool_call_id, entao nao
        // e possivel simplesmente pular - devolvemos um resultado que DECLARA o teto, para
        // o modelo nao tratar o dado como zero nem como inexistente (R3).
        if (toolsUsed.length >= MAX_TOOLS_TURNO) {
          tetoTools = true;
          messages.push({ role: "tool", tool_call_id: tc.id, content: JSON.stringify({
            erro: "teto_de_ferramentas_do_turno",
            aviso: `Limite de ${MAX_TOOLS_TURNO} ferramentas por turno atingido. Este dado NAO foi lido - nao o trate como zero nem como inexistente. Responda com o que ja tem e diga ao usuario, em uma linha, que este item precisa de uma pergunta separada.` }) });
          continue;
        }
        let args: any = {}; try { args = JSON.parse(tc.function?.arguments ?? "{}"); } catch { /* */ }
        const result = await runTool(tc.function?.name, args, ctx);
        toolsUsed.push({ tool: tc.function?.name, args });
        messages.push({ role: "tool", tool_call_id: tc.id, content: JSON.stringify(result).slice(0, 14000) });
      }
      continue;
    }
    reply = msg.content ?? "";
    break;
  }

  if (!reply) {
    messages.push({ role: "user", content: deadlineTools
      ? "PARE de usar ferramentas: o tempo de coleta acabou. Com os dados JA coletados, responda AGORA por blocos, com numeros reais e suas fontes. Diga em UMA linha, no fim, quais itens do pedido nao foram cobertos por falta de tempo de coleta, para o usuario poder pedir so esses depois. Nao responda que nao conseguiu."
      : "PARE de usar ferramentas. Com os dados JA coletados, responda AGORA por blocos, com numeros reais e suas fontes, dizendo explicitamente o que nao esta disponivel. Nao responda que nao conseguiu." });
    const rf = await chamar(false, tokensDisponiveis());
    if (!rf.erro) {
      const p = rf.parsed;
      tokensIn += Number(p?.usage?.prompt_tokens ?? 0);
      tokensOut += Number(p?.usage?.completion_tokens ?? 0);
      somarCache(p?.usage);
      finishReason = String(p?.choices?.[0]?.finish_reason ?? finishReason) + "+sintese_final";
      reply = p?.choices?.[0]?.message?.content ?? "";
    }
  }
  // v18: emenda o texto que vinha junto com tool_calls e era descartado.
  // Heuristica deliberada: preambulo curto costuma ser ruido operacional ("vou consultar os
  // dados"), que o proprio prompt ja proibe; texto de 120+ chars e analise real. Se 'reply'
  // ficou vazio, emenda TUDO como resgate - melhor texto parcial que mensagem de erro.
  let preambulosUsados = 0;
  if (preambulos.length) {
    const aproveitar = reply ? preambulos.filter((p) => p.length >= 120) : preambulos;
    if (aproveitar.length) {
      preambulosUsados = aproveitar.length;
      const pre = aproveitar.join("\n\n").trim();
      reply = reply ? pre + "\n\n" + reply : pre;
    }
  }
  if (!reply) reply = "Tive um problema para concluir a resposta. Reenvie em partes menores.";

  const diagnostico = { finish_reason: finishReason, iteracoes, ms_total: decorrido(),
    deadline_tools: deadlineTools, preambulos_detectados: preambulos.length,
    preambulos_recuperados: preambulosUsados, tools: toolsUsed.map((t) => t.tool),
    teto_tools: tetoTools, cache_write: cacheWrite, cache_read: cacheRead,
    cache_rejeitado: cacheRejeitado,
    tokens_in: tokensIn, tokens_out: tokensOut, versao: "v20" };

  await supa.from("chat_messages").insert({ conversation_id: convId, company_id: company.id, role: "assistant", content: reply,
    tool_calls: toolsUsed.length ? toolsUsed : null, model: MODEL, tokens_in: tokensIn, tokens_out: tokensOut,
    diagnostico,
    attachments: actionCards.length ? actionCards.map((c) => ({ tipo: "action_card", approval_id: c.approval_id, summary: c.summary, status: c.status })) : null });
  await supa.from("chat_conversations").update({ updated_at: new Date().toISOString() }).eq("id", convId);

  return json({ ok: true, conversation_id: convId, reply, tools_used: toolsUsed.map((t) => t.tool),
    iteracoes_usadas: iteracoes, finish_reason: finishReason, fatos_memoria: (ctxRows ?? []).length,
    preambulos_detectados: preambulos.length, preambulos_recuperados: preambulosUsados,
    deadline_tools: deadlineTools, ms_total: decorrido(),
    teto_tools: tetoTools, cache_write: cacheWrite, cache_read: cacheRead, cache_rejeitado: cacheRejeitado,
    tokens_in: tokensIn, tokens_out: tokensOut, attachments_processed: attMeta, attachment_warnings: attNotas, action_cards: actionCards });
});
