// Seguidores de Instagram ATRIBUIDOS a anuncio (Ads Insights).
//
// POR QUE UMA TOOL DEDICADA. Em 10/09/2026 o gestor perguntou seguidores so das turbinagens.
// O Analista ja tinha ler_pipeboard, listou o catalogo e chamou os endpoints errados:
// get_insights com object_id = id numerico da conta (Graph: "nonexisting field insights")
// e get_instagram_account_insights (saldo do perfil, recusado sem instagram_manage_insights).
// get_insights do Pipeboard NAO aceita `fields`, entao nunca devolve instagram_profile_follow.
// Quem aceita `fields` e bulk_get_insights — o mesmo caminho do ranking de qualidade.
//
// O QUE ISTO MEDE. Campo oficial `instagram_profile_follow` (Ads Insights, dado desde
// 07/07/2025). Atribuicao da Meta na janela padrao da conta, no nivel campanha. NAO e o
// saldo liquido do @. NAO e incrementalidade. Funil/ranking desta casa nao coletam o campo.

import { casarCampanhas } from "./leitura_desempenho.ts";
import {
  assertAccountInCompany,
  callReadTool,
  companyMetaAccounts,
  normalizeAccountId,
} from "./pipeboard_read.ts";

export const CAMPOS_INSIGHT_FOLLOW = [
  "campaign_id",
  "campaign_name",
  "spend",
  "impressions",
  "reach",
  "instagram_profile_follow",
  "actions",
] as const;

export const ACTION_TYPE_FOLLOW = "instagram_profile_follow";

const ISO = /^\d{4}-\d{2}-\d{2}$/;
const MAX_CAMPANHAS = 40;

export type CampanhaFollow = {
  campaign_id: string;
  name: string | null;
  account_id: string | null;
  status: string | null;
  gasto_espelho: number;
};

export type LinhaFollow = {
  campaign_id: string;
  campaign_name: string | null;
  spend: number;
  impressions: number;
  reach: number;
  seguidores: number | null;
  fonte_do_follow: "campo" | "actions" | null;
};

export type ArgsSeguidoresAds = {
  // deno-lint-ignore no-explicit-any
  supa: { from: (t: string) => any };
  companyId: string;
  token: string;
  dateFrom: string;
  dateTo: string;
  nameLike?: string;
  campaignId?: string;
};

export function dataIsoValida(value: unknown): string | null {
  const t = String(value ?? "").trim().slice(0, 10);
  return ISO.test(t) ? t : null;
}

export function achatarLinhaInsight(row: unknown): Record<string, unknown> {
  if (!row || typeof row !== "object" || Array.isArray(row)) return {};
  const r = row as Record<string, unknown>;
  const metrics = r.metrics && typeof r.metrics === "object" && !Array.isArray(r.metrics)
    ? r.metrics as Record<string, unknown>
    : {};
  return { ...r, ...metrics };
}

export function coletarLinhasInsight(value: unknown, depth = 0): Record<string, unknown>[] {
  if (depth > 6 || value == null) return [];
  if (typeof value === "string") {
    try {
      return coletarLinhasInsight(JSON.parse(value), depth + 1);
    } catch {
      return [];
    }
  }
  if (Array.isArray(value)) {
    const objs = value.filter((x) => x && typeof x === "object") as Record<string, unknown>[];
    if (
      objs.some((item) => {
        const r = achatarLinhaInsight(item);
        return r.campaign_id || r.ad_id || r.campaign_name;
      })
    ) {
      return objs.map((x) => achatarLinhaInsight(x));
    }
    return value.flatMap((item) => coletarLinhasInsight(item, depth + 1));
  }
  if (typeof value !== "object") return [];
  const obj = value as Record<string, unknown>;
  for (const key of [
    "data",
    "insights",
    "rows",
    "results",
    "items",
    "result",
    "segmented_metrics",
    "campaigns",
    "metrics",
  ]) {
    if (obj[key] != null) {
      const found = coletarLinhasInsight(obj[key], depth + 1);
      if (found.length) return found;
    }
  }
  const flat = achatarLinhaInsight(obj);
  return flat.campaign_id || flat.ad_id ? [flat] : [];
}

export function followDaLinha(row: Record<string, unknown>): {
  valor: number | null;
  fonte: "campo" | "actions" | null;
  campo_presente: boolean;
} {
  const campoPresente = Object.prototype.hasOwnProperty.call(row, "instagram_profile_follow");
  if (campoPresente) {
    const n = Number(row.instagram_profile_follow);
    return {
      valor: Number.isFinite(n) ? n : 0,
      fonte: "campo",
      campo_presente: true,
    };
  }
  const actions = Array.isArray(row.actions) ? row.actions : [];
  for (const raw of actions) {
    if (!raw || typeof raw !== "object") continue;
    const a = raw as Record<string, unknown>;
    const tipo = String(a.action_type ?? a.type ?? "");
    if (tipo === ACTION_TYPE_FOLLOW) {
      const n = Number(a.value ?? 0);
      return {
        valor: Number.isFinite(n) ? n : 0,
        fonte: "actions",
        campo_presente: false,
      };
    }
  }
  return { valor: null, fonte: null, campo_presente: false };
}

