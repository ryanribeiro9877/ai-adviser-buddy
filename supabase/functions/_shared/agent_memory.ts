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
  /legal\s*e\s*viver|\bLEV\b|consignado\s*CLT|FIN-0[0-9]|CET na|act_3302001729967572/i;
const MARCA_COHAPM =
  /COHAPM|La Felicit|Jur[ií]dico\s+COHAPM|act_1622612945584817/i;

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
): FatoMemoria[] {
  const id = String(companyId ?? "").trim();
  if (!id) return [];
  return rows.filter((r) => {
    const cid = r.company_id == null ? null : String(r.company_id);
    if (cid === id) return true;
    if (cid != null) return false; // nunca carregar fato de outra empresa
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
): Promise<{ rows: FatoMemoria[]; texto: string }> {
  const id = String(companyId ?? "").trim();
  if (!id) return { rows: [], texto: "(sem fatos registrados)" };
  const { data } = await supa
    .from("agent_context")
    .select("categoria,fato,desde,company_id")
    .eq("vigente", true)
    .or(`company_id.is.null,company_id.eq.${id}`)
    .order("categoria");
  const filtrados = filtrarMemoriaPorEmpresa((data ?? []) as FatoMemoria[], id);
  return { rows: filtrados, texto: formatarMemoria(filtrados) };
}
