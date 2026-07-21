import { createFileRoute } from "@tanstack/react-router";
import { useMemo } from "react";
import { useApp } from "@/lib/app-context";
import { EmptyCompany } from "@/components/metric-card";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { useCampaignBreakdown } from "@/hooks/use-breakdown";
import { fmtInt, fmtPct } from "@/lib/breakdown";

export const Route = createFileRoute("/_authenticated/funil")({
  component: Funil,
  head: () => ({ meta: [{ title: "Funil e conversões" }] }),
});

function Funil() {
  const { selectedCompany } = useApp();
  const campaignsQ = useCampaignBreakdown(selectedCompany?.id ?? null);
  const rows = campaignsQ.data ?? [];

  // Etapas reais do funil (soma das campanhas da empresa). Sem receita/vendas
  // aqui porque estas campanhas são de lead/mensagem/tráfego (sales = 0).
  const stages = useMemo(() => {
    const sum = (k: "impressions" | "clicks" | "link_clicks" | "leads" | "messaging_started" | "form_leads" | "sales") =>
      rows.reduce((a, c) => a + c[k], 0);
    const base = [
      { name: "Impressões", value: sum("impressions") },
      { name: "Cliques", value: sum("clicks") },
      { name: "Cliques no link", value: sum("link_clicks") },
      { name: "Leads", value: sum("leads") },
    ];
    const vendas = sum("sales");
    if (vendas > 0) base.push({ name: "Vendas", value: vendas });
    return base;
  }, [rows]);

  if (!selectedCompany) return <EmptyCompany />;

  const max = stages[0]?.value ?? 0;
  const hasData = max > 0;

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-semibold">Funil e conversões</h1>
        <p className="text-sm text-muted-foreground">
          Taxa de conversão etapa a etapa · {selectedCompany.name}
        </p>
      </div>

      {campaignsQ.isLoading ? (
        <Skeleton className="h-64 rounded-xl" />
      ) : !hasData ? (
        <Card className="p-6 text-sm text-muted-foreground">
          Sem dados de entrega para esta empresa no período.
        </Card>
      ) : (
        <Card className="p-6 space-y-3">
          {stages.map((s, i) => {
            const pct = max > 0 ? (s.value / max) * 100 : 0;
            const prev = stages[i - 1]?.value ?? 0;
            const rate = i > 0 && prev > 0 ? (s.value / prev) * 100 : 100;
            return (
              <div key={s.name}>
                <div className="flex items-center justify-between text-sm mb-1">
                  <div className="font-medium">{s.name}</div>
                  <div className="flex items-center gap-3">
                    <span className="tabular-nums">{fmtInt(s.value)}</span>
                    {i > 0 && (
                      <span className="text-xs text-muted-foreground">conv. {fmtPct(rate)}</span>
                    )}
                  </div>
                </div>
                <div className="h-9 rounded-md bg-muted overflow-hidden">
                  <div
                    className="h-full bg-gradient-to-r from-primary to-[color:var(--color-chart-2)]"
                    style={{ width: `${pct}%` }}
                  />
                </div>
              </div>
            );
          })}
        </Card>
      )}
    </div>
  );
}
