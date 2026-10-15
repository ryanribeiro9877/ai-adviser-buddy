/**
 * Prazo da validacao de compliance dentro de um turno do chat.
 *
 * O DEFEITO QUE ISTO CONSERTA (15/10/2026, conversa bf4a8869, 18:55 UTC): "agora atribua a
 * esse conjunto os criativos: AD_C2_CARTAO_ARMADILHA / AD_C3_VALOR_INCORRETO /
 * AD_C1_JUROS_ALTO" ficou sem resposta. O card 1 saiu aos 72s de turno (o compliance levou
 * ~29,7s); o compliance do card 2 comecou aos 73,5s e nao voltou. `t_check_compliance` fazia
 * `fetch` sem prazo, e o compliance-check chama a OpenRouter tambem sem prazo: o HTTP do chat
 * ficou preso ate o gateway cortar em 150s (504 as 18:57:58), antes de a resposta ser gravada.
 * O gestor nao soube nem do card 1.
 *
 * Regra: dentro do turno, o compliance tem ate o prazo das ferramentas (o mesmo HARD_LIMIT
 * menos a reserva de gravacao que o laco do chat ja respeita), nunca mais que o teto. Sem
 * resposta no prazo nao ha veredito — nem aprovacao nem reprovacao — e o card NAO nasce; o
 * turno grava o que tem e a continuacao automatica tenta de novo no proximo bloco.
 */

/**
 * Teto para quem chama sem prazo de turno. Medido em 15/10/2026 (function_edge_logs do
 * compliance-check): 29,7 / 30,2 / 31,3 / 33,7 / 45,5s. 60s deixa folga sobre o maior e ainda
 * cabe sob os 150s do gateway com a reserva de gravacao.
 */
export const COMPLIANCE_TETO_MS = 60_000;

/** Abaixo disso nao vale chamar: a validacao nao volta e o card nao sairia de qualquer jeito. */
export const COMPLIANCE_PISO_MS = 5_000;

/** Retorno de t_check_compliance quando a validacao nao respondeu no prazo. */
export const ERRO_COMPLIANCE_SEM_PRAZO = "compliance_sem_resposta_no_prazo";

/**
 * Recusa do card de anuncio por falta de tempo de compliance. O nome comeca com "orcamento"
 * de proposito: o fim do turno do chat le isso como falta de janela (continua no proximo
 * bloco), nao como falha dura (`compliance_bloqueou`, que para o turno).
 */
export const ERRO_CARD_SEM_TEMPO_DE_COMPLIANCE = "orcamento_tempo_compliance";

/** Quanto o compliance pode esperar agora. `prazoEm` e epoch ms; ausente = teto. */
export function prazoDoCompliance(agora: number, prazoEm?: number | null): number {
  if (prazoEm == null || !Number.isFinite(prazoEm)) return COMPLIANCE_TETO_MS;
  return Math.max(0, Math.min(COMPLIANCE_TETO_MS, Math.floor(prazoEm - agora)));
}

export type LeituraComPrazo =
  | { estourou: false; status: number; texto: string }
  | { estourou: true; prazoMs: number };

/**
 * `fetch` com prazo que cobre cabecalho E corpo. Prazo abaixo do piso nem chama. Erro de rede
 * continua sendo erro (lanca), como era antes — so a espera longa vira `estourou`.
 */
export async function buscarComPrazo(
  fetcher: typeof fetch,
  url: string,
  init: RequestInit,
  prazoMs: number,
): Promise<LeituraComPrazo> {
  if (!(prazoMs >= COMPLIANCE_PISO_MS)) return { estourou: true, prazoMs: Math.max(0, prazoMs || 0) };
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), prazoMs);
  try {
    const r = await fetcher(url, { ...init, signal: ac.signal });
    const texto = await r.text();
    return { estourou: false, status: r.status, texto };
  } catch (e) {
    if (ac.signal.aborted) return { estourou: true, prazoMs };
    throw e;
  } finally {
    clearTimeout(timer);
  }
}

export function complianceSemPrazo(comp: unknown): boolean {
  return !!comp && typeof comp === "object" &&
    (comp as { erro?: unknown }).erro === ERRO_COMPLIANCE_SEM_PRAZO;
}

/** O que propose_action devolve quando o card de anuncio ficou sem veredito por prazo. */
export function recusaPorPrazoDoCompliance(comp: unknown): {
  erro: string;
  aviso: string;
  prazo_ms: number | null;
} {
  const ms = Number((comp as { prazo_ms?: unknown } | null)?.prazo_ms);
  return {
    erro: ERRO_CARD_SEM_TEMPO_DE_COMPLIANCE,
    aviso:
      "A validacao de compliance nao respondeu dentro da janela desta resposta, entao este card nao foi criado " +
      "(nada foi aprovado nem reprovado). O sistema continua no proximo bloco. NAO diga que o card saiu e NAO " +
      "peca ao gestor para repetir o pedido.",
    prazo_ms: Number.isFinite(ms) ? ms : null,
  };
}
