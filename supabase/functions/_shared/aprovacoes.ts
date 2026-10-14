// Estado de um card de aprovacao, em UM lugar so.
//
// O DEFEITO QUE ISTO CONSERTA (medido 07/08/2026, card b5e2f338-f28c-4c8e-b89f-a8d82d0e16ec):
// `executed_at IS NULL` significava DUAS coisas incompativeis - "ainda nao executou" e "executou
// e falhou antes de escrever". A falha existia so no audit_log, e get_aprovacoes nao olha la.
// O agente leu o card, viu "aprovado, ainda NAO executado" e disse ao gestor "aguarde alguns
// instantes, o conjunto esta sendo criado". A criacao ja tinha falhado 3 segundos depois da
// aprovacao, recusada pelo Pipeboard por conflito de orcamento. O agente nao inventou o estado:
// inventou a CAUSALIDADE, porque o estado que ele leu era ambiguo.
//
// POR QUE A FALHA VAI NO CARD E NAO NUM CRUZAMENTO COM O audit_log:
//   (1) Sao TRES leitores (traffic-chat.get_aprovacoes, mcp-server.list_approvals e a propria
//       executora). Cruzar com audit_log obrigaria os tres a repetir o mesmo join sobre um
//       `details` jsonb polimorfico e a traduzir ~6 nomes de acao de auditoria para linguagem de
//       negocio. Repetir doutrina em tres lugares e exatamente o defeito que este projeto ja
//       pagou duas vezes (v5.3 do meta-actions: consertar um nivel quebrou os outros dois).
//   (2) `executed_at` conserva UM significado so - "a escrita terminou e o card esta fechado".
//       Nao mexer nele preserva as duas invariantes que ja existem: a varredura continua achando
//       card re-executavel por `executed_at is null`, e o fechamento em falha POS-ESCRITA PARCIAL
//       (creative orfao) continua fechando com ok=false.
//   (3) O card e o objeto sobre o qual o gestor pergunta. A verdade sobre ele mora nele.
// O audit_log continua sendo o registro forense completo; `ultima_falha` carrega o veredito da
// ULTIMA tentativa, que e o que responde "e agora?".

export type EstadoDoCard =
  | "aguardando_decisao"
  | "recusado"
  | "aguardando_execucao"
  | "execucao_falhou"
  | "executado";

export type LinhaAprovacao = {
  status?: string | null;
  executed_at?: string | null;
  execution_result?: any;
  ultima_falha?: any;
  [k: string]: unknown;
};

export type SituacaoDoCard = {
  estado: EstadoDoCard;
  situacao: string;
  id_criado_na_meta: string | null;
  falhou: boolean;
  motivo_da_falha: string | null;
  detalhe_tecnico_da_falha: string | null;
  falhou_em: string | null;
  tentativas: number;
  re_executavel: boolean | null;
};

/**
 * A UNICA leitura de estado de card do sistema. Os tres leitores chamam esta funcao; nenhum
 * deriva situacao por conta propria.
 *
 * Ordem de decisao (a primeira que casa vence):
 *   pending                      -> aguardando_decisao
 *   rejected                     -> recusado
 *   executed_at + ok=true        -> executado (com identificador)
 *   executed_at + ok=false       -> execucao_falhou (falha POS-escrita: card fechado, sem retry)
 *   ultima_falha presente        -> execucao_falhou (falha PRE-escrita: card segue re-executavel)
 *   resto                        -> aguardando_execucao
 *
 * O quinto caso e o que nao existia. Sem ele, falha antes de qualquer escrita ficava
 * indistinguivel de "ainda nao rodou".
 */
export function situacaoDoCard(r: LinhaAprovacao): SituacaoDoCard {
  const er = r.execution_result ?? {};
  const uf = r.ultima_falha ?? null;
  const idCriado = er.id_criado ? String(er.id_criado) : null;
  const tentativas = Number(uf?.tentativa ?? 0) || 0;

  if (r.status === "pending") {
    return {
      estado: "aguardando_decisao",
      situacao: "aguardando decisao do administrador",
      id_criado_na_meta: null,
      falhou: false,
      motivo_da_falha: null,
      detalhe_tecnico_da_falha: null,
      falhou_em: null,
      tentativas,
      re_executavel: null,
    };
  }
  if (r.status === "rejected") {
    return {
      estado: "recusado",
      situacao: "recusado ou expirado sem decisao",
      id_criado_na_meta: null,
      falhou: false,
      motivo_da_falha: null,
      detalhe_tecnico_da_falha: null,
      falhou_em: null,
      tentativas,
      re_executavel: null,
    };
  }

  if (r.executed_at && er.ok === true) {
    return {
      estado: "executado",
      situacao: `aprovado e EXECUTADO na Meta (identificador ${idCriado ?? "nao devolvido"})`,
      id_criado_na_meta: idCriado,
      falhou: false,
      motivo_da_falha: null,
      detalhe_tecnico_da_falha: null,
      falhou_em: null,
      tentativas,
      re_executavel: false,
    };
  }

  // Falha POS-escrita parcial: o card ja foi fechado de proposito (nao repete para nao duplicar
  // objeto orfao). Retry aqui exige card novo - decisao humana.
  if (r.executed_at && er.ok === false) {
    // `motivo` e `nota` sao onde os cards fechados ADMINISTRATIVAMENTE guardam a explicacao
    // (card superseded, pedido de teste neutralizado). Ignora-los fazia sete cards desta base
    // responderem "a execucao falhou na etapa desconhecida" tendo a razao escrita ao lado.
    const motivo =
      er.motivo_para_o_gestor ??
      uf?.motivo_para_o_gestor ??
      er.motivo ??
      er.nota ??
      `a execucao falhou na etapa ${er.etapa ?? "desconhecida"}`;
    return {
      estado: "execucao_falhou",
      situacao: "aprovado, mas a execucao FALHOU na Meta - este card NAO sera repetido automaticamente",
      id_criado_na_meta: null,
      falhou: true,
      motivo_da_falha: String(motivo),
      detalhe_tecnico_da_falha: textoCurto(er.detalhe ?? er.erro ?? uf?.detalhe_tecnico ?? null),
      falhou_em: r.executed_at ?? null,
      tentativas: Math.max(tentativas, 1),
      re_executavel: false,
    };
  }

  // Falha PRE-escrita: nada foi criado na Meta, entao o card continua elegivel para nova
  // tentativa (executed_at segue nulo de proposito). ISSO NAO E "esta sendo processado".
  if (uf) {
    return {
      estado: "execucao_falhou",
      situacao:
        "aprovado, a execucao foi TENTADA e FALHOU - nada foi criado na Meta. O card segue elegivel para nova tentativa, mas a tentativa anterior ja terminou: NAO ha nada amadurecendo",
      id_criado_na_meta: null,
      falhou: true,
      motivo_da_falha: String(uf.motivo_para_o_gestor ?? uf.recusa ?? "motivo nao registrado"),
      detalhe_tecnico_da_falha: textoCurto(uf.detalhe_tecnico ?? null),
      falhou_em: uf.em ? String(uf.em) : null,
      tentativas: Math.max(tentativas, 1),
      re_executavel: uf.re_executavel !== false,
    };
  }

  return {
    estado: "aguardando_execucao",
    situacao:
      "aprovado, execucao ainda NAO tentada (nenhuma tentativa registrada). A execucao dispara junto com a aprovacao, entao este estado deve durar segundos",
    id_criado_na_meta: null,
    falhou: false,
    motivo_da_falha: null,
    detalhe_tecnico_da_falha: null,
    falhou_em: null,
    tentativas: 0,
    re_executavel: true,
  };
}

