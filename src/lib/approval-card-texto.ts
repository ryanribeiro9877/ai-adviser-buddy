// Texto visível do card de aprovação: título curto + prévia de nomes.
// O summary gravado no banco pode ser um ensaio (compliance, visão, ESP-*);
// a UI NÃO o despeja. Detalhe operacional fica no payload.

const TITULO_POR_ACAO: Record<string, string> = {
  criar_campanha: "Card de criação de campanha",
  criar_conjunto_a_partir_de: "Card de criação de conjunto",
  criar_conjunto: "Card de criação de conjunto",
  criar_criativo: "Card de criação de criativo",
  criar_criativo_carrossel: "Card de criação de carrossel",
  trocar_criativo_do_anuncio: "Card de trocar criativo do anúncio",
  criar_anuncio_a_partir_de: "Card de criação de anúncio",
  escalar_duplicar: "Card de escala de conjunto",
  pausar_criativo: "Card de pausar criativo",
  ativar_criativo: "Card de ativar criativo",
  escalar_criativo: "Card de escalar criativo",
  pausar_campanha: "Card de pausar campanha",
  ativar_campanha: "Card de ativar campanha",
  pausar_conjunto: "Card de pausar conjunto",
  ativar_conjunto: "Card de ativar conjunto",
  alterar_orcamento: "Card de alterar orçamento",
  renomear_campanha: "Card de renomear campanha",
  renomear_conjunto: "Card de renomear conjunto",
  renomear_criativo: "Card de renomear criativo",
  alterar_categoria_especial_campanha: "Card de alterar categoria especial",
  ajustar_posicionamentos_do_conjunto: "Card de ajustar posicionamentos",
  alterar_geo_do_conjunto: "Card de alterar geo do conjunto",
  alterar_publico_do_conjunto: "Card de alterar público do conjunto",
  alterar_idade_do_conjunto: "Card de alterar idade do conjunto",
  vincular_instagram_dos_anuncios: "Card de vincular Instagram",
  registrar_veredito_peca: "Card de veredito de compliance",
};

const ACOES_CRIACAO = new Set([
  "criar_campanha",
  "criar_conjunto_a_partir_de",
  "criar_conjunto",
  "criar_criativo",
  "criar_criativo_carrossel",
  "criar_anuncio_a_partir_de",
  "escalar_duplicar",
]);

function campo(payload: unknown, ...chaves: string[]): string | null {
  if (!payload || typeof payload !== "object") return null;
  const p = payload as Record<string, unknown>;
  for (const k of chaves) {
    const v = p[k];
    if (typeof v === "string" && v.trim()) return v.trim();
  }
  return null;
}

export function tituloDoCardAprovacao(
  action: string | null | undefined,
  summary?: string | null,
): string {
  const acao = String(action ?? "").trim();
  if (acao && TITULO_POR_ACAO[acao]) return TITULO_POR_ACAO[acao];
  const primeira = String(summary ?? "")
    .split(/\n/)[0]
    .trim();
  if (primeira && primeira.length <= 80 && !/compliance|ESP-|PECA NOVA|molde/i.test(primeira)) {
    return primeira;
  }
  return acao || "Card de aprovação";
}

export function ehCardDeCriacao(action: string | null | undefined): boolean {
  return ACOES_CRIACAO.has(String(action ?? "").trim());
}

/** Prévia: só nomes de campanha / conjunto / criativo. Sem compliance, visão ou doutrina. */
export function previaDoCardAprovacao(
  action: string | null | undefined,
  payload: unknown,
): { campanha?: string; conjunto?: string; criativo?: string } {
  const acao = String(action ?? "").trim();
  const campanha = campo(payload, "campanha_destino_nome", "campanha_nome", "nome_campanha");
  const conjunto = campo(payload, "conjunto_destino_nome", "conjunto_nome", "nome_conjunto");
  const criativo = campo(payload, "nome_novo", "nome_criativo", "target_name");

  if (acao === "criar_campanha") {
    return { campanha: campo(payload, "nome_novo") ?? campanha ?? undefined };
  }
  if (acao === "criar_conjunto_a_partir_de" || acao === "criar_conjunto" || acao === "escalar_duplicar") {
    return {
      campanha: campanha ?? undefined,
      conjunto: campo(payload, "nome_novo") ?? conjunto ?? undefined,
    };
  }
  if (acao === "criar_criativo" || acao === "criar_criativo_carrossel") {
    return {
      criativo: campo(payload, "nome_novo", "nome") ?? criativo ?? undefined,
    };
  }
  if (acao === "trocar_criativo_do_anuncio") {
    return { criativo: campo(payload, "target_name") ?? criativo ?? undefined };
  }
  if (acao === "criar_anuncio_a_partir_de") {
    return {
      campanha: campanha ?? undefined,
      conjunto: conjunto ?? undefined,
      criativo: campo(payload, "nome_novo") ?? criativo ?? undefined,
    };
  }
  if (
    acao === "pausar_conjunto" ||
    acao === "ativar_conjunto" ||
    acao === "ajustar_posicionamentos_do_conjunto" ||
    acao === "alterar_geo_do_conjunto" ||
    acao === "alterar_publico_do_conjunto" ||
    acao === "renomear_conjunto"
  ) {
    return { conjunto: campo(payload, "target_name") ?? conjunto ?? undefined };
  }
  if (
    acao === "pausar_campanha" ||
    acao === "ativar_campanha" ||
    acao === "renomear_campanha" ||
    acao === "alterar_orcamento" ||
    acao === "alterar_categoria_especial_campanha"
  ) {
    return { campanha: campo(payload, "target_name", "novo_nome") ?? campanha ?? undefined };
  }
  if (
    acao === "pausar_criativo" ||
    acao === "ativar_criativo" ||
    acao === "escalar_criativo" ||
    acao === "renomear_criativo"
  ) {
    return { criativo: campo(payload, "target_name") ?? criativo ?? undefined };
  }
  if (acao === "vincular_instagram_dos_anuncios") {
    return {
      campanha: campo(payload, "campanha_destino_nome", "target_name") ?? campanha ?? undefined,
    };
  }
  return {
    campanha: campanha ?? undefined,
    conjunto: conjunto ?? undefined,
    criativo: criativo ?? undefined,
  };
}

