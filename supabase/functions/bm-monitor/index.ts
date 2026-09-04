// supabase/functions/bm-monitor/index.ts (v4) — F4.4 multi-empresa
// v4 (27/08/2026): HTTP 400 code 80004 (too many calls / ad-account) NAO e token
//   ausente e NAO deve retry. O retry sem funding_source_details era certo para
//   task MANAGE; em quota ele duplicava a chamada e gravava alerta critico falso.
// v3 (25/08/2026): HTTP 400 em funding_source_details NAO e "token ausente".
//   O secret foi enviado; a Graph recusa o CAMPO (exige task MANAGE) e o pedido
//   inteiro cai. Retry sem o campo. Alerta cita o erro Graph. Sucesso posterior
//   resolve o alerta de leitura (o sino nao fica 7h com texto falso de token).
// Monitor da BM/conta de anúncios POR EMPRESA (Legal + COHAPM): coleta via Graph API —
// (1) status da conta + motivo de desativação; (2) cobrança: balance (gasto não
// faturado), funding_source_details, spend_cap — NOTA/fallback: a Graph API não
// expõe status de fatura vencida diretamente; usamos account_status=3 (UNSETTLED)
// como sinal de cobrança pendente e documentamos conferência manual no Gerenciador
// de Pagamentos para casos ambíguos; (3) anúncios com effective_status DISAPPROVED
// + ad_review_feedback; (4) issues_info de campanhas ativas.
// Grava em public.alerts com DEDUP por título (não recria alerta idêntico não resolvido).
// Severidade: critical = conta desativada/unsettled ou anúncio reprovado; high = issues.
// Body: {} = coleta real | { teste: true, company_id? } = injeta alerta sintético.
// Auth: x-mcp-key. Tokens: por empresa via meta_company_tokens (sem fallback cruzado).
// Cron diário recomendado 09:20 UTC.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { chaveMcpDe, mcpKeyValida } from "../_shared/mcp_auth.ts";
import {
  EMPRESAS_META,
  empresasComTokenAds,
  graphRateLimited,
  redactAllMetaTokens,
  tokenAdsPorCompanyId,
} from "../_shared/meta_company_tokens.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const GRAPH = "https://graph.facebook.com/v21.0";
const VERSAO = "bm-monitor-v4";
const CAMPOS_CONTA = "name,account_status,disable_reason,balance,currency,spend_cap,amount_spent";
const CAMPOS_CONTA_COM_FUNDING = `${CAMPOS_CONTA},funding_source_details`;
const TITULO_FALHA_CONTA = (slug: string) => `[BM][${slug}] Falha ao consultar a conta de anúncios`;

const supa = createClient(SUPABASE_URL, SERVICE_ROLE, { auth: { persistSession: false } });
function json(obj: unknown, status = 200) {
  return new Response(redactAllMetaTokens(JSON.stringify(obj)), {
    status,
    headers: { "content-type": "application/json" },
  });
}
async function g(path: string, token: string) {
  const sep = path.includes("?") ? "&" : "?";
  const r = await fetch(`${GRAPH}${path}${sep}access_token=${encodeURIComponent(token)}`);
  const t = await r.text();
  try {
    return { status: r.status, body: JSON.parse(redactAllMetaTokens(t)) };
  } catch {
    return { status: r.status, body: redactAllMetaTokens(t.slice(0, 300)) };
  }
}
const STATUS_LABEL: Record<number, string> = {
  1: "ATIVA",
  2: "DESATIVADA",
  3: "UNSETTLED (cobrança pendente)",
  7: "PENDING_RISK_REVIEW",
  8: "PENDING_SETTLEMENT",
  9: "IN_GRACE_PERIOD",
  100: "PENDING_CLOSURE",
  101: "FECHADA",
  201: "ANY_ACTIVE",
  202: "ANY_CLOSED",
};

function mensagemGraph(body: unknown): string {
  const err = (body as { error?: { message?: string; code?: number; error_subcode?: number } })?.error;
  if (!err?.message) return "";
  const code = err.code != null ? ` code=${err.code}` : "";
  const sub = err.error_subcode != null ? ` sub=${err.error_subcode}` : "";
  return `${err.message}${code}${sub}`.slice(0, 280);
}

function erroPareceToken(status: number, body: unknown): boolean {
  if (status === 401 || status === 403) return true;
  const err = (body as { error?: { code?: number; message?: string; type?: string } })?.error;
  const code = Number(err?.code ?? 0);
  const msg = String(err?.message ?? "").toLowerCase();
  if (code === 190 || code === 104) return true;
  return /invalid oauth|access token|session has expired|api access blocked/.test(msg);
}

