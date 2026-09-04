/**
 * Semantica do fio do chat: o que conta como RESPOSTA ao gestor, e quando o
 * front deve parar de continuar o turno.
 *
 * Estas funcoes moravam dentro de operacao-chat.tsx, em escopo de modulo e sem
 * export — puras, prontas para teste, e inalcancaveis por teste. O componente
 * tem 1750 linhas e zero cobertura; era aqui que ficava a decisao mais cara da
 * tela: se um retorno vazio, um stub de progresso ou um stub de falha do job
 * contam como "o gestor foi respondido".
 *
 * O criterio para tirar daqui e o mesmo que ja produziu chat-http-erro.ts, que
 * guarda `turnoSincronoOrfao` extraida DESTE componente e coberta por teste.
 * Estas sao as irmas que ficaram para tras.
 *
 * Por que importa: um `false` a mais em hasSubstantiveReplyAfterLastUser deixa o
 * card de falha na tela para sempre depois de uma resposta que chegou; um `true`
 * a mais some com o card enquanto o turno ainda esta sem resposta — e silencio
 * na tela e o modo de falha mais caro deste produto.
 */
import { replyLoteComLegendas, replyLoteCriativoIncompleto } from "@/lib/lote-criativo";
import {
  ehPedidoUploadLote,
  ehUploadLoteCurto,
  replyLeituraIncompleta,
} from "@/lib/intencao-turno";

export type Message = {
  id: string;
  role: string;
  content: string | null;
  tool_calls: unknown;
  attachments: unknown;
  model: string | null;
  created_at: string;
};

export type AttachmentMeta = { name?: string; mime?: string; kb?: number };

export type ChatReply = {
  ok: boolean;
  conversation_id: string;
  reply: string;
  tools_used?: string[];
  // "stop" = completa; começa com "length" = cortada pelo limite de tamanho;
  // "continuar_turno" = orçamento esgotou com checkpoint — retomar automaticamente.
  finish_reason?: string;
  // A edge pode encaminhar o pedido para a rota assíncrona antes de responder. Nesse caso
  // não há `reply`: o que volta é o job, e a resposta chega pela conversa (Realtime).
  async?: boolean;
  job_id?: string;
  roteado_para_job?: boolean;
  /** v28.37: turno sincrono pediu novo segmento (checkpoint gravado). */
  continuar?: boolean;
  segmento?: number;
  aviso?: string;
};

// Costura de respostas longas no FRONT: cada requisição fica dentro dos 150s da
// plataforma e o cliente emenda os pedaços. Texto exigido pelo briefing.
export const CONTINUE_PROMPT =
  "Sua resposta anterior foi cortada pelo limite de tamanho. Continue EXATAMENTE do ponto onde parou, na próxima palavra ou linha. Não repita nada do que já escreveu, não reintroduza o assunto, não reescreva títulos já entregues, não cumprimente. Apenas continue até concluir.";
// Segmentos extras alem da costura por tamanho (checkpoint de orçamento / ato).
export const MAX_CONTINUATIONS = 6;
export const MAX_CONTINUATIONS_UPLOAD = 8;

export const isTruncated = (fr?: string) => !!fr && fr.startsWith("length");

export const needsAutoContinue = (data?: ChatReply | null) =>
  !!data &&
  data.continuar === true &&
  !!data.finish_reason &&
  data.finish_reason.startsWith("continuar_turno");

export function deaccFront(s: string) {
  return s.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
}