function nomesDoSummary(summary?: string | null): {
  campanha?: string;
  conjunto?: string;
  criativo?: string;
} {
  const out: { campanha?: string; conjunto?: string; criativo?: string } = {};
  for (const line of String(summary ?? "").split(/\n/)) {
    const m = line.trim().match(/^(Campanha|Conjunto|Criativo):\s*(.+)$/i);
    if (!m) continue;
    const valor = m[2].trim();
    if (!valor) continue;
    const rotulo = m[1].toLowerCase();
    if (rotulo === "campanha") out.campanha = valor;
    else if (rotulo === "conjunto") out.conjunto = valor;
    else out.criativo = valor;
  }
  return out;
}

export function textoDaExecucao(resultado: unknown): { tom: "ok" | "alerta" | "falha"; texto: string } {
  const r = resultado && typeof resultado === "object" ? resultado as Record<string, unknown> : {};
  const releitura = String(r.releitura ?? "");
  const campos = Array.isArray(r.campos_releitura) ? r.campos_releitura as { campo?: string; veredito?: string }[] : [];
  const lista = campos
    .map((c) => `${c.campo ?? "campo"} (${c.veredito ?? "?"})`)
    .join("; ");
  if (releitura === "gravado_diferente") {
    return {
      tom: "alerta",
      texto: `Gravado diferente do pedido${lista ? `: ${lista}` : ""}. Isso não é execução limpa.`,
    };
  }
  if (releitura === "releitura_falhou") {
    return {
      tom: "falha",
      texto: "A Meta aceitou a escrita, mas a releitura falhou. Não dá para dizer que ficou como foi pedido.",
    };
  }
  if (releitura === "conferido") {
    const norm = campos.filter((c) => c.veredito === "normalizado");
    const extra = norm.length
      ? ` A Meta normalizou: ${norm.map((c) => c.campo).join(", ")}.`
      : "";
    return { tom: "ok", texto: `Conferido na Meta.${extra}` };
  }
  if (r.ok === false) {
    return {
      tom: "falha",
      texto: "A execução terminou com escrita parcial. Confira no Gerenciador antes de tentar de novo.",
    };
  }
  return { tom: "ok", texto: "Executado." };
}

export function linhasPreviaDoCard(
  action: string | null | undefined,
  payload: unknown,
  summary?: string | null,
): { rotulo: string; valor: string }[] {
  const p = previaDoCardAprovacao(action, payload);
  const s = nomesDoSummary(summary);
  const merged = {
    campanha: p.campanha ?? s.campanha,
    conjunto: p.conjunto ?? s.conjunto,
    criativo: p.criativo ?? s.criativo,
  };
  const out: { rotulo: string; valor: string }[] = [];
  if (merged.campanha) out.push({ rotulo: "Campanha", valor: merged.campanha });
  if (merged.conjunto) out.push({ rotulo: "Conjunto", valor: merged.conjunto });
  if (merged.criativo) out.push({ rotulo: "Criativo", valor: merged.criativo });
  const bag = payload && typeof payload === "object" ? payload as Record<string, unknown> : {};
  const validado = String(bag.validado_na_meta_em ?? "").trim();
  if (validado) out.push({ rotulo: "Validado na Meta em", valor: validado });
  else if (bag.validacao === "nao_testado") out.push({ rotulo: "Validação", valor: "não testado na Meta" });
  return out;
}
