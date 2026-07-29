import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import { Copy, Download, CalendarDays } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { exportarXlsx, nomeComPeriodo } from "@/lib/xlsx-export";
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
type Relatorio = {
  periodo: { inicio: string; fim: string; dias_com_dado: number; dias_no_periodo: number };
  investimento: number;
  formularios: number;
  custo_por_formulario: number;
  cliques_link: number;
  custo_por_clique: number;
  visualizacoes_pagina: number;
  ctr_pct: number;
  conversao_view_form_pct: number;
  por_campanha: { campanha: string; gasto: number; formularios: number }[];
  nao_disponivel: string[];
};

const brl = (n: number) =>
  n.toLocaleString("pt-BR", { style: "currency", currency: "BRL", minimumFractionDigits: 2 });
const int = (n: number) => n.toLocaleString("pt-BR");
const pct = (n: number) =>
  `${n.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}%`;
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
    `🔗 Cliques no link: ${int(r.cliques_link)}`,
    `💸 Custo por clique: ${brl(r.custo_por_clique)}`,
    `👀 Visualizações da página: ${int(r.visualizacoes_pagina)}`,
    `📊 CTR: ${pct(r.ctr_pct)}`,
    `📈 Conversão (visualização → formulário): ${pct(r.conversao_view_form_pct)}`,
  ];
  if (r.por_campanha?.length) {
    L.push(``, `Por campanha:`);
    for (const c of r.por_campanha) {
      L.push(`• ${c.campanha}: ${brl(c.gasto)} · ${int(c.formularios)} formulários`);
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

export function WeeklyReport({ companyId }: { companyId: string }) {
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

  const exportar = () => {
    if (!r) return;
    const linhas = [
      { Métrica: "Investimento", Valor: r.investimento },
      { Métrica: "Formulários", Valor: r.formularios },
      { Métrica: "Custo por formulário", Valor: r.custo_por_formulario },
      { Métrica: "Cliques no link", Valor: r.cliques_link },
      { Métrica: "Custo por clique", Valor: r.custo_por_clique },
      { Métrica: "Visualizações da página", Valor: r.visualizacoes_pagina },
      { Métrica: "CTR (%)", Valor: r.ctr_pct },
      { Métrica: "Conversão view→form (%)", Valor: r.conversao_view_form_pct },
      ...(r.por_campanha ?? []).flatMap((c) => [
        { Métrica: `Campanha — ${c.campanha} (gasto)`, Valor: c.gasto },
        { Métrica: `Campanha — ${c.campanha} (formulários)`, Valor: c.formularios },
      ]),
      ...(r.nao_disponivel ?? []).map((n) => ({ Métrica: "Não disponível", Valor: n })),
    ];
    exportarXlsx(linhas, nomeComPeriodo("relatorio", r.periodo.inicio, r.periodo.fim), "Relatório");
  };

  const METRICAS = r
    ? [
        { emoji: "💰", label: "Investimento", valor: brl(r.investimento) },
        { emoji: "📝", label: "Formulários", valor: int(r.formularios) },
        { emoji: "🎯", label: "Custo por formulário", valor: brl(r.custo_por_formulario) },
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
            <label className="text-[11px] text-muted-foreground">Início</label>
            <Input
              type="date"
              value={inicio}
              onChange={(e) => setInicio(e.target.value)}
              className="h-9 w-[150px]"
            />
          </div>
          <div>
            <label className="text-[11px] text-muted-foreground">Fim</label>
            <Input
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
          <Button size="sm" variant="outline" onClick={exportar} disabled={!r}>
            <Download className="mr-1 h-4 w-4" />
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
                    <TableHead className="text-right">Formulários</TableHead>
                    <TableHead className="text-right">Custo por formulário</TableHead>
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
                        {int(c.formularios)}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {c.formularios > 0 ? brl(c.gasto / c.formularios) : "—"}
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
