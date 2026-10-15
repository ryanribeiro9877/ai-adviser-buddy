// Resgate da coleta de um especialista que leu e nao escreveu.
//
// 15/10/2026, job cb099406: o especialista de desempenho chamou 17 ferramentas (campanha,
// conjuntos, 30 anuncios lidos) e morreu no timeout do provider antes de escrever. O codigo
// declarava "a coleta paga se perde aqui" e a sintese recebia so o rotulo de falha: a resposta
// disse "nao coletado nesta rodada" para numeros que estavam na memoria do job. Aqui o que as
// ferramentas devolveram vira relatorio literal, sem analise, e a sintese escreve em cima dele.

import { montarRelacaoDeDetalhe } from "./coleta_completa.ts";

/** Ferramentas que nao trazem dado da conta: nada a resgatar. */
const SEM_DADO_DA_CONTA = new Set(["get_conhecimento", "teto_vigente", "listar_ferramentas_pipeboard"]);

export const RESGATE_TETO_POR_FERRAMENTA = 6_000;
export const RESGATE_TETO_TOTAL = 36_000;

/**
 * Texto que sobrevive de UMA chamada de ferramenta. `get_detalhe_anuncios` sai como a mesma
 * tabela da colheita (conjunto + criativo); o resto sai como JSON literal, cortado.
 * Retorno com erro, ambiguidade ou sem dado da conta nao entra: resgatar falha seria inventar.
 */
export function textoDeResgate(ferramenta: string, retorno: unknown): string | null {
  if (SEM_DADO_DA_CONTA.has(ferramenta)) return null;
  if (!retorno || typeof retorno !== "object") return null;
  const r = retorno as Record<string, unknown>;
  if (typeof r.erro === "string" || r.ambiguo === true) return null;
  if (ferramenta === "get_detalhe_anuncios") {
    const md = montarRelacaoDeDetalhe(r, false, false);
    if (md) return `[${ferramenta}]\n${md}`.slice(0, RESGATE_TETO_POR_FERRAMENTA);
  }
  if (typeof r.tabela_markdown === "string" && r.tabela_markdown.trim()) {
    return `[${ferramenta}]\n${r.tabela_markdown}`.slice(0, RESGATE_TETO_POR_FERRAMENTA);
  }
  let json = "";
  try {
    json = JSON.stringify(r);
  } catch {
    return null;
  }
  return `[${ferramenta}] ${json}`.slice(0, RESGATE_TETO_POR_FERRAMENTA);
}

/**
 * Relatorio literal a partir do que as ferramentas devolveram. Null quando nao ha nada lido:
 * ai o especialista continua sendo lacuna, e a sintese diz que ninguem leu.
 */
export function relatorioDeResgate(motivo: string, colhidos: string[]): string | null {
  const unicos = [...new Set(colhidos.filter((c) => c && c.trim()))];
  if (!unicos.length) return null;
  const partes: string[] = [];
  let total = 0;
  let fora = 0;
  for (const c of unicos) {
    if (total + c.length > RESGATE_TETO_TOTAL) {
      fora++;
      continue;
    }
    partes.push(c);
    total += c.length;
  }
  const lacunas = [
    "a analise do especialista nao foi escrita (so os numeros abaixo)",
    fora ? `${fora} leitura(s) ficaram fora deste resgate por tamanho — existem, nao foram repassadas` : "",
  ].filter(Boolean).join("; ");
  return [
    `Coleta lida pelas ferramentas nesta rodada. O especialista nao chegou a escrever (${motivo}). Numeros literais das ferramentas, sem analise:`,
    "",
    partes.join("\n\n"),
    "",
    `LACUNAS: ${lacunas}.`,
  ].join("\n");
}
