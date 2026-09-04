/**
 * Espelho de supabase/functions/_shared/orcamento_reais.ts
 * orcamento_diario_reais e SEMPRE reais por dia, nunca centavos da Graph.
 */

function parseParte(intP: string, dec?: string | null): number | null {
  const n = dec != null && String(dec).length ? Number(`${intP}.${dec}`) : Number(intP);
  if (!Number.isFinite(n) || n <= 0 || n > 5000) return null;
  if (n >= 2020 && n <= 2035) return null;
  return Math.round(n * 100) / 100;
}

export function pareceOrcamentoCentavosComoReais(reais: number): boolean {
  if (!Number.isFinite(reais) || reais <= 0) return false;
  if (reais !== Math.round(reais)) return false;
  if (reais < 1000) return false;
  if (reais % 100 !== 0) return false;
  const comoReais = reais / 100;
  return comoReais >= 5 && comoReais <= 80;
}

export function extrairOrcamentoDiarioDaFala(texto: string): number | null {
  const t = String(texto ?? "");
  if (!t.trim()) return null;
  const hits: { idx: number; val: number }[] = [];
  const add = (idx: number, intP: string, dec?: string | null) => {
    const n = parseParte(intP, dec);
    if (n == null) return;
    hits.push({ idx, val: n });
  };

  const run = (re: RegExp, precisaContexto = false) => {
    const r = new RegExp(re.source, re.flags);
    let m: RegExpExecArray | null;
    while ((m = r.exec(t))) {
      if (precisaContexto) {
        const i0 = Math.max(0, m.index - 100);
        const i1 = Math.min(t.length, m.index + m[0].length + 40);
        const janela = t.slice(i0, i1);
        if (!/or[cç]amento|reais|r\$|\/\s*dia|conjuntos?/i.test(janela)) continue;
      }
      add(m.index, m[1], m[2] ?? null);
    }
  };

  run(/or[cç]amento[\s\S]{0,80}?(\d{1,4})(?:[.,](\d{2}))?/gi);
  run(/(?:r\$)\s*(\d{1,4})(?:[.,](\d{2}))?/gi);
  run(/(\d{1,4})(?:[.,](\d{2}))?\s*(?:reais?|\/\s*dia)\b/gi);
  run(/\(\s*(\d{1,4})[.,](\d{2})\s*\)/g, true);

  if (!hits.length) return null;
  hits.sort((a, b) => a.idx - b.idx);
  return hits[hits.length - 1].val;
}

export function ehFlagOrcamentoConfirmadoReais(v: unknown): boolean {
  return (
    v === true ||
    v === 1 ||
    String(v ?? "")
      .trim()
      .toLowerCase() === "true"
  );
}

export function conferirOrcamentoReais(opts: {
  reais: number;
  contrato?: number | null;
  confirmadoReais?: boolean;
}): { ok: true; reais: number } | { ok: false; erro: string; detalhe: string } {
  const reais = Number(opts.reais);
  if (!(reais > 0) || !Number.isFinite(reais)) {
    return {
      ok: false,
      erro: "orcamento_invalido",
      detalhe:
        "orcamento_diario_reais tem de ser um valor positivo em REAIS por dia (ex.: 30, nao 3000).",
    };
  }
  const contrato =
    opts.contrato != null && Number(opts.contrato) > 0
      ? Math.round(Number(opts.contrato) * 100) / 100
      : null;

  if (contrato != null) {
    if (Math.abs(reais - contrato) < 0.009) return { ok: true, reais };
    if (Math.abs(reais - contrato * 100) < 0.009) {
      return { ok: true, reais: contrato };
    }
    return {
      ok: false,
      erro: "orcamento_diferente_do_contrato",
      detalhe:
        `O gestor definiu R$ ${contrato.toFixed(2)}/dia nesta conversa. Nao use R$ ${reais.toFixed(2)}. ` +
        `O valor do card tem de ser exatamente o que ele falou.`,
    };
  }

  if (!opts.confirmadoReais && pareceOrcamentoCentavosComoReais(reais)) {
    const interpretado = reais / 100;
    return {
      ok: false,
      erro: "orcamento_parece_centavos",
      detalhe:
        `R$ ${reais.toFixed(2)}/dia parece R$ ${interpretado.toFixed(2)} enviado em CENTAVOS (a Meta guarda ${reais} = R$ ${interpretado.toFixed(2)}). ` +
        `O campo orcamento_diario_reais e em REAIS. Para R$ ${interpretado.toFixed(2)} use ${interpretado}. ` +
        `So se a intencao era mesmo R$ ${reais.toFixed(2)}/dia, passe params.orcamento_confirmado_reais=true.`,
    };
  }
  return { ok: true, reais };
}
