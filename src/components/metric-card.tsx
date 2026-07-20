import { Card } from "@/components/ui/card";
import type { LucideIcon } from "lucide-react";

export function MetricCard({
  label,
  value,
  hint,
  icon: Icon,
  tone = "default",
}: {
  label: string;
  value: string;
  hint?: string;
  icon?: LucideIcon;
  tone?: "default" | "success" | "warning" | "destructive";
}) {
  const toneColor =
    tone === "success"
      ? "text-[color:var(--color-success)]"
      : tone === "warning"
        ? "text-[color:var(--color-warning)]"
        : tone === "destructive"
          ? "text-destructive"
          : "text-primary";
  return (
    <Card className="p-4 border-border bg-card">
      <div className="flex items-start justify-between gap-2">
        <div className="text-xs uppercase tracking-wider text-muted-foreground">{label}</div>
        {Icon && <Icon className={`h-4 w-4 ${toneColor}`} />}
      </div>
      <div className="mt-2 text-2xl font-semibold tabular-nums">{value}</div>
      {hint && <div className="mt-1 text-xs text-muted-foreground">{hint}</div>}
    </Card>
  );
}

export function EmptyCompany() {
  return (
    <Card className="p-8 text-center">
      <div className="text-lg font-semibold">Selecione ou cadastre uma empresa</div>
      <p className="mt-2 text-sm text-muted-foreground">
        Adicione sua primeira empresa em <span className="text-foreground">Empresas e contas</span> para visualizar métricas e conectar plataformas.
      </p>
    </Card>
  );
}
