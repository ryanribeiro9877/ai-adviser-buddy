/**
 * orcamento_diario_reais e SEMPRE reais por dia, nunca centavos da Graph.
 * Incidente 24/08/2026: gestor pediu (30,00) nos 4 conjuntos; o agente emitiu 3000
 * nos dois primeiros (3000 centavos = R$ 30) e a Meta nasceu com R$ 3.000/dia.
 */

function parseParte(intP: string, dec?: string | null): number | null {
  const n = dec != null && String(dec).length ? Number(`${intP}.${dec}`) : Number(intP);
  if (!Number.isFinite(n) || n <= 0 || n > 5000) return null;
  if (n >= 2020 && n <= 2035) return null;
  return Math.round(n * 100) / 100;
}

/** 3000 reais inteiros e multiplo de 100, interpretado como R$ 30 em centavos. */
export function pareceOrcamentoCentavosComoReais(reais: number): boolean {
  if (!Number.isFinite(reais) || reais <= 0) return false;
  if (reais !== Math.round(reais)) return false;
  if (reais < 1000) return false;
  if (reais % 100 !== 0) return false;
  const comoReais = reais / 100;
  return comoReais >= 5 && comoReais <= 80;
}

/**
 * CONJ.04, 9331-6245 e "nos 4 conjuntos" nao sao diaria.
 * Incidente 12/09/2026: "altere o orçamento desse conjunto JUR_WA_CONJ.04_9331-6245 para 20,00"
 * extraia 4 do NOME e o card de alterar_orcamento morria com orcamento_diferente_do_contrato.
 */
export function ehIdentificadorNaoOrcamento(texto: string, idx: number, trechoInt: string): boolean {
  const before = String(texto ?? "").slice(Math.max(0, idx - 24), idx);
  const after = String(texto ?? "").slice(idx + String(trechoInt).length, idx + String(trechoInt).length + 16);
  if (/CONJ\.?\s*_?$/i.test(before)) return true;
  if (/\d{3,}\s*[-_]$/.test(before)) return true;
  if (/^\s*[-_]\s*\d{3,}/.test(after)) return true;
  if (/[_-]$/.test(before) && /^\d{3,}/.test(trechoInt) && /[-_]\d/.test(after)) return true;
  if (/\bnos\s+$/i.test(before)) return true;
  // JUN/JUL26, 8CRIATIVOS — numero colado em letra nao e diaria.
  if (/[A-Za-zÁ-ú]$/.test(before)) return true;
  if (/^[A-Za-zÁ-ú]/.test(after)) return true;
  return false;
}

/**
 * "35-75 anos" e "idade de 30 à 65" nao sao diaria.
 * Incidente 23/09/2026: "orçamento de 30,00 e idade de público 35-75 anos"
 * lia 75 como contrato e recusava o card de R$ 30 com orcamento_diferente_do_contrato.
 */
function ehFaixaDeIdade(texto: string, idx: number, trechoInt: string): boolean {
  const before = String(texto ?? "").slice(Math.max(0, idx - 60), idx);
  const after = String(texto ?? "").slice(
    idx + String(trechoInt).length,
    idx + String(trechoInt).length + 24,
  );
  if (/\bidade\b[^.\n]{0,60}$/i.test(before)) return true;
  if (/\d{1,3}\s*[-–—]\s*$/.test(before) && /anos?\b/i.test(after)) return true;
  if (/^\s*[-–—aà]\s*\d{1,3}/i.test(after) && /\b(idade|p[uú]blico|faixa|anos?)\b/i.test(before + after)) {
    return true;
  }
  return false;
}

/**
 * Ultimo orcamento diario falado pelo gestor.
 * Pega "o orçamento será o mesmo nos 4 (30,00)" e ignora idade "30 à 65" e "35-75 anos".
 * CONJ.N / telefone no nome do conjunto nao contam.
 */
