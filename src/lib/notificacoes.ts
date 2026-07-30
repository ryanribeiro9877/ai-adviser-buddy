// Notificação não é entidade: é projeção de `approval_requests.status = pendente`
// e `alerts.resolved = false`. Não existe tabela, não existe "marcar como lida" —
// o item sai do sino quando é resolvido de fato no banco.
// Fonte única de conteúdo, contagem e urgência: a RPC get_notificacoes_pendentes.

export type UrgenciaNotif = "critical" | "high" | "medium" | "low";
export type TipoNotif = "aprovacao" | "alerta";

export type ItemNotificacao = {
  id: string;
  tipo: TipoNotif;
  titulo: string;
  descricao: string | null;
  /** Vem calculada da RPC. NUNCA recalcular no front. */
  urgencia: UrgenciaNotif;
  created_at: string;
  expires_at: string | null;
  minutos_para_expirar: number | null;
  conversation_id: string | null;
};

export type Notificacoes = {
  total: number;
  aprovacoes_pendentes: number;
  alertas_abertos: number;
  /** A RPC conta critical + high aqui. */
  criticos: number;
  expirando_em_2h: number;
  itens: ItemNotificacao[];
};

export const NOTIFICACOES_VAZIAS: Notificacoes = {
  total: 0,
  aprovacoes_pendentes: 0,
  alertas_abertos: 0,
  criticos: 0,
  expirando_em_2h: 0,
  itens: [],
};

// Mesma convenção de cor da tela de Alertas: critical/high vermelho, medium
// âmbar, low neutro. O `criticos` da RPC agrupa critical+high — a cor segue isso.
export const URGENCIA: Record<
  UrgenciaNotif,
  { rotulo: string; ponto: string; texto: string; vermelha: boolean }
> = {
  critical: {
    rotulo: "Crítico",
    ponto: "bg-destructive",
    texto: "text-destructive",
    vermelha: true,
  },
  high: { rotulo: "Alta", ponto: "bg-destructive", texto: "text-destructive", vermelha: true },
  medium: {
    rotulo: "Atenção",
    ponto: "bg-[color:var(--color-warning)]",
    texto: "text-[color:var(--color-warning)]",
    vermelha: false,
  },
  low: {
    rotulo: "Informativo",
    ponto: "bg-muted-foreground",
    texto: "text-muted-foreground",
    vermelha: false,
  },
};

const RANK: Record<UrgenciaNotif, number> = { critical: 0, high: 1, medium: 2, low: 3 };

/** Urgência mais alta de um conjunto (para o toast agrupado). */
export function maiorUrgencia(itens: { urgencia: UrgenciaNotif }[]): UrgenciaNotif {
  return itens.reduce<UrgenciaNotif>(
    (pior, i) => (RANK[i.urgencia] < RANK[pior] ? i.urgencia : pior),
    "low",
  );
}

/** Toast de urgência alta não desaparece sozinho; o resto sai em 8s. */
export function persistente(u: UrgenciaNotif): boolean {
  return u === "critical" || u === "high";
}

export type Destino = { pathname: string; search: Record<string, string> };

/**
 * Destino de cada tipo, com o item destacado na tela.
 * Aprovações são renderizadas na aba "Aprovações" da tela Operação (/recomendacoes);
 * a rota antiga /aprovacoes segue oculta por feature-flag.
 */
export function destinoNotificacao(item: ItemNotificacao): Destino {
  if (item.tipo === "alerta") return { pathname: "/alertas", search: { item: item.id } };
  return { pathname: "/recomendacoes", search: { tab: "aprovacoes", item: item.id } };
}

/** Agrupa itens idênticos pelo título (hoje há dois "Jobs internos com falha"). */
export type Grupo = { chave: string; principal: ItemNotificacao; quantidade: number };

export function agruparPorTitulo(itens: ItemNotificacao[]): Grupo[] {
  const grupos: Grupo[] = [];
  const index = new Map<string, Grupo>();
  for (const item of itens) {
    const chave = `${item.tipo}::${item.titulo}`;
    const existente = index.get(chave);
    if (existente) {
      existente.quantidade += 1;
      continue;
    }
    // O primeiro de cada grupo já vem na ordem da RPC (urgência, depois data),
    // então ele é o representante certo: o mais urgente/recente do grupo.
    const grupo = { chave, principal: item, quantidade: 1 };
    index.set(chave, grupo);
    grupos.push(grupo);
  }
  return grupos;
}

