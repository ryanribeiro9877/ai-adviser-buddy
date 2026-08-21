// supabase/functions/meta-token-crosscheck/index.ts (v1)
// Validacao funcional: META_ADS_TOKEN / WHATSAPP_ACCESS_TOKEN (Edge Secrets) x dados Pipeboard no DB.
// NAO expoe valor de token. NAO escreve na Meta. So GETs + leitura SQL.
//
// Body opcional:
//   { company_id?: uuid }  default COHAPM
// Auth: x-mcp-key

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { chaveMcpDe, mcpKeyValida } from "../_shared/mcp_auth.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const T_ADS = (Deno.env.get("META_ADS_TOKEN") ?? "").trim();
const T_WABA = (Deno.env.get("WHATSAPP_ACCESS_TOKEN") ?? "").trim();
const GRAPH = "https://graph.facebook.com/v21.0";
const VERSAO = "meta-token-crosscheck-v1";

const COHAPM = "57f755b9-c23d-4f58-a488-8173d697c010";
const LEGAL = "ded20b38-f42e-4c71-800c-31b97ea48bcf";
const ACT_LEGAL = "act_3302001729967572";
const ACT_COHAPM = "act_1622612945584817";

const ESCOPOS_ADS = ["ads_management", "ads_read", "business_management"];
const ESCOPOS_WABA = ["whatsapp_business_management", "whatsapp_business_messaging", "business_management"];

const supa = createClient(SUPABASE_URL, SERVICE_ROLE, { auth: { persistSession: false } });

function redact(s: string): string {
  let o = s;
  for (const t of [T_ADS, T_WABA]) if (t) o = o.split(t).join("[TOKEN-REDACTED]");
  return o.replace(/access_token=[A-Za-z0-9_\-.]+/g, "access_token=[TOKEN-REDACTED]");
}
function json(obj: unknown, status = 200) {
  return new Response(redact(JSON.stringify(obj)), {
    status,
    headers: { "content-type": "application/json" },
  });
}

async function g(path: string, token: string) {
  const sep = path.includes("?") ? "&" : "?";
  const r = await fetch(`${GRAPH}${path}${sep}access_token=${encodeURIComponent(token)}`);
  const t = await r.text();
  let body: any = null;
  try {
    body = JSON.parse(t);
  } catch {
    body = { raw: t.slice(0, 240) };
  }
  return { ok: r.ok, status: r.status, body };
}

function escoposDe(dd: any): string[] {
  return Array.from(
    new Set([
      ...(Array.isArray(dd?.scopes) ? dd.scopes.map(String) : []),
      ...(Array.isArray(dd?.granular_scopes)
        ? dd.granular_scopes.map((s: any) => String(s?.scope ?? "")).filter(Boolean)
        : []),
    ]),
  );
}

async function inspecionarToken(papel: "ads" | "waba", token: string, tokenRef: string) {
  if (!token) {
    return {
      token_ref: tokenRef,
      papel,
      presente: false,
      valido: false,
      app_id: null,
      app_nome: null,
      tipo: null,
      subject: null,
      scopes: [] as string[],
      faltando: papel === "ads" ? ESCOPOS_ADS : ESCOPOS_WABA,
      erro: "secret_ausente",
    };
  }
  const quem = await g("/me?fields=id,name", token);
  const debug = await g(`/debug_token?input_token=${encodeURIComponent(token)}`, token);
  const dd = debug.body?.data ?? {};
  const scopes = escoposDe(dd);
  const esperados = papel === "ads" ? ESCOPOS_ADS : ESCOPOS_WABA;
  return {
    token_ref: tokenRef,
    papel,
    presente: true,
    valido: dd?.is_valid === true,
    app_id: dd?.app_id ? String(dd.app_id) : null,
    app_nome: dd?.application ?? null,
    tipo: dd?.type ?? null,
    subject: quem.ok
      ? { id: quem.body?.id ?? null, nome: quem.body?.name ?? null }
      : { erro: quem.body?.error?.message ?? `http_${quem.status}` },
    scopes,
    faltando: esperados.filter((e) => !scopes.includes(e)),
    expires_at: Number(dd?.expires_at ?? 0) > 0 ? Number(dd.expires_at) : null,
    data_access_expires_at:
      Number(dd?.data_access_expires_at ?? 0) > 0 ? Number(dd.data_access_expires_at) : null,
    debug_http: debug.status,
    me_http: quem.status,
  };
}

