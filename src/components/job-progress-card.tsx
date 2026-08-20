import { useEffect, useRef, useState } from "react";
import { Loader2, Check, Microscope, RefreshCw, AlertTriangle, Clock } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { useAgora } from "@/hooks/use-agora";
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

// GT-16: a tela NÃO decide por tempo decorrido. Quem diz se o job morreu é a linha em
// `chat_jobs` — `status` e `erro`, escritos pelo worker ou pelo `expira-chat-jobs`.
//
// O relógio anterior (7 min) reprovava job vivo. Medição de 05/08 sobre os 15 jobs
// existentes, do `created_at` ao `finished_at` (que é o tempo que o gestor sente, já que o
// POST devolve 202 na hora): média 196 s, p95 440 s, máximo 542 s. O teto de 420 s ficava no
// meio da distribuição, com o p95 do lado errado dele, e 1 job em 15 o cruzava — e nesse caso
// o job seguia rodando e terminava com sucesso no servidor enquanto a tela já dizia que
// falhou. Falso negativo na tela, não timeout curto.
//
// Sobre medir do `created_at` e não do `started_at`: em job de 2 segmentos o `started_at` é
// reescrito no início do segmento 2, então `finished_at - started_at` mede só o último trecho
// (máximo 201 s) e esconde o tempo real. Os três jobs mais longos de 30/07 são todos
// `segmento = 2`.

// Intervalo da releitura da linha. Não é duração de job: é a frequência com que a tela
// reconfere o banco caso o Realtime perca um UPDATE.
const RELEITURA_MS = 20 * 1000;

// Rede de segurança, NÃO veredito. Cobre só a janela em que o worker morreu e o banco ainda
// não sabe: o `expira-chat-jobs` roda de hora em hora (hh:08) e só marca job com mais de
// 15 min, então a linha pode dizer 'running' sobre um job morto por até uma hora.
// Dimensionada sobre o máximo observado (542 s) com folga — nenhum dos 15 jobs passou de
// 900 s. Conta silêncio (tempo sem a linha avançar), não tempo total: job que segue emitindo
// fase está vivo por mais que demore.
const SILENCIO_MS = 15 * 60 * 1000;
// Em "Escrevendo resposta" o worker ja coletou tudo; se a sintese travar, 5 min de
// silencio basta para oferecer Reenviar sem esperar o watchdog de 15 min.
const SILENCIO_SINTESE_MS = 5 * 60 * 1000;

const minutos = (ms: number) => Math.floor(ms / 60000);

type Passo = { fase?: string; detalhe?: string; em?: string };
type Linha = {
  status?: string;
  progresso?: unknown;
  erro?: string | null;
  created_at?: string;
  started_at?: string | null;
};

function passos(progresso: unknown): Passo[] {
  return Array.isArray(progresso) ? (progresso as Passo[]) : [];
}

const instante = (iso?: string | null): number | null => {
  if (!iso) return null;
  const t = new Date(iso).getTime();
  return Number.isFinite(t) ? t : null;
};

// Quando a linha avançou pela última vez, segundo a PRÓPRIA linha. Usar o momento em que o
// componente montou seria errado ao reabrir uma conversa cujo job já estava silencioso: o
// relógio zeraria e o silêncio acumulado desapareceria da tela.
function carimboDoAvanco(row: Linha): number {
  const ps = passos(row.progresso);
  return (
    instante(ps[ps.length - 1]?.em) ??
    instante(row.started_at) ??
    instante(row.created_at) ??
    Date.now()
  );
}

// "especialistas: whatsapp_waba, criativos" → ["WhatsApp", "Criativos"]
function nomesEspecialistas(detalhe: string): string[] {
  const m = /especialistas:\s*(.+)$/i.exec(detalhe);
  if (!m) return [];
  const body = m[1]
    // remove sufixo de degradacao do planner e tier ([lite]/[fast]/…)
    .replace(/\s*\(plano padrao[^)]*\)/gi, "")
    .replace(/\s*\[(lite|standard|deep|fast)\]\s*$/i, "")
    .trim();
  return body
    .split(/[,;]/)
    .map((s) => s.trim())
    .filter(Boolean)
    .map((s) => ESPECIALISTAS[s] ?? s)
    .filter((s) => !/plano padrao/i.test(s));
}

/** Extrai o tier de capacidade do detalhe do progresso (ex.: "... [lite]"). */
function tierDoProgresso(lista: Passo[]): string | null {
  for (let i = lista.length - 1; i >= 0; i--) {
    const d = lista[i]?.detalhe ?? "";
    const m = /\[(lite|standard|deep)\]/i.exec(d) || /capacidade\s+(leve|padrao|profunda)/i.exec(d);
    if (m) {
      const raw = m[1].toLowerCase();
      if (raw === "leve" || raw === "lite") return "leve";
      if (raw === "profunda" || raw === "deep") return "profunda";
      return "padrão";
    }
  }
  return null;
}

