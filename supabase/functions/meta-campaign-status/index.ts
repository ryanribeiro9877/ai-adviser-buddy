// supabase/functions/meta-campaign-status/index.ts (v16)
// v16 (20/08/2026) - OPPORTUNITY SCORE / Recommendation Center. O badge "1 recomendacao"
//   do Ads Manager NAO vinha do campo classico `recommendations` em campaign/adset/ad
//   (meta_recommendations ficou 0 em todas as empresas). Fonte correta: GET
//   /act_{id}/recommendations (mid_flight). Mantem a sonda classica; adiciona coleta OS
//   na corrida diaria e modo pontual { modo: "meta_dicas", company_id? } para refresh
//   ao vivo no atalho do traffic-chat. Meta documenta assimetria API < UI.
// v15 (15/08/2026) - DICAS DA META (recommendations). Apos o espelho ESP-13, sonda o campo
//   `recommendations` isoladamente em campanhas ACTIVE, conjuntos dos anuncios ACTIVE e
//   anuncios ACTIVE. Cada dica vira linha em meta_recommendations (first_seen_on/last_seen_on
//   + referencia de campanha/conjunto/criativo) e passa pelo julgamento deterministico
//   (upsert_meta_recomendacoes). Campo ausente nao fabrica []; um #100 em recommendations
//   nao derruba o resto da corrida (mesma doutrina GT-12).
// v14 (11/08/2026) - COLETA PONTUAL DE UM CONJUNTO SOB DEMANDA (auto-resolucao de leitura).
//   A corrida diaria colhe is_dynamic_creative de TODOS os conjuntos, mas conjunto recem-criado
//   pelo fluxo nasce com is_dynamic_creative NULO e so ganha leitura no dia seguinte - e o portao
//   de emissao recusa fechado (estado_conjunto_destino_nao_verificado). Medido em 11/08 com o
//   conjunto 120254414154880191 ("Campanhas Teste RR"): tinha linha em ad_sets, mas estado nulo,
//   e o card do anuncio travou. Nao e edge case: e o caminho feliz de "crio o conjunto e no minuto
//   seguinte quero o anuncio nele". Doutrina do Ryan (11/08): lacuna de LEITURA que o sistema
//   alcanca e resolvida na mesma chamada, sem devolver tarefa ao humano.
//   Esta versao aceita, alem da corrida completa (POST sem corpo, do cron), um POST com
//   { conjunto | adset_external_id } que le SO aquele conjunto na Graph (fields=is_dynamic_creative,
//   LEITURA, nada escrito na Meta), garante a linha em ad_sets se faltar e espelha pela MESMA RPC
//   espelhar_estado_de_conjuntos_da_graph. Reusa lerCampoPorIds - nada de parsing duplicado.
// v13 (11/08/2026) - MOLDE DE IMAGEM: grava expoe_link_data + serve_de_molde_imagem a partir
//   de object_story_spec.link_data (page_id + link + CTA). Os 25 criativos com
//   chaves=["page_id","link_data"] passam a servir de molde para peca nova de imagem.
//   Video (serve_de_molde_video) intacto. Amostra de chaves_do_link_data no retorno.
// v12 (11/08/2026) - CONFIG DO MOLDE: grava VALORES (page_id, link, CTA, IG) e
//   serve_de_molde_video a partir de object_story_spec.video_data OU asset_feed_spec
//   (videos + link_urls + call_to_action_types). Forma do CTA observada na sonda v11:
//   array de strings planas. Ambiguidade de URL/CTA deixa nulo (nao escolhemos). Molde
//   de imagem continua serve=false. O portao passa a liberar os ~23+ criativos dinamicos
//   de video que antes caiam em molde_sem_video_data.
// v11 (11/08/2026) - SONDA READ-ONLY da config do molde dinamico. Hoje so 8 dos 59 criativos
//   da conta servem de molde para peca nova, porque a rota le apenas object_story_spec.
//   Os outros 48 tem object_story_spec com page_id e guardam midia, textos e link no
//   asset_feed_spec - campo que esta funcao JA LE desde a v4 para deduzir destino_url.
//   Antes de montar video_data a partir dessa fonte, esta versao apenas OBSERVA a forma:
//   link_urls[].website_url ja e forma provada, mas a de call_to_action_types nunca foi vista
//   nesta conta, e montar CTA adivinhado publicaria botao errado num anuncio de credito.
//   Nada e gravado nesta versao - nenhuma coluna nova nasce antes da forma ser observada.
// v10 (10/08/2026)
// v10 (10/08/2026) - os OUTROS pre-requisitos do molde. Conferindo o criterio da v9 contra a
//   executora apareceram dois vizinhos no mesmo ponto de meta-actions, com o mesmo defeito de
//   momento: molde_sem_page_id e molde_sem_link_de_destino tambem so falavam depois da
//   aprovacao. Agora page_id e o link de destino (que mora dentro do video_data) tambem sao
//   gravados, e o portao cobra os quatro na ordem da executora.
// v9 (10/08/2026) - ESTADO DO CRIATIVO: ELE SERVE DE MOLDE PARA PECA NOVA DE VIDEO?
//   Mesmo defeito da v8, um nivel ao lado. Em 10/08 as 21:58 um card de anuncio foi
//   APROVADO e so entao a execucao recusou com molde_sem_video_data - o molde escolhido
//   era de conjunto Dynamic Creative e expunha object_story_spec so com page_id. A recusa
//   estava certa; errado era o MOMENTO, porque aprovar card de anuncio e o ato que inicia
//   o gasto e o gestor aprovou algo que nunca teve como executar.
//   O dado ja passava por aqui: esta funcao le object_story_spec de todo criativo da conta
//   desde a v4 (GT-12), usava so para deduzir destino_url e descartava o resto. Agora o
//   fato e gravado em creative_estado_graph e o portao (contrato_de_estado_execucao,
//   propriedade molde_expoe_video_data) recusa ANTES do card.
//   O criterio de "expoe video" replica literalmente o da executora meta-actions: divergir
//   recriaria o mesmo defeito ao contrario - card emitido que a execucao recusa.
// v8 (10/08/2026) - ESTADO DO CONJUNTO (is_dynamic_creative) PASSA A SER COLETADO.
//   O portao de emissao de anuncio (avaliar_estado_destino_execucao) le
//   ad_sets.is_dynamic_creative e RECUSA fechado quando a coluna e nula - correto, porque
//   ausencia de leitura nao e liberacao. O defeito estava em quem deveria alimentar a coluna:
//   NINGUEM. Esta funcao nunca leu o campo, o meta-health so le e registra em audit_log, e o
//   unico preenchimento veio da migracao manual 20260807183846, para 4 moldes. Resultado medido
//   em 10/08: o conjunto 120254387861670191, criado as 21:17, travou o card do anuncio com
//   `estado_conjunto_destino_nao_verificado` - e nenhuma espera resolveria, porque nao havia
//   processo amadurecendo. Todo conjunto novo nascia invisivel para o portao.
//   A leitura roda ANTES das sondas de anuncio e criativo, pela licao da v5: passo de escrita
//   nao fica atras de passo lento, senao um estouro do teto do cron perde justamente o dado que
//   destrava a emissao. A gravacao e da RPC espelhar_estado_de_conjuntos_da_graph, que mantem o
//   contrato do ESP-13: chave ausente na Graph preserva o valor anterior, e valor presente que
//   nao seja booleano fica de fora em vez de virar `false` por conveniencia.
// v7 (06/08/2026) - VARREDURA DE ORFAOS. Depois que a Graph devolve a lista da conta, o que
//   esta no espelho e nao veio e marcado DELETED + ausente_na_graph_em (RPC
//   marcar_orfaos_ausentes_na_graph). Nao apaga linha nem metrica. Conta inacessivel nao marca
//   orfao (seria falso positivo). Inclui adsets na leitura para cobrir TESTE-GT02 e pares.
// v6 (06/08/2026) - ESP-13: historico diario de status do anuncio e saude da conta.
//   effective_status, issues_info e os campos da conta sao sondados isoladamente. A chave so
//   entra no snapshot quando a Graph realmente a devolveu; []/null retornado continua sendo uma
//   leitura, mas campo ausente nao e fabricado. Upsert pela chave diaria torna a corrida idempotente.
//   Conta inacessivel nao gera snapshot. A fonte da saude fica explicitamente `graph`.
// v5 (05/08/2026) - ESPELHO DE OBJETO DO ANUNCIO. `ads.last_synced_at` ficou parado de 27/07 a
//   05/08 nas tres contas, no mesmo microssegundo, enquanto campaigns e ad_metric_snapshots
//   avancavam todo dia. Causa medida, em duas partes:
//     (1) no windsor-sync os passos de objeto (ad_sets e ads) vivem dentro de `if (!skipWide)` e o
//         cron diario manda skip_wide:true - `ads` nunca esteve na corrida diaria;
//     (2) o Windsor descarta anuncio sem sinal de entrega (mapAd/anySignal), entao 13 anuncios que
//         existem na Graph nao poderiam entrar no espelho por aquela rota nem sem timeout.
//   POR QUE O ESPELHO PASSA A MORAR AQUI: a lista de anuncios e ESTADO, nao metrica - e este
//   endpoint ja le a lista completa da conta na Graph (71 anuncios contra 58 no espelho). E a
//   mesma decisao do GT-09 um nivel abaixo. Nao cabia no windsor-sync: medido em 05/08, a corrida
//   diaria dele termina aos 145s de um teto de 150s, sem folga para um passo novo.
//   A gravacao e da RPC espelhar_ads_da_graph: metrica de anuncio novo vem da soma de
//   ad_metric_snapshots (nunca inventada), anuncio existente nao tem metrica tocada, e
//   url_tags/destino_url continuam sendo exclusividade do GT-12.
// v4 (05/08/2026) - GT-12: coleta url_tags e destino_url dos anuncios pela Graph.
//   A coleta preserva a diferenca fundamental entre CAMPO AUSENTE e CAMPO VAZIO:
//   so grava url_tags_coletado_em quando a chave veio na resposta da Graph. Um modificador
//   desconhecido pode ser ignorado em silencio pela API; por isso cada campo candidato e
//   consultado isoladamente e a telemetria declara quantos objetos realmente trouxeram a chave.
//   Conta fora do alcance do token nao e tocada. O valor de url_tags e guardado cru.
//   Destino segue o contrato da migracao 20260805172443: unica grava URL; ambigua grava as
//   candidatas cruas e URL nula; ausente fica explicitamente marcado. A marca so nasce quando
//   object_story_spec ou asset_feed_spec realmente voltou; display URL nao vira destino.
// v3 (04/08/2026) - GT-09: passa a coletar CONFIGURACAO de campanha, nao so status.
//   Seis campos na MESMA requisicao que ja existia: special_ad_categories, bid_strategy,
//   daily_budget, lifetime_budget, is_adset_budget_sharing_enabled, buying_type.
//   POR QUE AQUI E NAO NO WINDSOR (rota decidida em 04/08 com dado real): o Windsor entrega os
//   seis, mas so devolve linha para campanha COM ENTREGA na janela - medido, 2 de 29. Este
//   endpoint le a LISTA de campanhas da conta, entao ve campanha pausada, sem entrega e sem
//   gasto. Configuracao e ESTADO, nao metrica: coletar pela via que so ve quem entregou
//   deixaria 27 campanhas com nulo indistinguivel de "nao tem".
//   config_coletada_em SO e preenchido para campanha que veio da Graph de fato. Campanha cujo
//   status vem do caminho de INFERENCIA por inatividade nao teve config lida - marcar ali faria
//   o nulo passar por ausencia, que e a falha que estas marcas existem para impedir.
//   ORCAMENTO EM CENTAVOS, igual a ad_sets e igual a fonte. As 4 linhas [SALT] que tinham 250.00
//   (reais, vindas de caminho manual) passam a ser sobrescritas com 25000 pela propria coleta.
//   ZERO NAO E NULO: lifetime_budget volta "0" da Graph quando nao ha orcamento vitalicio, e
//   isso e resposta real. Por isso a conversao NUNCA usa `Number(x) || null`, que engoliria o 0.
// v2: varre TODAS as contas de anuncios de public.integrations (nao so a da Legal).
// Motivo: 9 campanhas de outra conta (946388181625874) seguiam marcadas como 'active' e
// inflavam a contagem que o agente reporta. Para contas que o token nao acessa, aplica
// regra de INATIVIDADE (sem gasto ha mais de 45 dias => paused) e reporta isso como
// inferencia, nao como status oficial da Meta.
// SOMENTE leitura na Meta + UPDATE local. Auth: x-mcp-key via mcp_key_valida.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { chaveMcpDe, mcpKeyValida } from "../_shared/mcp_auth.ts";
import {
  empresaPorAdAccount,
  empresasComTokenAds,
  redactAllMetaTokens,
  tokenAdsPorCompanyId,
} from "../_shared/meta_company_tokens.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
/** Token ativo no request — nunca um global para todas as contas. */
let TOKEN = "";
const GRAPH = "https://graph.facebook.com/v21.0";
// Opportunity Score /act_*/recommendations estabilizou em versoes recentes da Marketing API.
const GRAPH_OS = "https://graph.facebook.com/v22.0";
const supa = createClient(SUPABASE_URL, SERVICE_ROLE, { auth: { persistSession: false } });
function redact(s: string) {
  return redactAllMetaTokens(s);
}
function json(o: unknown, st = 200) {
  return new Response(redact(JSON.stringify(o)), {
    status: st,
    headers: { "content-type": "application/json" },
  });
}

