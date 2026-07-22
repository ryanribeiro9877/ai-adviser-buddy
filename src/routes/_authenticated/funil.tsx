import { createFileRoute } from "@tanstack/react-router";
import { useMemo } from "react";
import { useApp } from "@/lib/app-context";
import { EmptyCompany } from "@/components/metric-card";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { GlobalFilters } from "@/components/global-filters";
import { useGlobalFilters, useSnapshotMinDate } from "@/hooks/use-filters";
import { usePeriodCampaigns } from "@/hooks/use-period";
import { fmtBRL, fmtInt, fmtPct, TIPO_ORDER, type TipoConta } from "@/lib/breakdown";
import { matchesStatus, resolveRange, validateFilterSearch } from "@/lib/filters";
import { HelpCircle, MessageCircle, Clock } from "lucide-react";

export const Route = createFileRoute("/_authenticated/funil")({
  component: Funil,
  validateSearch: validateFilterSearch,
  head: () => ({ meta: [{ title: "Funil e conversões" }] }),
});

// Glossário do Roberto (call): cada etapa ganha um tooltip explicando a origem.
function StageInfo({ text }: { text: string }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button type="button" className="text-muted-foreground/70 hover:text-foreground">
          <HelpCircle className="h-3.5 w-3.5" />
        </button>
      </TooltipTrigger>
      <TooltipContent className="max-w-[260px] text-left">{text}</TooltipContent>
    </Tooltip>
  );
}

