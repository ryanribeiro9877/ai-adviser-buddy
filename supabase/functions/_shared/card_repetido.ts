// Card de anuncio repetido no mesmo conjunto.
//
// O DEFEITO QUE ISTO CONSERTA (15/10/2026, conversa bf4a8869, COHAPM juridico): AD_C1_JUROS_ALTO
// virou DOIS anuncios ACTIVE no CONJ.4 MELHORES_CRIATIVOS (adset 120250525505760182):
// 120250525697670182 (card ed6a402d, executado 19:04:30) e 120250525725040182 (card 9817d6c5,
// executado 19:06:45). O turno "emita o proximo card" leu a fila as 19:04:24, seis segundos antes
// de a execucao do ed6a402d terminar, e chamou "aguardando_execucao" de "a execucao nao rodou".
// A continuacao escreveu "Nao ha card novo a emitir" e chamou propose_action assim mesmo. O ramo
// criar_anuncio_a_partir_de LEU os cards desta conversa (ed6a402d ja executado, mesmo conjunto,
// mesmo molde) e usou a leitura so para desempatar conjunto: nada no servidor recusava o repetido.
// A prosa do modelo nao e portao. O portao e o servidor, antes do compliance.
//
// Regra: mesmo conjunto destino + mesma peca, com card que ainda vai criar (pendente, aprovado
// com execucao em curso) ou que ja criou (executado), e repetido. Nao e repetido o que nao criou
// nada na Meta (recusado, expirado, execucao falha) nem o anuncio que o espelho ja marca como
// apagado. O estado vem de situacaoDoCard — a mesma leitura de get_aprovacoes —, nao daqui.

import { type EstadoDoCard, type LinhaAprovacao, situacaoDoCard } from "./aprovacoes.ts";

export const ERRO_CARD_REPETIDO = "card_repetido_no_conjunto";

/** Estados em que o anuncio existe ou vai existir sem ninguem pedir de novo. */
const ESTADOS_QUE_SEGURAM: EstadoDoCard[] = ["aguardando_decisao", "aguardando_execucao", "executado"];

export type CardDeAnuncioLido = LinhaAprovacao & {
  id?: string | null;
  created_at?: string | null;
  payload?: Record<string, unknown> | null;
};

/** A peca que o ramo resolveu para o pedido atual. */
export type PedidoDeAnuncio = {
  conjuntoDestinoExternalId: string;
  /** Replicacao: o anuncio molde resolvido no espelho. */
  moldeExternalId?: string | null;
  moldeNome?: string | null;
  moldeCreativeId?: string | null;
  /** Peca nova: a midia do pedido. */
  driveFileId?: string | null;
  metaVideoId?: string | null;
  metaImageHash?: string | null;
  nomeNovo?: string | null;
  legenda?: string | null;
};

export type CardRepetido = {
  approval_id: string;
  estado: EstadoDoCard;
  situacao: string;
  id_criado_na_meta: string | null;
  criado_em: string | null;
};

const txt = (v: unknown) => String(v ?? "").trim();
const normNome = (v: unknown) =>
  txt(v).normalize("NFD").replace(/\p{M}/gu, "").toLowerCase().replace(/\s+/g, " ");
const normLegenda = (v: unknown) => normNome(v).replace(/[^a-z0-9]+/g, " ").trim();
const igual = (a: unknown, b: unknown) => !!txt(a) && txt(a) === txt(b);

