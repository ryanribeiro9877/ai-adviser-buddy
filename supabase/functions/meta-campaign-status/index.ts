// supabase/functions/meta-campaign-status/index.ts (v4)
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
// SOMENTE leitura na Meta + UPDATE local. Auth: x-mcp-key.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

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
  nivel: "anuncio" | "criativo";
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
  nivel: "anuncio" | "criativo",
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
  const prov = (req.headers.get("x-mcp-key") ?? "").trim();
  const { data: cfg } = await supa.from("mcp_config").select("api_key").eq("id", 1).maybeSingle();
  if (!cfg?.api_key || prov !== cfg.api_key) return json({ error: "unauthorized" }, 401);

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
  const anunciosPorConta = new Map<string, Array<{ id: string; creative_id: string | null }>>();

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
      for (const x of p?.data ?? []) {
        reais.set(String(x.id), String(x.effective_status ?? ""));
        config.set(String(x.id), lerConfig(x));
      }
      url = p?.paging?.next ?? "";
      pag++;
    }
    (okConta ? acessiveis : inacessiveis).push(c);

    // GT-12: a lista de anuncios e estado da conta, como a configuracao de campanha. So tenta
    // esta ponta quando a conta respondeu na Graph; conta inacessivel permanece nunca_lido.
    if (okConta) {
      const anuncios: Array<{ id: string; creative_id: string | null }> = [];
      let urlAds = `${GRAPH}/act_${c}/ads?fields=id,creative{id}&limit=200&access_token=${encodeURIComponent(TOKEN)}`;
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
          anuncios.push({
            id: String(x.id),
            creative_id: x?.creative?.id ? String(x.creative.id) : null,
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
  const diagnosticoCampos: LeituraCampo[] = [];

  const adUrlTags = await lerCampoPorIds(adIds, "anuncio", "url_tags");
  diagnosticoCampos.push(adUrlTags.diagnostico);
  const trackingSpecs = await lerCampoPorIds(adIds, "anuncio", "tracking_specs");
  diagnosticoCampos.push(trackingSpecs.diagnostico);

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
    .select("id, external_id, creative_id, account_id")
    .in("external_id", adIds.length ? adIds : ["__nenhum__"]);
  const graphPorAd = new Map(anunciosGraph.map((a) => [a.id, a]));
  let urlTagsGravadas = 0;
  let destinosGravados = 0;
  const destinosPorSituacao = { unica: 0, ambigua: 0, ausente: 0 };
  let anunciosSemCampoUrlTags = 0;
  let anunciosSemCampoDestino = 0;
  const errosEscritaAds: string[] = [];
  const agoraAds = new Date().toISOString();

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
    contas_no_sistema: contas.length,
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
    versao: "meta-campaign-status-v4",
  });
});
