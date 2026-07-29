// Exportação de tabelas para .xlsx no navegador. O SheetJS entra por import
// dinâmico (o mesmo padrão do parser de anexos), então o chunk só é baixado
// quando alguém realmente exporta.

export type Linha = Record<string, string | number | null | undefined>;

/** Nome de arquivo com período: relatorio_2026-07-22_a_2026-07-28.xlsx */
export function nomeComPeriodo(prefixo: string, inicio: string, fim: string) {
  return `${prefixo}_${inicio}_a_${fim}.xlsx`;
}

export async function exportarXlsx(
  linhas: Linha[],
  nomeArquivo: string,
  nomeAba = "Dados",
): Promise<void> {
  const mod = await import("xlsx");
  const XLSX = (mod as unknown as { default?: typeof mod }).default ?? mod;
  const ws = XLSX.utils.json_to_sheet(linhas);
  const wb = XLSX.utils.book_new();
  // O Excel rejeita nome de aba com mais de 31 chars.
  XLSX.utils.book_append_sheet(wb, ws, nomeAba.slice(0, 31));
  XLSX.writeFile(wb, nomeArquivo);
}
