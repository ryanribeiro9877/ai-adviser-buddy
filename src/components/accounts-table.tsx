import { Card } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { TypeBadge } from "@/components/type-badge";
import { fmtBRL, fmtInt, type AccountRow } from "@/lib/breakdown";

export function AccountsTable({
  accounts,
  onSelect,
}: {
  accounts: AccountRow[];
  onSelect: (accountId: string) => void;
}) {
  return (
    <Card className="p-0 overflow-hidden">
      <div className="flex items-center justify-between px-5 py-4 border-b border-border">
        <div>
          <h2 className="font-semibold">Contas</h2>
          <p className="text-xs text-muted-foreground">Clique em uma conta para ver as campanhas</p>
        </div>
        <span className="text-xs text-muted-foreground">{accounts.length} conta(s)</span>
      </div>
      <div className="overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Conta</TableHead>
              <TableHead>Tipo</TableHead>
              <TableHead className="text-right">Gasto</TableHead>
              <TableHead className="text-right">Cliques no link</TableHead>
              <TableHead className="text-right">Conversas</TableHead>
              <TableHead className="text-right">Formulário</TableHead>
              <TableHead className="text-right">Leads</TableHead>
              <TableHead className="text-right">CPL</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {accounts.length === 0 && (
              <TableRow>
                <TableCell colSpan={8} className="text-center text-sm text-muted-foreground py-8">
                  Nenhuma conta com dados para o filtro selecionado.
                </TableCell>
              </TableRow>
            )}
            {accounts.map((a) => (
              <TableRow
                key={a.account_id}
                className="cursor-pointer"
                onClick={() => onSelect(a.account_id)}
              >
                <TableCell className="font-medium max-w-[220px] truncate">
                  {a.account_name}
                </TableCell>
                <TableCell>
                  <TypeBadge tipo={a.tipo_conta} />
                </TableCell>
                <TableCell className="text-right tabular-nums">{fmtBRL(a.spend)}</TableCell>
                <TableCell className="text-right tabular-nums">{fmtInt(a.link_clicks)}</TableCell>
                <TableCell className="text-right tabular-nums">
                  {fmtInt(a.messaging_started)}
                </TableCell>
                <TableCell className="text-right tabular-nums">{fmtInt(a.form_leads)}</TableCell>
                <TableCell className="text-right tabular-nums">{fmtInt(a.leads)}</TableCell>
                <TableCell className="text-right tabular-nums">
                  {a.leads > 0 ? fmtBRL(a.spend / a.leads) : "—"}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </Card>
  );
}
