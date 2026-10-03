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
import { useAds, useCampaignBreakdown } from "@/hooks/use-breakdown";
import {
  fmtBRL,
  fmtInt,
  fmtPct,
  ordenarLinhas,
  seloDeEntrega,
  statusParaFiltro,
  TIPO_ORDER,
  type AdRow,
  type OrdemDaLista,
  type TipoConta,
} from "@/lib/breakdown";
import { FrescorDoEspelho } from "@/components/frescor-do-espelho";
import { Button } from "@/components/ui/button";
import { matchesStatus, validateFilterSearch } from "@/lib/filters";
import { Image as ImageIcon, ExternalLink } from "lucide-react";

export const Route = createFileRoute("/_authenticated/anuncios")({
  component: Anuncios,
  validateSearch: validateFilterSearch,
  head: () => ({ meta: [{ title: "Anúncios e criativos" }] }),
});

function ctr(a: AdRow): string {
  return a.impressions > 0 ? fmtPct((a.clicks / a.impressions) * 100) : "—";
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-[10px] uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className="font-semibold tabular-nums">{value}</div>
    </div>
  );
}

function AdCard({
  ad,
  campanhaStatus,
  campanhaEfetivo,
}: {
  ad: AdRow;
  campanhaStatus: string | null;
  campanhaEfetivo: string | null;
}) {
  const st = seloDeEntrega({
    status: ad.status,
    effectiveStatus: ad.effective_status,
    campaignStatus: campanhaStatus,
    campaignEffective: campanhaEfetivo,
  });
  const thumb = ad.thumbnail_url || ad.image_url;
  return (
    <Card className="p-4 flex flex-col">
      <div className="aspect-video rounded-lg overflow-hidden bg-accent/40 flex items-center justify-center">
        {thumb ? (
          <img src={thumb} alt={ad.name} className="h-full w-full object-cover" loading="lazy" />
        ) : (
          <ImageIcon className="h-6 w-6 text-muted-foreground" />
        )}
      </div>
      <div className="mt-3 flex items-start justify-between gap-2">
        <div className="font-semibold text-sm line-clamp-2">{ad.name}</div>
        <Badge variant={st.variant} className="shrink-0">
          {st.label}
        </Badge>
      </div>
      <div className="mt-1 flex items-center gap-2 text-xs text-muted-foreground">
        {ad.object_type && <span className="uppercase">{ad.object_type}</span>}
        {ad.call_to_action_type && (
          <span className="rounded bg-muted px-1.5 py-0.5">{ad.call_to_action_type}</span>
        )}
      </div>
      <div className="grid grid-cols-4 gap-2 mt-3">
        <Stat label="Gasto" value={fmtBRL(ad.spend)} />
        {/* Formulário e conversa aparecem separados: o anúncio não tem "lead" genérico, e a
            coluna que somava os dois parou de ser atualizada em julho de 2026. */}
        <Stat label="Formulários" value={fmtInt(ad.form_leads)} />
        <Stat label="Conversas" value={fmtInt(ad.messaging_started)} />
        <Stat label="CTR" value={ctr(ad)} />
      </div>
      {ad.permalink_url && (
        <a
          href={ad.permalink_url}
          target="_blank"
          rel="noreferrer"
          className="mt-3 inline-flex items-center gap-1 text-xs text-primary hover:underline"
        >
          <ExternalLink className="h-3.5 w-3.5" /> Ver post
        </a>
      )}
    </Card>
  );
}

function Anuncios() {
  const { selectedCompany } = useApp();
  const { filters } = useGlobalFilters();
  const [ordem, setOrdem] = useState<OrdemDaLista>("recentes");
  const adsQ = useAds(selectedCompany?.id ?? null);
  const metaQ = useCampaignBreakdown(selectedCompany?.id ?? null);

  // tipo (categoria) vem da campanha-mãe (ads não carregam categoria).
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

  const ads = useMemo(() => {
    const filtrados = (adsQ.data ?? []).filter((a) => {
      const camp = campanhaById.get(a.campaign_id ?? "");
      return (
        matchesStatus(
          statusParaFiltro({
            status: a.status,
            effectiveStatus: a.effective_status,
            campaignStatus: camp?.status,
            campaignEffective: camp?.effective,
          }),
          filters.status,
        ) && (filters.tipo === "all" || tipoByCampaign.get(a.campaign_id ?? "") === filters.tipo)
      );
    });
    return ordenarLinhas(filtrados, ordem);
  }, [adsQ.data, filters.status, filters.tipo, tipoByCampaign, campanhaById, ordem]);

  if (!selectedCompany) return <EmptyCompany />;

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-semibold">Anúncios e criativos</h1>
        <p className="text-sm text-muted-foreground">
          Performance por criativo · {selectedCompany.name}
          {!adsQ.isLoading && ads.length > 0 ? ` · ${ads.length} anúncio(s)` : ""}
        </p>
        <FrescorDoEspelho companyId={selectedCompany.id} />
      </div>

      <div className="flex gap-2">
        <Button type="button" size="sm" variant={ordem === "recentes" ? "default" : "outline"} onClick={() => setOrdem("recentes")}>
          Mais recentes
        </Button>
        <Button type="button" size="sm" variant={ordem === "gasto" ? "default" : "outline"} onClick={() => setOrdem("gasto")}>
          Maior gasto
        </Button>
      </div>

      <GlobalFilters mode="accumulated" typesPresent={typesPresent} />

      {adsQ.isLoading ? (
        <div className="grid md:grid-cols-2 xl:grid-cols-3 gap-4">
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} className="h-[260px] rounded-xl" />
          ))}
        </div>
      ) : adsQ.isError ? (
        <FalhaDeCarga
          oQue="os anúncios desta empresa"
          erro={adsQ.error}
          onTentarDeNovo={() => adsQ.refetch()}
        />
      ) : ads.length === 0 ? (
        <Card className="p-10 text-center">
          <ImageIcon className="h-8 w-8 mx-auto text-muted-foreground/60" />
          <div className="mt-3 font-medium">Nenhum anúncio para esta empresa</div>
          <p className="mt-1 text-sm text-muted-foreground max-w-md mx-auto">
            Esta empresa não tem criativos com entrega no período.
          </p>
        </Card>
      ) : (
        <div className="grid md:grid-cols-2 xl:grid-cols-3 gap-4">
          {ads.map((ad) => {
            const camp = campanhaById.get(ad.campaign_id ?? "");
            return (
              <AdCard
                key={ad.id}
                ad={ad}
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
