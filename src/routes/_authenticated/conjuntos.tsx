import { createFileRoute } from "@tanstack/react-router";
import { useMemo } from "react";
import { useApp } from "@/lib/app-context";
import { EmptyCompany } from "@/components/metric-card";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { GlobalFilters } from "@/components/global-filters";
import { useGlobalFilters } from "@/hooks/use-filters";
import { useAdSets, useCampaignBreakdown } from "@/hooks/use-breakdown";
import {
  fmtBRL,
  fmtInt,
  fmtPct,
  fmtBudget,
  metaStatus,
  summarizeTargeting,
  TIPO_ORDER,
  type AdSetRow,
  type TipoConta,
} from "@/lib/breakdown";
import { matchesStatus, validateFilterSearch } from "@/lib/filters";
import { Target, Sparkles } from "lucide-react";

export const Route = createFileRoute("/_authenticated/conjuntos")({
  component: Conjuntos,
  validateSearch: validateFilterSearch,
  head: () => ({ meta: [{ title: "Conjuntos e públicos" }] }),
});

function ctr(s: AdSetRow): string {
  return s.impressions > 0 ? fmtPct((s.clicks / s.impressions) * 100) : "—";
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-[10px] uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className="font-semibold tabular-nums">{value}</div>
    </div>
  );
}

function AdSetCard({ s }: { s: AdSetRow }) {
  const st = metaStatus(s.status);
  const { chips, advantagePlus } = summarizeTargeting(s.targeting);
  return (
    <Card className="p-4 flex flex-col">
      <div className="flex items-start justify-between gap-2">
        <div className="font-semibold text-sm line-clamp-2">{s.name}</div>
        <div className="flex flex-col items-end gap-1 shrink-0">
          <Badge variant={st.variant}>{st.label}</Badge>
          {advantagePlus && (
            <Badge className="gap-1 bg-violet-500/15 text-violet-400 border-violet-500/30" variant="outline">
              <Sparkles className="h-3 w-3" /> Advantage+
            </Badge>
          )}
        </div>
      </div>

      {/* Público */}
      {chips.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-1.5">
          {chips.map((c, i) => (
            <span
              key={i}
              className="rounded-full border border-border bg-muted/40 px-2 py-0.5 text-[11px] text-muted-foreground"
            >
              {c}
            </span>
          ))}
        </div>
      )}

      {/* Orçamento / estratégia */}
      <div className="mt-3 grid grid-cols-3 gap-2 border-t border-border pt-3">
        <Stat label="Orç. diário" value={fmtBudget(s.daily_budget)} />
        <Stat label="Orç. total" value={fmtBudget(s.lifetime_budget)} />
        <Stat label="Lance" value={s.bid_strategy ? s.bid_strategy.replace(/_/g, " ").toLowerCase() : "—"} />
      </div>

      {/* Métricas */}
      <div className="mt-3 grid grid-cols-4 gap-2">
        <Stat label="Gasto" value={fmtBRL(s.spend)} />
        <Stat label="Leads" value={fmtInt(s.leads)} />
        <Stat label="CPL" value={s.leads > 0 ? fmtBRL(s.spend / s.leads) : "—"} />
        <Stat label="CTR" value={ctr(s)} />
      </div>
    </Card>
  );
}

function Conjuntos() {
  const { selectedCompany } = useApp();
  const { filters } = useGlobalFilters();
  const adSetsQ = useAdSets(selectedCompany?.id ?? null);
  const metaQ = useCampaignBreakdown(selectedCompany?.id ?? null);

  // tipo (categoria) vem da campanha-mãe (ad_sets não carregam categoria).
  const tipoByCampaign = useMemo(() => {
    const m = new Map<string, TipoConta>();
    for (const c of metaQ.data ?? []) m.set(c.campaign_id, c.tipo);
    return m;
  }, [metaQ.data]);

  const typesPresent = useMemo<TipoConta[]>(() => {
    const present = new Set(metaQ.data?.map((c) => c.tipo) ?? []);
    return TIPO_ORDER.filter((t) => present.has(t));
  }, [metaQ.data]);

  const adSets = useMemo(
    () =>
      (adSetsQ.data ?? []).filter(
        (s) =>
          matchesStatus(s.status, filters.status) &&
          (filters.tipo === "all" || tipoByCampaign.get(s.campaign_id ?? "") === filters.tipo),
      ),
    [adSetsQ.data, filters.status, filters.tipo, tipoByCampaign],
  );

  if (!selectedCompany) return <EmptyCompany />;

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-semibold">Conjuntos e públicos</h1>
        <p className="text-sm text-muted-foreground">
          Segmentações por conjunto de anúncios · {selectedCompany.name}
          {!adSetsQ.isLoading && adSets.length > 0 ? ` · ${adSets.length} conjunto(s)` : ""}
        </p>
      </div>

      <GlobalFilters mode="accumulated" typesPresent={typesPresent} />

      {adSetsQ.isLoading ? (
        <div className="grid md:grid-cols-2 gap-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-[220px] rounded-xl" />
          ))}
        </div>
      ) : adSets.length === 0 ? (
        <Card className="p-10 text-center">
          <Target className="h-8 w-8 mx-auto text-muted-foreground/60" />
          <div className="mt-3 font-medium">Nenhum conjunto para esta empresa</div>
          <p className="mt-1 text-sm text-muted-foreground max-w-md mx-auto">
            Esta empresa não tem conjuntos de anúncios com entrega no período.
          </p>
        </Card>
      ) : (
        <div className="grid md:grid-cols-2 gap-4">
          {adSets.map((s) => (
            <AdSetCard key={s.id} s={s} />
          ))}
        </div>
      )}
    </div>
  );
}
