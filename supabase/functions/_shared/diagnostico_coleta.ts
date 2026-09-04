// Instrumento da COLETA do modo profundo: por que o especialista parou, com que relogio, e
// quanto do que ele coletou chegou de fato a resposta.
//
// POR QUE ESTE MODULO EXISTE (medido em 04/09/2026, n=39 jobs deep / 62 execucoes de especialista)
//
// A pergunta era qual recurso limitava a coleta. Havia tres suspeitos — janela, parede de tempo e
// encerramento voluntario do especialista — e cada um pedia uma intervencao diferente. A medicao
// derrubou os tres, e derrubou tambem a capacidade do diagnostico anterior de distinguir um do
// outro. Os dois defeitos de instrumento que este modulo conserta:
//
// 1. O CAMPO `finish` MISTURA DUAS COISAS. Ele guarda o `finish_reason` do provider E o motivo de
//    saida do laco. Pior: a saida por reserva de sintese e escrita como `finish = finish ||
//    "reserva_sintese"`, e como `finish` JA vinha preenchido pela iteracao anterior, o `||` nunca
//    entrega o novo valor. Uma parada por reserva era gravada como `tool_calls`. Nas 62 execucoes
//    medidas, `reserva_sintese` aparece ZERO vezes — nao porque nao aconteceu, mas porque o campo
//    nao consegue dize-lo. Foi essa cegueira que fez a amostra pequena mentir duas vezes:
//    "encerrou sozinho" e "morreu de tempo" tinham o MESMO rotulo.
//
// 2. NAO HAVIA MEDIDA DE APROVEITAMENTO. `chars_visiveis` mede o tamanho da saida, e ja esta
//    estabelecido que a dispersao de tamanho e do proprio modelo (119 a 13.254 chars com entrada
//    identica ao token). Medir coleta por tamanho de resposta e medir o ruido. O que interessa e
//    conteudo verificavel: numero concreto e entidade nomeada que saem da coleta e reaparecem na
//    resposta. `fidelidadeDaColeta` faz exatamente isso e nao olha comprimento nenhum.
//
// O QUE A MEDICAO MOSTROU, para nao se reabrir a linha esperando outro resultado:
//
//   - PAREDE: a coleta encerra com a MEDIANA de 398,5s livres dos 480s de parede (83% intactos).
//     Em 18 de 18 jobs concluidos a parede sobrou. A frente nao morre de parede.
//   - JANELA: entrada da sintese ~8.500 tokens contra 500k de contexto do grok-4.6 (~98% livre);
//     especialista fecha com 3.300-4.300 tokens de saida contra teto de 5.000, e `length` aparece
//     em 1 de 62. Nada encostou em janela.
//   - VOLUNTARIO: `finish: stop` — o unico estado em que o especialista de fato decidiu que
//     terminou — sao 8 de 62 (13%).
//   - O QUE MATOU: 50 de 62 (81%) terminaram em chamada abortada por relogio, e o valor do
//     timeout nomeia o culpado: `openrouter_timeout_20000`. 20.000ms e o PISO de
//     `tetoDaChamadaMs`, nao um teto escolhido para aquela chamada.
//
// Por isso o instrumento passou a gravar `no_piso`: uma chamada no piso e uma chamada que a
// aritmetica da reserva NAO autorizou e que foi emitida de qualquer jeito. Sem esse campo, um
// timeout de relogio apertado e um timeout de provider lento ficam identicos na auditoria.

// ============================================================================
// 1. MOTIVO DE SAIDA — separado do finish_reason do provider
// ============================================================================

/**
 * Por que o laco de coleta do especialista terminou.
 *
 * Isto NAO e o `finish_reason` do provider e nao deve ser derivado dele: `stop` do provider
 * significa "o modelo devolveu texto", e o laco pode ter parado por cinco outros motivos com o
 * mesmo `stop` pendurado da iteracao anterior.
 */
