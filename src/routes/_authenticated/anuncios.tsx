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
import { useDrivePorVideo, useMiniaturasAssinadas } from "@/hooks/use-miniaturas";
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
import { caminhoNosso, textoSemMiniatura, urlDoDrive } from "@/lib/miniatura";
import { FrescorDoEspelho } from "@/components/frescor-do-espelho";
import { PreviaAnuncio } from "@/components/previa-anuncio";
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
  src,
  driveUrl,
  onVer,
}: {
  ad: AdRow;
  campanhaStatus: string | null;
  campanhaEfetivo: string | null;
  src: string | null;
  driveUrl: string | null;
  onVer: () => void;
}) {
  const st = seloDeEntrega({
    status: ad.status,
    effectiveStatus: ad.effective_status,
    campaignStatus: campanhaStatus,
    campaignEffective: campanhaEfetivo,
    exigeEfetivo: true,
  });
  const problema = String(ad.effective_status ?? "").toUpperCase() === "WITH_ISSUES";
  return (
    <Card className={`p-4 flex flex-col ${problema ? "border-destructive ring-1 ring-destructive/40" : ""}`}>
      <div className="aspect-video rounded-lg overflow-hidden bg-accent/40 flex items-center justify-center">
        {src ? (
          <img src={src} alt={ad.name} className="h-full w-full object-cover" loading="lazy" />
        ) : (
          <div data-testid="lugar-vazio" className="px-4 text-center">
            <div className="text-sm font-medium line-clamp-3">{ad.name}</div>
            <p className="mt-1 text-xs text-muted-foreground">{textoSemMiniatura(ad.miniatura_motivo)}</p>
          </div>
        )}
      </div>
      {problema && (
        <p className="mt-3 text-xs text-destructive">
          Com problema na Meta. Pode derrubar a entrega do conjunto inteiro.
        </p>
      )}
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
        <Stat label="Formulários" value={fmtInt(ad.form_leads)} />
        <Stat label="Conversas" value={fmtInt(ad.messaging_started)} />
        <Stat label="CTR" value={ctr(ad)} />
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-3">
        <Button type="button" size="sm" variant="outline" onClick={onVer}>
          Ver anúncio
        </Button>
        {driveUrl && (
          <a
            href={driveUrl}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1 text-xs text-primary hover:underline"
          >
            <ExternalLink className="h-3.5 w-3.5" /> Abrir no Drive
          </a>
        )}
        {ad.permalink_url && (
          <a
            href={ad.permalink_url}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1 text-xs text-primary hover:underline"
          >
            <ExternalLink className="h-3.5 w-3.5" /> Ver post
          </a>
        )}
      </div>
    </Card>
  );
}

function estadoDoFiltro(ad: AdRow, camp: { status: string; effective: string | null } | undefined) {
  return {
    status: ad.status,
    effectiveStatus: ad.effective_status,
    campaignStatus: camp?.status,
    campaignEffective: camp?.effective,
    exigeEfetivo: true,
  };
}

