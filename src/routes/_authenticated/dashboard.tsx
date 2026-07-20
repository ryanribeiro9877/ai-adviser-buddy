import { createFileRoute } from "@tanstack/react-router";
import { useApp } from "@/lib/app-context";
import { EmptyCompany, MetricCard } from "@/components/metric-card";
import { generateMetrics, generateTimeSeries, fmtBRL, fmtInt, fmtPct, fmtDec } from "@/lib/mock-metrics";
import { Card } from "@/components/ui/card";
import { DollarSign, Eye, Users, MousePointerClick, Target, TrendingUp, ShoppingCart, Repeat } from "lucide-react";
import { AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from "recharts";

export const Route = createFileRoute("/_authenticated/dashboard")({
  component: Dashboard,
  head: () => ({ meta: [{ title: "Dashboard executivo" }] }),
});

function Dashboard() {
  const { selectedCompany } = useApp();
  if (!selectedCompany) return <EmptyCompany />;
  const m = generateMetrics(selectedCompany.id);
  const series = generateTimeSeries(selectedCompany.id);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Dashboard executivo</h1>
        <p className="text-sm text-muted-foreground">
          Consolidado dos últimos 30 dias · {selectedCompany.name}
        </p>
      </div>

      <div className="grid gap-3 grid-cols-2 md:grid-cols-4 xl:grid-cols-7">
        <MetricCard label="Investimento" value={fmtBRL(m.investment)} icon={DollarSign} />
        <MetricCard label="Impressões" value={fmtInt(m.impressions)} icon={Eye} />
        <MetricCard label="Alcance" value={fmtInt(m.reach)} icon={Users} />
        <MetricCard label="Cliques" value={fmtInt(m.clicks)} icon={MousePointerClick} />
        <MetricCard label="CTR" value={fmtPct(m.ctr)} tone="success" />
        <MetricCard label="CPC" value={fmtBRL(m.cpc)} />
        <MetricCard label="Frequência" value={fmtDec(m.frequency)} icon={Repeat} />
        <MetricCard label="Leads" value={fmtInt(m.leads)} icon={Target} />
        <MetricCard label="CPL" value={fmtBRL(m.cpl)} />
        <MetricCard label="Vendas" value={fmtInt(m.sales)} icon={ShoppingCart} />
        <MetricCard label="CPA" value={fmtBRL(m.cpa)} />
        <MetricCard label="Receita" value={fmtBRL(m.revenue)} tone="success" icon={TrendingUp} />
        <MetricCard label="ROAS" value={`${fmtDec(m.roas)}x`} tone={m.roas >= 2 ? "success" : "warning"} />
        <MetricCard label="Taxa de conversão" value={fmtPct(m.conversionRate)} />
      </div>

      <Card className="p-5">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h2 className="font-semibold">Investimento × Receita</h2>
            <p className="text-xs text-muted-foreground">Série diária dos últimos 30 dias</p>
          </div>
        </div>
        <div className="h-72">
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={series}>
              <defs>
                <linearGradient id="inv" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="var(--color-chart-1)" stopOpacity={0.6} />
                  <stop offset="95%" stopColor="var(--color-chart-1)" stopOpacity={0} />
                </linearGradient>
                <linearGradient id="rev" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="var(--color-chart-2)" stopOpacity={0.6} />
                  <stop offset="95%" stopColor="var(--color-chart-2)" stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" />
              <XAxis dataKey="date" stroke="var(--color-muted-foreground)" fontSize={11} />
              <YAxis stroke="var(--color-muted-foreground)" fontSize={11} />
              <Tooltip contentStyle={{ background: "var(--color-card)", border: "1px solid var(--color-border)", borderRadius: 8 }} />
              <Area type="monotone" dataKey="investment" stroke="var(--color-chart-1)" fill="url(#inv)" name="Investimento" />
              <Area type="monotone" dataKey="revenue" stroke="var(--color-chart-2)" fill="url(#rev)" name="Receita" />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      </Card>
    </div>
  );
}