export type MotivoSaida =
  /** O modelo devolveu relatorio sem pedir ferramenta: ELE julgou que tinha terminado. */
  | "voluntario"
  /** O laco parou para nao invadir a reserva da escrita (SINT_RESERVA + custo de reinvocacao). */
  | "reserva_sintese"
  /** Prazo do job zerado. */
  | "prazo_do_job"
  /** Bateu SUB_MAX_ITER ainda pedindo ferramenta. */
  | "iteracoes_esgotadas"
  /** A chamada morreu (timeout de relogio, HTTP, abort). */
  | "erro_llm"
  /** Provider devolveu choice sem message. */
  | "resposta_vazia";

/**
 * Motivo de saida e "encerramento voluntario"?
 *
 * So `voluntario` conta. Existe para o registro poder afirmar a taxa de encerramento voluntario
 * sem reinterpretar strings de provider em cada consulta.
 */
export function ehSaidaVoluntaria(motivo: MotivoSaida | null | undefined): boolean {
  return motivo === "voluntario";
}

/** Motivo de saida imposto pelo relogio (reserva, prazo ou chamada abortada por tempo). */
export function ehSaidaPorRelogio(motivo: MotivoSaida | null | undefined): boolean {
  return motivo === "reserva_sintese" || motivo === "prazo_do_job" || motivo === "erro_llm";
}

// ============================================================================
// 2. TETO POR CHAMADA — a aritmetica sai da closure para poder ser provada
// ============================================================================

export type TetoConcedido = {
  /** Timeout que a chamada realmente recebeu. */
  ms: number;
  /** O que a reserva de fato autorizava (pode ser negativo). */
  autorizado_ms: number;
  /** true = a chamada saiu no piso, ou seja, com mais tempo do que a reserva autorizava. */
  no_piso: boolean;
};

/**
 * Teto desta chamada do especialista.
 *
 * Mesma aritmetica que morava dentro de `rodarSubagente` — os numeros nao mudam. O que muda e que
 * agora ela e inspecionavel e declara `no_piso`.
 *
 * A leitura que o campo `no_piso` habilita: com `prazo()` limitado pelo teto POR INVOCACAO (270s)
 * e reserva de 195s (150s de sintese + 45s de reinvocacao), a coleta tem 65s de pista em que o
 * teto e real. Depois disso `autorizado_ms` fica negativo e toda chamada sai no piso de 20s — que
 * e menos do que uma chamada de raciocinio xhigh leva para voltar. O piso nao protege a coleta;
 * ele garante uma chamada que vai abortar e ainda gasta parede tentando.
 */
export function tetoDaChamadaMs(args: {
  prazoMs: number;
  tetoProviderMs: number;
  reservaMs: number;
  pisoMs: number;
}): TetoConcedido {
  const autorizado = args.prazoMs - args.reservaMs;
  const semPiso = Math.min(args.tetoProviderMs, autorizado);
  const ms = Math.max(args.pisoMs, semPiso);
  return { ms, autorizado_ms: autorizado, no_piso: ms > semPiso };
}

/** Resumo dos tetos concedidos numa execucao de especialista. */
export function resumirTetos(tetos: TetoConcedido[]): {
  chamadas: number;
  no_piso: number;
  min_ms: number | null;
  max_ms: number | null;
} {
  if (!Array.isArray(tetos) || !tetos.length) {
    return { chamadas: 0, no_piso: 0, min_ms: null, max_ms: null };
  }
  const ms = tetos.map((t) => t.ms);
  return {
    chamadas: tetos.length,
    no_piso: tetos.filter((t) => t.no_piso).length,
    min_ms: Math.min(...ms),
    max_ms: Math.max(...ms),
  };
}

// ============================================================================
// 3. JANELA — headroom declarado, para "sobrou janela?" ser consulta e nao conta de cabeca
// ============================================================================

export function janelaLivre(tokensEntrada: number, contextoModeloTokens: number): {
  tokens_entrada: number;
  contexto_tokens: number;
  livre_tokens: number;
  ocupacao: number;
} {
  const ctx = Math.max(1, contextoModeloTokens);
  const inp = Math.max(0, tokensEntrada);
  return {
    tokens_entrada: inp,
    contexto_tokens: ctx,
    livre_tokens: Math.max(0, ctx - inp),
    ocupacao: Number((inp / ctx).toFixed(4)),
  };
}

// ============================================================================
// 4. FIDELIDADE — quanto do que foi coletado chegou a resposta
// ============================================================================

