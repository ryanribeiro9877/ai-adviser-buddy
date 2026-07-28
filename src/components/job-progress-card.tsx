import { useEffect, useState } from "react";
import { Loader2, Check, Microscope, RefreshCw, AlertTriangle } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

// Fases emitidas pela edge traffic-agent-job, na ordem em que acontecem.
const FASES = [
  { id: "planner", label: "Planejando" },
  { id: "subagentes", label: "Especialistas trabalhando" },
  { id: "sintese", label: "Escrevendo resposta" },
] as const;

// Nomes técnicos dos subagentes → rótulo do gestor.
const ESPECIALISTAS: Record<string, string> = {
  desempenho_campanhas: "Desempenho",
  criativos: "Criativos",
  compliance: "Compliance",
  estrutura_conta: "Estrutura",
  whatsapp_waba: "WhatsApp",
  alertas_recomendacoes: "Alertas",
  conhecimento: "Base técnica",
};

// A UI desiste antes do cron que expira jobs presos (15 min), para não deixar
// o card girando indefinidamente.
const TIMEOUT_UI_MS = 7 * 60 * 1000;

type Passo = { fase?: string; detalhe?: string; em?: string };

function passos(progresso: unknown): Passo[] {
  return Array.isArray(progresso) ? (progresso as Passo[]) : [];
}

// "especialistas: whatsapp_waba, criativos" → ["WhatsApp", "Criativos"]
function nomesEspecialistas(detalhe: string): string[] {
  const m = /especialistas:\s*(.+)$/i.exec(detalhe);
  if (!m) return [];
  return m[1]
    .split(/[,;]/)
    .map((s) => s.trim())
    .filter(Boolean)
    .map((s) => ESPECIALISTAS[s] ?? s);
}

export function JobProgressCard({
  jobId,
  onDone,
  onResend,
}: {
  jobId: string;
  onDone: () => void;
  onResend: () => void;
}) {
  const [status, setStatus] = useState<string>("queued");
  const [lista, setLista] = useState<Passo[]>([]);
  const [erro, setErro] = useState<string | null>(null);
  const [estourou, setEstourou] = useState(false);

  useEffect(() => {
    let vivo = true;
    const aplicar = (row: { status?: string; progresso?: unknown; erro?: string | null }) => {
      if (!vivo) return;
      if (row.status) setStatus(row.status);
      if (row.progresso !== undefined) setLista(passos(row.progresso));
      if (row.erro !== undefined) setErro(row.erro ?? null);
      // done: a mensagem final chega (ou já chegou) pelo Realtime de chat_messages.
      if (row.status === "done") onDone();
    };

    // Estado inicial: o job pode já ter avançado antes de assinarmos.
    supabase
      .from("chat_jobs")
      .select("status, progresso, erro")
      .eq("id", jobId)
      .maybeSingle()
      .then(({ data }) => data && aplicar(data));

    const canal = supabase
      .channel(`chat-job-${jobId}`)
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "chat_jobs", filter: `id=eq.${jobId}` },
        (payload) =>
          aplicar(payload.new as { status?: string; progresso?: unknown; erro?: string | null }),
      )
      .subscribe();

    const t = setTimeout(() => vivo && setEstourou(true), TIMEOUT_UI_MS);
    return () => {
      vivo = false;
      clearTimeout(t);
      supabase.removeChannel(canal);
    };
  }, [jobId, onDone]);

  const ultimo = lista[lista.length - 1];
  const faseAtual = ultimo?.fase ?? "planner";
  const indiceAtual = Math.max(
    0,
    FASES.findIndex((f) => f.id === faseAtual),
  );
  const especialistas = lista.flatMap((p) => nomesEspecialistas(p.detalhe ?? ""));

  if (status === "error" || (estourou && status !== "done")) {
    const msg =
      status === "error"
        ? (erro ?? "A análise falhou antes de concluir.")
        : "Está demorando mais que o normal.";
    return (
      <div className="rounded-md border border-destructive/40 bg-destructive/10 p-3">
        <div className="flex items-center gap-2 text-sm font-medium">
          <AlertTriangle className="h-4 w-4 text-destructive" />
          {status === "error" ? "A análise não foi concluída" : "Está demorando mais que o normal"}
        </div>
        <p className="mt-1 text-xs text-muted-foreground">{msg}</p>
        <Button size="sm" variant="outline" className="mt-2" onClick={onResend}>
          <RefreshCw className="mr-1 h-3.5 w-3.5" />
          Reenviar
        </Button>
      </div>
    );
  }

  return (
    <div className="rounded-md border border-border bg-muted/40 p-3">
      <div className="flex items-center gap-2 text-sm font-medium">
        <Microscope className="h-4 w-4 text-primary" />
        Análise profunda em andamento
      </div>

      <ol className="mt-2 space-y-1.5">
        {FASES.map((f, i) => {
          const feito = i < indiceAtual;
          const ativo = i === indiceAtual;
          return (
            <li
              key={f.id}
              className={cn(
                "flex items-center gap-2 text-xs",
                ativo
                  ? "text-foreground"
                  : feito
                    ? "text-muted-foreground"
                    : "text-muted-foreground/50",
              )}
            >
              {feito ? (
                <Check className="h-3.5 w-3.5 text-[color:var(--color-success)]" />
              ) : ativo ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin text-primary" />
              ) : (
                <span className="h-1.5 w-1.5 rounded-full bg-current opacity-50" />
              )}
              {f.label}
            </li>
          );
        })}
      </ol>

      {especialistas.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-1">
          {especialistas.map((e, i) => (
            <span
              key={`${e}-${i}`}
              className="rounded-md border border-border bg-background px-1.5 py-0.5 text-[11px]"
            >
              {e}
            </span>
          ))}
        </div>
      )}

      {ultimo?.detalhe && !ultimo.detalhe.startsWith("especialistas:") && (
        <div className="mt-2 text-[11px] text-muted-foreground">{ultimo.detalhe}</div>
      )}
    </div>
  );
}
