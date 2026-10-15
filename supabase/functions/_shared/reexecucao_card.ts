// Prova de ida e volta do card de criacao. O card grava o pedido em jsonb; ao aprovar, a
// executora (meta-actions/montarCriacao) remonta o corpo a partir do que ficou gravado. Se a
// remontagem recusa ou difere do corpo que passou no pre-voo da Meta, o card nasce condenado:
// aprovado e morto na execucao. Em 15/10/2026 foram dois criar_conjunto assim (promoted_object
// gravado em texto). A prova roda antes de gravar e usa a mesma montagem da executora.
//
// Dois niveis. Conjunto por spec, criativo e carrossel tem montagem pura: a prova remonta o
// corpo inteiro e compara com o validado. Campanha, conjunto com molde, escala e anuncio
// dependem de leitura ao vivo na executora: a prova roda as recusas que saem so do payload
// (precondicoes_criacao.ts), as mesmas que montarCriacao roda primeiro.

import { validarSpecConjunto } from "./conjunto_spec.ts";
import { montarCriativoCarrossel, montarCriativoDeClique, recusarContagemDeSlides } from "./criativo_whatsapp.ts";
import { recusaDoPayloadDeCriacao } from "./precondicoes_criacao.ts";

export type Reexecucao = { ok: true } | { ok: false; erro: string; detalhe: string };

type Remontagem = { ok: true; corpo: Record<string, string> } | { ok: false; erro: string; detalhe: string };

export const ACOES_COM_PROVA_DE_REEXECUCAO = new Set(["criar_conjunto", "criar_criativo", "criar_criativo_carrossel"]);
export const ACOES_COM_PRECONDICAO = new Set([
  "criar_campanha",
  "criar_conjunto_a_partir_de",
  "escalar_duplicar",
  "criar_anuncio_a_partir_de",
]);

/** Texto JSON vira objeto e as chaves ficam em ordem: o jsonb reordena chaves e isso nao e divergencia. */
function canonico(v: unknown): unknown {
  if (typeof v === "string") {
    const s = v.trim();
    if (s.startsWith("{") || s.startsWith("[")) {
      try {
        return canonico(JSON.parse(s));
      } catch {
        return v;
      }
    }
    return v;
  }
  if (Array.isArray(v)) return v.map(canonico);
  if (v && typeof v === "object") {
    const o = v as Record<string, unknown>;
    return Object.fromEntries(Object.keys(o).sort().map((k) => [k, canonico(o[k])]));
  }
  return v;
}

/** Mesma sequencia de montarCriacao na meta-actions para estas acoes. */
function remontar(acao: string, payload: Record<string, unknown>): Remontagem {
  if (acao === "criar_conjunto") {
    const s = validarSpecConjunto(payload);
    return s.ok ? { ok: true, corpo: s.corpo } : s;
  }
  const slides = recusarContagemDeSlides(acao, payload);
  if (slides) return slides;
  const c = acao === "criar_criativo_carrossel" ? montarCriativoCarrossel(payload) : montarCriativoDeClique(payload);
  return c.ok ? { ok: true, corpo: c.body } : c;
}

export function conferirReexecucaoDoCard(
  acao: string,
  payload: Record<string, unknown>,
  corpoValidado: Record<string, string> | null,
): Reexecucao {
  const gravado = JSON.parse(JSON.stringify(payload)) as Record<string, unknown>;

  if (ACOES_COM_PRECONDICAO.has(acao)) {
    const recusa = recusaDoPayloadDeCriacao(acao, gravado);
    if (!recusa) return { ok: true };
    // O erro e o detalhe sao os da executora: o agente corrige o pedido (ex.: pede o numero
    // do WhatsApp) em vez de receber um generico.
    return {
      ok: false,
      erro: recusa.erro,
      detalhe:
        `O card nao foi criado: ao aprovar, a executora recusaria (${recusa.erro}). ${recusa.detalhe ?? ""} ` +
        "Se faltou dado no pedido, peca ao gestor e proponha de novo. Se o pedido ja trazia o dado, e defeito do sistema: avise o gestor.",
    };
  }

  if (!ACOES_COM_PROVA_DE_REEXECUCAO.has(acao) || !corpoValidado) return { ok: true };
  const r = remontar(acao, gravado);
  if (!r.ok) {
    return {
      ok: false,
      erro: "card_nao_reexecutavel",
      detalhe:
        `Ao aprovar, a executora recusaria este card (${r.erro}: ${r.detalhe}). ` +
        "Defeito do sistema, nao do pedido. Nao contorne mudando o pedido: avise o gestor que o card nao foi criado.",
    };
  }
  const chaves = [...new Set([...Object.keys(corpoValidado), ...Object.keys(r.corpo)])];
  const divergentes = chaves.filter((k) =>
    JSON.stringify(canonico(corpoValidado[k])) !== JSON.stringify(canonico(r.corpo[k]))
  );
  if (divergentes.length) {
    return {
      ok: false,
      erro: "card_nao_reexecutavel",
      detalhe:
        `Ao aprovar, a executora montaria um corpo diferente do validado na Meta em: ${divergentes.join(", ")}. ` +
        "Defeito do sistema, nao do pedido. Nao contorne mudando o pedido: avise o gestor que o card nao foi criado.",
    };
  }
  return { ok: true };
}
