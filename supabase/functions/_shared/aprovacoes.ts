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
];

/**
 * Traduz uma falha de execucao para uma frase que o gestor entende.
 * `recusaConhecida` vem de uma recusa NOMEADA pelo proprio sistema (montarCriacao), e quando
 * existe ela manda - o sistema sabe mais sobre o proprio "nao" do que qualquer regex.
 */
export function traduzirFalha(
  bruto: unknown,
  recusaConhecida?: string | null,
  mensagemConhecida?: string | null,
): FalhaTraduzida {
  if (recusaConhecida && mensagemConhecida) {
    return { recusa: recusaConhecida, motivo_para_o_gestor: mensagemConhecida };
  }
  const texto = typeof bruto === "string" ? bruto : safeJson(bruto);
  for (const a of ASSINATURAS) {
    if (a.quando.test(texto)) {
      return { recusa: recusaConhecida ?? a.recusa, motivo_para_o_gestor: a.frase };
    }
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
