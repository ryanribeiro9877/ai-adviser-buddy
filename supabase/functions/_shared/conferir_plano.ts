// Diferenca crua entre o plano gravado e a ficha ao vivo. Sem nota e sem adjetivo.

export type Diferenca = { campo: string; plano: unknown; conta: unknown };

function valorDe(obj: Record<string, unknown>, caminho: string): unknown {
  const partes = caminho.split(".");
  let cur: unknown = obj;
  for (const p of partes) {
    if (!cur || typeof cur !== "object") return undefined;
    cur = (cur as Record<string, unknown>)[p];
  }
  return cur;
}

function igual(a: unknown, b: unknown): boolean {
  if (a == null && b == null) return true;
  return JSON.stringify(a) === JSON.stringify(b);
}

export function conferirCampos(
  plano: Record<string, unknown>,
  conta: Record<string, unknown>,
  campos: string[],
): { igual: string[]; diferente: Diferenca[]; ausente: string[] } {
  const igualLista: string[] = [];
  const diferente: Diferenca[] = [];
  const ausente: string[] = [];
  for (const campo of campos) {
    const p = valorDe(plano, campo);
    const c = valorDe(conta, campo);
    const planoTem = p !== undefined && p !== null && p !== "";
    const contaTem = c !== undefined && c !== null && c !== "";
    if (!planoTem && !contaTem) continue;
    if (planoTem && !contaTem) {
      ausente.push(campo);
      continue;
    }
    if (igual(p, c)) igualLista.push(campo);
    else diferente.push({ campo, plano: p ?? null, conta: c ?? null });
  }
  return { igual: igualLista, diferente, ausente };
}

export const CAMPOS_CONFERENCIA_CONJUNTO = [
  "nome",
  "verba_diaria_reais",
  "idade_min",
  "idade_max",
  "whatsapp",
  "destination_type",
  "optimization_goal",
  "status",
];
