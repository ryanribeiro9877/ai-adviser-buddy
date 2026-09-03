// Fonte UNICA de formula para os indicadores de midia.
//
// POR QUE (auditoria de 03/09/2026 sobre o repositorio inteiro): o mesmo rotulo "CPL" /
// "custo por lead" e calculado hoje com QUATRO denominadores diferentes, em codigo que roda
// em producao:
//
//   base `leads` (= form_leads + messaging_started)  -> v_campaign_breakdown, dashboard,
//                                                       campanhas.tsx, use-period.ts, mcp-server
//   base `form_leads`                                -> motor de alertas, relatorio semanal,
//                                                       decidir_sobre_conjunto, diagnosticar_custo
//   base `messaging_started`                         -> funil de mensagem, alertas R1/R5
//   base `link_clicks` (rotulado custo_por_lead_lp)  -> traffic-chat, funil.tsx ("Custo por lead")
//
// Com gasto R$ 300, 5 formularios, 10 conversas e 20 cliques no link, o MESMO periodo produz
// R$ 20,00 / R$ 60,00 / R$ 30,00 / R$ 15,00 dependendo de qual pedaco do sistema responde.
// Nenhum modelo de linguagem participa disso: e divergencia de codigo. Enquanto ela existe,
// texto canonico nao resolve nada — o molde emitiria com autoridade um numero que o painel
// contradiz na tela ao lado.
//
// A DECISAO DE DESENHO: nao existe funcao `cpl()` neste modulo, e isso e deliberado. Um nome
// que nao carrega o denominador convida o proximo chamador a escolher o dele. Aqui a base faz
// parte do nome e do retorno, entao duas leituras com bases diferentes sao distinguiveis na
// resposta em vez de parecerem a mesma coisa com numeros diferentes.
//
// ESTE MODULO NAO LE BANCO. Recebe contadores brutos e devolve valores. Isso o torna
// reprodutivel byte a byte na prova, que e o requisito da camada.

/** Contadores brutos de um dia de um objeto (anuncio, conjunto ou campanha). */
export type ContadoresDoDia = {
  /** Data do snapshot. Em ad_metric_snapshots a coluna e `snapshot_date`, nao `date`. */
  snapshot_date: string;
  spend: number;
  impressions: number;
  /** Cliques TOTAIS (inclui reacao, comentario, expansao de foto). */
  clicks: number;
  /** Cliques no LINK. Sempre menor ou igual a clicks. */
  link_clicks: number;
  form_leads: number;
  messaging_started: number;
  /** Pessoas unicas DO DIA. Nao e somavel entre dias. */
  reach: number;
  /** Frequencia DO DIA, como a Meta devolveu. Nao e somavel nem media-vel entre dias. */
  frequency: number;
};

/** Base de resultado declarada. O nome existe para que a base nunca fique implicita. */
export type BaseDeResultado = "formularios" | "conversas" | "formularios_e_conversas" | "cliques_no_link";

export type Numerador = "gasto_total" | "gasto_dos_objetos_com_resultado";

export type CustoPorResultado = {
  valor: number | null;
  base: BaseDeResultado;
  numerador: Numerador;
  /** Denominador efetivamente usado. Vai para a resposta: numero sem denominador nao confere. */
  resultados: number;
  gasto: number;
  /** Motivo de `valor` ser null. Zero resultados nao e custo zero — e custo indefinido. */
  indefinido_porque: string | null;
};

export type MetricasCanonicas = {
  gasto: number;
  impressoes: number;
  cliques_totais: number;
  cliques_no_link: number;
  formularios: number;
  conversas: number;
  dias: number;
  /** CTR com base declarada. As duas coexistem por necessidade real, nunca sob o mesmo nome. */
  ctr_todos_pct: number | null;
  ctr_link_pct: number | null;
  cpc_todos: number | null;
  cpc_link: number | null;
  cpm: number | null;
  /**
   * Soma de alcance diario. NAO e alcance unico do periodo: a mesma pessoa alcancada em dois
   * dias conta duas vezes. O nome carrega o defeito de proposito — `alcance` puro seria mentira.
   */
  alcance_soma_diaria_nao_deduplicada: number;
  /**
   * null quando o periodo tem mais de um dia. Frequencia de periodo nao e a media das diarias
   * nem impressoes/soma-de-alcance; so a Meta sabe, e so devolve sem quebra por dia.
   */
  frequencia_do_dia: number | null;
};

function div(a: number, b: number): number | null {
  if (!Number.isFinite(a) || !Number.isFinite(b) || b === 0) return null;
  return a / b;
}

function num(v: unknown): number {
  const n = Number(v ?? 0);
  return Number.isFinite(n) ? n : 0;
}

/**
 * Arredondamento explicito e unico.
 *
 * Existe para a prova de reprodutibilidade: sem casa decimal fixada, dois caminhos que
 * calculam o mesmo valor imprimem "2.1400000000000001" e "2.14" e a comparacao byte a byte
 * falha por formatacao, escondendo se a formula divergiu ou nao.
 *
 * ARREDONDE UMA VEZ SO, E AQUI. Medido em 03/09/2026: `round(2.135, 2)` no Postgres devolve
 * 2.14 (numeric e decimal exato, meio para cima), e `Math.round(2.135 * 100) / 100` no Deno
 * devolve 2.13 — porque 2.135 em IEEE-754 e 2.13499999999999978 e 2.135 * 100 da
 * 213.49999999999997. As duas contas estao "certas" nas respectivas aritmeticas, e as duas
 * sao deterministicas, mas divergem em um centavo.
 *
 * A consequencia pratica: se um caminho arredonda no SQL e o outro no TypeScript, a camada
 * emite R$ 2,14 e o painel mostra R$ 2,13 para o MESMO indicador, e a divergencia parece
 * alucinacao do modelo quando e aritmetica. Por isso o SQL desta camada devolve valor bruto e
 * quem arredonda e esta funcao.
 */
