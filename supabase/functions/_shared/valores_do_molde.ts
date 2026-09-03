// EXTRACAO DOS VALORES DO MOLDE a partir dos `toolResults` do turno.
//
// E a peca que faltava para a camada poder ser ligada. Sem ela o ponto B da composicao
// resolve sempre para LLM com `instruiuOmitir` verdadeiro — o modelo omite os numeros porque
// foi mandado omitir, o bloco nao materializa, e sai a resposta mutilada: analise comentando
// numeros que nao aparecem em lugar nenhum da mensagem.
//
// ============================================================================
// TRES REGRAS, E A PRIMEIRA E A QUE IMPEDE A MUTILACAO
// ============================================================================
//
// 1. CAMPO OBRIGATORIO AUSENTE DERRUBA A RESOLUCAO INTEIRA. Este modulo nunca devolve
//    valores parciais: ou entrega o conjunto completo, ou entrega a lista de defeitos e o
//    turno cai para LLM inteiro. Perder o determinismo de um turno e barato; entregar
//    mensagem mutilada nao, porque ela parece completa e ninguem desconfia.
//
// 2. PRESENTE DE FORMA INESPERADA NAO E O MESMO QUE AUSENTE. Tipo errado, estrutura
//    diferente, retorno truncado, ferramenta que respondeu com erro — tudo isso e DEFEITO
//    nomeado, nao lacuna silenciosa. Lacuna silenciosa aqui viraria exatamente o problema
//    que a camada existe para resolver: numero errado com forma de numero certo.
//
//    Dois casos merecem destaque porque nao sao teoricos:
//
//    - `cortado: true` significa que `retorno` NAO e o objeto, e sim uma STRING de JSON
//      cortada em 14.000 chars. Medido em producao: `get_aprovacoes` veio cortado em 59 de
//      67 chamadas (88%). Ler campo de um JSON truncado da valor arbitrario ou undefined
//      conforme onde o corte caiu — e o pior tipo de defeito, porque as vezes funciona.
//
//    - `erro` presente significa que O DADO NAO FOI LIDO. O proprio traffic-chat grava o
//      aviso "nao o trate como zero nem como inexistente" nesses retornos. Contar uma lista
//      que nao chegou como zero afirmaria "nenhum alerta aberto" quando a verdade e "nao
//      consegui olhar" — canonico, autoritativo e falso.
//
// 3. NADA DE RECALCULAR. Nenhuma formula nasce aqui. Quando o numero precisa de conta, ele
//    vem de `metrica_canonica.ts`, que e a fonte unica — reimplementar aritmetica aqui
//    recriaria a divergencia de denominador que esta sendo corrigida nas funcoes SQL de
//    custo, com o agravante de ser por caminho de codigo em vez de por funcao.
//
//    Fato util sobre os 5 moldes alimentados: NENHUM deles precisa de formula. Quatro
//    consomem contagens que a propria ferramenta DECLARA, e um consome cardinalidade de
//    lista. Nao ha custo por resultado, CPL nem CTR em bloco canonico, e isso nao e
//    coincidencia — indicador com base de calculo em disputa nao deveria estar travado em
//    molde enquanto a base nao for unica.
//
//    A distincao que eu adoto, explicitada para nao virar brecha: CARDINALIDADE de uma
//    lista que a ferramenta devolveu inteira nao e formula. `alertas_ativos.length` nao tem
//    numerador nem denominador em disputa; e a contagem do conjunto que veio. O que esta
//    proibido e derivar indicador — e por isso a cardinalidade so vale com a lista COMPLETA,
//    o que torna a checagem de `cortado` parte da regra e nao um detalhe.

import type { ValoresDoMolde } from "./resposta_canonica.ts";

/** Forma do que o traffic-chat acumula em `toolResults`. Ver premissas no fim do arquivo. */
export type RetornoDeFerramenta = {
  tool: string;
  args?: unknown;
  chars?: number;
  cortado?: boolean;
  retorno?: unknown;
  erro?: string;
};

export type Defeito = {
  /** Campo do molde que ficou sem valor, ou "*" quando o defeito derruba o molde todo. */
  campo: string;
  motivo: string;
};

export type Extracao =
  | { ok: true; valores: ValoresDoMolde }
  | { ok: false; defeitos: Defeito[] };

