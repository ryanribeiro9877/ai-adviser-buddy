import { Card } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { TypeBadge } from "@/components/type-badge";
import { fmtBRL, resultForCampaign, type CampaignRow } from "@/lib/breakdown";

export function CampaignsTable({
  campaigns,
  accountName,
}: {
  campaigns: CampaignRow[];
  accountName: string;
}) {
  return (
    <Card className="p-0 overflow-hidden">
      <div className="flex items-center justify-between px-5 py-4 border-b border-border">
        <div>
          <h2 className="font-semibold">Campanhas</h2>
          <p className="text-xs text-muted-foreground">{accountName}</p>
        </div>
        <span className="text-xs text-muted-foreground">{campaigns.length} campanha(s)</span>
      </div>
      <div className="overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Campanha</TableHead>
              <TableHead>Tipo</TableHead>
              <TableHead className="text-right">Gasto</TableHead>
              <TableHead className="text-right">Resultado</TableHead>
              <TableHead className="text-right">Custo</TableHead>
              <TableHead>Status</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {campaigns.length === 0 && (
              <TableRow>
                <TableCell colSpan={6} className="text-center text-sm text-muted-foreground py-8">
                  Nenhuma campanha para o filtro selecionado.
                </TableCell>
              </TableRow>
            )}
            {campaigns.map((c) => {
              const r = resultForCampaign(c);
              return (
                <TableRow key={c.campaign_id}>
                  <TableCell className="font-medium max-w-[280px] truncate">{c.campanha}</TableCell>
                  <TableCell>
                    <TypeBadge tipo={c.tipo} />
                  </TableCell>
                  <TableCell className="text-right tabular-nums">{fmtBRL(c.spend)}</TableCell>
                  <TableCell className="text-right tabular-nums">
                    <span className="text-foreground">{r.value}</span>
                    <span className="block text-[10px] uppercase tracking-wide text-muted-foreground">
                      {r.label}
                    </span>
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {r.costValue ? (
                      <>
                        <span className="text-foreground">{r.costValue}</span>
                        {r.costLabel && (
                          <span className="block text-[10px] uppercase tracking-wide text-muted-foreground">
                            {r.costLabel}
                          </span>
                        )}
                      </>
                    ) : (
                      "—"
                    )}
                  </TableCell>
                  <TableCell>
                    <Badge
                      variant={c.status === "active" ? "default" : "secondary"}
                      className="capitalize"
                    >
                      {c.status || "—"}
                    </Badge>
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </div>
    </Card>
  );
}
