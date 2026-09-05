// VERIFICACAO POS-RESPOSTA: o ponto unico de conferencia antes da resposta sair.
//
// Desenhada em 03/09/2026 como a quarta peca da camada contra alucinacao (as outras tres:
// contrato de pedido 06/08, envelope de cobertura 07/08, idempotencia neste ciclo). O contrato
// dela vivia em _shared/resposta_canonica.ts sob o titulo "descrito, nao implementado". Este
// arquivo o implementa. Onde eu discordei do desenho, esta escrito ABAIXO com o numero medido
// que me fez discordar — nao mudei nada em silencio.
//
// ============================================================================
// O QUE ESTA CAMADA E, E O QUE ELA NAO E
// ============================================================================
//
// Ela NAO julga se a resposta esta boa, nem reescreve prosa, nem chama modelo. Ela responde
// UMA pergunta, tres vezes: *o que esta resposta afirma foi conferido contra a fonte?*
//
// Cada conferencia devolve um de tres vereditos, e a distincao entre o segundo e o terceiro e
// a razao de o arquivo existir:
//
//   conferido       foi lido na fonte e bate.
//   reprovado       foi lido na fonte e NAO bate. Ha o que dizer ao gestor.
//   nao_conferido   a fonte nao respondeu. NAO HA VEREDITO — e isso precisa aparecer.
//
// ============================================================================
// O PRINCIPIO QUE ESTE ARQUIVO NAO PODE VIOLAR (e por que ele e o candidato obvio a viola-lo)
// ============================================================================
//
// Na semana de 29/08 a 04/09/2026 apareceram CINCO fail-opens diferentes neste projeto, todos
// da mesma familia: ausencia de sinal virando permissao.
//   - `resultado->>'aprovado'` era chave inexistente; NULL virou "sem risco" (03/09);
//   - `veredito === "reprova"` deixava passar todo veredito desconhecido na meta-actions;
//   - `parData` nulo sem erro liberava a publicacao no gerar-legendas;
//   - `(...)::boolean is false` sobre NULL liberava no portao de compliance;
//   - e o quinto esta em `aprovacoes.ts`: consulta falha absolvia em SILENCIO.
//
// Uma camada cuja unica funcao e conferir e, por construcao, o lugar mais provavel do SEXTO.
// As regras que ela segue, entao:
//
//   [R1] Nao existe `catch` que devolva sucesso. Falha vira `nao_conferido` COM MOTIVO.
//   [R2] `nao_conferido` nunca e somado a `conferido` em nenhuma contagem, e nunca satisfaz
//        `estaLimpo`. Quem quiser tratar os dois igual tem de escrever isso explicitamente.
//   [R3] A decisao e por LISTA DE LIBERADOS, nunca por ausencia de reprovacao. Veredito que
//        este arquivo nao conhece cai em `nao_conferido`, nao em `conferido`.
//   [R4] Se a propria verificacao quebrar, isso vai para `defeito` E para a nota do gestor.
//        Verificador que morre calado e pior que verificador ausente, porque o painel continua
//        verde. Foi o que aconteceu com a auditoria de 13/08 (10 de 12 funcoes devolviam
//        PGRST202 e o teste por HTTP "confirmou" um conserto que era no-op).
//   [R5] Nada aqui BLOQUEIA resposta. Ela declara. Uma camada nova com poder de veto sobre
//        todo turno e um modo de falha novo do tamanho do produto; declarar nao tem esse risco.

import { conferirApprovalIds, approvalIdsInventados } from "./aprovacoes.ts";

// ============================================================================
// VEREDITO
// ============================================================================

/** Os tres estados. Nao ha um quarto, e `conferido` nao e o default de nada. */
export type Veredito = "conferido" | "reprovado" | "nao_conferido";

/** Vocabulario aceito. Rotulo fora daqui cai em `nao_conferido` (R3). */
export const VEREDITOS_CONHECIDOS: readonly Veredito[] = [
  "conferido",
  "reprovado",
  "nao_conferido",
];

export type Conferencia = {
  /** `identificadores` | `cobertura` | `contrato_do_pedido`. */
  nome: string;
  veredito: Veredito;
  /** Legivel, sempre presente fora de `conferido`. E o dado de governanca. */
  motivo: string | null;
  /** Itens nomeados: ids, campos, numeros. Vazio nao e o mesmo que ausente. */
  itens: string[];
};

/**
 * Normaliza um veredito vindo de fora (RPC, jsonb, string do banco) SEM abrir buraco.
 *
 * `conferido` so sai daqui se a entrada for literalmente "conferido". Qualquer outra coisa —
 * undefined, null, "ok", "aprovado", vocabulario novo que alguem acrescentou no banco — vira
 * `nao_conferido`. E o oposto de `x !== "reprova"`, que foi o defeito da meta-actions.
 */
export function vereditoDe(v: unknown): Veredito {
  const s = String(v ?? "").trim().toLowerCase();
  return (VEREDITOS_CONHECIDOS as readonly string[]).includes(s) ? (s as Veredito) : "nao_conferido";
}

