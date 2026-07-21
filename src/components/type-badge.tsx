import { cn } from "@/lib/utils";
import { TIPO_META, type TipoConta } from "@/lib/breakdown";

export function TypeBadge({ tipo, className }: { tipo: string; className?: string }) {
  const meta = TIPO_META[tipo as TipoConta] ?? TIPO_META.outro;
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-medium",
        meta.badge,
        className,
      )}
    >
      {meta.label}
    </span>
  );
}
