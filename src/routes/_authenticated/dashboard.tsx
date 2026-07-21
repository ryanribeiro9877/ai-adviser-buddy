import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { useApp } from "@/lib/app-context";
import { EmptyCompany, MetricCard } from "@/components/metric-card";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import {
  DollarSign,
  Target,
  MousePointerClick,
  MessageCircle,
  FileText,
  ShoppingCart,
  TrendingUp,
  ArrowLeft,
} from "lucide-react";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  CartesianGrid,
  Cell,
} from "recharts";
import { AccountSelector, ALL_ACCOUNTS } from "@/components/account-selector";
import { TypeFilter, ALL_TYPES } from "@/components/type-filter";
import { AccountsTable } from "@/components/accounts-table";
import { CampaignsTable } from "@/components/campaigns-table";
import { Button } from "@/components/ui/button";
import { useAccountBreakdown, useCampaignBreakdown } from "@/hooks/use-breakdown";
import {
  fmtBRL,
  fmtInt,
  TIPO_META,
  TIPO_ORDER,
  type AccountRow,
  type CampaignRow,
  type TipoConta,
} from "@/lib/breakdown";

export const Route = createFileRoute("/_authenticated/dashboard")({
  component: Dashboard,
  head: () => ({ meta: [{ title: "Dashboard executivo" }] }),
});

