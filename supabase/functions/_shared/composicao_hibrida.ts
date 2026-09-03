// Composicao HIBRIDA: bloco canonico travado + analise gerada, unidos por CODIGO.
//
// O gestor leu a medicao (~5% por turno inteiro, ~48% por segmento), aceitou que 90% nao e
// alcancavel e escolheu o hibrido: a confirmacao do ato e os numeros saem travados no molde, a
// analise em volta continua livre.
//
// ============================================================================
// A ARMADILHA QUE ESTE MODULO EXISTE PARA FECHAR
// ============================================================================
//
// A implementacao obvia e errada e entregar o bloco canonico ao modelo pedindo que ele o
// reproduza literalmente. O modelo PARAFRASEIA. O determinismo morre no exato ponto que
// justifica a camada, e morre de forma INVISIVEL: o texto sai parecido o bastante para ninguem
// notar que mudou. Um R$ 1.512,00 que virou "cerca de mil e quinhentos" passa em qualquer
// revisao por amostragem.
//
// Por isso aqui nao existe caminho em que o bloco canonico atravesse o modelo. A funcao
// `compor` recebe o texto gerado como STRING JA PRONTA e concatena. O bloco e imutavel do
// ponto de vista do modelo porque o modelo nunca o teve nas maos para escrever.
//
// O SEGUNDO defeito, mais sutil: se o modelo escrever a mesma informacao que o codigo vai
// anexar, ela aparece DUAS VEZES na mesma mensagem — uma travada e uma variavel. Isso e pior
// que o estado de hoje, porque hoje a divergencia esta entre turnos (dificil de ver) e ali
// estaria dentro de uma unica mensagem (impossivel de nao ver, e destroi a confianca no
// numero travado). Fechado por `instrucaoDeComposicao`, abaixo.
//
// ============================================================================
// POSICAO DO BLOCO: SEMPRE NO INICIO. A decisao e do modulo, nao do molde.
// ============================================================================
//
// Consideradas as tres opcoes (antes, depois, ou por molde), o bloco vai no INICIO, sempre.
//
//  1. O bloco E a resposta; a analise e comentario. "Foram emitidos 2 cards" responde o que o
//     gestor pediu; os 1.900 chars de leitura em volta explicam o contexto.
//  2. O GESTOR AS VEZES LE POR VOZ. Por voz nao existe varredura visual: ele nao "bate o olho"
//     no fim da mensagem. Bloco no fim significa esperar a leitura inteira da analise antes de
//     ouvir se o card saiu — na media medida (1.933 chars) isso e mais de um minuto de audio
//     para receber um fato de 90 chars.
//  3. Ancorar em verdade primeiro. Com o bloco no fim, o gestor le a interpretacao antes do
//     fato e chega ao fato ja com a moldura da analise. Se a analise divergir do bloco, quem
//     le primeiro ganha — e o que tem de ganhar e o travado.
//  4. Beneficio de engenharia que nao e o motivo, mas confirma: com posicao fixa no inicio, o
//     bloco esta sempre em offset 0. Conferir integridade e `startsWith`, nao busca. Verificar
//     o trecho gerado e um slice. Posicao variavel por molde exigiria delimitador no texto, e
//     delimitador visivel vaza para o gestor (ou e lido em voz alta).
//
// Nao fiz a posicao configuravel por molde de proposito. Seria flexibilidade sem demanda: os 7
// componiveis sao todos "fato + interpretacao do fato", e nenhum deles pede a ordem inversa.
// Configuracao sem caso de uso e superficie de erro.

import type { Molde } from "./molde_pergunta.ts";
import type { GrupoDeComposicao, Resolucao } from "./resposta_canonica.ts";

/**
 * Separador entre bloco e analise.
 *
 * Linha em branco, nada mais. Considerei `---` (regua horizontal) e descartei: por voz um
 * leitor de tela ou fala "linha horizontal" ou engole, e nos dois casos o gestor recebe ruido
 * no lugar de uma pausa. Linha em branco vira pausa natural na fala e paragrafo no markdown.
 */
