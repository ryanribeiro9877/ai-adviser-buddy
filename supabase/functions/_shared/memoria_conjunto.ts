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

/**
 * Conjunto/anuncio do zero. Nao comparar com a `norm()` do traffic-chat:
 * ela remove `_` e transforma "sem_molde" em "semmolde" (lookup falha).
 */
export function ehSentinelaSemMolde(nome: unknown): boolean {
  const s = String(nome ?? "").trim();
  if (!s) return false;
  if (/^_?sem[_-]?molde$/i.test(s)) return true;
  const compact = s
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[-_\s]+/g, "");
  return compact === "semmolde";
}

/** params.sem_molde — o LLM as vezes manda string "true". */
export function ehFlagSemMolde(v: unknown): boolean {
  if (v === true || v === 1) return true;
  const s = String(v ?? "").trim().toLowerCase();
  return s === "true" || s === "1";
}

export function pareceNomeDePecaNaoMolde(nome: string): boolean {
  const s = String(nome ?? "").trim();
  if (!s) return true;
  if (ehSentinelaSemMolde(s)) return true;
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

/** Peca ja escolhida para um conjunto nesta conversa (contrato, nao inventario Drive). */
export type PecaSlate = {
  conjunto: number;
  drive_file_id: string;
  nome: string;
  pasta?: string;
  angulo?: string;
  cta?: string;
  peca_chave: string;
};

const RE_DRIVE_ID = /1[A-Za-z0-9_-]{24,40}/;
const RE_MP4 = /([^|`\n\r]+?\.(?:mp4|mov|webm))/i;

export function temSlateNoTexto(s: string): boolean {
  const t = String(s ?? "");
  return /conj(?:unto)?\.?\s*0*[1-9]/i.test(t) && RE_DRIVE_ID.test(t) && /\.mp4/i.test(t);
}

export function pecaChaveDoSlate(p: { conjunto: number; nome: string; drive_file_id: string }): string {
  const slug = String(p.nome ?? "")
    .replace(/\.[a-z0-9]+$/i, "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^\w]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 80);
  return `conjunto_${p.conjunto}_${slug || p.drive_file_id.slice(0, 12)}`;
}

/**
 * Extrai o slate CONTRATUAL (CONJ.N + arquivos numerados) da fala.
 * Ignora a tabela de inventario (mes/pasta sem numero de peca) — 34 arquivos
 * nao sao o slate. Linhas "| 1 | arquivo.mp4 | pasta | drive_id | motivacao |"
 * sob um heading CONJ.N sao.
 */
export function extrairSlateDaFala(texto: string): PecaSlate[] {
  const lines = String(texto ?? "").split(/\r?\n/);
  let conjunto: number | null = null;
  let anguloConj: string | undefined;
  let ctaConj: string | undefined;
  const byId = new Map<string, PecaSlate>();

  const stampMeta = () => {
    if (conjunto == null) return;
    for (const p of byId.values()) {
      if (p.conjunto !== conjunto) continue;
      if (anguloConj && !p.angulo) p.angulo = anguloConj;
      if (ctaConj && !p.cta) p.cta = ctaConj;
    }
  };

  for (const raw of lines) {
    const line = raw.trim();
    const head = line.match(/(?:^#+\s*)?(?:\*\*)?conj(?:unto)?\.?\s*0*([1-9]\d?)\b/i);
    if (head && !/^\|/.test(line)) {
      stampMeta();
      conjunto = Number(head[1]);
      anguloConj = undefined;
      ctaConj = undefined;
      continue;
    }
    const ang = line.match(/\*\*Ângulo[^*]*\*\*:?\s*(.+)/i) || line.match(/\*\*Angulo[^*]*\*\*:?\s*(.+)/i);
    if (ang) {
      anguloConj = ang[1].replace(/\*+/g, "").trim();
      stampMeta();
      continue;
    }
    const ctaM = line.match(/\*\*CTA:\*\*\s*(.+)/i);
    if (ctaM) {
      ctaConj = ctaM[1].replace(/\*+/g, "").trim();
      stampMeta();
      continue;
    }
    if (conjunto == null) continue;
    if (!/^\|\s*\d{1,2}\s*\|/.test(line)) continue;
    const idM = line.match(RE_DRIVE_ID);
    const nomeM = line.match(RE_MP4);
    if (!idM || !nomeM) continue;
    const drive = idM[0];
    const nome = nomeM[1].replace(/^[|\s`]+|[|\s`]+$/g, "").trim();
    const cells = line.split("|").map((c) => c.replace(/`/g, "").trim()).filter(Boolean);
    const pasta = cells[2] && !RE_DRIVE_ID.test(cells[2]) && !/\.mp4/i.test(cells[2]) ? cells[2] : undefined;
    const motivacao = cells.length >= 5 && !RE_DRIVE_ID.test(cells[cells.length - 1])
      ? cells[cells.length - 1]
      : undefined;
    const peca: PecaSlate = {
      conjunto,
      drive_file_id: drive,
      nome,
      pasta,
      angulo: motivacao || anguloConj,
      cta: ctaConj,
      peca_chave: "",
    };
    peca.peca_chave = pecaChaveDoSlate(peca);
    byId.set(drive, peca);
  }
  stampMeta();
  return [...byId.values()].sort((a, b) => a.conjunto - b.conjunto || a.nome.localeCompare(b.nome, "pt"));
}

