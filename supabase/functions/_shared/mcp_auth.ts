// GT-15 / briefing CODE: auth das edges via mcp_key_valida (VOLATILE).
// A chave legada continua válida; a RPC registra chamador/uso em mcp_api_keys.
// Nunca passar JWT de usuário para esta RPC.

import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";

export type McpAuthOk = {
  ok: true;
  chamador: string;
  legado: boolean;
  aviso: string | null;
};
export type McpAuthFail = { ok: false; motivo: string };
export type McpAuthResult = McpAuthOk | McpAuthFail;

export function bearerDe(req: Request): string {
  const authz = req.headers.get("authorization") ?? "";
  return authz.toLowerCase().startsWith("bearer ") ? authz.slice(7).trim() : "";
}

/** header-only = padrão A; header-or-bearer = B (e meta-campaign-status alinhado ao cron). */
export function chaveMcpDe(
  req: Request,
  modo: "header-only" | "header-or-bearer" | "bearer-or-header" = "header-or-bearer",
): string {
  const x = (req.headers.get("x-mcp-key") ?? "").trim();
  const b = bearerDe(req);
  if (modo === "header-only") return x;
  if (modo === "bearer-or-header") return b || x;
  return x || b;
}

export async function mcpKeyValida(
  supa: SupabaseClient,
  chave: string,
): Promise<McpAuthResult> {
  const p = (chave ?? "").trim();
  if (!p) return { ok: false, motivo: "chave_ausente_ou_curta" };
  const { data, error } = await supa.rpc("mcp_key_valida", { p_chave: p });
  if (error) return { ok: false, motivo: error.message };
  const v = data as {
    valida?: boolean;
    chamador?: string;
    legado?: boolean;
    aviso?: string | null;
    motivo?: string;
  } | null;
  if (!v?.valida) return { ok: false, motivo: v?.motivo ?? "chave_invalida" };
  return {
    ok: true,
    chamador: String(v.chamador ?? ""),
    legado: !!v.legado,
    aviso: v.aviso ?? null,
  };
}
