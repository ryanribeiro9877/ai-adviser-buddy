import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate, useSearch } from "@tanstack/react-router";
import { toast } from "sonner";
import {
  Plus,
  Send,
  Bot,
  Loader2,
  MessagesSquare,
  Mic,
  Microscope,
  Paperclip,
  RefreshCw,
  Trash2,
  Square,
  X,
  Image as ImageIcon,
  FileText,
  FileSpreadsheet,
  File as FileIcon,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useApp } from "@/lib/app-context";
import { useDictation } from "@/hooks/use-dictation";
import {
  ACCEPT,
  MAX_FILES,
  MAX_BYTES,
  fileToBase64,
  toOutgoing,
  kindFromMime,
  type AttachmentKind,
  type OutgoingAttachment,
} from "@/lib/attachments";
import { Markdown } from "@/components/markdown";
import { JobProgressCard } from "@/components/job-progress-card";
import { ActionCard, decideApproval, type Approval, type Decision } from "@/components/action-card";
import { APPROVAL_SELECT } from "@/components/approvals-queue";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";

type Conversation = { id: string; title: string | null; updated_at: string };
type Message = {
  id: string;
  role: string;
  content: string | null;
  tool_calls: unknown;
  attachments: unknown;
  model: string | null;
  created_at: string;
};

