import { useEffect, useState } from "react";
import { createFileRoute, useSearch } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { SupabaseClient } from "@supabase/supabase-js";
import { Plus } from "lucide-react";
import { toast } from "sonner";
import { logAudit, useApp } from "@/lib/app-context";
import { supabase } from "@/integrations/supabase/client";
import { EmptyCompany } from "@/components/metric-card";
import { FalhaDeCarga } from "@/components/falha-de-carga";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  FormularioMissao,
  formVazioMissao,
  type FormMissaoRitmo,
} from "@/components/ritmo/formulario-missao";
import { DetalheMissao } from "@/components/ritmo/detalhe-missao";
import { rotuloMetrica, unidadeSonho } from "@/lib/ritmo";
import {
  mergeCampanhasRelatorio,
  flattenCampanhasPipeboard,
  type CampanhaRelatorio,
} from "@/lib/relatorios";
import { fmtBRL } from "@/lib/breakdown";
import type { Tables } from "@/integrations/supabase/types";

export const Route = createFileRoute("/_authenticated/ritmo")({
  component: Ritmo,
  head: () => ({ meta: [{ title: "Ritmo" }] }),
});

type MissaoRitmo = Tables<"ritmo_missoes">;

const ROTULO_STATUS: Record<string, string> = {
  em_analise: "Em análise",
  plano_pronto: "Plano pronto",
  analise_falhou: "Análise falhou",
  em_execucao: "Em execução",
  encerrada: "Encerrada",
};

function rotuloStatus(status: string): string {
  return ROTULO_STATUS[status] ?? status;
}

function varianteStatus(status: string): "default" | "secondary" | "destructive" | "outline" {
  if (status === "analise_falhou") return "destructive";
  if (status === "em_execucao") return "default";
  if (status === "plano_pronto") return "secondary";
  return "outline";
}

function prazoLegivel(inicio: string, fim: string): string {
  const a = inicio.split("-").reverse().join("/");
  const b = fim.split("-").reverse().join("/");
  return a === b ? a : `${a} – ${b}`;
}

function sonhoLegivel(metrica: string, sonho: number | null): string {
  if (sonho == null) return "—";
  return unidadeSonho(metrica) === "pct" ? `${sonho}%` : String(sonho);
}

function gastoVsTeto(gasto: number | null, teto: number | null): string {
  if (teto == null && gasto == null) return "—";
  const g = gasto == null ? "—" : fmtBRL(gasto);
  const t = teto == null ? "—" : fmtBRL(teto);
  return `${g} / ${t}`;
}