function textoCurto(v: unknown): string | null {
  if (v === null || v === undefined) return null;
  const s = typeof v === "string" ? v : safeJson(v);
  const t = s.trim();
  return t ? t.slice(0, 400) : null;
}

function safeJson(v: unknown): string {
  try {
    return JSON.stringify(v);
  } catch {
    return String(v);
  }
}

// ==================== TRADUCAO DE FALHA PARA LINGUAGEM DO GESTOR ====================
// O gestor nao le "Budget conflict: campaign already has a daily_budget set (CBO)". Ele precisa
// saber O QUE ACONTECEU e O QUE FAZER. A traducao mora aqui, junto com a leitura de estado, para
// que a executora grave e os leitores exibam exatamente a mesma frase.
//
// A lista e de assinaturas MEDIDAS, nao imaginadas. Falha sem assinatura conhecida NAO recebe
// frase inventada: devolve o texto tecnico com um enquadramento honesto. Traduzir por palpite
// seria trocar um erro ilegivel por um erro errado.
export type FalhaTraduzida = {
  recusa: string;
  motivo_para_o_gestor: string;
};

const ASSINATURAS: {
  recusa: string;
  quando: RegExp;
  frase: string;
}[] = [
  {
    recusa: "campanha_usa_orcamento_proprio_cbo",
    // Medido 07/08/2026 no card b5e2f338: create_adset recusado pelo Pipeboard.
    quando: /budget conflict|already has a daily_budget|already has a lifetime_budget|campaign budget optimization|budgets at both the campaign and ad set/i,
    frase:
      // Nao ofereca "peca o conjunto sem orcamento": orcamento_diario_reais e obrigatorio no
      // contrato e o executor recusa valor zero, entao esse caminho termina em segunda recusa.
      "conflito de orcamento: a campanha de destino usa orcamento no NIVEL DA CAMPANHA (CBO), e a Meta nao aceita orcamento na campanha e no conjunto ao mesmo tempo. Ou o orcamento vive na campanha e os conjuntos herdam, ou cada conjunto tem o seu e a campanha fica sem. Para seguir, escolha uma campanha de destino sem orcamento proprio: criar conjunto SEM orcamento ainda nao e suportado por este sistema.",
  },
  {
    recusa: "conjunto_destino_criativo_dinamico",
    quando: /dynamic creative|is_dynamic_creative/i,
    frase:
      "o conjunto de destino esta configurado para Criativo Dinamico, e esse tipo de conjunto nao aceita a criacao de um anuncio avulso. Escolha um conjunto com Criativo Dinamico desativado ou crie uma replica a partir do molde.",
  },
  {
    recusa: "conexao_meta_expirada",
    quando: /token_status|expired|reconnect|oauthexception.*(?:190|102)/i,
    frase:
      "a conexao com a Meta nao esta valida no momento da execucao, entao nada foi enviado. Reconectar o login e refazer o pedido.",
  },
  {
    recusa: "orcamento_abaixo_do_minimo_da_meta",
    quando: /minimum budget|budget.*too low|must be at least/i,
    frase:
      "o orcamento pedido esta abaixo do minimo que a Meta aceita para este tipo de conjunto. Aumentar o valor ou mudar a estrategia de lance.",
  },
  {
    // Medido 20/08/2026 no card 1b905e3a: POST_ENGAGEMENT sem destination_type=ON_POST.
    recusa: "meta_de_desempenho_incompativel_com_objetivo",
    quando:
      /performance goal incompatible|optimization_goal you selected is not valid|not compatible with the campaign'?s? objective|performance goal isn'?t available/i,
    frase:
      "a Meta recusou a meta de desempenho (optimization_goal) porque ela nao combina com o objetivo da campanha — ou falta o destino (destination_type) exigido. Em engajamento SOCIAL use POST_ENGAGEMENT + ON_POST. Em conversas WhatsApp (CTWA) use CONVERSATIONS + WHATSAPP sob a mesma campanha OUTCOME_ENGAGEMENT (familia mensagens). Em reconhecimento use REACH. Corrigir o pedido e tentar de novo.",
  },
  {
    // Medido 21/08/2026 no card 1687f34f: molde com teto de lance sem bid_amount (subcode 2490487).
    recusa: "lance_exige_valor_ou_restricao",
    quando:
      /2490487|bid amount.*(?:required|obrigat)|valor de licita[cç][aã]o|restri[cç][oõ]es de licita[cç][aã]o|bid.?cap|cost.?cap.*bid/i,
    frase:
      "a Meta exigiu valor de lance porque a estrategia herdada tinha teto (bid cap/cost cap) sem valor. O sistema agora usa custo mais baixo sem teto (LOWEST_COST_WITHOUT_CAP) em conjuntos de mensagens/engajamento — reemitir ou tentar de novo.",
  },
  {
    // Medido 21/08/2026 no card ae4c277e: IG Explore descontinuado (subcode 2490589).
    recusa: "instagram_explore_descontinuado",
    quando:
      /2490589|explorar do ig|instagram explore|explore_home|posicionamento explorar/i,
    frase:
      "a Meta descontinuou o posicionamento Instagram Explore (explore/explore_home). O sistema remove esses placements automaticamente — reemitir ou tentar de novo.",
  },
  {
    // Medido 21/08/2026: Advantage+ com age_min>25 ou age_max no payload (subcode 1870188).
    recusa: "advantage_plus_idade_incompativel",
    quando:
      /1870188|advantage\+.*idade|idade m[ií]nima.*25|age_min.*advantage|controlo da idade m[ií]nima/i,
    frase:
      "com publico Advantage+ a Meta so aceita idade minima entre 18 e 25 e nao aceita age_max no pedido (o teto fica em 65). O sistema agora sanitiza isso automaticamente — reemitir ou tentar de novo.",
  },
  {
    recusa: "location_types_entre_blocos_de_geo",
    quando: /1870194/,
    frase:
      "Num conjunto com exclusao geografica, divergencia de location_types entre os dois blocos e esperada e nao deve alarmar: geo_locations pode ganhar frequently_in, e excluded_geo_locations perde frequently_in e fica em home, recent. O que deve alarmar e o Gerenciador recusando a publicacao — e um erro de CTA no anuncio pode estar segurando este.",
  },
  {
    recusa: "cta_incompativel_derruba_o_conjunto",
    quando: /1885882/,
    frase:
      "um anuncio com botao incompativel (Saiba mais / LEARN_MORE apontando para site) dentro de conjunto de conversas derrubou o conjunto inteiro. O criativo certo e WHATSAPP_MESSAGE. Apagar ou trocar esse anuncio e o que libera os outros.",
  },
  {
    recusa: "troca_cruza_personalizacao_de_placement",
    quando: /1885866/,
    frase:
      "a Meta recusou a troca de criativo porque um tem regras de placement (asset_customization_rules) e o outro nao. Nao cruze essa fronteira.",
  },
  {
    recusa: "video_sem_miniatura",
    quando: /1443226/,
    frase: "video sem thumbnail_url. A Meta recusa o criativo. Passe a miniatura e tente de novo.",
  },
  {
    // Medido 22/08/2026 cards a703e076 / 934e1a2f: video_data.link no POST /adcreatives.
    recusa: "video_data_link_nao_suportado",
    quando:
      /1443050|campo link n[aã]o [eé] suportado.*video_data|link.*not supported.*video_data/i,
    frase:
      "a Meta recusou o criativo porque o campo link nao e permitido dentro de video_data (so no call_to_action). O sistema ja corrige isso — pode tentar de novo neste card.",
  },
];