/** "há 3 min", "há 2h", "há 4 d". */
export function haQuanto(iso: string, agora = Date.now()): string {
  const min = Math.floor((agora - new Date(iso).getTime()) / 60000);
  if (min < 1) return "agora";
  if (min < 60) return `há ${min} min`;
  const h = Math.floor(min / 60);
  if (h < 24) return `há ${h}h`;
  return `há ${Math.floor(h / 24)} d`;
}

/**
 * Texto do contador de expiração. Deriva de `expires_at` (não da urgência) para
 * poder decrescer de minuto em minuto sem novo fetch.
 */
export function textoExpiracao(expiresAt: string | null, agora = Date.now()): string | null {
  if (!expiresAt) return null;
  const min = Math.floor((new Date(expiresAt).getTime() - agora) / 60000);
  if (min <= 0) return "expirado";
  if (min < 60) return `expira em ${min}min`;
  const h = Math.floor(min / 60);
  const resto = min % 60;
  return resto === 0 ? `expira em ${h}h` : `expira em ${h}h ${resto}min`;
}

export function expirado(expiresAt: string | null, agora = Date.now()): boolean {
  return !!expiresAt && new Date(expiresAt).getTime() <= agora;
}

/** Primeira linha da descrição — o sino e o toast mostram só ela. */
export function primeiraLinha(texto: string | null, max = 120): string {
  if (!texto) return "";
  const linha = texto.split("\n")[0].trim();
  return linha.length > max ? `${linha.slice(0, max - 1)}…` : linha;
}

/** Máximo de toasts na tela ao mesmo tempo; o excedente colapsa em um só. */
export const TOASTS_MAX = 3;

export type EventoRealtime = {
  eventType: string;
  new?: Record<string, unknown> | null;
  old?: Record<string, unknown> | null;
};

/**
 * Só é candidato a aviso quem ENTRA na fila: insert de item aberto, ou update
 * que reabre. Decidir uma aprovação ou resolver um alerta muda a lista do sino,
 * mas não é novidade — não pode virar toast.
 * Depende de REPLICA IDENTITY FULL para ver o registro antigo no UPDATE.
 */
export function ehNovaPendencia(ev: EventoRealtime, tipo: TipoNotif): boolean {
  if (ev.eventType === "DELETE") return false;
  const aberto = (r?: Record<string, unknown> | null) =>
    tipo === "alerta" ? r?.resolved === false : r?.status === "pending";
  if (ev.eventType === "INSERT") return aberto(ev.new);
  return !aberto(ev.old) && aberto(ev.new);
}

/**
 * Distribui os novos itens entre toasts individuais e um agrupado:
 * 3+ de uma vez viram um só (rajada de cron), e o que passar do teto de
 * simultâneos também colapsa.
 */
export function planejarToasts(
  novos: ItemNotificacao[],
  ativos: number,
  max = TOASTS_MAX,
): { individuais: ItemNotificacao[]; agrupado: ItemNotificacao[] } {
  if (novos.length >= 3) return { individuais: [], agrupado: novos };
  const espaco = Math.max(0, max - ativos);
  const agrupado = novos.slice(espaco);
  // Colapsar UM item só não economiza toast e perde o destino direto: mostra ele.
  if (agrupado.length === 1) return { individuais: novos, agrupado: [] };
  return { individuais: novos.slice(0, espaco), agrupado };
}

/** Rótulo do toast agrupado, honesto quanto à mistura de tipos. */
export function rotuloGrupo(itens: ItemNotificacao[]): string {
  const n = itens.length;
  const soAlertas = itens.every((i) => i.tipo === "alerta");
  const soAprovacoes = itens.every((i) => i.tipo === "aprovacao");
  if (soAlertas) return `${n} ${n === 1 ? "novo alerta" : "novos alertas"}`;
  if (soAprovacoes)
    return `${n} ${n === 1 ? "novo pedido de aprovação" : "novos pedidos de aprovação"}`;
  return `${n} ${n === 1 ? "nova pendência" : "novas pendências"}`;
}