function mesmaPeca(payload: Record<string, unknown>, idCriado: string | null, p: PedidoDeAnuncio): boolean {
  const temMidia = !!(txt(p.driveFileId) || txt(p.metaVideoId) || txt(p.metaImageHash));
  if (temMidia) {
    const mesmaMidia = igual(payload.drive_file_id, p.driveFileId) ||
      igual(payload.meta_video_id, p.metaVideoId) ||
      igual(payload.meta_image_hash, p.metaImageHash);
    if (!mesmaMidia) return false;
    // Mesmo video com outro nome E outra legenda e teste de texto no mesmo conjunto: legitimo.
    const mesmoNome = !!normNome(p.nomeNovo) && normNome(payload.nome_novo) === normNome(p.nomeNovo);
    const mesmaLegenda = !!normLegenda(p.legenda) && normLegenda(payload.legenda) === normLegenda(p.legenda);
    return mesmoNome || mesmaLegenda;
  }
  return igual(payload.molde_external_id, p.moldeExternalId) ||
    // Depois da execucao o espelho tem dois anuncios com o nome do molde; o ramo acha o molde por
    // nome e pode cair na copia, cujo external_id e o id criado pelo card anterior.
    igual(idCriado, p.moldeExternalId) ||
    (!!normNome(p.moldeNome) && normNome(payload.molde_nome) === normNome(p.moldeNome)) ||
    igual(payload.creative_id, p.moldeCreativeId);
}

/**
 * Card desta conversa que ja cobre o pedido, ou null. `cards` sao linhas de approval_requests de
 * criar_anuncio_a_partir_de; `anunciosRemovidos` sao external_id que o espelho marca DELETED/ARCHIVED.
 */
export function cardRepetidoDoAnuncio(
  cards: CardDeAnuncioLido[] | null | undefined,
  pedido: PedidoDeAnuncio,
  opts?: { anunciosRemovidos?: Iterable<string> | null },
): CardRepetido | null {
  const conjunto = txt(pedido.conjuntoDestinoExternalId);
  if (!conjunto) return null;
  const removidos = new Set([...(opts?.anunciosRemovidos ?? [])].map(txt).filter(Boolean));
  for (const c of cards ?? []) {
    const payload = (c?.payload ?? {}) as Record<string, unknown>;
    if (txt(payload.conjunto_destino_external_id) !== conjunto) continue;
    const s = situacaoDoCard(c);
    if (!ESTADOS_QUE_SEGURAM.includes(s.estado)) continue;
    if (s.id_criado_na_meta && removidos.has(s.id_criado_na_meta)) continue;
    if (!mesmaPeca(payload, s.id_criado_na_meta, pedido)) continue;
    return {
      approval_id: txt(c.id),
      estado: s.estado,
      situacao: s.situacao,
      id_criado_na_meta: s.id_criado_na_meta,
      criado_em: c.created_at ? String(c.created_at) : null,
    };
  }
  return null;
}

/** Retorno de propose_action quando o pedido repete um card. */
export function recusaDeCardRepetido(
  r: CardRepetido,
  ctx: { conjuntoNome?: string | null; peca?: string | null },
): { erro: string; detalhe: string; card_existente: CardRepetido; instrucao: string } {
  const conj = txt(ctx.conjuntoNome) || "o conjunto destino";
  const peca = txt(ctx.peca) || "esta peca";
  return {
    erro: ERRO_CARD_REPETIDO,
    detalhe:
      `NAO emiti o card: o card ${r.approval_id} desta conversa ja leva '${peca}' para '${conj}' ` +
      `(estado ${r.estado}: ${r.situacao})` +
      (r.id_criado_na_meta ? `. O anuncio ${r.id_criado_na_meta} ja existe nesse conjunto` : "") +
      `. Outro card criaria um segundo anuncio igual no mesmo conjunto.`,
    card_existente: r,
    instrucao:
      "NAO chame propose_action de novo para esta peca neste conjunto. Diga ao gestor o card existente " +
      "e o estado lido aqui. aguardando_execucao NAO e 'a execucao nao rodou': a execucao dispara com a " +
      "aprovacao e leva segundos; releia get_aprovacoes antes de afirmar falha. Se o gestor quer mesmo " +
      "um segundo anuncio igual no mesmo conjunto, isso e decisao dele no Gerenciador.",
  };
}

/** Recusa de repetido e erro DURO: o bloco seguinte so levaria a mesma recusa. */
export function ehRecusaDeCardRepetido(erro: unknown): boolean {
  return txt(erro) === ERRO_CARD_REPETIDO;
}
