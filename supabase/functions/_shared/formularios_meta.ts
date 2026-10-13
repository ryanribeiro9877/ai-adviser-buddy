// Formulario enviado: qual contador de uma linha de insights da Meta conta como formulario.
//
// POR QUE ESTE ARQUIVO EXISTE (13/10/2026). O relatorio semanal da Lafelicita LP
// (COHAPM_LAFELICITA_LEADS_LP_2026-10, 120250380225140182) disse "R$ 2.001,61 e 0 formularios"
// de 06 a 12/10 e recomendou testar a pagina e pausar. A Meta registrou 63 formularios na mesma
// janela (0, 12, 1, 8, 7, 7, 28 por dia; Resultados oficiais, atribuicao padrao). Medido no
// mesmo dia:
//   - o formulario da LP dispara o evento padrao SubmitApplication, e o conjunto otimiza para
//     ele (`results` = "conversions:submit_application_website");
//   - a Meta devolve esse evento no campo `conversions`, NAO em `actions`;
//   - os dois coletores so liam `actions` com action_type `lead` / `onsite_conversion.lead_grouped`
//     e gravavam form_leads = 0 em todas as 120 linhas da campanha.
// A outra LP da conta (Ocular, evento Lead) estava certa: 13 no banco, 13 na Meta. O defeito
// so aparece quando o site usa outro evento padrao de formulario — e ai aparece como zero, que
// ninguem desconfia.
//
// DUAS CAMADAS, NESTA ORDEM DE AUTORIDADE:
//   1. `results` da Meta (o "Resultados" do Gerenciador). Diz qual evento o conjunto otimiza e
//      quantos houve. Quando esse evento e de formulario, ele MANDA no form_leads da linha.
//      So vem pelo bulk_get_insights (get_insights nao aceita `fields`).
//   2. Contadores da propria linha, para quando o passe de `results` falhar: `lead` primeiro
//      (formulario instantaneo e evento Lead do pixel, regra que ja existia e confere com a
//      Meta: 202 e 213 nas LPs da Legal e Viver em ago/26) e, so se ele for zero, o
//      SubmitApplication do site. Nunca soma os dois: o mesmo envio pode disparar Lead e
//      SubmitApplication (a Ocular tem 13 Lead e 16 SubmitApplication), e somar contaria a
//      mesma pessoa duas vezes.
//
// Indicador de conversao personalizada (`offsite_conversion.custom.<id>`) NAO e classificado
// aqui: o nome dela mora no Gerenciador de Eventos e pode ser qualquer coisa. Quem le o
// relatorio de coleta ve esses indicadores listados em vez de vê-los virar formulario por palpite.

function numero(value: unknown): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function inteiro(value: unknown): number {
  return Math.round(numero(value));
}

/** Soma os itens de `actions` ou `conversions` cujo action_type esta na lista. */
export function somaDeAcoes(row: unknown, campo: "actions" | "conversions", tipos: string[]): number {
  const o = row && typeof row === "object" ? row as Record<string, unknown> : {};
  const lista = Array.isArray(o[campo]) ? o[campo] as Record<string, unknown>[] : [];
  const quer = new Set(tipos);
  let total = 0;
  for (const item of lista) {
    if (quer.has(String(item?.action_type ?? item?.type ?? ""))) total += numero(item?.value);
  }
  return total;
}

/** Envio de formulario do site pelo evento padrao SubmitApplication. */
function submitApplicationDaLinha(row: unknown): number {
  const site = somaDeAcoes(row, "conversions", ["submit_application_website"]);
  if (site) return site;
  const pixel = somaDeAcoes(row, "actions", ["offsite_conversion.fb_pixel_submit_application"]);
  if (pixel) return pixel;
  return somaDeAcoes(row, "conversions", ["submit_application_total"]);
}

/** Camada 2: formularios pelos contadores da propria linha, sem `results`. */
export function formulariosDaLinhaMeta(row: unknown): number {
  const o = row && typeof row === "object" ? row as Record<string, unknown> : {};
  const lead = inteiro(o.form_leads) ||
    inteiro(o.actions_lead) ||
    inteiro(somaDeAcoes(o, "actions", ["lead", "onsite_conversion.lead_grouped"]));
  if (lead) return lead;
  return inteiro(submitApplicationDaLinha(o));
}

const EVENTO_DE_FORMULARIO = [
  /(^|[:.])lead$/,
  /(^|[:.])onsite_web_lead$/,
  /(^|[:.])lead_grouped$/,
  /(^|[:.])leadgen_grouped$/,
  /(^|[:.])fb_pixel_lead$/,
  /submit_application(_website|_total)?$/,
  /complete_registration(_website|_total)?$/,
];

/**
 * O indicador de `results` e de formulario? Ex.: "conversions:submit_application_website",
 * "actions:offsite_conversion.fb_pixel_lead", "actions:onsite_conversion.lead_grouped".
 * Conversa, clique, engajamento, compra e conversao personalizada ficam de fora.
 */
export function indicadorEhFormulario(indicador: string | null | undefined): boolean {
  const i = String(indicador ?? "").trim().toLowerCase();
  if (!i || i.includes("offsite_conversion.custom.") || i.includes("fb_pixel_custom")) return false;
  return EVENTO_DE_FORMULARIO.some((re) => re.test(i));
}

export type ResultadoOficial = { indicador: string; valor: number };

/**
 * Camada 1: o primeiro item de `results` da linha. `values` ausente com indicador presente e
 * resultado ZERO declarado pela Meta (o conjunto otimiza aquele evento e ele nao aconteceu),
 * nao falta de leitura.
 */
export function resultadoOficialDaLinha(row: unknown): ResultadoOficial | null {
  const o = row && typeof row === "object" ? row as Record<string, unknown> : {};
  const lista = Array.isArray(o.results) ? o.results as Record<string, unknown>[] : [];
  const primeiro = lista.find((r) => String(r?.indicator ?? "").trim());
  if (!primeiro) return null;
  const valores = Array.isArray(primeiro.values) ? primeiro.values as Record<string, unknown>[] : [];
  const padrao = valores.find((v) =>
    Array.isArray(v?.attribution_windows) && (v.attribution_windows as unknown[]).includes("default")
  ) ?? valores[0];
  return { indicador: String(primeiro.indicator).trim(), valor: inteiro(padrao?.value) };
}
