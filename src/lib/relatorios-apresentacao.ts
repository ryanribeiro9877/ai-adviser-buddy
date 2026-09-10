/** Só a tela. Não vai para a edge: traduz jargão do job para o gestor ler. */

const TROCAS: readonly [RegExp, string][] = [
  [/\bdesempenho_campanhas\b/gi, "leitura de desempenho"],
  [/\bestrutura_conta\b/gi, "leitura da estrutura"],
  [/\balertas_recomendacoes\b/gi, "fila de alertas"],
  [/\bopenrouter_timeout\b/gi, "tempo esgotado na leitura"],
  [/\bamostra_pequena\s*=\s*true\b/gi, "amostra pequena"],
  [/\bamostra_pequena\s*=\s*false\b/gi, "amostra suficiente"],
  [/\bbudget_remaining\s*=\s*0\b/gi, "orçamento restante zerado"],
  [/\bspecial_ad_categories\s*=\s*\[\s*\]\b/gi, "sem categoria especial"],
  [/\bsomente_ativas\s*=\s*true\b/gi, "só ativas"],
  [/\beffective_status\b/gi, "status real"],
  [/\bconfigured_status\b/gi, "status configurado"],
  [/\bwaba_de_pe_connected\s*=\s*0\b/gi, "nenhum WhatsApp Cloud conectado"],
  [/\bctwa_em_anuncios_ativos_entregando\s*=\s*0\b/gi, "nenhum clique-to-WhatsApp entregando agora"],
  [/\bsem_regua\b/gi, "sem régua da casa"],
  [/\bON_PREMISE\b/g, "WhatsApp local"],
  [/\bDISCONNECTED\b/g, "desconectado"],
  [/\bCONNECTED\b/g, "conectado"],
  [/\bIN_ADS\b/g, "no anúncio"],
];

export function limparJargaoRelatorio(texto: string): string {
  let out = String(texto ?? "");
  for (const [re, sub] of TROCAS) out = out.replace(re, sub);
  return out.replace(/[ \t]{2,}/g, " ").trim();
}

export function rotuloNivelRelatorio(nivel: string): string {
  if (nivel === "conta") return "Conta";
  if (nivel === "campanha") return "Campanha";
  if (nivel === "conjunto") return "Conjunto";
  if (nivel === "anuncio") return "Anúncio";
  return nivel || "—";
}

export function rotuloSeveridadeRelatorio(sev: string): string {
  if (sev === "urgente") return "Urgente";
  if (sev === "atencao") return "Atenção";
  if (sev === "info") return "Informativo";
  return sev;
}

export function rotuloTipoAchado(tipo: string): string {
  if (tipo === "teto") return "Teto";
  if (tipo === "custo_elevado") return "Custo elevado";
  if (tipo === "monitoramento_reforcado") return "Vigiar de perto";
  if (tipo === "fadiga") return "Fadiga";
  if (tipo === "escala") return "Escala";
  if (tipo === "pausa_com_guarda") return "Pausa com guarda";
  if (tipo === "hipotese") return "Hipótese";
  return tipo;
}
