import { cn } from "@/lib/utils";
import { TIPO_META, type TipoConta } from "@/lib/breakdown";

export const ALL_TYPES = "all";

export function TypeFilter({
  types,
  value,
  onChange,
}: {
  types: TipoConta[]; // tipos presentes nos dados, já ordenados
  value: string; // TipoConta ou ALL_TYPES
  onChange: (v: string) => void;
}) {
  if (types.length === 0) return null;

  const chip = (key: string, label: string, activeClasses: string) => {
    const isActive = value === key;
    return (
      <button
        key={key}
        type="button"
        onClick={() => onChange(key)}
        className={cn(
          "rounded-full border px-3 py-1 text-xs font-medium transition-colors",
          isActive
            ? activeClasses
            : "border-border bg-transparent text-muted-foreground hover:text-foreground hover:border-foreground/30",
        )}
      >
        {label}
      </button>
    );
  };

  return (
    <div className="flex flex-wrap items-center gap-2">
      {chip(ALL_TYPES, "Todos", "border-primary/40 bg-primary/15 text-primary")}
      {types.map((t) => chip(t, TIPO_META[t].label, TIPO_META[t].badge))}
    </div>
  );
}
