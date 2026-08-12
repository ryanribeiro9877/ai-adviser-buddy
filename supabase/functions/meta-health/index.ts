// supabase/functions/meta-health/index.ts (v3) — F4.1 + sonda de pendencias Pipeboard
// Diagnóstico do token Meta disponível no ambiente: escopos, acesso à ad account da
// Legal é Viver (act_3302001729967572) e leitura de campanha. NÃO escreve nada no modo
// diagnóstico padrão.
// Token: META_ADS_TOKEN somente (ESP-32 — sem fallback WhatsApp).
// Auth: x-mcp-key / Bearer <mcp_config.api_key>.
//
// v2 (07/08/2026) — DIAGNOSTICO DO OAuthException 100 / subcode 1885183.
//   A primeira criacao real de anuncio (07/08) morreu no POST de /adcreatives com
//   "O post do criativo dos anuncios foi criado por um app que esta em modo de desenvolvimento".
//   O v1 nao respondia as perguntas que decidem o que fazer: QUAL app assina o token, QUAIS
//   escopos ele tem de fato, e QUAL papel o System User tem na conta. Esta versao responde as
//   tres com evidencia da propria Graph, e mede o caminho Pipeboard como rota alternativa.
//
//   POR QUE debug_token e nao /me/permissions: token de System User NAO devolve linhas em
//   /me/permissions (aquele edge e de usuario humano). O que vale para System User e
//   granular_scopes/scopes do debug_token, que tambem entrega o app_id - o dado central aqui.
//
//   ESTA FUNCAO CONTINUA SEM ESCREVER NADA. O ensaio do Pipeboard usa o dry_run NATIVO do
//   conector, que existe so em create_campaign/update_campaign, e nunca preenche access_token.
//
// v3 (07/08/2026) — SONDA DAS PENDENCIAS DA PRIMEIRA ESCRITA REAL VIA PIPEBOARD.
//   modo=sonda_pendencias_pipeboard: so GETs (reconciliacao do anuncio de prova, creatives
//   orfaos, is_dynamic_creative dos conjuntos da conta). Opcionalmente limpar_orfaos=true tenta
//   DELETE Graph e, se bloquear, Pipeboard — SOMENTE nos dois ids orfaos conhecidos. Resultado
//   tambem vai para audit_log (meta_health_sonda) para leitura via SQL sem expor token.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { chaveMcpDe, mcpKeyValida } from "../_shared/mcp_auth.ts";
import { monitorConexaoPipeboard, pipeboardCall, pipeboardToken } from "../_shared/pipeboard.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const TOKEN = (Deno.env.get("META_ADS_TOKEN") ?? "").trim();
const TOKEN_FONTE = "META_ADS_TOKEN";
const AD_ACCOUNT = "act_3302001729967572";
const GRAPH = "https://graph.facebook.com/v21.0";
const COMPANY_ID = "ded20b38-f42e-4c71-800c-31b97ea48bcf";

// Escopos que a criacao de anuncio exige. ads_management e o unico realmente inegociavel para
// escrever; ads_read serve leitura; business_management e o que permite ler papel na conta.
const ESCOPOS_NECESSARIOS = ["ads_management", "ads_read", "business_management"];

const ORFAOS_PERMITIDOS = new Set(["2635490320208656", "1023859480523471"]);
const AD_PROVA = "120254319507370191";
const CREATIVE_PROVA = "1401862435158611";
const ADSET_PROVA = "120254208284780191";
const ADSET_MOLDE_C7 = "120251373799340191";
const CANDIDATOS_72 = [
  "120253805954390191",
  "120252394635960191",
  "120253897605020191",
  "120253542040290191",
];

const supa = createClient(SUPABASE_URL, SERVICE_ROLE, { auth: { persistSession: false } });
const CORS = {
  "access-control-allow-origin": "*",
  "access-control-allow-headers": "authorization, content-type, x-mcp-key",
  "access-control-allow-methods": "POST, OPTIONS",
};
function json(obj: unknown, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { "content-type": "application/json", ...CORS },
  });
}

// O token vai na query porque a Graph aceita assim e esta funcao roda server-side. O valor NUNCA
// entra na resposta: so ids, nomes e escopos.
async function g(path: string, method = "GET") {
  const sep = path.includes("?") ? "&" : "?";
  const url = `${GRAPH}${path}${sep}access_token=${encodeURIComponent(TOKEN)}`;
  const r = await fetch(url, method === "GET" ? undefined : { method });
  const t = await r.text();
  try {
    return { status: r.status, body: JSON.parse(t) };
  } catch {
    return { status: r.status, body: t.slice(0, 300) };
  }
}

