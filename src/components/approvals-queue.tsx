import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useApp } from "@/lib/app-context";
import { Skeleton } from "@/components/ui/skeleton";
import { ActionCard, decideApproval, type Approval, type Decision } from "@/components/action-card";

export const APPROVAL_SELECT =
  "id, action, entity_type, summary, payload, status, review_note, reviewed_at, requested_by, reviewed_by, created_at, conversation_id";

const STATUS_RANK: Record<string, number> = { pending: 0, approved: 1, rejected: 1 };

export function ApprovalsQueue({ companyId }: { companyId: string }) {
  const { isAdmin } = useApp();
  const qc = useQueryClient();
  const [decidingId, setDecidingId] = useState<string | null>(null);

  const query = useQuery({
    queryKey: ["approvals", "company", companyId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("approval_requests")
        .select(APPROVAL_SELECT)
        .eq("company_id", companyId);
      if (error) throw error;
      return (data ?? []) as Approval[];
    },
  });

  // pending primeiro, depois por data desc.
  const rows = useMemo(
    () =>
      [...(query.data ?? [])].sort((a, b) => {
        const r = (STATUS_RANK[a.status] ?? 2) - (STATUS_RANK[b.status] ?? 2);
        return r !== 0 ? r : new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
      }),
    [query.data],
  );

  const ids = useMemo(() => {
    const s = new Set<string>();
    for (const a of rows) {
      if (a.requested_by) s.add(a.requested_by);
      if (a.reviewed_by) s.add(a.reviewed_by);
    }
    return [...s];
  }, [rows]);

  const profiles = useQuery({
    queryKey: ["profiles", ids.join(",")],
    enabled: ids.length > 0,
    queryFn: async () => {
      const { data } = await supabase.from("profiles").select("id, email, full_name").in("id", ids);
      const map: Record<string, string> = {};
      for (const p of data ?? []) map[p.id] = p.full_name || p.email || p.id.slice(0, 8);
      return map;
    },
  });
  const nameOf = (id: string | null) => (id ? (profiles.data?.[id] ?? id.slice(0, 8)) : undefined);

  const onDecide = async (id: string, decision: Decision, reason?: string) => {
    setDecidingId(id);
    const key = ["approvals", "company", companyId];
    const prev = qc.getQueryData<Approval[]>(key);
    qc.setQueryData<Approval[]>(key, (old) =>
      (old ?? []).map((a) =>
        a.id === id
          ? {
              ...a,
              status: decision,
              reviewed_at: new Date().toISOString(),
              review_note: reason ?? a.review_note,
            }
          : a,
      ),
    );
    const { error } = await decideApproval(id, decision, reason);
    setDecidingId(null);
    if (error) {
      qc.setQueryData(key, prev); // reverte
      toast.error(error);
      return;
    }
    toast.success(decision === "approved" ? "Pedido aprovado" : "Pedido rejeitado");
    qc.invalidateQueries({ queryKey: ["approvals"] });
  };

  if (query.isLoading) {
    return (
      <div className="space-y-3">
        {[0, 1, 2].map((i) => (
          <Skeleton key={i} className="h-24 w-full" />
        ))}
      </div>
    );
  }
  if (rows.length === 0) {
    return (
      <div className="rounded-md border border-border p-6 text-sm text-muted-foreground">
        Nenhum pedido de aprovação.
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {rows.map((a) => (
        <ActionCard
          key={a.id}
          approval={a}
          isAdmin={isAdmin}
          deciding={decidingId === a.id}
          onDecide={onDecide}
          requesterName={nameOf(a.requested_by)}
          reviewerName={nameOf(a.reviewed_by)}
          showMeta
        />
      ))}
    </div>
  );
}
