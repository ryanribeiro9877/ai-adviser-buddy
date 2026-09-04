// Leitura de desempenho por campanha/conjunto/anúncio.
// Habilita o agente a fechar detalhamento (ID Meta ou nome) com série diária,
// sem o gestor repetir a pergunta. Não grava fato de conta.

import { statusObjetoOperacional } from "./memoria_conjunto.ts";
import { type BaseDeResultado, baseDoObjetivo, custoPorResultado, rotuloDaBase } from "./metrica_canonica.ts";

export type CampanhaRef = {
  id?: string;
  name?: string | null;
  external_id?: string | null;
};

export type DetalheAnunciosArgs = {
  name_like?: string;
  campaign_id?: string;
  date_from?: string;
  date_to?: string;
  pagina?: number;
  incluir_serie_diaria?: boolean;
};

const ADS_POR_PAGINA = 6;
const DIGITOS_ID_MIN = 8;

export const deaccLeitura = (s: string) =>
  s.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
export const normLeitura = (s: string) =>
  deaccLeitura(s.toLowerCase()).replace(/[-_\s]+/g, "");

const brl = (n: number) => "R$ " + (Math.round(n * 100) / 100).toFixed(2);
const num = (v: unknown) => Number(v || 0);
const pct = (n: number, d: number) => d > 0 ? `${(100 * n / d).toFixed(2)}%` : null;

export function todayIsoBrt(): string {
  return new Date().toLocaleDateString("en-CA", { timeZone: "America/Sao_Paulo" });
}

/** Casa campanha por trecho de nome OU ID numérico da Meta (external_id). */
export function casarCampanhas<T extends CampanhaRef>(camps: T[], needleRaw: string): T[] {
  const needle = String(needleRaw ?? "").trim();
  if (!needle) return [];
  const n = normLeitura(needle);
  const digits = needle.replace(/\D/g, "");
  return camps.filter((c) => {
    const nome = normLeitura(String(c.name ?? ""));
    const ext = String(c.external_id ?? "").replace(/\D/g, "");
    if (nome && n && (nome.includes(n) || n.includes(nome))) return true;
    if (digits.length >= DIGITOS_ID_MIN && ext) {
      if (ext === digits || ext.endsWith(digits) || digits.endsWith(ext)) return true;
    }
    return false;
  });
}

export function escolherCampanhaUnica<T extends CampanhaRef>(
  hits: T[],
  needleRaw: string,
): { unica?: T; ambiguo?: T[] } {
  if (!hits.length) return {};
  if (hits.length === 1) return { unica: hits[0] };
  const needle = String(needleRaw ?? "").trim();
  const n = normLeitura(needle);
  const digits = needle.replace(/\D/g, "");
  const exactId = hits.filter((c) => String(c.external_id ?? "").replace(/\D/g, "") === digits);
  if (exactId.length === 1) return { unica: exactId[0] };
  const exactNome = hits.filter((c) => normLeitura(String(c.name ?? "")) === n);
  if (exactNome.length === 1) return { unica: exactNome[0] };
  return { ambiguo: hits };
}

