import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { SupabaseClient } from "@supabase/supabase-js";
import { toast } from "sonner";
import { logAudit } from "@/lib/app-context";
import { supabase } from "@/integrations/supabase/client";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { fmtBRL, fmtInt, fmtPct } from "@/lib/breakdown";
import { addDaysYmd, hojeYmdBrasilia } from "@/lib/relatorios";
import {
  nDiasPrazo,
  parsePlanoRitmo,
  rotuloMetrica,
  type AtoPlano,
  type Horizontes,
  type PlanoRitmo,
} from "@/lib/ritmo";
import type { Tables } from "@/integrations/supabase/types";

export type MissaoRitmo = Tables<"ritmo_missoes">;
type AtoRitmo = Tables<"ritmo_atos">;

type SnapLinha = {
  snapshot_date?: string | null;
  impressions?: number | string | null;
  reach?: number | string | null;
  clicks?: number | string | null;
  link_clicks?: number | string | null;
  form_leads?: number | string | null;
  messaging_started?: number | string | null;
};

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

const ROTULO_RESULTADO: Record<string, string> = {
  pendente: "Pendente",
  executando: "Executando",
  ok: "Ok",
  simulado: "Simulado",
  falhou: "Falhou",
  bloqueado: "Bloqueado",
};

const ROTULO_TIQUE: Record<string, string> = {
  primeiro_passe: "Primeiro passe",
  leve: "Leve",
  fundo: "Fundo",
};

function rotuloResultado(r: string): string {
  return ROTULO_RESULTADO[r] ?? r;
}

function rotuloTique(t: string): string {
  return ROTULO_TIQUE[t] ?? t;
}

function varianteResultado(r: string): "default" | "secondary" | "destructive" | "outline" {
  if (r === "falhou" || r === "bloqueado") return "destructive";
  if (r === "ok") return "default";
  if (r === "simulado") return "secondary";
  return "outline";
}

function linhaRespostaMeta(raw: unknown): string {
  if (raw == null || raw === "") return "—";
  if (typeof raw === "string") return raw.trim() || "—";
  if (typeof raw !== "object") return String(raw);
  const o = raw as Record<string, unknown>;
  for (const k of ["motivo", "error", "erro", "mensagem", "message", "nota"]) {
    const v = o[k];
    if (typeof v === "string" && v.trim()) return v.trim();
  }
  try {
    const s = JSON.stringify(raw);
    if (!s || s === "{}") return "—";
    return s.length > 160 ? `${s.slice(0, 157)}…` : s;
  } catch {
    return "—";
  }
}

function textoDryRun(dryRun: boolean | null | undefined): string | null {
  if (dryRun === true) return "Simulação (dry-run): a Meta não muda.";
  if (dryRun === false) return "Escrita real na Meta, presa ao teto e ao prazo.";
  return null;
}

function num(v: unknown): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function maxYmd(a: string, b: string): string {
  return a >= b ? a : b;
}

function minYmd(a: string, b: string): string {
  return a <= b ? a : b;
}

function corteRealizado(periodoInicio: string, concessaoIso: string | null): string {
  if (!concessaoIso) return periodoInicio;
  const ymd = hojeYmdBrasilia(new Date(concessaoIso));
  return maxYmd(periodoInicio, ymd);
}

function planoDaMissao(raw: unknown): PlanoRitmo | null {
  if (!raw || typeof raw !== "object") return parsePlanoRitmo(raw);
  const o = raw as Record<string, unknown>;
  if (typeof o.leitura === "string") {
    return parsePlanoRitmo({ ...o, leitura: { texto: o.leitura } });
  }
  return parsePlanoRitmo(raw);
}

function campoAto(ato: AtoPlano, chave: string): string {
  const v = (ato as Record<string, unknown>)[chave];
  return typeof v === "string" ? v : "";
}