export function pecasDoConjunto(pecas: PecaSlate[], n: number): PecaSlate[] {
  return pecas.filter((p) => p.conjunto === n);
}

/** Linhas de produto que compartilham a empresa COHAPM. Nao misturar. */
export type LinhaProdutoCohapm = "juridico" | "la_felicita";
export const ERRO_CRUZAMENTO_LINHA_PRODUTO = "cruzamento_linha_produto";

/**
 * Classifica UM lado (campanha/conjunto OU peca/slate/meio) a partir de nomes.
 * `_LAF_` em CONJ.1_LAF_8CRIATIVOS… conta como La Felicità (detectarMeioCohapm antigo nao pegava).
 * Sinais mistos no mesmo lado → null (nao adivinha).
 */
export function classificarLinhaProdutoCohapm(
  ...sinais: Array<string | null | undefined>
): LinhaProdutoCohapm | null {
  const n = sinais
    .filter((s) => s != null && String(s).trim())
    .map((s) => deacc(String(s)).toLowerCase())
    .join(" || ");
  if (!n.trim()) return null;

  const lf =
    /la[\s_-]*felicita/.test(n) ||
    /lafelicita/.test(n) ||
    /_laf_/.test(n) ||
    /(^|[^a-z0-9])laf([^a-z0-9]|$)/.test(n) ||
    /\blaf_/.test(n) ||
    /(^|[^a-z0-9])lf([^a-z0-9]|$)/.test(n) ||
    /_lf_/.test(n) ||
    /\bimovel\b/.test(n) ||
    /\bresidencial\b/.test(n);

  const jur =
    /juridico/.test(n) ||
    /(^|[^a-z0-9])jur([^a-z0-9]|$)/.test(n) ||
    /_jur_/.test(n) ||
    /\bjur_/.test(n) ||
    /cj_inss/.test(n) ||
    /coop_social_juridico/.test(n);

  if (lf && jur) return null;
  if (lf) return "la_felicita";
  if (jur) return "juridico";
  return null;
}

function rotuloLinhaProduto(l: LinhaProdutoCohapm): string {
  return l === "la_felicita" ? "La Felicità" : "Jurídico";
}

function hintDestinoLinha(l: LinhaProdutoCohapm): string {
  return l === "la_felicita"
    ? "a campanha COHAPM_LAFELICITA_* (ou equivalente) e o conjunto La Felicità do mesmo CONJ.N — nunca COHAPM_JURIDICO_* / JURIDICO_CONJ"
    : "a campanha COHAPM_JURIDICO_* e o conjunto JURIDICO_CONJ.* — nunca LAFELICITA / LAF / FELICITA";
}

export type RecusaCruzamentoLinhaProduto =
  | { ok: true; dest: LinhaProdutoCohapm | null; peca: LinhaProdutoCohapm | null }
  | {
    ok: false;
    erro: typeof ERRO_CRUZAMENTO_LINHA_PRODUTO;
    detalhe: string;
    dest: LinhaProdutoCohapm;
    peca: LinhaProdutoCohapm;
  };

/**
 * Hard block: campanha/conjunto de uma linha × peca/slate/nome da outra.
 * So recusa quando OS DOIS lados classificam e divergem — sinal incompleto nao inventa recusa.
 */
export function recusarCruzamentoLinhaProduto(opts: {
  estruturaNomes: Array<string | null | undefined>;
  pecaSinais: Array<string | null | undefined>;
}): RecusaCruzamentoLinhaProduto {
  const dest = classificarLinhaProdutoCohapm(...opts.estruturaNomes);
  const peca = classificarLinhaProdutoCohapm(...opts.pecaSinais);
  if (!dest || !peca || dest === peca) return { ok: true, dest, peca };
  const destTxt = opts.estruturaNomes.map((s) => String(s ?? "").trim()).filter(Boolean).join(" / ") ||
    "(sem nome)";
  const pecaTxt = opts.pecaSinais.map((s) => String(s ?? "").trim()).filter(Boolean).slice(0, 6).join(" / ") ||
    "(sem nome)";
  return {
    ok: false,
    erro: ERRO_CRUZAMENTO_LINHA_PRODUTO,
    dest,
    peca,
    detalhe:
      `ERRO GRAVE (nao e aviso): peca de ${rotuloLinhaProduto(peca)} no destino de ${rotuloLinhaProduto(dest)}. ` +
      `Misturar as duas linhas da COHAPM e falta operacional grave — o card NAO pode ser emitido nem aplicado no Gerenciador. ` +
      `Destino escolhido: ${destTxt}. Peca/slate: ${pecaTxt}. ` +
      `Reemitir SOMENTE em ${hintDestinoLinha(peca)}.`,
  };
}

/** Auto-pick de CONJ.N: so conjuntos cuja campanha/nome e da mesma linha da peca. */
export function escolherConjuntosDaMesmaLinha<T extends { name?: string | null }>(
  hits: T[],
  pecaSinais: Array<string | null | undefined>,
  campanhaDe: (row: T) => string | null | undefined,
): T[] {
  const peca = classificarLinhaProdutoCohapm(...pecaSinais);
  if (!peca) return hits;
  return hits.filter((h) =>
    classificarLinhaProdutoCohapm(String(h.name ?? ""), campanhaDe(h)) === peca
  );
}