type ChatReply = {
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
const CONTINUE_PROMPT =
  "Sua resposta anterior foi cortada pelo limite de tamanho. Continue EXATAMENTE do ponto onde parou, na próxima palavra ou linha. Não repita nada do que já escreveu, não reintroduza o assunto, não reescreva títulos já entregues, não cumprimente. Apenas continue até concluir.";
// Segmentos extras alem da costura por tamanho (checkpoint de orçamento / ato).
const MAX_CONTINUATIONS = 5;
const isTruncated = (fr?: string) => !!fr && fr.startsWith("length");
const needsAutoContinue = (data?: ChatReply | null) =>
  !!data && data.continuar === true && !!data.finish_reason && data.finish_reason.startsWith("continuar_turno");

function deaccFront(s: string) {
  return s.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
}

/** Mensagens de progresso / checkpoint — nao contam como resposta ao gestor. */
function isProgressOnlyReply(text: string): boolean {
  const raw = (text ?? "").trim();
  if (!raw) return true;
  const t = deaccFront(raw.toLowerCase());
  if (raw.length < 80 && /continuando|montando os pedidos/.test(t)) return true;
  return (
    /^montando os pedidos de aprovacao/.test(t) ||
    /^continuando automaticamente/.test(t) ||
    /continuando automaticamente para emitir/.test(t) ||
    /^\[continuacao automatica do sistema/.test(t)
  );
}

/** Stub gravado pelo traffic-agent-job no catch — nao conta como resposta real. */
function isJobFailureStub(text: string): boolean {
  return /processamento em segundo plano falhou/i.test(text ?? "");
}

/** Há resposta substantiva (não stub/progresso) depois do último user. */
function hasSubstantiveReplyAfterLastUser(msgs: Message[]): boolean {
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
function looksLikeCompleteTurn(text: string): boolean {
  const raw = (text ?? "").trim();
  if (raw.length < 100 || isProgressOnlyReply(raw)) return false;
  const t = deaccFront(raw.toLowerCase());
  if (/\?/.test(raw)) return true;
  return /\b(preciso (da sua|que voce|confirmar|saber)|qual (o |a )?(objetivo|opcao|caminho|meta)|me (confirma|diga|escolha)|antes de (criar|emitir|propor)|contradic|aguardo (sua|a) (resposta|decisao)|escolha (uma|o|a)|decida)\b/.test(t);
}

/** Conta assistants substantivos apos o ultimo user (protege contra 2a bolha). */
function countSubstantiveAssistantsSinceLastUser(msgs: Message[]): number {
  let count = 0;
  for (let i = msgs.length - 1; i >= 0; i--) {
    const m = msgs[i];
    if (m.role === "user") break;
    if (m.role === "assistant" && !isProgressOnlyReply(m.content ?? "")) count++;
  }
  return count;
}

// Estado de processamento é DERIVADO do banco, não guardado em memória: um turno
// está em andamento quando a última mensagem da conversa é 'user' e nenhuma
// 'assistant' veio depois. Isso sobrevive a trocar de conversa, F5 e outra aba —
// o que estado local nunca cobriria. A edge grava a resposta antes de responder
// ao HTTP, então o trabalho não se perde ao navegar.
// Governa APENAS o caminho síncrono (traffic-chat), onde a resposta vem no próprio HTTP e
// passar de 2 min significa que a requisição não voltou no orçamento operacional alinhado
// à edge (HARD_LIMIT ~118s; teto de plataforma Supabase ~150s IDLE, não configurável).
// NÃO vale para análise profunda: lá o veredito é do banco (`chat_jobs`), e job passar de
// 2–3 min é rotina — dos 15 jobs medidos em 05/08, 6 passaram de 180 s e a média é 196 s.
// Por isso o aviso derivado deste literal é renderizado sob `!jobAtivo`.
const TIMEOUT_TURNO_MS = 2 * 60 * 1000;
const JANELA_STATUS_MS = 30 * 60 * 1000; // recorte para varrer a lista de conversas

// Análise profunda: a edge traffic-agent-job roda subagentes em background e
// responde 202 em ~1s; a resposta final só chega por Realtime em chat_messages.
//
// O roteamento AUTOMÁTICO saiu daqui (v28.11). Ele era `text.length > 1500` e tinha dois
// defeitos medidos: (a) não pegava o caso real — o pedido que truncou em 07/08 tinha 594
// caracteres e gastou 9 ferramentas; (b) mandava pedido de AÇÃO para uma rota que não tem
// `propose_action`, ou seja, trocava um card por card nenhum. Quem decide agora é a edge
// `traffic-chat`, que enxerga famílias de assunto do pedido, anexos e verbos de ato, e
// devolve `async + job_id` quando encaminha. Este toggle continua sendo o pedido EXPLÍCITO
// do gestor e vai direto ao job.
type ChatJobReply = { ok: boolean; async?: boolean; job_id: string; conversation_id: string };

type PendingFile = {
  id: string;
  file: File;
  name: string;
  sizeKb: number;
  mime: string;
  url?: string;
};

type AttachmentMeta = { name?: string; mime?: string; kb?: number };

const ICON_BY_KIND: Record<AttachmentKind, typeof FileIcon> = {
  image: ImageIcon,
  pdf: FileText,
  sheet: FileSpreadsheet,
  text: FileText,
  file: FileIcon,
};

const fmtWhen = (iso: string) =>
  new Date(iso).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" });

const fmtDuration = (ms: number) => {
  const s = Math.floor(ms / 1000);
  return `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
};

// Normaliza as tools para chips: histórico grava tool_calls = [{ tool, args }].
function toolNames(toolCalls: unknown): string[] {
  if (!Array.isArray(toolCalls)) return [];
  return toolCalls
    .map((t) => (t && typeof t === "object" ? (t as { tool?: string }).tool : undefined))
    .filter((t): t is string => typeof t === "string");
}

function storedAttachments(att: unknown): AttachmentMeta[] {
  if (!Array.isArray(att)) return [];
  return att.filter((x): x is AttachmentMeta => !!x && typeof x === "object");
}

// Marcadores de ActionCard nos attachments da mensagem assistant: extrai os approval_id.
function actionCardIds(att: unknown): string[] {
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

async function fetchMessages(conversationId: string): Promise<Message[]> {
  const { data, error } = await supabase
    .from("chat_messages")
    .select("id, role, content, tool_calls, attachments, model, created_at")
    .eq("conversation_id", conversationId)
    .order("created_at", { ascending: true });
  if (error) throw error;
  return (data ?? []) as Message[];
}

// Gateway ~150s pode devolver 504 enquanto a edge ainda grava a resposta (medido 20/08:
// HTTP 504 às 13:27:06 e assistant no banco às 13:27:27). Em vez de falhar na hora,
// espera breve a mensagem assistant posterior à pergunta.
async function waitAssistantAfterUser(
  conversationId: string,
  userText: string,
  sentAtMs: number,
  maxWaitMs = 45_000,
): Promise<boolean> {
  const deadline = Date.now() + maxWaitMs;
  const needle = userText.trim();
  while (Date.now() < deadline) {
    try {
      const msgs = await fetchMessages(conversationId);
      let sawUser = false;
      for (const m of msgs) {
        if (
          m.role === "user" &&
          (m.content ?? "").trim() === needle &&
          new Date(m.created_at).getTime() >= sentAtMs - 5_000
        ) {
          sawUser = true;
          continue;
        }
        if (sawUser && m.role === "assistant" && (m.content ?? "").trim()) return true;
      }
    } catch {
      /* rede transitória — tenta de novo */
    }
    await new Promise((r) => setTimeout(r, 2_500));
  }
  return false;
}

export function OperacaoChat() {
  const { selectedCompany, isAdmin } = useApp();
  const companyId = selectedCompany?.id ?? null;
  const companyName = selectedCompany?.name ?? "";
  const qc = useQueryClient();

  const [activeId, setActiveId] = useState<string | null>(null);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [attachments, setAttachments] = useState<PendingFile[]>([]);
  // Mensagem otimista do usuário, presa à conversa em que foi enviada.
  const [pending, setPending] = useState<{
    convId: string | null;
    text: string;
    attachments: AttachmentMeta[];
    profunda?: boolean;
    autoProfunda?: boolean;
  } | null>(null);
  // Resposta em construção (com as emendas de continuação) e aviso de interrupção.
  const [live, setLive] = useState<{ convId: string; text: string; continuing: number } | null>(
    null,
  );
  const [interrupted, setInterrupted] = useState(false);
  // Toggle da análise profunda e job em andamento — ambos por conversa, não globais.
  const [deepByConv, setDeepByConv] = useState<Record<string, boolean>>({});
  const [job, setJob] = useState<{ convId: string; jobId: string; texto: string } | null>(null);
  const chaveConv = activeId ?? "__nova__";
  const deepOn = !!deepByConv[chaveConv];
  const setDeepOn = (v: boolean) => setDeepByConv((m) => ({ ...m, [chaveConv]: v }));

  const threadRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const clearAttachments = () =>
    setAttachments((a) => {
      a.forEach((x) => x.url && URL.revokeObjectURL(x.url));
      return [];
    });

  // Trocar de empresa reseta a conversa aberta e o compositor.
  useEffect(() => {
    setActiveId(null);
    setPending(null);
    setInput("");
    clearAttachments();
  }, [companyId]);

  const convos = useQuery({
    queryKey: ["chat-conversations", companyId],
    enabled: !!companyId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("chat_conversations")
        .select("id, title, updated_at")
        .eq("company_id", companyId!)
        .eq("kind", "chat")
        .order("updated_at", { ascending: false });
      if (error) throw error;
      return (data ?? []) as Conversation[];
    },
  });

  // ?conv=<id> vem do link "ver a conversa que originou" no cartão de aprovação.
  // Abre a conversa uma vez e limpa o parâmetro, para não travar a navegação manual.
  const search = useSearch({ strict: false }) as { conv?: string; reco?: string };
  const navigate = useNavigate();
  const convAplicadaRef = useRef<string | null>(null);
  const recoAplicadaRef = useRef<string | null>(null);
  useEffect(() => {
    const alvo = search.conv;
    if (!alvo || convAplicadaRef.current === alvo) return;
    if (!(convos.data ?? []).some((c) => c.id === alvo)) return;
    convAplicadaRef.current = alvo;
    setActiveId(alvo);
    navigate({
      to: ".",
      search: ((prev: Record<string, unknown>) => {
        const { conv: _conv, ...resto } = prev;
        return resto;
      }) as never,
      replace: true,
    });
  }, [search.conv, convos.data, navigate]);

  const messages = useQuery({
    queryKey: ["chat-messages", activeId],
    enabled: !!activeId,
    queryFn: () => fetchMessages(activeId!),
  });

  // Pedidos de aprovação desta conversa (para renderizar os ActionCards com o
  // status ATUAL do banco, tanto ao vivo quanto ao recarregar).
  const approvals = useQuery({
    queryKey: ["approvals", "conv", activeId],
    enabled: !!activeId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("approval_requests")
        .select(APPROVAL_SELECT)
        .eq("conversation_id", activeId!);
      if (error) throw error;
      return (data ?? []) as Approval[];
    },
  });
  const approvalsById = useMemo(() => {
    const m: Record<string, Approval> = {};
    for (const a of approvals.data ?? []) m[a.id] = a;
    return m;
  }, [approvals.data]);

  const [decidingId, setDecidingId] = useState<string | null>(null);
  const onDecideApproval = async (id: string, decision: Decision, reason?: string) => {
    setDecidingId(id);
    const key = ["approvals", "conv", activeId];
    const prev = qc.getQueryData<Approval[]>(key);
    qc.setQueryData<Approval[]>(key, (old) =>
      (old ?? []).map((a) =>
        a.id === id
          ? {
              ...a,
              status: decision,
              reviewed_at: new Date().toISOString(),
              review_note: reason ?? a.review_note,
            }
          : a,
      ),
    );
    const { error } = await decideApproval(id, decision, reason);
    setDecidingId(null);
    if (error) {
      qc.setQueryData(key, prev); // reverte
      toast.error(error);
      return;
    }
    toast.success(decision === "approved" ? "Pedido aprovado" : "Pedido rejeitado");
    qc.invalidateQueries({ queryKey: ["approvals"] });
  };

  // Perguntas sem resposta por conversa (convId -> created_at da pergunta).
  // Uma consulta só: pega as mensagens recentes da empresa e fica com a última
  // de cada conversa. Alimenta tanto o indicador da lista quanto o da thread.
  const status = useQuery({
    queryKey: ["chat-status", companyId],
    enabled: !!companyId,
    queryFn: async () => {
      const desde = new Date(Date.now() - JANELA_STATUS_MS).toISOString();
      const { data, error } = await supabase
        .from("chat_messages")
        .select("conversation_id, role, created_at")
        .eq("company_id", companyId!)
        .gte("created_at", desde)
        .order("created_at", { ascending: false })
        .limit(400);
      if (error) throw error;
      const ultima = new Map<string, { role: string; created_at: string }>();
      for (const m of data ?? []) {
        if (!ultima.has(m.conversation_id)) ultima.set(m.conversation_id, m);
      }
      const pendentes: Record<string, string> = {};
      for (const [convId, m] of ultima) {
        if (m.role === "user") pendentes[convId] = m.created_at;
      }
      return pendentes;
    },
  });
  const pendentes = status.data ?? {};

  // Relógio: sem isto a idade da pergunta não seria reavaliada e o indicador
  // nunca viraria "falha" ao cruzar os 2 minutos.
  const [agora, setAgora] = useState(() => Date.now());
  const ultimaDaAtiva = messages.data?.[(messages.data?.length ?? 0) - 1];
  const precisaRelogio = Object.keys(pendentes).length > 0 || ultimaDaAtiva?.role === "user";
  useEffect(() => {
    if (!precisaRelogio) return;
    const t = setInterval(() => setAgora(Date.now()), 15_000);
    return () => clearInterval(t);
  }, [precisaRelogio]);

  // Só para a LISTA: usa o recorte de 30 min (conversa em andamento é recente).
  const idadePendente = (convId: string | null) => {
    if (!convId) return null;
    const iso = pendentes[convId];
    return iso ? agora - new Date(iso).getTime() : null;
  };

  // Realtime: um canal por empresa cobre a thread aberta E a lista (toda mensagem
  // carrega company_id), evitando um segundo canal só para a lista. Sem polling.
  useEffect(() => {
    if (!companyId) return;
    const canal = supabase
      .channel(`chat-msgs-${companyId}`)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "chat_messages",
          filter: `company_id=eq.${companyId}`,
        },
        (payload) => {
          const nova = payload.new as { conversation_id?: string };
          qc.invalidateQueries({ queryKey: ["chat-status", companyId] });
          if (nova?.conversation_id) {
            qc.invalidateQueries({ queryKey: ["chat-messages", nova.conversation_id] });
            qc.invalidateQueries({ queryKey: ["chat-conversations", companyId] });
            // A resposta do job chegou: encerra o card (o job já virou done).
            qc.invalidateQueries({ queryKey: ["chat-job-ativo", nova.conversation_id] });
            setJob((j) => (j && j.convId === nova.conversation_id ? null : j));
          }
        },
      )
      .subscribe();
    return () => {
      supabase.removeChannel(canal);
    };
  }, [companyId, qc]);

  const showPending = !!pending && pending.convId === activeId;

  // Rola para o fim quando chegam mensagens ou durante o envio.
  useEffect(() => {
    threadRef.current?.scrollTo({ top: threadRef.current.scrollHeight, behavior: "smooth" });
  }, [messages.data, showPending, sending, activeId, live]);

  // --- Auto-grow do textarea ------------------------------------------------
  const autoGrow = () => {
    const el = inputRef.current;
    if (!el) return;
    const MAX = 200; // ~8 linhas
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, MAX)}px`;
    el.style.overflowY = el.scrollHeight > MAX ? "auto" : "hidden";
  };
  useEffect(autoGrow, [input]);

  // --- Ditado por voz (engine única: MediaRecorder → transcribe-audio) ------
  // Retorna o texto, "" se vazio, ou null em erro de invoke (o hook conta 2 erros
  // seguidos para parar limpo). Loga [dictation] os erros com o corpo da resposta.
  const transcribeAudio = async (blob: Blob, mime: string): Promise<string | null> => {
    try {
      const audio_base64 = await fileToBase64(blob);
      const { data, error } = await supabase.functions.invoke<{ ok: boolean; text: string }>(
        "transcribe-audio",
        { body: { audio_base64, mime } },
      );
      if (error) {
        let body: unknown = null;
        try {
          body = await (error as { context?: Response }).context?.json?.();
        } catch {
          /* corpo não-JSON */
        }
        console.log("[dictation] erro no invoke transcribe-audio:", error.message, body);
        return null;
      }
      return data?.text?.trim() ?? "";
    } catch (e) {
      console.log("[dictation] exceção no invoke transcribe-audio:", e);
      return null;
    }
  };

  const dictation = useDictation({
    transcribe: transcribeAudio,
    onText: (full) => {
      setInput(full);
      requestAnimationFrame(() => {
        const el = inputRef.current;
        if (!el) return;
        el.selectionStart = el.selectionEnd = el.value.length;
        el.scrollTop = el.scrollHeight; // scroll acompanha o fim
      });
    },
    onLimitReached: () => toast("Limite de 10 minutos atingido."),
    onPermissionError: () =>
      toast.error("Não foi possível acessar o microfone. Verifique a permissão do navegador."),
    onTranscribeError: () => toast.error("Não consegui transcrever, tente de novo."),
  });
  const listening = dictation.state === "listening";
  const transcribing = dictation.state === "transcribing";

  const startDictation = async () => {
    try {
      await dictation.start(input);
      requestAnimationFrame(() => inputRef.current?.focus());
    } catch {
      toast.error("Não foi possível acessar o microfone. Verifique a permissão do navegador.");
    }
  };

  // --- Anexos ---------------------------------------------------------------
  const onFilesPicked = (e: React.ChangeEvent<HTMLInputElement>) => {
    const picked = Array.from(e.target.files ?? []);
    e.target.value = "";
    const next: PendingFile[] = [];
    for (const file of picked) {
      if (attachments.length + next.length >= MAX_FILES) {
        toast.error(`Máximo de ${MAX_FILES} arquivos por mensagem.`);
        break;
      }
      if (file.size > MAX_BYTES) {
        toast.error(`"${file.name}" excede 8MB.`);
        continue;
      }
      next.push({
        id: crypto.randomUUID(),
        file,
        name: file.name,
        sizeKb: Math.max(1, Math.round(file.size / 1024)),
        mime: file.type,
        url: file.type.startsWith("image/") ? URL.createObjectURL(file) : undefined,
      });
    }
    if (next.length) setAttachments((a) => [...a, ...next]);
  };

  const removeAttachment = (id: string) =>
    setAttachments((a) => {
      const found = a.find((x) => x.id === id);
      if (found?.url) URL.revokeObjectURL(found.url);
      return a.filter((x) => x.id !== id);
    });

  const newConversation = () => {
    setActiveId(null);
    setInput("");
  };

  const canSend = (input.trim().length > 0 || attachments.length > 0) && !!companyId;

  // `textoOverride` só é usado pelo reenvio de uma pergunta órfã (turno que
  // estourou os 2 min): reenvia aquele texto sem mexer no que o usuário digitou.
  const send = async (textoOverride?: string) => {
    const reenvio = typeof textoOverride === "string";
    const text = (reenvio ? textoOverride : input).trim();
    if (sending || transcribing || !companyId) return;
    if (!reenvio && !canSend) return;
    if (reenvio && !text) return;
    const convIdAtSend = activeId;
    const snapshot = reenvio ? [] : attachments;
    // Roteamento explícito: o toggle vai direto ao modo assíncrono. O automático é decidido
    // pela edge e chega como `async` na resposta — `autoProfunda` só é ligado lá.
    const profunda = deepOn;
    if (!reenvio) setInput("");
    setInterrupted(false);
    setJob(null);
    setPending({
      convId: convIdAtSend,
      text,
      attachments: snapshot.map((a) => ({ name: a.name, mime: a.mime, kb: a.sizeKb })),
      profunda,
      autoProfunda: false,
    });
    setSending(true);
    try {
      let outgoing: OutgoingAttachment[] = [];
      try {
        outgoing = await Promise.all(snapshot.map((a) => toOutgoing(a.file)));
      } catch {
        toast.error("Não consegui processar um dos anexos.");
        if (!reenvio) setInput(text);
        setPending(null);
        return; // mantém os anexos para nova tentativa
      }

      // --- Modo assíncrono: 202 em ~1s, sem reply. A resposta final chega por
      // Realtime em chat_messages; aqui só adotamos a conversa e abrimos o card.
      if (profunda) {
        const { data: jobData, error: jobErr } = await supabase.functions.invoke<ChatJobReply>(
          "traffic-agent-job",
          {
            body: {
              message: text,
              conversation_id: convIdAtSend ?? undefined,
              company: companyName,
              ...(outgoing.length ? { attachments: outgoing } : {}),
            },
          },
        );
        if (jobErr || !jobData?.job_id) {
          let msg = "Não foi possível iniciar a análise profunda. Tente novamente.";
          try {
            const body = await (jobErr as { context?: Response })?.context?.json?.();
            if (body && typeof body.error === "string") msg = body.error;
          } catch {
            /* corpo não-JSON */
          }
          toast.error(msg);
          if (!reenvio) setInput(text);
          setPending(null);
          return;
        }
        const convJob = jobData.conversation_id;
        qc.invalidateQueries({ queryKey: ["chat-conversations", companyId] });
        if (!convIdAtSend) {
          await qc.fetchQuery({
            queryKey: ["chat-messages", convJob],
            queryFn: () => fetchMessages(convJob),
          });
          setActiveId(convJob);
        } else {
          await qc.invalidateQueries({ queryKey: ["chat-messages", convJob] });
        }
        setJob({ convId: convJob, jobId: jobData.job_id, texto: text });
        setPending(null);
        clearAttachments();
        return; // NÃO há reply nem costura neste caminho
      }

      const sentAtMs = Date.now();
      const { data, error } = await supabase.functions.invoke<ChatReply>("traffic-chat", {
        body: {
          message: text,
          conversation_id: convIdAtSend ?? undefined,
          company: companyName,
          ...(outgoing.length ? { attachments: outgoing } : {}),
        },
      });
      if (error) {
        // 504 do gateway: a edge pode ter gravado (ou ainda estar gravando). Se já temos
        // conversation_id, espera a resposta no banco antes de declarar falha.
        let recovered = false;
        if (convIdAtSend) {
          recovered = await waitAssistantAfterUser(convIdAtSend, text, sentAtMs);
        }
        if (recovered && convIdAtSend) {
          clearAttachments();
          qc.invalidateQueries({ queryKey: ["chat-conversations", companyId] });
          qc.invalidateQueries({ queryKey: ["approvals"] });
          await qc.invalidateQueries({ queryKey: ["chat-messages", convIdAtSend] });
          // Pode ter gravado checkpoint + "continuando…": retoma sem o gestor clicar Reenviar.
          // v28.38: so se continuar=true de verdade; para se ja houver 2 assistants substantivos.
          setLive({ convId: convIdAtSend, text: "continuando a resposta…", continuing: 1 });
          let contFinish = true;
          for (let n = 1; n <= MAX_CONTINUATIONS && contFinish; n++) {
            try {
              const msgsNow = await fetchMessages(convIdAtSend);
              if (countSubstantiveAssistantsSinceLastUser(msgsNow) >= 2) break;
            } catch {
              /* rede — segue com a flag da edge */
            }
            setLive({ convId: convIdAtSend, text: "continuando a resposta…", continuing: n });
            const { data: more, error: contErr } = await supabase.functions.invoke<ChatReply>(
              "traffic-chat",
              { body: { continuar: true, conversation_id: convIdAtSend, company: companyName } },
            );
            if (contErr || !more || more.aviso === "sem_checkpoint") {
              contFinish = false;
              break;
            }
            contFinish = needsAutoContinue(more) && !looksLikeCompleteTurn(more.reply ?? "");
            await qc.invalidateQueries({ queryKey: ["chat-messages", convIdAtSend] });
            qc.invalidateQueries({ queryKey: ["approvals"] });
          }
          setLive(null);
          setPending(null);
          return;
        }
        let msg = "Não foi possível obter resposta agora. Tente novamente.";
        try {
          const body = await (error as { context?: Response }).context?.json?.();
          if (body && typeof body.error === "string") msg = body.error;
        } catch {
          /* corpo não-JSON */
        }
        toast.error(msg);
        if (!reenvio) setInput(text);
        setPending(null);
        return;
      }

      // A edge encaminhou o pedido para a rota assíncrona: não há `reply` nem costura a
      // fazer. Adotamos a conversa e abrimos o MESMO card de progresso da análise profunda —
      // o veredito continua sendo o de `chat_jobs` (GT-16), sem relógio nesta tela.
      if (data?.async && data.job_id) {
        const convJob = data.conversation_id;
        setPending((p) => (p ? { ...p, autoProfunda: true } : p));
        qc.invalidateQueries({ queryKey: ["chat-conversations", companyId] });
        if (!convIdAtSend) {
          await qc.fetchQuery({
            queryKey: ["chat-messages", convJob],
            queryFn: () => fetchMessages(convJob),
          });
          setActiveId(convJob);
        } else {
          await qc.invalidateQueries({ queryKey: ["chat-messages", convJob] });
        }
        setJob({ convId: convJob, jobId: data.job_id, texto: text });
        setPending(null);
        clearAttachments();
        return;
      }

      const convId = data!.conversation_id;
      clearAttachments();

      // Resposta longa (finish_reason=length) OU turno com checkpoint (continuar=true):
      // cada HTTP fica sob ~150s; o cliente emenda / retoma sem o gestor clicar Reenviar.
      // v28.38: ignora continuar se a 1a reply ja fechou o turno (clarificacao/decisao).
      let acc = data!.reply ?? "";
      let finish = data!.finish_reason;
      let autoCont = needsAutoContinue(data) && !looksLikeCompleteTurn(acc);
      if (isTruncated(finish) || autoCont) setLive({ convId, text: acc || "continuando a resposta…", continuing: 0 });

      for (let n = 1; n <= MAX_CONTINUATIONS && (isTruncated(finish) || autoCont); n++) {
        if (autoCont) {
          try {
            const msgsNow = await fetchMessages(convId);
            if (countSubstantiveAssistantsSinceLastUser(msgsNow) >= 2) break;
          } catch {
            /* rede — segue com a flag da edge */
          }
        }
        setLive({ convId, text: acc || "continuando a resposta…", continuing: n });
        const bodyCont = autoCont
          ? { continuar: true, conversation_id: convId, company: companyName }
          : { message: CONTINUE_PROMPT, conversation_id: convId, company: companyName };
        const { data: more, error: contErr } = await supabase.functions.invoke<ChatReply>(
          "traffic-chat",
          { body: bodyCont },
        );
        if (contErr || !more) {
          // Nunca descarta o que já veio: o texto recebido já está gravado no banco.
          setInterrupted(true);
          break;
        }
        if (more.aviso === "sem_checkpoint") break;
        const piece = (more.reply ?? "").trim();
        if (piece && autoCont) {
          // Segmentos de checkpoint: cada um já é mensagem assistant no banco;
          // na bolha live só mostramos progresso + último trecho.
          acc = acc ? `${acc}\n\n${piece}` : piece;
        } else if (piece) {
          acc = `${acc}\n${piece}`;
        }
        finish = more.finish_reason;
        autoCont = needsAutoContinue(more) && !looksLikeCompleteTurn(more.reply ?? "");
        setLive({ convId, text: acc || "continuando a resposta…", continuing: n });
        // Cards podem ter saído no segmento — atualiza a fila sem esperar o fim.
        if (autoCont || (more.tools_used?.length ?? 0) > 0) {
          qc.invalidateQueries({ queryKey: ["approvals"] });
          await qc.invalidateQueries({ queryKey: ["chat-messages", convId] });
        }
      }

      qc.invalidateQueries({ queryKey: ["chat-conversations", companyId] });
      qc.invalidateQueries({ queryKey: ["approvals"] });
      if (convIdAtSend) {
        await qc.invalidateQueries({ queryKey: ["chat-messages", convId] });
      } else {
        await qc.fetchQuery({
          queryKey: ["chat-messages", convId],
          queryFn: () => fetchMessages(convId),
        });
        setActiveId(convId);
      }
      setPending(null);
      setLive(null); // as mensagens canônicas do banco assumem a partir daqui
    } catch {
      toast.error("Erro de conexão. Tente novamente.");
      if (!reenvio) setInput(text);
      setPending(null);
      setLive(null);
    } finally {
      setSending(false);
    }
  };

  // ?reco=<id> vem do botao Chat no card de recomendacao: abre conversa NOVA e
  // envia automaticamente o suggested_prompt (ou title+description) como primeira mensagem.
  useEffect(() => {
    const recoId = search.reco;
    if (!recoId || !companyId || sending) return;
    if (recoAplicadaRef.current === recoId) return;
    let cancelled = false;
    (async () => {
      const { data, error } = await supabase
        .from("ai_recommendations")
        .select("id, title, description, suggested_prompt, evidence_json, entity_name, signal_key")
        .eq("id", recoId)
        .eq("company_id", companyId)
        .maybeSingle();
      if (cancelled) return;
      if (error || !data) {
        toast.error("Não encontrei a recomendação para abrir no chat.");
        recoAplicadaRef.current = recoId;
        navigate({
          to: ".",
          // tab/reco vivem na URL da rota Operação; o search tipado do router
          // raiz não os declara — cast local evita mentir no tipo global.
          search: ((prev: Record<string, unknown>) => {
            const { reco: _r, ...resto } = prev;
            return { ...resto, tab: "chat" };
          }) as never,
          replace: true,
        });
        return;
      }
      const prompt =
        (data.suggested_prompt && String(data.suggested_prompt).trim()) ||
        `Quero discutir esta recomendação da IA:\n\nTítulo: ${data.title}\n\n${data.description}\n\nO que você propõe com base nas evidências?`;
      recoAplicadaRef.current = recoId;
      setActiveId(null);
      navigate({
        to: ".",
        search: ((prev: Record<string, unknown>) => {
          const { reco: _r, ...resto } = prev;
          return { ...resto, tab: "chat" };
        }) as never,
        replace: true,
      });
      await send(prompt);
    })();
    return () => {
      cancelled = true;
    };
    // send e estavel o suficiente no fluxo; evitamos reabrir o mesmo reco.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search.reco, companyId]);

  // Reenvia a última pergunta que ficou sem resposta (turno estourado).
  const reenviarOrfa = () => {
    const ultimaUser = [...msgs].reverse().find((m) => m.role === "user");
    const texto = (ultimaUser?.content ?? "").trim();
    if (!texto) {
      toast.error("Não encontrei o texto da pergunta para reenviar.");
      return;
    }
    send(texto);
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      send();
    }
  };

  const conversations = convos.data ?? [];

  // O backend grava cada pedaço de uma resposta longa como uma mensagem assistant
  // separada. Mescla visualmente as consecutivas em janela de 3 min numa bolha só,
  // igual ao que o usuário viu enquanto a resposta era costurada.
  const msgs = useMemo(() => {
    const src = messages.data ?? [];
    const out: Message[] = [];
    for (const m of src) {
      const prev = out[out.length - 1];
      const near =
        prev &&
        prev.role === "assistant" &&
        m.role === "assistant" &&
        new Date(m.created_at).getTime() - new Date(prev.created_at).getTime() < 3 * 60 * 1000;
      if (near) {
        out[out.length - 1] = {
          ...prev,
          content: `${prev.content ?? ""}\n${m.content ?? ""}`,
          tool_calls: [
            ...(Array.isArray(prev.tool_calls) ? prev.tool_calls : []),
            ...(Array.isArray(m.tool_calls) ? m.tool_calls : []),
          ],
          attachments: [
            ...(Array.isArray(prev.attachments) ? prev.attachments : []),
            ...(Array.isArray(m.attachments) ? m.attachments : []),
          ],
          model: m.model ?? prev.model,
          created_at: m.created_at,
        };
      } else {
        out.push(m);
      }
    }
    return out;
  }, [messages.data]);

  // Estado da conversa ABERTA: derivado das mensagens carregadas (não do recorte
  // de 30 min da lista) — assim uma conversa órfã antiga também é reconhecida ao
  // ser aberta, mostrando falha em vez de "analisando" para sempre.
  const ultimaMsg = msgs[msgs.length - 1];
  const idadeAtiva =
    ultimaMsg && ultimaMsg.role === "user"
      ? agora - new Date(ultimaMsg.created_at).getTime()
      : null;
  const processandoAtiva = idadeAtiva !== null && idadeAtiva < TIMEOUT_TURNO_MS;
  const falhouAtiva = idadeAtiva !== null && idadeAtiva >= TIMEOUT_TURNO_MS;
  // Sem resposta do assistente depois da última pergunta: é o que delimita até quando faz
  // sentido mostrar o desfecho de um job. Chegou resposta, o card sai de cena.
  const aguardandoResposta = idadeAtiva !== null;
  // Resposta real no fio (não stub de erro_job): o card de falha não fica permanente se o
  // turno já entregou texto — inclusive após rate-limit transitório com reply no banco.
  const respostaRealJaChegou = hasSubstantiveReplyAfterLastUser(msgs);
  const soStubDeFalha =
    !!ultimaMsg &&
    ultimaMsg.role === "assistant" &&
    isJobFailureStub(ultimaMsg.content ?? "");

  // Job de análise profunda desta conversa. Vem do state (quem enviou) ou do banco (quem só
  // abriu a conversa / voltou depois) — mesmo princípio do indicador síncrono: o estado é
  // derivado, não presumido.
  // GT-16: 'error' entra na busca. Sem ele, job marcado pelo `expira-chat-jobs` sumia do card
  // ao reabrir a conversa e caía no aviso genérico de 2 min abaixo, que atribui a falha ao
  // "limite de tempo do servidor" — motivo inventado, quando o banco tem o motivo real.
  // Stub de falha (última msg): ainda mostra card error+Reenviar. Resposta substantiva:
  // card some mesmo se chat_jobs.status=error (falso negativo na tela).
  const jobDb = useQuery({
    queryKey: ["chat-job-ativo", activeId],
    enabled: !!activeId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("chat_jobs")
        .select("id, message, status")
        .eq("conversation_id", activeId!)
        .in("status", ["queued", "running", "error"])
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (error) throw error;
      return data;
    },
  });
  const jobAtivo = respostaRealJaChegou
    ? null
    : job && job.convId === activeId
      ? job
      : jobDb.data &&
          (jobDb.data.status !== "error" || aguardandoResposta || soStubDeFalha)
        ? { convId: activeId!, jobId: jobDb.data.id, texto: jobDb.data.message ?? "" }
        : null;

  // Com o Realtime, a pergunta gravada pela edge chega à thread durante o envio.
  // Sem isto, a bolha otimista apareceria duplicada com a do banco.
  const pendingNoBanco =
    !!pending &&
    msgs.some((m) => m.role === "user" && (m.content ?? "").trim() === pending.text.trim());

  const ConversationList = ({ onPick }: { onPick?: () => void }) => (
    <div className="flex flex-col gap-1">
      {convos.isLoading && [0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-9 w-full" />)}
      {!convos.isLoading && conversations.length === 0 && (
        <div className="px-2 py-3 text-xs text-muted-foreground">Nenhuma conversa ainda.</div>
      )}
      {conversations.map((c) => (
        <button
          key={c.id}
          type="button"
          onClick={() => {
            setActiveId(c.id);
            onPick?.();
          }}
          className={cn(
            "w-full truncate rounded-md px-2 py-2 text-left text-sm transition-colors",
            c.id === activeId
              ? "bg-sidebar-accent text-sidebar-accent-foreground"
              : "text-foreground/80 hover:bg-muted",
          )}
          title={c.title ?? "Conversa sem título"}
        >
          <div className="flex items-center gap-1.5">
            <span className="min-w-0 flex-1 truncate">{c.title ?? "Conversa sem título"}</span>
            {/* 3.5: torna visível, de fora da conversa, que há um turno em andamento. */}
            {(() => {
              const idade = idadePendente(c.id);
              if (idade === null) return null;
              return idade < TIMEOUT_TURNO_MS ? (
                <Loader2
                  className="h-3 w-3 shrink-0 animate-spin text-primary"
                  aria-label="Processando"
                />
              ) : (
                <span
                  className="h-1.5 w-1.5 shrink-0 rounded-full bg-destructive"
                  aria-label="Sem resposta"
                />
              );
            })()}
          </div>
          <div className="truncate text-[11px] text-muted-foreground">{fmtWhen(c.updated_at)}</div>
        </button>
      ))}
    </div>
  );

  return (
    <div className="flex h-[calc(100vh-16rem)] min-h-[420px] max-w-full overflow-hidden rounded-lg border border-border">
      {/* Sidebar de conversas (md+) */}
      <aside className="hidden w-64 shrink-0 flex-col border-r border-border md:flex">
        <div className="border-b border-border p-2">
          <Button size="sm" className="w-full" onClick={newConversation}>
            <Plus className="mr-1 h-4 w-4" />
            Nova conversa
          </Button>
        </div>
        <div className="flex-1 overflow-y-auto overflow-x-hidden p-2">
          <ConversationList />
        </div>
      </aside>

      {/* Coluna direita: thread + input */}
      <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
        {/* Controle mobile: dropdown de conversa + nova */}
        <div className="flex items-center gap-2 border-b border-border p-2 md:hidden">
          <Select value={activeId ?? ""} onValueChange={(v) => setActiveId(v)}>
            <SelectTrigger className="h-9 flex-1">
              <SelectValue placeholder="Selecione uma conversa" />
            </SelectTrigger>
            <SelectContent>
              {conversations.map((c) => (
                <SelectItem key={c.id} value={c.id}>
                  {c.title ?? "Conversa sem título"}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button
            size="icon"
            variant="outline"
            onClick={newConversation}
            aria-label="Nova conversa"
          >
            <Plus className="h-4 w-4" />
          </Button>
        </div>

        {/* Thread — só scroll vertical; conteúdo largo fica contido nas bolhas */}
        <div ref={threadRef} className="chat-thread flex-1 overflow-y-auto overflow-x-hidden p-4">
          {!activeId && !showPending ? (
            <div className="flex h-full flex-col items-center justify-center text-center text-muted-foreground">
              <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-primary/15 text-primary">
                <MessagesSquare className="h-6 w-6" />
              </div>
              <div className="mt-3 font-medium text-foreground">
                Converse com o gestor de tráfego
              </div>
              <p className="mx-auto mt-1 max-w-sm text-sm">
                Pergunte sobre metas, gastos e campanhas — por texto, voz ou anexando um print, PDF
                ou planilha de {selectedCompany?.name ?? "sua empresa"}.
              </p>
            </div>
          ) : (
            <div className="mx-auto flex w-full min-w-0 max-w-3xl flex-col gap-4">
              {messages.isLoading &&
                activeId &&
                [0, 1].map((i) => <Skeleton key={i} className="h-20 w-full" />)}

              {msgs.map((m) => (
                <MessageBubble
                  key={m.id}
                  message={m}
                  approvalsById={approvalsById}
                  isAdmin={isAdmin}
                  decidingId={decidingId}
                  onDecide={onDecideApproval}
                />
              ))}

              {showPending && !pendingNoBanco && (
                <div className="flex justify-end">
                  <div className="max-w-[min(85%,100%)] min-w-0 space-y-1 break-words rounded-lg bg-primary px-3 py-2 text-sm text-primary-foreground">
                    {pending!.attachments.length > 0 && (
                      <AttachmentChips items={pending!.attachments} onPrimary />
                    )}
                    {pending!.text && (
                      <div className="whitespace-pre-wrap break-words">{pending!.text}</div>
                    )}
                    {/* Só quando o roteamento foi automático: explica por que não
                        veio resposta imediata. Com o toggle ligado o usuário já sabe.
                        Texto neutro de propósito: aqui o gestor NÃO pediu análise
                        profunda, quem encaminhou foi a edge. */}
                    {pending!.autoProfunda && (
                      <div className="flex items-center gap-1 pt-0.5 text-[11px] opacity-80">
                        <Microscope className="h-3 w-3" />
                        preparando resposta completa
                      </div>
                    )}
                  </div>
                </div>
              )}

              {/* Resposta longa sendo costurada: uma bolha só que cresce. */}
              {live && (
                <div className="flex min-w-0 gap-2">
                  <div className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-primary/15 text-primary">
                    <Bot className="h-4 w-4" />
                  </div>
                  <div className="min-w-0 flex-1 overflow-hidden">
                    <div className="max-w-full break-words rounded-lg bg-muted px-3 py-2 [overflow-wrap:anywhere]">
                      <Markdown>{live.text}</Markdown>
                    </div>
                    {live.continuing > 0 && (
                      <div className="mt-1 flex items-center gap-1.5 text-[11px] text-muted-foreground">
                        <Loader2 className="h-3 w-3 animate-spin" />
                        continuando a resposta… ({live.continuing}/{MAX_CONTINUATIONS})
                      </div>
                    )}
                  </div>
                </div>
              )}

              {/* Indicador derivado do banco: aparece também para quem apenas ABRIU
                  a conversa (outra aba, volta de navegação, F5) — não só para quem enviou. */}
              {/* Análise profunda: o card de progresso ocupa o lugar do indicador
                  síncrono. Some sozinho quando o job termina (a mensagem final
                  chega pelo Realtime de chat_messages). */}
              {jobAtivo && (
                <JobProgressCard
                  jobId={jobAtivo.jobId}
                  onDone={() => {
                    setJob(null);
                    // O job terminou: busca a resposta no banco em vez de esperar o Realtime
                    // de chat_messages. Se aquele evento se perdesse, o turno ficaria sem
                    // resposta na tela mesmo tendo concluído no servidor.
                    void qc.invalidateQueries({ queryKey: ["chat-messages", jobAtivo.convId] });
                    void qc.invalidateQueries({ queryKey: ["chat-job-ativo", jobAtivo.convId] });
                  }}
                  onResend={() => {
                    setJob(null);
                    send(jobAtivo.texto);
                  }}
                />
              )}

              {!jobAtivo && ((sending && showPending) || processandoAtiva) && !live && (
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                  <Bot className="h-4 w-4 text-primary" />
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  Analisando os dados…
                </div>
              )}

              {/* GT-16: `!jobAtivo` é obrigatório aqui. Este aviso é do caminho SÍNCRONO;
                  sem a guarda ele aparecia embaixo do card de progresso aos 2 min, dizendo que
                  o turno não foi concluído enquanto o card girava logo acima — e job longo é
                  normal: dos 15 jobs medidos em 05/08, 6 passaram de 180 s.
                  Com auto-continuação (live/sending), NÃO mostrar o card de timeout. */}
              {falhouAtiva && !jobAtivo && !sending && !live && (
                <div className="rounded-md border border-destructive/40 bg-destructive/10 p-3">
                  <div className="text-sm font-medium">A resposta não chegou</div>
                  <p className="mt-1 text-xs text-muted-foreground">
                    A pergunta foi enviada há mais de 2 minutos e o turno não foi concluído
                    (o servidor corta perto desse orçamento; o gateway da plataforma fica em
                    torno de 2,5 min). Nada foi perdido: reenviar refaz a pergunta nesta mesma
                    conversa — para dicas da Meta, uma pergunta só sobre isso costuma responder
                    mais rápido.
                  </p>
                  <Button
                    size="sm"
                    variant="outline"
                    className="mt-2"
                    onClick={() => reenviarOrfa()}
                  >
                    <RefreshCw className="mr-1 h-3.5 w-3.5" />
                    Reenviar pergunta
                  </Button>
                </div>
              )}

              {interrupted && !sending && (
                <div className="text-xs text-muted-foreground">
                  A resposta foi interrompida. Peça “continue” para retomar.
                </div>
              )}
            </div>
          )}
        </div>

        {/* Compositor */}
        <div className="shrink-0 border-t border-border p-3">
          <div className="mx-auto w-full min-w-0 max-w-3xl space-y-2">
            {/* Anexos pendentes */}
            {attachments.length > 0 && !sending && (
              <div className="flex flex-wrap gap-2">
                {attachments.map((a) => {
                  const Icon = ICON_BY_KIND[kindFromMime(a.mime, a.name)];
                  return (
                    <span
                      key={a.id}
                      className="inline-flex items-center gap-1.5 rounded-md border border-border bg-muted py-1 pl-1.5 pr-1 text-xs"
                    >
                      {a.url ? (
                        <img src={a.url} alt="" className="h-6 w-6 rounded object-cover" />
                      ) : (
                        <Icon className="h-4 w-4 text-muted-foreground" />
                      )}
                      <span className="max-w-[160px] truncate">{a.name}</span>
                      <span className="text-muted-foreground">{a.sizeKb}KB</span>
                      <button
                        type="button"
                        onClick={() => removeAttachment(a.id)}
                        className="rounded p-0.5 hover:bg-background"
                        aria-label={`Remover ${a.name}`}
                      >
                        <X className="h-3.5 w-3.5" />
                      </button>
                    </span>
                  );
                })}
              </div>
            )}

            {/* Faixa compacta de gravação — ACIMA do textarea, não o substitui. */}
            {listening && (
              <div className="flex items-center gap-3 rounded-md border border-border bg-muted/40 px-2 py-1.5">
                <MicWaveform analyser={dictation.analyser} />
                <span className="text-sm font-medium tabular-nums text-destructive">
                  {fmtDuration(dictation.elapsedMs)}
                </span>
                <span className="hidden text-xs text-muted-foreground sm:inline">Ouvindo…</span>
                <div className="ml-auto flex gap-2">
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={dictation.cancel}
                    aria-label="Cancelar gravação"
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                  <Button size="sm" onClick={dictation.stop}>
                    <Square className="mr-1 h-4 w-4" />
                    Parar
                  </Button>
                </div>
              </div>
            )}

            {/* Linha do input — SEMPRE visível (read-only durante a gravação). */}
            <div className="flex items-end gap-2">
              <input
                ref={fileInputRef}
                type="file"
                accept={ACCEPT}
                multiple
                className="hidden"
                onChange={onFilesPicked}
              />
              <Button
                size="icon"
                variant="ghost"
                className="h-[42px] w-[42px] shrink-0"
                onClick={() => fileInputRef.current?.click()}
                disabled={
                  sending ||
                  transcribing ||
                  listening ||
                  !companyId ||
                  attachments.length >= MAX_FILES
                }
                aria-label="Anexar arquivo"
              >
                <Paperclip className="h-4 w-4" />
              </Button>
              <Button
                size="icon"
                variant="ghost"
                className="h-[42px] w-[42px] shrink-0"
                onClick={startDictation}
                disabled={sending || transcribing || listening || !companyId}
                aria-label="Falar (transcrição por voz)"
              >
                {transcribing ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Mic className="h-4 w-4" />
                )}
              </Button>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    size="icon"
                    variant={deepOn ? "default" : "ghost"}
                    className="h-[42px] w-[42px] shrink-0"
                    onClick={() => setDeepOn(!deepOn)}
                    disabled={sending || transcribing || listening || !companyId}
                    aria-pressed={deepOn}
                    aria-label="Análise profunda"
                  >
                    <Microscope className="h-4 w-4" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent className="max-w-[260px] text-left">
                  Análise profunda: vários especialistas em paralelo; demora mais, responde completo
                  de uma vez.
                </TooltipContent>
              </Tooltip>
              <Textarea
                ref={inputRef}
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={onKeyDown}
                readOnly={listening}
                disabled={sending || transcribing || !companyId}
                placeholder={
                  listening
                    ? "Transcrevendo…"
                    : transcribing
                      ? "Transcrevendo áudio…"
                      : "Pergunte algo… (Enter envia, Shift+Enter quebra linha)"
                }
                rows={1}
                className="chat-scroll min-h-[42px] resize-none overflow-y-hidden"
              />
              <Button
                onClick={() => send()}
                disabled={!canSend || sending || transcribing || listening}
                size="icon"
                className="h-[42px] w-[42px] shrink-0"
                aria-label="Enviar"
              >
                {sending ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Send className="h-4 w-4" />
                )}
              </Button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// Ondas sonoras (estilo Claude). Lê o AnalyserNode via rAF e ajusta a altura das
// barras mutando o DOM — não dispara re-render do chat a cada frame.
function MicWaveform({ analyser }: { analyser: AnalyserNode | null }) {
  const barsRef = useRef<Array<HTMLSpanElement | null>>([]);
  useEffect(() => {
    if (!analyser) return;
    const data = new Uint8Array(analyser.frequencyBinCount);
    const N = 6;
    let raf = 0;
    const loop = () => {
      analyser.getByteFrequencyData(data);
      for (let i = 0; i < N; i++) {
        const start = Math.floor((i * data.length) / N);
        const end = Math.floor(((i + 1) * data.length) / N);
        let sum = 0;
        for (let j = start; j < end; j++) sum += data[j];
        const avg = sum / Math.max(1, end - start) / 255;
        const el = barsRef.current[i];
        if (el) el.style.height = `${Math.round(15 + avg * 85)}%`;
      }
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [analyser]);

  return (
    <div className="flex h-8 items-center gap-0.5" aria-hidden>
      {Array.from({ length: 6 }).map((_, i) => (
        <span
          key={i}
          ref={(el) => {
            barsRef.current[i] = el;
          }}
          className="w-1 rounded-full bg-destructive"
          style={{ height: "15%" }}
        />
      ))}
    </div>
  );
}

function AttachmentChips({ items, onPrimary }: { items: AttachmentMeta[]; onPrimary?: boolean }) {
  if (!items.length) return null;
  return (
    <div className="flex flex-wrap gap-1">
      {items.map((a, i) => {
        const Icon = ICON_BY_KIND[kindFromMime(a.mime, a.name)];
        return (
          <span
            key={i}
            className={cn(
              "inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-[11px]",
              onPrimary
                ? "border-primary-foreground/25 bg-primary-foreground/10"
                : "border-border bg-background",
            )}
          >
            <Icon className="h-3 w-3" />
            <span className="max-w-[160px] truncate">{a.name ?? "arquivo"}</span>
            {a.kb ? <span className="opacity-70">{a.kb}KB</span> : null}
          </span>
        );
      })}
    </div>
  );
}

function MessageBubble({
  message,
  approvalsById,
  isAdmin,
  decidingId,
  onDecide,
}: {
  message: Message;
  approvalsById: Record<string, Approval>;
  isAdmin: boolean;
  decidingId: string | null;
  onDecide: (id: string, decision: Decision, reason?: string) => void;
}) {
  const isUser = message.role === "user";
  const tools = toolNames(message.tool_calls);
  const files = storedAttachments(message.attachments);
  const cardIds = isUser ? [] : actionCardIds(message.attachments);

  if (isUser) {
    return (
      <div className="flex min-w-0 justify-end">
        <div className="max-w-[min(85%,100%)] min-w-0 space-y-1 break-words rounded-lg bg-primary px-3 py-2 text-sm text-primary-foreground">
          {files.length > 0 && <AttachmentChips items={files} onPrimary />}
          {message.content && (
            <div className="whitespace-pre-wrap break-words [overflow-wrap:anywhere]">
              {message.content}
            </div>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-w-0 gap-2">
      <div className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-primary/15 text-primary">
        <Bot className="h-4 w-4" />
      </div>
      <div className="min-w-0 flex-1 overflow-hidden">
        <div className="max-w-full break-words rounded-lg bg-muted px-3 py-2 [overflow-wrap:anywhere]">
          <Markdown>{message.content ?? ""}</Markdown>
        </div>
        {cardIds.length > 0 && (
          <div className="mt-2 max-w-full space-y-2">
            {cardIds.map((id) => {
              const ap = approvalsById[id];
              return ap ? (
                <ActionCard
                  key={id}
                  approval={ap}
                  isAdmin={isAdmin}
                  deciding={decidingId === id}
                  onDecide={onDecide}
                />
              ) : null;
            })}
          </div>
        )}
        {(tools.length > 0 || message.model) && (
          <div className="mt-1 flex max-w-full flex-wrap items-center gap-1">
            {tools.map((t, i) => (
              <Badge
                key={`${t}-${i}`}
                variant="outline"
                className="h-5 max-w-full px-1.5 text-[11px] font-normal"
              >
                <span className="truncate">{t}</span>
              </Badge>
            ))}
            {message.model && (
              <span className="ml-1 truncate text-[11px] text-muted-foreground">
                {message.model}
              </span>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
