// A tela /campanhas gravava pause, activate e update_budget.
// O executor so conhece pausar_campanha, ativar_campanha e alterar_orcamento.
// O alias fica explicito aqui. Acao fora dos dois vocabularios nao vira "pulado".

const ALIAS: Record<string, string> = {
  pause: "pausar_campanha",
  activate: "ativar_campanha",
  update_budget: "alterar_orcamento",
};

export function canonicalizarAcaoDoCard(
  acao: string,
  payload: Record<string, unknown> | null | undefined,
): { acao: string; payload: Record<string, unknown>; alias: boolean } {
  const bruto = String(acao ?? "").trim();
  const canon = ALIAS[bruto] ?? bruto;
  const p: Record<string, unknown> = payload && typeof payload === "object" ? { ...payload } : {};
  if (canon === "alterar_orcamento") {
    const jaTem = Number(p.novo_orcamento_diario_reais ?? p.orcamento_diario_reais ?? 0);
    if (!(jaTem > 0) && p.new_budget != null && p.new_budget !== "") {
      const n = Number(p.new_budget);
      if (Number.isFinite(n) && n > 0) p.novo_orcamento_diario_reais = n;
    }
  }
  if ((canon === "pausar_campanha" || canon === "ativar_campanha") && !String(p.target_external_id ?? "").trim()) {
    const id = String(p.campaign_id ?? p.entity_id ?? "").trim();
    if (id) p.target_external_id = id;
  }
  return { acao: canon, payload: p, alias: canon !== bruto };
}
