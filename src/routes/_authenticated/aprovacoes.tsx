import { useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useApp, logAudit } from "@/lib/app-context";
import { EmptyCompany } from "@/components/metric-card";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Check, X, ShieldCheck, Clock } from "lucide-react";
import { toast } from "sonner";
import { FalhaDaExecucao, reexecutarApproval, type UltimaFalha } from "@/components/action-card";
import {
  ehCardDeCriacao,
  linhasPreviaDoCard,
  tituloDoCardAprovacao,
} from "@/lib/approval-card-texto";

export const Route = createFileRoute("/_authenticated/aprovacoes")({
  component: Aprovacoes,
  head: () => ({ meta: [{ title: "Aprovações pendentes" }] }),
});

function Aprovacoes() {
  const { selectedCompany, isAdmin, user } = useApp();
  const [retryingId, setRetryingId] = useState<string | null>(null);
  const q = useQuery({
    queryKey: ["approvals", selectedCompany?.id],
    enabled: !!selectedCompany,
    queryFn: async () => {
      const { data } = await supabase
        .from("approval_requests")
        .select("*")
        .eq("company_id", selectedCompany!.id)
        .order("created_at", { ascending: false });
      return data ?? [];
    },
  });

  const review = async (id: string, status: "approved" | "rejected") => {
    const { error } = await supabase
      .from("approval_requests")
      .update({ status, reviewed_by: user.id, reviewed_at: new Date().toISOString() })
      .eq("id", id);
    if (error) return toast.error(error.message);
    await logAudit({
      companyId: selectedCompany!.id,
      action: `approval.${status}`,
      targetType: "approval",
      targetId: id,
    });
    toast.success(status === "approved" ? "Aprovado" : "Rejeitado");
    q.refetch();
  };

  const retry = async (id: string) => {
    setRetryingId(id);
    const { error } = await reexecutarApproval(id);
    setRetryingId(null);
    if (error) {
      toast.error(error);
      return;
    }
    toast.success("Nova tentativa disparada");
    q.refetch();
    window.setTimeout(() => q.refetch(), 4000);
    window.setTimeout(() => q.refetch(), 12000);
  };

  if (!selectedCompany) return <EmptyCompany />;
  const items = q.data ?? [];
  const pending = items.filter((i) => i.status === "pending");
  const others = items.filter((i) => i.status !== "pending");

  const Row = ({ r, reviewable }: { r: (typeof items)[number]; reviewable: boolean }) => {
    const linhas = linhasPreviaDoCard(r.action as string, r.payload, r.summary);
    return (
      <Card className="p-4">
        <div className="flex items-start justify-between gap-3">
          <div>
            <div className="flex items-center gap-2">
              <span className="font-semibold">
                {tituloDoCardAprovacao(r.action as string, r.summary)}
              </span>
              <Badge variant="outline">{r.entity_type}</Badge>
              <Badge
                className={
                  r.status === "approved"
                    ? "bg-[color:var(--color-success)] text-primary-foreground"
                    : r.status === "rejected"
                      ? "bg-destructive text-destructive-foreground"
                      : ""
                }
                variant={r.status === "pending" ? "secondary" : "default"}
              >
                {r.status === "pending"
                  ? "Pendente"
                  : r.status === "approved"
                    ? "Aprovado"
                    : "Rejeitado"}
              </Badge>
            </div>
            <div className="text-xs text-muted-foreground mt-1 flex items-center gap-2">
              <Clock className="h-3 w-3" /> {new Date(r.created_at).toLocaleString("pt-BR")}
            </div>
            {linhas.length > 0 && (
              <dl className="mt-2 space-y-0.5 text-sm">
                {linhas.map((l) => (
                  <div key={l.rotulo} className="flex gap-2">
                    <dt className="shrink-0 text-muted-foreground">{l.rotulo}:</dt>
                    <dd className="min-w-0 font-medium break-words">{l.valor}</dd>
                  </div>
                ))}
              </dl>
            )}
            {r.payload &&
              Object.keys(r.payload as object).length > 0 &&
              !ehCardDeCriacao(r.action as string) && (
                <pre className="mt-2 text-xs bg-muted rounded p-2 max-w-xl overflow-x-auto">
                  {JSON.stringify(r.payload, null, 2)}
                </pre>
              )}
            {/* A falha da execução mora no card; sem ela e sem executed_at, segue "aguardando". */}
            {r.ultima_falha && (
              <FalhaDaExecucao
                falha={r.ultima_falha as unknown as UltimaFalha}
                isAdmin={isAdmin}
                retrying={retryingId === r.id}
                onRetry={() => retry(r.id)}
              />
            )}
            {r.status === "approved" && !r.ultima_falha && (
              <p className="mt-2 text-xs text-muted-foreground">
                {r.executed_at
                  ? `Executado em ${new Date(r.executed_at).toLocaleString("pt-BR")}.`
                  : "Aprovado — aguardando execução."}
              </p>
            )}
          </div>
          {reviewable && (
            <div className="flex gap-2">
              <Button size="sm" variant="ghost" onClick={() => review(r.id, "rejected")}>
                <X className="h-4 w-4 mr-1" />
                Rejeitar
              </Button>
              <Button size="sm" onClick={() => review(r.id, "approved")}>
                <Check className="h-4 w-4 mr-1" />
                Aprovar
              </Button>
            </div>
          )}
        </div>
      </Card>
    );
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold flex items-center gap-2">
          <ShieldCheck className="h-6 w-6 text-primary" /> Aprovações pendentes
        </h1>
        <p className="text-sm text-muted-foreground">
          Toda alteração em campanhas, orçamentos, anúncios e públicos passa por aqui antes de ser
          aplicada.
        </p>
      </div>

      <section>
        <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider mb-2">
          Pendentes ({pending.length})
        </h2>
        <div className="space-y-3">
          {pending.map((r) => (
            <Row key={r.id} r={r} reviewable={isAdmin} />
          ))}
          {pending.length === 0 && (
            <Card className="p-6 text-sm text-muted-foreground">Nenhuma solicitação pendente.</Card>
          )}
        </div>
      </section>

      {others.length > 0 && (
        <section>
          <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider mb-2">
            Histórico
          </h2>
          <div className="space-y-3">
            {others.map((r) => (
              <Row key={r.id} r={r} reviewable={false} />
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
