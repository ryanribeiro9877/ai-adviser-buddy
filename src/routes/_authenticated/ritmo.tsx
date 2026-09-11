import { createFileRoute } from "@tanstack/react-router";
import { useApp } from "@/lib/app-context";
import { EmptyCompany } from "@/components/metric-card";

export const Route = createFileRoute("/_authenticated/ritmo")({
  component: Ritmo,
  head: () => ({ meta: [{ title: "Ritmo" }] }),
});

function Ritmo() {
  const { selectedCompany, selectedCompanyId } = useApp();

  if (!selectedCompany || !selectedCompanyId) return <EmptyCompany />;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Ritmo</h1>
        <p className="text-sm text-muted-foreground">
          Força-tarefa da campanha, com uma autorização.
        </p>
      </div>
    </div>
  );
}
