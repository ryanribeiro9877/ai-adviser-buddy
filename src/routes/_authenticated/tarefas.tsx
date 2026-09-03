import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useApp } from "@/lib/app-context";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { AlertTriangle, CheckCircle2, CircleSlash, Clock, Loader2, RotateCw } from "lucide-react";
import { toast } from "sonner";

export const Route = createFileRoute("/_authenticated/tarefas")({
  component: Tarefas,
  head: () => ({ meta: [{ title: "Tarefas agendadas" }] }),
});

// Os desfechos são gravados no banco em código ('sucesso_vazio'); aqui viram frase.
// "Rodou, nada a fazer" é o estado que antes se confundia com "não rodou" — a distinção
// é o motivo de a tela existir.
const DESFECHO: Record<string, { rotulo: string; tom: "ok" | "vazio" | "erro" | "andando" }> = {
  sucesso: { rotulo: "Concluída", tom: "ok" },
  sucesso_vazio: { rotulo: "Rodou, nada a fazer", tom: "vazio" },
  falha: { rotulo: "Falhou", tom: "erro" },
  em_curso: { rotulo: "Em andamento", tom: "andando" },
};

const PERIODICIDADE: Record<string, string> = {
  frequente: "a cada poucos minutos",
  horaria: "de hora em hora",
  diaria: "uma vez por dia",
  semanal: "uma vez por semana",
};

function quando(iso: string | null) {
  if (!iso) return "nunca rodou";
  const d = new Date(iso);
  const min = Math.round((Date.now() - d.getTime()) / 60000);
  const relativo =
    min < 1
      ? "agora mesmo"
      : min < 60
        ? `há ${min} min`
        : min < 60 * 48
          ? `há ${Math.round(min / 60)} h`
          : `há ${Math.round(min / 1440)} dias`;
  return `${d.toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" })} (${relativo})`;
}

function duracao(ms: number | null) {
  if (ms === null || ms === undefined) return null;
  return ms < 1000 ? "menos de 1s" : `${Math.round(ms / 1000)}s`;
}

function Tarefas() {
  const { isAdmin } = useApp();

  const q = useQuery({
    queryKey: ["painel-tarefas"],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("painel_tarefas_agendadas");
      if (error) throw error;
      return data ?? [];
    },
    refetchInterval: 60_000,
  });

  const reexecutar = async (tarefa: string, titulo: string) => {
    const { error } = await supabase.rpc("reexecutar_tarefa", { p_tarefa: tarefa });
    if (error) {
      toast.error(`Não foi possível reexecutar: ${error.message}`);
      return;
    }
    // Tarefa HTTP não termina no disparo: quem fecha o registro é a conferência, que roda
    // de 5 em 5 minutos. Dizer isso evita a leitura de que "não fez nada".
    toast.success(`"${titulo}" foi disparada. O resultado aparece aqui em alguns minutos.`);
    q.refetch();
  };

  const itens = q.data ?? [];
  const atrasadas = itens.filter((t) => t.atrasada);
  const emDia = itens.filter((t) => !t.atrasada);
  const falhas7d = itens.reduce((s, t) => s + (t.falhas_7d ?? 0), 0);
  const semAgendamento = itens.filter((t) => !t.agendada_no_cron);

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-semibold">Tarefas agendadas</h1>
        <p className="text-sm text-muted-foreground">
          O que o sistema faz sozinho, quando rodou por último e o que encontrou.
        </p>
      </div>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Card className="p-4">
          <div className="text-2xl font-semibold">{emDia.length}</div>
          <div className="text-xs text-muted-foreground">em dia</div>
        </Card>
        <Card className="p-4">
          <div
            className={`text-2xl font-semibold ${atrasadas.length > 0 ? "text-destructive" : ""}`}
          >
            {atrasadas.length}
          </div>
          <div className="text-xs text-muted-foreground">atrasadas</div>
        </Card>
        <Card className="p-4">
          <div className="text-2xl font-semibold">{falhas7d}</div>
          <div className="text-xs text-muted-foreground">falhas em 7 dias</div>
        </Card>
        <Card className="p-4">
          <div className="text-2xl font-semibold">{semAgendamento.length}</div>
          <div className="text-xs text-muted-foreground">sem agendamento</div>
        </Card>
      </div>

      {q.isLoading && (
        <Card className="flex items-center gap-2 p-6 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" />
          Carregando as rotinas.
        </Card>
      )}

      {q.isError && (
        <Card className="p-6 text-sm text-destructive">
          Não foi possível ler a saúde das tarefas: {(q.error as Error).message}
        </Card>
      )}

      {atrasadas.length > 0 && (
        <section className="space-y-3">
          <h2 className="text-sm font-semibold text-destructive">
            Atrasadas — deveriam ter rodado e não rodaram
          </h2>
          {atrasadas.map((t) => (
            <LinhaTarefa key={t.tarefa} t={t} isAdmin={isAdmin} onReexecutar={reexecutar} />
          ))}
        </section>
      )}

      {emDia.length > 0 && (
        <section className="space-y-3">
          <h2 className="text-sm font-semibold text-muted-foreground">Em dia</h2>
          {emDia.map((t) => (
            <LinhaTarefa key={t.tarefa} t={t} isAdmin={isAdmin} onReexecutar={reexecutar} />
          ))}
        </section>
      )}

      {!q.isLoading && itens.length === 0 && (
        <Card className="p-6 text-sm text-muted-foreground">
          Nenhuma tarefa cadastrada no catálogo.
        </Card>
      )}
    </div>
  );
}

