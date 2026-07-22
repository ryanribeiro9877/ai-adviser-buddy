import { createFileRoute } from "@tanstack/react-router";
import { useApp, logAudit } from "@/lib/app-context";
import { EmptyCompany } from "@/components/metric-card";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { TypeBadge } from "@/components/type-badge";
import { GlobalFilters } from "@/components/global-filters";
import { useGlobalFilters, useSnapshotMinDate } from "@/hooks/use-filters";
import { usePeriodCampaigns } from "@/hooks/use-period";
import { fmtBRL, fmtInt, fmtPct, fmtDec, TIPO_ORDER, type CampaignRow, type TipoConta } from "@/lib/breakdown";
import { matchesStatus, resolveRange, validateFilterSearch } from "@/lib/filters";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { Pause, Play, TrendingUp, ShieldAlert } from "lucide-react";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogTrigger,
} from "@/components/ui/dialog";
import { useMemo, useState } from "react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

export const Route = createFileRoute("/_authenticated/campanhas")({
  component: Campanhas,
  validateSearch: validateFilterSearch,
  head: () => ({ meta: [{ title: "Campanhas" }] }),
});

// CTR = clicks / impressions * 100 (protege impressions = 0)
function ctr(c: CampaignRow): string {
  return c.impressions > 0 ? fmtPct((c.clicks / c.impressions) * 100) : "—";
}

// Status "active"/"paused" (Meta) -> rótulo pt-BR
function statusLabel(s: string): string {
  const k = s.toLowerCase();
  if (k === "active") return "Ativa";
  if (k === "paused") return "Pausada";
  if (k === "archived") return "Arquivada";
  return s || "—";
}

