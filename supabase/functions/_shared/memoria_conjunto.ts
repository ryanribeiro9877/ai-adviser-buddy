/** Espelho de src/lib/memoria-conjunto.ts — Deno nao importa o frontend. */
function deacc(s: string): string {
  return s.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
}

/**
 * "conjunto 2", "CONJ.02", "CONJ.1_LAF_…", "cj_02" → 2 / 1.
 * Delimitador depois do numero: fim, nao-digito (inclui `_` e `/`). `\b` falha em CONJ.1_LAF.
 */
export function numeroConjuntoDoNome(s: string): number | null {
  const t = deacc(String(s ?? "").toLowerCase());
  const m =
    t.match(/(?:^|[^a-z0-9])conj(?:unto)?\.?\s*0*([1-9]\d?)(?=[^0-9]|$)/) ||
    t.match(/(?:^|[^a-z0-9])cj[_\s.]*0*([1-9]\d?)(?=[^0-9]|$)/);
  if (!m) return null;
  const n = Number(m[1]);
  return n >= 1 && n <= 99 ? n : null;
}

export function numeroConjuntoDaFala(s: string): number | null {
  return numeroConjuntoDoNome(s);
}

/** Unico CONJ.N compartilhado pelos sinais; ambiguo (1 e 4) → null. */
export function numeroConjuntoDeSinais(
  ...sinais: Array<string | null | undefined>
): number | null {
  const nums = new Set<number>();
  for (const s of sinais) {
    if (s == null || !String(s).trim()) continue;
    const n = numeroConjuntoDoNome(String(s));
    if (n != null) nums.add(n);
  }
  if (nums.size === 1) return [...nums][0];
  return null;
}

export function conjuntoNomeCasaComNumero(name: string, n: number): boolean {
  return numeroConjuntoDoNome(name) === n;
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

/**
 * O que chegou como drive_file_id e, na verdade, approval_id (ou um pedaco dele).
 *
 * O DEFEITO QUE ISTO CONSERTA (01/09/2026): o slate da conversa do VISTTA recebeu 9 pecas com
 * drive_file_id do tipo "15-402a-9c1f-a8f3e1b5c9d2" — cauda de b7c8d92f-4e15-402a-9c1f-… — e
 * angulo "📋 Pendente". O modelo copiou colunas da propria tabela de cards para dentro dos
 * argumentos da tool. Como o upsert e por peca_chave, o lixo SOBRESCREVEU o id real: o slate,
 * que e a lista contratual das pecas, passou a apontar para nada.
 *
 * Hifen sozinho nao serve de sinal — "1-i4AgqTDwcZw_W4Vw-iedv52NYNutPkU" e id de Drive real.
 * Comprimento tambem nao: um dos lixos tinha 34 caracteres. O que separa os dois mundos e a
 * CAUDA de UUID (hex4-hex4-hex12 no fim): casa nos 9 lixos medidos e em nenhum dos 16 ids
 * reais da mesma conversa, porque id de Drive tem letra fora do hexa e grupos de outro tamanho.
 */
export function pareceApprovalIdEmVezDeDrive(driveFileId: string): boolean {
  return /-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(driveFileId ?? "").trim());
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
export type LinhaProdutoCohapm = "juridico" | "la_felicita" | "sistema_ocular";
export const ERRO_CRUZAMENTO_LINHA_PRODUTO = "cruzamento_linha_produto";

function textoTemSistemaOcularLinha(n: string): boolean {
  return /vistta/.test(n) || /sistema[\s_-]*ocular/.test(n) || /\bocular\b/.test(n) || /oftalm/.test(n);
}

/**
 * Classifica UM lado (campanha/conjunto OU peca/slate/meio) a partir de nomes.
 * `_LAF_` em CONJ.1_LAF_8CRIATIVOS… conta como La Felicità (detectarMeioCohapm antigo nao pegava).
 * VISTTA / Sistema Ocular e a terceira linha. Sinais mistos no mesmo lado → null (nao adivinha).
 */
export function classificarLinhaProdutoCohapm(
  ...sinais: Array<string | null | undefined>
): LinhaProdutoCohapm | null {
  const n = sinais
    .filter((s) => s != null && String(s).trim())
    .map((s) => deacc(String(s)).toLowerCase())
    .join(" || ");
  if (!n.trim()) return null;

  const oc = textoTemSistemaOcularLinha(n);

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

  const hits: LinhaProdutoCohapm[] = [];
  if (oc) hits.push("sistema_ocular");
  if (lf) hits.push("la_felicita");
  if (jur) hits.push("juridico");
  if (hits.length === 1) return hits[0];
  return null;
}

function rotuloLinhaProduto(l: LinhaProdutoCohapm): string {
  if (l === "la_felicita") return "La Felicità";
  if (l === "sistema_ocular") return "Sistema Ocular (VISTTA)";
  return "Jurídico";
}

function hintDestinoLinha(l: LinhaProdutoCohapm): string {
  if (l === "la_felicita") {
    return "a campanha COHAPM_LAFELICITA_* (ou equivalente) e o conjunto La Felicità do mesmo CONJ.N — nunca COHAPM_JURIDICO_* / JURIDICO_CONJ nem VISTTA / Sistema Ocular";
  }
  if (l === "sistema_ocular") {
    return "a campanha COHAPM_SISTEMA_OCULAR_* / COHAPM_VISTTA_* e o conjunto do mesmo empreendimento — nunca JURIDICO nem LAFELICITA";
  }
  return "a campanha COHAPM_JURIDICO_* e o conjunto JURIDICO_CONJ.* — nunca LAFELICITA / LAF / FELICITA nem VISTTA / Sistema Ocular";
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
      `Misturar linhas distintas da COHAPM e falta operacional grave — o card NAO pode ser emitido nem aplicado no Gerenciador. ` +
      `Destino escolhido: ${destTxt}. Peca/slate: ${pecaTxt}. ` +
      `Reemitir SOMENTE em ${hintDestinoLinha(peca)}.`,
  };
}

