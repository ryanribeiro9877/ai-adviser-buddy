import { createFileRoute, useNavigate, useSearch } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useApp, logAudit } from "@/lib/app-context";
import { EmptyCompany } from "@/components/metric-card";
import { FalhaDeCarga } from "@/components/falha-de-carga";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { MessagesSquare } from "lucide-react";
import { toast } from "sonner";
import { OperacaoChat } from "@/components/operacao-chat";
import { ApprovalsQueue } from "@/components/approvals-queue";
import { RecomendacaoCard } from "@/components/recomendacao-card";
import { rotuloFamiliaRecomendacao } from "@/lib/recomendacao-texto";

export const Route = createFileRoute("/_authenticated/recomendacoes")({
  component: Operacao,
  head: () => ({ meta: [{ title: "Operação" }] }),
});

type RecoRow = {
  id: string;
  title: string;
  description: string;
  impact: string | null;
  category: string | null;
  status: "new" | "accepted" | "dismissed";
  created_at: string;
  signal_key?: string | null;
  entity_type?: string | null;
  entity_id?: string | null;
  entity_name?: string | null;
  evidence_json?: Record<string, unknown> | null;
  suggested_prompt?: string | null;
  maturity_days?: number | null;
  source?: string | null;
  family?: string | null;
};

function Recomendacoes() {
  const { selectedCompany } = useApp();
  const navigate = useNavigate();
  const [statusFilter, setStatusFilter] = useState<"new" | "all" | "accepted" | "dismissed">("new");
  const [familyFilter, setFamilyFilter] = useState<string>("all");

  const q = useQuery({
    queryKey: ["reco", selectedCompany?.id],
    enabled: !!selectedCompany,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("ai_recommendations")
        .select("*")
        .eq("company_id", selectedCompany!.id)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return (data ?? []) as RecoRow[];
    },
  });

  const families = useMemo(() => {
    const set = new Set<string>();
    for (const r of q.data ?? []) {
      if (r.family) set.add(r.family);
      else if (r.category) set.add(r.category);
    }
    return [...set].sort();
  }, [q.data]);

  const items = useMemo(() => {
    let list = q.data ?? [];
    if (statusFilter !== "all") list = list.filter((r) => r.status === statusFilter);
    if (familyFilter !== "all") {
      list = list.filter((r) => (r.family ?? r.category ?? "") === familyFilter);
    }
    return list;
  }, [q.data, statusFilter, familyFilter]);

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

  const openChat = async (r: RecoRow) => {
    await logAudit({
      companyId: selectedCompany!.id,
      action: "recommendation.chat_opened",
      targetType: "recommendation",
      targetId: r.id,
    });
    navigate({
      to: "/recomendacoes",
      search: (prev: Record<string, unknown>): Record<string, unknown> => ({
        ...prev,
        tab: "chat",
        reco: r.id,
      }),
    });
  };

  return (
    <div className="space-y-3">
      <p className="text-sm text-muted-foreground">
        Cada card diz o que está acontecendo, o que fazer e o que o SuperGestor acha de realizar agora.
      </p>
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs text-muted-foreground">Status:</span>
        {(["new", "all", "accepted", "dismissed"] as const).map((s) => (
          <Button
            key={s}
            size="sm"
            variant={statusFilter === s ? "default" : "outline"}
            onClick={() => setStatusFilter(s)}
          >
            {s === "new"
              ? "Novas"
              : s === "all"
                ? "Todas"
                : s === "accepted"
                  ? "Aceitas"
                  : "Descartadas"}
          </Button>
        ))}
        <span className="text-xs text-muted-foreground ml-2">Tipo:</span>
        <Button
          size="sm"
          variant={familyFilter === "all" ? "default" : "outline"}
          onClick={() => setFamilyFilter("all")}
        >
          Todas
        </Button>
        {families.map((f) => (
          <Button
            key={f}
            size="sm"
            variant={familyFilter === f ? "default" : "outline"}
            onClick={() => setFamilyFilter(f)}
          >
            {rotuloFamiliaRecomendacao(f)}
          </Button>
        ))}
      </div>

      {q.isError ? (
        <FalhaDeCarga
          oQue="as recomendações desta empresa"
          erro={q.error}
          onTentarDeNovo={() => void q.refetch()}
        />
      ) : (
      <div className="grid md:grid-cols-2 gap-3">
        {items.map((r) => (
          <RecomendacaoCard
            key={r.id}
            reco={r}
            onChat={() => void openChat(r)}
            onAccept={() => void update(r.id, "accepted")}
            onDismiss={() => void update(r.id, "dismissed")}
          />
        ))}
        {items.length === 0 && (
          <Card className="p-6 text-sm text-muted-foreground md:col-span-2">
            Nenhuma recomendação neste filtro.
          </Card>
        )}
      </div>
      )}
    </div>
  );
}

const ABAS = ["chat", "aprovacoes", "recomendacoes"] as const;
type Aba = (typeof ABAS)[number];

function Operacao() {
  const { selectedCompany } = useApp();
  const navigate = useNavigate();
  const search = useSearch({ strict: false }) as { tab?: string; item?: string; reco?: string };
  const aba: Aba = ABAS.includes(search.tab as Aba) ? (search.tab as Aba) : "chat";

  if (!selectedCompany) return <EmptyCompany />;

  return (
    <div className="space-y-4 max-w-full overflow-x-hidden">
      <div>
        <h1 className="text-2xl font-semibold flex items-center gap-2">
          <MessagesSquare className="h-6 w-6 text-primary" />
          Operação
        </h1>
        <p className="text-sm text-muted-foreground">
          Converse com o gestor de tráfego IA sobre os dados reais e acompanhe as recomendações.
        </p>
      </div>

      <Tabs
        value={aba}
        onValueChange={(v) =>
          navigate({
            to: "/recomendacoes",
            search: (prev: Record<string, unknown>): Record<string, unknown> => ({
              ...prev,
              tab: v,
              reco: v === "chat" ? prev.reco : undefined,
            }),
            replace: true,
          })
        }
      >
        <TabsList>
          <TabsTrigger value="chat">Chat do gestor</TabsTrigger>
          <TabsTrigger value="aprovacoes">Aprovações</TabsTrigger>
          <TabsTrigger value="recomendacoes">Recomendações da IA</TabsTrigger>
        </TabsList>
        <TabsContent value="chat" className="mt-4 max-w-full overflow-x-hidden">
          <OperacaoChat />
        </TabsContent>
        <TabsContent value="aprovacoes" className="mt-4">
          <ApprovalsQueue companyId={selectedCompany.id} destacarId={search.item} />
        </TabsContent>
        <TabsContent value="recomendacoes" className="mt-4">
          <Recomendacoes />
        </TabsContent>
      </Tabs>
    </div>
  );
}
