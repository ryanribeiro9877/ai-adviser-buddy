// supabase/functions/meta-token-crosscheck/index.ts (v1)
// Validacao funcional: META_ADS_TOKEN / WHATSAPP_ACCESS_TOKEN (Edge Secrets) x dados Pipeboard no DB.
// NAO expoe valor de token. NAO escreve na Meta. So GETs + leitura SQL.
//
// Body opcional:
//   { company_id?: uuid }  default COHAPM
// Auth: x-mcp-key

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { chaveMcpDe, mcpKeyValida } from "../_shared/mcp_auth.ts";
import {
  tokenAdsPorCompanyId,
  tokenWabaPorCompanyId,
} from "../_shared/meta_company_tokens.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const T_ADS_GLOBAL = (Deno.env.get("META_ADS_TOKEN") ?? "").trim();
const GRAPH = "https://graph.facebook.com/v21.0";
const VERSAO = "meta-token-crosscheck-v4";

const COHAPM = "57f755b9-c23d-4f58-a488-8173d697c010";
const LEGAL = "ded20b38-f42e-4c71-800c-31b97ea48bcf";
const ACT_LEGAL = "act_3302001729967572";
const ACT_COHAPM = "act_1622612945584817";
/** BM Cohapm (Graph) — mesmo id visto em act_….business */
const BM_COHAPM = "870473609113498";
/** ID exibido no BM UI do SU gestor-trafego (print 2026-08-21) — comparar com /me do token */
const SU_UI_ID_GESTOR_TRAFEGO = "61593603570922";

const ESCOPOS_ADS = ["ads_management", "ads_read", "business_management"];
const ESCOPOS_WABA = ["whatsapp_business_management", "whatsapp_business_messaging", "business_management"];

const supa = createClient(SUPABASE_URL, SERVICE_ROLE, { auth: { persistSession: false } });

function redact(s: string, ...tokens: string[]): string {
  let o = s;
  for (const t of tokens) if (t) o = o.split(t).join("[TOKEN-REDACTED]");
  return o.replace(/access_token=[A-Za-z0-9_\-.]+/g, "access_token=[TOKEN-REDACTED]");
}
function json(obj: unknown, tokens: string[], status = 200) {
  return new Response(redact(JSON.stringify(obj), ...tokens), {
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

/**
 * Uma leitura de conta de anuncios pela Graph. O tipo e explicito porque os tres pontos de
 * chamada tem um ramo "token ausente" que NAO chama a Graph: enquanto esse ramo era um objeto
 * literal com 4 das 13 chaves, a uniao dos dois ramos nao tinha `acesso_campanhas`,
 * `acesso_recommendations` nem `http_conta`, e o veredito que le esses campos nao compilava.
 *
 * http_* nulo significa "nao houve request", nao "request com status 0".
 */
type LeituraConta = {
  act: string;
  acesso_conta: boolean;
  http_conta: number | null;
  erro_conta: string | null;
  conta: {
    id: string | null;
    name: string | null;
    account_status: unknown;
    currency: string | null;
    business: unknown;
  } | null;
  acesso_campanhas: boolean;
  http_campanhas: number | null;
  erro_campanhas: string | null;
  campanhas_graph: Array<{
    id: string;
    name: string | null;
    status: string | null;
    effective_status: string | null;
    objective: string | null;
  }>;
  acesso_recommendations: boolean;
  http_recommendations: number | null;
  erro_recommendations: string | null;
  recommendations_count: number;
};

/** Conta que nem chegou a ser consultada — sem token nao se pergunta nada a Graph. */
function contaNaoLida(act: string, motivo: string): LeituraConta {
  return {
    act,
    acesso_conta: false,
    http_conta: null,
    erro_conta: motivo,
    conta: null,
    acesso_campanhas: false,
    http_campanhas: null,
    erro_campanhas: motivo,
    campanhas_graph: [],
    acesso_recommendations: false,
    http_recommendations: null,
    erro_recommendations: motivo,
    recommendations_count: 0,
  };
}

async function lerConta(token: string, act: string): Promise<LeituraConta> {
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

async function detalharWabas(token: string, lista: any[]) {
  const detalhe: any[] = [];
  for (const w of lista.slice(0, 20)) {
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
            verified_name: p.verified_name ?? null,
            quality: p.quality_rating,
            tier: p.messaging_limit_tier,
            platform: p.platform_type,
            status: p.status,
          }))
        : [],
      phones_erro: ph.body?.error?.message ?? null,
    });
  }
  return detalhe;
}