/**
 * Conjunto arquivado/apagado NAO e destino de anuncio — ele so cria ambiguidade de nome.
 *
 * Medido 01/09/2026: o gestor arquivou a duplicata CONJ.1_VISTTA (120249829825270182) e
 * ficou preso em conjunto_destino_ambiguo por horas, porque o espelho listava as duas
 * como candidatas. Nome repetido e normal na conta; nome repetido entre um objeto vivo e
 * um arquivado nao e ambiguidade nenhuma.
 */
export function conjuntoVivoParaDestino(row: { status?: unknown } | null | undefined): boolean {
  const st = String((row as { status?: unknown })?.status ?? "").trim().toUpperCase();
  return st !== "ARCHIVED" && st !== "DELETED";
}

/**
 * Instrucao de desempate honesta quando sobram varios conjuntos com o mesmo nome.
 *
 * Mandar "informe params.campanha_destino" quando as duplicatas estao na MESMA campanha
 * e um beco sem saida: o agente reenvia com a campanha, cai no mesmo erro e entra em loop
 * (medido 01/09/2026 nos anuncios do CONJ.1_VISTTA). Nesse caso o unico desempate real e
 * o external_id, entao e ele que tem que ser pedido.
 */
export function desempateDeConjunto(
  prefixo: string,
  pool: Array<{ campaign_id?: unknown; external_id?: unknown }>,
): string {
  const campanhas = new Set(pool.map((s) => String(s?.campaign_id ?? "")));
  const ids = pool.map((s) => String(s?.external_id ?? "")).filter(Boolean).slice(0, 8);
  if (campanhas.size <= 1) {
    return `${prefixo} Estao TODOS na mesma campanha, entao params.campanha_destino NAO desempata — ` +
      `nao reenvie com ela. Escolha um external_id de candidatos e mande em ` +
      `params.conjunto_destino_external_id (${ids.join(" ou ")}). ` +
      `Se um deles for duplicata que o gestor arquivou, peca a ele qual fica.`;
  }
  return `${prefixo} Informe params.campanha_destino (nome). ` +
    `Se ainda empatar dentro da mesma campanha, use params.conjunto_destino_external_id.`;
}

/**
 * Desempate do ALVO de um card (propose_action) quando o nome nao distingue.
 *
 * "peca o NOME COMPLETO EXATO" resolve prefixo ambiguo, mas e beco sem saida quando dois
 * objetos tem a MESMA string: nao existe nome que o gestor possa digitar que separe os dois.
 * Foi o que travou o rename dos dois anuncios homonimos do CONJ.2_VISTTA em 01/09/2026 — os
 * dois nasceram chamados "CONJ.2_VISTTA_WA_7199185-8107", o resolvedor acusou ambiguidade e o
 * agente concluiu que so restava renomear na mao no Gerenciador. Com nomes iguais o unico
 * desempate real e o external_id, entao e ele que tem que ser pedido.
 */
