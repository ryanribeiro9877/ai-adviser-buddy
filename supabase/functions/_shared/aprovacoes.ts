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
 * Veredito final: dos candidatos, quais NAO existem em approval_requests desta empresa.
 * Consulta por id (chave primaria) e filtra por empresa — card de outra empresa nao serve
 * de alibi. Se a consulta falhar, devolve lista VAZIA: sem leitura nao ha acusacao, porque
 * marcar card real como inventado quebra a operacao tanto quanto o contrario.
 */
export async function approvalIdsInexistentes(
  candidatos: string[],
  ctx: {
    companyId: string;
    buscar: (ids: string[]) => Promise<Array<{ id?: unknown }> | null>;
  },
): Promise<string[]> {
  const ids = [...new Set(candidatos.map((c) => String(c ?? "").toLowerCase()).filter(Boolean))];
  if (!ids.length || !ctx.companyId) return [];

  // Id fora do hexadecimal nao precisa (nem pode) ir ao banco: a coluna e uuid e a consulta
  // estouraria, caindo no catch abaixo e absolvendo justamente o caso mais obvio de invencao.
  const consultaveis = ids.filter((id) => RE_UUID_VALIDO.test(id));
  const malformados = ids.filter((id) => !RE_UUID_VALIDO.test(id));
  if (!consultaveis.length) return malformados;

  let achados: Array<{ id?: unknown }> | null = null;
  try {
    achados = await ctx.buscar(consultaveis);
  } catch {
    return malformados;
  }
  if (achados == null) return malformados;
  const existentes = new Set(
    achados.map((r) => String(r?.id ?? "").toLowerCase()).filter(Boolean),
  );
  return [...malformados, ...consultaveis.filter((id) => !existentes.has(id))];
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
