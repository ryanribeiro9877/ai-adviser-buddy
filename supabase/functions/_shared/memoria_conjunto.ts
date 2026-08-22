/** Espelho de src/lib/memoria-conjunto.ts — Deno nao importa o frontend. */
function deacc(s: string): string {
  return s.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
}

export function numeroConjuntoDaFala(s: string): number | null {
  const t = deacc(String(s ?? "").toLowerCase());
  const m =
    t.match(/\bconj(?:unto)?\.?\s*0*([1-9]\d?)\b/) ||
    t.match(/\bcj[_\s.]*0*([1-9]\d?)\b/);
  if (!m) return null;
  const n = Number(m[1]);
  return n >= 1 && n <= 99 ? n : null;
}

export function conjuntoNomeCasaComNumero(name: string, n: number): boolean {
  const t = deacc(String(name ?? "").toLowerCase());
  const pad = String(n).padStart(2, "0");
  return (
    new RegExp(`\\bconj(?:unto)?\\.?\\s*0*${n}\\b`).test(t) ||
    t.includes(`conj.${pad}`) ||
    t.includes(`conj ${pad}`)
  );
}

const RE_WAME = "https?:\\/\\/(?:wa\\.me|api\\.whatsapp\\.com\\/send)[^\\s)\\]\"'<>|]+";

export function extrairLinksWaMePorConjunto(texto: string): Record<number, string> {
  const out: Record<number, string> = {};
  const t = String(texto ?? "");
  const limpar = (u: string) => u.replace(/[.,;]+$/, "");
  const gravar = (n: number, url: string) => {
    if (n >= 1 && n <= 99 && url && !out[n]) out[n] = limpar(url);
  };

  const rePar = new RegExp(
    `(?:conj(?:unto)?\\.?\\s*0*(\\d+)|(?:^|\\s)no\\s+0*(\\d+)\\b)[\\s\\S]{0,180}?(${RE_WAME})`,
    "gi",
  );
  let m: RegExpExecArray | null;
  while ((m = rePar.exec(t))) gravar(Number(m[1] || m[2]), m[3]);

  const reTab = new RegExp(
    `conj(?:unto)?\\.?\\s*0*(\\d+)[^\\n]{0,220}?(${RE_WAME})`,
    "gi",
  );
  while ((m = reTab.exec(t))) gravar(Number(m[1]), m[2]);

  return out;
}

export function pareceNomeDePecaNaoMolde(nome: string): boolean {
  const s = String(nome ?? "").trim();
  if (!s) return true;
  if (/^_?sem_molde$/i.test(s)) return true;
  if (/\.(mp4|mov|webm|jpg|jpeg|png|webp)$/i.test(s)) return true;
  if (/veed|conjunto_\d+_criativo|criativo_\d+|drive_file/i.test(s)) return true;
  return false;
}

/** Padrao estruturado [MARCA][CANAL][OBJ]… — nao e nome livre do contrato. */
export function ehNomeCompostoEstruturado(nome: string): boolean {
  return /^\[[A-Z0-9._+-]+\](?:\[[A-Z0-9._+-]+\]){2,}$/i.test(String(nome ?? "").trim());
}

/** [WA]/[LEADS]/[WPP] no composto contradiz campanha OUTCOME_TRAFFIC / WEBSITE+LPV. */
export function nomeCompostoForaDeEscopoTrafego(nome: string): boolean {
  if (!ehNomeCompostoEstruturado(nome)) return false;
  const tokens = [...String(nome).matchAll(/\[([^\]]+)\]/g)].map((m) => m[1].toUpperCase());
  return tokens.includes("WA") || tokens.includes("LEADS") || tokens.includes("WPP");
}

const RE_NOME_CRIATIVO =
  /\b((?:JUR|LEV|COHAPM|LF)_[A-Z0-9]+(?:_CONJ0?\d+)?_AD0?\d+_[A-Za-z0-9_]+)\b/gi;

/** Nomes livres ja falados (ex.: JUR_CONV_CONJ03_AD01_Emprestimo_Pessoal_LEVA02). */
export function extrairNomesCriativoDaFala(texto: string): string[] {
  const out: string[] = [];
  const t = String(texto ?? "");
  let m: RegExpExecArray | null;
  const re = new RegExp(RE_NOME_CRIATIVO.source, RE_NOME_CRIATIVO.flags);
  while ((m = re.exec(t))) {
    const nome = String(m[1] ?? "").trim();
    if (!nome || ehNomeCompostoEstruturado(nome)) continue;
    if (!out.some((x) => x.toLowerCase() === nome.toLowerCase())) out.push(nome);
  }
  return out;
}

