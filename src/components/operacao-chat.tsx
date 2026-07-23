import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  Plus,
  Send,
  Bot,
  Loader2,
  MessagesSquare,
  Mic,
  Paperclip,
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
import { ActionCard, decideApproval, type Approval, type Decision } from "@/components/action-card";
import { APPROVAL_SELECT } from "@/components/approvals-queue";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
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
};

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
  } | null>(null);

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

  const showPending = !!pending && pending.convId === activeId;

  // Rola para o fim quando chegam mensagens ou durante o envio.
  useEffect(() => {
    threadRef.current?.scrollTo({ top: threadRef.current.scrollHeight, behavior: "smooth" });
  }, [messages.data, showPending, sending, activeId]);

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

  const send = async () => {
    const text = input.trim();
    if (!canSend || sending || transcribing) return;
    const convIdAtSend = activeId;
    const snapshot = attachments;
    setInput("");
    setPending({
      convId: convIdAtSend,
      text,
      attachments: snapshot.map((a) => ({ name: a.name, mime: a.mime, kb: a.sizeKb })),
    });
    setSending(true);
    try {
      let outgoing: OutgoingAttachment[] = [];
      try {
        outgoing = await Promise.all(snapshot.map((a) => toOutgoing(a.file)));
      } catch {
        toast.error("Não consegui processar um dos anexos.");
        setInput(text);
        setPending(null);
        return; // mantém os anexos para nova tentativa
      }

      const { data, error } = await supabase.functions.invoke<ChatReply>("traffic-chat", {
        body: {
          message: text,
          conversation_id: convIdAtSend ?? undefined,
          company: companyName,
          ...(outgoing.length ? { attachments: outgoing } : {}),
        },
      });
      if (error) {
        let msg = "Não foi possível obter resposta agora. Tente novamente.";
        try {
          const body = await (error as { context?: Response }).context?.json?.();
          if (body && typeof body.error === "string") msg = body.error;
        } catch {
          /* corpo não-JSON */
        }
        toast.error(msg);
        setInput(text);
        setPending(null);
        return;
      }

      const convId = data!.conversation_id;
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
      clearAttachments();
    } catch {
      toast.error("Erro de conexão. Tente novamente.");
      setInput(text);
      setPending(null);
    } finally {
      setSending(false);
    }
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      send();
    }
  };

  const conversations = convos.data ?? [];
  const msgs = messages.data ?? [];

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
          <div className="truncate">{c.title ?? "Conversa sem título"}</div>
          <div className="truncate text-[11px] text-muted-foreground">{fmtWhen(c.updated_at)}</div>
        </button>
      ))}
    </div>
  );

  return (
    <div className="flex h-[calc(100vh-16rem)] min-h-[420px] gap-4 rounded-lg border border-border">
      {/* Sidebar de conversas (md+) */}
      <aside className="hidden w-64 shrink-0 flex-col border-r border-border md:flex">
        <div className="border-b border-border p-2">
          <Button size="sm" className="w-full" onClick={newConversation}>
            <Plus className="mr-1 h-4 w-4" />
            Nova conversa
          </Button>
        </div>
        <div className="flex-1 overflow-y-auto p-2">
          <ConversationList />
        </div>
      </aside>

      {/* Coluna direita: thread + input */}
      <div className="flex min-w-0 flex-1 flex-col">
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

        {/* Thread */}
        <div ref={threadRef} className="flex-1 overflow-y-auto p-4">
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
            <div className="mx-auto flex max-w-3xl flex-col gap-4">
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

              {showPending && (
                <div className="flex justify-end">
                  <div className="max-w-[85%] space-y-1 rounded-lg bg-primary px-3 py-2 text-sm text-primary-foreground">
                    {pending!.attachments.length > 0 && (
                      <AttachmentChips items={pending!.attachments} onPrimary />
                    )}
                    {pending!.text && <div className="whitespace-pre-wrap">{pending!.text}</div>}
                  </div>
                </div>
              )}

              {sending && showPending && (
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                  <Bot className="h-4 w-4 text-primary" />
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  Analisando os dados…
                </div>
              )}
            </div>
          )}
        </div>

        {/* Compositor */}
        <div className="border-t border-border p-3">
          <div className="mx-auto max-w-3xl space-y-2">
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
                onClick={send}
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
      <div className="flex justify-end">
        <div className="max-w-[85%] space-y-1 rounded-lg bg-primary px-3 py-2 text-sm text-primary-foreground">
          {files.length > 0 && <AttachmentChips items={files} onPrimary />}
          {message.content && <div className="whitespace-pre-wrap">{message.content}</div>}
        </div>
      </div>
    );
  }

  return (
    <div className="flex gap-2">
      <div className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-primary/15 text-primary">
        <Bot className="h-4 w-4" />
      </div>
      <div className="min-w-0 flex-1">
        <div className="rounded-lg bg-muted px-3 py-2">
          <Markdown>{message.content ?? ""}</Markdown>
        </div>
        {cardIds.length > 0 && (
          <div className="mt-2 space-y-2">
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
          <div className="mt-1 flex flex-wrap items-center gap-1">
            {tools.map((t, i) => (
              <Badge
                key={`${t}-${i}`}
                variant="outline"
                className="h-5 px-1.5 text-[11px] font-normal"
              >
                {t}
              </Badge>
            ))}
            {message.model && (
              <span className="ml-1 text-[11px] text-muted-foreground">{message.model}</span>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