async function lerConta(token: string, act: string) {
  const conta = await g(
    `/${act}?fields=id,name,account_id,account_status,currency,amount_spent,balance,business{id,name},disable_reason`,
    token,
  );
  const camps = await g(
    `/${act}/campaigns?fields=id,name,status,effective_status,objective,daily_budget&limit=100`,
    token,
  );
  const recs = await g(`/${act}/recommendations?limit=25`, token);
  const erroConta = conta.body?.error?.message ?? null;
  const erroCamps = camps.body?.error?.message ?? null;
  const erroRecs = recs.body?.error?.message ?? null;
  const lista = Array.isArray(camps.body?.data) ? camps.body.data : [];
  return {
    act,
    acesso_conta: conta.ok,
    http_conta: conta.status,
    erro_conta: erroConta,
    conta: conta.ok
      ? {
          id: conta.body?.id ?? null,
          name: conta.body?.name ?? null,
          account_status: conta.body?.account_status ?? null,
          currency: conta.body?.currency ?? null,
          business: conta.body?.business ?? null,
        }
      : null,
    acesso_campanhas: camps.ok,
    http_campanhas: camps.status,
    erro_campanhas: erroCamps,
    campanhas_graph: lista.map((c: any) => ({
      id: String(c.id),
      name: c.name ?? null,
      status: c.status ?? null,
      effective_status: c.effective_status ?? null,
      objective: c.objective ?? null,
    })),
    acesso_recommendations: recs.ok,
    http_recommendations: recs.status,
    erro_recommendations: erroRecs,
    recommendations_count: Array.isArray(recs.body?.data) ? recs.body.data.length : 0,
  };
}

async function wabaDoToken(token: string) {
  if (!token) return { presente: false, wabas: [], erro: "secret_ausente" };
  const assigned = await g(
    `/me/assigned_whatsapp_business_accounts?fields=id,name&limit=50`,
    token,
  );
  const lista = Array.isArray(assigned.body?.data) ? assigned.body.data : [];
  const detalhe: any[] = [];
  for (const w of lista.slice(0, 15)) {
    const ph = await g(
      `/${w.id}/phone_numbers?fields=id,display_phone_number,verified_name,status,quality_rating,messaging_limit_tier,platform_type&limit=20`,
      token,
    );
    detalhe.push({
      waba_id: String(w.id),
      name: w.name ?? null,
      phones_ok: ph.ok,
      phones: ph.ok
        ? (ph.body?.data ?? []).map((p: any) => ({
            id: p.id,
            display: p.display_phone_number,
            quality: p.quality_rating,
            tier: p.messaging_limit_tier,
            platform: p.platform_type,
            status: p.status,
          }))
        : [],
      phones_erro: ph.body?.error?.message ?? null,
    });
  }
  return {
    presente: true,
    http: assigned.status,
    erro: assigned.body?.error?.message ?? null,
    wabas: detalhe,
    total_wabas: lista.length,
  };
}

