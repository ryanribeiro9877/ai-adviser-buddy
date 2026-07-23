import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import { Pencil, Check, X, HelpCircle } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useApp, logAudit } from "@/lib/app-context";
import type { Json } from "@/integrations/supabase/types";
import { fmtBRL } from "@/lib/breakdown";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

type TargetRow = {
  id: string;
  metric: string;
  valor: number | string;
  fonte: string;
  memoria: Json | null;
  updated_at: string;
};

// Glossário do Roberto: label amigável + definição por métrica. A métrica
// custo_por_lead_dashboard é a que o motor de alertas usa para a regra de CPL.
const METRIC_META: Record<string, { label: string; tip: string; alertaCpl?: boolean }> = {
  custo_por_lead_dashboard: {
    label: "Custo por Lead (dashboard)",
    tip: "CPL do motor de alertas: investimento ÷ leads.",
    alertaCpl: true,
  },
  custo_por_formulario: {
    label: "Custo por Formulário",
    tip: "Custo por lead de formulário (form_leads).",
  },
  custo_por_lead_lp: {
    label: "Custo por Lead na LP",
    tip: "Custo por lead na landing page (link_clicks).",
  },
  custo_por_conversa: {
    label: "Custo por Conversa WhatsApp",
    tip: "Custo por conversa iniciada no WhatsApp (messaging_started).",
  },
};

const FONTE_META: Record<string, { label: string; variant: "default" | "secondary" | "outline" }> =
  {
    derivado_meta_p75_diario: { label: "Derivado dos dados (p75)", variant: "secondary" },
    comando: { label: "Comando do gestor", variant: "outline" },
    manual: { label: "Editado manualmente", variant: "default" },
  };

// Aceita "2,50" (pt-BR) ou "2.50". Retorna número > 0 com 2 casas, ou null.
function parseValor(raw: string): number | null {
  let s = raw.trim().replace(/[R$\s]/g, "");
  if (s === "") return null;
  if (s.includes(",")) s = s.replace(/\./g, "").replace(",", ".");
  const n = Number(s);
  if (!Number.isFinite(n) || n <= 0) return null;
  return Math.round(n * 100) / 100;
}

const fmtDate = (iso: string) =>
  new Date(iso).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" });

function MetricInfo({ text }: { text: string }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button type="button" className="text-muted-foreground/70 hover:text-foreground">
          <HelpCircle className="h-3.5 w-3.5" />
        </button>
      </TooltipTrigger>
      <TooltipContent className="max-w-[260px] text-left">{text}</TooltipContent>
    </Tooltip>
  );
}

