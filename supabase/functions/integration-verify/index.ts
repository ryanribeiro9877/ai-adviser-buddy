// integration-verify v1 — GT-24 / fluxo de vínculo Meta via Pipeboard.
// Chamado somente por usuário autenticado e administrador. O token Pipeboard
// permanece no servidor; o navegador recebe apenas contas e estados normalizados.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import {
  monitorConexaoPipeboard,
  pipeboardCall,
  pipeboardToken,
} from "../_shared/pipeboard.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const supa = createClient(SUPABASE_URL, SERVICE_ROLE, { auth: { persistSession: false } });

const CORS = {
  "access-control-allow-origin": "*",
  "access-control-allow-headers": "authorization, x-client-info, apikey, content-type",
  "access-control-allow-methods": "POST, OPTIONS",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, "content-type": "application/json" },
  });
}

function digits(value: unknown): string {
  return String(value ?? "").trim().replace(/^act_/, "");
}

function accountArray(body: any): any[] {
  const candidates = [
    body,
    body?.data,
    body?.accounts,
    body?.ad_accounts,
    body?.result,
    body?.result?.data,
    body?.result?.accounts,
  ];
  return candidates.find(Array.isArray) ?? [];
}

function normalizeAccounts(body: unknown) {
  const seen = new Set<string>();
  return accountArray(body)
    .map((raw: any) => {
      const id = digits(raw?.account_id ?? raw?.ad_account_id ?? raw?.id);
      if (!/^\d+$/.test(id) || seen.has(id)) return null;
      seen.add(id);
      return {
        id: `act_${id}`,
        external_id: id,
        name: String(raw?.name ?? raw?.account_name ?? raw?.business_name ?? `Conta ${id}`),
        status: String(raw?.account_status ?? raw?.status ?? "UNKNOWN"),
        currency: raw?.currency ? String(raw.currency) : null,
        timezone: raw?.timezone_name ? String(raw.timezone_name) : null,
      };
    })
    .filter(Boolean);
}

async function integrationSecret(name: string): Promise<string> {
  const { data } = await supa
    .from("integration_secrets")
    .select("value")
    .eq("name", name)
    .maybeSingle();
  return String(data?.value ?? "");
}

async function requireAdmin(req: Request) {
  const header = req.headers.get("authorization") ?? "";
  const token = header.replace(/^Bearer\s+/i, "").trim();
  if (!token) return { error: "Sessão ausente.", status: 401 } as const;

  const { data: auth, error } = await supa.auth.getUser(token);
  if (error || !auth.user) return { error: "Sessão inválida.", status: 401 } as const;

  const { data: role } = await supa
    .from("user_roles")
    .select("role")
    .eq("user_id", auth.user.id)
    .eq("role", "admin")
    .maybeSingle();
  if (!role) return { error: "Somente administradores podem vincular contas.", status: 403 } as const;
  return { user: auth.user } as const;
}

async function listAccounts(companyId: string) {
  const token = await pipeboardToken(integrationSecret);
  if (!token) return json({ error: "PIPEBOARD_API_TOKEN não configurado." }, 503);

  const pipeboard = await monitorConexaoPipeboard(token);
  if (!pipeboard.ok) {
    return json({
      error: pipeboard.alerta ?? "Conexão Pipeboard inativa.",
      pipeboard,
      accounts: [],
    }, 409);
  }

  const result = await pipeboardCall("get_ad_accounts", {}, token);
  if (!result.body || result.erro || result.body?.error) {
    return json({ error: result.erro ?? "Pipeboard não devolveu as contas.", pipeboard }, 502);
  }

  const accounts = normalizeAccounts(result.body);
  const { data: linked } = await supa
    .from("integrations")
    .select("company_id, external_id")
    .eq("provider", "meta_ads")
    .not("external_id", "is", null);

  const ownerByAccount = new Map(
    (linked ?? []).map((row: any) => [digits(row.external_id), String(row.company_id)]),
  );

  return json({
    accounts: accounts.map((account: any) => ({
      ...account,
      already_linked_company_id: ownerByAccount.get(account.external_id) ?? null,
      selected_company: ownerByAccount.get(account.external_id) === companyId,
    })),
    pipeboard,
    contract_limit: 10,
    visible_accounts: accounts.length,
  });
}