function Funil() {
  const { selectedCompany } = useApp();

  const { filters } = useGlobalFilters();
  const minDate = useSnapshotMinDate().data ?? "2026-03-03";
  const range = useMemo(() => resolveRange(filters, minDate), [filters, minDate]);

  const campaignsQ = usePeriodCampaigns(selectedCompany?.id ?? null, range);
  const allRows = campaignsQ.data;

  const typesPresent = useMemo<TipoConta[]>(() => {
    const present = new Set(allRows.map((c) => c.tipo));
    return TIPO_ORDER.filter((t) => present.has(t));
  }, [allRows]);

  // Respeita o filtro global (empresa + período via snapshots; status + tipo aqui).
  const rows = useMemo(
    () =>
      allRows.filter(
        (c) =>
          matchesStatus(c.status, filters.status) &&
          (filters.tipo === "all" || c.tipo === filters.tipo),
      ),
    [allRows, filters.status, filters.tipo],
  );

  // Somatório das campanhas filtradas (a régua do funil).
  const agg = useMemo(() => {
    const sum = (k: "spend" | "impressions" | "clicks" | "link_clicks" | "form_leads" | "messaging_started") =>
      rows.reduce((a, c) => a + c[k], 0);
    return {
      spend: sum("spend"),
      impressions: sum("impressions"),
      clicks: sum("clicks"),
      link_clicks: sum("link_clicks"),
      form_leads: sum("form_leads"),
      messaging_started: sum("messaging_started"),
    };
  }, [rows]);

  // Etapas do funil do Roberto:
  // Impressões → Cliques → Cliques no link (Lead) → Formulários → [Propostas: placeholder]
  type Stage = {
    key: string;
    name: string;
    value: number | null; // null => etapa ainda não integrada (Propostas)
    tip: string;
    cost?: { label: string; value: string } | null;
  };

  const stages: Stage[] = [
    {
      key: "impressions",
      name: "Impressões",
      value: agg.impressions,
      tip: "Quantas vezes os anúncios foram exibidos.",
    },
    {
      key: "clicks",
      name: "Cliques",
      value: agg.clicks,
      tip: "Todos os cliques no anúncio (inclui cliques que não abrem a landing page).",
    },
    {
      key: "link_clicks",
      name: "Cliques no link (Lead)",
      value: agg.link_clicks,
      tip: "Lead = entrou na LP (clicou no link do anúncio).",
      cost:
        agg.link_clicks > 0
          ? { label: "Custo por lead", value: fmtBRL(agg.spend / agg.link_clicks) }
          : null,
    },
    {
      key: "form_leads",
      name: "Formulários",
      value: agg.form_leads,
      tip: "Formulário = preencheu as etapas e enviou (evento do pixel).",
      cost:
        agg.form_leads > 0
          ? { label: "Custo por formulário", value: fmtBRL(agg.spend / agg.form_leads) }
          : null,
    },
    {
      key: "propostas",
      name: "Propostas",
      value: null,
      tip: "Proposta = gerada no Dash da Legal. Integração prevista para a Fase 1.",
    },
  ];

  if (!selectedCompany) return <EmptyCompany />;

  const max = agg.impressions || 1;
  const hasData = agg.impressions > 0 || agg.clicks > 0 || agg.messaging_started > 0;

  // Valor da etapa anterior (para taxa de conversão), pulando placeholders.
  const prevValue = (i: number): number | null => {
    for (let j = i - 1; j >= 0; j--) {
      if (stages[j].value != null) return stages[j].value;
    }
    return null;
  };

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-semibold">Funil e conversões</h1>
        <p className="text-sm text-muted-foreground">
          Impressões → Cliques → Lead → Formulários → Propostas · {selectedCompany.name}
        </p>
      </div>

      <GlobalFilters mode="series" typesPresent={typesPresent} />

      {campaignsQ.isLoading ? (
        <Skeleton className="h-64 rounded-xl" />
      ) : !hasData ? (
        <Card className="p-6 text-sm text-muted-foreground">
          Sem dados de entrega para esta empresa no período selecionado.
        </Card>
      ) : (
        <>
          <Card className="p-6 space-y-3">
            {stages.map((s, i) => {
              const placeholder = s.value == null;
              const pct = placeholder ? 0 : Math.min(100, ((s.value as number) / max) * 100);
              const prev = prevValue(i);
              const rate =
                i > 0 && !placeholder && prev && prev > 0 ? ((s.value as number) / prev) * 100 : null;
              return (
                <div key={s.key}>
                  <div className="flex items-center justify-between text-sm mb-1">
                    <div className="flex items-center gap-1.5 font-medium">
                      {s.name}
                      <StageInfo text={s.tip} />
                    </div>
                    <div className="flex items-center gap-3">
                      {placeholder ? (
                        <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
                          <Clock className="h-3 w-3" /> aguardando integração
                        </span>
                      ) : (
                        <>
                          {s.cost && (
                            <span className="text-xs text-muted-foreground">
                              {s.cost.label}: <span className="tabular-nums">{s.cost.value}</span>
                            </span>
                          )}
                          {rate != null && (
                            <span className="text-xs text-muted-foreground">
                              conv. {fmtPct(rate)}
                            </span>
                          )}
                          <span className="tabular-nums font-medium">{fmtInt(s.value as number)}</span>
                        </>
                      )}
                    </div>
                  </div>
                  <div
                    className={
                      placeholder
                        ? "h-9 rounded-md border border-dashed border-border bg-muted/20"
                        : "h-9 rounded-md bg-muted overflow-hidden"
                    }
                  >
                    {!placeholder && (
                      <div
                        className="h-full bg-gradient-to-r from-primary to-[color:var(--color-chart-2)]"
                        style={{ width: `${pct}%` }}
                      />
                    )}
                  </div>
                </div>
              );
            })}
          </Card>

          {/* Linha separada: conversas de WhatsApp não entram na régua acima. */}
          <Card className="p-5">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-center gap-2">
                <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-emerald-500/15 text-emerald-400">
                  <MessageCircle className="h-4 w-4" />
                </div>
                <div>
                  <div className="flex items-center gap-1.5 font-medium">
                    Conversas (WhatsApp)
                    <StageInfo text="Conversa = iniciou conversa no WhatsApp. Fica em linha separada — não entra na régua Impressões → Formulários." />
                  </div>
                  <div className="text-xs text-muted-foreground">
                    Iniciadas a partir dos anúncios de mensagem
                  </div>
                </div>
              </div>
              <div className="flex items-center gap-6">
                <div className="text-right">
                  <div className="text-[10px] uppercase tracking-wide text-muted-foreground">
                    Conversas
                  </div>
                  <div className="text-lg font-semibold tabular-nums">
                    {fmtInt(agg.messaging_started)}
                  </div>
                </div>
                <div className="text-right">
                  <div className="text-[10px] uppercase tracking-wide text-muted-foreground">
                    Custo por conversa
                  </div>
                  <div className="text-lg font-semibold tabular-nums">
                    {agg.messaging_started > 0 ? fmtBRL(agg.spend / agg.messaging_started) : "—"}
                  </div>
                </div>
              </div>
            </div>
          </Card>
        </>
      )}
    </div>
  );
}