/** Extrai error_user_msg / message do envelope Graph quando presente. */
function mensagemGraphDoBruto(bruto: unknown): string | null {
  try {
    const o = typeof bruto === "string" ? JSON.parse(bruto) : bruto;
    const err = (o as any)?.body?.error ?? (o as any)?.error ?? null;
    if (!err || typeof err !== "object") return null;
    const user = String((err as any).error_user_msg ?? "").trim();
    if (user) return user;
    const title = String((err as any).error_user_title ?? "").trim();
    const msg = String((err as any).message ?? "").trim();
    if (title && msg) return `${title}: ${msg}`;
    return title || msg || null;
  } catch {
    return null;
  }
}

/**
 * Traduz uma falha de execucao para uma frase que o gestor entende.
 * `recusaConhecida` vem de uma recusa NOMEADA pelo proprio sistema (montarCriacao), e quando
 * existe ela manda - o sistema sabe mais sobre o proprio "nao" do que qualquer regex.
 * Excecao: wrappers genericos ("falha ao criar adcreative") cedem a assinatura Graph / error_user_msg.
 */
export function traduzirFalha(
  bruto: unknown,
  recusaConhecida?: string | null,
  mensagemConhecida?: string | null,
): FalhaTraduzida {
  const wrapperGenerico =
    !!recusaConhecida &&
    /^(falha ao criar adcreative|falha_meta|falha|erro)$/i.test(String(recusaConhecida).trim());

  if (recusaConhecida && mensagemConhecida && !wrapperGenerico) {
    return { recusa: recusaConhecida, motivo_para_o_gestor: mensagemConhecida };
  }
  const texto = typeof bruto === "string" ? bruto : safeJson(bruto);
  for (const a of ASSINATURAS) {
    if (a.quando.test(texto)) {
      return { recusa: a.recusa, motivo_para_o_gestor: a.frase };
    }
  }
  const msgGraph = mensagemGraphDoBruto(bruto);
  if (msgGraph) {
    return {
      recusa: wrapperGenerico
        ? "meta_recusou_adcreative"
        : (recusaConhecida ?? "meta_recusou"),
      motivo_para_o_gestor: `a Meta recusou a operacao: ${msgGraph}`,
    };
  }
  if (recusaConhecida && mensagemConhecida) {
    return { recusa: recusaConhecida, motivo_para_o_gestor: mensagemConhecida };
  }
  if (recusaConhecida) {
    return {
      recusa: recusaConhecida,
      motivo_para_o_gestor: `a execucao foi recusada pelo proprio sistema com o motivo "${recusaConhecida}". Nada foi criado na Meta.`,
    };
  }
  return {
    recusa: "falha_nao_classificada",
    motivo_para_o_gestor:
      `a plataforma recusou a operacao e esta resposta ainda nao tem traducao propria no sistema. ` +
      `Texto devolvido, sem interpretacao: ${texto.slice(0, 300)}`,
  };
}

