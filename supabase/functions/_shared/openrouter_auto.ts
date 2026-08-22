// Config compartilhada do OpenRouter Auto Router (estavel).
// Docs: https://openrouter.ai/docs/guides/routing/routers/auto-router
// Slug: openrouter/auto — plugin id: auto-router
// (auto-beta fica disponivel se o secret apontar para openrouter/auto-beta)
// Sem surcharge: paga-se a taxa do modelo roteado (campo `model` da resposta).
// 22/08/2026: o padrao da casa passou a ser o catalogo em llm_catalogo.ts +
// llm_roteador.ts (escolha de MODELO por tarefa). Auto Router fica como
// fallback se LLM_ROTEADOR=legado.

export const OPENROUTER_AUTO_SLUG = "openrouter/auto";
export const OPENROUTER_AUTO_PLUGIN_ID = "auto-router";
export const OPENROUTER_AUTO_BETA_SLUG = "openrouter/auto-beta";
export const OPENROUTER_AUTO_BETA_PLUGIN_ID = "auto-beta-router";

/** Default da casa quando o secret OPENROUTER_MODEL estiver ausente. */
export function modeloOpenRouterPadrao(): string {
  return (Deno.env.get("OPENROUTER_MODEL") ?? OPENROUTER_AUTO_SLUG).trim() || OPENROUTER_AUTO_SLUG;
}

export function modeloOpenRouterSubPadrao(): string {
  const sub = (Deno.env.get("OPENROUTER_MODEL_SUB") ?? "").trim();
  return sub || modeloOpenRouterPadrao();
}

export type AutoCostTier = "low" | "medium" | "high" | "xhigh" | "max";

export function costTierOpenRouter(defaultTier: AutoCostTier = "medium"): AutoCostTier {
  const raw = (Deno.env.get("OPENROUTER_AUTO_COST_TIER") ?? defaultTier).trim().toLowerCase();
  if (raw === "low" || raw === "medium" || raw === "high" || raw === "xhigh" || raw === "max") {
    return raw;
  }
  return defaultTier;
}

export function isAutoRouterModel(model: string): boolean {
  const m = model.trim().toLowerCase();
  return m === "openrouter/auto" || m === "openrouter/auto-beta" || m.startsWith("openrouter/auto");
}

/**
 * Campos extras do body chat/completions quando o slug é Auto Router.
 * - plugins: cost_tier (+ allowed/excluded se secrets existirem)
 * - session_id: sticky de modelo/provider entre turnos da mesma conversa
 */
export function extrasAutoRouter(opts?: {
  model?: string;
  sessionId?: string | null;
  costTier?: AutoCostTier;
}): Record<string, unknown> {
  const model = (opts?.model ?? modeloOpenRouterPadrao()).trim();
  if (!isAutoRouterModel(model)) return {};

  const pluginId = model.includes("auto-beta")
    ? OPENROUTER_AUTO_BETA_PLUGIN_ID
    : OPENROUTER_AUTO_PLUGIN_ID;
  const plugin: Record<string, unknown> = {
    id: pluginId,
    cost_tier: opts?.costTier ?? costTierOpenRouter("medium"),
  };

  const allowed = (Deno.env.get("OPENROUTER_AUTO_ALLOWED_MODELS") ?? "").trim();
  if (allowed) {
    plugin.allowed_models = allowed.split(",").map((s) => s.trim()).filter(Boolean);
  }
  const excluded = (Deno.env.get("OPENROUTER_AUTO_EXCLUDED_MODELS") ?? "").trim();
  if (excluded) {
    plugin.excluded_models = excluded.split(",").map((s) => s.trim()).filter(Boolean);
  }

  const out: Record<string, unknown> = { plugins: [plugin] };
  const sid = String(opts?.sessionId ?? "").trim();
  if (sid) out.session_id = sid;
  return out;
}

/** Modelo efetivamente usado (roteado), para gravar no chat / custo. */
export function modeloEfetivoDaResposta(parsed: any, fallback: string): string {
  const m = String(parsed?.model ?? "").trim();
  return m || fallback;
}
