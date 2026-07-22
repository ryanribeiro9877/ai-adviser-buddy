import { useMemo } from "react";
import { format, parseISO } from "date-fns";
import { ptBR } from "date-fns/locale";
import type { DateRange } from "react-day-picker";
import { CalendarRange, Info, SlidersHorizontal } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { TIPO_META, type TipoConta } from "@/lib/breakdown";
import {
  hasActiveFilters,
  isPeriodNarrowed,
  PRESET_LABEL,
  resolveRange,
  STATUS_LABEL,
  type FilterStatus,
  type PeriodPreset,
} from "@/lib/filters";
import { useGlobalFilters, useSnapshotMinDate } from "@/hooks/use-filters";

const PRESET_OPTIONS: PeriodPreset[] = ["all", "7d", "30d", "month", "custom"];
const STATUS_OPTIONS: FilterStatus[] = ["all", "active", "paused"];

const fmtBR = (iso: string) => format(parseISO(iso), "dd/MM/yyyy", { locale: ptBR });

export function GlobalFilters({
  mode,
  typesPresent,
}: {
  // series = Campanhas/Funil (o período filtra os dados via metric_snapshots)
  // accumulated = Anúncios/Conjuntos (totais acumulados; período só sinaliza)
  mode: "series" | "accumulated";
  typesPresent: TipoConta[];
}) {
  const { filters, setFilters, clearFilters } = useGlobalFilters();
  const minDateQ = useSnapshotMinDate();
  const minDate = minDateQ.data ?? "2026-03-03";

  const range = useMemo(() => resolveRange(filters, minDate), [filters, minDate]);

  const calendarRange: DateRange | undefined =
    range.start && range.end ? { from: parseISO(range.start), to: parseISO(range.end) } : undefined;

  const onPreset = (preset: PeriodPreset) => {
    if (preset === "custom") {
      // entra no modo custom já ancorado no range atualmente exibido
      setFilters({ preset: "custom", start: range.start, end: range.end });
    } else {
      setFilters({ preset, start: undefined, end: undefined });
    }
  };

  const onCalendarSelect = (r: DateRange | undefined) => {
    if (!r?.from) return;
    setFilters({
      preset: "custom",
      start: format(r.from, "yyyy-MM-dd"),
      end: format(r.to ?? r.from, "yyyy-MM-dd"),
    });
  };

  const periodLabel =
    filters.preset === "all"
      ? PRESET_LABEL.all
      : filters.preset === "custom"
        ? `${fmtBR(range.start)} – ${fmtBR(range.end)}`
        : PRESET_LABEL[filters.preset];

  const narrowed = isPeriodNarrowed(filters);

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        <SlidersHorizontal className="h-4 w-4 text-muted-foreground shrink-0" />

        {/* Período */}
        <Popover>
          <PopoverTrigger asChild>
            <Button variant="outline" size="sm" className="gap-2">
              <CalendarRange className="h-4 w-4" />
              <span className="truncate max-w-[220px]">{periodLabel}</span>
            </Button>
          </PopoverTrigger>
          <PopoverContent align="start" className="w-auto p-0">
            <div className="flex flex-col gap-1 border-b border-border p-2 sm:flex-row sm:flex-wrap">
              {PRESET_OPTIONS.map((p) => (
                <Button
                  key={p}
                  variant={filters.preset === p ? "default" : "ghost"}
                  size="sm"
                  className="justify-start"
                  onClick={() => onPreset(p)}
                >
                  {PRESET_LABEL[p]}
                </Button>
              ))}
            </div>
            <div className="p-2">
              <Calendar
                mode="range"
                numberOfMonths={2}
                defaultMonth={calendarRange?.from}
                selected={calendarRange}
                onSelect={onCalendarSelect}
                locale={ptBR}
              />
              <p className="px-1 pb-1 text-xs text-muted-foreground">
                {fmtBR(range.start)} – {fmtBR(range.end)}
              </p>
            </div>
          </PopoverContent>
        </Popover>

        {/* Plataforma — Meta fixo hoje (dropdown preparado para o futuro) */}
        <Select value={filters.platform} disabled>
          <SelectTrigger className="h-8 w-[130px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="meta">Meta Ads</SelectItem>
          </SelectContent>
        </Select>

        {/* Status */}
        <Select
          value={filters.status}
          onValueChange={(v) => setFilters({ status: v as FilterStatus })}
        >
          <SelectTrigger className="h-8 w-[150px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {STATUS_OPTIONS.map((s) => (
              <SelectItem key={s} value={s}>
                {STATUS_LABEL[s]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        {/* Tipo (categoria da campanha) */}
        <Select value={filters.tipo} onValueChange={(v) => setFilters({ tipo: v as TipoConta | "all" })}>
          <SelectTrigger className="h-8 w-[160px]">
            <SelectValue placeholder="Tipo" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todos os tipos</SelectItem>
            {typesPresent.map((t) => (
              <SelectItem key={t} value={t}>
                {TIPO_META[t]?.label ?? t}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        {hasActiveFilters(filters) && (
          <Button
            variant="ghost"
            size="sm"
            className="ml-auto gap-1 text-muted-foreground"
            onClick={clearFilters}
          >
            Limpar filtros
          </Button>
        )}
      </div>

      {/* Aviso: telas acumuladas não têm série diária (F0.1) */}
      {mode === "accumulated" && narrowed && (
        <div
          className={cn(
            "flex items-start gap-2 rounded-md border border-border bg-muted/40 px-3 py-2 text-xs text-muted-foreground",
          )}
        >
          <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          <span>
            Anúncios e conjuntos mostram totais acumulados (desde o início da conta). O filtro de
            período ainda não se aplica a estas telas.
          </span>
        </div>
      )}
    </div>
  );
}
