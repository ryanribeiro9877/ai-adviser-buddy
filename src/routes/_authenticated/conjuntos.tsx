import { createFileRoute } from "@tanstack/react-router";
import { useApp } from "@/lib/app-context";
import { EmptyCompany } from "@/components/metric-card";
import { Card } from "@/components/ui/card";
import { Target } from "lucide-react";

export const Route = createFileRoute("/_authenticated/conjuntos")({
  component: Conjuntos,
  head: () => ({ meta: [{ title: "Conjuntos e públicos" }] }),
});

function Conjuntos() {
  const { selectedCompany } = useApp();
  if (!selectedCompany) return <EmptyCompany />;

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-semibold">Conjuntos e públicos</h1>
        <p className="text-sm text-muted-foreground">
          Segmentações por conjunto de anúncios · {selectedCompany.name}
        </p>
      </div>
      <Card className="p-10 text-center">
        <Target className="h-8 w-8 mx-auto text-muted-foreground/60" />
        <div className="mt-3 font-medium">Dados de conjuntos ainda não sincronizados</div>
        <p className="mt-1 text-sm text-muted-foreground max-w-md mx-auto">
          A sincronização atual traz métricas no nível de campanha. Assim que os conjuntos de
          anúncios forem importados, eles aparecerão aqui com público, investimento e resultado.
        </p>
      </Card>
    </div>
  );
}
