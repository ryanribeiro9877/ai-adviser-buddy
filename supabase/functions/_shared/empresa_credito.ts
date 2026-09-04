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

/**
 * Se o ramo desta empresa e CONHECIDO, em vez de se ela e de credito.
 *
 * Existe porque `empresaEhCredito` responde uma pergunta binaria a partir de tres estados de
 * mundo: Legal (credito), COHAPM (nao-credito) e QUALQUER OUTRA (nao sabemos). As duas ultimas
 * colapsam em `false`, e para escolher texto de prompt esse colapso e inofensivo — foi para
 * isso que a funcao nasceu. Para FILTRAR REGRA DE COMPLIANCE ele nao e: empresa desconhecida
 * cair em "nao e credito" faz o filtro remover as regras de credito de quem talvez seja
 * exatamente uma empresa de credito, e menos regra por ignorancia e aprovacao por omissao.
 *
 * O par SQL disto e `public.ramos_da_empresa`, que pela mesma razao devolve o conjunto MAIS
 * AMPLO quando nao consegue derivar o ramo.
 */
export function empresaComRamoConhecido(companyId: string | null | undefined): boolean {
  const id = String(companyId ?? "").trim();
  return id === COMPANY_LEGAL || id === COMPANY_COHAPM;
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
  // FAIL-CLOSED. Empresa cujo ramo nao conhecemos recebe TODAS as regras, nao o subconjunto.
  // Antes disto, um company_id novo (ou vazio) caia no ramo `else` de `empresaEhCredito` e
  // saia daqui SEM as 10 regras de credito — empresa nova estrearia com verificador mais
  // frouxo que as duas ja cadastradas, e o retorno diria "regras_aplicadas: N" com aparencia
  // de normalidade. Escopo mais estreito por ignorancia e a mesma familia de defeito que
  // aprovar por ausencia de sinal.
  if (!empresaComRamoConhecido(companyId)) return rules;
  return rules.filter((r) => !CODIGOS_SO_CREDITO.has(String(r.code)));
}