/** Mensagens de progresso / checkpoint — nao contam como resposta ao gestor. */
export function isProgressOnlyReply(text: string): boolean {
  const raw = (text ?? "").trim();
  if (!raw) return true;
  if (/##\s*status do upload/i.test(raw)) return false;
  const t = deaccFront(raw.toLowerCase());
  if (raw.length < 80 && /continuando|montando os pedidos/.test(t)) return true;
  return (
    /^montando os pedidos de aprovacao/.test(t) ||
    /^continuando automaticamente/.test(t) ||
    /continuando automaticamente para emitir/.test(t) ||
    /^\[continuacao automatica do sistema/.test(t)
  );
}

export function mesmaProsa(a: string, b: string): boolean {
  return deaccFront((a ?? "").trim().toLowerCase()) === deaccFront((b ?? "").trim().toLowerCase());
}

/** Junta bolhas consecutivas sem duplicar stub de progresso. */
export function mergeAssistantContent(prev: string, next: string): string {
  const p = (prev ?? "").trim();
  const n = (next ?? "").trim();
  if (!n) return prev ?? "";
  if (!p) return next ?? "";
  if (mesmaProsa(p, n)) return prev;
  if (isProgressOnlyReply(p) && isProgressOnlyReply(n)) return prev;
  if (isProgressOnlyReply(p) && !isProgressOnlyReply(n)) return next;
  if (!isProgressOnlyReply(p) && isProgressOnlyReply(n)) return prev;
  return `${prev ?? ""}\n${next ?? ""}`;
}

export function mergeLivePiece(acc: string, piece: string): string {
  const a = (acc ?? "").trim();
  const p = (piece ?? "").trim();
  if (!p) return acc;
  if (mesmaProsa(a, p) || (isProgressOnlyReply(p) && isProgressOnlyReply(a))) return acc;
  if (/##\s*status do upload/i.test(p)) return p;
  if (isProgressOnlyReply(p)) return a && !isProgressOnlyReply(a) ? acc : "";
  if (!a || isProgressOnlyReply(a)) return p;
  return `${acc}\n\n${p}`;
}

export function liveOverlayText(acc: string): string {
  const t = (acc ?? "").trim();
  if (!t || isProgressOnlyReply(t)) return "continuando a resposta…";
  return acc;
}

/** Stub gravado pelo traffic-agent-job no catch — nao conta como resposta real. */
export function isJobFailureStub(text: string): boolean {
  return /processamento em segundo plano falhou|modelo ficou sobrecarregado nesta rodada/i.test(
    text ?? "",
  );
}

/** Há resposta substantiva (não stub/progresso) depois do último user. */
export function hasSubstantiveReplyAfterLastUser(msgs: Message[]): boolean {
  for (let i = msgs.length - 1; i >= 0; i--) {
    const m = msgs[i];
    if (m.role === "user") return false;
    if (
      m.role === "assistant" &&
      !isProgressOnlyReply(m.content ?? "") &&
      !isJobFailureStub(m.content ?? "")
    ) {
      return true;
    }
  }
  return false;
}

/** Resposta que ja fecha o turno (clarificacao / decisao) — front nao deve auto-continuar. */
export function looksLikeCompleteTurn(text: string): boolean {
  const raw = (text ?? "").trim();
  if (raw.length < 100 || isProgressOnlyReply(raw)) return false;
  if (replyLoteCriativoIncompleto(raw) || replyLoteComLegendas(raw)) return false;
  if (replyLeituraIncompleta(raw)) return false;
  if (/##\s*status do upload/i.test(raw) && /ainda fora da meta/i.test(raw)) return false;
  const t = deaccFront(raw.toLowerCase());
  if (/\?/.test(raw) && !/envie (novamente|de novo)|nova pergunta|peca de novo/.test(t))
    return true;
  return /\b(preciso (da sua|que voce|confirmar|saber)|qual (o |a )?(objetivo|opcao|caminho|meta)|me (confirma|diga|escolha)|antes de (criar|emitir|propor)|contradic|aguardo (sua|a) (resposta|decisao)|escolha (uma|o|a)|decida)\b/.test(
    t,
  );
}

export function lastUserContent(msgs: Message[]): string {
  for (let i = msgs.length - 1; i >= 0; i--) {
    if (msgs[i].role === "user") return msgs[i].content ?? "";
  }
  return "";
}

export function uploadLoteAberto(msgs: Message[]): boolean {
  return ehPedidoUploadLote(lastUserContent(msgs));
}

export function leituraAindaAberta(msgs: Message[]): boolean {
  for (let i = msgs.length - 1; i >= 0; i--) {
    const m = msgs[i];
    if (m.role === "user") break;
    if (m.role !== "assistant") continue;
    if (replyLeituraIncompleta(m.content ?? "")) return true;
  }
  return false;
}

export function devePararContinuacao(msgs: Message[]): boolean {
  if (uploadLoteAberto(msgs)) return false;
  if (leituraAindaAberta(msgs)) return false;
  return countSubstantiveAssistantsSinceLastUser(msgs) >= 2 && !loteAindaAberto(msgs);
}

/** Lote de criativos ainda em curso: nao cortar a continuacao na 2a bolha. */
export function loteAindaAberto(msgs: Message[]): boolean {
  for (let i = msgs.length - 1; i >= 0; i--) {
    const m = msgs[i];
    if (m.role === "user") break;
    if (m.role !== "assistant") continue;
    const c = m.content ?? "";
    if (replyLoteCriativoIncompleto(c) || replyLoteComLegendas(c)) return true;
  }
  return false;
}

/** Conta assistants substantivos apos o ultimo user (protege contra 2a bolha). */
export function countSubstantiveAssistantsSinceLastUser(msgs: Message[]): number {
  let count = 0;
  for (let i = msgs.length - 1; i >= 0; i--) {
    const m = msgs[i];
    if (m.role === "user") break;
    if (m.role === "assistant" && !isProgressOnlyReply(m.content ?? "")) count++;
  }
  return count;
}

/**
 * Teto de segmentos para o pedido em curso. Vivia duplicado em operacao-chat
 * (uma copia para a costura do envio, outra para o rodape "continuando…"), e
 * duas copias da mesma politica sao duas politicas esperando divergir.
 */
export function capContinuacoes(texto: string): number {
  return ehPedidoUploadLote(texto)
    ? ehUploadLoteCurto(texto)
      ? 3
      : MAX_CONTINUATIONS_UPLOAD
    : MAX_CONTINUATIONS;
}

// Normaliza as tools para chips: uma ocorrencia por nome (1a aparicao).
export function toolNames(toolCalls: unknown): string[] {
  if (!Array.isArray(toolCalls)) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of toolCalls) {
    const t = raw && typeof raw === "object" ? (raw as { tool?: string }).tool : undefined;
    if (typeof t !== "string" || !t || seen.has(t)) continue;
    seen.add(t);
    out.push(t);
  }
  return out;
}

export function storedAttachments(att: unknown): AttachmentMeta[] {
  if (!Array.isArray(att)) return [];
  return att.filter((x): x is AttachmentMeta => !!x && typeof x === "object");
}

// Marcadores de ActionCard nos attachments da mensagem assistant: extrai os approval_id.
export function actionCardIds(att: unknown): string[] {
  if (!Array.isArray(att)) return [];
  return att
    .filter(
      (x): x is { approval_id: string } =>
        !!x &&
        typeof x === "object" &&
        (x as { tipo?: unknown }).tipo === "action_card" &&
        typeof (x as { approval_id?: unknown }).approval_id === "string",
    )
    .map((x) => x.approval_id);
}
