import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useApp, logAudit } from "@/lib/app-context";
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

function Alertas() {
  const { selectedCompany, isAdmin } = useApp();
  const q = useQuery({
    queryKey: ["alerts", selectedCompany?.id],
    enabled: !!selectedCompany,
    queryFn: async () => {
      const { data } = await supabase.from("alerts").select("*").eq("company_id", selectedCompany!.id).order("created_at", { ascending: false });
      return data ?? [];
    },
  });

  const resolve = async (id: string) => {
    await supabase.from("alerts").update({ resolved: true }).eq("id", id);
    await logAudit({ companyId: selectedCompany!.id, action: "alert.resolve", targetType: "alert", targetId: id });
    toast.success("Alerta resolvido");
    q.refetch();
  };

  if (!selectedCompany) return <EmptyCompany />;
  const items = q.data ?? [];

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Alertas</h1>
          <p className="text-sm text-muted-foreground">Anomalias detectadas nas contas conectadas.</p>
        </div>
      </div>
      <div className="space-y-3">
        {items.map((a) => (
          <Card key={a.id} className="p-4 flex items-start gap-3">
            <div className="mt-0.5">
              <AlertTriangle className={`h-5 w-5 ${a.severity === "high" || a.severity === "critical" ? "text-destructive" : a.severity === "medium" ? "text-[color:var(--color-warning)]" : "text-muted-foreground"}`} />
            </div>
            <div className="flex-1">
              <div className="flex items-center gap-2">
                <span className="font-semibold">{a.title}</span>
                <Badge variant={a.resolved ? "secondary" : "outline"}>{a.resolved ? "Resolvido" : a.severity}</Badge>
              </div>
              <div className="text-sm text-muted-foreground mt-1">{a.description}</div>
            </div>
            {isAdmin && !a.resolved && (
              <Button size="sm" variant="outline" onClick={() => resolve(a.id)}>
                <CheckCircle2 className="h-4 w-4 mr-1" />Resolver
              </Button>
            )}
          </Card>
        ))}
        {items.length === 0 && <Card className="p-6 text-sm text-muted-foreground">Nenhum alerta ativo.</Card>}
      </div>
    </div>
  );
}