function Dashboard() {
  const { selectedCompany } = useApp();
  const companyId = selectedCompany?.id ?? null;

  const [accountId, setAccountId] = useState<string>(ALL_ACCOUNTS);
  const [tipo, setTipo] = useState<string>(ALL_TYPES);

  // Ao trocar de empresa, volta filtros ao padrão.
  useEffect(() => {
    setAccountId(ALL_ACCOUNTS);
    setTipo(ALL_TYPES);
  }, [companyId]);

  const accountsQ = useAccountBreakdown(companyId);
  const campaignsQ = useCampaignBreakdown(companyId);

  const accounts = useMemo(() => accountsQ.data ?? [], [accountsQ.data]);
  const campaigns = useMemo(() => campaignsQ.data ?? [], [campaignsQ.data]);

  // Tipos presentes (para os chips), na ordem canônica, sem sem_dados.
  const typesPresent = useMemo<TipoConta[]>(() => {
    const present = new Set<string>(campaigns.map((c) => c.tipo));
    return TIPO_ORDER.filter((t) => present.has(t));
  }, [campaigns]);

  // Campanhas após aplicar conta + tipo.
  const filteredCampaigns = useMemo(() => {
    return campaigns.filter(
      (c) =>
        (accountId === ALL_ACCOUNTS || c.account_id === accountId) &&
        (tipo === ALL_TYPES || c.tipo === tipo),
    );
  }, [campaigns, accountId, tipo]);

  // KPIs — sempre do nível de campanha (reconcilia com os totais).
  const kpi = useMemo(() => aggregate(filteredCampaigns), [filteredCampaigns]);

  // Contas exibidas na tabela: com tipo=Todos usa a view (número de referência
  // exato + tipo dominante); com um tipo ativo, deriva das campanhas daquele tipo.
  const accountsForTable = useMemo<AccountRow[]>(() => {
    const active = accounts.filter((a) => a.tipo_conta !== "sem_dados");
    if (tipo === ALL_TYPES) return active;
    return deriveAccounts(filteredCampaigns, tipo as TipoConta);
  }, [accounts, filteredCampaigns, tipo]);

  const dormantCount = useMemo(
    () => accounts.filter((a) => a.tipo_conta === "sem_dados").length,
    [accounts],
  );

  // Investimento por tipo (gráfico) a partir das campanhas filtradas.
  const spendByTipo = useMemo(() => {
    const map = new Map<TipoConta, number>();
    for (const c of filteredCampaigns) map.set(c.tipo, (map.get(c.tipo) ?? 0) + c.spend);
    return [...map.entries()]
      .map(([t, spend]) => ({ tipo: t, label: TIPO_META[t]?.label ?? t, spend }))
      .sort((a, b) => b.spend - a.spend);
  }, [filteredCampaigns]);

  const selectedAccount = accounts.find((a) => a.account_id === accountId) ?? null;

  if (!selectedCompany) return <EmptyCompany />;

  const isLoading = accountsQ.isLoading || campaignsQ.isLoading;
  const hasRevenue = kpi.revenue > 0 || kpi.sales > 0;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Dashboard executivo</h1>
        <p className="text-sm text-muted-foreground">
          Dados consolidados · {selectedCompany.name}
          {accountId !== ALL_ACCOUNTS && selectedAccount
            ? ` · ${selectedAccount.account_name}`
            : ""}
        </p>
      </div>

      {/* Barra de filtros */}
      <div className="flex flex-wrap items-center gap-3">
        <AccountSelector accounts={accounts} value={accountId} onChange={setAccountId} />
        <div className="h-5 w-px bg-border hidden sm:block" />
        <TypeFilter types={typesPresent} value={tipo} onChange={setTipo} />
        {(accountId !== ALL_ACCOUNTS || tipo !== ALL_TYPES) && (
          <Button
            variant="ghost"
            size="sm"
            className="ml-auto gap-1 text-muted-foreground"
            onClick={() => {
              setAccountId(ALL_ACCOUNTS);
              setTipo(ALL_TYPES);
            }}
          >
            Limpar filtros
          </Button>
        )}
      </div>

      {isLoading ? (
        <div className="grid gap-3 grid-cols-2 md:grid-cols-3 xl:grid-cols-6">
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} className="h-[92px] rounded-xl" />
          ))}
        </div>
      ) : (
        <div className="grid gap-3 grid-cols-2 md:grid-cols-3 xl:grid-cols-6">
          <MetricCard label="Investimento" value={fmtBRL(kpi.spend)} icon={DollarSign} />
          <MetricCard label="Leads" value={fmtInt(kpi.leads)} icon={Target} tone="success" />
          <MetricCard label="CPL" value={kpi.leads > 0 ? fmtBRL(kpi.spend / kpi.leads) : "—"} />
          <MetricCard
            label="Cliques no link"
            value={fmtInt(kpi.link_clicks)}
            icon={MousePointerClick}
          />
          <MetricCard
            label="Conversas"
            value={fmtInt(kpi.messaging_started)}
            icon={MessageCircle}
          />
          <MetricCard label="Formulário" value={fmtInt(kpi.form_leads)} icon={FileText} />
          {hasRevenue && (
            <>
              <MetricCard label="Compras" value={fmtInt(kpi.sales)} icon={ShoppingCart} />
              <MetricCard
                label="Receita"
                value={fmtBRL(kpi.revenue)}
                tone="success"
                icon={TrendingUp}
              />
              <MetricCard
                label="ROAS"
                value={`${(kpi.revenue / Math.max(kpi.spend, 1)).toFixed(2)}x`}
                tone={kpi.revenue / Math.max(kpi.spend, 1) >= 2 ? "success" : "warning"}
              />
            </>
          )}
        </div>
      )}

      {/* Gráfico: investimento por tipo */}
      {!isLoading && spendByTipo.length > 0 && (
        <Card className="p-5">
          <div className="mb-4">
            <h2 className="font-semibold">Investimento por tipo</h2>
            <p className="text-xs text-muted-foreground">Distribuição do gasto na seleção atual</p>
          </div>
          <div className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={spendByTipo}>
                <CartesianGrid
                  strokeDasharray="3 3"
                  stroke="var(--color-border)"
                  vertical={false}
                />
                <XAxis dataKey="label" stroke="var(--color-muted-foreground)" fontSize={11} />
                <YAxis
                  stroke="var(--color-border)"
                  tick={{ fill: "var(--color-foreground)", fontSize: 11 }}
                  tickFormatter={(v: number) => fmtBRL(v)}
                  width={90}
                />
                <Tooltip
                  cursor={{ fill: "var(--color-muted)", opacity: 0.2 }}
                  formatter={(v: number) => [fmtBRL(v), "Investimento"]}
                  contentStyle={{
                    background: "var(--color-card)",
                    border: "1px solid var(--color-border)",
                    borderRadius: 8,
                  }}
                />
                <Bar dataKey="spend" radius={[6, 6, 0, 0]}>
                  {spendByTipo.map((d) => (
                    <Cell key={d.tipo} fill={TIPO_META[d.tipo]?.color ?? "#60a5fa"} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </Card>
      )}

      {/* Tabelas: contas ou drill-down de campanhas */}
      {!isLoading &&
        (accountId === ALL_ACCOUNTS ? (
          <>
            <AccountsTable accounts={accountsForTable} onSelect={setAccountId} />
            {dormantCount > 0 && tipo === ALL_TYPES && (
              <p className="text-xs text-muted-foreground">
                + {dormantCount} conta(s) sem entrega no período (dormentes), disponíveis no seletor
                de contas.
              </p>
            )}
          </>
        ) : (
          <>
            <Button
              variant="ghost"
              size="sm"
              className="gap-1"
              onClick={() => setAccountId(ALL_ACCOUNTS)}
            >
              <ArrowLeft className="h-4 w-4" /> Todas as contas
            </Button>
            <CampaignsTable
              campaigns={filteredCampaigns}
              accountName={selectedAccount?.account_name ?? ""}
            />
          </>
        ))}
    </div>
  );
}

// Soma métricas de um conjunto de campanhas.
function aggregate(rows: CampaignRow[]) {
  return rows.reduce(
    (acc, c) => {
      acc.spend += c.spend;
      acc.clicks += c.clicks;
      acc.link_clicks += c.link_clicks;
      acc.messaging_started += c.messaging_started;
      acc.form_leads += c.form_leads;
      acc.leads += c.leads;
      acc.sales += c.sales;
      acc.revenue += c.revenue;
      acc.impressions += c.impressions;
      return acc;
    },
    {
      spend: 0,
      clicks: 0,
      link_clicks: 0,
      messaging_started: 0,
      form_leads: 0,
      leads: 0,
      sales: 0,
      revenue: 0,
      impressions: 0,
    },
  );
}

// Agrega campanhas (já filtradas por um tipo) em linhas por conta.
function deriveAccounts(rows: CampaignRow[], tipo: TipoConta): AccountRow[] {
  const map = new Map<string, AccountRow>();
  for (const c of rows) {
    let a = map.get(c.account_id);
    if (!a) {
      a = {
        account_id: c.account_id,
        account_name: c.account_name,
        company_id: c.company_id,
        tipo_conta: tipo,
        campaigns: 0,
        spend: 0,
        clicks: 0,
        link_clicks: 0,
        landing_page_views: 0,
        messaging_started: 0,
        form_leads: 0,
        leads: 0,
        sales: 0,
        revenue: 0,
      };
      map.set(c.account_id, a);
    }
    a.campaigns += 1;
    a.spend += c.spend;
    a.clicks += c.clicks;
    a.link_clicks += c.link_clicks;
    a.landing_page_views += c.landing_page_views;
    a.messaging_started += c.messaging_started;
    a.form_leads += c.form_leads;
    a.leads += c.leads;
    a.sales += c.sales;
    a.revenue += c.revenue;
  }
  return [...map.values()].sort((a, b) => b.spend - a.spend);
}
