import { createFileRoute, useNavigate, useSearch } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useApp, logAudit } from "@/lib/app-context";
import { EmptyCompany } from "@/components/metric-card";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { MessagesSquare, Sparkles, Check, X, MessageSquare } from "lucide-react";
import { toast } from "sonner";
import { OperacaoChat } from "@/components/operacao-chat";
import { ApprovalsQueue } from "@/components/approvals-queue";

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

function evidencePreview(ev: Record<string, unknown> | null | undefined): string[] {
  if (!ev) return [];
  const skip = new Set(["fonte", "legenda", "base_clique", "janela"]);
  const lines: string[] = [];
  for (const [k, v] of Object.entries(ev)) {
    if (skip.has(k) || v == null || typeof v === "object") continue;
    lines.push(`${k}: ${String(v)}`);
    if (lines.length >= 4) break;
  }
  if (ev.fonte) lines.unshift(`fonte: ${String(ev.fonte)}`);
  if (ev.base_clique) lines.push(`base_clique: ${String(ev.base_clique)}`);
  return lines.slice(0, 5);
}

function Recomendacoes() {
  const { selectedCompany } = useApp();
  const navigate = useNavigate();
  const [statusFilter, setStatusFilter] = useState<"new" | "all" | "accepted" | "dismissed">("new");
  const [familyFilter, setFamilyFilter] = useState<string>("all");

  const q = useQuery({
    queryKey: ["reco", selectedCompany?.id],
    enabled: !!selectedCompany,
    queryFn: async () => {
      const { data } = await supabase
        .from("ai_recommendations")
        .select("*")
        .eq("company_id", selectedCompany!.id)
        .order("created_at", { ascending: false });
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
        <span className="text-xs text-muted-foreground ml-2">Família:</span>
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
            {f}
          </Button>
        ))}
      </div>

      <div className="grid md:grid-cols-2 gap-3">
        {items.map((r) => {
          const evLines = evidencePreview(r.evidence_json ?? undefined);
          return (
            <Card key={r.id} className="p-4">
              <div className="flex items-start justify-between gap-2">
                <div className="flex items-center gap-2 min-w-0">
                  <Sparkles className="h-4 w-4 text-primary shrink-0" />
                  <span className="font-semibold truncate">{r.title}</span>
                </div>
                <Badge variant="outline">{r.impact ?? "medium"}</Badge>
              </div>
              {r.entity_name && (
                <p className="text-xs text-muted-foreground mt-1">
                  {r.entity_type}: {r.entity_name}
                  {r.maturity_days != null ? ` · ${r.maturity_days} dias de entrega` : ""}
                </p>
              )}
              <p className="text-sm text-muted-foreground mt-2 whitespace-pre-wrap">
                {r.description}
              </p>
              {evLines.length > 0 && (
                <div className="mt-2 rounded-md bg-muted/50 px-2 py-1.5 text-xs text-muted-foreground space-y-0.5">
                  {evLines.map((line) => (
                    <div key={line}>{line}</div>
                  ))}
                </div>
              )}
              <div className="mt-3 flex items-center justify-between gap-2 flex-wrap">
                <div className="flex gap-1.5 flex-wrap">
                  <Badge variant="secondary">{r.family ?? r.category ?? "geral"}</Badge>
                  {r.signal_key && <Badge variant="outline">{r.signal_key}</Badge>}
                  {r.family === "meta_dica" && r.evidence_json?.veredito != null && (
                    <Badge
                      variant={
                        String(r.evidence_json.veredito) === "discorda"
                          ? "destructive"
                          : String(r.evidence_json.veredito) === "concorda"
                            ? "default"
                            : "outline"
                      }
                    >
                      Meta → {String(r.evidence_json.veredito)}
                    </Badge>
                  )}
                  {r.family === "meta_dica" && r.evidence_json?.first_seen_on != null && (
                    <Badge variant="outline">desde {String(r.evidence_json.first_seen_on)}</Badge>
                  )}
                </div>
                <div className="flex gap-2">
                  {(r.status === "new" || r.status === "accepted") && (
                    <Button size="sm" variant="secondary" onClick={() => openChat(r)}>
                      <MessageSquare className="h-4 w-4 mr-1" />
                      Chat
                    </Button>
                  )}
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
          );
        })}
        {items.length === 0 && (
          <Card className="p-6 text-sm text-muted-foreground md:col-span-2">
            Nenhuma recomendação neste filtro.
          </Card>
        )}
      </div>
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