export function nomeCriativoDoConjunto(nome: string, n: number): boolean {
  const t = String(nome ?? "").toUpperCase();
  const pad = String(n).padStart(2, "0");
  return (
    t.includes(`CONJ${pad}`) ||
    t.includes(`CONJ0${n}`) ||
    t.includes(`CONJ_${pad}`) ||
    t.includes(`CONJ.${pad}`)
  );
}

export function numeroAnuncioDaChave(s: string): number | null {
  const m = String(s ?? "").toUpperCase().match(/_AD0?([1-9]\d?)(?:_|$)/);
  if (!m) return null;
  const n = Number(m[1]);
  return n >= 1 && n <= 99 ? n : null;
}

export type NomeCriativoTravado =
  | { ok: true; nome: string; origem: "pedido" | "conversa" }
  | { ok: false; erro: string; detalhe: string; nomes_contrato: string[] };

/**
 * Se a conversa (ou o turno) ja definiu o nome do anuncio, esse string E o contrato.
 * Trocar por [MARCA][CANAL][LEADS]… e perda de memoria — recusa por nome.
 */
export function escolherNomeCriativoTravado(opts: {
  nomePedido?: string | null;
  nomesContrato: string[];
  nomesJaUsados?: string[];
  conjuntoNumero?: number | null;
  pecaChave?: string | null;
}): NomeCriativoTravado {
  const pedido = String(opts.nomePedido ?? "").trim();
  const contrato = uniqNomes(opts.nomesContrato);
  const usados = new Set(uniqNomes(opts.nomesJaUsados ?? []).map((n) => n.toLowerCase()));
  const doConj = opts.conjuntoNumero
    ? contrato.filter((n) => nomeCriativoDoConjunto(n, opts.conjuntoNumero!))
    : contrato;
  const pool = doConj.length ? doConj : contrato;
  const livres = pool.filter((n) => !usados.has(n.toLowerCase()));

  if (pedido && !ehNomeCompostoEstruturado(pedido)) {
    return { ok: true, nome: pedido, origem: "pedido" };
  }
  if (pedido && ehNomeCompostoEstruturado(pedido) && contrato.length) {
    return {
      ok: false,
      erro: "nome_trocado_pelo_padrao_estruturado",
      detalhe:
        `O nome '${pedido}' e o padrao [MARCA][CANAL]… e esta conversa JA definiu nomes livres: ${contrato.join(", ")}. ` +
        "Use params.nome_novo com o nome EXATO do contrato. Se VOCE listou os nomes nesta conversa, esses nomes SAO o contrato; alterar na emissao e perda de memoria.",
      nomes_contrato: contrato,
    };
  }

  const nAd = numeroAnuncioDaChave(opts.pecaChave ?? "") ?? numeroAnuncioDaChave(pedido);
  const porAd = nAd
    ? (livres.length ? livres : pool).find((n) => numeroAnuncioDaChave(n) === nAd)
    : null;
  if (porAd) return { ok: true, nome: porAd, origem: "conversa" };

  const peca = String(opts.pecaChave ?? "").trim();
  if (peca) {
    const hit = pool.find(
      (n) => n.toLowerCase() === peca.toLowerCase() || n.toLowerCase().includes(peca.toLowerCase()),
    );
    if (hit) return { ok: true, nome: hit, origem: "conversa" };
  }

  if (livres.length === 1) return { ok: true, nome: livres[0], origem: "conversa" };
  if (livres.length > 1) {
    return {
      ok: false,
      erro: "nome_do_contrato_ambiguo",
      detalhe:
        `Esta conversa definiu ${livres.length} nomes ainda nao usados. Informe params.nome_novo com UM deles: ${livres.join(", ")}.`,
      nomes_contrato: livres,
    };
  }
  if (pool.length === 1) return { ok: true, nome: pool[0], origem: "conversa" };

  if (pedido && ehNomeCompostoEstruturado(pedido)) {
    return { ok: true, nome: pedido, origem: "pedido" };
  }
  return {
    ok: false,
    erro: "nome_obrigatorio",
    detalhe:
      "Informe params.nome_novo com o nome LIVRE do anuncio. Se voce listou nomes nesta conversa, use exatamente esses. PROIBIDO gerar [MARCA][CANAL][LEADS]… no lugar.",
    nomes_contrato: contrato,
  };
}

function uniqNomes(xs: string[]): string[] {
  const out: string[] = [];
  for (const raw of xs ?? []) {
    const s = String(raw ?? "").trim();
    if (!s || ehNomeCompostoEstruturado(s)) continue;
    if (!out.some((x) => x.toLowerCase() === s.toLowerCase())) out.push(s);
  }
  return out;
}
