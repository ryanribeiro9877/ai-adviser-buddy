// Ordem de varredura do nivel ads. Modulo puro (sem Deno) para o vitest testar.

// 08/10/2026: o nivel ads listava, para CADA conta, todas as campanhas da empresa.
// A Legal e Viver tem 17 contas e ~84 campanhas: a primeira conta (sem nenhuma
// campanha ativa) gastava os 115s inteiros em get_ads de campanhas de outras contas
// e todas as demais saiam "pulado_por_prazo" — inclusive as duas da COHAPM, que
// ficaram sem anuncio novo desde 06/10 e com o gasto fora do rollup de campanha.
// Agora cada conta so lista as campanhas dela, ativas primeiro.
export function campanhasDaConta(
  campanhas: { external_id: string; conta: string | null; ativa: boolean }[],
  accountId: string,
) {
  return campanhas
    .filter((c) => c.conta === accountId)
    .sort((a, b) => Number(b.ativa) - Number(a.ativa))
    .map((c) => c.external_id);
}

// Conta com mais campanha ativa vai primeiro: se o prazo cortar, corta a conta parada.
export function ordenarContasPorAtividade<T extends { external_id: unknown }>(
  contas: T[],
  campanhas: { conta: string | null; ativa: boolean }[],
) {
  const ativas = new Map<string, number>();
  for (const c of campanhas) {
    if (c.ativa && c.conta) ativas.set(c.conta, (ativas.get(c.conta) ?? 0) + 1);
  }
  const chave = (r: T) => String(r.external_id).replace(/^act_/, "");
  return [...contas].sort((a, b) => (ativas.get(chave(b)) ?? 0) - (ativas.get(chave(a)) ?? 0));
}

// Prazo justo: cada conta com campanha ativa que ainda falta rodar leva uma fatia igual
// do tempo que resta. Sem isto a 3302001729967572 (39 campanhas, 97 anuncios com
// detalhe e criativo) consumia os 125s sozinha e a COHAPM, segunda da fila, nunca rodava.
// Conta sem campanha ativa nao reserva fatia: usa o que sobrar, no fim da fila.
export function fatiaDoPrazo(agora: number, prazoAte: number, ativaEstaConta: boolean, ativasRestantes: number) {
  if (!ativaEstaConta || ativasRestantes <= 1) return prazoAte;
  return agora + Math.max(0, prazoAte - agora) / ativasRestantes;
}

// 08/10/2026: a rodada respondia ok:true com truncado=true e a COHAPM "pulado_por_prazo",
// e o registro gravava "sucesso" — dois dias sem anuncio novo sem ninguem saber.
// Conta com campanha ativa que nao sincronizou (pulada pelo prazo ou com erro) vai para
// esta lista; conferir_execucoes_http le o campo, marca a rodada como falha parcial e
// emite um alerta por conta. Conta sem campanha ativa pulada nao e problema: fica de fora.
export type ContaFora = { company_id: string; account_id: string; motivo: "pulado_por_prazo" | "erro"; erro?: string };

export function contasAtivasFora(
  reports: { company_id: string; account_id: string; pulado_por_prazo?: boolean; error?: string; [k: string]: unknown }[],
  contasComAtiva: Set<string>,
): ContaFora[] {
  return reports.flatMap((r): ContaFora[] => {
    if (!contasComAtiva.has(String(r.account_id).replace(/^act_/, ""))) return [];
    if (r.pulado_por_prazo) return [{ company_id: r.company_id, account_id: r.account_id, motivo: "pulado_por_prazo" }];
    if (r.error) return [{ company_id: r.company_id, account_id: r.account_id, motivo: "erro", erro: String(r.error).slice(0, 300) }];
    return [];
  });
}