export function TargetsTable({ companyId }: { companyId: string }) {
  const { isAdmin } = useApp();
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [saving, setSaving] = useState(false);

  const query = useQuery({
    queryKey: ["targets", companyId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("targets")
        .select("id, metric, valor, fonte, memoria, updated_at")
        .eq("company_id", companyId)
        .is("campaign_id", null)
        .eq("active", true)
        .order("metric");
      if (error) throw error;
      return (data ?? []) as TargetRow[];
    },
  });

  const startEdit = (row: TargetRow) => {
    setEditingId(row.id);
    setDraft(Number(row.valor).toFixed(2).replace(".", ","));
  };

  const cancelEdit = () => {
    setEditingId(null);
    setDraft("");
  };

  const save = async (row: TargetRow) => {
    const novo = parseValor(draft);
    if (novo === null) {
      toast.error("Informe um valor em reais maior que zero.");
      return;
    }
    setSaving(true);
    // Relê a linha imediatamente antes de gravar (valor anterior + memória atual).
    const { data: fresh, error: readErr } = await supabase
      .from("targets")
      .select("valor, memoria")
      .eq("id", row.id)
      .single();
    if (readErr || !fresh) {
      toast.error("Não foi possível ler a meta atual. Tente novamente.");
      setSaving(false);
      return;
    }
    const anterior = Number(fresh.valor);
    const memoriaAntiga = (
      fresh.memoria && typeof fresh.memoria === "object" && !Array.isArray(fresh.memoria)
        ? (fresh.memoria as Record<string, Json>)
        : {}
    ) as Record<string, Json>;
    const n = Object.keys(memoriaAntiga).filter((k) => /^edicao_\d+$/.test(k)).length + 1;
    const novaMemoria: Record<string, Json> = {
      ...memoriaAntiga,
      [`edicao_${n}`]: { anterior, novo, em: new Date().toISOString(), via: "ui" },
    };

    const { error } = await supabase
      .from("targets")
      .update({
        valor: novo,
        fonte: "manual",
        updated_at: new Date().toISOString(),
        memoria: novaMemoria as Json,
      })
      .eq("id", row.id);

    if (error) {
      // RLS: o UPDATE de não-admin falha aqui.
      toast.error("Sem permissão para editar metas (apenas administradores).");
      setSaving(false);
      return;
    }

    await logAudit({
      companyId,
      action: "target.update",
      targetType: "target",
      targetId: row.id,
      details: { metric: row.metric, anterior, novo },
    });
    toast.success("Meta atualizada — alertas recalibram na próxima avaliação (06:15)");
    setEditingId(null);
    setDraft("");
    setSaving(false);
    await query.refetch();
  };

  if (query.isLoading) {
    return (
      <div className="space-y-2">
        {[0, 1, 2, 3].map((i) => (
          <Skeleton key={i} className="h-12 w-full" />
        ))}
      </div>
    );
  }

  const rows = query.data ?? [];
  if (rows.length === 0) {
    return (
      <div className="rounded-md border border-border p-6 text-sm text-muted-foreground">
        Nenhuma meta cadastrada para esta empresa.
      </div>
    );
  }

  return (
    <div className="rounded-md border border-border">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Métrica</TableHead>
            <TableHead className="text-right">Valor (teto)</TableHead>
            <TableHead>Fonte</TableHead>
            <TableHead>Atualizado em</TableHead>
            {isAdmin && <TableHead className="w-[120px] text-right">Ações</TableHead>}
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((row) => {
            const meta = METRIC_META[row.metric] ?? { label: row.metric, tip: "" };
            const fonte = FONTE_META[row.fonte] ?? {
              label: row.fonte,
              variant: "outline" as const,
            };
            const editing = editingId === row.id;
            return (
              <TableRow key={row.id}>
                <TableCell className="font-medium">
                  <div className="flex items-center gap-1.5">
                    {meta.label}
                    {meta.tip && <MetricInfo text={meta.tip} />}
                    {meta.alertaCpl && (
                      <Badge variant="secondary" className="ml-1 font-normal">
                        usado nos alertas de CPL
                      </Badge>
                    )}
                  </div>
                </TableCell>
                <TableCell className="text-right tabular-nums">
                  {editing ? (
                    <Input
                      autoFocus
                      inputMode="decimal"
                      value={draft}
                      disabled={saving}
                      onChange={(e) => setDraft(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") save(row);
                        if (e.key === "Escape") cancelEdit();
                      }}
                      className="h-8 w-28 ml-auto text-right"
                      aria-label={`Novo valor para ${meta.label}`}
                    />
                  ) : (
                    fmtBRL(Number(row.valor))
                  )}
                </TableCell>
                <TableCell>
                  <Badge variant={fonte.variant} className="font-normal">
                    {fonte.label}
                  </Badge>
                </TableCell>
                <TableCell className="text-xs text-muted-foreground">
                  {fmtDate(row.updated_at)}
                </TableCell>
                {isAdmin && (
                  <TableCell className="text-right">
                    {editing ? (
                      <div className="flex justify-end gap-1">
                        <Button
                          size="icon"
                          variant="ghost"
                          className="h-8 w-8"
                          disabled={saving}
                          onClick={() => save(row)}
                          aria-label="Salvar"
                        >
                          <Check className="h-4 w-4 text-[color:var(--color-success)]" />
                        </Button>
                        <Button
                          size="icon"
                          variant="ghost"
                          className="h-8 w-8"
                          disabled={saving}
                          onClick={cancelEdit}
                          aria-label="Cancelar"
                        >
                          <X className="h-4 w-4" />
                        </Button>
                      </div>
                    ) : (
                      <Button
                        size="sm"
                        variant="ghost"
                        className="h-8"
                        onClick={() => startEdit(row)}
                      >
                        <Pencil className="h-3.5 w-3.5 mr-1" />
                        Editar
                      </Button>
                    )}
                  </TableCell>
                )}
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </div>
  );
}