/** Índice da fase VISÍVEL: fases internas (devolucao/segmento) não podem resetar para Planejando. */
function indiceDaFase(lista: Passo[]): number {
  let idx = 0;
  for (const p of lista) {
    const f = p.fase ?? "";
    const d = p.detalhe ?? "";
    if (f === "planner") idx = Math.max(idx, 0);
    else if (f === "subagentes" || f === "devolucao") idx = Math.max(idx, 1);
    else if (f === "sintese") idx = Math.max(idx, 2);
    else if (f === "segmento") {
      // Continuação: se o detalhe fala em síntese, mostra Escrevendo; senão Especialistas.
      if (/sintese|escrevendo|direto_para_sintese/i.test(d)) idx = Math.max(idx, 2);
      else idx = Math.max(idx, 1);
    }
  }
  return idx;
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
  const [ultimoAvanco, setUltimoAvanco] = useState(() => Date.now());

  // `onDone` é recriado a cada render do pai, que tem relógio de 15 s. Com ele nas
  // dependências, o canal do Realtime era desfeito e refeito a cada tique.
  const onDoneRef = useRef(onDone);
  useEffect(() => {
    onDoneRef.current = onDone;
  }, [onDone]);

  useEffect(() => {
    let vivo = true;
    let releitura: ReturnType<typeof setInterval> | null = null;
    const pararReleitura = () => {
      if (releitura) clearInterval(releitura);
      releitura = null;
    };

    // Assinatura da linha: só conta como AVANÇO quando algo de fato mudou. Sem isto a
    // releitura periódica zeraria o relógio de silêncio a cada consulta bem-sucedida e a
    // rede de segurança nunca dispararia.
    let assinatura = "";
    const aplicar = (row: Linha) => {
      if (!vivo) return;
      const nova = `${row.status ?? ""}|${passos(row.progresso).length}|${row.erro ?? ""}`;
      if (nova !== assinatura) {
        assinatura = nova;
        setUltimoAvanco(carimboDoAvanco(row));
      }
      if (row.status) setStatus(row.status);
      if (row.progresso !== undefined) setLista(passos(row.progresso));
      if (row.erro !== undefined) setErro(row.erro ?? null);
      if (row.status === "done" || row.status === "error") pararReleitura();
      // done: a mensagem final chega (ou já chegou) pelo Realtime de chat_messages.
      if (row.status === "done") onDoneRef.current();
    };

    const ler = async () => {
      const { data } = await supabase
        .from("chat_jobs")
        .select("status, progresso, erro, created_at, started_at")
        .eq("id", jobId)
        .maybeSingle();
      if (data) aplicar(data);
    };

    // Estado inicial: o job pode já ter avançado antes de assinarmos.
    void ler();
    // Lastro do Realtime: se o socket cair ou perder um UPDATE, a tela ainda converge para o
    // que a linha diz. É o que garante que job longo termine em sucesso sem intervenção.
    releitura = setInterval(() => void ler(), RELEITURA_MS);

    const canal = supabase
      .channel(`chat-job-${jobId}`)
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "chat_jobs", filter: `id=eq.${jobId}` },
        (payload) => aplicar(payload.new as Linha),
      )
      .subscribe();

    return () => {
      vivo = false;
      pararReleitura();
      supabase.removeChannel(canal);
    };
  }, [jobId]);

  // Relógio só enquanto há o que esperar — e só para MEDIR silêncio, nunca para reprovar.
  const aguardando = status !== "done" && status !== "error";
  const agora = useAgora(aguardando);

  const ultimo = lista[lista.length - 1];
  const indiceAtual = indiceDaFase(lista);
  const especialistas = lista.flatMap((p) => nomesEspecialistas(p.detalhe ?? ""));
  const tier = tierDoProgresso(lista);

  // Concluído: o card sai de cena por conta própria. O pai também o remove ao receber a
  // resposta, mas depender só disso deixaria o card girando "em andamento" sobre um job já
  // pronto caso o evento de chat_messages se perdesse.
  if (status === "done") return null;

  // Falha é o que o BANCO diz. O motivo vem de `erro` — inclusive o texto do
  // `expira-chat-jobs`, que explica a expiração melhor do que "tempo esgotado" explicaria.
  if (status === "error") {
    return (
      <div className="rounded-md border border-destructive/40 bg-destructive/10 p-3">
        <div className="flex items-center gap-2 text-sm font-medium">
          <AlertTriangle className="h-4 w-4 text-destructive" />A resposta não foi concluída
        </div>
        <p className="mt-1 text-xs text-muted-foreground">
          {erro ?? "O processamento parou antes de concluir."}
        </p>
        <Button size="sm" variant="outline" className="mt-2" onClick={onResend}>
          <RefreshCw className="mr-1 h-3.5 w-3.5" />
          Reenviar
        </Button>
      </div>
    );
  }

  const silencio = agora - ultimoAvanco;
  const silencioLimite = ultimo?.fase === "sintese" ? SILENCIO_SINTESE_MS : SILENCIO_MS;
  const emSilencio = silencio >= silencioLimite;

  return (
    <div className="rounded-md border border-border bg-muted/40 p-3">
      {/* Rótulo neutro: Q&A de análise usa o job por padrão (sem toggle). O mesmo card
          cobre encaminhamento pela traffic-chat. */}
      <div className="flex items-center gap-2 text-sm font-medium">
        <Microscope className="h-4 w-4 text-primary" />
        Preparando a resposta completa
        {tier && (
          <span className="rounded border border-border bg-background px-1.5 py-0.5 text-[10px] font-normal text-muted-foreground">
            análise {tier}
          </span>
        )}
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

      {/* Rede de segurança: informa silêncio e oferece saída, sem afirmar que o job falhou —
          ele pode estar terminando neste instante. O veredito continua sendo do banco. */}
      {emSilencio && (
        <div className="mt-2 flex flex-wrap items-center gap-2 border-t border-border pt-2">
          <span className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
            <Clock className="h-3.5 w-3.5" />
            Ainda processando; sem resposta do servidor há {minutos(silencio)} min.
          </span>
          <Button size="sm" variant="ghost" className="h-6 px-2 text-[11px]" onClick={onResend}>
            <RefreshCw className="mr-1 h-3 w-3" />
            Reenviar
          </Button>
        </div>
      )}
    </div>
  );
}