/**
 * Ancora verificavel: pedaco de CONTEUDO que da para conferir dos dois lados.
 *
 * Duas familias, escolhidas porque sao as que o gestor cobra numa resposta de midia:
 *
 *   NUMERO  — gasto, custo, CTR, impressao, alcance. Exigimos 3+ digitos significativos ou 2 casas
 *             decimais. `1`, `12` e `0` ficam FORA de proposito: sao tao comuns que casariam por
 *             acidente e inflariam o aproveitamento sem ninguem ter citado numero nenhum.
 *   ENTIDADE— nome de campanha/conjunto/anuncio e sigla da casa (JURIDICO_CONJ.01, COHAPM, CONJ.01).
 *             Token de 5+ chars comecando em maiuscula e carregando digito, ponto, hifen ou
 *             underscore, que e o formato da nomenclatura desta conta.
 *
 * O casamento e por CONJUNTO de tokens, nunca por substring: `847` nao pode casar dentro de
 * `18.470`. Por isso os dois lados passam pela mesma normalizacao antes de comparar.
 */
export type Ancoras = { numeros: Set<string>; entidades: Set<string> };

const RE_NUMERO = /-?\d[\d.,]*/g;
const RE_ENTIDADE = /\b[A-Z][A-Za-z0-9]*(?:[_.\-][A-Za-z0-9]+)+\b|\b[A-Z]{4,}\b/g;
/**
 * Data NAO e ancora de coleta.
 *
 * A janela lida aparece nos dois lados por construcao — o contrato do pedido carrega date_from e
 * a resposta repete a janela —, entao contar `2026` ou `09/04` como "dado que chegou" inflaria o
 * aproveitamento sem que ninguem tenha citado um numero da conta. Sai antes da extracao.
 */
const RE_DATA = /\d{4}-\d{2}-\d{2}|\d{2}\/\d{2}\/\d{2,4}|\d{2}\/\d{2}\b/g;

/**
 * Tokens que aparecem por causa do formato do relatorio, nao por causa do dado.
 *
 * Sem esta lista, `RELATORIO`, `LACUNAS` e `COMPLETO` entrariam como entidades coletadas e
 * reapareceriam na resposta, produzindo aproveitamento fantasma.
 */
const RUIDO_ESTRUTURAL = new Set([
  "RELATORIO", "RELATORIOS", "LACUNAS", "LACUNA", "COMPLETO", "INCOMPLETO", "FALHOU",
  "NENHUMA", "FONTE", "JANELA", "TOTAL", "OBSERVACAO", "OBSERVACOES", "RESUMO",
  "DEVOLUCAO", "COORDENACAO", "ESGOTADA", "NOTA", "AVISO", "ATENCAO",
]);

/** Normaliza numero brasileiro para uma chave estavel: separador de milhar cai, virgula vira ponto. */
function normalizarNumero(bruto: string): string | null {
  let s = bruto.trim().replace(/^-/, "");
  // Ultima virgula (ou ultimo ponto seguido de 1-2 digitos no fim) e o separador decimal.
  const virgula = s.lastIndexOf(",");
  let decimais = "";
  if (virgula >= 0) {
    decimais = s.slice(virgula + 1).replace(/\D/g, "");
    s = s.slice(0, virgula);
  }
  const inteiros = s.replace(/\D/g, "");
  const digitos = inteiros + decimais;
  if (!digitos) return null;
  // Significancia: 3+ digitos no total, ou 2 casas decimais (dinheiro / custo por resultado).
  const significativo = digitos.replace(/^0+/, "");
  if (significativo.length < 3 && decimais.length < 2) return null;
  if (!significativo.length) return null;
  return decimais ? `${inteiros || "0"}.${decimais}` : inteiros;
}

/** Extrai as ancoras verificaveis de um texto. */
export function ancorasVerificaveis(texto: string): Ancoras {
  const numeros = new Set<string>();
  const entidades = new Set<string>();
  const t = String(texto ?? "").replace(RE_DATA, " ");
  for (const m of t.matchAll(RE_NUMERO)) {
    const k = normalizarNumero(m[0]);
    if (k) numeros.add(k);
  }
  for (const m of t.matchAll(RE_ENTIDADE)) {
    const k = m[0].toUpperCase();
    // Rotulos do proprio arcabouco nao sao dado coletado: contariam como conteudo que a
    // sintese "aproveitou" quando sao so cabecalho de bloco.
    if (RUIDO_ESTRUTURAL.has(k)) continue;
    entidades.add(k);
  }
  return { numeros, entidades };
}

