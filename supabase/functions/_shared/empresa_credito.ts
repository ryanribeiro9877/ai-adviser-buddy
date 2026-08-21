// Isolamento credito vs nao-credito (Legal vs COHAPM).
// Usado por compliance-check, gerar-legendas, traffic-chat e traffic-agent-job.
// NUNCA trate COHAPM como consignado/CLT/CET.

import { COMPANY_COHAPM, COMPANY_LEGAL } from "./meta_company_tokens.ts";

export { COMPANY_COHAPM, COMPANY_LEGAL };

/** Legal e a unica empresa de credito consignado no portfolio atual. */
export function empresaEhCredito(companyId: string | null | undefined): boolean {
  const id = String(companyId ?? "").trim();
  if (!id) return false;
  if (id === COMPANY_LEGAL) return true;
  if (id === COMPANY_COHAPM) return false;
  return false;
}

/** Codigos de compliance_rules so aplicaveis a credito (FIN-* + LGL-01 produto consignado). */
export const CODIGOS_SO_CREDITO = new Set([
  "FIN-01",
  "FIN-02",
  "FIN-03",
  "FIN-04",
  "FIN-05",
  "FIN-06",
  "FIN-07",
  "FIN-08",
  "LGL-01",
  "LGL-02",
]);

export function filtrarRegrasPorEmpresa<T extends { code: string }>(
  rules: T[],
  companyId: string | null | undefined,
): T[] {
  if (empresaEhCredito(companyId)) return rules;
  return rules.filter((r) => !CODIGOS_SO_CREDITO.has(String(r.code)));
}