function cruzar(graphCamps: { id: string; name: string | null; status: string | null }[], dbCamps: any[]) {
  const gIds = new Set(graphCamps.map((c) => c.id));
  const dIds = new Set(dbCamps.map((c) => String(c.external_id)));
  const soGraph = graphCamps.filter((c) => !dIds.has(c.id));
  const soDb = dbCamps.filter((c) => !gIds.has(String(c.external_id)));
  const ambos = graphCamps.filter((c) => dIds.has(c.id));
  const statusMatch = ambos.map((g) => {
    const d = dbCamps.find((x) => String(x.external_id) === g.id)!;
    const gs = String(g.status ?? "").toLowerCase();
    const ds = String(d.status ?? "").toLowerCase();
    return {
      id: g.id,
      name: g.name,
      status_graph: g.status,
      status_pipe: d.status,
      bate: gs === ds || (gs === "active" && ds === "active") || (gs === "paused" && ds === "paused"),
    };
  });
  return {
    graph_total: graphCamps.length,
    pipe_total: dbCamps.length,
    em_ambos: ambos.length,
    so_no_graph: soGraph.map((c) => ({ id: c.id, name: c.name })),
    so_no_pipeboard: soDb.map((c) => ({ id: c.external_id, name: c.name, status: c.status })),
    status_conferidos: statusMatch,
    taxa_intersecao:
      Math.max(graphCamps.length, dbCamps.length) === 0
        ? null
        : Number(
            (
              (ambos.length / Math.max(graphCamps.length, dbCamps.length, 1)) *
              100
            ).toFixed(1),
          ),
  };
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return json({ error: "POST only" }, 405);
  const auth = await mcpKeyValida(supa, chaveMcpDe(req, "header-or-bearer"));
  if (!auth.ok) return json({ error: "unauthorized", motivo: auth.motivo }, 401);

  let body: any = {};
  try {
    body = await req.json();
  } catch {
    /* */
  }
  const companyId = String(body?.company_id ?? COHAPM);

  const { data: emp } = await supa.from("companies").select("id,name").eq("id", companyId).maybeSingle();
  const adsMeta = await inspecionarToken("ads", T_ADS, "META_ADS_TOKEN");
  const wabaMeta = await inspecionarToken("waba", T_WABA, "WHATSAPP_ACCESS_TOKEN");

  const graphCohapm = T_ADS
    ? await lerConta(T_ADS, ACT_COHAPM)
    : { act: ACT_COHAPM, acesso_conta: false, erro_conta: "META_ADS_TOKEN ausente", campanhas_graph: [] as any[] };
  const graphLegal = T_ADS
    ? await lerConta(T_ADS, ACT_LEGAL)
    : { act: ACT_LEGAL, acesso_conta: false, erro_conta: "META_ADS_TOKEN ausente", campanhas_graph: [] as any[] };

  const { data: dbCamps } = await supa
    .from("campaigns")
    .select("external_id,name,status,objective,fonte_config,config_coletada_em")
    .eq("company_id", companyId)
    .order("name");

  const { data: dbTokens } = await supa
    .from("meta_tokens")
    .select("token_ref,papel,company_id,app_id,is_valid,subject_nome,verificado_em,scopes")
    .or(`company_id.eq.${companyId},company_id.eq.${LEGAL}`);

  const { data: integ } = await supa
    .from("integrations")
    .select("account_name,external_id,status,estado_operacional")
    .eq("company_id", companyId)
    .eq("provider", "meta_ads");

  const cruz = cruzar(graphCohapm.campanhas_graph ?? [], dbCamps ?? []);
  const waba = await wabaDoToken(T_WABA);

  const utilitarioAds =
    adsMeta.valido &&
    graphCohapm.acesso_conta === true &&
    graphCohapm.acesso_campanhas === true &&
    (cruz.em_ambos ?? 0) > 0;

  const utilitarioRecs = graphCohapm.acesso_recommendations === true;
  const utilitarioWabaCloud = (waba.total_wabas ?? 0) > 0 &&
    (waba.wabas ?? []).some((w: any) => (w.phones ?? []).some((p: any) => p.platform === "CLOUD_API" || p.quality));

  const metaDbTemCohapm = (dbTokens ?? []).some((t) => t.company_id === companyId);

  return json({
    ok: true,
    versao: VERSAO,
    empresa: emp ?? { id: companyId, name: null },
    veredito: {
      token_ads_funcional_na_cohapm: utilitarioAds,
      recommendations_legiveis: utilitarioRecs,
      waba_cloud_visivel_no_token: utilitarioWabaCloud,
      meta_tokens_tem_linha_cohapm: metaDbTemCohapm,
      legal_ainda_acessivel_pelo_mesmo_token: graphLegal.acesso_conta === true,
      resumo: !T_ADS
        ? "META_ADS_TOKEN ausente nos Edge Secrets — nada a validar."
        : !adsMeta.valido
          ? "Token Ads presente mas debug_token diz invalido."
          : !graphCohapm.acesso_conta
            ? `Token Ads NAO acessa a conta COHAPM (${ACT_COHAPM}): ${graphCohapm.erro_conta ?? "sem detalhe"}`
            : utilitarioAds
              ? "Token Ads acessa COHAPM e as campanhas batem com o Pipeboard — utilitario para Graph (dicas/BM/reconcile)."
              : "Token acessa a conta, mas intersecao com Pipeboard e fraca — revisar sync ou escopo da conta.",
    },
    tokens_edge: { ads: adsMeta, waba: wabaMeta },
    meta_tokens_banco: dbTokens ?? [],
    integrations_cohapm: integ ?? [],
    graph: {
      cohapm: graphCohapm,
      legal: {
        acesso_conta: graphLegal.acesso_conta,
        http_conta: graphLegal.http_conta,
        erro_conta: graphLegal.erro_conta,
        conta: graphLegal.conta,
        campanhas: (graphLegal.campanhas_graph ?? []).length,
        recommendations_count: graphLegal.recommendations_count,
      },
    },
    cruzamento_pipeboard: cruz,
    waba_assigned: waba,
    nota:
      "meta_tokens no banco e METADADO populado pelo meta-token-monitor (hoje hardcoded na Legal). Este crosscheck usa os Edge Secrets globais META_ADS_TOKEN / WHATSAPP_ACCESS_TOKEN.",
  });
});
