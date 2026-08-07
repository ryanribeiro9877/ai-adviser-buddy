// supabase/functions/meta-campaign-status/index.ts (v7)
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

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const TOKEN = (Deno.env.get("META_ADS_TOKEN") ?? "").trim();
const GRAPH = "https://graph.facebook.com/v21.0";
const supa = createClient(SUPABASE_URL, SERVICE_ROLE, { auth: { persistSession: false } });
function redact(s: string) {
  if (!TOKEN) return s;
  return s
    .split(TOKEN)
    .join("[TOKEN-REDACTED]")
    .replace(/access_token=[A-Za-z0-9]+/g, "access_token=[TOKEN-REDACTED]");
}
function json(o: unknown, st = 200) {
  return new Response(redact(JSON.stringify(o)), {
    status: st,
    headers: { "content-type": "application/json" },
  });
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
  nivel: "anuncio" | "criativo" | "conta";
  campo: string;
  solicitados: number;
  respostas: number;
  com_chave: number;
  exemplos: unknown[];
  erros: string[];
};

type ResultadoCampo = {
  valores: Map<string, unknown>;
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
  nivel: "anuncio" | "criativo" | "conta",
  campo: string,
): Promise<ResultadoCampo> {
  const valores = new Map<string, unknown>();
  const diagnostico: LeituraCampo = {
    nivel,
    campo,
    solicitados: ids.length,
    respostas: 0,
    com_chave: 0,
    exemplos: [],
    erros: [],
  };
  for (let i = 0; i < ids.length; i += 20) {
    const lote = ids.slice(i, i + 20);
    const url = `${GRAPH}/?ids=${encodeURIComponent(lote.join(","))}&fields=${encodeURIComponent(campo)}&access_token=${encodeURIComponent(TOKEN)}`;
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
      if (!temChave(obj, campo)) continue;
      const valor = obj[campo];
      valores.set(id, valor);
      diagnostico.com_chave++;
      if (diagnostico.exemplos.length < 2) diagnostico.exemplos.push(exemploSeguro(valor));
    }
  }
  return { valores, diagnostico };
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

Deno.serve(async (req) => {
  if (req.method !== "POST") return json({ error: "POST only" }, 405);
  if (!TOKEN) return json({ error: "META_ADS_TOKEN ausente" }, 500);
  // Cron manda x-mcp-key; bearer tambem aceito. A RPC grava o chamador — evidencia
  // que autoriza revogar a chave legada depois (CODE 1.5).
  const auth = await mcpKeyValida(supa, chaveMcpDe(req, "header-or-bearer"));
  if (!auth.ok) return json({ error: "unauthorized", motivo: auth.motivo }, 401);

  const { data: integs } = await supa
    .from("integrations")
    .select("external_id, account_name")
    .eq("provider", "meta_ads");
  const contas = [
    ...new Set((integs ?? []).map((i: any) => String(i.external_id)).filter(Boolean)),
  ];

  const reais = new Map<string, string>(); // campaign_id -> effective_status
  const config = new Map<string, ConfigCampanha>(); // campaign_id -> configuracao lida da Graph
  const acessiveis: string[] = [];
  const inacessiveis: string[] = [];
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

  for (const c of contas) {
    let url = `${GRAPH}/act_${c}/campaigns?fields=${CAMPOS}&limit=200&access_token=${encodeURIComponent(TOKEN)}`;
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
        config.set(String(x.id), lerConfig(x));
        campIds.push(String(x.id));
      }
      campanhasPorConta.set(c, campIds);
      url = p?.paging?.next ?? "";
      pag++;
    }
    (okConta ? acessiveis : inacessiveis).push(c);

    // GT-12: a lista de anuncios e estado da conta, como a configuracao de campanha. So tenta
    // esta ponta quando a conta respondeu na Graph; conta inacessivel permanece nunca_lido.
    if (okConta) {
      // v7: conjuntos da conta — sem isso o espelho nao marca orfao de adset (ex.: TESTE-GT02).
      const adsetIds: string[] = [];
      let urlSets = `${GRAPH}/act_${c}/adsets?fields=id&limit=200&access_token=${encodeURIComponent(TOKEN)}`;
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
      let urlAds = `${GRAPH}/act_${c}/ads?fields=${CAMPOS_ADS}&limit=200&access_token=${encodeURIComponent(TOKEN)}`;
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

  // Sonda e coleta GT-12. Cada candidato e lido isoladamente: um campo invalido nao contamina
  // outro, e `hasOwnProperty` impede transformar ausencia silenciosa em "nao tem UTM".
  const anunciosGraph = [...anunciosPorConta.values()].flat();
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

  const adUrlTags = await lerCampoPorIds(adIds, "anuncio", "url_tags");
  diagnosticoCampos.push(adUrlTags.diagnostico);
  const trackingSpecs = await lerCampoPorIds(adIds, "anuncio", "tracking_specs");
  diagnosticoCampos.push(trackingSpecs.diagnostico);

  // ESP-13: status configurado e status efetivo sao fatos distintos. Cada campo e consultado
  // sozinho; `issues_info` ausente nunca vira [].
  const adStatus = await lerCampoPorIds(adIds, "anuncio", "status");
  diagnosticoCampos.push(adStatus.diagnostico);
  const adEffectiveStatus = await lerCampoPorIds(adIds, "anuncio", "effective_status");
  diagnosticoCampos.push(adEffectiveStatus.diagnostico);
  const adIssuesInfo = await lerCampoPorIds(adIds, "anuncio", "issues_info");
  diagnosticoCampos.push(adIssuesInfo.diagnostico);

  const accountGraphIds = acessiveis.map((id) => `act_${id}`);
  const accountStatus = await lerCampoPorIds(accountGraphIds, "conta", "account_status");
  diagnosticoCampos.push(accountStatus.diagnostico);
  const accountDisableReason = await lerCampoPorIds(accountGraphIds, "conta", "disable_reason");
  diagnosticoCampos.push(accountDisableReason.diagnostico);
  const accountSpendCap = await lerCampoPorIds(accountGraphIds, "conta", "spend_cap");
  diagnosticoCampos.push(accountSpendCap.diagnostico);
  const accountCapabilities = await lerCampoPorIds(accountGraphIds, "conta", "capabilities");
  diagnosticoCampos.push(accountCapabilities.diagnostico);

  const camposCriativo = new Map<string, Map<string, unknown>>();
  for (const campo of [
    "url_tags",
    "object_story_spec",
    "template_url_spec",
    "asset_feed_spec",
    "link_destination_display_url",
  ]) {
    const lido = await lerCampoPorIds(creativeIds, "criativo", campo);
    camposCriativo.set(campo, lido.valores);
    diagnosticoCampos.push(lido.diagnostico);
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

      if (Object.keys(patch).length > 0)
        await supa.from("campaigns").update(patch).eq("id", loc.id);
      if (cfgCamp) configGravada++;

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
    contas_inacessiveis: inacessiveis,
    campanhas_lidas_na_meta: reais.size,
    corrigidas_por_status_oficial: corrigidas.length,
    corrigidas,
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
    versao: "meta-campaign-status-v7",
  });
});
