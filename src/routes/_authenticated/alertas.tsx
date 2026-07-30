import { useEffect, useRef } from "react";
import { createFileRoute, useSearch } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useApp, logAudit } from "@/lib/app-context";
import { useNotificacoes } from "@/hooks/use-notificacoes";
import { EmptyCompany } from "@/components/metric-card";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { AlertTriangle, CheckCircle2 } from "lucide-react";
import { toast } from "sonner";

export const Route = createFileRoute("/_authenticated/alertas")({
  component: Alertas,
  head: () => ({ meta: [{ title: "Alertas" }] }),
});

// Ordem de severidade: critical no topo (pendência da fase 2).
const SEVERITY_RANK: Record<string, number> = { critical: 0, high: 1, medium: 2, low: 3 };

function Alertas() {
  const { selectedCompany, isAdmin } = useApp();
  const { recarregar } = useNotificacoes();
  // ?item=<id> vem do sino/toast: rola até o alerta e o destaca.
  const { item: destacado } = useSearch({ strict: false }) as { item?: string };
  const refs = useRef(new Map<string, HTMLDivElement>());

  const q = useQuery({
    queryKey: ["alerts", selectedCompany?.id],
    enabled: !!selectedCompany,
    queryFn: async () => {
      const { data } = await supabase
        .from("alerts")
        .select("*")
        .eq("company_id", selectedCompany!.id)
        .order("created_at", { ascending: false });
      return data ?? [];
    },
  });

  useEffect(() => {
    if (!destacado) return;
    const el = refs.current.get(destacado);
    el?.scrollIntoView({ behavior: "smooth", block: "center" });
  }, [destacado, q.data]);

  const resolve = async (id: string) => {
    await supabase.from("alerts").update({ resolved: true }).eq("id", id);
    await logAudit({
      companyId: selectedCompany!.id,
      action: "alert.resolve",
      targetType: "alert",
      targetId: id,
    });
    toast.success("Alerta resolvido");
    q.refetch();
    recarregar(); // o sino é derivado do banco: some daqui, some de lá
  };

  if (!selectedCompany) return <EmptyCompany />;
  // Ordena por severidade (critical → low) e, dentro de cada nível, por data desc.
  const items = [...(q.data ?? [])].sort((a, b) => {
    const rank = (SEVERITY_RANK[a.severity] ?? 9) - (SEVERITY_RANK[b.severity] ?? 9);
    return rank !== 0 ? rank : new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
  });

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Alertas</h1>
          <p className="text-sm text-muted-foreground">
            Anomalias detectadas nas contas conectadas.
          </p>
        </div>
      </div>
      <div className="space-y-3">
        {items.map((a) => (
          <Card
            key={a.id}
            ref={(el) => {
              if (el) refs.current.set(a.id, el);
              else refs.current.delete(a.id);
            }}
            className={
              a.id === destacado
                ? "flex items-start gap-3 p-4 ring-2 ring-primary ring-offset-2 ring-offset-background"
                : "flex items-start gap-3 p-4"
            }
          >
            <div className="mt-0.5">
              <AlertTriangle
                className={`h-5 w-5 ${a.severity === "high" || a.severity === "critical" ? "text-destructive" : a.severity === "medium" ? "text-[color:var(--color-warning)]" : "text-muted-foreground"}`}
              />
            </div>
            <div className="flex-1">
              <div className="flex items-center gap-2">
                <span className="font-semibold">{a.title}</span>
                <Badge variant={a.resolved ? "secondary" : "outline"}>
                  {a.resolved ? "Resolvido" : a.severity}
                </Badge>
              </div>
              <div className="mt-1 text-sm text-muted-foreground">{a.description}</div>
            </div>
            {isAdmin && !a.resolved && (
              <Button size="sm" variant="outline" onClick={() => resolve(a.id)}>
                <CheckCircle2 className="mr-1 h-4 w-4" />
                Resolver
              </Button>
            )}
          </Card>
        ))}
        {items.length === 0 && (
          <Card className="p-6 text-sm text-muted-foreground">Nenhum alerta ativo.</Card>
        )}
      </div>
    </div>
  );
}
