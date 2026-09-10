import { useEffect, useMemo, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { FileText, Play, Pencil, Plus, Trash2 } from "lucide-react";
import { useApp, logAudit } from "@/lib/app-context";
import { supabase } from "@/integrations/supabase/client";
import { EmptyCompany } from "@/components/metric-card";
import { FalhaDeCarga } from "@/components/falha-de-carga";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  FormularioAgendamento,
  formVazio,
  type FormAgendamento,
} from "@/components/relatorios/formulario-agendamento";
import {
  DetalheRelatorio,
  rotuloStatusGerado,
  type RelatorioGerado,
} from "@/components/relatorios/detalhe-relatorio";
import {
  mergeCampanhasRelatorio,
  flattenCampanhasPipeboard,
  type CampanhaRelatorio,
  type FrequenciaRelatorio,
  type JanelaAnalise,
  type RecorteCampanhas,
} from "@/lib/relatorios";

export const Route = createFileRoute("/_authenticated/relatorios")({
  component: Relatorios,
  head: () => ({ meta: [{ title: "Relatórios" }] }),
});

type Agenda = {
  id: string;
  nome: string;
  ativo: boolean;
  frequencia: string;
  hora_local: string;
  dia_semana: number | null;
  intervalo_horas: number | null;
  recorte_campanhas: string;
  campaign_ids: string[];
  janela_analise: string;
  secoes: string[];
  proxima_execucao_em: string | null;
  ultima_execucao_em: string | null;
};

function horaCurta(h: string | null | undefined): string {
  const s = String(h ?? "08:00");
  return s.slice(0, 5);
}

function agendaParaForm(a: Agenda): FormAgendamento {
  return {
    nome: a.nome,
    frequencia: a.frequencia as FrequenciaRelatorio,
    horaLocal: horaCurta(a.hora_local),
    diaSemana: a.dia_semana ?? 1,
    intervaloHoras: a.intervalo_horas ?? 6,
    recorte: a.recorte_campanhas as RecorteCampanhas,
    campaignIds: a.campaign_ids ?? [],
    janela: a.janela_analise as JanelaAnalise,
    secoes: a.secoes as FormAgendamento["secoes"],
  };
}

function payloadAgenda(companyId: string, form: FormAgendamento, userId: string) {
  return {
    company_id: companyId,
    nome: form.nome.trim(),
    frequencia: form.frequencia,
    hora_local: form.horaLocal,
    dia_semana: form.frequencia === "semanal" ? form.diaSemana : null,
    intervalo_horas: form.frequencia === "cada_n_horas" ? form.intervaloHoras : null,
    recorte_campanhas: form.recorte,
    campaign_ids: form.recorte === "ids_fixos" ? form.campaignIds : [],
    janela_analise: form.janela,
    secoes: form.secoes,
    criado_por: userId,
  };
}

function rotuloFreq(a: Agenda): string {
  if (a.frequencia === "diaria") return `todo dia às ${horaCurta(a.hora_local)}`;
  if (a.frequencia === "dias_uteis") return `dias úteis às ${horaCurta(a.hora_local)}`;
  if (a.frequencia === "semanal") return `semanal às ${horaCurta(a.hora_local)}`;
  if (a.frequencia === "cada_n_horas") return `a cada ${a.intervalo_horas}h`;
  return a.frequencia;
}

function quando(iso: string | null) {
  if (!iso) return "—";
  return new Date(iso).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" });
}

