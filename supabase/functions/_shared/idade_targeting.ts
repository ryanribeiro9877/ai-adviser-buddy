// Idade do conjunto publicado.
// A Meta aceita POST /{adset_id} targeting (o mesmo transporte de geo/publico).
// age_min/age_max sao inteiros 18–65. Com Advantage+ ligado a Graph recusa
// age_max no payload (teto 65) e so aceita age_min 18–25 (erro 1870188).
// Em credito o gate checar_segmentacao recusa estreitamento (fair lending).

export const IDADE_PISO = 18;
export const IDADE_TETO = 65;
export const IDADE_MIN_MAX_ADVANTAGE_PLUS = 25;

export type IdadePedido = {
  age_min: number;
  age_max: number;
  advantage_audience?: 0 | 1;
};

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === "object" && !Array.isArray(v);
}

export function parseIdade(v: unknown): number | null {
  if (v == null || v === "") return null;
  const n = typeof v === "number" ? v : Number(String(v).trim().replace(",", "."));
  if (!Number.isFinite(n) || !Number.isInteger(n)) return null;
  return n;
}

export function advantageAudienceLigado(targeting: Record<string, unknown> | null | undefined): boolean {
  if (!isPlainObject(targeting)) return false;
  const auto = targeting.targeting_automation;
  if (!isPlainObject(auto)) return false;
  const v = auto.advantage_audience;
  return v === 1 || v === true || v === "1";
}

export function faixaCompativelComAdvantagePlus(age_min: number, age_max: number): boolean {
  return age_min >= IDADE_PISO && age_min <= IDADE_MIN_MAX_ADVANTAGE_PLUS && age_max === IDADE_TETO;
}

export function resumoFaixa(age_min: number, age_max: number): string {
  return `${age_min}–${age_max} anos`;
}

export function validarIdadeDoPedido(params: Record<string, unknown> | null | undefined):
  | { ok: true; params: IdadePedido; resumo: string }
  | { ok: false; erro: string; detalhe?: string } {
  const p = isPlainObject(params) ? params : {};
  const minRaw = p.idade_min ?? p.age_min ?? p.min;
  const maxRaw = p.idade_max ?? p.age_max ?? p.max;
  if (minRaw == null || minRaw === "" || maxRaw == null || maxRaw === "") {
    return {
      ok: false,
      erro: "idade_min_e_max_obrigatorios",
      detalhe:
        "Passe idade_min e idade_max (inteiros 18–65). Alias: age_min / age_max. Os dois, nao so um.",
    };
  }
  const age_min = parseIdade(minRaw);
  const age_max = parseIdade(maxRaw);
  if (age_min == null || age_max == null) {
    return {
      ok: false,
      erro: "idade_nao_inteira",
      detalhe: "idade_min e idade_max tem de ser inteiros (ex.: 25 e 54), nao faixa em texto.",
    };
  }
  if (age_min < IDADE_PISO || age_max < IDADE_PISO) {
    return {
      ok: false,
      erro: "idade_abaixo_de_18",
      detalhe: "Piso desta casa e 18 (anuncios no Brasil). A Meta ate aceita 13 em alguns contextos; aqui nao.",
    };
  }
  if (age_min > IDADE_TETO || age_max > IDADE_TETO) {
    return {
      ok: false,
      erro: "idade_acima_de_65",
      detalhe: "Teto da Meta e 65.",
    };
  }
  if (age_min > age_max) {
    return {
      ok: false,
      erro: "idade_min_maior_que_max",
      detalhe: `idade_min (${age_min}) nao pode ser maior que idade_max (${age_max}).`,
    };
  }

  const aPlusRaw = p.advantage_audience ?? p.advantage_plus ?? p.advantage;
  let advantage_audience: 0 | 1 | undefined;
  if (aPlusRaw === 1 || aPlusRaw === true || aPlusRaw === "1" || aPlusRaw === "true") {
    advantage_audience = 1;
  } else if (aPlusRaw === 0 || aPlusRaw === false || aPlusRaw === "0" || aPlusRaw === "false") {
    advantage_audience = 0;
  }

  const compativelAPlus = faixaCompativelComAdvantagePlus(age_min, age_max);
  if (advantage_audience === 1 && !compativelAPlus) {
    return {
      ok: false,
      erro: "advantage_plus_nao_aceita_esta_faixa",
      detalhe:
        "Com Advantage+ ligado a Meta so aceita age_min 18–25 e nao aceita age_max (teto 65, erro 1870188). " +
        "Passe advantage_audience=0 para a faixa valer, ou peca 18–25 ate 65.",
    };
  }
  // Faixa estreita so funciona com Advantage+ desligado. Default 0 se o gestor nao declarou.
  if (advantage_audience === undefined && !compativelAPlus) {
    advantage_audience = 0;
  }

  const pedido: IdadePedido = { age_min, age_max };
  if (advantage_audience !== undefined) pedido.advantage_audience = advantage_audience;
  return { ok: true, params: pedido, resumo: resumoFaixa(age_min, age_max) };
}