/** Janela explícita no pedido (21/08 a 27/08/2026, ISO, etc.). */
export function parseJanelaDatasPedido(texto: string, hojeIso?: string): { date_from?: string; date_to?: string } {
  const raw = String(texto ?? "");
  const hoje = (hojeIso || todayIsoBrt()).slice(0, 10);
  const anoHoje = Number(hoje.slice(0, 4));
  const iso = raw.match(
    /(\d{4}-\d{2}-\d{2})\s*(?:a|ate|até|–|-|ate)\s*(\d{4}-\d{2}-\d{2})/i,
  );
  if (iso) return { date_from: iso[1], date_to: iso[2] };
  const br = raw.match(
    /(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?\s*(?:a|ate|até|–|-)\s*(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?/i,
  );
  if (!br) return {};
  const anoFim = normalizarAno(br[6], anoHoje);
  const anoIni = normalizarAno(br[3], anoFim);
  return {
    date_from: `${anoIni}-${pad2(br[2])}-${pad2(br[1])}`,
    date_to: `${anoFim}-${pad2(br[5])}-${pad2(br[4])}`,
  };
}

function normalizarAno(raw: string | undefined, fallback: number): number {
  if (!raw) return fallback;
  const n = Number(raw);
  if (n >= 100) return n;
  return n >= 70 ? 1900 + n : 2000 + n;
}
function pad2(s: string): string {
  return String(s).padStart(2, "0");
}

export function janelaDetalhe(date_from?: string, date_to?: string, daysDefault = 14): { from: string; to: string } {
  const to = (date_to || todayIsoBrt()).slice(0, 10);
  if (date_from) return { from: date_from.slice(0, 10), to };
  const d = new Date(`${to}T12:00:00-03:00`);
  d.setDate(d.getDate() - Math.max(1, daysDefault) + 1);
  const from = d.toLocaleDateString("en-CA", { timeZone: "America/Sao_Paulo" });
  return { from, to };
}

function linhaMetrica(s: Record<string, unknown>, hoje: string) {
  const spend = num(s.spend), imp = num(s.impressions);
  const clkTodos = num(s.clicks), clkLink = num(s.link_clicks);
  return {
    dia: s.snapshot_date,
    gasto: brl(spend),
    gasto_num: spend,
    impressoes: imp,
    alcance: num(s.reach),
    frequencia: s.frequency != null ? Number(num(s.frequency).toFixed(2)) : null,
    cliques_todos: clkTodos,
    cliques_no_link: clkLink,
    visualizacoes_lp: num(s.landing_page_views),
    formularios: num(s.form_leads),
    conversas: num(s.messaging_started),
    ctr_todos: pct(clkTodos, imp),
    ctr_link: pct(clkLink, imp),
    cpc_todos: clkTodos ? brl(spend / clkTodos) : null,
    cpc_link: clkLink ? brl(spend / clkLink) : null,
    cpm: imp ? brl(1000 * spend / imp) : null,
    ...(String(s.snapshot_date) === hoje ? { dia_parcial_em_coleta: true } : {}),
  };
}

type TotaisSnap = {
  spend: number; imp: number; reach: number; clkTodos: number;
  link: number; lpv: number; forms: number; msg: number;
};

export function somarSnaps(rows: Record<string, unknown>[]): TotaisSnap {
  return rows.reduce<TotaisSnap>((a, s) => ({
    spend: a.spend + num(s.spend),
    imp: a.imp + num(s.impressions),
    reach: a.reach + num(s.reach),
    clkTodos: a.clkTodos + num(s.clicks),
    link: a.link + num(s.link_clicks),
    lpv: a.lpv + num(s.landing_page_views),
    forms: a.forms + num(s.form_leads),
    msg: a.msg + num(s.messaging_started),
  }), { spend: 0, imp: 0, reach: 0, clkTodos: 0, link: 0, lpv: 0, forms: 0, msg: 0 });
}

/**
 * Totais da janela COM A BASE DE RESULTADO DECLARADA.
 *
 * 04/09/2026: antes daqui saia so `custo_por_formulario`, com denominador fixo em formularios
 * qualquer que fosse a base da campanha. Numa campanha de WhatsApp — que nao coleta formulario —
 * isso devolvia `null` e o leitor concluia "sem resultado", quando havia conversa; numa campanha
 * de trafego, dividia o gasto por formularios que nunca existiriam. O rotulo dizia "formulario"
 * e o consumidor lia "resultado", que sao coisas diferentes quando a base muda.
 *
 * `base` e OBRIGATORIA de proposito. Ela vem de `baseDoObjetivo` (categoria, optimization_goal,
 * objective) — configuracao declarada, nunca contador — porque base decidida por "teve conversa
 * > 0" troca de identidade conforme a janela do relatorio.
 *
 * `custo_por_formulario` continua saindo, mas agora ao lado de `custo_por_resultado` e do rotulo
 * da base: ele nunca foi errado como "custo por formulario", foi errado como "custo por
 * resultado". Manter os dois nomeados separadamente e o que impede a proxima confusao.
 */
export function totaisDe(tot: TotaisSnap, base: BaseDeResultado) {
  const cpr = custoPorResultado(
    { gasto: tot.spend, formularios: tot.forms, conversas: tot.msg, cliques_no_link: tot.link },
    base,
  );
  return {
    gasto: brl(tot.spend),
    impressoes: tot.imp,
    alcance_soma_diaria_nao_deduplicada: tot.reach,
    cliques_todos: tot.clkTodos,
    cliques_no_link: tot.link,
    visualizacoes_lp: tot.lpv,
    formularios: tot.forms,
    conversas: tot.msg,
    ctr_todos: pct(tot.clkTodos, tot.imp),
    ctr_link: pct(tot.link, tot.imp),
    cpc_todos: tot.clkTodos ? brl(tot.spend / tot.clkTodos) : null,
    cpc_link: tot.link ? brl(tot.spend / tot.link) : null,
    cpm: tot.imp ? brl(1000 * tot.spend / tot.imp) : null,
    base_de_resultado: base,
    base_de_resultado_rotulo: rotuloDaBase(base),
    resultados_na_base: cpr.resultados,
    custo_por_resultado: cpr.valor === null ? null : brl(cpr.valor),
    custo_por_resultado_indefinido_porque: cpr.indefinido_porque,
    custo_por_formulario: tot.forms ? brl(tot.spend / tot.forms) : null,
  };
}

/**
 * Nota do overview da conta. Fica junto do calculo de proposito: nota e formula que moram em
 * arquivos diferentes divergem, e foi assim que a proibicao de recalcular sumiu do overview
 * enquanto continuava escrita no funil.
 */
export const NOTA_OVERVIEW =
  "status vem do effective_status real da Meta (cron 09:10). dias_com_dado<7 indica cobertura " +
  "incompleta: nao conclua queda sem checar isso. CUSTO POR RESULTADO: a conta mistura TRES bases " +
  "(formulario, conversa e clique no link) e cada custo abaixo usa SO o gasto das campanhas que " +
  "registraram AQUELE evento (veja os campos gasto_base_*). E PROIBIDO recalcular dividindo o " +
  "`gasto` total por um evento — o gasto total inclui campanhas de outra base, e a divisao infla o " +
  "custo. custo_por_clique_no_link NAO e custo por lead: clique no link e midia, nao resultado.";

type LinhaSnapConta = {
  campaign_id?: unknown; spend?: unknown;
  form_leads?: unknown; messaging_started?: unknown; link_clicks?: unknown;
};

/**
 * Custo por resultado da CONTA INTEIRA, com o gasto escopado por base.
 *
 * 04/09/2026: o overview dividia o gasto das TRES bases pelo denominador de UMA. Numa conta que
 * roda formulario, WhatsApp e trafego ao mesmo tempo, o gasto do WhatsApp e do trafego entrava no
 * numerador do custo por formulario — o mesmo defeito de numerador que ja tinha inflado o custo de
 * uma marca em 5,4x no detalhamento, aqui em versao agregada e portanto mais dificil de notar.
 *
 * O padrao replicado e o de `get_funnel`, que ja fazia certo desde 14/08: soma so o gasto das
 * campanhas que registraram o evento, e devolve esse gasto ao lado do custo para que o numero
 * possa ser conferido sem refazer a conta.
 */
export function custosDaContaPorBase(linhas: LinhaSnapConta[], tot: { spend: number; forms: number; msg: number; link: number }) {
  const porCampanha = new Map<string, { spend: number; forms: number; msg: number; link: number }>();
  for (const r of linhas) {
    const k = String(r.campaign_id ?? "sem_campanha");
    const cur = porCampanha.get(k) ?? { spend: 0, forms: 0, msg: 0, link: 0 };
    cur.spend += num(r.spend);
    cur.forms += num(r.form_leads);
    cur.msg += num(r.messaging_started);
    cur.link += num(r.link_clicks);
    porCampanha.set(k, cur);
  }
  const gastoOnde = (tem: (v: { forms: number; msg: number; link: number }) => boolean) =>
    [...porCampanha.values()].filter(tem).reduce((a, v) => a + v.spend, 0);
  const gastoForm = gastoOnde((v) => v.forms > 0);
  const gastoMsg = gastoOnde((v) => v.msg > 0);
  const gastoLink = gastoOnde((v) => v.link > 0);
  const cpr = (base: BaseDeResultado, gastoDosObjetosComResultado: number) =>
    custoPorResultado(
      { gasto: tot.spend, formularios: tot.forms, conversas: tot.msg, cliques_no_link: tot.link },
      base,
      { gastoDosObjetosComResultado },
    ).valor;
  const cForm = cpr("formularios", gastoForm);
  const cMsg = cpr("conversas", gastoMsg);
  const cLink = cpr("cliques_no_link", gastoLink);
  return {
    custo_por_formulario: cForm === null ? null : brl(cForm),
    custo_por_conversa: cMsg === null ? null : brl(cMsg),
    // Renomeado de `custo_por_lead_lp` em 04/09/2026: chamava de "lead" um clique no link, e o
    // rotulo levava o modelo a compara-lo com custo por formulario como se fossem a mesma coisa.
    custo_por_clique_no_link: cLink === null ? null : brl(cLink),
    gasto_base_do_por_formulario: tot.forms ? brl(gastoForm) : null,
    gasto_base_do_por_conversa: tot.msg ? brl(gastoMsg) : null,
    gasto_base_do_por_clique_no_link: tot.link ? brl(gastoLink) : null,
  };
}

function resumoTargeting(t: unknown): Record<string, unknown> | null {
  if (!t || typeof t !== "object") return null;
  const o = t as Record<string, unknown>;
  const geo = o.geo_locations && typeof o.geo_locations === "object"
    ? o.geo_locations as Record<string, unknown>
    : null;
  const custom = Array.isArray(o.custom_audiences) ? o.custom_audiences : [];
  const excluded = Array.isArray(o.excluded_custom_audiences) ? o.excluded_custom_audiences : [];
  return {
    age_min: o.age_min ?? null,
    age_max: o.age_max ?? null,
    genders: o.genders ?? null,
    advantage_plus: o.targeting_automation != null || o.advantage_audience === true,
    paises: Array.isArray(geo?.countries) ? geo!.countries : null,
    custom_audiences: custom.length,
    excluded_custom_audiences: excluded.length,
  };
}

async function snapsDosAds(supa: Supa, ids: string[], from: string, to: string) {
  const out: Record<string, unknown>[] = [];
  const TAM = 80;
  for (let i = 0; i < ids.length; i += TAM) {
    const fatia = ids.slice(i, i + TAM);
    const { data, error } = await supa.from("ad_metric_snapshots")
      .select("ad_external_id,snapshot_date,spend,impressions,reach,clicks,link_clicks,landing_page_views,form_leads,messaging_started,frequency")
      .gte("snapshot_date", from)
      .lte("snapshot_date", to)
      .in("ad_external_id", fatia);
    if (error) return { erro: error.message, snaps: [] as Record<string, unknown>[] };
    out.push(...((data ?? []) as Record<string, unknown>[]));
  }
  return { snaps: out };
}

type Supa = { from: (t: string) => any };

/**
 * Anúncios de UMA campanha (nome ou ID Meta) + totais do período + série diária
 * por anúncio (paginada) e por conjunto (agregada, sempre).
 */
export async function tDetalheAnuncios(
  supa: Supa,
  companyId: string,
  args: DetalheAnunciosArgs,
): Promise<Record<string, unknown>> {
  const needle = String(args.campaign_id || args.name_like || "").trim();
  if (!needle) {
    return { erro: "informe campaign_id (ID Meta) ou name_like (trecho do nome)" };
  }
  const { data: all, error: eCamp } = await supa.from("campaigns")
    // `category` entrou em 04/09/2026: e a PRIMEIRA entrada de `baseDoObjetivo` (decisao humana
    // vem antes de configuracao da Meta). Sem ela, toda campanha caia no ramo de `objective` e as
    // de categoria "mensagem" eram medidas por formulario.
    .select("id,name,status,objective,external_id,special_ad_categories,category")
    .eq("company_id", companyId);
  if (eCamp) return { erro: `falha ao ler campanhas: ${eCamp.message}` };
  const campsOperacionais = ((all ?? []) as Array<CampanhaRef & { status?: unknown }>)
    .filter((c) => statusObjetoOperacional(c.status));
  const hits = casarCampanhas(campsOperacionais, needle);
  const escolha = escolherCampanhaUnica(hits, needle);
  if (!escolha.unica) {
    if (escolha.ambiguo?.length) {
      return {
        ambiguo: true,
        opcoes: escolha.ambiguo.slice(0, 8).map((c) => ({
          nome: c.name, campaign_id: c.external_id,
        })),
        instrucao: "chame de novo com o campaign_id Meta ou o nome completo de UMA campanha",
      };
    }
    return { erro: `nenhuma campanha com nome ou ID contendo '${needle}'` };
  }
  const camp = escolha.unica as CampanhaRef & {
    status?: string; objective?: string; special_ad_categories?: unknown; category?: string | null;
  };
  // Base da CAMPANHA. Os conjuntos podem refinar com o proprio optimization_goal (abaixo), mas
  // ninguem aqui decide base por contador — so por configuracao declarada.
  const baseCamp = baseDoObjetivo(camp.category, null, camp.objective);
  const { from, to } = janelaDetalhe(args.date_from, args.date_to, 14);
  const pagina = Math.max(1, Number(args.pagina ?? 1) || 1);
  const comSerie = args.incluir_serie_diaria !== false;
  const hoje = todayIsoBrt();

  const { data: ads, error: eAds } = await supa.from("ads")
    .select("external_id,name,status,adset_external_id,call_to_action_type,title,body,object_type,destino_url,destination_url")
    .eq("company_id", companyId)
    .eq("campaign_id", camp.id);
  if (eAds) return { erro: `falha ao ler anuncios: ${eAds.message}` };
  const listaAds = ((ads ?? []) as Record<string, unknown>[])
    .filter((a) => statusObjetoOperacional(a.status));

  const { data: sets } = await supa.from("ad_sets")
    .select("external_id,name,status,daily_budget,optimization_goal,destination_type,targeting")
    .eq("company_id", companyId)
    .eq("campaign_id", camp.id);
  const listaSets = ((sets ?? []) as Record<string, unknown>[])
    .filter((s) => statusObjetoOperacional(s.status));
  const setMap = new Map(
    listaSets.map((s) => [String(s.external_id), s]),
  );

  const ids = listaAds.map((a) => String(a.external_id)).filter(Boolean);
  let snaps: Record<string, unknown>[] = [];
  if (ids.length) {
    const got = await snapsDosAds(supa, ids, from, to);
    if (got.erro) return { erro: `falha ao ler serie diaria dos anuncios: ${got.erro}` };
    snaps = got.snaps;
  }

  type Agg = TotaisSnap;
  const aggAd = new Map<string, Agg>();
  const snapsPorAd = new Map<string, Record<string, unknown>[]>();
  for (const s of snaps) {
    const id = String(s.ad_external_id ?? "");
    if (!id) continue;
    const cur = aggAd.get(id) ?? somarSnaps([]);
    aggAd.set(id, somarSnaps([{
      spend: cur.spend, impressions: cur.imp, reach: cur.reach, clicks: cur.clkTodos,
      link_clicks: cur.link, landing_page_views: cur.lpv, form_leads: cur.forms,
      messaging_started: cur.msg,
    }, s]));
    const arr = snapsPorAd.get(id) ?? [];
    arr.push(s);
    snapsPorAd.set(id, arr);
  }

  const ranked = [...listaAds].sort((a, b) => {
    const sa = aggAd.get(String(a.external_id))?.spend ?? 0;
    const sb = aggAd.get(String(b.external_id))?.spend ?? 0;
    return sb - sa;
  });
  const totalAnuncios = ranked.length;
  const offset = (pagina - 1) * ADS_POR_PAGINA;
  const fatia = ranked.slice(offset, offset + ADS_POR_PAGINA);
  const restantes = Math.max(0, totalAnuncios - offset - fatia.length);

  const anuncios = fatia.map((a) => {
    const id = String(a.external_id);
    const tot = aggAd.get(id) ?? somarSnaps([]);
    const set = setMap.get(String(a.adset_external_id ?? ""));
    const dest = String(a.destino_url || a.destination_url || "") || null;
    const dias = (snapsPorAd.get(id) ?? [])
      .slice()
      .sort((x, y) => String(x.snapshot_date).localeCompare(String(y.snapshot_date)));
    return {
      ad_id: id,
      nome: a.name,
      status: a.status,
      conjunto: set?.name ?? null,
      conjunto_id: a.adset_external_id ?? null,
      conjunto_status: set?.status ?? null,
      cta: a.call_to_action_type ?? null,
      titulo: a.title ?? null,
      legenda: typeof a.body === "string" && a.body.trim() ? String(a.body).slice(0, 500) : null,
      formato: a.object_type ?? null,
      destino: dest,
      // O anuncio herda a base do conjunto que o entrega; o conjunto refina a da campanha pelo
      // proprio optimization_goal, que e onde a Meta declara o que aquele conjunto otimiza.
      totais_janela: totaisDe(tot, baseDoObjetivo(camp.category, set?.optimization_goal as string | null, camp.objective)),
      ...(comSerie
        ? { serie_diaria: dias.map((d) => {
          const { gasto_num: _g, ...linha } = linhaMetrica(d, hoje);
          void _g;
          return linha;
        }) }
        : {}),
    };
  });

  const porConjunto = new Map<string, {
    nome: unknown; status: unknown; n: number; tot: Agg; dias: Map<string, Record<string, unknown>[]>;
  }>();
  for (const set of listaSets) {
    const sid = String(set.external_id ?? "");
    if (!sid) continue;
    porConjunto.set(sid, {
      nome: set.name, status: set.status ?? null, n: 0, tot: somarSnaps([]),
      dias: new Map<string, Record<string, unknown>[]>(),
    });
  }
  for (const a of listaAds) {
    const sid = String(a.adset_external_id ?? "sem_conjunto");
    const set = setMap.get(String(a.adset_external_id ?? ""));
    const cur = porConjunto.get(sid) ?? {
      nome: set?.name ?? sid, status: set?.status ?? null, n: 0, tot: somarSnaps([]),
      dias: new Map<string, Record<string, unknown>[]>(),
    };
    cur.n += 1;
    const id = String(a.external_id);
    const tAd = aggAd.get(id);
    if (tAd) {
      cur.tot = {
        spend: cur.tot.spend + tAd.spend, imp: cur.tot.imp + tAd.imp, reach: cur.tot.reach + tAd.reach,
        clkTodos: cur.tot.clkTodos + tAd.clkTodos, link: cur.tot.link + tAd.link, lpv: cur.tot.lpv + tAd.lpv,
        forms: cur.tot.forms + tAd.forms, msg: cur.tot.msg + tAd.msg,
      };
    }
    for (const d of snapsPorAd.get(id) ?? []) {
      const dia = String(d.snapshot_date);
      const arr = cur.dias.get(dia) ?? [];
      arr.push(d);
      cur.dias.set(dia, arr);
    }
    porConjunto.set(sid, cur);
  }

  const conjuntos = [...porConjunto.entries()].map(([sid, c]) => {
    const set = setMap.get(sid);
    const serie = [...c.dias.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([dia, rows]) => {
        const { gasto_num: _g, ...linha } = linhaMetrica({
          snapshot_date: dia,
          spend: rows.reduce((n, r) => n + num(r.spend), 0),
          impressions: rows.reduce((n, r) => n + num(r.impressions), 0),
          reach: rows.reduce((n, r) => n + num(r.reach), 0),
          clicks: rows.reduce((n, r) => n + num(r.clicks), 0),
          link_clicks: rows.reduce((n, r) => n + num(r.link_clicks), 0),
          landing_page_views: rows.reduce((n, r) => n + num(r.landing_page_views), 0),
          form_leads: rows.reduce((n, r) => n + num(r.form_leads), 0),
          messaging_started: rows.reduce((n, r) => n + num(r.messaging_started), 0),
        }, hoje);
        void _g;
        return linha;
      });
    return {
      conjunto_id: sid === "sem_conjunto" ? null : sid,
      nome: c.nome,
      status: c.status,
      anuncios: c.n,
      orcamento_diario_centavos: set?.daily_budget ?? null,
      optimization_goal: set?.optimization_goal ?? null,
      destination_type: set?.destination_type ?? null,
      publico: resumoTargeting(set?.targeting),
      totais_janela: totaisDe(c.tot, baseDoObjetivo(camp.category, set?.optimization_goal as string | null, camp.objective)),
      serie_diaria: serie,
    };
  });

  const totCamp = somarSnaps(snaps);
  return {
    campanha: {
      nome: camp.name,
      campaign_id: camp.external_id,
      status: camp.status,
      objective: camp.objective ?? null,
      special_ad_categories: Array.isArray(camp.special_ad_categories) ? camp.special_ad_categories : [],
    },
    janela: { date_from: from, date_to: to },
    pagina,
    anuncios_por_pagina: ADS_POR_PAGINA,
    total_anuncios: totalAnuncios,
    exibidos: fatia.length,
    restantes,
    totais_campanha_janela: totaisDe(totCamp, baseCamp),
    conjuntos,
    anuncios,
    nota:
      "Fonte: ads + ad_metric_snapshots (D-1). Aceita campaign_id Meta ou name_like. " +
      "total_anuncios e a lista IGNORAM DELETED/ARCHIVED — esses objetos sairam da memoria operacional. " +
      "CAMPAIGN_PAUSED/ADSET_PAUSED/PAUSED continuam: o anuncio EXISTE, nao entrega. " +
      "Conjunto ACTIVE com anuncios=0 nao tem peca operacional (nao some DELETED). " +
      "Se restantes>0, chame de novo com pagina+1 — os anúncios omitidos EXISTEM. " +
      "Alcance na série é soma diária (não pessoas únicas). " +
      "Engajamento de post (POST_ENGAGEMENT) não vive neste espelho; use cliques_todos/impressões/alcance aqui e, se precisar do evento de otimização ao vivo, ler_pipeboard insights. " +
      "Dia sem linha = coleta ainda não chegou, não é entrega zero.",
  };
}

// A definicao desta ferramenta (nome, descricao e schema) mora em public.agent_ferramentas,
// com snapshot local em _shared/ferramentas_base.ts. Mantida aqui, seria a segunda copia da
// mesma verdade — e foi divergindo da versao do traffic-agent-job ate 03/09/2026.

