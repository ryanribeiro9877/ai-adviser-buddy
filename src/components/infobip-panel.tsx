import { useMemo, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Upload, Loader2, Download, HelpCircle, X } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useApp } from "@/lib/app-context";
import { lerArquivoInfobip, enviarLotes, type ResultadoImport } from "@/lib/infobip-import";
import { exportarXlsx } from "@/lib/xlsx-export";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

const MAU = "monthly active user";

type Row = {
  message_id: string;
  service_name: string | null;
  traffic_source: string | null;
  communication_name: string | null;
  status: string | null;
  send_at: string | null;
  seen_at: string | null;
  price_raw: number | null;
};

const fmtInt = (n: number) => n.toLocaleString("pt-BR");
const fmtPct1 = (n: number) =>
  `${n.toLocaleString("pt-BR", { minimumFractionDigits: 1, maximumFractionDigits: 1 })}%`;
const fmtNum2 = (n: number) =>
  n.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export function InfobipPanel({ companyId }: { companyId: string }) {
  const { isAdmin } = useApp();
  const qc = useQueryClient();
  const inputRef = useRef<HTMLInputElement>(null);
  const [importando, setImportando] = useState(false);
  const [resultado, setResultado] = useState<ResultadoImport[] | null>(null);
  // "custom" = período digitado nos campos de data. Mexer numa data entra nesse
  // modo; clicar num preset volta para ele e limpa as datas.
  const [dias, setDias] = useState<"30" | "90" | "todos" | "custom">("90");
  const [de, setDe] = useState("");
  const [ate, setAte] = useState("");

  const escolherPreset = (v: "30" | "90" | "todos") => {
    setDias(v);
    setDe("");
    setAte("");
  };
  const mudarData = (qual: "de" | "ate", valor: string) => {
    if (qual === "de") setDe(valor);
    else setAte(valor);
    setDias("custom");
  };

  const dados = useQuery({
    queryKey: ["infobip", companyId, dias, de, ate],
    queryFn: async () => {
      let q = supabase
        .from("infobip_dispatches")
        .select(
          "message_id, service_name, traffic_source, communication_name, status, send_at, seen_at, price_raw",
        )
        .eq("company_id", companyId);
      if (dias === "custom") {
        // Datas soltas são válidas: só início, só fim, ou os dois. O fim inclui o
        // dia inteiro (até 23:59:59 no horário de Brasília, igual ao parser do import).
        if (de) q = q.gte("send_at", `${de}T00:00:00-03:00`);
        if (ate) q = q.lte("send_at", `${ate}T23:59:59.999-03:00`);
      } else if (dias !== "todos") {
        const desde = new Date(Date.now() - Number(dias) * 864e5).toISOString();
        q = q.gte("send_at", desde);
      }
      const { data, error } = await q.limit(20000);
      if (error) throw error;
      return (data ?? []) as Row[];
    },
  });

  // Existe algo importado nesta empresa, ignorando o filtro de período? Sem isso,
  // um período sem movimento mostraria "nenhum dado importado" — mensagem errada.
  const totalGeral = useQuery({
    queryKey: ["infobip-total", companyId],
    queryFn: async () => {
      const { count, error } = await supabase
        .from("infobip_dispatches")
        .select("message_id", { count: "exact", head: true })
        .eq("company_id", companyId);
      if (error) throw error;
      return count ?? 0;
    },
  });

  const resumo = useMemo(() => {
    const rows = dados.data ?? [];
    const mau = rows.filter((r) => (r.service_name ?? "").toLowerCase().includes(MAU));
    const msgs = rows.filter((r) => !(r.service_name ?? "").toLowerCase().includes(MAU));
    const st = (nome: string) =>
      msgs.filter((r) => (r.status ?? "").toLowerCase() === nome.toLowerCase()).length;
    const inbound = msgs.filter((r) =>
      (r.traffic_source ?? "").toLowerCase().includes("inbound"),
    ).length;
    const expiradas = st("Expired");
    return {
      total: msgs.length,
      inbound,
      outbound: msgs.length - inbound,
      entregues: st("Delivered"),
      expiradas,
      pctExpiradas: msgs.length ? (expiradas / msgs.length) * 100 : 0,
      naoEntregues: st("Undeliverable"),
      lidas: msgs.filter((r) => !!r.seen_at).length,
      mau: mau.length,
      preco: msgs.reduce((s, r) => s + Number(r.price_raw ?? 0), 0),
    };
  }, [dados.data]);

  const porTransmissao = useMemo(() => {
    const m = new Map<
      string,
      { nome: string; enviadas: number; entregues: number; lidas: number }
    >();
    for (const r of dados.data ?? []) {
      if ((r.service_name ?? "").toLowerCase().includes(MAU)) continue;
      const nome = r.communication_name || "(sem transmissão)";
      const cur = m.get(nome) ?? { nome, enviadas: 0, entregues: 0, lidas: 0 };
      cur.enviadas += 1;
      if ((r.status ?? "").toLowerCase() === "delivered") cur.entregues += 1;
      if (r.seen_at) cur.lidas += 1;
      m.set(nome, cur);
    }
    return [...m.values()].sort((a, b) => b.enviadas - a.enviadas);
  }, [dados.data]);

  const importar = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const arquivos = Array.from(e.target.files ?? []);
    e.target.value = "";
    if (!arquivos.length) return;
    setImportando(true);
    setResultado(null);
    const metas: ResultadoImport[] = [];
    try {
      for (const f of arquivos) {
        const { rows, meta } = await lerArquivoInfobip(f, companyId);
        if (rows.length === 0) {
          toast.error(`"${f.name}": nenhuma linha com Message Id na aba Data.`);
          continue;
        }
        await enviarLotes(rows);
        metas.push(meta);
      }
      setResultado(metas);
      const total = metas.reduce((s, m) => s + m.linhas, 0);
      toast.success(`${fmtInt(total)} linha(s) processadas — reimportar não duplica.`);
      await qc.invalidateQueries({ queryKey: ["infobip", companyId] });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      toast.error(
        /row-level security|permission/i.test(msg)
          ? "Sem permissão para importar (apenas administradores)."
          : `Falha na importação: ${msg.slice(0, 160)}`,
      );
    } finally {
      setImportando(false);
    }
  };

  const exportar = () =>
    exportarXlsx(
      porTransmissao.map((t) => ({
        Transmissão: t.nome,
        Enviadas: t.enviadas,
        Entregues: t.entregues,
        Lidas: t.lidas,
      })),
      // O nome carrega o período consultado, para o arquivo não virar anônimo.
      dias === "custom" && (de || ate)
        ? `infobip_transmissoes_${de || "inicio"}_a_${ate || "hoje"}.xlsx`
        : `infobip_transmissoes_${dias === "todos" ? "tudo" : `${dias}d`}_${new Date().toISOString().slice(0, 10)}.xlsx`,
      "Infobip",
    );

  const vazio = (dados.data ?? []).length === 0;

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-lg font-semibold">Infobip</h2>
        <div className="flex items-center gap-2">
          <ToggleGroup
            type="single"
            value={dias}
            onValueChange={(v) => v && escolherPreset(v as "30" | "90" | "todos")}
            variant="outline"
            size="sm"
          >
            <ToggleGroupItem value="30">30 d</ToggleGroupItem>
            <ToggleGroupItem value="90">90 d</ToggleGroupItem>
            <ToggleGroupItem value="todos">Tudo</ToggleGroupItem>
          </ToggleGroup>

          <div className="flex items-center gap-1">
            <Input
              type="date"
              aria-label="Data inicial"
              value={de}
              max={ate || undefined}
              onChange={(e) => mudarData("de", e.target.value)}
              className="h-8 w-[142px] text-xs"
            />
            <span className="text-xs text-muted-foreground">até</span>
            <Input
              type="date"
              aria-label="Data final"
              value={ate}
              min={de || undefined}
              onChange={(e) => mudarData("ate", e.target.value)}
              className="h-8 w-[142px] text-xs"
            />
            {dias === "custom" && (
              <Button
                size="icon"
                variant="ghost"
                className="h-8 w-8"
                onClick={() => escolherPreset("90")}
                aria-label="Limpar período"
                title="Limpar período"
              >
                <X className="h-4 w-4" />
              </Button>
            )}
          </div>
          {!vazio && (
            <Button size="sm" variant="outline" onClick={exportar}>
              <Download className="mr-1 h-4 w-4" />
              Exportar
            </Button>
          )}
          {isAdmin && (
            <>
              <input
                ref={inputRef}
                type="file"
                accept=".xlsx"
                multiple
                className="hidden"
                onChange={importar}
              />
              <Button size="sm" onClick={() => inputRef.current?.click()} disabled={importando}>
                {importando ? (
                  <Loader2 className="mr-1 h-4 w-4 animate-spin" />
                ) : (
                  <Upload className="mr-1 h-4 w-4" />
                )}
                Importar export da Infobip
              </Button>
            </>
          )}
        </div>
      </div>

      {resultado && resultado.length > 0 && (
        <Card className="p-3 text-sm">
          {resultado.map((r) => (
            <div key={r.arquivo} className="flex flex-wrap gap-x-2 gap-y-0.5">
              <span className="font-medium">{r.arquivo}</span>
              <span className="text-muted-foreground">
                — {r.tipo === "billing" ? "usuários ativos (MAU)" : "mensagens"}: {fmtInt(r.linhas)}{" "}
                linha(s)
                {r.ignoradas > 0 && `, ${r.ignoradas} sem Message Id (ignoradas)`}
                {r.periodo.inicio &&
                  ` · período ${r.periodo.inicio.split("-").reverse().join("/")} a ${r.periodo.fim?.split("-").reverse().join("/")}`}
              </span>
            </div>
          ))}
        </Card>
      )}

      {dados.isLoading ? (
        <Skeleton className="h-24 w-full" />
      ) : vazio && (totalGeral.data ?? 0) > 0 ? (
        <Card className="p-4">
          <div className="text-sm font-medium">Nenhum envio no período selecionado</div>
          <p className="mt-1 text-xs text-muted-foreground">
            Há {fmtInt(totalGeral.data ?? 0)} registro(s) importados nesta empresa, mas nenhum no
            intervalo escolhido. Amplie o período ou use “Tudo”.
          </p>
        </Card>
      ) : vazio ? (
        <Card className="p-4">
          <div className="text-sm font-medium">Nenhum dado da Infobip importado</div>
          <p className="mt-1 text-xs text-muted-foreground">
            {isAdmin
              ? "Use “Importar export da Infobip” e selecione os dois arquivos do período (mensagens e billing). Reimportar o mesmo arquivo não duplica."
              : "A importação é feita por um administrador."}
          </p>
        </Card>
      ) : (
        <>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Card className="p-4">
              <div className="text-xs text-muted-foreground">Mensagens</div>
              <div className="mt-1 text-2xl font-semibold">{fmtInt(resumo.total)}</div>
              <div className="mt-1 text-[11px] text-muted-foreground">
                {fmtInt(resumo.outbound)} enviadas · {fmtInt(resumo.inbound)} recebidas
              </div>
            </Card>
            <Card className="p-4">
              <div className="text-xs text-muted-foreground">Entregues</div>
              <div className="mt-1 text-2xl font-semibold">{fmtInt(resumo.entregues)}</div>
              <div className="mt-1 text-[11px] text-muted-foreground">
                {fmtInt(resumo.lidas)} lidas
              </div>
            </Card>
            <Card className="p-4">
              <div className="text-xs text-muted-foreground">Expiradas</div>
              <div className="mt-1 text-2xl font-semibold text-destructive">
                {fmtPct1(resumo.pctExpiradas)}
              </div>
              <div className="mt-1 text-[11px] text-muted-foreground">
                {fmtInt(resumo.expiradas)} mensagens · {fmtInt(resumo.naoEntregues)} não entregues
              </div>
            </Card>
            <Card className="p-4">
              <div className="flex items-center gap-1 text-xs text-muted-foreground">
                Custo (unidades do export)
                <Tooltip>
                  <TooltipTrigger asChild>
                    <button type="button" className="text-muted-foreground/70">
                      <HelpCircle className="h-3 w-3" />
                    </button>
                  </TooltipTrigger>
                  <TooltipContent className="max-w-[260px] text-left">
                    Soma de Purchase Price como vem no arquivo. Leitura provável: centavos (6 = R$
                    0,06) — confirmar na fatura antes de usar como custo em reais.
                  </TooltipContent>
                </Tooltip>
              </div>
              <div className="mt-1 text-2xl font-semibold">{fmtNum2(resumo.preco)}</div>
              <div className="mt-1 text-[11px] text-muted-foreground">
                {fmtInt(resumo.mau)} registro(s) de usuário ativo (MAU)
              </div>
            </Card>
          </div>

          {resumo.pctExpiradas >= 20 && (
            <div className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm">
              <span className="font-medium">
                {fmtPct1(resumo.pctExpiradas)} das mensagens expiraram
              </span>
              <p className="text-xs text-muted-foreground">
                Mensagem expirada é destinatário inalcançável na janela de entrega — não é falha de
                conteúdo. Vale revisar a origem e a validade da base de números.
              </p>
            </div>
          )}

          <div className="rounded-md border border-border">
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Transmissão</TableHead>
                    <TableHead className="text-right">Enviadas</TableHead>
                    <TableHead className="text-right">Entregues</TableHead>
                    <TableHead className="text-right">Lidas</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {porTransmissao.slice(0, 30).map((t) => (
                    <TableRow key={t.nome}>
                      <TableCell className="max-w-[320px] truncate font-medium">{t.nome}</TableCell>
                      <TableCell className="text-right tabular-nums">
                        {fmtInt(t.enviadas)}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {fmtInt(t.entregues)}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">{fmtInt(t.lidas)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
