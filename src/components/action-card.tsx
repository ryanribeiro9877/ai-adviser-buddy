import { useState } from "react";
import { Link } from "@tanstack/react-router";
import {
  Pause,
  PauseCircle,
  TrendingUp,
  DollarSign,
  Check,
  X,
  Loader2,
  Clock,
  MessagesSquare,
  Lock,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAgora } from "@/hooks/use-agora";
import { expirado as jaExpirou, textoExpiracao } from "@/lib/notificacoes";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";

export type Approval = {
  id: string;
  action: string;
  entity_type: string;
  summary: string;
  payload: unknown;
  status: string; // pending | approved | rejected
  review_note: string | null;
  reviewed_at: string | null;
  requested_by: string;
  reviewed_by: string | null;
  created_at: string;
  conversation_id: string | null;
  /** Padrão do banco: now() + 24h. Sem decisão, o pedido é rejeitado com nota. */
  expires_at?: string | null;
};

export type Decision = "approved" | "rejected";

const ACTION_META: Record<string, { label: string; icon: typeof Pause }> = {
  pausar_criativo: { label: "Pausar criativo", icon: Pause },
  escalar_criativo: { label: "Escalar criativo", icon: TrendingUp },
  pausar_campanha: { label: "Pausar campanha", icon: PauseCircle },
  alterar_orcamento: { label: "Alterar orçamento", icon: DollarSign },
};

const STATUS_META: Record<string, { label: string; className: string }> = {
  pending: {
    label: "Aguardando aprovação",
    className:
      "border-[color:var(--color-warning)]/40 bg-[color:var(--color-warning)]/15 text-[color:var(--color-warning)]",
  },
  approved: {
    label: "Aprovada — aplicar no Gerenciador",
    className:
      "border-[color:var(--color-success)]/40 bg-[color:var(--color-success)]/15 text-[color:var(--color-success)]",
  },
  rejected: {
    label: "Rejeitada",
    className: "border-destructive/40 bg-destructive/15 text-destructive",
  },
};

const fmtWhen = (iso: string) =>
  new Date(iso).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" });

// Chama a RPC. O backend valida (só admin, só de pending). Retorna a msg de erro.
export async function decideApproval(
  id: string,
  decision: Decision,
  reason?: string,
): Promise<{ error: string | null }> {
  const { error } = await supabase.rpc("decide_approval", {
    p_id: id,
    p_decision: decision,
    p_reason: reason && reason.trim() ? reason.trim() : null,
  });
  return { error: error?.message ?? null };
}

function justificativa(payload: unknown): string | null {
  if (payload && typeof payload === "object") {
    const j = (payload as { justificativa?: unknown }).justificativa;
    if (typeof j === "string") return j;
  }
  return null;
}

