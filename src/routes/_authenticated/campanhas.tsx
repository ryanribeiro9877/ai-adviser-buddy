import { createFileRoute } from "@tanstack/react-router";
import { useApp, logAudit } from "@/lib/app-context";
import { EmptyCompany } from "@/components/metric-card";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { generateMetrics, fmtBRL, fmtInt, fmtPct, fmtDec } from "@/lib/mock-metrics";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { Pause, Play, TrendingUp, ShieldAlert } from "lucide-react";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogTrigger,
} from "@/components/ui/dialog";
import { useState } from "react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

export const Route = createFileRoute("/_authenticated/campanhas")({
  component: Campanhas,
  head: () => ({ meta: [{ title: "Campanhas" }] }),
});

function seedCampaigns(companyId: string) {
  const providers: Array<"meta_ads" | "google_ads"> = ["meta_ads", "google_ads"];
  const names = ["Black Friday", "Remarketing Site", "Lookalike Compradores", "Search Marca", "Awareness Vídeo", "Prospecção Interesses"];
  return names.map((n, i) => {
    const m = generateMetrics(`${companyId}-${n}`);
    return {
      id: `${companyId}-${i}`,
      name: n,
      provider: providers[i % providers.length],
      status: i === 2 ? "paused" : "active",
      objective: i % 2 === 0 ? "Conversões" : "Tráfego",
      budget: 200 + i * 150,
      ...m,
    };
  });
}

function Campanhas() {
  const { selectedCompany, isAdmin, user } = useApp();
  const [reqOpen, setReqOpen] = useState<string | null>(null);
  if (!selectedCompany) return <EmptyCompany />;
  const rows = seedCampaigns(selectedCompany.id);

  const requestChange = async (campaign: typeof rows[number], action: string, form: FormData) => {
    const summary = `${action === "pause" ? "Pausar" : action === "activate" ? "Ativar" : "Ajustar orçamento"} — ${campaign.name}`;
    const { error } = await supabase.from("approval_requests").insert({
      company_id: selectedCompany.id,
      requested_by: user.id,
      entity_type: "campaign",
      entity_id: null,
      action,
      summary,
      payload: {
        campaign_name: campaign.name,
        new_budget: Number(form.get("budget") || campaign.budget),
        note: String(form.get("note") || ""),
      } as never,
    });
    if (error) return toast.error(error.message);
    await logAudit({
      companyId: selectedCompany.id,
      action: "approval.request",
      targetType: "campaign",
      details: { summary },
    });
    toast.success("Solicitação enviada para aprovação");
    setReqOpen(null);
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Campanhas</h1>
          <p className="text-sm text-muted-foreground">
            Alterações precisam ser aprovadas por um administrador — <span className="inline-flex items-center gap-1"><ShieldAlert className="h-3.5 w-3.5" />leitura por padrão</span>.
          </p>
        </div>
      </div>
      <Card>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Campanha</TableHead>
              <TableHead>Plataforma</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="text-right">Investimento</TableHead>
              <TableHead className="text-right">CTR</TableHead>
              <TableHead className="text-right">CPA</TableHead>
              <TableHead className="text-right">ROAS</TableHead>
              <TableHead className="text-right">Ações</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((c) => (
              <TableRow key={c.id}>
                <TableCell className="font-medium">
                  {c.name}
                  <div className="text-xs text-muted-foreground">{c.objective}</div>
                </TableCell>
                <TableCell>{c.provider === "meta_ads" ? "Meta Ads" : "Google Ads"}</TableCell>
                <TableCell>
                  <Badge variant={c.status === "active" ? "default" : "secondary"}>{c.status === "active" ? "Ativa" : "Pausada"}</Badge>
                </TableCell>
                <TableCell className="text-right tabular-nums">{fmtBRL(c.investment)}</TableCell>
                <TableCell className="text-right tabular-nums">{fmtPct(c.ctr)}</TableCell>
                <TableCell className="text-right tabular-nums">{fmtBRL(c.cpa)}</TableCell>
                <TableCell className="text-right tabular-nums">{fmtDec(c.roas)}x</TableCell>
                <TableCell className="text-right">
                  <Dialog open={reqOpen === c.id} onOpenChange={(o) => setReqOpen(o ? c.id : null)}>
                    <DialogTrigger asChild>
                      <Button size="sm" variant="outline">
                        {c.status === "active" ? <Pause className="h-3.5 w-3.5 mr-1" /> : <Play className="h-3.5 w-3.5 mr-1" />}
                        Solicitar mudança
                      </Button>
                    </DialogTrigger>
                    <DialogContent>
                      <DialogHeader><DialogTitle>Solicitar alteração — {c.name}</DialogTitle></DialogHeader>
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
                            <option value={c.status === "active" ? "pause" : "activate"}>{c.status === "active" ? "Pausar campanha" : "Ativar campanha"}</option>
                            <option value="update_budget">Ajustar orçamento diário</option>
                          </select>
                        </div>
                        <div>
                          <Label>Novo orçamento diário (R$)</Label>
                          <Input name="budget" type="number" min="0" defaultValue={c.budget} />
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
            ))}
          </TableBody>
        </Table>
      </Card>
    </div>
  );
}
