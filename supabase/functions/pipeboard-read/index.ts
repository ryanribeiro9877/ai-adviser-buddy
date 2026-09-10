// Leitura ao vivo do Pipeboard (somente get/list/search/...).
// Auth: x-mcp-key / Bearer. Escopo: company_id + contas meta_ads vinculadas.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { bearerDe, chaveMcpDe, mcpKeyValida } from "../_shared/mcp_auth.ts";
import { pipeboardToken } from "../_shared/pipeboard.ts";
import {
  callReadTool,
  catalogoPipeboard,
  classificarCatalogoPipeboard,
  companyMetaAccounts,
  isReadOnlyTool,
  listReadTools,
  scopeArgsToCompany,
  truncatePipeboardPayload,
} from "../_shared/pipeboard_read.ts";
import { flattenCampanhasPipeboard } from "../_shared/relatorios.ts";

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
  let body: Record<string, unknown> = {};
  try {
    body = await req.json();
  } catch {
    body = {};
  }

  const xKey = chaveMcpDe(req, "header-only");
  const bearer = bearerDe(req);
  let userId: string | null = null;
  let authed = false;
  if (xKey) {
    const v = await mcpKeyValida(supa, xKey);
    if (!v.ok) return json({ error: "unauthorized", motivo: v.motivo }, 401);
    authed = true;
  } else if (bearer) {
    const { data: u } = await supa.auth.getUser(bearer);
    if (u?.user) {
      authed = true;
      userId = u.user.id;
    } else {
      const v = await mcpKeyValida(supa, bearer);
      if (!v.ok) return json({ error: "unauthorized", motivo: v.motivo }, 401);
      authed = true;
    }
  }
  if (!authed) return json({ error: "unauthorized" }, 401);

  const { data: secret } = await supa
    .from("integration_secrets")
    .select("value")
    .eq("name", "pipeboard_api_token")
    .maybeSingle();
  const token = await pipeboardToken(async () => String(secret?.value ?? ""));
  if (!token) return json({ error: "missing_pipeboard_api_token" }, 400);

  // MODO AUDITORIA: catalogo remoto INTEIRO, com o veredito de leitura/escrita item a item.
  //
  // Distinto de list:true de proposito. list:true serve ao MODELO e por isso mostra so o que
  // ele pode chamar; auditoria serve a QUEM CLASSIFICA o proxy, e para isso o lado da escrita
  // e justamente a metade que importa. ler_pipeboard e listar_ferramentas_pipeboard estao no
  // registro como 'leitura' — essa afirmacao so e verificavel se o catalogo do outro lado
  // puder ser enumerado, e ate 03/09/2026 nao havia como enumera-lo.
  //
  // tools/list nao executa ferramenta nenhuma: le schemas. Este modo nao aceita args, nao
  // recebe company_id e nao chama tools/call em caso nenhum.
  if (body?.auditoria === true || body?.list_all === true) {
    const cat = await catalogoPipeboard(token);
    if (!cat.ok) return json({ ok: false, erro: cat.erro }, 502);
    const c = classificarCatalogoPipeboard(cat.tools);
    const detalhe = (v: typeof c.leitura[number]) => {
      const def = cat.tools.find((t) => String(t?.name ?? "") === v.name);
      return {
        ...v,
        descricao: String(def?.description ?? "").replace(/\s+/g, " ").slice(0, 200),
        argumentos: Object.keys(def?.inputSchema?.properties ?? {}),
      };
    };
    const cut = truncatePipeboardPayload({
      ok: true,
      source: "pipeboard:meta",
      modo: "auditoria",
      total: c.total,
      total_leitura: c.leitura.length,
      total_recusadas: c.recusadas.length,
      // O caso que o allowlist de nome sozinho nao pegava: nome de leitura, servidor dizendo
      // o contrario. Lista vazia aqui e o resultado desejado, nao ausencia de conferencia.
      divergentes_nome_x_anotacao: c.divergentes.map(detalhe),
      leitura: c.leitura.map(detalhe),
      recusadas: c.recusadas.map(detalhe),
      nota:
        "Veredito por NOME (allowlist de prefixo, vale sem rede) E por ANOTACAO do servidor (estreita, nunca alarga). Escrita continua exclusivamente em meta-actions, com card de aprovacao.",
    }, 120000);
    return json(cut.data);
  }

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

  const companyId = String(body?.company_id ?? "").trim();

  if (userId && companyId) {
    const { data: membro } = await supa.rpc("is_company_member", {
      _company_id: companyId,
      _user_id: userId,
    });
    if (!membro) return json({ error: "nao_e_membro_da_empresa" }, 403);
  }

  if (body?.modo === "listar_campanhas" || body?.listar_campanhas === true) {
    if (!companyId) return json({ error: "company_id_obrigatorio" }, 400);
    if (userId) {
      const { data: membro } = await supa.rpc("is_company_member", {
        _company_id: companyId,
        _user_id: userId,
      });
      if (!membro) return json({ error: "nao_e_membro_da_empresa" }, 403);
    }
    let allowed: string[] = [];
    try {
      allowed = await companyMetaAccounts(supa, companyId);
    } catch (error) {
      return json({ error: String((error as Error).message ?? error) }, 500);
    }
    if (!allowed.length) {
      return json({ ok: false, erro: "empresa_sem_conta_meta_vinculada", company_id: companyId }, 400);
    }
    const campanhas: unknown[] = [];
    const erros: string[] = [];
    for (const acc of allowed) {
      const scoped = scopeArgsToCompany("get_campaigns", { account_id: acc }, allowed, { account_id: {} });
      if (!scoped.ok) {
        erros.push(scoped.erro);
        continue;
      }
      const result = await callReadTool("get_campaigns", scoped.args, token);
      if (!result.ok) {
        erros.push(result.erro ?? `falha get_campaigns ${acc}`);
        continue;
      }
      campanhas.push(...flattenCampanhasPipeboard(result.body));
    }
    return json({
      ok: erros.length === 0 || campanhas.length > 0,
      fonte: "ao_vivo",
      company_id: companyId,
      contas: allowed,
      campanhas,
      erros: erros.length ? erros : undefined,
    }, campanhas.length || !erros.length ? 200 : 502);
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
