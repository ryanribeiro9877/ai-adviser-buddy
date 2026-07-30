import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useLocation, useNavigate } from "@tanstack/react-router";
import { toast } from "sonner";
import { X } from "lucide-react";
import type { RealtimePostgresChangesPayload } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";
import { useApp } from "@/lib/app-context";
import {
  destinoNotificacao,
  ehNovaPendencia,
  maiorUrgencia,
  persistente,
  planejarToasts,
  primeiraLinha,
  rotuloGrupo,
  URGENCIA,
  NOTIFICACOES_VAZIAS,
  type EventoRealtime,
  type ItemNotificacao,
  type Notificacoes,
  type TipoNotif,
  type UrgenciaNotif,
} from "@/lib/notificacoes";
import { cn } from "@/lib/utils";

// Rajada: os crons rodam 09:15/09:20/09:40/09:45 e podem criar vários alertas em
// segundos. Eventos são acumulados e só viram toast depois de SILENCIO_MS sem
// novidade — ou ao bater JANELA_RAJADA_MS, para nunca segurar aviso indefinidamente.
const SILENCIO_MS = 1200;
const JANELA_RAJADA_MS = 10_000;
const DURACAO_CURTA_MS = 8000;
// Contador de expiração: o minuto que passa não gera evento no banco, então a
// urgência (que é calculada na RPC a partir de expires_at) só se atualiza com um
// novo fetch. Só liga quando existe aprovação pendente com prazo.
const RELOGIO_MS = 60_000;

const CHAVE = (companyId: string) => ["notificacoes", companyId] as const;

type Ctx = {
  dados: Notificacoes;
  carregando: boolean;
  erro: string | null;
  /** Nº de vezes que alguém pediu para abrir o sino (toast agrupado). */
  pedidoDeAbrir: number;
  abrirSino: () => void;
  irPara: (item: ItemNotificacao) => void;
  recarregar: () => void;
};

const NotifCtx = createContext<Ctx | null>(null);

