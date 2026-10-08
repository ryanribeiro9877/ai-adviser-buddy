import { useMemo, useState, type ReactNode } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, Download, HelpCircle, RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { exportarXlsx } from "@/lib/xlsx-export";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { FalhaDeCarga } from "@/components/falha-de-carga";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { cn } from "@/lib/utils";

// Inventário Cloud/WABA: tudo que NÃO é Click-to-WhatsApp.
// Inclui CLOUD_API, ON_PREMISE e linhas do waba-sync com platform_type null
// (sync antigo sem o campo) — identificadas por external_id sem prefixo ads-wa:.
// CLICK_TO_WHATSAPP = destino de anúncio (wa.me), sem qualidade/tier da Cloud API.
const CLOUD = "CLOUD_API";
const ADS_WA = "CLICK_TO_WHATSAPP";
const DIAS_HISTORICO = 14;
const DIAS_PADRAO = 30;
// Folga para considerar um número "visto no último sync": o waba-sync roda 1x/dia
// e pode atrasar; dois dias evita sumir número por um atraso de rodada.
const FOLGA_SYNC_MS = 2 * 864e5;
const TODAS = "__todas__";

export function isClickToWhatsApp(p: { platform_type: string | null; external_id: string }) {
  return p.platform_type === ADS_WA || p.external_id.startsWith("ads-wa:");
}

/** Números do inventário WABA (Cloud API / on-premise / sync sem platform_type). */
export function isWabaInventory(p: { platform_type: string | null; external_id: string }) {
  if (isClickToWhatsApp(p)) return false;
  // NOT_APPLICABLE = migrado/inativo sem qualidade legível — fica em "outros".
  if (p.platform_type === "NOT_APPLICABLE") return false;
  return p.platform_type === CLOUD || p.platform_type === "ON_PREMISE" || p.platform_type == null;
}

/**
 * Número que o sync mais recente da empresa ainda devolveu. O waba-sync faz upsert e
 * nunca apaga: número que migrou de WABA fica para trás com o carimbo velho (ex.: as
 * linhas de 22/07 sem platform_type). Contá-los somava a mesma pessoa duas vezes —
 * a Legal é Viver aparecia com 21 ativos quando o sync de hoje vê 13.
 */
export function vistoNoUltimoSync(
  p: { last_synced_at: string | null },
  ultimoSyncIso: string | null,
) {
  if (!ultimoSyncIso) return true;
  if (!p.last_synced_at) return false;
  return new Date(p.last_synced_at).getTime() >= new Date(ultimoSyncIso).getTime() - FOLGA_SYNC_MS;
}

/** Chave de comparação de telefone BR que ignora o nono dígito (+55 71 9412-0467 = +55 71 99412-0467). */
export function chaveTelefone(display: string | null) {
  const d = (display ?? "").replace(/\D/g, "");
  if (d.length < 10) return d;
  return d.slice(0, 4) + d.slice(-8);
}

/** Capacidade do tier da Meta: conversas iniciadas pela empresa em 24h. */
export function capacidadeDoTier(t?: string | null): number | null {
  const m = /^TIER_(\d+)(K|M)?$/.exec(t ?? "");
  if (!m) return null;
  const mult = m[2] === "M" ? 1_000_000 : m[2] === "K" ? 1_000 : 1;
  return Number(m[1]) * mult;
}

type Phone = {
  external_id: string;
  waba_external_id: string;
  display_phone_number: string | null;
  verified_name: string | null;
  status: string | null;
  quality_rating: string | null;
  messaging_limit_tier: string | null;
  platform_type: string | null;
  last_synced_at: string | null;
  raw: { campanhas?: string | null } | null;
};
type Waba = { external_id: string; name: string | null; account_review_status: string | null };
type Snap = { phone_external_id: string; snapshot_date: string; quality_rating: string | null };
type Envio = {
  waba_external_id: string;
  phone_external_id: string | null;
  date: string;
  sent: number | null;
  delivered: number | null;
};

const QUALIDADE: Record<string, { label: string; ponto: string; texto: string }> = {
  GREEN: { label: "Boa", ponto: "bg-[color:var(--color-success)]", texto: "🟢" },
  YELLOW: { label: "Atenção", ponto: "bg-[color:var(--color-warning)]", texto: "🟡" },
  RED: { label: "Crítica", ponto: "bg-destructive", texto: "🔴" },
  UNKNOWN: { label: "Não informada", ponto: "bg-muted-foreground/40", texto: "⚪" },
};

const tierLabel = (t?: string | null) =>
  !t ? "—" : t.replace(/^TIER_/, "").replace("UNLIMITED", "Ilimitado");

