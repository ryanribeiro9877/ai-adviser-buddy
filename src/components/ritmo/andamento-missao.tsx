import { Badge } from "@/components/ui/badge";
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
import {
  montarAndamentoRitmo,
  rotuloAcaoRitmo,
  type AndamentoRitmo,
  type AtoAndamento,
  type DiaAndamento,
} from "@/lib/ritmo";
import type { Tables } from "@/integrations/supabase/types";

type SnapLinha = {
  snapshot_date?: string | null;
  spend?: number | string | null;
  impressions?: number | string | null;
  reach?: number | string | null;
  clicks?: number | string | null;
  link_clicks?: number | string | null;
  form_leads?: number | string | null;
  messaging_started?: number | string | null;
};

function ymdBr(ymd: string): string {
  const s = ymd.slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return ymd;
  return `${s.slice(8, 10)}/${s.slice(5, 7)}/${s.slice(0, 4)}`;
}

function fmtMetrica(n: number | null, metrica: string): string {
  if (n == null) return "—";
  if (metrica === "ctr" || metrica === "ctr_link") return fmtPct(n);
  return fmtInt(n);
}

function rotuloResultado(r: string | null | undefined): string {
  if (r === "ok") return "Ok";
  if (r === "simulado") return "Simulado";
  if (r === "falhou") return "Falhou";
  if (r === "bloqueado") return "Bloqueado";
  if (r === "pendente") return "Pendente";
  if (r === "executando") return "Executando";
  return r?.trim() || "—";
}

function varianteResultado(r: string | null | undefined): "default" | "secondary" | "destructive" | "outline" {
  if (r === "falhou" || r === "bloqueado") return "destructive";
  if (r === "ok") return "default";
  if (r === "simulado") return "secondary";
  return "outline";
}

export function montarEntradaAndamento(opts: {
  missao: Pick<
    Tables<"ritmo_missoes">,
    "metrica" | "sonho" | "teto_gasto_janela" | "periodo_inicio" | "periodo_fim"
  >;
  snaps: SnapLinha[];
  atos: AtoAndamento[];
  hoje: string;
  corte: string;
  fechadoHoje: boolean;
}): AndamentoRitmo | null {
  return montarAndamentoRitmo({
    metrica: opts.missao.metrica,
    sonho: opts.missao.sonho == null ? null : Number(opts.missao.sonho),
    teto: opts.missao.teto_gasto_janela == null ? null : Number(opts.missao.teto_gasto_janela),
    periodo_inicio: opts.missao.periodo_inicio,
    periodo_fim: opts.missao.periodo_fim,
    corte: opts.corte,
    hoje: opts.hoje,
    fechado: opts.fechadoHoje,
    snaps: opts.snaps.map((s) => ({
      date: String(s.snapshot_date ?? "").slice(0, 10),
      spend: s.spend,
      impressions: s.impressions,
      reach: s.reach,
      clicks: s.clicks,
      link_clicks: s.link_clicks,
      form_leads: s.form_leads,
      messaging_started: s.messaging_started,
    })),
    atos: opts.atos,
  });
}

function LinhaAtos({ dia, metrica }: { dia: DiaAndamento; metrica: string }) {
  if (dia.atos.length === 0) {
    return <span className="text-muted-foreground">Nenhum ato</span>;
  }
  return (
    <ul className="space-y-1">
      {dia.atos.map((a, i) => (
        <li key={`${a.acao}-${a.alvo_external_id ?? i}-${metrica}`} className="flex flex-wrap items-center gap-1">
          <span>{rotuloAcaoRitmo(a.acao)}</span>
          {a.alvo_external_id ? (
            <span className="tabular-nums text-muted-foreground">{a.alvo_external_id}</span>
          ) : null}
          <Badge variant={varianteResultado(a.resultado)}>{rotuloResultado(a.resultado)}</Badge>
        </li>
      ))}
    </ul>
  );
}

export function AndamentoMissao({
  andamento,
  diarios,
}: {
  andamento: AndamentoRitmo;
  diarios: Pick<Tables<"ritmo_diarios">, "data_civil" | "narrativa" | "fechado_em">[];
}) {
  const porDia = new Map(
    diarios.map((d) => [String(d.data_civil).slice(0, 10), d] as const),
  );
  const dias = [...andamento.dias].reverse();
  const hojeYmd = andamento.dias.at(-1)?.data;
  const metrica = andamento.metrica;

  return (
    <Card className="space-y-4 p-4">
      <div className="space-y-1">
        <h3 className="text-base font-semibold">Andamento</h3>
        <p className="text-sm text-muted-foreground">
          Um dia civil em Brasília. Números da campanha na coleta; atos dos agentes na hora em
          que tentaram. O texto de fechamento sai às 18:30.
        </p>
      </div>
      <p className="text-sm">
        {fmtMetrica(andamento.metrica_janela, metrica)} {andamento.rotulo_metrica.toLowerCase()} no
        prazo
        {andamento.sonho != null
          ? ` · sonho ${fmtMetrica(andamento.sonho, metrica)}`
          : ""}
        {andamento.teto != null
          ? ` · gasto ${fmtBRL(andamento.gasto_janela)} / teto ${fmtBRL(andamento.teto)}`
          : ` · gasto ${fmtBRL(andamento.gasto_janela)}`}
      </p>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Dia</TableHead>
            <TableHead className="text-right">Gasto</TableHead>
            <TableHead className="text-right">{andamento.rotulo_metrica}</TableHead>
            <TableHead className="text-right">Custo</TableHead>
            <TableHead>Agentes</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {dias.map((dia) => {
            const fechado = porDia.has(dia.data) || dia.fechado;
            return (
              <TableRow key={dia.data}>
                <TableCell className="whitespace-nowrap">
                  <div className="font-medium tabular-nums">{ymdBr(dia.data)}</div>
                  <div className="text-xs text-muted-foreground">
                    {fechado && porDia.has(dia.data)
                      ? "Fechamento 18:30"
                      : dia.data === hojeYmd && !fechado
                        ? "Até agora"
                        : dia.tem_coleta
                          ? "Coleta do dia"
                          : "Sem coleta"}
                  </div>
                </TableCell>
                <TableCell className="text-right tabular-nums">
                  {dia.tem_coleta ? fmtBRL(dia.gasto) : "—"}
                </TableCell>
                <TableCell className="text-right tabular-nums">
                  {dia.tem_coleta ? fmtMetrica(dia.metrica_valor, metrica) : "—"}
                </TableCell>
                <TableCell className="text-right tabular-nums">
                  {dia.custo != null ? fmtBRL(dia.custo) : "—"}
                </TableCell>
                <TableCell className="text-sm">
                  <LinhaAtos dia={dia} metrica={metrica} />
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
      <div className="space-y-3">
        {dias.map((dia) => {
          const gravado = porDia.get(dia.data);
          const texto = gravado?.narrativa?.trim() || dia.narrativa;
          return (
            <div key={`n-${dia.data}`} className="space-y-1 border-t border-border pt-3">
              <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                {gravado ? `Status de ${ymdBr(dia.data)} · 18:30` : `Status de ${ymdBr(dia.data)}`}
              </p>
              <p className="whitespace-pre-wrap text-sm">{texto}</p>
            </div>
          );
        })}
      </div>
    </Card>
  );
}