async function lerContaAds(adAccount: string, token: string) {
  const comFunding = await g(`/${adAccount}?fields=${CAMPOS_CONTA_COM_FUNDING}`, token);
  if (comFunding.status === 200) return { ...comFunding, funding_omitido: false };
  // Quota da conta: repetir o GET piora o 80004 e nao prova token ausente.
  if (graphRateLimited(comFunding.status, comFunding.body)) {
    return { ...comFunding, funding_omitido: false };
  }
  // HTTP 400 neste campo e comum (task MANAGE). Nao e prova de secret ausente.
  if (comFunding.status === 400) {
    const sem = await g(`/${adAccount}?fields=${CAMPOS_CONTA}`, token);
    if (sem.status === 200) {
      return { ...sem, funding_omitido: true, funding_erro: mensagemGraph(comFunding.body) };
    }
    return { ...sem, funding_omitido: false };
  }
  return { ...comFunding, funding_omitido: false };
}

async function resolverFalhaLeitura(companyId: string, slug: string) {
  await supa
    .from("alerts")
    .update({ resolved: true })
    .eq("company_id", companyId)
    .eq("title", TITULO_FALHA_CONTA(slug))
    .eq("resolved", false);
}

async function upsertAlert(companyId: string, severity: string, title: string, description: string) {
  const { data: dup } = await supa
    .from("alerts")
    .select("id")
    .eq("company_id", companyId)
    .eq("title", title)
    .eq("resolved", false)
    .limit(1)
    .maybeSingle();
  if (dup) return { created: false, motivo: "dedup: alerta idêntico já ativo" };
  const { error } = await supa
    .from("alerts")
    .insert({ company_id: companyId, severity, title, description, resolved: false });
  return error ? { created: false, motivo: error.message } : { created: true };
}

