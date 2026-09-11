import { useEffect, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus } from "lucide-react";
import { useApp } from "@/lib/app-context";
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

function gastoVsTeto(teto: number | null): string {
  if (teto == null) return "—";
  return `— / ${fmtBRL(Number(teto))}`;
}

function Ritmo() {
  const { selectedCompany, selectedCompanyId, isAdmin } = useApp();
  const qc = useQueryClient();
  const companyId = selectedCompanyId;
  const [formAberto, setFormAberto] = useState(false);
  const [form, setForm] = useState<FormMissaoRitmo>(formVazioMissao);

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
        () => {
          void qc.invalidateQueries({ queryKey: ["ritmo-missoes", companyId] });
        },
      )
      .subscribe();
    return () => {
      void supabase.removeChannel(canal);
    };
  }, [companyId, qc]);

  if (!selectedCompany || !companyId) return <EmptyCompany />;

  const missoes = missoesQ.data ?? [];

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Ritmo</h1>
          <p className="text-sm text-muted-foreground">
            Força-tarefa da campanha, com uma autorização.
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
                <TableRow key={m.id}>
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
                    {gastoVsTeto(m.teto_gasto_janela == null ? null : Number(m.teto_gasto_janela))}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Card>
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
          />
        </DialogContent>
      </Dialog>
    </div>
  );
}
