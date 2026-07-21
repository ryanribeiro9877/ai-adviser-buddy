import { createFileRoute } from "@tanstack/react-router";
import { useApp } from "@/lib/app-context";
import { EmptyCompany } from "@/components/metric-card";
import { Card } from "@/components/ui/card";
import { Image as ImageIcon } from "lucide-react";

export const Route = createFileRoute("/_authenticated/anuncios")({
  component: Anuncios,
  head: () => ({ meta: [{ title: "Anúncios e criativos" }] }),
});

function Anuncios() {
  const { selectedCompany } = useApp();
  if (!selectedCompany) return <EmptyCompany />;

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-semibold">Anúncios e criativos</h1>
        <p className="text-sm text-muted-foreground">
          Performance por criativo · {selectedCompany.name}
        </p>
      </div>
      <Card className="p-10 text-center">
        <ImageIcon className="h-8 w-8 mx-auto text-muted-foreground/60" />
        <div className="mt-3 font-medium">Dados de criativos ainda não sincronizados</div>
        <p className="mt-1 text-sm text-muted-foreground max-w-md mx-auto">
          A sincronização atual traz métricas no nível de campanha. Assim que os anúncios
          individuais forem importados, cada criativo aparecerá aqui com formato e desempenho.
        </p>
      </Card>
    </div>
  );
}