const isoDia = (d: Date) => d.toISOString().slice(0, 10);
const fmtDia = (iso: string) => {
  const [, m, d] = iso.split("-");
  return `${d}/${m}`;
};
const fmtInt = (n: number) => n.toLocaleString("pt-BR");
const fmtPct1 = (n: number) =>
  `${n.toLocaleString("pt-BR", { minimumFractionDigits: 1, maximumFractionDigits: 1 })}%`;

// PostgREST corta em 1000 linhas por resposta; o período livre passa disso fácil.
async function todasAsLinhas<T>(
  montar: (de: number, ate: number) => PromiseLike<{ data: T[] | null; error: unknown }>,
) {
  const tam = 1000;
  const out: T[] = [];
  for (let de = 0; ; de += tam) {
    const { data, error } = await montar(de, de + tam - 1);
    if (error) throw error;
    out.push(...(data ?? []));
    if ((data ?? []).length < tam) return out;
  }
}

function Ajuda({ children }: { children: ReactNode }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button type="button" className="text-muted-foreground/70">
          <HelpCircle className="h-3.5 w-3.5" />
        </button>
      </TooltipTrigger>
      <TooltipContent className="max-w-[280px] text-left">{children}</TooltipContent>
    </Tooltip>
  );
}

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
    return (
      <Tooltip>
        <TooltipTrigger asChild>
          <span className="text-xs text-muted-foreground underline decoration-dotted">
            sem série
          </span>
        </TooltipTrigger>
        <TooltipContent className="max-w-[260px] text-left">
          O sync diário não devolveu este número em nenhum dos últimos {DIAS_HISTORICO} dias — a
          Meta parou de listá-lo nesta conta (migrou de WABA ou o acesso caiu).
        </TooltipContent>
      </Tooltip>
    );
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
  const qc = useQueryClient();
  const hoje = useMemo(() => isoDia(new Date()), []);
  const [inicio, setInicio] = useState(() => isoDia(new Date(Date.now() - DIAS_PADRAO * 864e5)));
  const [fim, setFim] = useState(hoje);
  const [wabaFiltro, setWabaFiltro] = useState<string>(TODAS);
  const [pedindo, setPedindo] = useState(false);
  const periodoValido = inicio <= fim;

  const numeros = useQuery({
    queryKey: ["waba-phones", companyId],
    queryFn: async () => {
      // Inventário Click-to-WhatsApp a partir dos anúncios (idempotente; falha não bloqueia).
      await supabase.rpc("sincronizar_whatsapp_numeros_de_anuncios", {
        p_company_id: companyId,
      });
      const { data, error } = await supabase
        .from("waba_phone_numbers")
        .select(
          "external_id, waba_external_id, display_phone_number, verified_name, status, quality_rating, messaging_limit_tier, platform_type, last_synced_at, raw",
        )
        .eq("company_id", companyId);
      if (error) throw error;
      return (data ?? []) as unknown as Phone[];
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
      const desde = isoDia(new Date(Date.now() - DIAS_HISTORICO * 864e5));
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
    queryKey: ["waba-templates", companyId, inicio, fim, wabaFiltro],
    enabled: periodoValido,
    queryFn: async () => {
      const [analytics, { data: tpls, error: e2 }] = await Promise.all([
        todasAsLinhas<{
          waba_external_id: string;
          template_external_id: string;
          sent: number | null;
          delivered: number | null;
          read: number | null;
          clicked: number | null;
        }>((de, ate) => {
          let q = supabase
            .from("waba_template_analytics_daily")
            .select("waba_external_id, template_external_id, sent, delivered, read, clicked")
            .eq("company_id", companyId)
            .gte("date", inicio)
            .lte("date", fim);
          if (wabaFiltro !== TODAS) q = q.eq("waba_external_id", wabaFiltro);
          return q.order("date").range(de, ate);
        }),
        supabase
          .from("waba_templates")
          .select("external_id, name, category, status")
          .eq("company_id", companyId),
      ]);
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
          sent: number;
          delivered: number;
          read: number;
          clicked: number;
        }
      >();
      for (const a of analytics) {
        const m = meta.get(a.template_external_id);
        const nome = m?.name ?? a.template_external_id;
        const cur = agg.get(nome) ?? {
          nome,
          categoria: m?.category ?? "—",
          sent: 0,
          delivered: 0,
          read: 0,
          clicked: 0,
        };
        cur.sent += Number(a.sent ?? 0);
        cur.delivered += Number(a.delivered ?? 0);
        cur.read += Number(a.read ?? 0);
        cur.clicked += Number(a.clicked ?? 0);
        agg.set(nome, cur);
      }
      return [...agg.values()].sort((a, b) => b.sent - a.sent);
    },
  });

  // Envios do período. phone_external_id vazio = total da WABA (todas as conversas);
  // preenchido = recorte por número (analytics.phone_numbers da Meta). As duas séries
  // não somam igual — o total da WABA é a referência para "quanto a conta enviou".
  const envios = useQuery({
    queryKey: ["waba-envios", companyId, inicio, fim],
    enabled: periodoValido,
    queryFn: () =>
      todasAsLinhas<Envio>((de, ate) =>
        supabase
          .from("waba_analytics_daily")
          .select("waba_external_id, phone_external_id, date, sent, delivered")
          .eq("company_id", companyId)
          .gte("date", inicio)
          .lte("date", fim)
          .order("date")
          .range(de, ate),
      ),
  });

  const phones = useMemo(() => numeros.data ?? [], [numeros.data]);
  // Referência do "último sync": o carimbo mais novo entre os números Cloud da empresa.
  const ultimoSync = useMemo(() => {
    const ts = phones
      .filter(isWabaInventory)
      .map((p) => p.last_synced_at)
      .filter((x): x is string => !!x)
      .sort();
    return ts.length ? ts[ts.length - 1] : null;
  }, [phones]);
  const inventario = useMemo(() => phones.filter(isWabaInventory), [phones]);
  const vivosTodos = useMemo(
    () => inventario.filter((p) => vistoNoUltimoSync(p, ultimoSync)),
    [inventario, ultimoSync],
  );
  const foraDoSync = inventario.length - vivosTodos.length;
  const vivos = useMemo(
    () =>
      wabaFiltro === TODAS
        ? vivosTodos
        : vivosTodos.filter((p) => p.waba_external_id === wabaFiltro),
    [vivosTodos, wabaFiltro],
  );
  const emAnuncios = useMemo(() => phones.filter(isClickToWhatsApp), [phones]);
  const outrosSemCloud = useMemo(
    () => phones.filter((p) => !isWabaInventory(p) && !isClickToWhatsApp(p)).length,
    [phones],
  );
  const cloudPorTelefone = useMemo(
    () => new Map(vivosTodos.map((p) => [chaveTelefone(p.display_phone_number), p])),
    [vivosTodos],
  );

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
  // Só WABAs com número vivo entram no filtro: as outras não têm o que mostrar.
  const wabasComNumero = useMemo(() => {
    const ids = new Set(vivosTodos.map((p) => p.waba_external_id));
    return (wabas.data ?? []).filter((w) => ids.has(w.external_id));
  }, [wabas.data, vivosTodos]);
  const wabasSemAcesso = useMemo(() => {
    const comCloud = new Set(vivosTodos.map((p) => p.waba_external_id));
    return (wabas.data ?? []).filter(
      (w) => !w.external_id.startsWith("ads-destino-") && !comCloud.has(w.external_id),
    );
  }, [wabas.data, vivosTodos]);

  const seriePorNumero = useMemo(() => {
    const m = new Map<string, Snap[]>();
    for (const s of snaps.data ?? []) {
      const arr = m.get(s.phone_external_id) ?? [];
      arr.push(s);
      m.set(s.phone_external_id, arr);
    }
    return m;
  }, [snaps.data]);

  const enviosPorWaba = useMemo(() => {
    const agg = new Map<string, { waba: string; sent: number; delivered: number; dias: number }>();
    for (const e of envios.data ?? []) {
      if (e.phone_external_id) continue;
      if (wabaFiltro !== TODAS && e.waba_external_id !== wabaFiltro) continue;
      const cur = agg.get(e.waba_external_id) ?? {
        waba: e.waba_external_id,
        sent: 0,
        delivered: 0,
        dias: 0,
      };
      cur.sent += Number(e.sent ?? 0);
      cur.delivered += Number(e.delivered ?? 0);
      if (Number(e.sent ?? 0) > 0) cur.dias += 1;
      agg.set(e.waba_external_id, cur);
    }
    return [...agg.values()].filter((r) => r.sent > 0).sort((a, b) => b.sent - a.sent);
  }, [envios.data, wabaFiltro]);

  const phonePorId = useMemo(() => new Map(phones.map((p) => [p.external_id, p])), [phones]);
  const enviosPorNumero = useMemo(() => {
    const agg = new Map<
      string,
      {
        phone: string;
        waba: string;
        sent: number;
        delivered: number;
        pico: number;
        diaPico: string;
      }
    >();
    for (const e of envios.data ?? []) {
      if (!e.phone_external_id) continue;
      if (wabaFiltro !== TODAS && e.waba_external_id !== wabaFiltro) continue;
      const cur = agg.get(e.phone_external_id) ?? {
        phone: e.phone_external_id,
        waba: e.waba_external_id,
        sent: 0,
        delivered: 0,
        pico: 0,
        diaPico: "",
      };
      const s = Number(e.sent ?? 0);
      cur.sent += s;
      cur.delivered += Number(e.delivered ?? 0);
      if (s > cur.pico) {
        cur.pico = s;
        cur.diaPico = e.date;
      }
      agg.set(e.phone_external_id, cur);
    }
    return [...agg.values()].filter((r) => r.sent > 0).sort((a, b) => b.sent - a.sent);
  }, [envios.data, wabaFiltro]);

  const atualizarAgora = async () => {
    setPedindo(true);
    const { error } = await (
      supabase.rpc as unknown as (
        fn: string,
        args: Record<string, unknown>,
      ) => Promise<{ error: { message: string } | null }>
    )("pedir_sync_whatsapp_da_empresa", { p_company_id: companyId });
    setPedindo(false);
    if (error) {
      toast.error(`Não consegui pedir a atualização: ${error.message}`);
      return;
    }
    toast.success("Atualização pedida à Meta. Os números recarregam em instantes.");
    window.setTimeout(() => {
      void qc.invalidateQueries({ queryKey: ["waba-phones", companyId] });
      void qc.invalidateQueries({ queryKey: ["waba-snaps", companyId] });
      void qc.invalidateQueries({ queryKey: ["waba-templates", companyId] });
      void qc.invalidateQueries({ queryKey: ["waba-envios", companyId] });
    }, 20000);
  };

  if (numeros.isLoading || wabas.isLoading) {
    return (
      <div className="space-y-3">
        <Skeleton className="h-24 w-full" />
        <Skeleton className="h-56 w-full" />
      </div>
    );
  }

  // "Nada conectado" e uma afirmacao sobre a conta do cliente; so cabe depois de
  // conseguir perguntar. Com a consulta falhando, as duas listas chegam vazias
  // por `?? []` e a tela dizia que nao ha conta nem numero — quando o que houve
  // foi nao ter conseguido olhar.
  if (numeros.isError || wabas.isError) {
    return (
      <FalhaDeCarga
        oQue="as contas de WhatsApp desta empresa"
        erro={numeros.error ?? wabas.error}
        onTentarDeNovo={() => {
          void numeros.refetch();
          void wabas.refetch();
        }}
      />
    );
  }

  if (phones.length === 0 && (wabas.data ?? []).length === 0) {
    return (
      <Card className="p-6 text-sm text-muted-foreground">
        Nenhuma conta de WhatsApp Business conectada a esta empresa e nenhum número
        Click-to-WhatsApp encontrado nos anúncios.
      </Card>
    );
  }

  const soAnuncios = vivosTodos.length === 0 && emAnuncios.length > 0;
  const nomeWaba = (id: string) => wabaNome.get(id) ?? id;

  return (
    <div className="space-y-6">
      {soAnuncios && (
        <div className="rounded-md border border-border bg-muted/30 p-3 text-sm text-muted-foreground">
          Esta empresa não tem WABA Cloud API no sync oficial. Abaixo estão os números usados como
          destino Click-to-WhatsApp nos anúncios (sem qualidade/tier da Meta Cloud API).
        </div>
      )}

      {/* 0) Filtros — valem para resumo, números, templates e envios */}
      {!soAnuncios && (
        <Card className="flex flex-wrap items-end gap-3 p-3">
          <div className="min-w-[220px] flex-1">
            <label htmlFor="wa-filtro-waba" className="mb-1 block text-xs text-muted-foreground">
              Conta (WABA)
            </label>
            <Select value={wabaFiltro} onValueChange={setWabaFiltro}>
              <SelectTrigger id="wa-filtro-waba" className="h-9">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={TODAS}>Todas as WABAs ({wabasComNumero.length})</SelectItem>
                {wabasComNumero.map((w) => (
                  <SelectItem key={w.external_id} value={w.external_id}>
                    {w.name ?? w.external_id}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div>
            <label htmlFor="wa-filtro-inicio" className="mb-1 block text-xs text-muted-foreground">
              Data início
            </label>
            <Input
              type="date"
              id="wa-filtro-inicio"
              className="h-9 w-[150px]"
              value={inicio}
              max={fim}
              onChange={(e) => e.target.value && setInicio(e.target.value)}
            />
          </div>
          <div>
            <label htmlFor="wa-filtro-fim" className="mb-1 block text-xs text-muted-foreground">
              Data fim
            </label>
            <Input
              type="date"
              id="wa-filtro-fim"
              className="h-9 w-[150px]"
              value={fim}
              min={inicio}
              max={hoje}
              onChange={(e) => e.target.value && setFim(e.target.value)}
            />
          </div>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="h-9 gap-1"
            disabled={pedindo}
            onClick={() => void atualizarAgora()}
          >
            <RefreshCw className={cn("h-3.5 w-3.5", pedindo && "animate-spin")} />
            Atualizar da Meta
          </Button>
          <div className="w-full text-[11px] text-muted-foreground">
            Dados do sync diário (09:30)
            {ultimoSync
              ? `, última leitura ${new Date(ultimoSync).toLocaleString("pt-BR", {
                  timeZone: "America/Sao_Paulo",
                  day: "2-digit",
                  month: "2-digit",
                  hour: "2-digit",
                  minute: "2-digit",
                })}`
              : ""}
            . "Atualizar da Meta" relê os últimos 30 dias agora.
            {!periodoValido && (
              <span className="ml-1 text-destructive">Data início depois da data fim.</span>
            )}
          </div>
        </Card>
      )}

      {/* 1) Resumo Cloud API — só números que o último sync ainda vê */}
      {vivosTodos.length > 0 && (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Card className="p-4">
            <div className="text-xs text-muted-foreground">Números ativos (Cloud API)</div>
            <div className="mt-1 text-2xl font-semibold">{resumo.vivos}</div>
            <div className="mt-1 text-[11px] text-muted-foreground">
              {wabaFiltro === TODAS
                ? `nesta empresa, no último sync`
                : `nesta WABA, no último sync`}
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
              {resumo.tierQtd} de {resumo.vivos} números · conversas/24h por número
            </div>
          </Card>
          <Card className="p-4">
            <div className="text-xs text-muted-foreground">Contas (WABAs)</div>
            <div className="mt-1 text-2xl font-semibold">{wabasComNumero.length}</div>
            <div className="mt-1 text-[11px] text-muted-foreground">
              com número ativo
              {wabasSemAcesso.length > 0 && (
                <Tooltip>
                  <TooltipTrigger asChild>
                    <span className="ml-1 underline decoration-dotted">
                      · {wabasSemAcesso.length} sem número legível
                    </span>
                  </TooltipTrigger>
                  <TooltipContent className="max-w-[280px] text-left">
                    {wabasSemAcesso.map((w) => w.name ?? w.external_id).join(", ")}. A conta existe
                    no Business Manager, mas o sync não lê número ativo nela (número migrou para
                    outra WABA ou o ativo não está atribuído ao usuário de sistema).
                  </TooltipContent>
                </Tooltip>
              )}
            </div>
          </Card>
        </div>
      )}

      {emAnuncios.length > 0 && soAnuncios && (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <Card className="p-4">
            <div className="text-xs text-muted-foreground">Números em anúncios</div>
            <div className="mt-1 text-2xl font-semibold">{emAnuncios.length}</div>
            <div className="mt-1 text-[11px] text-muted-foreground">Click-to-WhatsApp (wa.me)</div>
          </Card>
          <Card className="p-4">
            <div className="text-xs text-muted-foreground">Em campanhas ativas</div>
            <div className="mt-1 text-2xl font-semibold">
              {emAnuncios.filter((p) => p.status === "IN_ACTIVE_ADS").length}
            </div>
            <div className="mt-1 text-[11px] text-muted-foreground">
              sinal de anúncio/conjunto ativo
            </div>
          </Card>
          <Card className="p-4">
            <div className="text-xs text-muted-foreground">Cloud API</div>
            <div className="mt-1 text-2xl font-semibold">0</div>
            <div className="mt-1 text-[11px] text-muted-foreground">
              sem WABA conectada nesta empresa
            </div>
          </Card>
        </div>
      )}

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

      {/* 2) Números Cloud API */}
      {vivos.length > 0 && (
        <div>
          <div className="mb-2 flex items-center justify-between gap-3">
            <h2 className="text-lg font-semibold">Números (Cloud API)</h2>
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
                    "Conta (WABA)": nomeWaba(p.waba_external_id),
                    Status: p.status ?? "",
                  })),
                  `whatsapp_numeros_${hoje}.xlsx`,
                  "Números",
                )
              }
            >
              <Download className="mr-1 h-4 w-4" />
              Exportar
            </Button>
          </div>
          <div className="rounded-md border border-border">
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Nome verificado</TableHead>
                    <TableHead>Número</TableHead>
                    <TableHead>Qualidade</TableHead>
                    <TableHead>
                      <span className="inline-flex items-center gap-1">
                        Tier
                        <Ajuda>
                          Limite da Meta de conversas iniciadas pela empresa, por número, em 24h
                          (ex.: 100K = até 100 mil pessoas diferentes por dia).
                        </Ajuda>
                      </span>
                    </TableHead>
                    <TableHead>Conta (WABA)</TableHead>
                    <TableHead>
                      <span className="inline-flex items-center gap-1">
                        Últimos {DIAS_HISTORICO} dias
                        <Ajuda>
                          Um bloco por dia em que o sync diário leu o número, na cor da qualidade
                          daquele dia (verde boa, amarelo atenção, vermelho crítica, cinza não
                          informada). Blocos faltando = dias em que a Meta não devolveu o número. A
                          coleta diária começou em 22/07.
                        </Ajuda>
                      </span>
                    </TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {vivos.map((p) => (
                    <TableRow key={p.external_id}>
                      <TableCell className="font-medium">{p.verified_name ?? "—"}</TableCell>
                      <TableCell className="tabular-nums">
                        {p.display_phone_number ?? "—"}
                      </TableCell>
                      <TableCell>
                        <QualidadeBadge q={p.quality_rating} />
                      </TableCell>
                      <TableCell>{tierLabel(p.messaging_limit_tier)}</TableCell>
                      <TableCell className="max-w-[220px] truncate text-sm text-muted-foreground">
                        {nomeWaba(p.waba_external_id)}
                      </TableCell>
                      <TableCell>
                        <HistoricoQualidade serie={seriePorNumero.get(p.external_id) ?? []} />
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </div>
          {foraDoSync + outrosSemCloud > 0 && wabaFiltro === TODAS && (
            <p className="mt-2 text-xs text-muted-foreground">
              {foraDoSync + outrosSemCloud} registro(s) antigos não entram na contagem: números que
              migraram de WABA ou que a Meta deixou de devolver no sync (ficaram com a leitura de
              22/07 ou 31/07). Não são números a mais — várias são a mesma linha que hoje está em
              outra WABA.
            </p>
          )}
        </div>
      )}

      {/* 3) Envios por WABA no período */}
      {!soAnuncios && (
        <div>
          <div className="mb-2 flex items-center justify-between gap-3">
            <h2 className="flex items-center gap-1 text-lg font-semibold">
              Envios por WABA
              <Ajuda>
                Total de mensagens que cada conta enviou e a Meta entregou no período filtrado
                (analytics da WABA, todas as conversas — não só templates).
              </Ajuda>
            </h2>
            {enviosPorWaba.length > 0 && (
              <Button
                size="sm"
                variant="outline"
                onClick={() =>
                  exportarXlsx(
                    enviosPorWaba.map((r) => ({
                      "Conta (WABA)": nomeWaba(r.waba),
                      Enviados: r.sent,
                      Entregues: r.delivered,
                      "Dias com envio": r.dias,
                    })),
                    `whatsapp_envios_waba_${inicio}_a_${fim}.xlsx`,
                    "Envios por WABA",
                  )
                }
              >
                <Download className="mr-1 h-4 w-4" />
                Exportar
              </Button>
            )}
          </div>
          <TabelaEnvios
            carregando={envios.isLoading}
            erro={envios.isError ? envios.error : null}
            onTentar={() => void envios.refetch()}
            vazio={enviosPorWaba.length === 0}
            colunas={["Conta (WABA)", "Enviados", "Entregues", "Taxa de entrega", "Dias com envio"]}
          >
            {enviosPorWaba.map((r) => (
              <TableRow key={r.waba}>
                <TableCell className="max-w-[320px] truncate font-medium">
                  {nomeWaba(r.waba)}
                </TableCell>
                <TableCell className="text-right tabular-nums">{fmtInt(r.sent)}</TableCell>
                <TableCell className="text-right tabular-nums">{fmtInt(r.delivered)}</TableCell>
                <TableCell className="text-right tabular-nums">
                  {r.sent > 0 ? fmtPct1((r.delivered / r.sent) * 100) : "—"}
                </TableCell>
                <TableCell className="text-right tabular-nums">{r.dias}</TableCell>
              </TableRow>
            ))}
            {enviosPorWaba.length > 1 && (
              <TableRow className="font-semibold">
                <TableCell>Total</TableCell>
                <TableCell className="text-right tabular-nums">
                  {fmtInt(enviosPorWaba.reduce((s, r) => s + r.sent, 0))}
                </TableCell>
                <TableCell className="text-right tabular-nums">
                  {fmtInt(enviosPorWaba.reduce((s, r) => s + r.delivered, 0))}
                </TableCell>
                <TableCell />
                <TableCell />
              </TableRow>
            )}
          </TabelaEnvios>
        </div>
      )}

      {/* 4) Envios por número — quanto cada número disparou e quão perto do limite chegou */}
      {!soAnuncios && (
        <div>
          <div className="mb-2 flex items-center justify-between gap-3">
            <h2 className="flex items-center gap-1 text-lg font-semibold">
              Envios por número
              <Ajuda>
                Mensagens que cada número enviou no período (recorte por número da Meta). "Pico
                diário" é o dia em que ele mais disparou; "% do limite" compara esse pico com a
                capacidade do tier (conversas por 24h). Perto de 100% = número no teto do dia.
              </Ajuda>
            </h2>
            {enviosPorNumero.length > 0 && (
              <Button
                size="sm"
                variant="outline"
                onClick={() =>
                  exportarXlsx(
                    enviosPorNumero.map((r) => {
                      const p = phonePorId.get(r.phone);
                      const cap = capacidadeDoTier(p?.messaging_limit_tier);
                      return {
                        Número: p?.display_phone_number ?? r.phone,
                        "Nome verificado": p?.verified_name ?? "",
                        "Conta (WABA)": nomeWaba(r.waba),
                        Enviados: r.sent,
                        Entregues: r.delivered,
                        "Pico diário": r.pico,
                        "Dia do pico": r.diaPico,
                        "Capacidade/24h": cap,
                        "% do limite no pico": cap
                          ? Number(((r.pico / cap) * 100).toFixed(2))
                          : null,
                      };
                    }),
                    `whatsapp_envios_numero_${inicio}_a_${fim}.xlsx`,
                    "Envios por número",
                  )
                }
              >
                <Download className="mr-1 h-4 w-4" />
                Exportar
              </Button>
            )}
          </div>
          <TabelaEnvios
            carregando={envios.isLoading}
            erro={envios.isError ? envios.error : null}
            onTentar={() => void envios.refetch()}
            vazio={enviosPorNumero.length === 0}
            colunas={[
              "Número",
              "Conta (WABA)",
              "Enviados",
              "Entregues",
              "Pico diário",
              "Capacidade/24h",
              "% do limite",
            ]}
          >
            {enviosPorNumero.map((r) => {
              const p = phonePorId.get(r.phone);
              const cap = capacidadeDoTier(p?.messaging_limit_tier);
              return (
                <TableRow key={r.phone}>
                  <TableCell>
                    <div className="tabular-nums font-medium">
                      {p?.display_phone_number ?? r.phone}
                    </div>
                    <div className="max-w-[260px] truncate text-[11px] text-muted-foreground">
                      {p?.verified_name ?? ""}
                    </div>
                  </TableCell>
                  <TableCell className="max-w-[200px] truncate text-sm text-muted-foreground">
                    {nomeWaba(r.waba)}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">{fmtInt(r.sent)}</TableCell>
                  <TableCell className="text-right tabular-nums">{fmtInt(r.delivered)}</TableCell>
                  <TableCell className="text-right tabular-nums">
                    {fmtInt(r.pico)}
                    {r.diaPico && (
                      <span className="ml-1 text-[11px] text-muted-foreground">
                        ({fmtDia(r.diaPico)})
                      </span>
                    )}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {cap ? fmtInt(cap) : tierLabel(p?.messaging_limit_tier)}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {cap ? fmtPct1((r.pico / cap) * 100) : "—"}
                  </TableCell>
                </TableRow>
              );
            })}
          </TabelaEnvios>
        </div>
      )}

      {/* 5) Templates — da WABA e do período filtrados */}
      {!soAnuncios && (
        <div>
          <div className="mb-2 flex items-center justify-between gap-3">
            <h2 className="text-lg font-semibold">Templates</h2>
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
                    `whatsapp_templates_${inicio}_a_${fim}.xlsx`,
                    "Templates",
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
                    <TableHead>Template</TableHead>
                    <TableHead>Categoria</TableHead>
                    <TableHead className="text-right">Enviados</TableHead>
                    <TableHead className="text-right">Entregues</TableHead>
                    <TableHead className="text-right">Lidos</TableHead>
                    <TableHead className="text-right">Cliques</TableHead>
                    <TableHead className="text-right">
                      <span className="inline-flex items-center gap-1">
                        Taxa de clique
                        <Ajuda>
                          Cliques ÷ enviados. Pode passar de 100% quando o recibo de leitura está
                          desligado ou o mesmo contato clica mais de uma vez — o valor é exibido
                          como vem.
                        </Ajuda>
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
                        <TableCell className="text-sm text-muted-foreground">
                          {t.categoria}
                        </TableCell>
                        <TableCell className="text-right tabular-nums">{fmtInt(t.sent)}</TableCell>
                        <TableCell className="text-right tabular-nums">
                          {fmtInt(t.delivered)}
                        </TableCell>
                        <TableCell className="text-right tabular-nums">{fmtInt(t.read)}</TableCell>
                        <TableCell className="text-right tabular-nums">
                          {fmtInt(t.clicked)}
                        </TableCell>
                        <TableCell className="text-right tabular-nums">
                          {t.sent > 0 ? fmtPct1((t.clicked / t.sent) * 100) : "—"}
                        </TableCell>
                      </TableRow>
                    );
                  })}
                  {templates.isError && (
                    <TableRow>
                      <TableCell colSpan={7} className="p-0">
                        <FalhaDeCarga
                          compacto
                          oQue="os envios de template"
                          erro={templates.error}
                          onTentarDeNovo={() => void templates.refetch()}
                        />
                      </TableCell>
                    </TableRow>
                  )}
                  {!templates.isLoading &&
                    !templates.isError &&
                    (templates.data ?? []).length === 0 && (
                      <TableRow>
                        <TableCell colSpan={7} className="text-sm text-muted-foreground">
                          Sem envios de template nesta conta e período.
                        </TableCell>
                      </TableRow>
                    )}
                </TableBody>
              </Table>
            </div>
          </div>
        </div>
      )}

      {/* 6) Números Click-to-WhatsApp em anúncios */}
      {emAnuncios.length > 0 && (
        <div>
          <div className="mb-2 flex items-center justify-between gap-3">
            <h2 className="text-lg font-semibold">Números em anúncios</h2>
            <Button
              size="sm"
              variant="outline"
              onClick={() =>
                exportarXlsx(
                  emAnuncios.map((p) => ({
                    Contexto: p.verified_name ?? "",
                    Número: p.display_phone_number ?? "",
                    Campanhas: p.raw?.campanhas ?? "",
                    Status: p.status === "IN_ACTIVE_ADS" ? "Em campanha ativa" : "Em anúncios",
                    Origem: "Click-to-WhatsApp (wa.me)",
                  })),
                  `whatsapp_anuncios_${hoje}.xlsx`,
                  "Anúncios",
                )
              }
            >
              <Download className="mr-1 h-4 w-4" />
              Exportar
            </Button>
          </div>
          <div className="rounded-md border border-border">
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Contexto (conjunto)</TableHead>
                    <TableHead>Número</TableHead>
                    <TableHead>Campanha de origem</TableHead>
                    <TableHead>Uso</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {emAnuncios.map((p) => {
                    const mesmo = cloudPorTelefone.get(chaveTelefone(p.display_phone_number));
                    return (
                      <TableRow key={p.external_id}>
                        <TableCell className="max-w-[300px] truncate font-medium">
                          {p.verified_name ?? "—"}
                        </TableCell>
                        <TableCell>
                          <div className="tabular-nums">{p.display_phone_number ?? "—"}</div>
                          {mesmo && (
                            <div className="text-[11px] text-muted-foreground">
                              mesmo número de {mesmo.verified_name ?? "um número Cloud API"}
                            </div>
                          )}
                        </TableCell>
                        <TableCell className="max-w-[260px] truncate text-sm text-muted-foreground">
                          {p.raw?.campanhas ?? "—"}
                        </TableCell>
                        <TableCell>
                          <Badge variant={p.status === "IN_ACTIVE_ADS" ? "default" : "secondary"}>
                            {p.status === "IN_ACTIVE_ADS" ? "Em campanha ativa" : "Em anúncios"}
                          </Badge>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          </div>
          <p className="mt-2 text-xs text-muted-foreground">
            Números que os anúncios desta empresa usam como destino wa.me. Sem qualidade e tier da
            Cloud API — esses números não passam pelo waba-sync oficial.
          </p>
        </div>
      )}
    </div>
  );
}

function TabelaEnvios({
  carregando,
  erro,
  onTentar,
  vazio,
  colunas,
  children,
}: {
  carregando: boolean;
  erro: unknown;
  onTentar: () => void;
  vazio: boolean;
  colunas: string[];
  children: ReactNode;
}) {
  return (
    <div className="rounded-md border border-border">
      <div className="overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow>
              {colunas.map((c, i) => (
                <TableHead key={c} className={i === 0 || c === "Conta (WABA)" ? "" : "text-right"}>
                  {c}
                </TableHead>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {carregando &&
              [0, 1, 2].map((i) => (
                <TableRow key={i}>
                  <TableCell colSpan={colunas.length}>
                    <Skeleton className="h-5 w-full" />
                  </TableCell>
                </TableRow>
              ))}
            {!carregando && !!erro && (
              <TableRow>
                <TableCell colSpan={colunas.length} className="p-0">
                  <FalhaDeCarga
                    compacto
                    oQue="os envios do período"
                    erro={erro}
                    onTentarDeNovo={onTentar}
                  />
                </TableCell>
              </TableRow>
            )}
            {!carregando && !erro && vazio && (
              <TableRow>
                <TableCell colSpan={colunas.length} className="text-sm text-muted-foreground">
                  Sem envios registrados nesta conta e período.
                </TableCell>
              </TableRow>
            )}
            {!carregando && !erro && children}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