export function desempateDeAlvoDoCard(
  candidatos: Array<{ name?: unknown; external_id?: unknown }>,
): {
  ambiguo: true;
  opcoes: Array<{ nome: string; external_id: string }>;
  instrucao: string;
} {
  const opcoes = candidatos.slice(0, 6).map((c) => ({
    nome: String(c?.name ?? ""),
    external_id: String(c?.external_id ?? ""),
  }));
  const nomes = new Set(opcoes.map((o) => o.nome.trim().toLowerCase()));
  const ids = opcoes.map((o) => o.external_id).filter(Boolean);
  if (nomes.size <= 1) {
    return {
      ambiguo: true,
      opcoes,
      instrucao:
        `Os candidatos tem o MESMO nome, entao pedir "o nome completo exato" NAO desempata — ` +
        `nao repita esse pedido ao gestor e nao mande ninguem renomear no Gerenciador. ` +
        `Reemita o card com params.alvo_external_id (${ids.join(" ou ")}). ` +
        `Se nao souber qual e qual, mostre a lista com os ids ao gestor e pergunte.`,
    };
  }
  return {
    ambiguo: true,
    opcoes,
    instrucao:
      `Reemita com o NOME COMPLETO EXATO de um dos candidatos, ou aponte pelo id em ` +
      `params.alvo_external_id (${ids.join(" ou ")}).`,
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

/**
 * Auto-pick: CONJ.N da mesma linha. Pool vazio = nao ha candidato (nunca o mais novo da linha).
 */
export function escolherConjuntosPorNumeroELinha<T extends { name?: string | null }>(
  hits: T[],
  n: number,
  pecaSinais: Array<string | null | undefined>,
  campanhaDe: (row: T) => string | null | undefined,
): T[] {
  const byNum = hits.filter((h) => conjuntoNomeCasaComNumero(String(h.name ?? ""), n));
  return escolherConjuntosDaMesmaLinha(byNum, pecaSinais, campanhaDe);
}

export const ERRO_CONJUNTO_ERRADO = "conjunto_numero_errado";

export type RecusaConjuntoErrado =
  | { ok: true; pedido: number | null; dest: number | null }
  | {
    ok: false;
    erro: typeof ERRO_CONJUNTO_ERRADO;
    detalhe: string;
    pedido: number;
    dest: number | null;
  };

/**
 * Hard block: peca/slate/fala pediu CONJ.N e o destino e outro (CONJ.1 ↛ CONJ.4).
 * Sinal incompleto (sem numero no pedido) nao inventa recusa.
 */
export function recusarConjuntoErrado(opts: {
  pedidoNumero?: number | null;
  destNome?: string | null;
  pecaSinais?: Array<string | null | undefined>;
}): RecusaConjuntoErrado {
  const nPedido = opts.pedidoNumero ?? numeroConjuntoDeSinais(...(opts.pecaSinais ?? []));
  const nDest = numeroConjuntoDoNome(String(opts.destNome ?? ""));
  if (nPedido == null) return { ok: true, pedido: null, dest: nDest };
  if (nDest === nPedido) return { ok: true, pedido: nPedido, dest: nDest };
  const destTxt = String(opts.destNome ?? "").trim() || "(sem nome)";
  const pad = String(nPedido).padStart(2, "0");
  const destRotulo = nDest != null ? `CONJ.${nDest}` : "um conjunto sem CONJ.N no nome";
  return {
    ok: false,
    erro: ERRO_CONJUNTO_ERRADO,
    pedido: nPedido,
    dest: nDest,
    detalhe:
      `ERRO GRAVE (nao e aviso): o pedido e CONJ.${nPedido} mas o destino resolvido e ${destRotulo} (${destTxt}). ` +
      `Esperado o conjunto CONJ.${nPedido} (CONJ.${pad}) da mesma linha de produto — nunca o mais novo da linha. ` +
      `O card NAO pode ser emitido nem aplicado. Nao peca o ID numerico da Meta ao gestor: CONJ.${nPedido} no nome basta (get_estrutura_conjuntos).`,
  };
}
