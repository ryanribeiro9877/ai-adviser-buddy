import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { AlertTriangle, Download, HelpCircle, Link2Off } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { exportarXlsx } from "@/lib/xlsx-export";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
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
import { cn } from "@/lib/utils";

// Só CLOUD_API é número "vivo" na API: os demais (NOT_APPLICABLE, sem platform_type)
// vêm de WABAs migradas ou sem acesso e não têm qualidade/tier legíveis.
const CLOUD = "CLOUD_API";
const DIAS_HISTORICO = 14;

type Phone = {
  external_id: string;
  waba_external_id: string;
  display_phone_number: string | null;
  verified_name: string | null;
  status: string | null;
  quality_rating: string | null;
  messaging_limit_tier: string | null;
  platform_type: string | null;
};
type Waba = { external_id: string; name: string | null; account_review_status: string | null };
type Snap = { phone_external_id: string; snapshot_date: string; quality_rating: string | null };

const QUALIDADE: Record<string, { label: string; ponto: string; texto: string }> = {
  GREEN: { label: "Boa", ponto: "bg-[color:var(--color-success)]", texto: "🟢" },
  YELLOW: { label: "Atenção", ponto: "bg-[color:var(--color-warning)]", texto: "🟡" },
  RED: { label: "Crítica", ponto: "bg-destructive", texto: "🔴" },
  UNKNOWN: { label: "Não informada", ponto: "bg-muted-foreground/40", texto: "⚪" },
};

const tierLabel = (t?: string | null) =>
  !t ? "—" : t.replace(/^TIER_/, "").replace("UNLIMITED", "Ilimitado");

const fmtDia = (iso: string) => {
  const [, m, d] = iso.split("-");
  return `${d}/${m}`;
};
const fmtInt = (n: number) => n.toLocaleString("pt-BR");
const fmtPct1 = (n: number) =>
  `${n.toLocaleString("pt-BR", { minimumFractionDigits: 1, maximumFractionDigits: 1 })}%`;

function QualidadeBadge({ q }: { q: string | null }) {
  const meta = QUALIDADE[q ?? "UNKNOWN"] ?? QUALIDADE.UNKNOWN;
  return (
    <span className="inline-flex items-center gap-1.5 text-sm">
      <span className={cn("h-2 w-2 rounded-full", meta.ponto)} />
      {meta.label}
    </span>
  );
}

// Mini-histórico: um quadradinho por dia coletado, na cor da qualidade daquele dia.
// Serve para ver degradação (ex.: 7 dias verdes e um vermelho no fim).
function HistoricoQualidade({ serie }: { serie: Snap[] }) {
  if (serie.length === 0) {
    return <span className="text-xs text-muted-foreground">sem série</span>;
  }
  return (
    <div className="flex items-center gap-0.5">
      {serie.map((s) => {
        const meta = QUALIDADE[s.quality_rating ?? "UNKNOWN"] ?? QUALIDADE.UNKNOWN;
        return (
          <Tooltip key={s.snapshot_date}>
            <TooltipTrigger asChild>
              <span className={cn("h-4 w-1.5 rounded-sm", meta.ponto)} />
            </TooltipTrigger>
            <TooltipContent>
              {fmtDia(s.snapshot_date)} — {meta.label}
            </TooltipContent>
          </Tooltip>
        );
      })}
    </div>
  );
}

