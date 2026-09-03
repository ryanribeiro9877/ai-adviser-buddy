import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import { Copy, Download, CalendarDays, Loader2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { exportarRelatorioRico, type DadosExport } from "@/lib/relatorio-xlsx";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

// Retorno de get_weekly_report_data. A RPC declara o que NÃO tem em
// `nao_disponivel` — a tela mostra essa lista, nunca omite em silêncio.
// As métricas derivadas (custo por X, CTR, conversão) vêm NULAS quando o
// denominador é zero — a RPC não inventa zero para período sem entrega. Por isso
// todo número aqui é anulável e os formatadores devolvem "—" em vez de quebrar.
type Numero = number | null | undefined;

// Cada campanha declara a BASE do seu resultado e já traz o custo calculado pela
// RPC. A tela não divide gasto por formulários: campanha de conversa tem
// formulários zero, e essa divisão devolvia "—" (ou um número inflado) para
// campanha que estava entregando conversa. O denominador é decisão do banco.
type LinhaCampanha = {
  campanha: string;
  gasto: Numero;
  formularios: Numero;
  conversas: Numero;
  cliques_link: Numero;
  resultados: Numero;
  unidade: string;
  rotulo_da_base: string;
  base_de_resultado: string;
  custo_por_resultado: Numero;
};

type Relatorio = {
  periodo: { inicio: string; fim: string; dias_com_dado: number; dias_no_periodo: number };
  investimento: Numero;
  formularios: Numero;
  custo_por_formulario: Numero;
  conversas: Numero;
  custo_por_conversa: Numero;
  cliques_link: Numero;
  custo_por_clique: Numero;
  visualizacoes_pagina: Numero;
  ctr_pct: Numero;
  conversao_view_form_pct: Numero;
  por_campanha: LinhaCampanha[];
  nao_disponivel: string[];
};

const SEM_DADO = "—";
const finito = (n: Numero): n is number => typeof n === "number" && Number.isFinite(n);

const brl = (n: Numero) =>
  finito(n)
    ? n.toLocaleString("pt-BR", { style: "currency", currency: "BRL", minimumFractionDigits: 2 })
    : SEM_DADO;
const int = (n: Numero) => (finito(n) ? n.toLocaleString("pt-BR") : SEM_DADO);
const pct = (n: Numero) =>
  finito(n)
    ? `${n.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}%`
    : SEM_DADO;
const ddmm = (iso: string) => iso.split("-").reverse().slice(0, 2).join("/");

/** Segunda a domingo da semana anterior — o período que o gestor reporta. */
function semanaAnterior() {
  const hoje = new Date();
  const dow = hoje.getDay(); // 0=dom
  const segundaDestaSemana = new Date(hoje);
  segundaDestaSemana.setDate(hoje.getDate() - ((dow + 6) % 7));
  const fim = new Date(segundaDestaSemana);
  fim.setDate(segundaDestaSemana.getDate() - 1); // domingo passado
  const inicio = new Date(fim);
  inicio.setDate(fim.getDate() - 6); // segunda passada
  const iso = (d: Date) => d.toISOString().slice(0, 10);
  return { inicio: iso(inicio), fim: iso(fim) };
}

/** Texto no layout das mensagens enviadas ao gestor (mesma ordem e emojis). */
function textoWhatsApp(r: Relatorio): string {
  const L = [
    `📅 ${ddmm(r.periodo.inicio)} a ${ddmm(r.periodo.fim)}`,
    ``,
    `💰 Investimento: ${brl(r.investimento)}`,
    `📝 Formulários: ${int(r.formularios)}`,
    `🎯 Custo por formulário: ${brl(r.custo_por_formulario)}`,
  ];
  // Conta só de formulário não ganha duas linhas de conversa zerada; conta com
  // conversa não pode ter a conversa escondida atrás do custo por formulário.
  if (finito(r.conversas) && r.conversas > 0) {
    L.push(
      `💬 Conversas iniciadas: ${int(r.conversas)}`,
      `🗨️ Custo por conversa: ${brl(r.custo_por_conversa)}`,
    );
  }
  L.push(
    `🔗 Cliques no link: ${int(r.cliques_link)}`,
    `💸 Custo por clique: ${brl(r.custo_por_clique)}`,
    `👀 Visualizações da página: ${int(r.visualizacoes_pagina)}`,
    `📊 CTR: ${pct(r.ctr_pct)}`,
    `📈 Conversão (visualização → formulário): ${pct(r.conversao_view_form_pct)}`,
  );
  if (r.por_campanha?.length) {
    L.push(``, `Por campanha:`);
    for (const c of r.por_campanha) {
      const custo = finito(c.custo_por_resultado)
        ? ` · ${brl(c.custo_por_resultado)} ${c.rotulo_da_base}`
        : "";
      L.push(`• ${c.campanha}: ${brl(c.gasto)} · ${int(c.resultados)} ${c.unidade}${custo}`);
    }
  }
  if (r.nao_disponivel?.length) {
    L.push(``, `Não disponível:`);
    // Mostra só o rótulo do item; o motivo técnico fica na tela, não no WhatsApp.
    for (const n of r.nao_disponivel) L.push(`• ${n.split(":")[0].replace(/_/g, " ")}`);
  }
  if (r.periodo.dias_com_dado < r.periodo.dias_no_periodo) {
    L.push(
      ``,
      `⚠️ Cobertura: ${r.periodo.dias_com_dado} de ${r.periodo.dias_no_periodo} dias com dado.`,
    );
  }
  return L.join("\n");
}

export function WeeklyReport({
  companyId,
  empresaNome = "empresa",
}: {
  companyId: string;
  empresaNome?: string;
}) {
  const inicial = useMemo(semanaAnterior, []);
  const [inicio, setInicio] = useState(inicial.inicio);
  const [fim, setFim] = useState(inicial.fim);

  const q = useQuery({
    queryKey: ["weekly-report", companyId, inicio, fim],
    enabled: !!companyId && !!inicio && !!fim,
    queryFn: async () => {
      const { data, error } = await supabase.rpc("get_weekly_report_data", {
        p_company_id: companyId,
        p_start: inicio,
        p_end: fim,
      });
      if (error) throw error;
      return data as unknown as Relatorio;
    },
  });

  const r = q.data;

  const copiar = async () => {
    if (!r) return;
    try {
      await navigator.clipboard.writeText(textoWhatsApp(r));
      toast.success("Relatório copiado — cole no WhatsApp.");
    } catch {
      toast.error("O navegador bloqueou a cópia. Selecione o texto abaixo manualmente.");
    }
  };

  // A exportação usa uma RPC própria (get_report_export_data), que devolve série
  // diária, campanhas, anúncios e tetos — bem mais que a RPC da tela. As métricas
  // derivadas vão como FÓRMULA na planilha, então o arquivo é auditável no Excel.
  const [exportando, setExportando] = useState(false);
  const exportar = async () => {
    setExportando(true);
    try {
      const { data, error } = await supabase.rpc("get_report_export_data", {
        p_company_id: companyId,
        p_start: inicio,
        p_end: fim,
      });
      if (error) throw error;
      const dados = data as unknown as DadosExport;
      if (!dados?.serie_diaria?.length) {
        toast.error("Sem dados no período para exportar.");
        return;
      }
      const nome = await exportarRelatorioRico(dados, empresaNome);
      toast.success(`Planilha gerada: ${nome}`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      toast.error(`Não foi possível gerar a planilha: ${msg.slice(0, 140)}`);
    } finally {
      setExportando(false);
    }
  };

  const temConversa = r ? finito(r.conversas) && r.conversas > 0 : false;
  const METRICAS = r
    ? [
        { emoji: "💰", label: "Investimento", valor: brl(r.investimento) },
        { emoji: "📝", label: "Formulários", valor: int(r.formularios) },
        { emoji: "🎯", label: "Custo por formulário", valor: brl(r.custo_por_formulario) },
        ...(temConversa
          ? [
              { emoji: "💬", label: "Conversas iniciadas", valor: int(r.conversas) },
              { emoji: "🗨️", label: "Custo por conversa", valor: brl(r.custo_por_conversa) },
            ]
          : []),
        { emoji: "🔗", label: "Cliques no link", valor: int(r.cliques_link) },
        { emoji: "💸", label: "Custo por clique", valor: brl(r.custo_por_clique) },
        { emoji: "👀", label: "Visualizações da página", valor: int(r.visualizacoes_pagina) },
        { emoji: "📊", label: "CTR", valor: pct(r.ctr_pct) },
        { emoji: "📈", label: "Conversão (view → form)", valor: pct(r.conversao_view_form_pct) },
      ]
    : [];

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="flex items-center gap-2 text-lg font-semibold">
            <CalendarDays className="h-5 w-5 text-primary" />
            Relatório semanal
          </h2>
          <p className="text-xs text-muted-foreground">
            Padrão: segunda a domingo da semana anterior. Os números vêm do banco; a análise em
            texto é escrita pelo gestor IA no chat.
          </p>
        </div>
        <div className="flex flex-wrap items-end gap-2">
          <div>
            <label htmlFor="weekly-inicio" className="text-[11px] text-muted-foreground">
              Início
            </label>
            <Input
              id="weekly-inicio"
              type="date"
              value={inicio}
              onChange={(e) => setInicio(e.target.value)}
              className="h-9 w-[150px]"
            />
          </div>
          <div>
            <label htmlFor="weekly-fim" className="text-[11px] text-muted-foreground">
              Fim
            </label>
            <Input
              id="weekly-fim"
              type="date"
              value={fim}
              onChange={(e) => setFim(e.target.value)}
              className="h-9 w-[150px]"
            />
          </div>
          <Button size="sm" variant="outline" onClick={copiar} disabled={!r}>
            <Copy className="mr-1 h-4 w-4" />
            Copiar para WhatsApp
          </Button>
          <Button size="sm" variant="outline" onClick={exportar} disabled={!r || exportando}>
            {exportando ? (
              <Loader2 className="mr-1 h-4 w-4 animate-spin" />
            ) : (
              <Download className="mr-1 h-4 w-4" />
            )}
            Exportar planilha
          </Button>
        </div>
      </div>

      {q.isLoading && <Skeleton className="h-40 w-full" />}
      {q.isError && (
        <Card className="p-4 text-sm text-muted-foreground">
          Não foi possível carregar o relatório deste período.
        </Card>
      )}

      {r && (
        <>
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
            {METRICAS.map((m) => (
              <Card key={m.label} className="p-3">
                <div className="text-xs text-muted-foreground">
                  {m.emoji} {m.label}
                </div>
                <div className="mt-0.5 text-xl font-semibold tabular-nums">{m.valor}</div>
              </Card>
            ))}
          </div>

          {r.periodo.dias_com_dado < r.periodo.dias_no_periodo && (
            <div className="rounded-md border border-[color:var(--color-warning)]/40 bg-[color:var(--color-warning)]/10 p-2 text-xs">
              Cobertura incompleta: {r.periodo.dias_com_dado} de {r.periodo.dias_no_periodo} dias
              com dado no período.
            </div>
          )}

          {(r.por_campanha ?? []).length > 0 && (
            <div className="rounded-md border border-border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Campanha</TableHead>
                    <TableHead className="text-right">Investimento</TableHead>
                    <TableHead className="text-right">Resultados</TableHead>
                    <TableHead className="text-right">Custo por resultado</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {r.por_campanha.map((c) => (
                    <TableRow key={c.campanha}>
                      <TableCell className="max-w-[320px] truncate font-medium">
                        {c.campanha}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">{brl(c.gasto)}</TableCell>
                      <TableCell className="text-right tabular-nums">
                        {int(c.resultados)}
                        <span className="ml-1 text-xs text-muted-foreground">{c.unidade}</span>
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {brl(c.custo_por_resultado)}
                        <span className="ml-1 text-xs text-muted-foreground">
                          {c.rotulo_da_base}
                        </span>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}

          {(r.nao_disponivel ?? []).length > 0 && (
            <Card className="p-3">
              <div className="text-sm font-medium">Não disponível</div>
              <ul className="mt-1 space-y-1">
                {r.nao_disponivel.map((n) => (
                  <li key={n} className="text-xs text-muted-foreground">
                    • {n}
                  </li>
                ))}
              </ul>
            </Card>
          )}
        </>
      )}
    </div>
  );
}
