import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useApp, logAudit } from "@/lib/app-context";
import { EmptyCompany } from "@/components/metric-card";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { MessagesSquare, Sparkles, Check, X } from "lucide-react";
import { toast } from "sonner";
import { OperacaoChat } from "@/components/operacao-chat";
import { ApprovalsQueue } from "@/components/approvals-queue";

export const Route = createFileRoute("/_authenticated/recomendacoes")({
  component: Operacao,
  head: () => ({ meta: [{ title: "Operação" }] }),
});

function Recomendacoes() {
  const { selectedCompany } = useApp();
  const q = useQuery({
    queryKey: ["reco", selectedCompany?.id],
    enabled: !!selectedCompany,
    queryFn: async () => {
      const { data } = await supabase
        .from("ai_recommendations")
        .select("*")
        .eq("company_id", selectedCompany!.id)
        .order("created_at", { ascending: false });
      return data ?? [];
    },
  });

  const update = async (id: string, status: "accepted" | "dismissed") => {
    await supabase.from("ai_recommendations").update({ status }).eq("id", id);
    await logAudit({
      companyId: selectedCompany!.id,
      action: `recommendation.${status}`,
      targetType: "recommendation",
      targetId: id,
    });
    toast.success(status === "accepted" ? "Recomendação aceita" : "Recomendação descartada");
    q.refetch();
  };

  const items = q.data ?? [];

  return (
    <div className="grid md:grid-cols-2 gap-3">
      {items.map((r) => (
        <Card key={r.id} className="p-4">
          <div className="flex items-start justify-between gap-2">
            <div className="flex items-center gap-2">
              <Sparkles className="h-4 w-4 text-primary" />
              <span className="font-semibold">{r.title}</span>
            </div>
            <Badge variant="outline">{r.impact}</Badge>
          </div>
          <p className="text-sm text-muted-foreground mt-2">{r.description}</p>
          <div className="mt-3 flex items-center justify-between">
            <Badge variant="secondary">{r.category}</Badge>
            <div className="flex gap-2">
              {r.status === "new" ? (
                <>
                  <Button size="sm" variant="ghost" onClick={() => update(r.id, "dismissed")}>
                    <X className="h-4 w-4 mr-1" />
                    Descartar
                  </Button>
                  <Button size="sm" onClick={() => update(r.id, "accepted")}>
                    <Check className="h-4 w-4 mr-1" />
                    Aceitar
                  </Button>
                </>
              ) : (
                <Badge>{r.status === "accepted" ? "Aceita" : "Descartada"}</Badge>
              )}
            </div>
          </div>
        </Card>
      ))}
      {items.length === 0 && (
        <Card className="p-6 text-sm text-muted-foreground md:col-span-2">
          Nenhuma recomendação ativa.
        </Card>
      )}
    </div>
  );
}

function Operacao() {
  const { selectedCompany } = useApp();
  if (!selectedCompany) return <EmptyCompany />;

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-semibold flex items-center gap-2">
          <MessagesSquare className="h-6 w-6 text-primary" />
          Operação
        </h1>
        <p className="text-sm text-muted-foreground">
          Converse com o gestor de tráfego IA sobre os dados reais e acompanhe as recomendações.
        </p>
      </div>

      <Tabs defaultValue="chat">
        <TabsList>
          <TabsTrigger value="chat">Chat do gestor</TabsTrigger>
          <TabsTrigger value="aprovacoes">Aprovações</TabsTrigger>
          <TabsTrigger value="recomendacoes">Recomendações da IA</TabsTrigger>
        </TabsList>
        <TabsContent value="chat" className="mt-4">
          <OperacaoChat />
        </TabsContent>
        <TabsContent value="aprovacoes" className="mt-4">
          <ApprovalsQueue companyId={selectedCompany.id} />
        </TabsContent>
        <TabsContent value="recomendacoes" className="mt-4">
          <Recomendacoes />
        </TabsContent>
      </Tabs>
    </div>
  );
}