export type FidelidadeEspecialista = {
  nome: string;
  ancoras: number;
  na_resposta: number;
  aproveitamento: number;
};

export type Fidelidade = {
  /** Ancoras distintas que a coleta produziu (uniao dos relatorios validos). */
  ancoras_coletadas: number;
  /** Quantas delas reaparecem na resposta. */
  ancoras_na_resposta: number;
  /** 0..1. -1 quando nao ha o que medir (nenhum relatorio valido). */
  aproveitamento: number;
  numeros: { coletados: number; na_resposta: number };
  entidades: { coletadas: number; na_resposta: number };
  /** Relatorios que falharam e por isso nao entram no denominador. */
  relatorios_ignorados: string[];
  por_especialista: FidelidadeEspecialista[];
  /** Amostra do que a coleta trouxe e a resposta nao citou — e por aqui que se revisa. */
  ausentes_amostra: string[];
};

/**
 * Quanto do que foi coletado chegou a resposta.
 *
 * NAO mede comprimento, de proposito e por decisao registrada: a dispersao de tamanho da saida ja
 * foi medida como propriedade do modelo, entao comprimento e ruido. Aqui a unidade e conteudo
 * conferivel — numero e entidade que existem na coleta e podem ser procurados na resposta.
 *
 * Relatorio de especialista que FALHOU sai do denominador: ele nao coletou nada, e cobrar da
 * sintese o que ninguem leu daria aproveitamento baixo por motivo errado. Os nomes ficam em
 * `relatorios_ignorados` para a exclusao ser auditavel e nao silenciosa.
 */
export function fidelidadeDaColeta(
  relatorios: { nome: string; relatorio: string; erro?: string | null }[],
  resposta: string,
  opts?: { amostraAusentes?: number },
): Fidelidade {
  const limiteAmostra = opts?.amostraAusentes ?? 12;
  const naResposta = ancorasVerificaveis(resposta);
  const ignorados: string[] = [];
  const porEsp: FidelidadeEspecialista[] = [];
  const todosNumeros = new Set<string>();
  const todasEntidades = new Set<string>();

  for (const r of Array.isArray(relatorios) ? relatorios : []) {
    if (r?.erro) { ignorados.push(String(r.nome)); continue; }
    const a = ancorasVerificaveis(String(r?.relatorio ?? ""));
    for (const n of a.numeros) todosNumeros.add(n);
    for (const e of a.entidades) todasEntidades.add(e);
    const total = a.numeros.size + a.entidades.size;
    const achadas = [...a.numeros].filter((n) => naResposta.numeros.has(n)).length
      + [...a.entidades].filter((e) => naResposta.entidades.has(e)).length;
    porEsp.push({
      nome: String(r?.nome ?? "?"),
      ancoras: total,
      na_resposta: achadas,
      aproveitamento: total ? Number((achadas / total).toFixed(4)) : -1,
    });
  }

  const numAch = [...todosNumeros].filter((n) => naResposta.numeros.has(n));
  const entAch = [...todasEntidades].filter((e) => naResposta.entidades.has(e));
  const coletadas = todosNumeros.size + todasEntidades.size;
  const achadas = numAch.length + entAch.length;
  const ausentes = [
    ...[...todasEntidades].filter((e) => !naResposta.entidades.has(e)),
    ...[...todosNumeros].filter((n) => !naResposta.numeros.has(n)),
  ].slice(0, limiteAmostra);

  return {
    ancoras_coletadas: coletadas,
    ancoras_na_resposta: achadas,
    aproveitamento: coletadas ? Number((achadas / coletadas).toFixed(4)) : -1,
    numeros: { coletados: todosNumeros.size, na_resposta: numAch.length },
    entidades: { coletadas: todasEntidades.size, na_resposta: entAch.length },
    relatorios_ignorados: ignorados,
    por_especialista: porEsp,
    ausentes_amostra: ausentes,
  };
}