// ============================================================================
// ORIGENS DECLARADAS — o contrato com `moldes_de_resposta.campos[].origem`
// ============================================================================
//
// Este mapa e a MESMA string que esta gravada na coluna. A prova compara os dois lados: se
// alguem corrigir a origem no banco sem mexer no extrator (ou o contrario), a prova acusa.
//
// Sem essa amarra a coluna `origem` seria decorativa. Ela existe para a auditoria poder
// responder "de onde veio este numero?" sem ler codigo, e uma origem que mente e pior que
// origem ausente.
export const ORIGENS: Record<string, Record<string, string>> = {
  ATO_CONFIRMACAO_CARD: {
    total: "toolResults[propose_action].retorno.ok=true -> cardinalidade",
    emitidos: "toolResults[propose_action].retorno.approval_id + resumo",
  },
  ATO_CARD_NAO_EMITIDO: {
    motivo: "toolResults[propose_action|validar_pedido_contra_contrato].erro",
  },
  EST_ALERTAS_ABERTOS: {
    data: "parametro do turno (hojeIso)",
    alertas: "toolResults[get_alerts].retorno.alertas_ativos -> cardinalidade",
    recomendacoes: "toolResults[get_recommendations].retorno.recomendacoes_pendentes -> cardinalidade",
    lista: "toolResults[get_alerts].alertas_ativos + toolResults[get_recommendations].recomendacoes_pendentes",
  },
  EST_CAMPANHAS_ATIVAS: {
    data: "parametro do turno (hojeIso)",
    total: "toolResults[get_overview].retorno.campanhas_total",
    ativas: "toolResults[get_overview].retorno.campanhas_ativas",
    lista: "toolResults[get_overview].retorno.campanhas_ativas_lista -> nome + conta + gasto_acumulado",
  },
  EST_SAUDE_INTEGRACOES: {
    data: "parametro do turno (hojeIso)",
    integracoes: "toolResults[saude_das_integracoes].retorno.integracoes",
    vivas: "toolResults[saude_das_integracoes].retorno.por_veredito.viva",
    tolerancia: "toolResults[saude_das_integracoes].retorno.dias_tolerancia",
    detalhe: "toolResults[saude_das_integracoes].retorno.contas -> conta + afirmado.status + veredito",
  },
};

/** Moldes que este modulo sabe alimentar. Ver `SEM_EXTRATOR` para os que ficaram fora. */
export function temExtrator(codigo: string | null | undefined): boolean {
  return !!codigo && Object.prototype.hasOwnProperty.call(ORIGENS, codigo);
}

/**
 * Componiveis que NAO tem extrator, com o motivo.
 *
 * Estao aqui em vez de terem sido rebaixados no banco porque as duas perguntas sao
 * diferentes e moram em lugares diferentes: `moldes_de_resposta.composicao` responde "este
 * molde tolera analise em volta?", que e doutrina; a existencia de extrator responde
 * "consigo alimentar o bloco hoje?", que e implementacao. Misturar as duas na mesma coluna
 * faria a doutrina mudar por motivo de codigo.
 *
 * O que garante a seguranca e `instrucaoDeComposicao` exigir extrator: sem extrator a
 * instrucao de omitir nunca entra no prompt, entao o turno nao pode sair mutilado.
 */
export const SEM_EXTRATOR: Record<string, string> = {
  NUM_EXPOSICAO_ORCAMENTO:
    "nao existe ferramenta que devolva a exposicao de orcamento diario da operacao. " +
    "`avaliar_orcamento_diario` nao e ferramenta de chat e exige p_reais > 0 (julga um orcamento PROPOSTO, " +
    "nao le o vigente); `get_estrutura_conjuntos` tem orcamento por conjunto mas e paginado de 20, e somar " +
    "pagina seria total parcial com cara de total.",
  NUM_CUSTO_LLM_PERIODO:
    "a ferramenta existe no catalogo mas nunca foi chamada em producao (0 registros em chat_messages.tool_results), " +
    "entao a forma do retorno nao pode ser conferida contra dado real. O corpo da RPC tem `custo_usd`, `custo_usd_sub` " +
    "e `custo_usd_sintese` alem de blocos `chat` e `jobs`, e nao da para afirmar sem amostra se `custo_usd` e chave de " +
    "topo ou de secao. Errar isso emitiria custo parcial como custo total.",
};

// ============================================================================
// LEITURA DEFENSIVA DOS RETORNOS
// ============================================================================