export function extrairOrcamentoDiarioDaFala(texto: string): number | null {
  const t = String(texto ?? "");
  if (!t.trim()) return null;
  const hits: { idx: number; val: number }[] = [];
  const add = (idx: number, intP: string, dec?: string | null) => {
    const n = parseParte(intP, dec);
    if (n == null) return;
    if (ehIdentificadorNaoOrcamento(t, idx, intP)) return;
    if (ehFaixaDeIdade(t, idx, intP)) return;
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
      const g = m[1];
      const numIdx = g ? m.index + m[0].lastIndexOf(g) : m.index;
      add(numIdx, m[1], m[2] ?? null);
    }
  };

  const reOrc = /or[cç]amento/gi;
  let mOrc: RegExpExecArray | null;
  while ((mOrc = reOrc.exec(t))) {
    const start = mOrc.index + mOrc[0].length;
    const end = Math.min(t.length, start + 120);
    let janela = t.slice(start, end);
    const corteIdade = janela.search(/\bidade\b/i);
    if (corteIdade >= 0) janela = janela.slice(0, corteIdade);
    const numRe = /(\d{1,4})(?:[.,](\d{2}))?/g;
    let n: RegExpExecArray | null;
    while ((n = numRe.exec(janela))) {
      add(start + n.index, n[1], n[2] ?? null);
    }
  }
  run(/(?:r\$)\s*(\d{1,4})(?:[.,](\d{2}))?/gi);
  run(/(\d{1,4})(?:[.,](\d{2}))?\s*(?:reais?|\/\s*dia)\b/gi);
  run(/\(\s*(\d{1,4})[.,](\d{2})\s*\)/g, true);
  run(/(?:para|pra)\s+(?:r\$\s*)?(\d{1,4})(?:[.,](\d{2}))?/gi, true);

  if (!hits.length) return null;
  hits.sort((a, b) => a.idx - b.idx);
  return hits[hits.length - 1].val;
}

/**
 * Valor pedido em alterar_orcamento. Aceita o campo da acao e o alias de criar_conjunto
 * (incidente 12/09/2026: a primeira chamada veio com orcamento_diario_reais).
 */
export function reaisPedidoAlterarOrcamento(origem: unknown): number {
  const bag: unknown[] = [];
  if (origem && typeof origem === "object") {
    const o = origem as Record<string, unknown>;
    bag.push(o.novo_orcamento_diario_reais, o.orcamento_diario_reais);
    if (o.params && typeof o.params === "object") {
      const p = o.params as Record<string, unknown>;
      bag.push(p.novo_orcamento_diario_reais, p.orcamento_diario_reais);
    }
  }
  for (const c of bag) {
    const n = Number(c);
    if (n > 0 && Number.isFinite(n)) return n;
  }
  return 0;
}

/**
 * Confirmacao de que o valor foi dito em REAIS, e nao centavos copiados da Meta.
 *
 * Mais restrita que `ehFlagSemMolde` (memoria_conjunto), que tambem aceita a string `"1"`, e a
 * assimetria e de proposito — nao harmonizar as duas. `sem_molde` e dica de estrutura: ser
 * liberal ali nao quebra nada. Aqui a lista curta E a guarda: esta flag e a unica coisa entre
 * "3000 foi engano de centavos" e "3000 foi proposito", e um truthy acidental faria
 * `conferirOrcamentoReais` aceitar R$ 3000/dia onde o gestor quis R$ 30 — 100x. Recusar custa
 * uma repergunta; aceitar por acidente custa o orcamento do dia.
 */
export function ehFlagOrcamentoConfirmadoReais(v: unknown): boolean {
  return v === true || v === 1 || String(v ?? "").trim().toLowerCase() === "true";
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
      detalhe: "orcamento_diario_reais tem de ser um valor positivo em REAIS por dia (ex.: 30, nao 3000).",
    };
  }
  const contrato = opts.contrato != null && Number(opts.contrato) > 0
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