// ==================== APPROVAL_ID CITADO QUE NENHUMA FERRAMENTA DEVOLVEU ====================
// O DEFEITO QUE ISTO CONSERTA (medido 01/09/2026, anuncios do CONJ.3_VISTTA):
// a resposta trouxe uma tabela de 6 cards em que 4 approval_id eram reais (fba683b5…,
// dd151a44…, 7a3c6518…, f54be98f…) e 2 eram inventados (b7c8d92f…, c9e7f3a2…). Os dois
// inventados nunca existiram em approval_requests, e o gestor ficou sem os anuncios
// AD_CONJ.3_APENAS_OCULOS_1 e _2 achando que estavam na fila.
//
// A checagem que existia era por FRASE e falhava duas vezes no mesmo caso:
//   (a) ela desistia logo no inicio quando a rodada tinha QUALQUER card real, entao mistura
//       de verdadeiro com inventado passava sem ninguem ler o texto;
//   (b) a frase publicada era "Cards 1 e 2 Emitidos", que a expressao de claim nao casava.
// Continuar remendando frase e perder a corrida contra a redacao do modelo. UUID nao:
// ou a ferramenta devolveu aquele identificador nesta conversa, ou ele foi inventado.
//
// CUIDADO COM O INVERSO — acusar card VERDADEIRO e tao caro quanto deixar passar o falso.
// A primeira versao desta checagem (01/09/2026, 15:30) tratava "nenhuma ferramenta devolveu
// NESTA rodada" como prova de inexistencia, e 20 minutos depois acusou 7a3c6518… e
// f54be98f… — dois cards do CONJ.3 que existem desde as 18:15. O modelo os citou de
// memoria da conversa, sem rechamar tool, e o guarda chamou de invencao. Nao ter sido
// devolvido agora NAO e o mesmo que nao existir.
//
// Por isso a checagem local so PRE-SELECIONA: o que ela nao reconhece vira candidato, e
// quem decide e o banco (approvalIdsInexistentes). Sem consulta, nao ha veredito.
// Casa o FORMATO 8-4-4-4-12 com qualquer alfanumerico, nao so hexadecimal. O modelo inventa
// id fora do hexa: "6d3b9f5e-7c0a-52b4-d0e9-3g6f8e4d7b3g" e "7e4c0g6f-8d1b-63c5-e1f0-4h7g9f5e8c4h"
// foram publicados como cards de pausa do CONJ.2 em 01/09/2026, e a versao so-hexa nem os via.
// UUID real e subconjunto disto, entao nada verdadeiro deixa de ser reconhecido.
const RE_UUID_CARD = /[0-9a-z]{8}-[0-9a-z]{4}-[0-9a-z]{4}-[0-9a-z]{4}-[0-9a-z]{12}/gi;
/** approval_id real e sempre UUID hexadecimal. Fora disso, nao ha o que consultar. */
const RE_UUID_VALIDO = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Ids citados no texto que NAO vieram de ferramenta nesta rodada. Sao apenas CANDIDATOS a
 * invencao: podem ser cards reais lembrados da conversa. Confirme com approvalIdsInexistentes.
 */
export function approvalIdsInventados(
  texto: string,
  reais: {
    cardsDaRodada?: Array<{ approval_id?: unknown }> | null;
    cardsDoTurno?: Array<{ approval_id?: unknown }> | null;
    retornosDeFerramenta?: Array<{ retorno?: unknown }> | null;
  },
): string[] {
  const citados = [
    ...new Set((String(texto ?? "").match(RE_UUID_CARD) ?? []).map((u) => u.toLowerCase())),
  ];
  if (!citados.length) return [];

  const conhecidos = new Set<string>();
  const anotar = (v: unknown) => {
    const s = String(v ?? "").toLowerCase();
    for (const u of s.match(RE_UUID_CARD) ?? []) conhecidos.add(u);
  };
  for (const c of reais.cardsDaRodada ?? []) anotar(c?.approval_id);
  for (const c of reais.cardsDoTurno ?? []) anotar(c?.approval_id);
  for (const t of reais.retornosDeFerramenta ?? []) {
    const r = t?.retorno;
    if (r == null) continue;
    if (typeof r === "string") {
      anotar(r);
      continue;
    }
    // Retorno de tool e objeto; serializar e a unica forma de achar id em qualquer nivel.
    try {
      anotar(JSON.stringify(r));
    } catch {
      // Ciclo ou BigInt: ignora essa tool em vez de derrubar a checagem inteira.
    }
  }

  return citados.filter((u) => !conhecidos.has(u));
}

/**
 * Veredito de TRES estados sobre os candidatos, e nao de dois.
 *
 * O DEFEITO QUE ISTO CONSERTA (medido 04/09/2026). `approvalIdsInexistentes` respondia UMA
 * lista — os inventados — e nada mais. Quando a consulta falhava, ela devolvia so os
 * malformados, e os candidatos que ninguem conseguiu conferir simplesmente DESAPARECIAM da
 * resposta. Nao havia acusacao (correto) e tambem nao havia sinal (errado): o chamador nao
 * tinha como distinguir "conferi e sao reais" de "nao consegui conferir". O turno saia igual
 * nos dois casos, e no segundo o gestor lia uma tabela de cards sem saber que ninguem
 * verificou se aqueles cards existem.
 *
 * Essa e exatamente a familia de defeito que esta semana produziu cinco fail-opens diferentes
 * (compliance aprovando por omissao, verdicto desconhecido tratado como aprovacao, erro de RPC
 * tratado como liberacao). Aqui ela aparece na forma mais dificil de ver, porque o codigo
 * ANTIGO ESTAVA CERTO na parte visivel: nao acusar sem leitura e a decisao correta — a versao
 * de 01/09/2026 que tratava "nao veio de tool nesta rodada" como prova de inexistencia acusou
 * dois cards reais do CONJ.3 em 20 minutos. O erro nao era acusar de menos; era CALAR.
 *
 * Por isso a separacao e em tres:
 *
 *   inventados      conferido contra o banco: NAO existe. Veredito, pode acusar.
 *   nao_conferidos  a consulta nao respondeu. SEM veredito — tem de ser declarado ao gestor,
 *                   nunca absolvido em silencio.
 *   (o resto)       conferido e existe. Sai da lista, e ai o silencio e correto.
 *
 * `motivo` carrega a falha da consulta para a telemetria. Ele NAO e opcional quando
 * `nao_conferidos` tem itens: um estado sem veredito e sem motivo e um beco para o plantao.
 */
export type VereditoDeIds = {
  /** Conferidos contra o banco e ausentes: invencao. */
  inventados: string[];
  /** Nao foi possivel conferir. Ausencia de veredito, NAO absolvicao. */
  nao_conferidos: string[];
  /** Por que a conferencia nao aconteceu. Null so quando `nao_conferidos` esta vazio. */
  motivo: string | null;
};