function Campanhas() {
  const { selectedCompany, isAdmin, user } = useApp();
  const [reqOpen, setReqOpen] = useState<string | null>(null);

  const { filters } = useGlobalFilters();
  const minDate = useSnapshotMinDate().data ?? "2026-03-03";
  const range = useMemo(() => resolveRange(filters, minDate), [filters, minDate]);

  const campaignsQ = usePeriodCampaigns(selectedCompany?.id ?? null, range);
  const allRows = campaignsQ.data;

  // Tipos presentes (para o dropdown de tipo), na ordem canônica.
  const typesPresent = useMemo<TipoConta[]>(() => {
    const present = new Set(allRows.map((c) => c.tipo));
    return TIPO_ORDER.filter((t) => present.has(t));
  }, [allRows]);

  // Aplica status + tipo (empresa e período já entram na query).
  const rows = useMemo(
    () =>
      allRows.filter(
        (c) =>
          matchesStatus(c.status, filters.status) &&
          (filters.tipo === "all" || c.tipo === filters.tipo),
      ),
    [allRows, filters.status, filters.tipo],
  );

  // Só mostra colunas de receita quando existe venda de verdade (e-commerce).
  const hasRevenue = rows.some((c) => c.sales > 0 || c.revenue > 0);

  const requestChange = async (campaign: CampaignRow, action: string, form: FormData) => {
    if (!selectedCompany) return;
    const summary = `${action === "pause" ? "Pausar" : action === "activate" ? "Ativar" : "Ajustar orçamento"} — ${campaign.campanha}`;
    const budgetRaw = form.get("budget");
    const { error } = await supabase.from("approval_requests").insert({
      company_id: selectedCompany.id,
      requested_by: user.id,
      entity_type: "campaign",
      entity_id: campaign.campaign_id || null,
      action,
      summary,
      payload: {
        campaign_id: campaign.campaign_id,
        campaign_name: campaign.campanha,
        new_budget: budgetRaw ? Number(budgetRaw) : null,
        note: String(form.get("note") || ""),
      } as never,
    });
    if (error) return toast.error(error.message);
    await logAudit({
      companyId: selectedCompany.id,
      action: "approval.request",
      targetType: "campaign",
      targetId: campaign.campaign_id,
      details: { summary },
    });
    toast.success("Solicitação enviada para aprovação");
    setReqOpen(null);
  };

  if (!selectedCompany) return <EmptyCompany />;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Campanhas</h1>
          <p className="text-sm text-muted-foreground">
            {selectedCompany.name} · alterações precisam ser aprovadas por um administrador —{" "}
            <span className="inline-flex items-center gap-1">
              <ShieldAlert className="h-3.5 w-3.5" />leitura por padrão
            </span>.
          </p>
        </div>
      </div>

      <GlobalFilters mode="series" typesPresent={typesPresent} />

      {campaignsQ.isLoading ? (
        <Skeleton className="h-64 rounded-xl" />
      ) : (
        <Card className="p-0 overflow-hidden">
          <div className="flex items-center justify-between px-5 py-4 border-b border-border">
            <h2 className="font-semibold">Todas as campanhas</h2>
            <span className="text-xs text-muted-foreground">{rows.length} campanha(s)</span>
          </div>
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Campanha</TableHead>
                  <TableHead>Conta</TableHead>
                  <TableHead>Tipo</TableHead>
                  <TableHead>Plataforma</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Investimento</TableHead>
                  <TableHead className="text-right">CTR</TableHead>
                  <TableHead className="text-right">Leads</TableHead>
                  <TableHead className="text-right">CPL</TableHead>
                  {hasRevenue && <TableHead className="text-right">ROAS</TableHead>}
                  <TableHead className="text-right">Ações</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.length === 0 && (
                  <TableRow>
                    <TableCell
                      colSpan={hasRevenue ? 11 : 10}
                      className="text-center text-sm text-muted-foreground py-10"
                    >
                      Nenhuma campanha para esta empresa.
                    </TableCell>
                  </TableRow>
                )}
                {rows.map((c) => {
                  const isActive = c.status.toLowerCase() === "active";
                  return (
                    <TableRow key={c.campaign_id}>
                      <TableCell className="font-medium max-w-[260px] truncate">{c.campanha}</TableCell>
                      <TableCell className="max-w-[160px] truncate text-sm text-muted-foreground">
                        {c.account_name}
                      </TableCell>
                      <TableCell><TypeBadge tipo={c.tipo} /></TableCell>
                      <TableCell className="text-sm">Meta Ads</TableCell>
                      <TableCell>
                        <Badge variant={isActive ? "default" : "secondary"}>{statusLabel(c.status)}</Badge>
                      </TableCell>
                      <TableCell className="text-right tabular-nums">{fmtBRL(c.spend)}</TableCell>
                      <TableCell className="text-right tabular-nums">{ctr(c)}</TableCell>
                      <TableCell className="text-right tabular-nums">{fmtInt(c.leads)}</TableCell>
                      <TableCell className="text-right tabular-nums">
                        {c.leads > 0 ? fmtBRL(c.cpl ?? c.spend / c.leads) : "—"}
                      </TableCell>
                      {hasRevenue && (
                        <TableCell className="text-right tabular-nums">
                          {c.revenue > 0
                            ? `${fmtDec(c.revenue / Math.max(c.spend, 1))}x`
                            : "—"}
                        </TableCell>
                      )}
                      <TableCell className="text-right">
                        <Dialog open={reqOpen === c.campaign_id} onOpenChange={(o) => setReqOpen(o ? c.campaign_id : null)}>
                          <DialogTrigger asChild>
                            <Button size="sm" variant="outline">
                              {isActive ? <Pause className="h-3.5 w-3.5 mr-1" /> : <Play className="h-3.5 w-3.5 mr-1" />}
                              Solicitar mudança
                            </Button>
                          </DialogTrigger>
                          <DialogContent>
                            <DialogHeader><DialogTitle>Solicitar alteração — {c.campanha}</DialogTitle></DialogHeader>
                            <form
                              onSubmit={(e) => {
                                e.preventDefault();
                                const form = new FormData(e.currentTarget);
                                const action = String(form.get("action") || "pause");
                                requestChange(c, action, form);
                              }}
                              className="space-y-3"
                            >
                              <div>
                                <Label>Ação</Label>
                                <select name="action" className="w-full h-9 rounded-md border border-input bg-background px-3 text-sm">
                                  <option value={isActive ? "pause" : "activate"}>{isActive ? "Pausar campanha" : "Ativar campanha"}</option>
                                  <option value="update_budget">Ajustar orçamento diário</option>
                                </select>
                              </div>
                              <div>
                                <Label>Novo orçamento diário (R$)</Label>
                                <Input name="budget" type="number" min="0" step="0.01" placeholder="Opcional" />
                              </div>
                              <div>
                                <Label>Justificativa</Label>
                                <Textarea name="note" placeholder="Explique o motivo…" required />
                              </div>
                              <DialogFooter>
                                <Button type="submit"><TrendingUp className="h-4 w-4 mr-2" />Enviar para aprovação</Button>
                              </DialogFooter>
                              {!isAdmin && (
                                <p className="text-xs text-muted-foreground">Você é visualizador. Um administrador precisará aprovar antes que a mudança ocorra.</p>
                              )}
                            </form>
                          </DialogContent>
                        </Dialog>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        </Card>
      )}
    </div>
  );
}