function fmtHorizonte(n: number | null, metrica: string): string {
  if (n == null) return "—";
  if (metrica === "ctr" || metrica === "ctr_link") return fmtPct(n);
  return fmtInt(n);
}

function realizadoDaMetrica(metrica: string, snaps: SnapLinha[]): number | null {
  if (snaps.length === 0) return null;
  let impressions = 0;
  let clicks = 0;
  let link = 0;
  let form = 0;
  let conv = 0;
  let reach = 0;
  let temReach = false;
  for (const s of snaps) {
    impressions += num(s.impressions);
    clicks += num(s.clicks);
    link += num(s.link_clicks);
    form += num(s.form_leads);
    conv += num(s.messaging_started);
    if (s.reach != null && s.reach !== "") {
      reach += num(s.reach);
      temReach = true;
    }
  }
  if (metrica === "conversas") return conv;
  if (metrica === "cliques_no_link") return link;
  if (metrica === "formularios") return form;
  if (metrica === "impressoes") return impressions;
  if (metrica === "alcance") return temReach ? reach : null;
  if (metrica === "ctr") return impressions > 0 ? (100 * clicks) / impressions : null;
  if (metrica === "ctr_link") return impressions > 0 ? (100 * link) / impressions : null;
  return null;
}

function horizonteVencido(dias: number): "d3" | "d7" | "d15" | "d30" | null {
  if (dias >= 30) return "d30";
  if (dias >= 15) return "d15";
  if (dias >= 7) return "d7";
  if (dias >= 3) return "d3";
  return null;
}

function diasDoHorizonte(h: "d3" | "d7" | "d15" | "d30"): number {
  if (h === "d3") return 3;
  if (h === "d7") return 7;
  if (h === "d15") return 15;
  return 30;
}

function BlocoLeitura({ leitura }: { leitura: Record<string, unknown> | undefined }) {
  if (!leitura || Object.keys(leitura).length === 0) {
    return <p className="text-sm text-muted-foreground">Sem leitura gravada.</p>;
  }
  const texto = leitura.texto;
  const resto = Object.entries(leitura).filter(([k]) => k !== "texto");
  return (
    <div className="space-y-3 text-sm">
      {typeof texto === "string" && texto.trim() ? (
        <p className="whitespace-pre-wrap">{texto}</p>
      ) : null}
      {resto.map(([k, v]) => (
        <div key={k}>
          <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
            {k.replaceAll("_", " ")}
          </p>
          <p className="whitespace-pre-wrap">
            {typeof v === "string" ? v : JSON.stringify(v)}
          </p>
        </div>
      ))}
    </div>
  );
}

function CelulasHorizonte({
  h,
  metrica,
  destaque,
}: {
  h: Horizontes;
  metrica: string;
  destaque?: "d3" | "d7" | "d15" | "d30" | null;
}) {
  const cols: Array<"d3" | "d7" | "d15" | "d30"> = ["d3", "d7", "d15", "d30"];
  return (
    <>
      {cols.map((c) => (
        <TableCell
          key={c}
          className={`text-right tabular-nums ${destaque === c ? "font-semibold" : ""}`}
        >
          {fmtHorizonte(h[c], metrica)}
        </TableCell>
      ))}
    </>
  );
}