export const SEPARADOR = "\n\n";

export type Composicao =
  | {
    caminho: "canonico";
    /** Resposta final. Igual ao bloco: nao houve analise. */
    texto: string;
    bloco_canonico: string;
    trecho_gerado: null;
    molde: string;
    composicao: GrupoDeComposicao;
    versao: number;
  }
  | {
    caminho: "hibrido";
    texto: string;
    bloco_canonico: string;
    trecho_gerado: string;
    molde: string;
    composicao: GrupoDeComposicao;
    versao: number;
  }
  | {
    caminho: "llm";
    texto: string;
    bloco_canonico: null;
    trecho_gerado: string;
    molde: string | null;
    composicao: null;
    versao: null;
    motivo: string;
    /**
     * Preenchido SO no defeito descrito em `compor`: o modelo foi instruido a omitir um bloco
     * que depois nao materializou, entao a resposta tem um buraco. Null e o caso normal.
     */
    defeito: string | null;
  };

/**
 * Une o resultado canonico e o texto gerado.
 *
 * `gerado` e o texto que o modelo produziu, ja pronto. Esta funcao nunca chama modelo, nunca
 * reescreve o bloco e nunca interpola valor dentro dele — o bloco chega resolvido de
 * `resolverRespostaCanonica` e sai byte a byte igual.
 *
 * As decisoes de caminho:
 *
 *  - resolucao llm            -> caminho llm. Sem bloco. E o comportamento de hoje.
 *  - turno_inteiro            -> caminho canonico. Analise DESCARTADA se vier: o molde diz que
 *                                nao ha nada a acrescentar, e SIS_SONDA_OK reprova a sonda com
 *                                qualquer caractere extra.
 *  - nao_componivel           -> caminho canonico. Analise DESCARTADA. Aqui o descarte e a
 *                                regra de seguranca central: texto livre depois de uma recusa a
 *                                torna falsa.
 *  - segmento_componivel      -> caminho hibrido se houver analise, canonico se nao houver.
 *
 * Descartar em vez de recusar a emissao e deliberado, e e o oposto da fronteira canonico/LLM.
 * La, duvida derruba para o LLM porque emitir molde errado e pior. Aqui o bloco JA foi
 * validado: descartar a analise entrega uma resposta mais seca e 100% correta, enquanto
 * concatenar entrega uma resposta que pode se contradizer. O erro barato e a resposta seca.
 *
 * ============================================================================
 * O DEFEITO QUE O HIBRIDO CRIA E O BINARIO NAO TINHA — `instruiuOmitir`
 * ============================================================================
 *
 * No desenho binario a ordem era: classifica, resolve, emite OU chama o modelo. A resolucao
 * acontecia ANTES da geracao, entao ela nunca podia falhar depois.
 *
 * No hibrido a ordem muda por necessidade. A instrucao "nao escreva os numeros" tem de entrar
 * no prompt ANTES da geracao, e a resolucao do bloco s'o pode acontecer DEPOIS das ferramentas
 * (e dai que vem o numero). Abre-se uma janela: o modelo omite os numeros porque foi mandado
 * omitir, e a resolucao falha em seguida — campo obrigatorio sem valor, molde vencido, RPC que
 * voltou parcial. O resultado e a pior saida possivel: uma analise que comenta numeros que nao
 * aparecem em lugar nenhum da mensagem. Nao e resposta errada, e resposta MUTILADA, e o gestor
 * nao tem como saber que faltou algo.
 *
 * Quem chama passa `instruiuOmitir: true` quando colocou a instrucao no prompt. Se o bloco nao
 * materializar, `defeito` vem preenchido. O chamador NAO deve entregar essa resposta como
 * esta: o certo e regerar sem a instrucao. Entregar com uma nota de rodape ("nao consegui ler
 * os numeros") e o segundo melhor, e e melhor que o silencio — mas o dado fica devendo.
 *
 * Este modulo detecta e nomeia; nao decide o que fazer, porque a decisao (regerar custa um
 * turno de modelo) e do chamador.
 */
