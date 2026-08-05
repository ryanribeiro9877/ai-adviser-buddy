// supabase/functions/traffic-agent-job/index.ts (v2.9)
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
// v2.9 (04/08/2026) - CONSERTO: na base multiquadro o filtro de video passou a ser aplicado antes
//   do corte por `limite`, nao dentro do laco. Com limite 12 os 12 primeiros pendentes eram
//   imagens e a corrida devolveu 0 analisadas em 5s - nao gravou nada errado, simplesmente nao
//   fez. Foi a telemetria da v2.8 que tornou o no-op visivel.
// v2.8 (04/08/2026) - o detalhe do filtro de peso (quantos dos 15 quadros passaram, quantos foram
//   usados, quais indices, e os videos sem video_id) sai NO RETORNO do modo drive_watch. Na corrida
//   de 5 videos esses numeros existiam so na telemetria interna e tiveram de ser reconstruidos
//   chamando a thumbnails de novo - numero que precisa ser reconstruido e numero que ninguem confere.
// v2.7 (04/08/2026) - GT-45: MULTIQUADRO EM VIDEO. Base `multiquadro/criterio-v2.4`: 5 quadros da
//   Meta por video em vez de uma miniatura do Drive. Os quadros vem da acao thumbnails da
//   upload-midia (unica edge com META_ADS_TOKEN); este job usa a mcp key, nao o token.
//   Selecao por PESO e nao por posicao: descarta quadro abaixo de 40% da mediana de bytes (quase
//   uniforme) e distribui 5 no tempo entre os que sobram. `is_preferred` e ignorado - medido que a
//   capa escolhida pela Meta tinha 26 KB contra 186 KB dos vizinhos, ou seja, pode ser o pior
//   quadro para julgar conteudo. Sem audio de proposito: se audio entrasse junto e o resultado
//   melhorasse, nao se saberia qual dos dois resolveu.
// v2.6 (04/08/2026) - BASE DA ANALISE NO CONTRATO + CONSERTO DE FALHA SILENCIOSA.
//   (1) O pipeline de visao e o modo drive_watch aceitam base_da_analise (default thumbnail, para
//       o cron das 08:45 nao regredir). O plano e pedido PARA a base, com recorte opcional por
//       nome, por tipo (somente_imagens) e por limite - o aceite parcial de 5 antes de 48.
//   (2) CONSERTO: o upsert citava onConflict (drive_file_id, drive_modified_time) e esse indice de
//       2 colunas deixou de existir quando a chave virou (arquivo, versao, base). Toda gravacao
//       falharia com 42P10 - e o erro era DESCARTADO: analisados++ acontecia igual e a telemetria
//       diria "analisado". O cron de hoje devolveu 0 pecas novas, entao a quebra nunca foi
//       exercitada; a primeira peca nova no Drive teria sumido em silencio.
// v2.5 (04/08/2026) - COBERTURA DO DRIVE VEM DA TABELA + MODO VIGIA PARA O CRON.
//   (B) As pastas a varrer saem de drive_pastas_monitoradas (RPC drive_plano_de_varredura), nao
//       mais do segredo DRIVE_CRIATIVOS_FOLDER_ID - acrescentar pasta passou a ser INSERT, sem
//       deploy. Acesso amplo da conta de servico nunca foi cobertura: o codigo olhava um id fixo.
//       O segredo fica como FALLBACK DECLARADO (se a lista vier vazia, avisa no retorno).
//       Cada arquivo carrega pasta_monitorada, e a varredura de cada pasta e registrada.
//   (A) modo drive_watch: caminho barato para o cron - so varredura + visao no que mudou, sem
//       PLANNER, sem subagentes, sem sintese. Devolve "0 pecas novas em N pastas" em vez de
//       silencio, porque silencio e indistinguivel de falha.
// v2.4 (31/07/2026) - CRITERIO DO GESTOR no pipeline de visao (audios do Roberto):
//   o universo criativo da marca e "credito CLT + educacao financeira + dicas de seguranca
//   financeira" - peca desses temas e SIM. NAO fica reservado a peca que mostra
//   explicitamente OUTRO produto financeiro (financiamento de veiculo, conta corrente,
//   consorcio, imovel). Vale para PECAS FUTURAS; o acervo atual ja esta liberado pela
//   camada de aprovacao humana (aprovado_pelo_gestor, decisao 31/07).
//
// v2.3 (31/07/2026) - vereditos visuais expostos como TOOL (get_analise_visual_drive):
//   os demais especialistas e a sintese leem a classificacao persistida sem repetir visao.
//
// v2.2 (31/07/2026) - OLHOS: analise VISUAL das midias do Drive.
//   O especialista criativos_drive lia a miniatura como URL EM TEXTO - o modelo nunca via
//   os pixels, e recusar "classifique cada arquivo" era o comportamento correto de um
//   analista cego. Agora existe o especialista analise_visual_drive: pipeline CODIFICADO
//   (nao e loop de tools) que baixa a miniatura em alta resolucao (=s1600), entrega os
//   pixels ao modelo em LOTES e PERSISTE cada veredito em drive_midia_analises (chave
//   arquivo+versao: rodadas sucessivas so analisam o que falta ou mudou - segmentos e
//   devolucoes convergem para a cobertura total sem reanalisar). Limite declarado em cada
//   linha: base_da_analise='thumbnail' - de video se ve UM FRAME, nunca o interior.
//
// v2.1 (30/07/2026, mesma noite) - PAGINACAO DE DADOS: fecha a terceira lacuna, achada no
//   teste real com a pergunta integral do gestor. Os mecanismos do v2 cobrem TEMPO
//   (segmentos) e RELATORIO RUIM (devolucao) - mas nao cobriam DADO TRUNCADO no payload da
//   ferramenta: 26 de 30 legendas ficaram invisiveis e o aviso "peca um recorte" apontava
//   para um parametro que nao existia. Agora: get_criativos_conteudo aceita pagina
//   (RPC paginada por gasto desc), o subagente tem ORDEM de paginar ate cobrir quando o
//   foco exigir, e a mae ganhou o criterio 5: aceitar corte com paginacao disponivel =
//   relatorio devolvido.
//
// v2 (30/07/2026) - TRES FRENTES NOVAS:
//   (A) SUBAGENTE criativos_drive: le a pasta de criativos do Google Drive via service
//       account (somente leitura), caminha a arvore (1o nivel=FORMATO, 2o nivel=EIXO),
//       traz thumbnail de video/imagem e cruza com as legendas vencedoras (eixo validado
//       vs hipotese). Limite declarado: video = thumbnail+nome+caminho; sem ffmpeg em edge.
//   (B) DEVOLUCAO COORDENADOR->SUBAGENTE: apos a fase 2, a coordenacao (modelo da sintese)
//       valida cada relatorio contra a pergunta e o foco atribuido; relatorio reprovado
//       volta ao subagente COM O PARECER ("faltou X; a pergunta era A, voce respondeu B").
//       Maximo DEVOLUCOES_MAX rodadas; ao esgotar, o relatorio entra marcado FALHO e a
//       sintese declara a lacuna - nunca o meio-termo silencioso.
//   (C) SEGMENTOS ENCADEADOS: o teto de ~330s e por INVOCACAO, nao por trabalho. Ao chegar
//       perto do limite com trabalho pendente, o job grava CHECKPOINT em chat_jobs
//       (relatorios validados congelados + fila de devolucoes) e reinvoca a PROPRIA edge;
//       o novo worker retoma do ponto exato com orcamento zerado. Ate MAX_SEGMENTOS=3
//       (~14 min de parede). Relatorio validado NUNCA e refeito.
//   (D) SPLIT DE MODELO: planejador e subagentes leem OPENROUTER_MODEL_SUB (fallback p/ o
//       principal); coordenacao e sintese leem OPENROUTER_MODEL. Permite Opus na sintese
//       mantendo a extracao paralela no modelo mais barato.
//
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
import { bearerDe, mcpKeyValida } from "../_shared/mcp_auth.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const OPENROUTER_KEY = (Deno.env.get("OPENROUTER_API_KEY") ?? "").trim();
const MODEL = (Deno.env.get("OPENROUTER_MODEL") ?? "anthropic/claude-sonnet-5").trim();
// v2: modelo dos SUBAGENTES e do planejador (extracao estrita nao precisa do modelo caro).
const MODEL_SUB = ((Deno.env.get("OPENROUTER_MODEL_SUB") ?? "").trim()) || MODEL;
// v2: credencial do Drive (service account) + pasta raiz dos criativos.
const GOOGLE_SA_KEY_B64 = (Deno.env.get("GOOGLE_SA_KEY_B64") ?? "").trim();
const DRIVE_CRIATIVOS_FOLDER_ID = (Deno.env.get("DRIVE_CRIATIVOS_FOLDER_ID") ?? "").trim();