export function numeroDe(row: Record<string, unknown>, chave: string): number {
  const n = Number(row[chave] ?? 0);
  return Number.isFinite(n) ? n : 0;
}

function erroPipeboard(body: unknown): string | null {
  if (body == null) return null;
  if (typeof body === "string") {
    const t = body.trim();
    if (/failed|error|#\d+|invalid_token|unauthorized/i.test(t)) return t.slice(0, 400);
    return null;
  }
  if (typeof body !== "object") return null;
  const o = body as Record<string, unknown>;
  if (typeof o.texto === "string" && /failed|error|#\d+|invalid_token|unauthorized/i.test(o.texto)) {
    return String(o.texto).slice(0, 400);
  }
  if (o.error) return String((o.error as { message?: unknown })?.message ?? o.error).slice(0, 400);
  return null;
}

function erroFatalConector(erro: string | null): boolean {
  return !!erro && /invalid_token|unauthorized|401|PIPEBOARD_API_TOKEN/i.test(erro);
}

async function carregarCampanhas(
  opts: ArgsSeguidoresAds,
): Promise<{ ok: true; campanhas: CampanhaFollow[] } | { ok: false; erro: string; dica?: string }> {
  const needle = String(opts.nameLike ?? opts.campaignId ?? "").trim();
  if (!needle) {
    return {
      ok: false,
      erro: "informe_name_like_ou_campaign_id",
      dica: "Para turbinagens, name_like='Post do Instagram'. Ou passe o campaign_id Meta.",
    };
  }
  const { data, error } = await opts.supa
    .from("campaigns")
    .select("external_id,name,external_account_id,status")
    .eq("company_id", opts.companyId);
  if (error) return { ok: false, erro: error.message };
  const todas = (data ?? []) as Array<{
    external_id?: string | null;
    name?: string | null;
    external_account_id?: string | null;
    status?: string | null;
  }>;
  const casadas = casarCampanhas(
    todas.map((c) => ({
      name: c.name,
      external_id: c.external_id,
    })),
    needle,
  );
  const ids = new Set(casadas.map((c) => String(c.external_id ?? "")).filter(Boolean));
  const escolhidas = todas.filter((c) => ids.has(String(c.external_id ?? "")));
  if (!escolhidas.length) {
    return { ok: false, erro: "nenhuma_campanha_casou", dica: `Nenhum nome/id casou com '${needle}'.` };
  }

  const { data: snaps } = await opts.supa
    .from("ad_metric_snapshots")
    .select("campaign_external_id,spend")
    .eq("company_id", opts.companyId)
    .gte("snapshot_date", opts.dateFrom)
    .lte("snapshot_date", opts.dateTo)
    .in(
      "campaign_external_id",
      escolhidas.map((c) => String(c.external_id)),
    );

  const gastoPor = new Map<string, number>();
  for (const s of snaps ?? []) {
    const id = String(s.campaign_external_id ?? "");
    gastoPor.set(id, (gastoPor.get(id) ?? 0) + Number(s.spend || 0));
  }

  const campanhas: CampanhaFollow[] = escolhidas.map((c) => ({
    campaign_id: String(c.external_id ?? ""),
    name: c.name ?? null,
    account_id: c.external_account_id ? normalizeAccountId(c.external_account_id) : null,
    status: c.status ?? null,
    gasto_espelho: gastoPor.get(String(c.external_id ?? "")) ?? 0,
  })).filter((c) => c.campaign_id);

  campanhas.sort((a, b) => b.gasto_espelho - a.gasto_espelho);
  const vivas = campanhas.filter((c) =>
    c.gasto_espelho > 0 || String(c.status ?? "").toUpperCase() !== "DELETED"
  );
  return { ok: true, campanhas: vivas.length ? vivas : campanhas };
}

const CAMPOS_SO_ACTIONS = [
  "campaign_id",
  "campaign_name",
  "spend",
  "impressions",
  "reach",
  "actions",
] as const;

async function insightsDaConta(
  token: string,
  accountId: string,
  dateFrom: string,
  dateTo: string,
  campaignIds: string[],
): Promise<{
  ok: boolean;
  linhas: Record<string, unknown>[];
  erro: string | null;
  ferramenta: string;
  tentativas: Array<{ ferramenta: string; erro: string | null; linhas: number }>;
}> {
  const tentativasArgs: Array<{ ferramenta: string; args: Record<string, unknown> }> = [
    {
      ferramenta: "bulk_get_insights",
      args: {
        account_ids: [accountId],
        level: "campaign",
        since: dateFrom,
        until: dateTo,
        compact: true,
        fields: [...CAMPOS_INSIGHT_FOLLOW],
        campaign_ids: campaignIds,
      },
    },
    {
      ferramenta: "bulk_get_insights",
      args: {
        account_ids: [accountId],
        level: "campaign",
        since: dateFrom,
        until: dateTo,
        compact: true,
        fields: [...CAMPOS_INSIGHT_FOLLOW],
      },
    },
    {
      ferramenta: "bulk_get_insights",
      args: {
        account_ids: [accountId],
        level: "campaign",
        since: dateFrom,
        until: dateTo,
        compact: true,
        fields: [...CAMPOS_SO_ACTIONS],
      },
    },
    {
      ferramenta: "get_insights",
      args: {
        account_id: `act_${accountId}`,
        level: "campaign",
        since: dateFrom,
        until: dateTo,
      },
    },
  ];

  const log: Array<{ ferramenta: string; erro: string | null; linhas: number }> = [];
  let ultimoErro: string | null = "sem_tentativa";
  let ultimaFerramenta = "bulk_get_insights";

  for (const t of tentativasArgs) {
    const r = await callReadTool(t.ferramenta, t.args, token);
    const embedded = erroPipeboard(r.body) ?? (r.ok ? null : (r.erro ?? "pipeboard_falhou"));
    if (embedded) {
      log.push({ ferramenta: t.ferramenta, erro: embedded, linhas: 0 });
      ultimoErro = embedded;
      ultimaFerramenta = t.ferramenta;
      if (erroFatalConector(embedded)) {
        return { ok: false, linhas: [], erro: embedded, ferramenta: t.ferramenta, tentativas: log };
      }
      continue;
    }
    const linhas = coletarLinhasInsight(r.body);
    log.push({ ferramenta: t.ferramenta, erro: null, linhas: linhas.length });
    if (!linhas.length) {
      ultimoErro = "resposta_sem_linhas";
      ultimaFerramenta = t.ferramenta;
      continue;
    }
    return { ok: true, linhas, erro: null, ferramenta: t.ferramenta, tentativas: log };
  }
  return { ok: false, linhas: [], erro: ultimoErro, ferramenta: ultimaFerramenta, tentativas: log };
}

export async function tSeguidoresInstagramAds(opts: ArgsSeguidoresAds): Promise<Record<string, unknown>> {
  const dateFrom = dataIsoValida(opts.dateFrom);
  const dateTo = dataIsoValida(opts.dateTo);
  if (!dateFrom || !dateTo) {
    return { erro: "date_from_e_date_to_obrigatorios", dica: "Use YYYY-MM-DD (ex. 2026-09-03 e 2026-09-09)." };
  }
  if (dateFrom > dateTo) return { erro: "date_from_maior_que_date_to" };
  if (!opts.token) {
    return {
      erro: "PIPEBOARD_API_TOKEN ausente",
      nota: "Sem conector nao leio instagram_profile_follow. Funil/ranking desta casa nao tem follow.",
    };
  }
  if (!opts.companyId) return { erro: "company_id_obrigatorio" };

  let allowed: string[] = [];
  try {
    allowed = await companyMetaAccounts(opts.supa, opts.companyId);
  } catch (error) {
    return { erro: String((error as Error).message ?? error) };
  }
  if (!allowed.length) return { erro: "empresa_sem_conta_meta_vinculada" };

  const loaded = await carregarCampanhas(opts);
  if (!loaded.ok) return loaded;

  const comGasto = loaded.campanhas.filter((c) => c.gasto_espelho > 0);
  const universo = (comGasto.length ? comGasto : loaded.campanhas).slice(0, MAX_CAMPANHAS);
  const truncado = (comGasto.length ? comGasto : loaded.campanhas).length > universo.length;

  const porConta = new Map<string, CampanhaFollow[]>();
  for (const c of universo) {
    const acc = c.account_id && allowed.includes(c.account_id) ? c.account_id : null;
    if (!acc) continue;
    const check = assertAccountInCompany(acc, allowed);
    if (!check.ok) continue;
    const lista = porConta.get(acc) ?? [];
    lista.push(c);
    porConta.set(acc, lista);
  }
  if (!porConta.size) {
    return {
      erro: "campanhas_fora_das_contas_vinculadas",
      campanhas_espelho: loaded.campanhas.length,
      contas_da_empresa: allowed,
    };
  }

  const porCampanha: LinhaFollow[] = [];
  const leituras: Array<{
    account_id: string;
    ferramenta: string;
    erro: string | null;
    linhas: number;
    tentativas: Array<{ ferramenta: string; erro: string | null; linhas: number }>;
  }> = [];
  let campoPresente = false;
  let falhaConector: string | null = null;

  for (const [accountId, camps] of porConta) {
    const ids = camps.map((c) => c.campaign_id);
    const leitura = await insightsDaConta(opts.token, accountId, dateFrom, dateTo, ids);
    leituras.push({
      account_id: accountId,
      ferramenta: leitura.ferramenta,
      erro: leitura.erro,
      linhas: leitura.linhas.length,
      tentativas: leitura.tentativas,
    });
    if (leitura.erro && !leitura.linhas.length) {
      falhaConector = leitura.erro;
    }
    const queridas = new Set(ids);
    for (const raw of leitura.linhas) {
      const id = String(raw.campaign_id ?? "").trim();
      if (id && !queridas.has(id)) continue;
      const f = followDaLinha(raw);
      if (f.campo_presente) campoPresente = true;
      porCampanha.push({
        campaign_id: id || String(raw.campaign_name ?? ""),
        campaign_name: raw.campaign_name != null ? String(raw.campaign_name) : null,
        spend: numeroDe(raw, "spend"),
        impressions: numeroDe(raw, "impressions"),
        reach: numeroDe(raw, "reach"),
        seguidores: f.valor,
        fonte_do_follow: f.fonte,
      });
    }
  }

  const mapaNome = new Map(universo.map((c) => [c.campaign_id, c]));
  for (const linha of porCampanha) {
    const esp = mapaNome.get(linha.campaign_id);
    if (esp && !linha.campaign_name) linha.campaign_name = esp.name;
  }

  const comNumero = porCampanha.filter((l) => l.seguidores != null);
  const totalSeguidores = comNumero.length
    ? comNumero.reduce((a, l) => a + Number(l.seguidores ?? 0), 0)
    : null;
  const contasDoUniverso = new Set(universo.map((c) => c.account_id).filter(Boolean));
  const gastoLive = porCampanha.reduce((a, l) => a + l.spend, 0);
  const disponivel = totalSeguidores != null;
  if (falhaConector && !porCampanha.length) {
    return {
      ok: false,
      erro: "pipeboard_nao_devolveu_insights",
      detalhe: falhaConector,
      janela: { date_from: dateFrom, date_to: dateTo },
      recorte: {
        name_like: opts.nameLike ?? null,
        campaign_id: opts.campaignId ?? null,
        campanhas_no_espelho: loaded.campanhas.length,
        campanhas_com_gasto: universo.length,
        truncado,
      },
      campo: ACTION_TYPE_FOLLOW,
      leituras,
      nota: "Falha do conector, nao ausencia do campo. Nao invente follow a partir de CTR. Tente de novo; se persistir, o token Pipeboard precisa ser valido.",
    };
  }

  return {
    ok: true,
    source: "pipeboard:meta",
    janela: { date_from: dateFrom, date_to: dateTo },
    recorte: {
      name_like: opts.nameLike ?? null,
      campaign_id: opts.campaignId ?? null,
      campanhas_no_espelho: loaded.campanhas.length,
      campanhas_lidas_ao_vivo: porCampanha.length,
      truncado,
    },
    o_que_e:
      "Follows de Instagram ATRIBUIDOS pela Meta a estes anuncios (instagram_profile_follow). Janela padrao da conta. Dado desde 07/07/2025.",
    o_que_nao_e: [
      "Saldo liquido do perfil (orgânico + Explore + outros posts + pago).",
      "Incrementalidade (o que teria acontecido sem o anuncio).",
      "Clique no perfil / CTR como proxy de follow.",
    ],
    campo: ACTION_TYPE_FOLLOW,
    campo_presente_na_resposta: campoPresente,
    disponivel,
    seguidores_atribuidos: totalSeguidores,
    gasto_live: Math.round(gastoLive * 100) / 100,
    custo_por_seguidor: disponivel && totalSeguidores! > 0
      ? Math.round((gastoLive / totalSeguidores!) * 100) / 100
      : null,
    por_campanha: porCampanha,
    sem_entrega_na_janela: loaded.campanhas
      .filter((c) => c.gasto_espelho <= 0 && contasDoUniverso.has(c.account_id))
      .map((c) => ({ campaign_id: c.campaign_id, name: c.name, status: c.status })),
    leituras,
    nota: disponivel
      ? "Numero da Meta por campanha. Nao some com o insight do perfil. Funil desta casa (clique/formulario/conversa) continua sem follow."
      : "A Meta/Pipeboard nao devolveu instagram_profile_follow nesta leitura. Nao invente follow a partir de CTR. get_insights no objeto da conta falha; o caminho certo e bulk_get_insights com fields. Insight do perfil (get_instagram_account_insights) mistura orgânico e exige reconectar o Pipeboard com instagram_manage_insights.",
  };
}