export function validarIdadeContraTargetingAtual(
  targeting: Record<string, unknown> | null | undefined,
  pedido: IdadePedido,
):
  | { ok: true; advantage_audience_efetivo: 0 | 1 | undefined }
  | { ok: false; erro: string; detalhe: string } {
  const aPlusAtual = advantageAudienceLigado(targeting);
  const efetivo: 0 | 1 | undefined = pedido.advantage_audience !== undefined
    ? pedido.advantage_audience
    : (aPlusAtual ? 1 : 0);
  if (efetivo === 1 && !faixaCompativelComAdvantagePlus(pedido.age_min, pedido.age_max)) {
    return {
      ok: false,
      erro: "advantage_plus_nao_aceita_esta_faixa",
      detalhe:
        "Este conjunto tem Advantage+ ligado. A Meta so aceita age_min 18–25 e nao aceita age_max (teto 65). " +
        "Reemita o card com advantage_audience=0 (a faixa vira filtro) ou aceite 18–25 ate 65.",
    };
  }
  return { ok: true, advantage_audience_efetivo: pedido.advantage_audience };
}

/** Substitui age_min/age_max; preserva geo/interesses/plataformas. */
export function aplicarIdadeNoTargeting(
  targeting: Record<string, unknown>,
  opts: IdadePedido,
): Record<string, unknown> {
  const next: Record<string, unknown> = { ...targeting };
  const autoRaw = next.targeting_automation;
  const auto: Record<string, unknown> = isPlainObject(autoRaw) ? { ...autoRaw } : {};
  if (opts.advantage_audience === 0 || opts.advantage_audience === 1) {
    auto.advantage_audience = opts.advantage_audience;
  }
  const aPlus =
    auto.advantage_audience === 1 ||
    auto.advantage_audience === true ||
    auto.advantage_audience === "1";
  next.age_min = opts.age_min;
  if (aPlus) {
    delete next.age_max;
    if (isPlainObject(next.age_range)) {
      next.age_range = { ...next.age_range, min: opts.age_min, max: IDADE_TETO };
    }
  } else {
    next.age_max = opts.age_max;
    if (isPlainObject(next.age_range)) {
      next.age_range = { ...next.age_range, min: opts.age_min, max: opts.age_max };
    }
  }
  next.targeting_automation = auto;
  return next;
}

/**
 * Idade na CRIACAO de conjunto. Ausente = nao mexe no targeting herdado.
 * Acima de 65 nao recusa o card: a Meta nao tem esse teto, entao entra 65 e o aviso volta na tool.
 * Incidente 23/09/2026: pedido 35-75 morria na prosa ("idade 75 nao existe") e nenhum card saia.
 */
export function prepararIdadeParaCriacao(params: Record<string, unknown> | null | undefined):
  | { ok: true; aplica: false }
  | { ok: true; aplica: true; params: IdadePedido; resumo: string; aviso: string | null }
  | { ok: false; erro: string; detalhe?: string } {
  const p = isPlainObject(params) ? params : {};
  const minRaw = p.idade_min ?? p.age_min;
  const maxRaw = p.idade_max ?? p.age_max;
  if ((minRaw == null || minRaw === "") && (maxRaw == null || maxRaw === "")) {
    return { ok: true, aplica: false };
  }
  let min = parseIdade(minRaw);
  let max = parseIdade(maxRaw);
  const avisos: string[] = [];
  if (max != null && max > IDADE_TETO) {
    avisos.push(`Teto da Meta e ${IDADE_TETO}. idade_max ${max} entrou no card como ${IDADE_TETO}.`);
    max = IDADE_TETO;
  }
  if (min != null && min > IDADE_TETO) {
    avisos.push(`Teto da Meta e ${IDADE_TETO}. idade_min ${min} entrou no card como ${IDADE_TETO}.`);
    min = IDADE_TETO;
  }
  const v = validarIdadeDoPedido({
    ...p,
    idade_min: min ?? minRaw,
    idade_max: max ?? maxRaw,
  });
  if (!v.ok) return v;
  return {
    ok: true,
    aplica: true,
    params: v.params,
    resumo: v.resumo,
    aviso: avisos.length ? avisos.join(" ") : null,
  };
}