export async function conferirApprovalIds(
  candidatos: string[],
  ctx: {
    companyId: string;
    buscar: (ids: string[]) => Promise<Array<{ id?: unknown }> | null>;
  },
): Promise<VereditoDeIds> {
  const ids = [...new Set(candidatos.map((c) => String(c ?? "").toLowerCase()).filter(Boolean))];
  if (!ids.length) return { inventados: [], nao_conferidos: [], motivo: null };

  // Sem empresa resolvida a consulta nao tem recorte (card de outra empresa nao serve de
  // alibi), entao nada pode ser conferido. Isto NAO e "esta tudo certo": e nao_conferido.
  if (!ctx.companyId) {
    return {
      inventados: [],
      nao_conferidos: ids,
      motivo: "empresa nao resolvida no turno: a consulta a approval_requests nao tem recorte",
    };
  }

  // Id fora do hexadecimal nao precisa (nem pode) ir ao banco: a coluna e uuid e a consulta
  // estouraria, caindo no catch abaixo e absolvendo justamente o caso mais obvio de invencao.
  // Ele e CONFERIDO aqui, por formato — nao existe uuid nao-hexadecimal em approval_requests.
  const consultaveis = ids.filter((id) => RE_UUID_VALIDO.test(id));
  const malformados = ids.filter((id) => !RE_UUID_VALIDO.test(id));
  if (!consultaveis.length) return { inventados: malformados, nao_conferidos: [], motivo: null };

  let achados: Array<{ id?: unknown }> | null = null;
  try {
    achados = await ctx.buscar(consultaveis);
  } catch (e) {
    return {
      inventados: malformados,
      nao_conferidos: consultaveis,
      motivo: `consulta a approval_requests falhou: ${String((e as Error)?.message ?? e).slice(0, 200)}`,
    };
  }
  if (achados == null) {
    return {
      inventados: malformados,
      nao_conferidos: consultaveis,
      // Resposta vazia sem erro e o formato do episodio de 03/09/2026 no gerar-legendas:
      // verificador que nao respondeu liberava a publicacao. Aqui ele nao libera nada.
      motivo: "consulta a approval_requests devolveu resposta vazia sem erro",
    };
  }
  const existentes = new Set(
    achados.map((r) => String(r?.id ?? "").toLowerCase()).filter(Boolean),
  );
  return {
    inventados: [...malformados, ...consultaveis.filter((id) => !existentes.has(id))],
    nao_conferidos: [],
    motivo: null,
  };
}

/**
 * Dos candidatos, quais NAO existem em approval_requests desta empresa.
 *
 * ATENCAO — esta funcao DESCARTA `nao_conferidos` de proposito, e por isso ela e insuficiente
 * como unico portao. O descarte preserva a protecao contra falso positivo (nao acusar sem
 * leitura) mas reintroduz o silencio: quem chama daqui nao fica sabendo que a conferencia nao
 * aconteceu. Ela continua existindo porque o comportamento de nao-acusar e correto e ja esta
 * provado, e mudar o tipo de retorno mexeria em todo chamador de uma vez.
 *
 * Quem precisa DECIDIR sobre a resposta usa `conferirApprovalIds` e trata os tres estados.
 * Quem so precisa da lista de acusaveis pode continuar aqui.
 */
export async function approvalIdsInexistentes(
  candidatos: string[],
  ctx: {
    companyId: string;
    buscar: (ids: string[]) => Promise<Array<{ id?: unknown }> | null>;
  },
): Promise<string[]> {
  return (await conferirApprovalIds(candidatos, ctx)).inventados;
}

/**
 * Texto de correcao quando o modelo citou card que nao existe. Nomeia os inventados e diz o
 * que de fato saiu, porque "algo esta errado" sem a lista deixa o gestor sem saber o que
 * repedir — foi exatamente o que faltou no CONJ.3.
 */
export function avisoDeCardInventado(inventados: string[], reaisDaRodada: string[]): string {
  const plural = inventados.length > 1;
  return `**${plural ? "Esses identificadores nao existem" : "Esse identificador nao existe"}: ` +
    `${inventados.join(", ")}.** Nenhuma ferramenta devolveu ${plural ? "eles" : "ele"}, ` +
    `entao ${plural ? "esses cards nao estao" : "esse card nao esta"} na fila e o que ` +
    `${plural ? "eles diziam representar nao foi pedido" : "ele dizia representar nao foi pedido"}. ` +
    (reaisDaRodada.length
      ? `Cards realmente emitidos nesta rodada: ${reaisDaRodada.join(", ")}. `
      : `Nenhum card foi emitido nesta rodada. `) +
    `O sistema retoma propose_action no proximo bloco — nao peca o gestor para repetir. ` +
    `Confira em get_aprovacoes antes de aprovar.`;
}

/**
 * Quando nenhum card real saiu, a prosa que ainda afirma "cards emitidos" / slate com
 * check de emissao e o resto da mentira. Medido 02/09/2026 no CONJ.4: o guarda nomeou
 * dois UUID inventados e deixou a secao "Cards emitidos" + slate "✅ Card emitido".
 */
