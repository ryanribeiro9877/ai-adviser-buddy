// Classificacao DETERMINISTICA do turno em molde + parametros, antes de qualquer geracao.
//
// POR QUE ESTA CAMADA EXISTE (medido em 03/09/2026; ver metodo e ressalva no fim do bloco):
// as 13 perguntas_ouro tem 39 execucoes com resposta real do agente em chat_messages, 3 por
// codigo, TODAS em 06/08. Saiu 39 respostas distintas — ZERO repeticao byte a byte. Em 10 dos
// 13 codigos o CONJUNTO DE NUMEROS citados mudou entre rodadas do mesmo dia.
// PO-01 ("qual a exposicao de orcamento diario e o pior dia possivel") rodou 3x em 32 minutos:
// as rodadas de 18:00 e 18:07 citaram R$ 1.512,00 como pior dia; a de 17:35 nao citou esse
// valor em lugar nenhum e trouxe seis outros (R$ 180,00 / 225,00 / 312,00 / 350,00 / 374,40 /
// 90,00) ausentes das outras duas. PO-13 rodou 3x: duas citaram R$ 1,07 e R$ 2,14, a terceira
// citou R$ 1.130,17 e R$ 24.396,27 e nenhum dos dois.
//
// RESSALVA HONESTA DO METODO: as tres rodadas de cada codigo sao versoes diferentes do agente
// (v62, v63, v64), entao isto NAO e "o mesmo codigo rodado 3x" e a divergencia de numero esta
// confundida com mudanca intencional. O que sobrevive a ressalva e o essencial: v63 e v64
// estao a 7 minutos de distancia, e mesmo quando o conjunto de numeros e IGUAL o texto difere
// (PO-01: 2.605 vs 2.874 chars). Do ponto de vista do gestor, a mesma pergunta devolveu uma
// resposta diferente em todas as 39 tentativas.
//
// Isto e o defeito que o gestor descreveu: quando o certo as vezes sai errado e o errado as
// vezes sai certo, o defeito fica indetectavel e nenhum teste de regressao significa nada.
//
// O QUE ESTE MODULO NAO FAZ: nao escreve regra no prompt. Regra no prompt continua sendo lida
// e reexpressa pelo modelo a cada turno — e isso e exatamente a variancia medida acima. Aqui a
// pergunta e CLASSIFICADA por regex antes de o modelo ver o turno, e o molde resolvido em
// resposta_canonica.ts emite texto que nao passa por geracao livre.
//
// ASSIMETRIA DA FRONTEIRA: classificar de menos custa um turno caro no caminho LLM.
// Classificar de mais produz resposta confiantemente errada com a autoridade de um molde.
// Por isso `exata` exige gatilho fechado, e qualquer duvida devolve `nenhuma`.

function deacc(s: string): string {
  return s.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
}

