// supabase/functions/meta-health/index.ts (v2) — F4.1
// Diagnóstico do token Meta disponível no ambiente: escopos, acesso à ad account da
// Legal é Viver (act_3302001729967572) e leitura de campanha. NÃO escreve nada.
// Tokens testados: META_ADS_TOKEN (se existir) senão WHATSAPP_ACCESS_TOKEN.
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

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { chaveMcpDe, mcpKeyValida } from "../_shared/mcp_auth.ts";
import { monitorConexaoPipeboard, pipeboardCall, pipeboardToken } from "../_shared/pipeboard.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const TOKEN = (Deno.env.get("META_ADS_TOKEN") ?? Deno.env.get("WHATSAPP_ACCESS_TOKEN") ?? "").trim();
const TOKEN_FONTE = Deno.env.get("META_ADS_TOKEN") ? "META_ADS_TOKEN" : "WHATSAPP_ACCESS_TOKEN";
const AD_ACCOUNT = "act_3302001729967572";
const GRAPH = "https://graph.facebook.com/v21.0";

// Escopos que a criacao de anuncio exige. ads_management e o unico realmente inegociavel para
// escrever; ads_read serve leitura; business_management e o que permite ler papel na conta.
const ESCOPOS_NECESSARIOS = ["ads_management", "ads_read", "business_management"];

const supa = createClient(SUPABASE_URL, SERVICE_ROLE, { auth: { persistSession: false } });
const CORS = { "access-control-allow-origin": "*", "access-control-allow-headers": "authorization, content-type, x-mcp-key", "access-control-allow-methods": "POST, OPTIONS" };
function json(obj: unknown, status = 200) {
  return new Response(JSON.stringify(obj), { status, headers: { "content-type": "application/json", ...CORS } });
}

// O token vai na query porque a Graph aceita assim e esta funcao roda server-side. O valor NUNCA
// entra na resposta: so ids, nomes e escopos.
async function g(path: string) {
  const r = await fetch(`${GRAPH}${path}${path.includes("?") ? "&" : "?"}access_token=${encodeURIComponent(TOKEN)}`);
  const t = await r.text();
  try { return { status: r.status, body: JSON.parse(t) }; } catch { return { status: r.status, body: t.slice(0, 300) }; }
}

async function segredoIntegracao(nome: string): Promise<string> {
  const { data } = await supa.from("integration_secrets").select("value").eq("name", nome).maybeSingle();
  return String(data?.value ?? "");
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });
  const auth = await mcpKeyValida(supa, chaveMcpDe(req, "header-or-bearer"));
  if (!auth.ok) return json({ error: "unauthorized", motivo: auth.motivo }, 401);
  if (!TOKEN) return json({ error: "nenhum token Meta no ambiente" }, 500);

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
    versao: "meta-health-v2",
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
