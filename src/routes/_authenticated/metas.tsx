import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { toast } from "sonner";
import { RefreshCw } from "lucide-react";
import { useApp } from "@/lib/app-context";
import { supabase } from "@/integrations/supabase/client";
import { EmptyCompany } from "@/components/metric-card";
import { TargetsTable } from "@/components/targets-table";
import { Button } from "@/components/ui/button";

export const Route = createFileRoute("/_authenticated/metas")({
  component: Metas,
  head: () => ({ meta: [{ title: "Metas & Tetos" }] }),
});

function Metas() {
  const { isAdmin, selectedCompany, selectedCompanyId } = useApp();
  const [rpcRunning, setRpcRunning] = useState(false);
  const [rpcForbidden, setRpcForbidden] = useState(false);

  const reavaliar = async () => {
    setRpcRunning(true);
    const { data, error } = await supabase.rpc("evaluate_alerts");
    setRpcRunning(false);
    if (error) {
      const msg = (error.message ?? "").toLowerCase();
      if (
        error.code === "42501" ||
        msg.includes("permission denied") ||
        msg.includes("not allowed")
      ) {
        setRpcForbidden(true);
        return;
      }
      toast.error("Não foi possível reavaliar os alertas agora.");
      return;
    }
    toast.success(`${data ?? 0} alertas ativos`);
  };

  return (
    <div className="space-y-6 max-w-4xl">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold">Metas &amp; Tetos</h1>
          <p className="text-sm text-muted-foreground">
            Tetos de custo por métrica da empresa. Editar uma meta recalibra os alertas na próxima
            avaliação (cron diário, 06:15).
          </p>
        </div>
        {isAdmin && !rpcForbidden && selectedCompanyId && (
          <Button variant="outline" size="sm" onClick={reavaliar} disabled={rpcRunning}>
            <RefreshCw className={`h-4 w-4 mr-2 ${rpcRunning ? "animate-spin" : ""}`} />
            Reavaliar alertas agora
          </Button>
        )}
      </div>

      {!selectedCompanyId || !selectedCompany ? (
        <EmptyCompany />
      ) : (
        <>
          <div className="text-sm text-muted-foreground">
            Empresa: <span className="text-foreground font-medium">{selectedCompany.name}</span>
          </div>
          <TargetsTable companyId={selectedCompanyId} />
          {!isAdmin && (
            <p className="text-xs text-muted-foreground">
              Somente administradores podem editar metas.
            </p>
          )}
        </>
      )}
    </div>
  );
}
