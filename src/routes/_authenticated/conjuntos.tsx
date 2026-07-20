import { createFileRoute } from "@tanstack/react-router";
import { useApp } from "@/lib/app-context";
import { EmptyCompany } from "@/components/metric-card";
import { Card } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { fmtBRL, fmtInt, fmtPct, generateMetrics } from "@/lib/mock-metrics";

export const Route = createFileRoute("/_authenticated/conjuntos")({
  component: Conjuntos,
  head: () => ({ meta: [{ title: "Conjuntos e públicos" }] }),
});

function Conjuntos() {
  const { selectedCompany } = useApp();
  if (!selectedCompany) return <EmptyCompany />;
  const audiences = [
    { name: "Lookalike 1% — Compradores 90d", size: 2100000, type: "Lookalike", spend: 8400, ctr: 1.9 },
    { name: "Remarketing — Visitou checkout", size: 42000, type: "Custom", spend: 3120, ctr: 3.1 },
    { name: "Interesses — Fitness + Nutrição", size: 8500000, type: "Interesse", spend: 4200, ctr: 0.9 },
    { name: "Lookalike 3% — Leads formulário", size: 6300000, type: "Lookalike", spend: 5100, ctr: 1.4 },
    { name: "Retention — Clientes 30d", size: 18000, type: "Custom", spend: 1250, ctr: 4.2 },
  ];

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-semibold">Conjuntos e públicos</h1>
        <p className="text-sm text-muted-foreground">Segmentações ativas por campanha da empresa {selectedCompany.name}.</p>
      </div>
      <Card>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Público</TableHead>
              <TableHead>Tipo</TableHead>
              <TableHead className="text-right">Tamanho</TableHead>
              <TableHead className="text-right">Investimento</TableHead>
              <TableHead className="text-right">CTR</TableHead>
              <TableHead>Status</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {audiences.map((a) => (
              <TableRow key={a.name}>
                <TableCell className="font-medium">{a.name}</TableCell>
                <TableCell><Badge variant="outline">{a.type}</Badge></TableCell>
                <TableCell className="text-right tabular-nums">{fmtInt(a.size)}</TableCell>
                <TableCell className="text-right tabular-nums">{fmtBRL(a.spend)}</TableCell>
                <TableCell className="text-right tabular-nums">{fmtPct(a.ctr)}</TableCell>
                <TableCell><Badge>Ativo</Badge></TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Card>
    </div>
  );
}