export function cortarClaimEmitidoSemCard(texto: string): string {
  let t = String(texto ?? "");
  t = t.replace(/##\s*[^\n]*cards?\s+(re)?emitid[\s\S]*?(?=\n##\s|\n\[SLATE|\n---\s*\n|$)/gi, "");
  // "3) Cards emitidos — Conjunto 4" (sem ##) ate o proximo bloco numerado, slate ou legendas.
  t = t.replace(
    /\n?\d+\)\s*[^\n]*cards?\s+(re)?emitid[^\n]*\n[\s\S]*?(?=\n\d+\)\s|\n\[SLATE|\n\[LEGENDAS|\n##\s|\n---\s*\n|$)/gi,
    "\n",
  );
  t = t.replace(/^.*\bos\s+dois\s+(primeiros\s+)?cards?\s+foram\s+emitid.*$/gim, "");
  // Toda linha que afirma emissao — inclusive slate "✅ Card emitido" SEM approval_id.
  // A versao anterior FAZIA O CONTRARIO: mantinha a linha se nao havia UUID, que e o
  // formato do incidente CONJ.4 (02/09/2026).
  t = t.replace(/^.*card emitido.*$/gim, "");
  t = t.replace(/\b(os\s+)?(dois\s+)?(primeiros\s+)?cards?\s+(foram\s+)?(re)?emitid[^\n.]*/gi, "");
  return t.replace(/\n{3,}/g, "\n\n").trim();
}

const semAcento = (s: string) => s.normalize("NFD").replace(/[\u0300-\u036f]/g, "");

/** Claim de EMISSAO NESTA rodada — nao casa "pendente/aguardando" de card JA na fila. */
// "Cards 1 e 2 Emitidos" (CONJ.3, 01/09/2026) passava batido: entre "Cards" e "Emitidos"
// vinha a numeracao, e nenhuma alternativa cobria isso.
export const RE_CLAIM_CARD_EMITIDO =
  /##\s*cards?\s+(re)?emitid|\bcards?\s+(foram\s+)?(re)?emitid|\bcards?\s+\d+(\s*(e|,|a|-|ate|até)\s*\d+)*\s+(foram\s+)?(re)?emitid|\bos\s+dois\s+(primeiros\s+)?cards?\s+foram\s+emitid|\bemiti\s+(o\s+)?(pedido|card|os\s+cards?)\b|\bpedido\s+de\s+aprova[cç][aã]o\s+(foi\s+)?(emitido|registrado)\b/i;

/**
 * v28.40: HARD STOP — se a prosa afirma "card emitido" sem approval_id real em
 * actionCards, reescreve. Doutrina sozinha nao bastou (incidente IMPULSAO 20/08).
 *
 * Mora aqui (e nao no traffic-chat) para a prova rodar a guarda inteira sobre o texto real
 * do incidente; o chat so injeta a consulta ao banco em `buscarApprovalIds`.
 */
export async function sanitizarClaimDeCardSemLastro(
  reply: string,
  cards: Array<{ approval_id?: unknown }>,
  toolResults: Array<{ tool?: string; retorno?: any; erro?: string }>,
  opts?: {
    perguntaLeitura?: boolean;
    soComentario?: boolean;
    pedidoAto?: boolean;
    cardsDoTurno?: Array<{ approval_id?: unknown }> | null;
    companyId?: string;
    buscarApprovalIds?: (ids: string[]) => Promise<Array<{ id?: unknown }> | null>;
  },
): Promise<{ reply: string; reescreveu: boolean }> {
  const raw = String(reply ?? "").trim();
  if (!raw) return { reply: raw, reescreveu: false };

  // v28.88: UUID inventado e verificado SEMPRE, inclusive com card real na rodada — a
  // mistura de verdadeiro com inventado (CONJ.3, 01/09/2026) escapava no `cards.length > 0`
  // logo abaixo, e a tabela publicada mandava o gestor esperar anuncio que ninguem pediu.
  // v28.89: quem nao veio de tool nesta rodada e so CANDIDATO; o banco da o veredito.
  const candidatos = approvalIdsInventados(raw, {
    cardsDaRodada: cards,
    cardsDoTurno: opts?.cardsDoTurno ?? null,
    retornosDeFerramenta: toolResults,
  });
  const inventados = candidatos.length && opts?.companyId && opts?.buscarApprovalIds
    ? await approvalIdsInexistentes(candidatos, {
      companyId: opts.companyId,
      buscar: opts.buscarApprovalIds,
    })
    : [];
  if (inventados.length) {
    const aviso = avisoDeCardInventado(
      inventados,
      cards.map((c) => String(c.approval_id ?? "")).filter(Boolean),
    );
    // Tira as LINHAS que carregam o id inventado (linha de tabela, item de lista) em vez de
    // apagar a resposta: o que veio de ferramenta na mesma resposta continua valendo.
    let semInventado = raw
      .split("\n")
      .filter((l) => !inventados.some((u) => l.toLowerCase().includes(u)))
      .join("\n")
      .trim();
    if (!cards.length) {
      semInventado = cortarClaimEmitidoSemCard(semInventado);
      // O aviso acima diz "Nenhum card foi emitido"; "cada linha e um card pendente" que sobrar
      // o desmentiria na mesma mensagem.
      if (cardPendenteSemLastro(semInventado, { cardsDoTurno: opts?.cardsDoTurno, retornosDeFerramenta: toolResults })) {
        semInventado = trocarClaimCardPendente(semInventado);
      }
      // Nao apaga o resto so porque ainda casa RE_CLAIM: a selecao/legendas do CONJ.4
      // precisam ficar. So descarta sobra curta (titulo oco depois do corte).
      if (semInventado.length < 80) semInventado = "";
    }
    return { reply: semInventado ? `${aviso}\n\n${semInventado}` : aviso, reescreveu: true };
  }

  if (cards.length > 0) return { reply: raw, reescreveu: false };
  if (opts?.perguntaLeitura || opts?.pedidoAto === false) return { reply: raw, reescreveu: false };
  const leuFila = toolResults.some((t) => String(t.tool ?? "") === "get_aprovacoes");
  const tentouPropose = toolResults.some((t) => String(t.tool ?? "") === "propose_action");
  const prosaAfirmaEmissao = semAcento(raw.toLowerCase())
    .replace(/\bnao\s+(emiti|emitimos|foi emitido|foram emitidos)[^\n.]*/g, "")
    .replace(/\bnenhum (pedido de aprovacao|card)[^\n.]*/g, "")
    .replace(/\bsem (ato|essa ordem|verbo de emitir)[^\n.]*/g, "");
  const afirmaEmitido = !(leuFila && !tentouPropose) && RE_CLAIM_CARD_EMITIDO.test(prosaAfirmaEmissao);
  // "Card pendente" tem os proprios lastros (bloco anterior, fila lida, approval_id citado):
  // o portao `leuFila && !tentouPropose` acima e do verbo emitir e nao vale para o adjetivo.
  const afirmaPendente = cardPendenteSemLastro(raw, {
    cardsDoTurno: opts?.cardsDoTurno ?? null,
    retornosDeFerramenta: toolResults,
  });
  if (!afirmaEmitido && !afirmaPendente) return { reply: raw, reescreveu: false };

  const proposes = toolResults.filter((t) => String(t.tool ?? "") === "propose_action");
  const errosPropose = proposes
    .map((t) => {
      if (t.erro) return String(t.erro);
      const r = t.retorno;
      if (r && typeof r === "object" && (r as any).erro) return String((r as any).erro);
      return null;
    })
    .filter(Boolean) as string[];
  const deadlineSkip = proposes.some((t) =>
    /deadline|nao foi lido|consulta_nao_realizada/i.test(String(t.erro ?? "")));

  // "nao devolveu approval_id" quando a ferramenta nem foi chamada (o caso de 14/10/2026)
  // sugeria uma tentativa que nao houve.
  let motivo = proposes.length
    ? "propose_action nao devolveu approval_id nesta rodada"
    : "propose_action não foi chamado nesta rodada";
  if (deadlineSkip) {
    motivo = "o orcamento de tempo esgotou antes de concluir propose_action — o card NAO existe";
  } else if (errosPropose.length) {
    motivo = `propose_action recusou: ${errosPropose[0]}`;
  }

  const aviso = opts?.soComentario
    ? `**Nenhum pedido de aprovação foi emitido nesta rodada.** Desativar comentário não é ato de anúncio — ` +
      `não há card. O interruptor fica no Instagram/Business Suite. Pausar boost não fecha comentário. ` +
      `O sistema NÃO retoma propose_action.`
    : `**Nenhum pedido de aprovação foi emitido nesta rodada.** ${motivo}. ` +
      (afirmaEmitido
        ? `Afirmar "card emitido" sem o identificador devolvido pela ferramenta é fabricar um ato — `
        : `Apresentar como esperando aprovação um card que nenhuma ferramenta registrou é fabricar um ato — `) +
      `não há card na fila. O sistema retoma propose_action no próximo bloco — não peça de novo.`;

  // Remove a secao "## Card emitido…" (ate o proximo ## ou fim) e o claim solto.
  let limpo = cortarClaimEmitidoSemCard(raw)
    .replace(/##\s*card\s+emitido[^\n]*\n[\s\S]*?(?=\n##\s|\n---\s*\n|$)/gi, "")
    .replace(/\bcard\s+emitido[^\n.]*/gi, "")
    .replace(/\bemiti\s+(o\s+)?(pedido|card|os\s+cards?)[^\n.]*/gi, "")
    .trim();
  // A tabela de ids fica; so a coluna/frase de "pendente" sai. Zerar o texto (o que acontecia
  // com o claim de emissao) jogaria fora a leitura da Meta que o card de verdade vai usar.
  if (afirmaPendente) limpo = trocarClaimCardPendente(limpo);
  if (
    limpo.length < 80 || RE_CLAIM_CARD_EMITIDO.test(limpo) ||
    (afirmaPendente && afirmaCardPendente(limpo))
  ) {
    limpo = "";
  }
  const novo = limpo ? `${aviso}\n\n${limpo}` : aviso;
  return { reply: novo, reescreveu: true };
}

// ===== Card "pendente de aprovacao" que nao existe =====
// 14/10/2026, conversa 0da3ccb4 ("desative os anuncios"): nenhuma propose_action, zero linhas
// em approval_requests, e a resposta disse "cada linha e um card pendente de aprovacao", pos
// "pendente" na coluna Card de 21 linhas e fechou com "Aprovacao dos 21 cards executa a pausa".
// RE_CLAIM_CARD_EMITIDO so conhece o verbo "emitir"; esta e a mesma mentira no adjetivo.
//
// Tudo aqui roda sobre texto minusculo e sem acento.

/** Card de aprovacao. "CARD-04"/"IMG_CARD-04" sao nomes de peca: o \b e o lookahead os tiram. */
const CARD_DE_APROVACAO = String.raw`(?:\bcards?\b(?![-_]?\d)|\bpedidos?\s+de\s+aprovacao\b)`;
const ESPERA_APROVACAO =
  String.raw`(?:\bpendentes?\b|\baguarda(?:m|ndo)?\s+(?:a\s+)?(?:sua\s+)?aprovacao\b|\besperando\s+(?:a\s+)?(?:sua\s+)?aprovacao\b|\bna\s+fila\b)`;
/** "cada linha e um card pendente", "os 21 cards aguardam sua aprovacao", "Card 3: pendente". */
const RE_CARD_ESPERANDO = new RegExp(`${CARD_DE_APROVACAO}[^.!?\\n]{0,60}?${ESPERA_APROVACAO}`);
/** "aprovacao dos 21 cards executa a pausa", "aprove os 7 cards abaixo". */
const RE_APROVAR_CARDS = new RegExp(
  String.raw`\baprov(?:acao|ar|e|em|ando)\s+(?:d?[oa]s?\s+|esses\s+|estes\s+|cada\s+)?(?:\d+\s+)?` +
    CARD_DE_APROVACAO,
);
/** Negacao da existencia: "nenhum card pendente", "nao ha cards pendentes", "sem card pendente". */
const RE_NEGA_CARD =
  /\b(?:nenhum|nenhuma|zero)\b|\b0\s+cards?\b|\bnao\s+(?:ha|existe|existem|tem|temos|ficou|ficaram|resta|restam|sobrou|sobraram|foi|foram|houve|esta|estao|emiti|emitimos|criei|gerei|saiu|sairam)\b|\bsem\s+(?:nenhum\s+)?(?:cards?|pedidos?\s+de\s+aprovacao)\b|\bnada\s+(?:ficou\s+|esta\s+)?pendente\b|\bainda\s+nao\b/;
/**
 * Card que AINDA vai sair nao e afirmacao de existencia: "emito um card... ficarao pendentes",
 * "faltam 3 cards pendentes de emissao". "Pendente" tambem quer dizer "por fazer".
 */
const RE_CARD_POR_VIR =
  /\b(?:vou|vamos|irei|iremos|vai|vao)\s+(?:\w+\s+)?(?:emitir|criar|gerar|registrar|montar|aguardar|ficar)\b|\b(?:emitirei|emitiremos|emito|emitiria|criarei|crio)\b|\b(?:ficara|ficarao|ficaria|ficariam|estara|estarao|seria|seriam|sera|serao|aguardara|aguardarao)\b|\b(?:assim\s+que|quando|depois\s+que|depois\s+de|apos|ao)\s+(?:eu\s+)?(?:emitir|emitidos?|criar|criados?|gerar|gerados?|registrar)\b|\b(?:forem|for)\s+(?:emitidos?|criados?|gerados?)\b|\b(?:a|por|para)\s+emitir\b|\bpendentes?\s+de\s+(?:emissao|emitir|criacao|envio|serem)\b|\bfaltam?\b|\bproximo\s+bloco\b/;
/** Coluna de tabela que diz o estado do card: "Card", "Status do card", "Aprovacao". */
const RE_COLUNA_DO_CARD = /^(?:(?:status|situacao|estado)\s+(?:do\s+)?)?(?:cards?|aprovacao)$/;
const RE_CELULA_CARD_EXISTE = /\b(?:pendentes?|aguardando|esperando|na\s+fila|emitidos?|criados?|registrados?)\b/;

const ehLinhaDeTabela = (l: string) => /^\s*\|.*\|\s*$/.test(l);
const ehSeparadorDeTabela = (l: string) => /^\s*\|?(?:\s*:?-{2,}:?\s*\|)+\s*:?-{0,}:?\s*\|?\s*$/.test(l);
const celulasDe = (l: string) => l.trim().replace(/^\|/, "").replace(/\|$/, "").split("|");
const normCelula = (c: string) => semAcento(c.toLowerCase()).replace(/[*_`]/g, "").trim();

/** Clausula (pedaco entre ":" e ";") que, sozinha, afirma card esperando aprovacao. */
function clausulaAfirma(c: string): boolean {
  if (RE_NEGA_CARD.test(c) || RE_CARD_POR_VIR.test(c)) return false;
  return RE_CARD_ESPERANDO.test(c) || RE_APROVAR_CARDS.test(c);
}

/**
 * A frase afirma card esperando aprovacao. Olha cada clausula ("Nada foi publicado: cada linha
 * e um card pendente" — a primeira nao anula a segunda) e a frase inteira ("Card 3: pendente"
 * so fecha juntando os dois lados), mas a frase inteira so conta se nenhuma clausula nega ou
 * poe o card no futuro.
 */
function fraseAfirma(frase: string): boolean {
  const f = semAcento(frase.toLowerCase());
  const clausulas = f.split(/[:;]/);
  if (clausulas.some(clausulaAfirma)) return true;
  if (clausulas.some((c) => RE_NEGA_CARD.test(c) || RE_CARD_POR_VIR.test(c))) return false;
  return RE_CARD_ESPERANDO.test(f) || RE_APROVAR_CARDS.test(f);
}

const frasesDe = (linha: string) => linha.split(/(?<=[.!?])\s+/);

/**
 * Percorre o texto separando tabela de prosa e devolve, por tabela, o indice da coluna do card
 * e, por linha de prosa, as frases. Os dois consumidores (detectar e reescrever) andam igual.
 */
function mapearCardPendente(texto: string): Array<
  | { tipo: "prosa"; linha: string; frases: { frase: string; afirma: boolean }[] }
  | { tipo: "tabela"; linha: string; coluna: number; afirma: boolean }
> {
  const linhas = String(texto ?? "").split("\n");
  const out: ReturnType<typeof mapearCardPendente> = [];
  let coluna = -1;
  for (let i = 0; i < linhas.length; i++) {
    const l = linhas[i];
    if (!ehLinhaDeTabela(l)) {
      coluna = -1;
      out.push({
        tipo: "prosa",
        linha: l,
        frases: frasesDe(l).map((frase) => ({ frase, afirma: fraseAfirma(frase) })),
      });
      continue;
    }
    // Cabecalho = linha de tabela seguida do separador "|---|".
    if (coluna === -1 && i + 1 < linhas.length && ehSeparadorDeTabela(linhas[i + 1])) {
      coluna = celulasDe(l).map(normCelula).findIndex((c) => RE_COLUNA_DO_CARD.test(c));
      out.push({ tipo: "tabela", linha: l, coluna: -1, afirma: false });
      continue;
    }
    const cel = coluna >= 0 ? normCelula(celulasDe(l)[coluna] ?? "") : "";
    const afirma = coluna >= 0 && RE_CELULA_CARD_EXISTE.test(cel) && !RE_NEGA_CARD.test(cel) &&
      !/\bnao\b/.test(cel);
    out.push({ tipo: "tabela", linha: l, coluna: afirma ? coluna : -1, afirma });
  }
  return out;
}

/** O texto afirma que EXISTE card esperando aprovacao (frase ou coluna de tabela). */
export function afirmaCardPendente(texto: string): boolean {
  return mapearCardPendente(texto).some((p) =>
    p.tipo === "tabela" ? p.afirma : p.frases.some((f) => f.afirma)
  );
}

/**
 * Tira a afirmacao e MANTEM o resto: a tabela de ids do incidente veio da leitura da Meta e e
 * o insumo do card de verdade no proximo bloco. Celula "pendente" na coluna do card vira
 * "não emitido"; frase que afirma card esperando aprovacao sai inteira.
 */
export function trocarClaimCardPendente(texto: string): string {
  const linhas: string[] = [];
  for (const p of mapearCardPendente(texto)) {
    if (p.tipo === "tabela") {
      if (!p.afirma) {
        linhas.push(p.linha);
        continue;
      }
      const partes = p.linha.split("|");
      // A linha comeca com "|", entao a celula N mora em partes[N + 1].
      const alvo = p.coluna + (p.linha.trim().startsWith("|") ? 1 : 0);
      partes[alvo] = " não emitido ";
      linhas.push(partes.join("|"));
      continue;
    }
    if (!p.frases.some((f) => f.afirma)) {
      linhas.push(p.linha);
      continue;
    }
    const resto = p.frases.filter((f) => !f.afirma).map((f) => f.frase).join(" ").trim();
    if (resto) linhas.push(resto);
  }
  return linhas.join("\n").replace(/\n{3,}/g, "\n\n").trim();
}

/**
 * A afirmacao de card pendente tem lastro neste turno? Tres lastros, cada um um falso positivo
 * que esta guarda nao pode produzir:
 *  (a) turno de varios blocos: turnCheckpoint.cards traz card real de bloco anterior;
 *  (b) get_aprovacoes leu a fila e ela tinha pedido (ou nao da para saber: erro, retorno
 *      cortado) — citar card pendente lido dali e fato. Fila lida e VAZIA nao e lastro: ela
 *      prova o contrario;
 *  (c) o texto cita approval_id — a checagem de UUID acima ja o conferiu no banco.
 * Negacao ("nenhum card pendente") nao chega aqui: `afirmaCardPendente` ja a descarta.
 */
export function cardPendenteSemLastro(
  texto: string,
  ctx: {
    cardsDoTurno?: Array<{ approval_id?: unknown }> | null;
    retornosDeFerramenta: Array<{ tool?: string; retorno?: unknown }>;
  },
): boolean {
  if ((ctx.cardsDoTurno ?? []).some((c) => String(c?.approval_id ?? "").trim())) return false;
  const leituras = ctx.retornosDeFerramenta.filter((t) => String(t?.tool ?? "") === "get_aprovacoes");
  const filaVazia = (r: unknown) =>
    !!r && typeof r === "object" && Array.isArray((r as { pedidos?: unknown }).pedidos) &&
    (r as { pedidos: unknown[] }).pedidos.length === 0;
  if (leituras.some((t) => !filaVazia(t.retorno))) return false;
  if (new RegExp(RE_UUID_CARD.source, "i").test(String(texto ?? ""))) return false;
  return afirmaCardPendente(texto);
}
