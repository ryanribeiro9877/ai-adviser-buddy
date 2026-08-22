function deacc(s: string): string {
  return s.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
}

/** "conjunto 2", "CONJ.02", "cj_02" → 2. Nao pega "os 3 primeiros". */
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

/** Mapa conjunto → wa.me extraido da conversa (ex.: "no 02 o link: http://wa.me/…"). */
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

/** target_name e peca do Drive / chave do slate — nao e anuncio molde do espelho. */
export function pareceNomeDePecaNaoMolde(nome: string): boolean {
  const s = String(nome ?? "").trim();
  if (!s) return true;
  if (/^_?sem_molde$/i.test(s)) return true;
  if (/\.(mp4|mov|webm|jpg|jpeg|png|webp)$/i.test(s)) return true;
  if (/veed|conjunto_\d+_criativo|criativo_\d+|drive_file/i.test(s)) return true;
  return false;
}