function resolverTokenConta(
  companyId: string | null | undefined,
  externalId: string | null | undefined,
): { token: string; company_id: string; slug: string; ref: string } | null {
  const porCompany = tokenAdsPorCompanyId(companyId);
  if (porCompany) return porCompany;
  const emp = empresaPorAdAccount(externalId);
  if (!emp) return null;
  return tokenAdsPorCompanyId(emp.company_id);
}

type ConfigCampanha = {
  special_ad_categories: string[] | null;
  bid_strategy: string | null;
  daily_budget: number | null;
  lifetime_budget: number | null;
  is_adset_budget_sharing_enabled: boolean | null;
  buying_type: string | null;
};

type LeituraCampo = {
  nivel: "anuncio" | "criativo" | "conta" | "conjunto";
  campo: string;
  solicitados: number;
  respostas: number;
  com_chave: number;
  exemplos: unknown[];
  erros: string[];
};

type ResultadoCampo = {
  valores: Map<string, unknown>;
  // v9: quem RESPONDEU, independentemente de ter trazido a chave. Sem este conjunto nao da
  // para separar "a Graph nao respondeu por este objeto" de "respondeu e o campo nao existe
  // nele" - e essa e justamente a diferenca entre nao saber e saber que nao tem.
  respondidos: Set<string>;
  diagnostico: LeituraCampo;
};

type ResultadoDestino =
  | { lido: false }
  | {
      lido: true;
      situacao: "unica" | "ambigua" | "ausente";
      url: string | null;
      candidatas: string[] | null;
    };

