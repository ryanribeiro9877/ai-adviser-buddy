// Leitura ao vivo do Pipeboard: so tools de leitura, escopadas a contas da empresa.
// Escrita continua em meta-actions. Sync diario (structure/metrics) continua oficial para historico.

import { pipeboardCall, pipeboardListTools } from "./pipeboard.ts";

const READ_PREFIXES = [
  "get_",
  "list_",
  "search_",
  "estimate_",
  "resolve_",
  "check_",
  "compute_",
  "bulk_get_",
] as const;

const READ_EXACT = new Set(["fetch"]);

const WRITE_PREFIXES = [
  "create_",
  "update_",
  "delete_",
  "upload_",
  "duplicate_",
  "publish_",
  "manage_",
  "submit_",
  "buy_",
  "bulk_create",
  "bulk_update",
  "bulk_upload",
  "add_",
  "remove_",
] as const;

export const PIPEBOARD_READ_PAYLOAD_CAP = 35000;

export type PipeboardToolDef = {
  name: string;
  description?: string;
  inputSchema?: { properties?: Record<string, unknown>; required?: string[] };
};

export function isReadOnlyTool(name: string): boolean {
  const n = String(name ?? "").trim();
  if (!n) return false;
  if (WRITE_PREFIXES.some((p) => n.startsWith(p))) return false;
  if (READ_EXACT.has(n)) return true;
  return READ_PREFIXES.some((p) => n.startsWith(p));
}

export function normalizeAccountId(value: unknown): string {
  return String(value ?? "").trim().replace(/^act_/i, "");
}

export function withActPrefix(accountId: string): string {
  const bare = normalizeAccountId(accountId);
  return bare ? `act_${bare}` : "";
}

/** Remove access_token e qualquer chave sensivel residual. */
export function sanitizeReadArgs(args: Record<string, unknown> | null | undefined): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(args ?? {})) {
    if (k === "access_token" || k === "token" || k === "PIPEBOARD_API_TOKEN") continue;
    if (v === undefined) continue;
    out[k] = v;
  }
  return out;
}

export function truncatePipeboardPayload(value: unknown, cap = PIPEBOARD_READ_PAYLOAD_CAP): {
  data: unknown;
  truncado: boolean;
  bytes: number;
} {
  const raw = JSON.stringify(value ?? null);
  const bytes = raw?.length ?? 0;
  if (bytes <= cap) return { data: value, truncado: false, bytes };
  // Preferir cortar arrays grandes em vez de cortar JSON no meio.
  if (value && typeof value === "object" && !Array.isArray(value)) {
    const obj = { ...(value as Record<string, unknown>) };
    for (const key of Object.keys(obj)) {
      if (Array.isArray(obj[key])) {
        const lista = obj[key] as unknown[];
        let keep = lista.length;
        while (keep > 0) {
          const candidate = { ...obj, [key]: lista.slice(0, keep) };
          const size = JSON.stringify(candidate).length;
          if (size <= cap - 400) {
            return {
              data: {
                ...candidate,
                aviso_corte:
                  `Payload truncado: ${keep} de ${lista.length} itens em '${key}'. O restante EXISTE no Pipeboard — peca filtro mais estreito.`,
                exibidos: keep,
                omitidos: lista.length - keep,
              },
              truncado: true,
              bytes: size,
            };
          }
          keep = Math.floor(keep / 2);
        }
      }
    }
  }
  return {
    data: {
      aviso_corte: `Resposta do Pipeboard excedeu ${cap} bytes e foi cortada. Peca um recorte mais estreito (ids, datas, limit).`,
      trecho: raw.slice(0, Math.max(0, cap - 200)),
    },
    truncado: true,
    bytes,
  };
}

export async function listReadTools(token: string): Promise<{
  ok: boolean;
  tools: Array<{ name: string; description: string; properties: string[]; required: string[] }>;
  total_pipeboard: number;
  total_leitura: number;
  erro?: string;
}> {
  const listed = await pipeboardListTools(token);
  if (!listed.ok) {
    return {
      ok: false,
      tools: [],
      total_pipeboard: 0,
      total_leitura: 0,
      erro: listed.erro ?? `tools/list_${listed.status}`,
    };
  }
  const all = (listed.tools ?? []) as PipeboardToolDef[];
  const read = all.filter((t) => isReadOnlyTool(String(t?.name ?? "")));
  return {
    ok: true,
    total_pipeboard: all.length,
    total_leitura: read.length,
    tools: read.map((t) => ({
      name: String(t.name),
      description: String(t.description ?? "").slice(0, 180),
      properties: Object.keys(t.inputSchema?.properties ?? {}),
      required: Array.isArray(t.inputSchema?.required) ? t.inputSchema!.required! : [],
    })),
  };
}