// ============================================================================
// ESCOPO: QUAL TRECHO DA MENSAGEM CADA CONFERENCIA OLHA
// ============================================================================
//
// O contrato de 03/09 pedia recorte por TRECHO e nao por turno, e nisso ele esta certo: em
// turno hibrido o bloco canonico nao passou por geracao (reprovar ali e sempre falso positivo)
// e o trecho gerado passou (e o unico que pode alucinar).
//
// A condicao (c) do contrato estava marcada como "vale discutir antes de implementar", e ela e
// o unico ponto do desenho que nao e um simples recorte. O texto dela: "o trecho gerado do
// hibrido foi produzido sob a instrucao de NAO repetir o bloco. Um verificador que exija 'a
// resposta declara os numeros' reprovaria o trecho por obedecer."
//
// RESOLVIDO ASSIM, e concordo com o diagnostico: SAO DOIS ESCOPOS, nao um.
//
//   escopo de FABRICACAO    o trecho gerado. So ele pode inventar um identificador.
//   escopo de COMPLETUDE    a mensagem INTEIRA. Cobertura e contrato falam do que a mensagem
//                           entrega como um todo, e o bloco canonico conta a favor dela.
//
// Sem essa separacao, a conferencia de cobertura reprovaria o hibrido por obediencia, que era
// exatamente o risco apontado. Com ela, cada regra ve o texto de que precisa e nenhuma ve
// menos do que precisa.
//
// NOTA DE ESTADO (medido em 04/09/2026): a camada de composicao hibrida esta pronta e provada
// mas NAO esta ligada — o ponto de ligacao em resposta_canonica.ts segue "NAO APLICADO DE
// PROPOSITO", e traffic-chat nao importa `compor`. Entao HOJE, em producao, 100% dos turnos
// caem no ramo `llm` e os dois escopos coincidem na mensagem inteira. O recorte por trecho
// esta implementado porque e o contrato e porque custa 20 linhas, mas ele e INERTE ate alguem
// ligar a composicao. Isso e informacao, nao defeito: quem ligar a composicao nao precisa
// voltar aqui.
//
// LEVADO AO GESTOR EM 05/09/2026, com a decisao registrada: NAO ligar agora. Fica sabido, e
// nao pendente. Quem reabrir o assunto reabre por decisao nova, nao por descoberta.
//
// O traffic-agent-job tambem cai 100% em `llm`, e por um motivo mais forte: ele nunca importou
// `resposta_canonica`. Sintese de job e sempre texto de modelo, entao nem existe bloco canonico
// para recortar. `superficie: "job"` nao muda escopo nenhum — muda so o fecho da nota.

export type CaminhoDaComposicao = "canonico" | "hibrido" | "llm";

export type EscopoDoTexto = {
  /** O que olhar para julgar FABRICACAO. Vazio = nada a conferir (canonico puro). */
  fabricacao: string;
  /** O que olhar para julgar COMPLETUDE. Sempre a mensagem inteira. */
  completude: string;
  /** true quando o turno nao deve ser conferido por trecho: incidente de composicao. */
  recorte_invalido: boolean;
  motivo: string | null;
};

/**
 * Aplica o contrato de escopo.
 *
 * `integridadeIntacta === false` e o caso (b) do contrato: alguem mexeu no texto entre a
 * composicao e a persistencia, entao o offset nao aponta para o que se pensa que aponta.
 * Conferir por trecho um texto adulterado confere o slice errado — e conferir o slice errado
 * silenciosamente e pior que nao conferir. Aqui isso vira `recorte_invalido`, que o chamador
 * traduz em `nao_conferido` mais um incidente nomeado.
 */
export function escopoDaVerificacao(opts: {
  texto: string;
  caminho: CaminhoDaComposicao;
  /** Offset devolvido por `conferirIntegridade`. Null fora do hibrido. */
  inicioDoGerado?: number | null;
  /** Resultado de `conferirIntegridade(c).intacto`. Undefined quando nao houve composicao. */
  integridadeIntacta?: boolean;
}): EscopoDoTexto {
  const texto = String(opts.texto ?? "");

  if (opts.integridadeIntacta === false) {
    return {
      fabricacao: "",
      completude: texto,
      recorte_invalido: true,
      motivo:
        "integridade da composicao reprovou: o texto final foi alterado entre a composicao e a " +
        "persistencia, entao o offset do trecho gerado nao e confiavel. Incidente da camada de " +
        "composicao, nao da verificacao.",
    };
  }

  if (opts.caminho === "canonico") {
    // Nao passou por geracao. Se o texto canonico esta errado, o conserto e no registro
    // (`moldes_de_resposta`) e a deteccao e por `revalidar_ate` — nao por este verificador.
    return { fabricacao: "", completude: texto, recorte_invalido: false, motivo: null };
  }

  if (opts.caminho === "hibrido") {
    const ini = opts.inicioDoGerado;
    if (typeof ini !== "number" || ini < 0 || ini > texto.length) {
      // Caminho hibrido declarado sem offset utilizavel: nao ha recorte a fazer. NAO caia para
      // "confere o texto inteiro" — isso reprovaria o bloco canonico por obediencia, que e o
      // falso positivo que o contrato de escopo existe para evitar.
      return {
        fabricacao: "",
        completude: texto,
        recorte_invalido: true,
        motivo: `caminho hibrido sem inicio_do_gerado utilizavel (recebido: ${String(ini)})`,
      };
    }
    return { fabricacao: texto.slice(ini), completude: texto, recorte_invalido: false, motivo: null };
  }

  return { fabricacao: texto, completude: texto, recorte_invalido: false, motivo: null };
}

// ============================================================================
// CONFERENCIA 1 — IDENTIFICADOR FABRICADO
// ============================================================================
//
// MEDIDO EM 04/09/2026 sobre as 781 respostas de assistente da base (23/07 a 04/09):
//   178 respostas citam identificador em formato UUID (346 citacoes);
//   28 citacoes nao existem em approval_requests da empresa (24 hexadecimais + 4 fora do hexa);
//   essas 28 estao em 15 respostas;
//   5 dessas 15 sairam SEM NENHUM SINAL ao gestor (04/08 x2, 22/08 x2, 24/08 x1), somando 8
//     citacoes fabricadas entregues como fato;
//   as outras 10 (a partir de 01/09) ja trazem o texto do guarda — foi quando ele entrou.
//
// Ou seja: a deteccao existe e funciona no chat desde 01/09. O que esta conferencia acrescenta
// nao e a deteccao, sao tres coisas:
//   (1) o terceiro estado. `approvalIdsInexistentes` respondia lista de dois estados e o
//       `nao_conferido` sumia (ver o comentario longo em aprovacoes.ts);
//   (2) um ponto unico, com veredito registrado, em vez de embutido no meio de uma funcao que
//       tambem reescreve prosa;
//   (3) cobertura do caminho que NAO tinha guarda nenhum, o traffic-agent-job — ver o fim do
//       arquivo, secao "A COLETA PROFUNDA".

