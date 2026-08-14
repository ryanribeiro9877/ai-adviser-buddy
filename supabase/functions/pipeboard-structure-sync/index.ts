// Coleta estrutural oficial Meta via Pipeboard.
// Niveis separados evitam timeout e mantem company_id derivado da integracao vinculada.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { chaveMcpDe, mcpKeyValida } from "../_shared/mcp_auth.ts";
import { pipeboardCall, pipeboardListTools, pipeboardToken } from "../_shared/pipeboard.ts";
import {
  buildStructureArgs,
  collectStructureRows,
  firstStructureObject,
  mapPipeboardAd,
  mapPipeboardAdset,
  mapPipeboardCampaign,
} from "../_shared/pipeboard_structure.ts";

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

type ToolDef = { name: string; inputSchema?: { properties?: Record<string, unknown> } };
type Level = "campaigns" | "adsets" | "ads";

const tool = (tools: ToolDef[], name: string) => tools.find((item) => item.name === name) ?? null;
const uniqueById = (rows: any[], fallbackField: string) =>
  Array.from(
    new Map(
      rows
        .filter((row) => String(row?.id ?? row?.[fallbackField] ?? "").trim())
        .map((row) => [String(row?.id ?? row?.[fallbackField]), row]),
    ).values(),
  );

async function call(name: string, args: Record<string, unknown>, token: string) {
  delete args.access_token;
  const response = await pipeboardCall(name, args, token);
  const readOk =
    response.status >= 200 &&
    response.status < 300 &&
    !response.erro &&
    !(response.body as any)?.error;
  if (!readOk) {
    const detail = JSON.stringify(response.body ?? response.bruto ?? {}).slice(0, 600);
    throw new Error(response.erro ?? `pipeboard_${name}_${response.status}:${detail}`);
  }
  return response.body;
}

async function listAll(
  name: string,
  schema: ToolDef | null,
  accountId: string,
  token: string,
  options: { campaignId?: string; adsetId?: string } = {},
) {
  const rows: any[] = [];
  let after: string | undefined;
  const seen = new Set<string>();
  const properties = schema?.inputSchema?.properties ?? {};
  const supportsCursor =
    Object.hasOwn(properties, "after") || Object.hasOwn(properties, "cursor");
  for (let page = 0; page < 50; page++) {
    const args = buildStructureArgs(schema?.inputSchema ?? null, accountId, {
      ...options,
      after,
      limit: 100,
    });
    const result = collectStructureRows(await call(name, args, token));
    rows.push(...result.rows);
    if (!result.after || !supportsCursor || seen.has(result.after)) break;
    seen.add(result.after);
    after = result.after;
  }
  return rows;
}

async function enrich(
  rows: any[],
  detailName: string,
  detailSchema: ToolDef | null,
  idField: "campaign_id" | "adset_id" | "ad_id",
  token: string,
) {
  if (!detailSchema) return rows;
  const output: any[] = [];
  for (let start = 0; start < rows.length; start += 5) {
    const batch = rows.slice(start, start + 5);
    const details = await Promise.all(
      batch.map(async (row) => {
        const id = String(row?.id ?? row?.[idField] ?? "").trim();
        if (!id) return row;
        try {
          const properties = detailSchema.inputSchema?.properties ?? {};
          const args: Record<string, unknown> = {};
          if (Object.hasOwn(properties, idField)) args[idField] = id;
          const detail = firstStructureObject(await call(detailName, args, token));
          return detail ? { ...row, ...detail, id: detail.id ?? id } : row;
        } catch (error) {
          return { ...row, _detail_error: String((error as Error).message ?? error) };
        }
      }),
    );
    output.push(...details);
  }
  return output;
}

// Anexa o criativo completo (legenda, CTA, destino/WhatsApp) a cada anuncio.
async function enrichCreatives(rows: any[], creativeSchema: ToolDef | null, token: string) {
  if (!creativeSchema) return rows;
  const output: any[] = [];
  for (let start = 0; start < rows.length; start += 5) {
    const batch = rows.slice(start, start + 5);
    const details = await Promise.all(
      batch.map(async (row) => {
        const creativeId = String(row?.creative?.id ?? row?.creative_id ?? "").trim();
        if (!creativeId) return row;
        try {
          const properties = creativeSchema.inputSchema?.properties ?? {};
          const args: Record<string, unknown> = {};
          if (Object.hasOwn(properties, "creative_id")) args.creative_id = creativeId;
          const creative = firstStructureObject(await call("get_creative_details", args, token));
          return creative ? { ...row, creative: { id: creativeId, ...creative } } : row;
        } catch {
          return row;
        }
      }),
    );
    output.push(...details);
  }
  return output;
}

