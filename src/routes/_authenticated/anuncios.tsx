import { createFileRoute } from "@tanstack/react-router";
import { useApp } from "@/lib/app-context";
import { EmptyCompany } from "@/components/metric-card";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { useAds } from "@/hooks/use-breakdown";
import { fmtBRL, fmtInt, fmtPct, metaStatus, type AdRow } from "@/lib/breakdown";
import { Image as ImageIcon, ExternalLink } from "lucide-react";

export const Route = createFileRoute("/_authenticated/anuncios")({
  component: Anuncios,
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

function AdCard({ ad }: { ad: AdRow }) {
  const st = metaStatus(ad.status);
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
        <Badge variant={st.variant} className="shrink-0">{st.label}</Badge>
      </div>
      <div className="mt-1 flex items-center gap-2 text-xs text-muted-foreground">
        {ad.object_type && <span className="uppercase">{ad.object_type}</span>}
        {ad.call_to_action_type && (
          <span className="rounded bg-muted px-1.5 py-0.5">{ad.call_to_action_type}</span>
        )}
      </div>
      <div className="grid grid-cols-4 gap-2 mt-3">
        <Stat label="Gasto" value={fmtBRL(ad.spend)} />
        <Stat label="Leads" value={fmtInt(ad.leads)} />
        <Stat label="CPL" value={ad.leads > 0 ? fmtBRL(ad.spend / ad.leads) : "—"} />
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
  const adsQ = useAds(selectedCompany?.id ?? null);
  const ads = adsQ.data ?? [];

  if (!selectedCompany) return <EmptyCompany />;

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-semibold">Anúncios e criativos</h1>
        <p className="text-sm text-muted-foreground">
          Performance por criativo · {selectedCompany.name}
          {!adsQ.isLoading && ads.length > 0 ? ` · ${ads.length} anúncio(s)` : ""}
        </p>
      </div>

      {adsQ.isLoading ? (
        <div className="grid md:grid-cols-2 xl:grid-cols-3 gap-4">
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} className="h-[260px] rounded-xl" />
          ))}
        </div>
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
          {ads.map((ad) => (
            <AdCard key={ad.id} ad={ad} />
          ))}
        </div>
      )}
    </div>
  );
}