export function compor(opts: {
  resolucao: Resolucao;
  gerado?: string | null;
  /** true quando `instrucaoDeComposicao` foi de fato colocada no prompt deste turno. */
  instruiuOmitir?: boolean;
}): Composicao {
  const gerado = typeof opts.gerado === "string" ? opts.gerado.trim() : "";

  if (opts.resolucao.caminho === "llm") {
    return {
      caminho: "llm",
      texto: gerado,
      bloco_canonico: null,
      trecho_gerado: gerado,
      molde: opts.resolucao.molde ?? null,
      composicao: null,
      versao: null,
      motivo: opts.resolucao.motivo,
      defeito: opts.instruiuOmitir
        ? `resposta mutilada: o modelo foi instruido a omitir o bloco e a resolucao falhou (${opts.resolucao.motivo}). Regerar sem a instrucao.`
        : null,
    };
  }

  const r = opts.resolucao;
  const bloco = r.texto;
  const aceitaAnalise = r.composicao === "segmento_componivel";

  if (!aceitaAnalise || !gerado) {
    return {
      caminho: "canonico",
      texto: bloco,
      bloco_canonico: bloco,
      trecho_gerado: null,
      molde: r.molde,
      composicao: r.composicao,
      versao: r.versao,
    };
  }

  return {
    caminho: "hibrido",
    texto: bloco + SEPARADOR + gerado,
    bloco_canonico: bloco,
    trecho_gerado: gerado,
    molde: r.molde,
    composicao: r.composicao,
    versao: r.versao,
  };
}

// ============================================================================
// VERIFICACAO DA INTEGRIDADE DO BLOCO
// ============================================================================

/**
 * Confere que o bloco canonico saiu intacto no texto final, e devolve os limites do trecho
 * gerado.
 *
 * Existe por dois motivos praticos. Primeiro, a prova de reprodutibilidade precisa hashear SO
 * a parte fixa — a analise varia por desenho, entao hashear o texto final daria hash novo a
 * cada turno e a prova nao provaria nada. Segundo, e o contrato que o verificador pos-resposta
 * (outro dono) precisa para checar apenas o trecho GERADO, sem reprovar o canonico por "nao
 * seguir o formato do prompt".
 */
export function conferirIntegridade(c: Composicao): {
  intacto: boolean;
  motivo: string | null;
  /** Limites do trecho gerado dentro de `texto`. Null quando nao ha analise. */
  inicio_do_gerado: number | null;
  fim_do_gerado: number | null;
} {
  if (c.caminho === "llm") {
    return { intacto: true, motivo: null, inicio_do_gerado: 0, fim_do_gerado: c.texto.length };
  }

  // Posicao fixa no inicio torna a conferencia exata, nao heuristica.
  if (!c.texto.startsWith(c.bloco_canonico)) {
    return {
      intacto: false,
      motivo: "bloco canonico nao esta no inicio do texto final ou foi alterado",
      inicio_do_gerado: null,
      fim_do_gerado: null,
    };
  }

  if (c.caminho === "canonico") {
    if (c.texto.length !== c.bloco_canonico.length) {
      return {
        intacto: false,
        motivo: "caminho canonico com texto maior que o bloco: houve concatenacao indevida",
        inicio_do_gerado: null,
        fim_do_gerado: null,
      };
    }
    return { intacto: true, motivo: null, inicio_do_gerado: null, fim_do_gerado: null };
  }

  const inicio = c.bloco_canonico.length + SEPARADOR.length;
  if (c.texto.slice(c.bloco_canonico.length, inicio) !== SEPARADOR) {
    return {
      intacto: false,
      motivo: "separador esperado entre bloco e analise nao encontrado",
      inicio_do_gerado: null,
      fim_do_gerado: null,
    };
  }
  if (c.texto.slice(inicio) !== c.trecho_gerado) {
    return {
      intacto: false,
      motivo: "trecho gerado no texto final difere do que foi informado",
      inicio_do_gerado: null,
      fim_do_gerado: null,
    };
  }

  return { intacto: true, motivo: null, inicio_do_gerado: inicio, fim_do_gerado: c.texto.length };
}