async function mapsForCompany(supa: any, companyId: string) {
  const [{ data: campaigns }, { data: adsets }] = await Promise.all([
    supa.from("campaigns").select("id,external_id").eq("company_id", companyId),
    supa.from("ad_sets").select("id,external_id").eq("company_id", companyId),
  ]);
  return {
    campaigns: new Map<string, string>(
      (campaigns ?? []).map((row: any) => [String(row.external_id), String(row.id)]),
    ),
    adsets: new Map<string, string>(
      (adsets ?? []).map((row: any) => [String(row.external_id), String(row.id)]),
    ),
  };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: CORS });
  if (req.method !== "POST") return json({ error: "POST only" }, 405);
  const supa = createClient(SUPABASE_URL, SERVICE_ROLE, { auth: { persistSession: false } });
  const auth = await mcpKeyValida(supa, chaveMcpDe(req, "bearer-or-header"));
  if (!auth.ok) return json({ error: "unauthorized", motivo: auth.motivo }, 401);

  let body: any = {};
  try {
    body = await req.json();
  } catch {
    // defaults
  }
  const level = String(body?.level ?? "campaigns") as Level;
  if (!["campaigns", "adsets", "ads"].includes(level)) {
    return json({ error: "level_invalido", aceitos: ["campaigns", "adsets", "ads"] }, 400);
  }

  const { data: secret } = await supa
    .from("integration_secrets")
    .select("value")
    .eq("name", "pipeboard_api_token")
    .maybeSingle();
  const token = await pipeboardToken(async () => String(secret?.value ?? ""));
  if (!token) return json({ error: "missing_pipeboard_api_token" }, 400);
  const listed = await pipeboardListTools(token);
  if (!listed.ok) return json({ error: "pipeboard_tools_list_failed", detail: listed.erro }, 502);
  const tools = listed.tools as ToolDef[];

  const required = {
    campaigns: ["get_campaigns"],
    adsets: ["get_adsets"],
    ads: ["get_ads"],
  }[level];
  const missing = required.filter((name) => !tool(tools, name));
  if (missing.length) return json({ error: "pipeboard_tools_missing", missing }, 501);

  if (body?.probe === true) {
    const names = [
      "get_campaigns",
      "get_campaign_details",
      "get_adsets",
      "get_adset_details",
      "get_ads",
      "get_ad_details",
    ];
    return json({
      ok: true,
      source: "pipeboard:meta",
      all_tools: tools.map((item) => item.name),
      tools: names.map((name) => {
        const found = tool(tools, name);
        return { name, available: !!found, schema: found?.inputSchema ?? null };
      }),
    });
  }

  // Diagnostico somente-leitura: devolve o objeto de detalhe cru para inspecionar
  // pegada/destino (destination_type, optimization_goal, promoted_object, CTA/link)
  // sem escrever nada. Uso: { raw: true, level, external_id }.
  if (body?.raw === true && typeof body?.tool === "string") {
    const toolName = String(body.tool).trim();
    if (!toolName.startsWith("get_")) return json({ error: "raw_passthrough_somente_get" }, 400);
    if (!tool(tools, toolName)) return json({ error: "tool_indisponivel", toolName }, 501);
    try {
      const detail = await call(toolName, { ...(body?.args ?? {}) }, token);
      const obj = firstStructureObject(detail) ?? detail;
      return json({ ok: true, source: "pipeboard:meta", tool: toolName, keys: obj && typeof obj === "object" ? Object.keys(obj) : [], detail });
    } catch (error) {
      return json({ ok: false, erro: String((error as Error).message ?? error) }, 502);
    }
  }
  if (body?.raw === true) {
    const externalId = String(body?.external_id ?? "").trim();
    if (!externalId) return json({ error: "external_id_obrigatorio_no_modo_raw" }, 400);
    const detailName =
      level === "campaigns"
        ? "get_campaign_details"
        : level === "adsets"
          ? "get_adset_details"
          : "get_ad_details";
    const idField =
      level === "campaigns" ? "campaign_id" : level === "adsets" ? "adset_id" : "ad_id";
    const detailSchema = tool(tools, detailName);
    if (!detailSchema) return json({ error: "detalhe_indisponivel", detailName }, 501);
    try {
      const properties = detailSchema.inputSchema?.properties ?? {};
      const args: Record<string, unknown> = {};
      if (Object.hasOwn(properties, idField)) args[idField] = externalId;
      const detail = firstStructureObject(await call(detailName, args, token));
      return json({ ok: true, source: "pipeboard:meta", level, external_id: externalId, keys: detail ? Object.keys(detail) : [], detail });
    } catch (error) {
      return json({ ok: false, erro: String((error as Error).message ?? error) }, 502);
    }
  }

  const requested = new Set(
    (Array.isArray(body?.account_ids) ? body.account_ids : [])
      .map((value: unknown) => String(value).replace(/^act_/, "")),
  );
  const { data: integrations, error: integrationError } = await supa
    .from("integrations")
    .select("company_id,external_id,status")
    .eq("provider", "meta_ads")
    .not("external_id", "is", null);
  if (integrationError) return json({ error: integrationError.message }, 500);
  const active = (integrations ?? []).filter(
    (row: any) =>
      row.company_id &&
      row.external_id &&
      row.status !== "disabled" &&
      (!requested.size || requested.has(String(row.external_id).replace(/^act_/, ""))),
  );

  const reports: any[] = [];
  for (const integration of active) {
    const companyId = String(integration.company_id);
    const accountId = String(integration.external_id).replace(/^act_/, "");
    try {
      if (level === "campaigns") {
        const listedRows = await listAll("get_campaigns", tool(tools, "get_campaigns"), accountId, token);
        const rows = await enrich(
          listedRows,
          "get_campaign_details",
          tool(tools, "get_campaign_details"),
          "campaign_id",
          token,
        );
        const unique = uniqueById(rows, "campaign_id");
        const mapped = unique.map((row) => mapPipeboardCampaign(row, companyId, accountId));
        const { error } = mapped.length
          ? await supa.from("campaigns").upsert(mapped, { onConflict: "provider,external_id" })
          : { error: null };
        if (error) throw error;
        reports.push({ company_id: companyId, account_id: accountId, level, found: rows.length, unique: unique.length, upserted: mapped.length });
        continue;
      }

      const maps = await mapsForCompany(supa, companyId);
      if (level === "adsets") {
        const listedRows = await listAll("get_adsets", tool(tools, "get_adsets"), accountId, token);
        const rows = await enrich(
          listedRows,
          "get_adset_details",
          tool(tools, "get_adset_details"),
          "adset_id",
          token,
        );
        const unique = uniqueById(rows, "adset_id");
        const rejected: string[] = [];
        const mapped = unique.flatMap((row) => {
          try {
            return [mapPipeboardAdset(row, companyId, accountId, maps.campaigns)];
          } catch {
            rejected.push(String(row?.id ?? "?"));
            return [];
          }
        });
        const { error } = mapped.length
          ? await supa.from("ad_sets").upsert(mapped, { onConflict: "provider,external_id" })
          : { error: null };
        if (error) throw error;
        reports.push({ company_id: companyId, account_id: accountId, level, found: rows.length, unique: unique.length, upserted: mapped.length, rejected });
        continue;
      }

      const listedRows: any[] = [];
      for (const campaignExternalId of maps.campaigns.keys()) {
        listedRows.push(
          ...(await listAll("get_ads", tool(tools, "get_ads"), accountId, token, {
            campaignId: campaignExternalId,
          })),
        );
      }
      const detailed = await enrich(
        listedRows,
        "get_ad_details",
        tool(tools, "get_ad_details"),
        "ad_id",
        token,
      );
      const rows = await enrichCreatives(detailed, tool(tools, "get_creative_details"), token);
      const unique = uniqueById(rows, "ad_id");
      const rejected: string[] = [];
      const mapped = unique.flatMap((row) => {
        try {
          return [mapPipeboardAd(row, companyId, accountId, maps.campaigns)];
        } catch {
          rejected.push(String(row?.id ?? "?"));
          return [];
        }
      });
      const { error } = mapped.length
        ? await supa.from("ads").upsert(mapped, { onConflict: "provider,external_id" })
        : { error: null };
      if (error) throw error;
      reports.push({ company_id: companyId, account_id: accountId, level, found: rows.length, unique: unique.length, upserted: mapped.length, rejected });
    } catch (error) {
      reports.push({
        company_id: companyId,
        account_id: accountId,
        level,
        error: String((error as Error).message ?? error),
      });
    }
  }
  return json({
    ok: reports.every((report) => !report.error),
    source: "pipeboard:meta",
    level,
    reports,
  });
});