function ehObjeto(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/**
 * Todos os retornos de uma ferramenta no turno, ja separados entre usaveis e defeituosos.
 *
 * Devolve TODOS e nao so o ultimo porque `propose_action` roda varias vezes por turno e cada
 * chamada e um card. Para ferramenta de leitura o chamador usa o ultimo usavel, que e o mais
 * fresco.
 */
function colher(
  toolResults: RetornoDeFerramenta[],
  nome: string,
): { usaveis: Record<string, unknown>[]; comErro: RetornoDeFerramenta[]; truncados: number } {
  const usaveis: Record<string, unknown>[] = [];
  const comErro: RetornoDeFerramenta[] = [];
  let truncados = 0;

  for (const t of toolResults) {
    if (String(t?.tool ?? "") !== nome) continue;
    if (t.erro) { comErro.push(t); continue; }
    // `cortado` vem antes do teste de tipo de proposito: cortado com retorno string e o caso
    // comum, e a mensagem de defeito tem de dizer "truncado", nao "tipo inesperado".
    if (t.cortado === true) { truncados++; continue; }
    if (!ehObjeto(t.retorno)) {
      if (typeof t.retorno === "string") { truncados++; continue; }
      comErro.push({ ...t, erro: `retorno de tipo inesperado (${t.retorno === null ? "null" : typeof t.retorno})` });
      continue;
    }
    usaveis.push(t.retorno);
  }
  return { usaveis, comErro, truncados };
}

/** Ultimo retorno usavel de uma ferramenta de leitura, ou o defeito que impede de usar. */
function lerFerramenta(
  toolResults: RetornoDeFerramenta[],
  nome: string,
  campo: string,
): { ok: true; dado: Record<string, unknown> } | { ok: false; defeito: Defeito } {
  const { usaveis, comErro, truncados } = colher(toolResults, nome);
  if (usaveis.length) return { ok: true, dado: usaveis[usaveis.length - 1] };

  if (truncados) {
    return {
      ok: false,
      defeito: {
        campo,
        motivo: `${nome} veio truncado (cortado=true): o retorno e uma string de JSON cortada, nao o objeto. Nao se le campo de JSON truncado.`,
      },
    };
  }
  if (comErro.length) {
    return {
      ok: false,
      defeito: {
        campo,
        // "nao foi lido" e diferente de "e zero", e a frase existe para nunca deixar duvida.
        motivo: `${nome} respondeu com erro (${String(comErro[0].erro).slice(0, 120)}): o dado NAO foi lido e nao pode ser tratado como zero.`,
      },
    };
  }
  return { ok: false, defeito: { campo, motivo: `${nome} nao foi chamada neste turno` } };
}

/** Inteiro DECLARADO pela ferramenta. Nao aceita string numerica: tipo divergente e defeito. */
function inteiroDeclarado(
  dado: Record<string, unknown>,
  chave: string,
  campo: string,
): { ok: true; valor: number } | { ok: false; defeito: Defeito } {
  const v = dado[chave];
  if (v === undefined) return { ok: false, defeito: { campo, motivo: `chave "${chave}" ausente no retorno` } };
  if (v === null) return { ok: false, defeito: { campo, motivo: `chave "${chave}" veio null — ausencia de leitura, nao zero` } };
  if (typeof v !== "number" || !Number.isFinite(v)) {
    return {
      ok: false,
      defeito: { campo, motivo: `chave "${chave}" deveria ser numero e veio ${typeof v} (${String(v).slice(0, 40)})` },
    };
  }
  if (!Number.isInteger(v) || v < 0) {
    return { ok: false, defeito: { campo, motivo: `chave "${chave}" deveria ser inteiro nao negativo e veio ${v}` } };
  }
  return { ok: true, valor: v };
}

/** Lista COMPLETA devolvida pela ferramenta. Cardinalidade so vale sobre lista completa. */
function listaDeclarada(
  dado: Record<string, unknown>,
  chave: string,
  campo: string,
): { ok: true; itens: unknown[] } | { ok: false; defeito: Defeito } {
  const v = dado[chave];
  if (v === undefined) return { ok: false, defeito: { campo, motivo: `chave "${chave}" ausente no retorno` } };
  if (v === null) return { ok: false, defeito: { campo, motivo: `chave "${chave}" veio null — ausencia de leitura, nao lista vazia` } };
  if (!Array.isArray(v)) {
    return { ok: false, defeito: { campo, motivo: `chave "${chave}" deveria ser lista e veio ${typeof v}` } };
  }
  return { ok: true, itens: v };
}

function texto(v: unknown): string {
  return typeof v === "string" ? v.trim() : "";
}

// ============================================================================
// OS EXTRATORES
// ============================================================================

export type ContextoDaExtracao = {
  /** Data de referencia em ISO. Injetada, nao lida do relogio: a prova tem de ser reprodutivel. */
  hojeIso: string;
};

type Extrator = (t: RetornoDeFerramenta[], ctx: ContextoDaExtracao) => Extracao;

/**
 * ATO_CONFIRMACAO_CARD — a maior familia da operacao (43,2% das respostas).
 *
 * A fonte e `propose_action`, e e ela justamente porque o incidente de 01/09 (CONJ.2 VISTTA)
 * foi texto livre anunciando "6 Cards de Pausa Emitidos" com tabela e approval_id sem card
 * nenhum existir. Aqui `total` e a cardinalidade dos propose_action que voltaram `ok: true`
 * COM approval_id — nao ha como afirmar card que nao houve, porque o numero e a contagem dos
 * ids reais.
 *
 * Chamada com erro NAO derruba este molde, e essa e a unica excecao do modulo: `propose_action`
 * que recusou e um card que nao saiu, e o turno pode legitimamente ter emitido 2 e falhado 1.
 * O que a recusa faz e virar assunto do OUTRO molde (ATO_CARD_NAO_EMITIDO) quando nenhuma
 * passou. Zero sucessos aqui e ausencia de bloco, nao bloco com zero.
 */
const extrairConfirmacaoCard: Extrator = (t) => {
  const { usaveis, truncados } = colher(t, "propose_action");
  if (truncados) {
    return { ok: false, defeitos: [{ campo: "*", motivo: "propose_action veio truncado: nao da para contar approval_id em JSON cortado." }] };
  }

  const emitidos: string[] = [];
  for (const r of usaveis) {
    if (r.ok !== true) continue;
    const id = texto(r.approval_id);
    if (!id) continue;
    const resumo = texto(r.resumo).replace(/\s*\n\s*/g, " — ");
    emitidos.push(resumo ? `${resumo} (id ${id})` : `id ${id}`);
  }

  if (!emitidos.length) {
    return {
      ok: false,
      defeitos: [{ campo: "*", motivo: "nenhum propose_action com ok=true e approval_id neste turno: nao houve card a confirmar" }],
    };
  }
  return { ok: true, valores: { total: emitidos.length, emitidos } };
};

/**
 * ATO_CARD_NAO_EMITIDO — o negativo do anterior.
 *
 * `motivo` vem do erro literal da ferramenta que recusou, sem parafrase. Parafrasear aqui
 * seria reintroduzir geracao no unico campo do bloco.
 *
 * Nao emite se ALGUM card saiu: "nenhum card foi emitido" seria falso, e a confirmacao dos
 * que sairam e do outro molde.
 */
const extrairCardNaoEmitido: Extrator = (t) => {
  const propose = colher(t, "propose_action");
  const houveSucesso = propose.usaveis.some((r) => r.ok === true && texto(r.approval_id));
  if (houveSucesso) {
    return { ok: false, defeitos: [{ campo: "*", motivo: "houve card emitido neste turno: 'nenhum card foi emitido' seria falso" }] };
  }

  const motivos: string[] = [];
  for (const nome of ["propose_action", "validar_pedido_contra_contrato"]) {
    const c = colher(t, nome);
    for (const e of c.comErro) {
      const m = texto(e.erro);
      if (m && !motivos.includes(m)) motivos.push(m);
    }
    // Recusa que volta em `retorno.erro` com ok=false, e nao no campo `erro` do envelope.
    for (const r of c.usaveis) {
      if (r.ok === false) {
        const m = texto(r.erro) || texto(r.motivo) || texto(r.aviso);
        if (m && !motivos.includes(m)) motivos.push(m);
      }
    }
  }

  if (!motivos.length) {
    return {
      ok: false,
      defeitos: [{ campo: "motivo", motivo: "nenhuma recusa legivel de propose_action ou validar_pedido_contra_contrato neste turno" }],
    };
  }
  return { ok: true, valores: { motivo: motivos.join("\n\n") } };
};

/**
 * EST_ALERTAS_ABERTOS — duas ferramentas, e as DUAS obrigatorias.
 *
 * O gabarito afirma dois numeros. Se so uma das leituras chegou, emitir o bloco com a outra
 * em branco (ou em zero) afirmaria ausencia de pendencia que nao foi verificada. Exigir as
 * duas e o que faz este molde ou acertar ou nao emitir.
 */
const extrairAlertasAbertos: Extrator = (t, ctx) => {
  const defeitos: Defeito[] = [];

  const a = lerFerramenta(t, "get_alerts", "alertas");
  const r = lerFerramenta(t, "get_recommendations", "recomendacoes");
  if (!a.ok) defeitos.push(a.defeito);
  if (!r.ok) defeitos.push(r.defeito);
  if (!a.ok || !r.ok) return { ok: false, defeitos };

  const la = listaDeclarada(a.dado, "alertas_ativos", "alertas");
  const lr = listaDeclarada(r.dado, "recomendacoes_pendentes", "recomendacoes");
  if (!la.ok) defeitos.push(la.defeito);
  if (!lr.ok) defeitos.push(lr.defeito);
  if (!la.ok || !lr.ok) return { ok: false, defeitos };

  const linhas: string[] = [];
  for (const it of la.itens) {
    if (!ehObjeto(it)) continue;
    const titulo = texto(it.title) || texto(it.titulo) || texto(it.message) || texto(it.tipo);
    if (titulo) linhas.push(`alerta: ${titulo}`);
  }
  for (const it of lr.itens) {
    if (!ehObjeto(it)) continue;
    const titulo = texto(it.title) || texto(it.titulo);
    if (titulo) linhas.push(`recomendacao: ${titulo}`);
  }

  // Lista vazia e resultado legitimo (nada pendente) e o gabarito precisa de algo em {lista}.
  if (!linhas.length) linhas.push("Nada aberto nesta leitura.");

  return {
    ok: true,
    valores: { data: ctx.hojeIso, alertas: la.itens.length, recomendacoes: lr.itens.length, lista: linhas },
  };
};

/**
 * EST_CAMPANHAS_ATIVAS — o caso mais limpo dos cinco.
 *
 * `get_overview` DECLARA `campanhas_total` e `campanhas_ativas`. Nao ha contagem minha nem
 * cardinalidade: os dois numeros vem prontos da ferramenta, e a lista e so formatacao.
 */
const extrairCampanhasAtivas: Extrator = (t, ctx) => {
  const o = lerFerramenta(t, "get_overview", "*");
  if (!o.ok) return { ok: false, defeitos: [o.defeito] };

  const defeitos: Defeito[] = [];
  const total = inteiroDeclarado(o.dado, "campanhas_total", "total");
  const ativas = inteiroDeclarado(o.dado, "campanhas_ativas", "ativas");
  const lista = listaDeclarada(o.dado, "campanhas_ativas_lista", "lista");
  if (!total.ok) defeitos.push(total.defeito);
  if (!ativas.ok) defeitos.push(ativas.defeito);
  if (!lista.ok) defeitos.push(lista.defeito);
  if (!total.ok || !ativas.ok || !lista.ok) return { ok: false, defeitos };

  // Coerencia entre dois numeros que a MESMA ferramenta declarou. Ativas maior que o total
  // nao e ruido: e sinal de que a leitura mistura janelas ou empresas, e um bloco canonico
  // com numeros que se contradizem e pior que nenhum bloco.
  if (ativas.valor > total.valor) {
    return {
      ok: false,
      defeitos: [{ campo: "*", motivo: `incoerencia declarada por get_overview: campanhas_ativas (${ativas.valor}) maior que campanhas_total (${total.valor})` }],
    };
  }

  const linhas: string[] = [];
  for (const it of lista.itens) {
    if (!ehObjeto(it)) continue;
    const nome = texto(it.nome);
    if (!nome) continue;
    const conta = texto(it.conta);
    const gasto = texto(it.gasto_acumulado);
    const extras = [conta ? `conta ${conta}` : "", gasto ? `gasto acumulado ${gasto}` : ""].filter(Boolean);
    linhas.push(extras.length ? `${nome} — ${extras.join(", ")}` : nome);
  }
  if (!linhas.length && ativas.valor > 0) {
    return {
      ok: false,
      defeitos: [{ campo: "lista", motivo: `get_overview declarou ${ativas.valor} campanhas ativas e a lista veio sem nome legivel` }],
    };
  }
  if (!linhas.length) linhas.push("Nenhuma campanha ativa nesta leitura.");

  return { ok: true, valores: { data: ctx.hojeIso, total: total.valor, ativas: ativas.valor, lista: linhas } };
};

/**
 * EST_SAUDE_INTEGRACOES — o molde que exigiu corrigir o gabarito antes de poder ser ligado.
 *
 * O gabarito original afirmava "contas com coleta medida nos ultimos 7 DIAS". A RPC nao tem
 * janela de 7 dias: ela tem `dias_tolerancia`, que e PARAMETRO e vale 3 por padrao. Emitir
 * "7 dias" lendo uma leitura de 3 dias e o defeito mais grave que esta camada pode produzir —
 * numero certo com rotulo errado, travado, autoritativo e impossivel de o gestor conferir.
 * Por isso o gabarito passou a citar `dias_tolerancia` como valor, em vez de fixar a janela.
 *
 * `por_veredito` e mapa esparso: chave sem contagem simplesmente nao aparece. Aqui ausencia
 * PODE ser lida como zero, e a excecao se justifica porque `integracoes` declara o total e
 * corrobora o denominador — sem essa corroboracao eu estaria inferindo zero de silencio, que
 * e o que o resto deste modulo proibe.
 */
const extrairSaudeIntegracoes: Extrator = (t, ctx) => {
  const s = lerFerramenta(t, "saude_das_integracoes", "*");
  if (!s.ok) return { ok: false, defeitos: [s.defeito] };

  const defeitos: Defeito[] = [];
  const integracoes = inteiroDeclarado(s.dado, "integracoes", "integracoes");
  const tolerancia = inteiroDeclarado(s.dado, "dias_tolerancia", "tolerancia");
  const contas = listaDeclarada(s.dado, "contas", "detalhe");
  if (!integracoes.ok) defeitos.push(integracoes.defeito);
  if (!tolerancia.ok) defeitos.push(tolerancia.defeito);
  if (!contas.ok) defeitos.push(contas.defeito);
  if (!integracoes.ok || !tolerancia.ok || !contas.ok) return { ok: false, defeitos };

  const pv = s.dado.por_veredito;
  if (pv !== undefined && !ehObjeto(pv)) {
    return { ok: false, defeitos: [{ campo: "vivas", motivo: `por_veredito deveria ser objeto e veio ${typeof pv}` }] };
  }
  const bruto = ehObjeto(pv) ? pv.viva : undefined;
  if (bruto !== undefined && (typeof bruto !== "number" || !Number.isInteger(bruto) || bruto < 0)) {
    return { ok: false, defeitos: [{ campo: "vivas", motivo: `por_veredito.viva deveria ser inteiro nao negativo e veio ${String(bruto).slice(0, 40)}` }] };
  }
  const vivas = typeof bruto === "number" ? bruto : 0;

  if (vivas > integracoes.valor) {
    return {
      ok: false,
      defeitos: [{ campo: "*", motivo: `incoerencia declarada: por_veredito.viva (${vivas}) maior que integracoes (${integracoes.valor})` }],
    };
  }

  const linhas: string[] = [];
  for (const it of contas.itens) {
    if (!ehObjeto(it)) continue;
    const nome = texto(it.conta);
    if (!nome) continue;
    const af = ehObjeto(it.afirmado) ? texto(it.afirmado.status) : "";
    const ver = texto(it.veredito);
    // A doutrina do molde e a separacao entre o que o cadastro AFIRMA e o que o dado MEDE,
    // entao as duas colunas vao lado a lado por conta, nunca fundidas em um veredito unico.
    linhas.push(`${nome} — cadastro afirma "${af || "sem status"}", medicao diz "${ver || "sem veredito"}"`);
  }
  if (!linhas.length) {
    return { ok: false, defeitos: [{ campo: "detalhe", motivo: "contas veio sem nome legivel: sem detalhe o bloco afirmaria contagem sem lastro" }] };
  }

  return {
    ok: true,
    valores: { data: ctx.hojeIso, integracoes: integracoes.valor, vivas, tolerancia: tolerancia.valor, detalhe: linhas },
  };
};

const EXTRATORES: Record<string, Extrator> = {
  ATO_CONFIRMACAO_CARD: extrairConfirmacaoCard,
  ATO_CARD_NAO_EMITIDO: extrairCardNaoEmitido,
  EST_ALERTAS_ABERTOS: extrairAlertasAbertos,
  EST_CAMPANHAS_ATIVAS: extrairCampanhasAtivas,
  EST_SAUDE_INTEGRACOES: extrairSaudeIntegracoes,
};

/**
 * Monta o mapa campo->valor do molde a partir dos `toolResults` do turno.
 *
 * Deterministico sobre a mesma entrada: nao le relogio (a data vem de `ctx.hojeIso`), nao
 * itera objeto por ordem de chave e nao usa nada aleatorio. A mesma lista de toolResults
 * produz o mesmo mapa, sempre — e a prova confere isso por hash.
 */
export function extrairValoresDoMolde(opts: {
  codigo: string | null | undefined;
  toolResults: RetornoDeFerramenta[] | null | undefined;
  ctx: ContextoDaExtracao;
}): Extracao {
  const codigo = String(opts.codigo ?? "");
  const extrator = EXTRATORES[codigo];
  if (!extrator) {
    const motivo = SEM_EXTRATOR[codigo] ?? "molde sem extrator declarado";
    return { ok: false, defeitos: [{ campo: "*", motivo: `sem extrator para ${codigo || "(sem molde)"}: ${motivo}` }] };
  }
  const lista = Array.isArray(opts.toolResults) ? opts.toolResults : [];
  return extrator(lista, opts.ctx);
}

// ============================================================================
// PREMISSAS SOBRE A FORMA DOS toolResults — revalidar quando a latencia assentar
// ============================================================================
//
// O traffic-chat esta sendo alterado agora por outro agente que corrige regressao de
// latencia em producao. Estas sao as premissas que este modulo assume. Todas foram conferidas
// contra DADO REAL de `chat_messages.tool_results` em 03/09/2026, nao apenas contra o codigo,
// porque o codigo pode mudar antes da ligacao e o dado gravado e o contrato observado.
//
//  P1. O envelope e `{ tool, args, chars, cortado, retorno, erro? }`. (type ToolResult,
//      traffic-chat ~5842.)
//
//  P2. `cortado: true` implica `retorno` = STRING de JSON truncada em TOOLRES_TETO_PERSIST
//      (14.000). Medido: get_aprovacoes cortado em 59/67 chamadas. Se o teto subir ou o corte
//      passar a preservar o objeto, este modulo fica CONSERVADOR (recusa o que poderia usar),
//      nunca permissivo — a direcao segura.
//
//  P3. `erro` presente implica dado nao lido. Vale para as tres origens de erro do turno:
//      excecao da ferramenta, teto de ferramentas e deadline de coleta.
//
//  P4. `propose_action` devolve `{ ok, approval_id, resumo, aviso, expira_em }`. Medido em 530
//      chamadas, 140 com erro, nenhuma truncada.
//
//  P5. `get_overview` devolve `campanhas_total`, `campanhas_ativas` e
//      `campanhas_ativas_lista[{nome, conta, categoria, gasto_acumulado}]`. Medido em 27
//      chamadas, nenhuma truncada. E a premissa mais valiosa dos cinco moldes, porque as duas
//      contagens vem DECLARADAS.
//
//  P6. `get_alerts` devolve `{ alertas_ativos: [] }` e `get_recommendations` devolve
//      `{ nota, recomendacoes_pendentes: [] }`. Medido em 10 e 8 chamadas. Aqui a premissa e
//      mais fraca: as listas vieram curtas na amostra, e nenhuma truncada, mas nao ha
//      garantia de que uma conta com muitos alertas nao estoure o teto. `cortado` cobre o
//      caso, ao custo de o molde parar de emitir justamente quando ha muita pendencia — o que
//      e correto, so nao e agradavel.
//
//  P7. `saude_das_integracoes` devolve `{ integracoes, por_veredito, dias_tolerancia, contas,
//      nota }`, com `por_veredito` esparso. Medido em 9 chamadas.
//
//  P8. Ferramenta chamada mais de uma vez no turno: para leitura vale o ULTIMO retorno
//      usavel; para `propose_action` valem TODOS. Se o traffic-chat passar a deduplicar ou
//      reordenar toolResults, a premissa de "ultimo e o mais fresco" precisa ser reconferida.
