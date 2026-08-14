// Leitura ao vivo do Pipeboard (somente get/list/search/...).
// Auth: x-mcp-key / Bearer. Escopo: company_id + contas meta_ads vinculadas.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { chaveMcpDe, mcpKeyValida } from "../_shared/mcp_auth.ts";
import { pipeboardToken } from "../_shared/pipeboard.ts";
import {
  callReadTool,
  companyMetaAccounts,
  isReadOnlyTool,
  listReadTools,
  scopeArgsToCompany,
  truncatePipeboardPayload,
} from "../_shared/pipeboard_read.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const CORS = {
  "access-control-allow-origin": "*",
  "access-control-allow-headers": "authorization, x-mcp-key, content-type",
};
const json = (value: unknown, status = 200) =>
  new Response(JSON.stringify(value), {
    status,
    headers: { "content-type": "application/json", ...CORS },
  });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: CORS });
  if (req.method !== "POST") return json({ error: "POST only" }, 405);

  const supa = createClient(SUPABASE_URL, SERVICE_ROLE, { auth: { persistSession: false } });
  const auth = await mcpKeyValida(supa, chaveMcpDe(req, "bearer-or-header"));
  if (!auth.ok) return json({ error: "unauthorized", motivo: auth.motivo }, 401);

  let body: Record<string, unknown> = {};
  try {
    body = await req.json();
  } catch {
    body = {};
  }

  const { data: secret } = await supa
    .from("integration_secrets")
    .select("value")
    .eq("name", "pipeboard_api_token")
    .maybeSingle();
  const token = await pipeboardToken(async () => String(secret?.value ?? ""));
  if (!token) return json({ error: "missing_pipeboard_api_token" }, 400);

  if (body?.list === true) {
    const catalog = await listReadTools(token);
    if (!catalog.ok) return json({ ok: false, erro: catalog.erro }, 502);
    const cut = truncatePipeboardPayload({
      ok: true,
      source: "pipeboard:meta",
      modo: "list",
      total_pipeboard: catalog.total_pipeboard,
      total_leitura: catalog.total_leitura,
      tools: catalog.tools,
      nota: "Somente ferramentas de leitura. Escrita continua via meta-actions com card de aprovacao.",
    });
    return json(cut.data);
  }

  const toolName = String(body?.tool ?? body?.ferramenta ?? "").trim();
  if (!toolName) {
    return json({
      error: "informe list:true ou tool/ferramenta",
      exemplo: { list: true },
      exemplo_call: { company_id: "<uuid>", tool: "get_adset_details", args: { adset_id: "..." } },
    }, 400);
  }
  if (!isReadOnlyTool(toolName)) {
    return json({
      ok: false,
      erro: "ferramenta_nao_e_leitura",
      tool: toolName,
      nota: "pipeboard-read so executa get_/list_/search_/estimate_/resolve_/check_/compute_/bulk_get_/fetch. Escrita = meta-actions.",
    }, 403);
  }

  const companyId = String(body?.company_id ?? "").trim();
  if (!companyId) return json({ error: "company_id_obrigatorio" }, 400);

  let allowed: string[] = [];
  try {
    allowed = await companyMetaAccounts(supa, companyId);
  } catch (error) {
    return json({ error: String((error as Error).message ?? error) }, 500);
  }
  if (!allowed.length) {
    return json({ ok: false, erro: "empresa_sem_conta_meta_vinculada", company_id: companyId }, 400);
  }

  // Schema resumido a partir do catalogo (properties) para decidir se precisa de account_id.
  const catalog = await listReadTools(token);
  const toolMeta = catalog.tools.find((t) => t.name === toolName);
  const properties = Object.fromEntries((toolMeta?.properties ?? []).map((p) => [p, {}]));

  const argsIn = (body?.args && typeof body.args === "object" && !Array.isArray(body.args))
    ? body.args as Record<string, unknown>
    : {};
  const scoped = scopeArgsToCompany(toolName, argsIn, allowed, properties);
  if (!scoped.ok) {
    return json({
      ok: false,
      erro: scoped.erro,
      contas_da_empresa: scoped.contas_da_empresa ?? allowed,
    }, 403);
  }

  try {
    const result = await callReadTool(toolName, scoped.args, token);
    const cut = truncatePipeboardPayload({
      ok: result.ok,
      source: "pipeboard:meta",
      modo: "call",
      company_id: companyId,
      tool: toolName,
      args_usados: scoped.args,
      status: result.status ?? null,
      erro: result.erro ?? null,
      resultado: result.body ?? null,
    });
    return json(cut.data, result.ok ? 200 : 502);
  } catch (error) {
    return json({ ok: false, erro: String((error as Error).message ?? error) }, 502);
  }
});
