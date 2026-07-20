import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useApp } from "@/lib/app-context";
import { EmptyCompany } from "@/components/metric-card";
import { Card } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";

export const Route = createFileRoute("/_authenticated/auditoria")({
  component: Auditoria,
  head: () => ({ meta: [{ title: "Histórico e auditoria" }] }),
});

function Auditoria() {
  const { selectedCompany } = useApp();
  const q = useQuery({
    queryKey: ["audit", selectedCompany?.id],
    enabled: !!selectedCompany,
    queryFn: async () => {
      const { data } = await supabase
        .from("audit_log")
        .select("*, profiles:user_id(email, full_name)")
        .eq("company_id", selectedCompany!.id)
        .order("created_at", { ascending: false })
        .limit(200);
      return data ?? [];
    },
  });

  if (!selectedCompany) return <EmptyCompany />;
  const items = q.data ?? [];

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-semibold">Histórico e auditoria</h1>
        <p className="text-sm text-muted-foreground">Todo evento realizado por usuários autenticados na empresa {selectedCompany.name}.</p>
      </div>
      <Card>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Quando</TableHead>
              <TableHead>Usuário</TableHead>
              <TableHead>Ação</TableHead>
              <TableHead>Alvo</TableHead>
              <TableHead>Detalhes</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {items.map((r) => {
              const prof = (r as unknown as { profiles?: { email?: string } }).profiles;
              return (
                <TableRow key={r.id}>
                  <TableCell className="text-xs">{new Date(r.created_at).toLocaleString("pt-BR")}</TableCell>
                  <TableCell className="text-sm">{prof?.email ?? "—"}</TableCell>
                  <TableCell><Badge variant="outline">{r.action}</Badge></TableCell>
                  <TableCell className="text-sm">{r.target_type ?? "—"}</TableCell>
                  <TableCell className="text-xs text-muted-foreground max-w-md truncate">{JSON.stringify(r.details)}</TableCell>
                </TableRow>
              );
            })}
            {items.length === 0 && (
              <TableRow><TableCell colSpan={5} className="text-center text-sm text-muted-foreground py-6">Nenhum evento registrado.</TableCell></TableRow>
            )}
          </TableBody>
        </Table>
      </Card>
    </div>
  );
}