async function segredoIntegracao(nome: string): Promise<string> {
  const { data } = await supa.from("integration_secrets").select("value").eq("name", nome).maybeSingle();
  return String(data?.value ?? "");
}

async function adsDoCreative(creativeId: string) {
  const filtering = encodeURIComponent(
    JSON.stringify([{ field: "creative.id", operator: "EQUAL", value: creativeId }]),
  );
  return g(
    `/${AD_ACCOUNT}/ads?fields=id,name,status,adset_id,creative{id}&filtering=${filtering}&limit=25`,
  );
}

async function limparOrfao(creativeId: string, pbToken: string) {
  if (!ORFAOS_PERMITIDOS.has(creativeId)) {
    return { id: creativeId, ok: false, erro: "id_fora_da_lista_permitida" };
  }
  const graphDel = await g(`/${creativeId}`, "DELETE");
  if (graphDel.status === 200 && (graphDel.body as any)?.success === true) {
    return { id: creativeId, ok: true, via: "graph_delete", body: graphDel.body };
  }
  const tentativas: { tool: string; r: Awaited<ReturnType<typeof pipeboardCall>> }[] = [];
  for (const tool of ["delete_ad_creative", "delete_creative", "update_ad_creative"]) {
    const args: Record<string, unknown> =
      tool === "update_ad_creative"
        ? { account_id: AD_ACCOUNT, creative_id: creativeId, status: "DELETED" }
        : { account_id: AD_ACCOUNT, creative_id: creativeId };
    const r = await pipeboardCall(tool, args, pbToken);
    tentativas.push({ tool, r: { ok: r.ok, status: r.status, erro: r.erro, body: r.body } as any });
    if (r.ok) return { id: creativeId, ok: true, via: `pipeboard:${tool}`, body: r.body };
  }
  return {
    id: creativeId,
    ok: false,
    via: null,
    graph_delete: { status: graphDel.status, body: graphDel.body },
    pipeboard_tentativas: tentativas.map((t) => ({
      tool: t.tool,
      ok: t.r.ok,
      status: t.r.status,
      erro: t.r.erro,
      body: t.r.body,
    })),
    limpeza_manual_necessaria: true,
  };
}

