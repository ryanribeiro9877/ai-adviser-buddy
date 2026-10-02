// Memoria institucional do agente (agent_context), isolada por empresa.
// Padrao SUPER GESTOR: fatos de marca/produto so da empresa selecionada;
// universais (company_id null) entram so se nao contaminarem com outra marca.

import { COMPANY_COHAPM, COMPANY_LEGAL } from "./meta_company_tokens.ts";

export type FatoMemoria = {
  categoria: string;
  fato: string;
  desde?: string | null;
  company_id?: string | null;
};

const MARCA_LEGAL =
  /legal\s*e\s*viver|\bLEV\b|consignado\s*CLT|FIN-0[0-9]|CET na/i;
const MARCA_COHAPM =
  /COHAPM|La Felicit|Jur[ií]dico\s+COHAPM/i;

/** IDs act_ no fato que nao pertencem a esta empresa contaminam a memoria. */
export function fatoCitaContaAlheia(fato: string, contasDaEmpresa: string[]): boolean {
  const citados = [...String(fato ?? "").matchAll(/\bact_(\d{6,})\b/gi)].map((m) => m[1]);
  if (!citados.length) return false;
  const proprias = new Set(
    (contasDaEmpresa ?? []).map((c) => String(c).replace(/^act_/i, "").trim()).filter(Boolean),
  );
  return citados.some((id) => !proprias.has(id));
}

/** Universais que citam as DUAS marcas (doutrina de isolamento) passam. */
function universalSeguroParaEmpresa(fato: string, companyId: string): boolean {
  const legal = MARCA_LEGAL.test(fato);
  const cohapm = MARCA_COHAPM.test(fato);
  if (legal && cohapm) return true;
  if (companyId === COMPANY_LEGAL) {
    if (cohapm && !legal) return false;
    return true;
  }
  if (companyId === COMPANY_COHAPM) {
    if (legal && !cohapm) return false;
    return true;
  }
  // Outra empresa: zero mencao de portfolio conhecido.
  if (legal || cohapm) return false;
  return true;
}

export function filtrarMemoriaPorEmpresa(
  rows: FatoMemoria[],
  companyId: string,
  contasDaEmpresa: string[] = [],
): FatoMemoria[] {
  const id = String(companyId ?? "").trim();
  if (!id) return [];
  return rows.filter((r) => {
    const cid = r.company_id == null ? null : String(r.company_id);
    if (cid != null && cid !== id) return false;
    if (fatoCitaContaAlheia(String(r.fato ?? ""), contasDaEmpresa)) return false;
    if (cid === id) return true;
    return universalSeguroParaEmpresa(String(r.fato ?? ""), id);
  });
}

export function formatarMemoria(rows: FatoMemoria[]): string {
  if (!rows.length) return "(sem fatos registrados)";
  return rows
    .map(
      (r) =>
        `- [${String(r.categoria).toUpperCase()}${r.desde ? " " + String(r.desde) : ""}] ${r.fato}`,
    )
    .join("\n");
}

/** Carrega vigente: desta empresa + universais nao contaminantes. */
export async function carregarMemoriaInstitucional(
  // deno-lint-ignore no-explicit-any
  supa: { from: (t: string) => any },
  companyId: string,
): Promise<{ rows: FatoMemoria[]; texto: string; consulta_falhou?: boolean }> {
  const id = String(companyId ?? "").trim();
  if (!id) return { rows: [], texto: "(sem fatos registrados)" };
  const { data, error } = await supa
    .from("agent_context")
    .select("categoria,fato,desde,company_id")
    .eq("vigente", true)
    .or(`company_id.is.null,company_id.eq.${id}`)
    .order("categoria");
  if (error) {
    return {
      rows: [],
      texto: `consulta_falhou: nao foi possivel ler a memoria institucional (${error.message}). Isto NAO e 'sem fatos'.`,
      consulta_falhou: true,
    };
  }
  const { data: contas } = await supa
    .from("meta_ad_accounts")
    .select("account_id")
    .eq("company_id", id);
  const ids = ((contas ?? []) as { account_id?: string }[])
    .map((c) => String(c.account_id ?? ""))
    .filter(Boolean);
  const filtrados = filtrarMemoriaPorEmpresa((data ?? []) as FatoMemoria[], id, ids);
  return { rows: filtrados, texto: formatarMemoria(filtrados) };
}