function Anuncios() {
  const { selectedCompany } = useApp();
  const { filters } = useGlobalFilters();
  const [ordem, setOrdem] = useState<OrdemDaLista>("recentes");
  const [previa, setPrevia] = useState<AdRow | null>(null);
  const adsQ = useAds(selectedCompany?.id ?? null);
  const metaQ = useCampaignBreakdown(selectedCompany?.id ?? null);
  const drivesQ = useDrivePorVideo(selectedCompany?.id ?? null);

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

  const daEmpresa = useMemo(() => {
    return (adsQ.data ?? []).filter(
      (a) => filters.tipo === "all" || tipoByCampaign.get(a.campaign_id ?? "") === filters.tipo,
    );
  }, [adsQ.data, filters.tipo, tipoByCampaign]);

  const comProblema = useMemo(
    () => daEmpresa.filter((a) => String(a.effective_status ?? "").toUpperCase() === "WITH_ISSUES"),
    [daEmpresa],
  );

  const ads = useMemo(() => {
    const filtrados = daEmpresa.filter((a) => {
      if (String(a.effective_status ?? "").toUpperCase() === "WITH_ISSUES") return false;
      const camp = campanhaById.get(a.campaign_id ?? "");
      return matchesStatus(statusParaFiltro(estadoDoFiltro(a, camp)), filters.status);
    });
    return ordenarLinhas(filtrados, ordem);
  }, [daEmpresa, filters.status, campanhaById, ordem]);

  const caminhos = useMemo(() => {
    const ids = new Set<string>();
    for (const ad of [...comProblema, ...ads]) {
      const caminho = caminhoNosso(ad.thumbnail_url);
      if (caminho) ids.add(caminho);
    }
    return [...ids];
  }, [comProblema, ads]);
  const assinadasQ = useMiniaturasAssinadas(caminhos);
  const assinadas = assinadasQ.data ?? {};

  function srcDe(ad: AdRow): string | null {
    const caminho = caminhoNosso(ad.thumbnail_url);
    return caminho ? assinadas[caminho] ?? null : null;
  }

  function driveDe(ad: AdRow): string | null {
    const video = ad.meta_video_id;
    if (!video) return null;
    return urlDoDrive(drivesQ.data?.get(video) ?? null);
  }

  if (!selectedCompany) return <EmptyCompany />;

  const mostrarGrade = !adsQ.isLoading && !adsQ.isError && (ads.length > 0 || comProblema.length > 0);

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
      ) : !mostrarGrade ? (
        <Card className="p-10 text-center">
          <ImageIcon className="h-8 w-8 mx-auto text-muted-foreground/60" />
          <div className="mt-3 font-medium">
            {(adsQ.data?.length ?? 0) > 0 ? "Nenhum anúncio entregando com este filtro" : "Nenhum anúncio para esta empresa"}
          </div>
          <p className="mt-1 text-sm text-muted-foreground max-w-md mx-auto">
            {(adsQ.data?.length ?? 0) > 0
              ? "O filtro Ativas só mostra anúncio que está entregando. Pausado, encerrado ou sem estado coletado fica de fora."
              : "Esta empresa não tem criativos com entrega no período."}
          </p>
        </Card>
      ) : (
        <>
          {comProblema.length > 0 && (
            <section data-testid="anuncios-com-problema" className="space-y-3">
              <h2 className="text-sm font-semibold text-destructive">
                Com problemas na Meta · {comProblema.length}
              </h2>
              <div className="grid md:grid-cols-2 xl:grid-cols-3 gap-4">
                {comProblema.map((ad) => {
                  const camp = campanhaById.get(ad.campaign_id ?? "");
                  return (
                    <AdCard
                      key={ad.id}
                      ad={ad}
                      campanhaStatus={camp?.status ?? null}
                      campanhaEfetivo={camp?.effective ?? null}
                      src={srcDe(ad)}
                      driveUrl={driveDe(ad)}
                      onVer={() => setPrevia(ad)}
                    />
                  );
                })}
              </div>
            </section>
          )}
          {ads.length > 0 ? (
            <div className="grid md:grid-cols-2 xl:grid-cols-3 gap-4">
              {ads.map((ad) => {
                const camp = campanhaById.get(ad.campaign_id ?? "");
                return (
                  <AdCard
                    key={ad.id}
                    ad={ad}
                    campanhaStatus={camp?.status ?? null}
                    campanhaEfetivo={camp?.effective ?? null}
                    src={srcDe(ad)}
                    driveUrl={driveDe(ad)}
                    onVer={() => setPrevia(ad)}
                  />
                );
              })}
            </div>
          ) : (
            <Card className="p-6 text-center text-sm text-muted-foreground">
              Nenhum anúncio entregando com este filtro.
            </Card>
          )}
        </>
      )}

      <PreviaAnuncio
        adId={previa?.id ?? null}
        nome={previa?.name ?? ""}
        aberto={!!previa}
        onFechar={() => setPrevia(null)}
      />
    </div>
  );
}