function Ritmo() {
  const { selectedCompany, selectedCompanyId, isAdmin } = useApp();
  const qc = useQueryClient();
  const companyId = selectedCompanyId;
  // ?item=<id> vem do sino/toast: seleciona a missão e a destaca.
  const { item: destacado } = useSearch({ strict: false }) as { item?: string };
  const [formAberto, setFormAberto] = useState(false);
  const [form, setForm] = useState<FormMissaoRitmo>(formVazioMissao);
  const [detalheId, setDetalheId] = useState<string | null>(null);

  const missoesQ = useQuery({
    queryKey: ["ritmo-missoes", companyId],
    enabled: !!companyId,
    queryFn: async (): Promise<MissaoRitmo[]> => {
      const { data, error } = await supabase
        .from("ritmo_missoes")
        .select("*")
        .eq("company_id", companyId!)
        .order("criado_em", { ascending: false });
      if (error) throw error;
      return (data ?? []) as MissaoRitmo[];
    },
  });

  const gastosQ = useQuery({
    queryKey: [
      "ritmo-gastos",
      companyId,
      (missoesQ.data ?? [])
        .map((m) => `${m.campaign_id}:${m.periodo_inicio}:${m.periodo_fim}`)
        .join("|"),
    ],
    enabled: !!companyId && (missoesQ.data?.length ?? 0) > 0,
    queryFn: async (): Promise<Record<string, number>> => {
      const missoes = missoesQ.data ?? [];
      const ext = [...new Set(missoes.map((m) => m.campaign_id).filter(Boolean))];
      if (ext.length === 0) return {};
      const db = supabase as unknown as SupabaseClient;
      const { data: camps, error: campErr } = await db
        .from("campaigns")
        .select("id,external_id")
        .eq("company_id", companyId!)
        .in("external_id", ext);
      if (campErr) throw campErr;
      const lista = Array.isArray(camps) ? camps : camps ? [camps] : [];
      const porExt = new Map<string, string>();
      for (const c of lista as { id?: string; external_id?: string }[]) {
        if (c.id && c.external_id) porExt.set(c.external_id, c.id);
      }
      const uuids = [...new Set(porExt.values())];
      if (uuids.length === 0) return {};
      const inicios = missoes.map((m) => m.periodo_inicio).sort();
      const fins = missoes.map((m) => m.periodo_fim).sort();
      const { data: snaps, error: snapErr } = await db
        .from("metric_snapshots")
        .select("campaign_id,snapshot_date,spend")
        .eq("company_id", companyId!)
        .in("campaign_id", uuids)
        .gte("snapshot_date", inicios[0])
        .lte("snapshot_date", fins[fins.length - 1]);
      if (snapErr) throw snapErr;
      const rows = (snaps ?? []) as {
        campaign_id?: string;
        snapshot_date?: string;
        spend?: number | string | null;
      }[];
      const out: Record<string, number> = {};
      for (const m of missoes) {
        const campUuid = porExt.get(m.campaign_id);
        if (!campUuid) continue;
        let soma = 0;
        for (const s of rows) {
          if (s.campaign_id !== campUuid) continue;
          const d = String(s.snapshot_date ?? "").slice(0, 10);
          if (d < m.periodo_inicio || d > m.periodo_fim) continue;
          const n = Number(s.spend);
          if (Number.isFinite(n)) soma += n;
        }
        out[m.id] = soma;
      }
      return out;
    },
  });

  const campanhasQ = useQuery({
    queryKey: ["ritmo-campanhas", companyId],
    enabled: !!companyId && formAberto,
    queryFn: async (): Promise<{
      campanhas: CampanhaRelatorio[];
      fonte: "ao_vivo" | "espelho";
      aviso: string | null;
    }> => {
      const { data: espelho, error } = await supabase.rpc("listar_campanhas_para_relatorio", {
        p_company_id: companyId!,
      });
      if (error) throw error;
      const base: CampanhaRelatorio[] = (espelho ?? []).map((c) => ({
        external_id: c.external_id,
        nome: c.nome,
        status: c.status,
        objective: c.objetivo,
        tipo: c.tipo,
        gasto: Number(c.gasto ?? 0),
        last_synced_at: c.last_synced_at,
        fonte: "espelho",
      }));
      const vivo = await supabase.functions.invoke<{
        ok?: boolean;
        campanhas?: unknown[];
        erro?: string;
      }>("pipeboard-read", { body: { modo: "listar_campanhas", company_id: companyId } });
      if (vivo.error || !vivo.data?.ok) {
        return {
          campanhas: base,
          fonte: "espelho",
          aviso:
            "Lista do último sync local, não da Graph agora. O relatório tenta o ao vivo na hora de rodar.",
        };
      }
      const merge = mergeCampanhasRelatorio(base, flattenCampanhasPipeboard(vivo.data.campanhas));
      return {
        campanhas: merge.campanhas,
        fonte: merge.fonte,
        aviso: merge.fonte === "ao_vivo" ? null : "Pipeboard não devolveu campanhas; usando o espelho.",
      };
    },
  });

  useEffect(() => {
    setDetalheId(destacado ?? null);
  }, [companyId, destacado]);

  const criar = useMutation({
    mutationFn: async (pedido: FormMissaoRitmo) => {
      if (!companyId) throw new Error("sem empresa");
      const db = supabase as unknown as SupabaseClient;
      const { data: camp } = await db
        .from("campaigns")
        .select("external_account_id")
        .eq("company_id", companyId)
        .eq("external_id", pedido.campaignId)
        .maybeSingle();
      const bruto = (camp as { external_account_id?: string | null } | null)?.external_account_id;
      const p_ad_account_id = bruto && String(bruto).trim() ? String(bruto).trim() : null;
      const { data, error } = await supabase.rpc("enfileirar_ritmo_analise", {
        p_company_id: companyId,
        p_campaign_id: pedido.campaignId,
        p_campaign_name: pedido.campaignName,
        p_ad_account_id,
        p_periodo_inicio: pedido.periodoInicio,
        p_periodo_fim: pedido.periodoFim,
        p_metrica: pedido.metrica,
        p_dissertacao: pedido.dissertacao,
        p_sonho: pedido.sonho.trim() === "" ? null : Number(pedido.sonho),
        p_extra: pedido.extra.trim() === "" ? 0 : Number(pedido.extra),
        p_fonte_campanhas: campanhasQ.data?.fonte ?? "espelho",
      });
      if (error) throw error;
      const id = String(data ?? "");
      if (!id || id === "null" || id === "undefined") {
        throw new Error("Não foi possível enfileirar a análise.");
      }
      const inv = await supabase.functions.invoke("traffic-agent-job", {
        body: { modo: "ritmo_analise", missao_id: id },
      });
      if (inv.error) throw new Error(inv.error.message);
      return id;
    },
    onSuccess: async (id, pedido) => {
      toast.success("Análise na fila. O plano aparece nesta tela.");
      if (!companyId) return;
      const agora = new Date().toISOString();
      const otimista: MissaoRitmo = {
        id,
        company_id: companyId,
        campaign_id: pedido.campaignId,
        campaign_name: pedido.campaignName,
        ad_account_id: null,
        status: "em_analise",
        periodo_inicio: pedido.periodoInicio,
        periodo_fim: pedido.periodoFim,
        metrica: pedido.metrica,
        dissertacao: pedido.dissertacao,
        sonho: pedido.sonho.trim() === "" ? null : Number(pedido.sonho),
        extra_investimento: pedido.extra.trim() === "" ? 0 : Number(pedido.extra),
        baseline_gasto_diario: null,
        baseline_json: {},
        teto_gasto_janela: null,
        plano_json: null,
        leitura_json: null,
        projecoes_json: null,
        confianca_baseline: null,
        fonte_campanhas: campanhasQ.data?.fonte ?? "espelho",
        autonomia_concedida_em: null,
        autonomia_concedida_por: null,
        encerrada_em: null,
        encerrada_por: null,
        encerrada_motivo: null,
        erro_analise: null,
        job_id: null,
        criado_por: null,
        criado_em: agora,
        atualizado_em: agora,
      };
      qc.setQueryData<MissaoRitmo[]>(["ritmo-missoes", companyId], (old) => {
        if (!old) return [otimista];
        if (old.some((m) => m.id === id)) return old;
        return [otimista, ...old];
      });
      setFormAberto(false);
      setForm(formVazioMissao());
      setDetalheId(id);
      void qc.invalidateQueries({ queryKey: ["ritmo-missoes", companyId] });
      await logAudit({
        companyId,
        action: "ritmo.analise",
        targetType: "ritmo_missoes",
        targetId: id,
      });
    },
    onError: (e: Error) => toast.error(e.message || "Não foi possível enfileirar a análise."),
  });

  useEffect(() => {
    if (!companyId) return;
    const canal = supabase
      .channel(`ritmo-${companyId}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "ritmo_missoes",
          filter: `company_id=eq.${companyId}`,
        },
        () => {
          void qc.invalidateQueries({ queryKey: ["ritmo-missoes", companyId] });
        },
      )
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "ritmo_atos",
          filter: `company_id=eq.${companyId}`,
        },
        (payload) => {
          void qc.invalidateQueries({ queryKey: ["ritmo-missoes", companyId] });
          const row = (payload.new ?? payload.old) as { missao_id?: string } | null;
          const missaoId = typeof row?.missao_id === "string" ? row.missao_id : undefined;
          void qc.invalidateQueries({
            queryKey: missaoId ? ["ritmo-atos", missaoId] : ["ritmo-atos"],
          });
        },
      )
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "ritmo_diarios",
          filter: `company_id=eq.${companyId}`,
        },
        (payload) => {
          void qc.invalidateQueries({ queryKey: ["ritmo-missoes", companyId] });
          void qc.invalidateQueries({ queryKey: ["ritmo-gastos", companyId] });
          const row = (payload.new ?? payload.old) as { missao_id?: string } | null;
          const missaoId = typeof row?.missao_id === "string" ? row.missao_id : undefined;
          void qc.invalidateQueries({
            queryKey: missaoId ? ["ritmo-diarios", missaoId] : ["ritmo-diarios"],
          });
        },
      )
      .subscribe();
    return () => {
      void supabase.removeChannel(canal);
    };
  }, [companyId, qc]);

  if (!selectedCompany || !companyId) return <EmptyCompany />;

  const missoes = missoesQ.data ?? [];
  const detalhe = detalheId
    ? (missoes.find((m) => m.id === detalheId) ?? null)
    : (missoes[0] ?? null);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Ritmo</h1>
          <p className="text-sm text-muted-foreground">
            Força-tarefa da campanha, com uma autorização. O andamento fecha às 18:30.
          </p>
        </div>
        {isAdmin && (
          <Button
            onClick={() => {
              setForm(formVazioMissao());
              setFormAberto(true);
            }}
          >
            <Plus className="mr-2 h-4 w-4" />
            Nova força-tarefa
          </Button>
        )}
      </div>

      {missoesQ.isError && (
        <FalhaDeCarga
          oQue="as forças-tarefa"
          erro={missoesQ.error}
          onTentarDeNovo={() => missoesQ.refetch()}
        />
      )}
      {missoesQ.isLoading && <Skeleton className="h-24 w-full" />}
      {!missoesQ.isLoading && !missoesQ.isError && missoes.length === 0 && (
        <Card className="p-6 text-sm text-muted-foreground">
          Nenhuma força-tarefa nesta empresa
        </Card>
      )}
      {!missoesQ.isError && missoes.length > 0 && (
        <Card className="p-0 overflow-hidden">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Status</TableHead>
                <TableHead>Campanha</TableHead>
                <TableHead>Métrica</TableHead>
                <TableHead>Prazo</TableHead>
                <TableHead className="text-right">Extra</TableHead>
                <TableHead className="text-right">Sonho</TableHead>
                <TableHead className="text-right">Gasto / teto</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {missoes.map((m) => (
                <TableRow
                  key={m.id}
                  className={`cursor-pointer ${detalhe?.id === m.id ? "bg-muted/50" : ""} ${m.id === destacado ? "ring-2 ring-primary ring-offset-2 ring-offset-background" : ""}`}
                  onClick={() => setDetalheId(m.id)}
                >
                  <TableCell>
                    <Badge variant={varianteStatus(m.status)}>{rotuloStatus(m.status)}</Badge>
                  </TableCell>
                  <TableCell>
                    <div className="font-medium">{m.campaign_name || m.campaign_id}</div>
                    {m.erro_analise && (
                      <p className="mt-1 text-xs text-destructive">{m.erro_analise}</p>
                    )}
                  </TableCell>
                  <TableCell>{rotuloMetrica(m.metrica) || m.metrica}</TableCell>
                  <TableCell className="tabular-nums">
                    {prazoLegivel(m.periodo_inicio, m.periodo_fim)}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {fmtBRL(Number(m.extra_investimento))}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {sonhoLegivel(m.metrica, m.sonho == null ? null : Number(m.sonho))}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {gastoVsTeto(
                      gastosQ.data?.[m.id] ?? null,
                      m.teto_gasto_janela == null ? null : Number(m.teto_gasto_janela),
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Card>
      )}
      {detalhe && (
        <DetalheMissao
          missao={detalhe}
          isAdmin={isAdmin}
          companyId={companyId}
          onMudou={() => {
            void qc.invalidateQueries({ queryKey: ["ritmo-missoes", companyId] });
            void qc.invalidateQueries({ queryKey: ["ritmo-atos", detalhe.id] });
            void qc.invalidateQueries({ queryKey: ["ritmo-diarios", detalhe.id] });
            void qc.invalidateQueries({ queryKey: ["ritmo-gastos", companyId] });
          }}
        />
      )}

      <Dialog open={formAberto} onOpenChange={setFormAberto}>
        <DialogContent className="max-h-[90vh] max-w-3xl overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Nova força-tarefa</DialogTitle>
          </DialogHeader>
          {campanhasQ.isError && (
            <FalhaDeCarga
              oQue="as campanhas"
              erro={campanhasQ.error}
              onTentarDeNovo={() => campanhasQ.refetch()}
            />
          )}
          <FormularioMissao
            form={form}
            onChange={setForm}
            campanhas={campanhasQ.data?.campanhas ?? []}
            fonteCampanhas={campanhasQ.data?.fonte ?? "espelho"}
            avisoFonte={campanhasQ.data?.aviso ?? null}
            carregandoCampanhas={campanhasQ.isFetching}
            onRecarregarCampanhas={() => campanhasQ.refetch()}
            isAdmin={isAdmin}
            ocupado={criar.isPending}
            onSubmit={(pedido) => {
              if (criar.isPending) return;
              criar.mutate(pedido);
            }}
          />
        </DialogContent>
      </Dialog>
    </div>
  );
}