async function sondaPendencias(limparOrfaos: boolean) {
  const ad = await g(
    `/${AD_PROVA}?fields=id,name,status,effective_status,adset_id,creative{id,name}`,
  );
  const creativeProva = await g(`/${CREATIVE_PROVA}?fields=id,name,status,object_type,account_id`);
  const adsetProva = await g(
    `/${ADSET_PROVA}?fields=id,name,status,is_dynamic_creative,daily_budget,campaign_id`,
  );
  const moldeC7 = await g(
    `/${ADSET_MOLDE_C7}?fields=id,name,status,is_dynamic_creative,daily_budget,campaign_id`,
  );

  const orfaos: Record<string, unknown> = {};
  for (const id of ORFAOS_PERMITIDOS) {
    const meta = await g(`/${id}?fields=id,name,status,object_type,account_id`);
    const ads = await adsDoCreative(id);
    orfaos[id] = {
      creative: meta,
      ads_associados: ads,
      sem_anuncio:
        ads.status === 200 && Array.isArray((ads.body as any)?.data) && (ads.body as any).data.length === 0,
    };
  }

  // Pagina todos os conjuntos da conta com is_dynamic_creative.
  const conjuntos: any[] = [];
  let next: string | null =
    `/${AD_ACCOUNT}/adsets?fields=id,name,status,effective_status,daily_budget,is_dynamic_creative,campaign_id&limit=100`;
  while (next) {
    const page = next.startsWith("http")
      ? await (async () => {
          const url = next!.includes("access_token=")
            ? next!
            : `${next}${next!.includes("?") ? "&" : "?"}access_token=${encodeURIComponent(TOKEN)}`;
          const r = await fetch(url);
          const t = await r.text();
          try {
            return { status: r.status, body: JSON.parse(t) };
          } catch {
            return { status: r.status, body: t.slice(0, 300) };
          }
        })()
      : await g(next);
    if (page.status !== 200) {
      conjuntos.push({ erro_pagina: page });
      break;
    }
    const data = Array.isArray((page.body as any)?.data) ? (page.body as any).data : [];
    conjuntos.push(...data);
    next = (page.body as any)?.paging?.next ?? null;
  }

  const candidatos72: Record<string, unknown> = {};
  for (const id of CANDIDATOS_72) {
    candidatos72[id] = await g(
      `/${id}?fields=id,name,status,effective_status,daily_budget,is_dynamic_creative,campaign_id`,
    );
  }

  let limpeza: unknown = null;
  if (limparOrfaos) {
    const pbToken = await pipeboardToken(segredoIntegracao);
    limpeza = {
      "2635490320208656": await limparOrfao("2635490320208656", pbToken),
      "1023859480523471": await limparOrfao("1023859480523471", pbToken),
    };
  }

  const resultado = {
    versao: "meta-health-v3-sonda",
    token_fonte: TOKEN_FONTE,
    reconciliacao: {
      ad_graph: ad,
      creative_graph: creativeProva,
      adset_destino_graph: adsetProva,
      esperado: {
        ad_id: AD_PROVA,
        status: "PAUSED",
        adset_id: ADSET_PROVA,
        creative_id: CREATIVE_PROVA,
      },
    },
    molde_c7_lal: moldeC7,
    orfaos,
    conjuntos_conta: conjuntos.map((c: any) => ({
      id: c.id,
      name: c.name,
      status: c.status,
      effective_status: c.effective_status,
      daily_budget: c.daily_budget,
      is_dynamic_creative: c.is_dynamic_creative,
      campaign_id: c.campaign_id,
      erro_pagina: c.erro_pagina,
    })),
    candidatos_72_dia: candidatos72,
    limpeza_orfaos: limpeza,
  };

  await supa.from("audit_log").insert({
    company_id: COMPANY_ID,
    action: "meta_health_sonda",
    target_type: "ad",
    target_id: AD_PROVA,
    details: resultado,
  });

  return resultado;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });
  const auth = await mcpKeyValida(supa, chaveMcpDe(req, "header-or-bearer"));
  if (!auth.ok) return json({ error: "unauthorized", motivo: auth.motivo }, 401);
  if (!TOKEN) return json({ error: "META_ADS_TOKEN ausente" }, 500);

  let body: any = {};
  try {
    body = await req.json();
  } catch {
    /* */
  }

  if (body?.modo === "sonda_pendencias_pipeboard") {
    const limpar = body?.limpar_orfaos === true;
    const sonda = await sondaPendencias(limpar);
    return json({
      ok: true,
      modo: "sonda_pendencias_pipeboard",
      limpar_orfaos: limpar,
      mcp_chamador: auth.chamador,
      sonda,
    });
  }

  const permissoes = await g("/me/permissions");
  const quem = await g("/me?fields=id,name");
  const conta = await g(`/${AD_ACCOUNT}?fields=name,account_status,currency,business,owner,funding_source_details`);
  // leitura de 1 campanha (a líder conhecida) — só GET
  const campanha = await g(`/120249671567740191?fields=name,status,daily_budget`);

  // ---------- v2: QUEM ASSINA O TOKEN ----------
  // input_token e access_token sao o MESMO token de proposito: e o que se tem sem app secret.
  const debug = await g(`/debug_token?input_token=${encodeURIComponent(TOKEN)}`);
  const dd: any = debug.body?.data ?? {};
  const appId: string | null = dd?.app_id ? String(dd.app_id) : null;

  // Escopos: em System User a verdade esta no debug_token, nao em /me/permissions.
  const scopesDebug: string[] = Array.isArray(dd?.scopes) ? dd.scopes.map(String) : [];
  const granular: string[] = Array.isArray(dd?.granular_scopes)
    ? dd.granular_scopes.map((s: any) => String(s?.scope ?? "")).filter(Boolean)
    : [];
  const permsEdge: string[] = Array.isArray(permissoes.body?.data)
    ? permissoes.body.data.filter((p: any) => p?.status === "granted").map((p: any) => String(p.permission))
    : [];
  const escoposPresentes = Array.from(new Set([...scopesDebug, ...granular, ...permsEdge]));
  const escoposAusentes = ESCOPOS_NECESSARIOS.filter((s) => !escoposPresentes.includes(s));

  // O app: nome e o que a Graph entrega sem app access token. NAO existe campo publico que
  // declare development vs live, entao isso NAO e afirmado aqui - fica como pergunta para o
  // painel, com o subcode como evidencia comportamental.
  const app = appId ? await g(`/${appId}?fields=id,name,link,category`) : null;

  // ---------- v2: PAPEL DO SYSTEM USER NA CONTA ----------
  const businessId: string | null = conta.body?.business?.id ? String(conta.body.business.id) : null;
  const atribuidos = businessId
    ? await g(`/${AD_ACCOUNT}/assigned_users?business=${encodeURIComponent(businessId)}&fields=id,name,tasks&limit=50`)
    : null;
  const meuId = quem.body?.id ? String(quem.body.id) : null;
  const minhaLinha = Array.isArray(atribuidos?.body?.data)
    ? atribuidos!.body.data.find((u: any) => String(u?.id) === meuId) ?? null
    : null;
  const minhasTasks: string[] = Array.isArray(minhaLinha?.tasks) ? minhaLinha.tasks.map(String) : [];

  // ---------- v2: ROTA PIPEBOARD ----------
  // Pergunta pratica: o conector escreve pela conexao DELE, com o app DELE. Se o bloqueio for do
  // nosso app, esta rota pode nao ter o problema. Aqui so se mede presenca, conexao e dry_run
  // NATIVO de campanha - o subcode 1885183 nasce em /adcreatives, e o dry_run nativo nao cobre
  // esse nivel. Isso e dito na resposta em vez de extrapolado.
  const pbToken = await pipeboardToken(segredoIntegracao);
  const pipeboard: Record<string, unknown> = { token_presente: !!pbToken };
  if (pbToken) {
    pipeboard.conexao = await monitorConexaoPipeboard(pbToken);
    const ensaio = await pipeboardCall(
      "create_campaign",
      {
        account_id: AD_ACCOUNT,
        name: "[GT-13 DRY-RUN NATIVO] sonda de rota - nao cria nada",
        objective: "OUTCOME_LEADS",
        status: "PAUSED",
        special_ad_categories: ["FINANCIAL_PRODUCTS_SERVICES"],
        buying_type: "AUCTION",
        dry_run: true,
      },
      pbToken,
    );
    pipeboard.dry_run_nativo_campanha = {
      ok: ensaio.ok,
      dry_run_confirmado: ensaio.dry_run === true,
      status: ensaio.status,
      erro: ensaio.erro ?? null,
      body: ensaio.body,
    };
    pipeboard.cobertura = {
      dry_run_nativo_existe_em: ["create_campaign", "update_campaign"],
      nao_cobre:
        "adcreatives/ads - e exatamente onde o subcode 1885183 aparece. Um dry_run de campanha OK nao prova que a rota Pipeboard cria adcreative; so prova que o transporte e a conexao respondem.",
    };
  }

  return json({
    versao: "meta-health-v3",
    token_fonte: TOKEN_FONTE,
    identidade: quem,
    app_do_token: {
      app_id: appId,
      app: app?.body ?? null,
      tipo_de_token: dd?.type ?? null,
      valido: dd?.is_valid ?? null,
      expira_em: dd?.expires_at ?? null,
      data_access_expira_em: dd?.data_access_expires_at ?? null,
      modo_do_app:
        "NAO DETERMINAVEL PELA GRAPH: nao existe campo publico development/live no no do app para token de usuario/system user. Conferir em developers.facebook.com/apps/<app_id>/settings/basic (seletor no topo). A evidencia comportamental de modo desenvolvimento e o subcode 1885183 no POST de /adcreatives.",
    },
    escopos: {
      presentes: escoposPresentes,
      necessarios: ESCOPOS_NECESSARIOS,
      ausentes: escoposAusentes,
      fonte:
        "debug_token.scopes + granular_scopes + /me/permissions. Token de System User nao aparece em /me/permissions - por isso o debug_token e a fonte principal.",
      debug_token_bruto: debug,
    },
    ad_account: conta,
    system_user_na_conta: {
      business_id: businessId,
      meu_id: meuId,
      tasks: minhasTasks,
      tem_manage_ads: minhasTasks.includes("MANAGE"),
      atribuidos,
      nota:
        "tasks MANAGE (ou ADVERTISE + MANAGE_AD_ACCOUNT dependendo do papel) e o que permite criar. Lista vazia com erro de permissao significa que falta business_management no token, nao necessariamente que o System User nao tem papel.",
    },
    campanha_leitura: campanha,
    pipeboard,
    veredito_dica: "para F4.2 precisamos: ads_read (leitura) e ads_management (escrita) com a ad account atribuída ao System User",
  });
});