export function WhatsAppPanel({ companyId }: { companyId: string }) {
  const [janela, setJanela] = useState<"7" | "30">("30");

  const numeros = useQuery({
    queryKey: ["waba-phones", companyId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("waba_phone_numbers")
        .select(
          "external_id, waba_external_id, display_phone_number, verified_name, status, quality_rating, messaging_limit_tier, platform_type",
        )
        .eq("company_id", companyId);
      if (error) throw error;
      return (data ?? []) as Phone[];
    },
  });

  const wabas = useQuery({
    queryKey: ["wabas", companyId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("wabas")
        .select("external_id, name, account_review_status")
        .eq("company_id", companyId)
        .order("name");
      if (error) throw error;
      return (data ?? []) as Waba[];
    },
  });

  const snaps = useQuery({
    queryKey: ["waba-snaps", companyId],
    queryFn: async () => {
      const desde = new Date(Date.now() - DIAS_HISTORICO * 864e5).toISOString().slice(0, 10);
      const { data, error } = await supabase
        .from("waba_phone_snapshots")
        .select("phone_external_id, snapshot_date, quality_rating")
        .eq("company_id", companyId)
        .gte("snapshot_date", desde)
        .order("snapshot_date");
      if (error) throw error;
      return (data ?? []) as Snap[];
    },
  });

  // Nome/categoria do template vivem em waba_templates: na tabela de analytics a
  // coluna template_name está sempre nula, então o join por external_id é obrigatório.
  const templates = useQuery({
    queryKey: ["waba-templates", companyId, janela],
    queryFn: async () => {
      const desde = new Date(Date.now() - Number(janela) * 864e5).toISOString().slice(0, 10);
      const [{ data: analytics, error: e1 }, { data: tpls, error: e2 }] = await Promise.all([
        supabase
          .from("waba_template_analytics_daily")
          .select("template_external_id, sent, delivered, read, clicked")
          .eq("company_id", companyId)
          .gte("date", desde),
        supabase
          .from("waba_templates")
          .select("external_id, name, category, status")
          .eq("company_id", companyId),
      ]);
      if (e1) throw e1;
      if (e2) throw e2;
      const meta = new Map(
        (tpls ?? []).map((t) => [t.external_id, { name: t.name, category: t.category }]),
      );
      // Agrupa por NOME, não por external_id: o mesmo template existe replicado em
      // várias WABAs (ids diferentes, nome igual) e para o gestor é um só. Sem isso
      // o líder apareceria fatiado em três linhas.
      const agg = new Map<
        string,
        {
          nome: string;
          categoria: string;
          instancias: number;
          sent: number;
          delivered: number;
          read: number;
          clicked: number;
        }
      >();
      for (const a of analytics ?? []) {
        const m = meta.get(a.template_external_id);
        const nome = m?.name ?? a.template_external_id;
        const cur = agg.get(nome) ?? {
          nome,
          categoria: m?.category ?? "—",
          instancias: 0,
          sent: 0,
          delivered: 0,
          read: 0,
          clicked: 0,
        };
        cur.instancias += 1;
        cur.sent += Number(a.sent ?? 0);
        cur.delivered += Number(a.delivered ?? 0);
        cur.read += Number(a.read ?? 0);
        cur.clicked += Number(a.clicked ?? 0);
        agg.set(nome, cur);
      }
      return [...agg.values()].sort((a, b) => b.sent - a.sent);
    },
  });

  // Envios por número: a coleta por número (waba-sync v18) ainda não está ativa —
  // toda linha vem com phone_external_id vazio (total da WABA). Enquanto for assim,
  // a seção mostra estado vazio explícito em vez de zeros que parecem medição.
  const porNumero = useQuery({
    queryKey: ["waba-analytics-por-numero", companyId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("waba_analytics_daily")
        .select("phone_external_id, sent, delivered")
        .eq("company_id", companyId)
        .not("phone_external_id", "is", null)
        .neq("phone_external_id", "");
      if (error) throw error;
      return data ?? [];
    },
  });

  const porNumeroAtivo = (porNumero.data ?? []).length > 0;

  const phones = numeros.data ?? [];
  const vivos = useMemo(() => phones.filter((p) => p.platform_type === CLOUD), [phones]);
  const resumo = useMemo(() => {
    const conta = (q: string) => vivos.filter((p) => (p.quality_rating ?? "UNKNOWN") === q).length;
    const tiers = new Map<string, number>();
    for (const p of vivos) {
      const t = p.messaging_limit_tier ?? "—";
      tiers.set(t, (tiers.get(t) ?? 0) + 1);
    }
    const predominante = [...tiers.entries()].sort((a, b) => b[1] - a[1])[0];
    return {
      vivos: vivos.length,
      green: conta("GREEN"),
      yellow: conta("YELLOW"),
      red: conta("RED"),
      tier: predominante ? tierLabel(predominante[0]) : "—",
      tierQtd: predominante?.[1] ?? 0,
    };
  }, [vivos]);

  const wabaNome = useMemo(
    () => new Map((wabas.data ?? []).map((w) => [w.external_id, w.name ?? w.external_id])),
    [wabas.data],
  );
  const seriePorNumero = useMemo(() => {
    const m = new Map<string, Snap[]>();
    for (const s of snaps.data ?? []) {
      const arr = m.get(s.phone_external_id) ?? [];
      arr.push(s);
      m.set(s.phone_external_id, arr);
    }
    return m;
  }, [snaps.data]);

  // "Sem acesso" = WABA sem nenhum número CLOUD_API legível (ativo não atribuído ao
  // System User no BM). Não é erro do sistema: é pendência de permissão no Business Manager.
  const wabasSemAcesso = useMemo(() => {
    const comCloud = new Set(vivos.map((p) => p.waba_external_id));
    return (wabas.data ?? []).filter((w) => !comCloud.has(w.external_id));
  }, [wabas.data, vivos]);

  if (numeros.isLoading || wabas.isLoading) {
    return (
      <div className="space-y-3">
        <Skeleton className="h-24 w-full" />
        <Skeleton className="h-56 w-full" />
      </div>
    );
  }

  if (phones.length === 0 && (wabas.data ?? []).length === 0) {
    return (
      <Card className="p-6 text-sm text-muted-foreground">
        Nenhuma conta de WhatsApp Business conectada a esta empresa.
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      {/* 1) Resumo */}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Card className="p-4">
          <div className="text-xs text-muted-foreground">Números ativos (Cloud API)</div>
          <div className="mt-1 text-2xl font-semibold">{resumo.vivos}</div>
          <div className="mt-1 text-[11px] text-muted-foreground">
            de {phones.length} cadastrados
          </div>
        </Card>
        <Card className="p-4">
          <div className="text-xs text-muted-foreground">Qualidade</div>
          <div className="mt-1 flex items-baseline gap-3 text-2xl font-semibold">
            <span className="text-[color:var(--color-success)]">{resumo.green}</span>
            <span className="text-[color:var(--color-warning)]">{resumo.yellow}</span>
            <span className="text-destructive">{resumo.red}</span>
          </div>
          <div className="mt-1 text-[11px] text-muted-foreground">boa · atenção · crítica</div>
        </Card>
        <Card className="p-4">
          <div className="text-xs text-muted-foreground">Tier predominante</div>
          <div className="mt-1 text-2xl font-semibold">{resumo.tier}</div>
          <div className="mt-1 text-[11px] text-muted-foreground">
            {resumo.tierQtd} de {resumo.vivos} números
          </div>
        </Card>
        <Card className="p-4">
          <div className="text-xs text-muted-foreground">Contas (WABAs)</div>
          <div className="mt-1 text-2xl font-semibold">{(wabas.data ?? []).length}</div>
          <div className="mt-1 text-[11px] text-muted-foreground">
            {wabasSemAcesso.length > 0 ? `${wabasSemAcesso.length} sem acesso` : "todas com acesso"}
          </div>
        </Card>
      </div>

      {resumo.red > 0 && (
        <div className="flex items-start gap-2 rounded-md border border-destructive/40 bg-destructive/10 p-3">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-destructive" />
          <div className="text-sm">
            <span className="font-medium">
              {resumo.red === 1
                ? "1 número com qualidade crítica"
                : `${resumo.red} números com qualidade crítica`}
            </span>
            <p className="text-xs text-muted-foreground">
              Qualidade vermelha antecede restrição de envio pela Meta. Veja o mini-histórico abaixo
              para identificar quando começou.
            </p>
          </div>
        </div>
      )}

      {/* 2) Números */}
      <div>
        <div className="mb-2 flex items-center justify-between gap-3">
          <h2 className="text-lg font-semibold">Números</h2>
          {vivos.length > 0 && (
            <Button
              size="sm"
              variant="outline"
              onClick={() =>
                exportarXlsx(
                  vivos.map((p) => ({
                    "Nome verificado": p.verified_name ?? "",
                    Número: p.display_phone_number ?? "",
                    Qualidade: (QUALIDADE[p.quality_rating ?? "UNKNOWN"] ?? QUALIDADE.UNKNOWN)
                      .label,
                    Tier: tierLabel(p.messaging_limit_tier),
                    "Conta (WABA)": wabaNome.get(p.waba_external_id) ?? p.waba_external_id,
                    Status: p.status ?? "",
                  })),
                  `whatsapp_numeros_${new Date().toISOString().slice(0, 10)}.xlsx`,
                  "Números",
                )
              }
            >
              <Download className="mr-1 h-4 w-4" />
              Exportar
            </Button>
          )}
        </div>
        <div className="rounded-md border border-border">
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Nome verificado</TableHead>
                  <TableHead>Número</TableHead>
                  <TableHead>Qualidade</TableHead>
                  <TableHead>Tier</TableHead>
                  <TableHead>Conta (WABA)</TableHead>
                  <TableHead>
                    <span className="inline-flex items-center gap-1">
                      Últimos {DIAS_HISTORICO} dias
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <button type="button" className="text-muted-foreground/70">
                            <HelpCircle className="h-3.5 w-3.5" />
                          </button>
                        </TooltipTrigger>
                        <TooltipContent className="max-w-[260px] text-left">
                          Um bloco por dia coletado, na cor da qualidade daquele dia. A coleta
                          diária começou em 22/07.
                        </TooltipContent>
                      </Tooltip>
                    </span>
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {vivos.map((p) => (
                  <TableRow key={p.external_id}>
                    <TableCell className="font-medium">{p.verified_name ?? "—"}</TableCell>
                    <TableCell className="tabular-nums">{p.display_phone_number ?? "—"}</TableCell>
                    <TableCell>
                      <QualidadeBadge q={p.quality_rating} />
                    </TableCell>
                    <TableCell>{tierLabel(p.messaging_limit_tier)}</TableCell>
                    <TableCell className="max-w-[220px] truncate text-sm text-muted-foreground">
                      {wabaNome.get(p.waba_external_id) ?? p.waba_external_id}
                    </TableCell>
                    <TableCell>
                      <HistoricoQualidade serie={seriePorNumero.get(p.external_id) ?? []} />
                    </TableCell>
                  </TableRow>
                ))}
                {vivos.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={6} className="text-sm text-muted-foreground">
                      Nenhum número ativo na Cloud API.
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </div>
        </div>
        {phones.length > vivos.length && (
          <p className="mt-2 text-xs text-muted-foreground">
            {phones.length - vivos.length} número(s) não aparecem acima: são linhas migradas ou de
            contas sem acesso, sem qualidade e tier legíveis pela API.
          </p>
        )}
      </div>

      {/* 3) Templates */}
      <div>
        <div className="mb-2 flex items-center justify-between gap-3">
          <h2 className="text-lg font-semibold">Templates</h2>
          <div className="flex items-center gap-2">
            {(templates.data ?? []).length > 0 && (
              <Button
                size="sm"
                variant="outline"
                onClick={() =>
                  exportarXlsx(
                    (templates.data ?? []).map((t) => ({
                      Template: t.nome,
                      Categoria: t.categoria,
                      Enviados: t.sent,
                      Entregues: t.delivered,
                      Lidos: t.read,
                      Cliques: t.clicked,
                      "Taxa de clique (%)":
                        t.sent > 0 ? Number(((t.clicked / t.sent) * 100).toFixed(1)) : null,
                    })),
                    `whatsapp_templates_${janela}d_${new Date().toISOString().slice(0, 10)}.xlsx`,
                    "Templates",
                  )
                }
              >
                <Download className="mr-1 h-4 w-4" />
                Exportar
              </Button>
            )}
            <ToggleGroup
              type="single"
              value={janela}
              onValueChange={(v) => v && setJanela(v as "7" | "30")}
              variant="outline"
              size="sm"
            >
              <ToggleGroupItem value="7">7 dias</ToggleGroupItem>
              <ToggleGroupItem value="30">30 dias</ToggleGroupItem>
            </ToggleGroup>
          </div>
        </div>
        <div className="rounded-md border border-border">
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Template</TableHead>
                  <TableHead>Categoria</TableHead>
                  <TableHead className="text-right">Enviados</TableHead>
                  <TableHead className="text-right">Entregues</TableHead>
                  <TableHead className="text-right">Lidos</TableHead>
                  <TableHead className="text-right">Cliques</TableHead>
                  <TableHead className="text-right">
                    <span className="inline-flex items-center gap-1">
                      Taxa de clique
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <button type="button" className="text-muted-foreground/70">
                            <HelpCircle className="h-3.5 w-3.5" />
                          </button>
                        </TooltipTrigger>
                        <TooltipContent className="max-w-[260px] text-left">
                          Cliques ÷ enviados. Pode passar de 100% quando o recibo de leitura está
                          desligado ou o mesmo contato clica mais de uma vez — o valor é exibido
                          como vem.
                        </TooltipContent>
                      </Tooltip>
                    </span>
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {templates.isLoading &&
                  [0, 1, 2].map((i) => (
                    <TableRow key={i}>
                      <TableCell colSpan={7}>
                        <Skeleton className="h-5 w-full" />
                      </TableCell>
                    </TableRow>
                  ))}
                {(templates.data ?? []).map((t) => {
                  const semClique = t.sent > 0 && t.clicked === 0;
                  return (
                    <TableRow key={t.nome}>
                      <TableCell className="font-medium">
                        <div className="flex flex-wrap items-center gap-1.5">
                          <span className="max-w-[260px] truncate">{t.nome}</span>
                          {semClique && (
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <Badge variant="outline" className="font-normal text-[11px]">
                                  auditar botão/URL
                                </Badge>
                              </TooltipTrigger>
                              <TooltipContent className="max-w-[260px] text-left">
                                Teve envio e nenhum clique registrado na janela. Vale checar se o
                                botão/URL do template está correto e rastreável.
                              </TooltipContent>
                            </Tooltip>
                          )}
                        </div>
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground">{t.categoria}</TableCell>
                      <TableCell className="text-right tabular-nums">{fmtInt(t.sent)}</TableCell>
                      <TableCell className="text-right tabular-nums">
                        {fmtInt(t.delivered)}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">{fmtInt(t.read)}</TableCell>
                      <TableCell className="text-right tabular-nums">{fmtInt(t.clicked)}</TableCell>
                      <TableCell className="text-right tabular-nums">
                        {t.sent > 0 ? fmtPct1((t.clicked / t.sent) * 100) : "—"}
                      </TableCell>
                    </TableRow>
                  );
                })}
                {!templates.isLoading && (templates.data ?? []).length === 0 && (
                  <TableRow>
                    <TableCell colSpan={7} className="text-sm text-muted-foreground">
                      Sem envios de template nesta janela.
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </div>
        </div>
      </div>

      {/* 4) Envios por número — honesto sobre a coleta ainda não ativa */}
      <div>
        <h2 className="mb-2 text-lg font-semibold">Envios por número</h2>
        {porNumeroAtivo ? (
          <Card className="p-4 text-sm text-muted-foreground">
            {(porNumero.data ?? []).length} registro(s) por número disponíveis.
          </Card>
        ) : (
          <Card className="p-4">
            <div className="text-sm font-medium">Coleta por número ainda não ativa</div>
            <p className="mt-1 text-xs text-muted-foreground">
              Hoje o volume de envios chega agregado por conta (WABA), sem separação por número.
              Esta seção fica vazia de propósito — mostrar zero aqui pareceria medição, quando na
              verdade o dado ainda não é coletado.
            </p>
          </Card>
        )}
      </div>

      {/* 5) Contas (WABAs) */}
      <div>
        <h2 className="mb-2 text-lg font-semibold">Contas (WABAs)</h2>
        <div className="grid gap-2 md:grid-cols-2">
          {(wabas.data ?? []).map((w) => {
            const numerosDaWaba = vivos.filter((p) => p.waba_external_id === w.external_id);
            const semAcesso = numerosDaWaba.length === 0;
            return (
              <Card key={w.external_id} className="flex items-start justify-between gap-3 p-3">
                <div className="min-w-0">
                  <div className="truncate text-sm font-medium">{w.name ?? w.external_id}</div>
                  <div className="text-[11px] text-muted-foreground">
                    {semAcesso
                      ? "nenhum número legível pela API"
                      : `${numerosDaWaba.length} número(s) ativo(s)`}
                  </div>
                </div>
                {semAcesso ? (
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Badge variant="outline" className="shrink-0 gap-1 font-normal">
                        <Link2Off className="h-3 w-3" />
                        sem acesso
                      </Badge>
                    </TooltipTrigger>
                    <TooltipContent className="max-w-[260px] text-left">
                      A conta existe no Business Manager, mas os ativos não estão atribuídos ao
                      usuário de sistema — por isso não há números nem métricas. Atribuir no BM
                      resolve; não é falha do sistema.
                    </TooltipContent>
                  </Tooltip>
                ) : (
                  <Badge variant="secondary" className="shrink-0 font-normal">
                    {w.account_review_status === "APPROVED"
                      ? "aprovada"
                      : (w.account_review_status ?? "—")}
                  </Badge>
                )}
              </Card>
            );
          })}
        </div>
      </div>
    </div>
  );
}