async function linkAccount(body: any, userId: string) {
  const companyId = String(body?.company_id ?? "").trim();
  const integrationId = String(body?.integration_id ?? "").trim();
  const externalId = digits(body?.account_id);
  const accountName = String(body?.account_name ?? "").trim();
  if (!/^[0-9a-f-]{36}$/i.test(companyId)) return json({ error: "Empresa inválida." }, 400);
  if (!/^\d+$/.test(externalId)) return json({ error: "Conta Meta inválida." }, 400);
  if (!accountName) return json({ error: "Informe o nome exibido no sistema." }, 400);

  const token = await pipeboardToken(integrationSecret);
  const pipeboard = await monitorConexaoPipeboard(token);
  if (!pipeboard.ok) return json({ error: pipeboard.alerta, pipeboard }, 409);

  const verification = await pipeboardCall("get_account_info", {
    account_id: `act_${externalId}`,
  }, token);
  if (!verification.body || verification.erro || verification.body?.error) {
    return json({
      error: verification.erro ?? "A conta não pôde ser confirmada pelo Pipeboard.",
    }, 422);
  }

  const { data: conflict } = await supa
    .from("integrations")
    .select("id, company_id")
    .eq("provider", "meta_ads")
    .eq("external_id", externalId)
    .neq("company_id", companyId)
    .limit(1)
    .maybeSingle();
  if (conflict) return json({ error: "Esta conta já está vinculada a outra empresa." }, 409);

  const patch = {
    company_id: companyId,
    provider: "meta_ads",
    account_name: accountName,
    external_id: externalId,
    status: "connected",
    estado_operacional: "ativa",
    estado_motivo: null,
    connected_at: new Date().toISOString(),
  };

  let integrationQuery;
  if (integrationId) {
    integrationQuery = supa
      .from("integrations")
      .update(patch)
      .eq("id", integrationId)
      .eq("company_id", companyId)
      .eq("provider", "meta_ads")
      .select()
      .single();
  } else {
    integrationQuery = supa.from("integrations").insert(patch).select().single();
  }
  const { data: integration, error: integrationError } = await integrationQuery;
  if (integrationError) return json({ error: integrationError.message }, 400);

  const { data: config } = await supa
    .from("meta_execution_config")
    .select("contas_permitidas_criacao")
    .eq("company_id", companyId)
    .single();
  const allowed = Array.from(new Set([
    ...((config?.contas_permitidas_criacao as string[] | null) ?? []),
    `act_${externalId}`,
  ]));
  const { error: configError } = await supa
    .from("meta_execution_config")
    .update({
      driver_escrita: "pipeboard",
      contas_permitidas_criacao: allowed,
      updated_at: new Date().toISOString(),
      updated_by: userId,
    })
    .eq("company_id", companyId);
  if (configError) return json({ error: `Conta vinculada, mas a configuração falhou: ${configError.message}` }, 500);

  await supa.from("audit_log").insert({
    company_id: companyId,
    user_id: userId,
    action: "integration.meta_linked",
    target_type: "integration",
    target_id: integration.id,
    details: {
      external_id: externalId,
      account_name: accountName,
      driver_escrita: "pipeboard",
      verificacao: "get_account_info",
    },
  });

  return json({ integration, pipeboard, execution_driver: "pipeboard" });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });
  if (req.method !== "POST") return json({ error: "Use POST." }, 405);

  const auth = await requireAdmin(req);
  if ("error" in auth) return json({ error: auth.error }, auth.status);

  let body: any;
  try {
    body = await req.json();
  } catch {
    return json({ error: "JSON inválido." }, 400);
  }

  const companyId = String(body?.company_id ?? "").trim();
  if (!/^[0-9a-f-]{36}$/i.test(companyId)) return json({ error: "Empresa inválida." }, 400);
  const { data: company } = await supa.from("companies").select("id").eq("id", companyId).maybeSingle();
  if (!company) return json({ error: "Empresa não encontrada." }, 404);

  if (body?.action === "list") return await listAccounts(companyId);
  if (body?.action === "link") return await linkAccount(body, auth.user.id);
  return json({ error: "Ação inválida. Use list ou link." }, 400);
});