async function wabaDoToken(token: string) {
  if (!token) return { presente: false, wabas: [], erro: "secret_ausente" };

  const me = await g("/me?fields=id,name", token);
  const meId = me.body?.id ? String(me.body.id) : null;
  const meNome = me.body?.name ?? null;

  const assigned = await g(
    `/me/assigned_whatsapp_business_accounts?fields=id,name&limit=50`,
    token,
  );
  const owned = await g(
    `/${BM_COHAPM}/owned_whatsapp_business_accounts?fields=id,name&limit=50`,
    token,
  );
  const client = await g(
    `/${BM_COHAPM}/client_whatsapp_business_accounts?fields=id,name&limit=50`,
    token,
  );
  const businesses = await g(`/me/businesses?fields=id,name&limit=50`, token);

  const assignedLista = Array.isArray(assigned.body?.data) ? assigned.body.data : [];
  const ownedLista = Array.isArray(owned.body?.data) ? owned.body.data : [];
  const clientLista = Array.isArray(client.body?.data) ? client.body.data : [];

  const byId = new Map<string, any>();
  for (const w of [...ownedLista, ...clientLista, ...assignedLista]) {
    byId.set(String(w.id), w);
  }
  const lista = Array.from(byId.values());
  const detalhe = await detalharWabas(token, lista);

  const idUiBateComToken = meId === SU_UI_ID_GESTOR_TRAFEGO;

  return {
    presente: true,
    diagnostico_system_user: {
      token_me_id: meId,
      token_me_nome: meNome,
      bm_ui_id_print_gestor_trafego: SU_UI_ID_GESTOR_TRAFEGO,
      ids_iguais: idUiBateComToken,
      alerta: idUiBateComToken
        ? null
        : "O ID do System User na tela do BM (61593603570922) NAO e o mesmo do token nas Edge Secrets (/me = 122097…). Voce pode estar atribuindo WABA a um SU e o app esta autenticando com outro (mesmo nome).",
    },
    discovery: {
      assigned: {
        http: assigned.status,
        erro: assigned.body?.error?.message ?? null,
        count: assignedLista.length,
        nomes: assignedLista.map((w: any) => w.name),
      },
      bm_owned: {
        business_id: BM_COHAPM,
        http: owned.status,
        erro: owned.body?.error?.message ?? null,
        count: ownedLista.length,
        nomes: ownedLista.map((w: any) => w.name),
      },
      bm_client: {
        business_id: BM_COHAPM,
        http: client.status,
        erro: client.body?.error?.message ?? null,
        count: clientLista.length,
        nomes: clientLista.map((w: any) => w.name),
      },
      me_businesses: {
        http: businesses.status,
        erro: businesses.body?.error?.message ?? null,
        count: Array.isArray(businesses.body?.data) ? businesses.body.data.length : 0,
        lista: Array.isArray(businesses.body?.data)
          ? businesses.body.data.map((b: any) => ({ id: b.id, name: b.name }))
          : [],
      },
    },
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
  if (req.method !== "POST") return json({ error: "POST only" }, [], 405);
  const auth = await mcpKeyValida(supa, chaveMcpDe(req, "header-or-bearer"));
  if (!auth.ok) return json({ error: "unauthorized", motivo: auth.motivo }, [], 401);

  let body: any = {};
  try {
    body = await req.json();
  } catch {
    /* */
  }
  const companyId = String(body?.company_id ?? COHAPM);
  const { data: emp } = await supa.from("companies").select("id,name").eq("id", companyId).maybeSingle();
  const adsTok = tokenAdsPorCompanyId(companyId);
  const wabaTok = tokenWabaPorCompanyId(companyId);
  const T_ADS_EMP = adsTok?.token ?? "";
  const T_WABA_EMP = wabaTok?.token ?? "";
  const adsRef = adsTok?.ref ?? (companyId === LEGAL ? "META_ADS_TOKEN" : "META_ADS_TOKEN_COHAPM");
  const wabaRef = wabaTok?.ref ?? (companyId === LEGAL ? "WHATSAPP_ACCESS_TOKEN" : "WHATSAPP_ACCESS_TOKEN_COHAPM");
  const tokensRedact = [T_ADS_GLOBAL, T_ADS_EMP, T_WABA_EMP].filter(Boolean);
  const adsMeta = await inspecionarToken("ads", T_ADS_EMP, adsRef);
  const wabaMeta = await inspecionarToken("waba", T_WABA_EMP, wabaRef);

  const graphCohapm = T_ADS_EMP
    ? await lerConta(T_ADS_EMP, ACT_COHAPM)
    : contaNaoLida(ACT_COHAPM, `${adsRef} ausente`);
  // Controle: o token DA EMPRESA enxerga a Legal? (esperado: nao, se for token isolado COHAPM)
  const graphLegalComTokenEmp = T_ADS_EMP
    ? await lerConta(T_ADS_EMP, ACT_LEGAL)
    : contaNaoLida(ACT_LEGAL, "ausente");
  // Controle: o token GLOBAL ainda enxerga a Legal?
  const graphLegalGlobal = T_ADS_GLOBAL
    ? await lerConta(T_ADS_GLOBAL, ACT_LEGAL)
    : contaNaoLida(ACT_LEGAL, "META_ADS_TOKEN ausente");

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
  const waba = await wabaDoToken(T_WABA_EMP);

  const utilitarioAds =
    adsMeta.valido &&
    graphCohapm.acesso_conta === true &&
    graphCohapm.acesso_campanhas === true &&
    (cruz.em_ambos ?? 0) > 0;

  const utilitarioRecs = graphCohapm.acesso_recommendations === true;
  const utilitarioWabaCloud =
    (waba.total_wabas ?? 0) > 0 &&
    (waba.wabas ?? []).some((w: any) =>
      (w.phones ?? []).some((p: any) => p.platform === "CLOUD_API" || p.quality)
    );

  const metaDbTemCohapm = (dbTokens ?? []).some((t) => t.company_id === companyId);
  const usouSecretEmpresa =
    companyId === COHAPM ? adsRef === "META_ADS_TOKEN_COHAPM" : adsRef === "META_ADS_TOKEN";

  return json(
    {
      ok: true,
      versao: VERSAO,
      empresa: emp ?? { id: companyId, name: null },
      secrets_resolvidos: {
        ads_ref: adsRef,
        waba_ref: wabaRef,
        ads_presente: !!T_ADS_EMP,
        waba_presente: !!T_WABA_EMP,
        usou_secret_por_empresa: usouSecretEmpresa,
      },
      veredito: {
        token_ads_funcional_na_cohapm: utilitarioAds,
        recommendations_legiveis: utilitarioRecs,
        waba_cloud_visivel_no_token: utilitarioWabaCloud,
        meta_tokens_tem_linha_cohapm: metaDbTemCohapm,
        legal_acessivel_pelo_token_da_empresa: graphLegalComTokenEmp.acesso_conta === true,
        legal_acessivel_pelo_token_global: graphLegalGlobal.acesso_conta === true,
        resumo: !T_ADS_EMP
          ? `${adsRef} ausente nos Edge Secrets — nada a validar. (Cadastrou META_ADS_TOKEN_COHAPM? Redeploy da edge le secrets novos.)`
          : !adsMeta.valido
            ? `Token Ads (${adsRef}) presente mas debug_token diz invalido.`
            : !graphCohapm.acesso_conta
              ? `Token Ads (${adsRef}) NAO acessa a conta COHAPM (${ACT_COHAPM}): ${graphCohapm.erro_conta ?? "sem detalhe"}`
              : utilitarioAds
                ? `Token Ads (${adsRef}) acessa COHAPM e as campanhas batem com o Pipeboard — utilitario para Graph.`
                : `Token (${adsRef}) acessa a conta, mas intersecao com Pipeboard e fraca.`,
      },
      tokens_edge: { ads: adsMeta, waba: wabaMeta },
      meta_tokens_banco: dbTokens ?? [],
      integrations_cohapm: integ ?? [],
      graph: {
        cohapm: graphCohapm,
        legal_via_token_empresa: {
          acesso_conta: graphLegalComTokenEmp.acesso_conta,
          http_conta: graphLegalComTokenEmp.http_conta,
          erro_conta: graphLegalComTokenEmp.erro_conta,
          campanhas: (graphLegalComTokenEmp.campanhas_graph ?? []).length,
        },
        legal_via_token_global: {
          acesso_conta: graphLegalGlobal.acesso_conta,
          http_conta: graphLegalGlobal.http_conta,
          erro_conta: graphLegalGlobal.erro_conta,
          campanhas: (graphLegalGlobal.campanhas_graph ?? []).length,
        },
      },
      cruzamento_pipeboard: cruz,
      waba_assigned: waba,
      nota:
        "v4: COHAPM le so META_ADS_TOKEN_COHAPM e WHATSAPP_ACCESS_TOKEN_COHAPM (sem alias, sem fallback para o token da Legal). Edge Secrets nao sao a tabela integration_secrets.",
    },
    tokensRedact,
  );
});