async function coletarEmpresa(
  companyId: string,
  slug: string,
  nome: string,
  token: string,
  tokenRef: string,
  adAccounts: string[],
) {
  const criados: any[] = [];
  const porConta: any[] = [];

  for (const adAccount of adAccounts) {
    const conta = await lerContaAds(adAccount, token);
    const st = Number((conta.body as { account_status?: number })?.account_status ?? 0);
    if (conta.status !== 200) {
      const graph = mensagemGraph(conta.body);
      const tokenRuim = erroPareceToken(conta.status, conta.body);
      const quota = graphRateLimited(conta.status, conta.body);
      criados.push(
        await upsertAlert(
          companyId,
          quota ? "high" : "critical",
          TITULO_FALHA_CONTA(slug),
          tokenRuim
            ? `Graph recusou o token Ads de ${slug} ao ler ${adAccount} (HTTP ${conta.status}${graph ? `: ${graph}` : ""}). Conferir o Edge Secret ${tokenRef} (valor novo so entra no isolate apos frio/redeploy).`
            : quota
            ? `Graph recusou a leitura de ${adAccount} por LIMITE DE CHAMADAS (HTTP ${conta.status}${graph ? `: ${graph}` : ""}). O secret ${tokenRef} FOI enviado — nao e token da outra empresa. A corrida diaria (meta-campaign-status) esgota a cota da conta; tentar de novo depois.`
            : `Graph recusou a leitura de ${adAccount} (HTTP ${conta.status}${graph ? `: ${graph}` : ""}). O secret desta empresa FOI enviado — nao e ausencia de token.`,
        ),
      );
    } else {
      await resolverFalhaLeitura(companyId, slug);
      if (st !== 1) {
        criados.push(
          await upsertAlert(
            companyId,
            "critical",
            `[BM][${slug}] Conta de anúncios: ${STATUS_LABEL[st] ?? "status " + st}`,
            `account_status=${st}${conta.body?.disable_reason ? ", disable_reason=" + conta.body.disable_reason : ""}. Ação: abrir Gerenciador de Pagamentos/Qualidade da Conta imediatamente.`,
          ),
        );
      }
    }

    const bodyConta = (conta.body ?? {}) as {
      balance?: number;
      currency?: string;
      disable_reason?: unknown;
      funding_source_details?: { display_string?: string };
    };
    const balanceCent = Number(bodyConta.balance ?? 0);
    let reprovados: any[] = [];
    let comIssues: any[] = [];

    if (conta.status === 200) {
      const ads = await g(
        `/${adAccount}/ads?fields=name,effective_status,ad_review_feedback&limit=200`,
        token,
      );
      reprovados = (ads.body?.data ?? []).filter((a: any) => a.effective_status === "DISAPPROVED");
      for (const ad of reprovados.slice(0, 10)) {
        const fb = ad.ad_review_feedback?.global
          ? JSON.stringify(ad.ad_review_feedback.global).slice(0, 300)
          : "sem detalhe da Meta";
        criados.push(
          await upsertAlert(
            companyId,
            "critical",
            `[BM][${slug}] Anúncio REPROVADO pela Meta: ${String(ad.name).slice(0, 80)}`,
            `Feedback da revisão: ${fb}. Ação: corrigir o criativo/legenda (use o guardião de compliance) e reenviar, ou contestar a decisão.`,
          ),
        );
      }

      const camps = await g(
        `/${adAccount}/campaigns?fields=name,effective_status,issues_info&limit=100`,
        token,
      );
      comIssues = (camps.body?.data ?? []).filter(
        (c: any) => Array.isArray(c.issues_info) && c.issues_info.length,
      );
      for (const c of comIssues.slice(0, 10)) {
        const i = c.issues_info[0];
        criados.push(
          await upsertAlert(
            companyId,
            "high",
            `[BM][${slug}] Campanha com problema: ${String(c.name).slice(0, 80)}`,
            `${i.error_summary ?? i.error_type ?? "issue"}: ${String(i.error_message ?? "").slice(0, 250)}`,
          ),
        );
      }
    }

    porConta.push({
      ad_account: adAccount,
      leitura_http: conta.status,
      funding_omitido: conta.funding_omitido ?? false,
      status: st,
      label: STATUS_LABEL[st] ?? st,
      saldo_nao_faturado: bodyConta.currency
        ? `${bodyConta.currency} ${(balanceCent / 100).toFixed(2)}`
        : null,
      funding: bodyConta.funding_source_details?.display_string ?? null,
      anuncios_reprovados: reprovados.length,
      campanhas_com_issues: comIssues.length,
    });
  }

  return {
    company_id: companyId,
    slug,
    nome,
    token_ref: tokenRef,
    contas: porConta,
    alertas: criados,
  };
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return json({ error: "POST only" }, 405);
  const comToken = empresasComTokenAds();
  if (!comToken.length) {
    return json({ error: "nenhum META_ADS_TOKEN* configurado para empresas Meta" }, 500);
  }
  const auth = await mcpKeyValida(supa, chaveMcpDe(req, "header-only"));
  if (!auth.ok) return json({ error: "unauthorized", motivo: auth.motivo }, 401);

  let body: any = {};
  try {
    body = await req.json();
  } catch {
    /* */
  }

  if (body?.teste === true) {
    const companyId =
      String(body?.company_id ?? "").trim() ||
      EMPRESAS_META[0]?.company_id ||
      "";
    if (!companyId) return json({ error: "company_id ausente para teste" }, 400);
    const r = await upsertAlert(
      companyId,
      "critical",
      "[BM][TESTE] Conta de anúncios desativada (simulação)",
      "Alerta SINTÉTICO do bm-monitor para validar o fluxo critical → tela/chat. Resolver após o teste; nenhuma condição real detectada.",
    );
    return json({ ok: true, modo: "TESTE", company_id: companyId, alerta: r, versao: VERSAO });
  }

  // `null` cru, sem `as string | null`: token e ref vem sempre juntos de
  // tokenAdsPorCompanyId, e com os ramos assim os dois formam uma uniao discriminada —
  // o `if (!emp.token) continue` abaixo estreita `ref` para string junto com `token`.
  // Com o cast, `ref` continuava `string | null` depois da guarda e nao entrava em
  // coletarEmpresa, que exige string.
  const empresas = EMPRESAS_META.map((e) => {
    const tok = tokenAdsPorCompanyId(e.company_id);
    return tok ? { ...e, token: tok.token, ref: tok.ref } : { ...e, token: null, ref: null };
  });

  const resultados: any[] = [];
  const puladas: any[] = [];
  for (const emp of empresas) {
    if (!emp.token) {
      puladas.push({
        company_id: emp.company_id,
        slug: emp.slug,
        motivo: "token_ausente_empresa",
        nota: "sem fallback para token de outra empresa",
      });
      continue;
    }
    resultados.push(
      await coletarEmpresa(emp.company_id, emp.slug, emp.nome, emp.token, emp.ref, emp.ad_accounts),
    );
  }

  return json({
    ok: true,
    modo: "COLETA",
    versao: VERSAO,
    empresas: resultados,
    puladas,
    nota_fallback_cobranca:
      "Graph não expõe fatura vencida diretamente; sinal usado é account_status=3 (UNSETTLED). Conferir Gerenciador de Pagamentos em caso ambíguo.",
  });
});