// Orcamentos do JOB (parede de ~400s do worker; 330s de trabalho + reserva de gravacao).
const JOB_LIMIT_MS = 330_000;
const RESERVA_FINAL_MS = 12_000;
// v2: segmentos e devolucao
const MAX_SEGMENTOS = 3;
const DEVOLUCOES_MAX = 2;          // rodadas de devolucao por job (nao por subagente)
const CHECKPOINT_MIN_MS = 75_000;  // se falta trabalho e o prazo esta abaixo disto, segmenta
// v2.2: pipeline de visao
const VISAO_LOTE = 6;               // imagens por chamada de visao
const VISAO_MAX_POR_RODADA = 30;    // teto de arquivos analisados por segmento
const VISAO_MIN_PRAZO_MS = 45_000;  // abaixo disto, para o lote e declara parcial
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
async function t_criativos_conteudo(somenteAtivas: boolean, companyId: string, pagina = 1) {
  // v2: p_company_id obrigatorio (isolamento). v2.1: paginacao - cada pagina de 20 cabe no
  // teto de payload da ferramenta; restantes>0 diz ao subagente que a lista continua.
  const TAM_PAGINA = 20;
  const off = (Math.max(1, pagina) - 1) * TAM_PAGINA;
  const { data, error } = await supa.rpc("get_criativos_conteudo", { p_somente_ativas: somenteAtivas, p_company_id: companyId, p_offset: off, p_limit: TAM_PAGINA });
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
      case "get_criativos_conteudo": return await t_criativos_conteudo(args?.somente_ativas === false ? false : true, ctx.companyId, Number(args?.pagina ?? 1));
      case "get_estrutura_conjuntos": return await t_estrutura_conjuntos();
      case "get_drive_criativos": return await t_drive_criativos(ctx.companyId);
      case "get_analise_visual_drive": {
        const { data, error } = await supa.rpc("get_drive_analises", { p_company_id: ctx.companyId });
        return error ? { erro: error.message } : data;
      }
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
  get_analise_visual_drive: { type: "function", function: { name: "get_analise_visual_drive", description: "VEREDITO VISUAL POR PECA das midias do Drive, ja persistido pelo especialista de visao: produto detectado pelos pixels, texto visivel, risco e veredito aproveitavel sim/nao/incerto com motivo. Leitura instantanea - nao repete a visao. Se total_analisados < inventario, pecas novas ainda nao passaram pela visao: declare, nao invente.", parameters: { type: "object", properties: {} } } },
  get_drive_criativos: { type: "function", function: { name: "get_drive_criativos", description: "INVENTARIO DA PASTA DE CRIATIVOS NOVOS no Google Drive (somente leitura): caminho (1o nivel=formato, 2o nivel=eixo de mensagem), nome, tipo, tamanho, data e thumbnail (um frame/preview) de cada arquivo, com resumo por formato e por eixo. Pode vir truncado: leia aviso_corte e nunca trate item omitido como inexistente. LIMITE: video e analisado por thumbnail+nome+caminho, nao pelo conteudo interno.", parameters: { type: "object", properties: {} } } },
  get_overview: { type: "function", function: { name: "get_overview", description: "Visao geral de MIDIA: campanhas ativas (status real), gasto/resultados 7d, dias_com_dado.", parameters: { type: "object", properties: {} } } },
  get_alerts: { type: "function", function: { name: "get_alerts", description: "Alertas ativos do sistema.", parameters: { type: "object", properties: {} } } },
  get_recommendations: { type: "function", function: { name: "get_recommendations", description: "Recomendacoes pendentes da IA (regua = custo de midia).", parameters: { type: "object", properties: {} } } },
  get_targets: { type: "function", function: { name: "get_targets", description: "Metas e tetos de custo vigentes.", parameters: { type: "object", properties: {} } } },
  get_funnel: { type: "function", function: { name: "get_funnel", description: "Funil de MIDIA num periodo, com cobertura_real.", parameters: { type: "object", properties: { date_from: { type: "string" }, date_to: { type: "string" } } } } },
  get_ads_ranking: { type: "function", function: { name: "get_ads_ranking", description: "RECORTE por custo MEDIO (Breakdown Effect: serve p/ ENTENDER, proibido prescrever pausa so por isto).", parameters: { type: "object", properties: { days: { type: "number" } } } } },
  get_campaign_detail: { type: "function", function: { name: "get_campaign_detail", description: "Detalhe e serie diaria 14d de uma campanha pelo nome.", parameters: { type: "object", properties: { name_like: { type: "string" } }, required: ["name_like"] } } },
  get_criativos_conteudo: { type: "function", function: { name: "get_criativos_conteudo", description: "Legendas/titulo/CTA reais dos anuncios, PAGINADO por gasto (paginas de 20). O retorno traz total/exibidos/restantes: se restantes > 0 a lista NAO acabou - chame de novo com pagina+1 ate cobrir o que o seu foco exige. Nunca trate item de outra pagina como inexistente.", parameters: { type: "object", properties: { somente_ativas: { type: "boolean" }, pagina: { type: "integer", description: "Pagina de 20 criativos, comecando em 1. Use restantes>0 do retorno anterior." } } } } },
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
    maxPorTool: { get_criativos_conteudo: 4, get_conhecimento: 3 }, maxToolsTotal: 7,
    missao: "CONTEUDO REAL DAS PECAS em operacao: legendas, titulos, CTAs, gasto e formularios por legenda distinta, hooks e formatos (fundamentar na base de conhecimento de criativo). NAO faz auditoria de compliance (dominio do especialista compliance) nem analisa metricas de campanha (dominio do desempenho_campanhas).",
  },
  compliance: {
    tools: ["check_compliance", "get_criativos_conteudo", "get_conhecimento"],
    maxPorTool: { check_compliance: 8, get_criativos_conteudo: 3, get_conhecimento: 2 }, maxToolsTotal: 13,
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
  analise_visual_drive: {
    tools: [], maxPorTool: {}, maxToolsTotal: 0,  // pipeline codificado - nao usa loop de tools
    missao: "ANALISE VISUAL arquivo a arquivo das midias do Drive (pixels da miniatura em alta resolucao): produto detectado, texto visivel, riscos de compliance visiveis e veredito aproveitavel/nao/incerto por peca, persistido em banco. Use quando o gestor pedir para CLASSIFICAR/ANALISAR O CONTEUDO das pecas (nao apenas inventariar). Limite declarado: de video se ve UM FRAME.",
  },
  criativos_drive: {
    tools: ["get_drive_criativos", "get_analise_visual_drive", "get_criativos_conteudo", "get_conhecimento"],
    maxPorTool: { get_drive_criativos: 2, get_analise_visual_drive: 1, get_criativos_conteudo: 1, get_conhecimento: 2 }, maxToolsTotal: 6,
    missao: "CRIATIVOS NOVOS NO GOOGLE DRIVE (pasta compartilhada, somente leitura): inventariar os arquivos com caminho (1o nivel=formato, 2o nivel=eixo de mensagem), tipo, data e thumbnail; cruzar os EIXOS encontrados com as legendas que ja performaram na conta (via conteudo dos anuncios) e classificar cada grupo como EIXO JA VALIDADO (existe vencedora medida) ou EIXO NOVO/HIPOTESE (sem dado de custo); indicar a qual tipo de teste cada grupo serviria. DECLARAR SEMPRE o limite: video foi avaliado por thumbnail+nome+caminho, nao pelo conteudo interno. NAO analisa metricas de campanha nem faz compliance.",
  },
  conhecimento: {
    tools: ["get_conhecimento"],
    maxPorTool: { get_conhecimento: 5 }, maxToolsTotal: 5,
    missao: "FUNDAMENTO TECNICO puro (politicas Meta, definicao de metricas, metodo de otimizacao, boas praticas de criativo), citando o tema consultado e declarando [VENCIDO] quando for o caso. So e acionado quando a pergunta exige conceito alem do que os outros especialistas ja fundamentam.",
  },
};

