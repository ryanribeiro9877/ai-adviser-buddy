// Recorte da LEITURA de desempenho por linha de produto e por destino (LP x WhatsApp).
//
// 15/10/2026, job cb099406: "campanhas do La Felicità que derrama na LP e do sistema ocular, que
// também derrama na LP ... não a campanha que derrama no WhatsApp". A colheita deterministica so
// sabia recortar UMA linha (inferirMeioDrive devolve null com duas), nao sabia destino nenhum e
// ainda nao reconhecia COHAPM_OCULAR_* como Sistema Ocular. Ficou sem campanha, caiu no
// especialista LLM e a resposta saiu vazia depois de 7 minutos. Em 13/10, "La Felicità que derrama
// no WhatsApp" trouxe as 11 campanhas da linha, LP e TOFU juntas.

import { classificarLinhaProdutoCohapm } from "./memoria_conjunto.ts";
import { inferirMeiosDoPedido, type MeioDrive } from "./pedido_drive_criativos.ts";

export type DestinoLeitura = "lp" | "whatsapp" | "perfil";

export type SinalDeConjunto = { destination_type?: unknown; optimization_goal?: unknown };

const deacc = (s: unknown) =>
  String(s ?? "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");

const RE_LP = /\b(lp|landing\s*pages?|landing|pagina de destino|site)\b/g;
const RE_WA = /\b(whatsapp|whats|wpp|zap|wa)\b/g;
const NEGACAO = /\b(nao|sem|exceto|menos|fora|nem|tirando)\b/;
// "visitas na LP" / "cliques no site" e METRICA, nao destino da campanha.
const METRICA_ANTES = /\b(visitas?|visualizac\w*|views?|acessos?|cliques?)\s+(\w+\s+){0,2}$/;

/** Mencoes que afirmam o destino. "nao a campanha que derrama no WhatsApp" nao conta. */
function mencoesQueAfirmam(p: string, re: RegExp, ignorarMetrica: boolean): number {
  let n = 0;
  for (const m of p.matchAll(re)) {
    const i = m.index ?? 0;
    // A negacao so vale dentro da mesma oracao: ", nao a campanha que derrama no WhatsApp".
    const oracao = p.slice(Math.max(0, i - 60), i).split(/[.,;:!?\n]/).pop() ?? "";
    if (NEGACAO.test(oracao)) continue;
    if (ignorarMetrica && METRICA_ANTES.test(oracao)) continue;
    n++;
  }
  return n;
}

/**
 * Destino que o pedido recorta. So recorta quando UM destino e afirmado: LP e WhatsApp juntos,
 * ou nenhum dos dois, devolvem null e a leitura cobre a linha inteira.
 */
export function destinoDoPedido(pedido: string): DestinoLeitura | null {
  const p = deacc(pedido).replace(/_/g, " ");
  const lp = mencoesQueAfirmam(p, RE_LP, true);
  const wa = mencoesQueAfirmam(p, RE_WA, false);
  if (lp > 0 && wa === 0) return "lp";
  if (wa > 0 && lp === 0) return "whatsapp";
  return null;
}

function destinoDoConjunto(s: SinalDeConjunto): DestinoLeitura | null {
  const dt = String(s.destination_type ?? "").toUpperCase();
  const og = String(s.optimization_goal ?? "").toUpperCase();
  if (dt === "WEBSITE") return "lp";
  if (dt === "WHATSAPP") return "whatsapp";
  if (dt === "INSTAGRAM_PROFILE") return "perfil";
  // destination_type UNDEFINED: a otimizacao ainda diz para onde o conjunto manda.
  if (og === "LANDING_PAGE_VIEWS" || og === "OFFSITE_CONVERSIONS") return "lp";
  if (og === "CONVERSATIONS") return "whatsapp";
  if (og === "VISIT_INSTAGRAM_PROFILE") return "perfil";
  return null;
}

/**
 * Destino da campanha: primeiro o que os conjuntos declaram (ad_sets.destination_type), depois
 * o nome (`_LP_`, `_SITE_`, `_WA_`). Destinos misturados ou nenhum sinal = null (nao adivinha).
 */
export function destinoDaCampanha(nome: unknown, conjuntos: SinalDeConjunto[] = []): DestinoLeitura | null {
  const vistos = new Set<DestinoLeitura>();
  for (const s of conjuntos) {
    const d = destinoDoConjunto(s);
    if (d) vistos.add(d);
  }
  if (vistos.size === 1) return [...vistos][0];
  if (vistos.size > 1) return null;
  const toks = new Set(String(nome ?? "").toUpperCase().split(/[^A-Z0-9]+/).filter(Boolean));
  const lp = toks.has("LP") || toks.has("SITE") || toks.has("LANDING");
  const wa = toks.has("WA") || toks.has("WHATSAPP") || toks.has("WPP");
  if (lp && !wa) return "lp";
  if (wa && !lp) return "whatsapp";
  return null;
}

const AGULHA_DA_LINHA: Record<MeioDrive, RegExp> = {
  la_felicita: /felicita/,
  sistema_ocular: /ocular|vistta/,
  juridico: /juridico/,
};

export type RecorteDaLeitura<T> = {
  linhas: MeioDrive[];
  destino: DestinoLeitura | null;
  alvos: T[];
  /** Da linha pedida, mas com outro destino (ou destino nao identificado). Vai declarado. */
  fora_do_destino: { nome: string; destino: DestinoLeitura | null }[];
};

export const ROTULO_DESTINO: Record<DestinoLeitura, string> = {
  lp: "LP/site",
  whatsapp: "WhatsApp",
  perfil: "perfil do Instagram",
};

/**
 * Campanhas da leitura quando o pedido nao traz nome: todas as linhas citadas e, se o pedido
 * afirmar um destino, so as daquele destino. Sem linha e sem destino devolve vazio — quem chama
 * decide o que fazer (o especialista entra).
 */
export function recortarCampanhasDaLeitura<T extends { name?: unknown }>(
  camps: T[],
  pedido: string,
  destinoDe: (c: T) => DestinoLeitura | null,
): RecorteDaLeitura<T> {
  const linhas = inferirMeiosDoPedido(pedido);
  const destino = destinoDoPedido(pedido);
  let daLinha: T[] = [];
  if (linhas.length) {
    for (const linha of linhas) {
      let hits = camps.filter((c) => classificarLinhaProdutoCohapm(String(c.name ?? "")) === linha);
      // Nome com sinais misturados nao classifica: a agulha do nome ainda acha a campanha.
      if (!hits.length) hits = camps.filter((c) => AGULHA_DA_LINHA[linha].test(deacc(c.name)));
      for (const h of hits) if (!daLinha.includes(h)) daLinha.push(h);
    }
  } else if (destino) {
    daLinha = [...camps];
  }
  if (!destino) return { linhas, destino, alvos: daLinha, fora_do_destino: [] };
  const alvos: T[] = [];
  const fora: { nome: string; destino: DestinoLeitura | null }[] = [];
  for (const c of daLinha) {
    const d = destinoDe(c);
    if (d === destino) alvos.push(c);
    else fora.push({ nome: String(c.name ?? ""), destino: d });
  }
  return { linhas, destino, alvos, fora_do_destino: fora };
}