function Relatorios() {
  const { selectedCompany, selectedCompanyId, isAdmin, user } = useApp();
  const qc = useQueryClient();
  const companyId = selectedCompanyId;
  const [aba, setAba] = useState("gerados");
  const [formAberto, setFormAberto] = useState(false);
  const [editando, setEditando] = useState<Agenda | null>(null);
  const [form, setForm] = useState<FormAgendamento>(formVazio());
  const [detalheId, setDetalheId] = useState<string | null>(null);

  const agendasQ = useQuery({
    queryKey: ["relatorio-agendamentos", companyId],
    enabled: !!companyId,
    queryFn: async (): Promise<Agenda[]> => {
      const { data, error } = await supabase
        .from("relatorio_agendamentos")
        .select("*")
        .eq("company_id", companyId!)
        .order("criado_em", { ascending: false });
      if (error) throw error;
      return (data ?? []) as Agenda[];
    },
  });

  const geradosQ = useQuery({
    queryKey: ["relatorio-gerados", companyId],
    enabled: !!companyId,
    queryFn: async (): Promise<RelatorioGerado[]> => {
      const { data, error } = await supabase
        .from("relatorio_gerados")
        .select(
          "id,nome,status,fonte_campanhas,campaign_ids_resolvidos,periodo_inicio,periodo_fim,corpo_md,achados,cobertura,erro,criado_em,finalizado_em",
        )
        .eq("company_id", companyId!)
        .order("criado_em", { ascending: false })
        .limit(40);
      if (error) throw error;
      return (data ?? []) as RelatorioGerado[];
    },
    refetchInterval: (q) => {
      const rows = q.state.data ?? [];
      return rows.some((r) => r.status === "queued" || r.status === "running") ? 4000 : false;
    },
  });

  const campanhasQ = useQuery({
    queryKey: ["relatorio-campanhas", companyId],
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
          aviso: "Lista do último sync local, não da Graph agora. O relatório tenta o ao vivo na hora de rodar.",
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
      .channel(`relatorios-${companyId}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "relatorio_gerados",
          filter: `company_id=eq.${companyId}`,
        },
        () => {
          void qc.invalidateQueries({ queryKey: ["relatorio-gerados", companyId] });
        },
      )
      .subscribe();
    return () => {
      void supabase.removeChannel(canal);
    };
  }, [companyId, qc]);

  const salvar = useMutation({
    mutationFn: async () => {
      if (!companyId || !user) throw new Error("sem empresa");
      if (!form.nome.trim()) throw new Error("Dê um nome ao relatório.");
      if (!form.secoes.length) throw new Error("Marque ao menos uma seção.");
      if (form.recorte === "ids_fixos" && !form.campaignIds.length) {
        throw new Error("Escolha ao menos uma campanha, ou use todas as ativas.");
      }
      const body = payloadAgenda(companyId, form, user.id);
      if (editando) {
        const { criado_por: _c, ...upd } = body;
        const { error } = await supabase.from("relatorio_agendamentos").update(upd).eq("id", editando.id);
        if (error) throw error;
      } else {
        const { error } = await supabase.from("relatorio_agendamentos").insert(body);
        if (error) throw error;
      }
    },
    onSuccess: async () => {
      toast.success(editando ? "Agenda atualizada." : "Agenda criada.");
      await logAudit({
        companyId,
        action: editando ? "relatorio.agenda.editar" : "relatorio.agenda.criar",
        targetType: "relatorio_agendamentos",
        targetId: editando?.id,
      });
      setFormAberto(false);
      setEditando(null);
      void qc.invalidateQueries({ queryKey: ["relatorio-agendamentos", companyId] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const gerar = useMutation({
    mutationFn: async (agendamentoId: string | null) => {
      if (!companyId) throw new Error("sem empresa");
      const { data, error } = await supabase.rpc("enfileirar_relatorio_agora", {
        p_company_id: companyId,
        p_agendamento_id: agendamentoId,
        ...(agendamentoId
          ? {}
          : {
              p_nome: form.nome,
              p_recorte_campanhas: form.recorte,
              p_campaign_ids: form.campaignIds,
              p_janela_analise: form.janela,
              p_secoes: form.secoes,
            }),
      });
      if (error) throw error;
      const id = String(data);
      const inv = await supabase.functions.invoke("traffic-agent-job", {
        body: { modo: "relatorio", relatorio_id: id },
      });
      if (inv.error) throw new Error(inv.error.message);
      return id;
    },
    onSuccess: async (id) => {
      toast.success("Relatório na fila. A aba Gerados atualiza sozinha.");
      setAba("gerados");
      setDetalheId(id);
      setFormAberto(false);
      void qc.invalidateQueries({ queryKey: ["relatorio-gerados", companyId] });
      await logAudit({
        companyId,
        action: "relatorio.gerar_agora",
        targetType: "relatorio_gerados",
        targetId: id,
      });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const detalhe = useMemo(
    () => (geradosQ.data ?? []).find((r) => r.id === detalheId) ?? geradosQ.data?.[0] ?? null,
    [geradosQ.data, detalheId],
  );

  if (!selectedCompany || !companyId) return <EmptyCompany />;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Relatórios</h1>
          <p className="text-sm text-muted-foreground">
            O gestor de IA lê as campanhas no horário que você escolher, opina com evidência e não
            escreve na Meta. Empresa:{" "}
            <span className="font-medium text-foreground">{selectedCompany.name}</span>
          </p>
        </div>
        {isAdmin && (
          <Button
            onClick={() => {
              setEditando(null);
              setForm(formVazio());
              setFormAberto(true);
            }}
          >
            <Plus className="mr-2 h-4 w-4" />
            Nova agenda
          </Button>
        )}
      </div>

      <Tabs value={aba} onValueChange={setAba}>
        <TabsList>
          <TabsTrigger value="gerados">Gerados</TabsTrigger>
          <TabsTrigger value="agendamentos">Agendamentos</TabsTrigger>
        </TabsList>

        <TabsContent value="agendamentos" className="space-y-3">
          {agendasQ.isError && (
            <FalhaDeCarga
              oQue="os agendamentos de relatório"
              erro={agendasQ.error}
              onTentarDeNovo={() => agendasQ.refetch()}
            />
          )}
          {agendasQ.isLoading && <Skeleton className="h-24 w-full" />}
          {!agendasQ.isLoading && !agendasQ.isError && (agendasQ.data ?? []).length === 0 && (
            <Card className="p-6 text-sm text-muted-foreground">
              Nenhuma agenda nesta empresa. Crie uma com o preset diário (08:00, todas as ativas,
              todas as seções) para substituir o relatório que você montava à mão.
            </Card>
          )}
          {(agendasQ.data ?? []).map((a) => (
            <Card key={a.id} className="flex flex-wrap items-start justify-between gap-3 p-4">
              <div className="min-w-0 space-y-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-medium">{a.nome}</span>
                  <Badge variant={a.ativo ? "secondary" : "outline"}>
                    {a.ativo ? "ligada" : "pausada"}
                  </Badge>
                </div>
                <p className="text-sm text-muted-foreground">
                  {rotuloFreq(a)} · {a.recorte_campanhas === "todas_ativas" ? "todas as ativas" : `${a.campaign_ids.length} campanha(s)`} · {a.secoes.length} seções
                </p>
                <p className="text-xs text-muted-foreground">
                  Próxima: {quando(a.proxima_execucao_em)} · Última: {quando(a.ultima_execucao_em)}
                </p>
              </div>
              {isAdmin && (
                <div className="flex flex-wrap items-center gap-2">
                  <Switch
                    checked={a.ativo}
                    onCheckedChange={async (v) => {
                      const { error } = await supabase
                        .from("relatorio_agendamentos")
                        .update({ ativo: v })
                        .eq("id", a.id);
                      if (error) toast.error(error.message);
                      else void qc.invalidateQueries({ queryKey: ["relatorio-agendamentos", companyId] });
                    }}
                    aria-label={a.ativo ? "Pausar agenda" : "Ligar agenda"}
                  />
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => gerar.mutate(a.id)}
                    disabled={gerar.isPending}
                  >
                    <Play className="mr-1 h-3.5 w-3.5" />
                    Gerar agora
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => {
                      setEditando(a);
                      setForm(agendaParaForm(a));
                      setFormAberto(true);
                    }}
                  >
                    <Pencil className="h-3.5 w-3.5" />
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={async () => {
                      const { error } = await supabase.from("relatorio_agendamentos").delete().eq("id", a.id);
                      if (error) toast.error(error.message);
                      else {
                        toast.success("Agenda apagada. O histórico gerado permanece.");
                        void qc.invalidateQueries({ queryKey: ["relatorio-agendamentos", companyId] });
                      }
                    }}
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </div>
              )}
            </Card>
          ))}
        </TabsContent>

        <TabsContent value="gerados" className="grid gap-4 lg:grid-cols-[280px_1fr]">
          <div className="space-y-2">
            {geradosQ.isError && (
              <FalhaDeCarga
                oQue="os relatórios gerados"
                erro={geradosQ.error}
                onTentarDeNovo={() => geradosQ.refetch()}
              />
            )}
            {geradosQ.isLoading && <Skeleton className="h-32 w-full" />}
            {!geradosQ.isLoading && !geradosQ.isError && (geradosQ.data ?? []).length === 0 && (
              <Card className="p-4 text-sm text-muted-foreground">
                Ainda não há relatório gerado. Crie uma agenda ou peça um agora.
              </Card>
            )}
            {(geradosQ.data ?? []).map((r) => (
              <button
                key={r.id}
                type="button"
                onClick={() => setDetalheId(r.id)}
                className={`w-full rounded-md border px-3 py-2 text-left text-sm ${
                  detalhe?.id === r.id ? "border-ring bg-muted/60" : "border-border"
                }`}
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="truncate font-medium">{r.nome}</span>
                  <Badge variant={r.status === "error" ? "destructive" : "outline"}>
                    {rotuloStatusGerado(r.status)}
                  </Badge>
                </div>
                <div className="text-xs text-muted-foreground">{quando(r.criado_em)}</div>
              </button>
            ))}
          </div>
          <div>
            {detalhe ? (
              <DetalheRelatorio relatorio={detalhe} />
            ) : (
              <Card className="p-8 text-center text-sm text-muted-foreground">
                <FileText className="mx-auto mb-2 h-6 w-6" />
                Escolha um relatório à esquerda.
              </Card>
            )}
          </div>
        </TabsContent>
      </Tabs>

      <Dialog open={formAberto} onOpenChange={setFormAberto}>
        <DialogContent className="max-h-[90vh] max-w-3xl overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{editando ? "Editar agenda" : "Nova agenda de relatório"}</DialogTitle>
          </DialogHeader>
          {campanhasQ.isError && (
            <FalhaDeCarga
              oQue="as campanhas"
              erro={campanhasQ.error}
              onTentarDeNovo={() => campanhasQ.refetch()}
            />
          )}
          <FormularioAgendamento
            form={form}
            onChange={setForm}
            campanhas={campanhasQ.data?.campanhas ?? []}
            fonteCampanhas={campanhasQ.data?.fonte ?? "espelho"}
            avisoFonte={campanhasQ.data?.aviso ?? null}
            carregandoCampanhas={campanhasQ.isFetching}
            onRecarregarCampanhas={() => campanhasQ.refetch()}
            isAdmin={isAdmin}
          />
          <DialogFooter className="gap-2">
            {isAdmin && !editando && (
              <Button
                type="button"
                variant="outline"
                disabled={gerar.isPending}
                onClick={() => gerar.mutate(null)}
              >
                Gerar agora (sem esperar a cron)
              </Button>
            )}
            <Button type="button" disabled={salvar.isPending} onClick={() => salvar.mutate()}>
              {editando ? "Salvar" : "Criar agenda"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