export async function companyMetaAccounts(
  // deno-lint-ignore no-explicit-any
  supa: any,
  companyId: string,
): Promise<string[]> {
  if (!companyId) return [];
  const { data, error } = await supa
    .from("integrations")
    .select("external_id,status")
    .eq("provider", "meta_ads")
    .eq("company_id", companyId)
    .not("external_id", "is", null);
  if (error) throw new Error(error.message);
  return (data ?? [])
    .filter((row: { status?: string }) => row.status !== "disabled")
    .map((row: { external_id: string }) => normalizeAccountId(row.external_id))
    .filter(Boolean);
}

export function assertAccountInCompany(accountId: string, allowed: string[]): {
  ok: boolean;
  account_id?: string;
  erro?: string;
} {
  const bare = normalizeAccountId(accountId);
  if (!bare) return { ok: false, erro: "account_id_ausente" };
  if (!allowed.includes(bare)) {
    return {
      ok: false,
      erro: "account_fora_da_empresa",
      account_id: bare,
    };
  }
  return { ok: true, account_id: bare };
}

/** Injeta/valida account_id quando a tool exige conta. */
export function scopeArgsToCompany(
  toolName: string,
  args: Record<string, unknown>,
  allowedAccounts: string[],
  schemaProperties: Record<string, unknown> = {},
): { ok: true; args: Record<string, unknown> } | { ok: false; erro: string; contas_da_empresa?: string[] } {
  if (!allowedAccounts.length) {
    return { ok: false, erro: "empresa_sem_conta_meta_vinculada" };
  }
  const safe = sanitizeReadArgs(args);
  const props = schemaProperties ?? {};
  const needsAccount =
    Object.hasOwn(props, "account_id") ||
    Object.hasOwn(props, "ad_account_id") ||
    ["get_insights", "bulk_get_insights", "get_campaigns", "get_adsets", "get_ads", "get_ad_accounts"].includes(
      toolName,
    );

  const rawAccount =
    safe.account_id ?? safe.ad_account_id ?? safe.act_id ?? null;
  if (rawAccount != null && String(rawAccount).trim()) {
    const check = assertAccountInCompany(String(rawAccount), allowedAccounts);
    if (!check.ok) {
      return {
        ok: false,
        erro: check.erro ?? "account_fora_da_empresa",
        contas_da_empresa: allowedAccounts,
      };
    }
    safe.account_id = withActPrefix(check.account_id!);
    delete safe.ad_account_id;
    delete safe.act_id;
    return { ok: true, args: safe };
  }

  if (needsAccount) {
    if (allowedAccounts.length === 1) {
      safe.account_id = withActPrefix(allowedAccounts[0]);
      return { ok: true, args: safe };
    }
    return {
      ok: false,
      erro: "informe_account_id_das_contas_da_empresa",
      contas_da_empresa: allowedAccounts,
    };
  }

  return { ok: true, args: safe };
}

export async function callReadTool(
  toolName: string,
  args: Record<string, unknown>,
  token: string,
): Promise<{
  ok: boolean;
  tool: string;
  status?: number;
  body?: unknown;
  erro?: string;
}> {
  const name = String(toolName ?? "").trim();
  if (!isReadOnlyTool(name)) {
    return {
      ok: false,
      tool: name,
      erro: "ferramenta_nao_e_leitura",
    };
  }
  const response = await pipeboardCall(name, sanitizeReadArgs(args), token);
  const readOk =
    response.status >= 200 &&
    response.status < 300 &&
    !response.erro &&
    !(response.body as { error?: unknown } | null)?.error;
  if (!readOk) {
    return {
      ok: false,
      tool: name,
      status: response.status,
      erro: response.erro ?? `pipeboard_${name}_${response.status}`,
      body: response.body,
    };
  }
  return { ok: true, tool: name, status: response.status, body: response.body };
}
