import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { RefreshCw } from "lucide-react";
import { toast } from "sonner";

function horaBrasil(iso: string | null | undefined): string {
  if (!iso) return "sem horário";
  const data = new Date(iso);
  if (Number.isNaN(data.getTime())) return "sem horário";
  return data.toLocaleString("pt-BR", {
    timeZone: "America/Sao_Paulo",
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function hojeBrasil(): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Sao_Paulo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

// O espelho tem last_synced_at e a marca de dia parcial. Sem isto na tela,
// o gestor nao distingue o numero de agora do numero de ontem.
export function FrescorDoEspelho({ companyId }: { companyId: string }) {
  const qc = useQueryClient();
  const [pedindo, setPedindo] = useState(false);
  const q = useQuery({
    queryKey: ["frescor-espelho", companyId],
    enabled: !!companyId,
    queryFn: async () => {
      const [estrutura, metrica] = await Promise.all([
        supabase
          .from("ad_sets")
          .select("last_synced_at")
          .eq("company_id", companyId)
          .order("last_synced_at", { ascending: false })
          .limit(1)
          .maybeSingle(),
        (supabase as unknown as {
          from: (t: string) => {
            select: (c: string) => {
              eq: (col: string, val: string) => {
                order: (col: string, opts: { ascending: boolean }) => {
                  limit: (n: number) => {
                    maybeSingle: () => Promise<{
                      data: { snapshot_date: string | null; parcial: boolean | null; atualizado_em: string | null } | null;
                      error: { message: string } | null;
                    }>;
                  };
                };
              };
            };
          };
        })
          .from("metric_snapshots")
          .select("snapshot_date, parcial, atualizado_em")
          .eq("company_id", companyId)
          .order("snapshot_date", { ascending: false })
          .limit(1)
          .maybeSingle(),
      ]);
      if (estrutura.error) throw estrutura.error;
      if (metrica.error) throw metrica.error;
      return {
        estruturaEm: estrutura.data?.last_synced_at ?? null,
        dia: metrica.data?.snapshot_date ?? null,
        parcial: metrica.data?.parcial === true || metrica.data?.snapshot_date === hojeBrasil(),
        metricaEm: metrica.data?.atualizado_em ?? null,
      };
    },
  });

  const atualizar = async () => {
    setPedindo(true);
    const { error } = await supabase.rpc("pedir_sync_da_empresa", { p_company_id: companyId });
    setPedindo(false);
    if (error) {
      toast.error(error.message);
      return;
    }
    toast.success("Sincronização pedida. O carimbo muda quando o espelho gravar.");
    window.setTimeout(() => {
      void qc.invalidateQueries();
    }, 8000);
  };

  const dados = q.data;
  const parcial = dados?.parcial && dados.dia === hojeBrasil();

  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
      <span>Estrutura sincronizada {horaBrasil(dados?.estruturaEm)}</span>
      {parcial ? (
        <span>Números de hoje parciais, atualizados {horaBrasil(dados?.metricaEm)}</span>
      ) : (
        <span>
          Último dia de métrica {dados?.dia ? dados.dia.split("-").reverse().join("/") : "—"}
        </span>
      )}
      <Button
        type="button"
        variant="outline"
        size="sm"
        className="h-7 gap-1"
        disabled={pedindo}
        onClick={() => void atualizar()}
      >
        <RefreshCw className={`h-3.5 w-3.5 ${pedindo ? "animate-spin" : ""}`} />
        Atualizar agora
      </Button>
    </div>
  );
}