// ============================================================================
// v2 - GOOGLE DRIVE (service account, somente leitura)
// ============================================================================
let _driveToken: { token: string; exp: number } | null = null;
function _pemParaDer(pem: string): ArrayBuffer {
  const b64 = pem.replace(/-----[^-]+-----/g, "").replace(/\s+/g, "");
  const bin = atob(b64);
  const buf = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) buf[i] = bin.charCodeAt(i);
  return buf.buffer;
}
function _b64url(dados: Uint8Array | string): string {
  const bin = typeof dados === "string" ? dados : String.fromCharCode(...dados);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
async function driveToken(): Promise<string> {
  if (_driveToken && _driveToken.exp > Date.now() + 60_000) return _driveToken.token;
  if (!GOOGLE_SA_KEY_B64) throw new Error("credencial do Drive nao configurada (GOOGLE_SA_KEY_B64)");
  const sa = JSON.parse(atob(GOOGLE_SA_KEY_B64));
  const agora = Math.floor(Date.now() / 1000);
  const header = _b64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const claims = _b64url(JSON.stringify({
    iss: sa.client_email, scope: "https://www.googleapis.com/auth/drive.readonly",
    aud: "https://oauth2.googleapis.com/token", iat: agora, exp: agora + 3600 }));
  const chave = await crypto.subtle.importKey("pkcs8", _pemParaDer(sa.private_key),
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["sign"]);
  const assinatura = new Uint8Array(await crypto.subtle.sign("RSASSA-PKCS1-v1_5", chave,
    new TextEncoder().encode(`${header}.${claims}`)));
  const jwt = `${header}.${claims}.${_b64url(assinatura)}`;
  const resp = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" },
    body: `grant_type=${encodeURIComponent("urn:ietf:params:oauth:grant-type:jwt-bearer")}&assertion=${jwt}` });
  const j = await resp.json();
  if (!resp.ok || !j.access_token) throw new Error(`falha no token do Drive: ${JSON.stringify(j).slice(0, 200)}`);
  _driveToken = { token: j.access_token, exp: Date.now() + (Number(j.expires_in ?? 3600) - 120) * 1000 };
  return _driveToken.token;
}
// Caminha a arvore da pasta raiz. Convencao observada na pasta real (30/07/2026):
// 1o nivel = FORMATO (Videos, Cards, Carrossel N...), 2o nivel = EIXO DE MENSAGEM.
// v2.5 (04/08/2026) - COBERTURA VEM DA TABELA, NAO DO SEGREDO. Antes o codigo lia UMA pasta, do
// segredo DRIVE_CRIATIVOS_FOLDER_ID: por mais amplo que fosse o acesso da conta de servico, a
// cobertura era um id fixo, e acrescentar pasta exigia mudar segredo e deployar. Agora a lista
// vem de drive_pastas_monitoradas via drive_plano_de_varredura, e acrescentar pasta e um INSERT.
// O segredo fica como FALLBACK DECLARADO: se a RPC nao devolver pasta ativa, ele e usado E o
// retorno avisa - falha de leitura da tabela nao pode deixar o sistema cego em silencio.
async function t_drive_criativos(companyId: string) {
  const { data: plano, error: ePlano } = await supa.rpc("drive_plano_de_varredura", { p_company_id: companyId });
  const pastasAtivas: any[] = Array.isArray((plano as any)?.pastas_ativas) ? (plano as any).pastas_ativas : [];
  const desativadas: any[] = Array.isArray((plano as any)?.pastas_desativadas) ? (plano as any).pastas_desativadas : [];

  let raizes: { folder_id: string; nome: string }[] = pastasAtivas
    .map((p: any) => ({ folder_id: String(p.folder_id ?? ""), nome: String(p.nome ?? "(sem nome)") }))
    .filter((p) => p.folder_id);
  let avisoFallback: string | null = null;
  if (!raizes.length) {
    if (!DRIVE_CRIATIVOS_FOLDER_ID) {
      return { erro: "nenhuma pasta monitorada para esta empresa e o segredo DRIVE_CRIATIVOS_FOLDER_ID esta vazio - nao ha o que varrer",
        detalhe_rpc: ePlano?.message ?? null };
    }
    raizes = [{ folder_id: DRIVE_CRIATIVOS_FOLDER_ID, nome: "(fallback: segredo DRIVE_CRIATIVOS_FOLDER_ID)" }];
    avisoFallback = `FALLBACK: a lista de pastas monitoradas veio vazia${ePlano ? ` (erro na leitura: ${ePlano.message})` : ""}, entao a varredura usou o id fixo do segredo. A cobertura desta rodada NAO e a cadastrada - declare isso.`;
  }

  let token: string;
  try { token = await driveToken(); }
  catch (e) { return { erro: String((e as any)?.message ?? e), aviso: "Sem acesso ao Drive nesta rodada - o dado NAO foi lido; nao trate como pasta vazia. Verificar credencial e compartilhamento da pasta com a service account." }; }
  const MAX_PASTAS = 40, MAX_ARQUIVOS = 250, MAX_PROFUNDIDADE = 4;
  type No = { id: string; caminho: string; nivel: number; raiz: string };
  // Tetos GLOBAIS entre as raizes: o que protege e o payload, que nao sabe de quantas pastas veio.
  const fila: No[] = raizes.map((r) => ({ id: r.folder_id, caminho: "", nivel: 0, raiz: r.nome }));
  const arquivos: any[] = [];
  const porPasta: Record<string, number> = {};
  let pastasLidas = 0, cortado = false;
  while (fila.length) {
    const no = fila.shift()!;
    if (pastasLidas >= MAX_PASTAS || arquivos.length >= MAX_ARQUIVOS) { cortado = true; break; }
    pastasLidas++;
    let pageToken = "";
    do {
      const url = new URL("https://www.googleapis.com/drive/v3/files");
      url.searchParams.set("q", `'${no.id}' in parents and trashed=false`);
      url.searchParams.set("fields", "nextPageToken,files(id,name,mimeType,size,modifiedTime,thumbnailLink)");
      url.searchParams.set("pageSize", "100");
      url.searchParams.set("supportsAllDrives", "true");
      url.searchParams.set("includeItemsFromAllDrives", "true");
      if (pageToken) url.searchParams.set("pageToken", pageToken);
      const r = await fetch(url, { headers: { authorization: `Bearer ${token}` } });
      const j = await r.json();
      if (!r.ok) return { erro: `Drive respondeu ${r.status}`, detalhe: JSON.stringify(j).slice(0, 200) };
      for (const f of j.files ?? []) {
        if (f.mimeType === "application/vnd.google-apps.folder") {
          if (no.nivel + 1 <= MAX_PROFUNDIDADE) fila.push({ id: f.id, caminho: no.caminho ? `${no.caminho}/${f.name}` : f.name, nivel: no.nivel + 1, raiz: no.raiz });
        } else if (arquivos.length < MAX_ARQUIVOS) {
          arquivos.push({ id: f.id, nome: f.name, caminho: no.caminho || "(raiz)",
            pasta_monitorada: no.raiz,
            formato_pasta: (no.caminho.split("/")[0] || "(raiz)"),
            eixo_pasta: (no.caminho.split("/")[1] ?? null),
            tipo: f.mimeType, tamanho_bytes: Number(f.size ?? 0) || null,
            modificado_em: f.modifiedTime ?? null, thumbnail: f.thumbnailLink ?? null });
          porPasta[no.raiz] = (porPasta[no.raiz] ?? 0) + 1;
        } else { cortado = true; }
      }
      pageToken = j.nextPageToken ?? "";
    } while (pageToken && arquivos.length < MAX_ARQUIVOS);
  }
  const porFormato: Record<string, number> = {};
  const porEixo: Record<string, number> = {};
  for (const a of arquivos) {
    porFormato[a.formato_pasta] = (porFormato[a.formato_pasta] ?? 0) + 1;
    if (a.eixo_pasta) porEixo[a.eixo_pasta] = (porEixo[a.eixo_pasta] ?? 0) + 1;
  }
  // v2.5: registra a varredura por pasta. `ultima_varredura_em` e o que distingue "varri e nao
  // achei peca nova" de "nunca varri" - sem isso, silencio e indistinguivel de falha.
  const registradas: string[] = [];
  if (!avisoFallback) {
    for (const r of raizes) {
      const { error } = await supa.rpc("drive_registrar_varredura", {
        p_company_id: companyId, p_folder_id: r.folder_id, p_pecas: porPasta[r.nome] ?? 0,
      });
      if (!error) registradas.push(r.nome);
    }
  }

  const out: any = {
    total_arquivos: arquivos.length, pastas_lidas: pastasLidas,
    pastas_monitoradas_varridas: raizes.map((r) => ({ nome: r.nome, arquivos: porPasta[r.nome] ?? 0 })),
    pastas_desativadas: desativadas,
    varredura_registrada_em: registradas,
    resumo_por_formato: porFormato, resumo_por_eixo_de_mensagem: porEixo,
    nota: "Inventario das pastas de criativo MONITORADAS desta empresa (somente leitura). Convencao: 1o nivel do caminho = formato, 2o nivel = eixo de mensagem. 'thumbnail' e um frame/preview servido pelo Google. LIMITE DECLARADO: video e analisado por thumbnail+nome+caminho; o conteudo interno (frames/audio) NAO e lido nesta versao.",
    declare_a_cobertura: (plano as any)?.declare_a_cobertura
      ?? "NUNCA diga que leu 'o Drive'. Diga quais pastas foram varridas e quando. Pasta fora da lista nao e lida por ninguem.",
    arquivos,
  };
  if (avisoFallback) out.aviso_fallback = avisoFallback;
  if (desativadas.length) {
    out.aviso_pastas_desativadas = `Existem ${desativadas.length} pasta(s) cadastradas e DESATIVADAS: elas nao foram lidas. Peca que exista nelas e invisivel para o sistema - declare isso se o gestor perguntar por peca que voce nao encontrou.`;
  }
  if (cortado) out.aviso_corte = `Inventario truncado nos tetos de leitura (${MAX_PASTAS} pastas / ${MAX_ARQUIVOS} arquivos), somados entre as pastas monitoradas. O que nao veio EXISTE nas pastas - nao trate como inexistente; peca um recorte por subpasta.`;
  return out;
}

