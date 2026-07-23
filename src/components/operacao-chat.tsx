import { useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Plus, Send, Bot, Loader2, MessagesSquare } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useApp } from "@/lib/app-context";
import { Markdown } from "@/components/markdown";
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
  model: string | null;
  created_at: string;
};

type ChatReply = {
  ok: boolean;
  conversation_id: string;
  reply: string;
  tools_used?: string[];
  tokens_in?: number;
  tokens_out?: number;
};

const fmtWhen = (iso: string) =>
  new Date(iso).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" });

// Normaliza as tools para chips: histórico grava tool_calls = [{ tool, args }];
// a edge ao vivo devolve tools_used: string[]. Só o histórico chega aqui (refetch).
function toolNames(toolCalls: unknown): string[] {
  if (!Array.isArray(toolCalls)) return [];
  return toolCalls
    .map((t) => (t && typeof t === "object" ? (t as { tool?: string }).tool : undefined))
    .filter((t): t is string => typeof t === "string");
}

async function fetchMessages(conversationId: string): Promise<Message[]> {
  const { data, error } = await supabase
    .from("chat_messages")
    .select("id, role, content, tool_calls, model, created_at")
    .eq("conversation_id", conversationId)
    .order("created_at", { ascending: true });
  if (error) throw error;
  return (data ?? []) as Message[];
}

export function OperacaoChat() {
  const { selectedCompany } = useApp();
  const companyId = selectedCompany?.id ?? null;
  const companyName = selectedCompany?.name ?? "";
  const qc = useQueryClient();

  const [activeId, setActiveId] = useState<string | null>(null);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  // Mensagem otimista do usuário, presa à conversa em que foi enviada.
  const [pending, setPending] = useState<{ convId: string | null; text: string } | null>(null);
  const threadRef = useRef<HTMLDivElement>(null);

  // Trocar de empresa reseta a conversa aberta.
  useEffect(() => {
    setActiveId(null);
    setPending(null);
    setInput("");
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

  const showPending = !!pending && pending.convId === activeId;

  // Rola para o fim quando chegam mensagens ou durante o envio.
  useEffect(() => {
    threadRef.current?.scrollTo({ top: threadRef.current.scrollHeight, behavior: "smooth" });
  }, [messages.data, showPending, sending, activeId]);

  const newConversation = () => {
    setActiveId(null);
    setInput("");
  };

  const send = async () => {
    const text = input.trim();
    if (!text || sending || !companyId) return;
    const convIdAtSend = activeId;
    setInput("");
    setPending({ convId: convIdAtSend, text });
    setSending(true);
    try {
      const { data, error } = await supabase.functions.invoke<ChatReply>("traffic-chat", {
        body: { message: text, conversation_id: convIdAtSend ?? undefined, company: companyName },
      });
      if (error) {
        let msg = "Não foi possível obter resposta agora. Tente novamente.";
        try {
          const body = await (error as { context?: Response }).context?.json?.();
          if (body && typeof body.error === "string") msg = body.error;
        } catch {
          /* corpo não-JSON: mantém a mensagem padrão */
        }
        toast.error(msg);
        setInput(text); // devolve o texto para não se perder
        setPending(null);
        return;
      }
      const convId = data!.conversation_id;
      qc.invalidateQueries({ queryKey: ["chat-conversations", companyId] });
      if (convIdAtSend) {
        await qc.invalidateQueries({ queryKey: ["chat-messages", convId] });
      } else {
        // conversa nova: semeia o cache antes de trocar a conversa ativa (sem flicker)
        await qc.fetchQuery({
          queryKey: ["chat-messages", convId],
          queryFn: () => fetchMessages(convId),
        });
        setActiveId(convId);
      }
      setPending(null);
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
                Pergunte sobre metas, gastos, campanhas e o que aconteceu. As respostas usam os
                dados reais de {selectedCompany?.name ?? "sua empresa"}.
              </p>
            </div>
          ) : (
            <div className="mx-auto flex max-w-3xl flex-col gap-4">
              {messages.isLoading &&
                activeId &&
                [0, 1].map((i) => <Skeleton key={i} className="h-20 w-full" />)}

              {msgs.map((m) => (
                <MessageBubble key={m.id} message={m} />
              ))}

              {showPending && (
                <div className="flex justify-end">
                  <div className="max-w-[85%] rounded-lg bg-primary px-3 py-2 text-sm text-primary-foreground">
                    {pending!.text}
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

        {/* Input */}
        <div className="border-t border-border p-3">
          <div className="mx-auto flex max-w-3xl items-end gap-2">
            <Textarea
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={onKeyDown}
              disabled={sending || !companyId}
              placeholder="Pergunte algo… (Enter envia, Shift+Enter quebra linha)"
              rows={1}
              className="max-h-40 min-h-[42px] resize-none"
            />
            <Button
              onClick={send}
              disabled={sending || !input.trim() || !companyId}
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
  );
}

function MessageBubble({ message }: { message: Message }) {
  const isUser = message.role === "user";
  const tools = toolNames(message.tool_calls);

  if (isUser) {
    return (
      <div className="flex justify-end">
        <div className="max-w-[85%] whitespace-pre-wrap rounded-lg bg-primary px-3 py-2 text-sm text-primary-foreground">
          {message.content}
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
        {(tools.length > 0 || message.model) && (
          <div className="mt-1 flex flex-wrap items-center gap-1">
            {tools.map((t, i) => (
              <Badge
                key={`${t}-${i}`}
                variant="outline"
                className="h-5 px-1.5 font-normal text-[11px]"
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