export function arredondar(v: number | null, casas: number): number | null {
  if (v === null || !Number.isFinite(v)) return null;
  const f = 10 ** casas;
  return Math.round(v * f) / f;
}

/** Soma os contadores somaveis de uma serie diaria. Alcance e frequencia ficam de fora. */
export function agregar(dias: ContadoresDoDia[]): MetricasCanonicas {
  const linhas = Array.isArray(dias) ? dias : [];
  let spend = 0, imp = 0, clk = 0, lnk = 0, forms = 0, msg = 0, reach = 0;
  for (const d of linhas) {
    spend += num(d.spend);
    imp += num(d.impressions);
    clk += num(d.clicks);
    lnk += num(d.link_clicks);
    forms += num(d.form_leads);
    msg += num(d.messaging_started);
    reach += num(d.reach);
  }
  return {
    gasto: arredondar(spend, 2) ?? 0,
    impressoes: imp,
    cliques_totais: clk,
    cliques_no_link: lnk,
    formularios: forms,
    conversas: msg,
    dias: linhas.length,
    ctr_todos_pct: arredondar(div(100 * clk, imp), 2),
    ctr_link_pct: arredondar(div(100 * lnk, imp), 2),
    cpc_todos: arredondar(div(spend, clk), 2),
    cpc_link: arredondar(div(spend, lnk), 2),
    cpm: arredondar(div(1000 * spend, imp), 2),
    alcance_soma_diaria_nao_deduplicada: reach,
    frequencia_do_dia: linhas.length === 1 ? arredondar(num(linhas[0].frequency), 2) : null,
  };
}

/**
 * Custo por resultado com base e numerador DECLARADOS.
 *
 * `numerador` existe porque a divergencia medida nao esta so no denominador: get_funnel usa
 * `gastoComForm` (so o gasto das campanhas que tiveram ao menos um formulario) enquanto
 * get_campaign_detail e o relatorio semanal usam o gasto total. Com R$ 1.000 gastos, dos quais
 * R$ 400 em campanha de engajamento sem formulario, e 10 formularios, um caminho responde
 * R$ 60,00 e o outro R$ 100,00 — os dois se chamando "custo por formulario".
 */
export function custoPorResultado(
  m: Pick<MetricasCanonicas, "gasto" | "formularios" | "conversas" | "cliques_no_link">,
  base: BaseDeResultado,
  opts?: { gastoDosObjetosComResultado?: number },
): CustoPorResultado {
  const resultados = base === "formularios"
    ? m.formularios
    : base === "conversas"
    ? m.conversas
    : base === "formularios_e_conversas"
    ? m.formularios + m.conversas
    : m.cliques_no_link;

  const usaFiltrado = typeof opts?.gastoDosObjetosComResultado === "number";
  const gasto = usaFiltrado ? num(opts?.gastoDosObjetosComResultado) : m.gasto;
  const numerador: Numerador = usaFiltrado ? "gasto_dos_objetos_com_resultado" : "gasto_total";

  const valor = arredondar(div(gasto, resultados), 2);
  return {
    valor,
    base,
    numerador,
    resultados,
    gasto: arredondar(gasto, 2) ?? 0,
    indefinido_porque: valor === null
      ? (resultados === 0 ? `nenhum resultado na base ${base} no periodo` : "gasto ou resultado nao numerico")
      : null,
  };
}

/**
 * Base correta pelo objetivo da campanha.
 *
 * Substitui o `forms || convs` de get_ads_ranking, que trocava de base silenciosamente: uma
 * campanha de formulario com zero formularios e conversas de WhatsApp passava a ser medida por
 * conversa, e o numero saia comparavel com o de campanhas medidas por formulario quando nao e.
 */
export function baseDoObjetivo(categoria: string | null | undefined): BaseDeResultado {
  const c = String(categoria ?? "").trim().toLowerCase();
  if (c === "mensagem" || c === "mensagens") return "conversas";
  return "formularios";
}

/** Rotulo em portugues da base. Vai para o texto da resposta junto com o numero. */
export function rotuloDaBase(base: BaseDeResultado): string {
  switch (base) {
    case "formularios": return "por formulario enviado";
    case "conversas": return "por conversa iniciada";
    case "formularios_e_conversas": return "por resultado (formulario + conversa)";
    case "cliques_no_link": return "por clique no link";
  }
}

/**
 * Orcamento diario da Meta vem em centavos. Converte e recusa o palpite.
 *
 * `orcamento_reais.ts` resolve o mesmo problema por HEURISTICA ("inteiro multiplo de 100 e
 * provavelmente centavos"), o que e necessario quando a origem do numero e desconhecida.
 * Aqui a origem e conhecida — campo da Graph API — entao a conversao e exata e nao adivinha.
 */
export function centavosParaReais(centavos: number | null | undefined): number | null {
  const c = Number(centavos ?? NaN);
  if (!Number.isFinite(c)) return null;
  return arredondar(c / 100, 2);
}