type Linha = {
  tarefa: string;
  titulo: string;
  pergunta: string | null;
  periodicidade: string | null;
  tipo: string;
  empresa: string | null;
  ultima_em: string | null;
  desfecho: string | null;
  duracao_ms: number | null;
  itens_processados: number | null;
  achados: number | null;
  mensagem_erro: string | null;
  atrasada: boolean;
  rodadas_7d: number | null;
  falhas_7d: number | null;
  agendada_no_cron: boolean;
};

function LinhaTarefa({
  t,
  isAdmin,
  onReexecutar,
}: {
  t: Linha;
  isAdmin: boolean;
  onReexecutar: (tarefa: string, titulo: string) => void;
}) {
  const d = t.desfecho ? DESFECHO[t.desfecho] : null;
  const Icone =
    t.atrasada || d?.tom === "erro"
      ? AlertTriangle
      : d?.tom === "andando"
        ? Clock
        : d?.tom === "vazio"
          ? CircleSlash
          : d?.tom === "ok"
            ? CheckCircle2
            : Clock;

  const cor =
    t.atrasada || d?.tom === "erro"
      ? "text-destructive"
      : d?.tom === "ok"
        ? "text-[color:var(--color-success,inherit)]"
        : "text-muted-foreground";

  return (
    <Card className="flex items-start gap-3 p-4">
      <div className="mt-0.5">
        <Icone className={`h-5 w-5 ${cor}`} />
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-semibold">{t.titulo}</span>
          <Badge variant={t.atrasada || d?.tom === "erro" ? "destructive" : "outline"}>
            {d?.rotulo ?? "Nunca rodou"}
          </Badge>
          {t.empresa && <Badge variant="secondary">{t.empresa}</Badge>}
          {!t.agendada_no_cron && <Badge variant="outline">sem agendamento</Badge>}
        </div>

        {t.pergunta && <div className="mt-1 text-sm text-muted-foreground">{t.pergunta}</div>}

        <div className="mt-2 text-xs text-muted-foreground">
          <span>Última rodada: {quando(t.ultima_em)}</span>
          {t.periodicidade && (
            <span> · esperada {PERIODICIDADE[t.periodicidade] ?? t.periodicidade}</span>
          )}
          {duracao(t.duracao_ms) && <span> · levou {duracao(t.duracao_ms)}</span>}
        </div>

        <div className="mt-1 text-xs text-muted-foreground">
          <span>{t.itens_processados ?? 0} itens processados</span>
          <span> · {t.achados ?? 0} achados</span>
          <span> · {t.rodadas_7d ?? 0} rodadas em 7 dias</span>
          {(t.falhas_7d ?? 0) > 0 && (
            <span className="text-destructive"> · {t.falhas_7d} falharam</span>
          )}
        </div>

        {t.mensagem_erro && (
          <div className="mt-2 rounded-md bg-destructive/10 p-2 text-xs text-destructive">
            {t.mensagem_erro}
          </div>
        )}
      </div>

      {isAdmin && t.agendada_no_cron && (
        <Button size="sm" variant="outline" onClick={() => onReexecutar(t.tarefa, t.titulo)}>
          <RotateCw className="mr-1 h-4 w-4" />
          Reexecutar
        </Button>
      )}
    </Card>
  );
}