export function ActionCard({
  approval,
  isAdmin,
  deciding,
  onDecide,
  requesterName,
  reviewerName,
  showMeta,
  linkConversa,
}: {
  approval: Approval;
  isAdmin: boolean;
  deciding: boolean;
  onDecide: (id: string, decision: Decision, reason?: string) => void;
  requesterName?: string;
  reviewerName?: string;
  showMeta?: boolean;
  /** Link "ver a conversa que originou" — inútil dentro do próprio chat. */
  linkConversa?: boolean;
}) {
  const [rejecting, setRejecting] = useState(false);
  const [reason, setReason] = useState("");

  const meta = ACTION_META[approval.action] ?? { label: approval.action, icon: Clock };
  const status = STATUS_META[approval.status] ?? {
    label: approval.status,
    className: "border-border bg-muted text-muted-foreground",
  };
  const Icon = meta.icon;
  const just = justificativa(approval.payload);
  const pendente = approval.status === "pending";
  // Contador vivo enquanto o pedido está pendente (o minuto passa sem evento no banco).
  const agora = useAgora(pendente && !!approval.expires_at, 30_000);
  const expirou = pendente && jaExpirou(approval.expires_at ?? null, agora);
  const prazo = pendente ? textoExpiracao(approval.expires_at ?? null, agora) : null;
  const restamMin = approval.expires_at
    ? Math.floor((new Date(approval.expires_at).getTime() - agora) / 60000)
    : null;
  const prazoUrgente = restamMin !== null && restamMin <= 120;
  // Expirado não se aprova. Não-admin vê o botão desabilitado com o motivo — a RLS
  // bloqueia o UPDATE e um botão que falha em silêncio é pior que um desabilitado.
  const canDecide = pendente && !expirou;
  const motivoBloqueio = !isAdmin
    ? "Somente administrador pode aprovar ou rejeitar"
    : expirou
      ? "Pedido expirado — não pode mais ser aprovado"
      : null;
  const payloadJson =
    approval.payload && Object.keys(approval.payload as object).length > 0
      ? JSON.stringify(approval.payload, null, 2)
      : null;

  return (
    <div className="rounded-lg border border-border bg-card p-3">
      <div className="flex items-start gap-2">
        <div className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-primary/15 text-primary">
          <Icon className="h-4 w-4" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
              {meta.label}
            </span>
            <span
              className={cn(
                "inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-medium",
                expirou
                  ? "border-destructive/40 bg-destructive/15 text-destructive"
                  : status.className,
              )}
            >
              {expirou ? "Expirada sem decisão" : status.label}
            </span>
            {prazo && !expirou && (
              <span
                className={cn(
                  "inline-flex items-center gap-1 text-[11px]",
                  prazoUrgente ? "font-medium text-destructive" : "text-muted-foreground",
                )}
              >
                <Clock className="h-3 w-3" />
                {prazo}
              </span>
            )}
          </div>
          <div className="mt-1 text-sm font-medium">{approval.summary}</div>
          {just && <p className="mt-1 text-xs text-muted-foreground">{just}</p>}

          {/* Os parâmetros reais da ação — recolhidos, mas sempre disponíveis:
              sem eles a decisão é no escuro. */}
          {payloadJson && (
            <details className="mt-2">
              <summary className="cursor-pointer text-xs text-muted-foreground hover:text-foreground">
                Parâmetros da ação
              </summary>
              <pre className="mt-1 max-w-full overflow-x-auto rounded bg-muted p-2 text-[11px]">
                {payloadJson}
              </pre>
            </details>
          )}

          {pendente && (
            <div className="mt-2 space-y-1 rounded-md border border-border bg-muted/40 p-2 text-[11px] text-muted-foreground">
              <p className="flex items-start gap-1.5">
                <Lock className="mt-0.5 h-3 w-3 shrink-0" />
                <span>
                  As travas de execução estão fechadas: aprovar <strong>registra a decisão</strong>{" "}
                  e não aplica nada na Meta enquanto as flags seguirem desligadas.
                </span>
              </p>
              <p className="flex items-start gap-1.5">
                <Clock className="mt-0.5 h-3 w-3 shrink-0" />
                <span>
                  A aprovação expira em 24h — sem decisão, vira rejeitada automaticamente com nota.
                </span>
              </p>
            </div>
          )}

          {linkConversa && approval.conversation_id && (
            <Link
              to="/recomendacoes"
              search={(prev: Record<string, unknown>) => ({
                ...prev,
                tab: "chat",
                conv: approval.conversation_id,
              })}
              className="mt-2 inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline"
            >
              <MessagesSquare className="h-3.5 w-3.5" />
              Ver a conversa que originou
            </Link>
          )}

          {approval.status === "approved" && (
            <p className="mt-2 text-xs text-muted-foreground">
              Nesta fase a mudança é aplicada manualmente no Gerenciador.
            </p>
          )}
          {approval.status === "rejected" && approval.review_note && (
            <p className="mt-2 text-xs text-muted-foreground">
              <span className="font-medium">Motivo:</span> {approval.review_note}
            </p>
          )}

          {showMeta && (
            <div className="mt-2 text-[11px] text-muted-foreground">
              Pedido por {requesterName ?? "—"} em {fmtWhen(approval.created_at)}
              {approval.reviewed_at && (
                <>
                  {" · "}
                  {approval.status === "approved" ? "Aprovado" : "Rejeitado"} por{" "}
                  {reviewerName ?? "—"} em {fmtWhen(approval.reviewed_at)}
                </>
              )}
            </div>
          )}

          {pendente && !rejecting && (
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <Button
                size="sm"
                onClick={() => onDecide(approval.id, "approved")}
                disabled={deciding || !isAdmin || expirou}
                title={motivoBloqueio ?? undefined}
              >
                {deciding ? (
                  <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />
                ) : (
                  <Check className="mr-1 h-3.5 w-3.5" />
                )}
                Aprovar
              </Button>
              <Button
                size="sm"
                variant="outline"
                onClick={() => setRejecting(true)}
                disabled={deciding || !isAdmin || expirou}
                title={motivoBloqueio ?? undefined}
              >
                <X className="mr-1 h-3.5 w-3.5" />
                Rejeitar
              </Button>
              {motivoBloqueio && (
                <span className="text-[11px] text-muted-foreground">{motivoBloqueio}</span>
              )}
            </div>
          )}

          {canDecide && isAdmin && rejecting && (
            <div className="mt-3 space-y-2">
              {/* O motivo é obrigatório: é ele que ensina o sistema. */}
              <Textarea
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                placeholder="Motivo da rejeição (obrigatório)"
                rows={2}
                className="resize-none text-sm"
                disabled={deciding}
                aria-required
              />
              <div className="flex flex-wrap items-center gap-2">
                <Button
                  size="sm"
                  variant="destructive"
                  onClick={() => onDecide(approval.id, "rejected", reason)}
                  disabled={deciding || reason.trim().length === 0}
                  title={reason.trim() ? undefined : "Escreva o motivo da rejeição"}
                >
                  {deciding ? (
                    <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <X className="mr-1 h-3.5 w-3.5" />
                  )}
                  Confirmar rejeição
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => {
                    setRejecting(false);
                    setReason("");
                  }}
                  disabled={deciding}
                >
                  Cancelar
                </Button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