export function DetalheMissao({
  missao,
  isAdmin,
  companyId,
  onMudou,
}: {
  missao: MissaoRitmo;
  isAdmin: boolean;
  companyId: string;
  onMudou?: () => void;
}) {
  const [ocupado, setOcupado] = useState(false);
  const qc = useQueryClient();
  const plano = useMemo(() => planoDaMissao(missao.plano_json), [missao.plano_json]);
  const leitura =
    plano?.leitura ??
    (missao.leitura_json && typeof missao.leitura_json === "object"
      ? (missao.leitura_json as Record<string, unknown>)
      : undefined);
  const nDias = nDiasPrazo(missao.periodo_inicio, missao.periodo_fim);
  const temSonho = missao.sonho != null && Number(missao.sonho) > 0;
  const corte = corteRealizado(missao.periodo_inicio, missao.autonomia_concedida_em);
  const hoje = hojeYmdBrasilia(new Date());
  const fimAteHoje = minYmd(hoje, missao.periodo_fim);
  const diasDecorridos = nDiasPrazo(corte, fimAteHoje);
  const vencido = horizonteVencido(diasDecorridos);
  const fimSnap = vencido
    ? minYmd(fimAteHoje, addDaysYmd(corte, diasDoHorizonte(vencido) - 1))
    : fimAteHoje;

  const realizadoQ = useQuery({
    queryKey: [
      "ritmo-realizado",
      companyId,
      missao.id,
      missao.campaign_id,
      corte,
      fimSnap,
    ],
    enabled: !!companyId && !!missao.campaign_id && corte <= fimSnap,
    queryFn: async (): Promise<SnapLinha[]> => {
      const db = supabase as unknown as SupabaseClient;
      const { data: camp, error: campErr } = await db
        .from("campaigns")
        .select("id")
        .eq("company_id", companyId)
        .eq("external_id", missao.campaign_id)
        .maybeSingle();
      if (campErr) throw campErr;
      const campId = (camp as { id?: string } | null)?.id;
      if (!campId) return [];
      const { data, error } = await db
        .from("metric_snapshots")
        .select(
          "snapshot_date,impressions,reach,clicks,link_clicks,form_leads,messaging_started",
        )
        .eq("company_id", companyId)
        .eq("campaign_id", campId)
        .gte("snapshot_date", corte)
        .lte("snapshot_date", fimSnap);
      if (error) throw error;
      return (data ?? []) as SnapLinha[];
    },
  });

  const atosQ = useQuery({
    queryKey: ["ritmo-atos", missao.id],
    enabled: !!missao.id,
    queryFn: async (): Promise<AtoRitmo[]> => {
      const { data, error } = await supabase
        .from("ritmo_atos")
        .select("*")
        .eq("missao_id", missao.id)
        .order("criado_em");
      if (error) throw error;
      return (data ?? []) as AtoRitmo[];
    },
  });

  const dryRunQ = useQuery({
    queryKey: ["ritmo-dry-run", companyId],
    enabled: !!companyId,
    queryFn: async (): Promise<boolean | null> => {
      const db = supabase as unknown as SupabaseClient;
      const { data, error } = await db
        .from("meta_execution_config")
        .select("dry_run")
        .eq("company_id", companyId)
        .maybeSingle();
      if (error) throw error;
      if (!data || typeof data !== "object" || Array.isArray(data)) return null;
      const v = (data as { dry_run?: unknown }).dry_run;
      return typeof v === "boolean" ? v : null;
    },
  });

  const snaps = (realizadoQ.data ?? []).filter((s) => {
    const ymd = (s.snapshot_date ?? "").slice(0, 10);
    return ymd >= corte && ymd <= fimSnap;
  });
  const realizado = realizadoDaMetrica(missao.metrica, snaps);
  const mostrarRealizado = snaps.length > 0 && realizado !== null;

  const reenviar = async () => {
    if (ocupado) return;
    setOcupado(true);
    try {
      const { data, error } = await supabase.rpc("reenviar_ritmo_analise", { p_id: missao.id });
      if (error) throw error;
      const id = String(data ?? missao.id);
      const inv = await supabase.functions.invoke("traffic-agent-job", {
        body: { modo: "ritmo_analise", missao_id: id },
      });
      if (inv.error) throw new Error(inv.error.message);
      await logAudit({
        companyId,
        action: "ritmo.analise",
        targetType: "ritmo_missoes",
        targetId: id,
      });
      toast.success("Análise na fila de novo.");
      onMudou?.();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Não foi possível reenviar a análise.");
    } finally {
      setOcupado(false);
    }
  };

  const autorizar = async () => {
    if (ocupado) return;
    setOcupado(true);
    try {
      const { data, error } = await supabase.rpc("autorizar_ritmo_missao", { p_id: missao.id });
      if (error) throw error;
      const r = data as { ok?: boolean; motivo?: string } | null;
      if (r?.ok !== true) {
        const motivo = typeof r?.motivo === "string" ? r.motivo.trim() : "";
        toast.error(motivo || "Não foi possível autorizar.");
        return;
      }
      const inv = await supabase.functions.invoke("ritmo-executar", {
        body: { modo: "primeiro_passe", missao_id: missao.id },
      });
      if (inv.error) throw new Error(inv.error.message);
      await logAudit({
        companyId,
        action: "ritmo.autorizar",
        targetType: "ritmo_missoes",
        targetId: missao.id,
      });
      toast.success("Força-tarefa autorizada.");
      void qc.invalidateQueries({ queryKey: ["ritmo-atos", missao.id] });
      onMudou?.();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Não foi possível autorizar.");
    } finally {
      setOcupado(false);
    }
  };

  const encerrar = async () => {
    if (ocupado) return;
    setOcupado(true);
    try {
      const { error } = await supabase.rpc("encerrar_ritmo_missao", {
        p_id: missao.id,
        p_motivo: missao.status === "em_execucao" ? "humano" : "descartada",
      });
      if (error) throw error;
      await logAudit({
        companyId,
        action: "ritmo.encerrar",
        targetType: "ritmo_missoes",
        targetId: missao.id,
      });
      toast.success("Força-tarefa encerrada.");
      onMudou?.();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Não foi possível encerrar.");
    } finally {
      setOcupado(false);
    }
  };

  const sonhoHorizontes: Horizontes = {
    d3: temSonho ? Number(missao.sonho) : null,
    d7: temSonho ? Number(missao.sonho) : null,
    d15: temSonho ? Number(missao.sonho) : null,
    d30: temSonho ? Number(missao.sonho) : null,
  };

  const realizadoHorizontes: Horizontes = {
    d3: vencido === "d3" ? realizado : null,
    d7: vencido === "d7" ? realizado : null,
    d15: vencido === "d15" ? realizado : null,
    d30: vencido === "d30" ? realizado : null,
  };

  const atos = atosQ.data ?? [];
  const declaracaoDryRun = textoDryRun(dryRunQ.data);
  const mostraAutorizarArea =
    missao.status === "plano_pronto" || missao.status === "em_execucao";
  const mostraHistorico =
    missao.status !== "em_analise" && missao.status !== "analise_falhou";

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="space-y-1">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-lg font-semibold">{missao.campaign_name || missao.campaign_id}</h2>
            <Badge variant={varianteStatus(missao.status)}>{rotuloStatus(missao.status)}</Badge>
          </div>
          <p className="text-sm text-muted-foreground">
            {rotuloMetrica(missao.metrica) || missao.metrica}
            {missao.teto_gasto_janela != null
              ? ` · teto ${fmtBRL(Number(missao.teto_gasto_janela))}`
              : ""}
          </p>
        </div>
        {mostraAutorizarArea && (
          <div className="flex max-w-md flex-col items-end gap-2">
            {declaracaoDryRun && (
              <p className="text-right text-sm text-muted-foreground">{declaracaoDryRun}</p>
            )}
            {isAdmin && (
              <div className="flex flex-wrap gap-2">
                {missao.status === "plano_pronto" && (
                  <Button type="button" disabled={ocupado} onClick={() => void autorizar()}>
                    Autorizar
                  </Button>
                )}
                <Button type="button" variant="outline" disabled={ocupado} onClick={() => void encerrar()}>
                  Encerrar agora
                </Button>
              </div>
            )}
          </div>
        )}
      </div>

      {missao.status === "em_analise" && (
        <Card className="p-4 text-sm text-muted-foreground">Os agentes estão lendo a campanha…</Card>
      )}

      {missao.status === "analise_falhou" && (
        <Card className="space-y-3 border-destructive/40 bg-destructive/10 p-4">
          <p className="text-sm">{missao.erro_analise || "A análise falhou e não deixou detalhe."}</p>
          {isAdmin && (
            <Button type="button" variant="outline" disabled={ocupado} onClick={() => void reenviar()}>
              Tentar análise de novo
            </Button>
          )}
        </Card>
      )}

      {plano && missao.status !== "em_analise" && missao.status !== "analise_falhou" && (
        <>
          <Card className="space-y-3 p-4">
            <h3 className="text-base font-semibold">Leitura</h3>
            <BlocoLeitura leitura={leitura} />
            <p className="text-sm text-muted-foreground">
              Baseline: {fmtBRL(plano.baseline.gasto_diario)}/dia em {plano.baseline.dias_usados}{" "}
              dias com gasto (confiança {plano.baseline.confianca}). Teto da janela:{" "}
              {fmtBRL(plano.teto_janela)}.
            </p>
            {plano.baseline.confianca === "baixa" && (
              <p className="text-sm text-amber-700 dark:text-amber-400">
                Amostra pequena: a confiança do ritmo de gasto é baixa.
              </p>
            )}
          </Card>

          <Card className="space-y-3 p-4">
            <h3 className="text-base font-semibold">Possibilidades</h3>
            {plano.sonho?.atingivel_no_prazo === false && (
              <p className="text-sm font-medium">
                {plano.sonho.nota || "O sonho fica acima do máximo honesto no prazo."}
              </p>
            )}
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Série</TableHead>
                  <TableHead className="text-right">3</TableHead>
                  <TableHead className="text-right">7</TableHead>
                  <TableHead className="text-right">15</TableHead>
                  <TableHead className="text-right">30</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                <TableRow>
                  <TableCell>Se nada mudar</TableCell>
                  <CelulasHorizonte h={plano.possibilidades.nada_muda} metrica={missao.metrica} />
                </TableRow>
                <TableRow>
                  <TableCell>Se executar o plano</TableCell>
                  <CelulasHorizonte
                    h={plano.possibilidades.plano}
                    metrica={missao.metrica}
                    destaque={vencido}
                  />
                </TableRow>
                <TableRow>
                  <TableCell>Máximo do envelope</TableCell>
                  <CelulasHorizonte h={plano.possibilidades.maximo_envelope} metrica={missao.metrica} />
                </TableRow>
                {temSonho && (
                  <TableRow>
                    <TableCell>Sonho (não é previsão)</TableCell>
                    <CelulasHorizonte h={sonhoHorizontes} metrica={missao.metrica} />
                  </TableRow>
                )}
                {mostrarRealizado && vencido && (
                  <TableRow>
                    <TableCell>
                      Realizado até agora (horizonte de {diasDoHorizonte(vencido)} dias)
                    </TableCell>
                    <CelulasHorizonte h={realizadoHorizontes} metrica={missao.metrica} destaque={vencido} />
                  </TableRow>
                )}
              </TableBody>
            </Table>
            {mostrarRealizado && !vencido && (
              <p className="text-sm text-muted-foreground">
                Realizado até agora ({diasDecorridos} dias): {fmtHorizonte(realizado, missao.metrica)}
              </p>
            )}
            {nDias < 15 && (
              <p className="text-xs text-muted-foreground">
                15 e 30 dias: se o ritmo novo se manter depois do prazo
              </p>
            )}
            {plano.premissas && plano.premissas.length > 0 && (
              <ul className="list-disc space-y-1 pl-5 text-sm text-muted-foreground">
                {plano.premissas.map((p) => (
                  <li key={p}>{p}</li>
                ))}
              </ul>
            )}
          </Card>

          <Card className="space-y-3 p-4">
            <h3 className="text-base font-semibold">Plano</h3>
            {plano.atos.length === 0 ? (
              <p className="text-sm text-muted-foreground">Nenhum ato no plano.</p>
            ) : (
              <ol className="list-decimal space-y-4 pl-5">
                {plano.atos.map((ato, i) => (
                  <li key={`${ato.acao}-${ato.alvo_external_id ?? i}`} className="space-y-1 text-sm">
                    <p className="font-medium">
                      {ato.acao}
                      {ato.alvo_external_id ? ` · ${ato.alvo_external_id}` : ""}
                      {ato.quando ? ` · ${ato.quando}` : ""}
                      {!ato.executavel ? " · não executável" : ""}
                    </p>
                    {campoAto(ato, "evidencia") && (
                      <p>
                        <span className="text-muted-foreground">Evidência: </span>
                        {campoAto(ato, "evidencia")}
                      </p>
                    )}
                    {campoAto(ato, "mecanismo") && (
                      <p>
                        <span className="text-muted-foreground">Mecanismo: </span>
                        {campoAto(ato, "mecanismo")}
                      </p>
                    )}
                    {campoAto(ato, "metrica_sucesso") && (
                      <p>
                        <span className="text-muted-foreground">Métrica de sucesso: </span>
                        {campoAto(ato, "metrica_sucesso")}
                      </p>
                    )}
                    {campoAto(ato, "janela_leitura") && (
                      <p>
                        <span className="text-muted-foreground">Janela de leitura: </span>
                        {campoAto(ato, "janela_leitura")}
                      </p>
                    )}
                    {campoAto(ato, "reversa") && (
                      <p>
                        <span className="text-muted-foreground">Reversa: </span>
                        {campoAto(ato, "reversa")}
                      </p>
                    )}
                  </li>
                ))}
              </ol>
            )}
            {plano.recusas.length > 0 && (
              <div className="space-y-1">
                <p className="text-sm font-medium">Recusas</p>
                <ul className="list-disc pl-5 text-sm text-muted-foreground">
                  {plano.recusas.map((r) => (
                    <li key={r}>{r}</li>
                  ))}
                </ul>
              </div>
            )}
            {plano.lacunas && plano.lacunas.length > 0 && (
              <div className="space-y-1">
                <p className="text-sm font-medium">Lacunas</p>
                <ul className="list-disc pl-5 text-sm text-muted-foreground">
                  {plano.lacunas.map((l) => (
                    <li key={l}>{l}</li>
                  ))}
                </ul>
              </div>
            )}
          </Card>
        </>
      )}

      {mostraHistorico && (
        <Card className="space-y-3 p-4">
          <h3 className="text-base font-semibold">Histórico de atos</h3>
          {atosQ.isError ? (
            <p className="text-sm text-muted-foreground">Não foi possível carregar os atos.</p>
          ) : atos.length === 0 ? (
            <p className="text-sm text-muted-foreground">Nenhum ato ainda.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Ação</TableHead>
                  <TableHead>Alvo</TableHead>
                  <TableHead>Tique</TableHead>
                  <TableHead>Resultado</TableHead>
                  <TableHead>Resposta da Meta</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {atos.map((ato) => (
                  <TableRow key={ato.id}>
                    <TableCell className="font-medium">{ato.acao}</TableCell>
                    <TableCell className="tabular-nums">{ato.alvo_external_id || "—"}</TableCell>
                    <TableCell>{rotuloTique(ato.tique)}</TableCell>
                    <TableCell>
                      <Badge variant={varianteResultado(ato.resultado)}>
                        {rotuloResultado(ato.resultado)}
                      </Badge>
                    </TableCell>
                    <TableCell className="max-w-xs text-sm text-muted-foreground">
                      {linhaRespostaMeta(ato.resposta_meta)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </Card>
      )}
    </div>
  );
}
