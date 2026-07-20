import { createFileRoute } from "@tanstack/react-router";
import { useApp } from "@/lib/app-context";
import { EmptyCompany } from "@/components/metric-card";
import { Card } from "@/components/ui/card";
import { generateMetrics, fmtInt, fmtPct } from "@/lib/mock-metrics";

export const Route = createFileRoute("/_authenticated/funil")({
  component: Funil,
  head: () => ({ meta: [{ title: "Funil e conversões" }] }),
});

function Funil() {
  const { selectedCompany } = useApp();
  if (!selectedCompany) return <EmptyCompany />;
  const m = generateMetrics(selectedCompany.id);
  const stages = [
    { name: "Impressões", value: m.impressions },
    { name: "Alcance", value: m.reach },
    { name: "Cliques", value: m.clicks },
    { name: "Leads", value: m.leads },
    { name: "Vendas", value: m.sales },
  ];
  const max = stages[0].value;

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-semibold">Funil e conversões</h1>
        <p className="text-sm text-muted-foreground">Taxa de conversão etapa a etapa.</p>
      </div>
      <Card className="p-6 space-y-3">
        {stages.map((s, i) => {
          const pct = (s.value / max) * 100;
          const rate = i > 0 ? (s.value / stages[i - 1].value) * 100 : 100;
          return (
            <div key={s.name}>
              <div className="flex items-center justify-between text-sm mb-1">
                <div className="font-medium">{s.name}</div>
                <div className="flex items-center gap-3">
                  <span className="tabular-nums">{fmtInt(s.value)}</span>
                  {i > 0 && <span className="text-xs text-muted-foreground">conv. {fmtPct(rate)}</span>}
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
    </div>
  );
}
