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

export async function rodarConferenciaDePlanos(opts: {
  supa: {
    from: (t: string) => any;
  };
  lerConjunto: (companyId: string, id: string) => Promise<Record<string, unknown>>;
}): Promise<{ ok: true; planos: number; alertas: number; falhas_de_leitura: number }> {
  const { data, error } = await opts.supa
    .from("plano_campanha")
    .select("id,company_id,campanha_nome,conjuntos")
    .eq("vigente", true);
  if (error) {
    return { ok: true, planos: 0, alertas: 0, falhas_de_leitura: 1 };
  }
  const planos = (data ?? []) as {
    id: string;
    company_id: string;
    campanha_nome: string;
    conjuntos: Record<string, unknown>[];
  }[];
  let alertas = 0;
  let falhas = 0;
  for (const plano of planos) {
    const conjuntos = Array.isArray(plano.conjuntos) ? plano.conjuntos : [];
    const diffs: string[] = [];
    for (const conj of conjuntos) {
      const id = String(conj.external_id ?? conj.id ?? "").trim();
      const nome = String(conj.nome ?? id);
      if (!id) {
        diffs.push(`${nome}: plano sem external_id`);
        continue;
      }
      const ficha = await opts.lerConjunto(plano.company_id, id);
      if (ficha.consulta_falhou) {
        falhas += 1;
        diffs.push(`${nome}: consulta_falhou (${String(ficha.motivo ?? "sem motivo")})`);
        continue;
      }
      const targeting = ficha.targeting && typeof ficha.targeting === "object"
        ? ficha.targeting as Record<string, unknown>
        : {};
      const promo = ficha.promoted_object && typeof ficha.promoted_object === "object"
        ? ficha.promoted_object as Record<string, unknown>
        : {};
      const cents = Number(ficha.daily_budget);
      const conta = {
        nome: ficha.name ?? null,
        verba_diaria_reais: Number.isFinite(cents) && cents > 0 ? Math.round(cents) / 100 : null,
        idade_min: targeting.age_min ?? null,
        idade_max: targeting.age_max ?? null,
        whatsapp: promo.whatsapp_phone_number ?? promo.whats_app_business_phone_number ?? null,
        destination_type: ficha.destination_type ?? null,
        optimization_goal: ficha.optimization_goal ?? null,
        status: ficha.effective_status ?? ficha.status ?? null,
      };
      const diff = conferirCampos(conj, conta, CAMPOS_CONFERENCIA_CONJUNTO);
      for (const d of diff.diferente) diffs.push(`${nome}.${d.campo}: plano=${JSON.stringify(d.plano)} conta=${JSON.stringify(d.conta)}`);
      for (const a of diff.ausente) diffs.push(`${nome}.${a}: ausente na conta`);
    }
    if (!diffs.length) continue;
    const chave = `plano:${plano.id}`;
    const { data: ja } = await opts.supa
      .from("alerts")
      .select("id")
      .eq("company_id", plano.company_id)
      .eq("chave_dedupe", chave)
      .eq("resolved", false)
      .limit(1);
    if (Array.isArray(ja) && ja.length) continue;
    const { error: insErr } = await opts.supa.from("alerts").insert({
      company_id: plano.company_id,
      severity: "high",
      title: "Conta diferente do plano",
      description: `Campanha ${plano.campanha_nome}: ${diffs.slice(0, 12).join(" | ")}`,
      resolved: false,
      chave_dedupe: chave,
      onde: plano.campanha_nome,
      acao: "Conferir o conjunto na Meta. Diferente ou ausente nao e 'esta tudo certo'.",
    });
    if (!insErr) alertas += 1;
  }
  return { ok: true, planos: planos.length, alertas, falhas_de_leitura: falhas };
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