export async function conferirIdentificadores(opts: {
  /** Trecho no escopo de FABRICACAO. So ele pode ter inventado. */
  trecho: string;
  companyId: string;
  cardsDaRodada?: Array<{ approval_id?: unknown }> | null;
  cardsDoTurno?: Array<{ approval_id?: unknown }> | null;
  retornosDeFerramenta?: Array<{ retorno?: unknown }> | null;
  buscar: (ids: string[]) => Promise<Array<{ id?: unknown }> | null>;
}): Promise<Conferencia> {
  const candidatos = approvalIdsInventados(opts.trecho, {
    cardsDaRodada: opts.cardsDaRodada ?? null,
    cardsDoTurno: opts.cardsDoTurno ?? null,
    retornosDeFerramenta: opts.retornosDeFerramenta ?? null,
  });
  if (!candidatos.length) {
    return { nome: "identificadores", veredito: "conferido", motivo: null, itens: [] };
  }

  const v = await conferirApprovalIds(candidatos, {
    companyId: opts.companyId,
    buscar: opts.buscar,
  });

  // Ordem das clausulas: `nao_conferido` vem ANTES de `conferido`. Se um id foi conferido e
  // existe e outro nao pode ser conferido, o veredito do turno e "nao conferi tudo" — o
  // parcial nao herda o verde da parte que deu certo.
  if (v.inventados.length) {
    return {
      nome: "identificadores",
      veredito: "reprovado",
      motivo: v.nao_conferidos.length
        ? `${v.inventados.length} identificador(es) conferido(s) e inexistente(s); ` +
          `${v.nao_conferidos.length} nao pude conferir (${v.motivo})`
        : `${v.inventados.length} identificador(es) citado(s) nao existe(m) em approval_requests desta empresa`,
      itens: [...v.inventados, ...v.nao_conferidos],
    };
  }
  if (v.nao_conferidos.length) {
    return {
      nome: "identificadores",
      veredito: "nao_conferido",
      motivo: v.motivo ?? "conferencia de identificadores nao concluida, sem motivo registrado",
      itens: v.nao_conferidos,
    };
  }
  return { nome: "identificadores", veredito: "conferido", motivo: null, itens: [] };
}

// ============================================================================
// CONFERENCIA 2 — COBERTURA MAL DECLARADA
// ============================================================================
//
// MEDIDO EM 04/09/2026: 49 turnos tiveram retorno de ferramenta com `restantes > 0`. Em 31
// deles (63,3%) a resposta nao diz uma palavra sobre o que ficou de fora. As ferramentas sao
// as pagináveis: get_criativos_conteudo, get_detalhe_anuncios, get_estrutura_conjuntos.
//
// A MEDICAO TAMBEM MATOU A IMPLEMENTACAO OBVIA, e vale registrar porque ela e tentadora:
// "cheque se a resposta cita o numero de restantes". Rodei isso contra os 49 turnos e 31
// "citam o numero" — porque `restantes` costuma ser 1, 2, 6, e esses digitos aparecem em
// qualquer texto com tabela e data. O detector teria ~63% de acerto aparente e ZERO poder
// discriminante. Julgar a prosa do modelo por regex e a corrida que `aprovacoes.ts` ja perdeu
// duas vezes ("Cards 1 e 2 Emitidos" nao casava a expressao de claim).
//
// ENTAO ESTA CONFERENCIA NAO JULGA A PROSA. Ela MONTA o envelope, de codigo, a partir dos
// numeros do retorno, e exige a presenca do PROPRIO envelope. Duas consequencias, as duas
// desejadas:
//   - impossivel acusar falso: o pior caso e uma linha redundante, nao um gestor acusado de
//     omitir o que ele declarou;
//   - o gestor passa a ver os restantes SEMPRE, com o numero certo, escrito por quem tem o
//     numero — em vez de depender de o modelo lembrar.
//
// Isto e o "envelope de cobertura passa a ser obrigatorio na saida" do pedido, na unica forma
// que nao depende de adivinhar intencao de texto.

/** Marca literal do envelope. E CONTRATO com a auditoria em SQL: mudar aqui quebra o PO. */
export const MARCA_DO_ENVELOPE = "Cobertura desta leitura:";

export type EnvelopeDeCobertura = {
  ferramenta: string;
  exibidos: number | null;
  total: number | null;
  restantes: number | null;
  omitidos: number | null;
  aviso_corte: string | null;
};