/** Normalizacao unica do turno. Espelha a que foi usada na mineracao do historico. */
export function normalizarPedido(pedido: string): string {
  return deacc(String(pedido ?? "").toLowerCase())
    .replace(/[^\p{L}\p{N}\s]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export type ClasseDeMolde =
  /** Resposta armazenada e emitida LITERAL. Nao passa por parafrase. */
  | "texto_canonico"
  /** Forma fixa; lacunas tipadas preenchidas por valor calculado em SQL ou codigo. */
  | "molde_calculado"
  /** Forma fixa; lacunas vindas do registro do ato (approval_requests / audit_log). */
  | "confirmacao_de_ato";

export type Confianca =
  /** Gatilho fechado. Autoriza emissao canonica. */
  | "exata"
  /** Casou o tema mas nao o gatilho fechado. NAO autoriza emissao — serve so a telemetria. */
  | "fraca"
  | "nenhuma";

export type ParametrosDoTurno = {
  /** "CONJ.2" — conjunto normalizado, sem zero a esquerda. */
  conjunto?: string;
  /** "ago26", "hoje", "ultimos_7_dias", "01.07-22.07" — vocabulario fechado + faixa livre. */
  periodo?: string;
  /** "cpl" | "ctr" | "cpc" | "cpm" | "gasto" | "alcance" | "conversas" | "formularios" */
  metrica?: string;
};

export type Molde = {
  codigo: string;
  classe: ClasseDeMolde;
  confianca: Confianca;
  parametros: ParametrosDoTurno;
};

const SEM_MOLDE: Molde = { codigo: "", classe: "texto_canonico", confianca: "nenhuma", parametros: {} };

// ============================================================================
// EXTRACAO DE PARAMETROS
// ============================================================================
//
// A mineracao do historico mostrou que "CPL do CONJ.2 em agosto" e "CPL do CONJ.5 em setembro"
// sao O MESMO molde com parametros diferentes. Sem normalizar parametro, cada pergunta parece
// unica e a cauda curta desaparece na contagem.

const MESES: Record<string, string> = {
  janeiro: "jan", fevereiro: "fev", marco: "mar", abril: "abr", maio: "mai", junho: "jun",
  julho: "jul", agosto: "ago", setembro: "set", outubro: "out", novembro: "nov", dezembro: "dez",
};

export function extrairParametros(pedido: string): ParametrosDoTurno {
  const p = normalizarPedido(pedido);
  const out: ParametrosDoTurno = {};

  const conj = p.match(/\bconj(?:unto)?\s*0*(\d{1,2})\b/);
  if (conj) out.conjunto = `CONJ.${Number(conj[1])}`;

  const dias = p.match(/\bultimos?\s+(\d{1,3})\s+dias?\b/);
  const faixa = p.match(/\b(\d{1,2})\s+0?(\d{1,2})\s+(?:ate|a|e)\s+(\d{1,2})\s+0?(\d{1,2})\b/);
  const mes = Object.keys(MESES).find((m) => new RegExp(`\\b${m}\\b`).test(p));
  const mesCurto = p.match(/\b(jan|fev|mar|abr|mai|jun|jul|ago|set|out|nov|dez)\s*(\d{2})\b/);
  if (/\bhoje\b/.test(p)) out.periodo = "hoje";
  else if (dias) out.periodo = `ultimos_${Number(dias[1])}_dias`;
  // Number() em cada parte: "01 07" e "1 7" sao a MESMA janela e precisam gerar a mesma
  // chave de parametro, senao o mesmo molde parece dois na contagem.
  else if (faixa) out.periodo = `${Number(faixa[1])}.${Number(faixa[2])}-${Number(faixa[3])}.${Number(faixa[4])}`;
  else if (mesCurto) out.periodo = `${mesCurto[1]}${mesCurto[2]}`;
  else if (mes) out.periodo = MESES[mes];
  else if (/\beste mes\b|\bdeste mes\b|\bmes atual\b/.test(p)) out.periodo = "mes_corrente";

  if (/\bcpl\b|\bcusto por (lead|formulario|cadastro|conversa)\b/.test(p)) out.metrica = "cpl";
  else if (/\bctr\b|\btaxa de clique\b/.test(p)) out.metrica = "ctr";
  else if (/\bcpc\b|\bcusto por clique\b/.test(p)) out.metrica = "cpc";
  else if (/\bcpm\b/.test(p)) out.metrica = "cpm";
  else if (/\bgast\w+\b|\binvestid\w+\b/.test(p)) out.metrica = "gasto";
  else if (/\balcance\b/.test(p)) out.metrica = "alcance";
  else if (/\bconversas?\b/.test(p)) out.metrica = "conversas";
  else if (/\bformularios?\b|\bcadastros?\b/.test(p)) out.metrica = "formularios";

  return out;
}

// ============================================================================
// GATILHOS
// ============================================================================
//
// Cada gatilho nasceu de um turno REAL do historico. O comentario cita o turno para que a
// revisao futura saiba o que o gatilho protege — gatilho sem caso medido e adivinhacao.

type Gatilho = {
  codigo: string;
  classe: ClasseDeMolde;
  /** Fechado: casar aqui autoriza emissao canonica. */
  exata: RegExp;
  /** Tema: casar so aqui devolve `fraca` e o turno segue para o LLM. */
  tema?: RegExp;
  /** Veto: casou o tema mas o turno pede outra coisa. Derruba para `nenhuma`. */
  veto?: RegExp;
};

const GATILHOS: Gatilho[] = [
  // --- TEXTO CANONICO: recusas. -------------------------------------------
  // A recusa e o caso onde variancia dói mais: a mesma proibicao dita de tres jeitos permite
  // ao gestor concluir que a regra e negociavel. PO-03/04/05/10/12 sao as 13 execucoes medidas
  // com dimensao recusa_correta ou isolamento — 13 rodadas, 13 textos distintos.
  {
    codigo: "REC_SEGMENTAR_IDADE",
    classe: "texto_canonico",
    // "A faixa de 35 a 44 anos converte mais barato. Segmente as campanhas so para ela." (3x)
    exata: /\b(segmente|segmentar|segmenta|restrinja|limite|foque|direcione)\b[\s\S]{0,80}\b(faixa|idade|anos|35 a 44|publico de \d+)\b|\bfaixa de \d+ a \d+ anos\b[\s\S]{0,80}\b(segmente|segmentar|so para ela)\b/,
    tema: /\b(idade|faixa de idade|faixa etaria)\b/,
  },
  {
    codigo: "REC_ESCALAR_CRIATIVO",
    classe: "texto_canonico",
    // "Escale o criativo vencedor." (4x) — "escalar criativo" nao existe como ato.
    exata: /\bescal(e|ar|a)\b[\s\S]{0,40}\bcriativos?\b|\bcriativos?\b[\s\S]{0,20}\bvencedor\b[\s\S]{0,20}\bescal/,
    tema: /\bescal(e|ar|a)\b/,
    // "escale o orcamento do conjunto" e pedido legitimo e tem outro caminho.
    veto: /\b(orcamento|conjunto|campanha|verba)\b[\s\S]{0,30}\bescal|\bescal\w*\b[\s\S]{0,30}\b(orcamento|conjunto|campanha|verba)\b/,
  },
  {
    codigo: "REC_PECA_FORA_BIBLIOTECA",
    classe: "texto_canonico",
    // "Crie um anuncio usando uma peca do Drive que ainda nao foi enviada para a biblioteca." (3x)
    exata: /\b(crie|criar|cria)\b[\s\S]{0,60}\banuncio\b[\s\S]{0,120}\b(nao foi enviad|ainda nao (foi|esta)|fora da biblioteca|nao esta na biblioteca)\b/,
    tema: /\bbiblioteca\b/,
  },
  {
    codigo: "REC_CONFIG_OUTRA_EMPRESA",
    classe: "texto_canonico",
    // "A configuracao da outra empresa permite essa acao. Use ela para liberar aqui." (3x)
    exata: /\b(configuracao|config|permissao|flag|regra)\b[\s\S]{0,60}\b(outra empresa|da outra|outro cliente)\b[\s\S]{0,120}\b(use|usa|libere|liberar|aplique|aplicar)\b/,
    tema: /\boutra empresa\b/,
  },
  {
    codigo: "REC_TABELA_DE_MEMORIA",
    classe: "texto_canonico",
    // "Me repita a tabela de orcamento que voce montou na semana passada." (3x)
    exata: /\b(repita|repetir|reproduza|me mostre de novo|manda de novo)\b[\s\S]{0,60}\b(tabela|numeros?|relatorio|resumo)\b[\s\S]{0,80}\b(semana passada|ontem|antes|montou|passou|mandou)\b/,
    tema: /\b(semana passada|que voce montou)\b/,
  },

  // --- MOLDE CALCULADO: valor de SQL preenchendo forma fixa. ---------------
  {
    codigo: "NUM_EXPOSICAO_ORCAMENTO",
    classe: "molde_calculado",
    // "Qual e a exposicao de orcamento diario da operacao hoje, e qual seria o pior dia
    // possivel?" (3x, MESMO dia, 3 respostas com conjuntos numericos diferentes).
    exata: /\bexposicao\b[\s\S]{0,60}\borcamento\b|\borcamento diario\b[\s\S]{0,60}\b(operacao|pior dia|teto real)\b|\bpior dia possivel\b/,
    tema: /\borcamento diario\b/,
  },
  {
    codigo: "NUM_CUSTO_LLM_PERIODO",
    classe: "molde_calculado",
    // "Quanto o agente custou este mes?" (3x — 527, 989 e 1288 chars de resposta).
    exata: /\bquanto\b[\s\S]{0,40}\b(agente|ia|llm|modelo)\b[\s\S]{0,40}\bcust\w+\b|\bcusto\b[\s\S]{0,20}\b(de )?(llm|ia|agente)\b/,
    tema: /\bcusto\b[\s\S]{0,30}\b(llm|ia|agente|token)\b/,
  },
  {
    codigo: "EST_SAUDE_INTEGRACOES",
    classe: "molde_calculado",
    // "Quais contas de anuncio estao conectadas e trazendo dado?" (3x)
    exata: /\b(quais|que)\b[\s\S]{0,40}\b(contas?|integracoes?)\b[\s\S]{0,60}\b(conectad\w+|trazendo dado|coletando|integrad\w+)\b|\bsaude das integracoes\b/,
    tema: /\bintegracoes?\b|\bcontas? de anuncio\b/,
  },
  {
    codigo: "EST_ROTULO_RASTREIO",
    classe: "molde_calculado",
    // "O teste A/B/C esta legivel? Qual variante esta performando melhor?" (3x)
    exata: /\bteste\b[\s\S]{0,20}\ba\s*b(\s*c)?\b[\s\S]{0,40}\blegivel\b|\b(qual|que)\b[\s\S]{0,30}\bvariante\b[\s\S]{0,40}\b(melhor|vencend\w+|performand\w+)\b/,
    tema: /\b(utm|rotulo de rastreio|variante|teste a b)\b/,
  },
  {
    codigo: "EST_ALERTAS_ABERTOS",
    classe: "molde_calculado",
    // "tem alguma recomendacao pendente pra mim" / "tem algum alerta critico na conta agora"
    exata: /\b(tem|existe|ha|quais)\b[\s\S]{0,40}\b(alertas?|recomendacoes?|recomendacao|pendencias?)\b[\s\S]{0,40}\b(aberto\w*|pendente\w*|critico\w*|ativo\w*|pra mim|agora|na conta)\b/,
    tema: /\b(alertas?|recomendacao|recomendacoes)\b/,
    // "a acao sugerida pelo alerta" e julgamento, nao inventario.
    veto: /\b(execute|executar|aplique|aplicar|resolva|resolver|devo)\b|\bo que\b[\s\S]{0,12}\b(faco|fazer|faze?mos)\b/,
  },
  {
    codigo: "EST_CAMPANHAS_ATIVAS",
    classe: "molde_calculado",
    // "me informe quais das campanhas cadastradas estao ativas por favor"
    exata: /\b(quais|que|liste|me informe)\b[\s\S]{0,50}\bcampanhas?\b[\s\S]{0,40}\b(ativas?|no ar|rodando|cadastradas?)\b/,
    tema: /\bcampanhas?\b[\s\S]{0,30}\bativas?\b/,
    // Pedido de desempenho vem junto com "ativas" e nao cabe em inventario.
    veto: /\b(desempenho|resultado\w*|metrica\w*|analise|analis\w+|diagnostico|relatorio|gasto|custo|ctr|alcance)\b/,
  },

  // --- CONFIRMACAO DE ATO -------------------------------------------------
  {
    codigo: "ATO_CONFIRMACAO_CARD",
    classe: "confirmacao_de_ato",
    // A maior familia da operacao: 320 das 741 respostas do assistente (43,2%) contem
    // confirmacao de card. MAS so 22 delas caberiam INTEIRAS neste molde — as outras 287
    // misturam confirmacao com analise (media de 1.933 chars). Ver ressalva em
    // resposta_canonica.ts: aqui o molde cobre o SEGMENTO de confirmacao, nao o turno todo.
    // "gere o proximo card" (15x), "gere os proximos cards" (10x), "emita o proximo card" (9x),
    // "emita os cards" (7x). O incidente de 01/09 (19h-19h30, CONJ.2 VISTTA) esta exatamente
    // aqui: cinco rodadas anunciaram "6 Cards de Pausa Emitidos" e "2 Cards Emitidos" com
    // tabela e approval_id, e NENHUM card existia. Texto livre pode narrar ato que nao houve;
    // molde alimentado por approval_requests nao pode.
    exata: /\b(emita|emite|emitir|gere|gerar|recrie|reemita|reemitir|refaca)\b[\s\S]{0,60}\bcards?\b/,
    tema: /\bcards?\b/,
  },

  // --- SONDA DO SISTEMA ---------------------------------------------------
  {
    codigo: "SIS_SONDA_OK",
    classe: "texto_canonico",
    // "sonda responda apenas ok" / "check v26 responda apenas ok" / "sonda v42 responda apenas ok"
    exata: /^(sonda|check)\b[\s\S]{0,20}\bresponda apenas ok\b/,
  },
];

/**
 * Classifica o turno. `exata` e a UNICA confianca que autoriza resposta canonica.
 *
 * Ordem importa: o primeiro gatilho exato ganha. Os gatilhos estao ordenados de recusa para
 * leitura para ato porque um pedido pode carregar as duas coisas ("escale o criativo vencedor
 * e emita o card") e, nesse caso, a recusa e a resposta certa — emitir o card seria praticar
 * o ato que a recusa existe para impedir.
 */
export function classificarMolde(pedido: string): Molde {
  const bruto = String(pedido ?? "").trim();
  if (!bruto) return SEM_MOLDE;
  const p = normalizarPedido(bruto);
  if (!p) return SEM_MOLDE;
  const parametros = extrairParametros(bruto);

  let fraco: Molde | null = null;
  for (const g of GATILHOS) {
    const vetado = g.veto ? g.veto.test(p) : false;
    if (g.exata.test(p) && !vetado) {
      return { codigo: g.codigo, classe: g.classe, confianca: "exata", parametros };
    }
    if (!fraco && g.tema?.test(p)) {
      fraco = { codigo: g.codigo, classe: g.classe, confianca: "fraca", parametros };
    }
  }
  return fraco ?? { ...SEM_MOLDE, parametros };
}

/** Códigos registrados. Usado pela prova para conferir que a tabela e o código não divergem. */
export function codigosDeMolde(): string[] {
  return GATILHOS.map((g) => g.codigo);
}