/** Cartão do toast. `role=alert` em urgência alta (leitor de tela interrompe). */
function CartaoToast({
  urgencia,
  titulo,
  descricao,
  acao,
  onAbrir,
  onFechar,
}: {
  urgencia: UrgenciaNotif;
  titulo: string;
  descricao: string;
  acao: string;
  onAbrir: () => void;
  onFechar: () => void;
}) {
  const u = URGENCIA[urgencia];
  const alta = persistente(urgencia);
  return (
    <div
      role={alta ? "alert" : "status"}
      aria-live={alta ? "assertive" : "polite"}
      className="flex w-[356px] max-w-[90vw] items-start gap-2 rounded-md border border-border bg-background p-3 shadow-lg"
    >
      <span className={cn("mt-1.5 h-2 w-2 shrink-0 rounded-full", u.ponto)} aria-hidden />
      <button
        type="button"
        onClick={onAbrir}
        className="min-w-0 flex-1 cursor-pointer text-left"
        title={acao}
      >
        <div className="flex items-center gap-2">
          <span className="truncate text-sm font-medium">{titulo}</span>
          <span className={cn("shrink-0 text-[11px] font-medium", u.texto)}>{u.rotulo}</span>
        </div>
        {descricao && (
          <p className="mt-0.5 line-clamp-2 text-xs text-muted-foreground">{descricao}</p>
        )}
        <span className="mt-1 inline-block text-xs font-medium text-primary">{acao}</span>
      </button>
      <button
        type="button"
        onClick={onFechar}
        aria-label="Fechar aviso"
        className="shrink-0 rounded p-0.5 text-muted-foreground hover:bg-muted hover:text-foreground"
      >
        <X className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}

export function NotificacoesProvider({ children }: { children: ReactNode }) {
  const { selectedCompany } = useApp();
  const companyId = selectedCompany?.id ?? null;
  const qc = useQueryClient();
  const navigate = useNavigate();
  const location = useLocation();

  const query = useQuery({
    queryKey: CHAVE(companyId ?? "nenhuma"),
    enabled: !!companyId,
    queryFn: async (): Promise<Notificacoes> => {
      const { data, error } = await supabase.rpc("get_notificacoes_pendentes", {
        p_company_id: companyId!,
      });
      if (error) throw error;
      return (data as unknown as Notificacoes) ?? NOTIFICACOES_VAZIAS;
    },
    // Sem polling: o Realtime avisa. A única exceção é o relógio da expiração.
    refetchInterval: (q) =>
      (q.state.data?.itens ?? []).some((i) => i.tipo === "aprovacao" && i.expires_at)
        ? RELOGIO_MS
        : false,
  });

  const dados = query.data ?? NOTIFICACOES_VAZIAS;

  const [pedidoDeAbrir, setPedidoDeAbrir] = useState(0);
  const abrirSino = useCallback(() => setPedidoDeAbrir((n) => n + 1), []);

  const irPara = useCallback(
    (item: ItemNotificacao) => {
      if (item.tipo === "alerta") {
        navigate({
          to: "/alertas",
          search: (prev: Record<string, unknown>) => ({ ...prev, item: item.id }),
        });
        return;
      }
      navigate({
        to: "/recomendacoes",
        search: (prev: Record<string, unknown>) => ({
          ...prev,
          tab: "aprovacoes",
          item: item.id,
        }),
      });
    },
    [navigate],
  );

  // ---- refs para os handlers do Realtime não capturarem estado velho ----
  const bufferRef = useRef(new Map<string, TipoNotif>());
  const jaToastadosRef = useRef(new Set<string>());
  const ativosRef = useRef(new Set<string>());
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const inicioJanelaRef = useRef<number | null>(null);
  const seqRef = useRef(0);

  const pathRef = useRef(location.pathname);
  pathRef.current = location.pathname;
  const refetchRef = useRef(query.refetch);
  refetchRef.current = query.refetch;
  const irParaRef = useRef(irPara);
  irParaRef.current = irPara;

  const soltar = (id: string) => ativosRef.current.delete(id);

  const mostrarToast = useCallback(
    (
      id: string,
      urgencia: UrgenciaNotif,
      titulo: string,
      descricao: string,
      onAbrir: () => void,
    ) => {
      ativosRef.current.add(id);
      toast.custom(
        () => (
          <CartaoToast
            urgencia={urgencia}
            titulo={titulo}
            descricao={descricao}
            acao="Ver agora"
            onAbrir={() => {
              toast.dismiss(id);
              soltar(id);
              onAbrir();
            }}
            onFechar={() => {
              toast.dismiss(id);
              soltar(id);
            }}
          />
        ),
        {
          id,
          duration: persistente(urgencia) ? Infinity : DURACAO_CURTA_MS,
          onDismiss: () => soltar(id),
          onAutoClose: () => soltar(id),
        },
      );
    },
    [],
  );

  const toastAgrupado = useCallback(
    (itens: ItemNotificacao[]) => {
      const u = maiorUrgencia(itens);
      seqRef.current += 1;
      mostrarToast(
        `notif-grupo:${seqRef.current}`,
        u,
        rotuloGrupo(itens),
        itens
          .slice(0, 3)
          .map((i) => i.titulo)
          .join(" · "),
        abrirSino,
      );
    },
    [abrirSino, mostrarToast],
  );

  /**
   * Realtime é só o gatilho; o conteúdo e a urgência vêm da RPC. Assim um item
   * que já foi resolvido entre o evento e o flush simplesmente não aparece —
   * e nunca existe urgência calculada no front.
   */
  const flush = useCallback(async () => {
    timerRef.current = null;
    const ids = [...bufferRef.current.keys()];
    bufferRef.current.clear();
    inicioJanelaRef.current = null;
    if (ids.length === 0) return;
    // Marca antes de resolver: um mesmo id nunca dispara dois toasts na sessão.
    ids.forEach((id) => jaToastadosRef.current.add(id));

    const { data } = await refetchRef.current();
    const itens = data?.itens ?? [];
    const encontrados = ids
      .map((id) => itens.find((i) => i.id === id))
      .filter((i): i is ItemNotificacao => !!i);
    // Quem já está na tela de destino está vendo o item — não interromper.
    const novos = encontrados.filter((i) => destinoNotificacao(i).pathname !== pathRef.current);
    if (novos.length === 0) return;

    const { individuais, agrupado } = planejarToasts(novos, ativosRef.current.size);
    for (const item of individuais) {
      mostrarToast(
        `notif:${item.id}`,
        item.urgencia,
        item.titulo,
        primeiraLinha(item.descricao),
        () => irParaRef.current(item),
      );
    }
    if (agrupado.length > 0) toastAgrupado(agrupado);
  }, [mostrarToast, toastAgrupado]);

  const flushRef = useRef(flush);
  flushRef.current = flush;

  const enfileirar = useCallback((id: string, tipo: TipoNotif) => {
    if (jaToastadosRef.current.has(id) || bufferRef.current.has(id)) return;
    if (inicioJanelaRef.current == null) inicioJanelaRef.current = Date.now();
    bufferRef.current.set(id, tipo);
    const restante = Math.max(0, JANELA_RAJADA_MS - (Date.now() - inicioJanelaRef.current));
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => void flushRef.current(), Math.min(SILENCIO_MS, restante));
  }, []);

  // Trocar de empresa: o canal cai e reinscreve. O que já foi avisado continua
  // marcado (dedup é por sessão), mas o buffer da empresa anterior é descartado.
  useEffect(() => {
    if (!companyId) return;
    bufferRef.current.clear();
    inicioJanelaRef.current = null;
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }

    const invalidar = () => qc.invalidateQueries({ queryKey: CHAVE(companyId) });

    const aoEvento = (
      payload: RealtimePostgresChangesPayload<Record<string, unknown>>,
      tipo: TipoNotif,
    ) => {
      invalidar(); // badge e lista sobem/descem em qualquer evento
      if (!ehNovaPendencia(payload as EventoRealtime, tipo)) return;
      const id = (payload.new as { id?: string } | undefined)?.id;
      if (id) enfileirar(id, tipo);
    };

    // O filtro por company_id é obrigatório: o admin pertence às duas empresas e
    // sem ele receberia aviso da empresa que não está olhando.
    const canal = supabase
      .channel(`notificacoes:${companyId}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "approval_requests",
          filter: `company_id=eq.${companyId}`,
        },
        (p) => aoEvento(p, "aprovacao"),
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "alerts", filter: `company_id=eq.${companyId}` },
        (p) => aoEvento(p, "alerta"),
      )
      .subscribe();

    return () => {
      void supabase.removeChannel(canal);
    };
  }, [companyId, qc, enfileirar]);

  // Esc fecha os avisos abertos (os persistentes inclusive).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || ativosRef.current.size === 0) return;
      for (const id of ativosRef.current) toast.dismiss(id);
      ativosRef.current.clear();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const valor = useMemo<Ctx>(
    () => ({
      dados,
      carregando: query.isLoading,
      erro: query.error ? (query.error as Error).message : null,
      pedidoDeAbrir,
      abrirSino,
      irPara,
      recarregar: () => {
        if (companyId) void qc.invalidateQueries({ queryKey: CHAVE(companyId) });
      },
    }),
    [dados, query.isLoading, query.error, pedidoDeAbrir, abrirSino, irPara, companyId, qc],
  );

  return <NotifCtx.Provider value={valor}>{children}</NotifCtx.Provider>;
}

export function useNotificacoes() {
  const ctx = useContext(NotifCtx);
  if (!ctx) throw new Error("useNotificacoes precisa estar dentro de NotificacoesProvider");
  return ctx;
}
