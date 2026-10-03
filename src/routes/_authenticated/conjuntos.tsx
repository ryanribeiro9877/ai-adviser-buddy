import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useApp } from "@/lib/app-context";
import { EmptyCompany } from "@/components/metric-card";
import { FalhaDeCarga } from "@/components/falha-de-carga";
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
  ordenarLinhas,
  seloDeEntrega,
  statusParaFiltro,
  summarizeTargeting,
  TIPO_ORDER,
  type AdSetRow,
  type OrdemDaLista,
  type TipoConta,
} from "@/lib/breakdown";
import { FrescorDoEspelho } from "@/components/frescor-do-espelho";
import { Button } from "@/components/ui/button";
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

function AdSetCard({
  s,
  campanhaStatus,
  campanhaEfetivo,
}: {
  s: AdSetRow;
  campanhaStatus: string | null;
  campanhaEfetivo: string | null;
}) {
  const st = seloDeEntrega({
    status: s.status,
    effectiveStatus: s.effective_status,
    campaignStatus: campanhaStatus,
    campaignEffective: campanhaEfetivo,
  });
  const { chips, advantagePlus } = summarizeTargeting(s.targeting);
  return (
    <Card className="p-4 flex flex-col">
      <div className="flex items-start justify-between gap-2">
        <div className="font-semibold text-sm line-clamp-2">{s.name}</div>
        <div className="flex flex-col items-end gap-1 shrink-0">
          <Badge variant={st.variant}>{st.label}</Badge>
          {advantagePlus && (
            <Badge
              className="gap-1 bg-violet-500/15 text-violet-400 border-violet-500/30"
              variant="outline"
            >
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
        <Stat
          label="Lance"
          value={s.bid_strategy ? s.bid_strategy.replace(/_/g, " ").toLowerCase() : "—"}
        />
      </div>

      {/* Métricas */}
      <div className="mt-3 grid grid-cols-4 gap-2">
        <Stat label="Gasto" value={fmtBRL(s.spend)} />
        {/* Idem anúncios: base declarada, não "leads" somando formulário com conversa. */}
        <Stat label="Formulários" value={fmtInt(s.form_leads)} />
        <Stat label="Conversas" value={fmtInt(s.messaging_started)} />
        <Stat label="CTR" value={ctr(s)} />
      </div>
    </Card>
  );
}

function Conjuntos() {
  const { selectedCompany } = useApp();
  const { filters } = useGlobalFilters();
  const [ordem, setOrdem] = useState<OrdemDaLista>("recentes");
  const adSetsQ = useAdSets(selectedCompany?.id ?? null);
  const metaQ = useCampaignBreakdown(selectedCompany?.id ?? null);

  // tipo (categoria) vem da campanha-mãe (ad_sets não carregam categoria).
  const tipoByCampaign = useMemo(() => {
    const m = new Map<string, TipoConta>();
    for (const c of metaQ.data ?? []) m.set(c.campaign_id, c.tipo);
    return m;
  }, [metaQ.data]);

  const campanhaById = useMemo(() => {
    const m = new Map<string, { status: string; effective: string | null }>();
    for (const c of metaQ.data ?? []) {
      m.set(c.campaign_id, { status: c.status, effective: c.effective_status });
    }
    return m;
  }, [metaQ.data]);

  const typesPresent = useMemo<TipoConta[]>(() => {
    const present = new Set(metaQ.data?.map((c) => c.tipo) ?? []);
    return TIPO_ORDER.filter((t) => present.has(t));
  }, [metaQ.data]);

  const adSets = useMemo(() => {
    const filtrados = (adSetsQ.data ?? []).filter((s) => {
      const camp = campanhaById.get(s.campaign_id ?? "");
      return (
        matchesStatus(
          statusParaFiltro({
            status: s.status,
            effectiveStatus: s.effective_status,
            campaignStatus: camp?.status,
            campaignEffective: camp?.effective,
          }),
          filters.status,
        ) && (filters.tipo === "all" || tipoByCampaign.get(s.campaign_id ?? "") === filters.tipo)
      );
    });
    return ordenarLinhas(filtrados, ordem);
  }, [adSetsQ.data, filters.status, filters.tipo, tipoByCampaign, campanhaById, ordem]);

  if (!selectedCompany) return <EmptyCompany />;

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-semibold">Conjuntos e públicos</h1>
        <p className="text-sm text-muted-foreground">
          Segmentações por conjunto de anúncios · {selectedCompany.name}
          {!adSetsQ.isLoading && adSets.length > 0 ? ` · ${adSets.length} conjunto(s)` : ""}
        </p>
        <FrescorDoEspelho companyId={selectedCompany.id} />
      </div>

      <div className="flex gap-2">
        <Button
          type="button"
          size="sm"
          variant={ordem === "recentes" ? "default" : "outline"}
          onClick={() => setOrdem("recentes")}
        >
          Mais recentes
        </Button>
        <Button
          type="button"
          size="sm"
          variant={ordem === "gasto" ? "default" : "outline"}
          onClick={() => setOrdem("gasto")}
        >
          Maior gasto
        </Button>
      </div>

      <GlobalFilters mode="accumulated" typesPresent={typesPresent} />

      {adSetsQ.isLoading ? (
        <div className="grid md:grid-cols-2 gap-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-[220px] rounded-xl" />
          ))}
        </div>
      ) : adSetsQ.isError ? (
        <FalhaDeCarga
          oQue="os conjuntos desta empresa"
          erro={adSetsQ.error}
          onTentarDeNovo={() => adSetsQ.refetch()}
        />
      ) : adSets.length === 0 ? (
        <Card className="p-10 text-center">
          <Target className="h-8 w-8 mx-auto text-muted-foreground/60" />
          <div className="mt-3 font-medium">Nenhum conjunto para esta empresa</div>
          <p className="mt-1 text-sm text-muted-foreground max-w-md mx-auto">
            Nenhum conjunto nesta conta com o filtro atual.
          </p>
        </Card>
      ) : (
        <div className="grid md:grid-cols-2 gap-4">
          {adSets.map((s) => {
            const camp = campanhaById.get(s.campaign_id ?? "");
            return (
              <AdSetCard
                key={s.id}
                s={s}
                campanhaStatus={camp?.status ?? null}
                campanhaEfetivo={camp?.effective ?? null}
              />
            );
          })}
        </div>
      )}
    </div>
  );
}