// Centavos, como a Graph devolve e como ad_sets ja guarda. CRITICO: `Number(v) || null` engoliria
// o zero, e zero e resposta real ("nao ha orcamento vitalicio"). Nulo aqui significa apenas uma
// coisa: a Graph NAO trouxe o campo - e para campanha ABO ela nao traz daily_budget mesmo, porque
// o orcamento vive no conjunto. Quem distingue "nao trouxe" de "nao coletei" e config_coletada_em.
const centavos = (v: unknown): number | null => {
  if (v === undefined || v === null || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

function lerConfig(x: any): ConfigCampanha {
  return {
    // Array vazio e NULO sao coisas diferentes: [] = a Meta disse que nao ha categoria
    // regulada; null = a Graph nao devolveu o campo. Nao colapsar os dois.
    special_ad_categories: Array.isArray(x?.special_ad_categories)
      ? x.special_ad_categories.map((c: unknown) => String(c))
      : null,
    bid_strategy: x?.bid_strategy ? String(x.bid_strategy) : null,
    daily_budget: centavos(x?.daily_budget),
    lifetime_budget: centavos(x?.lifetime_budget),
    is_adset_budget_sharing_enabled:
      typeof x?.is_adset_budget_sharing_enabled === "boolean"
        ? x.is_adset_budget_sharing_enabled
        : null,
    buying_type: x?.buying_type ? String(x.buying_type) : null,
  };
}

const temChave = (o: unknown, chave: string): boolean =>
  !!o && typeof o === "object" && Object.prototype.hasOwnProperty.call(o, chave);

function exemploSeguro(v: unknown): unknown {
  if (typeof v === "string") return v.length > 180 ? `${v.slice(0, 180)}…` : v;
  if (Array.isArray(v)) return { tipo: "array", itens: v.length };
  if (v && typeof v === "object") return { chaves: Object.keys(v as Record<string, unknown>) };
  return v;
}

// Consulta um unico campo por vez. Se a Graph ignorar um modificador desconhecido em silencio,
// `com_chave` fica zero e nenhum dado e escrito. Separar os campos impede que um candidato
// invalido derrube a leitura dos demais.
async function lerCampoPorIds(
  ids: string[],
  nivel: "anuncio" | "criativo" | "conta" | "conjunto" | "campanha",
  campo: string,
  tokenOverride?: string,
): Promise<ResultadoCampo> {
  const tok = (tokenOverride ?? TOKEN).trim();
  const valores = new Map<string, unknown>();
  const respondidos = new Set<string>();
  const diagnostico: LeituraCampo = {
    nivel,
    campo,
    solicitados: ids.length,
    respostas: 0,
    com_chave: 0,
    exemplos: [],
    erros: [],
  };
  if (!tok) {
    diagnostico.erros.push("token Ads ausente para esta leitura");
    return { valores, respondidos, diagnostico };
  }
  for (let i = 0; i < ids.length; i += 20) {
    const lote = ids.slice(i, i + 20);
    const url = `${GRAPH}/?ids=${encodeURIComponent(lote.join(","))}&fields=${encodeURIComponent(campo)}&access_token=${encodeURIComponent(tok)}`;
    const r = await fetch(url);
    const t = await r.text();
    let p: any;
    try {
      p = JSON.parse(t);
    } catch {
      p = null;
    }
    if (!r.ok || !p || typeof p !== "object") {
      diagnostico.erros.push(`graph ${r.status}: ${redact(t).slice(0, 240)}`);
      continue;
    }
    for (const id of lote) {
      const obj = p[id];
      if (!obj || typeof obj !== "object") continue;
      diagnostico.respostas++;
      respondidos.add(id);
      if (!temChave(obj, campo)) continue;
      const valor = obj[campo];
      valores.set(id, valor);
      diagnostico.com_chave++;
      if (diagnostico.exemplos.length < 2) diagnostico.exemplos.push(exemploSeguro(valor));
    }
  }
  return { valores, respondidos, diagnostico };
}

function mergeResultadoCampo(parts: ResultadoCampo[]): ResultadoCampo {
  const valores = new Map<string, unknown>();
  const respondidos = new Set<string>();
  const diagnostico: LeituraCampo = {
    nivel: parts[0]?.diagnostico.nivel ?? "anuncio",
    campo: parts[0]?.diagnostico.campo ?? "",
    solicitados: 0,
    respostas: 0,
    com_chave: 0,
    exemplos: [],
    erros: [],
  };
  for (const p of parts) {
    diagnostico.nivel = p.diagnostico.nivel;
    diagnostico.campo = p.diagnostico.campo;
    diagnostico.solicitados += p.diagnostico.solicitados;
    diagnostico.respostas += p.diagnostico.respostas;
    diagnostico.com_chave += p.diagnostico.com_chave;
    diagnostico.erros.push(...p.diagnostico.erros);
    for (const ex of p.diagnostico.exemplos) {
      if (diagnostico.exemplos.length < 2) diagnostico.exemplos.push(ex);
    }
    for (const [k, v] of p.valores) valores.set(k, v);
    for (const id of p.respondidos) respondidos.add(id);
  }
  return { valores, respondidos, diagnostico };
}

/** Agrupa IDs pelo token da conta dona e le com o token certo (sem misturar empresas). */
async function lerCampoPorIdsMultiToken(
  ids: string[],
  tokenDe: (id: string) => string | null,
  nivel: "anuncio" | "criativo" | "conta" | "conjunto" | "campanha",
  campo: string,
): Promise<ResultadoCampo> {
  const grupos = new Map<string, string[]>();
  const semToken: string[] = [];
  for (const id of ids) {
    const tok = tokenDe(id);
    if (!tok) {
      semToken.push(id);
      continue;
    }
    const arr = grupos.get(tok) ?? [];
    arr.push(id);
    grupos.set(tok, arr);
  }
  const parts: ResultadoCampo[] = [];
  for (const [tok, groupIds] of grupos) {
    parts.push(await lerCampoPorIds(groupIds, nivel, campo, tok));
  }
  if (!parts.length) {
    return {
      valores: new Map(),
      respondidos: new Set(),
      diagnostico: {
        nivel,
        campo,
        solicitados: ids.length,
        respostas: 0,
        com_chave: 0,
        exemplos: [],
        erros: semToken.length
          ? [`token_ausente_empresa para ${semToken.length} id(s)`]
          : [],
      },
    };
  }
  const merged = mergeResultadoCampo(parts);
  if (semToken.length) {
    merged.diagnostico.erros.push(`token_ausente_empresa para ${semToken.length} id(s)`);
    merged.diagnostico.solicitados = ids.length;
  }
  return merged;
}

function destinoDoCriativo(
  campos: Map<string, Map<string, unknown>>,
  creativeId: string,
): ResultadoDestino {
  // So object_story_spec e asset_feed_spec tem caminhos de destino provados neste projeto.
  // template_url_spec e link_destination_display_url continuam na sonda, mas nao autorizam
  // marcar o destino como lido enquanto a forma real deles nao tiver sido observada.
  const storyFoiRetornado = campos.get("object_story_spec")?.has(creativeId) ?? false;
  const assetFeedFoiRetornado = campos.get("asset_feed_spec")?.has(creativeId) ?? false;
  if (!storyFoiRetornado && !assetFeedFoiRetornado) return { lido: false };

  const candidatos: string[] = [];
  const adicionar = (v: unknown) => {
    if (typeof v === "string" && v.trim()) candidatos.push(v);
  };

  const spec: any = campos.get("object_story_spec")?.get(creativeId);
  adicionar(spec?.link_data?.link);
  adicionar(spec?.link_data?.call_to_action?.value?.link);
  adicionar(spec?.video_data?.call_to_action?.value?.link);

  const afs: any = campos.get("asset_feed_spec")?.get(creativeId);
  for (const item of Array.isArray(afs?.link_urls) ? afs.link_urls : []) {
    adicionar(item?.website_url);
  }

  // Dedupe apenas por igualdade byte a byte, preservando a primeira forma recebida. A mesma URL
  // pode aparecer no link e no CTA; isso nao transforma um destino unico em ambiguidade.
  const unicos = [...new Set(candidatos)];
  if (unicos.length === 1) {
    return { lido: true, situacao: "unica", url: unicos[0], candidatas: null };
  }
  if (unicos.length > 1) {
    return { lido: true, situacao: "ambigua", url: null, candidatas: candidatos };
  }
  return { lido: true, situacao: "ausente", url: null, candidatas: null };
}

// v14: coleta pontual do estado de UM conjunto. Le is_dynamic_creative (e, quando precisa criar a
// linha, account_id/name) na Graph e espelha pela mesma RPC da corrida diaria. LEITURA apenas -
// nada e criado/pausado/alterado na Meta. Preserva o contrato do ESP-13: campo ausente na Graph
// nao vira false; so grava quando o valor veio como booleano.
async function coletarEstadoDeUmConjunto(externalId: string, corpo: any): Promise<Response> {
  const accountBody = corpo?.account_id ? String(corpo.account_id).replace(/^act_/, "").trim() : null;
  const companyBody = corpo?.company_id ? String(corpo.company_id).trim() : null;

  const tokInfo = resolverTokenConta(
    companyBody,
    accountBody ? `act_${accountBody}` : null,
  );
  if (!tokInfo) {
    return json({
      error: "token Ads ausente para a empresa deste conjunto (sem fallback)",
      company_id: companyBody,
      account_id: accountBody,
      motivo: "token_ausente_empresa",
    }, 400);
  }
  TOKEN = tokInfo.token;

  // Reuso do parser de campo por ids (nada duplicado). Um unico id no lote.
  const r = await lerCampoPorIds([externalId], "conjunto", "is_dynamic_creative", tokInfo.token);
  const respondido = r.respondidos.has(externalId);
  const valor = r.valores.has(externalId) ? r.valores.get(externalId) : null;
  const boolLido = typeof valor === "boolean" ? valor : null;

  // Garante a linha em ad_sets: conjunto lido na Graph que ainda nao existe no espelho nao pode ser
  // espelhado pela RPC (ela so faz UPDATE). account_id/company_id sao nullable; preencho quando os
  // tenho (corpo da emissao ou leitura da Graph) para o portao casar por conta.
  let linhaCriada = false;
  const { data: existe } = await supa
    .from("ad_sets")
    .select("external_id, account_id, company_id")
    .eq("external_id", externalId)
    .eq("provider", "meta_ads")
    .maybeSingle();

  if (!existe) {
    let accountId = accountBody;
    let nome: string | null = null;
    // Sem conta conhecida, pergunto a Graph pelo objeto (id, account_id, name) - ainda LEITURA.
    const url = `${GRAPH}/${encodeURIComponent(externalId)}?fields=id,account_id,name&access_token=${encodeURIComponent(tokInfo.token)}`;
    try {
      const g = await fetch(url);
      const gt = await g.text();
      if (g.ok) {
        const gp: any = JSON.parse(gt);
        if (!accountId && gp?.account_id) accountId = String(gp.account_id).replace(/^act_/, "");
        if (gp?.name != null) nome = String(gp.name);
      }
    } catch { /* leitura opcional: se falhar, insere linha minima */ }
    const linha: Record<string, unknown> = {
      external_id: externalId,
      provider: "meta_ads",
      criado_pelo_sistema: true,
    };
    if (accountId) linha.account_id = accountId;
    if (companyBody) linha.company_id = companyBody;
    if (nome) linha.name = nome;
    const { error: insErr } = await supa.from("ad_sets").insert(linha);
    linhaCriada = !insErr;
  }

  let espelho: unknown = { nota: "is_dynamic_creative nao veio como booleano na Graph; nada gravado" };
  if (boolLido !== null) {
    const { data, error } = await supa.rpc("espelhar_estado_de_conjuntos_da_graph", {
      p: [{
        adset_external_id: externalId,
        is_dynamic_creative: boolLido,
        fonte: "coleta pontual sob demanda; Graph fields=is_dynamic_creative",
      }],
    });
    espelho = error ? { erro: error.message } : data;
  }

  return json({
    modo: "coleta_pontual_de_conjunto",
    conjunto: externalId,
    respondido_pela_graph: respondido,
    is_dynamic_creative: boolLido,
    linha_criada: linhaCriada,
    espelho,
    diagnostico: r.diagnostico,
    nota:
      "Leitura pontual do estado do conjunto. is_dynamic_creative=true impede anuncio avulso " +
      "(Dynamic Creative); false libera; null = a Graph nao devolveu o campo e o portao segue " +
      "recusando fechado. Nada foi criado/pausado/alterado na Meta.",
  });
}

function tituloDicaOs(tipo: string, lift: string | null, body: string | null): string {
  const t = tipo.replace(/_/g, " ").trim();
  if (lift) return `${t} (lift score ${lift})`;
  if (body) return body.slice(0, 120);
  return t || "Dica Meta (Opportunity Score)";
}

function importanciaDeLift(lift: string | null): string {
  const n = Number(lift);
  if (!Number.isFinite(n)) return "MEDIUM";
  if (n >= 20) return "HIGH";
  if (n >= 8) return "MEDIUM";
  return "LOW";
}

function achatarRecsOs(payload: any): Record<string, unknown>[] {
  const out: Record<string, unknown>[] = [];
  const push = (r: any) => {
    if (!r || typeof r !== "object") return;
    if (r.type != null || r.recommendation_signature != null || r.recommendation_name != null) {
      out.push(r as Record<string, unknown>);
      return;
    }
    if (Array.isArray(r.recommendations)) {
      for (const x of r.recommendations) push(x);
    }
  };
  if (Array.isArray(payload?.data)) {
    for (const row of payload.data) push(row);
  } else if (Array.isArray(payload?.recommendations)) {
    for (const row of payload.recommendations) push(row);
  } else {
    push(payload);
  }
  return out;
}

async function fetchOpportunityRecommendations(accountId: string, tokenOverride?: string): Promise<{
  ok: boolean;
  recs: Record<string, unknown>[];
  status: number;
  erro?: string;
  opportunity_score?: unknown;
  raw_shape?: string;
}> {
  const tok = (tokenOverride ?? TOKEN).trim();
  if (!tok) {
    return { ok: false, recs: [], status: 0, erro: "token_ausente_empresa" };
  }
  const tryUrls: string[] = [];
  const fields = [
    "recommendation_signature",
    "recommendation_stage",
    "recommendation_time",
    "type",
    "object_ids",
    "recommendation_content",
    "opportunity_score_lift",
    "url",
  ].join(",");
  // Sem fields primeiro (alguns tokens devolvem lista so no shape default); depois com fields.
  for (const base of [GRAPH_OS, "https://graph.facebook.com/v25.0", GRAPH]) {
    tryUrls.push(
      `${base}/act_${encodeURIComponent(accountId)}/recommendations?limit=100&access_token=${encodeURIComponent(tok)}`,
    );
    tryUrls.push(
      `${base}/act_${encodeURIComponent(accountId)}/recommendations` +
        `?fields=${encodeURIComponent(fields)}&limit=100&access_token=${encodeURIComponent(tok)}`,
    );
  }

  let lastStatus = 0;
  let lastErro: string | undefined;
  let bestRecs: Record<string, unknown>[] = [];
  let rawShape = "vazio";

  for (const url of tryUrls) {
    const r = await fetch(url);
    const t = await r.text();
    lastStatus = r.status;
    let p: any = null;
    try {
      p = JSON.parse(t);
    } catch {
      p = null;
    }
    if (!r.ok) {
      lastErro = redact(t).slice(0, 320);
      // 403/400 nesta conta: nao adianta tentar outras URLs com o mesmo token.
      if (r.status === 403 || r.status === 401) break;
      continue;
    }
    const recs = achatarRecsOs(p);
    rawShape = Array.isArray(p?.data)
      ? `data[${p.data.length}]`
      : (Array.isArray(p?.recommendations) ? `recommendations[${p.recommendations.length}]` : typeof p);
    if (recs.length >= bestRecs.length) bestRecs = recs;
    if (recs.length > 0) break;
  }

  let score: unknown = null;
  try {
    const su =
      `${GRAPH_OS}/act_${encodeURIComponent(accountId)}` +
      `?fields=opportunity_score&access_token=${encodeURIComponent(tok)}`;
    const sr = await fetch(su);
    const st = await sr.text();
    if (sr.ok) {
      const sj = JSON.parse(st);
      score = sj?.opportunity_score ?? null;
    }
  } catch {
    /* score e opcional */
  }

  const ok = lastStatus >= 200 && lastStatus < 300 && !lastErro;
  // ok=true mesmo com 0 recs se a conta respondeu 200 em alguma tentativa
  const anyOk = bestRecs.length > 0 || (lastStatus === 200 && !lastErro) || score != null;
  return {
    ok: anyOk && (lastStatus !== 403 && lastStatus !== 401),
    recs: bestRecs,
    status: lastStatus || (score != null ? 200 : 0),
    erro: anyOk ? undefined : lastErro,
    opportunity_score: score,
    raw_shape: rawShape,
  };
}

type ObjRef = {
  object_type: "campaign" | "adset" | "ad" | "account";
  object_external_id: string;
  object_name: string | null;
  campaign_external_id: string | null;
  campaign_name: string | null;
  adset_external_id: string | null;
  ad_external_id: string | null;
  company_id: string;
};

async function montarIndiceObjetosConta(accountId: string): Promise<{
  porId: Map<string, ObjRef>;
  companyIds: Set<string>;
}> {
  const porId = new Map<string, ObjRef>();
  const companyIds = new Set<string>();
  const { data: camps } = await supa
    .from("campaigns")
    .select("external_id, name, company_id, external_account_id")
    .eq("external_account_id", accountId)
    .eq("provider", "meta_ads");
  for (const c of camps ?? []) {
    if (!c?.external_id || !c?.company_id) continue;
    companyIds.add(String(c.company_id));
    porId.set(String(c.external_id), {
      object_type: "campaign",
      object_external_id: String(c.external_id),
      object_name: c.name != null ? String(c.name) : null,
      campaign_external_id: String(c.external_id),
      campaign_name: c.name != null ? String(c.name) : null,
      adset_external_id: null,
      ad_external_id: null,
      company_id: String(c.company_id),
    });
  }
  const { data: sets } = await supa
    .from("ad_sets")
    .select("external_id, name, company_id, campaign_id")
    .eq("account_id", accountId);
  const campPk = [...new Set((sets ?? []).map((s: any) => s.campaign_id).filter(Boolean))];
  const { data: campsByPk } = await supa
    .from("campaigns")
    .select("id, external_id, name")
    .in("id", campPk.length ? campPk : ["00000000-0000-0000-0000-000000000000"]);
  const campByUuid = new Map(
    (campsByPk ?? []).map((c: any) => [String(c.id), { id: String(c.external_id), name: String(c.name ?? "") }]),
  );
  for (const s of sets ?? []) {
    if (!s?.external_id || !s?.company_id) continue;
    companyIds.add(String(s.company_id));
    const camp = s.campaign_id ? campByUuid.get(String(s.campaign_id)) : null;
    porId.set(String(s.external_id), {
      object_type: "adset",
      object_external_id: String(s.external_id),
      object_name: s.name != null ? String(s.name) : null,
      campaign_external_id: camp?.id ?? null,
      campaign_name: camp?.name ?? null,
      adset_external_id: String(s.external_id),
      ad_external_id: null,
      company_id: String(s.company_id),
    });
  }
  const { data: ads } = await supa
    .from("ads")
    .select("external_id, name, company_id, adset_external_id, campaign_id, account_id")
    .eq("account_id", accountId);
  for (const a of ads ?? []) {
    if (!a?.external_id || !a?.company_id) continue;
    companyIds.add(String(a.company_id));
    const camp = a.campaign_id ? campByUuid.get(String(a.campaign_id)) : null;
    porId.set(String(a.external_id), {
      object_type: "ad",
      object_external_id: String(a.external_id),
      object_name: a.name != null ? String(a.name) : null,
      campaign_external_id: camp?.id ?? null,
      campaign_name: camp?.name ?? null,
      adset_external_id: a.adset_external_id != null ? String(a.adset_external_id) : null,
      ad_external_id: String(a.external_id),
      company_id: String(a.company_id),
    });
  }
  return { porId, companyIds };
}

function linhasDeOpportunityScore(
  accountId: string,
  recs: Record<string, unknown>[],
  indice: Map<string, ObjRef>,
  companyFallback: string | null,
): Record<string, unknown>[] {
  const linhas: Record<string, unknown>[] = [];
  for (const raw of recs) {
    const tipo = String(raw.type ?? raw.recommendation_name ?? "opportunity").trim();
    const stage = raw.recommendation_stage != null ? String(raw.recommendation_stage) : null;
    const sig = raw.recommendation_signature != null ? String(raw.recommendation_signature) : null;
    const content = (raw.recommendation_content && typeof raw.recommendation_content === "object")
      ? raw.recommendation_content as Record<string, unknown>
      : {};
    const body = content.body != null
      ? String(content.body)
      : (raw.body != null ? String(raw.body) : null);
    const lift = content.opportunity_score_lift != null
      ? String(content.opportunity_score_lift)
      : (raw.opportunity_score_lift != null ? String(raw.opportunity_score_lift) : null);
    const liftEst = content.lift_estimate != null ? String(content.lift_estimate) : null;
    const message = [body, liftEst ? `Estimativa Meta: ${liftEst}` : null].filter(Boolean).join(" | ") || null;
    const code = sig || tipo;
    const title = tituloDicaOs(tipo, lift, body);
    const importance = importanciaDeLift(lift);
    const objectIds = Array.isArray(raw.object_ids)
      ? raw.object_ids.map((x) => String(x)).filter(Boolean)
      : [];
    const payload = {
      fonte: "opportunity_score",
      account_id: accountId,
      ...raw,
    };

    const refs: ObjRef[] = [];
    for (const oid of objectIds) {
      const hit = indice.get(oid);
      if (hit) refs.push(hit);
    }
    if (!refs.length) {
      if (!companyFallback) continue;
      refs.push({
        object_type: "account",
        object_external_id: accountId,
        object_name: `act_${accountId}`,
        campaign_external_id: null,
        campaign_name: null,
        adset_external_id: null,
        ad_external_id: null,
        company_id: companyFallback,
      });
    }
    for (const ref of refs) {
      linhas.push({
        company_id: ref.company_id,
        object_type: ref.object_type,
        object_external_id: ref.object_external_id,
        object_name: ref.object_name,
        campaign_external_id: ref.campaign_external_id,
        campaign_name: ref.campaign_name,
        adset_external_id: ref.adset_external_id,
        ad_external_id: ref.ad_external_id,
        recommendation_code: code,
        title,
        message,
        importance,
        confidence: stage,
        blame_field: tipo,
        payload_raw: payload,
      });
    }
  }
  return linhas;
}

async function coletarMetaDicasAoVivo(corpo: any): Promise<Response> {
  const companyFilter = corpo?.company_id ? String(corpo.company_id).trim() : "";
  // Com company_id: SOMENTE o token dessa empresa (sem fallback).
  let tokenEmpresaFiltro: string | null = null;
  if (companyFilter) {
    const t = tokenAdsPorCompanyId(companyFilter);
    if (!t) {
      return json({
        error: `token Ads ausente para company_id=${companyFilter} (sem fallback)`,
        motivo: "token_ausente_empresa",
        modo: "meta_dicas",
      }, 400);
    }
    tokenEmpresaFiltro = t.token;
    TOKEN = t.token;
  }

  let q = supa.from("integrations").select("external_id, company_id, estado_operacional").eq("provider", "meta_ads");
  if (companyFilter) q = q.eq("company_id", companyFilter);
  const { data: integs } = await q;
  // Preferir contas com anuncios ACTIVE da empresa (evita 16x #200 em contas sem grant).
  let contasPreferidas = new Set<string>();
  if (companyFilter) {
    const { data: adsAtivos } = await supa
      .from("ads")
      .select("account_id")
      .eq("company_id", companyFilter)
      .eq("status", "ACTIVE");
    for (const a of adsAtivos ?? []) {
      if (a?.account_id) contasPreferidas.add(String(a.account_id).replace(/^act_/, ""));
    }
  }
  const todasContas = [
    ...new Set((integs ?? []).map((i: any) => String(i.external_id ?? "").replace(/^act_/, "")).filter(Boolean)),
  ];
  const contas = contasPreferidas.size
    ? todasContas.filter((c) => contasPreferidas.has(c))
    : todasContas;
  const companyPorConta = new Map<string, string>();
  for (const i of integs ?? []) {
    if (i?.external_id && i?.company_id) {
      companyPorConta.set(String(i.external_id).replace(/^act_/, ""), String(i.company_id));
    }
  }

  const linhas: Record<string, unknown>[] = [];
  const diagnostico: unknown[] = [];
  for (const acct of contas) {
    const companyId = companyPorConta.get(acct) ?? (companyFilter || null);
    const tok = tokenEmpresaFiltro
      ?? resolverTokenConta(companyId, `act_${acct}`)?.token
      ?? null;
    if (!tok) {
      diagnostico.push({
        account_id: acct,
        ok: false,
        status: 0,
        erro: "token_ausente_empresa",
        motivo: "token_ausente_empresa",
      });
      continue;
    }
    const fetched = await fetchOpportunityRecommendations(acct, tok);
    const indice = await montarIndiceObjetosConta(acct);
    const companyFb = companyPorConta.get(acct) ?? [...indice.companyIds][0] ?? null;
    const montadas = fetched.ok
      ? linhasDeOpportunityScore(acct, fetched.recs, indice.porId, companyFb)
      : [];
    // Snapshot do score da conta mesmo sem itens — o agente precisa dizer "score X, API sem lista".
    if (fetched.opportunity_score != null && companyFb && montadas.length === 0) {
      montadas.push({
        company_id: companyFb,
        object_type: "account",
        object_external_id: acct,
        object_name: `act_${acct}`,
        campaign_external_id: null,
        campaign_name: null,
        adset_external_id: null,
        ad_external_id: null,
        recommendation_code: "opportunity_score_snapshot",
        title: `Opportunity Score da conta: ${fetched.opportunity_score}`,
        message:
          `A Graph devolveu opportunity_score=${fetched.opportunity_score} para act_${acct}, ` +
          `mas a lista GET /act_*/recommendations veio vazia (recs_api=0). ` +
          `Badge do Ads Manager pode existir mesmo assim — assimetria documentada pela Meta.`,
        importance: "LOW",
        confidence: "mid_flight_recommendation",
        blame_field: "opportunity_score",
        payload_raw: {
          fonte: "opportunity_score",
          account_id: acct,
          opportunity_score: fetched.opportunity_score,
          recs_api: 0,
          raw_shape: fetched.raw_shape ?? null,
        },
      });
    }
    linhas.push(...montadas);
    diagnostico.push({
      account_id: acct,
      ok: fetched.ok,
      status: fetched.status,
      erro: fetched.erro ?? null,
      opportunity_score: fetched.opportunity_score ?? null,
      recs_api: fetched.recs.length,
      linhas_montadas: montadas.length,
      raw_shape: fetched.raw_shape ?? null,
    });
  }

  let upsert: unknown = { nota: "nenhuma dica OS montada" };
  if (linhas.length) {
    const { data, error } = await supa.rpc("upsert_meta_recomendacoes", { p: linhas });
    upsert = error ? { erro: error.message, candidatas: linhas.length } : data;
  }

  return json({
    ok: true,
    modo: "meta_dicas",
    company_id: companyFilter || null,
    contas: contas.length,
    candidatas: linhas.length,
    upsert,
    diagnostico,
    versao: "meta-campaign-status-v16",
    nota:
      "Refresh ao vivo do Opportunity Score (GET /act_*/recommendations). " +
      "Badge do Ads Manager pode exceder a lista da API (assimetria documentada pela Meta).",
  });
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return json({ error: "POST only" }, 405);
  if (empresasComTokenAds().length === 0) {
    return json({ error: "nenhum META_ADS_TOKEN* configurado para empresas Meta" }, 500);
  }
  // Cron manda x-mcp-key; bearer tambem aceito. A RPC grava o chamador — evidencia
  // que autoriza revogar a chave legada depois (CODE 1.5).
  const auth = await mcpKeyValida(supa, chaveMcpDe(req, "header-or-bearer"));
  if (!auth.ok) return json({ error: "unauthorized", motivo: auth.motivo }, 401);

  // v14: modo pontual. O cron dispara POST sem corpo (corrida completa); a auto-resolucao de
  // leitura manda { conjunto | adset_external_id } e recebe SO aquele conjunto, sem varrer a conta.
  let corpo: any = null;
  try { corpo = await req.json(); } catch { corpo = null; }
  const conjuntoAlvo = corpo && typeof corpo === "object"
    ? String(corpo.conjunto ?? corpo.adset_external_id ?? "").trim()
    : "";
  if (conjuntoAlvo) return await coletarEstadoDeUmConjunto(conjuntoAlvo, corpo);
  const modo = corpo && typeof corpo === "object" ? String(corpo.modo ?? "").trim() : "";
  if (modo === "meta_dicas") return await coletarMetaDicasAoVivo(corpo);

  const { data: integs } = await supa
    .from("integrations")
    .select("external_id, account_name, company_id")
    .eq("provider", "meta_ads");
  const contasMeta = [
    ...new Map(
      (integs ?? [])
        .map((i: any) => {
          const external_id = String(i.external_id ?? "").replace(/^act_/, "").trim();
          if (!external_id) return null;
          return [external_id, {
            external_id,
            company_id: i.company_id ? String(i.company_id) : null,
            account_name: i.account_name ?? null,
          }];
        })
        .filter(Boolean) as [string, { external_id: string; company_id: string | null; account_name: string | null }][],
    ).values(),
  ];

  const reais = new Map<string, string>(); // campaign_id -> effective_status
  const nomesReais = new Map<string, string>(); // campaign_id -> name (nome real na Meta)
  const config = new Map<string, ConfigCampanha>(); // campaign_id -> configuracao lida da Graph
  const acessiveis: string[] = [];
  const inacessiveis: Array<{ account_id: string; motivo: string }> = [];
  const tokenPorConta = new Map<string, string>(); // account_id sem act_ -> token
  // v5: o anuncio carrega o proprio objeto, nao apenas o id e o criativo. `status` guarda
  // effective_status - o estado que a Meta de fato aplica, o mesmo que o windsor-sync grava.
  type AnuncioGraph = {
    id: string;
    creative_id: string | null;
    account_id: string;
    name: string | null;
    status: string | null;
    adset_external_id: string | null;
    campaign_external_id: string | null;
  };
  const anunciosPorConta = new Map<string, AnuncioGraph[]>();
  const adsetsPorConta = new Map<string, string[]>(); // account_id -> external_ids
  const campanhasPorConta = new Map<string, string[]>(); // account_id -> campaign external_ids
  const orfaosPorConta: Record<string, unknown> = {};

  const CAMPOS = [
    "name",
    "effective_status",
    // v3 (GT-09): configuracao. Sao campos do OBJETO campanha, nao de insights.
    "special_ad_categories",
    "bid_strategy",
    "daily_budget",
    "lifetime_budget",
    "is_adset_budget_sharing_enabled",
    "buying_type",
  ].join(",");

  for (const meta of contasMeta) {
    const c = meta.external_id;
    const tokInfo = resolverTokenConta(meta.company_id, `act_${c}`);
    if (!tokInfo) {
      inacessiveis.push({ account_id: c, motivo: "token_ausente_empresa" });
      continue;
    }
    TOKEN = tokInfo.token;
    tokenPorConta.set(c, tokInfo.token);

    let url = `${GRAPH}/act_${c}/campaigns?fields=${CAMPOS}&limit=200&access_token=${encodeURIComponent(tokInfo.token)}`;
    let pag = 0,
      okConta = false;
    while (url && pag < 5) {
      const r = await fetch(url);
      const t = await r.text();
      if (!r.ok) break;
      let p: any;
      try {
        p = JSON.parse(t);
      } catch {
        break;
      }
      okConta = true;
      const campIds = campanhasPorConta.get(c) ?? [];
      for (const x of p?.data ?? []) {
        reais.set(String(x.id), String(x.effective_status ?? ""));
        if (x.name != null) nomesReais.set(String(x.id), String(x.name));
        config.set(String(x.id), lerConfig(x));
        campIds.push(String(x.id));
      }
      campanhasPorConta.set(c, campIds);
      url = p?.paging?.next ?? "";
      pag++;
    }
    if (!okConta) {
      inacessiveis.push({ account_id: c, motivo: "graph_inacessivel" });
    } else {
      acessiveis.push(c);
    }

    // GT-12: a lista de anuncios e estado da conta, como a configuracao de campanha. So tenta
    // esta ponta quando a conta respondeu na Graph; conta inacessivel permanece nunca_lido.
    if (okConta) {
      // v7: conjuntos da conta — sem isso o espelho nao marca orfao de adset (ex.: TESTE-GT02).
      const adsetIds: string[] = [];
      let urlSets = `${GRAPH}/act_${c}/adsets?fields=id&limit=200&access_token=${encodeURIComponent(tokInfo.token)}`;
      let pagSets = 0;
      while (urlSets && pagSets < 5) {
        const r = await fetch(urlSets);
        const t = await r.text();
        if (!r.ok) break;
        let p: any;
        try {
          p = JSON.parse(t);
        } catch {
          break;
        }
        for (const x of p?.data ?? []) {
          if (x?.id) adsetIds.push(String(x.id));
        }
        urlSets = p?.paging?.next ?? "";
        pagSets++;
      }
      adsetsPorConta.set(c, adsetIds);

      const anuncios: AnuncioGraph[] = [];
      const CAMPOS_ADS = "id,name,effective_status,adset_id,campaign_id,creative{id}";
      let urlAds = `${GRAPH}/act_${c}/ads?fields=${CAMPOS_ADS}&limit=200&access_token=${encodeURIComponent(tokInfo.token)}`;
      let pagAds = 0;
      while (urlAds && pagAds < 5) {
        const r = await fetch(urlAds);
        const t = await r.text();
        if (!r.ok) break;
        let p: any;
        try {
          p = JSON.parse(t);
        } catch {
          break;
        }
        for (const x of p?.data ?? []) {
          // Campo que a Graph nao devolveu vira null e a RPC preserva o valor anterior com
          // coalesce. Nunca um default: foi um `?? "ACTIVE"` que ja produziu status falso aqui.
          const texto = (v: unknown) => {
            const s = String(v ?? "").trim();
            return s ? s : null;
          };
          anuncios.push({
            id: String(x.id),
            creative_id: x?.creative?.id ? String(x.creative.id) : null,
            account_id: c,
            name: texto(x.name),
            status: texto(x.effective_status),
            adset_external_id: texto(x.adset_id),
            campaign_external_id: texto(x.campaign_id),
          });
        }
        urlAds = p?.paging?.next ?? "";
        pagAds++;
      }
      anunciosPorConta.set(c, anuncios);
    }
  }

  // Mapas id -> token da conta dona (leituras batch multi-empresa).
  const contaDoAdset = new Map<string, string>();
  for (const [acct, ids] of adsetsPorConta) {
    for (const id of ids) contaDoAdset.set(id, acct);
  }
  const contaDoCamp = new Map<string, string>();
  for (const [acct, ids] of campanhasPorConta) {
    for (const id of ids) contaDoCamp.set(id, acct);
  }
  const anunciosGraph = [...anunciosPorConta.values()].flat();
  const contaDoAd = new Map(anunciosGraph.map((a) => [a.id, a.account_id]));
  const contaDoCreative = new Map<string, string>();
  for (const a of anunciosGraph) {
    if (a.creative_id) contaDoCreative.set(a.creative_id, a.account_id);
  }
  const tokenDeConta = (accountId: string | null | undefined) =>
    accountId ? (tokenPorConta.get(String(accountId).replace(/^act_/, "")) ?? null) : null;
  const tokenDeAd = (id: string) => tokenDeConta(contaDoAd.get(id));
  const tokenDeAdset = (id: string) => tokenDeConta(contaDoAdset.get(id));
  const tokenDeCamp = (id: string) => tokenDeConta(contaDoCamp.get(id));
  const tokenDeCreative = (id: string) => tokenDeConta(contaDoCreative.get(id));
  const tokenDeAccountGraphId = (actId: string) =>
    tokenDeConta(String(actId).replace(/^act_/, ""));
  const adIds = [...new Set(anunciosGraph.map((a) => a.id))];
  const creativeIds = [
    ...new Set(anunciosGraph.map((a) => a.creative_id).filter((x): x is string => !!x)),
  ];

  // v5: ESPELHO ANTES DA SONDA, de proposito. A licao do windsor-sync v15 (os 5 dias cegos de
  // 23-27/07) foi que passo de escrita nao fica atras de passo lento: se a sonda de campos
  // estourar o teto de 120s do cron, o espelho do anuncio ja esta gravado. Como o espelho corre
  // primeiro, o anuncio recem-inserido tambem entra na coleta do GT-12 nesta mesma corrida.
  let espelhoAds: unknown = { nota: "nenhum anuncio lido na Graph" };
  if (anunciosGraph.length) {
    const linhas = anunciosGraph.map((a) => ({
      account_id: a.account_id,
      ad_external_id: a.id,
      name: a.name,
      status: a.status,
      adset_external_id: a.adset_external_id,
      campaign_external_id: a.campaign_external_id,
      creative_id: a.creative_id,
    }));
    const { data, error } = await supa.rpc("espelhar_ads_da_graph", { p: linhas });
    espelhoAds = error ? { erro: error.message } : data;
  }

  // v7: orfaos — so em conta que a Graph respondeu. Lista vazia com conta ok = tudo orfao.
  for (const c of acessiveis) {
    const adsIds = (anunciosPorConta.get(c) ?? []).map((a) => a.id);
    const setIds = adsetsPorConta.get(c) ?? [];
    const campIds = [...new Set(campanhasPorConta.get(c) ?? [])];
    const rAds = await supa.rpc("marcar_orfaos_ausentes_na_graph", {
      p_nivel: "ads",
      p_account_id: c,
      p_ids_presentes: adsIds,
    });
    const rSets = await supa.rpc("marcar_orfaos_ausentes_na_graph", {
      p_nivel: "ad_sets",
      p_account_id: c,
      p_ids_presentes: setIds,
    });
    const rCamps = await supa.rpc("marcar_orfaos_ausentes_na_graph", {
      p_nivel: "campaigns",
      p_account_id: c,
      p_ids_presentes: campIds,
    });
    orfaosPorConta[c] = {
      ads: rAds.error ? { erro: rAds.error.message } : rAds.data,
      ad_sets: rSets.error ? { erro: rSets.error.message } : rSets.data,
      campaigns: rCamps.error ? { erro: rCamps.error.message } : rCamps.data,
    };
  }

  const diagnosticoCampos: LeituraCampo[] = [];

  // ============ v8: ESTADO DO CONJUNTO, ANTES DAS SONDAS PESADAS ============
  // Primeiro da fila de proposito. Este e o dado que o portao de emissao de anuncio consulta;
  // se um estouro do teto do cron interromper a corrida no meio das sondas de criativo, o que
  // nao pode faltar e justamente ele. Mesma licao da v5, aplicada ao nivel do conjunto.
  const adsetIds = [...new Set([...adsetsPorConta.values()].flat())];
  const adsetDynamic = await lerCampoPorIdsMultiToken(adsetIds, tokenDeAdset, "conjunto", "is_dynamic_creative");
  diagnosticoCampos.push(adsetDynamic.diagnostico);

  let estadoConjuntos: unknown = { nota: "nenhum conjunto lido na Graph" };
  if (adsetDynamic.valores.size) {
    // So entra na lista o conjunto cuja chave a Graph devolveu: e a diferenca entre "nao
    // respondeu" e "respondeu false". A RPC preserva o valor anterior no primeiro caso, para
    // que nulo continue significando "nunca verificado" e o portao siga recusando fechado.
    const linhas = [...adsetDynamic.valores.entries()].map(([id, valor]) => ({
      adset_external_id: id,
      is_dynamic_creative: valor,
      fonte: "Graph fields=is_dynamic_creative; coleta meta-campaign-status",
    }));
    const { data, error } = await supa.rpc("espelhar_estado_de_conjuntos_da_graph", { p: linhas });
    estadoConjuntos = error ? { erro: error.message } : data;
  }

  const adUrlTags = await lerCampoPorIdsMultiToken(adIds, tokenDeAd, "anuncio", "url_tags");
  diagnosticoCampos.push(adUrlTags.diagnostico);
  const trackingSpecs = await lerCampoPorIdsMultiToken(adIds, tokenDeAd, "anuncio", "tracking_specs");
  diagnosticoCampos.push(trackingSpecs.diagnostico);

  // ESP-13: status configurado e status efetivo sao fatos distintos. Cada campo e consultado
  // sozinho; `issues_info` ausente nunca vira [].
  const adStatus = await lerCampoPorIdsMultiToken(adIds, tokenDeAd, "anuncio", "status");
  diagnosticoCampos.push(adStatus.diagnostico);
  const adEffectiveStatus = await lerCampoPorIdsMultiToken(adIds, tokenDeAd, "anuncio", "effective_status");
  diagnosticoCampos.push(adEffectiveStatus.diagnostico);
  const adIssuesInfo = await lerCampoPorIdsMultiToken(adIds, tokenDeAd, "anuncio", "issues_info");
  diagnosticoCampos.push(adIssuesInfo.diagnostico);

  const accountGraphIds = acessiveis.map((id) => `act_${id}`);
  const accountStatus = await lerCampoPorIdsMultiToken(accountGraphIds, tokenDeAccountGraphId, "conta", "account_status");
  diagnosticoCampos.push(accountStatus.diagnostico);
  const accountDisableReason = await lerCampoPorIdsMultiToken(accountGraphIds, tokenDeAccountGraphId, "conta", "disable_reason");
  diagnosticoCampos.push(accountDisableReason.diagnostico);
  const accountSpendCap = await lerCampoPorIdsMultiToken(accountGraphIds, tokenDeAccountGraphId, "conta", "spend_cap");
  diagnosticoCampos.push(accountSpendCap.diagnostico);
  const accountCapabilities = await lerCampoPorIdsMultiToken(accountGraphIds, tokenDeAccountGraphId, "conta", "capabilities");
  diagnosticoCampos.push(accountCapabilities.diagnostico);

  const camposCriativo = new Map<string, Map<string, unknown>>();
  let storySpec: ResultadoCampo | null = null;
  let assetFeedSpec: ResultadoCampo | null = null;
  for (const campo of [
    "url_tags",
    "object_story_spec",
    "template_url_spec",
    "asset_feed_spec",
    "link_destination_display_url",
  ]) {
    const lido = await lerCampoPorIdsMultiToken(creativeIds, tokenDeCreative, "criativo", campo);
    camposCriativo.set(campo, lido.valores);
    if (campo === "object_story_spec") storySpec = lido;
    if (campo === "asset_feed_spec") assetFeedSpec = lido;
    diagnosticoCampos.push(lido.diagnostico);
  }

  // ============ v13: CONFIG DO MOLDE (video_data | asset_feed video | link_data imagem) ============
  // v12: video via video_data OU asset_feed com videos. v13: IMAGEM via link_data
  // (page_id + link + CTA). Forma observada nos 25 moldes da conta: chaves_do_spec =
  // ["page_id","link_data"]. Pipeboard ja desembrulha link_data.image_hash.
  let estadoCriativos: unknown = { nota: "object_story_spec nao foi lido nesta corrida" };
  if (storySpec && storySpec.respondidos.size) {
    const contaDoCriativo = new Map<string, string>();
    for (const a of anunciosGraph) {
      if (a.creative_id) contaDoCriativo.set(a.creative_id, a.account_id);
    }
    const afsMap = assetFeedSpec?.valores ?? new Map<string, unknown>();
    const linhas = [...storySpec.respondidos].map((id) => {
      const bruto = storySpec!.valores.get(id);
      const spec =
        storySpec!.valores.has(id) && bruto && typeof bruto === "object"
          ? (bruto as Record<string, unknown>)
          : null;
      const videoData = spec ? (spec.video_data as Record<string, unknown> | null) : null;
      const linkData = spec ? (spec.link_data as Record<string, unknown> | null) : null;
      const ctaVd = videoData?.call_to_action as
        | { type?: unknown; value?: { link?: unknown } }
        | undefined;
      const linkVd = (ctaVd?.value?.link ?? videoData?.link ?? null) as string | null;
      const ctaVdTipo = typeof ctaVd?.type === "string" ? ctaVd.type : null;

      const ctaLd = linkData?.call_to_action as
        | { type?: unknown; value?: { link?: unknown } }
        | undefined;
      const linkLd = (linkData?.link ?? ctaLd?.value?.link ?? null) as string | null;
      const ctaLdTipo = typeof ctaLd?.type === "string" ? ctaLd.type : null;
      const pageId = typeof spec?.page_id === "string" ? spec.page_id : null;
      const igRaw = spec?.instagram_user_id ?? spec?.instagram_actor_id ?? null;
      const ig = typeof igRaw === "string" ? igRaw : null;

      const afsBruto = afsMap.get(id);
      const afs =
        afsBruto && typeof afsBruto === "object" ? (afsBruto as Record<string, unknown>) : null;
      const linkUrls = Array.isArray(afs?.link_urls) ? afs!.link_urls : [];
      const urls = [
        ...new Set(
          linkUrls
            .map((u) =>
              u && typeof u === "object"
                ? String((u as Record<string, unknown>).website_url ?? "").trim()
                : "",
            )
            .filter(Boolean),
        ),
      ];
      const linkAfs = urls.length === 1 ? urls[0] : null;
      const ctasRaw = Array.isArray(afs?.call_to_action_types) ? afs!.call_to_action_types : [];
      const ctas = [
        ...new Set(
          ctasRaw
            .map((c) => (typeof c === "string" ? c.trim() : ""))
            .filter(Boolean),
        ),
      ];
      const ctaAfs = ctas.length === 1 ? ctas[0] : null;
      const temVideosAfs = Array.isArray(afs?.videos) && afs!.videos.length > 0;
      const temImagesAfs = Array.isArray(afs?.images) && (afs!.images as unknown[]).length > 0;
      const linkDataEhCarrossel =
        !!linkData && Array.isArray(linkData.child_attachments) &&
        (linkData.child_attachments as unknown[]).length > 0;

      const link = (typeof linkVd === "string" && linkVd) || (typeof linkLd === "string" && linkLd) || linkAfs || null;
      const cta = ctaVdTipo || ctaLdTipo || ctaAfs;
      const fonteCfg = videoData
        ? "video_data"
        : linkData && pageId && linkLd && ctaLdTipo && !linkDataEhCarrossel
          ? "link_data"
          : pageId && link && cta && temVideosAfs
            ? "asset_feed_spec"
            : null;
      const serveVideo =
        !!pageId &&
        !!link &&
        !!cta &&
        (!!videoData || temVideosAfs);
      // Imagem avulsa: link_data com page+link+CTA e SEM child_attachments (carrossel).
      const serveImagem =
        !!pageId &&
        !!link &&
        !!cta &&
        !serveVideo &&
        !linkDataEhCarrossel &&
        (!!linkData || temImagesAfs);

      return {
        creative_id: id,
        account_id: contaDoCriativo.get(id) ?? null,
        expoe_object_story_spec: spec !== null,
        expoe_video_data: !!videoData,
        expoe_link_data: !!linkData,
        expoe_page_id: !!pageId,
        expoe_link_destino: !!link,
        serve_de_molde_video: serveVideo,
        serve_de_molde_imagem: serveImagem,
        page_id: pageId,
        link_destino: link,
        call_to_action_type: cta,
        instagram_actor_id: ig,
        fonte_da_config: fonteCfg,
        chaves_do_spec: spec ? Object.keys(spec) : [],
        chaves_do_link_data: linkData ? Object.keys(linkData) : [],
        fonte: "Graph fields=object_story_spec,asset_feed_spec; coleta meta-campaign-status",
      };
    });
    const { data, error } = await supa.rpc("espelhar_estado_de_criativos_da_graph", { p: linhas });
    estadoCriativos = error
      ? { erro: error.message }
      : {
          ...(data as object),
          servem_de_molde_video: linhas.filter((l) => l.serve_de_molde_video).length,
          servem_de_molde_imagem: linhas.filter((l) => l.serve_de_molde_imagem).length,
          via_video_data: linhas.filter((l) => l.fonte_da_config === "video_data").length,
          via_link_data: linhas.filter((l) => l.fonte_da_config === "link_data").length,
          via_asset_feed_spec: linhas.filter((l) => l.fonte_da_config === "asset_feed_spec").length,
          amostra_chaves_link_data: [
            ...new Set(linhas.flatMap((l) => l.chaves_do_link_data ?? [])),
          ],
        };
  }

  const { data: adsLocais } = await supa
    .from("ads")
    .select("id, company_id, external_id, creative_id, account_id")
    .in("external_id", adIds.length ? adIds : ["__nenhum__"]);
  const graphPorAd = new Map(anunciosGraph.map((a) => [a.id, a]));
  let urlTagsGravadas = 0;
  let destinosGravados = 0;
  const destinosPorSituacao = { unica: 0, ambigua: 0, ausente: 0 };
  let anunciosSemCampoUrlTags = 0;
  let anunciosSemCampoDestino = 0;
  const errosEscritaAds: string[] = [];
  const agoraAds = new Date().toISOString();

  // Snapshot diario ESP-13. Objetos variam de chaves de proposito: chave ausente na resposta
  // Graph tambem fica ausente do payload PostgREST, em vez de ser convertida em null/[].
  let statusSnapshotsGravados = 0;
  let healthSnapshotsGravados = 0;
  const errosSnapshots: string[] = [];
  for (const ad of anunciosGraph) {
    const patch: Record<string, unknown> = {
      company_id: null,
      account_id: ad.account_id,
      ad_external_id: ad.id,
      snapshot_date: agoraAds.slice(0, 10),
      coletado_em: agoraAds,
    };
    if (adStatus.valores.has(ad.id)) patch.status = adStatus.valores.get(ad.id);
    if (adEffectiveStatus.valores.has(ad.id)) {
      patch.effective_status = adEffectiveStatus.valores.get(ad.id);
    }
    if (adIssuesInfo.valores.has(ad.id)) patch.issues_info = adIssuesInfo.valores.get(ad.id);

    // company_id vem do anuncio local: a Graph nao conhece nosso tenant.
    const local = (adsLocais ?? []).find((x: any) => String(x.external_id) === ad.id);
    if (!local?.company_id) {
      errosSnapshots.push(`${ad.id}: company_id nao resolvido`);
      continue;
    }
    patch.company_id = local.company_id;
    const { error } = await supa.from("ad_status_snapshots").upsert(patch, {
      onConflict: "company_id,ad_external_id,snapshot_date",
    });
    if (error) errosSnapshots.push(`${ad.id}: ${error.message}`);
    else statusSnapshotsGravados++;
  }

  for (const accountGraphId of accountGraphIds) {
    const accountId = accountGraphId.replace(/^act_/, "");
    const bruto: Record<string, unknown> = {};
    const patch: Record<string, unknown> = {
      account_id: accountId,
      snapshot_date: agoraAds.slice(0, 10),
      fonte: "graph",
      coletado_em: agoraAds,
    };
    if (accountStatus.valores.has(accountGraphId)) {
      bruto.account_status = accountStatus.valores.get(accountGraphId);
      patch.account_status = bruto.account_status;
    }
    if (accountDisableReason.valores.has(accountGraphId)) {
      bruto.disable_reason = accountDisableReason.valores.get(accountGraphId);
      patch.disable_reason = bruto.disable_reason;
    }
    if (accountSpendCap.valores.has(accountGraphId)) {
      bruto.spend_cap = accountSpendCap.valores.get(accountGraphId);
      patch.spend_cap = centavos(bruto.spend_cap);
    }
    if (accountCapabilities.valores.has(accountGraphId)) {
      bruto.capabilities = accountCapabilities.valores.get(accountGraphId);
      patch.capabilities = bruto.capabilities;
    }
    // Nenhum candidato retornado = nenhuma linha. Isso declara cegueira, nao saude vazia.
    if (Object.keys(bruto).length === 0) continue;
    const local = (adsLocais ?? []).find((x: any) => String(x.account_id) === accountId);
    if (!local?.company_id) {
      errosSnapshots.push(`${accountId}: company_id nao resolvido`);
      continue;
    }
    patch.company_id = local.company_id;
    patch.bruto = bruto;
    const { error } = await supa.from("account_health_snapshots").upsert(patch, {
      onConflict: "company_id,account_id,snapshot_date",
    });
    if (error) errosSnapshots.push(`${accountId}: ${error.message}`);
    else healthSnapshotsGravados++;
  }

  for (const loc of adsLocais ?? []) {
    const adId = String(loc.external_id);
    const graphAd = graphPorAd.get(adId);
    const creativeId = graphAd?.creative_id ?? (loc.creative_id ? String(loc.creative_id) : null);
    const patch: Record<string, unknown> = {};
    let tentouUrlTags = false;
    let tentouDestino = false;

    // O campo no anuncio tem precedencia se a Graph realmente o devolveu. Caso contrario tenta
    // o criativo, onde meta-actions ja grava url_tags ao criar o adcreative.
    if (adUrlTags.valores.has(adId)) {
      const bruto = adUrlTags.valores.get(adId);
      // COALESCE da releitura: null nem entra no patch e portanto nao apaga valor bom;
      // string vazia entra, porque e a resposta afirmativa "li e nao tem rotulo".
      if (bruto !== null) patch.url_tags = bruto;
      patch.url_tags_coletado_em = agoraAds;
      tentouUrlTags = true;
    } else if (creativeId && camposCriativo.get("url_tags")?.has(creativeId)) {
      const bruto = camposCriativo.get("url_tags")!.get(creativeId);
      if (bruto !== null) patch.url_tags = bruto;
      patch.url_tags_coletado_em = agoraAds;
      tentouUrlTags = true;
    } else {
      anunciosSemCampoUrlTags++;
    }

    if (creativeId) {
      const destino = destinoDoCriativo(camposCriativo, creativeId);
      if (destino.lido) {
        patch.destino_url = destino.url;
        patch.destino_url_coletado_em = agoraAds;
        patch.destino_url_situacao = destino.situacao;
        patch.destino_url_candidatas = destino.candidatas;
        tentouDestino = true;
      } else {
        anunciosSemCampoDestino++;
      }
    } else {
      anunciosSemCampoDestino++;
    }

    if (Object.keys(patch).length === 0) continue;
    const { error } = await supa.from("ads").update(patch).eq("id", loc.id);
    if (error) {
      errosEscritaAds.push(`${adId}: ${error.message}`);
    } else {
      if (tentouUrlTags) urlTagsGravadas++;
      if (tentouDestino) {
        destinosGravados++;
        const situacao = patch.destino_url_situacao as "unica" | "ambigua" | "ausente";
        destinosPorSituacao[situacao]++;
      }
    }
  }

  const { data: locais } = await supa
    .from("campaigns")
    .select("id, external_id, name, status, external_account_id")
    .eq("provider", "meta_ads");

  const corrigidas: any[] = [];
  const renomeadas: any[] = [];
  const porInatividade: any[] = [];
  let iguais = 0;
  let configGravada = 0;
  const agora = new Date().toISOString();

  for (const loc of locais ?? []) {
    const real = reais.get(String(loc.external_id));
    if (real) {
      // v3: a config e gravada SEMPRE que a campanha veio da Graph - inclusive quando o status
      // ja estava certo. Na v2 esse caso fazia `continue` sem update; manter isso deixaria a
      // config so nas campanhas que por acaso tiveram status corrigido (2 de 29 na ultima corrida).
      const cfgCamp = config.get(String(loc.external_id));
      const patch: Record<string, unknown> = cfgCamp
        ? { ...cfgCamp, config_coletada_em: agora, categoria_especial_verificada_em: agora }
        : {};
      const novo = real.toUpperCase() === "ACTIVE" ? "active" : "paused";
      if (novo !== loc.status) patch.status = novo;

      // ESPELHO DO NOME: o nome pode ter mudado na Meta (renomear_campanha, ou edicao manual no
      // Gerenciador) sem o espelho acompanhar. A reconciliacao ja sincroniza status; o nome segue
      // a mesma logica - a Graph e a fonte de autoridade. Sem isto, um rename executado deixava
      // campaigns.name defasado ate alguem reescrever a mao.
      const nomeReal = nomesReais.get(String(loc.external_id));
      const nomeMudou = nomeReal != null && nomeReal !== loc.name;
      if (nomeMudou) patch.name = nomeReal;

      if (Object.keys(patch).length > 0)
        await supa.from("campaigns").update(patch).eq("id", loc.id);
      if (cfgCamp) configGravada++;

      if (nomeMudou) {
        renomeadas.push({
          external_id: loc.external_id,
          de: loc.name,
          para: nomeReal,
          fonte: "name da Meta (Graph)",
        });
      }

      if (novo !== loc.status) {
        corrigidas.push({
          campanha: loc.name,
          de: loc.status,
          para: novo,
          fonte: "effective_status da Meta",
        });
      } else {
        iguais++;
      }
      continue;
    }
    // sem correspondencia na Meta (conta inacessivel ou campanha removida)
    if (loc.status !== "active") {
      iguais++;
      continue;
    }
    const { data: ultimo } = await supa
      .from("metric_snapshots")
      .select("snapshot_date")
      .eq("campaign_id", loc.id)
      .gt("spend", 0)
      .order("snapshot_date", { ascending: false })
      .limit(1)
      .maybeSingle();
    const dias = ultimo?.snapshot_date
      ? Math.floor((Date.now() - new Date(ultimo.snapshot_date).getTime()) / 864e5)
      : 9999;
    if (dias > 45) {
      await supa.from("campaigns").update({ status: "paused" }).eq("id", loc.id);
      porInatividade.push({
        campanha: loc.name,
        conta: loc.external_account_id,
        dias_sem_gasto: dias === 9999 ? "nunca registrou gasto" : dias,
        fonte: "INFERENCIA por inatividade (>45d), nao status oficial",
      });
    } else {
      iguais++;
    }
  }

  // ============ v15: DICAS DA META (recommendations) ============
  // So objetos ACTIVE: dica mid-flight importa onde ha entrega. Campo sondado isolado.
  const campanhasAtivasIds = [...reais.entries()]
    .filter(([, st]) => /ACTIVE/i.test(String(st ?? "")))
    .map(([id]) => id);
  const anunciosAtivos = anunciosGraph.filter((a) => /ACTIVE/i.test(String(a.status ?? "")));
  const adsetsAtivosIds = [
    ...new Set(
      anunciosAtivos.map((a) => a.adset_external_id).filter((x): x is string => !!x),
    ),
  ];
  const adsAtivosIds = anunciosAtivos.map((a) => a.id);

  const campRecs = await lerCampoPorIdsMultiToken(campanhasAtivasIds, tokenDeCamp, "campanha", "recommendations");
  diagnosticoCampos.push(campRecs.diagnostico);
  const adsetRecs = await lerCampoPorIdsMultiToken(adsetsAtivosIds, tokenDeAdset, "conjunto", "recommendations");
  diagnosticoCampos.push(adsetRecs.diagnostico);
  const adRecs = await lerCampoPorIdsMultiToken(adsAtivosIds, tokenDeAd, "anuncio", "recommendations");
  diagnosticoCampos.push(adRecs.diagnostico);

  const companyPorConta = new Map<string, string>();
  for (const a of adsLocais ?? []) {
    if (a?.account_id && a?.company_id) {
      companyPorConta.set(String(a.account_id), String(a.company_id));
    }
  }
  const { data: campsLocais } = await supa
    .from("campaigns")
    .select("external_id, name, company_id, external_account_id")
    .in("external_id", campanhasAtivasIds.length ? campanhasAtivasIds : ["__nenhum__"]);
  const campLocalPorId = new Map(
    (campsLocais ?? []).map((c: any) => [String(c.external_id), c]),
  );
  const { data: adsetsLocais } = await supa
    .from("ad_sets")
    .select("external_id, name, company_id, campaign_id")
    .in("external_id", adsetsAtivosIds.length ? adsetsAtivosIds : ["__nenhum__"]);
  const adsetLocalPorId = new Map(
    (adsetsLocais ?? []).map((s: any) => [String(s.external_id), s]),
  );
  const campPkIds = [
    ...new Set((adsetsLocais ?? []).map((s: any) => s.campaign_id).filter(Boolean)),
  ];
  const { data: campsByPk } = await supa
    .from("campaigns")
    .select("id, external_id, name")
    .in(
      "id",
      campPkIds.length ? campPkIds : ["00000000-0000-0000-0000-000000000000"],
    );
  const campIdPorUuid = new Map(
    (campsByPk ?? []).map((c: any) => [
      String(c.id),
      { external_id: String(c.external_id), name: String(c.name ?? "") },
    ]),
  );

  const linhasDicas: Record<string, unknown>[] = [];
  const pushRecs = (
    objectType: "campaign" | "adset" | "ad",
    objectId: string,
    lista: unknown,
    meta: {
      company_id?: string | null;
      object_name?: string | null;
      campaign_external_id?: string | null;
      campaign_name?: string | null;
      adset_external_id?: string | null;
      ad_external_id?: string | null;
    },
  ) => {
    if (!meta.company_id || !Array.isArray(lista) || !lista.length) return;
    for (const raw of lista) {
      if (!raw || typeof raw !== "object") continue;
      const r = raw as Record<string, unknown>;
      const title = String(r.title ?? r.message ?? "").trim();
      if (!title && r.message == null) continue;
      linhasDicas.push({
        company_id: meta.company_id,
        object_type: objectType,
        object_external_id: objectId,
        object_name: meta.object_name ?? null,
        campaign_external_id: meta.campaign_external_id ?? null,
        campaign_name: meta.campaign_name ?? null,
        adset_external_id: meta.adset_external_id ?? null,
        ad_external_id: meta.ad_external_id ?? null,
        recommendation_code: r.code != null ? String(r.code) : null,
        title: title || "Dica Meta",
        message: r.message != null ? String(r.message) : null,
        importance: r.importance != null ? String(r.importance) : null,
        confidence: r.confidence != null ? String(r.confidence) : null,
        blame_field: r.blame_field != null ? String(r.blame_field) : null,
        payload_raw: r,
      });
    }
  };

  for (const [campId, lista] of campRecs.valores.entries()) {
    const local = campLocalPorId.get(campId);
    const companyId =
      local?.company_id ??
      (local?.external_account_id
        ? companyPorConta.get(String(local.external_account_id))
        : null);
    pushRecs("campaign", campId, lista, {
      company_id: companyId ? String(companyId) : null,
      object_name: local?.name ?? nomesReais.get(campId) ?? null,
      campaign_external_id: campId,
      campaign_name: local?.name ?? nomesReais.get(campId) ?? null,
    });
  }
  for (const [adsetId, lista] of adsetRecs.valores.entries()) {
    const local = adsetLocalPorId.get(adsetId);
    const camp = local?.campaign_id ? campIdPorUuid.get(String(local.campaign_id)) : null;
    pushRecs("adset", adsetId, lista, {
      company_id: local?.company_id ? String(local.company_id) : null,
      object_name: local?.name ?? null,
      campaign_external_id: camp?.external_id ?? null,
      campaign_name: camp?.name ?? null,
      adset_external_id: adsetId,
    });
  }
  for (const [adId, lista] of adRecs.valores.entries()) {
    const graph = graphPorAd.get(adId);
    const local = (adsLocais ?? []).find((x: any) => String(x.external_id) === adId);
    const campLocal = graph?.campaign_external_id
      ? campLocalPorId.get(graph.campaign_external_id)
      : null;
    pushRecs("ad", adId, lista, {
      company_id: local?.company_id ? String(local.company_id) : null,
      object_name: graph?.name ?? null,
      campaign_external_id: graph?.campaign_external_id ?? null,
      campaign_name: campLocal?.name ?? null,
      adset_external_id: graph?.adset_external_id ?? null,
      ad_external_id: adId,
    });
  }

  let metaRecosResultado: unknown = { nota: "nenhuma dica coletada nesta corrida" };
  // v16: Opportunity Score por conta acessivel (badge Ads Manager / Recommendation Center).
  const linhasOs: Record<string, unknown>[] = [];
  const diagnosticoOs: unknown[] = [];
  for (const acct of acessiveis) {
    const tok = tokenPorConta.get(acct);
    if (!tok) {
      diagnosticoOs.push({
        account_id: acct,
        ok: false,
        status: 0,
        erro: "token_ausente_empresa",
        motivo: "token_ausente_empresa",
      });
      continue;
    }
    const fetched = await fetchOpportunityRecommendations(acct, tok);
    const indice = await montarIndiceObjetosConta(acct);
    const companyFb =
      [...indice.companyIds][0] ??
      companyPorConta.get(acct) ??
      null;
    const montadas = fetched.ok
      ? linhasDeOpportunityScore(acct, fetched.recs, indice.porId, companyFb)
      : [];
    if (fetched.opportunity_score != null && companyFb && montadas.length === 0) {
      montadas.push({
        company_id: companyFb,
        object_type: "account",
        object_external_id: acct,
        object_name: `act_${acct}`,
        campaign_external_id: null,
        campaign_name: null,
        adset_external_id: null,
        ad_external_id: null,
        recommendation_code: "opportunity_score_snapshot",
        title: `Opportunity Score da conta: ${fetched.opportunity_score}`,
        message:
          `A Graph devolveu opportunity_score=${fetched.opportunity_score} para act_${acct}, ` +
          `mas a lista GET /act_*/recommendations veio vazia. Badge do Ads Manager pode existir mesmo assim.`,
        importance: "LOW",
        confidence: "mid_flight_recommendation",
        blame_field: "opportunity_score",
        payload_raw: {
          fonte: "opportunity_score",
          account_id: acct,
          opportunity_score: fetched.opportunity_score,
          recs_api: 0,
          raw_shape: fetched.raw_shape ?? null,
        },
      });
    }
    linhasOs.push(...montadas);
    diagnosticoOs.push({
      account_id: acct,
      ok: fetched.ok,
      status: fetched.status,
      erro: fetched.erro ?? null,
      opportunity_score: fetched.opportunity_score ?? null,
      recs_api: fetched.recs.length,
      linhas_montadas: montadas.length,
      raw_shape: fetched.raw_shape ?? null,
    });
  }
  const todasLinhasDicas = [...linhasDicas, ...linhasOs];
  if (todasLinhasDicas.length) {
    const { data, error } = await supa.rpc("upsert_meta_recomendacoes", { p: todasLinhasDicas });
    metaRecosResultado = error
      ? { erro: error.message, candidatas: todasLinhasDicas.length }
      : data;
  } else {
    metaRecosResultado = {
      ok: true,
      inseridas: 0,
      atualizadas: 0,
      nota: "Graph nao devolveu recommendations classicas nem Opportunity Score nos objetos/contas ACTIVE (ou campo ausente na sonda)",
      sonda: {
        campanhas: campRecs.diagnostico,
        conjuntos: adsetRecs.diagnostico,
        anuncios: adRecs.diagnostico,
        opportunity_score: diagnosticoOs,
      },
    };
  }

  const { count: ativasAgora } = await supa
    .from("campaigns")
    .select("id", { count: "exact", head: true })
    .eq("provider", "meta_ads")
    .eq("status", "active");

  // v3: config_gravada e a cobertura REAL da coleta de configuracao. Comparar com
  // campanhas_no_sistema mostra quantas seguem sem config por conta inacessivel (GT-19) - e a
  // diferenca precisa estar visivel, senao nulo por falta de acesso passa por "nao tem".
  const { count: totalCampanhas } = await supa
    .from("campaigns")
    .select("id", { count: "exact", head: true })
    .eq("provider", "meta_ads");

  return json({
    ok: true,
    mcp_chamador: auth.chamador,
    mcp_chave_legada: auth.legado,
    contas_acessiveis: acessiveis.length,
    contas_inacessiveis: inacessiveis.map((x) => x.account_id),
    contas_inacessiveis_detalhe: inacessiveis,
    campanhas_lidas_na_meta: reais.size,
    corrigidas_por_status_oficial: corrigidas.length,
    corrigidas,
    renomeadas_por_nome_oficial: renomeadas.length,
    renomeadas,
    pausadas_por_inatividade: porInatividade.length,
    porInatividade,
    ja_corretas: iguais,
    ativas_apos_correcao: ativasAgora ?? null,
    config_gravada: configGravada,
    campanhas_no_sistema: totalCampanhas ?? null,
    sem_config_por_falta_de_acesso: (totalCampanhas ?? 0) - configGravada,
    nota_config:
      "config_coletada_em so e preenchido para campanha lida na Graph. Campanha em conta inacessivel fica com config NULA e sem a marca - nulo sem marca = nao coletado; nulo COM marca = a Meta nao tem o campo (tipico de daily_budget em campanha ABO, onde o orcamento vive no conjunto). Orcamentos em CENTAVOS.",
    espelho_de_ads: {
      resultado: espelhoAds,
      nota: "inseridos = anuncio que existia na Graph e nao no espelho (a rota do Windsor nao o traz porque descarta objeto sem entrega). Metrica de anuncio novo e a soma de ad_metric_snapshots, nao um zero inventado; anuncio existente nao tem metrica tocada aqui - quem a mantem e o windsor-sync na janela ampla. last_synced_at avanca para todo anuncio lido na Graph.",
    },
    estado_dos_criativos: {
      criativos_lidos_na_meta: creativeIds.length,
      resultado: estadoCriativos,
      nota: "serve_de_molde_video=true libera peca nova de VIDEO; serve_de_molde_imagem=true libera peca nova de IMAGEM (link_data). Criterio alinhado a meta-actions montarCriacao.",
    },
    estado_dos_conjuntos: {
      conjuntos_lidos_na_meta: adsetIds.length,
      resultado: estadoConjuntos,
      sonda: diagnosticoCampos.filter((d) => d.nivel === "conjunto"),
      nota: "is_dynamic_creative=true impede anuncio avulso no conjunto (Criativo Dinamico); false libera. Campo nao devolvido pela Graph preserva o valor anterior - nulo continua significando 'nunca verificado', e nesse caso o portao de emissao recusa fechado. Ate a v8 nenhuma coleta preenchia esta coluna: todo conjunto criado depois da medicao manual de 07/08 travava a emissao de anuncio sem que nenhuma espera resolvesse. sem_espelho = conjunto que existe na Graph e ainda nao em ad_sets.",
    },
    orfaos_ausentes_na_graph: {
      por_conta: orfaosPorConta,
      nota: "Apos lista Graph ok, o que esta no espelho e nao veio e marcado status=DELETED + ausente_na_graph_em. Conta inacessivel nao entra (falso positivo). Nao apaga metrica. Rodar de novo depois que Ryan apagar TESTE-* na Meta.",
    },
    gt12: {
      anuncios_lidos_na_meta: adIds.length,
      criativos_identificados: creativeIds.length,
      url_tags_gravadas: urlTagsGravadas,
      destinos_gravados: destinosGravados,
      destinos_por_situacao: destinosPorSituacao,
      anuncios_sem_campo_url_tags: anunciosSemCampoUrlTags,
      anuncios_sem_campo_destino: anunciosSemCampoDestino,
      erros_escrita: errosEscritaAds,
      sonda: diagnosticoCampos,
      nota: "com_chave=0 significa que a Graph nao devolveu o campo e a respectiva marca de coleta nao foi gravada. Destino: uma URL inequívoca = unica; mais de uma = ambigua com candidatas cruas e destino_url NULL; nenhuma em spec retornado = ausente. template_url_spec e link_destination_display_url sao apenas sondados ate a forma real ser provada.",
    },
    esp13: {
      ad_status_snapshots_gravados: statusSnapshotsGravados,
      account_health_snapshots_gravados: healthSnapshotsGravados,
      erros_escrita: errosSnapshots,
      sonda: diagnosticoCampos.filter((d) =>
        [
          "status",
          "effective_status",
          "issues_info",
          "account_status",
          "disable_reason",
          "spend_cap",
          "capabilities",
        ].includes(d.campo),
      ),
      nota: "com_chave=0 significa campo nao retornado: a coluna nao entra no upsert. Array vazio ou null com chave presente e uma leitura e e preservado. Conta inacessivel nao gera linha.",
    },
    meta_recommendations: {
      resultado: metaRecosResultado,
      candidatas_montadas: todasLinhasDicas.length,
      candidatas_classicas: linhasDicas.length,
      candidatas_opportunity_score: linhasOs.length,
      objetos_sondados: {
        campanhas_active: campanhasAtivasIds.length,
        conjuntos_de_ads_active: adsetsAtivosIds.length,
        anuncios_active: adsAtivosIds.length,
        contas_opportunity_score: acessiveis.length,
      },
      sonda: {
        campanhas: campRecs.diagnostico,
        conjuntos: adsetRecs.diagnostico,
        anuncios: adRecs.diagnostico,
        opportunity_score: diagnosticoOs,
      },
      nota: "v16: Opportunity Score GET /act_*/recommendations (badge Ads Manager) + campo classico recommendations em objetos ACTIVE. first_seen_on/last_seen_on + veredito via upsert_meta_recomendacoes.",
    },
    versao: "meta-campaign-status-v16",
  });
});