// ============================================================================
// A INSTRUCAO AO MODELO
// ============================================================================
//
// Orcamento: o commit 0ed7a9f acabou de tirar 35% do prompt tirando doutrina das descricoes de
// ferramenta. Nao vou devolver esse peso. Por isso a instrucao e UMA linha, montada de um
// molde generico, e o unico trecho variavel e um rotulo curto derivado da CLASSE do molde —
// duas variantes, nao catorze regras.
//
// A instrucao entra SO quando o turno tem molde componivel resolvido. Turno sem molde nao
// recebe linha nenhuma, que e o caso da maioria dos turnos (66,8% e analise nova). O custo
// medio no prompt e, portanto, muito menor que o custo da linha isolada.
//
// Por que citar o rotulo em vez de mandar so "nao repita o bloco": o modelo nao ve o bloco. Se
// a instrucao nao disser O QUE ja esta coberto, ele nao tem como saber o que evitar, e a
// escolha e entre repetir tudo ou omitir a analise. O rotulo e o minimo que resolve.

/** Rotulo curto do que ja vai anexado, derivado da classe. Duas variantes cobrem os 7. */
function rotuloDoBloco(classe: string): string {
  return classe === "confirmacao_de_ato" ? "a confirmacao dos cards" : "os numeros desta leitura";
}

/**
 * Linha a acrescentar ao prompt quando o turno vai ser composto.
 *
 * Devolve "" quando nao ha composicao, e nesse caso NADA e acrescentado ao prompt: silencio e
 * mais barato e mais seguro que uma instrucao condicional que o modelo tem de interpretar.
 */
export function instrucaoDeComposicao(resolucao: Resolucao): string {
  if (resolucao.caminho !== "canonico") return "";
  if (resolucao.composicao !== "segmento_componivel") return "";
  const rotulo = rotuloDoBloco(resolucao.classe);
  return `Nao escreva ${rotulo}: ja vai anexado no topo, travado por codigo. ` +
    `Escreva so a analise em volta, sem repetir esses dados.`;
}

// ============================================================================
// TELEMETRIA
// ============================================================================

export type LinhaDeComposicao = {
  molde: string | null;
  caminho: "canonico" | "hibrido" | "llm";
  motivo: string | null;
  confianca: string;
  versao: number | null;
  /** NULL, nao zero, quando nao houve bloco: ausencia e diferente de vazio. */
  chars_canonicos: number | null;
  chars_gerados: number | null;
  parametros: Record<string, unknown>;
};

/**
 * Linha para public.resolucoes_de_molde. Grava-se nos TRES caminhos.
 *
 * Os dois tamanhos vao crus, e nao a proporcao: proporcao e derivada, e derivada gravada
 * envelhece quando a formula muda. `proporcao_canonica_medida()` recalcula na leitura. Isso e
 * o que vai permitir dizer se os ~48% estimados se confirmaram em producao — a primeira rodada
 * desta camada produziu numero errado justamente por estimar em vez de medir.
 */
export function linhaDeComposicao(molde: Molde, c: Composicao): LinhaDeComposicao {
  return {
    molde: c.molde,
    caminho: c.caminho,
    // O defeito de resposta mutilada ENTRA em `motivo`, e nao em coluna propria, porque a
    // consulta de governanca que ja existe agrupa por motivo — defeito em coluna nova ficaria
    // invisivel para quem le o painel de hoje. A string do defeito ja carrega o motivo
    // original entre parenteses, entao nada se perde.
    motivo: c.caminho === "llm" ? (c.defeito ?? c.motivo) : null,
    confianca: molde.confianca,
    versao: c.versao,
    chars_canonicos: c.bloco_canonico === null ? null : c.bloco_canonico.length,
    chars_gerados: c.trecho_gerado === null ? null : c.trecho_gerado.length,
    parametros: { ...molde.parametros },
  };
}