function num(v: unknown): number | null {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

/**
 * Le os envelopes que as ferramentas ja devolvem. NAO inventa nenhum: ferramenta sem envelope
 * nao entra, porque ausencia de envelope aqui significa "esta ferramenta nao pagina", e nao
 * "esta ferramenta escondeu algo".
 */
export function envelopesDosRetornos(
  toolResults: Array<{ tool?: unknown; retorno?: unknown }> | null | undefined,
): EnvelopeDeCobertura[] {
  const out: EnvelopeDeCobertura[] = [];
  for (const t of toolResults ?? []) {
    const r = t?.retorno;
    if (!r || typeof r !== "object" || Array.isArray(r)) continue;
    const o = r as Record<string, unknown>;
    const restantes = num(o.restantes);
    const omitidos = num(o.omitidos);
    const aviso = typeof o.aviso_corte === "string" && o.aviso_corte.trim() ? o.aviso_corte.trim() : null;
    if ((restantes ?? 0) <= 0 && (omitidos ?? 0) <= 0 && !aviso) continue;
    out.push({
      ferramenta: String(t?.tool ?? "ferramenta"),
      exibidos: num(o.exibidos),
      total: num(o.total_anuncios) ?? num(o.total) ?? num(o.inventario_global),
      restantes,
      omitidos,
      aviso_corte: aviso,
    });
  }
  return out;
}

/** Uma linha por ferramenta que cortou. Determinista: mesmos numeros, mesmo texto. */
export function textoDoEnvelope(envs: EnvelopeDeCobertura[]): string {
  if (!envs.length) return "";
  const linhas = envs.map((e) => {
    const partes: string[] = [];
    if (e.exibidos !== null && e.total !== null) partes.push(`${e.exibidos} de ${e.total} itens`);
    else if (e.exibidos !== null) partes.push(`${e.exibidos} itens`);
    if ((e.restantes ?? 0) > 0) partes.push(`${e.restantes} restante(s) nao lido(s) nesta rodada`);
    if ((e.omitidos ?? 0) > 0) partes.push(`${e.omitidos} omitido(s) por limite de payload`);
    // A frase final e a que importa e nao pode ser cortada: o gestor tem de saber que o que
    // faltou EXISTE. Tratar item omitido como inexistente ja fez anuncio existente passar por
    // inexistente nesta base (get_criativos_conteudo, doutrina do proprio retorno).
    return `- \`${e.ferramenta}\`: ${partes.join("; ")}. Os itens que faltam EXISTEM — nao foram lidos.`;
  });
  return `**${MARCA_DO_ENVELOPE}**\n${linhas.join("\n")}`;
}

export function conferirCobertura(opts: {
  /** Escopo de COMPLETUDE: a mensagem inteira. Ver o comentario de escopo. */
  textoCompleto: string;
  toolResults: Array<{ tool?: unknown; retorno?: unknown }> | null | undefined;
}): Conferencia & { envelope: string } {
  const envs = envelopesDosRetornos(opts.toolResults);
  if (!envs.length) {
    return { nome: "cobertura", veredito: "conferido", motivo: null, itens: [], envelope: "" };
  }
  const envelope = textoDoEnvelope(envs);
  // Idempotencia: turno continuado reentra aqui com a mensagem que ja recebeu a nota. Anexar
  // de novo produziria dois envelopes contraditorios na mesma mensagem.
  if (String(opts.textoCompleto ?? "").includes(MARCA_DO_ENVELOPE)) {
    return { nome: "cobertura", veredito: "conferido", motivo: null, itens: [], envelope: "" };
  }
  return {
    nome: "cobertura",
    veredito: "reprovado",
    motivo: `${envs.length} ferramenta(s) cortaram a leitura e a resposta saiu sem o envelope de cobertura`,
    itens: envs.map((e) => `${e.ferramenta}: restantes=${e.restantes ?? 0} omitidos=${e.omitidos ?? 0}`),
    envelope,
  };
}

// ============================================================================
// CONFERENCIA 3 — CONTRATO DE PEDIDO
// ============================================================================
//
// AQUI EU DISCORDO DE PARTE DO PEDIDO, e a discordancia e o resultado de rodar o contrato
// contra o historico inteiro. Os numeros, medidos em 04/09/2026 sobre os 269 cards de
// `approval_requests`, chamando `public.validar_pedido_contra_contrato(action, payload)` em
// cada um:
//
//   232 cards  contrato conferido e valido
//    22 cards  `contrato_desconhecido` — nenhum campo declarado para a acao
//              (pausar_criativo 15, pausar_campanha 4, renomear_criativo 2, ativar_criativo 1)
//    15 cards  contrato reprovou
//
// Dos 15 reprovados:
//    3  reprovacao CORRETA (1 objetivo fora dos valores aceitos, 2 conjunto de destino com
//       Criativo Dinamico). Todos os tres estao com status `rejected` — nenhum dano.
//   10  reprovados por `special_ad_categories` (6 em criar_campanha, 1 em
//       alterar_categoria_especial_campanha) e `plataformas_publicacao` (3 em
//       criar_conjunto_a_partir_de) — E TODOS OS DEZ EXECUTARAM COM ok=true NA META.
//    2  reprovados por `plataformas_publicacao` e nunca executados: indeterminados.
//
// Isto e uma taxa de falso positivo de 10 em 15 (67%) no veredito "reprovado". A causa nao e o
// verificador: e a TABELA. As linhas `criar_campanha.special_ad_categories` e
// `criar_conjunto_a_partir_de.plataformas_publicacao` foram semeadas de payload de card de
// CREDITO, onde o campo e de fato exigido, e viraram `obrigatorio` para toda campanha e todo
// conjunto. O executor tem default para os dois. O contrato ficou mais restrito que o executor.
//
// DUAS CONSEQUENCIAS PARA O DESENHO, e as duas contrariam a leitura mais direta do pedido:
//
//  (1) "Contrato de pedido nao conferido, usado em apenas 2,6% dos turnos de ato" mede a
//      frequencia com que o MODELO chama a tool `validar_pedido_contra_contrato` (medi 3,6%:
//      7 de 192 turnos de ato). Mas essa tool e ADVISORIA — ela nao barra nada. O portao que
//      vale para anuncio ja existe, e ja e fail-closed: `t_propose_criacao` chama
//      `pedido_de_anuncio_completo` e, se a RPC nao responde, devolve
//      `verificacao_do_pedido_indisponivel` e NAO emite o card (traffic-chat ~4122-4128). Isso
//      cobre os 180 cards de `criar_anuncio_a_partir_de`, dois tercos da base. A lacuna real
//      nao e "o modelo nao chama a tool"; e que as OUTRAS acoes com contrato declarado
//      (criar_conjunto 47, criar_campanha 15, ajustar_posicionamentos 1, renomear_campanha 3,
//      alterar_categoria 1 = 67 cards) nao passam por conferencia nenhuma antes de emitir.
//
//  (2) Por isso esta conferencia NAO transforma "reprovado" em recusa, e NAO suprime card.
//      Com 67% de falso positivo medido, um alarme de recusa treinaria o gestor a ignorar a
//      unica linha da resposta que ele precisa ler — o mesmo raciocinio pelo qual o `bun audit`
//      e o `deno lint` deste repositorio sao informativos: job que nasce vermelho ensina a
//      ignorar o CI. O que ela faz e DECLARAR divergencia, nomeando o campo, com a palavra
//      "confira" e nao "recusei".
//
// O conserto dos 10 falsos positivos e de DADO, nao de codigo: tirar `obrigatorio` das duas
// linhas ou condiciona-las a credito. Nao fiz porque o contrato tem dono declarado ("so entra
// por EVIDENCIA: payload de card que executou com sucesso, ou declaracao explicita de quem le
// o codigo do executor") e mexer nele por conta propria e adivinhar a lista — o que o comentario
// da propria tabela diz que ja falhou tres vezes aqui. Fica registrado para o gestor coordenar.

/** Chaves de veredito que a RPC do contrato usa. Lidas por lista, nunca por ausencia (R3). */
export type VeredictoDoContrato = {
  valido?: unknown;
  motivo?: unknown;
  recusa?: unknown;
  faltando?: unknown;
  valores_invalidos?: unknown;
  nao_suportados?: unknown;
  mensagem?: unknown;
};

export type CardParaConferir = { id: string; action: string; payload: unknown };

function listaDe(v: unknown): string[] {
  return Array.isArray(v) ? v.map((x) => String(x ?? "").trim()).filter(Boolean) : [];
}

export async function conferirContratoDoPedido(opts: {
  /** approval_ids emitidos neste turno. Sem card emitido, nada a conferir. */
  approvalIds: string[];
  /** Le action + payload REAIS do banco: e o objeto que o executor vai consumir, nao o que o modelo pediu. */
  buscarCards: (ids: string[]) => Promise<CardParaConferir[] | null>;
  validar: (acao: string, pedido: unknown) => Promise<VeredictoDoContrato | null>;
}): Promise<Conferencia> {
  const ids = [...new Set(opts.approvalIds.map((s) => String(s ?? "").trim()).filter(Boolean))];
  if (!ids.length) {
    return { nome: "contrato_do_pedido", veredito: "conferido", motivo: null, itens: [] };
  }

  let cards: CardParaConferir[] | null = null;
  try {
    cards = await opts.buscarCards(ids);
  } catch (e) {
    return {
      nome: "contrato_do_pedido",
      veredito: "nao_conferido",
      motivo: `leitura dos cards do turno falhou: ${String((e as Error)?.message ?? e).slice(0, 200)}`,
      itens: ids,
    };
  }
  if (cards == null) {
    return {
      nome: "contrato_do_pedido",
      veredito: "nao_conferido",
      motivo: "leitura dos cards do turno devolveu resposta vazia sem erro",
      itens: ids,
    };
  }

  // Card emitido que a leitura nao trouxe: nao ha payload para conferir. Isto e ausencia de
  // veredito, e nao ausencia de problema.
  const lidos = new Set(cards.map((c) => String(c.id).toLowerCase()));
  const semPayload = ids.filter((id) => !lidos.has(id.toLowerCase()));

  const desconhecidos: string[] = [];
  const divergentes: string[] = [];
  const naoConferidos: string[] = [...semPayload];
  const motivos: string[] = [];

  for (const c of cards) {
    let v: VeredictoDoContrato | null = null;
    try {
      v = await opts.validar(c.action, c.payload);
    } catch (e) {
      naoConferidos.push(`${c.action} (${c.id})`);
      motivos.push(`RPC do contrato falhou em ${c.action}: ${String((e as Error)?.message ?? e).slice(0, 120)}`);
      continue;
    }
    if (v == null || typeof v !== "object") {
      // Resposta vazia sem erro: a forma exata do episodio de 03/09 no gerar-legendas.
      naoConferidos.push(`${c.action} (${c.id})`);
      motivos.push(`RPC do contrato devolveu resposta vazia em ${c.action}`);
      continue;
    }
    if (String(v.motivo ?? "") === "contrato_desconhecido") {
      desconhecidos.push(c.action);
      continue;
    }
    // `valido` e lido por igualdade com TRUE. undefined/null/"" nao passam — e a diferenca
    // entre esta linha e `v.valido !== false`, que absolveria por ausencia.
    if (v.valido === true) continue;
    if (v.valido === false) {
      const campos = [
        ...listaDe(v.faltando).map((f) => `faltando ${f}`),
        ...listaDe(v.valores_invalidos).map((f) => `valor nao aceito em ${f}`),
        ...listaDe(v.nao_suportados).map((f) => `nao suportado: ${f}`),
      ];
      divergentes.push(`${c.action}: ${campos.length ? campos.join(", ") : String(v.recusa ?? "recusa sem campo nomeado")}`);
      continue;
    }
    // Chegou aqui: `valido` existe mas nao e booleano — vocabulario que este codigo nao
    // conhece. R3: cai em nao_conferido, nao em conferido.
    naoConferidos.push(`${c.action} (${c.id})`);
    motivos.push(`veredito de contrato em formato desconhecido para ${c.action}: valido=${JSON.stringify(v.valido)}`);
  }

  if (naoConferidos.length) {
    return {
      nome: "contrato_do_pedido",
      veredito: "nao_conferido",
      motivo: motivos.length
        ? motivos.slice(0, 3).join(" | ")
        : `${naoConferidos.length} card(s) emitido(s) sem payload legivel para conferir o contrato`,
      itens: [...new Set([...naoConferidos, ...divergentes, ...desconhecidos.map((a) => `${a}: contrato nao declarado`)])],
    };
  }
  if (divergentes.length) {
    return {
      nome: "contrato_do_pedido",
      veredito: "reprovado",
      motivo: `${divergentes.length} card(s) divergem do contrato declarado`,
      itens: divergentes,
    };
  }
  if (desconhecidos.length) {
    return {
      nome: "contrato_do_pedido",
      veredito: "nao_conferido",
      motivo: `nenhum contrato declarado para: ${[...new Set(desconhecidos)].join(", ")}`,
      itens: [...new Set(desconhecidos)].map((a) => `${a}: contrato nao declarado`),
    };
  }
  return { nome: "contrato_do_pedido", veredito: "conferido", motivo: null, itens: [] };
}

// ============================================================================
// O PONTO UNICO
// ============================================================================

export type ResultadoDaVerificacao = {
  conferencias: Conferencia[];
  /** true SO se as tres conferencias devolveram `conferido`. `nao_conferido` nao conta (R2). */
  limpo: boolean;
  /** Texto a ANEXAR na resposta. "" quando nada precisa ser dito. */
  nota: string;
  /** A verificacao quebrou. Null e o caso normal; string aqui e alarme (R4). */
  defeito: string | null;
};

/**
 * Roda as tres conferencias e devolve o que dizer ao gestor.
 *
 * A ORDEM DAS CONFERENCIAS NAO IMPORTA e isso e proposital: elas nao se influenciam, nao ha
 * curto-circuito, e uma falha em qualquer uma nao impede as outras de rodar. Curto-circuito
 * aqui esconderia a segunda reprovacao atras da primeira — o defeito que fez este repositorio
 * acreditar por semanas que havia UMA prova vermelha quando havia duas.
 */
export async function verificarAntesDeResponder(opts: {
  texto: string;
  companyId: string;
  caminho?: CaminhoDaComposicao;
  inicioDoGerado?: number | null;
  integridadeIntacta?: boolean;
  toolResults?: Array<{ tool?: unknown; retorno?: unknown }> | null;
  cardsDaRodada?: Array<{ approval_id?: unknown }> | null;
  cardsDoTurno?: Array<{ approval_id?: unknown }> | null;
  /**
   * false em segmento intermediario de turno continuado: os restantes ainda podem ser lidos no
   * proximo bloco, e cobrar o envelope agora produziria envelope que a rodada seguinte
   * desmente. Fabricacao e contrato NAO dependem disso — id inventado num stub de progresso
   * chega ao gestor igual.
   */
  turnoVaiFechar?: boolean;
  /** Muda so o fechamento da nota. Ver `SuperficieDaResposta`. Default `chat`. */
  superficie?: SuperficieDaResposta;
  buscarIds: (ids: string[]) => Promise<Array<{ id?: unknown }> | null>;
  buscarCards?: (ids: string[]) => Promise<CardParaConferir[] | null>;
  validarContrato?: (acao: string, pedido: unknown) => Promise<VeredictoDoContrato | null>;
}): Promise<ResultadoDaVerificacao> {
  const conferencias: Conferencia[] = [];
  const defeitos: string[] = [];
  let envelope = "";

  const escopo = escopoDaVerificacao({
    texto: opts.texto,
    caminho: opts.caminho ?? "llm",
    inicioDoGerado: opts.inicioDoGerado ?? null,
    integridadeIntacta: opts.integridadeIntacta,
  });
  if (escopo.recorte_invalido) {
    conferencias.push({
      nome: "composicao",
      veredito: "nao_conferido",
      motivo: escopo.motivo ?? "recorte do trecho gerado invalido",
      itens: [],
    });
  }

  // Cada conferencia num try proprio. O catch NAO devolve sucesso (R1): ele produz
  // `nao_conferido` e alimenta `defeito`, que sobe para a nota do gestor (R4).
  const idsDaRodada = (opts.cardsDaRodada ?? [])
    .map((c) => String(c?.approval_id ?? "").trim())
    .filter(Boolean);

  if (escopo.fabricacao) {
    try {
      conferencias.push(await conferirIdentificadores({
        trecho: escopo.fabricacao,
        companyId: opts.companyId,
        cardsDaRodada: opts.cardsDaRodada ?? null,
        cardsDoTurno: opts.cardsDoTurno ?? null,
        retornosDeFerramenta: (opts.toolResults ?? null) as Array<{ retorno?: unknown }> | null,
        buscar: opts.buscarIds,
      }));
    } catch (e) {
      const m = `conferencia de identificadores quebrou: ${String((e as Error)?.message ?? e).slice(0, 200)}`;
      conferencias.push({ nome: "identificadores", veredito: "nao_conferido", motivo: m, itens: [] });
      defeitos.push(m);
    }
  }

  if (opts.turnoVaiFechar !== false) {
    try {
      const c = conferirCobertura({ textoCompleto: escopo.completude, toolResults: opts.toolResults });
      envelope = c.envelope;
      conferencias.push({ nome: c.nome, veredito: c.veredito, motivo: c.motivo, itens: c.itens });
    } catch (e) {
      const m = `conferencia de cobertura quebrou: ${String((e as Error)?.message ?? e).slice(0, 200)}`;
      conferencias.push({ nome: "cobertura", veredito: "nao_conferido", motivo: m, itens: [] });
      defeitos.push(m);
    }
  }

  if (idsDaRodada.length) {
    if (!opts.buscarCards || !opts.validarContrato) {
      // Chamador que emitiu card e nao passou as duas funcoes NAO recebe verde por isso. A
      // superficie sem conferencia de contrato e uma superficie nao conferida, e ela se declara.
      conferencias.push({
        nome: "contrato_do_pedido",
        veredito: "nao_conferido",
        motivo: "esta superficie nao liga a conferencia de contrato (buscarCards/validarContrato ausentes)",
        itens: idsDaRodada,
      });
    } else {
      try {
        conferencias.push(await conferirContratoDoPedido({
          approvalIds: idsDaRodada,
          buscarCards: opts.buscarCards,
          validar: opts.validarContrato,
        }));
      } catch (e) {
        const m = `conferencia de contrato quebrou: ${String((e as Error)?.message ?? e).slice(0, 200)}`;
        conferencias.push({ nome: "contrato_do_pedido", veredito: "nao_conferido", motivo: m, itens: [] });
        defeitos.push(m);
      }
    }
  }

  const limpo = conferencias.every((c) => c.veredito === "conferido");
  return {
    conferencias,
    limpo,
    nota: notaDaVerificacao(conferencias, envelope, defeitos, {
      // Os DOIS marcadores: o do guarda do chat e o desta camada. O segundo e o que da
      // idempotencia ao job, que reentra na escrita no segmento 2 e sem ele ganharia duas notas.
      jaAvisouIdentificador: MARCA_DO_AVISO_DE_ID.test(String(opts.texto ?? "")) ||
        MARCA_DA_NOTA_DE_ID.test(String(opts.texto ?? "")),
      superficie: opts.superficie ?? "chat",
    }),
    defeito: defeitos.length ? defeitos.join(" | ") : null,
  };
}

// ============================================================================
// O QUE O GESTOR LE
// ============================================================================
//
// UMA nota por turno, nao uma por item. O envelope de cobertura vem primeiro porque e o unico
// que carrega DADO que faltava na resposta; o resto e ressalva sobre a propria conferencia.
//
// Nao ha frase de "tudo conferido": turno limpo nao acrescenta caractere nenhum. Selo verde em
// toda resposta e ruido que ensina a nao ler a linha, e e justamente a linha que precisa ser
// lida quando aparece.

/**
 * Marca estavel do aviso nominal do CHAT (`avisoDeCardInventado`). Serve para saber que a
 * acusacao ja foi feita naquele caminho, sem depender de casar a prosa inteira.
 */
export const MARCA_DO_AVISO_DE_ID = /get_aprovacoes antes de aprovar/i;

/**
 * Marca da nota DESTA camada. Existe separada da de cima porque a nota do job nao pode terminar
 * na frase do chat (ver `superficie`), e sem uma marca propria a nota do job perderia a
 * idempotencia — o job reentra na escrita no segmento 2 e ganharia duas notas.
 */
export const MARCA_DA_NOTA_DE_ID = /Identificador nao confirmado:/;

/**
 * Onde a resposta esta saindo. Muda SO o fechamento da nota, nunca o veredito.
 *
 * `chat`  pode emitir card, tem `get_aprovacoes`, e o gestor aprova ali. "Confira antes de
 *         aprovar" e a acao certa.
 * `job`   e SOMENTE LEITURA por construcao (`propose_action` nao existe no tier profundo, e
 *         `get_aprovacoes` nao esta na lista de nenhum especialista — conferido em 05/09/2026).
 *         Mandar o gestor "conferir em get_aprovacoes antes de aprovar" ali seria apontar para
 *         uma ferramenta que aquela superficie nao tem e sugerir que existe algo para aprovar
 *         quando nao existe. Uma camada que existe para impedir afirmacao nao conferida nao
 *         pode fechar a propria nota com uma.
 */
export type SuperficieDaResposta = "chat" | "job";

function fechamentoDaNota(superficie: SuperficieDaResposta): string {
  return superficie === "job"
    ? `Este tier e somente leitura e nao emite card, entao nao ha nada a aprovar: trate o ` +
      `identificador como NAO existente e nao o use para agir no chat.`
    : `Confira em get_aprovacoes antes de aprovar.`;
}

export function notaDaVerificacao(
  conferencias: Conferencia[],
  envelope: string,
  defeitos: string[] = [],
  opts?: {
    /**
     * O texto JA carrega a acusacao nominal (posta por `avisoDeCardInventado` no chat). O
     * veredito continua `reprovado` — a telemetria tem de contar o turno —, mas a nota nao
     * escreve a mesma acusacao duas vezes. Duas redacoes do mesmo fato na mesma mensagem
     * obrigariam a auditoria em SQL a aprender a casar as duas, e foi a proliferacao de
     * redacoes que fez `cortarClaimEmitidoSemCard` perder duas vezes para a prosa do modelo.
     */
    jaAvisouIdentificador?: boolean;
    superficie?: SuperficieDaResposta;
  },
): string {
  const blocos: string[] = [];
  const superficie = opts?.superficie ?? "chat";
  if (envelope) blocos.push(envelope);

  const ids = conferencias.find((c) => c.nome === "identificadores");
  if (ids?.veredito === "reprovado" && !opts?.jaAvisouIdentificador) {
    blocos.push(
      `**Identificador nao confirmado: ${ids.itens.join(", ")}.** Nenhuma ferramenta devolveu ` +
        `esses identificadores nesta rodada e eles nao constam em approval_requests desta empresa. ` +
        fechamentoDaNota(superficie),
    );
  } else if (ids?.veredito === "nao_conferido") {
    blocos.push(
      `_Nao consegui conferir se ${ids.itens.length === 1 ? "o identificador" : "os identificadores"} ` +
        `${ids.itens.join(", ")} ${ids.itens.length === 1 ? "existe" : "existem"} de verdade ` +
        `(${ids.motivo}). Trate como NAO confirmado. ${fechamentoDaNota(superficie)}_`,
    );
  }

  const contrato = conferencias.find((c) => c.nome === "contrato_do_pedido");
  if (contrato?.veredito === "reprovado") {
    blocos.push(
      `_O contrato de execucao divergiu do pedido em: ${contrato.itens.join("; ")}. ` +
        `Isso NAO recusa o card — o contrato desta base ja se mostrou mais restrito que o ` +
        `executor em 10 de 15 casos medidos. Confira o campo antes de aprovar._`,
    );
  } else if (contrato?.veredito === "nao_conferido") {
    blocos.push(
      `_Nao conferi o pedido contra o contrato de execucao: ${contrato.motivo}. ` +
        `O card existe e esta na fila; o que nao existe e a conferencia._`,
    );
  }

  const comp = conferencias.find((c) => c.nome === "composicao");
  if (comp && comp.veredito !== "conferido") {
    blocos.push(`_${comp.motivo}_`);
  }

  if (defeitos.length) {
    // R4: a propria verificacao quebrou. Isto NAO pode ficar so na telemetria — se o gestor le
    // uma resposta sem ressalva, ele assume que ela foi conferida.
    blocos.push(
      `_A verificacao pos-resposta falhou neste turno (${defeitos.join(" | ")}). ` +
        `Esta resposta NAO foi conferida._`,
    );
  }

  return blocos.join("\n\n");
}

/** Linha para a telemetria do turno. Grava-se SEMPRE, inclusive em turno limpo. */
export function linhaDeVerificacao(r: ResultadoDaVerificacao): Record<string, unknown> {
  const porNome: Record<string, string> = {};
  for (const c of r.conferencias) porNome[c.nome] = c.veredito;
  return {
    limpo: r.limpo,
    // Contagens SEPARADAS. Somar `nao_conferido` a `conferido` num total unico e como o
    // numerador desta camada morreria (R2).
    conferidas: r.conferencias.filter((c) => c.veredito === "conferido").length,
    reprovadas: r.conferencias.filter((c) => c.veredito === "reprovado").length,
    nao_conferidas: r.conferencias.filter((c) => c.veredito === "nao_conferido").length,
    vereditos: porNome,
    motivos: r.conferencias.filter((c) => c.motivo).map((c) => `${c.nome}: ${c.motivo}`),
    defeito: r.defeito,
  };
}

// ============================================================================
// A COLETA PROFUNDA (traffic-agent-job) — APLICADO EM 05/09/2026
// ============================================================================
//
// O gancho que este arquivo descrevia esta ligado. Ele mora em `entregarResposta`, no
// traffic-agent-job, que passou a ser o UNICO ponto do job que grava mensagem de assistente.
// O que segue e o que a aplicacao corrigiu na propria descricao — nao repita o que estava aqui.
//
// (1) "GRAVA EM CINCO PONTOS" ESTAVA ERRADO. Eram TRES: sintese fresca, sintese da retomada de
//     segmento e a mensagem de degradacao do `catch`. A contagem de cinco veio de casar
//     `role: "assistant"` no arquivo inteiro, o que somou duas montagens de PROMPT
//     (`messages.push({ role: "assistant", ... })`, usadas para o modelo continuar de onde
//     parou) as gravacoes de verdade. Tres continua sendo tres chances de divergir; a correcao
//     e do numero, nao do diagnostico. A prova [8.1] conta com a subtracao explicita para nao
//     herdar o mesmo erro.
//
// (2) O `throw` E OBRIGATORIO, MAS NAO PELO MOTIVO QUE ESTAVA ESCRITO AQUI. Este bloco dizia que
//     sem ele "a conferencia absolve em silencio". Medido em 05/09: e o contrario. Com
//     `return data ?? []`, o erro vira lista vazia, nenhum id consta como existente e TODOS os
//     citados sao acusados de inexistentes — inclusive os reais. Falha de banco vira acusacao
//     nominal falsa. Continua sendo dar por conferido o que nao foi conferido, entao o `throw`
//     continua obrigatorio; o que muda e a direcao do estrago, e ela importa, porque falso
//     positivo e o que ensina o gestor a ignorar a linha. Controle positivo em [8.2].
//
// (3) CONTRATO DO PEDIDO FICA FORA DO JOB, e por estrutura. `propose_action` nao existe la e
//     `get_aprovacoes` nao esta na lista de nenhum dos 9 especialistas: sem card emitido,
//     `cardsDaRodada` e sempre vazio e a conferencia nunca rodaria. Ligar mesmo assim nao daria
//     seguranca e daria uma coisa pior — conferencia que nunca reprova parece vigilancia viva.
//     A prova [8.7] falha se `propose_action` voltar ao job, forcando reavaliar isto.
//
// (4) A COBERTURA PRECISOU DE CAPTURA, nao so de ligacao. O job nunca guardou retorno de
//     ferramenta (`chat_messages.tool_results` e nulo nas 80 respostas historicas): no ponto de
//     escrita nao existe mais o objeto que declarou `restantes`. A captura ficou no unico lugar
//     onde o retorno existe como objeto — a linha seguinte ao `runTool` no laco do subagente —
//     e sobe em `tel`, que e o que atravessa o checkpoint do segmento 2.
//
// (5) A NOTA MUDA DE FECHO POR SUPERFICIE (`superficie: "job"`). Ver `SuperficieDaResposta`.