// ============================================================================
// LLM
// ============================================================================
async function chamarLLM(messages: any[], opts: { tools?: any[]; maxTokens: number; reasoning?: any; model?: string }): Promise<any> {
  const payload: any = { model: opts.model ?? MODEL, messages, max_tokens: opts.maxTokens };
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
- criativos_drive: pasta de criativos NOVOS no Google Drive (inventario, formatos, eixos, comparacao com vencedores)\n- analise_visual_drive: analise VISUAL arquivo a arquivo das pecas do Drive (produto, texto visivel, riscos, veredito aproveitavel) - so quando pedirem CLASSIFICAR/ANALISAR CONTEUDO das pecas
- conhecimento: fundamento tecnico puro (so quando a pergunta exige conceito alem do operacional)
REGRAS DE ATRIBUICAO: taxa de clique/insight de CAMPANHA -> desempenho_campanhas; taxa de clique de TEMPLATE WhatsApp -> whatsapp_waba; texto/ideia de anuncio -> criativos; "pode anunciar isso?"/violacao -> compliance; Drive/pasta de materiais/criativos novos ainda nao publicados -> criativos_drive; CLASSIFICAR/ANALISAR o CONTEUDO das pecas do Drive (aproveitavel ou nao, o que a peca diz, produto da peca) -> analise_visual_drive. NAO inclua especialista cujo dominio a pergunta nao toca.
Responda APENAS com JSON valido, sem markdown, no formato:
{"subagentes":[{"nome":"...","foco":"instrucao curta e especifica do que ELE deve levantar"}]}
Para auditoria ampla da conta, inclua todos os pertinentes.`;
  const r = await chamarLLM(
    [{ role: "system", content: sys }, { role: "user", content: pergunta.slice(0, 12000) }],
    { maxTokens: PLANNER_MAX_TOKENS, reasoning: REASONING_OFF, model: MODEL_SUB },
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
REGRAS: todo numero vem de ferramenta CHAMADA AGORA (nunca de memoria); distinga zero / nao existe / nao coletado; incorpore campos 'nota'/'aviso' dos retornos; amostra pequena e hipotese; nao misture janelas.\nPAGINACAO OBRIGATORIA: se um retorno trouxer restantes > 0 ou aviso de corte E o seu foco exigir cobertura da lista inteira, chame a MESMA ferramenta pedindo a proxima pagina ate cobrir ou esgotar seu teto de consultas. Aceitar o corte sem tentar a proxima pagina e falha sua; se esgotar o teto antes de cobrir, declare em LACUNAS exatamente quantos itens ficaram sem leitura.
Ao terminar a coleta, escreva um RELATORIO conciso e denso em markdown com numeros + fonte + janela, terminando com a linha 'LACUNAS:' listando o que nao conseguiu cobrir (ou 'nenhuma').`;
  const messages: any[] = [{ role: "system", content: sys }, { role: "user", content: `Pergunta original do gestor (para contexto):\n${pergunta.slice(0, 8000)}` }];
  const usadas: string[] = [];
  let tin = 0, tout = 0, reas = 0, relatorio = "", finish = "";
  for (let iter = 0; iter < SUB_MAX_ITER; iter++) {
    if (prazo() <= 0) { finish = "prazo_do_job"; break; }
    const r = await chamarLLM(messages, { tools, maxTokens: SUB_MAX_TOKENS, reasoning: SUB_REASONING, model: MODEL_SUB });
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
    const rf = await chamarLLM(messages, { maxTokens: SUB_MAX_TOKENS, reasoning: REASONING_OFF, model: MODEL_SUB });
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
    const rc = await chamarLLM(messages, { maxTokens: maxTok, reasoning: REASONING_OFF, model: MODEL_SUB });
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
// v2.2 - ANALISE VISUAL DO DRIVE (pipeline codificado com visao, persistido)
// ============================================================================
async function baixarThumb(url: string): Promise<{ b64: string; mime: string } | null> {
  try {
    const alta = url.replace(/=s\d+(-c)?$/, "=s1600");
    let r = await fetch(alta);
    if (!r.ok) { const t = await driveToken(); r = await fetch(alta, { headers: { authorization: `Bearer ${t}` } }); }
    if (!r.ok) return null;
    const mime = r.headers.get("content-type") ?? "image/jpeg";
    const u = new Uint8Array(await r.arrayBuffer());
    if (u.length > 1_800_000) return null; // grande demais p/ lote - pula com registro
    let bin = ""; const CH = 0x8000;
    for (let i = 0; i < u.length; i += CH) bin += String.fromCharCode.apply(null, u.subarray(i, i + CH) as any);
    return { b64: btoa(bin), mime };
  } catch { return null; }
}

// v2.6 (04/08/2026) - BASE DA ANALISE NO CONTRATO. A chave de drive_midia_analises passou a ser
// (drive_file_id, drive_modified_time, base_da_analise): reanalise com base DIFERENTE cria linha
// nova e o veredito antigo permanece. Convencao do nome: "<evidencia>/criterio-<versao do prompt>"
// - se o prompt de visao mudar, a base muda e a reanalise dispara por construcao, sem ninguem
// precisar lembrar de inventar nome. Foi exatamente esse esquecimento que deixou as 67 pecas de
// 31/07 julgadas 2h11 ANTES do deploy que trouxe a taxonomia do gestor (educacao financeira e
// seguranca), com zero pecas nesses dois temas.
const BASE_PADRAO = "thumbnail";
type OpcoesVisao = { base?: string; somenteNomes?: string[]; limite?: number; somenteImagens?: boolean };

// v2.7 (04/08/2026) - QUADROS DA META. O Drive entrega UMA miniatura por arquivo e nao aceita
// offset de tempo; extrair quadro do mp4 no runtime da edge nao existe (isolate V8 sem shell,
// Deno.Command bloqueado, ffmpeg.wasm estoura os 256 MB). Mas a Meta gera 15 quadros 1080x1920 por
// video enviado, todos baixaveis sem credencial - medido em 04/08. Entao os quadros vem de la, via
// a acao `thumbnails` da upload-midia (que tem o META_ADS_TOKEN; este job nao tem, e nao deve ter).
// FILTRO POR PESO, nao por posicao: um quadro muito mais leve que os vizinhos e quase uniforme -
// abertura em fundo liso. Medido: num dos videos o quadro `is_preferred` tinha 26 KB contra 186 KB
// dos vizinhos, ou seja, a capa que a Meta escolhe pode ser o PIOR quadro para julgar conteudo.
// Por isso `is_preferred` e ignorado de proposito.
const QUADROS_POR_VIDEO = 5;
const PESO_MINIMO_DA_MEDIANA = 0.40;

async function quadrosDaMeta(videoId: string, mcpKey: string) {
  const r = await fetch(`${SUPABASE_URL}/functions/v1/upload-midia`, {
    method: "POST", headers: { "content-type": "application/json", "x-mcp-key": mcpKey },
    body: JSON.stringify({ acao: "thumbnails", video_id: videoId, medir_todos: true }),
  });
  const t = await r.text();
  let j: any; try { j = JSON.parse(t); } catch { return { erro: `thumbnails falhou (${r.status})` }; }
  const v = Array.isArray(j?.videos) ? j.videos[0] : null;
  if (!v || v.erro) return { erro: String(v?.erro ?? "sem quadros na resposta") };
  const todos: any[] = Array.isArray(v.quadros) ? v.quadros : [];
  const mediana = Number(v.mediana_bytes ?? 0);
  const piso = mediana > 0 ? mediana * PESO_MINIMO_DA_MEDIANA : 0;
  const sobreviventes = todos.filter((q) => typeof q.bytes === "number" && q.bytes >= piso && q.uri);
  // Distribui os 5 ao longo do TEMPO entre os que sobraram (a ordem do array e a ordem temporal).
  const escolhidos: any[] = [];
  if (sobreviventes.length <= QUADROS_POR_VIDEO) escolhidos.push(...sobreviventes);
  else {
    const passo = (sobreviventes.length - 1) / (QUADROS_POR_VIDEO - 1);
    for (let k = 0; k < QUADROS_POR_VIDEO; k++) escolhidos.push(sobreviventes[Math.round(k * passo)]);
  }
  return { total: todos.length, mediana, piso, sobreviventes: sobreviventes.length,
    descartados_por_peso: todos.length - sobreviventes.length, escolhidos };
}

async function rodarAnaliseVisual(foco: string, ctx: { companyId: string; mcpKey?: string }, prazo: () => number, tel: any, opts: OpcoesVisao = {}) {
  const base = String(opts.base ?? BASE_PADRAO).trim() || BASE_PADRAO;
  const nomeSub = "analise_visual_drive";
  const inv = await t_drive_criativos(ctx.companyId);
  if ((inv as any)?.erro) return { nome: nomeSub, relatorio: `LACUNAS: inventario do Drive indisponivel (${(inv as any).erro}) - nenhuma analise visual feita nesta rodada.`, completo: false };
  const arquivos: any[] = (inv as any).arquivos ?? [];

  // v2.5: as impressoes digitais vem do MESMO plano que definiu as pastas, em vez de uma consulta
  // propria - uma fonte so para "o que varrer" e "o que ja foi analisado".
  // v2.6: o plano e pedido PARA A BASE desejada. `ja_analisados` sao as que ja foram vistas NESSA
  // base (pulam); `vistos_em_base_mais_rasa` sao as vistas de forma menos completa (reanalisam).
  const { data: plano } = await supa.rpc("drive_plano_de_varredura", {
    p_company_id: ctx.companyId, p_base_desejada: base,
  });
  const jaAnalisados: any[] = Array.isArray((plano as any)?.ja_analisados) ? (plano as any).ja_analisados : [];
  const jaFeito = new Set(jaAnalisados.map((f: any) => `${f.f}|${f.m ?? ""}`));
  const emBaseMaisRasa = Array.isArray((plano as any)?.vistos_em_base_mais_rasa) ? (plano as any).vistos_em_base_mais_rasa.length : 0;
  // v2.6: filtros do recorte da rodada. `somenteImagens` existe porque reanalisar VIDEO por
  // miniatura com critério novo gastaria visão para continuar vendo um quadro - o video espera a
  // rota de quadros. `somenteNomes` e `limite` servem ao aceite parcial: provar em 5 antes de 48.
  const alvoNomes = (opts.somenteNomes ?? []).map((n) => n.trim().toLowerCase()).filter(Boolean);
  // v2.9: o recorte por TIPO entra AQUI, antes do corte por `limite`. Na v2.8 a base multiquadro
  // filtrava video dentro do laco, depois do slice(0, limite): com limite 12 os 12 primeiros
  // pendentes eram imagens, todas foram puladas e a corrida devolveu 0 analisadas em 5s. Nao
  // quebrou nada e nao gravou nada errado - simplesmente nao fez, e so a telemetria nova
  // (multiquadro: [] com falhas 0) tornou isso visivel em vez de parecer "nada a fazer".
  const soVideo = base.startsWith("multiquadro");
  const pendentes = arquivos.filter((a: any) => {
    if (!a.thumbnail) return false;
    if (jaFeito.has(`${a.id ?? a.nome}|${a.modificado_em ?? ""}`)) return false;
    const ehVideo = String(a.tipo ?? "").startsWith("video/");
    if (opts.somenteImagens && ehVideo) return false;
    if (soVideo && !ehVideo) return false;
    if (alvoNomes.length && !alvoNomes.includes(String(a.nome ?? "").trim().toLowerCase())) return false;
    return true;
  });
  const semThumb = arquivos.filter((a: any) => !a.thumbnail);

  let analisados = 0, falhasThumb = 0, falhasGravacao = 0;
  const teto = Math.max(1, Math.min(Number(opts.limite ?? VISAO_MAX_POR_RODADA), VISAO_MAX_POR_RODADA));
  const fila = pendentes.slice(0, teto);
  const modoMultiquadro = base.startsWith("multiquadro");
  const detalheQuadros: any[] = [];
  const semVideoId: string[] = [];

  // ---------- caminho MULTIQUADRO: 5 quadros da Meta por video, um video por chamada ----------
  if (modoMultiquadro) {
    for (const arq of fila) {
      if (prazo() < VISAO_MIN_PRAZO_MS) break;
      if (!String(arq.tipo ?? "").startsWith("video/")) continue;   // multiquadro so faz sentido em video
      if (!ctx.mcpKey) { falhasThumb++; continue; }
      // O quadro vem da Meta, entao exige o video JA na biblioteca. Sem video_id nao ha o que ler -
      // e isso e lacuna declarada, nao peca ruim.
      const { data: up } = await supa.from("media_uploads")
        .select("meta_video_id").eq("drive_file_id", String(arq.id ?? ""))
        .eq("status", "enviado").not("meta_video_id", "is", null).maybeSingle();
      const videoId = up?.meta_video_id ? String(up.meta_video_id) : "";
      if (!videoId) { semVideoId.push(String(arq.nome ?? arq.id)); continue; }

      const q: any = await quadrosDaMeta(videoId, ctx.mcpKey);
      if (q.erro) { falhasThumb++; detalheQuadros.push({ nome: arq.nome, erro: q.erro }); continue; }
      const imagens: { b64: string; mime: string; indice: number }[] = [];
      for (const esc of q.escolhidos ?? []) {
        const th = await baixarThumb(String(esc.uri));
        if (th) imagens.push({ b64: th.b64, mime: th.mime, indice: esc.indice });
      }
      detalheQuadros.push({ nome: arq.nome, video_id: videoId, total_da_meta: q.total,
        mediana_bytes: q.mediana, descartados_por_peso: q.descartados_por_peso,
        sobreviventes: q.sobreviventes, usados: imagens.length,
        indices_usados: imagens.map((x) => x.indice) });
      if (!imagens.length) { falhasThumb++; continue; }

      const content: any[] = [{ type: "text", text:
        `Voce analisa um VIDEO de anuncio a partir de ${imagens.length} QUADROS extraidos ao longo dele (ordem cronologica). A operacao e EXCLUSIVAMENTE de credito consignado CLT (categoria especial na Meta). O UNIVERSO CRIATIVO DA MARCA, por decisao do gestor (31/07/2026), inclui tres temas: credito consignado CLT, EDUCACAO FINANCEIRA e DICAS DE SEGURANCA financeira - pecas desses temas SAO aproveitaveis. Devolve UM objeto JSON para o video inteiro. Campos: produto_detectado (consignado CLT, educacao financeira, seguranca, imovel, consorcio, financiamento, abertura de conta, indeterminado); confianca ("alta"|"media"|"baixa"); quadro_que_sustenta (o numero do quadro, de 1 a ${imagens.length}, que sustenta a conclusao); texto_visivel (transcreva o texto legivel somando os quadros, sem repetir); menciona_taxa_prazo_ou_valor (true/false - materia de compliance de credito) e qual_valor (o trecho, ou vazio); quadros_divergem (true/false - se os quadros contam historias diferentes entre si, o que num video e comum e e informacao valiosa) e o_que_diverge (uma frase, ou vazio); riscos_compliance (promessa de aprovacao, taxa prometida, "garantido", urgencia enganosa, ausencia de ressalva - so o que estiver VISIVEL); aproveitavel: "sim" se e credito CLT, educacao financeira ou seguranca e sem risco visivel, "nao" APENAS se mostra explicitamente OUTRO produto financeiro (financiamento de veiculo, conta corrente, consorcio, imovel) ou tem risco claro, "incerto" se os quadros nao permitem afirmar; motivo (uma frase). LIMITE REAL: voce ve ${imagens.length} quadros de um video, NAO o video - nao ha audio e o que acontece entre os quadros nao foi visto. "indeterminado" e "incerto" continuam sendo respostas legitimas: com mais evidencia devem ficar mais raros, nao proibidos. Forcar classificacao produz numero bonito e falso. Responda APENAS JSON: {"produto_detectado":"...","confianca":"...","quadro_que_sustenta":1,"texto_visivel":"...","menciona_taxa_prazo_ou_valor":false,"qual_valor":"","quadros_divergem":false,"o_que_diverge":"","riscos_compliance":"","aproveitavel":"sim|nao|incerto","motivo":"..."}` +
        `\nArquivo: ${arq.nome} (pasta: ${arq.caminho})` }];
      for (const im of imagens) content.push({ type: "image_url", image_url: { url: `data:${im.mime};base64,${im.b64}` } });
      const r = await chamarLLM([{ role: "user", content }], { maxTokens: 1500, reasoning: REASONING_OFF, model: MODEL_SUB });
      if (r.erro) continue;
      const it = extrairJSON(String(r.parsed?.choices?.[0]?.message?.content ?? "")) ?? {};
      const aprov = ["sim", "nao", "incerto"].includes(String(it?.aproveitavel)) ? String(it.aproveitavel) : "incerto";
      const extras = [
        it?.confianca ? `confianca: ${it.confianca}` : "",
        it?.quadro_que_sustenta ? `quadro ${it.quadro_que_sustenta} sustenta` : "",
        it?.menciona_taxa_prazo_ou_valor === true ? `MENCIONA VALOR/TAXA/PRAZO: ${String(it?.qual_valor ?? "").slice(0, 80)}` : "",
        it?.quadros_divergem === true ? `QUADROS DIVERGEM: ${String(it?.o_que_diverge ?? "").slice(0, 80)}` : "",
      ].filter(Boolean).join(" · ");
      const { error: eUp } = await supa.from("drive_midia_analises").upsert({
        company_id: ctx.companyId, drive_file_id: String(arq.id ?? arq.nome), drive_modified_time: arq.modificado_em ?? "",
        base_da_analise: base,
        nome: arq.nome, caminho: arq.caminho, formato_pasta: arq.formato_pasta, eixo_pasta: arq.eixo_pasta, mime: arq.tipo,
        produto_detectado: String(it?.produto_detectado ?? "indeterminado").slice(0, 120),
        texto_visivel: String(it?.texto_visivel ?? "").slice(0, 800),
        riscos_compliance: String(it?.riscos_compliance ?? "").slice(0, 400),
        aproveitavel: aprov,
        motivo: `${String(it?.motivo ?? "sem motivo")}${extras ? ` [${extras}]` : ""}`.slice(0, 400),
        modelo: MODEL_SUB, analisado_em: new Date().toISOString(),
      }, { onConflict: "drive_file_id,drive_modified_time,base_da_analise" });
      if (eUp) { falhasGravacao++; continue; }
      analisados++;
    }
  }

  for (let i = 0; !modoMultiquadro && i < fila.length; i += VISAO_LOTE) {
    if (prazo() < VISAO_MIN_PRAZO_MS) break;
    const lote = fila.slice(i, i + VISAO_LOTE);
    const imagens: { arq: any; b64: string; mime: string }[] = [];
    for (const arq of lote) {
      const th = await baixarThumb(String(arq.thumbnail));
      if (th) imagens.push({ arq, b64: th.b64, mime: th.mime }); else falhasThumb++;
    }
    if (!imagens.length) continue;
    const content: any[] = [{ type: "text", text:
      `Voce analisa criativos de anuncio para uma operacao cuja campanha e EXCLUSIVAMENTE de credito consignado CLT (categoria especial de credito na Meta). O UNIVERSO CRIATIVO DA MARCA, por decisao do gestor (31/07/2026), inclui tres temas: credito consignado CLT, EDUCACAO FINANCEIRA e DICAS DE SEGURANCA financeira - pecas educativas e de seguranca SAO aproveitaveis. Para CADA imagem, na ordem, devolva um item JSON. Criterios: produto_detectado (o que a peca vende ou trata, pelo que esta VISIVEL: consignado CLT, educacao financeira, seguranca, imovel, consorcio, financiamento, abertura de conta, indeterminado); texto_visivel (transcreva o texto legivel da peca); riscos_compliance (promessa de aprovacao, taxa prometida, "garantido", urgencia enganosa, ausencia de ressalva de analise - so o que estiver VISIVEL); aproveitavel: "sim" se a peca e de credito CLT, educacao financeira ou dicas de seguranca e sem risco visivel, "nao" APENAS se mostra explicitamente OUTRO produto financeiro (financiamento de veiculo, conta corrente, consorcio, imovel) ou tem risco claro de texto, "incerto" se nao da para afirmar pelo frame. motivo: uma frase. LEMBRE: voce ve UM FRAME/miniatura - se a peca e video, o interior nao foi visto; na duvida, "incerto" e melhor que chute. Responda APENAS JSON: {"itens":[{"nome":"...","produto_detectado":"...","texto_visivel":"...","riscos_compliance":"...","aproveitavel":"sim|nao|incerto","motivo":"..."}]}` + `\nArquivos nesta ordem: ${imagens.map((x) => `${x.arq.nome} (pasta: ${x.arq.caminho})`).join(" | ")}` }];
    for (const im of imagens) content.push({ type: "image_url", image_url: { url: `data:${im.mime};base64,${im.b64}` } });
    const r = await chamarLLM([{ role: "user", content }], { maxTokens: 2500, reasoning: REASONING_OFF, model: MODEL_SUB });
    if (r.erro) continue;
    const bruto = extrairJSON(String(r.parsed?.choices?.[0]?.message?.content ?? ""));
    const itens = Array.isArray(bruto?.itens) ? bruto.itens : [];
    for (let k = 0; k < imagens.length; k++) {
      const arq = imagens[k].arq; const it = itens[k] ?? {};
      const aprov = ["sim", "nao", "incerto"].includes(String(it?.aproveitavel)) ? String(it.aproveitavel) : "incerto";
      const { error: eUp } = await supa.from("drive_midia_analises").upsert({
        company_id: ctx.companyId, drive_file_id: String(arq.id ?? arq.nome), drive_modified_time: arq.modificado_em ?? "",
        base_da_analise: base,
        nome: arq.nome, caminho: arq.caminho, formato_pasta: arq.formato_pasta, eixo_pasta: arq.eixo_pasta, mime: arq.tipo,
        produto_detectado: String(it?.produto_detectado ?? "indeterminado").slice(0, 120),
        texto_visivel: String(it?.texto_visivel ?? "").slice(0, 800),
        riscos_compliance: String(it?.riscos_compliance ?? "").slice(0, 400),
        aproveitavel: aprov, motivo: String(it?.motivo ?? "sem motivo").slice(0, 400),
        modelo: MODEL_SUB, analisado_em: new Date().toISOString(),
        // v2.6: o onConflict TEM de citar as tres colunas da uq_drive_analise. A versao anterior
        // citava (drive_file_id, drive_modified_time) e esse indice de 2 colunas NAO EXISTE MAIS -
        // toda gravacao falharia com 42P10, e o erro era descartado: `analisados++` acontecia de
        // qualquer jeito e a telemetria diria "analisado". Falha silenciosa, achada antes de rodar.
      }, { onConflict: "drive_file_id,drive_modified_time,base_da_analise" });
      if (eUp) { falhasGravacao++; continue; }
      analisados++;
    }
  }

  // relatorio = estado ACUMULADO da tabela (inclui rodadas anteriores) NA BASE DESTA RODADA.
  // v2.6: sem o filtro por base, o relatorio somaria o veredito de 31/07 com o novo e a contagem
  // de cobertura passaria do total - duas leituras da mesma peca nao sao duas pecas.
  const { data: tudo } = await supa.from("drive_midia_analises")
    .select("nome, caminho, formato_pasta, eixo_pasta, produto_detectado, aproveitavel, motivo, riscos_compliance")
    .eq("company_id", ctx.companyId).eq("base_da_analise", base).order("caminho");
  const linhas = (tudo ?? []).map((t2: any) =>
    `- [${t2.aproveitavel.toUpperCase()}] ${t2.caminho}/${t2.nome} | produto: ${t2.produto_detectado} | ${t2.motivo}${t2.riscos_compliance ? " | risco: " + t2.riscos_compliance : ""}`).join("\n");
  const cobertura = (tudo ?? []).length;
  const totalComThumb = arquivos.filter((a: any) => a.thumbnail).length;
  const rel = `ANALISE VISUAL DAS MIDIAS DO DRIVE (persistida em banco; base desta leitura: ${base} - se a base cita "thumbnail", de video se ve UM frame, nunca o interior)\n` +
    `Cobertura acumulada NESTA BASE: ${cobertura} de ${totalComThumb} arquivos com miniatura (${arquivos.length} no inventario; ${semThumb.length} sem miniatura disponivel). Nesta rodada: ${analisados} analisados, ${falhasThumb} miniaturas falharam, ${falhasGravacao} falharam ao gravar.\n` +
    (emBaseMaisRasa ? `${emBaseMaisRasa} peca(s) tem leitura em base mais rasa e estao sendo reavaliadas nesta base - o veredito anterior NAO foi apagado, continua no banco sob a base antiga.\n` : "") +
    `Resumo: SIM=${(tudo ?? []).filter((x: any) => x.aproveitavel === "sim").length} · NAO=${(tudo ?? []).filter((x: any) => x.aproveitavel === "nao").length} · INCERTO=${(tudo ?? []).filter((x: any) => x.aproveitavel === "incerto").length}\n` +
    linhas +
    (cobertura < totalComThumb ? `\nLACUNAS: ${totalComThumb - cobertura} arquivos ainda sem analise (teto por rodada/prazo) - nova rodada continua de onde parou, nada se refaz.` : "\nCobertura completa dos arquivos com miniatura.") +
    (semThumb.length ? `\nSem miniatura (nao analisaveis por visao): ${semThumb.map((x: any) => x.nome).slice(0, 10).join(", ")}${semThumb.length > 10 ? "..." : ""}` : "");
  tel.visao = { base, analisados_nesta_rodada: analisados, cobertura_acumulada: cobertura,
    total: totalComThumb, falhas_thumb: falhasThumb, falhas_gravacao: falhasGravacao,
    candidatas_nesta_base: pendentes.length, em_base_mais_rasa: emBaseMaisRasa,
    ...(modoMultiquadro ? { multiquadro: detalheQuadros, sem_video_id: semVideoId } : {}) };
  return { nome: nomeSub, relatorio: rel.slice(0, 24000), completo: cobertura >= totalComThumb };
}

// ============================================================================
// v2 - VALIDACAO DA COORDENACAO ("a mae"): aprova ou devolve com parecer
// ============================================================================
// A mae nao valida "esta certo" no sentido absoluto - valida criterios VERIFICAVEIS:
// cobriu o foco atribuido? tem numero+fonte+janela? saiu do escopo? termina em LACUNAS?
// Veredito subjetivo de "qualidade" e proibido de proposito: e a receita do loop infinito.
async function validarRelatorios(
  pergunta: string,
  plano: { nome: string; foco: string }[],
  relatorios: { nome: string; relatorio: string; completo: boolean }[],
  tel: any,
): Promise<{ nome: string; motivo: string }[]> {
  const resumo = relatorios.map((r) => {
    const foco = plano.find((p) => p.nome === r.nome)?.foco ?? "";
    return `--- ${r.nome} (foco atribuido: ${foco || "geral"}) [${r.completo ? "COMPLETO" : "INCOMPLETO-cortado"}] ---\n${r.relatorio.slice(0, 3200)}`;
  }).join("\n\n");
  const sys = `Voce e a COORDENACAO de uma equipe de especialistas de trafego pago. Avalie cada relatorio contra CRITERIOS VERIFICAVEIS, nunca contra gosto:
(1) COBERTURA: o relatorio atende o foco que foi atribuido ao especialista? (2) FORMA: numeros vem com fonte e janela, e existe a linha LACUNAS? (3) ESCOPO: ele respondeu o que era de OUTRO especialista em vez do proprio dominio? (4) COERENCIA INTERNA: ha contradicao evidente dentro do proprio relatorio? (5) COBERTURA PAGINAVEL: o relatorio aceitou corte de dados ('X de Y exibidos', 'restantes') SEM esgotar as paginas disponiveis, quando o foco exigia a lista inteira? Isso E motivo de devolucao - a ferramenta pagina e o especialista tinha teto sobrando.
NAO devolva por: estilo, tamanho, relatorio marcado INCOMPLETO-cortado (isso e limite de tamanho, nao erro do especialista), ou lacuna JA DECLARADA na linha LACUNAS (declarar lacuna e comportamento correto).
Responda APENAS JSON valido: {"avaliacoes":[{"nome":"...","veredito":"ok"|"devolver","motivo":"especifico: o que faltou/errou e o que a nova tentativa deve trazer"}]}`;
  const r = await chamarLLM(
    [{ role: "system", content: sys },
     { role: "user", content: `PERGUNTA DO GESTOR:\n${pergunta.slice(0, 4000)}\n\nRELATORIOS:\n${resumo}` }],
    { maxTokens: 1500, reasoning: REASONING_OFF },
  );
  if (r.erro) { tel.validacao = { erro: r.erro, aviso: "validacao indisponivel - relatorios seguem sem devolucao" }; return []; }
  const u = usoDe(r.parsed);
  const bruto = extrairJSON(String(r.parsed?.choices?.[0]?.message?.content ?? ""));
  const lista = Array.isArray(bruto?.avaliacoes) ? bruto.avaliacoes : [];
  const nomesValidos = new Set(relatorios.map((x) => x.nome));
  const devolver = lista
    .filter((a: any) => String(a?.veredito ?? "") === "devolver" && nomesValidos.has(String(a?.nome ?? "")))
    .map((a: any) => ({ nome: String(a.nome), motivo: String(a?.motivo ?? "sem motivo declarado").slice(0, 500) }));
  tel.validacao = { tokens_in: u.tin, tokens_out: u.tout, devolvidos: devolver.map((d: any) => d.nome) };
  return devolver;
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

// v2: helpers de lote, checkpoint e reinvocacao ------------------------------
async function executarLote(
  lote: { nome: string; foco: string }[], pergunta: string,
  ctx: { companyId: string; mcpKey: string }, prazo: () => number, tel: any,
): Promise<{ nome: string; relatorio: string; completo: boolean }[]> {
  const resultados = await Promise.allSettled(lote.map((p) =>
    p.nome === "analise_visual_drive"
      ? rodarAnaliseVisual(p.foco, ctx, prazo, tel)
      : rodarSubagente(p.nome, p.foco, pergunta, ctx, prazo)));
  const saida: { nome: string; relatorio: string; completo: boolean }[] = [];
  for (let i = 0; i < resultados.length; i++) {
    const res = resultados[i];
    if (res.status === "fulfilled") {
      saida.push({ nome: res.value.nome, relatorio: res.value.relatorio, completo: res.value.completo });
      tel.subagentes.push({ nome: res.value.nome, tools: res.value.tools, tokens_in: res.value.tokens_in,
        tokens_out: res.value.tokens_out, reasoning_tokens: res.value.reasoning_tokens, finish: res.value.finish,
        partes_relatorio: res.value.partes, relatorio_completo: res.value.completo });
    } else {
      saida.push({ nome: lote[i].nome, relatorio: `(especialista falhou: ${String(res.reason).slice(0, 200)} - trate como LACUNA)`, completo: false });
      tel.subagentes.push({ nome: lote[i].nome, erro: String(res.reason).slice(0, 200), relatorio_completo: false });
    }
  }
  return saida;
}

async function gravarCheckpointEReinvocar(
  jobId: string, convId: string, companyId: string, mcpKey: string,
  cp: { pergunta: string; plano: any[]; relatorios: any[]; devolver: any[]; rodada: number; tel_parcial: any; segmento: number; direto_para_sintese?: boolean },
) {
  await supa.from("chat_jobs").update({
    checkpoint: cp, segmento: cp.segmento,
    status: "running",
  }).eq("id", jobId);
  await pushProgresso(jobId, "segmento", `prazo do worker esgotando: continuando no segmento ${cp.segmento} de ${MAX_SEGMENTOS} (nada sera re-pensado)`);
  // Reinvoca a PROPRIA edge. fire-and-forget: se o POST falhar, o watchdog adota o orfao.
  await fetch(`${SUPABASE_URL}/functions/v1/traffic-agent-job`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-mcp-key": mcpKey },
    body: JSON.stringify({ continuar: true, job_id: jobId }),
  }).then(() => {}, () => {});
}

async function processarJob(jobId: string, convId: string, companyId: string, pergunta: string, mcpKey: string, retomada?: any) {
  const t0 = Date.now();
  const prazo = () => JOB_LIMIT_MS - (Date.now() - t0) - RESERVA_FINAL_MS;
  const segmento: number = Number(retomada?.segmento ?? 1);
  const tel: any = retomada?.tel_parcial ?? { versao: "job-v2.9", subagentes: [] };
  tel.versao = "job-v2.4";
  try {
    await supa.from("chat_jobs").update({ status: "running", started_at: new Date().toISOString() }).eq("id", jobId);

    // v2: RETOMADA DE CHECKPOINT - pula direto para o ponto onde o segmento anterior parou.
    if (retomada) {
      await pushProgresso(jobId, "segmento", `segmento ${segmento}: retomando do checkpoint`);
      const { data: styleRows0 } = await supa.from("agent_style").select("secao,regra").eq("vigente", true).order("ordem");
      const estilo0 = (styleRows0 ?? []).map((r: any) => `- [${String(r.secao).toUpperCase()}] ${r.regra}`).join("\n") || "(sem regras cadastradas)";
      const { data: ctxRows0 } = await supa.from("agent_context").select("categoria,fato,desde").eq("vigente", true)
        .or(`company_id.is.null,company_id.eq.${companyId}`).order("categoria");
      const memoria0 = (ctxRows0 ?? []).map((r: any) => `- [${String(r.categoria).toUpperCase()}${r.desde ? " " + String(r.desde) : ""}] ${r.fato}`).join("\n") || "(sem fatos registrados)";
      let relatorios: { nome: string; relatorio: string; completo: boolean }[] = retomada.relatorios ?? [];
      const plano: { nome: string; foco: string }[] = retomada.plano ?? [];
      let rodada: number = Number(retomada.rodada ?? 0);
      // devolucoes pendentes deste checkpoint (ja com parecer da coordenacao anexavel)
      if (!retomada.direto_para_sintese && Array.isArray(retomada.devolver) && retomada.devolver.length) {
        const refeitos = await executarLote(
          retomada.devolver.map((d: any) => ({ nome: String(d.nome),
            foco: `${plano.find((p) => p.nome === d.nome)?.foco ?? ""}\n\nDEVOLUCAO DA COORDENACAO (rodada ${rodada}): seu relatorio anterior foi recusado. Motivo: ${String(d.motivo)}\nCorrija exatamente isso.` })),
          pergunta, { companyId, mcpKey }, prazo, tel,
        );
        for (const novo of refeitos) {
          const i = relatorios.findIndex((r) => r.nome === novo.nome);
          if (i >= 0) relatorios[i] = novo; else relatorios.push(novo);
        }
        // uma re-validacao final se ainda ha rodadas e prazo
        while (rodada < DEVOLUCOES_MAX) {
          const devolver2 = await validarRelatorios(pergunta, plano, relatorios, tel);
          if (!devolver2.length) break;
          rodada++;
          if (prazo() < CHECKPOINT_MIN_MS && segmento < MAX_SEGMENTOS) {
            await gravarCheckpointEReinvocar(jobId, convId, companyId, mcpKey, {
              pergunta, plano, relatorios, devolver: devolver2, rodada, tel_parcial: tel, segmento: segmento + 1 });
            return;
          }
          const refeitos2 = await executarLote(
            devolver2.map((d) => ({ nome: d.nome, foco: `DEVOLUCAO DA COORDENACAO (rodada ${rodada}): ${d.motivo}. Corrija exatamente isso.` })),
            pergunta, { companyId, mcpKey }, prazo, tel,
          );
          for (const novo of refeitos2) {
            const i = relatorios.findIndex((r) => r.nome === novo.nome);
            if (i >= 0) relatorios[i] = novo; else relatorios.push(novo);
          }
        }
      }
      tel.rodadas_devolucao = rodada;
      tel.segmento = segmento;
      await pushProgresso(jobId, "sintese", "escrevendo a resposta final");
      const texto0 = await sintetizar(pergunta, relatorios, estilo0, memoria0, prazo, tel);
      tel.ms_total = Date.now() - t0;
      const finishSint0 = tel.sintese?.finish_reason ?? "stop";
      await supa.from("chat_messages").insert({
        conversation_id: convId, company_id: companyId, role: "assistant", content: texto0, model: MODEL,
        tokens_in: tel.subagentes.reduce((a: number, s2: any) => a + (s2.tokens_in ?? 0), 0) + (tel.sintese?.tokens_in ?? 0),
        tokens_out: tel.subagentes.reduce((a: number, s2: any) => a + (s2.tokens_out ?? 0), 0) + (tel.sintese?.tokens_out ?? 0),
        diagnostico: { ...tel, finish_reason: finishSint0, origem: "traffic-agent-job" },
      });
      await supa.from("chat_conversations").update({ updated_at: new Date().toISOString() }).eq("id", convId);
      await supa.from("chat_jobs").update({ status: "done", finished_at: new Date().toISOString(), diagnostico: tel, checkpoint: null }).eq("id", jobId);
      return;
    }

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
    let relatorios = await executarLote(plano, pergunta, { companyId, mcpKey }, prazo, tel);
    await pushProgresso(jobId, "subagentes", "relatorios prontos");

    // FASE 2.5 (v2) - VALIDACAO DA COORDENACAO + DEVOLUCAO (com segmentacao se o prazo apertar)
    let rodada = 0;
    const falhosDefinitivos: string[] = [];
    while (rodada < DEVOLUCOES_MAX) {
      const devolver = await validarRelatorios(pergunta, plano, relatorios, tel);
      if (!devolver.length) break;
      rodada++;
      await pushProgresso(jobId, "devolucao", `rodada ${rodada}: ${devolver.map((d) => d.nome).join(", ")}`);
      // prazo apertado com trabalho pendente -> grava checkpoint e reinvoca (novo segmento)
      if (prazo() < CHECKPOINT_MIN_MS && segmento < MAX_SEGMENTOS) {
        await gravarCheckpointEReinvocar(jobId, convId, companyId, mcpKey, {
          pergunta, plano, relatorios, devolver, rodada, tel_parcial: tel, segmento: segmento + 1 });
        return; // este worker termina limpo; o proximo retoma do ponto exato
      }
      const refeitos = await executarLote(
        devolver.map((d) => ({ nome: d.nome,
          foco: `${plano.find((p) => p.nome === d.nome)?.foco ?? ""}\n\nDEVOLUCAO DA COORDENACAO (rodada ${rodada}): seu relatorio anterior foi recusado. Motivo: ${d.motivo}\nCorrija exatamente isso; o que ja estava certo nao precisa ser repetido do zero.` })),
        pergunta, { companyId, mcpKey }, prazo, tel,
      );
      for (const novo of refeitos) {
        const i = relatorios.findIndex((r) => r.nome === novo.nome);
        if (i >= 0) relatorios[i] = novo; else relatorios.push(novo);
      }
      if (rodada >= DEVOLUCOES_MAX) {
        // ainda reprovados na proxima validacao entrariam aqui - marca sem re-validar para nao gastar o prazo
        for (const d of devolver) if (!falhosDefinitivos.includes(d.nome)) falhosDefinitivos.push(d.nome);
      }
    }
    if (falhosDefinitivos.length) {
      tel.devolucao_esgotada = falhosDefinitivos;
      for (const nome of falhosDefinitivos) {
        const i = relatorios.findIndex((r) => r.nome === nome);
        if (i >= 0) relatorios[i] = { ...relatorios[i], relatorio: `[RELATORIO COM DEVOLUCAO ESGOTADA - a coordenacao recusou ${DEVOLUCOES_MAX}x; use com reserva e declare a limitacao]\n` + relatorios[i].relatorio };
      }
    }
    tel.rodadas_devolucao = rodada;
    tel.segmento = segmento;

    // Sintese em segmento proprio se o prazo nao comporta escrever a resposta inteira
    if (prazo() < CHECKPOINT_MIN_MS && segmento < MAX_SEGMENTOS) {
      await gravarCheckpointEReinvocar(jobId, convId, companyId, mcpKey, {
        pergunta, plano, relatorios, devolver: [], rodada, tel_parcial: tel, segmento: segmento + 1, direto_para_sintese: true });
      return;
    }

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

  const xKey = (req.headers.get("x-mcp-key") ?? "").trim();
  const bearer = bearerDe(req);
  let userId: string | null = null, authed = false;
  if (xKey) {
    const v = await mcpKeyValida(supa, xKey);
    if (!v.ok) return json({ error: "unauthorized", motivo: v.motivo }, 401);
    authed = true;
  } else if (bearer) {
    const { data: u } = await supa.auth.getUser(bearer);
    if (u?.user) { authed = true; userId = u.user.id; }
    else {
      const v = await mcpKeyValida(supa, bearer);
      if (v.ok) authed = true;
    }
  }
  if (!authed) return json({ error: "unauthorized" }, 401);
  const { data: cfg } = await supa.from("mcp_config").select("api_key").eq("id", 1).maybeSingle();

  let body: any = {};
  try { body = await req.json(); } catch { /* */ }

  // v2.5 (04/08/2026) - MODO VIGIA DO DRIVE: {"modo":"drive_watch","company_id":"..."}.
  // Existe para o cron ter o que chamar. Roda SO a varredura das pastas monitoradas e a visao
  // nas pecas novas - sem PLANNER, sem subagentes, sem sintese, portanto sem nenhuma chamada de
  // LLM de raciocinio: o custo e a visao nas pecas que mudaram, e zero quando nada mudou.
  // Modo em vez de edge nova pelo mesmo motivo do GT-09: acrescentar caminho a algo que ja sabe
  // baixar e analisar e mais barato que uma segunda edge competindo pela mesma tabela.
  // O retorno NUNCA e silencioso: "0 pecas novas em N pastas" e resposta, silencio seria
  // indistinguivel de falha - e essa distincao e o que ultima_varredura_em existe para preservar.
  if (String(body?.modo ?? "") === "drive_watch") {
    const companyId = String(body?.company_id ?? "").trim();
    if (!companyId) return json({ error: "drive_watch exige company_id - a RPC do plano e por empresa e a pasta de uma empresa nao pode ser lida sob outra" }, 400);
    const tw = Date.now();
    const prazoW = () => JOB_LIMIT_MS - (Date.now() - tw) - RESERVA_FINAL_MS;
    const telW: any = {};
    // v2.6: base e recorte pelo body. Default 'thumbnail' para o cron das 08:45 nao regredir.
    const baseW = String(body?.base_da_analise ?? BASE_PADRAO).trim() || BASE_PADRAO;
    const nomesW: string[] = Array.isArray(body?.somente_nomes) ? body.somente_nomes.map((x: unknown) => String(x)) : [];
    const opts: OpcoesVisao = {
      base: baseW,
      somenteNomes: nomesW.length ? nomesW : undefined,
      limite: body?.limite !== undefined ? Number(body.limite) : undefined,
      somenteImagens: body?.somente_imagens === true,
    };
    const { data: planoW } = await supa.rpc("drive_plano_de_varredura", { p_company_id: companyId, p_base_desejada: baseW });
    const nPastas = Array.isArray((planoW as any)?.pastas_ativas) ? (planoW as any).pastas_ativas.length : 0;
    const nDesativadas = Array.isArray((planoW as any)?.pastas_desativadas) ? (planoW as any).pastas_desativadas.length : 0;
    // v2.7: mcpKey vai no ctx porque o caminho multiquadro precisa chamar a upload-midia (que tem o
    // token da Meta). Este job nao tem META_ADS_TOKEN e nao deve ter - um segredo, um dono.
    const r = await rodarAnaliseVisual("varredura automatica do Drive",
      { companyId, mcpKey: String(cfg?.api_key ?? "") }, prazoW, telW, opts);
    const v = telW.visao ?? { analisados_nesta_rodada: 0, cobertura_acumulada: null, total: null, falhas_thumb: 0, falhas_gravacao: 0 };
    return json({ ok: true, modo: "drive_watch", versao: "job-v2.9",
      base_da_analise: baseW, recorte: { somente_imagens: !!opts.somenteImagens, somente_nomes: nomesW, limite: opts.limite ?? null },
      pastas_ativas: nPastas, pastas_desativadas: nDesativadas,
      pecas_novas_analisadas: v.analisados_nesta_rodada,
      cobertura_acumulada: v.cobertura_acumulada, total_com_miniatura: v.total,
      miniaturas_que_falharam: v.falhas_thumb, falhas_ao_gravar: v.falhas_gravacao ?? 0,
      candidatas_nesta_base: v.candidatas_nesta_base ?? null, em_base_mais_rasa: v.em_base_mais_rasa ?? null,
      // v2.8: o detalhe do filtro de peso sai NO RETORNO. Na corrida de 5 videos eu tive de
      // reconstruir esses numeros chamando a thumbnails de novo - numa corrida grande isso nao
      // escala, e numero que precisa ser reconstruido e numero que ninguem confere.
      multiquadro: v.multiquadro ?? null,
      sem_video_id: v.sem_video_id ?? null,
      completo: (r as any)?.completo ?? null,
      resumo: `${v.analisados_nesta_rodada} peca(s) analisada(s) na base '${baseW}' em ${nPastas} pasta(s) monitorada(s)` +
        (nDesativadas ? ` (${nDesativadas} pasta(s) desativada(s) NAO foram lidas)` : "") +
        ((v.falhas_gravacao ?? 0) > 0 ? ` - ATENCAO: ${v.falhas_gravacao} falha(s) ao GRAVAR, o veredito foi produzido e nao persistiu` : "") +
        (v.analisados_nesta_rodada === 0 ? " - nada a analisar nesta base, o que NAO e falha" : ""),
      duracao_ms: Date.now() - tw });
  }

  // v2: CONTINUACAO DE SEGMENTO - a propria edge se reinvoca com o job_id; o novo worker
  // le o checkpoint do banco e retoma do ponto exato, com orcamento de tempo zerado.
  if (body?.continuar === true && body?.job_id) {
    const { data: job } = await supa.from("chat_jobs")
      .select("id, conversation_id, company_id, message, status, checkpoint, segmento")
      .eq("id", String(body.job_id)).maybeSingle();
    if (!job) return json({ error: "job nao encontrado" }, 404);
    if (job.status === "done" || job.status === "error") return json({ ok: true, aviso: "job ja finalizado - nada a continuar" }, 200);
    if (!job.checkpoint) return json({ error: "job sem checkpoint - nada a retomar" }, 400);
    if (Number(job.segmento ?? 1) > MAX_SEGMENTOS) return json({ error: "teto de segmentos atingido" }, 400);
    const cp = job.checkpoint as any;
    // limpa o checkpoint consumido ANTES de processar: reentrega duplicada nao reprocessa
    await supa.from("chat_jobs").update({ checkpoint: null }).eq("id", job.id);
    (globalThis as any).EdgeRuntime?.waitUntil
      ? (globalThis as any).EdgeRuntime.waitUntil(processarJob(job.id, job.conversation_id, job.company_id, String(job.message ?? cp.pergunta ?? ""), cfg?.api_key ?? "", cp))
      : processarJob(job.id, job.conversation_id, job.company_id, String(job.message ?? cp.pergunta ?? ""), cfg?.api_key ?? "", cp);
    return json({ ok: true, async: true, job_id: job.id, segmento: cp.segmento, aviso: "segmento retomado do checkpoint" }, 202);
  }

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
